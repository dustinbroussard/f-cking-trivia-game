import { supabase } from '../lib/supabase';
import { GameInvite, RecentPlayer } from '../types';

export async function sendInvite(
  fromUser: { uid: string; displayName: string; photoURL?: string },
  toUser: { uid: string },
  gameId: string
) {
  const { data, error } = await supabase
    .from('game_invites')
    .insert({
      from_uid: fromUser.uid,
      nickname: fromUser.displayName,
      avatar_url: fromUser.photoURL,
      to_uid: toUser.uid,
      game_id: gameId,
      status: 'pending',
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

export async function acceptInvite(inviteId: string) {
  const { error } = await supabase
    .from('game_invites')
    .update({ status: 'accepted' })
    .eq('id', inviteId);
  if (error) throw error;
}

export async function declineInvite(inviteId: string) {
  const { error } = await supabase
    .from('game_invites')
    .update({ status: 'declined' })
    .eq('id', inviteId);
  if (error) throw error;
}

export async function expireInvite(inviteId: string) {
  const { error } = await supabase
    .from('game_invites')
    .update({ status: 'expired' })
    .eq('id', inviteId);
  if (error) throw error;
}

export function subscribeToIncomingInvites(
  uid: string,
  callback: (invites: GameInvite[]) => void,
  onError?: (error: unknown) => void
) {
  const channel = supabase
    .channel(`invites-${uid}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_invites', filter: `to_uid=eq.${uid}` },
      () => {
        loadIncomingInvites(uid).then(callback).catch(onError);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        loadIncomingInvites(uid).then(callback).catch(onError);
      }
    });

  return () => supabase.removeChannel(channel);
}

async function loadIncomingInvites(uid: string): Promise<GameInvite[]> {
  const { data, error } = await supabase
    .from('game_invites')
    .select('*')
    .eq('to_uid', uid)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) throw error;
  
  return data.map(d => ({
    id: d.id,
    fromUid: d.from_uid,
    fromNickname: d.nickname,
    fromAvatarUrl: d.avatar_url,
    toUid: d.to_uid,
    gameId: d.game_id,
    status: d.status,
    createdAt: new Date(d.created_at).getTime(),
  }));
}

export async function loadRecentPlayers(uid: string): Promise<RecentPlayer[]> {
  const { data, error } = await supabase
    .from('recent_players')
    .select('*')
    .eq('user_id', uid)
    .order('last_played_at', { ascending: false })
    .limit(8);

  if (error) throw error;

  return data.map(d => ({
    uid: d.opponent_id,
    nickname: d.nickname,
    avatarUrl: d.avatar_url,
    lastPlayedAt: new Date(d.last_played_at).getTime(),
    lastGameId: d.last_game_id,
    hidden: d.hidden,
    updatedAt: new Date(d.updated_at).getTime(),
  }));
}
