import type { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  MatchupSummary,
  Player,
  PlayerProfile,
  RecentCompletedGame,
  RecentPlayer,
  TriviaQuestion,
} from '../types';
import {
  isMissingFunctionError,
  isMissingRowError,
  isMissingTableError,
  logSupabaseError,
  nowIsoString,
} from './supabaseUtils';

function mapPostgresProfileToPlayerProfile(profile: any): PlayerProfile {
  if (!profile) {
    return null as any;
  }

  return {
    userId: profile.id,
    nickname: profile.nickname ?? null,
    avatarUrl: profile.avatar_url || undefined,
    stats: {
      completedGames: profile.completed_games ?? 0,
      wins: profile.wins ?? 0,
      losses: profile.losses ?? 0,
      winPercentage:
        (profile.wins ?? 0) + (profile.losses ?? 0) > 0
          ? Math.round(((profile.wins ?? 0) / ((profile.wins ?? 0) + (profile.losses ?? 0))) * 100)
          : 0,
      totalQuestionsSeen: profile.total_questions_seen ?? 0,
      totalQuestionsCorrect: profile.total_questions_correct ?? 0,
      categoryPerformance: profile.category_performance ?? {},
    },
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

async function loadProfilesByIds(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Map<string, any>();
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, nickname, avatar_url, created_at, updated_at')
    .in('id', uniqueIds);

  if (error) {
    logSupabaseError('profiles', 'select', error, { ids: uniqueIds });
    throw error;
  }

  return new Map((data || []).map((row) => [row.id, row]));
}

async function loadCompletedGamesForUser(uid: string): Promise<RecentCompletedGame[]> {
  console.info('[playerProfiles] profile_recent_completed_games is not part of the live schema; returning empty recent completed games.', {
    uid,
  });
  return [];
}

export async function ensurePlayerProfile(user: SupabaseUser, nickname?: string) {
  const { data: existingProfile, error: getError } = await supabase
    .from('profiles')
    .select('id, nickname, avatar_url, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  if (getError && !isMissingRowError(getError)) {
    logSupabaseError('profiles', 'select', getError, { userId: user.id });
    throw getError;
  }

  const identity = user.user_metadata ?? {};
  const now = nowIsoString();
  const desiredDisplayName =
    nickname?.trim() ||
    identity.nickname ||
    identity.full_name ||
    identity.name ||
    existingProfile?.nickname ||
    'Player';
  const desiredPhotoUrl =
    identity.avatar_url ||
    identity.picture ||
    existingProfile?.avatar_url ||
    null;

  const payload = {
    id: user.id,
    nickname: desiredDisplayName,
    avatar_url: desiredPhotoUrl,
    created_at: existingProfile?.created_at || now,
    updated_at: now,
  };

  const { error: upsertError } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' });

  if (upsertError) {
    logSupabaseError('profiles', 'upsert', upsertError, { userId: user.id });
    throw upsertError;
  }
}

export function subscribePlayerProfile(
  uid: string,
  callback: (profile: PlayerProfile | null) => void,
  onError?: (error: unknown) => void
) {
  const channel = supabase
    .channel(`profile-${uid}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
      (payload) => {
        callback(payload.new ? mapPostgresProfileToPlayerProfile(payload.new) : null);
      }
    )
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') {
        return;
      }

      supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error) {
            if (isMissingRowError(error)) {
              callback(null);
              return;
            }

            logSupabaseError('profiles', 'select', error, { userId: uid, purpose: 'subscribePlayerProfile' });
            onError?.(error);
            return;
          }

          callback(mapPostgresProfileToPlayerProfile(data));
        });
    });

  return () => {
    void supabase.removeChannel(channel);
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
        loadRecentPlayers(uid).then(callback).catch(onError);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        loadRecentPlayers(uid).then(callback).catch(onError);
      }
    });

  return () => {
    void supabase.removeChannel(channel);
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

    logSupabaseError('recent_players', 'select', error, { uid });
    throw error;
  }

  const profileMap = await loadProfilesByIds((data || []).map((row) => row.opponent_id));

  return (data || []).map((row) => {
    const profile = profileMap.get(row.opponent_id);
    return {
      uid: row.opponent_id,
      nickname: profile?.nickname || row.display_name || 'Player',
      avatarUrl: profile?.avatar_url || row.photo_url || undefined,
      lastPlayedAt: row.last_played_at ? new Date(row.last_played_at).getTime() : Date.now(),
      lastGameId: row.last_game_id || undefined,
      hidden: !!row.hidden,
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    };
  });
}

export function subscribeRecentCompletedGames(
  uid: string,
  callback: (games: RecentCompletedGame[]) => void,
  onError?: (error: unknown) => void
) {
  loadCompletedGamesForUser(uid).then(callback).catch(onError);

  const channel = supabase
    .channel(`completed-games-${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => {
      loadCompletedGamesForUser(uid).then(callback).catch(onError);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players' }, () => {
      loadCompletedGamesForUser(uid).then(callback).catch(onError);
    })
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export async function loadMatchupHistory(uid: string, opponentUid: string) {
  const allGames = await loadCompletedGamesForUser(uid);
  const games = allGames.filter((game) => game.opponentIds?.includes(opponentUid)).slice(0, 5);

  const [{ data: summaryRows, error: summaryError }, profileMap] = await Promise.all([
    supabase
      .from('profile_matchup_summaries')
      .select('total_games, wins, losses, last_played_at')
      .eq('profile_id', uid)
      .eq('opponent_profile_id', opponentUid)
      .maybeSingle(),
    loadProfilesByIds([opponentUid]),
  ]);

  if (summaryError && !isMissingRowError(summaryError) && !isMissingTableError(summaryError)) {
    logSupabaseError('profile_matchup_summaries', 'select', summaryError, { uid, opponentUid });
  }

  const opponentProfile = profileMap.get(opponentUid);
  const fallbackLatestGame = games[0];
  const fallbackOpponent = fallbackLatestGame?.players.find((player) => player.uid === opponentUid);

  const summary: MatchupSummary | null = summaryRows || games.length > 0
    ? {
        opponentId: opponentUid,
        opponentNickname: opponentProfile?.nickname || fallbackOpponent?.nickname || 'Player',
        opponentAvatarUrl: opponentProfile?.avatar_url || undefined,
        wins: summaryRows?.wins ?? games.filter((game) => game.winnerId === uid).length,
        losses: summaryRows?.losses ?? games.filter((game) => game.winnerId === opponentUid).length,
        totalGames: summaryRows?.total_games ?? games.length,
        lastPlayedAt: summaryRows?.last_played_at
          ? new Date(summaryRows.last_played_at).getTime()
          : fallbackLatestGame?.completedAt ?? Date.now(),
      }
    : null;

  return { summary, games };
}

export async function removeRecentPlayer(uid: string, opponentUid: string) {
  const { error } = await supabase
    .from('recent_players')
    .update({ hidden: true, updated_at: nowIsoString() })
    .eq('user_id', uid)
    .eq('opponent_id', opponentUid);

  if (error) {
    if (isMissingTableError(error)) {
      return;
    }

    logSupabaseError('recent_players', 'update', error, { uid, opponentUid, operation: 'hide' });
    throw error;
  }
}

export async function updateRecentPlayer(
  uid: string,
  opponentUid: string,
  patch: Record<string, unknown>
) {
  const { error } = await supabase
    .from('recent_players')
    .upsert(
      {
        user_id: uid,
        opponent_id: opponentUid,
        display_name:
          typeof patch.nickname === 'string'
            ? patch.nickname
            : null,
        photo_url:
          typeof patch.avatar_url === 'string'
            ? patch.avatar_url
            : null,
        last_played_at:
          typeof patch.last_played_at === 'string'
            ? patch.last_played_at
            : nowIsoString(),
        last_game_id:
          typeof patch.last_game_id === 'string'
            ? patch.last_game_id
            : null,
        hidden: typeof patch.hidden === 'boolean' ? patch.hidden : false,
        updated_at: nowIsoString(),
      },
      { onConflict: 'user_id,opponent_id' }
    );

  if (error) {
    if (isMissingTableError(error)) {
      return;
    }

    logSupabaseError('recent_players', 'upsert', error, { uid, opponentUid, patchKeys: Object.keys(patch) });
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
  const { error } = await supabase.rpc('record_question_stats', {
    p_uid: uid,
    p_category: category,
    p_is_correct: isCorrect,
  });

  if (!error) {
    return;
  }

  if (isMissingFunctionError(error)) {
    console.warn('[playerProfiles] record_question_stats is not part of the canonical schema; skipping stats RPC.', {
      uid,
      category,
      isCorrect,
    });
    return;
  }

  logSupabaseError('rpc:record_question_stats', 'rpc', error, { uid, category, isCorrect });
  throw error;
}

export async function recordCompletedGame({
  gameId,
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
  const categoriesUsed = Array.from(
    new Set(questions.filter((question) => question.used).map((question) => question.category))
  );

  const { error } = await supabase
    .from('games')
    .update({
      status,
      winner_profile_id: winnerId,
      final_scores: finalScores,
      categories_used: categoriesUsed,
      completed_at: new Date(completedAt).toISOString(),
      last_updated_at: new Date(completedAt).toISOString(),
    })
    .eq('id', gameId);

  if (error) {
    logSupabaseError('games', 'update', error, { gameId, winnerId });
    throw error;
  }
}
