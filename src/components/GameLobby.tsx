import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Trophy, Users, Gamepad2, User, Upload, Bell, SendHorizontal, Check, X, BarChart3, Trash2, Pencil } from 'lucide-react';
import { publicAsset } from '../assets';
import { CategoryPerformance, GameInvite, MatchupSummary, PlayerProfile, PlayerStatsSummary, RecentCompletedGame, RecentPlayer } from '../types';
import { MAX_NICKNAME_LENGTH, sanitizeNicknameInput } from '../services/playerProfiles';

interface GameLobbyProps {
  onStartSolo: (avatarUrl: string) => void;
  onStartMulti: (avatarUrl: string) => void;
  onJoinMulti: (code: string, avatarUrl: string) => void;
  isLoading?: boolean;
  loadingTitle?: string;
  loadingFlow?: string;
  recentPlayers: RecentPlayer[];
  recentPlayersStatus?: 'loading' | 'empty' | 'error' | 'success';
  recentPlayersError?: string | null;
  playerProfile: PlayerProfile | null;
  profileError?: string | null;
  recentCompletedGames: RecentCompletedGame[];
  recentCompletedGamesStatus?: 'loading' | 'empty' | 'error' | 'success';
  recentCompletedGamesError?: string | null;
  selectedMatchup: { opponentId: string; summary: MatchupSummary | null; games: RecentCompletedGame[] } | null;
  isLoadingMatchup: boolean;
  incomingInvites: GameInvite[];
  incomingInvitesStatus?: 'loading' | 'empty' | 'error' | 'success';
  incomingInvitesError?: string | null;
  onInviteRecentPlayer: (player: RecentPlayer, avatarUrl: string) => void;
  onInspectMatchup: (player: RecentPlayer) => void;
  onCloseMatchup: () => void;
  onRemoveRecentPlayer: (player: RecentPlayer) => void;
  onAcceptInvite: (invite: GameInvite, avatarUrl: string) => void;
  onDeclineInvite: (invite: GameInvite) => void;
  onAvatarChange: (avatarUrl: string) => void | Promise<void>;
  onAvatarRemove: () => void | Promise<void>;
  inviteFeedback?: string | null;
  displayName: string;
  nickname: string;
  isEditingNickname: boolean;
  isSavingNickname: boolean;
  onNicknameChange: (value: string) => void;
  onStartNicknameEdit: () => void;
  onSaveNickname: () => void | Promise<void>;
  onCancelNicknameEdit: () => void;
}

type LobbyMode = 'IDLE' | 'JOIN' | 'STATS' | 'RECENT_PLAYERS' | 'LOADING';

const EMPTY_STATS: PlayerStatsSummary = {
  completedGames: 0,
  wins: 0,
  losses: 0,
  winPercentage: 0,
  totalQuestionsSeen: 0,
  totalQuestionsCorrect: 0,
  categoryPerformance: {},
};

function getProfileStats(profile: PlayerProfile | null): PlayerStatsSummary {
  const rawStats = profile?.stats;

  if (rawStats) {
    return {
      ...EMPTY_STATS,
      ...rawStats,
      categoryPerformance: rawStats.categoryPerformance || {},
    };
  }

  const legacyProfile = (profile || {}) as PlayerProfile & {
    completedGames?: number;
    wins?: number;
    losses?: number;
    totalQuestionsSeen?: number;
    totalQuestionsCorrect?: number;
    categoryPerformance?: Record<string, CategoryPerformance>;
  };
  const completedGames = Number(legacyProfile.completedGames ?? 0);
  const wins = Number(legacyProfile.wins ?? 0);
  const losses = Number(legacyProfile.losses ?? 0);
  const totalQuestionsSeen = Number(legacyProfile.totalQuestionsSeen ?? 0);
  const totalQuestionsCorrect = Number(legacyProfile.totalQuestionsCorrect ?? 0);

  return {
    completedGames,
    wins,
    losses,
    winPercentage: completedGames > 0 ? Math.round((wins / completedGames) * 100) : 0,
    totalQuestionsSeen,
    totalQuestionsCorrect,
    categoryPerformance: legacyProfile.categoryPerformance || {},
  };
}

