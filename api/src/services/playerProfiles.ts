import { supabase } from '../lib/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import {
  CategoryPerformance,
  MatchupSummary,
  Player,
  PlayerProfile,
  PlayerStatsSummary,
  RecentCompletedGame,
  RecentPlayer,
} from '../types';

const DEFAULT_STATS: PlayerStatsSummary = {
  completedGames: 0,
  wins: 0,
  losses: 0,
  winPercentage: 0,
  totalQuestionsSeen: 0,
  totalQuestionsCorrect: 0,
  categoryPerformance: {},
};

const getDefaultCategoryPerformance = (): CategoryPerformance => ({
  seen: 0,
  correct: 0,
  percentageCorrect: 0,
});

export async function ensurePlayerProfile(user: SupabaseUser) {
  const { data: existingProfile, error: getError } = await supabase
    .from('profiles')
    .select('id, display_name, photo_url')
    .eq('id', user.id)
    .single();

  if (getError && getError.code !== 'PGRST116') { // PGRST116 is "no rows found"
    throw getError;
  }

  const identity = user.user_metadata;
  const now = new Date().toISOString();

  if (!existingProfile) {
    const newProfile = {
      id: user.id,
      display_name: identity?.full_name || identity?.display_name || 'Player',
      photo_url: identity?.avatar_url || identity?.picture || undefined,
      created_at: now,
      updated_at: now,
      last_seen_at: now,
      stats: DEFAULT_STATS,
    };
    const { error: insertError } = await supabase.from('profiles').insert(newProfile);
    if (insertError) throw insertError;
    return;
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      display_name: identity?.full_name || identity?.display_name || existingProfile.display_name || 'Player',
      photo_url: identity?.avatar_url || identity?.picture || existingProfile.photo_url || undefined,
      updated_at: now,
      last_seen_at: now,
    })
    .eq('id', user.id);
  if (updateError) throw updateError;
}

