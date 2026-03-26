import { supabase } from '../lib/supabase';
import { TriviaQuestion, getPlayableCategories, isPlayableCategory } from '../types';
import { generateQuestions, getQuestionGenerationStatus } from './gemini';
import { validateGeneratedQuestions } from './questionValidation';
import { isQuestionApprovedForStorage } from './questionVerification';

interface GetQuestionsForSessionParams {
  categories: string[];
  count: number;
  excludeQuestionIds?: string[];
  userId?: string;
}

const generationLocks = new Map<string, Promise<TriviaQuestion[]>>();
const inventoryCheckLocks = new Map<string, Promise<void>>();
const seenQuestionIdsCache = new Map<string, Promise<Set<string>>>();
const bucketCooldowns = new Map<string, number>();
const EMPTY_RESULT_COOLDOWN_MS = 45_000;

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
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('category', category)
    .eq('validation_status', 'approved')
    .order('used_count', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(Math.max(count * 5, 20));

  if (error) {
    console.error(`[supabaseService] Error fetching questions for ${category}:`, error.message);
    return [];
  }

  return (data || [])
    .map(mapRowToTriviaQuestion)
    .filter((question) => !excludeIds.has(question.id));
}

async function loadSeenQuestionIds(userId?: string) {
  if (!userId) return new Set<string>();
  const cached = seenQuestionIdsCache.get(userId);
  if (cached) {
    return new Set(await cached);
  }

  const loadPromise = (async () => {
    const { data, error } = await supabase
      .from('seen_questions')
      .select('question_id')
      .eq('user_id', userId);
    
    if (error) {
      console.error(`[supabaseService] Error loading seen questions for ${userId}:`, error.message);
      return new Set<string>();
    }
    
    return new Set((data || []).map(row => row.question_id));
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

async function storeQuestionsInBank(questions: TriviaQuestion[]) {
  const transformed = questions.map(q => ({
    id: q.questionId || q.id || undefined,
    content: q.question,
    correct_answer: q.choices[q.correctIndex],
    distractors: q.choices.filter((_, i) => i !== q.correctIndex),
    category: q.category,
    difficulty_level: q.difficulty || 'medium',
    validation_status: q.validationStatus === 'approved' ? 'approved' : 'pending',
    explanation: q.explanation || '',
    batch_id: q.batchId,
    styling: {
      questionStyled: q.questionStyled,
      explanationStyled: q.explanationStyled,
      hostLeadIn: q.hostLeadIn
    },
    metadata: q
  }));

  const { error } = await supabase
    .from('questions')
    .upsert(transformed, { onConflict: 'content' });

  if (error) {
    console.error('[supabaseService] Error storing questions:', error.message);
    throw error;
  }
}

async function fetchApprovedQuestionsByCategoryAndDifficulty(
  category: string,
  difficulty: 'easy' | 'medium' | 'hard'
) {
  const { count, error } = await supabase
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .eq('category', category)
    .eq('difficulty_level', difficulty)
    .eq('validation_status', 'approved');

  if (error) {
    console.error(`[supabaseService] Error counting questions for ${category}/${difficulty}:`, error.message);
    return 0;
  }
  
  return count || 0;
}

export async function ensureQuestionInventory({
  category,
  difficulty,
  minimumApproved,
  replenishBatchSize,
}: {
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  minimumApproved: number;
  replenishBatchSize: number;
}): Promise<void> {
  if (!isPlayableCategory(category)) return;

  const bucketKey = `${category}::${difficulty}`;
  const inFlightCheck = inventoryCheckLocks.get(bucketKey);
  if (inFlightCheck) return inFlightCheck;

  const checkPromise = (async () => {
    if (generationLocks.has(bucketKey)) return;
    if ((bucketCooldowns.get(bucketKey) || 0) > Date.now()) return;

    const approvedCount = await fetchApprovedQuestionsByCategoryAndDifficulty(category, difficulty);
    if (approvedCount >= minimumApproved) return;

    console.warn(`[questionInventory] Low inventory ${category}/${difficulty}: ${approvedCount}/${minimumApproved}`);

    const status = getQuestionGenerationStatus();
    if (!status.canAttemptAny) return;

    const startedAt = Date.now();
    const generated = await generateQuestions([category], replenishBatchSize, [], difficulty);
    
    // AI Pipeline writes directly to Supabase now, so we just log result
    if (generated.length > 0) {
      console.warn(`[questionInventory] Replenished ${category}/${difficulty} with ${generated.length} questions in ${Date.now() - startedAt}ms`);
    } else {
      bucketCooldowns.set(bucketKey, Date.now() + EMPTY_RESULT_COOLDOWN_MS);
    }
  })();

  inventoryCheckLocks.set(bucketKey, checkPromise);

  try {
    await checkPromise;
  } finally {
    inventoryCheckLocks.delete(bucketKey);
  }
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
  await supabase
    .from('seen_questions')
    .insert({
      user_id: userId,
      question_id: questionId
    });

  const cached = seenQuestionIdsCache.get(userId);
  if (cached) {
    seenQuestionIdsCache.set(
      userId,
      cached.then((ids) => {
        const next = new Set(ids);
        next.add(questionId);
        return next;
      })
    );
  }
  
  // Also increment usage count in the bank
  await supabase.rpc('increment_question_used_count', { q_id: questionId });
}
