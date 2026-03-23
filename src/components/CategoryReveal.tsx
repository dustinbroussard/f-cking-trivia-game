import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CATEGORY_COLORS } from '../types';
import { getCategoryIcon } from '../content/categoryIcons';

interface CategoryRevealProps {
  category: string | null;
}

export const CategoryReveal: React.FC<CategoryRevealProps> = ({ category }) => {
  const Icon = category ? getCategoryIcon(category) : null;
  const accentColor = category ? CATEGORY_COLORS[category] || '#FFFFFF' : '#FFFFFF';

  return (
    <AnimatePresence>
      {category && (
        <motion.div
          key="category-reveal"
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 20 }}
          className="fixed inset-0 flex items-center justify-center z-50 p-6 theme-overlay backdrop-blur-sm pointer-events-none"
        >
          <div
            className="p-10 rounded-2xl border shadow-[0_8px_30px_rgb(0,0,0,0.25)] max-w-md w-full text-center transition-all duration-300 ease-in-out"
            style={{
              backgroundColor: 'var(--app-bg-panel)',
              borderColor: `${accentColor}66`,
            }}
          >
            <p className="text-xs font-black uppercase tracking-[0.3em] theme-text-muted mb-4">
              Next Category
            </p>
            <div
              className="w-20 h-20 mx-auto mb-5 rounded-2xl flex items-center justify-center shadow-lg"
              style={{ backgroundColor: accentColor }}
            >
              {Icon && <Icon className="w-10 h-10 text-black" strokeWidth={2.5} />}
            </div>
            <h3
              className="text-4xl font-black uppercase tracking-tight"
              style={{ color: accentColor }}
            >
              {category}
            </h3>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
