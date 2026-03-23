import { Type } from "@google/genai";
import { TriviaQuestion } from "../types";
import { HeckleGenerationContext, MAX_HECKLES } from "../content/heckles";
import { getGenerationCategoryProfile } from "./categorySubdomains";

export const questionSchema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          difficulty: { type: Type.STRING },
          question: { type: Type.STRING },
          choices: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          correctIndex: { type: Type.INTEGER },
          explanation: { type: Type.STRING }
        },
        required: ["category", "difficulty", "question", "choices", "correctIndex", "explanation"]
      }
    }
  }
};

export const heckleSchema = {
  type: Type.OBJECT,
  properties: {
    heckles: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    }
  },
  required: ["heckles"]
};

export type ExistingQuestion = Pick<TriviaQuestion, 'category' | 'question'>;

const QUESTION_LENSES = [
  'obscure-but-fair connections',
  'unexpected comparisons',
  'cause-and-effect trivia',
  'timeline-based clues',
  'famous failures and near misses',
  'counterintuitive facts',
  'cultural crossovers',
  'deep-cut but solvable references',
];

const QUESTION_STYLES = [
  'mostly clue-driven prompts',
  'mostly scenario-based prompts',
  'mostly direct factual prompts',
  'mostly comparative prompts',
  'mostly short setup with sharp punchline prompts',
];

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;

type ProviderName = 'server';

const providerCooldowns: Record<ProviderName, number> = {
  server: 0,
};

function logGeneration(message: string) {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') return;
  console.warn(`[questionGeneration] ${message}`);
}

export function extractRetryDelayMs(message: string | null | undefined) {
  if (!message) return null;

  const retryAfterSeconds = message.match(/retry(?:-after)?[^0-9]*(\d+)\s*s/i);
  if (retryAfterSeconds) return Number(retryAfterSeconds[1]) * 1000;

  const retryAfterMilliseconds = message.match(/retry(?:-after)?[^0-9]*(\d+)\s*ms/i);
  if (retryAfterMilliseconds) return Number(retryAfterMilliseconds[1]);

  const tryAgainInSeconds = message.match(/try again in[^0-9]*(\d+)\s*seconds?/i);
  if (tryAgainInSeconds) return Number(tryAgainInSeconds[1]) * 1000;

  return null;
}

export function isRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|rate limit|quota|resource exhausted|too many requests/i.test(message);
}

function setProviderCooldown(provider: ProviderName, retryDelayMs?: number | null) {
  const cooldownMs = retryDelayMs && retryDelayMs > 0 ? retryDelayMs : DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  providerCooldowns[provider] = Date.now() + cooldownMs;
  logGeneration(`${provider} cooldown active for ${Math.ceil(cooldownMs / 1000)}s`);
}

function getProviderCooldownUntil(provider: ProviderName) {
  return providerCooldowns[provider];
}

function isProviderCoolingDown(provider: ProviderName) {
  return getProviderCooldownUntil(provider) > Date.now();
}

export function getQuestionGenerationStatus() {
  const now = Date.now();
  const cooldownUntil = getProviderCooldownUntil('server');
  const canAttemptAny = !isProviderCoolingDown('server');

  return {
    geminiCooldownUntil: cooldownUntil,
    openRouterCooldownUntil: cooldownUntil,
    hasGeminiKey: true,
    canAttemptGemini: canAttemptAny,
    canAttemptOpenRouter: false,
    canAttemptAny,
    message: canAttemptAny
      ? null
      : `AI generation is temporarily cooling down. Please try again shortly.`,
    now,
  };
}

function shuffle<T>(items: readonly T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function buildSubdomainInstructions(categories: string[], requestedCount: number) {
  const profiles = categories.map((category) => {
    const profile = getGenerationCategoryProfile(category);
    const shuffled = shuffle(profile.subdomains);
    const featured = shuffled.slice(0, Math.min(2, shuffled.length));
    const rotation = shuffled.slice(0, Math.min(requestedCount, shuffled.length));

    return {
      category,
      promptCategory: profile.promptCategory,
      featured,
      rotation,
    };
  });

  if (typeof process === 'undefined' || process.env.NODE_ENV !== 'production') {
    profiles.forEach((profile) => {
      console.warn(
        `[questionGeneration] ${profile.category} subdomains: ${profile.featured.join(', ') || 'none'}`
      );
    });
  }

  return profiles.map((profile) => {
    const featuredText = profile.featured.length > 0
      ? `Focus on subdomains such as: ${profile.featured.join(', ')}.`
      : 'Use a varied spread of subtopics.';
    const rotationText = profile.rotation.length > 1
      ? `Across the batch, vary focus across these subdomains instead of repeating one: ${profile.rotation.join(', ')}.`
      : '';

    return `- Category "${profile.category}" maps to the knowledge area "${profile.promptCategory}".
  ${featuredText}
  ${rotationText}`.trim();
  }).join('\n');
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(' ')
    .filter(token => token.length > 2);
}

function similarityScore(a: string, b: string) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));

  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  return overlap / Math.min(aTokens.size, bTokens.size);
}

