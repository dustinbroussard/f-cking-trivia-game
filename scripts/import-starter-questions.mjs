import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const QUESTION_TABLE = 'questions';
const DEFAULT_FILES = ['new-questions.json', 'starter-questions.json', 'starterquestions.json', 'strarterquestions.json'];
const INSERT_BATCH_SIZE = 100;

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

function createSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase admin credentials. Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before importing.'
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function parseStarterFile(rawText, filePath) {
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `Starter file "${path.basename(filePath)}" is not valid JSON. ${error instanceof Error ? error.message : String(error)}`
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

function normalizePresentation(rawQuestion) {
  const nestedPresentation = rawQuestion?.presentation && typeof rawQuestion.presentation === 'object'
    ? rawQuestion.presentation
    : {};
  const presentation = { ...nestedPresentation };

  if (presentation.hostLeadIn == null && rawQuestion?.hostLeadIn != null) {
    presentation.hostLeadIn = rawQuestion.hostLeadIn;
  }

  if (presentation.questionStyled == null && rawQuestion?.questionStyled != null) {
    presentation.questionStyled = rawQuestion.questionStyled;
  }

  if (presentation.explanationStyled == null && rawQuestion?.explanationStyled != null) {
    presentation.explanationStyled = rawQuestion.explanationStyled;
  }

  if (presentation.wrongAnswerQuips == null && rawQuestion?.wrongAnswerQuips != null) {
    presentation.wrongAnswerQuips = rawQuestion.wrongAnswerQuips;
  }

  return presentation;
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

  const correctAnswer = rawQuestion.choices[rawQuestion.correctIndex];
  const distractors = rawQuestion.choices.filter((_, index) => index !== rawQuestion.correctIndex);
  const presentation = normalizePresentation(rawQuestion);
  const status = rawQuestion.status || rawQuestion.validationStatus || 'approved';
  const sourceType = rawQuestion.sourceType || 'manual_import';

  return {
    category: rawQuestion.category,
    ...(rawQuestion.subcategory ? { subcategory: rawQuestion.subcategory } : {}),
    difficulty: rawQuestion.difficulty,
    question: rawQuestion.question,
    choices: rawQuestion.choices,
    correct_index: rawQuestion.correctIndex,
    explanation: rawQuestion.explanation,
    tags: Array.isArray(rawQuestion.tags) ? rawQuestion.tags : [],
    status,
    source_type: sourceType,
    presentation,
    created_at: createdAt,
    updated_at: createdAt,
    content: rawQuestion.question,
    validation_status: rawQuestion.validationStatus || status,
    difficulty_level: rawQuestion.difficulty,
    styling: presentation,
    correct_answer: correctAnswer,
    distractors,
    used_count: 0,
  };
}

async function loadExistingQuestionContents(supabase) {
  const existingContents = new Set();
  let from = 0;

  while (true) {
    const to = from + 999;
    const { data, error } = await supabase
      .from(QUESTION_TABLE)
      .select('content')
      .range(from, to);

    if (error) {
      throw new Error(`[import-starter-questions] Failed to load existing questions: ${error.message}`);
    }

    const rows = data || [];
    for (const row of rows) {
      if (typeof row.content === 'string') {
        existingContents.add(row.content.trim().toLowerCase());
      }
    }

    if (rows.length < 1000) {
      break;
    }

    from += 1000;
  }

  return existingContents;
}

async function insertInBatches(supabase, rows) {
  for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
    const batch = rows.slice(index, index + INSERT_BATCH_SIZE);
    const { error } = await supabase.from(QUESTION_TABLE).insert(batch);

    if (error) {
      throw new Error(`[import-starter-questions] Supabase insert failed: ${error.message}`);
    }
  }
}

async function main() {
  const filePath = await resolveStarterFile(process.argv[2]);
  const rawText = await fs.readFile(filePath, 'utf8');
  const parsed = parseStarterFile(rawText, filePath);
  const rawQuestions = getRawQuestions(parsed);
  const createdAt = new Date().toISOString();
  const normalizedQuestions = rawQuestions.map((question) => normalizeQuestion(question, createdAt));
  const supabase = createSupabaseAdmin();
  const existingQuestions = await loadExistingQuestionContents(supabase);

  const toInsert = [];
  let skipped = 0;

  for (const question of normalizedQuestions) {
    const dedupeKey = question.content.trim().toLowerCase();
    if (existingQuestions.has(dedupeKey)) {
      skipped += 1;
      continue;
    }

    existingQuestions.add(dedupeKey);
    toInsert.push(question);
  }

  await insertInBatches(supabase, toInsert);

  console.log(JSON.stringify({
    table: QUESTION_TABLE,
    filePath,
    total: normalizedQuestions.length,
    inserted: toInsert.length,
    skipped,
  }, null, 2));
}

main().catch((error) => {
  console.error('[import-starter-questions] Failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
