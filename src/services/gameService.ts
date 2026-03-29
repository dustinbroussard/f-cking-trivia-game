import { supabase } from '../lib/supabase';
import { GameAnswer, GameState, PersistedGameState, Player, TriviaQuestion } from '../types';
import {
  getGameDisplayCode,
  isMissingRowError,
  isMissingTableError,
  isUuid,
  logSupabaseError,
  nowIsoString,
} from './supabaseUtils';

function createGameId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  throw new Error('crypto.randomUUID is not available in this environment.');
}

function normalizeStoredGameState(value: any): PersistedGameState {
  const state = value && typeof value === 'object' ? value : {};
  const players = Array.isArray(state.players) ? state.players : [];
  const playerIds = Array.isArray(state.playerIds)
    ? state.playerIds.filter((entry: unknown): entry is string => typeof entry === 'string')
    : players
        .map((player: any) => player?.uid)
        .filter((entry: unknown): entry is string => typeof entry === 'string');

  return {
    hostId: typeof state.hostId === 'string' ? state.hostId : playerIds[0] || '',
    playerIds,
    players,
    questionIds: Array.isArray(state.questionIds) ? state.questionIds : [],
    answers: state.answers && typeof state.answers === 'object' ? state.answers : {},
    currentQuestionId: typeof state.currentQuestionId === 'string' ? state.currentQuestionId : null,
    currentQuestionCategory: typeof state.currentQuestionCategory === 'string' ? state.currentQuestionCategory : null,
    currentQuestionIndex: typeof state.currentQuestionIndex === 'number' ? state.currentQuestionIndex : undefined,
    currentQuestionStartedAt: typeof state.currentQuestionStartedAt === 'number' ? state.currentQuestionStartedAt : null,
  };
}

function buildInitialStoredGameState(hostId: string, initialPlayer: Player): PersistedGameState {
  return {
    hostId,
    playerIds: [hostId],
    players: [initialPlayer],
    questionIds: [],
    answers: {},
    currentQuestionId: null,
    currentQuestionCategory: null,
    currentQuestionIndex: undefined,
    currentQuestionStartedAt: null,
  };
}

function sanitizeGameResult(value: any) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return {
    ...value,
    finalScores: value.finalScores && typeof value.finalScores === 'object' ? value.finalScores : {},
    categoriesUsed: Array.isArray(value.categoriesUsed) ? value.categoriesUsed : [],
  };
}

export function mapPostgresGameToState(row: any): GameState {
  const state = normalizeStoredGameState(row.game_state);
  const result = sanitizeGameResult(row.result);

  return {
    id: row.id,
    code: getGameDisplayCode(row.id),
    status: row.status,
    hostId: state.hostId,
    playerIds: state.playerIds,
    players: state.players,
    currentTurn: row.current_turn_user_id ?? null,
    winnerId: row.winner_user_id ?? null,
    gameMode: row.game_mode || undefined,
    gameState: state,
    result,
    currentQuestionId: state.currentQuestionId ?? null,
    currentQuestionCategory: state.currentQuestionCategory ?? null,
    currentQuestionIndex: state.currentQuestionIndex,
    currentQuestionStartedAt: state.currentQuestionStartedAt ?? null,
    questionIds: state.questionIds,
    answers: state.answers,
    finalScores: result.finalScores || {},
    categoriesUsed: result.categoriesUsed || [],
    lastUpdated: new Date(row.updated_at).getTime(),
    createdAt: new Date(row.created_at).getTime(),
  };
}

async function fetchGameRow(gameId: string) {
  const { data, error } = await supabase.from('games').select('*').eq('id', gameId).maybeSingle();

  if (error) {
    if (isMissingRowError(error)) {
      return null;
    }

    logSupabaseError('games', 'select', error, { gameId });
    throw error;
  }

  return data;
}