function isTooSimilar(candidate: ExistingQuestion, existing: ExistingQuestion) {
  if (candidate.category !== existing.category) return false;

  const candidateNormalized = normalizeText(candidate.question);
  const existingNormalized = normalizeText(existing.question);

  if (!candidateNormalized || !existingNormalized) return true;
  if (candidateNormalized === existingNormalized) return true;
  if (candidateNormalized.includes(existingNormalized) || existingNormalized.includes(candidateNormalized)) return true;

  return similarityScore(candidate.question, existing.question) >= 0.7;
}

function isValidQuestionShape(question: any) {
  if (!question || typeof question.question !== 'string' || typeof question.category !== 'string') return false;
  if (!['easy', 'medium', 'hard'].includes(question.difficulty)) return false;
  if (!Array.isArray(question.choices) || question.choices.length !== 4) return false;
  if (!Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 3) return false;
  if (typeof question.explanation !== 'string' || !question.explanation.trim()) return false;

  const normalizedChoices = question.choices.map((choice: string) => normalizeText(choice));
  if (normalizedChoices.some((choice: string) => !choice)) return false;
  if (new Set(normalizedChoices).size !== 4) return false;

  return true;
}

export function buildQuestionPrompt(
  categories: string[],
  countPerCategory: number,
  existingQuestions: ExistingQuestion[],
  requestedDifficulty?: 'easy' | 'medium' | 'hard'
) {
  const style = QUESTION_STYLES[Math.floor(Math.random() * QUESTION_STYLES.length)];
  const lens = QUESTION_LENSES[Math.floor(Math.random() * QUESTION_LENSES.length)];
  const difficulty = requestedDifficulty || 'medium';
  const requestedCount = countPerCategory + 2;
  const subdomainInstructions = buildSubdomainInstructions(categories, requestedCount);
  const avoidedQuestions = existingQuestions
    .filter(item => categories.includes(item.category))
    .slice(-12)
    .map(item => `- [${item.category}] ${item.question}`)
    .join('\n');
  const categoryToneGuidance = [
    'History = dry, lightly ironic',
    'Science = curious, confident, lightly amused',
    'Pop Culture = playful, current, a little cheeky',
    'Sports = energetic, slightly cocky',
    'Art & Music = expressive, appreciative, not pretentious',
    'Technology = dry, slightly smug',
  ].join('\n');

  return `You are generating high-quality trivia questions injected with highbrow humor, sublte condescension and occassional sarcasm.

Return ONLY valid JSON.
Do not include commentary.
Do not include markdown.
Do not include explanations outside the JSON.

Return this exact top-level shape:
{
  "questions": [
    {
      "category": string,
      "difficulty": "easy" | "medium" | "hard",
      "question": string,
      "choices": [string, string, string, string],
      "correctIndex": number,
      "explanation": string
    }
  ]
}

Rules:
- Exactly ${requestedCount} questions total.
- Categories allowed for this batch: ${categories.join(', ')}.
- Use only the category names exactly as listed.
- Target difficulty for this batch: ${difficulty}.
- Difficulty guidelines:
  easy = common knowledge for adults, but not insultingly obvious or elementary-school trivial
  medium = default target; assume an informed adult audience and write questions that feel game-show appropriate
  hard = challenging but fair; reward strong knowledge without drifting into niche, obscure, or specialist-only trivia
- Exactly 4 answer choices per question.
- Exactly 1 correct answer per question.
- No duplicate answers.
- No trick questions.
- No ambiguous wording.
- No "all of the above" or "none of the above".
- Keep explanations to 1-2 sentences.
- Make wrong answers plausible but clearly incorrect.
- Avoid extremely overused textbook trivia and worksheet-level facts.
- Avoid elementary-school obvious questions unless absolutely necessary.
- Do not use questions equivalent to "Who was the first U.S. president?", "Earth is the third planet from the Sun", or other one-step giveaway facts.
- Avoid obvious one-step sports or pop-culture facts that most players would answer instantly without thinking.
- Prefer questions that feel sharp, intentional, and game-show appropriate rather than classroom-recitation obvious.
- Keep questions clear and direct, but inject them with humor and personality; write them in a conversational, witty, highbrow tone.
- Add humor or mild sarcasm in a manner that does not distract or confuse; the style of humor and/or sarcasm should be smug, condescending, and highbrow.
- Do not make the wording silly, vague, overly cute, or forced.
- Do not sacrifice clarity for personality.
- Avoid sounding like a textbook, exam, teacher, or encyclopedia entry; don't be boring.
- Answer choices must stay plain, clean, and straightforward. No jokes or gimmicks in the choices.
- Explanations should be informative while adopting a humorous or sarcastic tone, reminiscent of a witty game show host engaging with an adult audience
- Explanations must have more personality, humor, and/or sarcasm than the question, but should still sound concise and natural.
- Good style example:
  Question: "If the Pope decided to model his traditional zucchetto skullcap after the most famous "hungry" arcade character of 1980, what specific shape would be missing from his headgear?"
  Explanation: "While the Pope’s zucchetto is a full circle, Pac-Man is famously modeled after a pizza with one slice removed. If His Holiness went full Namco, he’d be rocking a 45-degree gap in his headgear."
- Bad style example:
  Question: "Which smug fruit empire birthed the magical rectangle that colonized your pocket???"
  Explanation: "Lol obviously Apple, come on."
- Prefer ${style}.
- Favor ${lens}.
- Apply these category tone nudges t:
${categoryToneGuidance}
- Use the following category focus guidance:
${subdomainInstructions}
- Do not repeat or closely paraphrase any avoided question.

Avoided questions:
${avoidedQuestions || '- None recorded'}`;
}

