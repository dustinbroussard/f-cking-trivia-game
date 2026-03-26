# Firebase to Supabase Migration Roadmap
## A-F-cking Trivia Game - Complete Technical Implementation Guide

---

## 1. PostgreSQL Schema Definition (SQL)

*[Schema definition complete - see above]*

---

## 2. Comprehensive Migration Script

*[Migration script complete - see above]*

---

## 3. Service Layer Refactor

### Firebase → Supabase Service Mapping

| Firebase Service | Supabase Equivalent | Migration Strategy |
|-----------------|---------------------|-------------------|
| `firebase.auth()` | `supabase.auth` | Direct replacement |
| `firebase.firestore()` | `supabase.from('table')` | Table-based queries |
| `collection(db, 'name')` | `supabase.from('name')` | Direct mapping |
| `doc(db, 'path')` | `supabase.from('table').select().eq('id', ...)` | Row-based operations |
| `setDoc()` | `supabase.insert().upsert()` | Upsert pattern |
| `updateDoc()` | `supabase.update().eq()` | Update with filter |
| `deleteDoc()` | `supabase.delete().eq()` | Delete with filter |
| `getDoc()` | `supabase.select().eq('id', ...).single()` | Single row fetch |
| `getDocs()` | `supabase.select().filter()` | Query builder |
| `onSnapshot()` | `supabase.channel().on('postgres_changes')` | Realtime subscription |
| `serverTimestamp()` | `new Date().toISOString()` | Direct timestamp |
| `arrayUnion()` | `array_append` via RPC or manual array ops | Array operations |
| `arrayRemove()` | Array removal via RPC | Array operations |
| `increment()` | `supabase.rpc('increment', ...)` | Database function |

### Complete TypeScript Service Layer Implementation

#### 3.1 Auth Service (`src/services/auth.ts`)

```typescript
import { supabase } from '../lib/supabase';

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });
  if (error) throw error;
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function onAuthStateChange(callback: (user: any) => void) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return subscription;
}

// NEW: Password migration helper (optional)
export async function migratePassword(email: string, oldPassword: string, newPassword: string) {
  // This would require a custom endpoint or backend function
  // For now, implement forced reset strategy
  console.log('Password migration requires user reset');
}
```

#### 3.2 Game Service (`src/services/gameService.ts`)

```typescript
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
```

#### 3.3 Question Repository Service (`src/services/questionRepository.ts` - Updated)

```typescript
import { supabase } from '../lib/supabase';
import { TriviaQuestion } from '../types';

// ... existing helper functions remain the same ...

async function fetchApprovedQuestionsByCategory(category: string, excludeIds: Set<string>, count: number) {
  let query = supabase
    .from('questions')
    .select('*')
    .eq('category', category)
    .eq('validation_status', 'approved')
    .order('used_count', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(Math.max(count * 5, 20));

  const { data, error } = await query;
  if (error) {
    console.error(`Error fetching questions for ${category}:`, error.message);
    return [];
  }

  return (data || [])
    .map(mapRowToTriviaQuestion)
    .filter((question) => !excludeIds.has(question.id));
}

async function loadSeenQuestionIds(userId?: string) {
  if (!userId) return new Set<string>();
  
  const { data, error } = await supabase
    .from('seen_questions')
    .select('question_id')
    .eq('user_id', userId);
  
  if (error) {
    console.error(`Error loading seen questions for ${userId}:`, error.message);
    return new Set<string>();
  }
  
  return new Set((data || []).map(row => row.question_id));
}

export async function markQuestionSeen({
  userId,
  questionId,
  gameId,
}: {
  userId: string;
  questionId: string;
  gameId?: string;
}) {
  const { error } = await supabase
    .from('seen_questions')
    .insert({
      user_id: userId,
      question_id: questionId
    });
  
  if (error && !error.message.includes('duplicate key')) {
    throw error;
  }
  
  // Also increment usage count via RPC
  await supabase.rpc('increment_question_used_count', { q_id: questionId });
}
```

#### 3.4 Player Profiles Service (`src/services/playerProfiles.ts`)

