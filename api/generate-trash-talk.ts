import type { TrashTalkGenerationContext } from '../src/content/trashTalk.js';
import { buildTrashTalkPrompt } from '../src/content/trashTalk.js';
import { MODERN_HOST_SYSTEM_PROMPT } from '../src/content/hostPersona.js';
import { generateGeminiText } from './_lib/gemini.js';

type ProviderName = 'gemini' | 'openrouter';

interface TrashTalkApiResponse {
  trashTalk: string | null;
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

function getProvider() {
  if (process.env.OPENROUTER_API_KEY) return 'openrouter' as const;
  if (process.env.GEMINI_API_KEY) return 'gemini' as const;
  return null;
}

function summarizeContext(context: Partial<TrashTalkGenerationContext>) {
  return {
    event: context.event ?? null,
    playerName: context.playerName ?? null,
    opponentName: context.opponentName ?? null,
    playerScore: context.playerScore ?? null,
    opponentScore: context.opponentScore ?? null,
    scoreDelta: context.scoreDelta ?? null,
    playerTrophies: context.playerTrophies ?? null,
    opponentTrophies: context.opponentTrophies ?? null,
    latestCategory: context.latestCategory ?? null,
    hasOutcomeSummary: !!context.outcomeSummary,
    recentQuestionHistoryCount: context.recentQuestionHistory?.length ?? 0,
    isSolo: context.isSolo ?? null,
  };
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

function parseTrashTalkResponse(rawText: string | null | undefined) {
  const normalizedText = normalizeTrashTalk(rawText);
  if (!normalizedText) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalizedText);
    if (typeof parsed?.trashTalk === 'string') {
      return normalizeTrashTalk(parsed.trashTalk);
    }
  } catch {
    // Some providers will ignore format instructions and return plain text.
  }

  return normalizedText;
}

async function generateWithGemini(prompt: string) {
  const text = await generateGeminiText(prompt, MODERN_HOST_SYSTEM_PROMPT);
  return parseTrashTalkResponse(text);
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

  const content = extractOpenRouterText(data?.choices?.[0]?.message?.content);
  return parseTrashTalkResponse(content);
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
    console.warn('[trash-talk/api] Rejected non-POST request', {
      method: req.method,
    });
    sendJson(res, 405, null);
    return;
  }

  try {
    const body = parseBody(req.body) as Partial<TrashTalkGenerationContext>;
    const provider = getProvider();
    const requestSummary = summarizeContext(body);

    console.info('[trash-talk/api] Incoming request', {
      provider,
      requestSummary,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
    });

    if (body.isSolo || !provider || !body.event || !body.playerName || !body.opponentName) {
      console.warn('[trash-talk/api] Request skipped: missing eligibility or required fields', {
        provider,
        requestSummary,
      });
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
    console.info('[trash-talk/api] Provider completed request', {
      provider,
      requestSummary,
      hasTrashTalk: !!trashTalk,
      trashTalkLength: trashTalk?.length ?? 0,
    });
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
