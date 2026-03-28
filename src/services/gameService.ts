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
          .maybeSingle()
          .then(({ data, error }) => {
            if (!error && data) callback(mapPostgresGameToState(data));
          });
      }
    });

  return () => supabase.removeChannel(channel);
};

export function mapPostgresGameToState(g: any): GameState {
  const state = g.game_state || {};
  const res = g.result || {};
  
  return {
    id: g.id,
    code: g.id, // Using id as fallback for code
    status: g.status,
    hostId: g.player_ids?.[0] || '', // Assuming first player is host
    playerIds: g.player_ids || [],
    players: state.players || [],
    currentTurn: g.current_turn_user_id || state.currentTurn,
    winnerId: g.winner_user_id || res.winnerId,
    gameMode: g.game_mode,
    gameState: state,
    result: res,
    currentQuestionId: state.currentQuestionId,
    currentQuestionCategory: state.currentQuestionCategory,
    currentQuestionIndex: state.currentQuestionIndex,
    currentQuestionStartedAt: state.currentQuestionStartedAt,
    questionIds: state.questionIds || [],
    answers: state.answers || {},
    finalScores: res.finalScores || {},
    categoriesUsed: res.categoriesUsed || [],
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
      id: code,
      player_ids: [hostId],
      status: isSolo ? 'active' : 'waiting',
      game_mode: isSolo ? 'solo' : 'multiplayer',
      current_turn_user_id: hostId,
      game_state: {
        players: [initialPlayer],
      },
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
    .select('player_ids, game_state')
    .eq('id', gameId)
    .maybeSingle();

  if (getError || !game) return;

  const playerIds = Array.from(new Set([...(game.player_ids || []), userId]));
  
  const state = game.game_state || {};
  const existingPlayer = (state.players || []).find((p: any) => p.uid === userId);
  let players = state.players || [];
  
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
      game_state: { ...state, players },
      status: playerIds.length >= 2 ? 'active' : 'waiting',
      current_turn_user_id: playerIds.length >= 2 ? (game.player_ids?.[0] || userId) : null,
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
    .select('player_ids, game_state')
    .eq('id', gameId)
    .maybeSingle();

  if (getError || !game) return;

  const playerIds = Array.from(new Set([...(game.player_ids || []), userId]));
  
  const { error: updateError } = await supabase
    .from('games')
    .update({
      player_ids: playerIds,
      status: playerIds.length >= 2 ? 'active' : 'waiting',
      current_turn_user_id: playerIds.length >= 2 ? (game.player_ids?.[0] || userId) : null,
      last_updated: new Date().toISOString(),
    })
    .eq('id', gameId);

  if (updateError) throw updateError;
}

export async function updatePlayerActivity(gameId: string, userId: string, isResume = false) {
  const { data: game, error: getError } = await supabase
    .from('games')
    .select('game_state')
    .eq('id', gameId)
    .maybeSingle();

  if (getError || !game) return;

  const state = game.game_state || {};
  const activity = Date.now();
  const players = (state.players || []).map((p: any) => {
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
    .update({ 
      game_state: { ...state, players }, 
      last_updated: new Date().toISOString() 
    })
    .eq('id', gameId);
  
  if (error) throw error;
}

export async function abandonGame(gameId: string) {
  const { error } = await supabase
    .from('games')
    .update({
      status: 'abandoned',
      last_updated: new Date().toISOString(),
    })
    .eq('id', gameId);
  if (error) throw error;
}

export async function persistQuestionsToGame(gameId: string, questionIds: string[]) {
  const { data } = await supabase.from('games').select('game_state').eq('id', gameId).maybeSingle();
  if (!data) return;
  const state = data?.game_state || {};
  await supabase.from('games').update({
    game_state: { ...state, questionIds },
    last_updated: new Date().toISOString(),
  }).eq('id', gameId);
}

export async function setActiveGameQuestion(
  gameId: string,
  category: string,
  questionId: string,
  questionIndex: number,
  startedAt: number
) {
  const { data } = await supabase.from('games').select('game_state').eq('id', gameId).maybeSingle();
  if (!data) return;
  const state = data?.game_state || {};
  await supabase.from('games').update({
    game_state: { 
      ...state, 
      currentQuestionId: questionId,
      currentQuestionCategory: category,
      currentQuestionIndex: questionIndex,
      currentQuestionStartedAt: startedAt
    },
    last_updated: new Date().toISOString(),
  }).eq('id', gameId);
}

export async function clearActiveGameQuestion(gameId: string) {
  const { data } = await supabase.from('games').select('game_state').eq('id', gameId).maybeSingle();
  if (!data) return;
  const state = data?.game_state || {};
  await supabase.from('games').update({
    game_state: { 
      ...state, 
      currentQuestionId: null,
      currentQuestionCategory: null,
      currentQuestionStartedAt: null
    },
    last_updated: new Date().toISOString(),
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

export async function getGameById(gameId: string): Promise<GameState | null> {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .maybeSingle();
  
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
    .eq('id', code.toUpperCase())
    .eq('status', 'waiting')
    .maybeSingle();
  
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
  const [{ data: messages, error: messagesError }, { data: game, error: gameError }] = await Promise.all([
    supabase
      .from('game_messages')
      .select('*')
      .eq('game_id', game_id)
      .order('timestamp', { ascending: true })
      .limit(50),
    supabase
      .from('games')
      .select('game_state')
      .eq('id', game_id)
      .maybeSingle(),
  ]);

  if (messagesError) throw messagesError;
  if (gameError) throw gameError;

  const state = game?.game_state || {};
  const playersById = new Map(
    ((state.players as any[]) || []).map((player) => [player.uid, player])
  );

  return (messages || []).map((m) => {
    const player = playersById.get(m.user_id);
    return {
      id: m.id,
      uid: m.user_id,
      name: player?.name || 'Player',
      text: m.content,
      timestamp: new Date(m.timestamp).getTime(),
      avatarUrl: player?.avatarUrl || undefined,
    };
  });
}

export async function getGameQuestions(game_id: string): Promise<TriviaQuestion[]> {
  // In Supabase, if questions are stored in a regular table, we can fetch them via a join or where in
  const { data: game, error: getError } = await supabase
    .from('games')
    .select('game_state')
    .eq('id', game_id)
    .maybeSingle();
  
  if (getError) throw getError;
  const questionIds = game.game_state?.questionIds || [];
  if (questionIds.length === 0) return [];

  const { data: qData, error: qError } = await supabase
    .from('questions')
    .select('*')
    .in('id', questionIds);
  
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