function getDisplayName(value: { nickname?: string; displayName?: string; name?: string } | null | undefined) {
  return value?.displayName || value?.nickname || value?.name || 'Player';
}

function getAvatarUrl(value: { avatarUrl?: string; photoURL?: string } | null | undefined) {
  return value?.avatarUrl || value?.photoURL;
}

export const GameLobby: React.FC<GameLobbyProps> = ({
  onStartSolo,
  onStartMulti,
  onJoinMulti,
  isLoading = false,
  loadingTitle = 'Working',
  loadingFlow = 'Working',
  recentPlayers,
  recentPlayersStatus = 'empty',
  recentPlayersError = null,
  playerProfile,
  profileError = null,
  recentCompletedGames,
  recentCompletedGamesStatus = 'empty',
  recentCompletedGamesError = null,
  selectedMatchup,
  isLoadingMatchup,
  incomingInvites,
  incomingInvitesStatus = 'empty',
  incomingInvitesError = null,
  onInviteRecentPlayer,
  onInspectMatchup,
  onCloseMatchup,
  onRemoveRecentPlayer,
  onAcceptInvite,
  onDeclineInvite,
  onAvatarChange,
  onAvatarRemove,
  inviteFeedback,
  displayName,
  nickname,
  isEditingNickname,
  isSavingNickname,
  onNicknameChange,
  onStartNicknameEdit,
  onSaveNickname,
  onCancelNicknameEdit,
}) => {
  const logoSrc = publicAsset('logo.png');
  const [joinCode, setJoinCode] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('');
  const [currentMode, setCurrentMode] = useState<LobbyMode>('IDLE');
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileStats = getProfileStats(playerProfile);

  useEffect(() => {
    console.info('[GameLobby] mounted');
    return () => {
      console.info('[GameLobby] unmounted');
    };
  }, []);

  useEffect(() => {
    if (selectedMatchup && currentMode !== 'RECENT_PLAYERS') {
      setCurrentMode('RECENT_PLAYERS');
    }
  }, [currentMode, selectedMatchup]);

  useEffect(() => {
    // App-level async work owns loading. The lobby mirrors that into one render mode so
    // buttons, join inputs, and modals are never mounted alongside the loading handoff.
    if (isLoading) {
      setCurrentMode('LOADING');
      return;
    }

    setCurrentMode((mode) => (mode === 'LOADING' ? 'IDLE' : mode));
  }, [isLoading]);

  useEffect(() => {
    if (currentMode !== 'JOIN' && joinCode) {
      setJoinCode('');
    }
  }, [currentMode, joinCode]);

  useEffect(() => {
    setSelectedAvatar(playerProfile?.avatarUrl || '');
  }, [playerProfile?.avatarUrl]);

  const effectiveAvatar = selectedAvatar || playerProfile?.avatarUrl || '';

  useEffect(() => {
    if (!effectiveAvatar && isAvatarMenuOpen) {
      setIsAvatarMenuOpen(false);
    }
  }, [effectiveAvatar, isAvatarMenuOpen]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 150;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        // Compress to base64 jpeg
        const nextAvatar = canvas.toDataURL('image/jpeg', 0.8);
        console.info('[GameLobby] avatar upload result', {
          mimeType: file.type,
          originalSizeBytes: file.size,
          previewLength: nextAvatar.length,
        });
        setSelectedAvatar(nextAvatar);
        setIsAvatarMenuOpen(false);
        Promise.resolve(onAvatarChange(nextAvatar)).catch((error) => {
          console.error('[GameLobby] avatar upload/save failed', error);
          setSelectedAvatar(playerProfile?.avatarUrl || '');
        });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const overallAccuracy = profileStats.totalQuestionsSeen
    ? Math.round((profileStats.totalQuestionsCorrect / profileStats.totalQuestionsSeen) * 100)
    : 0;
  const isInteractionLocked = currentMode === 'LOADING';
  const isStatsOpen = currentMode === 'STATS';
  const isRecentPlayersOpen = currentMode === 'RECENT_PLAYERS';
  // The large CTA stack only exists in the neutral lobby state.
  const showPrimaryActions = currentMode === 'IDLE';
  const isJoinMode = currentMode === 'JOIN';
  const showLobbyModal = isStatsOpen || isRecentPlayersOpen;
  const inviteCount = incomingInvites.length;
  const shouldShowInviteSection =
    incomingInvitesStatus === 'loading' || incomingInvitesStatus === 'error' || inviteCount > 0;

  useEffect(() => {
    console.info('[GameLobby] invite render state', {
      currentMode,
      showPrimaryActions,
      shouldShowInviteSection,
      incomingInvitesStatus,
      incomingInvitesError,
      inviteCount,
      invites: incomingInvites,
    });
  }, [
    currentMode,
    showPrimaryActions,
    shouldShowInviteSection,
    incomingInvitesStatus,
    incomingInvitesError,
    inviteCount,
    incomingInvites,
  ]);

  const closeLobbyModal = () => {
    if (selectedMatchup) {
      onCloseMatchup();
    }
    setCurrentMode('IDLE');
  };

  const handleToggleStats = () => {
    if (isInteractionLocked) return;
    setCurrentMode((mode) => mode === 'STATS' ? 'IDLE' : 'STATS');
    if (selectedMatchup) {
      onCloseMatchup();
    }
  };

  const handleToggleRecentPlayers = () => {
    if (isInteractionLocked) return;
    setCurrentMode((mode) => mode === 'RECENT_PLAYERS' ? 'IDLE' : 'RECENT_PLAYERS');
  };

  const handleStartSolo = () => {
    if (isInteractionLocked) return;
    // One lobby mode owns the entire handoff so buttons disappear before async work begins.
    setCurrentMode('LOADING');
    onStartSolo(effectiveAvatar);
  };

  const handleStartMulti = () => {
    if (isInteractionLocked) return;
    setCurrentMode('LOADING');
    onStartMulti(effectiveAvatar);
  };

  const handleJoinSubmit = () => {
    if (isInteractionLocked || joinCode.trim().length < 32) return;
    setCurrentMode('LOADING');
    onJoinMulti(joinCode.trim(), effectiveAvatar);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[min(100%,34rem)] flex-col items-center gap-5 px-4 pt-4 pb-5 sm:gap-6 sm:px-6 sm:pt-6 sm:pb-6">
      <div className="text-center relative shrink-0">
        <div className="relative inline-block aspect-square w-[min(72vw,16rem)] sm:w-[min(60vw,16rem)]">
          <img
            src={logoSrc}
            alt="A F-cking Trivia Game"
            className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]"
            decoding="async"
            fetchPriority="high"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>

      <div className="w-full space-y-2 flex flex-col items-center shrink-0">
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          className="hidden"
          onChange={handleImageUpload}
        />

        <div className="relative flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (isInteractionLocked) return;
              setIsAvatarMenuOpen((open) => !open);
            }}
            aria-label="Open avatar options"
            aria-expanded={isAvatarMenuOpen}
            disabled={isInteractionLocked}
            className="group relative flex h-20 w-20 max-h-[20vw] max-w-[20vw] min-h-16 min-w-16 items-center justify-center overflow-hidden rounded-2xl border-2 theme-panel-strong shadow-xl transition-all duration-300 ease-in-out hover:border-pink-500 hover:shadow-pink-500/20 sm:h-24 sm:w-24 sm:max-h-24 sm:max-w-24"
          >
            {effectiveAvatar ? (
              <img src={effectiveAvatar} alt="Avatar" className="h-full w-full object-cover" decoding="async" loading="lazy" />
            ) : (
              <User className="w-8 h-8 theme-text-muted group-hover:text-pink-500 transition-colors" />
            )}

            <div className="absolute inset-0 theme-overlay flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white">
              <Upload className="w-5 h-5" />
            </div>
          </button>

          {isEditingNickname ? (
            <div className="flex w-full max-w-[16rem] flex-col items-center gap-2">
              <input
                type="text"
                value={nickname}
                onChange={(event) => onNicknameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void onSaveNickname();
                  }
                  if (event.key === 'Escape') {
                    onCancelNicknameEdit();
                  }
                }}
                maxLength={MAX_NICKNAME_LENGTH}
                className="h-10 w-full rounded-xl border bg-transparent px-3 text-center text-sm font-bold tracking-wide theme-panel theme-inset focus:outline-none focus:ring-2 focus:ring-pink-500/50"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onSaveNickname()}
                  disabled={isSavingNickname || !sanitizeNicknameInput(nickname)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-pink-600 text-white transition-all disabled:opacity-50"
                  aria-label={isSavingNickname ? 'Saving nickname' : 'Save nickname'}
                  title={isSavingNickname ? 'Saving nickname' : 'Save nickname'}
                >
                  {isSavingNickname ? (
                    <span className="text-sm font-black">...</span>
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={onCancelNicknameEdit}
                  disabled={isSavingNickname}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full theme-button transition-all disabled:opacity-50"
                  aria-label="Cancel nickname edit"
                  title="Cancel nickname edit"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={onStartNicknameEdit}
              className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] theme-button theme-text-muted transition-colors"
              title="Edit nickname"
              aria-label="Edit nickname"
            >
              <span className="max-w-[12rem] truncate">{displayName}</span>
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}

          <AnimatePresence>
            {isAvatarMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                className="absolute top-full z-10 mt-2 flex min-w-[11rem] flex-col gap-2 rounded-2xl border p-2 theme-panel-strong shadow-2xl"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (isInteractionLocked) return;
                    setIsAvatarMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl theme-button px-3 py-2 text-[0.625rem] font-black uppercase tracking-[0.08em] transition-all duration-300"
                >
                  <Upload className="w-4 h-4" />
                  {effectiveAvatar ? 'Replace Avatar' : 'Choose Avatar'}
                </button>
                {effectiveAvatar && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isInteractionLocked) return;
                      setSelectedAvatar('');
                      setIsAvatarMenuOpen(false);
                      void onAvatarRemove();
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-xl theme-button px-3 py-2 text-[0.625rem] font-black uppercase tracking-[0.08em] text-rose-300 transition-all duration-300"
                  >
                    <Trash2 className="w-4 h-4" />
                    Remove Avatar
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="w-full space-y-3 relative">
        {showPrimaryActions && (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleToggleStats}
              aria-label="Show stats and match history"
              title="Show stats and match history"
              className="flex min-h-12 items-center justify-center rounded-xl border theme-panel-strong transition-all duration-300 sm:min-h-12"
            >
              <BarChart3 className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={handleToggleRecentPlayers}
              aria-label={`Show notifications, invites, and recent players${inviteCount > 0 ? ` (${inviteCount} pending invites)` : ''}`}
              title="Show notifications and recent players"
              className="relative flex min-h-12 items-center justify-center rounded-xl border theme-panel-strong transition-all duration-300 sm:min-h-12"
            >
              <Bell className="w-5 h-5" />
              {inviteCount > 0 && (
                <span className="absolute right-2 top-1.5 min-w-5 h-5 px-1 rounded-full bg-pink-500 text-white text-[0.625rem] font-black leading-none flex items-center justify-center shadow-lg shadow-pink-500/30">
                  {inviteCount > 99 ? '99+' : inviteCount}
                </span>
              )}
            </button>
          </div>
        )}

        {currentMode === 'LOADING' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full theme-panel-strong backdrop-blur-xl border rounded-2xl p-6 shadow-2xl"
            role="status"
            aria-live="polite"
          >
            <div className="flex flex-col items-center justify-center text-center">
              <div className="mb-4 rounded-full border border-pink-500/30 bg-pink-500/10 p-3">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-pink-400/30 border-t-pink-400" />
              </div>
              <p className="text-base font-bold theme-text-secondary">{loadingTitle}</p>
              <p className="mt-2 text-xs font-bold uppercase tracking-widest theme-text-muted">
                {loadingFlow}
              </p>
            </div>
          </motion.div>
        )}

        {showPrimaryActions && (
          <>
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleStartSolo}
              aria-label="Start a solo game"
              className="flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-lg font-bold text-white shadow-lg transition-all duration-300 ease-in-out hover:shadow-cyan-500/25 sm:min-h-16 sm:text-xl"
            >
              <Trophy className="w-6 h-6" />
              Solo Mode
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleStartMulti}
              aria-label="Create a multiplayer game"
              className="flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-lg font-bold text-white shadow-lg transition-all duration-300 ease-in-out hover:shadow-pink-500/25 sm:min-h-16 sm:text-xl"
            >
              <Gamepad2 className="w-6 h-6" />
              Start New Game
            </motion.button>

            <div className="space-y-2">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setCurrentMode('JOIN')}
                aria-label="Show join game code entry"
                className="flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-amber-500 to-pink-500 text-lg font-bold text-white shadow-lg transition-all duration-300 ease-in-out hover:shadow-amber-500/25 sm:min-h-16 sm:text-xl"
              >
                <Users className="w-6 h-6" />
                Join Game
              </motion.button>
            </div>
          </>
        )}

        {isJoinMode && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full theme-panel-strong border rounded-2xl p-4 sm:p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.625rem] font-black uppercase tracking-[0.22em] theme-text-muted mb-1">Join Match</p>
                <p className="text-sm theme-text-secondary">Paste the match ID to connect.</p>
              </div>
              <button
                type="button"
                onClick={() => setCurrentMode('IDLE')}
                aria-label="Close join game code entry"
                className="p-2 rounded-xl theme-button shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                aria-label="Enter match ID"
                maxLength={36}
                placeholder="match-id"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.trim().toLowerCase())}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                className="min-h-14 flex-1 rounded-xl border px-4 text-center text-sm font-bold transition-all duration-300 ease-in-out theme-input focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 shadow-inner sm:text-base"
              />
              <button
                type="button"
                onClick={handleJoinSubmit}
                aria-label="Join multiplayer game"
                disabled={joinCode.trim().length < 32}
                className="min-h-14 rounded-xl bg-pink-500 px-6 font-black uppercase text-white shadow-md transition-all duration-300 ease-in-out hover:bg-pink-600 disabled:opacity-50 sm:min-w-24"
              >
                GO
              </button>
            </div>
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {showLobbyModal && (
          <motion.div
            key="lobby-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] flex items-center justify-center p-4 theme-overlay backdrop-blur-sm"
            onClick={closeLobbyModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby={isStatsOpen ? 'lobby-stats-title' : 'lobby-recent-players-title'}
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-lg max-h-[80dvh] theme-panel-strong backdrop-blur-xl border rounded-[1.75rem] p-4 sm:p-5 shadow-2xl flex flex-col"
            >
              {isStatsOpen && (
                <>
                  <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-cyan-400" />
                      <h4 id="lobby-stats-title" className="text-sm font-black uppercase tracking-widest">Stats & Match History</h4>
                    </div>
                    <button type="button" onClick={closeLobbyModal} className="p-2 rounded-xl theme-button" aria-label="Close stats panel">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="overflow-y-auto custom-scrollbar pr-1 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="theme-soft-surface border rounded-2xl p-4 flex flex-col justify-center">
                        <p className="text-[0.625rem] uppercase tracking-widest theme-text-muted mb-1">Win Rate</p>
                        <p className="text-3xl font-black">{profileStats.winPercentage}%</p>
                      </div>
                      <div className="theme-soft-surface border rounded-2xl p-4 flex flex-col justify-center">
                        <p className="text-[0.625rem] uppercase tracking-widest theme-text-muted mb-1">Accuracy</p>
                        <p className="text-3xl font-black text-cyan-400">{overallAccuracy}%</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="theme-soft-surface border rounded-2xl p-4 text-center">
                        <p className="text-[0.625rem] uppercase tracking-widest theme-text-muted mb-1">Wins</p>
                        <p className="text-xl font-black text-emerald-400">{profileStats.wins}</p>
                      </div>
                      <div className="theme-soft-surface border rounded-2xl p-4 text-center">
                        <p className="text-[0.625rem] uppercase tracking-widest theme-text-muted mb-1">Losses</p>
                        <p className="text-xl font-black text-rose-400">{profileStats.losses}</p>
                      </div>
                      <div className="theme-soft-surface border rounded-2xl p-4 text-center">
                        <p className="text-[0.625rem] uppercase tracking-widest theme-text-muted mb-1">Matches</p>
                        <p className="text-xl font-black">{profileStats.completedGames}</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h5 className="text-xs font-black uppercase tracking-widest theme-text-muted">Category Performance</h5>
                      {Object.entries(profileStats.categoryPerformance).length === 0 ? (
                        <p className="text-sm theme-text-muted">Category accuracy shows up after you finish completed games.</p>
                      ) : (
                        <div className="space-y-2">
                          {Object.entries(profileStats.categoryPerformance).map(([category, stats]) => (
                            <div key={category} className="theme-soft-surface border rounded-2xl p-4 flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-bold">{category}</p>
                                <p className="text-[0.625rem] uppercase tracking-widest theme-text-muted">
                                  {stats.correct}/{stats.seen} correct
                                </p>
                              </div>
                              <p className="text-lg font-black">{stats.percentageCorrect}%</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {isRecentPlayersOpen && (
                <>
                  <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-pink-400" />
                      <h4 id="lobby-recent-players-title" className="text-sm font-black uppercase tracking-widest">Notifications & Recent Players</h4>
                    </div>
                    <div className="flex items-center gap-3">
                      {inviteFeedback && (
                        <span className="text-[0.625rem] font-black uppercase tracking-widest text-emerald-400" role="status" aria-live="polite">
                          {inviteFeedback}
                        </span>
                      )}
                      <button type="button" onClick={closeLobbyModal} className="p-2 rounded-xl theme-button" aria-label="Close recent players panel">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="overflow-y-auto custom-scrollbar pr-1 space-y-4">
                    {shouldShowInviteSection && (
                      <section className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Bell className="w-4 h-4 text-pink-500" />
                            <h5 className="text-xs font-black uppercase tracking-widest">Game Invites</h5>
                          </div>
                          {inviteCount > 0 && (
                            <span className="text-[0.625rem] font-black uppercase tracking-widest text-pink-300">
                              {inviteCount} Pending
                            </span>
                          )}
                        </div>

                        {incomingInvitesStatus === 'loading' ? (
                          <p className="text-sm theme-text-muted">Loading invites...</p>
                        ) : incomingInvitesStatus === 'error' ? (
                          <p className="text-sm text-rose-300">{incomingInvitesError || 'Failed to load invites.'}</p>
                        ) : (
                          <div className="space-y-3">
                            {incomingInvites.map((invite) => (
                              <div key={invite.id} className="theme-soft-surface border rounded-2xl p-4 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-11 h-11 theme-avatar-surface rounded-xl flex items-center justify-center overflow-hidden border shrink-0">
                                    {invite.fromAvatarUrl ? (
                                      <img src={invite.fromAvatarUrl} alt={invite.fromNickname} className="w-full h-full object-cover" loading="lazy" />
                                    ) : (
                                      <User className="w-5 h-5 theme-text-muted" />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm font-bold truncate">{invite.fromNickname || 'Someone'}</p>
                                    <p className="text-[0.625rem] uppercase tracking-widest theme-text-muted">Wants a rematch</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => onAcceptInvite(invite, effectiveAvatar)}
                                    className="p-2 rounded-xl bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                                    aria-label={`Accept invite from ${invite.fromNickname}`}
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onDeclineInvite(invite)}
                                    className="p-2 rounded-xl bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 transition-colors"
                                    aria-label={`Decline invite from ${invite.fromNickname}`}
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    )}

                    <section className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-cyan-400" />
                        <h5 className="text-xs font-black uppercase tracking-widest theme-text-muted">Recent Players</h5>
                      </div>

                      {recentPlayersStatus === 'loading' ? (
                        <p className="text-sm theme-text-muted">Loading recent players...</p>
                      ) : recentPlayersStatus === 'error' ? (
                        <p className="text-sm text-rose-300">{recentPlayersError || 'Failed to load recent players.'}</p>
                      ) : recentPlayers.length === 0 ? (
                        <p className="text-sm theme-text-muted">Play a multiplayer match and recent opponents will show up here.</p>
                      ) : (
                        <div className="space-y-3">
                          {recentPlayers.map((player) => (
                            <div key={player.uid} className="theme-soft-surface border rounded-2xl p-4 space-y-3">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-11 h-11 theme-avatar-surface rounded-xl flex items-center justify-center overflow-hidden border shrink-0">
                                    {getAvatarUrl(player) ? (
                                      <img src={getAvatarUrl(player)} alt={getDisplayName(player)} className="w-full h-full object-cover" />
                                    ) : (
                                      <User className="w-5 h-5 theme-text-muted" />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm font-bold truncate">{getDisplayName(player)}</p>
                                    <p className="text-[0.625rem] uppercase tracking-widest theme-text-muted">
                                      Last played {new Date(player.lastPlayedAt).toLocaleDateString()}
                                    </p>
                                  </div>
                                </div>
                                <div className="grid grid-cols-3 gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => onInspectMatchup(player)}
                                    className="px-3 py-2 rounded-xl theme-button font-black text-[0.625rem] uppercase tracking-widest"
                                  >
                                    History
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onInviteRecentPlayer(player, effectiveAvatar)}
                                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white font-black text-xs uppercase tracking-widest shadow-lg"
                                  >
                                    <span className="inline-flex items-center gap-1"><SendHorizontal className="w-3.5 h-3.5" /> Invite</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onRemoveRecentPlayer(player)}
                                    className="p-2 rounded-xl theme-button"
                                    aria-label={`Remove ${getDisplayName(player)} from recent players`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>

                              {selectedMatchup?.opponentId === player.uid && (
                                <div className="border-t pt-3 space-y-3">
                                  {isLoadingMatchup ? (
                                    <p className="text-sm theme-text-muted">Loading matchup history...</p>
                                  ) : (
                                    <>
                                      <div className="grid grid-cols-3 gap-3">
                                        <div className="theme-panel-strong border rounded-2xl p-3">
                                          <p className="text-[0.625rem] uppercase tracking-widest theme-text-muted mb-1">Record</p>
                                          <p className="text-lg font-black">
                                            {selectedMatchup.summary?.wins ?? 0}-{selectedMatchup.summary?.losses ?? 0}
                                          </p>
                                        </div>
                                        <div className="theme-panel-strong border rounded-2xl p-3">
                                          <p className="text-[0.625rem] uppercase tracking-widest theme-text-muted mb-1">Games</p>
                                          <p className="text-lg font-black">{selectedMatchup.summary?.totalGames ?? 0}</p>
                                        </div>
                                        <div className="theme-panel-strong border rounded-2xl p-3">
                                          <p className="text-[0.625rem] uppercase tracking-widest theme-text-muted mb-1">Last Played</p>
                                          <p className="text-sm font-black">
                                            {selectedMatchup.summary?.lastPlayedAt ? new Date(selectedMatchup.summary.lastPlayedAt).toLocaleDateString() : 'N/A'}
                                          </p>
                                        </div>
                                      </div>
                                      {selectedMatchup.games.length === 0 ? (
                                        <p className="text-sm theme-text-muted">No completed games against this player yet.</p>
                                      ) : (
                                        <div className="space-y-2">
                                          {selectedMatchup.games.map((game) => (
                                            <div key={game.gameId} className="theme-panel-strong border rounded-2xl p-3 flex items-center justify-between gap-3">
                                              <div>
                                                <p className="text-sm font-bold">
                                                  Winner: {getDisplayName(game.players.find((entry) => entry.uid === game.winnerId))}
                                                </p>
                                                <p className="text-[0.625rem] uppercase tracking-widest theme-text-muted">
                                                  {new Date(game.completedAt).toLocaleDateString()}
                                                </p>
                                              </div>
                                              <p className="text-[0.625rem] uppercase tracking-widest theme-text-secondary">
                                                {Object.entries(game.finalScores).map(([uid, score]) => {
                                                  const entry = game.players.find((playerEntry) => playerEntry.uid === uid);
                                                  return `${getDisplayName(entry)} ${score}`;
                                                }).join(' • ')}
                                              </p>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
