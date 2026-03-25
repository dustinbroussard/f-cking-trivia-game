import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { Trophy, Users, Gamepad2, User, Upload, Bell, SendHorizontal, Check, X, BarChart3, Trash2 } from 'lucide-react';
import { publicAsset } from '../assets';
import { GameInvite, MatchupSummary, PlayerProfile, RecentCompletedGame, RecentPlayer } from '../types';

interface GameLobbyProps {
  onStartSolo: (avatarUrl: string) => void;
  onStartMulti: (avatarUrl: string) => void;
  onJoinMulti: (code: string, avatarUrl: string) => void;
  recentPlayers: RecentPlayer[];
  playerProfile: PlayerProfile | null;
  recentCompletedGames: RecentCompletedGame[];
  selectedMatchup: { opponentId: string; summary: MatchupSummary | null; games: RecentCompletedGame[] } | null;
  isLoadingMatchup: boolean;
  incomingInvites: GameInvite[];
  onInviteRecentPlayer: (player: RecentPlayer, avatarUrl: string) => void;
  onInspectMatchup: (player: RecentPlayer) => void;
  onCloseMatchup: () => void;
  onRemoveRecentPlayer: (player: RecentPlayer) => void;
  onAcceptInvite: (invite: GameInvite, avatarUrl: string) => void;
  onDeclineInvite: (invite: GameInvite) => void;
  inviteFeedback?: string | null;
}

