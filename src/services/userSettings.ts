import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
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

function sanitizeSettings(value: Partial<UserSettings> | null | undefined): Partial<UserSettings> {
  if (!value || typeof value !== 'object') return {};

  return {
    themeMode: value.themeMode === 'light' ? 'light' : value.themeMode === 'dark' ? 'dark' : undefined,
    soundEnabled: typeof value.soundEnabled === 'boolean' ? value.soundEnabled : undefined,
    musicEnabled: typeof value.musicEnabled === 'boolean' ? value.musicEnabled : undefined,
    sfxEnabled: typeof value.sfxEnabled === 'boolean' ? value.sfxEnabled : undefined,
    commentaryEnabled: typeof value.commentaryEnabled === 'boolean' ? value.commentaryEnabled : undefined,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : undefined,
  };
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
  const settingsRef = doc(db, 'users', uid, 'private', 'settings');
  const snapshot = await getDoc(settingsRef);
  if (!snapshot.exists()) return null;
  return sanitizeSettings(snapshot.data() as Partial<UserSettings>);
}

export async function saveUserSettings(uid: string, settings: UserSettings) {
  const settingsRef = doc(db, 'users', uid, 'private', 'settings');
  await setDoc(settingsRef, settings, { merge: true });
}
