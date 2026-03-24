import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import {
  buildQuestionPrompt,
  dedupeQuestions,
  extractRetryDelayMs,
  ExistingQuestion,
  isRateLimitError,
  questionSchema,
  TRIVIA_PIPELINE_VERSION,
} from '../src/services/gemini';
import { buildStylingPrompt, normalizeStylingResults, questionStylingSchema } from '../src/services/questionStyling';
import {
  buildVerificationPrompt,
  isQuestionApprovedForStorage,
  normalizeVerificationResults,
  questionVerificationSchema,
} from '../src/services/questionVerification';
import { validateGeneratedQuestions } from '../src/services/questionValidation';
import { TriviaQuestion } from '../src/types';

type Difficulty = 'easy' | 'medium' | 'hard';
type PipelineStage = 'request' | 'generation' | 'verification' | 'styling' | 'response';

interface StageContext {
  requestId: string;
  startedAt: number;
}

interface StructuredErrorResponse {
  error: string;
  code: string;
  stage?: PipelineStage;
  requestId: string;
  retryAfterMs?: number;
  details?: string;
}

function getConfiguredProviderCount() {
  return Number(Boolean(process.env.GEMINI_API_KEY)) + Number(Boolean(process.env.OPENROUTER_API_KEY));
}

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

function parseJsonEnvelope(text: string, errorLabel: string) {
  if (!text || !text.trim()) {
    throw new Error(`${errorLabel} returned an empty response`);
  }

  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error(`${errorLabel} returned non-JSON content`);
  }

  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  } catch (error) {
    throw new Error(`${errorLabel} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function logPipelineWarning(message: string) {
  console.warn(`[questionPipeline] ${message}`);
}

function logPipelineInfo(message: string) {
  console.info(`[questionPipeline] ${message}`);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function createRequestId() {
  return `qg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeError(error: unknown) {
  const message = getErrorMessage(error);
  if (error instanceof Error && error.stack) {
    return `${message}\n${error.stack}`;
  }
  return message;
}

function elapsedMs(startedAt: number) {
  return Date.now() - startedAt;
}

function logStage(context: StageContext, stage: PipelineStage, event: string, details?: Record<string, unknown>) {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  logPipelineInfo(`[${context.requestId}] ${stage}:${event} +${elapsedMs(context.startedAt)}ms${suffix}`);
}

function logStageFailure(context: StageContext, stage: PipelineStage, error: unknown, details?: Record<string, unknown>) {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  logPipelineWarning(`[${context.requestId}] ${stage}:failed +${elapsedMs(context.startedAt)}ms${suffix} ${summarizeError(error)}`);
}

function createErrorResponse(
  context: StageContext,
  code: string,
  error: string,
  options?: {
    stage?: PipelineStage;
    retryAfterMs?: number;
    details?: string;
  }
): StructuredErrorResponse {
  return {
    error,
    code,
    requestId: context.requestId,
    ...(options?.stage ? { stage: options.stage } : {}),
    ...(options?.retryAfterMs ? { retryAfterMs: options.retryAfterMs } : {}),
    ...(options?.details ? { details: options.details } : {}),
  };
}

function classifyPipelineError(error: unknown, stage: PipelineStage, context: StageContext) {
  const message = getErrorMessage(error);

  if (/api[_ -]?key is missing/i.test(message)) {
    return {
      status: 503,
      body: createErrorResponse(context, 'provider_not_configured', 'Question generation is not configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY.', {
        stage,
        details: message,
      }),
    };
  }

  if (/\b401\b|\b403\b|invalid api key|api key not valid|permission denied|unauthorized|forbidden/i.test(message)) {
    return {
      status: 503,
      body: createErrorResponse(context, 'provider_auth_failed', 'Question generation provider rejected the server credentials.', {
        stage,
        details: message,
      }),
    };
  }

  if (/returned non-json content|unexpected token|json/i.test(message)) {
    return {
      status: 502,
      body: createErrorResponse(context, 'provider_invalid_response', 'Question generation provider returned an invalid response.', {
        stage,
        details: message,
      }),
    };
  }

  if (/timed out|timeout|time-out|aborted/i.test(message)) {
    return {
      status: 504,
      body: createErrorResponse(context, 'provider_timeout', 'Question generation timed out while waiting for the provider.', {
        stage,
        details: message,
      }),
    };
  }

  return {
    status: 500,
    body: createErrorResponse(context, 'internal_error', 'Question generation failed unexpectedly.', {
      stage,
      details: message,
    }),
  };
}

function validateRequestPayload(body: any) {
  const categories = Array.isArray(body.categories) ? body.categories.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0) : [];
  const countPerCategory = Number.isInteger(body.countPerCategory) ? body.countPerCategory : 3;
  const existingQuestions = Array.isArray(body.existingQuestions) ? body.existingQuestions as ExistingQuestion[] : [];
  const requestedDifficulty = body.requestedDifficulty as Difficulty | undefined;

  if (categories.length === 0) {
    return { ok: false as const, status: 400, error: 'categories are required' };
  }

  if (countPerCategory < 1 || countPerCategory > 10) {
    return { ok: false as const, status: 400, error: 'countPerCategory must be between 1 and 10' };
  }

  if (requestedDifficulty && !['easy', 'medium', 'hard'].includes(requestedDifficulty)) {
    return { ok: false as const, status: 400, error: 'requestedDifficulty must be easy, medium, or hard' };
  }

  return {
    ok: true as const,
    data: {
      categories,
      countPerCategory,
      existingQuestions,
      requestedDifficulty,
    },
  };
}

async function requestGeminiJson(prompt: string, schema: any, errorLabel: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing');
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });

  return parseJsonEnvelope(response.text || '', errorLabel);
}

