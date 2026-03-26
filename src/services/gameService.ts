import { supabase } from '../lib/supabase';
import { GameState, GameAnswer, Player, TriviaQuestion } from '../types';

export const subscribeToGame = (gameId: string, callback: (game: GameState) => void) => {
  const channel = supabase
    .channel(`game-${gameId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => {
        // Here we need to map the Postgres row back to GameState
        const g = payload.new as any;
        callback(mapPostgresGameToState(g));
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        supabase
          .from('games')
          .select('*')
          .eq('id', gameId)
          .single()
          .then(({ data, error }) => {
            if (!error && data) callback(mapPostgresGameToState(data));
          });
      }
    });

  return () => supabase.removeChannel(channel);
};

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
    createdAt: new Date(g.created_at).getTime(),
  };
}

export async function createGame(
  hostId: string, 
  displayName: string, 
  avatarUrl?: string, 
  isSolo = false
): Promise<GameState> {
  const code = isSolo ? 'SOLO' : Math.random().toString(36).substring(2, 8).toUpperCase();
  const now = new Date().toISOString();
  
  const initialPlayer: Player = {
    uid: hostId,
    name: displayName,
    score: 0,
    streak: 0,
    completedCategories: [],
    avatarUrl: avatarUrl || '',
    lastActive: Date.now(),
  };

  const { data, error } = await supabase
    .from('games')
    .insert({
      code,
      host_id: hostId,
      player_ids: [hostId],
      players: [initialPlayer],
      status: isSolo ? 'active' : 'waiting',
      created_at: now,
      last_updated: now,
    })
    .select('*')
    .single();

  if (error) throw error;
  return mapPostgresGameToState(data);
}

export async function joinGameById(gameId: string, userId: string, displayName: string, avatarUrl?: string) {
  const { data: game, error: getError } = await supabase
    .from('games')
    .select('player_ids, players')
    .eq('id', gameId)
    .single();

  if (getError) throw getError;

  const playerIds = Array.from(new Set([...(game.player_ids || []), userId]));
  
  const existingPlayer = (game.players || []).find((p: any) => p.uid === userId);
  let players = game.players || [];
  
  if (!existingPlayer) {
    players = [
      ...players,
      {
        uid: userId,
        name: displayName,
        score: 0,
        streak: 0,
        completedCategories: [],
        avatarUrl: avatarUrl || '',
        lastActive: Date.now(),
      } as Player
    ];
  }

  const { error: updateError } = await supabase
    .from('games')
    .update({
      player_ids: playerIds,
      players: players,
      status: playerIds.length >= 2 ? 'active' : 'waiting',
      last_updated: new Date().toISOString(),
    })
    .eq('id', gameId);

  if (updateError) throw updateError;
}

export async function updateGame(gameId: string, patch: Partial<any>) {
  const { error } = await supabase
    .from('games')
    .update({
      ...patch,
      last_updated: new Date().toISOString(),
    })
    .eq('id', gameId);

  if (error) throw error;
}

export async function joinGame(gameId: string, userId: string) {
  const { data: game, error: getError } = await supabase
    .from('games')
    .select('player_ids')
    .eq('id', gameId)
    .single();

  if (getError) throw getError;

  const playerIds = Array.from(new Set([...(game.player_ids || []), userId]));
  
  const { error: updateError } = await supabase
    .from('games')
    .update({
      player_ids: playerIds,
      status: playerIds.length >= 2 ? 'active' : 'waiting',
      last_updated: new Date().toISOString(),
    })
    .eq('id', gameId);

  if (updateError) throw updateError;
}

export async function updatePlayerActivity(gameId: string, userId: string, isResume = false) {
  const { data: game, error: getError } = await supabase
    .from('games')
    .select('players')
    .eq('id', gameId)
    .single();

  if (getError) throw getError;

  const activity = Date.now();
  const players = (game.players || []).map((p: any) => {
    if (p.uid === userId) {
      return { 
        ...p, 
        lastActive: activity,
        lastResumedAt: isResume ? activity : (p.lastResumedAt || undefined)
      };
    }
    return p;
  });

  const { error } = await supabase
    .from('games')
    .update({ players, last_updated: new Date().toISOString() })
    .eq('id', gameId);
  
  if (error) throw error;
}

export async function abandonGame(gameId: string) {
  const { error } = await supabase
    .from('games')
    .update({
      status: 'abandoned',
      current_question_id: null,
      current_question_category: null,
      current_question_started_at: null,
      last_updated: new Date().toISOString(),
    })
    .eq('id', gameId);
  if (error) throw error;
}

export async function persistQuestionsToGame(gameId: string, questionIds: string[]) {
  const { error } = await supabase
    .from('games')
    .update({
      question_ids: questionIds,
      last_updated: new Date().toISOString(),
    })
    .eq('id', gameId);
  if (error) throw error;
}

export async function setActiveGameQuestion(
  gameId: string,
  category: string,
  questionId: string,
  questionIndex: number,
  startedAt: number
) {
  const { error } = await supabase
    .from('games')
    .update({
      current_question_id: questionId,
      current_question_category: category,
      current_question_index: questionIndex,
      current_question_started_at: startedAt,
      last_updated: new Date().toISOString(),
    })
    .eq('id', gameId);
  if (error) throw error;
}

export async function clearActiveGameQuestion(gameId: string) {
  const { error } = await supabase
    .from('games')
    .update({
      current_question_id: null,
      current_question_category: null,
      current_question_started_at: null,
      last_updated: new Date().toISOString(),
    })
    .eq('id', gameId);
  if (error) throw error;
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

export async function getGameById(gameId: string): Promise<GameState | null> {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return mapPostgresGameToState(data);
}

export async function getGameByCode(code: string): Promise<GameState | null> {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('code', code.toUpperCase())
    .eq('status', 'waiting')
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return mapPostgresGameToState(data);
}


export const subscribeToMessages = (game_id: string, callback: (messages: any[]) => void) => {
  const channel = supabase
    .channel(`messages-${game_id}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'game_messages', filter: `game_id=eq.${game_id}` },
      () => {
        loadMessages(game_id).then(callback);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        loadMessages(game_id).then(callback);
      }
    });

  return () => supabase.removeChannel(channel);
};

