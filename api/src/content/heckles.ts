export const HECKLE_ROTATION_MS = 4200;
export const MAX_HECKLES = 3;

export interface HeckleGenerationContext {
  playerName: string;
  opponentName: string;
  gameState: string;
  recentFailure: string;
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
- Opponent currently playing: ${context.opponentName}
- Scoreboard and streak state: ${context.gameState}
- Recent failure: ${context.recentFailure}

Tone:
- Highbrow, smug, impatient, professionally condescending
- Witty, sarcastic, funny
- Adult-oriented; mild or stronger profanity is allowed when it sharpens the sting
- Smart, not sloppy

Rules:
- Write exactly ${MAX_HECKLES} heckles
- Each heckle must be short, at most 3-5 lines
- Keep them readable and punchy
- React to the specific failure and current score/streak state
- Do not explain the rules of the game
- Do not mention being an AI
- Do not repeat the same joke structure
- Keep the insults playful rather than hateful
- These are background flavor while the opponent plays, not result-screen summaries
- Favor clever contempt over random noise

Good example:
"An ambitious answer, ${context.playerName}. Wrong, obviously, but ambitious. ${context.opponentName} now has the floor, which is probably safer for everyone."

Bad example:
"LOL you suck this is bad wow terrible answer hahaha."
`;
}
