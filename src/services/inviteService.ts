import { supabase } from '../lib/supabase';
import { GameInvite } from '../types';
import { isMissingTableError, logSupabaseError, nowIsoString } from './supabaseUtils';

async function loadDisplayProfiles(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Map<string, any>();
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, nickname, avatar_url')
    .in('id', uniqueIds);

  if (error) {
    logSupabaseError('profiles', 'select', error, { ids: uniqueIds, purpose: 'invite-profiles' });
    throw error;
  }

  return new Map((data || []).map((row) => [row.id, row]));
}

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
      () => {
        loadInvites(userId).then(callback).catch(onError);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        loadInvites(userId).then(callback).catch(onError);
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

async function loadInvites(userId: string): Promise<GameInvite[]> {
  const { data, error } = await supabase
    .from('game_invites')
    .select('*')
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

  const profileMap = await loadDisplayProfiles((data || []).map((invite) => invite.from_uid));

  return (data || []).map((row) => {
    const fromProfile = profileMap.get(row.from_uid);
    return {
      id: row.id,
      gameId: row.game_id,
      fromUid: row.from_uid,
      fromNickname: fromProfile?.nickname || 'Player',
      fromAvatarUrl: fromProfile?.avatar_url || undefined,
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
  const { error } = await supabase
    .from('game_invites')
    .insert({
      game_id: gameId,
      from_uid: from.uid,
      to_uid: to.uid,
      status: 'pending',
      created_at: nowIsoString(),
    });
  if (error) {
    logSupabaseError('game_invites', 'insert', error, { fromUid: from.uid, toUid: to.uid, gameId });
    throw error;
  }
}

async function updateInviteStatus(inviteId: string, userId: string, status: GameInvite['status']) {
  const { error } = await supabase
    .from('game_invites')
    .update({ status, responded_at: nowIsoString() })
    .eq('id', inviteId)
    .eq('to_uid', userId);

  if (error) {
    logSupabaseError('game_invites', 'update', error, { inviteId, userId, status });
    throw error;
  }
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