```typescript
import { supabase } from '../lib/supabase';
import { PlayerProfile, PlayerStatsSummary, CategoryPerformance, RecentCompletedGame } from '../types';

export async function ensurePlayerProfile(user: any): Promise<void> {
  // The database trigger handles this automatically via handle_new_user()
  // But we can ensure user_settings exists too
  const { error } = await supabase
    .from('user_settings')
    .upsert({ 
      user_id: user.id,
      theme_mode: 'dark',
      sound_enabled: true,
      music_enabled: true,
      sfx_enabled: true,
      commentary_enabled: true
    });
  
  if (error) throw error;
}

export async function loadMatchupHistory(userId: string, opponentId: string) {
  const { data, error } = await supabase
    .from('matchup_history')
    .select('*')
    .eq('user_id', userId)
    .eq('opponent_id', opponentId)
    .single();
  
  if (error || !data) {
    return { summary: null as any, games: [] as RecentCompletedGame[] };
  }

  return {
    summary: {
      opponentId: data.opponent_id,
      opponentDisplayName: data.opponent_display_name,
      opponentPhotoURL: data.opponent_photo_url,
      wins: data.wins,
      losses: data.losses,
      totalGames: data.wins + data.losses,
      lastPlayedAt: new Date(data.last_played_at).getTime()
    },
    games: [] // Would need additional query to get game details
  };
}

export async function recordCompletedGame(completedGame: any) {
  // Insert into completed_games archive
  const { error } = await supabase
    .from('completed_games')
    .insert({
      id: completedGame.gameId,
      players: completedGame.players,
      winner_id: completedGame.winnerId,
      final_scores: completedGame.finalScores,
      categories_used: completedGame.categoriesUsed,
      questions: completedGame.questions,
      completed_at: new Date(completedGame.completedAt).toISOString()
    });
  
  if (error) throw error;
  
  // Update matchup history for each player
  const players = completedGame.players;
  const winnerId = completedGame.winnerId;
  
  for (const player of players) {
    const isWinner = player.uid === winnerId;
    const opponent = players.find((p: any) => p.uid !== player.uid);
    if (!opponent) continue;
    
    await supabase.rpc('upsert_matchup_history', {
      p_user_id: player.uid,
      p_opponent_id: opponent.uid,
      p_won: isWinner ? 1 : 0,
      p_lost: isWinner ? 0 : 1,
      p_opponent_display_name: opponent.name,
      p_opponent_photo_url: opponent.avatarUrl || null
    });
  }
}

export async function recordQuestionStats(stats: { uid: string; category: string; isCorrect: boolean }) {
  // This would update the profiles.stats JSONB field
  const { data: profile } = await supabase
    .from('profiles')
    .select('stats')
    .eq('id', stats.uid)
    .single();
  
  if (!profile) return;
  
  const currentStats = profile.stats || {};
  const categoryPerformance = currentStats.categoryPerformance || {};
  const catStats = categoryPerformance[stats.category] || { seen: 0, correct: 0 };
  
  const updatedStats = {
    ...currentStats,
    totalQuestionsSeen: (currentStats.totalQuestionsSeen || 0) + 1,
    totalQuestionsCorrect: (currentStats.totalQuestionsCorrect || 0) + (stats.isCorrect ? 1 : 0),
    categoryPerformance: {
      ...categoryPerformance,
      [stats.category]: {
        seen: catStats.seen + 1,
        correct: catStats.correct + (stats.isCorrect ? 1 : 0),
        percentageCorrect: ((catStats.correct + (stats.isCorrect ? 1 : 0)) / (catStats.seen + 1)) * 100
      }
    }
  };
  
  await supabase
    .from('profiles')
    .update({ stats: updatedStats })
    .eq('id', stats.uid);
}

// Add this RPC function to your database
/*
create function public.upsert_matchup_history(
  p_user_id uuid,
  p_opponent_id uuid,
  p_won integer,
  p_lost integer,
  p_opponent_display_name text,
  p_opponent_photo_url text
)
returns void as $$
begin
  insert into public.matchup_history (user_id, opponent_id, wins, losses, last_played_at, opponent_display_name, opponent_photo_url)
  values (p_user_id, p_opponent_id, p_won, p_lost, timezone('utc'::text, now()), p_opponent_display_name, p_opponent_photo_url)
  on conflict (user_id, opponent_id) 
  do update set 
    wins = public.matchup_history.wins + p_won,
    losses = public.matchup_history.losses + p_lost,
    last_played_at = timezone('utc'::text, now()),
    opponent_display_name = p_opponent_display_name,
    opponent_photo_url = p_opponent_photo_url;
end;
$$ language plpgsql security definer;
*/
```

