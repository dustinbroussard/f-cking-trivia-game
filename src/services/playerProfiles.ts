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
  TriviaQuestion,
} from '../types';

function isMissingRowError(error: any) {
  return error?.code === 'PGRST116' || error?.status === 406;
}

function isMissingTableError(error: any) {
  return error?.code === 'PGRST205' || error?.status === 404;
}

function mapPostgresProfileToPlayerProfile(p: any): PlayerProfile {
  if (!p) return null as any;
  return {
    userId: p.user_id,
    nickname: p.nickname,
    avatarUrl: p.avatar_url || undefined,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

export async function ensurePlayerProfile(user: SupabaseUser, nickname?: string) {
  const { data: existingProfile, error: getError } = await supabase
    .from('profiles')
    .select('user_id, nickname, avatar_url')
    .eq('user_id', user.id)
    .maybeSingle();

  if (getError && getError.code !== 'PGRST116') {
    if (isMissingRowError(getError)) {
      return;
    }
    throw getError;
  }

  const identity = user.user_metadata;
  const now = new Date().toISOString();

  if (!existingProfile) {
    const newProfile = {
      user_id: user.id,
      nickname: nickname || identity?.nickname || identity?.full_name || identity?.name || 'Player',
      avatar_url: identity?.avatar_url || identity?.picture || undefined,
      created_at: now,
      updated_at: now,
    };
    const { error: insertError } = await supabase.from('profiles').insert(newProfile);
    if (insertError) throw insertError;
    return;
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      nickname: nickname || existingProfile.nickname,
      avatar_url: identity?.avatar_url || identity?.picture || existingProfile.avatar_url,
      updated_at: now,
    })
    .eq('user_id', user.id);
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
      { event: '*', schema: 'public', table: 'profiles', filter: `user_id=eq.${uid}` },
      (payload) => {
        callback(mapPostgresProfileToPlayerProfile(payload.new));
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        supabase
          .from('profiles')
          .select('user_id, nickname, avatar_url, created_at, updated_at')
          .eq('user_id', uid)
          .maybeSingle()
          .then(({ data, error }) => {
            if (error) {
              if (isMissingRowError(error)) {
                callback(null);
                return;
              }
              onError?.(error);
              return;
            }
            else callback(mapPostgresProfileToPlayerProfile(data));
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

  if (error) {
    if (isMissingTableError(error)) {
      return [];
    }
    throw error;
  }
  return (data || []).map(d => ({
    uid: d.opponent_id,
    nickname: d.nickname,
    avatarUrl: d.avatar_url,
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
    .select('id, player_ids, status, game_mode, winner_user_id, current_turn_user_id, game_state, result, created_at, last_updated')
    .contains('player_ids', [uid])
    .eq('status', 'completed')
    .order('last_updated', { ascending: false })
    .limit(5);

  if (error) throw error;
  
  return (data || []).map(g => ({
    gameId: g.id,
    players: (g.player_ids || []).map((pid: string) => ({ uid: pid, nickname: 'Player' })), 
    winnerId: g.winner_user_id,
    finalScores: (g.result as any)?.finalScores || {},
    categoriesUsed: (g.result as any)?.categoriesUsed || [],
    completedAt: new Date(g.last_updated || g.created_at).getTime(),
    status: 'completed',
    opponentIds: (g.player_ids || []).filter((pid: string) => pid !== uid),
  }));
}

export async function loadMatchupHistory(uid: string, opponentUid: string) {
  const { data: summary, error: summaryError } = await supabase
    .from('matchups')
    .select('*')
    .eq('user_id', uid)
    .eq('opponent_id', opponentUid)
    .maybeSingle();

  if (summaryError) {
    // Expected if no matchup history yet
    console.debug('[loadMatchupHistory] No summary found:', summaryError.message);
  }

  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('id, player_ids, status, game_mode, winner_user_id, current_turn_user_id, game_state, result, created_at, last_updated')
    .contains('player_ids', [uid, opponentUid])
    .eq('status', 'completed')
    .order('updated_at', { ascending: false })
    .limit(5);

  if (gamesError) throw gamesError;

  return {
    summary: summary ? {
      opponentId: summary.opponent_id,
      opponentNickname: summary.nickname,
      opponentAvatarUrl: summary.avatar_url,
      wins: summary.wins || 0,
      losses: summary.losses || 0,
      totalGames: summary.total_games || 0,
      lastPlayedAt: summary.last_played_at ? new Date(summary.last_played_at).getTime() : Date.now(),
    } as MatchupSummary : null,
    games: games.map(g => ({
      gameId: g.id,
      players: [], 
      winnerId: g.winner_user_id,
      finalScores: (g.result as any)?.finalScores || {},
      categoriesUsed: (g.result as any)?.categoriesUsed || [],
      completedAt: new Date(g.last_updated || g.created_at).getTime(),
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
  if (error) {
    if (isMissingTableError(error)) {
      return;
    }
    throw error;
  }
}

export async function updateRecentPlayer(uid: string, opponentUid: string, patch: any) {
  const { error } = await supabase
    .from('recent_players')
    .upsert({
      user_id: uid,
      opponent_id: opponentUid,
      ...patch,
      updated_at: new Date().toISOString()
    });
  if (error) {
    if (isMissingTableError(error)) {
      return;
    }
    throw error;
  }
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

  const now = new Date(completedAt).toISOString();
  await supabase
    .from('games')
    .update({
      status: 'completed',
      winner_user_id: winnerId,
      result: { finalScores, categoriesUsed },
      last_updated: now,
    })
    .eq('id', gameId);

  // Process player profiles
  for (const player of players) {
    await supabase
      .from('profiles')
      .update({ updated_at: now })
      .eq('user_id', player.uid);
  }
}
