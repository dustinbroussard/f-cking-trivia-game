import type { EndgameRoastGenerationContext, EndgameRoastResult } from '../../src/content/endgameRoast.js';
import type { HeckleGenerationContext } from '../../src/content/heckles.js';
import { MAX_HECKLES } from '../../src/content/heckles.js';
import type { TrashTalkGenerationContext } from '../../src/content/trashTalk.js';
import { generateGeminiTextResponse } from './gemini.js';

export type CommentaryProvider = 'gemini' | 'openrouter';

export interface ProviderTextResponse {
  text: string | null;
  model: string | null;
  durationMs: number;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

interface GenerationConfig<T> {
  task: 'heckles' | 'trash-talk' | 'endgame-roast';
  prompt: string;
  systemInstruction: string;
  temperature: number;
  maxTokens: number;
  validate: (rawText: string | null) => ValidationResult<T>;
  localFallback: () => T;
}

const OPENROUTER_DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
export const SHORT_FORM_COMMENTARY_TIMEOUT_MS = Number(process.env.AI_SHORT_FORM_TIMEOUT_MS || 10000);

const FORBIDDEN_PHRASES = [
  'okay, here',
  "let's think",
  'here’s my reasoning',
  "here's my reasoning",
  "i'd go with",
  'sure!',
  'certainly!',
  'the answer is',
  'step-by-step',
  'i can help with that',
  'as an ai',
  "i'm unable",
  'i cannot',
];

function now() {
  return Date.now();
}

function normalizeWhitespace(text: string) {
  return text.replace(/\r\n/g, '\n').trim();
}

function createTimeoutError(provider: CommentaryProvider, timeoutMs: number) {
  return new Error(`${provider} timed out after ${timeoutMs}ms`);
}

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(createTimeoutError('openrouter', timeoutMs)), timeoutMs);

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeoutId),
  };
}

function textContainsForbiddenPhrase(text: string) {
  const normalized = text.toLowerCase();
  return FORBIDDEN_PHRASES.find((phrase) => normalized.includes(phrase)) ?? null;
}

