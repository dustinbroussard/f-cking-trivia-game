import { MODERN_HOST_PERSONA } from './hostPersona.js';

export const HECKLE_ROTATION_MS = 9200;
export const MAX_HECKLES = 3;
export const HECKLE_REQUEST_COOLDOWN_MS = 15000;
export const HECKLE_PROLONGED_WAIT_MS = 9000;

export type HeckleTriggerReason =
  | 'wrong_answer'
  | 'round_loss'
  | 'score_deficit'
  | 'prolonged_wait';

export interface RecentAiQuestionContext {
  question: string;
  category: string;
  difficulty: string;
  playerAnswer: string;
  correctAnswer: string;
  result: 'correct' | 'wrong' | 'timeout';
  explanation?: string;
}

export interface HeckleGenerationContext {
  playerName: string;
  opponentName?: string;
  trigger: HeckleTriggerReason;
  waitingReason: string;
  playerScore: number;
  opponentScore: number;
  scoreDelta: number;
  recentPerformanceSummary: string;
  lastQuestion?: string;
  playerMissedLastQuestion: boolean;
  category?: string;
  difficulty?: string;
  recentFailure?: string;
  recentQuestionHistory?: RecentAiQuestionContext[];
  isSolo: boolean;
}

export function shouldEnableHeckles(isSolo: boolean) {
  return !isSolo;
}

export function buildHecklePrompt(context: HeckleGenerationContext) {
  return `Write a short in-game heckle for a trivia player who just missed a question and is now waiting on the opponent.

Context:
- Player: ${context.playerName}
- Opponent: ${context.opponentName || 'Opponent'}
- Trigger: ${context.trigger}
- Score: ${context.playerName} ${context.playerScore}, ${context.opponentName || 'Opponent'} ${context.opponentScore}
- Category: ${context.category || 'Unknown'}
- Difficulty: ${context.difficulty || 'Unknown'}
- Last question: ${context.lastQuestion || 'Unknown'}
- Recent failure: ${context.recentFailure || 'None recorded'}
- Last two resolved questions:
${context.recentQuestionHistory?.length
  ? context.recentQuestionHistory
      .map((item, index) => `  ${index + 1}. "${item.question}" | ${item.category} | player answer: "${item.playerAnswer}" | correct answer: "${item.correctAnswer}" | result: ${item.result}`)
      .join('\n')
  : '  None recorded'}

${MODERN_HOST_PERSONA}

Tone:
- Commentary booth, not trash talk
- Teasing, smug, observant
- Clever and concise
- More like a sharp host remark than direct chest-thumping
- Teasing, smug, quietly amused
- Detached and observant, not aggressive
- Dry humor with a light smirk
- The line should carry a subtle edge or sting, even while staying observational
- It should feel like the host enjoys the player being wrong, just a little

Game Rules Summary:
- Two players compete in trivia; correct answers earn points, and the first to collect all 6 category trophies wins the match.

Style Rules:
- Use game context
- Sound sharp, witty, pointed, and intentional
- Make it feel handcrafted to this exact moment
- Keep it concise and controlled
- No filler, no setup, no explanations
- No emojis or excessive punctuation

Humor Guidelines:
- Focus on hesitation, confidence, timing, or decision-making
- Lightly mock the situation, not the person directly
- Feel like a quick aside, not a punchline performance
- If the player is significantly behind, allow slightly harsher tone
- If the moment is decisive (MATCH_LOSS), allow a more final, crushing line

Structure:
- Observation → pressure point → twist

Avoid:
- Harsh insults or aggression
- Explaining the joke
- Long or complex sentences
- Repeating phrasing patterns

Rules:
- Return only the final player-facing heckle text
- One short line is best
- Prefer 8-24 words
- Hard cap: 2 sentences, 56 words, 280 characters
- No JSON
- No markdown
- No HTML or XML tags
- No labels
- No explanations
- No reasoning or refusal language like "let's think", "here's my reasoning", "as an AI", "I'm unable", or "I cannot"
- Do not mention prompts, rules, or formatting
- Use a concrete detail when possible
- Do not sound like trash talk
`;
}
