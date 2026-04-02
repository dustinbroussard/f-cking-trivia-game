import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { TrashTalkEvent } from '../content/trashTalk';
import { ResultCard } from './ResultCard';

interface TrashTalkOverlayProps {
  event: TrashTalkEvent | null;
  message: string | null;
  onClose: () => void;
}

export const TrashTalkOverlay: React.FC<TrashTalkOverlayProps> = ({ event, message, onClose }) => {
  if (!event) return null;

  const displayMessage = message?.trim() || 'Couldn’t format commentary.';

  return (
    <AnimatePresence>
      <motion.div
        key={`${event}-${displayMessage}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 pointer-events-auto"
      >
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 theme-overlay"
          initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
          animate={{ opacity: 0.5, backdropFilter: 'blur(3px)' }}
          exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        />
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.98 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="relative z-10 w-full max-w-xl pointer-events-auto"
        >
          <ResultCard
            variant="trashTalk"
            label="Trash Talk"
            actionLabel="Continue"
            onAction={onClose}
            className="w-full"
            body={
              <p className="whitespace-pre-line text-balance">
                {displayMessage}
              </p>
            }
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
