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
  const accentClass = isMatchLoss ? 'text-rose-400' : 'text-cyan-400';
  const cardClass = isMatchLoss
    ? 'bg-rose-950/45 border-rose-500/35 ring-1 ring-rose-400/12'
    : 'theme-panel-strong border-cyan-400/22 ring-1 ring-cyan-300/12';

  return (
    <AnimatePresence>
      <motion.div
        key={`${event}-${message}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[54] flex items-center justify-center p-6 pointer-events-none"
      >
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 theme-overlay"
          initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
          animate={{ opacity: 0.62, backdropFilter: 'blur(4px)' }}
          exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        />
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.98 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="relative z-10 w-full max-w-md"
        >
          <div className={`rounded-2xl border backdrop-blur-xl px-6 py-7 sm:px-8 sm:py-8 text-center shadow-[0_12px_36px_rgba(0,0,0,0.28)] ${cardClass}`}>
            <p className={`mb-4 text-[10px] font-black uppercase tracking-[0.28em] ${accentClass}`}>
              {TITLES[event]}
            </p>
            <p className="text-[1.12rem] sm:text-[1.3rem] font-semibold leading-7 sm:leading-8 text-balance">
              {message}
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
