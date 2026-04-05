import type { EndgameRoastGenerationContext, EndgameRoastResult } from '../../src/content/endgameRoast.js';
import type { HeckleGenerationContext } from '../../src/content/heckles.js';
import { MAX_HECKLES } from '../../src/content/heckles.js';
import type { TrashTalkGenerationContext } from '../../src/content/trashTalk.js';
import { extractAiDisplayLines, extractAiDisplayText } from '../../src/services/aiText.js';
import { generateGeminiTextResponse } from './gemini.js';

export type CommentaryProvider = 'gemini' | 'openrouter';
export type ProviderFailureType =
  | 'timeout'
  | 'non_200'
  | 'network_error'
  | 'parse_failure'
  | 'empty_response'
  | 'validator_rejected'
  | 'aborted_request'
  | 'unknown_error';

export interface ProviderTextResponse {
  text: string | null;
  model: string | null;
  durationMs: number;
  status: number | null;
  rawBody: string | null;
  requestSummary: Record<string, unknown>;
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

export interface ProviderAttemptDiagnostic {
  provider: CommentaryProvider;
  model: string | null;
  attempted: boolean;
  durationMs: number;
  status: number | null;
  requestSummary: Record<string, unknown> | null;
  rawBody: string | null;
  rawText: string | null;
  rawPreview: string | null;
  normalizedResponse: unknown;
  parser: string;
  parsed: boolean;
  normalizedLength: number | null;
  itemCount: number | null;
  validationOk: boolean;
  failureType: ProviderFailureType | null;
  validationReason: string | null;
  error: string | null;
}

export interface CommentaryGenerationDebug {
  geminiAttempted: boolean;
  geminiProducedRenderableText: boolean;
  openrouterAttempted: boolean;
  openrouterProducedRenderableText: boolean;
  fallbackAttempted: boolean;
  geminiFailedReason: string | null;
  openrouterFailedReason: string | null;
  finalReason: string;
  totalDurationMs: number;
  providerDiagnostics: ProviderAttemptDiagnostic[];
}

export type CommentaryGenerationResult<T> =
  | {
    ok: true;
    source: CommentaryProvider | 'local_fallback';
    value: T;
    debug: CommentaryGenerationDebug;
  }
  | {
    ok: false;
    error: string;
    debug: CommentaryGenerationDebug;
  };

export interface ProviderProbeResult<T> {
  ok: boolean;
  provider: CommentaryProvider;
  model: string | null;
  status: number | null;
  rawResponse: string | null;
  parsedText: string | null;
  validation: ValidationResult<T>;
  elapsedMs: number;
  failureType: ProviderFailureType | null;
  message: string | null;
  requestSummary: Record<string, unknown> | null;
}

class ProviderRequestError extends Error {
  provider: CommentaryProvider;
  failureType: ProviderFailureType;
  status: number | null;
  rawBody: string | null;
  requestSummary: Record<string, unknown> | null;

  constructor(options: {
    provider: CommentaryProvider;
    message: string;
    failureType: ProviderFailureType;
    status?: number | null;
    rawBody?: string | null;
    requestSummary?: Record<string, unknown> | null;
  }) {
    super(options.message);
    this.name = 'ProviderRequestError';
    this.provider = options.provider;
    this.failureType = options.failureType;
    this.status = options.status ?? null;
    this.rawBody = options.rawBody ?? null;
    this.requestSummary = options.requestSummary ?? null;
  }
}

function getProviderErrorDetails(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'failureType' in error &&
    'status' in error &&
    'rawBody' in error &&
    'requestSummary' in error
  ) {
    return error as {
      failureType: ProviderFailureType;
      status: number | null;
      rawBody: string | null;
      requestSummary: Record<string, unknown> | null;
    };
  }

  return null;
}

type ProviderGenerator = (
  prompt: string,
  systemInstruction: string,
  temperature: number,
  maxTokens: number
) => Promise<ProviderTextResponse>;