async function requestOpenRouterJson(prompt: string, requestUrl: string, errorLabel: string) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': requestUrl,
      'X-Title': 'AFTG Trivia',
    },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
    const error = new Error(detail || `OpenRouter returned ${response.status}`);
    (error as Error & { retryAfterMs?: number | null }).retryAfterMs = retryAfterMs;
    throw error;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return parseJsonEnvelope(content, errorLabel);
}

async function requestStageJson({
  prompt,
  schema,
  requestUrl,
  errorLabel,
  stage,
  context,
}: {
  prompt: string;
  schema: any;
  requestUrl: string;
  errorLabel: string;
  stage: PipelineStage;
  context: StageContext;
}) {
  try {
    logStage(context, stage, 'gemini_started', { errorLabel });
    return await requestGeminiJson(prompt, schema, errorLabel);
  } catch (error) {
    logStageFailure(context, stage, error, { errorLabel, provider: 'gemini' });
    if (!process.env.OPENROUTER_API_KEY) {
      throw error;
    }

    try {
      logStage(context, stage, 'openrouter_started', { errorLabel });
      return await requestOpenRouterJson(prompt, requestUrl, errorLabel);
    } catch (fallbackError) {
      logStageFailure(context, stage, fallbackError, { errorLabel, provider: 'openrouter' });
      throw fallbackError;
    }
  }
}

function finalizeQuestions(questions: TriviaQuestion[], prefix = '') {
  return questions.map((question, index) => {
    const generatedId = `${prefix}${Date.now()}-${index}`;
    return {
      ...question,
      id: generatedId,
      questionId: generatedId,
      used: false,
      pipelineVersion: TRIVIA_PIPELINE_VERSION,
    };
  });
}

function logRejectedQuestions(
  stage: 'validation' | 'verification',
  rejected: Array<{ question: TriviaQuestion; reason: string }>
) {
  if (process.env.NODE_ENV === 'production') return;
  rejected.forEach(({ question, reason }) => {
    logPipelineWarning(`${stage} rejected "${question.question || question.id}": ${reason}`);
  });
}

