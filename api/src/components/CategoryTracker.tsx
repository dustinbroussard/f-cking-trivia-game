import React from 'react';
import { CATEGORY_COLORS, getPlayableCategories } from '../types';
import { getCategoryIcon } from '../content/categoryIcons';

interface CategoryTrackerProps {
  completed: string[];
  playerName: string;
  avatarUrl?: string;
  isCurrentTurn?: boolean;
  score?: number;
  onAvatarClick?: () => void;
  unreadCount?: number;
  unreadBadgeClassName?: string;
}

export const CategoryTracker: React.FC<CategoryTrackerProps> = ({
  completed,
  playerName,
  avatarUrl,
  isCurrentTurn,
  score,
  onAvatarClick,
  unreadCount = 0,
  unreadBadgeClassName = 'bg-rose-500 text-white',
}) => {
  return (
    <div className={`rounded-2xl border p-3 sm:p-4 transition-all duration-500 ease-in-out ${isCurrentTurn ? 'border-purple-500/40 bg-purple-500/10 shadow-[0_8px_20px_rgba(168,85,247,0.15)] scale-[1.01]' : 'theme-panel'}`}>
      <div className="mb-3 flex items-center justify-between gap-3 sm:mb-4">
        <div className="flex items-center gap-3">
          {onAvatarClick ? (
            <button
              type="button"
              onClick={onAvatarClick}
              aria-label={`Open chat with ${playerName}`}
              className="relative cursor-pointer transition-transform active:scale-[0.97]"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="h-10 w-10 rounded-xl object-cover shadow-inner border theme-border sm:h-11 sm:w-11" />
              ) : (
                <div className="h-10 w-10 theme-avatar-surface rounded-xl flex items-center justify-center text-lg shadow-inner border sm:h-11 sm:w-11">
                  👤
                </div>
              )}
              {unreadCount > 0 && (
                <span className={`absolute -right-1.5 -top-1.5 min-w-5 h-5 px-1 rounded-full text-[10px] font-black flex items-center justify-center shadow-md ${unreadBadgeClassName}`}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          ) : (
            <div className="relative">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="h-10 w-10 rounded-xl object-cover shadow-inner border theme-border sm:h-11 sm:w-11" />
              ) : (
                <div className="h-10 w-10 theme-avatar-surface rounded-xl flex items-center justify-center text-lg shadow-inner border sm:h-11 sm:w-11">
                  👤
                </div>
              )}
            </div>
          )}
          <span className="text-xs font-bold uppercase tracking-[0.18em] theme-text-secondary sm:text-sm">
            {playerName} {score !== undefined && <span className="theme-text-muted ml-1">({score})</span>}
          </span>
        </div>
        {isCurrentTurn && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 animate-pulse bg-cyan-400/10 px-2 py-1 rounded-full">
            Active
          </span>
        )}
      </div>
      
      <div className="flex gap-1.5 justify-center flex-wrap sm:gap-2">
        {getPlayableCategories().map(cat => {
          const isDone = completed.includes(cat);
          const Icon = getCategoryIcon(cat);
          return (
            <div
              key={cat}
              className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center border transition-all duration-500 ${
                isDone 
                ? 'scale-105 shadow-md' 
                : 'opacity-35'
              }`}
              style={{ 
                backgroundColor: isDone ? CATEGORY_COLORS[cat] : 'transparent',
                borderColor: CATEGORY_COLORS[cat]
              }}
              title={cat}
            >
              {Icon && (
                <Icon
                  className={isDone ? 'w-4 h-4 sm:w-[18px] sm:h-[18px] text-black' : 'w-4 h-4 sm:w-[18px] sm:h-[18px]'}
                  style={{ color: isDone ? '#111111' : CATEGORY_COLORS[cat] }}
                  strokeWidth={2.5}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