function normalizeGamePatch(
  currentRow: any,
  patch: Record<string, any>
) {
  const currentState = normalizeStoredGameState(currentRow?.game_state);
  const nextState: PersistedGameState = {
    ...currentState,
    players: patch.players ?? currentState.players,
    playerIds: patch.playerIds ?? patch.players?.map((player: Player) => player.uid) ?? currentState.playerIds,
    questionIds: patch.question_ids ?? patch.questionIds ?? currentState.questionIds,
    answers: patch.answers ?? currentState.answers,
    currentQuestionId:
      patch.current_question_id ?? patch.currentQuestionId ?? currentState.currentQuestionId ?? null,
    currentQuestionCategory:
      patch.current_question_category ??
      patch.currentQuestionCategory ??
      currentState.currentQuestionCategory ??
      null,
    currentQuestionIndex:
      patch.current_question_index ?? patch.currentQuestionIndex ?? currentState.currentQuestionIndex,
    currentQuestionStartedAt:
      patch.current_question_started_at ??
      patch.currentQuestionStartedAt ??
      currentState.currentQuestionStartedAt ??
      null,
  };

  const nextHostId = patch.hostId ?? currentState.hostId ?? nextState.playerIds[0] ?? '';
  nextState.hostId = nextHostId;

  const currentResult = sanitizeGameResult(currentRow?.result);
  const nextResult = {
    ...currentResult,
    ...(patch.result && typeof patch.result === 'object' ? patch.result : {}),
    finalScores: patch.final_scores ?? patch.finalScores ?? currentResult.finalScores,
    categoriesUsed: patch.categories_used ?? patch.categoriesUsed ?? currentResult.categoriesUsed,
  };

  return {
    status: patch.status ?? currentRow.status,
    game_mode: patch.game_mode ?? patch.gameMode ?? currentRow.game_mode,
    winner_user_id: patch.winner_id ?? patch.winnerId ?? currentRow.winner_user_id,
    current_turn_user_id: patch.current_turn ?? patch.currentTurn ?? currentRow.current_turn_user_id,
    game_state: nextState,
    result: nextResult,
    updated_at: nowIsoString(),
  };
}

function logGamesUpdatePayload(triggeredBy: string, gameId: string, payload: Record<string, any>) {
  console.info('[Supabase] games update payload', {
    table: 'games',
    operation: 'update',
    triggeredBy,
    gameId,
    payload,
    payloadKeys: Object.keys(payload),
    hasLastUpdated: Object.prototype.hasOwnProperty.call(payload, 'last_updated'),
  });
}

