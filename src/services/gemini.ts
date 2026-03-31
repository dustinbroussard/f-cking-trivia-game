import { Type } from '@google/genai';
import type { EndgameRoastGenerationContext, EndgameRoastResult } from '../content/endgameRoast.js';
import type { HeckleGenerationContext } from '../content/heckles.js';
import { MAX_HECKLES } from '../content/heckles.js';
import type { TrashTalkGenerationContext } from '../content/trashTalk.js';

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

async function requestHecklesFromApi(context: HeckleGenerationContext) {
  const response = await fetch('/api/generate-heckles', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(context),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Heckle generation failed with status ${response.status}`);
  }

  return data;
}

async function requestTrashTalkFromApi(context: TrashTalkGenerationContext) {
  const response = await fetch('/api/generate-trash-talk', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(context),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Trash-talk generation failed with status ${response.status}`);
  }

  return data;
}

async function requestEndgameRoastFromApi(context: EndgameRoastGenerationContext) {
  const response = await fetch('/api/generate-endgame-roast', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(context),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Endgame roast generation failed with status ${response.status}`);
  }

  return data;
}

export async function generateHeckles(context: HeckleGenerationContext): Promise<string[]> {
  if (context.isSolo) {
    return [];
  }

  try {
    const data = await requestHecklesFromApi(context);
    const rawHeckles = Array.isArray(data.heckles) ? data.heckles : [];

    return rawHeckles
      .filter((heckle: unknown): heckle is string => typeof heckle === 'string')
      .map((heckle) => heckle.trim())
      .filter((heckle) => heckle.length > 0)
      .slice(0, MAX_HECKLES);
  } catch (error) {
    if (typeof process === 'undefined' || process.env.NODE_ENV !== 'production') {
      console.warn('[heckles] Generation failed:', error);
    }
    return [];
  }
}

export async function generateTrashTalk(context: TrashTalkGenerationContext): Promise<string | null> {
  if (context.isSolo) {
    return null;
  }

  try {
    const data = await requestTrashTalkFromApi(context);
    const rawTrashTalk = typeof data.trashTalk === 'string' ? data.trashTalk : null;
    const normalized = rawTrashTalk?.trim() || '';
    return normalized.length > 0 ? normalized : null;
  } catch (error) {
    if (typeof process === 'undefined' || process.env.NODE_ENV !== 'production') {
      console.warn('[trash-talk] Generation failed:', error);
    }
    return null;
  }
}

export async function generateEndgameRoast(context: EndgameRoastGenerationContext): Promise<EndgameRoastResult | null> {
  if (context.isSolo) {
    return null;
  }

  try {
    const data = await requestEndgameRoastFromApi(context);
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
    if (typeof process === 'undefined' || process.env.NODE_ENV !== 'production') {
      console.warn('[endgame-roast] Generation failed:', error);
    }
    return null;
  }
}
