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
      className="w-full max-w-2xl mx-auto p-8 bg-zinc-900/80 backdrop-blur-md border border-white/10 rounded-3xl shadow-2xl"
    >
      <div className="flex items-center justify-between mb-8">
        <div 
          className="inline-block px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest"
          style={{ backgroundColor: CATEGORY_COLORS[question.category] || '#fff', color: '#000' }}
        >
          {question.category}
        </div>
      </div>
      
      <h2 className="text-3xl font-black text-white mb-10 leading-tight">
        {question.question}
      </h2>
      
      <div className="space-y-4">
        {question.choices.map((choice, i) => {
          const isSelected = selectedId === i;
          const isCorrect = correctId === i;
          const isWrong = isSelected && correctId !== null && !isCorrect;
          
          let borderColor = 'border-white/10';
          let bgColor = 'bg-zinc-800/50';
          let textColor = 'text-zinc-300';
          
          if (isCorrect) {
            borderColor = 'border-emerald-500/50';
            bgColor = 'bg-emerald-500/20';
            textColor = 'text-emerald-400';
          } else if (isWrong) {
            borderColor = 'border-rose-500/50';
            bgColor = 'bg-rose-500/20';
            textColor = 'text-rose-400';
          } else if (isSelected) {
            borderColor = 'border-purple-500/50';
            bgColor = 'bg-purple-500/20';
            textColor = 'text-purple-400';
          }

          return (
            <motion.button
              key={i}
              whileHover={!disabled ? { scale: 1.01, backgroundColor: 'rgba(255,255,255,0.05)' } : {}}
              whileTap={!disabled ? { scale: 0.99 } : {}}
              onClick={() => !disabled && onSelect(i)}
              disabled={disabled}
              className={`w-full p-5 text-left rounded-2xl border transition-all ${borderColor} ${bgColor} group`}
            >
              <div className="flex items-center gap-4">
                <span className={`w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-950/50 text-xs font-bold transition-colors ${isSelected ? 'text-white' : 'text-zinc-500'}`}>
                  {String.fromCharCode(65 + i)}
                </span>
                <span className={`font-medium text-lg ${textColor}`}>
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
