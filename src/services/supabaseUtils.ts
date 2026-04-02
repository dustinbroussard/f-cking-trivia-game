export function isMissingRowError(error: any) {
  return error?.code === 'PGRST116' || error?.status === 406;
}

export function isMissingTableError(error: any) {
  return error?.code === 'PGRST205' || error?.status === 404;
}

export function isMissingFunctionError(error: any) {
  return error?.code === '42883' || error?.message?.includes('function') || error?.status === 404;
}

export function logSupabaseError(
  table: string,
  operation: string,
  error: any,
  metadata?: Record<string, unknown>
) {
  console.error(`[Supabase] ${operation} ${table} failed`, {
    table,
    operation,
    status: error?.status ?? null,
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    details: error?.details ?? null,
    hint: error?.hint ?? null,
    rawError: error ?? null,
    metadata: metadata ?? null,
  });
}

export function isSupabaseRlsInsertError(error: any) {
  return error?.code === '42501';
}

export function isGamesUpdatedAtSchemaError(error: any) {
  return error?.code === '42703'
    && typeof error?.message === 'string'
    && error.message.includes('updated_at');
}

export function nowIsoString() {
  return new Date().toISOString();
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function getGameDisplayCode(gameId: string) {
  return gameId.slice(0, 8).toUpperCase();
}