async function runQuestionPipeline({
  categories,
  countPerCategory,
  existingQuestions,
  requestedDifficulty,
  requestUrl,
  context,
}: {
  categories: string[];
  countPerCategory: number;
  existingQuestions: ExistingQuestion[];
  requestedDifficulty?: Difficulty;
  requestUrl: string;
  context: StageContext;
}) {
  const generationPrompt = buildQuestionPrompt(categories, countPerCategory, existingQuestions, requestedDifficulty);
  logStage(context, 'generation', 'started', {
    categories,
    countPerCategory,
    requestedDifficulty: requestedDifficulty || 'medium',
    existingQuestions: existingQuestions.length,
  });

  const generatedPayload = await requestStageJson({
    prompt: generationPrompt,
    schema: questionSchema,
    requestUrl,
    errorLabel: 'Generator',
    stage: 'generation',
    context,
  });

  const generatedDrafts = dedupeQuestions(generatedPayload.questions || [], existingQuestions, countPerCategory);
  logStage(context, 'generation', 'completed', {
    returnedQuestions: Array.isArray(generatedPayload.questions) ? generatedPayload.questions.length : 0,
    acceptedDrafts: generatedDrafts.length,
  });

  let structurallyValid: TriviaQuestion[] = [];
  let structurallyRejected: Array<{ question: TriviaQuestion; reason: string }> = [];

  try {
    const validationResult = validateGeneratedQuestions(generatedDrafts);
    structurallyValid = validationResult.approved;
    structurallyRejected = validationResult.rejected;
    logRejectedQuestions('validation', structurallyRejected);
    logStage(context, 'generation', 'validation_completed', {
      approved: structurallyValid.length,
      rejected: structurallyRejected.length,
    });
  } catch (error) {
    logStageFailure(context, 'generation', error, { event: 'validation_failed' });
    throw error;
  }

  if (structurallyValid.length === 0) {
    logStage(context, 'generation', 'validation_failed', {
      reason: 'no_structurally_valid_questions',
      rejected: structurallyRejected.length,
    });
    return [];
  }

  let verificationResults = normalizeVerificationResults(structurallyValid, {});

  try {
    logStage(context, 'verification', 'started', { questions: structurallyValid.length });
    const verificationPrompt = buildVerificationPrompt(structurallyValid);
    const verificationPayload = await requestStageJson({
      prompt: verificationPrompt,
      schema: questionVerificationSchema,
      requestUrl,
      errorLabel: 'Verifier',
      stage: 'verification',
      context,
    });
    verificationResults = normalizeVerificationResults(structurallyValid, verificationPayload);
    logStage(context, 'verification', 'completed', { questions: verificationResults.length });
  } catch (error) {
    logStageFailure(context, 'verification', error, { event: 'batch_failed_retrying_single' });

    verificationResults = await Promise.all(structurallyValid.map(async (question) => {
      try {
        const verificationPayload = await requestStageJson({
          prompt: buildVerificationPrompt([question]),
          schema: questionVerificationSchema,
          requestUrl,
          errorLabel: 'Verifier',
          stage: 'verification',
          context,
        });
        return normalizeVerificationResults([question], verificationPayload)[0];
      } catch (singleError) {
        logStageFailure(context, 'verification', singleError, { event: 'single_question_retry_failed', question: question.question });
        return normalizeVerificationResults([question], {})[0];
      }
    }));
  }
  const verifiedQuestions: TriviaQuestion[] = structurallyValid.map((question, questionIndex) => {
    const verification = verificationResults[questionIndex];
    const approvedForStorage = verification.verdict === 'pass' && verification.confidence === 'high';

    return {
      ...question,
      validationStatus: approvedForStorage ? 'approved' as const : 'rejected' as const,
      verificationVerdict: verification.verdict,
      verificationConfidence: verification.confidence,
      verificationIssues: verification.issues,
      verificationReason: verification.reason,
      pipelineVersion: TRIVIA_PIPELINE_VERSION,
    };
  });

  const verificationRejected = verifiedQuestions
    .filter((question) => !isQuestionApprovedForStorage(question))
    .map((question) => ({
      question,
      reason: question.verificationReason || 'verification rejected',
    }));
  logRejectedQuestions('verification', verificationRejected);
  logStage(context, 'verification', 'normalized', {
    approved: verifiedQuestions.filter(isQuestionApprovedForStorage).length,
    rejected: verificationRejected.length,
  });

  const approvedQuestions = verifiedQuestions.filter(isQuestionApprovedForStorage);
  if (approvedQuestions.length === 0) {
    logStage(context, 'verification', 'failed', { reason: 'no_verified_questions' });
    return [];
  }

  try {
    logStage(context, 'styling', 'started', { questions: approvedQuestions.length });
    const stylingPrompt = buildStylingPrompt(approvedQuestions);
    const stylingPayload = await requestStageJson({
      prompt: stylingPrompt,
      schema: questionStylingSchema,
      requestUrl,
      errorLabel: 'Styler',
      stage: 'styling',
      context,
    });
    const stylingResults = normalizeStylingResults(approvedQuestions, stylingPayload);

    const styledQuestions = approvedQuestions.map((question, questionIndex): TriviaQuestion => ({
      ...question,
      questionStyled: stylingResults[questionIndex].questionStyled,
      explanationStyled: stylingResults[questionIndex].explanationStyled,
      ...(stylingResults[questionIndex].hostLeadIn ? { hostLeadIn: stylingResults[questionIndex].hostLeadIn } : {}),
    }));
    logStage(context, 'styling', 'completed', { questions: styledQuestions.length });
    return styledQuestions;
  } catch (error) {
    logStageFailure(context, 'styling', error, { event: 'returning_verified_plain_questions' });
    return approvedQuestions;
  }
}

