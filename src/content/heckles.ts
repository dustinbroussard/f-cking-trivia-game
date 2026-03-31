export const HECKLE_ROTATION_MS = 9200;
export const MAX_HECKLES = 3;
export const HECKLE_REQUEST_COOLDOWN_MS = 15000;
export const HECKLE_PROLONGED_WAIT_MS = 9000;

export type HeckleTriggerReason =
  | 'wrong_answer'
  | 'round_loss'
  | 'score_deficit'
  | 'prolonged_wait';

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
  isSolo: boolean;
}

export function shouldEnableHeckles(isSolo: boolean) {
  return !isSolo;
}

export function buildHecklePrompt(context: HeckleGenerationContext) {
  return `You generate short multiplayer trivia heckles for the waiting period during an opponent's turn.

Return ONLY valid JSON.
Do not include markdown.
Do not include commentary outside the JSON.

Return this exact shape:
{
  "heckles": [string, string, string]
}

Context:
- Target player: ${context.playerName}
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

Tone:
- Highbrow, smug, impatient, professionally condescending
- Witty, sarcastic, funny
- Adult-oriented; mild profanity is allowed when it sharpens the sting
- Smart, not sloppy

Rules:
- Write exactly ${MAX_HECKLES} heckles
- Each heckle must be 1 to 3 lines max
- Keep them readable and punchy
- React to the specific failure and current score/streak state
- Do not explain the rules of the game
- Do not mention being an AI
- Do not repeat the same joke structure
- Keep the insults playful rather than hateful
- These are background flavor while the opponent plays, not result-screen summaries
- Favor clever contempt over random noise
- No slurs
- No hate content
- No threats
- No sexual content
- No encouragement to quit or self-harm
- Keep each heckle short enough to fit as a quick waiting-state sidebar line

Good example:
"An ambitious answer, ${context.playerName}. Wrong, obviously, but ambitious. ${context.opponentName} now has the floor, which is probably safer for everyone."

Bad example:
"LOL you suck this is bad wow terrible answer hahaha."
`;
}
