import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface RoastProps {
  message: string;
  isCorrect: boolean;
  onClose: () => void;
}

export const Roast: React.FC<RoastProps> = ({ message, isCorrect, onClose }) => {
  return (
    <AnimatePresence>
      <motion.div
        key="roast-modal"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="fixed inset-0 flex items-center justify-center z-50 p-6 bg-black/60 backdrop-blur-sm pointer-events-auto"
      >
        <div className={`p-10 rounded-3xl border border-white/10 shadow-2xl max-w-md w-full text-center ${
          isCorrect ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'
        }`}>
          <h3 className={`text-4xl font-black uppercase tracking-tight mb-4 ${
            isCorrect ? 'text-emerald-400' : 'text-rose-400'
          }`}>
            {isCorrect ? 'Correct!' : 'Roasted!'}
          </h3>
          <p className="text-xl font-medium text-white leading-relaxed mb-8">
            "{message}"
          </p>
          <button
            onClick={onClose}
            className={`w-full py-4 rounded-2xl text-sm font-bold uppercase tracking-widest hover:scale-105 transition-transform shadow-lg ${
              isCorrect ? 'bg-emerald-500 text-black shadow-emerald-500/20' : 'bg-rose-500 text-white shadow-rose-500/20'
            }`}
          >
            Continue
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
