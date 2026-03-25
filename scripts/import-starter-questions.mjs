import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const QUESTION_COLLECTION = 'questions';
const DEFAULT_FILES = ['new-questions.json', 'starter-questions.json', 'starterquestions.json', 'strarterquestions.json'];
const FIRESTORE_DATABASE_ID = 'ai-studio-5d62c22c-0318-44b3-a976-ecfe921b8e12';
const FIREBASE_PROJECT_ID = 'ai-studio-applet-webapp-a549d';

async function resolveStarterFile(inputPath) {
  if (inputPath) return path.resolve(ROOT, inputPath);

  for (const candidate of DEFAULT_FILES) {
    const candidatePath = path.resolve(ROOT, candidate);
    try {
      await fs.access(candidatePath);
      return candidatePath;
    } catch {
      // Try the next fallback.
    }
  }

  throw new Error(`Starter file not found. Expected one of: ${DEFAULT_FILES.join(', ')}`);
}

async function loadFirebaseAdmin() {
  try {
    const appModule = await import('firebase-admin/app');
    const firestoreModule = await import('firebase-admin/firestore');
    return { ...appModule, ...firestoreModule };
  } catch (error) {
    throw new Error(
      `Firebase Admin authentication failed: ${error instanceof Error ? error.message : String(error)}\n\n` +
      `TO FIX THIS LOCALLY:\n` +
      `1. Install the Google Cloud SDK (gcloud)\n` +
      `2. Run: gcloud auth application-default login\n\n` +
      `OR:\n` +
      `1. Generate a Service Account JSON key in the Firebase Console (Project Settings -> Service Accounts)\n` +
      `2. Set the environment variable: export GOOGLE_APPLICATION_CREDENTIALS="path/to/your/service-account.json"`
    );
  }
}

function getServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return pathToFileURL(process.env.GOOGLE_APPLICATION_CREDENTIALS).href;
  }

  return null;
}

async function createFirestore() {
  const {
    applicationDefault,
    cert,
    getApps,
    initializeApp,
    getFirestore,
  } = await loadFirebaseAdmin();

  if (!getApps().length) {
    const credentials = getServiceAccount();

    if (typeof credentials === 'string') {
      const serviceAccountJson = JSON.parse(await fs.readFile(new URL(credentials), 'utf8'));
      initializeApp({ credential: cert(serviceAccountJson), projectId: FIREBASE_PROJECT_ID });
    } else if (credentials) {
      initializeApp({ credential: cert(credentials), projectId: FIREBASE_PROJECT_ID });
    } else {
      initializeApp({ credential: applicationDefault(), projectId: FIREBASE_PROJECT_ID });
    }
  }

  return getFirestore(undefined, FIRESTORE_DATABASE_ID);
}

function parseStarterFile(rawText, filePath) {
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `Starter file "${path.basename(filePath)}" is not valid JSON. If this is the current concatenated styling export, replace it with a single JSON object or array containing full questions. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function getRawQuestions(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.questions)) return payload.questions;

  if (Array.isArray(payload?.results)) {
    throw new Error(
      'Starter file contains styling results only (`results`) and not full question objects. Each item must include category, difficulty, question, choices, correctIndex, and explanation.'
    );
  }

  throw new Error('Starter file must be an array of questions or an object with a `questions` array.');
}

function normalizeQuestion(rawQuestion, createdAt) {
  const requiredFields = ['category', 'difficulty', 'question', 'choices', 'correctIndex', 'explanation'];
  const missingFields = requiredFields.filter((field) => rawQuestion?.[field] == null);

  if (missingFields.length > 0) {
    throw new Error(`Question is missing required fields: ${missingFields.join(', ')}`);
  }

  if (!Array.isArray(rawQuestion.choices) || rawQuestion.choices.length !== 4) {
    throw new Error(`Question "${rawQuestion.question}" must include exactly 4 answer choices.`);
  }

  if (!Number.isInteger(rawQuestion.correctIndex) || rawQuestion.correctIndex < 0 || rawQuestion.correctIndex > 3) {
    throw new Error(`Question "${rawQuestion.question}" has an invalid correctIndex.`);
  }

  return {
    category: rawQuestion.category,
    difficulty: rawQuestion.difficulty,
    question: rawQuestion.question,
    choices: rawQuestion.choices,
    correctIndex: rawQuestion.correctIndex,
    answerIndex: rawQuestion.correctIndex,
    explanation: rawQuestion.explanation,
    ...(rawQuestion.questionStyled ? { questionStyled: rawQuestion.questionStyled } : {}),
    ...(rawQuestion.explanationStyled ? { explanationStyled: rawQuestion.explanationStyled } : {}),
    ...(rawQuestion.hostLeadIn ? { hostLeadIn: rawQuestion.hostLeadIn } : {}),
    validationStatus: 'approved',
    verificationVerdict: 'pass',
    verificationConfidence: 'high',
    pipelineVersion: 2,
    createdAt,
    usedCount: 0,
    used: false,
    correctQuip: rawQuestion.correctQuip || '',
    wrongAnswerQuips: rawQuestion.wrongAnswerQuips || { 0: '', 1: '', 2: '', 3: '' },
  };
}

async function main() {
  const filePath = await resolveStarterFile(process.argv[2]);
  const rawText = await fs.readFile(filePath, 'utf8');
  const parsed = parseStarterFile(rawText, filePath);
  const rawQuestions = getRawQuestions(parsed);
  const createdAt = Date.now();
  const normalizedQuestions = rawQuestions.map((question) => normalizeQuestion(question, createdAt));
  const db = await createFirestore();

  const existingSnapshot = await db.collection(QUESTION_COLLECTION).select('question').get();
  const existingQuestions = new Set(
    existingSnapshot.docs
      .map((doc) => doc.get('question'))
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim().toLowerCase())
  );

  let inserted = 0;
  let skipped = 0;

  for (const question of normalizedQuestions) {
    const dedupeKey = question.question.trim().toLowerCase();
    if (existingQuestions.has(dedupeKey)) {
      skipped += 1;
      continue;
    }

    await db.collection(QUESTION_COLLECTION).add(question);
    existingQuestions.add(dedupeKey);
    inserted += 1;
  }

  console.log(JSON.stringify({
    collection: QUESTION_COLLECTION,
    filePath,
    total: normalizedQuestions.length,
    inserted,
    skipped,
  }, null, 2));
}

main().catch((error) => {
  console.error('[import-starter-questions] Failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
