import React from 'react';
import { motion } from 'motion/react';
import { TriviaQuestion, CATEGORY_COLORS } from '../types';

interface QuestionCardProps {
  question: TriviaQuestion;
  onSelect: (index: number) => void;
  disabled?: boolean;
  selectedId?: number | null;
  correctId?: number | null;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({ 
  question, 
  onSelect, 
  disabled,
  selectedId,
  correctId
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md mx-auto p-8 bg-black border-2 border-purple-500/30 rounded-[2.5rem] shadow-[0_0_50px_rgba(168,85,247,0.1)]"
    >
      <div 
        className="inline-block px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest mb-6"
        style={{ backgroundColor: CATEGORY_COLORS[question.category] || '#fff', color: '#000' }}
      >
        {question.category}
      </div>
      
      <h2 className="text-2xl font-black text-white mb-8 leading-tight font-display">
        {question.question}
      </h2>
      
      <div className="space-y-4">
        {question.choices.map((choice, i) => {
          const isSelected = selectedId === i;
          const isCorrect = correctId === i;
          const isWrong = isSelected && correctId !== null && !isCorrect;
          
          let borderColor = 'border-zinc-800';
          let bgColor = 'bg-zinc-900/50';
          let textColor = 'text-zinc-300';
          
          if (isCorrect) {
            borderColor = 'border-emerald-500';
            bgColor = 'bg-emerald-500/20';
            textColor = 'text-emerald-400';
          } else if (isWrong) {
            borderColor = 'border-rose-500';
            bgColor = 'bg-rose-500/20';
            textColor = 'text-rose-400';
          } else if (isSelected) {
            borderColor = 'border-white';
            bgColor = 'bg-white/10';
            textColor = 'text-white';
          }

          return (
            <motion.button
              key={i}
              whileHover={!disabled ? { scale: 1.02, backgroundColor: 'rgba(255,255,255,0.05)' } : {}}
              whileTap={!disabled ? { scale: 0.98 } : {}}
              onClick={() => !disabled && onSelect(i)}
              disabled={disabled}
              className={`w-full p-5 text-left rounded-2xl border-2 transition-all ${borderColor} ${bgColor} group`}
            >
              <div className="flex items-center gap-4">
                <span className={`w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 text-xs font-black transition-colors ${isSelected ? 'text-white bg-zinc-700' : 'text-zinc-500'}`}>
                  {String.fromCharCode(65 + i)}
                </span>
                <span className={`font-bold text-lg ${textColor}`}>
                  {choice}
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
};
