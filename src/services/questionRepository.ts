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

function toBankQuestion(question: any, createdAt = Date.now()): TriviaQuestion {
  const canonicalId = question.id || question.question_id;

  return {
    id: canonicalId,
    category: question.category,
    subcategory: question.subcategory,
    difficulty: question.difficulty || 'medium',
    question: question.question,
    choices: question.choices,
    correctIndex: question.correctIndex ?? question.correct_index,
    explanation: question.explanation,
    tags: question.tags || [],
    status: question.status || 'pending',
    presentation: question.presentation || {
      questionStyled: question.questionStyled,
      explanationStyled: question.explanationStyled,
      hostLeadIn: question.hostLeadIn,
    },
    sourceType: question.sourceType || question.source_type || 'ai',
    createdAt: question.createdAt || question.created_at || createdAt,
    metadata: {
      usedCount: question.usedCount ?? question.used_count ?? 0,
      used: question.used ?? false,
      validationStatus: question.validationStatus,
      verificationVerdict: question.verificationVerdict,
      ...question.metadata
    }
  };
}


function dedupeById(questions: TriviaQuestion[]) {
  const seen = new Set<string>();

  return questions.filter((question) => {
    const id = question.id;
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
    .eq('status', 'approved')
    .order('metadata->usedCount', { ascending: true }) // Note: used_count can be moved to metadata or dedicated column
    .limit(Math.max(count * 5, 20));

  const { data, error } = await query;
  
  if (error) {
    console.error('Error fetching questions from Supabase:', error);
    return [];
  }

  return (data || [])
    .map((entry) => toBankQuestion(entry))
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

      if (error) throw error;
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

async function storeQuestionsInBank(questions: TriviaQuestion[]) {
  const formattedRows = questions.map((q) => ({
    id: q.id,
    category: q.category,
    subcategory: q.subcategory,
    difficulty: q.difficulty,
    question: q.question,
    choices: q.choices,
    correct_index: q.correctIndex,
    explanation: q.explanation,
    tags: q.tags,
    status: q.status,
    presentation: q.presentation,
    source_type: q.sourceType,
    metadata: q.metadata || {},
  }));

  const { error } = await supabase
    .from('questions')
    .upsert(formattedRows);

  if (error) {
    console.error('Error storing questions in Supabase:', error);
    throw error;
  }
}


function logRejectedQuestions(rejected: Array<{ question: TriviaQuestion; reason: string }>) {
  if (!import.meta.env.DEV || rejected.length === 0) return;

  rejected.forEach(({ question, reason }) => {
    console.warn(`[questionValidation] Rejected "${question.question || question.id}": ${reason}`);
  });
}

function logStorageRejectedQuestions(rejected: TriviaQuestion[]) {
  if (!import.meta.env.DEV || rejected.length === 0) return;

  rejected.forEach((question) => {
    console.warn(
      `[questionVerification] Rejected "${question.question || question.id}": ${question.metadata?.verificationReason || 'verification did not pass with high confidence'}`
    );
  });
}


function logInventory(message: string) {
  if (!import.meta.env.DEV) return;
  console.warn(`[questionInventory] ${message}`);
}

function getBucketKey(category: string, difficulty?: 'easy' | 'medium' | 'hard') {
  return `${category}::${difficulty || 'mixed'}`;
}

function formatBucket(category: string, difficulty?: 'easy' | 'medium' | 'hard') {
  return `${category}/${difficulty || 'mixed'}`;
}

function isBucketCoolingDown(bucketKey: string) {
  return (bucketCooldowns.get(bucketKey) ?? 0) > Date.now();
}

function setBucketCooldown(bucketKey: string, cooldownMs = EMPTY_RESULT_COOLDOWN_MS) {
  bucketCooldowns.set(bucketKey, Date.now() + cooldownMs);
}

/**
 * Runs the full generation pipeline for a bucket.
 * This should ideally be called from a maintenance task or background process.
 */
async function generateApprovedQuestionsForBucket({
  category,
  count,
  difficulty,
  existingQuestions = [],
}: {
  category: string;
  count: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  existingQuestions?: Array<Pick<TriviaQuestion, 'category' | 'question'>>;
}) {
  const bucketKey = getBucketKey(category, difficulty);
  const inFlight = generationLocks.get(bucketKey);

  if (inFlight) {
    logInventory(`generation skipped: bucket locked ${formatBucket(category, difficulty)}`);
    return inFlight;
  }

  const status = getQuestionGenerationStatus();
  if (!status.canAttemptAny) {
    logInventory(`generation skipped: AI cooldown active ${formatBucket(category, difficulty)}`);
    return [];
  }

  const generationPromise = (async () => {
    const startedAt = Date.now();
    logInventory(`generation started: bucket=${formatBucket(category, difficulty)} requested=${count} existing=${existingQuestions.length}`);

    // Stage 1: Generation (handled by API handler)
    const generated = await generateQuestions([category], count, existingQuestions, difficulty);

    // Initial normalization
    const normalizedGenerated = generated
      .map((question) => toBankQuestion({ 
        ...question, 
        category, 
        ...(difficulty ? { difficulty } : {}),
        validationStatus: 'pending',
        source: 'gemini-2.0-flash',
      }))
      .filter((question) => question.category === category)
      .filter((question) => !difficulty || question.difficulty === difficulty);

    // Stage 2: Verification and Styling are now handled server-side in the API pipeline
    // This frontend call currently assumes the API returns styled, verified questions.
    // We will save them with 'approved' status if they pass verification checks.

    const { approved: structurallyValid, rejected } = validateGeneratedQuestions(normalizedGenerated);
    
    // Check verification status from the payload
    const approved = structurallyValid.filter(isQuestionApprovedForStorage);
    const verificationRejected = structurallyValid.filter((question) => !isQuestionApprovedForStorage(question));

    logRejectedQuestions(rejected);
    logStorageRejectedQuestions(verificationRejected);

    if (approved.length > 0) {
      // Save passing questions to the bank as 'approved'
      await storeQuestionsInBank(approved.map((question) => ({
        ...question,
        validationStatus: 'approved',
      })));

      logInventory(`generation completed: bucket=${formatBucket(category, difficulty)} requested=${count} approved=${approved.length} durationMs=${Date.now() - startedAt}`);
    } else if (!getQuestionGenerationStatus().canAttemptAny) {
      logInventory(getQuestionGenerationStatus().message || `generation failed: both providers unavailable`);
      setBucketCooldown(bucketKey);
    } else {
      logInventory(`generation produced_no_approved_questions: bucket=${formatBucket(category, difficulty)} requested=${count} generated=${generated.length} durationMs=${Date.now() - startedAt}`);
      setBucketCooldown(bucketKey);
    }

    return approved;
  })();

  generationLocks.set(bucketKey, generationPromise);

  try {
    return await generationPromise;
  } finally {
    generationLocks.delete(bucketKey);
  }
}

async function fetchApprovedQuestionsByCategoryAndDifficulty(
  category: string,
  difficulty: 'easy' | 'medium' | 'hard'
) {
  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    try {
      const { count, error } = await supabase
        .from('questions')
        .select('*', { count: 'exact', head: true })
        .eq('category', category)
        .eq('difficulty', difficulty)
        .eq('status', 'approved');

      if (error) throw error;
      return count || 0;
    } catch (error: any) {
      attempt++;
      const isRateLimit = error?.code === 'resource-exhausted' || error?.message?.includes('Too Many Requests') || error?.status === 429;
      if (isRateLimit && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 500));
        continue;
      }
      throw error;
    }
  }
  return 0;
}


