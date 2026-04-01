import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { buildHecklePrompt, MAX_HECKLES, type HeckleGenerationContext } from '../src/content/heckles.js';
import { MODERN_HOST_SYSTEM_PROMPT } from '../src/content/hostPersona.js';

type ProviderName = 'gemini' | 'openrouter';

interface HeckleApiResponse {
  heckle: string | null;
  heckles: string[];
}

type OpenRouterMessageContent =
  | string
  | Array<{
      type?: string;
      text?: string;
    }>;

function parseBody(body: unknown) {
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

function summarizeContext(context: Partial<HeckleGenerationContext>) {
  return {
    playerName: context.playerName ?? null,
    opponentName: context.opponentName ?? null,
    trigger: context.trigger ?? null,
    waitingReason: context.waitingReason ?? null,
    playerScore: context.playerScore ?? null,
    opponentScore: context.opponentScore ?? null,
    scoreDelta: context.scoreDelta ?? null,
    playerMissedLastQuestion: context.playerMissedLastQuestion ?? null,
    category: context.category ?? null,
    difficulty: context.difficulty ?? null,
    hasLastQuestion: !!context.lastQuestion,
    hasRecentFailure: !!context.recentFailure,
    recentQuestionHistoryCount: context.recentQuestionHistory?.length ?? 0,
  };
}

function normalizeHeckle(rawText: string | null | undefined) {
  if (!rawText) return null;

  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('\n')
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

function normalizeHeckles(rawHeckles: unknown) {
  if (!Array.isArray(rawHeckles)) {
    return [];
  }

  return rawHeckles
    .filter((heckle): heckle is string => typeof heckle === 'string')
    .map((heckle) => normalizeHeckle(heckle))
    .filter((heckle): heckle is string => !!heckle)
    .slice(0, MAX_HECKLES);
}

function extractOpenRouterText(content: OpenRouterMessageContent | null | undefined) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n')
    .trim();

  return text.length > 0 ? text : null;
}

function parseHeckleResponse(rawText: string | null | undefined) {
  const normalizedText = normalizeHeckle(rawText);
  if (!normalizedText) {
    return [];
  }

  try {
    const parsed = JSON.parse(normalizedText);
    const parsedHeckles = normalizeHeckles(parsed?.heckles);
    if (parsedHeckles.length > 0) {
      return parsedHeckles;
    }
  } catch {
    // Some providers will ignore the JSON instruction and return plain text.
  }

  return [normalizedText];
}

function getProvider() {
  if (process.env.OPENROUTER_API_KEY) return 'openrouter' as const;
  if (process.env.GEMINI_API_KEY) return 'gemini' as const;
  return null;
}

async function generateWithGemini(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing');
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  return parseHeckleResponse(response.text);
}

async function generateWithOpenRouter(prompt: string) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000',
      'X-Title': 'A F-cking Trivia Game',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: MODERN_HOST_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.9,
      max_tokens: 120,
    }),
  });

  const rawText = await response.text();
  let data: any = null;

  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch (error) {
    console.error('[heckles/api] OpenRouter returned non-JSON payload', {
      error,
      rawText,
    });
  }

  if (!response.ok) {
    throw new Error(
      `OpenRouter request failed with status ${response.status}: ${
        data?.error?.message || rawText || 'Unknown error'
      }`
    );
  }

  const content = extractOpenRouterText(data?.choices?.[0]?.message?.content);
  return parseHeckleResponse(content);
}

async function generateHeckle(provider: ProviderName, prompt: string) {
  if (provider === 'openrouter') {
    return generateWithOpenRouter(prompt);
  }

  return generateWithGemini(prompt);
}

function sendJson(res: any, status: number, heckles: string[]) {
  const payload: HeckleApiResponse = {
    heckle: heckles[0] ?? null,
    heckles,
  };

  res.status(status).json(payload);
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    console.warn('[heckles/api] Rejected non-POST request', {
      method: req.method,
    });
    sendJson(res, 405, []);
    return;
  }

  try {
    const body = parseBody(req.body) as Partial<HeckleGenerationContext>;
    const requestSummary = summarizeContext(body);
    const provider = getProvider();

    console.info('[heckles/api] Incoming request', {
      provider,
      requestSummary,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
    });

    if (body.isSolo) {
      console.info('[heckles/api] Solo mode request, returning null heckle', requestSummary);
      sendJson(res, 200, []);
      return;
    }

    if (!provider) {
      console.error('[heckles/api] No provider configured', {
        requestSummary,
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
      });
      sendJson(res, 200, []);
      return;
    }

    if (!body.playerName || !body.waitingReason) {
      console.error('[heckles/api] Missing required request fields', {
        requestSummary,
      });
      sendJson(res, 200, []);
      return;
    }

    const prompt = buildHecklePrompt({
      playerName: body.playerName,
      opponentName: body.opponentName,
      trigger: body.trigger ?? 'prolonged_wait',
      waitingReason: body.waitingReason,
      playerScore: body.playerScore ?? 0,
      opponentScore: body.opponentScore ?? 0,
      scoreDelta: body.scoreDelta ?? 0,
      recentPerformanceSummary: body.recentPerformanceSummary ?? 'No recent summary',
      lastQuestion: body.lastQuestion,
      playerMissedLastQuestion: !!body.playerMissedLastQuestion,
      category: body.category,
      difficulty: body.difficulty,
      recentFailure: body.recentFailure,
      recentQuestionHistory: body.recentQuestionHistory ?? [],
      isSolo: !!body.isSolo,
    });
    console.info('[heckles/api] Provider request starting', {
      provider,
      requestSummary,
      promptPreview: prompt.slice(0, 240),
    });

    const heckles = await generateHeckle(provider, prompt);

    console.info('[heckles/api] Provider request completed', {
      provider,
      requestSummary,
      heckleCount: heckles.length,
      hecklePreview: heckles[0] ?? null,
    });

    sendJson(res, 200, heckles);
  } catch (error) {
    console.error('[heckles/api] Unhandled provider failure', {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    sendJson(res, 200, []);
  }
}
