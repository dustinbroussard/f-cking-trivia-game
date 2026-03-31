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
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[55] flex items-center justify-center p-6 pointer-events-none"
      >
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 theme-overlay"
          initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
          animate={{ opacity: 0.7, backdropFilter: 'blur(5px)' }}
          exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
        />
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.965 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.98 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="relative z-10 w-full max-w-md"
        >
          <div className="theme-panel-strong border rounded-2xl min-h-[10.25rem] sm:min-h-[11rem] px-6 py-7 sm:px-8 sm:py-8 text-center shadow-[0_12px_36px_rgba(0,0,0,0.28),0_0_28px_rgba(217,70,239,0.12)] ring-1 ring-fuchsia-300/12">
            <p className="mb-4 text-[10px] font-black uppercase tracking-[0.28em] text-fuchsia-400">
              Commentary Booth
            </p>
            <p className="text-[1.12rem] sm:text-[1.34rem] font-semibold leading-7 sm:leading-8 whitespace-pre-line text-balance">
              {message}
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
