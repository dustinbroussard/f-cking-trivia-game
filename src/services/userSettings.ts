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

  if (value.theme_mode === 'light' || value.theme_mode === 'dark' || value.themeMode === 'light' || value.themeMode === 'dark') {
    result.themeMode = value.theme_mode || value.themeMode;
  }
  if (typeof (value.sound_enabled ?? value.soundEnabled) === 'boolean') {
    result.soundEnabled = value.sound_enabled ?? value.soundEnabled;
  }
  if (typeof (value.music_enabled ?? value.musicEnabled) === 'boolean') {
    result.musicEnabled = value.music_enabled ?? value.musicEnabled;
  }
  if (typeof (value.sfx_enabled ?? value.sfxEnabled) === 'boolean') {
    result.sfxEnabled = value.sfx_enabled ?? value.sfxEnabled;
  }
  if (typeof (value.commentary_enabled ?? value.commentaryEnabled) === 'boolean') {
    result.commentaryEnabled = value.commentary_enabled ?? value.commentaryEnabled;
  }
  if (typeof (value.updated_at ?? value.updatedAt) === 'number') {
    result.updatedAt = Number(value.updated_at ?? value.updatedAt);
  } else if (value.updated_at || value.updatedAt) {
    result.updatedAt = new Date(value.updated_at || value.updatedAt).getTime();
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
    .select('*')
    .eq('user_id', uid)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;

  return sanitizeSettings(data);
}

export async function saveUserSettings(uid: string, settings: UserSettings) {
  const { error } = await supabase
    .from('user_settings')
    .upsert({
      user_id: uid,
      theme_mode: settings.themeMode,
      sound_enabled: settings.soundEnabled,
      music_enabled: settings.musicEnabled,
      sfx_enabled: settings.sfxEnabled,
      commentary_enabled: settings.commentaryEnabled,
      updated_at: settings.updatedAt,
    });
  if (error) throw error;
}
