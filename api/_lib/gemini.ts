interface GeminiTextOptions {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

interface GeminiTextResponse {
  text: string | null;
  model: string;
  durationMs: number;
}

const GEMINI_MODEL = 'gemini-2.5-flash';

function now() {
  return Date.now();
}

async function withPromiseTimeout<T>(promise: Promise<T>, timeoutMs?: number) {
  if (!timeoutMs) {
    return promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`gemini timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function withTimeoutSignal(timeoutMs?: number) {
  if (!timeoutMs) {
    return {
      signal: undefined,
      cancel: () => {},
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`gemini timed out after ${timeoutMs}ms`)), timeoutMs);

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeoutId),
  };
}

export async function generateGeminiTextResponse(prompt: string, options: GeminiTextOptions = {}): Promise<GeminiTextResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing');
  }

  const {
    systemInstruction,
    temperature = 0.9,
    maxOutputTokens = 180,
    timeoutMs,
  } = options;
  const startedAt = now();

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const response = await withPromiseTimeout(ai.models.generateContent({
      model: GEMINI_MODEL,
      config: systemInstruction
        ? {
            systemInstruction,
            temperature,
            maxOutputTokens,
          }
        : {
            temperature,
            maxOutputTokens,
          },
      contents: prompt,
    }), timeoutMs);

    if (typeof response.text === 'string') {
      return {
        text: response.text,
        model: GEMINI_MODEL,
        durationMs: now() - startedAt,
      };
    }
  } catch (error) {
    console.error('[gemini/api] SDK request failed, falling back to REST', {
      error,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const { signal, cancel } = withTimeoutSignal(timeoutMs);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          system_instruction: systemInstruction
            ? {
                parts: [{ text: systemInstruction }],
              }
            : undefined,
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature,
            maxOutputTokens,
          },
        }),
      }
    );

    const rawText = await response.text();
    let data: any = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (error) {
      console.error('[gemini/api] REST fallback returned non-JSON payload', {
        error,
        rawText,
      });
    }

    if (!response.ok) {
      throw new Error(
        `Gemini REST request failed with status ${response.status}: ${
          data?.error?.message || rawText || 'Unknown error'
        }`
      );
    }

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string } | null | undefined) => (typeof part?.text === 'string' ? part.text : ''))
        .join('\n')
        .trim() || '';

    return {
      text,
      model: GEMINI_MODEL,
      durationMs: now() - startedAt,
    };
  } finally {
    cancel();
  }
}

export async function generateGeminiText(prompt: string, systemInstruction?: string) {
  const response = await generateGeminiTextResponse(prompt, { systemInstruction });
  return response.text ?? '';
}
