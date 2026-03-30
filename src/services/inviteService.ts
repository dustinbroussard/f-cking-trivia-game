import { supabase } from '../lib/supabase';
import { GameInvite } from '../types';
import { isMissingTableError, logSupabaseError, nowIsoString } from './supabaseUtils';

const GAME_INVITES_SELECT_COLUMNS =
  'id, from_uid, nickname, avatar_url, to_uid, game_id, status, created_at, updated_at';

export function subscribeToIncomingInvites(
  userId: string,
  callback: (invites: GameInvite[]) => void,
  onError?: (err: any) => void
) {
  const channel = supabase
    .channel(`invites-${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_invites', filter: `to_uid=eq.${userId}` },
      (payload) => {
        console.info('[game_invites] realtime event', {
          userId,
          payload,
        });
        loadInvites(userId).then(callback).catch(onError);
      }
    )
    .subscribe((status) => {
      console.info('[game_invites] subscription status', {
        userId,
        status,
      });
      if (status === 'SUBSCRIBED') {
        loadInvites(userId).then(callback).catch(onError);
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

async function loadInvites(userId: string): Promise<GameInvite[]> {
  console.info('[game_invites] fetch pending invites', {
    userId,
    selectColumns: GAME_INVITES_SELECT_COLUMNS,
  });

  const { data, error } = await supabase
    .from('game_invites')
    .select(GAME_INVITES_SELECT_COLUMNS)
    .eq('to_uid', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      return [];
    }
    logSupabaseError('game_invites', 'select', error, { userId });
    throw error;
  }

  console.info('[game_invites] fetch pending invites result', {
    userId,
    count: (data || []).length,
    rows: data || [],
  });

  return (data || []).map((row) => {
    return {
      id: row.id,
      gameId: row.game_id,
      fromUid: row.from_uid,
      fromNickname: row.nickname || 'Player',
      fromAvatarUrl: row.avatar_url || undefined,
      toUid: row.to_uid,
      status: row.status as GameInvite['status'],
      createdAt: new Date(row.created_at).getTime(),
    };
  });
}

export async function sendInvite(
  from: { uid: string; nickname: string; avatarUrl?: string },
  to: { uid: string },
  gameId: string
) {
  const payload = {
    game_id: gameId,
    from_uid: from.uid,
    nickname: from.nickname || 'Player',
    avatar_url: from.avatarUrl ?? null,
    to_uid: to.uid,
    status: 'pending',
    created_at: nowIsoString(),
    updated_at: nowIsoString(),
  };

  const { data, error } = await supabase
    .from('game_invites')
    .insert(payload)
    .select(GAME_INVITES_SELECT_COLUMNS)
    .single();

  if (error) {
    logSupabaseError('game_invites', 'insert', error, { fromUid: from.uid, toUid: to.uid, gameId, payload });
    throw error;
  }

  console.info('[game_invites] insert succeeded', {
    payload,
    returnedRow: data,
  });
}

async function updateInviteStatus(inviteId: string, userId: string, status: GameInvite['status']) {
  const updatePayload = { status, updated_at: nowIsoString() };

  const { data, error } = await supabase
    .from('game_invites')
    .update(updatePayload)
    .eq('id', inviteId)
    .eq('to_uid', userId)
    .select(GAME_INVITES_SELECT_COLUMNS)
    .single();

  if (error) {
    logSupabaseError('game_invites', 'update', error, { inviteId, userId, status });
    throw error;
  }

  console.info('[game_invites] status update succeeded', {
    inviteId,
    userId,
    status,
    updatePayload,
    returnedRow: data,
  });
}

export async function acceptInvite(inviteId: string, userId: string) {
  await updateInviteStatus(inviteId, userId, 'accepted');
}

export async function declineInvite(inviteId: string, userId: string) {
  await updateInviteStatus(inviteId, userId, 'declined');
}

export async function expireInvite(inviteId: string, userId: string) {
  await updateInviteStatus(inviteId, userId, 'expired');
}