export default async function handler(req: any, res: any) {
  const context: StageContext = {
    requestId: createRequestId(),
    startedAt: Date.now(),
  };

  if (req.method !== 'POST') {
    logStage(context, 'request', 'rejected_method', { method: req.method });
    res.status(405).json(createErrorResponse(context, 'method_not_allowed', 'Method not allowed', { stage: 'request' }));
    return;
  }

  let body: any;
  try {
    body = parseBody(req.body);
  } catch (error) {
    logStageFailure(context, 'request', error, { event: 'body_parse_failed' });
    res.status(400).json(createErrorResponse(context, 'invalid_request_body', 'Request body could not be parsed.', {
      stage: 'request',
      details: getErrorMessage(error),
    }));
    return;
  }

  const validation = validateRequestPayload(body);
  if (!validation.ok) {
    logStage(context, 'request', 'validation_failed', { error: validation.error });
    res.status(validation.status).json(createErrorResponse(context, 'invalid_request', validation.error, { stage: 'request' }));
    return;
  }

  const { categories, countPerCategory, existingQuestions, requestedDifficulty } = validation.data;
  logStage(context, 'request', 'received', {
    method: req.method,
    categories,
    countPerCategory,
    requestedDifficulty: requestedDifficulty || 'medium',
    existingQuestions: existingQuestions.length,
    configuredProviders: getConfiguredProviderCount(),
  });

  if (getConfiguredProviderCount() === 0) {
    logStage(context, 'request', 'provider_not_configured');
    res.status(503).json(createErrorResponse(
      context,
      'provider_not_configured',
      'Question generation is not configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY.',
      { stage: 'request' }
    ));
    return;
  }

  try {
    const requestUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host || ''}`;
    const approvedQuestions = await runQuestionPipeline({
      categories,
      countPerCategory,
      existingQuestions,
      requestedDifficulty,
      requestUrl,
      context,
    });

    const questions = finalizeQuestions(approvedQuestions);
    logStage(context, 'response', 'sent', { status: 200, questions: questions.length });
    res.status(200).json({
      questions,
      requestId: context.requestId,
    });
    return;
  } catch (error) {
    if (isRateLimitError(error)) {
      const retryAfterMs = (error as Error & { retryAfterMs?: number | null }).retryAfterMs
        ?? extractRetryDelayMs(getErrorMessage(error));
      logStageFailure(context, 'response', error, { event: 'rate_limited', retryAfterMs });
      res.status(429).json({
        ...createErrorResponse(context, 'rate_limited', 'AI generation is temporarily cooling down. Please try again shortly.', {
          stage: 'response',
          retryAfterMs,
          details: getErrorMessage(error),
        }),
        retryAfterMs,
      });
      return;
    }

    const classified = classifyPipelineError(error, 'response', context);
    logStageFailure(context, 'response', error, { event: 'handler_failed', status: classified.status });
    res.status(classified.status).json(classified.body);
  }
}
