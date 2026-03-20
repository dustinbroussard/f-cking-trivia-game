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
        initial={{ opacity: 0, scale: 0.8, y: 50 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.8, y: 50 }}
        className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
      >
        <div className={`p-10 rounded-[3rem] border-4 border-black shadow-[0_0_60px_rgba(0,0,0,0.5)] max-w-sm w-full text-center pointer-events-auto ${
          isCorrect ? 'bg-cyan-400' : 'bg-rose-500'
        }`}>
          <h3 className="text-5xl font-black text-black uppercase italic mb-6 leading-none tracking-tighter">
            {isCorrect ? 'SMUG!' : 'ROASTED!'}
          </h3>
          <p className="text-2xl font-black text-black leading-tight mb-8 font-display">
            "{message}"
          </p>
          <button
            onClick={onClose}
            className="w-full py-4 bg-black text-white rounded-2xl text-sm font-black uppercase tracking-widest hover:scale-105 transition-transform shadow-lg"
          >
            CONTINUE
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
