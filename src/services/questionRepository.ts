import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { TriviaQuestion, getPlayableCategories, isPlayableCategory } from '../types';
import { generateQuestions } from './gemini';
import { validateGeneratedQuestions } from './questionValidation';

interface GetQuestionsForSessionParams {
  categories: string[];
  count: number;
  excludeQuestionIds?: string[];
}

function normalizeRequestedCategory(category: string) {
  return isPlayableCategory(category) ? category : getPlayableCategories()[0];
}

function toBankQuestion(question: TriviaQuestion, createdAt = Date.now()): TriviaQuestion {
  const canonicalId = question.questionId || question.id;
  const explanation = question.explanation || question.correctQuip || '';

  return {
    ...question,
    id: canonicalId,
    questionId: canonicalId,
    category: question.category,
    difficulty: question.difficulty || 'medium',
    correctIndex: Number.isInteger(question.correctIndex) ? question.correctIndex : question.answerIndex,
    answerIndex: question.answerIndex,
    explanation,
    validationStatus: question.validationStatus || 'approved',
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
  const bankRef = collection(db, 'questionBank');
  const bankQuery = query(
    bankRef,
    where('category', '==', category),
    where('validationStatus', '==', 'approved'),
    orderBy('usedCount', 'asc'),
    orderBy('createdAt', 'asc'),
    limit(Math.max(count * 3, 10))
  );

  const snapshot = await getDocs(bankQuery);

  return snapshot.docs
    .map((entry) => toBankQuestion({ ...entry.data(), id: entry.id } as TriviaQuestion))
    .filter((question) => !excludeIds.has(question.id))
    .slice(0, count);
}

async function storeQuestionsInBank(questions: TriviaQuestion[]) {
  for (const question of questions) {
    const canonical = toBankQuestion(question);
    await setDoc(doc(db, 'questionBank', canonical.id), canonical, { merge: true });
  }
}

function logRejectedQuestions(rejected: Array<{ question: TriviaQuestion; reason: string }>) {
  if (!import.meta.env.DEV || rejected.length === 0) return;

  rejected.forEach(({ question, reason }) => {
    console.warn(`[questionValidation] Rejected "${question.question || question.id}": ${reason}`);
  });
}

function logInventory(message: string) {
  if (!import.meta.env.DEV) return;
  console.warn(`[questionInventory] ${message}`);
}

async function fetchApprovedQuestionsByCategoryAndDifficulty(
  category: string,
  difficulty: 'easy' | 'medium' | 'hard'
) {
  const bankRef = collection(db, 'questionBank');
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

  const snapshot = await fetchApprovedQuestionsByCategoryAndDifficulty(category, difficulty);
  if (snapshot.size >= minimumApproved) return;

  logInventory(`Low inventory ${category}/${difficulty}: ${snapshot.size}/${minimumApproved}`);
  logInventory(`Replenishing ${category}/${difficulty} with ${replenishBatchSize} questions`);

  const generated = await generateQuestions([category], replenishBatchSize, [], difficulty);
  const normalizedGenerated = generated
    .map((question) => toBankQuestion({ ...question, category, difficulty }))
    .filter((question) => question.category === category && question.difficulty === difficulty);
  const { approved, rejected } = validateGeneratedQuestions(normalizedGenerated);

  logRejectedQuestions(rejected);

  if (approved.length === 0) return;

  await storeQuestionsInBank(approved.map((question) => ({
    ...question,
    validationStatus: 'approved',
  })));

  logInventory(`Added ${approved.length} approved questions to ${category}/${difficulty}`);
}

export async function getQuestionsForSession({
  categories,
  count,
  excludeQuestionIds = [],
}: GetQuestionsForSessionParams): Promise<TriviaQuestion[]> {
  const uniqueCategories = [...new Set(categories.map(normalizeRequestedCategory))];
  const excludeIds = new Set(excludeQuestionIds);
  const selected: TriviaQuestion[] = [];

  for (const category of uniqueCategories) {
    const approved = await fetchApprovedQuestionsByCategory(category, excludeIds, count);
    approved.forEach((question) => excludeIds.add(question.id));
    selected.push(...approved);
  }

  const missingCategories = uniqueCategories.filter((category) => {
    return selected.filter((question) => question.category === category).length < count;
  });

  if (missingCategories.length === 0) {
    return dedupeById(selected);
  }

  const generated = await generateQuestions(missingCategories, count, toExistingQuestionHistory(selected));
  const normalizedGenerated = generated.map((question) => toBankQuestion(question));
  const { approved, rejected } = validateGeneratedQuestions(normalizedGenerated);

  logRejectedQuestions(rejected);

  if (approved.length > 0) {
    await storeQuestionsInBank(approved.map((question) => ({
      ...question,
      validationStatus: 'approved',
    })));
  }

  const combined = [...selected];

  for (const category of missingCategories) {
    const needed = count - combined.filter((question) => question.category === category).length;
    if (needed <= 0) continue;

    const generatedForCategory = approved
      .filter((question) => question.category === category)
      .filter((question) => !excludeIds.has(question.id))
      .slice(0, needed);

    generatedForCategory.forEach((question) => excludeIds.add(question.id));
    combined.push(...generatedForCategory);
  }

  return dedupeById(combined);
}
