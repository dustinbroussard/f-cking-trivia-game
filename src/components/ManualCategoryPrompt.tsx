import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CATEGORY_COLORS } from '../types';

interface ManualCategoryPromptProps {
  categories: string[];
  completedCategories?: string[];
  source?: 'streak' | 'wheel';
  onPickCategory: (category: string) => void;
  onSpinWheel: () => void;
}

export const ManualCategoryPrompt: React.FC<ManualCategoryPromptProps> = ({
  categories,
  completedCategories = [],
  source = 'streak',
  onPickCategory,
  onSpinWheel,
}) => {
  const isWheelReward = source === 'wheel';

  return (
    <AnimatePresence>
      <motion.div
        key="manual-category-prompt"
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        className="fixed inset-0 z-[80] flex items-center justify-center p-4 theme-overlay backdrop-blur-sm"
      >
        <div className="w-full max-w-2xl rounded-2xl border p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] theme-panel-strong sm:p-8">
          <p className="mb-3 text-[0.625rem] font-black uppercase tracking-[0.28em] text-cyan-400">
            {isWheelReward ? "Wheel's Choice" : "Player's Choice Unlocked"}
          </p>
          <h3 className="mb-2 text-2xl font-black sm:text-3xl">Pick your next move.</h3>
          <p className="mb-6 text-sm theme-text-secondary sm:text-base">
            {isWheelReward
              ? 'The wheel landed on Player’s Choice. Pick any category or spin again.'
              : 'Two correct answers. Pick your next category or spin the wheel.'}
          </p>

          <div className="mb-6 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3">
            {categories.map((category) => {
              const isCompleted = completedCategories.includes(category);

              return (
                <button
                  type="button"
                  key={category}
                  onClick={() => onPickCategory(category)}
                  aria-label={isCompleted ? `${category} category already claimed` : `Choose ${category} category`}
                  disabled={isCompleted}
                  className={`min-h-14 rounded-xl border border-white/10 px-4 py-4 text-left font-black text-black shadow-md transition-all duration-300 ${
                    isCompleted
                      ? 'cursor-not-allowed opacity-55 saturate-50 brightness-75'
                      : 'hover:scale-[1.02]'
                  }`}
                  style={{ backgroundColor: CATEGORY_COLORS[category] || '#fff' }}
                >
                  <span
                    className="block text-[1.05rem] font-black leading-tight"
                    style={{ textShadow: '0 1px 0 rgba(255,255,255,0.22), 0 1.5px 3px rgba(0,0,0,0.18)' }}
                  >
                    {category}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onSpinWheel}
            aria-label="Spin the wheel instead of choosing a category"
            className="w-full rounded-xl border py-4 text-sm font-bold uppercase tracking-widest transition-all duration-300 theme-button theme-border"
          >
            Spin Wheel Instead
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
