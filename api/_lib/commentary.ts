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

interface ValidationMeta {
  parser: string;
  parsed: boolean;
  rawLength: number;
  normalizedLength?: number;
  itemCount?: number;
}

export type ValidationResult<T> =
  | { ok: true; value: T; meta: ValidationMeta }
  | { ok: false; reason: string; meta: ValidationMeta };

interface GenerationConfig<T> {
  task: 'heckles' | 'trash-talk' | 'endgame-roast';
  prompt: string;
  systemInstruction: string;
  temperature: number;
  maxTokens: number;
  validate: (rawText: string | null) => ValidationResult<T>;
  localFallback: () => T;
  fallbackMode: 'empty' | 'safe';
}

const OPENROUTER_DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
export const SHORT_FORM_COMMENTARY_TIMEOUT_MS = Number(process.env.AI_SHORT_FORM_TIMEOUT_MS || 10000);
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

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

function getProviderModel(provider: CommentaryProvider) {
  return provider === 'openrouter' ? OPENROUTER_DEFAULT_MODEL : GEMINI_DEFAULT_MODEL;
}

function getProviderOrder() {
  const configuredOrder = (process.env.AI_PROVIDER_ORDER || 'gemini,openrouter')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is CommentaryProvider => value === 'gemini' || value === 'openrouter');

  const requested = configuredOrder.length > 0 ? configuredOrder : ['gemini', 'openrouter'];
  const available = new Set<CommentaryProvider>();

  if (process.env.GEMINI_API_KEY) {
    available.add('gemini');
  }
  if (process.env.OPENROUTER_API_KEY) {
    available.add('openrouter');
  }

  return requested.filter((provider, index) => available.has(provider) && requested.indexOf(provider) === index);
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

function buildMeta(
  rawText: string | null,
  parser: string,
  options: Partial<Pick<ValidationMeta, 'parsed' | 'normalizedLength' | 'itemCount'>> = {}
): ValidationMeta {
  return {
    parser,
    parsed: options.parsed ?? false,
    rawLength: rawText?.length ?? 0,
    normalizedLength: options.normalizedLength,
    itemCount: options.itemCount,
  };
}

function stripCodeFence(text: string) {
  return text.trim().replace(/^```(?:json|text)?/i, '').replace(/```$/i, '').trim();
}

