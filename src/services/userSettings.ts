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

function sanitizeSettings(v: any): Partial<UserSettings> {
  const r: Partial<UserSettings> = {};
  if (v.themeMode || v.theme_mode) r.themeMode = v.themeMode || v.theme_mode;
  if (typeof (v.soundEnabled ?? v.sound_enabled) === 'boolean') r.soundEnabled = v.soundEnabled ?? v.sound_enabled;
  if (typeof (v.musicEnabled ?? v.music_enabled) === 'boolean') r.musicEnabled = v.musicEnabled ?? v.music_enabled;
  if (typeof (v.sfxEnabled ?? v.sfx_enabled) === 'boolean') r.sfxEnabled = v.sfxEnabled ?? v.sfx_enabled;
  if (typeof (v.commentaryEnabled ?? v.commentary_enabled) === 'boolean') r.commentaryEnabled = v.commentaryEnabled ?? v.commentary_enabled;
  if (v.updatedAt || v.updated_at) r.updatedAt = Number(v.updatedAt || v.updated_at);
  return r;
}

export function getLocalSettings(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_USER_SETTINGS;
  const raw = window.localStorage.getItem(LOCAL_SETTINGS_KEY);
  if (!raw) return DEFAULT_USER_SETTINGS;
  try { return { ...DEFAULT_USER_SETTINGS, ...sanitizeSettings(JSON.parse(raw)) }; } catch { return DEFAULT_USER_SETTINGS; }
}

export function saveLocalSettings(s: UserSettings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(s));
}

export async function loadUserSettings(uid: string) {
  const { data } = await supabase.from('user_settings').select('*').eq('user_id', uid).single();
  return data ? sanitizeSettings(data) : null;
}

export async function saveUserSettings(uid: string, s: UserSettings) {
  await supabase.from('user_settings').upsert({ user_id: uid, theme_mode: s.themeMode, sound_enabled: s.soundEnabled, music_enabled: s.musicEnabled, sfx_enabled: s.sfxEnabled, commentary_enabled: s.commentaryEnabled, updated_at: s.updatedAt });
}

export function mergeSettings(local: any, remote: any, defaults: UserSettings = DEFAULT_USER_SETTINGS): UserSettings {
  const l = sanitizeSettings(local || {});
  const r = sanitizeSettings(remote || {});
  return { ...defaults, ...( (r.updatedAt || 0) > (l.updatedAt || 0) ? { ...l, ...r } : { ...r, ...l } ) };
}
