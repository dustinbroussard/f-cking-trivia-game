import { GoogleGenAI } from '@google/genai';
import { buildHecklePrompt, HeckleGenerationContext, MAX_HECKLES } from '../src/content/heckles';
import { heckleSchema } from '../src/services/gemini';

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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = parseBody(req.body) as Partial<HeckleGenerationContext>;
  if (!body.playerName || !body.opponentName || !body.gameState || !body.recentFailure) {
    res.status(400).json({ error: 'Invalid heckle payload' });
    return;
  }

  if (body.isSolo) {
    res.status(200).json({ heckles: [] });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: 'GEMINI_API_KEY is missing' });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
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

    res.status(200).json({
      heckles: heckles
        .filter((heckle: unknown): heckle is string => typeof heckle === 'string')
        .map((heckle) => heckle.trim())
        .filter((heckle) => heckle.length > 0)
        .slice(0, MAX_HECKLES),
    });
  } catch {
    res.status(500).json({ error: 'Heckle generation failed' });
  }
}
