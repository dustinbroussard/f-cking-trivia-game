import { useState, useCallback, useEffect, useRef } from 'react';
import { GameState, Player, ChatMessage, GameInvite, PlayerProfile, RecentPlayer, RecentCompletedGame } from '../types';
import { 
  subscribeToGame as subscribeToGameService, 
  subscribeToMessages as subscribeToMessagesService,
  getGameById,
  updateGame as updateGameService,
  mapPostgresGameToState
} from '../services/gameService';
import { subscribeToIncomingInvites } from '../services/inviteService';
import { 
  subscribePlayerProfile, 
  subscribeRecentPlayers, 
  subscribeRecentCompletedGames 
} from '../services/playerProfiles';

export function useGameStore(user: any | null) {
  const [game, setGame] = useState<GameState | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);
  const [recentPlayers, setRecentPlayers] = useState<RecentPlayer[]>([]);
  const [recentCompletedGames, setRecentCompletedGames] = useState<RecentCompletedGame[]>([]);
  const [incomingInvites, setIncomingInvites] = useState<GameInvite[]>([]);
  const [hasResolvedProfile, setHasResolvedProfile] = useState(false);

  // Subscriptions
  useEffect(() => {
    if (!game?.id) {
      setPlayers([]);
      setMessages([]);
      return;
    }

    const unsubscribeGame = subscribeToGameService(game.id, (updatedGame) => {
      setGame(updatedGame);
      setPlayers(updatedGame.players || []);
    });

    const unsubscribeMessages = subscribeToMessagesService(game.id, (msgs) => {
      setMessages(msgs);
    });

    return () => {
      unsubscribeGame();
      unsubscribeMessages();
    };
  }, [game?.id]);

  useEffect(() => {
    if (!user?.id) {
      setPlayerProfile(null);
      setRecentPlayers([]);
      setRecentCompletedGames([]);
      setIncomingInvites([]);
      setHasResolvedProfile(true);
      return;
    }

    setHasResolvedProfile(false);
    const unsubscribeProfile = subscribePlayerProfile(user.id, (profile) => {
      setPlayerProfile(profile);
      setHasResolvedProfile(true);
    }, (error) => {
      console.error(error);
      setHasResolvedProfile(true); // Treat as resolved even if error occurred, to avoid blocked state
    });
    const unsubscribeRecentPlayers = subscribeRecentPlayers(user.id, (p) => setRecentPlayers(p));
    const unsubscribeRecentGames = subscribeRecentCompletedGames(user.id, (g) => setRecentCompletedGames(g));
    const unsubscribeInvites = subscribeToIncomingInvites(user.id, (i) => setIncomingInvites(i));

    return () => {
      unsubscribeProfile();
      unsubscribeRecentPlayers();
      unsubscribeRecentGames();
      unsubscribeInvites();
    };
  }, [user?.id]);

  return {
    game,
    setGame,
    players,
    setPlayers,
    messages,
    setMessages,
    playerProfile,
    recentPlayers,
    recentCompletedGames,
    incomingInvites,
    hasResolvedProfile,
  };
}
