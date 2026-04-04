import type { EndgameRoastGenerationContext, EndgameRoastResult } from '../content/endgameRoast.js';
import type { HeckleGenerationContext } from '../content/heckles.js';
import { MAX_HECKLES } from '../content/heckles.js';
import type { TrashTalkGenerationContext } from '../content/trashTalk.js';
import { extractAiDisplayLines, extractAiDisplayText } from './aiText.js';

interface AiRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface AiJsonResponse<T> {
  response: Response;
  data: T;
  rawBody: string;
}

interface CommentaryDebugPayload {
  finalReason?: string;
}

interface HeckleApiPayload {
  source?: 'gemini' | 'openrouter';
  heckle?: string | null;
  heckles?: string[];
  commentary?: unknown;
  lines?: unknown;
  message?: unknown;
  error?: string;
  debug?: CommentaryDebugPayload;
}

interface TrashTalkApiPayload {
  source?: 'gemini' | 'openrouter';
  trashTalk?: string | null;
  commentary?: unknown;
  lines?: unknown;
  message?: unknown;
  error?: string;
  debug?: CommentaryDebugPayload;
}

const DEFAULT_HECKLE_TIMEOUT_MS = 6500;
const DEFAULT_TRASH_TALK_TIMEOUT_MS = 5000;
const DEFAULT_ENDGAME_ROAST_TIMEOUT_MS = 7000;
const AI_REQUEST_RETRY_DELAY_MS = 450;
const MAX_SHORT_FORM_RETRIES = 1;

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

async function postAiJson<TResponse, TRequest>(endpoint: string, context: TRequest, options: AiRequestOptions) {
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

    const rawBody = await response.text();
    const data = rawBody ? JSON.parse(rawBody) : {};
    return { response, data, rawBody } as AiJsonResponse<TResponse>;
  } finally {
    cleanup();
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('request aborted'));
      return;
    }

    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener('abort', abortListener);
      resolve();
    }, ms);

    const abortListener = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortListener);
      reject(signal.reason ?? new Error('request aborted'));
    };

    signal?.addEventListener('abort', abortListener, { once: true });
  });
}

async function withTransientRetry<T>(
  label: string,
  operation: () => Promise<T>,
  options: AiRequestOptions,
  maxRetries = MAX_SHORT_FORM_RETRIES
) {
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (isAbortError(error) || attempt >= maxRetries) {
        throw error;
      }

      attempt += 1;
      console.warn(`[${label}] transient failure; retrying`, {
        attempt,
        maxRetries,
        error,
      });
      await sleep(AI_REQUEST_RETRY_DELAY_MS * attempt, options.signal);
    }
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

  const { response, data, rawBody } = await postAiJson<HeckleApiPayload, HeckleGenerationContext>('/api/generate-heckles', context, {
    ...options,
    timeoutMs: options.timeoutMs ?? DEFAULT_HECKLE_TIMEOUT_MS,
  });
  const rawHeckles =
    Array.isArray(data?.heckles) ? data.heckles : data?.heckles ?? data?.commentary ?? data?.lines ?? data?.message ?? data;
  const normalizedHeckles = extractAiDisplayLines(rawHeckles).slice(0, MAX_HECKLES);

  console.info('[heckles/client] API response received', {
    endpoint: '/api/generate-heckles',
    ok: response.ok,
    status: response.status,
    rawResponseBody: rawBody,
    parsedResponse: data,
    hasHeckles: Array.isArray(data?.heckles) ? data.heckles.length : null,
    normalizedHeckles,
    renderabilityCheck: {
      hasRenderableHeckles: normalizedHeckles.length > 0,
      normalizedCount: normalizedHeckles.length,
    },
  });
  if (!response.ok) {
    throw new Error(data.error || `Heckle generation failed with status ${response.status}`);
  }

  if (!normalizedHeckles.length) {
    throw new Error(data?.error || data?.debug?.finalReason || 'empty_renderable_heckle_payload');
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

  const { response, data, rawBody } = await postAiJson<TrashTalkApiPayload, TrashTalkGenerationContext>('/api/generate-trash-talk', context, {
    ...options,
    timeoutMs: options.timeoutMs ?? DEFAULT_TRASH_TALK_TIMEOUT_MS,
  });
  const normalizedTrashTalk = extractAiDisplayText(
    data?.trashTalk ?? data?.message ?? data?.lines ?? data?.commentary ?? data
  );

  console.info('[trash-talk/client] API response received', {
    endpoint: '/api/generate-trash-talk',
    ok: response.ok,
    status: response.status,
    rawResponseBody: rawBody,
    parsedResponse: data,
    hasTrashTalk: typeof data?.trashTalk === 'string' && data.trashTalk.trim().length > 0,
    normalizedTrashTalk,
    renderabilityCheck: {
      hasRenderableMessage: typeof normalizedTrashTalk === 'string' && normalizedTrashTalk.trim().length > 0,
    },
  });
  if (!response.ok) {
    throw new Error(data.error || `Trash-talk generation failed with status ${response.status}`);
  }

  if (!normalizedTrashTalk) {
    throw new Error(data?.error || data?.debug?.finalReason || 'empty_renderable_trash_talk_payload');
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

  const { response, data } = await postAiJson<any, EndgameRoastGenerationContext>('/api/generate-endgame-roast', context, {
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
    const data = await withTransientRetry('heckles/client', () => requestHecklesFromApi(context, options), options);
    const rawHeckles =
      Array.isArray(data.heckles) ? data.heckles : data.heckles ?? data.commentary ?? data.lines ?? data.message ?? data;
    const normalizedHeckles = extractAiDisplayLines(rawHeckles).slice(0, MAX_HECKLES);
    console.info('[heckles/client] Normalized response', {
      normalizedHeckles,
      renderabilityCheck: {
        hasRenderableHeckles: normalizedHeckles.length > 0,
        normalizedCount: normalizedHeckles.length,
      },
    });
    return normalizedHeckles;
  } catch (error) {
    if (isAbortError(error)) {
      return [];
    }
    console.warn('[heckles/client] Treating response as provider failure; no commentary will render', {
      error,
    });
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
    const data = await withTransientRetry('trash-talk/client', () => requestTrashTalkFromApi(context, options), options);
    const normalizedTrashTalk = extractAiDisplayText(
      data.trashTalk ?? data.message ?? data.lines ?? data.commentary ?? data
    );
    console.info('[trash-talk/client] Normalized response', {
      normalizedTrashTalk,
      renderabilityCheck: {
        hasRenderableMessage: typeof normalizedTrashTalk === 'string' && normalizedTrashTalk.trim().length > 0,
      },
    });
    return normalizedTrashTalk;
  } catch (error) {
    if (isAbortError(error)) {
      return null;
    }
    console.warn('[trash-talk/client] Treating response as provider failure; no trash talk will render', {
      error,
    });
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
