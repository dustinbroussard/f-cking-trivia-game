import { GoogleGenAI, Type } from "@google/genai";
import { TriviaQuestion } from "../types";
import { getGenerationCategoryProfile } from "./categorySubdomains";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const questionSchema = {
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

type ExistingQuestion = Pick<TriviaQuestion, 'category' | 'question'>;

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

const DIFFICULTY_SHAPES = [
  'easy',
  'medium',
  'hard',
];

function shuffle<T>(items: T[]) {
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

  if (import.meta.env.DEV) {
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

function buildQuestionPrompt(
  categories: string[],
  countPerCategory: number,
  existingQuestions: ExistingQuestion[],
  requestedDifficulty?: 'easy' | 'medium' | 'hard'
) {
  const style = QUESTION_STYLES[Math.floor(Math.random() * QUESTION_STYLES.length)];
  const lens = QUESTION_LENSES[Math.floor(Math.random() * QUESTION_LENSES.length)];
  const difficulty = requestedDifficulty || DIFFICULTY_SHAPES[Math.floor(Math.random() * DIFFICULTY_SHAPES.length)];
  const requestedCount = countPerCategory + 2;
  const subdomainInstructions = buildSubdomainInstructions(categories, requestedCount);
  const avoidedQuestions = existingQuestions
    .filter(item => categories.includes(item.category))
    .slice(-12)
    .map(item => `- [${item.category}] ${item.question}`)
    .join('\n');

  return `You are generating high-quality trivia questions.

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
  easy = common knowledge, widely known facts
  medium = requires general education or familiarity
  hard = challenging but fair, not obscure trivia
- Exactly 4 answer choices per question.
- Exactly 1 correct answer per question.
- No duplicate answers.
- No trick questions.
- No ambiguous wording.
- No "all of the above" or "none of the above".
- Keep explanations to 1-2 sentences.
- Keep questions concise and clear.
- Make wrong answers plausible but clearly incorrect.
- Prefer ${style}.
- Favor ${lens}.
- Use the following category focus guidance:
${subdomainInstructions}
- Do not repeat or closely paraphrase any avoided question.

Avoided questions:
${avoidedQuestions || '- None recorded'}`;
}

function dedupeQuestions(
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

async function requestQuestions(prompt: string) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: questionSchema as any
    }
  });

  const text = response.text || '';
  if (!text.trim().startsWith('{') || !text.trim().endsWith('}')) {
    throw new Error('Generator returned non-JSON content');
  }

  return JSON.parse(text);
}

export async function generateQuestions(
  categories: string[],
  countPerCategory: number = 3,
  existingQuestions: ExistingQuestion[] = [],
  requestedDifficulty?: 'easy' | 'medium' | 'hard'
): Promise<TriviaQuestion[]> {
  let accepted: TriviaQuestion[] = [];
  let avoidanceList = [...existingQuestions];

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const prompt = buildQuestionPrompt(categories, countPerCategory, avoidanceList, requestedDifficulty);
      const data = await requestQuestions(prompt);
      const deduped = dedupeQuestions(data.questions || [], avoidanceList, countPerCategory);

      accepted = [...accepted, ...deduped].filter((question, index, array) => {
        return array.findIndex(other =>
          other.category === question.category &&
          normalizeText(other.question) === normalizeText(question.question)
        ) === index;
      });

      avoidanceList = [...avoidanceList, ...accepted.map(({ category, question }) => ({ category, question }))];

      const hasEnough = categories.every(category =>
        accepted.filter(question => question.category === category).length >= countPerCategory
      );

      if (hasEnough) break;
    }

    return accepted.map((q, index) => {
      const generatedId = `${Date.now()}-${index}`;
      return {
        ...q,
        id: generatedId,
        questionId: generatedId,
        used: false
      };
    });
  } catch (error) {
    console.warn("Primary AI failed, attempting OpenRouter fallback...", error);
    
    try {
      if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is missing");

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const prompt = buildQuestionPrompt(categories, countPerCategory, avoidanceList, requestedDifficulty);
        const fallbackPrompt = prompt;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": window.location.href,
            "X-Title": "AFTG Trivia"
          },
          body: JSON.stringify({
            model: "openrouter/free",
            messages: [{ role: "user", content: fallbackPrompt }]
          })
        });

        if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        if (!content.trim().startsWith('{') || !content.trim().endsWith('}')) {
          throw new Error('Fallback generator returned non-JSON content');
        }

        const parsedData = JSON.parse(content);
        const deduped = dedupeQuestions(parsedData.questions || [], avoidanceList, countPerCategory);

        accepted = [...accepted, ...deduped].filter((question, index, array) => {
          return array.findIndex(other =>
            other.category === question.category &&
            normalizeText(other.question) === normalizeText(question.question)
          ) === index;
        });

        avoidanceList = [...avoidanceList, ...accepted.map(({ category, question }) => ({ category, question }))];

        const hasEnough = categories.every(category =>
          accepted.filter(question => question.category === category).length >= countPerCategory
        );

        if (hasEnough) break;
      }

      return accepted.map((q, index) => {
        const generatedId = `or-${Date.now()}-${index}`;
        return {
          ...q,
          id: generatedId,
          questionId: generatedId,
          used: false
        };
      });
    } catch (fallbackError) {
      console.error("Fallback OpenRouter failed:", fallbackError);
      return [];
    }
  }
}

export async function generateRoast(
  category: string,
  question: string,
  answer: string,
  isCorrect: boolean,
  playerName: string,
  streak: number,
  score: number,
  completedCategories: string[]
): Promise<string> {
  const prompt = `You are a smug, sarcastic trivia host (like "You Don't Know Jack"). 
  Player "${playerName}" just answered a question in the "${category}" category.
  Question: "${question}"
  Their answer was: "${answer}"
  Result: ${isCorrect ? "CORRECT" : "WRONG"}
  Current Streak: ${streak}
  Total Score: ${score}
  Categories they've already completed: ${completedCategories.length > 0 ? completedCategories.join(', ') : 'None yet'}

  Generate a short (1-2 sentence) roast or celebratory quip. 
  If they were correct, be begrudgingly impressed or smugly supportive. 
  If they were wrong, be hilariously insulting. Reference their failure, the specific category, their past performance (completed categories), or their pathetic score/streak.
  Keep it irreverent, highly context-aware, and funny.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    return response.text || (isCorrect ? "Fine, you got it. Don't let it go to your head." : "Wow, that was impressively stupid.");
  } catch (error) {
    console.warn("Primary AI failed for roasting, attempting OpenRouter fallback...", error);
    
    try {
      if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is missing");
      
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": window.location.href,
          "X-Title": "AFTG Trivia"
        },
        body: JSON.stringify({
          model: "openrouter/free",
          messages: [{ role: "user", content: prompt }]
        })
      });

      if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
      
      const data = await response.json();
      return data.choices?.[0]?.message?.content || (isCorrect ? "Correct." : "Dead wrong.");
    } catch (fallbackError) {
      console.error("Error generating fallback roast:", fallbackError);
      return isCorrect ? "Correct!" : "Wrong!";
    }
  }
}