export const subscribeToGame = (gameId: string, callback: (game: GameState) => void) => {
  const channel = supabase
    .channel(`game-${gameId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => {
        if (payload.new) {
          callback(mapPostgresGameToState(payload.new));
        }
      }
    )
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') {
        return;
      }

      fetchGameRow(gameId).then((row) => {
        if (row) {
          callback(mapPostgresGameToState(row));
        }
      }).catch((error) => {
        logSupabaseError('games', 'select', error, { gameId, purpose: 'subscribeToGame' });
      });
    });

  return () => void supabase.removeChannel(channel);
};

export async function createGame(
  hostId: string,
  displayName: string,
  avatarUrl?: string,
  isSolo = false
): Promise<GameState> {
  const now = nowIsoString();
  const initialPlayer: Player = {
    uid: hostId,
    name: displayName,
    score: 0,
    streak: 0,
    completedCategories: [],
    avatarUrl: avatarUrl || '',
    lastActive: Date.now(),
  };

  const gameId = createGameId();
  const initialState = buildInitialStoredGameState(hostId, initialPlayer);
  const insertPayload: {
    id: string;
    status?: string;
    game_mode?: string | null;
    winner_user_id?: string | null;
    current_turn_user_id?: string | null;
    game_state?: Record<string, unknown>;
    result?: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  } = {
    id: gameId,
    status: isSolo ? 'active' : 'waiting',
    game_mode: isSolo ? 'solo' : 'multiplayer',
    winner_user_id: null,
    current_turn_user_id: hostId,
    game_state: initialState as Record<string, unknown>,
    result: {},
    created_at: now,
    updated_at: now,
  };

  console.info('[Supabase] insert games payload', {
    table: 'games',
    operation: 'insert',
    payload: insertPayload,
  });

  const { data, error } = await supabase
    .from('games')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) {
    logSupabaseError('games', 'insert', error, { hostId, isSolo, payload: insertPayload });
    throw error;
  }

  return mapPostgresGameToState(data);
}

export async function joinGameById(gameId: string, userId: string, displayName: string, avatarUrl?: string) {
  const game = await fetchGameRow(gameId);
  if (!game) {
    return;
  }

  const state = normalizeStoredGameState(game.game_state);
  const existingPlayer = state.players.find((player) => player.uid === userId);
  const playerIds = Array.from(new Set([...state.playerIds, userId]));
  const players = existingPlayer
    ? state.players.map((player) =>
        player.uid === userId
          ? { ...player, name: displayName, avatarUrl: avatarUrl || player.avatarUrl || '', lastActive: Date.now() }
          : player
      )
    : [
        ...state.players,
        {
          uid: userId,
          name: displayName,
          score: 0,
          streak: 0,
          completedCategories: [],
          avatarUrl: avatarUrl || '',
          lastActive: Date.now(),
        } as Player,
      ];

  const { error } = await supabase
    .from('games')
    .update({
      status: playerIds.length >= 2 ? 'active' : game.status,
      current_turn_user_id: game.current_turn_user_id || state.hostId || userId,
      game_state: {
        ...state,
        hostId: state.hostId || playerIds[0] || userId,
        playerIds,
        players,
      },
      updated_at: nowIsoString(),
    })
    .eq('id', gameId);

  if (error) {
    logSupabaseError('games', 'update', error, { gameId, userId, purpose: 'joinGameById' });
    throw error;
  }
}

export async function updateGame(gameId: string, patch: Partial<any>) {
  const currentRow = await fetchGameRow(gameId);
  if (!currentRow) {
    return;
  }

  const normalizedPatch = normalizeGamePatch(currentRow, patch);
  logGamesUpdatePayload('updateGame', gameId, normalizedPatch);
  const { error } = await supabase.from('games').update(normalizedPatch).eq('id', gameId);

  if (error) {
    logSupabaseError('games', 'update', error, { gameId, patchKeys: Object.keys(patch) });
    throw error;
  }
}

export async function joinGame(gameId: string, userId: string) {
  const game = await fetchGameRow(gameId);
  if (!game) {
    return;
  }

  const state = normalizeStoredGameState(game.game_state);
  await joinGameById(gameId, userId, state.players.find((player) => player.uid === userId)?.name || 'Player');
}

export async function updatePlayerActivity(gameId: string, userId: string, isResume = false) {
  const game = await fetchGameRow(gameId);
  if (!game) {
    return;
  }

  const state = normalizeStoredGameState(game.game_state);
  const activity = Date.now();
  const players = state.players.map((player) =>
    player.uid === userId
      ? {
          ...player,
          lastActive: activity,
          lastResumedAt: isResume ? activity : player.lastResumedAt,
        }
      : player
  );

  const { error } = await supabase
    .from('games')
    .update({
      game_state: { ...state, players },
      updated_at: nowIsoString(),
    })
    .eq('id', gameId);

  if (error) {
    logSupabaseError('games', 'update', error, { gameId, userId, purpose: 'updatePlayerActivity' });
    throw error;
  }
}

export async function abandonGame(gameId: string) {
  const { error } = await supabase
    .from('games')
    .update({
      status: 'abandoned',
      updated_at: nowIsoString(),
    })
    .eq('id', gameId);

  if (error) {
    logSupabaseError('games', 'update', error, { gameId, purpose: 'abandonGame' });
    throw error;
  }
}

export async function persistQuestionsToGame(gameId: string, questionIds: string[]) {
  const game = await fetchGameRow(gameId);
  if (!game) {
    return;
  }

  const state = normalizeStoredGameState(game.game_state);
  const { error } = await supabase
    .from('games')
    .update({
      game_state: { ...state, questionIds },
      updated_at: nowIsoString(),
    })
    .eq('id', gameId);

  if (error) {
    logSupabaseError('games', 'update', error, { gameId, questionIdsCount: questionIds.length, purpose: 'persistQuestionsToGame' });
    throw error;
  }
}

export async function setActiveGameQuestion(
  gameId: string,
  category: string,
  questionId: string,
  questionIndex: number,
  startedAt: number
) {
  const game = await fetchGameRow(gameId);
  if (!game) {
    return;
  }

  const state = normalizeStoredGameState(game.game_state);
  const updatePayload = {
    game_state: {
      ...state,
      currentQuestionId: questionId,
      currentQuestionCategory: category,
      currentQuestionIndex: questionIndex,
      currentQuestionStartedAt: startedAt,
    },
    updated_at: nowIsoString(),
  };
  logGamesUpdatePayload('setActiveGameQuestion', gameId, updatePayload);
  const { error } = await supabase
    .from('games')
    .update(updatePayload)
    .eq('id', gameId);

  if (error) {
    logSupabaseError('games', 'update', error, { gameId, questionId, purpose: 'setActiveGameQuestion' });
    throw error;
  }
}

export async function clearActiveGameQuestion(gameId: string) {
  const game = await fetchGameRow(gameId);
  if (!game) {
    return;
  }

  const state = normalizeStoredGameState(game.game_state);
  const { error } = await supabase
    .from('games')
    .update({
      game_state: {
        ...state,
        currentQuestionId: null,
        currentQuestionCategory: null,
        currentQuestionStartedAt: null,
      },
      updated_at: nowIsoString(),
    })
    .eq('id', gameId);

  if (error) {
    logSupabaseError('games', 'update', error, { gameId, purpose: 'clearActiveGameQuestion' });
    throw error;
  }
}

export async function recordAnswer(gameId: string, questionId: string, userId: string, answer: GameAnswer) {
  const { error } = await supabase.rpc('record_game_answer', {
    p_game_id: gameId,
    p_question_id: questionId,
    p_user_id: userId,
    p_answer: answer,
  });

  if (error) {
    logSupabaseError('rpc:record_game_answer', 'rpc', error, { gameId, questionId, userId });
    throw error;
  }
}

export async function getGameById(gameId: string): Promise<GameState | null> {
  if (!isUuid(gameId)) {
    return null;
  }

  const row = await fetchGameRow(gameId);
  return row ? mapPostgresGameToState(row) : null;
}

export async function getGameByCode(code: string): Promise<GameState | null> {
  const normalizedId = code.trim().toLowerCase();
  if (!isUuid(normalizedId)) {
    return null;
  }

  return getGameById(normalizedId);
}

export const subscribeToMessages = (gameId: string, callback: (messages: any[]) => void) => {
  logGameMessagesQuery('subscribeToMessages', gameId, false);
  const channel = supabase
    .channel(`messages-${gameId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'game_messages', filter: `game_id=eq.${gameId}` },
      () => {
        loadMessages(gameId).then(callback).catch((error) => {
          logSupabaseError('game_messages', 'select', error, { gameId, purpose: 'subscribeToMessages' });
        });
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        loadMessages(gameId).then(callback).catch((error) => {
          logSupabaseError('game_messages', 'select', error, { gameId, purpose: 'subscribeToMessagesInit' });
        });
      }
    });

  return () => void supabase.removeChannel(channel);
};

