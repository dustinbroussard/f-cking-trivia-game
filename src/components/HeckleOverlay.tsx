import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ResultCard } from './ResultCard';
import { isObviouslyInternalAiText } from '../services/aiText';

interface HeckleOverlayProps {
  message: string | null;
  visible: boolean;
  onClose: () => void;
}

export const HeckleOverlay: React.FC<HeckleOverlayProps> = ({ message, visible, onClose }) => {
  const displayMessage = message?.trim() ?? '';
  if (!visible || !displayMessage || isObviouslyInternalAiText(displayMessage)) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={displayMessage}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[55] flex items-center justify-center p-4 sm:p-6 pointer-events-auto"
      >
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 theme-overlay"
          initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
          animate={{ opacity: 0.56, backdropFilter: 'blur(3px)' }}
          exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
        />
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.965 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.98 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="relative z-10 w-full max-w-xl pointer-events-auto"
        >
          <ResultCard
            variant="commentary"
            label="Commentary Booth"
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
