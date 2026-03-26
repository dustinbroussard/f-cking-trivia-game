import { Type } from '@google/genai';
import type { TriviaQuestion } from '../types';

export interface QuestionStylingResult {
  questionStyled: string;
  explanationStyled: string;
  hostLeadIn?: string;
}

export const questionStylingSchema = {
  type: Type.OBJECT,
  properties: {
    results: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          questionIndex: { type: Type.INTEGER },
          questionStyled: { type: Type.STRING },
          explanationStyled: { type: Type.STRING },
          hostLeadIn: { type: Type.STRING },
        },
        required: ['questionIndex', 'questionStyled', 'explanationStyled'],
      },
    },
  },
  required: ['results'],
};

function formatStylingBatch(questions: TriviaQuestion[]) {
  return JSON.stringify({
    questions: questions.map((question, questionIndex) => ({
      questionIndex,
      category: question.category,
      difficulty: question.difficulty,
      question: question.question,
      explanation: question.explanation,
      correctAnswer: question.choices[question.correctIndex],
    })),
  }, null, 2);
}

export function buildStylingPrompt(questions: TriviaQuestion[]) {
  return `You are polishing already-verified trivia for a witty, sarcastic, and occasionally condescending game host.

PERSONALITY:
You are:
* intelligent
* composed
* slightly smug
* quietly amused

Add a significant amoutn of smug humor to the experience.
Do not change factual meaning.
Do not change the answer choices.
Do not change which answer is correct.
Do not add ambiguity.


Return ONLY valid JSON.
Do not include markdown.
Do not include commentary outside the JSON.

Return this exact top-level shape:
{
  "results": [
    {
      "questionIndex": number,
      "questionStyled": string,
      "explanationStyled": string,
      "hostLeadIn": string
    }
  ]
}

Styling rules:
- hostLeadIn: 5-12 words, clever, thematic, or lightly teasing
- Keep the same factual content and answerability as the original while dramatically altering the content to contain a consistent brain of condescending, sarcastic, adult humor. 
- Question styling must add wit, rhythm, or voice, but must stay clear and fair; NEVER be boring.
- Explanation styling should be more playful or smug, but must stay factually identical in substance.
- Don't hold back; this game is for grown, adults, so if feelings are hurt, that's on them. . . and their therapist. 
- hostLeadIn is optional and should be short.
- Never change dates, names, numbers, categories, or relationships.
- Never introduce new facts.
- wrongAnswerQuips: ligthly teasing, funny, 5-10 word. 
- IMPORTANT: The effect of your edits should not be subtle. It's critical that the styling of the content have an edge.  For God's sakes, but funny!

Questions to style:
${formatStylingBatch(questions)}`;
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function collectStylingResults(
  questions: TriviaQuestion[],
  payload: any
) {
  const indexed = new Map<number, QuestionStylingResult>();
  const rawResults = Array.isArray(payload?.results) ? payload.results : [];

  rawResults.forEach((result: any) => {
    if (!Number.isInteger(result?.questionIndex)) return;
    if (result.questionIndex < 0 || result.questionIndex >= questions.length) return;

    const questionStyled = normalizeText(result.questionStyled);
    const explanationStyled = normalizeText(result.explanationStyled);
    const hostLeadIn = normalizeText(result.hostLeadIn);

    if (!questionStyled || !explanationStyled) return;

    indexed.set(result.questionIndex, {
      questionStyled,
      explanationStyled,
      ...(hostLeadIn ? { hostLeadIn } : {}),
    });
  });

  return indexed;
}

export function getStrictStylingResults(
  questions: TriviaQuestion[],
  payload: any
): Array<QuestionStylingResult | null> {
  const indexed = collectStylingResults(questions, payload);

  return questions.map((_, questionIndex) => indexed.get(questionIndex) || null);
}

export function normalizeStylingResults(
  questions: TriviaQuestion[],
  payload: any
): QuestionStylingResult[] {
  const indexed = collectStylingResults(questions, payload);

  return questions.map((question, questionIndex) => {
    return indexed.get(questionIndex) || {
      questionStyled: question.question,
      explanationStyled: question.explanation,
    };
  });
}
