import { supabase } from '../lib/supabase';
import { ChatMessage, GameAnswer, GameState, PersistedGameState, Player, TriviaQuestion } from '../types';
import {
  getGameDisplayCode,
  isMissingFunctionError,
  isMissingTableError,
  isMissingRowError,
  isUuid,
  logSupabaseError,
  nowIsoString,
} from './supabaseUtils';
import { dedupeQuestionsByIdentity, mapQuestionRowToTriviaQuestion } from './questionRepository';

function createGameId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  throw new Error('crypto.randomUUID is not available in this environment.');
}

const GAME_MESSAGES_TIMESTAMP_COLUMN = 'created_at';
const GAME_MESSAGES_REQUIRED = false;
const GAME_MESSAGES_SELECT_COLUMNS =
  'id, game_id, user_id, message_type, content, created_at, avatar_url_snapshot';

type GameMessageRow = {
  id: string;
  game_id: string;
  user_id: string | null;
  message_type: string | null;
  content: string;
  created_at: string;
  avatar_url_snapshot: string | null;
};

type SendMessageInput = {
  gameId: string;
  userId: string;
  content: string;
  avatarUrlSnapshot?: string | null;
};

async function loadMessageProfiles(ids: Array<string | null | undefined>) {
  const uniqueIds = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (uniqueIds.length === 0) {
    return new Map<string, { nickname: string | null; avatar_url: string | null }>();
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, nickname, avatar_url')
    .in('id', uniqueIds);

  if (error) {
    logSupabaseError('profiles', 'select', error, { ids: uniqueIds, purpose: 'loadMessageProfiles' });
    throw error;
  }

  return new Map((data || []).map((row) => [row.id, row]));
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

type NormalizedGameSnapshot = {
  id: string | null;
  updatedAt: string | null;
  updatedAtMs: number | null;
  status: string | null;
  currentTurn: string | null;
  currentQuestionId: string | null;
  playerIds: string[];
  scores: Record<string, number>;
};

type FreshnessComparison =
  | {
      decision: 'accept';
      reason: 'no-current-snapshot' | 'incoming-newer-updated_at' | 'same-updated_at-different-authoritative-fields' | 'missing-updated_at-but-authoritative-fields-differ';
    }
  | {
      decision: 'ignore';
      reason: 'incoming-older-updated_at' | 'same-updated_at-equivalent-authoritative-fields' | 'missing-updated_at-equivalent-authoritative-fields';
    };

const FALLBACK_REFRESH_INTERVAL_MS = 3000;
const FALLBACK_REFRESH_MIN_GAP_MS = 15000;
const FALLBACK_REFRESH_IDLE_AFTER_ACCEPT_MS = 12000;

function hasOwn(object: unknown, key: string) {
  return !!object && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePlayerIdsForComparison(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))].sort();
}

function normalizeScoresForComparison(players: unknown): Record<string, number> {
  if (!Array.isArray(players)) {
    return {};
  }

  return players.reduce<Record<string, number>>((scores, player) => {
    if (!player || typeof player !== 'object' || typeof player.uid !== 'string') {
      return scores;
    }

    scores[player.uid] = typeof player.score === 'number' ? player.score : 0;
    return scores;
  }, {});
}

export function normalizeGameSnapshot(game: any): NormalizedGameSnapshot {
  const rawState = game?.game_state ?? game?.gameState;
  const state = normalizeStoredGameState(rawState);
  const updatedAtRaw = game?.updated_at ?? game?.updatedAt ?? null;
  const updatedAt = normalizeOptionalString(updatedAtRaw);
  const updatedAtMs = updatedAt ? new Date(updatedAt).getTime() : null;
  const playerIds = normalizePlayerIdsForComparison(game?.player_ids ?? game?.playerIds ?? state.playerIds);
  const currentQuestionId = normalizeOptionalString(
    game?.current_question_id ??
      game?.currentQuestionId ??
      state.currentQuestionId ??
      null
  );

  return {
    id: normalizeOptionalString(game?.id ?? null),
    updatedAt,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : null,
    status: normalizeOptionalString(game?.status ?? null),
    currentTurn: normalizeOptionalString(game?.current_turn_user_id ?? game?.currentTurn ?? null),
    currentQuestionId,
    playerIds,
    scores: normalizeScoresForComparison(state.players ?? game?.players),
  };
}

