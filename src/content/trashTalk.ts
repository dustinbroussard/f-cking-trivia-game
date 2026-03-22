export type TrashTalkEvent = 'OPPONENT_TROPHY' | 'PLAYER_FALLING_BEHIND' | 'MATCH_LOSS';

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
