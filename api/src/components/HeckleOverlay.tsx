import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface HeckleOverlayProps {
  message: string | null;
  visible: boolean;
}

export const HeckleOverlay: React.FC<HeckleOverlayProps> = ({ message, visible }) => {
  if (!visible || !message) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={message}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.99 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="w-full max-w-xl mx-auto"
      >
        <div className="theme-panel-strong border rounded-2xl px-6 py-5 shadow-[0_8px_30px_rgba(0,0,0,0.18)]">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-fuchsia-400 mb-2">
            Commentary Booth
          </p>
          <p className="text-base sm:text-lg font-semibold leading-relaxed whitespace-pre-line">
            {message}
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