/**
 * Checks inventory for a category/difficulty and replenishes if low.
 * This is non-blocking and safe for background execution.
 */
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

  const bucketKey = getBucketKey(category, difficulty);
  const inFlightCheck = inventoryCheckLocks.get(bucketKey);
  if (inFlightCheck) {
    logInventory(`inventory check skipped: bucket already checking ${formatBucket(category, difficulty)}`);
    return inFlightCheck;
  }

  const checkPromise = (async () => {
    if (generationLocks.has(bucketKey)) {
      logInventory(`generation skipped: bucket locked ${formatBucket(category, difficulty)}`);
      return;
    }

    if (isBucketCoolingDown(bucketKey)) {
      logInventory(`generation skipped: bucket cooldown active ${formatBucket(category, difficulty)}`);
      return;
    }

    const approvedCount = await fetchApprovedQuestionsByCategoryAndDifficulty(category, difficulty);
    if (approvedCount >= minimumApproved) return;

    logInventory(`Low inventory ${formatBucket(category, difficulty)}: ${approvedCount}/${minimumApproved}`);

    const status = getQuestionGenerationStatus();
    if (!status.canAttemptAny) {
      logInventory(`generation skipped: AI cooldown active ${formatBucket(category, difficulty)}`);
      return;
    }

    logInventory(`Replenishing ${formatBucket(category, difficulty)} with ${replenishBatchSize} questions`);
    generateApprovedQuestionsForBucket({
      category,
      count: replenishBatchSize,
      difficulty,
    }).catch(err => {
      setBucketCooldown(bucketKey);
      console.error(`[questionInventory] Replenishment failed for ${formatBucket(category, difficulty)}:`, err);
    });
  })();

  inventoryCheckLocks.set(bucketKey, checkPromise);

  try {
    await checkPromise;
  } finally {
    inventoryCheckLocks.delete(bucketKey);
  }
}

/**
 * Serves questions for a game session.
 * Strictly uses approved questions from the bank.
 */
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

  // Deduplicate and return. We NO LONGER generate JIT if questions are missing.
  // The UI should handle cases where fewer questions are returned if the bank is critically low.
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
    console.error('Error marking question seen in Supabase:', error);
    return;
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
