import { Type } from '@google/genai';
import type { EndgameRoastGenerationContext, EndgameRoastResult } from '../content/endgameRoast.js';
import type { HeckleGenerationContext } from '../content/heckles.js';
import { MAX_HECKLES } from '../content/heckles.js';
import type { TrashTalkGenerationContext } from '../content/trashTalk.js';
import { extractAiDisplayLines, extractFirstAiDisplayLine } from './aiText.js';

export const heckleSchema = {
  type: Type.OBJECT,
  properties: {
    heckles: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ['heckles'],
};

interface AiRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_HECKLE_TIMEOUT_MS = 6500;
const DEFAULT_TRASH_TALK_TIMEOUT_MS = 5000;
const DEFAULT_ENDGAME_ROAST_TIMEOUT_MS = 7000;

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || /aborted|timed out/i.test(error.message));
}

function createAbortSignal(options: AiRequestOptions) {
  const timeoutMs = options.timeoutMs;
  const parentSignal = options.signal;

  if (!timeoutMs) {
    return {
      signal: parentSignal,
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else if (parentSignal) {
    parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }

  const timeoutId = window.setTimeout(() => {
    controller.abort(new Error(`request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', abortFromParent);
      }
    },
  };
}

async function postAiJson<T>(endpoint: string, context: T, options: AiRequestOptions) {
  const { signal, cleanup } = createAbortSignal(options);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(context),
      signal,
    });

    const data = await response.json().catch(() => ({}));
    return { response, data };
  } finally {
    cleanup();
  }
}

async function requestHecklesFromApi(context: HeckleGenerationContext, options: AiRequestOptions = {}) {
  console.info('[heckles/client] Sending API request', {
    endpoint: '/api/generate-heckles',
    trigger: context.trigger,
    playerName: context.playerName,
    opponentName: context.opponentName ?? null,
    waitingReason: context.waitingReason,
  });

  const { response, data } = await postAiJson('/api/generate-heckles', context, {
    ...options,
    timeoutMs: options.timeoutMs ?? DEFAULT_HECKLE_TIMEOUT_MS,
  });

  console.info('[heckles/client] API response received', {
    endpoint: '/api/generate-heckles',
    ok: response.ok,
    status: response.status,
    hasHeckles: Array.isArray(data?.heckles) ? data.heckles.length : null,
  });
  if (!response.ok) {
    throw new Error(data.error || `Heckle generation failed with status ${response.status}`);
  }

  return data;
}

async function requestTrashTalkFromApi(context: TrashTalkGenerationContext, options: AiRequestOptions = {}) {
  console.info('[trash-talk/client] Sending API request', {
    endpoint: '/api/generate-trash-talk',
    event: context.event,
    playerName: context.playerName,
    opponentName: context.opponentName,
  });

  const { response, data } = await postAiJson('/api/generate-trash-talk', context, {
    ...options,
    timeoutMs: options.timeoutMs ?? DEFAULT_TRASH_TALK_TIMEOUT_MS,
  });

  console.info('[trash-talk/client] API response received', {
    endpoint: '/api/generate-trash-talk',
    ok: response.ok,
    status: response.status,
    hasTrashTalk: typeof data?.trashTalk === 'string' && data.trashTalk.trim().length > 0,
  });
  if (!response.ok) {
    throw new Error(data.error || `Trash-talk generation failed with status ${response.status}`);
  }

  return data;
}

async function requestEndgameRoastFromApi(context: EndgameRoastGenerationContext, options: AiRequestOptions = {}) {
  console.info('[endgame-roast/client] Sending API request', {
    endpoint: '/api/generate-endgame-roast',
    winnerName: context.winnerName,
    loserName: context.loserName,
    winnerTrophies: context.winnerTrophies,
    loserTrophies: context.loserTrophies,
  });

  const { response, data } = await postAiJson('/api/generate-endgame-roast', context, {
    ...options,
    timeoutMs: options.timeoutMs ?? DEFAULT_ENDGAME_ROAST_TIMEOUT_MS,
  });

  console.info('[endgame-roast/client] API response received', {
    endpoint: '/api/generate-endgame-roast',
    ok: response.ok,
    status: response.status,
    hasWinnerCompliment: typeof data?.winnerCompliment === 'string' && data.winnerCompliment.trim().length > 0,
    hasLoserRoast: typeof data?.loserRoast === 'string' && data.loserRoast.trim().length > 0,
  });
  if (!response.ok) {
    throw new Error(data.error || `Endgame roast generation failed with status ${response.status}`);
  }

  return data;
}

export async function generateHeckles(context: HeckleGenerationContext, options: AiRequestOptions = {}): Promise<string[]> {
  if (context.isSolo) {
    return [];
  }

  try {
    const data = await requestHecklesFromApi(context, options);
    const rawHeckles =
      Array.isArray(data.heckles) ? data.heckles : data.heckles ?? data.commentary ?? data.lines ?? data.message ?? data;

    return extractAiDisplayLines(rawHeckles).slice(0, MAX_HECKLES);
  } catch (error) {
    if (isAbortError(error)) {
      return [];
    }
    if (typeof process === 'undefined' || process.env.NODE_ENV !== 'production') {
      console.warn('[heckles] Generation failed:', error);
    }
    return [];
  }
}

export async function generateTrashTalk(
  context: TrashTalkGenerationContext,
  options: AiRequestOptions = {}
): Promise<string | null> {
  if (context.isSolo) {
    return null;
  }

  try {
    const data = await requestTrashTalkFromApi(context, options);
    return extractFirstAiDisplayLine(data.trashTalk ?? data.message ?? data.lines ?? data.commentary ?? data);
  } catch (error) {
    if (isAbortError(error)) {
      return null;
    }
    if (typeof process === 'undefined' || process.env.NODE_ENV !== 'production') {
      console.warn('[trash-talk] Generation failed:', error);
    }
    return null;
  }
}

export async function generateEndgameRoast(
  context: EndgameRoastGenerationContext,
  options: AiRequestOptions = {}
): Promise<EndgameRoastResult | null> {
  if (context.isSolo) {
    return null;
  }

  try {
    const data = await requestEndgameRoastFromApi(context, options);
    const loserRoast = typeof data.loserRoast === 'string' ? data.loserRoast.trim() : '';
    const winnerCompliment = typeof data.winnerCompliment === 'string' ? data.winnerCompliment.trim() : '';

    if (!loserRoast || !winnerCompliment) {
      return null;
    }

    return {
      loserRoast,
      winnerCompliment,
    };
  } catch (error) {
    if (isAbortError(error)) {
      return null;
    }
    if (typeof process === 'undefined' || process.env.NODE_ENV !== 'production') {
      console.warn('[endgame-roast] Generation failed:', error);
    }
    return null;
  }
}