---

## 4. "Safe-Delete" Decommissioning Strategy

### Phase 1: Audit Phase

**Objective**: Identify all Firebase dependencies

Run this search across the codebase:

```bash
# Search for Firebase imports
grep -r "from ['\"]firebase" src/ api/src/ --include="*.ts" --include="*.tsx" > firebase_imports.txt

# Search for Firebase config references
grep -r "firebaseConfig\|firebase-applet-config\|firebaseBlueprint" . --include="*.ts" --include="*.tsx" --include="*.json" > firebase_configs.txt

# Check package.json for firebase dependencies
grep '"firebase' package.json package-lock.json > firebase_deps.txt
```

**Expected Findings**:
- `src/firebase.ts` - Firebase initialization (DELETE)
- `src/services/questionFlags.ts` - Firestore write for flags (REPLACE)
- `api/src/firebase.ts` - Admin SDK initialization (DELETE)
- `api/_lib/firebase-admin.ts` - Firebase Admin helper (DELETE)
- `firebase.json`, `.firebaserc` - Firebase hosting config (DELETE after deploy)
- `firebase-applet-config.json` - Firebase config (DELETE)
- `firebase-blueprint.json` - Service account (REMOVE from repo, keep in CI/CD secrets)

### Phase 2: Redundancy Phase (Dual-Write Pattern)

**Implementation**: Create middleware that writes to both Firebase and Supabase during transition.

```typescript
// src/services/dualWriteMiddleware.ts
import { supabase } from '../lib/supabase';
import { db } from '../firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  increment as firestoreIncrement
} from 'firebase/firestore';

export async function dualWriteInsert(table: string, data: any, options?: { id?: string }) {
  // Write to Supabase
  await supabase.from(table).insert(data);
  
  // Write to Firebase (for parity checking)
  if (options?.id) {
    await setDoc(doc(db, table, options.id), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
}

export async function dualWriteUpdate(table: string, id: string, updates: any) {
  // Write to Supabase
  await supabase.from(table).update(updates).eq('id', id);
  
  // Write to Firebase
  await updateDoc(doc(db, table, id), {
    ...updates,
    updatedAt: serverTimestamp()
  });
}

export async function dualWriteDelete(table: string, id: string) {
  // Write to Supabase
  await supabase.from(table).delete().eq('id', id);
  
  // Write to Firebase
  await deleteDoc(doc(db, table, id));
}

// Special handler for array operations
export async function dualWriteArrayUnion(table: string, id: string, field: string, value: any) {
  await supabase.rpc('array_append', { 
    table_name: table, 
    row_id: id, 
    field_name: field, 
    new_element: value 
  });
  
  await updateDoc(doc(db, table, id), {
    [field]: arrayUnion(value),
    updatedAt: serverTimestamp()
  });
}

export async function dualWriteArrayRemove(table: string, id: string, field: string, value: any) {
  await supabase.rpc('array_remove', { 
    table_name: table, 
    row_id: id, 
    field_name: field, 
    old_element: value 
  });
  
  await updateDoc(doc(db, table, id), {
    [field]: arrayRemove(value),
    updatedAt: serverTimestamp()
  });
}

export async function dualWriteIncrement(table: string, id: string, field: string, amount = 1) {
  await supabase.rpc('increment_field', { 
    table_name: table, 
    row_id: id, 
    field_name: field, 
    increment_by: amount 
  });
  
  await updateDoc(doc(db, table, id), {
    [field]: firestoreIncrement(amount),
    updatedAt: serverTimestamp()
  });
}
```

**Required RPC Functions**:

