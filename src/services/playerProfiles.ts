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

export async function ensurePlayerProfile(user: SupabaseUser) {
  const { data: existingProfile, error: getError } = await supabase
    .from('profiles')
    .select('id, display_name, photo_url')
    .eq('id', user.id)
    .single();

  if (getError && getError.code !== 'PGRST116') throw getError;

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
      display_name: identity?.full_name || identity?.display_name || existingProfile.display_name,
      photo_url: identity?.avatar_url || identity?.picture || existingProfile.photo_url,
      updated_at: now,
      last_seen_at: now,
    })
    .eq('id', user.id);
  if (updateError) throw updateError;
}

export async function updatePlayer(ownerId: string, opponentId: string, patch: any) {
  const { error } = await supabase
    .from('recent_players')
    .upsert({
      user_id: ownerId,
      opponent_id: opponentId,
      ...patch,
      updated_at: new Date().toISOString()
    });
  if (error) throw error;
}

export function subscribePlayerProfile(
  uid: string,
  callback: (profile: PlayerProfile | null) => void,
  onError?: (error: unknown) => void
) {
  const channel = supabase
    .channel(`profile-${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` }, (p) => {
      callback(p.new as PlayerProfile);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        supabase.from('profiles').select('*').eq('id', uid).single().then(({ data, error }) => {
          if (error && error.code !== 'PGRST116') onError?.(error);
          else callback(data as PlayerProfile);
        });
      }
    });
  return () => { void supabase.removeChannel(channel); };
}


export function subscribeRecentPlayers(uid: string, callback: (ps: RecentPlayer[]) => void, onError?: (e: unknown) => void) {
  const channel = supabase
    .channel(`recent-players-${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'recent_players', filter: `user_id=eq.${uid}` }, () => {
      loadRecentPlayers(uid).then(callback).catch(onError);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') loadRecentPlayers(uid).then(callback).catch(onError);
    });
  return () => { void supabase.removeChannel(channel); };
}

async function loadRecentPlayers(uid: string): Promise<RecentPlayer[]> {
  const { data, error } = await supabase.from('recent_players').select('*').eq('user_id', uid).eq('hidden', false).order('last_played_at', { ascending: false }).limit(12);
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

export function subscribeRecentCompletedGames(uid: string, callback: (gs: RecentCompletedGame[]) => void, onError?: (e: unknown) => void, limitLimit = 5) {
  const channel = supabase
    .channel(`games-${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => {
      loadRecentGames(uid, limitLimit).then(callback).catch(onError);
    })
    .subscribe((s) => {
      if (s === 'SUBSCRIBED') loadRecentGames(uid, limitLimit).then(callback).catch(onError);
    });
  return () => { void supabase.removeChannel(channel); };
}

async function loadRecentGames(uid: string, limitLimit: number): Promise<RecentCompletedGame[]> {
  const { data, error } = await supabase.from('games').select('*').contains('player_ids', [uid]).eq('status', 'completed').order('last_updated', { ascending: false }).limit(limitLimit);
  if (error) throw error;
  return data.map(g => ({
    gameId: g.id,
    players: [],
    winnerId: g.winner_id,
    finalScores: g.final_scores,
    categoriesUsed: g.categories_used,
    completedAt: new Date(g.updated_at).getTime(),
    status: 'completed',
    opponentIds: g.player_ids.filter((pid: string) => pid !== uid),
  }));
}

export async function loadMatchupHistory(uid: string, opponentId: string) {
  const { data: summary, error: sErr } = await supabase.from('matchups').select('*').eq('user_id', uid).eq('opponent_id', opponentId).single();
  if (sErr && sErr.code !== 'PGRST116') throw sErr;
  const { data: gs, error: gErr } = await supabase.from('games').select('*').contains('player_ids', [uid, opponentId]).eq('status', 'completed').order('updated_at', { ascending: false }).limit(5);
  if (gErr) throw gErr;
  return {
    summary: summary ? {
      opponentId: summary.opponent_id,
      opponentDisplayName: summary.opponent_display_name,
      opponentPhotoURL: summary.opponent_photo_url,
      wins: summary.wins,
      losses: summary.losses,
      totalGames: summary.total_games,
      lastPlayedAt: new Date(summary.last_played_at).getTime(),
    } : null,
    games: gs.map(g => ({ gameId: g.id, players: [], winnerId: g.winner_id, finalScores: g.final_scores, categoriesUsed: g.categories_used, completedAt: new Date(g.updated_at).getTime(), status: 'completed', opponentIds: [opponentId] })),
  };
}

export async function removeRecentPlayer(uid: string, opponentId: string) {
  await supabase.from('recent_players').update({ hidden: true, updated_at: new Date().toISOString() }).eq('user_id', uid).eq('opponent_id', opponentId);
}

export async function recordQuestionStats({ userId, category, isCorrect }: { userId: string, category: string, isCorrect: boolean }) {
  await supabase.rpc('record_question_stats', { p_uid: userId, p_category: category, p_is_correct: isCorrect });
}

export async function recordCompletedGame(params: any) {
  const { gameId, winnerId, finalScores, questions, completedAt } = params;
  const cats = Array.from(new Set(questions.filter((q: any) => q.used).map((q: any) => q.category)));
  await supabase.from('games').update({ status: 'completed', winner_id: winnerId, final_scores: finalScores, categories_used: cats, updated_at: new Date(completedAt).toISOString() }).eq('id', gameId);
}
