import { supabase } from '../lib/supabase';
import { TriviaQuestion, getPlayableCategories, isPlayableCategory } from '../types';

interface GetQuestionsForSessionParams {
  categories: string[];
  count: number;
  excludeQuestionIds?: string[];
  userId?: string;
}

const seenQuestionIdsCache = new Map<string, Promise<Set<string>>>();

function normalizeRequestedCategory(category: string) {
  return isPlayableCategory(category) ? category : getPlayableCategories()[0];
}

function toBankQuestion(question: any, createdAt = Date.now()): TriviaQuestion {
  const canonicalId = question.id || question.question_id;
  const distractors = Array.isArray(question.distractors)
    ? question.distractors.map((entry: unknown) => String(entry))
    : [];
  const normalizedChoices = Array.isArray(question.choices)
    ? question.choices
    : question.correct_answer
      ? [question.correct_answer, ...distractors]
      : [];
  const normalizedCorrectIndex = question.correctIndex
    ?? question.correct_index
    ?? (question.correct_answer ? normalizedChoices.indexOf(question.correct_answer) : 0);
  const normalizedStatus = question.status ?? question.validation_status ?? question.validationStatus ?? 'pending';
  const normalizedDifficulty = question.difficulty ?? question.difficulty_level ?? 'medium';
  const normalizedQuestionText = question.question ?? question.content ?? '';
  const normalizedPresentation = question.presentation || {
    questionStyled: question.questionStyled ?? question.question_styled,
    explanationStyled: question.explanationStyled ?? question.explanation_styled,
    hostLeadIn: question.hostLeadIn ?? question.host_lead_in,
  };

  return {
    id: canonicalId,
    category: question.category,
    subcategory: question.subcategory,
    difficulty: normalizedDifficulty,
    question: normalizedQuestionText,
    choices: normalizedChoices,
    correctIndex: normalizedCorrectIndex >= 0 ? normalizedCorrectIndex : 0,
    explanation: question.explanation,
    tags: question.tags || [],
    status: normalizedStatus,
    presentation: normalizedPresentation,
    sourceType: question.sourceType || question.source_type || 'manual',
    createdAt: question.createdAt || question.created_at || createdAt,
    metadata: {
      usedCount: question.usedCount ?? question.used_count ?? 0,
      used: question.used ?? false,
      validationStatus: question.validationStatus,
      verificationVerdict: question.verificationVerdict,
      ...question.metadata,
    },
  };
}

function dedupeById(questions: TriviaQuestion[]) {
  const seen = new Set<string>();

  return questions.filter((question) => {
    if (!question.id || seen.has(question.id)) return false;
    seen.add(question.id);
    return true;
  });
}

async function fetchApprovedQuestionsByCategory(category: string, excludeIds: Set<string>, count: number) {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('category', category)
    .order('created_at', { ascending: false })
    .limit(Math.max(count * 5, 20));

  if (error) {
    console.error('Error fetching questions from Supabase:', error);
    return [];
  }

  return (data || [])
    .map((entry) => toBankQuestion(entry))
    .filter((question) => question.status === 'approved')
    .filter((question) => question.choices.length === 4)
    .filter((question) => !excludeIds.has(question.id));
}

async function loadSeenQuestionIds(userId?: string): Promise<Set<string>> {
  if (!userId) return new Set<string>();
  const cached = seenQuestionIdsCache.get(userId);
  if (cached) {
    return new Set(await cached);
  }

  const loadPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('user_seen_questions')
        .select('question_id')
        .eq('user_id', userId);

      if (error) {
        const fallback = await supabase
          .from('seen_questions')
          .select('question_id')
          .eq('profile_id', userId);

        if (fallback.error) throw error;
        return new Set((fallback.data || []).map((entry: { question_id: string }) => entry.question_id));
      }
      return new Set((data || []).map((entry: { question_id: string }) => entry.question_id));
    } catch (error) {
      seenQuestionIdsCache.delete(userId);
      throw error;
    }
  })();

  seenQuestionIdsCache.set(userId, loadPromise);
  return new Set(await loadPromise);
}

function preferUnseenQuestions(questions: TriviaQuestion[], seenQuestionIds: Set<string>, count: number) {
  if (seenQuestionIds.size === 0) {
    return questions.slice(0, count);
  }

  const unseen = questions.filter((question) => !seenQuestionIds.has(question.id));
  if (unseen.length >= count) {
    return unseen.slice(0, count);
  }

  const seenFallback = questions.filter((question) => seenQuestionIds.has(question.id));
  return [...unseen, ...seenFallback].slice(0, count);
}

export async function getQuestionsForSession({
  categories,
  count,
  excludeQuestionIds = [],
  userId,
}: GetQuestionsForSessionParams): Promise<TriviaQuestion[]> {
  const uniqueCategories = [...new Set(categories.map(normalizeRequestedCategory))];
  const excludeIds = new Set(excludeQuestionIds);
  const seenQuestionIds = await loadSeenQuestionIds(userId);
  const selected: TriviaQuestion[] = [];

  for (const category of uniqueCategories) {
    const approved = preferUnseenQuestions(
      await fetchApprovedQuestionsByCategory(category, excludeIds, count),
      seenQuestionIds,
      count
    );
    approved.forEach((question) => excludeIds.add(question.id));
    selected.push(...approved);
  }

  return dedupeById(selected);
}

export async function markQuestionSeen({
  userId,
  questionId,
  gameId,
}: {
  userId: string;
  questionId: string;
  gameId?: string;
}) {
  const { error } = await supabase
    .from('user_seen_questions')
    .upsert(
      {
        user_id: userId,
        question_id: questionId,
        game_id: gameId,
        seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,question_id' }
    );

  if (error) {
    const fallback = await supabase
      .from('seen_questions')
      .upsert(
        {
          profile_id: userId,
          question_id: questionId,
        },
        { onConflict: 'profile_id,question_id' }
      );

    if (fallback.error) {
      console.error('Error marking question seen in Supabase:', error);
      return;
    }
  }

  const cachedSeenQuestionIds = seenQuestionIdsCache.get(userId);
  if (cachedSeenQuestionIds) {
    seenQuestionIdsCache.set(
      userId,
      cachedSeenQuestionIds.then((ids) => {
        const nextIds = new Set(ids);
        nextIds.add(questionId);
        return nextIds;
      })
    );
  }
}
