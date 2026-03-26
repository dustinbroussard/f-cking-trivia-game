import React from 'react';
import { motion } from 'motion/react';
import { TriviaQuestion, CATEGORY_COLORS } from '../types';

interface QuestionCardProps {
  question: TriviaQuestion;
  onSelect: (index: number) => void;
  disabled?: boolean;
  selectedId?: number | null;
  correctId?: number | null;
  timerProgress?: number;
  timeRemaining?: number;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({ 
  question, 
  onSelect, 
  disabled,
  selectedId,
  correctId,
  timerProgress = 1,
  timeRemaining = 15,
}) => {
  const clampedProgress = Math.max(0, Math.min(1, timerProgress));
  const timerColor = clampedProgress <= 0.33 ? '#F43F5E' : '#06B6D4';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-2xl mx-auto theme-panel-strong backdrop-blur-md border rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-500 ease-in-out overflow-hidden p-4 sm:p-6 md:p-8 max-h-[min(76dvh,48rem)] flex flex-col"
    >
      <div className="mb-4 sm:mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] theme-text-muted">
            Time Remaining
          </span>
          <span
            className="text-sm font-black tabular-nums transition-colors duration-300"
            style={{ color: timerColor }}
          >
            {timeRemaining}s
          </span>
        </div>
        <div className="h-2 rounded-full theme-soft-surface overflow-hidden">
          <motion.div
            animate={{ width: `${clampedProgress * 100}%`, backgroundColor: timerColor }}
            transition={{ duration: 0.25, ease: 'linear' }}
            className="h-full rounded-full"
          />
        </div>
      </div>

      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <div 
          className="inline-block px-3 py-1.5 rounded-xl text-[11px] font-bold uppercase tracking-widest shadow-sm sm:px-4"
          style={{ backgroundColor: CATEGORY_COLORS[question.category] || '#fff', color: '#000' }}
        >
          {question.category}
        </div>
      </div>
      
      <div className="min-h-0 overflow-y-auto pr-1 custom-scrollbar">
        <h2 className="text-xl sm:text-2xl md:text-3xl font-black mb-5 sm:mb-7 leading-tight">
          {question.question}
        </h2>
      
        <div className="space-y-3 sm:space-y-4">
          {question.choices.map((choice, i) => {
            const isSelected = selectedId === i;
            const isCorrect = correctId === i;
            const isWrong = isSelected && correctId !== null && !isCorrect;
            
            let borderColor = 'theme-border';
            let bgColor = 'theme-soft-surface';
            let textColor = 'theme-text-secondary';
            
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
              <motion.button type="button"
                key={i}
                whileHover={!disabled ? { scale: 1.01, backgroundColor: 'var(--app-hover)' } : {}}
                whileTap={!disabled ? { scale: 0.99 } : {}}
                onClick={() => !disabled && onSelect(i)}
                disabled={disabled}
                aria-pressed={isSelected}
                aria-label={`Answer ${String.fromCharCode(65 + i)}: ${choice}`}
                className={`w-full p-3 sm:p-4 md:p-5 text-left rounded-xl border transition-all duration-300 ease-in-out hover:shadow-md ${borderColor} ${bgColor} group`}
              >
                <div className="flex items-center gap-3 sm:gap-4">
                  <span className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg shadow-inner theme-avatar-surface text-xs font-bold transition-colors duration-300 ${isSelected ? 'text-white' : 'theme-text-muted'}`}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className={`font-medium text-base sm:text-lg ${textColor}`}>
                    {choice}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};