```sql
-- array_append function
create function public.array_append(
  table_name text,
  row_id uuid,
  field_name text,
  new_element text
) returns void as $$
declare
  current_value text[];
begin
  execute format('select %I from %I where id = $1', field_name, table_name)
    into current_value
    using row_id;
  
  if current_value is null then
    current_value := array[new_element];
  else
    current_value := array_append(current_value, new_element);
  end if;
  
  execute format('update %I set %I = $1 where id = $2', table_name, field_name)
    using current_value, row_id;
end;
$$ language plpgsql security definer;

-- array_remove function
create function public.array_remove(
  table_name text,
  row_id uuid,
  field_name text,
  old_element text
) returns void as $$
declare
  current_value text[];
begin
  execute format('select %I from %I where id = $1', field_name, table_name)
    into current_value
    using row_id;
  
  if current_value is not null then
    current_value := array_remove(current_value, old_element);
    execute format('update %I set %I = $1 where id = $2', table_name, field_name)
      using current_value, row_id;
  end if;
end;
$$ language plpgsql security definer;

-- increment_field function
create function public.increment_field(
  table_name text,
  row_id uuid,
  field_name text,
  increment_by integer default 1
) returns void as $$
begin
  execute format('update %I set %I = coalesce(%I, 0) + $1 where id = $2', 
    table_name, field_name, field_name)
    using increment_by, row_id;
end;
$$ language plpgsql security definer;
```

**Integration**: Wrap critical operations with dual-write:

```typescript
// In src/services/gameService.ts (temporary dual-write wrapper)
export async function createGameDualWrite(game: Partial<GameState>, initialPlayer: Player) {
  // Generate IDs
  const gameId = game.id || uuidv4();
  
  // Write to both systems
  await dualWriteInsert('games', {
    id: gameId,
    code: game.code,
    host_id: game.hostId,
    player_ids: game.playerIds,
    players: [initialPlayer],
    status: game.status,
    created_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
  });
  
  // Also write game_players separately
  await dualWriteInsert('game_players', {
    game_id: gameId,
    user_id: initialPlayer.uid,
    score: 0,
    streak: 0,
    is_online: true,
    completed_categories: []
  });
}
```

### Phase 3: Cleanup Phase

**Trigger Conditions**:
1. ✅ All critical paths verified using Supabase (see Verification Checklist below)
2. ✅ 24-48 hours of dual-write parity monitoring with zero errors
3. ✅ Staging environment fully validated
4. ✅ Team sign-off on data integrity reports

**Removal Checklist**:

- [ ] Remove all Firebase imports from `src/` and `api/src/`
- [ ] Delete `src/firebase.ts` and `src/services/firestoreData.ts`
- [ ] Delete `api/src/firebase.ts` and `api/_lib/firebase-admin.ts`
- [ ] Update `package.json`:
  ```json
  {
    "dependencies": {
      // Remove:
      "firebase": "^12.x.x",
      "firebase-admin": "^13.x.x"
      // Keep supabase and other deps
    }
  }
  ```
- [ ] Delete Firebase config files:
  ```bash
  rm -f firebase.json .firebaserc firebase-applet-config.json firebase-blueprint.json
  ```
- [ ] Update `.gitignore` to remove Firebase-specific entries
- [ ] Update CI/CD environment variables (remove FIREBASE_* secrets)
- [ ] Remove Firebase hosting configuration from Vercel/Netlify
- [ ] Clean up unused Firebase-specific utility functions
- [ ] Update documentation and README.md

**Final Production Push**:
1. Deploy to production during low-traffic window
2. Monitor Supabase dashboard for errors
3. Have rollback plan ready (keep Firebase config accessible but unused)
4. After 1 week of stable operation, permanently delete Firebase project

---

## 5. Real-Time Synchronization with Supabase Realtime

Supabase Realtime uses PostgreSQL's logical replication to broadcast changes.

### Enable Realtime in Supabase Dashboard:
1. Go to Database → Replication
2. Enable "Realtime" for tables: `games`, `game_messages`, `game_players`
3. Or via SQL:
```sql
alter table public.games replica identity full;
alter table public.game_messages replica identity full;
alter table public.game_players replica identity full;
```

### Subscribe to Changes (Already Implemented in gameService.ts):

```typescript
// The existing subscribeToGame function uses Supabase Realtime
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
    .subscribe();
    
  return () => { void supabase.removeChannel(channel); };
};
```