function areScoresEquivalent(left: Record<string, number>, right: Record<string, number>) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function areNormalizedSnapshotsEquivalent(left: NormalizedGameSnapshot, right: NormalizedGameSnapshot) {
  return (
    left.id === right.id &&
    left.status === right.status &&
    left.currentTurn === right.currentTurn &&
    left.currentQuestionId === right.currentQuestionId &&
    left.playerIds.length === right.playerIds.length &&
    left.playerIds.every((playerId, index) => playerId === right.playerIds[index]) &&
    areScoresEquivalent(left.scores, right.scores)
  );
}

export function compareGameFreshness(
  incoming: NormalizedGameSnapshot,
  current: NormalizedGameSnapshot | null
): FreshnessComparison {
  if (!current) {
    return {
      decision: 'accept',
      reason: 'no-current-snapshot',
    };
  }

  if (incoming.updatedAtMs !== null && current.updatedAtMs !== null) {
    if (incoming.updatedAtMs < current.updatedAtMs) {
      return {
        decision: 'ignore',
        reason: 'incoming-older-updated_at',
      };
    }

    if (incoming.updatedAtMs > current.updatedAtMs) {
      return {
        decision: 'accept',
        reason: 'incoming-newer-updated_at',
      };
    }

    return areNormalizedSnapshotsEquivalent(incoming, current)
      ? {
          decision: 'ignore',
          reason: 'same-updated_at-equivalent-authoritative-fields',
        }
      : {
          decision: 'accept',
          reason: 'same-updated_at-different-authoritative-fields',
        };
  }

  return areNormalizedSnapshotsEquivalent(incoming, current)
    ? {
        decision: 'ignore',
        reason: 'missing-updated_at-equivalent-authoritative-fields',
      }
    : {
        decision: 'accept',
        reason: 'missing-updated_at-but-authoritative-fields-differ',
      };
}

function mergeGameRowsPreservingCanonical(currentRow: any | null, incomingRow: any) {
  if (!currentRow) {
    return incomingRow;
  }

  const incomingState = incomingRow?.game_state;
  const currentState = currentRow?.game_state;
  const mergedState =
    incomingState === null
      ? null
      : incomingState && typeof incomingState === 'object'
      ? {
          ...(currentState && typeof currentState === 'object' ? currentState : {}),
          ...incomingState,
        }
      : hasOwn(incomingRow, 'game_state')
        ? incomingState
        : currentState;

  const incomingResult = incomingRow?.result;
  const currentResult = currentRow?.result;
  const mergedResult =
    incomingResult === null
      ? null
      : incomingResult && typeof incomingResult === 'object'
      ? {
          ...(currentResult && typeof currentResult === 'object' ? currentResult : {}),
          ...incomingResult,
        }
      : hasOwn(incomingRow, 'result')
        ? incomingResult
        : currentResult;

  return {
    ...currentRow,
    ...incomingRow,
    player_ids: hasOwn(incomingRow, 'player_ids') ? incomingRow?.player_ids : currentRow?.player_ids,
    game_state: mergedState,
    result: mergedResult,
    updated_at: hasOwn(incomingRow, 'updated_at') ? incomingRow?.updated_at : currentRow?.updated_at,
    created_at: hasOwn(incomingRow, 'created_at') ? incomingRow?.created_at : currentRow?.created_at,
  };
}

function isMissingAuthoritativeFields(row: any) {
  if (!row || typeof row !== 'object') {
    return true;
  }

  const snapshot = normalizeGameSnapshot(row);
  return !snapshot.id || !snapshot.status || !snapshot.updatedAt;
}

