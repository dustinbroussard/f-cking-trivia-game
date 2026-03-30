import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { buildHecklePrompt, MAX_HECKLES } from '../src/content/heckles.js';
import type { HeckleGenerationContext } from '../src/content/heckles.js';
import { heckleSchema } from '../src/services/gemini.js';

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
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = parseBody(req.body) as Partial<HeckleGenerationContext>;
  const requestSummary = summarizeContext(body);
  console.info('[heckles/api] Incoming request', requestSummary);

  if (
    !body.playerName ||
    !body.opponentName ||
    !body.trigger ||
    !body.waitingReason ||
    typeof body.playerScore !== 'number' ||
    typeof body.opponentScore !== 'number' ||
    typeof body.scoreDelta !== 'number' ||
    !body.recentPerformanceSummary ||
    typeof body.playerMissedLastQuestion !== 'boolean'
  ) {
    console.warn('[heckles/api] Invalid payload', requestSummary);
    res.status(400).json({ error: 'Invalid heckle payload' });
    return;
  }

  if (body.isSolo) {
    console.info('[heckles/api] Solo mode payload, returning empty response');
    res.status(200).json({ heckles: [] });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error('[heckles/api] GEMINI_API_KEY missing');
    res.status(500).json({ error: 'GEMINI_API_KEY is missing' });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: buildHecklePrompt(body as HeckleGenerationContext),
      config: {
        responseMimeType: 'application/json',
        responseSchema: heckleSchema as any,
      },
    });

    const text = response.text || '';
    if (!isValidJsonEnvelope(text)) {
      throw new Error('Heckle generator returned non-JSON content');
    }

    const data = JSON.parse(text);
    const heckles = Array.isArray(data.heckles) ? data.heckles : [];
    const sanitizedHeckles = heckles
      .filter((heckle: unknown): heckle is string => typeof heckle === 'string')
      .map((heckle) => heckle.trim())
      .filter((heckle) => heckle.length > 0)
      .slice(0, MAX_HECKLES);

    console.info('[heckles/api] Generation succeeded', {
      ...requestSummary,
      returnedCount: sanitizedHeckles.length,
    });

    res.status(200).json({
      heckles: sanitizedHeckles,
    });
  } catch (error) {
    console.error('[heckles/api] Generation failed', {
      ...requestSummary,
      error,
    });
    res.status(500).json({ error: 'Heckle generation failed' });
  }
}