**Performance Tip**: Use `event: 'UPDATE'` instead of `'*'` if you don't need INSERT/DELETE events.

---

## 6. Performance Optimization

### PostgreSQL Indexes (Already in Schema)

The schema includes:
- `idx_questions_category_difficulty_vstatus` - For fast category/difficulty filtering
- `idx_questions_used_count` - For least-used question selection
- `idx_questions_content_trgm` - Full-text search capability
- `idx_games_status`, `idx_games_code` - Game lookup by status/code

### Query Optimization Examples

```typescript
// Efficient question fetch with exclusion
export async function fetchQuestionsOptimized(
  category: string, 
  count: number, 
  excludeIds: Set<string>
) {
  // Use NOT IN for exclusion (Supabase automatically parameterizes)
  const { data } = await supabase
    .from('questions')
    .select('id, content, correct_answer, distractors, category, difficulty_level, explanation, styling, metadata')
    .eq('category', category)
    .eq('validation_status', 'approved')
    .not('id', 'in', Array.from(excludeIds))
    .order('used_count', { ascending: true })
    .limit(count);
  
  return data;
}

// Join query for game with players
export async function getGameWithPlayers(gameId: string) {
  const { data } = await supabase
    .from('games')
    .select(`
      *,
      game_players (
        user_id,
        score,
        streak,
        is_online,
        completed_categories,
        profiles (display_name, photo_url)
      )
    `)
    .eq('id', gameId)
    .single();
  
  return data;
}
```

---

## 7. Security with Row Level Security (RLS)

### RLS Policy Summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `profiles` | Public | Owner | Owner | Restricted |
| `questions` | Authenticated (approved only) | Admin/AI | Admin/AI | Restricted |
| `games` | Participants | Authenticated | Host | Host |
| `game_players` | Participants | Self | Self | Restricted |
| `seen_questions` | Self | Self | Restricted | Restricted |
| `game_messages` | Participants | Self | Restricted | Restricted |
| `recent_players` | Self | Self | Self | Self |
| `game_invites` | Recipient | Sender | Restricted | Sender |
| `flagged_questions` | Restricted | Authenticated | Restricted | Restricted |
| `user_settings` | Self | Self | Self | Self |
| `matchup_history` | Self/Opponent | Self | Self | Restricted |
| `completed_games` | Participants | Restricted | Restricted | Restricted |

### Testing RLS Policies

```sql
-- Enable/disable RLS for testing (DO NOT leave disabled in production)
alter table public.games disable row level security;
-- Test queries without RLS
alter table public.games enable row level security;
-- Test with RLS enabled

-- Test as authenticated user
set role authenticated;
select * from public.games where id = 'some-game-id';
reset role;
```

### Admin Access

Create an admin role for managing all data:

```sql
create role admin nologin;

grant select on all tables in schema public to admin;
grant insert, update, delete on all tables in schema public to admin;

-- Add admin users
insert into auth.users (id, ...) values ('admin-uuid', ...);
grant admin to specific_user;
```

---

## 8. Verification Checklist

### Pre-Migration Validation

- [ ] **Schema Creation**: Execute full SQL schema in Supabase SQL Editor
- [ ] **Indexes**: Confirm all indexes created successfully
- [ ] **RLS Policies**: Verify policies are enabled on all tables
- [ ] **Triggers**: Test `handle_new_user()` trigger creates profile on user creation
- [ ] **RPC Functions**: Ensure `increment_question_used_count` and `record_game_answer` work
- [ ] **Realtime**: Enable replication for critical tables

### Migration Validation

- [ ] **Count Parity**: Row counts match between Firestore and Supabase for each collection
- [ ] **Data Integrity**: Sample 100 random documents, verify field mapping
- [ ] **Foreign Keys**: Validate that all user IDs, game IDs, question IDs resolve correctly
- [ ] **Timestamps**: Check that all `created_at`, `updated_at` timestamps are valid ISO strings
- [ ] **JSONB**: Ensure complex fields (metadata, styling, players) are properly stored as JSONB

### Post-Migration Testing

