import type { RecentAiQuestionContext } from './heckles';

export interface EndgameRoastGenerationContext {
  winnerName: string;
  loserName: string;
  winnerScore: number;
  loserScore: number;
  winnerTrophies: number;
  loserTrophies: number;
  winnerRecentQuestionHistory?: RecentAiQuestionContext[];
  loserRecentQuestionHistory?: RecentAiQuestionContext[];
  isSolo: boolean;
}

export interface EndgameRoastResult {
  loserRoast: string;
  winnerCompliment: string;
}

export function buildEndgameRoastPrompt(context: EndgameRoastGenerationContext) {
  return `You write the final post-game sendoff for a multiplayer trivia match. Speak as a smug, witty, slightly mean game show host delivering one last verdict.

Return ONLY valid JSON.
Do not include markdown.
Do not include commentary outside the JSON.

Return this exact shape:
{
  "loserRoast": string,
  "winnerCompliment": string
}

Context:
- Winner: ${context.winnerName}
- Loser: ${context.loserName}
- Final score: ${context.winnerName} ${context.winnerScore}, ${context.loserName} ${context.loserScore}
- Trophy count: ${context.winnerName} ${context.winnerTrophies}, ${context.loserName} ${context.loserTrophies}
- ${context.winnerName}'s last two resolved questions:
${context.winnerRecentQuestionHistory?.length
    ? context.winnerRecentQuestionHistory
        .map((item, index) => `  ${index + 1}. "${item.question}" | category: ${item.category} | difficulty: ${item.difficulty} | player answer: "${item.playerAnswer}" | correct answer: "${item.correctAnswer}" | result: ${item.result}`)
        .join('\n')
    : '  None recorded'}
- ${context.loserName}'s last two resolved questions:
${context.loserRecentQuestionHistory?.length
    ? context.loserRecentQuestionHistory
        .map((item, index) => `  ${index + 1}. "${item.question}" | category: ${item.category} | difficulty: ${item.difficulty} | player answer: "${item.playerAnswer}" | correct answer: "${item.correctAnswer}" | result: ${item.result}`)
        .join('\n')
    : '  None recorded'}

Rules:
- Write one playful roasting tease for the loser
- Write one sarcastic or backhanded compliment for the winner
- Return only the JSON object
- Each line must be 1 to 2 sentences max
- Keep each line under 32 words
- Sound specific to this exact match, not generic
- Use concrete details from the score, trophies, question topics, wrong answers, correct answers, or recent outcomes whenever possible
- Keep it sharp, adult, and funny, but not hateful
- No slurs
- No hate content
- No threats
- No sexual content
- No self-harm content
- No meta commentary`;
}
