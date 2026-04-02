import { buildHecklePrompt, type HeckleGenerationContext } from '../src/content/heckles.js';
import { MODERN_HOST_SYSTEM_PROMPT } from '../src/content/hostPersona.js';
import { createHeckleFallback, generateWithFallback, validateHeckles } from './_lib/commentary.js';

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

function sendJson(res: any, status: number, heckles: string[]) {
  const payload: HeckleApiResponse = {
    heckle: heckles[0] ?? null,
    heckles,
  };

  res.status(status).json(payload);
}

export default async function handler(req: any, res: any) {
  const body = parseBody(req.body) as Partial<HeckleGenerationContext>;

  if (req.method !== 'POST') {
    console.warn('[heckles/api] Rejected non-POST request', {
      method: req.method,
    });
    sendJson(res, 405, []);
    return;
  }

  try {
    const requestSummary = summarizeContext(body);

    console.info('[heckles/api] Incoming request', {
      requestSummary,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
    });

    if (body.isSolo) {
      console.info('[heckles/api] Solo mode request, returning null heckle', requestSummary);
      sendJson(res, 200, []);
      return;
    }

    if (!body.playerName || !body.waitingReason) {
      console.error('[heckles/api] Missing required request fields', {
        requestSummary,
      });
      sendJson(res, 200, createHeckleFallback({
        playerName: body.playerName ?? 'The player',
        opponentName: body.opponentName,
        category: body.category,
      }));
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

    const heckles = await generateWithFallback({
      task: 'heckles',
      prompt,
      systemInstruction: MODERN_HOST_SYSTEM_PROMPT,
      temperature: 0.9,
      maxTokens: 120,
      validate: validateHeckles,
      localFallback: () =>
        createHeckleFallback({
          playerName: body.playerName!,
          opponentName: body.opponentName,
          category: body.category,
        }),
    });

    console.info('[heckles/api] Commentary resolved', {
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
    sendJson(res, 200, createHeckleFallback({
      playerName: body.playerName ?? 'The player',
      opponentName: body.opponentName,
      category: body.category,
    }));
  }
}
