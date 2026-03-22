import React from 'react';
import { CATEGORIES, CATEGORY_COLORS } from '../types';

interface CategoryTrackerProps {
  completed: string[];
  playerName: string;
  avatarUrl?: string;
  isCurrentTurn?: boolean;
  score?: number;
}

export const CategoryTracker: React.FC<CategoryTrackerProps> = ({ completed, playerName, avatarUrl, isCurrentTurn, score }) => {
  return (
    <div className={`p-6 rounded-2xl border transition-all duration-500 ease-in-out ${isCurrentTurn ? 'border-purple-500/40 bg-purple-500/10 shadow-[0_8px_20px_rgba(168,85,247,0.15)] scale-[1.02]' : 'theme-panel'}`}>
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Avatar" className="w-10 h-10 rounded-xl object-cover shadow-inner border theme-border" />
          ) : (
            <div className="w-10 h-10 theme-avatar-surface rounded-xl flex items-center justify-center text-xl shadow-inner border">
              👤
            </div>
          )}
          <span className="text-sm font-bold uppercase tracking-widest theme-text-secondary">
            {playerName} {score !== undefined && <span className="theme-text-muted ml-1">({score})</span>}
          </span>
        </div>
        {isCurrentTurn && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 animate-pulse bg-cyan-400/10 px-2 py-1 rounded-full">
            Active
          </span>
        )}
      </div>
      
      <div className="flex gap-2 justify-center flex-wrap">
        {CATEGORIES.filter(c => c !== 'Random').map(cat => {
          const isDone = completed.includes(cat);
          return (
            <div
              key={cat}
              className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-500 ${
                isDone 
                ? 'scale-110 shadow-md' 
                : 'opacity-20 grayscale'
              }`}
              style={{ 
                backgroundColor: isDone ? CATEGORY_COLORS[cat] : 'transparent',
                borderColor: CATEGORY_COLORS[cat]
              }}
              title={cat}
            >
              {isDone && <span className="text-[10px] font-black text-black">✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
