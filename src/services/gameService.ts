import { supabase } from '../lib/supabase';
import { GameState, GameAnswer, Player, TriviaQuestion } from '../types';

export function mapPostgresGameToState(g: any): GameState {
  return {
    id: g.id,
    code: g.code,
    status: g.status,
    hostId: g.host_id,
    playerIds: g.player_ids || [],
    players: g.players || [],
    currentTurn: g.current_turn,
    winnerId: g.winner_id,
    currentQuestionId: g.current_question_id,
    currentQuestionCategory: g.current_question_category,
    currentQuestionIndex: g.current_question_index,
    currentQuestionStartedAt: g.current_question_started_at ? Number(g.current_question_started_at) : null,
    questionIds: g.question_ids || [],
    answers: g.answers || {},
    finalScores: g.final_scores || {},
    categoriesUsed: g.categories_used || [],
    statsRecordedAt: g.stats_recorded_at ? new Date(g.stats_recorded_at).getTime() : undefined,
    lastUpdated: new Date(g.last_updated).getTime(),
  };
}

export const subscribeToGame = (gameId: string, callback: (game: GameState) => void) => {
  const channel = supabase
    .channel(`game-${gameId}`)
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'games', 
      filter: `id=eq.${gameId}` 
    }, (p) => {
      callback(mapPostgresGameToState(p.new));
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        supabase.from('games').select('*').eq('id', gameId).single().then(({ data }) => {
          if (data) callback(mapPostgresGameToState(data));
        });
      }
    });
  return () => { void supabase.removeChannel(channel); };
};

export async function createGame(game: Partial<GameState>, initialPlayer: Player) {
  const { error } = await supabase.from('games').insert({
    id: game.id,
    code: game.code,
    host_id: game.hostId,
    player_ids: game.playerIds,
    players: [initialPlayer],
    status: game.status,
    created_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function updateGame(gameId: string, patch: any) {
  const { error } = await supabase.from('games').update({
    ...patch,
    last_updated: new Date().toISOString()
  }).eq('id', gameId);
  if (error) throw error;
}

export async function getGameById(gameId: string, searchByCode = false): Promise<GameState | null> {
  const query = supabase.from('games').select('*');
  if (searchByCode) {
    query.eq('code', gameId).eq('status', 'waiting');
  } else {
    query.eq('id', gameId);
  }
  const { data, error } = await query.single();
  if (error || !data) return null;
  return mapPostgresGameToState(data);
}

export async function joinGame(gameId: string, userId: string, name: string, avatarUrl: string) {
  const { data: g } = await supabase.from('games').select('player_ids, players').eq('id', gameId).single();
  if (!g) return;
  
  const pIds = Array.from(new Set([...g.player_ids, userId]));
  const ps = [...g.players.filter((p: any) => p.uid !== userId), { 
    uid: userId, 
    name, 
    score: 0, 
    streak: 0, 
    completedCategories: [], 
    avatarUrl 
  }];
  
  await supabase.from('games').update({
    player_ids: pIds,
    players: ps,
    status: pIds.length >= 2 ? 'active' : 'waiting',
    last_updated: new Date().toISOString()
  }).eq('id', gameId);
}

export async function recordAnswer(gameId: string, questionId: string, userId: string, answer: GameAnswer) {
  const { error } = await supabase.rpc('record_game_answer', {
    p_game_id: gameId,
    p_question_id: questionId,
    p_user_id: userId,
    p_answer: answer
  });
  if (error) throw error;
}

export const subscribeToMessages = (game_id: string, callback: (messages: any[]) => void) => {
  const channel = supabase
    .channel(`messages-${game_id}`)
    .on('postgres_changes', { 
      event: 'INSERT', 
      schema: 'public', 
      table: 'game_messages', 
      filter: `game_id=eq.${game_id}` 
    }, () => {
      loadMessages(game_id).then(callback);
    })
    .subscribe((s) => {
      if (s === 'SUBSCRIBED') loadMessages(game_id).then(callback);
    });
  return () => { void supabase.removeChannel(channel); };
};

export async function sendMessage(game_id: string, user_id: string, content: string) {
  const { error } = await supabase.from('game_messages').insert({ 
    game_id, 
    user_id, 
    content, 
    timestamp: new Date().toISOString() 
  });
  if (error) throw error;
}

async function loadMessages(game_id: string) {
  const { data } = await supabase
    .from('game_messages')
    .select('*, profiles(display_name, photo_url)')
    .eq('game_id', game_id)
    .order('timestamp', { ascending: true })
    .limit(50);
  
  return (data || []).map((m: any) => ({
    id: m.id,
    userId: m.user_id,
    uid: m.user_id,
    name: m.profiles?.display_name || 'Unknown',
    avatarUrl: m.profiles?.photo_url || undefined,
    text: m.content,
    timestamp: new Date(m.timestamp).getTime()
  }));
}

export async function getGameQuestions(game_id: string): Promise<TriviaQuestion[]> {
  const { data: g } = await supabase.from('games').select('question_ids').eq('id', game_id).single();
  if (!g?.question_ids?.length) return [];
  
  const { data: qs } = await supabase.from('questions').select('*').in('id', g.question_ids);
  return (qs || []).map(q => ({ ...q })) as TriviaQuestion[];
}

export async function persistQuestionsToGame(gameId: string, questionIds: string[]) {
  await updateGame(gameId, { question_ids: questionIds });
}

export async function updatePlayerActivity(gameId: string, userId: string, isResume = false) {
  // Note: In the new schema, player activity is tracked in game_players table
  const { error } = await supabase
    .from('game_players')
    .update({
      last_active: new Date().toISOString(),
      ...(isResume ? { last_resumed_at: new Date().toISOString() } : {})
    })
    .eq('game_id', gameId)
    .eq('user_id', userId);
  
  if (error) throw error;
}

export async function abandonGame(gameId: string) {
  await updateGame(gameId, { 
    status: 'abandoned', 
    current_question_id: null, 
    current_question_category: null, 
    current_question_started_at: null 
  });
}

export async function setActiveGameQuestion(gameId: string, cat: string, qId: string, idx: number, start: number) {
  await updateGame(gameId, { 
    current_question_id: qId, 
    current_question_category: cat, 
    current_question_index: idx, 
    current_question_started_at: new Date(start).toISOString() 
  });
}

export async function clearActiveGameQuestion(gameId: string) {
  await updateGame(gameId, { 
    current_question_id: null, 
    current_question_category: null, 
    current_question_started_at: null 
  });
}
