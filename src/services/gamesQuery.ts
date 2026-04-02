const GAME_ROW_SELECT_COLUMN_LIST = [
  'id',
  'player_ids',
  'status',
  'game_mode',
  'winner_profile_id',
  'current_turn_profile_id',
  'game_state',
  'result',
  'completed_at',
  'created_at',
  'last_updated_at',
];

// Shared projections do not flow cleanly through Supabase's select-string parser.
export const GAMES_SELECT_COLUMNS: any = GAME_ROW_SELECT_COLUMN_LIST.join(', ');
export const GAMES_WINNER_COLUMN = 'winner_profile_id';
export const GAME_SNAPSHOT_SOURCE_OF_TRUTH_FIELDS = [
  'id',
  'last_updated_at',
  'status',
  'current_turn_profile_id',
  'game_state.currentQuestionId',
  'player_ids',
  'game_state.players[].score',
];
export const GAME_REQUIRED_SNAPSHOT_FIELDS = [
  'id',
  'status',
  'last_updated_at',
];
