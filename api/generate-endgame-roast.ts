import type { EndgameRoastGenerationContext, EndgameRoastResult } from '../src/content/endgameRoast.js';
import { buildEndgameRoastPrompt } from '../src/content/endgameRoast.js';
import { MODERN_HOST_SYSTEM_PROMPT } from '../src/content/hostPersona.js';
import { generateGeminiText } from './_lib/gemini.js';

type ProviderName = 'gemini' | 'openrouter';

interface EndgameRoastApiResponse extends EndgameRoastResult {}

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

function summarizeContext(context: Partial<EndgameRoastGenerationContext>) {
  return {
    winnerName: context.winnerName ?? null,
    loserName: context.loserName ?? null,
    winnerScore: context.winnerScore ?? null,
    loserScore: context.loserScore ?? null,
    winnerTrophies: context.winnerTrophies ?? null,
    loserTrophies: context.loserTrophies ?? null,
    winnerRecentQuestionHistoryCount: context.winnerRecentQuestionHistory?.length ?? 0,
    loserRecentQuestionHistoryCount: context.loserRecentQuestionHistory?.length ?? 0,
    isSolo: context.isSolo ?? null,
  };
}

function normalizeText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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

function parseResponse(rawText: string | null | undefined): EndgameRoastResult | null {
  if (!rawText) return null;

  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const loserRoast = normalizeText(parsed?.loserRoast);
      const winnerCompliment = normalizeText(parsed?.winnerCompliment);
      if (!loserRoast || !winnerCompliment) {
        continue;
      }

      return {
        loserRoast,
        winnerCompliment,
      };
    } catch {
      // Try the next candidate.
    }
  }

  console.error('[endgame-roast/api] Failed to parse provider response', {
    rawText: cleaned,
  });
  return null;
}

async function generateWithGemini(prompt: string) {
  const text = await generateGeminiText(
    prompt,
    `${MODERN_HOST_SYSTEM_PROMPT} Return strict JSON and use the exact winner, loser, points score, trophy counts, and recent question context. Never invent impossible trophy totals or alternate scorelines.`
  );
  return parseResponse(text);
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
          content: `${MODERN_HOST_SYSTEM_PROMPT} Return strict JSON and use the exact winner, loser, points score, trophy counts, and recent question context. Never invent impossible trophy totals or alternate scorelines.`,
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

  const content = extractOpenRouterText(data?.choices?.[0]?.message?.content);
  return parseResponse(content);
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
    console.warn('[endgame-roast/api] Rejected non-POST request', {
      method: req.method,
    });
    sendJson(res, 405, null);
    return;
  }

  try {
    const body = parseBody(req.body) as Partial<EndgameRoastGenerationContext>;
    const provider = getProvider();
    const requestSummary = summarizeContext(body);

    console.info('[endgame-roast/api] Incoming request', {
      provider,
      requestSummary,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
    });

    if (
      body.isSolo ||
      !provider ||
      !body.winnerName ||
      !body.loserName
    ) {
      console.warn('[endgame-roast/api] Request skipped: missing eligibility or required fields', {
        provider,
        requestSummary,
      });
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

    console.info('[endgame-roast/api] Provider completed request', {
      provider,
      requestSummary,
      hasRoast: !!roast,
      hasWinnerCompliment: !!roast?.winnerCompliment,
      hasLoserRoast: !!roast?.loserRoast,
    });
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
