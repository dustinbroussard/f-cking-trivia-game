import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { TrashTalkEvent } from '../content/trashTalk';

interface TrashTalkOverlayProps {
  event: TrashTalkEvent | null;
  message: string | null;
}

const TITLES: Record<TrashTalkEvent, string> = {
  OPPONENT_TROPHY: 'They Scored',
  PLAYER_FALLING_BEHIND: 'Scoreboard Check',
  MATCH_LOSS: 'Final Verdict',
};

export const TrashTalkOverlay: React.FC<TrashTalkOverlayProps> = ({ event, message }) => {
  if (!event || !message) return null;

  const isMatchLoss = event === 'MATCH_LOSS';

  return (
    <AnimatePresence>
      <motion.div
        key={`${event}-${message}`}
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 w-full max-w-xl pointer-events-none"
      >
        <div
          className={`rounded-2xl border backdrop-blur-xl px-6 py-5 ${
            isMatchLoss
              ? 'bg-rose-950/85 border-rose-500/40'
              : 'theme-panel-strong border-cyan-400/20'
          }`}
        >
          <p
            className={`text-[10px] font-black uppercase tracking-[0.28em] mb-2 ${
              isMatchLoss ? 'text-rose-400' : 'text-cyan-400'
            }`}
          >
            {TITLES[event]}
          </p>
          <p className="text-lg font-semibold leading-relaxed">{message}</p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