function getPlainTextRejectionReason(text: string, maxChars: number) {
  const trimmed = normalizeWhitespace(text);

  if (!trimmed) return 'empty_response';
  if (trimmed.length > maxChars) return 'response_too_long';

  const forbiddenPhrase = textContainsForbiddenPhrase(trimmed);
  if (forbiddenPhrase) return `forbidden_phrase:${forbiddenPhrase}`;
  if (/```/.test(trimmed)) return 'contains_code_fence';
  if (/<\/?[a-z][^>]*>/i.test(trimmed)) return 'contains_markup';
  if (/^\s*[{[]/.test(trimmed)) return 'contains_structured_payload';
  if (/^\s*[-*]\s+/m.test(trimmed) || /^\s*\d+\.\s+/m.test(trimmed)) return 'contains_bullets';
  if (/(^|\n)\s*(analysis|reasoning|thought process|internal reasoning|chain of thought)\s*:/i.test(trimmed)) {
    return 'contains_reasoning_label';
  }
  if (/(^|\n)\s*(heckle|trash talk|winner compliment|loser roast)\s*\d*\s*:/i.test(trimmed)) {
    return 'contains_item_label';
  }

  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1 && new Set(lines).size !== lines.length) return 'duplicate_lines';

  return null;
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeComparisonText(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function areNearDuplicates(a: string, b: string) {
  const left = normalizeComparisonText(a);
  const right = normalizeComparisonText(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftTokens = new Set(left.split(' '));
  const rightTokens = new Set(right.split(' '));
  const intersection = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;

  return union > 0 && intersection / union >= 0.8;
}

function extractOpenRouterText(content: unknown) {
  if (typeof content === 'string') {
    const normalized = normalizeWhitespace(content);
    return normalized || null;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .map((part) => (typeof (part as { text?: unknown })?.text === 'string' ? (part as { text: string }).text : ''))
    .join('\n')
    .trim();

  return text.length > 0 ? text : null;
}

async function generateOpenRouterText(
  prompt: string,
  systemInstruction: string,
  temperature: number,
  maxTokens: number
): Promise<ProviderTextResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

  const startedAt = now();
  const { signal, cancel } = withTimeoutSignal(SHORT_FORM_COMMENTARY_TIMEOUT_MS);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000',
        'X-Title': 'A F-cking Trivia Game',
      },
      body: JSON.stringify({
        model: OPENROUTER_DEFAULT_MODEL,
        messages: [
          {
            role: 'system',
            content: systemInstruction,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    });

    const rawText = await response.text();
    let data: any = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      throw new Error('openrouter_non_json_payload');
    }

    if (!response.ok) {
      throw new Error(data?.error?.message || `openrouter_status_${response.status}`);
    }

    return {
      text: extractOpenRouterText(data?.choices?.[0]?.message?.content),
      model: typeof data?.model === 'string' ? data.model : OPENROUTER_DEFAULT_MODEL,
      durationMs: now() - startedAt,
    };
  } finally {
    cancel();
  }
}

function isAbortTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || /timed out/i.test(error.message));
}

function summarizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function tryProvider<T>(
  provider: CommentaryProvider,
  config: GenerationConfig<T>
): Promise<ValidationResult<T>> {
  const startedAt = now();
  console.info('[commentary/ai] attempt', {
    task: config.task,
    provider,
    model: provider === 'openrouter' ? OPENROUTER_DEFAULT_MODEL : 'gemini-2.5-flash',
    timeoutMs: SHORT_FORM_COMMENTARY_TIMEOUT_MS,
  });

  try {
    const providerResponse =
      provider === 'openrouter'
        ? await generateOpenRouterText(config.prompt, config.systemInstruction, config.temperature, config.maxTokens)
        : await generateGeminiTextResponse(config.prompt, {
            systemInstruction: config.systemInstruction,
            temperature: config.temperature,
            maxOutputTokens: config.maxTokens,
            timeoutMs: SHORT_FORM_COMMENTARY_TIMEOUT_MS,
          });

    if (providerResponse.durationMs > SHORT_FORM_COMMENTARY_TIMEOUT_MS) {
      console.warn('[commentary/ai] rejected', {
        task: config.task,
        provider,
        model: providerResponse.model,
        durationMs: providerResponse.durationMs,
        reason: 'slow_response',
      });
      return { ok: false, reason: 'slow_response' };
    }

    const validation = config.validate(providerResponse.text);
    const validationReason = 'reason' in validation ? validation.reason : null;
    console.info('[commentary/ai] result', {
      task: config.task,
      provider,
      model: providerResponse.model,
      durationMs: providerResponse.durationMs,
      validation: validation.ok ? 'pass' : 'fail',
      reason: validationReason,
    });
    return validation;
  } catch (error) {
    console.warn('[commentary/ai] provider_failed', {
      task: config.task,
      provider,
      model: provider === 'openrouter' ? OPENROUTER_DEFAULT_MODEL : 'gemini-2.5-flash',
      durationMs: now() - startedAt,
      reason: isAbortTimeoutError(error) ? 'timeout' : summarizeError(error),
    });
    return { ok: false, reason: isAbortTimeoutError(error) ? 'timeout' : summarizeError(error) };
  }
}

export async function generateWithFallback<T>(config: GenerationConfig<T>) {
  const providers: CommentaryProvider[] = [];

  if (process.env.OPENROUTER_API_KEY) {
    providers.push('openrouter');
  }
  if (process.env.GEMINI_API_KEY) {
    providers.push('gemini');
  }

  for (const provider of providers) {
    const result = await tryProvider(provider, config);
    if (result.ok) {
      console.info('[commentary/ai] success', {
        task: config.task,
        provider,
        usedGeminiFallback: provider === 'gemini' && providers[0] === 'openrouter',
        usedLocalFallback: false,
      });
      return result.value;
    }
  }

  console.warn('[commentary/ai] local_fallback', {
    task: config.task,
    attemptedProviders: providers,
    usedGeminiFallback: providers.includes('gemini'),
    usedLocalFallback: true,
  });

  return config.localFallback();
}

function stripCodeFence(text: string) {
  return text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}

function findJsonObject(text: string) {
  const cleaned = stripCodeFence(text);
  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  return null;
}

function cleanLine(text: string) {
  return normalizeWhitespace(text).replace(/^["']|["']$/g, '').trim();
}

export function validateHeckles(rawText: string | null): ValidationResult<string[]> {
  if (!rawText) return { ok: false, reason: 'empty_response' };
  if (getPlainTextRejectionReason(rawText, 600)) return { ok: false, reason: getPlainTextRejectionReason(rawText, 600)! };

  const parsed = findJsonObject(rawText);
  if (!parsed || !Array.isArray(parsed.heckles)) {
    return { ok: false, reason: 'invalid_shape' };
  }

  const heckles = parsed.heckles.map((item: unknown) => (typeof item === 'string' ? cleanLine(item) : '')).filter(Boolean);
  if (heckles.length !== MAX_HECKLES) return { ok: false, reason: 'wrong_item_count' };
  if (rawText.trim()[0] !== '{') return { ok: false, reason: 'preamble_before_items' };

  for (const heckle of heckles) {
    const textReason = getPlainTextRejectionReason(heckle, 160);
    if (textReason) return { ok: false, reason: `item_${textReason}` };
    const words = wordCount(heckle);
    if (words < 3 || words > 25) return { ok: false, reason: 'item_word_count_out_of_bounds' };
    if (heckle.length > 160) return { ok: false, reason: 'item_char_limit_exceeded' };
  }

  for (let index = 0; index < heckles.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < heckles.length; compareIndex += 1) {
      if (areNearDuplicates(heckles[index], heckles[compareIndex])) {
        return { ok: false, reason: 'duplicate_or_near_duplicate_items' };
      }
    }
  }

  return { ok: true, value: heckles };
}

export function validateTrashTalk(rawText: string | null): ValidationResult<string> {
  if (!rawText) return { ok: false, reason: 'empty_response' };

  const parsed = findJsonObject(rawText);
  const text = typeof parsed?.trashTalk === 'string' ? cleanLine(parsed.trashTalk) : cleanLine(rawText);
  const textReason = getPlainTextRejectionReason(text, 180);
  if (textReason) return { ok: false, reason: textReason };
  if (text.split('\n').length > 2) return { ok: false, reason: 'too_many_lines' };
  if (wordCount(text) < 4 || wordCount(text) > 32) return { ok: false, reason: 'word_count_out_of_bounds' };

  return { ok: true, value: text };
}

export function validateEndgameRoast(rawText: string | null): ValidationResult<EndgameRoastResult> {
  if (!rawText) return { ok: false, reason: 'empty_response' };

  const parsed = findJsonObject(rawText);
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'invalid_shape' };
  }

  const loserRoast = typeof (parsed as EndgameRoastResult).loserRoast === 'string' ? cleanLine((parsed as EndgameRoastResult).loserRoast) : '';
  const winnerCompliment = typeof (parsed as EndgameRoastResult).winnerCompliment === 'string'
    ? cleanLine((parsed as EndgameRoastResult).winnerCompliment)
    : '';

  if (!loserRoast || !winnerCompliment) {
    return { ok: false, reason: 'missing_required_fields' };
  }

  const loserReason = getPlainTextRejectionReason(loserRoast, 220);
  if (loserReason) return { ok: false, reason: `loserRoast_${loserReason}` };
  const winnerReason = getPlainTextRejectionReason(winnerCompliment, 220);
  if (winnerReason) return { ok: false, reason: `winnerCompliment_${winnerReason}` };

  if (wordCount(loserRoast) > 32 || wordCount(winnerCompliment) > 32) {
    return { ok: false, reason: 'field_word_count_out_of_bounds' };
  }

  return {
    ok: true,
    value: {
      loserRoast,
      winnerCompliment,
    },
  };
}

export function createHeckleFallback(context: Pick<HeckleGenerationContext, 'playerName' | 'opponentName' | 'category'>) {
  const opponent = context.opponentName || 'their opponent';
  const category = context.category || 'trivia';
  return [
    `${context.playerName} just turned ${category} into an argument for adult supervision.`,
    `${opponent} gets the next turn, which feels medically responsible.`,
    `${context.playerName} is still in this match, though the evidence remains mostly theoretical.`,
  ];
}

export function createTrashTalkFallback(
  context: Pick<TrashTalkGenerationContext, 'playerName' | 'opponentName' | 'event'>
) {
  if (context.event === 'MATCH_LOSS') {
    return `${context.playerName}, the match is over and ${context.opponentName} filed the final paperwork.`;
  }

  return `${context.playerName}, ${context.opponentName} is playing trivia while you're rehearsing disappointment.`;
}

export function createEndgameFallback(
  context: Pick<EndgameRoastGenerationContext, 'winnerName' | 'loserName'>
): EndgameRoastResult {
  return {
    loserRoast: `${context.loserName}, that was less a finish and more a supervised collapse.`,
    winnerCompliment: `${context.winnerName}, competence forced my hand, so accept this reluctant applause.`,
  };
}
