export const AUTO_REPLENISH_BATCH_SIZE = 3;

// Keep a healthier approved-question bank per category/difficulty bucket.
// There are 18 playable buckets (6 categories x 3 difficulties), so these
// targets raise inventory without requiring an immediate one-time bulk jump.
export const STARTUP_REPLENISH_MIN_APPROVED = 14;
export const ACTIVE_GAME_REPLENISH_MIN_APPROVED = 12;
export const MAINTENANCE_REPLENISH_THRESHOLD = 14;
