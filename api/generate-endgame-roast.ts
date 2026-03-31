import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import type { EndgameRoastGenerationContext, EndgameRoastResult } from '../src/content/endgameRoast.js';
import { buildEndgameRoastPrompt } from '../src/content/endgameRoast.js';

type ProviderName = 'gemini' | 'openrouter';

interface EndgameRoastApiResponse extends EndgameRoastResult {}

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

function getProvider() {
  if (process.env.OPENROUTER_API_KEY) return 'openrouter' as const;
  if (process.env.GEMINI_API_KEY) return 'gemini' as const;
  return null;
}

function normalizeText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseResponse(rawText: string | null | undefined): EndgameRoastResult | null {
  if (!rawText) return null;

  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    const loserRoast = normalizeText(parsed?.loserRoast);
    const winnerCompliment = normalizeText(parsed?.winnerCompliment);
    if (!loserRoast || !winnerCompliment) {
      return null;
    }

    return {
      loserRoast,
      winnerCompliment,
    };
  } catch (error) {
    console.error('[endgame-roast/api] Failed to parse provider response', {
      error,
      rawText: cleaned,
    });
    return null;
  }
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

  return parseResponse(response.text);
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
          content: 'You write short, specific post-game trivia roasts in strict JSON. Use the exact winner, loser, and recent question context.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.95,
      max_tokens: 180,
    }),
  });

  const rawText = await response.text();
  let data: any = null;

  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch (error) {
    console.error('[endgame-roast/api] OpenRouter returned non-JSON payload', {
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
  return parseResponse(typeof content === 'string' ? content : null);
}

async function generateEndgameRoast(provider: ProviderName, prompt: string) {
  if (provider === 'openrouter') {
    return generateWithOpenRouter(prompt);
  }

  return generateWithGemini(prompt);
}

function sendJson(res: any, status: number, payload: EndgameRoastResult | null) {
  const responsePayload: EndgameRoastApiResponse = {
    loserRoast: payload?.loserRoast ?? '',
    winnerCompliment: payload?.winnerCompliment ?? '',
  };

  res.status(status).json(responsePayload);
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    sendJson(res, 405, null);
    return;
  }

  try {
    const body = parseBody(req.body) as Partial<EndgameRoastGenerationContext>;
    const provider = getProvider();

    if (
      body.isSolo ||
      !provider ||
      !body.winnerName ||
      !body.loserName
    ) {
      sendJson(res, 200, null);
      return;
    }

    const roast = await generateEndgameRoast(provider, buildEndgameRoastPrompt({
      winnerName: body.winnerName,
      loserName: body.loserName,
      winnerScore: body.winnerScore ?? 0,
      loserScore: body.loserScore ?? 0,
      winnerTrophies: body.winnerTrophies ?? 0,
      loserTrophies: body.loserTrophies ?? 0,
      winnerRecentQuestionHistory: body.winnerRecentQuestionHistory ?? [],
      loserRecentQuestionHistory: body.loserRecentQuestionHistory ?? [],
      isSolo: !!body.isSolo,
    }));

    sendJson(res, 200, roast);
  } catch (error) {
    console.error('[endgame-roast/api] Unhandled provider failure', {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    sendJson(res, 200, null);
  }
}