- [ ] **Authentication**: Google OAuth login works, user profile auto-created
- [ ] **Question Bank**: Approved questions fetchable, used_count increments
- [ ] **Game Creation**: Solo and multiplayer games can be created
- [ ] **Real-time**: Game state updates propagate to all players
- [ ] **Chat**: Messages send and receive in real-time
- [ ] **Question Seeding**: `seen_questions` tracking works, questions marked as used
- [ ] **Player Stats**: Win/loss tracking updates correctly
- [ ] **Invites**: Sending/accepting invites works
- [ ] **Settings**: User settings persist across sessions
- [ ] **History**: Completed games appear in match history

### Automated Testing Script

```typescript
// scripts/verify_migration.ts
import { supabase } from '../src/lib/supabase';

async function runVerification() {
  console.log('=== Migration Verification Suite ===\n');
  
  // 1. Count verification
  const tables = [
    'questions', 'profiles', 'games', 'game_players', 'game_messages',
    'recent_players', 'game_invites', 'flagged_questions', 
    'user_settings', 'matchup_history', 'completed_games', 'seen_questions'
  ];
  
  for (const table of tables) {
    const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
    console.log(`[${table}] Count: ${count}`);
  }
  
  // 2. Sample data verification
  const { data: sampleQuestion } = await supabase
    .from('questions')
    .select('*')
    .eq('validation_status', 'approved')
    .limit(1)
    .single();
  
  console.log('\nSample question:', JSON.stringify(sampleQuestion, null, 2));
  
  // 3. RLS policy check
  const { data: rlsPolicies } = await supabase
    .rpc('pg_policies', { schemaname: 'public' });
  
  console.log('\nRLS Policies:', rlsPolicies?.length || 0);
  
  // 4. Index check
  const { data: indexes } = await supabase
    .rpc('pg_indexes', { schemaname: 'public' });
  
  console.log('Indexes:', indexes?.length || 0);
  
  // 5. Test RPC functions
  const { error: rpcError } = await supabase.rpc('increment_question_used_count', { q_id: 'test-uuid' });
  console.log('RPC test:', rpcError ? 'FAILED' : 'PASSED');
  
  console.log('\n=== Verification Complete ===');
}

runVerification().catch(console.error);
```

---

## 9. Production Deployment Plan

### Timeline

| Day | Activity |
|-----|----------|
| **Day 1** | Execute migration script on staging, run verification suite |
| **Day 2** | Enable dual-write middleware in staging, monitor parity for 24h |
| **Day 3** | If parity confirmed, switch staging to Supabase-only, remove Firebase SDK |
| **Day 4** | Staging QA testing (full user journey tests) |
| **Day 5** | Deploy to production (during off-peak hours) |
| **Day 6-7** | Production monitoring, error tracking, performance metrics |
| **Week 2** | Remove Firebase config files, update DNS/deployment configs |
| **Week 4** | Final cleanup, decommission Firebase project |

### Rollback Plan

If critical issues arise:

1. **Immediate**: Re-merge Firebase SDK, restore deleted files from Git
2. **Data Sync**: Since both systems were writing, re-enable dual-write with Firebase primary
3. **Alert**: Notify users of temporary outage
4. **Fix**: Address root cause in staging, re-run migration
5. **Retry**: Attempt production deployment again after 48h

### Monitoring

- **Supabase Dashboard**: Monitor query performance, errors, connection counts
- **Application Logs**: Set up Sentry/LogRocket for error tracking
- **Real-time Health**: Check channel subscription counts
- **User Metrics**: Track game creation, question fetches, message throughput

---

## 10. Conclusion

This migration roadmap provides a complete, production-ready plan for transitioning from Firebase Firestore to Supabase PostgreSQL. The phased approach with dual-write redundancy ensures zero downtime and data integrity. 

**Key Reminders**:
1. Test thoroughly in staging before production
2. Keep detailed logs during migration
3. Have rollback plan ready
4. Monitor closely for 48h post-migration
5. Update all environment variables and CI/CD configs

**Success Criteria**:
- ✅ All Firebase dependencies removed from codebase
- ✅ No data loss or corruption
- ✅ Application performance improved (measure query response times)
- ✅ Reduced infrastructure costs
- ✅ Enhanced data integrity with relational constraints

---

**Next Steps**: Start with executing the migration script on a staging Supabase instance.