const OPENROUTER_DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct';
export const SHORT_FORM_COMMENTARY_TIMEOUT_MS = Number(process.env.AI_SHORT_FORM_TIMEOUT_MS || 5500);
const GEMINI_DEFAULT_MODEL = 'gemini-1.5-flash';
const providerTestOverrides: Partial<Record<CommentaryProvider, ProviderGenerator>> = {};

const FORBIDDEN_PHRASES = [
  "let's think",
  'here’s my reasoning',
  "here's my reasoning",
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

export function createProviderRequestError(options: {
  provider: CommentaryProvider;
  message: string;
  failureType: ProviderFailureType;
  status?: number | null;
  rawBody?: string | null;
  requestSummary?: Record<string, unknown> | null;
}) {
  return new ProviderRequestError(options);
}

function getProviderGenerator(provider: CommentaryProvider): ProviderGenerator {
  if (providerTestOverrides[provider]) {
    return providerTestOverrides[provider] as ProviderGenerator;
  }

  return provider === 'openrouter'
    ? generateOpenRouterText
    : (prompt, systemInstruction, temperature, maxTokens) =>
      generateGeminiTextResponse(prompt, {
        systemInstruction,
        temperature,
        maxOutputTokens: maxTokens,
        timeoutMs: SHORT_FORM_COMMENTARY_TIMEOUT_MS,
      });
}

export function setCommentaryProviderOverride(provider: CommentaryProvider, generator: ProviderGenerator | null) {
  if (!generator) {
    delete providerTestOverrides[provider];
    return;
  }

  providerTestOverrides[provider] = generator;
}

export function resetCommentaryProviderOverrides() {
  delete providerTestOverrides.gemini;
  delete providerTestOverrides.openrouter;
}

function getProviderOrder(): CommentaryProvider[] {
  const configuredOrder = (process.env.AI_PROVIDER_ORDER || 'gemini,openrouter')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is CommentaryProvider => value === 'gemini' || value === 'openrouter');

  const requested: CommentaryProvider[] = configuredOrder.length > 0 ? configuredOrder : ['gemini', 'openrouter'];
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
  if (forbiddenPhrase && /^(let's think|here(?:'|’)s my reasoning|here's my reasoning|as an ai|i'm unable|i cannot)/i.test(trimmed)) {
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
  const requestSummary = {
    model: OPENROUTER_DEFAULT_MODEL,
    temperature,
    maxTokens,
    promptLength: prompt.length,
    promptPreview: summarizeRawText(prompt, 200),
    systemInstructionLength: systemInstruction.length,
  };

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
      throw createProviderRequestError({
        provider: 'openrouter',
        message: 'openrouter_non_json_payload',
        failureType: 'parse_failure',
        status: response.status,
        rawBody: rawText,
        requestSummary,
      });
    }

    if (!response.ok) {
      throw createProviderRequestError({
        provider: 'openrouter',
        message: data?.error?.message || `openrouter_status_${response.status}`,
        failureType: 'non_200',
        status: response.status,
        rawBody: rawText,
        requestSummary,
      });
    }

    return {
      text: extractOpenRouterText(data?.choices?.[0]?.message?.content),
      model: typeof data?.model === 'string' ? data.model : OPENROUTER_DEFAULT_MODEL,
      durationMs: now() - startedAt,
      status: response.status,
      rawBody: rawText,
      requestSummary,
    };
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      throw error;
    }

    throw createProviderRequestError({
      provider: 'openrouter',
      message: summarizeError(error),
      failureType: getFailureType(error),
      requestSummary,
    });
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

function getFailureType(error: unknown): ProviderFailureType {
  const providerError = getProviderErrorDetails(error);
  if (providerError) {
    return providerError.failureType;
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return /timed out/i.test(error.message) ? 'timeout' : 'aborted_request';
    }
    if (/timed out/i.test(error.message)) {
      return 'timeout';
    }
    if (/fetch failed/i.test(error.message) || error.name === 'TypeError') {
      return 'network_error';
    }
  }

  return 'unknown_error';
}