export function mapPostgresGameToState(row: any): GameState {
  const state = normalizeStoredGameState(row.game_state);
  const playerIds = Array.isArray(row.player_ids)
    ? row.player_ids.filter((entry: unknown): entry is string => typeof entry === 'string')
    : state.playerIds;
  const result = sanitizeGameResult(row.result);

  return {
    id: row.id,
    code: getGameDisplayCode(row.id),
    status: row.status,
    hostId: state.hostId,
    playerIds,
    players: state.players,
    currentTurn: row.current_turn_profile_id ?? row.current_turn_user_id ?? null,
    winnerId: row.winner_profile_id ?? row.winner_user_id ?? null,
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
    lastUpdated: new Date(row.last_updated_at || row.updated_at || row.last_updated).getTime(),
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
    playerIds:
      patch.player_ids ??
      patch.playerIds ??
      patch.players?.map((player: Player) => player.uid) ??
      currentState.playerIds,
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
    winner_profile_id: patch.winner_id ?? patch.winnerId ?? currentRow.winner_profile_id ?? currentRow.winner_user_id,
    current_turn_profile_id: patch.current_turn ?? patch.currentTurn ?? currentRow.current_turn_profile_id ?? currentRow.current_turn_user_id,
    player_ids: nextState.playerIds,
    game_state: nextState,
    result: nextResult,
    last_updated_at: nowIsoString(),
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
  let lastAcceptedSnapshot: NormalizedGameSnapshot | null = null;
  let lastAcceptedRow: any | null = null;
  let lastAcceptedAt = 0;
  let lastRealtimeEventAt = 0;
  let lastFallbackRefreshAt = 0;
  let fallbackRefreshInFlight = false;
  let isSubscribed = false;

  const runFallbackRefresh = (reason: string) => {
    if (fallbackRefreshInFlight) {
      console.info('[subscribeToGame] Fallback refresh skipped', {
        gameId,
        reason,
        decision: 'skip',
        skipReason: 'fallback-refresh-already-in-flight',
      });
      return;
    }

    const now = Date.now();
    if (lastFallbackRefreshAt > 0 && now - lastFallbackRefreshAt < FALLBACK_REFRESH_MIN_GAP_MS) {
      console.info('[subscribeToGame] Fallback refresh skipped', {
        gameId,
        reason,
        decision: 'skip',
        skipReason: 'fallback-refresh-rate-limited',
        lastFallbackRefreshAt,
        msSinceLastFallbackRefresh: now - lastFallbackRefreshAt,
      });
      return;
    }

    fallbackRefreshInFlight = true;
    lastFallbackRefreshAt = now;

    console.info('[subscribeToGame] Fallback refresh started', {
      gameId,
      reason,
      decision: 'refresh',
    });

    fetchGameRow(gameId)
      .then((row) => {
        emitGameRow(row, 'subscribe:fallbackRefresh');
      })
      .catch((error) => {
        logSupabaseError('games', 'select', error, { gameId, purpose: 'subscribeToGameFallbackRefresh', reason });
      })
      .finally(() => {
        fallbackRefreshInFlight = false;
      });
  };

  const emitGameRow = (row: any, source: string) => {
    if (!row) {
      console.warn('[subscribeToGame] No game row available', {
        gameId,
        source,
      });
      return;
    }

    if (source.startsWith('realtime:')) {
      lastRealtimeEventAt = Date.now();
    }

    if (isMissingAuthoritativeFields(row)) {
      console.warn('[subscribeToGame] Snapshot missing authoritative fields', {
        gameId,
        source,
        decision: 'fallback-refresh',
        missingAuthoritativeFields: true,
        incomingSnapshot: normalizeGameSnapshot(row),
      });
      runFallbackRefresh(`missing-authoritative-fields:${source}`);
      return;
    }

    const mergedRow = mergeGameRowsPreservingCanonical(lastAcceptedRow, row);
    const incomingSnapshot = normalizeGameSnapshot(mergedRow);
    const comparison = compareGameFreshness(incomingSnapshot, lastAcceptedSnapshot);

    console.info('[subscribeToGame] Snapshot decision', {
      gameId,
      source,
      decision: comparison.decision,
      reason: comparison.reason,
      incomingSnapshot,
      currentSnapshot: lastAcceptedSnapshot,
    });

    if (comparison.decision === 'ignore') {
      return;
    }

    const mappedGame = mapPostgresGameToState(mergedRow);
    lastAcceptedRow = mergedRow;
    lastAcceptedSnapshot = incomingSnapshot;
    lastAcceptedAt = Date.now();
    callback(mappedGame);
  };

  console.info('[subscribeToGame] Starting games subscription', {
    gameId,
    sourceOfTruthFields: ['id', 'updated_at', 'status', 'current_turn_user_id', 'game_state.currentQuestionId', 'player_ids', 'game_state.players[].score'],
  });

  const channel = supabase
    .channel(`game-${gameId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => {
        console.info('[subscribeToGame] Realtime event received', {
          gameId,
          eventType: payload.eventType,
          oldRecord: payload.old ?? null,
          newRecord: payload.new ?? null,
          hostReceivedRealtimeUpdate: true,
        });
        if (payload.new) {
          emitGameRow(payload.new, `realtime:${payload.eventType}`);
        }
      }
    )
    .subscribe((status) => {
      console.info('[subscribeToGame] Subscription status changed', {
        gameId,
        status,
      });

      if (status !== 'SUBSCRIBED') {
        isSubscribed = false;
        return;
      }

      isSubscribed = true;
      fetchGameRow(gameId).then((row) => {
        emitGameRow(row, 'subscribe:initFetch');
      }).catch((error) => {
        logSupabaseError('games', 'select', error, { gameId, purpose: 'subscribeToGame' });
      });
    });

  const fallbackRefreshInterval = window.setInterval(() => {
    const now = Date.now();
    const referenceTime = Math.max(lastAcceptedAt, lastRealtimeEventAt);

    if (!isSubscribed) {
      return;
    }

    if (referenceTime > 0 && now - referenceTime < FALLBACK_REFRESH_IDLE_AFTER_ACCEPT_MS) {
      return;
    }

    runFallbackRefresh('watchdog-idle');
  }, FALLBACK_REFRESH_INTERVAL_MS);

  return () => {
    window.clearInterval(fallbackRefreshInterval);
    return void supabase.removeChannel(channel);
  };
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
    winner_profile_id?: string | null;
    current_turn_profile_id?: string | null;
    player_ids?: string[];
    game_state?: Record<string, unknown>;
    result?: Record<string, unknown>;
    created_at: string;
    last_updated_at: string;
  } = {
    id: gameId,
    status: isSolo ? 'active' : 'waiting',
    game_mode: isSolo ? 'solo' : 'multiplayer',
    winner_profile_id: null,
    current_turn_profile_id: hostId,
    player_ids: initialState.playerIds,
    game_state: initialState as unknown as Record<string, unknown>,
    result: {},
    created_at: now,
    last_updated_at: now,
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
  console.info('[joinGameById] Looking up game', {
    submittedGameId: gameId,
    userId,
    displayName,
  });
  const game = await fetchGameRow(gameId);
  if (!game) {
    console.warn('[joinGameById] Early return: no game found', {
      submittedGameId: gameId,
      userId,
    });
    return;
  }

  console.info('[joinGameById] Game found', {
    submittedGameId: gameId,
    foundGameId: game.id,
    status: game.status,
    currentPlayerIds: normalizeStoredGameState(game.game_state).playerIds,
  });

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

  const { data, error } = await supabase
    .from('games')
    .update({
      status: playerIds.length >= 2 ? 'active' : game.status,
      current_turn_profile_id: game.current_turn_profile_id || game.current_turn_user_id || state.hostId || userId,
      player_ids: playerIds,
      game_state: {
        ...state,
        hostId: state.hostId || playerIds[0] || userId,
        playerIds,
        players,
      },
      last_updated_at: nowIsoString(),
    })
    .eq('id', gameId)
    .select('*')
    .single();

  if (error) {
    logSupabaseError('games', 'update', error, { gameId, userId, purpose: 'joinGameById' });
    throw error;
  }

  console.info('[joinGameById] Join update succeeded', {
    submittedGameId: gameId,
    foundGameId: data.id,
    updatedStatus: data.status,
    updatedPlayerIds: normalizeStoredGameState(data.game_state).playerIds,
    joiningPlayerAlreadyExisted: !!existingPlayer,
  });

  return mapPostgresGameToState(data);
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
      last_updated_at: nowIsoString(),
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
      last_updated_at: nowIsoString(),
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
  const nextQuestionIds = [...new Set([...(state.questionIds ?? []), ...questionIds])];
  const { error } = await supabase
    .from('games')
    .update({
      game_state: { ...state, questionIds: nextQuestionIds },
      last_updated_at: nowIsoString(),
    })
    .eq('id', gameId);

  if (error) {
    logSupabaseError('games', 'update', error, { gameId, questionIdsCount: nextQuestionIds.length, purpose: 'persistQuestionsToGame' });
    throw error;
  }
}

export async function replaceQuestionsInGame(gameId: string, questionIds: string[]) {
  const game = await fetchGameRow(gameId);
  if (!game) {
    return;
  }

  const state = normalizeStoredGameState(game.game_state);
  const nextQuestionIds = [...new Set(questionIds)];
  const { error } = await supabase
    .from('games')
    .update({
      game_state: { ...state, questionIds: nextQuestionIds },
      last_updated_at: nowIsoString(),
    })
    .eq('id', gameId);

  if (error) {
    logSupabaseError('games', 'update', error, { gameId, questionIdsCount: nextQuestionIds.length, purpose: 'replaceQuestionsInGame' });
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
    last_updated_at: nowIsoString(),
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

  const { error: incrementError } = await supabase.rpc('increment_question_used_count', {
    q_id: questionId,
  });

  if (incrementError) {
    if (isMissingFunctionError(incrementError)) {
      console.warn('[setActiveGameQuestion] increment_question_used_count RPC is missing from the current database schema.', {
        gameId,
        questionId,
      });
      return;
    }

    logSupabaseError('rpc:increment_question_used_count', 'rpc', incrementError, {
      gameId,
      questionId,
      purpose: 'setActiveGameQuestion',
    });
    throw incrementError;
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
      last_updated_at: nowIsoString(),
    })
    .eq('id', gameId);

  if (error) {
    logSupabaseError('games', 'update', error, { gameId, purpose: 'clearActiveGameQuestion' });
    throw error;
  }
}

export async function recordAnswer(gameId: string, questionId: string, userId: string, answer: GameAnswer) {
  const [{ data: authData }, gameRow] = await Promise.all([
    supabase.auth.getUser(),
    fetchGameRow(gameId),
  ]);
  if (!gameRow) {
    return null;
  }

  const authenticatedUserId = authData.user?.id ?? null;
  const effectiveUserId = authenticatedUserId || userId;
  const game = mapPostgresGameToState(gameRow);
  const resumedGameOwnershipMatchesCurrentSession = !!authenticatedUserId && game.playerIds.includes(authenticatedUserId);
  const userIsInPlayerIds = game.playerIds.includes(effectiveUserId);
  const userMatchesCurrentTurn = game.currentTurn === effectiveUserId;

  console.info('[record_game_answer] Preflight membership check', {
    gameId,
    questionId,
    authenticatedUserId,
    gamePlayerIds: game.playerIds,
    currentTurnUserId: game.currentTurn,
    userIdSentToRpc: effectiveUserId,
    resumedGameOwnershipMatchesCurrentSession,
    userIsInPlayerIds,
    userMatchesCurrentTurn,
    rpcUserMatchesAuthenticatedUser: authenticatedUserId === null ? 'unknown' : authenticatedUserId === userId,
  });

  if (!userIsInPlayerIds) {
    console.error('[record_game_answer] Refusing RPC call because authenticated user is not in games.player_ids', {
      gameId,
      questionId,
      authenticatedUserId,
      effectiveUserId,
      playerIds: game.playerIds,
    });
    throw new Error('Authenticated user is not part of this game.');
  }

  if (!userMatchesCurrentTurn) {
    console.error('[record_game_answer] Refusing RPC call because authenticated user does not match current_turn_user_id', {
      gameId,
      questionId,
      authenticatedUserId,
      effectiveUserId,
      currentTurnUserId: game.currentTurn,
    });
    throw new Error('Authenticated user is not the active turn owner.');
  }

  const livePayload = {
    p_game_id: gameId,
    p_question_id: questionId,
    p_user_id: effectiveUserId,
    p_is_correct: answer.isCorrect,
  };
  console.info('[record_game_answer] Submitting RPC payload', {
    gameId,
    questionId,
    userId: effectiveUserId,
    livePayload,
    rpcCallCount: 1,
  });

  const { error } = await supabase.rpc('record_game_answer', livePayload);

  if (error) {
    console.error('[record_game_answer] RPC failed', {
      gameId,
      questionId,
      userId: effectiveUserId,
      livePayload,
      code: error.code,
      message: error.message,
    });
    logSupabaseError('rpc:record_game_answer', 'rpc', error, { gameId, questionId, userId: effectiveUserId });
    throw error;
  }

  console.info('[record_game_answer] RPC succeeded', {
    gameId,
    questionId,
    userId: effectiveUserId,
    realtimeSubscriptionWillRefreshGameState: true,
  });
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

export function mapGameMessageRow(
  row: GameMessageRow,
  profileMap: Map<string, { nickname: string | null; avatar_url: string | null }> = new Map()
): ChatMessage {
  const messageTimestamp = row[GAME_MESSAGES_TIMESTAMP_COLUMN] ?? row.created_at ?? nowIsoString();
  const profile = row.user_id ? profileMap.get(row.user_id) : undefined;

  return {
    id: row.id,
    uid: row.user_id ?? null,
    name: profile?.nickname || 'Player',
    text: row.content,
    timestamp: new Date(messageTimestamp).getTime(),
    avatarUrl: row.avatar_url_snapshot || profile?.avatar_url || undefined,
    messageType: row.message_type || 'player',
  };
}

export async function fetchMessages(gameId: string): Promise<ChatMessage[]> {
  logGameMessagesQuery('fetchMessages', gameId, GAME_MESSAGES_REQUIRED, false);
  console.info('[Supabase] game_messages select config', {
    table: 'game_messages',
    functionName: 'fetchMessages',
    gameId,
    selectColumns: GAME_MESSAGES_SELECT_COLUMNS,
  });

  try {
    const { data: messages, error } = await supabase
      .from('game_messages')
      .select(GAME_MESSAGES_SELECT_COLUMNS)
      .eq('game_id', gameId)
      .order(GAME_MESSAGES_TIMESTAMP_COLUMN, { ascending: true })
      .limit(50);

    if (error) {
      logSupabaseError('game_messages', 'select', error, {
        functionName: 'fetchMessages',
        gameId,
        purpose: isGameMessagesMissingError(error) ? 'missingTableOrColumn' : 'selectFailed',
      });
      throw error;
    }

    const profileMap = await loadMessageProfiles((messages || []).map((message) => (message as GameMessageRow).user_id));
    return (messages || []).map((message) => mapGameMessageRow(message as GameMessageRow, profileMap));
  } catch (error) {
    logSupabaseError('game_messages', 'select', error, {
      functionName: 'fetchMessages',
      gameId,
      purpose: 'unexpectedFailure',
    });
    throw error;
  }
}

export const subscribeToMessages = (
  gameId: string,
  callback: (message: ChatMessage) => void,
  onError?: (error: unknown) => void
) => {
  logGameMessagesQuery('subscribeToMessages', gameId, GAME_MESSAGES_REQUIRED, false);

  const channel = supabase
    .channel(`messages-${gameId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'game_messages', filter: `game_id=eq.${gameId}` },
      (payload) => {
        void (async () => {
          try {
          if (!payload.new) {
            console.warn('[Supabase] game_messages insert payload missing row data', {
              table: 'game_messages',
              functionName: 'subscribeToMessages',
              gameId,
              payload,
            });
            return;
          }

            const row = payload.new as GameMessageRow;
            const profileMap = await loadMessageProfiles([row.user_id]);
            callback(mapGameMessageRow(row, profileMap));
        } catch (error) {
          logSupabaseError('game_messages', 'realtime-insert-map', error, {
            functionName: 'subscribeToMessages',
            gameId,
            payload,
          });
          onError?.(error);
        }
        })();
      }
    )
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        logSupabaseError('game_messages', 'subscribe', error ?? new Error(`Realtime status: ${status}`), {
          functionName: 'subscribeToMessages',
          gameId,
          status,
        });
        onError?.(error ?? new Error(`Realtime status: ${status}`));
      }
    });

  return () => void supabase.removeChannel(channel);
};

