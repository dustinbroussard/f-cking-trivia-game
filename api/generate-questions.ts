import { GoogleGenAI } from '@google/genai';
import {
  buildQuestionPrompt,
  dedupeQuestions,
  extractRetryDelayMs,
  ExistingQuestion,
  isRateLimitError,
  questionSchema,
} from '../src/services/gemini';

type Difficulty = 'easy' | 'medium' | 'hard';

function parseBody(body: any) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function isValidJsonEnvelope(text: string) {
  const trimmed = text.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}');
}

async function requestGeminiQuestions(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing');
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: questionSchema as any,
    },
  });

  const text = response.text || '';
  if (!isValidJsonEnvelope(text)) {
    throw new Error('Generator returned non-JSON content');
  }

  return JSON.parse(text);
}

async function requestOpenRouterQuestions(prompt: string, requestUrl: string) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': requestUrl,
      'X-Title': 'AFTG Trivia',
    },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
    const error = new Error(detail || `OpenRouter returned ${response.status}`);
    (error as Error & { retryAfterMs?: number | null }).retryAfterMs = retryAfterMs;
    throw error;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (!isValidJsonEnvelope(content)) {
    throw new Error('Fallback generator returned non-JSON content');
  }

  return JSON.parse(content);
}

function finalizeQuestions(questions: ReturnType<typeof dedupeQuestions>, prefix = '') {
  return questions.map((question, index) => {
    const generatedId = `${prefix}${Date.now()}-${index}`;
    return {
      ...question,
      id: generatedId,
      questionId: generatedId,
      used: false,
    };
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = parseBody(req.body);
  const categories = Array.isArray(body.categories) ? body.categories : [];
  const countPerCategory = Number.isInteger(body.countPerCategory) ? body.countPerCategory : 3;
  const existingQuestions = Array.isArray(body.existingQuestions) ? body.existingQuestions as ExistingQuestion[] : [];
  const requestedDifficulty = body.requestedDifficulty as Difficulty | undefined;

  if (categories.length === 0) {
    res.status(400).json({ error: 'categories are required' });
    return;
  }

  const prompt = buildQuestionPrompt(categories, countPerCategory, existingQuestions, requestedDifficulty);

  try {
    const geminiData = await requestGeminiQuestions(prompt);
    const accepted = dedupeQuestions(geminiData.questions || [], existingQuestions, countPerCategory);
    res.status(200).json({ questions: finalizeQuestions(accepted) });
    return;
  } catch (error) {
    if (process.env.OPENROUTER_API_KEY) {
      try {
        const requestUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host || ''}`;
        const openRouterData = await requestOpenRouterQuestions(prompt, requestUrl);
        const accepted = dedupeQuestions(openRouterData.questions || [], existingQuestions, countPerCategory);
        res.status(200).json({ questions: finalizeQuestions(accepted, 'or-') });
        return;
      } catch (fallbackError) {
        if (isRateLimitError(fallbackError)) {
          const retryAfterMs = (fallbackError as Error & { retryAfterMs?: number | null }).retryAfterMs
            ?? extractRetryDelayMs(fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
          res.status(429).json({
            error: 'AI generation is temporarily cooling down. Please try again shortly.',
            retryAfterMs,
          });
          return;
        }
      }
    }

    if (isRateLimitError(error)) {
      res.status(429).json({
        error: 'AI generation is temporarily cooling down. Please try again shortly.',
        retryAfterMs: extractRetryDelayMs(error instanceof Error ? error.message : String(error)),
      });
      return;
    }

    res.status(500).json({ error: 'Question generation failed' });
  }
}