function summarizeRawText(rawText: string | null, limit = 280) {
  if (typeof rawText !== 'string') {
    return null;
  }

  const normalized = normalizeWhitespace(rawText);
  if (!normalized) {
    return '';
  }

  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function summarizeNormalizedResponse(task: GenerationConfig<unknown>['task'], rawText: string | null) {
  if (!rawText) {
    return null;
  }

  if (task === 'heckles') {
    return extractAiDisplayLines(rawText).slice(0, MAX_HECKLES);
  }

  if (task === 'trash-talk') {
    return extractAiDisplayText(rawText);
  }

  return summarizeRawText(rawText);
}

async function tryProvider<T>(
  provider: CommentaryProvider,
  config: GenerationConfig<T>
): Promise<{ validation: ValidationResult<T>; diagnostic: ProviderAttemptDiagnostic }> {
  const startedAt = now();
  const requestSummary = {
    model: getProviderModel(provider),
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    promptLength: config.prompt.length,
    promptPreview: summarizeRawText(config.prompt, 200),
    systemInstructionLength: config.systemInstruction.length,
    timeoutMs: SHORT_FORM_COMMENTARY_TIMEOUT_MS,
  };
  console.info('[commentary/ai] attempt', {
    task: config.task,
    provider,
    requestSummary,
  });

  try {
    const providerResponse = await getProviderGenerator(provider)(
      config.prompt,
      config.systemInstruction,
      config.temperature,
      config.maxTokens
    );

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
      const validation = { ok: false, reason: 'slow_response', meta: buildMeta(providerResponse.text, 'none') } as ValidationResult<T>;
      return {
        validation,
        diagnostic: {
          provider,
          model: providerResponse.model,
          attempted: true,
          durationMs: providerResponse.durationMs,
          status: providerResponse.status,
          requestSummary: providerResponse.requestSummary,
          rawBody: providerResponse.rawBody,
          rawText: providerResponse.text,
          rawPreview: summarizeRawText(providerResponse.text),
          normalizedResponse: summarizeNormalizedResponse(config.task, providerResponse.text),
          parser: validation.meta.parser,
          parsed: validation.meta.parsed,
          normalizedLength: validation.meta.normalizedLength ?? null,
          itemCount: validation.meta.itemCount ?? null,
          validationOk: false,
          failureType: 'timeout',
          validationReason: 'slow_response',
          error: null,
        },
      };
    }

    const validation = config.validate(providerResponse.text);
    const validationReason = 'reason' in validation ? validation.reason : null;
    console.info('[commentary/ai] result', {
      task: config.task,
      provider,
      model: providerResponse.model,
      durationMs: providerResponse.durationMs,
      responseStatus: providerResponse.status,
      requestSummary: providerResponse.requestSummary,
      rawResponseBody: providerResponse.rawBody,
      rawResponsePresent: typeof providerResponse.text === 'string' && providerResponse.text.trim().length > 0,
      rawResponseLength: providerResponse.text?.length ?? 0,
      parsedText: providerResponse.text,
      rawResponsePreview: summarizeRawText(providerResponse.text),
      normalizedResponse: summarizeNormalizedResponse(config.task, providerResponse.text),
      parsingSucceeded: validation.meta.parsed,
      parser: validation.meta.parser,
      normalizedLength: validation.meta.normalizedLength ?? null,
      itemCount: validation.meta.itemCount ?? null,
      validation: validation.ok ? 'pass' : 'fail',
      rejectionReason: validationReason,
    });
    return {
      validation,
      diagnostic: {
        provider,
        model: providerResponse.model,
        attempted: true,
        durationMs: providerResponse.durationMs,
        status: providerResponse.status,
        requestSummary: providerResponse.requestSummary,
        rawBody: providerResponse.rawBody,
        rawText: providerResponse.text,
        rawPreview: summarizeRawText(providerResponse.text),
        normalizedResponse: summarizeNormalizedResponse(config.task, providerResponse.text),
        parser: validation.meta.parser,
        parsed: validation.meta.parsed,
        normalizedLength: validation.meta.normalizedLength ?? null,
        itemCount: validation.meta.itemCount ?? null,
        validationOk: validation.ok,
        failureType: validation.ok ? null : providerResponse.text?.trim() ? 'validator_rejected' : 'empty_response',
        validationReason,
        error: null,
      },
    };
  } catch (error) {
    const errorReason = summarizeError(error);
    const failureType = getFailureType(error);
    const providerError = getProviderErrorDetails(error);
    console.warn('[commentary/ai] provider_failed', {
      task: config.task,
      provider,
      model: getProviderModel(provider),
      durationMs: now() - startedAt,
      failureType,
      reason: errorReason,
      responseStatus: providerError?.status ?? null,
      requestSummary: providerError?.requestSummary ?? requestSummary,
      rawResponseBody: providerError?.rawBody ?? null,
    });
    return {
      validation: {
        ok: false,
        reason: failureType === 'timeout' || isAbortTimeoutError(error) ? 'timeout' : errorReason,
        meta: buildMeta(null, 'none'),
      },
      diagnostic: {
        provider,
        model: getProviderModel(provider),
        attempted: true,
        durationMs: now() - startedAt,
        status: providerError?.status ?? null,
        requestSummary: providerError?.requestSummary ?? requestSummary,
        rawBody: providerError?.rawBody ?? null,
        rawText: null,
        rawPreview: null,
        normalizedResponse: null,
        parser: 'none',
        parsed: false,
        normalizedLength: null,
        itemCount: null,
        validationOk: false,
        failureType,
        validationReason: errorReason,
        error: errorReason,
      },
    };
  }
}