export async function sendMessage(input: SendMessageInput) {
  const trimmedContent = input.content.trim();
  logGameMessagesQuery('sendMessage', input.gameId, GAME_MESSAGES_REQUIRED, false);

  const payload = {
    game_id: input.gameId,
    user_id: input.userId,
    message_type: 'player',
    content: trimmedContent,
    avatar_url_snapshot: input.avatarUrlSnapshot ?? null,
  };
  console.info('[Supabase] game_messages insert payload', {
    table: 'game_messages',
    functionName: 'sendMessage',
    payload,
    selectColumns: GAME_MESSAGES_SELECT_COLUMNS,
  });

  const { data, error } = await supabase
    .from('game_messages')
    .insert(payload)
    .select(GAME_MESSAGES_SELECT_COLUMNS)
    .single();

  if (error) {
    logSupabaseError('game_messages', 'insert', error, {
      functionName: 'sendMessage',
      payload,
    });
    throw error;
  }

  console.info('[Supabase] game_messages insert succeeded', {
    table: 'game_messages',
    functionName: 'sendMessage',
    returnedRow: data,
  });

  const profileMap = await loadMessageProfiles([(data as GameMessageRow).user_id]);
  return mapGameMessageRow(data as GameMessageRow, profileMap);
}

function isGameMessagesMissingError(error: any) {
  return (
    isMissingTableError(error) ||
    error?.code === '42P01' ||
    error?.message?.includes('public.game_messages')
  );
}

function logGameMessagesQuery(functionName: string, gameId: string, required: boolean, errorsSwallowedGracefully: boolean) {
  console.info('[Supabase] game_messages access', {
    table: 'game_messages',
    functionName,
    gameId,
    timestampColumn: GAME_MESSAGES_TIMESTAMP_COLUMN,
    required,
    startupCanContinueWithoutTable: !required,
    errorsSwallowedGracefully,
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

  const questionById = new Map((data || []).map((row) => [row.id, mapQuestionRowToTriviaQuestion(row)]));
  return dedupeQuestionsByIdentity(questionIds
    .map((questionId) => questionById.get(questionId))
    .filter((question): question is TriviaQuestion => Boolean(question)));
}

export async function getPastGames(userId: string): Promise<GameState[]> {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('status', 'completed')
    .order('last_updated_at', { ascending: false })
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