export function subscribePlayerProfile(
  uid: string,
  callback: (profile: PlayerProfile | null) => void,
  onError?: (error: unknown) => void
) {
  // Supabase Realtime for a single row
  const channel = supabase
    .channel(`profile-${uid}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
      (payload) => {
        callback(payload.new as PlayerProfile);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        supabase
          .from('profiles')
          .select('*')
          .eq('id', uid)
          .single()
          .then(({ data, error }) => {
            if (error) onError?.(error);
            else callback(data as PlayerProfile);
          });
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeRecentPlayers(
  uid: string,
  callback: (players: RecentPlayer[]) => void,
  onError?: (error: unknown) => void
) {
  const channel = supabase
    .channel(`recent-players-${uid}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'recent_players', filter: `user_id=eq.${uid}` },
      () => {
        // Just reload everything on change
        loadRecentPlayers(uid).then(callback).catch(onError);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        loadRecentPlayers(uid).then(callback).catch(onError);
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

async function loadRecentPlayers(uid: string): Promise<RecentPlayer[]> {
  const { data, error } = await supabase
    .from('recent_players')
    .select('*')
    .eq('user_id', uid)
    .eq('hidden', false)
    .order('last_played_at', { ascending: false })
    .limit(12);

  if (error) throw error;
  return data.map(d => ({
    uid: d.opponent_id,
    displayName: d.display_name,
    photoURL: d.photo_url,
    lastPlayedAt: new Date(d.last_played_at).getTime(),
    lastGameId: d.last_game_id,
    hidden: d.hidden,
    updatedAt: new Date(d.updated_at).getTime(),
  }));
}

export function subscribeRecentCompletedGames(
  uid: string,
  callback: (games: RecentCompletedGame[]) => void,
  onError?: (error: unknown) => void
) {
  // For Supabase, we might just use a regular select if changes are infrequent
  // or a channel listening to the 'games' table if the player is in 'player_ids'
  loadRecentGames(uid).then(callback).catch(onError);

  const channel = supabase
    .channel(`completed-games-${uid}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'games' }, // Might be too broad
      () => {
        loadRecentGames(uid).then(callback).catch(onError);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

async function loadRecentGames(uid: string): Promise<RecentCompletedGame[]> {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .contains('player_ids', [uid])
    .eq('status', 'completed')
    .order('last_updated', { ascending: false })
    .limit(5);

  if (error) throw error;
  
  return data.map(g => ({
    gameId: g.id,
    players: g.player_ids.map((pid: string) => ({ uid: pid, displayName: 'Player' })), // Join would be better
    winnerId: g.winner_id,
    finalScores: g.final_scores,
    categoriesUsed: g.categories_used,
    completedAt: new Date(g.updated_at).getTime(),
    status: 'completed',
    opponentIds: g.player_ids.filter((pid: string) => pid !== uid),
  }));
}

export async function loadMatchupHistory(uid: string, opponentUid: string) {
  const { data: summary, error: summaryError } = await supabase
    .from('matchups')
    .select('*')
    .eq('user_id', uid)
    .eq('opponent_id', opponentUid)
    .single();

  if (summaryError && summaryError.code !== 'PGRST116') throw summaryError;

  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('*')
    .contains('player_ids', [uid, opponentUid])
    .eq('status', 'completed')
    .order('updated_at', { ascending: false })
    .limit(5);

  if (gamesError) throw gamesError;

  return {
    summary: summary ? {
      opponentId: summary.opponent_id,
      opponentDisplayName: summary.opponent_display_name,
      opponentPhotoURL: summary.opponent_photo_url,
      wins: summary.wins,
      losses: summary.losses,
      totalGames: summary.total_games,
      lastPlayedAt: new Date(summary.last_played_at).getTime(),
    } as MatchupSummary : null,
    games: games.map(g => ({
      gameId: g.id,
      players: [], // Add join/enrichment logic if needed
      winnerId: g.winner_id,
      finalScores: g.final_scores,
      categoriesUsed: g.categories_used,
      completedAt: new Date(g.updated_at).getTime(),
      status: 'completed',
      opponentIds: [opponentUid],
    }) as RecentCompletedGame),
  };
}

export async function removeRecentPlayer(uid: string, opponentUid: string) {
  const { error } = await supabase
    .from('recent_players')
    .update({ hidden: true, updated_at: new Date().toISOString() })
    .eq('user_id', uid)
    .eq('opponent_id', opponentUid);
  if (error) throw error;
}

export async function recordQuestionStats({
  uid,
  category,
  isCorrect,
}: {
  uid: string;
  category: string;
  isCorrect: boolean;
}) {
  // Use a Postgres RPC for atomic updates
  const { error } = await supabase.rpc('record_question_stats', {
    p_uid: uid,
    p_category: category,
    p_is_correct: isCorrect
  });
  if (error) throw error;
}

export async function recordCompletedGame({
  gameId,
  players,
  winnerId,
  finalScores,
  questions,
  status,
  completedAt,
}: {
  gameId: string;
  players: Player[];
  winnerId: string | null;
  finalScores: Record<string, number>;
  questions: TriviaQuestion[];
  status: 'completed';
  completedAt: number;
}) {
  const categoriesUsed = Array.from(new Set(
    questions
      .filter((q) => q.used)
      .map((q) => q.category)
  ));

  const { error: gameError } = await supabase
    .from('games')
    .update({
      status: 'completed',
      winner_id: winnerId,
      final_scores: finalScores,
      categories_used: categoriesUsed,
      stats_recorded_at: new Date(completedAt).toISOString(),
      updated_at: new Date(completedAt).toISOString(),
    })
    .eq('id', gameId);

  if (gameError) throw gameError;

  // Process player profiles and matchups
  for (const player of players) {
    const isWinner = winnerId === player.uid;
    
    // Increment total stats using RPC
    await supabase.rpc('increment_player_game_stats', {
      p_uid: player.uid,
      p_is_win: isWinner
    });

    // Matchups
    for (const opponent of players.filter(p => p.uid !== player.uid)) {
      const isPlayerWinner = winnerId === player.uid;
      
      await supabase.from('matchups').upsert({
        user_id: player.uid,
        opponent_id: opponent.uid,
        opponent_display_name: opponent.name,
        opponent_photo_url: opponent.avatarUrl,
        wins: isPlayerWinner ? 1 : 0,
        losses: isPlayerWinner ? 0 : 1,
        total_games: 1,
        last_played_at: new Date(completedAt).toISOString(),
      }, { onConflict: 'user_id,opponent_id' }); // Handled correctly in Postgres via merge if I write an upsert rpc or just use upsert with increments

      await supabase.from('recent_players').upsert({
        user_id: player.uid,
        opponent_id: opponent.uid,
        display_name: opponent.name,
        photo_url: opponent.avatarUrl,
        last_played_at: new Date(completedAt).toISOString(),
        last_game_id: gameId,
        hidden: false,
        updated_at: new Date(completedAt).toISOString(),
      }, { onConflict: 'user_id,opponent_id' });
    }
  }
}
