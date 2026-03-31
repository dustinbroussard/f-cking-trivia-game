import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import type { HeckleGenerationContext } from '../src/content/heckles.js';

type ProviderName = 'gemini' | 'openrouter';

interface HeckleApiResponse {
  heckle: string | null;
  heckles: string[];
}

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

function buildPrompt(context: Partial<HeckleGenerationContext>) {
  const recentQuestionHistory = context.recentQuestionHistory?.length
    ? context.recentQuestionHistory
        .map((item, index) => `  ${index + 1}. "${item.question}" | category: ${item.category} | difficulty: ${item.difficulty} | player answer: "${item.playerAnswer}" | correct answer: "${item.correctAnswer}" | result: ${item.result}`)
        .join('\n')
    : '  None recorded';

  return `Write one short multiplayer trivia heckle for a waiting player.

Context:
- Player: ${context.playerName || 'Player'}
- Opponent: ${context.opponentName || 'Opponent'}
- Trigger: ${context.trigger || 'waiting'}
- Waiting reason: ${context.waitingReason || 'Waiting for the other player to finish'}
- Score: ${context.playerName || 'Player'} ${context.playerScore ?? 0}, ${context.opponentName || 'Opponent'} ${context.opponentScore ?? 0}
- Score delta: ${context.scoreDelta ?? 0}
- Last question: ${context.lastQuestion || 'Unknown'}
- Missed last question: ${context.playerMissedLastQuestion ? 'yes' : 'no'}
- Category: ${context.category || 'Unknown'}
- Difficulty: ${context.difficulty || 'Unknown'}
- Recent performance summary: ${context.recentPerformanceSummary || 'No recent summary'}
- Recent failure details: ${context.recentFailure || 'None'}
- Last two resolved questions:
${recentQuestionHistory}

Rules:
- Return only the heckle text
- 1 to 2 sentences max
- Witty, snarky, playful, and sharply specific
- Use at least one concrete detail from the provided context whenever possible
- Avoid generic filler that could fit any trivia match
- If context is thin, anchor the joke in the exact score state or trigger instead of vague insults
- No slurs
- No hate content
- No threats
- No sexual content
- No meta commentary
- Keep it punchy enough for a waiting-state UI`;
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

  return normalizeHeckle(response.text);
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
          content: 'You write sharp, highly specific trivia heckles for waiting-state UI. Use the supplied game details. Avoid generic roast filler.',
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

  const content = data?.choices?.[0]?.message?.content;
  return normalizeHeckle(typeof content === 'string' ? content : null);
}

async function generateHeckle(provider: ProviderName, prompt: string) {
  if (provider === 'openrouter') {
    return generateWithOpenRouter(prompt);
  }

  return generateWithGemini(prompt);
}

function sendJson(res: any, status: number, heckle: string | null) {
  const payload: HeckleApiResponse = {
    heckle,
    heckles: heckle ? [heckle] : [],
  };

  res.status(status).json(payload);
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    console.warn('[heckles/api] Rejected non-POST request', {
      method: req.method,
    });
    sendJson(res, 405, null);
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
      sendJson(res, 200, null);
      return;
    }

    if (!provider) {
      console.error('[heckles/api] No provider configured', {
        requestSummary,
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
      });
      sendJson(res, 200, null);
      return;
    }

    if (!body.playerName || !body.waitingReason) {
      console.error('[heckles/api] Missing required request fields', {
        requestSummary,
      });
      sendJson(res, 200, null);
      return;
    }

    const prompt = buildPrompt(body);
    console.info('[heckles/api] Provider request starting', {
      provider,
      requestSummary,
      promptPreview: prompt.slice(0, 240),
    });

    const heckle = await generateHeckle(provider, prompt);

    console.info('[heckles/api] Provider request completed', {
      provider,
      requestSummary,
      heckleGenerated: !!heckle,
      hecklePreview: heckle,
    });

    sendJson(res, 200, heckle);
  } catch (error) {
    console.error('[heckles/api] Unhandled provider failure', {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    sendJson(res, 200, null);
  }
}
