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
  return `You generate short multiplayer trivia heckles for the waiting period during an opponent's turn.
These should feel like they were written by one sharp host reacting to this exact game, not by a joke vending machine.

Return ONLY valid JSON.
Do not include markdown.
Do not include commentary outside the JSON.

Return this exact shape:
{
  "heckles": [string, string, string]
}

Context:
- Target player's name to address directly: ${context.playerName}
- Opponent currently playing: ${context.opponentName || 'Unknown opponent'}
- Trigger: ${context.trigger}
- Waiting reason: ${context.waitingReason}
- Scoreboard: ${context.playerName} ${context.playerScore}, ${context.opponentName || 'Opponent'} ${context.opponentScore}, delta ${context.scoreDelta}
- Recent performance summary: ${context.recentPerformanceSummary}
- Last question: ${context.lastQuestion || 'Unknown'}
- Missed last question: ${context.playerMissedLastQuestion ? 'yes' : 'no'}
- Category: ${context.category || 'Unknown'}
- Difficulty: ${context.difficulty || 'Unknown'}
- Recent failure details: ${context.recentFailure || 'None recorded'}
- Last two resolved questions:
${context.recentQuestionHistory?.length
  ? context.recentQuestionHistory
      .map((item, index) => `  ${index + 1}. "${item.question}" | category: ${item.category} | difficulty: ${item.difficulty} | player answer: "${item.playerAnswer}" | correct answer: "${item.correctAnswer}" | result: ${item.result}`)
      .join('\n')
  : '  None recorded'}

${MODERN_HOST_PERSONA}

Tone:
- Highbrow, smug, impatient, professionally condescending
- Witty, sarcastic, funny
- Adult-oriented; mild profanity is allowed when it sharpens the sting
- Smart, not sloppy
- Sophisticated enough to surprise an adult player
- Original enough that the lines do not sound mass-produced
- Context-aware enough that a player could tell what blunder or score swing inspired the line

Rules:
- Write exactly ${MAX_HECKLES} heckles
- Each heckle must be under 26 words
- Keep them readable and punchy
- Prefer sharp, concise phrasing over elaborate sentences
- Use rhythm, contrast, or repetition when possible
- Avoid long setups; land the punch quickly
- Speak as if you are an authoritative observer of the game, not a participant
- Speak as if addressing an audience watching the game, not the player directly
- Refer to the player in third person when it improves tone (e.g., "Dustin appears to believe...")
- Maintain a sense of distance and control; never sound reactive or emotional
- Favor dry, observational humor over direct insults
- Let the joke emerge from the analysis, not from aggression
- Use phrasing that implies expertise or authority
- Occasionally frame the moment like a case study, critique, or performance review
- Do not sound like trash talk
- Avoid sounding like you are trying to “win” the exchange
- Avoid direct taunts unless they are subtle and indirect
- If the score is 0-0, treat the match as just beginning; the tone should imply early-stage read or first impression, not a collapse, choke, deadlock, or comeback
- At 0-0, avoid language implying anyone has already lost control of the match
- React to the specific failure and current score/streak state
- Each heckle must use a different comedic structure (e.g., sarcasm, rhetorical question, mock praise, analogy)
- Make each one feel like a fresh angle on the situation rather than three versions of the same joke
- Use at least one concrete detail from the provided context whenever possible: question topic, wrong answer, correct answer, category, difficulty, trophies, or score state
- If a wrong answer is especially revealing, exploit what it implies about the player rather than merely repeating it
- Favor layered jokes: a clean insult plus a smart observation beats random cruelty
- Prefer references or metaphors that fit the category or answer, but keep them instantly understandable
- Do not write generic filler that could fit any trivia game moment
- If the recent context is thin, lean into the exact score state or trigger rather than vague insults
- When possible, incorporate category-specific references or metaphors
- Do not repeat the same joke structure
- Do not repeat signature words, phrasing, or sentence rhythm across the three heckles
- Do not comment on loading, delays, or wait time itself
- These are background flavor while the opponent plays, not result-screen summaries
- Favor clever contempt over random noise
- Keep the insults playful rather than hateful
- No slurs
- No hate content
- No threats
- No sexual content
- No encouragement of self-harm
- Keep each heckle short enough to fit as a quick waiting-state commentary card

Bad example:
"LOL you suck this is bad wow terrible answer hahaha."
`;
}