export async function sendMessage(game_id: string, user_id: string, content: string) {
  const { error } = await supabase
    .from('game_messages')
    .insert({
      game_id,
      user_id,
      content,
      timestamp: new Date().toISOString()
    });
  if (error) throw error;
}

async function loadMessages(game_id: string) {
  const { data, error } = await supabase
    .from('game_messages')
    .select('*')
    .eq('game_id', game_id)
    .order('timestamp', { ascending: true })
    .limit(50);
  
  if (error) throw error;
  return data.map(m => ({
    id: m.id,
    userId: m.user_id,
    text: m.content,
    timestamp: new Date(m.timestamp).getTime()
  }));
}

export async function getGameQuestions(game_id: string): Promise<TriviaQuestion[]> {
  // In Supabase, if questions are stored in a regular table, we can fetch them via a join or where in
  const { data: game, error: getError } = await supabase
    .from('games')
    .select('question_ids')
    .eq('id', game_id)
    .single();
  
  if (getError) throw getError;
  if (!game.question_ids || game.question_ids.length === 0) return [];

  const { data: qData, error: qError } = await supabase
    .from('questions')
    .select('*')
    .in('id', game.question_ids);
  
  if (qError) throw qError;
  return (qData || []).map((q: any) => ({
    ...q,
    // Add mapping if needed to match TriviaQuestion interface
  })) as TriviaQuestion[];
}

export async function getPastGames(userId: string): Promise<GameState[]> {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .contains('player_ids', [userId])
    .eq('status', 'completed')
    .order('last_updated', { ascending: false })
    .limit(10);
  
  if (error) throw error;
  return (data || []).map(mapPostgresGameToState);
}

