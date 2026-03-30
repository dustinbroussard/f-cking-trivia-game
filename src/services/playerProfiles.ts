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

const AVATAR_STORAGE_BUCKET = 'avatars';
const AVATAR_STORAGE_EXTENSION = 'jpg';
let hasLoggedMissingQuestionStatsRpc = false;

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

export const MAX_NICKNAME_LENGTH = 24;

export function sanitizeNicknameInput(value: string) {
  return value.trim().slice(0, MAX_NICKNAME_LENGTH);
}

function buildAvatarStoragePath(userId: string) {
  return `${userId}/avatar.${AVATAR_STORAGE_EXTENSION}`;
}

function dataUrlToBlob(dataUrl: string) {
  const [header, base64Payload] = dataUrl.split(',');
  if (!header || !base64Payload) {
    throw new Error('Invalid avatar data URL.');
  }

  const mimeMatch = header.match(/^data:(.*?);base64$/);
  if (!mimeMatch?.[1]) {
    throw new Error('Unsupported avatar data URL header.');
  }

  const binary = atob(base64Payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeMatch[1] });
}

async function uploadAvatarToStorage(user: SupabaseUser, avatarDataUrl: string) {
  const blob = dataUrlToBlob(avatarDataUrl);
  const path = buildAvatarStoragePath(user.id);

  const { data, error } = await supabase.storage
    .from(AVATAR_STORAGE_BUCKET)
    .upload(path, blob, {
      cacheControl: '3600',
      contentType: blob.type || 'image/jpeg',
      upsert: true,
    });

  if (error) {
    logSupabaseError('storage:avatars', 'upload', error, {
      userId: user.id,
      bucket: AVATAR_STORAGE_BUCKET,
      path,
      contentType: blob.type || 'image/jpeg',
      sizeBytes: blob.size,
    });
    throw error;
  }

  const { data: publicUrlData } = supabase.storage
    .from(AVATAR_STORAGE_BUCKET)
    .getPublicUrl(path);
  const publicUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

  console.info('[profiles] avatar upload result', {
    userId: user.id,
    bucket: AVATAR_STORAGE_BUCKET,
    path,
    storageRow: data,
    publicUrl,
    sizeBytes: blob.size,
  });

  return { path, publicUrl };
}

