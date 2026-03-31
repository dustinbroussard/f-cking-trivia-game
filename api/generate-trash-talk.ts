import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import type { TrashTalkGenerationContext } from '../src/content/trashTalk.js';
import { buildTrashTalkPrompt } from '../src/content/trashTalk.js';

type ProviderName = 'gemini' | 'openrouter';

interface TrashTalkApiResponse {
  trashTalk: string | null;
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

function getProvider() {
  if (process.env.OPENROUTER_API_KEY) return 'openrouter' as const;
  if (process.env.GEMINI_API_KEY) return 'gemini' as const;
  return null;
}

function normalizeTrashTalk(rawText: string | null | undefined) {
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
    .slice(0, 2)
    .join(' ')
    .trim();

  return cleaned.length > 0 ? cleaned : null;
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

  return normalizeTrashTalk(response.text);
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
          content: 'You write short, punchy trivia trash-talk lines for transient in-game overlays. Use the exact game context and avoid generic filler.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.95,
      max_tokens: 120,
    }),
  });

  const rawText = await response.text();
  let data: any = null;

  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch (error) {
    console.error('[trash-talk/api] OpenRouter returned non-JSON payload', {
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
  return normalizeTrashTalk(typeof content === 'string' ? content : null);
}

async function generateTrashTalk(provider: ProviderName, prompt: string) {
  if (provider === 'openrouter') {
    return generateWithOpenRouter(prompt);
  }

  return generateWithGemini(prompt);
}

function sendJson(res: any, status: number, trashTalk: string | null) {
  const payload: TrashTalkApiResponse = { trashTalk };
  res.status(status).json(payload);
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    sendJson(res, 405, null);
    return;
  }

  try {
    const body = parseBody(req.body) as Partial<TrashTalkGenerationContext>;
    const provider = getProvider();

    if (body.isSolo || !provider || !body.event || !body.playerName || !body.opponentName) {
      sendJson(res, 200, null);
      return;
    }

    const prompt = buildTrashTalkPrompt({
      event: body.event,
      playerName: body.playerName,
      opponentName: body.opponentName,
      playerScore: body.playerScore ?? 0,
      opponentScore: body.opponentScore ?? 0,
      scoreDelta: body.scoreDelta ?? 0,
      playerTrophies: body.playerTrophies ?? 0,
      opponentTrophies: body.opponentTrophies ?? 0,
      latestCategory: body.latestCategory,
      outcomeSummary: body.outcomeSummary ?? 'Momentum shifted.',
      recentQuestionHistory: body.recentQuestionHistory ?? [],
      isSolo: !!body.isSolo,
    });

    const trashTalk = await generateTrashTalk(provider, prompt);
    sendJson(res, 200, trashTalk);
  } catch (error) {
    console.error('[trash-talk/api] Unhandled provider failure', {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    sendJson(res, 200, null);
  }
}
