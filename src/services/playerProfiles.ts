import { supabase } from '../lib/supabase';
import { PlayerProfile, PlayerStatsSummary, CategoryPerformance, RecentCompletedGame } from '../types';

export async function ensurePlayerProfile(user: any): Promise<void> {
  // The database trigger handles this automatically via handle_new_user()
  // But we can ensure user_settings exists too
  const { error } = await supabase
    .from('user_settings')
    .upsert({ 
      user_id: user.id,
      theme_mode: 'dark',
      sound_enabled: true,
      music_enabled: true,
      sfx_enabled: true,
      commentary_enabled: true
    });
  
  if (error) throw error;
}

export async function loadMatchupHistory(userId: string, opponentId: string) {
  const { data, error } = await supabase
    .from('matchup_history')
    .select('*')
    .eq('user_id', userId)
    .eq('opponent_id', opponentId)
    .single();
  
  if (error || !data) {
    return { summary: null as any, games: [] as RecentCompletedGame[] };
  }

  return {
    summary: {
      opponentId: data.opponent_id,
      opponentDisplayName: data.opponent_display_name,
      opponentPhotoURL: data.opponent_photo_url,
      wins: data.wins,
      losses: data.losses,
      totalGames: data.wins + data.losses,
      lastPlayedAt: new Date(data.last_played_at).getTime()
    },
    games: [] // Would need additional query to get game details
  };
}

export async function recordCompletedGame(completedGame: any) {
  // Insert into completed_games archive
  const { error } = await supabase
    .from('completed_games')
    .insert({
      id: completedGame.gameId,
      players: completedGame.players,
      winner_id: completedGame.winnerId,
      final_scores: completedGame.finalScores,
      categories_used: completedGame.categoriesUsed,
      questions: completedGame.questions,
      completed_at: new Date(completedGame.completedAt).toISOString()
    });
  
  if (error) throw error;
  
  // Update matchup history for each player
  const players = completedGame.players;
  const winnerId = completedGame.winnerId;
  
  for (const player of players) {
    const isWinner = player.uid === winnerId;
    const opponent = players.find((p: any) => p.uid !== player.uid);
    if (!opponent) continue;
    
    await supabase.rpc('upsert_matchup_history', {
      p_user_id: player.uid,
      p_opponent_id: opponent.uid,
      p_won: isWinner ? 1 : 0,
      p_lost: isWinner ? 0 : 1,
      p_opponent_display_name: opponent.name,
      p_opponent_photo_url: opponent.avatarUrl || null
    });
  }
}

export async function recordQuestionStats(stats: { uid: string; category: string; isCorrect: boolean }) {
  // This would update the profiles.stats JSONB field
  const { data: profile } = await supabase
    .from('profiles')
    .select('stats')
    .eq('id', stats.uid)
    .single();
  
  if (!profile) return;
  
  const currentStats = profile.stats || {};
  const categoryPerformance = currentStats.categoryPerformance || {};
  const catStats = categoryPerformance[stats.category] || { seen: 0, correct: 0 };
  
  const updatedStats = {
    ...currentStats,
    totalQuestionsSeen: (currentStats.totalQuestionsSeen || 0) + 1,
    totalQuestionsCorrect: (currentStats.totalQuestionsCorrect || 0) + (stats.isCorrect ? 1 : 0),
    categoryPerformance: {
      ...categoryPerformance,
      [stats.category]: {
        seen: catStats.seen + 1,
        correct: catStats.correct + (stats.isCorrect ? 1 : 0),
        percentageCorrect: ((catStats.correct + (stats.isCorrect ? 1 : 0)) / (catStats.seen + 1)) * 100
      }
    }
  };
  
  await supabase
    .from('profiles')
    .update({ stats: updatedStats })
    .eq('id', stats.uid);
}

// Add this RPC function to your database
/*
create function public.upsert_matchup_history(
  p_user_id uuid,
  p_opponent_id uuid,
  p_won integer,
  p_lost integer,
  p_opponent_display_name text,
  p_opponent_photo_url text
)
returns void as $$
begin
  insert into public.matchup_history (user_id, opponent_id, wins, losses, last_played_at, opponent_display_name, opponent_photo_url)
  values (p_user_id, p_opponent_id, p_won, p_lost, timezone('utc'::text, now()), p_opponent_display_name, p_opponent_photo_url)
  on conflict (user_id, opponent_id) 
  do update set 
    wins = public.matchup_history.wins + p_won,
    losses = public.matchup_history.losses + p_lost,
    last_played_at = timezone('utc'::text, now()),
    opponent_display_name = p_opponent_display_name,
    opponent_photo_url = p_opponent_photo_url;
end;
$$ language plpgsql security definer;
*/

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


export function subscribeRecentPlayers(uid: string, callback: (ps: any[]) => void, onError?: (e: unknown) => void) {
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

async function loadRecentPlayers(uid: string): Promise<any[]> {
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
    completedAt: new Date(g.last_updated).getTime(),
    status: 'completed',
    opponentIds: g.player_ids.filter((pid: string) => pid !== uid),
  }));
}

export async function removeRecentPlayer(uid: string, opponentId: string) {
  await supabase.from('recent_players').update({ hidden: true, updated_at: new Date().toISOString() }).eq('user_id', uid).eq('opponent_id', opponentId);
}