function buildGenerationDebug(
  providerDiagnostics: ProviderAttemptDiagnostic[],
  finalReason: string,
  totalDurationMs: number
): CommentaryGenerationDebug {
  const gemini = providerDiagnostics.find((diagnostic) => diagnostic.provider === 'gemini');
  const openrouter = providerDiagnostics.find((diagnostic) => diagnostic.provider === 'openrouter');

  return {
    geminiAttempted: !!gemini?.attempted,
    geminiProducedRenderableText: !!gemini?.validationOk,
    openrouterAttempted: !!openrouter?.attempted,
    openrouterProducedRenderableText: !!openrouter?.validationOk,
    fallbackAttempted: providerDiagnostics.length > 1,
    geminiFailedReason: gemini && !gemini.validationOk ? gemini.validationReason ?? gemini.error : null,
    openrouterFailedReason: openrouter && !openrouter.validationOk ? openrouter.validationReason ?? openrouter.error : null,
    finalReason,
    totalDurationMs,
    providerDiagnostics,
  };
}

export async function generateWithDiagnostics<T>(config: GenerationConfig<T>): Promise<CommentaryGenerationResult<T>> {
  const startedAt = now();
  const providers = getProviderOrder();
  if (providers.length === 0) {
    return {
      ok: false,
      error: 'no_configured_providers',
      debug: buildGenerationDebug([], 'no_configured_providers', now() - startedAt),
    };
  }

  const providerDiagnostics: ProviderAttemptDiagnostic[] = [];
  for (const [index, provider] of providers.entries()) {
    const { validation, diagnostic } = await tryProvider(provider, config);
    providerDiagnostics.push(diagnostic);
    if (validation.ok) {
      console.info('[commentary/ai] success', {
        task: config.task,
        provider,
        model: getProviderModel(provider),
        usedFallbackProvider: index > 0,
        fallbackProvider: index > 0 ? provider : null,
        usedLocalFallback: false,
        finalResultEmptyByDesign: false,
      });
      return {
        ok: true,
        source: provider,
        value: validation.value,
        debug: buildGenerationDebug(
          providerDiagnostics,
          index > 0 ? `provider_success_after_fallback:${provider}` : `provider_success:${provider}`,
          now() - startedAt
        ),
      };
    }
  }

  if (config.fallbackMode === 'safe') {
    return {
      ok: true,
      source: 'local_fallback',
      value: config.localFallback(),
      debug: buildGenerationDebug(providerDiagnostics, 'local_fallback_after_provider_failures', now() - startedAt),
    };
  }

  console.warn('[commentary/ai] local_fallback', {
    task: config.task,
    attemptedProviders: providers,
    attemptReasons: providerDiagnostics.map((diagnostic) => ({
      provider: diagnostic.provider,
      reason: diagnostic.validationReason ?? diagnostic.error ?? 'unknown',
    })),
    usedLocalFallback: false,
    finalResultEmptyByDesign: true,
  });

  return {
    ok: false,
    error: 'all_providers_failed',
    debug: buildGenerationDebug(providerDiagnostics, 'all_providers_failed', now() - startedAt),
  };
}

