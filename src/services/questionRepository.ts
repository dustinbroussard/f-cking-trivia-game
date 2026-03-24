import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { TriviaQuestion, getPlayableCategories, isPlayableCategory } from '../types';
import { generateQuestions, getQuestionGenerationStatus } from './gemini';
import { QUESTION_COLLECTION, SEEN_QUESTIONS_COLLECTION } from './questionCollections';
import { validateGeneratedQuestions } from './questionValidation';
import { isQuestionApprovedForStorage } from './questionVerification';

interface GetQuestionsForSessionParams {
  categories: string[];
  count: number;
  excludeQuestionIds?: string[];
  userId?: string;
}

const generationLocks = new Map<string, Promise<TriviaQuestion[]>>();

function normalizeRequestedCategory(category: string) {
  return isPlayableCategory(category) ? category : getPlayableCategories()[0];
}

function toBankQuestion(question: TriviaQuestion, createdAt = Date.now()): TriviaQuestion {
  const canonicalId = question.questionId || question.id;
  const explanation = question.explanation || question.correctQuip || '';
  const approvedForStorage = isQuestionApprovedForStorage(question);

  return {
    ...question,
    id: canonicalId,
    questionId: canonicalId,
    category: question.category,
    difficulty: question.difficulty || 'medium',
    correctIndex: Number.isInteger(question.correctIndex) ? question.correctIndex : question.answerIndex,
    answerIndex: question.answerIndex,
    explanation,
    validationStatus: approvedForStorage ? 'approved' : (question.validationStatus || 'pending'),
    verificationVerdict: question.verificationVerdict,
    verificationConfidence: question.verificationConfidence,
    verificationIssues: question.verificationIssues || [],
    verificationReason: question.verificationReason,
    pipelineVersion: question.pipelineVersion,
    questionStyled: question.questionStyled,
    explanationStyled: question.explanationStyled,
    hostLeadIn: question.hostLeadIn,
    createdAt: question.createdAt || createdAt,
    usedCount: question.usedCount ?? 0,
    used: question.used ?? false,
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

function toExistingQuestionHistory(questions: TriviaQuestion[]) {
  return questions.map(({ category, question }) => ({ category, question }));
}

async function fetchApprovedQuestionsByCategory(category: string, excludeIds: Set<string>, count: number) {
  const bankRef = collection(db, QUESTION_COLLECTION);
  const bankQuery = query(
    bankRef,
    where('category', '==', category),
    where('validationStatus', '==', 'approved'),
    orderBy('usedCount', 'asc'),
    orderBy('createdAt', 'asc'),
    limit(Math.max(count * 10, 30))
  );

  const snapshot = await getDocs(bankQuery);
  const approved = snapshot.docs
    .map((entry) => toBankQuestion({ ...entry.data(), id: entry.id } as TriviaQuestion))
    .filter((question) => !excludeIds.has(question.id));

  return approved;
}

async function loadSeenQuestionIds(userId?: string) {
  if (!userId) return new Set<string>();

  const snapshot = await getDocs(collection(db, 'users', userId, SEEN_QUESTIONS_COLLECTION));
  return new Set(snapshot.docs.map((entry) => entry.id));
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
  for (const question of questions) {
    if (!isQuestionApprovedForStorage(question)) continue;
    const canonical = toBankQuestion(question);
    await setDoc(doc(db, QUESTION_COLLECTION, canonical.id), canonical, { merge: true });
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
      `[questionVerification] Rejected "${question.question || question.id}": ${question.verificationReason || 'verification did not pass with high confidence'}`
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
    const generated = await generateQuestions([category], count, existingQuestions, difficulty);
    const normalizedGenerated = generated
      .map((question) => toBankQuestion({ ...question, category, ...(difficulty ? { difficulty } : {}) }))
      .filter((question) => question.category === category)
      .filter((question) => !difficulty || question.difficulty === difficulty);
    const { approved: structurallyValid, rejected } = validateGeneratedQuestions(normalizedGenerated);
    const approved = structurallyValid.filter(isQuestionApprovedForStorage);
    const verificationRejected = structurallyValid.filter((question) => !isQuestionApprovedForStorage(question));

    logRejectedQuestions(rejected);
    logStorageRejectedQuestions(verificationRejected);

    if (approved.length > 0) {
      await storeQuestionsInBank(approved.map((question) => ({
        ...question,
        validationStatus: 'approved',
      })));

      logInventory(`Added ${approved.length} approved questions to ${formatBucket(category, difficulty)}`);
    } else if (!getQuestionGenerationStatus().canAttemptAny) {
      logInventory(getQuestionGenerationStatus().message || `generation failed: both providers unavailable`);
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
  const bankRef = collection(db, QUESTION_COLLECTION);
  const bankQuery = query(
    bankRef,
    where('category', '==', category),
    where('difficulty', '==', difficulty),
    where('validationStatus', '==', 'approved')
  );

  return getDocs(bankQuery);
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

  const bucketKey = getBucketKey(category, difficulty);
  if (generationLocks.has(bucketKey)) {
    logInventory(`generation skipped: bucket locked ${formatBucket(category, difficulty)}`);
    return;
  }

  const status = getQuestionGenerationStatus();
  if (!status.canAttemptAny) {
    logInventory(`generation skipped: AI cooldown active ${formatBucket(category, difficulty)}`);
    return;
  }

  const snapshot = await fetchApprovedQuestionsByCategoryAndDifficulty(category, difficulty);
  if (snapshot.size >= minimumApproved) return;

  logInventory(`Low inventory ${formatBucket(category, difficulty)}: ${snapshot.size}/${minimumApproved}`);
  logInventory(`Replenishing ${formatBucket(category, difficulty)} with ${replenishBatchSize} questions`);
  await generateApprovedQuestionsForBucket({
    category,
    count: replenishBatchSize,
    difficulty,
  });
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

  const missingCategories = uniqueCategories.filter((category) => {
    return selected.filter((question) => question.category === category).length < count;
  });

  if (missingCategories.length === 0) {
    return dedupeById(selected);
  }

  const combined = [...selected];

  for (const category of missingCategories) {
    const needed = count - combined.filter((question) => question.category === category).length;
    if (needed <= 0) continue;

    const generatedForCategory = (await generateApprovedQuestionsForBucket({
      category,
      count: needed,
      existingQuestions: toExistingQuestionHistory(combined),
    }))
      .filter((question) => !excludeIds.has(question.id))
      .slice(0, needed);

    generatedForCategory.forEach((question) => excludeIds.add(question.id));
    combined.push(...generatedForCategory);
  }

  return dedupeById(combined);
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
  await setDoc(
    doc(db, 'users', userId, SEEN_QUESTIONS_COLLECTION, questionId),
    {
      questionId,
      seenAt: serverTimestamp(),
      ...(gameId ? { gameId } : {}),
    },
    { merge: true }
  );
}
