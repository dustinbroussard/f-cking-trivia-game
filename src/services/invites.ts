import { supabase } from '../lib/supabase';
import { GameInvite, RecentPlayer } from '../types';

export async function sendInvite(fromUser: { uid: string; displayName: string; photoURL?: string }, toUser: { uid: string }, gameId: string) {
  const { data, error } = await supabase.from('game_invites').insert({ from_uid: fromUser.uid, from_display_name: fromUser.displayName, from_photo_url: fromUser.photoURL, to_uid: toUser.uid, game_id: gameId, status: 'pending', created_at: new Date().toISOString() }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function acceptInvite(id: string, _userId?: string) {
  await supabase.from('game_invites').update({ status: 'accepted' }).eq('id', id);
}


export async function declineInvite(id: string, _userId?: string) {
  await supabase.from('game_invites').update({ status: 'declined' }).eq('id', id);
}


export async function expireInvite(id: string, _userId?: string) {
  await supabase.from('game_invites').update({ status: 'expired' }).eq('id', id);
}


export function subscribeToIncomingInvites(uid: string, callback: (is: GameInvite[]) => void, onError?: (e: unknown) => void) {
  const channel = supabase.channel(`invites-${uid}`).on('postgres_changes', { event: '*', schema: 'public', table: 'game_invites', filter: `to_uid=eq.${uid}` }, () => {
    loadIncomingInvites(uid).then(callback).catch(onError);
  }).subscribe((s) => {
    if (s === 'SUBSCRIBED') loadIncomingInvites(uid).then(callback).catch(onError);
  });
  return () => { void supabase.removeChannel(channel); };
}

async function loadIncomingInvites(uid: string): Promise<GameInvite[]> {
  const { data, error } = await supabase.from('game_invites').select('*').eq('to_uid', uid).eq('status', 'pending').order('created_at', { ascending: false }).limit(10);
  if (error) throw error;
  return data.map(d => ({ id: d.id, fromUid: d.from_uid, fromDisplayName: d.from_display_name, fromPhotoURL: d.from_photo_url, toUid: d.to_uid, gameId: d.game_id, status: d.status, createdAt: new Date(d.created_at).getTime() }));
}