export async function generateWithFallback<T>(config: GenerationConfig<T>) {
  const result = await generateWithDiagnostics(config);
  if (result.ok) {
    return result.value;
  }

  return config.localFallback();
}

export async function probeCommentaryProvider<T>(options: {
  provider: CommentaryProvider;
  prompt: string;
  systemInstruction: string;
  temperature: number;
  maxTokens: number;
  validate: (rawText: string | null) => ValidationResult<T>;
}): Promise<ProviderProbeResult<T>> {
  const startedAt = now();

  try {
    const response = await getProviderGenerator(options.provider)(
      options.prompt,
      options.systemInstruction,
      options.temperature,
      options.maxTokens
    );
    const validation = options.validate(response.text);

    return {
      ok: validation.ok,
      provider: options.provider,
      model: response.model,
      status: response.status,
      rawResponse: response.rawBody,
      parsedText: response.text,
      validation,
      elapsedMs: now() - startedAt,
      failureType: validation.ok ? null : response.text?.trim() ? 'validator_rejected' : 'empty_response',
      message: validation.ok ? null : ('reason' in validation ? validation.reason : null),
      requestSummary: response.requestSummary,
    };
  } catch (error) {
    const providerError = getProviderErrorDetails(error);

    return {
      ok: false,
      provider: options.provider,
      model: getProviderModel(options.provider),
      status: providerError?.status ?? null,
      rawResponse: providerError?.rawBody ?? null,
      parsedText: null,
      validation: {
        ok: false,
        reason: summarizeError(error),
        meta: buildMeta(null, 'none'),
      },
      elapsedMs: now() - startedAt,
      failureType: getFailureType(error),
      message: summarizeError(error),
      requestSummary: providerError?.requestSummary ?? null,
    };
  }
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
  const heckles = extractAiDisplayLines(parsed ?? rawText)
    .map((line) => cleanLine(line))
    .filter(Boolean);
  const meta = buildMeta(rawText, parser, {
    parsed: !!parsed,
    normalizedLength: normalizeWhitespace(rawText).length,
    itemCount: heckles.length,
  });

  if (!heckles.length) {
    return { ok: false, reason: parsed ? 'parsed_but_no_items' : 'invalid_shape', meta };
  }

  for (const heckle of heckles) {
    const textReason = getPlainTextRejectionReason(heckle, 280);
    if (textReason) return { ok: false, reason: `item_${textReason}`, meta };
    const words = wordCount(heckle);
    if (words < 1 || words > 56) return { ok: false, reason: 'item_word_count_out_of_bounds', meta };
    if (heckle.length > 280) return { ok: false, reason: 'item_char_limit_exceeded', meta };
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
  const text = cleanLine(extractAiDisplayText(parsed ?? rawText) ?? '');
  const meta = buildMeta(rawText, parser, {
    parsed: !!parsed,
    normalizedLength: text.length,
    itemCount: text ? 1 : 0,
  });
  const textReason = getPlainTextRejectionReason(text, 260);
  if (textReason) return { ok: false, reason: textReason, meta };
  if (text.split('\n').length > 3) return { ok: false, reason: 'too_many_lines', meta };
  if (wordCount(text) < 3 || wordCount(text) > 48) return { ok: false, reason: 'word_count_out_of_bounds', meta };

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

  const loserReason = getPlainTextRejectionReason(loserRoast, 280);
  if (loserReason) return { ok: false, reason: `loserRoast_${loserReason}`, meta };
  const winnerReason = getPlainTextRejectionReason(winnerCompliment, 280);
  if (winnerReason) return { ok: false, reason: `winnerCompliment_${winnerReason}`, meta };

  if (wordCount(loserRoast) > 48 || wordCount(winnerCompliment) > 48) {
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