export async function sendMessage(gameId: string, userId: string, content: string) {
  const { error } = await supabase
    .from('game_messages')
    .insert({
      game_id: gameId,
      user_id: userId,
      content,
      timestamp: nowIsoString(),
    });

  if (error) {
    logSupabaseError('game_messages', 'insert', error, { gameId, userId });
    throw error;
  }
}

function isGameMessagesMissingError(error: any) {
  return (
    isMissingTableError(error) ||
    error?.code === '42P01' ||
    error?.message?.includes('public.game_messages')
  );
}

function logGameMessagesQuery(functionName: string, gameId: string, required: boolean) {
  console.info('[Supabase] game_messages access', {
    table: 'game_messages',
    functionName,
    gameId,
    required,
    startupCanContinueWithoutTable: !required,
  });
}

async function loadMessages(gameId: string) {
  logGameMessagesQuery('loadMessages', gameId, false);
  const [{ data: messages, error: messagesError }, gameRow] = await Promise.all([
    supabase.from('game_messages').select('*').eq('game_id', gameId).order('timestamp', { ascending: true }).limit(50),
    fetchGameRow(gameId),
  ]);

  if (messagesError) {
    if (isGameMessagesMissingError(messagesError)) {
      console.warn('[Supabase] game_messages unavailable; skipping message history', {
        table: 'game_messages',
        functionName: 'loadMessages',
        gameId,
        required: false,
        startupCanContinueWithoutTable: true,
        code: messagesError?.code ?? null,
        message: messagesError?.message ?? String(messagesError),
      });
      return [];
    }

    logSupabaseError('game_messages', 'select', messagesError, { gameId });
    throw messagesError;
  }

  const state = normalizeStoredGameState(gameRow?.game_state);
  const playersById = new Map(state.players.map((player) => [player.uid, player]));

  return (messages || []).map((message) => {
    const player = playersById.get(message.user_id);
    return {
      id: message.id,
      uid: message.user_id,
      name: player?.name || 'Player',
      text: message.content,
      timestamp: new Date(message.timestamp).getTime(),
      avatarUrl: player?.avatarUrl || undefined,
    };
  });
}

export async function getGameQuestions(gameId: string): Promise<TriviaQuestion[]> {
  const game = await fetchGameRow(gameId);
  if (!game) {
    return [];
  }

  const questionIds = normalizeStoredGameState(game.game_state).questionIds;
  if (questionIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase.from('questions').select('*').in('id', questionIds);
  if (error) {
    logSupabaseError('questions', 'select', error, { gameId, questionIdsCount: questionIds.length });
    throw error;
  }

  return (data || []) as TriviaQuestion[];
}

export async function getPastGames(userId: string): Promise<GameState[]> {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('status', 'completed')
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) {
    logSupabaseError('games', 'select', error, { userId, purpose: 'getPastGames' });
    throw error;
  }

  return (data || [])
    .map(mapPostgresGameToState)
    .filter((game) => game.playerIds.includes(userId))
    .slice(0, 10);
}
