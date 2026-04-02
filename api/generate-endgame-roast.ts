import type { EndgameRoastGenerationContext, EndgameRoastResult } from '../src/content/endgameRoast.js';
import { buildEndgameRoastPrompt } from '../src/content/endgameRoast.js';
import { MODERN_HOST_SYSTEM_PROMPT } from '../src/content/hostPersona.js';
import { createEndgameFallback, generateWithFallback, validateEndgameRoast } from './_lib/commentary.js';

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

function sendJson(res: any, status: number, payload: EndgameRoastResult | null) {
  const responsePayload: EndgameRoastApiResponse = {
    loserRoast: payload?.loserRoast ?? '',
    winnerCompliment: payload?.winnerCompliment ?? '',
  };

  res.status(status).json(responsePayload);
}

export default async function handler(req: any, res: any) {
  const body = parseBody(req.body) as Partial<EndgameRoastGenerationContext>;

  if (req.method !== 'POST') {
    console.warn('[endgame-roast/api] Rejected non-POST request', {
      method: req.method,
    });
    sendJson(res, 405, null);
    return;
  }

  try {
    const requestSummary = summarizeContext(body);

    console.info('[endgame-roast/api] Incoming request', {
      requestSummary,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
    });

    if (body.isSolo || !body.winnerName || !body.loserName) {
      console.warn('[endgame-roast/api] Request skipped: missing eligibility or required fields', {
        requestSummary,
      });
      sendJson(
        res,
        200,
        body.winnerName && body.loserName
          ? createEndgameFallback({
              winnerName: body.winnerName,
              loserName: body.loserName,
            })
          : null
      );
      return;
    }

    const roast = await generateWithFallback({
      task: 'endgame-roast',
      prompt: buildEndgameRoastPrompt({
        winnerName: body.winnerName,
        loserName: body.loserName,
        winnerScore: body.winnerScore ?? 0,
        loserScore: body.loserScore ?? 0,
        winnerTrophies: body.winnerTrophies ?? 0,
        loserTrophies: body.loserTrophies ?? 0,
        winnerRecentQuestionHistory: body.winnerRecentQuestionHistory ?? [],
        loserRecentQuestionHistory: body.loserRecentQuestionHistory ?? [],
        isSolo: !!body.isSolo,
      }),
      systemInstruction: `${MODERN_HOST_SYSTEM_PROMPT} Return strict JSON and use the exact winner, loser, points score, trophy counts, and recent question context. Never invent impossible trophy totals or alternate scorelines.`,
      temperature: 0.95,
      maxTokens: 180,
      validate: validateEndgameRoast,
      localFallback: () =>
        createEndgameFallback({
          winnerName: body.winnerName!,
          loserName: body.loserName!,
        }),
    });

    console.info('[endgame-roast/api] Commentary resolved', {
      requestSummary,
      hasRoast: !!roast,
      hasWinnerCompliment: !!roast.winnerCompliment,
      hasLoserRoast: !!roast.loserRoast,
    });
    sendJson(res, 200, roast);
  } catch (error) {
    console.error('[endgame-roast/api] Unhandled provider failure', {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    sendJson(
      res,
      200,
      body.winnerName && body.loserName
        ? createEndgameFallback({
            winnerName: body.winnerName,
            loserName: body.loserName,
          })
        : null
    );
  }
}
