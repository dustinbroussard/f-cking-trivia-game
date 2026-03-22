import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface RoastProps {
  message?: string | null;
  explanation: string;
  isCorrect: boolean;
  onClose: () => void;
}

export const Roast: React.FC<RoastProps> = ({ message, explanation, isCorrect, onClose }) => {
  return (
    <AnimatePresence>
      <motion.div
        key="roast-modal"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="fixed inset-0 flex items-center justify-center z-50 p-6 theme-overlay backdrop-blur-sm pointer-events-auto"
      >
        <div className={`p-10 rounded-2xl border shadow-[0_8px_30px_rgb(0,0,0,0.25)] max-w-md w-full text-center transition-all duration-300 ease-in-out ${
          isCorrect ? 'bg-emerald-950/40 border-emerald-500/30' : 'bg-rose-950/40 border-rose-500/30'
        }`}>
          <h3 className={`text-4xl font-black uppercase tracking-tight mb-4 ${
            isCorrect ? 'text-emerald-400' : 'text-rose-400'
          }`}>
            {isCorrect ? 'Correct!' : 'Wrong!'}
          </h3>
          <p className="text-lg font-semibold leading-relaxed mb-3">
            {explanation}
          </p>
          {message && (
            <p className="text-sm theme-text-muted leading-relaxed mb-8">
              {message}
            </p>
          )}
          <button
            onClick={onClose}
            className={`w-full py-4 rounded-xl text-sm font-bold uppercase tracking-widest hover:scale-[1.02] transition-all duration-300 ease-in-out shadow-lg ${
              isCorrect ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950 shadow-emerald-500/25' : 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/25'
            }`}
          >
            Continue
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
