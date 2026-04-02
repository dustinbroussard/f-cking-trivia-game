import type { TrashTalkGenerationContext } from '../src/content/trashTalk.js';
import { buildTrashTalkPrompt } from '../src/content/trashTalk.js';
import { MODERN_HOST_SYSTEM_PROMPT } from '../src/content/hostPersona.js';
import { createTrashTalkFallback, generateWithFallback, validateTrashTalk } from './_lib/commentary.js';

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

function sendJson(res: any, status: number, trashTalk: string | null) {
  const payload: TrashTalkApiResponse = { trashTalk };
  res.status(status).json(payload);
}

export default async function handler(req: any, res: any) {
  const body = parseBody(req.body) as Partial<TrashTalkGenerationContext>;

  if (req.method !== 'POST') {
    console.warn('[trash-talk/api] Rejected non-POST request', {
      method: req.method,
    });
    sendJson(res, 405, null);
    return;
  }

  try {
    const requestSummary = summarizeContext(body);

    console.info('[trash-talk/api] Incoming request', {
      requestSummary,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
    });

    if (body.isSolo || !body.event || !body.playerName || !body.opponentName) {
      console.warn('[trash-talk/api] Request skipped: missing eligibility or required fields', {
        requestSummary,
      });
      sendJson(
        res,
        200,
        body.playerName && body.opponentName && body.event
          ? createTrashTalkFallback({
              playerName: body.playerName,
              opponentName: body.opponentName,
              event: body.event,
            })
          : null
      );
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

    const trashTalk = await generateWithFallback({
      task: 'trash-talk',
      prompt,
      systemInstruction: MODERN_HOST_SYSTEM_PROMPT,
      temperature: 0.95,
      maxTokens: 120,
      validate: validateTrashTalk,
      localFallback: () =>
        createTrashTalkFallback({
          playerName: body.playerName!,
          opponentName: body.opponentName!,
          event: body.event!,
        }),
    });

    console.info('[trash-talk/api] Commentary resolved', {
      requestSummary,
      hasTrashTalk: !!trashTalk,
      trashTalkLength: trashTalk.length,
    });
    sendJson(res, 200, trashTalk);
  } catch (error) {
    console.error('[trash-talk/api] Unhandled provider failure', {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    sendJson(
      res,
      200,
      body.playerName && body.opponentName && body.event
        ? createTrashTalkFallback({
            playerName: body.playerName,
            opponentName: body.opponentName,
            event: body.event,
          })
        : null
    );
  }
}
