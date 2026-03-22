import { TriviaQuestion, isPlayableCategory } from '../types';

const MIN_EXPLANATION_LENGTH = 20;
const DISALLOWED_PHRASES = ['all of the above', 'none of the above'];
function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeForComparison(value: string) {
  return normalizeWhitespace(value).toLowerCase();
}

function hasDisallowedChoiceText(value: string) {
  const normalized = normalizeForComparison(value);
  return DISALLOWED_PHRASES.includes(normalized);
}

function isNonEmptyString(value: unknown) {
  return typeof value === 'string' && normalizeWhitespace(value).length > 0;
}

function hasValidChoices(choices: unknown): choices is string[] {
  return Array.isArray(choices) && choices.length === 4 && choices.every(isNonEmptyString);
}

function validateQuestion(question: TriviaQuestion) {
  if (!question || typeof question !== 'object') {
    return { isValid: false, reason: 'malformed item' };
  }

  if (!isNonEmptyString(question.category) || !isPlayableCategory(question.category)) {
    return { isValid: false, reason: 'invalid category' };
  }

  if (!isNonEmptyString(question.question)) {
    return { isValid: false, reason: 'empty question text' };
  }

  if (!hasValidChoices(question.choices)) {
    return { isValid: false, reason: 'choices must contain exactly 4 non-empty items' };
  }

  if (!Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 3) {
    return { isValid: false, reason: 'invalid correctIndex' };
  }

  if (!Number.isInteger(question.answerIndex) || question.answerIndex !== question.correctIndex) {
    return { isValid: false, reason: 'answerIndex mismatch' };
  }

  if (!isNonEmptyString(question.explanation) || normalizeWhitespace(question.explanation).length < MIN_EXPLANATION_LENGTH) {
    return { isValid: false, reason: 'explanation too short' };
  }

  const normalizedChoices = question.choices.map(normalizeForComparison);
  if (new Set(normalizedChoices).size !== 4) {
    return { isValid: false, reason: 'duplicate answer choices' };
  }

  if (question.choices.some(hasDisallowedChoiceText)) {
    return { isValid: false, reason: 'disallowed answer phrase' };
  }

  const correctChoice = normalizedChoices[question.correctIndex];
  const duplicateCorrectChoiceCount = normalizedChoices.filter((choice) => choice === correctChoice).length;
  if (duplicateCorrectChoiceCount !== 1) {
    return { isValid: false, reason: 'correct answer duplicated in another choice' };
  }

  return { isValid: true, reason: null };
}

export function validateGeneratedQuestions(questions: TriviaQuestion[]) {
  const approved: TriviaQuestion[] = [];
  const rejected: Array<{ question: TriviaQuestion; reason: string }> = [];

  for (const question of questions) {
    const result = validateQuestion(question);
    if (result.isValid) {
      approved.push(question);
    } else {
      rejected.push({ question, reason: result.reason || 'unknown validation error' });
    }
  }

  return { approved, rejected };
}