export const GameLobby: React.FC<GameLobbyProps> = ({
  onStartSolo,
  onStartMulti,
  onJoinMulti,
  recentPlayers,
  playerProfile,
  recentCompletedGames,
  selectedMatchup,
  isLoadingMatchup,
  incomingInvites,
  onInviteRecentPlayer,
  onInspectMatchup,
  onCloseMatchup,
  onRemoveRecentPlayer,
  onAcceptInvite,
  onDeclineInvite,
  inviteFeedback,
}) => {
  const logoSrc = publicAsset('logo.png');
  const [joinCode, setJoinCode] = useState('');
  const [showJoinInput, setShowJoinInput] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState('');
  const [showStats, setShowStats] = useState(false);
  const [showRecentPlayers, setShowRecentPlayers] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        setSelectedAvatar(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-7 p-6 flex flex-col items-center">
      {/* Logo Area */}
      <div className="text-center relative">
        <div className="relative inline-block w-64 h-64 md:w-80 md:h-80">
          <img
            src={logoSrc}
            alt="A F-cking Trivia Game"
            className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>

      {/* Avatar Selection */}
      <div className="w-full space-y-3 flex flex-col items-center">
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          className="hidden"
          onChange={handleImageUpload}
        />

        <button type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Upload avatar"
          className="relative w-24 h-24 rounded-2xl theme-panel-strong border-2 overflow-hidden flex items-center justify-center hover:border-pink-500 transition-all group shadow-xl hover:shadow-pink-500/20 duration-300 ease-in-out"
        >
          {selectedAvatar ? (
            <img src={selectedAvatar} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            <User className="w-10 h-10 theme-text-muted group-hover:text-pink-500 transition-colors" />
          )}

          <div className="absolute inset-0 theme-overlay flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white">
            <Upload className="w-6 h-6" />
          </div>
        </button>
      </div>

      {/* Main Actions */}
      <div className="w-full space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setShowStats((current) => !current)}
            aria-label={showStats ? 'Hide stats' : 'Show stats'}
            title={showStats ? 'Hide stats' : 'Show stats'}
            className="h-12 rounded-xl theme-panel-strong border transition-all duration-300 flex items-center justify-center"
          >
            <BarChart3 className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => setShowRecentPlayers((current) => !current)}
            aria-label={showRecentPlayers ? 'Hide recent players' : 'Show recent players'}
            title={showRecentPlayers ? 'Hide recent players' : 'Show recent players'}
            className="h-12 rounded-xl theme-panel-strong border transition-all duration-300 flex items-center justify-center"
          >
            <Users className="w-5 h-5" />
          </button>
        </div>

        {showStats && (
          <div className="w-full theme-panel backdrop-blur-xl border rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-cyan-400" />
              <h4 className="text-sm font-black uppercase tracking-widest">My Stats</h4>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="theme-soft-surface border rounded-2xl p-4">
                <p className="text-[10px] uppercase tracking-widest theme-text-muted mb-1">Win Rate</p>
                <p className="text-3xl font-black">{playerProfile?.stats.winPercentage ?? 0}%</p>
              </div>
              <div className="theme-soft-surface border rounded-2xl p-4">
                <p className="text-[10px] uppercase tracking-widest theme-text-muted mb-1">Completed Games</p>
                <p className="text-3xl font-black">{playerProfile?.stats.completedGames ?? 0}</p>
              </div>
              <div className="theme-soft-surface border rounded-2xl p-4">
                <p className="text-[10px] uppercase tracking-widest theme-text-muted mb-1">Wins</p>
                <p className="text-2xl font-black text-emerald-400">{playerProfile?.stats.wins ?? 0}</p>
              </div>
              <div className="theme-soft-surface border rounded-2xl p-4">
                <p className="text-[10px] uppercase tracking-widest theme-text-muted mb-1">Losses</p>
                <p className="text-2xl font-black text-rose-400">{playerProfile?.stats.losses ?? 0}</p>
              </div>
            </div>

            <div className="space-y-3">
              <h5 className="text-xs font-black uppercase tracking-widest theme-text-muted">Recent Completed Games</h5>
              {recentCompletedGames.length === 0 ? (
                <p className="text-sm theme-text-muted">Finish a game and your latest results will show up here.</p>
              ) : (
                recentCompletedGames.map((game) => (
                  <div key={game.gameId} className="theme-soft-surface border rounded-2xl p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold">
                        {game.players.map((player) => player.displayName).join(' vs ')}
                      </p>
                      <p className="text-[10px] uppercase tracking-widest theme-text-muted">
                        {new Date(game.completedAt).toLocaleDateString()} • {game.categoriesUsed.join(', ') || 'No categories'}
                      </p>
                    </div>
                    <p className="text-xs font-black uppercase tracking-widest theme-text-secondary">
                      Winner: {game.players.find((player) => player.uid === game.winnerId)?.displayName || 'None'}
                    </p>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-3">
              <h5 className="text-xs font-black uppercase tracking-widest theme-text-muted">Category Performance</h5>
              {Object.entries(playerProfile?.stats.categoryPerformance || {}).length === 0 ? (
                <p className="text-sm theme-text-muted">Category accuracy shows up after you finish completed games.</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(playerProfile?.stats.categoryPerformance || {}).map(([category, stats]) => (
                    <div key={category} className="theme-soft-surface border rounded-2xl p-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold">{category}</p>
                        <p className="text-[10px] uppercase tracking-widest theme-text-muted">
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
        )}

        <motion.button type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onStartSolo(selectedAvatar)}
          aria-label="Start a solo game"
          className="w-full h-16 bg-gradient-to-r from-cyan-500 to-emerald-500 rounded-xl flex items-center justify-center gap-3 text-white font-bold text-xl shadow-lg hover:shadow-cyan-500/25 transition-all duration-300 ease-in-out"
        >
          <Trophy className="w-6 h-6" />
          Solo Mode
        </motion.button>

        <motion.button type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onStartMulti(selectedAvatar)}
          aria-label="Create a multiplayer game"
          className="w-full h-16 bg-gradient-to-r from-pink-500 to-purple-600 rounded-xl flex items-center justify-center gap-3 text-white font-bold text-xl shadow-lg hover:shadow-pink-500/25 transition-all duration-300 ease-in-out"
        >
          <Gamepad2 className="w-6 h-6" />
          Start New Game
        </motion.button>

        <div className="space-y-2">
          {!showJoinInput ? (
            <motion.button type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowJoinInput(true)}
              aria-label="Show join game code entry"
              className="w-full h-16 bg-gradient-to-r from-amber-500 to-pink-500 rounded-xl flex items-center justify-center gap-3 text-white font-bold text-xl shadow-lg hover:shadow-amber-500/25 transition-all duration-300 ease-in-out"
            >
              <Users className="w-6 h-6" />
              Join Game
            </motion.button>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                aria-label="Enter 4 digit game code"
                maxLength={4}
                placeholder="CODE"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                pattern="[A-Z0-9]{4}"
                className="flex-1 theme-input border rounded-xl px-4 text-xl font-black text-center focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 transition-all duration-300 ease-in-out shadow-inner"
              />
              <button type="button"
                onClick={() => joinCode.length === 4 && onJoinMulti(joinCode, selectedAvatar)}
                aria-label="Join multiplayer game"
                disabled={joinCode.length !== 4}
                className="px-6 bg-pink-500 hover:bg-pink-600 rounded-xl font-black text-white uppercase disabled:opacity-50 transition-all duration-300 ease-in-out shadow-md"
              >
                GO
              </button>
              <button type="button"
                onClick={() => setShowJoinInput(false)}
                aria-label="Close join game code entry"
                className="px-4 theme-button rounded-xl font-black transition-all duration-300 ease-in-out shadow-md"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>

      {incomingInvites.length > 0 && (
        <div className="w-full theme-panel backdrop-blur-xl border rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-pink-500" />
            <h4 className="text-sm font-black uppercase tracking-widest">Incoming Invites</h4>
          </div>

          <div className="space-y-3">
            {incomingInvites.map((invite) => (
              <div key={invite.id} className="theme-soft-surface border rounded-2xl p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 theme-avatar-surface rounded-xl flex items-center justify-center overflow-hidden border shrink-0">
                    {invite.fromPhotoURL ? (
                      <img src={invite.fromPhotoURL} alt={invite.fromDisplayName} className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-5 h-5 theme-text-muted" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{invite.fromDisplayName}</p>
                    <p className="text-[10px] uppercase tracking-widest theme-text-muted">Wants a rematch</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button"
                    onClick={() => onAcceptInvite(invite, selectedAvatar)}
                    className="px-3 py-2 rounded-xl bg-emerald-500 text-emerald-950 font-black text-xs uppercase tracking-widest"
                  >
                    <span className="inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Accept</span>
                  </button>
                  <button type="button"
                    onClick={() => onDeclineInvite(invite)}
                    className="px-3 py-2 rounded-xl theme-button font-black text-xs uppercase tracking-widest"
                  >
                    <span className="inline-flex items-center gap-1"><X className="w-3.5 h-3.5" /> Decline</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(showRecentPlayers || selectedMatchup) && (
      <div className="w-full theme-panel backdrop-blur-xl border rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" />
            <h4 className="text-sm font-black uppercase tracking-widest">Recent Players</h4>
          </div>
          <div className="flex items-center gap-3">
            {inviteFeedback && (
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400" role="status" aria-live="polite">
                {inviteFeedback}
              </span>
            )}
            {selectedMatchup && (
              <button type="button" onClick={onCloseMatchup} className="p-2 rounded-xl theme-button" aria-label="Close matchup history">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {recentPlayers.length === 0 ? (
          <p className="text-sm theme-text-muted">Play a multiplayer match and recent opponents will show up here.</p>
        ) : (
          <div className="space-y-3">
            {recentPlayers.map((player) => (
              <div key={player.uid} className="theme-soft-surface border rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 theme-avatar-surface rounded-xl flex items-center justify-center overflow-hidden border shrink-0">
                    {player.photoURL ? (
                      <img src={player.photoURL} alt={player.displayName} className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-5 h-5 theme-text-muted" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{player.displayName}</p>
                    <p className="text-[10px] uppercase tracking-widest theme-text-muted">
                      Last played {new Date(player.lastPlayedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onInspectMatchup(player)}
                    className="px-3 py-2 rounded-xl theme-button font-black text-[10px] uppercase tracking-widest"
                  >
                    History
                  </button>
                  <button type="button"
                    onClick={() => onInviteRecentPlayer(player, selectedAvatar)}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white font-black text-xs uppercase tracking-widest shadow-lg"
                  >
                    <span className="inline-flex items-center gap-1"><SendHorizontal className="w-3.5 h-3.5" /> Invite</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveRecentPlayer(player)}
                    className="p-2 rounded-xl theme-button"
                    aria-label={`Remove ${player.displayName} from recent players`}
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
                            <p className="text-[10px] uppercase tracking-widest theme-text-muted mb-1">Record</p>
                            <p className="text-lg font-black">
                              {selectedMatchup.summary?.wins ?? 0}-{selectedMatchup.summary?.losses ?? 0}
                            </p>
                          </div>
                          <div className="theme-panel-strong border rounded-2xl p-3">
                            <p className="text-[10px] uppercase tracking-widest theme-text-muted mb-1">Games</p>
                            <p className="text-lg font-black">{selectedMatchup.summary?.totalGames ?? 0}</p>
                          </div>
                          <div className="theme-panel-strong border rounded-2xl p-3">
                            <p className="text-[10px] uppercase tracking-widest theme-text-muted mb-1">Last Played</p>
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
                                    Winner: {game.players.find((entry) => entry.uid === game.winnerId)?.displayName || 'None'}
                                  </p>
                                  <p className="text-[10px] uppercase tracking-widest theme-text-muted">
                                    {new Date(game.completedAt).toLocaleDateString()}
                                  </p>
                                </div>
                                <p className="text-[10px] uppercase tracking-widest theme-text-secondary">
                                  {Object.entries(game.finalScores).map(([uid, score]) => {
                                    const entry = game.players.find((playerEntry) => playerEntry.uid === uid);
                                    return `${entry?.displayName || 'Player'} ${score}`;
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
      </div>
      )}

      {/* Footer */}
      <div className="text-center space-y-4 max-w-xs">
        <p className="theme-text-muted font-bold text-lg">
          No ads. No coins. No bullsh*t. 🚫
        </p>
        <p className="theme-text-secondary font-medium text-sm leading-relaxed">
          Answer one question from each category to win. Get one wrong and your turn ends. 💀
        </p>
      </div>
    </div>
  );
};