function stripHarmlessLeadIn(text: string) {
  let next = text.trim();

  const leadIns = [
    /^(?:sure|certainly|absolutely|okay|ok)[,!:\-\s]+/i,
    /^(?:here(?:'|’)s(?:\s+(?:one|your|a|the|some|three))?|returning)[!:\-\s]+/i,
    /^(?:trash\s*talk|heckles?|commentary|line|lines)[!:\-\s]+/i,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of leadIns) {
      if (pattern.test(next)) {
        next = next.replace(pattern, '').trim();
        changed = true;
      }
    }
  }

  return next;
}

function stripLinePrefix(text: string) {
  return text
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^(?:heckle|trash\s*talk|line)\s*\d*\s*:\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function getPlainTextRejectionReason(text: string, maxChars: number) {
  const trimmed = stripHarmlessLeadIn(normalizeWhitespace(text));

  if (!trimmed) return 'empty_response';
  if (trimmed.length > maxChars) return 'response_too_long';

  const forbiddenPhrase = textContainsForbiddenPhrase(trimmed.slice(0, 80));
  if (forbiddenPhrase && /^(okay|let's think|here(?:'|’)s my reasoning|here's my reasoning|i'd go with|sure|certainly|the answer is|step-by-step|i can help with that|as an ai|i'm unable|i cannot)/i.test(trimmed)) {
    return `forbidden_phrase:${forbiddenPhrase}`;
  }
  if (/```/.test(trimmed)) return 'contains_code_fence';
  if (/<\/?[a-z][^>]*>/i.test(trimmed)) return 'contains_markup';
  if (/(^|\n)\s*(analysis|reasoning|thought process|internal reasoning|chain of thought)\s*:/i.test(trimmed)) {
    return 'contains_reasoning_label';
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
    model: getProviderModel(provider),
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
        rawResponsePresent: typeof providerResponse.text === 'string' && providerResponse.text.trim().length > 0,
        rawResponseLength: providerResponse.text?.length ?? 0,
        reason: 'slow_response',
      });
      return { ok: false, reason: 'slow_response', meta: buildMeta(providerResponse.text, 'none') };
    }

    const validation = config.validate(providerResponse.text);
    const validationReason = 'reason' in validation ? validation.reason : null;
    console.info('[commentary/ai] result', {
      task: config.task,
      provider,
      model: providerResponse.model,
      durationMs: providerResponse.durationMs,
      rawResponsePresent: typeof providerResponse.text === 'string' && providerResponse.text.trim().length > 0,
      rawResponseLength: providerResponse.text?.length ?? 0,
      parsingSucceeded: validation.meta.parsed,
      parser: validation.meta.parser,
      normalizedLength: validation.meta.normalizedLength ?? null,
      itemCount: validation.meta.itemCount ?? null,
      validation: validation.ok ? 'pass' : 'fail',
      rejectionReason: validationReason,
    });
    return validation;
  } catch (error) {
    console.warn('[commentary/ai] provider_failed', {
      task: config.task,
      provider,
      model: getProviderModel(provider),
      durationMs: now() - startedAt,
      reason: isAbortTimeoutError(error) ? 'timeout' : summarizeError(error),
    });
    return {
      ok: false,
      reason: isAbortTimeoutError(error) ? 'timeout' : summarizeError(error),
      meta: buildMeta(null, 'none'),
    };
  }
}

export async function generateWithFallback<T>(config: GenerationConfig<T>) {
  const providers = getProviderOrder();

  const attemptReasons: Array<{ provider: CommentaryProvider; reason: string }> = [];
  for (const [index, provider] of providers.entries()) {
    const result = await tryProvider(provider, config);
    if (result.ok) {
      console.info('[commentary/ai] success', {
        task: config.task,
        provider,
        model: getProviderModel(provider),
        usedFallbackProvider: index > 0,
        fallbackProvider: index > 0 ? provider : null,
        usedLocalFallback: false,
        finalResultEmptyByDesign: false,
      });
      return result.value;
    }

    if (!result.ok) {
      const failureReason = (result as { ok: false; reason: string }).reason;
      attemptReasons.push({
        provider,
        reason: failureReason,
      });
    }
  }

  console.warn('[commentary/ai] local_fallback', {
    task: config.task,
    attemptedProviders: providers,
    attemptReasons,
    usedLocalFallback: config.fallbackMode === 'safe',
    finalResultEmptyByDesign: config.fallbackMode === 'empty',
  });

  return config.localFallback();
}

function findJsonValue(text: string) {
  const cleaned = stripCodeFence(stripHarmlessLeadIn(text));
  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(cleaned.slice(firstBracket, lastBracket + 1));
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
  return stripLinePrefix(stripHarmlessLeadIn(normalizeWhitespace(text)));
}

function extractStringArrayCandidate(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? cleanLine(item) : '')).filter(Boolean);
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const candidates = [
    record.heckles,
    record.lines,
    record.commentary,
    record.messages,
    record.message,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map((item) => (typeof item === 'string' ? cleanLine(item) : '')).filter(Boolean);
    }
  }

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      return splitTextIntoCandidateLines(candidate);
    }
  }

  return [];
}

function splitTextIntoCandidateLines(text: string) {
  const normalized = stripCodeFence(stripHarmlessLeadIn(text));
  const lines = normalized
    .split('\n')
    .map((line) => cleanLine(line))
    .filter(Boolean);

  if (lines.length > 1) {
    return lines;
  }

  return normalized
    .split(/\s*(?:\n|(?<=["'!?])\s{2,}|(?<=["'])\s*,\s*)\s*/g)
    .map((line) => cleanLine(line))
    .filter(Boolean);
}

export function validateHeckles(rawText: string | null): ValidationResult<string[]> {
  if (!rawText) return { ok: false, reason: 'empty_response', meta: buildMeta(rawText, 'none') };

  const parsed = findJsonValue(rawText);
  const parser = parsed ? 'json' : 'plain_text';
  const heckles = parsed ? extractStringArrayCandidate(parsed) : splitTextIntoCandidateLines(rawText);
  const meta = buildMeta(rawText, parser, {
    parsed: !!parsed,
    normalizedLength: normalizeWhitespace(rawText).length,
    itemCount: heckles.length,
  });

  if (!heckles.length) {
    return { ok: false, reason: parsed ? 'parsed_but_no_items' : 'invalid_shape', meta };
  }

  for (const heckle of heckles) {
    const textReason = getPlainTextRejectionReason(heckle, 160);
    if (textReason) return { ok: false, reason: `item_${textReason}`, meta };
    const words = wordCount(heckle);
    if (words < 2 || words > 25) return { ok: false, reason: 'item_word_count_out_of_bounds', meta };
    if (heckle.length > 160) return { ok: false, reason: 'item_char_limit_exceeded', meta };
  }

  const trimmedHeckles = heckles.slice(0, MAX_HECKLES);
  for (let index = 0; index < trimmedHeckles.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < trimmedHeckles.length; compareIndex += 1) {
      if (areNearDuplicates(trimmedHeckles[index], trimmedHeckles[compareIndex])) {
        return { ok: false, reason: 'duplicate_or_near_duplicate_items', meta };
      }
    }
  }

  return {
    ok: true,
    value: trimmedHeckles,
    meta: {
      ...meta,
      itemCount: trimmedHeckles.length,
    },
  };
}

export function validateTrashTalk(rawText: string | null): ValidationResult<string> {
  if (!rawText) return { ok: false, reason: 'empty_response', meta: buildMeta(rawText, 'none') };

  const parsed = findJsonValue(rawText);
  const parser = parsed ? 'json' : 'plain_text';
  const text =
    typeof (parsed as Record<string, unknown> | null)?.trashTalk === 'string'
      ? cleanLine((parsed as Record<string, string>).trashTalk)
      : typeof (parsed as Record<string, unknown> | null)?.message === 'string'
        ? cleanLine((parsed as Record<string, string>).message)
        : cleanLine(rawText);
  const meta = buildMeta(rawText, parser, {
    parsed: !!parsed,
    normalizedLength: text.length,
    itemCount: text ? 1 : 0,
  });
  const textReason = getPlainTextRejectionReason(text, 180);
  if (textReason) return { ok: false, reason: textReason, meta };
  if (text.split('\n').length > 2) return { ok: false, reason: 'too_many_lines', meta };
  if (wordCount(text) < 3 || wordCount(text) > 32) return { ok: false, reason: 'word_count_out_of_bounds', meta };

  return { ok: true, value: text, meta };
}

export function validateEndgameRoast(rawText: string | null): ValidationResult<EndgameRoastResult> {
  if (!rawText) return { ok: false, reason: 'empty_response', meta: buildMeta(rawText, 'none') };

  const parsed = findJsonValue(rawText);
  const meta = buildMeta(rawText, parsed ? 'json' : 'none', {
    parsed: !!parsed,
    normalizedLength: normalizeWhitespace(rawText).length,
    itemCount: parsed ? 2 : 0,
  });
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'invalid_shape', meta };
  }

  const loserRoast = typeof (parsed as EndgameRoastResult).loserRoast === 'string' ? cleanLine((parsed as EndgameRoastResult).loserRoast) : '';
  const winnerCompliment = typeof (parsed as EndgameRoastResult).winnerCompliment === 'string'
    ? cleanLine((parsed as EndgameRoastResult).winnerCompliment)
    : '';

  if (!loserRoast || !winnerCompliment) {
    return { ok: false, reason: 'missing_required_fields', meta };
  }

  const loserReason = getPlainTextRejectionReason(loserRoast, 220);
  if (loserReason) return { ok: false, reason: `loserRoast_${loserReason}`, meta };
  const winnerReason = getPlainTextRejectionReason(winnerCompliment, 220);
  if (winnerReason) return { ok: false, reason: `winnerCompliment_${winnerReason}`, meta };

  if (wordCount(loserRoast) > 32 || wordCount(winnerCompliment) > 32) {
    return { ok: false, reason: 'field_word_count_out_of_bounds', meta };
  }

  return {
    ok: true,
    value: {
      loserRoast,
      winnerCompliment,
    },
    meta,
  };
}

export function createEndgameFallback(
  context: Pick<EndgameRoastGenerationContext, 'winnerName' | 'loserName'>
): EndgameRoastResult {
  return {
    loserRoast: `${context.loserName}, that was less a finish and more a supervised collapse.`,
    winnerCompliment: `${context.winnerName}, competence forced my hand, so accept this reluctant applause.`,
  };
}