async function deleteAvatarFromStorage(userId: string) {
  const path = buildAvatarStoragePath(userId);
  const { data, error } = await supabase.storage
    .from(AVATAR_STORAGE_BUCKET)
    .remove([path]);

  if (error) {
    logSupabaseError('storage:avatars', 'remove', error, {
      userId,
      bucket: AVATAR_STORAGE_BUCKET,
      path,
    });
    throw error;
  }

  console.info('[profiles] avatar storage delete result', {
    userId,
    bucket: AVATAR_STORAGE_BUCKET,
    path,
    storageRows: data,
  });
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
  const desiredNickname =
    sanitizeNicknameInput(nickname || '') ||
    identity.nickname ||
    identity.full_name ||
    identity.name ||
    existingProfile?.nickname ||
    'Player';
  const desiredPhotoUrl =
    existingProfile?.avatar_url ||
    identity.avatar_url ||
    identity.picture ||
    null;

  const payload = {
    id: user.id,
    nickname: desiredNickname,
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

  return mapPostgresProfileToPlayerProfile(payload);
}

export async function savePlayerNickname(user: SupabaseUser, nickname: string) {
  const trimmedNickname = sanitizeNicknameInput(nickname);
  if (!trimmedNickname) {
    throw new Error('Nickname cannot be empty.');
  }

  const { data: existingProfile, error: getError } = await supabase
    .from('profiles')
    .select('id, nickname, avatar_url, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  if (getError && !isMissingRowError(getError)) {
    logSupabaseError('profiles', 'select', getError, { userId: user.id, purpose: 'savePlayerNickname' });
    throw getError;
  }

  const now = nowIsoString();
  const payload = {
    id: user.id,
    nickname: trimmedNickname,
    avatar_url: existingProfile?.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
    created_at: existingProfile?.created_at || now,
    updated_at: now,
  };

  const { error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' });

  if (error) {
    logSupabaseError('profiles', 'upsert', error, { userId: user.id, purpose: 'savePlayerNickname' });
    throw error;
  }

  return mapPostgresProfileToPlayerProfile(payload);
}

export async function savePlayerAvatar(user: SupabaseUser, avatarDataUrl: string | null) {
  const normalizedAvatarInput = typeof avatarDataUrl === 'string' && avatarDataUrl.trim().length > 0
    ? avatarDataUrl.trim()
    : null;

  const { data: existingProfile, error: getError } = await supabase
    .from('profiles')
    .select('id, nickname, avatar_url, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  if (getError && !isMissingRowError(getError)) {
    logSupabaseError('profiles', 'select', getError, { userId: user.id, purpose: 'savePlayerAvatar' });
    throw getError;
  }

  let resolvedAvatarUrl: string | null;
  if (normalizedAvatarInput) {
    const { publicUrl } = await uploadAvatarToStorage(user, normalizedAvatarInput);
    resolvedAvatarUrl = publicUrl;
  } else {
    resolvedAvatarUrl = null;
  }

  const now = nowIsoString();
  const payload = {
    id: user.id,
    nickname:
      existingProfile?.nickname ||
      user.user_metadata?.nickname ||
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      'Player',
    avatar_url: resolvedAvatarUrl,
    created_at: existingProfile?.created_at || now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select('id, nickname, avatar_url, created_at, updated_at')
    .single();

  if (error) {
    logSupabaseError('profiles', 'upsert', error, {
      userId: user.id,
      purpose: normalizedAvatarInput ? 'savePlayerAvatar' : 'removePlayerAvatar',
      avatarLength: normalizedAvatarInput?.length || 0,
    });
    throw error;
  }

  console.info('[profiles] profile avatar update result', {
    userId: user.id,
    avatarSaved: !!resolvedAvatarUrl,
    avatarLength: resolvedAvatarUrl?.length || 0,
    returnedRow: data,
  });

  return mapPostgresProfileToPlayerProfile(data);
}

export async function removePlayerAvatar(user: SupabaseUser) {
  try {
    await deleteAvatarFromStorage(user.id);
  } catch (error) {
    console.warn('[profiles] avatar storage delete skipped or failed; clearing profile avatar_url anyway', {
      userId: user.id,
      error,
    });
  }
  const updatedProfile = await savePlayerAvatar(user, null);
  console.info('[profiles] avatar removal result', {
    userId: user.id,
    returnedProfile: updatedProfile,
  });
  return updatedProfile;
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
        console.info('[profiles] realtime profile payload', {
          userId: uid,
          payload,
        });
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

          console.info('[profiles] avatar fetch on app load', {
            userId: uid,
            avatarUrl: data?.avatar_url || null,
            profileRow: data,
          });
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
    .select('user_id, opponent_id, nickname, avatar_url, last_played_at, last_game_id, hidden, updated_at')
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
      nickname: profile?.nickname || row.nickname || 'Player',
      avatarUrl: profile?.avatar_url || row.avatar_url || undefined,
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
  const payload = {
    user_id: uid,
    opponent_id: opponentUid,
    nickname:
      typeof patch.nickname === 'string'
        ? patch.nickname
        : null,
    avatar_url:
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
  };

  const { data, error } = await supabase
    .from('recent_players')
    .upsert(
      payload,
      { onConflict: 'user_id,opponent_id' }
    )
    .select('user_id, opponent_id, nickname, avatar_url, last_played_at, last_game_id, hidden, updated_at')
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return;
    }

    logSupabaseError('recent_players', 'upsert', error, { uid, opponentUid, patchKeys: Object.keys(patch) });
    throw error;
  }

  console.info('[recent_players] upsert succeeded', {
    uid,
    opponentUid,
    payload,
    returnedRow: data,
    onConflict: 'user_id,opponent_id',
  });
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
    if (!hasLoggedMissingQuestionStatsRpc) {
      hasLoggedMissingQuestionStatsRpc = true;
      console.info(
        '[playerProfiles] Optional Supabase RPC "record_question_stats" is not available in the current backend schema; skipping question stats sync until that function exists.',
        {
          rpc: 'record_question_stats',
          expectedArgs: ['p_uid', 'p_category', 'p_is_correct'],
        }
      );
    }
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
