import { supabase } from '../lib/supabase';
import { UserSettings } from '../types';

const LOCAL_SETTINGS_KEY = 'aftg:userSettings';

export const DEFAULT_USER_SETTINGS: UserSettings = {
  themeMode: 'dark',
  soundEnabled: true,
  musicEnabled: true,
  sfxEnabled: true,
  commentaryEnabled: true,
  updatedAt: 0,
};

function sanitizeSettings(value: any): Partial<UserSettings> {
  if (!value || typeof value !== 'object') return {};

  const result: Partial<UserSettings> = {};

  if (value.themeMode === 'light' || value.themeMode === 'dark') {
    result.themeMode = value.themeMode;
  }
  if (typeof value.soundEnabled === 'boolean') {
    result.soundEnabled = value.soundEnabled;
  }
  if (typeof value.musicEnabled === 'boolean') {
    result.musicEnabled = value.musicEnabled;
  }
  if (typeof value.sfxEnabled === 'boolean') {
    result.sfxEnabled = value.sfxEnabled;
  }
  if (typeof value.commentaryEnabled === 'boolean') {
    result.commentaryEnabled = value.commentaryEnabled;
  }
  if (typeof value.updatedAt === 'number') {
    result.updatedAt = Number(value.updatedAt);
  } else if (value.updatedAt) {
    result.updatedAt = new Date(value.updatedAt).getTime();
  }

  return result;
}

function readLegacyLocalSettings(): Partial<UserSettings> {
  if (typeof window === 'undefined') return {};

  const themeMode = window.localStorage.getItem('themeMode');
  const soundEnabled = window.localStorage.getItem('soundEnabled');

  return sanitizeSettings({
    themeMode: themeMode === 'light' || themeMode === 'dark' ? themeMode : undefined,
    soundEnabled: soundEnabled === null ? undefined : soundEnabled === 'true',
  });
}

export function mergeSettings(
  local: Partial<UserSettings> | null | undefined,
  remote: Partial<UserSettings> | null | undefined,
  defaults: UserSettings = DEFAULT_USER_SETTINGS
): UserSettings {
  const safeLocal = sanitizeSettings(local);
  const safeRemote = sanitizeSettings(remote);
  const localUpdatedAt = safeLocal.updatedAt ?? 0;
  const remoteUpdatedAt = safeRemote.updatedAt ?? 0;

  const winner = remoteUpdatedAt > localUpdatedAt
    ? { ...safeLocal, ...safeRemote }
    : { ...safeRemote, ...safeLocal };

  return {
    ...defaults,
    ...winner,
    updatedAt: Math.max(localUpdatedAt, remoteUpdatedAt, defaults.updatedAt),
  };
}

export function getLocalSettings(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_USER_SETTINGS;

  let parsedLocal: Partial<UserSettings> = {};
  const raw = window.localStorage.getItem(LOCAL_SETTINGS_KEY);

  if (raw) {
    try {
      parsedLocal = JSON.parse(raw);
    } catch {
      parsedLocal = {};
    }
  }

  return mergeSettings(readLegacyLocalSettings(), parsedLocal, DEFAULT_USER_SETTINGS);
}

export function saveLocalSettings(settings: UserSettings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
  window.localStorage.setItem('themeMode', settings.themeMode);
  window.localStorage.setItem('soundEnabled', String(settings.soundEnabled));
}

export async function loadUserSettings(uid: string): Promise<Partial<UserSettings> | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('settings')
    .eq('user_id', uid)
    .maybeSingle();

  if (error) {
    console.error('[loadUserSettings] Error:', error.message);
    return null;
  }
  if (!data?.settings) return null;

  return sanitizeSettings(data.settings);
}

export async function saveUserSettings(uid: string, settings: UserSettings) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('user_settings')
    .upsert({
      user_id: uid,
      settings: settings,
      updated_at: now,
    });
  if (error) throw error;
}
