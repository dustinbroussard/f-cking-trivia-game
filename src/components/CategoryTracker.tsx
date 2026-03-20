import React from 'react';
import { CATEGORIES, CATEGORY_COLORS } from '../types';

interface CategoryTrackerProps {
  completed: string[];
  playerName: string;
  isCurrentTurn?: boolean;
}

export const CategoryTracker: React.FC<CategoryTrackerProps> = ({ completed, playerName, isCurrentTurn }) => {
  return (
    <div className={`p-6 rounded-[2rem] border-2 transition-all ${isCurrentTurn ? 'border-purple-500/50 bg-purple-500/5 shadow-[0_0_30px_rgba(168,85,247,0.1)]' : 'border-zinc-800 bg-zinc-900/30'}`}>
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm font-black uppercase tracking-widest text-zinc-400">
          {playerName}
        </span>
        {isCurrentTurn && (
          <span className="text-[10px] font-black uppercase tracking-widest text-cyan-400 animate-pulse">
            ACTIVE
          </span>
        )}
      </div>
      
      <div className="flex gap-2.5 justify-center">
        {CATEGORIES.filter(c => c !== 'Random').map(cat => {
          const isDone = completed.includes(cat);
          return (
            <div
              key={cat}
              className={`w-9 h-9 rounded-xl flex items-center justify-center border-2 transition-all duration-500 ${
                isDone 
                ? 'scale-110 shadow-lg rotate-3' 
                : 'opacity-10 grayscale'
              }`}
              style={{ 
                backgroundColor: isDone ? CATEGORY_COLORS[cat] : 'transparent',
                borderColor: CATEGORY_COLORS[cat]
              }}
            >
              {isDone && <span className="text-xs font-black text-black">✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