export function dedupeQuestions(
  generatedQuestions: any[],
  existingQuestions: ExistingQuestion[],
  countPerCategory: number
): TriviaQuestion[] {
  const accepted: TriviaQuestion[] = [];
  const seen: ExistingQuestion[] = [...existingQuestions];
  const counts = new Map<string, number>();

  for (const question of generatedQuestions) {
    if (!isValidQuestionShape(question)) continue;

    const candidate = {
      category: question.category,
      question: question.question,
    };

    if (seen.some(existing => isTooSimilar(candidate, existing))) continue;

    const currentCount = counts.get(question.category) ?? 0;
    if (currentCount >= countPerCategory) continue;

    counts.set(question.category, currentCount + 1);
    seen.push(candidate);

    accepted.push({
      ...question,
      id: '',
      questionId: '',
      difficulty: question.difficulty || 'medium',
      correctIndex: question.correctIndex,
      answerIndex: question.correctIndex,
      explanation: question.explanation || '',
      validationStatus: 'approved',
      createdAt: Date.now(),
      usedCount: 0,
      correctQuip: '',
      wrongAnswerQuips: {
        0: '',
        1: '',
        2: '',
        3: '',
      },
      used: false,
    });
  }

  return accepted;
}

async function requestQuestionsFromApi(payload: {
  categories: string[];
  countPerCategory: number;
  existingQuestions: ExistingQuestion[];
  requestedDifficulty?: 'easy' | 'medium' | 'hard';
}) {
  const response = await fetch('/api/generate-questions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) {
      setProviderCooldown('server', data.retryAfterMs ?? extractRetryDelayMs(data.error));
    }
    throw new Error(data.error || `Question generation failed with status ${response.status}`);
  }

  return data;
}

async function requestHecklesFromApi(context: HeckleGenerationContext) {
  const response = await fetch('/api/generate-heckles', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(context),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Heckle generation failed with status ${response.status}`);
  }

  return data;
}

export async function generateQuestions(
  categories: string[],
  countPerCategory: number = 3,
  existingQuestions: ExistingQuestion[] = [],
  requestedDifficulty?: 'easy' | 'medium' | 'hard'
): Promise<TriviaQuestion[]> {
  if (!getQuestionGenerationStatus().canAttemptAny) {
    logGeneration('generation skipped: server cooldown active');
    return [];
  }

  try {
    const data = await requestQuestionsFromApi({
      categories,
      countPerCategory,
      existingQuestions,
      requestedDifficulty,
    });
    return Array.isArray(data.questions) ? data.questions : [];
  } catch (error) {
    if (isRateLimitError(error)) {
      setProviderCooldown('server', extractRetryDelayMs(error instanceof Error ? error.message : String(error)));
    }
    logGeneration(`server generation failed${isRateLimitError(error) ? ' with rate limit' : ''}`);
    return [];
  }
}

export async function generateHeckles(context: HeckleGenerationContext): Promise<string[]> {
  if (context.isSolo) {
    return [];
  }

  try {
    const data = await requestHecklesFromApi(context);
    const rawHeckles = Array.isArray(data.heckles) ? data.heckles : [];

    return rawHeckles
      .filter((heckle: unknown): heckle is string => typeof heckle === 'string')
      .map((heckle) => heckle.trim())
      .filter((heckle) => heckle.length > 0)
      .slice(0, MAX_HECKLES);
  } catch (error) {
    if (typeof process === 'undefined' || process.env.NODE_ENV !== 'production') {
      console.warn('[heckles] Generation failed:', error);
    }
    return [];
  }
}
