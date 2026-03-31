import type { RecentAiQuestionContext } from './heckles';

export type TrashTalkEvent = 'OPPONENT_TROPHY' | 'PLAYER_FALLING_BEHIND' | 'MATCH_LOSS';

export interface TrashTalkGenerationContext {
  event: TrashTalkEvent;
  playerName: string;
  opponentName: string;
  playerScore: number;
  opponentScore: number;
  scoreDelta: number;
  playerTrophies: number;
  opponentTrophies: number;
  latestCategory?: string;
  outcomeSummary: string;
  recentQuestionHistory?: RecentAiQuestionContext[];
  isSolo: boolean;
}

const TRASH_TALK_LINES: Record<TrashTalkEvent, string[]> = {
  OPPONENT_TROPHY: [
    'They just grabbed another trophy. You may want to locate your pulse.',
    'Your opponent claimed that category like it owed them money.',
    'Another trophy for them. You are being turned into a cautionary tale.',
    'They locked in a category. You are now the supporting cast.',
  ],
  PLAYER_FALLING_BEHIND: [
    'Three points down. This is drifting from contest into documentary.',
    'You are trailing badly enough for concern to become comedy.',
    'The scoreboard is developing an opinion about you.',
    'You are a few answers away from becoming the lesson plan.',
  ],
  MATCH_LOSS: [
    'That is the match. You did not lose so much as slowly donate it.',
    'Game over. Your opponent left with the trophies and your dignity filed for transfer.',
    'That was the final blow. The scoreboard will remember this longer than anyone should.',
    'Match lost. Even the wheel is trying not to make eye contact.',
  ],
};

export function getTrashTalkLine(event: TrashTalkEvent): string {
  const bank = TRASH_TALK_LINES[event];
  return bank[Math.floor(Math.random() * bank.length)] || 'Rough scene.';
}

export function buildTrashTalkPrompt(context: TrashTalkGenerationContext) {
  return `Write one short trivia trash-talk line for a dramatic in-game overlay.

Context:
- Event: ${context.event}
- Player being addressed: ${context.playerName}
- Opponent: ${context.opponentName}
- Score: ${context.playerName} ${context.playerScore}, ${context.opponentName} ${context.opponentScore}
- Score delta: ${context.scoreDelta}
- Trophies: ${context.playerName} ${context.playerTrophies}, ${context.opponentName} ${context.opponentTrophies}
- Latest category swing: ${context.latestCategory || 'Unknown'}
- Outcome summary: ${context.outcomeSummary}
- Last two resolved questions:
${context.recentQuestionHistory?.length
  ? context.recentQuestionHistory
      .map((item, index) => `  ${index + 1}. "${item.question}" | category: ${item.category} | player answer: "${item.playerAnswer}" | correct answer: "${item.correctAnswer}" | result: ${item.result}`)
      .join('\n')
  : '  None recorded'}

Rules:
- Return only the trash-talk line
- One to two sentences max
- Sound sharp, witty, smug, and playful
- Make it feel handcrafted to this exact moment
- Use the supplied specifics when available; anchor the line in the actual miss, category swing, score, or recent answer history
- Avoid generic sports-announcer filler or insults that could fit any match
- Prefer one precise observation over broad swagger
- No slurs
- No hate content
- No threats
- No sexual content
- No self-harm content
- No meta commentary
- Keep it concise enough for a modal-style overlay`;
}
