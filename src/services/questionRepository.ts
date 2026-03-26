import { supabase } from '../lib/supabase';
import { TriviaQuestion, getPlayableCategories, isPlayableCategory } from '../types';

interface GetQuestionsForSessionParams {
  categories: string[];
  count: number;
  excludeQuestionIds?: string[];
  userId?: string;
}

function normalizeRequestedCategory(category: string) {
  return isPlayableCategory(category) ? category : getPlayableCategories()[0];
}

function mapRowToTriviaQuestion(row: any): TriviaQuestion {
  // Try to use metadata if available for exact fidelity
  if (row.metadata && row.metadata.question) {
    return {
      ...row.metadata,
      id: row.id,
      questionId: row.id,
      usedCount: row.used_count || 0
    };
  }

  // Fallback to manual mapping
  return {
    id: row.id,
    questionId: row.id,
    question: row.content,
    choices: [row.correct_answer, ...(row.distractors || [])],
    correctIndex: 0,
    answerIndex: 0,
    category: row.category,
    difficulty: row.difficulty_level || 'medium',
    explanation: row.explanation || '',
    status: row.validation_status === 'approved' ? 'approved' : 'pending',
    sourceType: row.metadata?.sourceType || 'generated',
    questionStyled: row.styling?.questionStyled,
    explanationStyled: row.styling?.explanationStyled,
    hostLeadIn: row.styling?.hostLeadIn,
    batchId: row.batch_id,
    usedCount: row.used_count || 0,
    used: (row.used_count || 0) > 0,
  };
}

function dedupeById(questions: TriviaQuestion[]) {
  const seen = new Set<string>();
  return questions.filter((question) => {
    const id = question.questionId || question.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function fetchApprovedQuestionsByCategory(category: string, excludeIds: Set<string>, count: number) {
  let query = supabase
    .from('questions')
    .select('*')
    .eq('category', category)
    .eq('validation_status', 'approved')
    .order('used_count', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(Math.max(count * 5, 20));

  const { data, error } = await query;
  if (error) {
    console.error(`Error fetching questions for ${category}:`, error.message);
    return [];
  }

  return (data || [])
    .map(mapRowToTriviaQuestion)
    .filter((question) => !excludeIds.has(question.id));
}

async function loadSeenQuestionIds(userId?: string) {
  if (!userId) return new Set<string>();
  
  const { data, error } = await supabase
    .from('seen_questions')
    .select('question_id')
    .eq('user_id', userId);
  
  if (error) {
    console.error(`Error loading seen questions for ${userId}:`, error.message);
    return new Set<string>();
  }
  
  return new Set((data || []).map(row => row.question_id));
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

export async function ensureQuestionInventory({
  category: _category,
  difficulty: _difficulty,
  minimumApproved: _minimumApproved,
  replenishBatchSize: _replenishBatchSize,
}: {
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  minimumApproved: number;
  replenishBatchSize: number;
}): Promise<void> {
  return;
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
    .from('seen_questions')
    .insert({
      user_id: userId,
      question_id: questionId
    });
  
  if (error && !error.message.includes('duplicate key')) {
    throw error;
  }
  
  // Also increment usage count via RPC
  await supabase.rpc('increment_question_used_count', { q_id: questionId });
}
