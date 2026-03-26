import { Type } from '@google/genai';
import type { TriviaQuestion } from '../types.js';

export type VerificationVerdict = 'pass' | 'reject';
export type VerificationConfidence = 'high' | 'medium' | 'low';

export interface QuestionVerificationResult {
  verdict: VerificationVerdict;
  confidence: VerificationConfidence;
  issues: string[];
  reason: string;
}

export const questionVerificationSchema = {
  type: Type.OBJECT,
  properties: {
    results: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          questionIndex: { type: Type.INTEGER },
          verdict: { type: Type.STRING },
          confidence: { type: Type.STRING },
          issues: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          reason: { type: Type.STRING },
        },
        required: ['questionIndex', 'verdict', 'confidence', 'issues', 'reason'],
      },
    },
  },
  required: ['results'],
};

function formatVerificationBatch(questions: TriviaQuestion[]) {
  return JSON.stringify({
    questions: questions.map((question, questionIndex) => ({
      questionIndex,
      category: question.category,
      difficulty: question.difficulty,
      question: question.question,
      choices: question.choices,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
    })),
  }, null, 2);
}

export function buildVerificationPrompt(questions: TriviaQuestion[]) {
  return `You are a ruthless trivia verifier.

Your job is to reject any question with meaningful doubt.
Be conservative. If you are not highly confident the item is factual, unambiguous, fair, and internally consistent, reject it.

Return ONLY valid JSON.
Do not include markdown.
Do not include commentary outside the JSON.

Return this exact top-level shape:
{
  "results": [
    {
      "questionIndex": number,
      "verdict": "pass" | "reject",
      "confidence": "high" | "medium" | "low",
      "issues": [string],
      "reason": string
    }
  ]
}

Verification rules:
- Evaluate each question independently.
- Reject if there is any factual uncertainty, ambiguity, misleading wording, or more than one plausibly defensible answer.
- Reject if the difficulty label feels materially wrong.
- Reject if the explanation conflicts with the question, answer, or known facts.
- Reject if any distractor is accidentally correct or too close to correct.
- Reject if the question depends on shifting current events without anchoring to a clear date or timeframe.
- Reject if the wording is vague enough that strong players could reasonably dispute the answer.
- Only use verdict "pass" when the question is clearly sound.
- Only use confidence "high" when you are highly certain the question is correct and fair.
- If there is any meaningful doubt, use verdict "reject".
- Keep reasons short and specific.
- Keep issues concise.

Questions to verify:
${formatVerificationBatch(questions)}`;
}

function normalizeIssueList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeResult(raw: any): QuestionVerificationResult {
  const verdict: VerificationVerdict = raw?.verdict === 'pass' ? 'pass' : 'reject';
  const confidence: VerificationConfidence =
    raw?.confidence === 'high' || raw?.confidence === 'medium' || raw?.confidence === 'low'
      ? raw.confidence
      : 'low';
  const issues = normalizeIssueList(raw?.issues);
  const reason = typeof raw?.reason === 'string' && raw.reason.trim().length > 0
    ? raw.reason.trim()
    : 'Verifier response was incomplete.';

  return {
    verdict,
    confidence,
    issues,
    reason,
  };
}

export function normalizeVerificationResults(
  questions: TriviaQuestion[],
  payload: any
): QuestionVerificationResult[] {
  const indexed = new Map<number, QuestionVerificationResult>();
  const rawResults = Array.isArray(payload?.results) ? payload.results : [];

  rawResults.forEach((result: any) => {
    if (!Number.isInteger(result?.questionIndex)) return;
    if (result.questionIndex < 0 || result.questionIndex >= questions.length) return;
    indexed.set(result.questionIndex, normalizeResult(result));
  });

  return questions.map((_, questionIndex) => {
    return indexed.get(questionIndex) || {
      verdict: 'reject',
      confidence: 'low',
      issues: ['missing verification result'],
      reason: 'Verifier did not return a result for this question.',
    };
  });
}

export function isQuestionApprovedForStorage(question: TriviaQuestion) {
  return (question.status === 'approved' || question.status === 'verified')
    && question.metadata?.verificationVerdict === 'pass'
    && question.metadata?.verificationConfidence === 'high';
}

