import { useRef, useCallback, useState } from 'react';
import { publicAsset } from '../assets';
import { UserSettings } from '../types';

const THEME_TRACKS = ['theme.mp3', 'theme1.mp3', 'theme2.mp3'] as const;

function getRandomThemeTrack() {
  return THEME_TRACKS[Math.floor(Math.random() * THEME_TRACKS.length)];
}

export async function safePlay(media: HTMLMediaElement) {
  try {
    await media.play();
    return true;
  } catch (err) {
    console.warn('[Audio] autoplay blocked or playback failed', err);
    return false;
  }
}

export function useSound(settings: UserSettings) {
  const themeAudioRef = useRef<HTMLAudioElement>(null);
  const correctAudioRef = useRef<HTMLAudioElement>(null);
  const wrongAudioRef = useRef<HTMLAudioElement>(null);
  const timesUpAudioRef = useRef<HTMLAudioElement>(null);
  const wonAudioRef = useRef<HTMLAudioElement>(null);
  const lostAudioRef = useRef<HTMLAudioElement>(null);
  const welcomeAudioRef = useRef<HTMLAudioElement>(null);
  const newGameAudioRef = useRef<HTMLAudioElement>(null);
  const heckleChimeAudioRef = useRef<HTMLAudioElement>(null);

  const [themeAudioSrc] = useState(() => publicAsset(getRandomThemeTrack()));
  const correctAudioSrc = publicAsset('correct.mp3');
  const wrongAudioSrc = publicAsset('wrong.mp3');
  const timesUpAudioSrc = publicAsset('times-up.mp3');
  const wonAudioSrc = publicAsset('won.mp3');
  const lostAudioSrc = publicAsset('lost.mp3');
  const newGameAudioSrc = publicAsset('new-game.mp3');
  const heckleChimeAudioSrc = publicAsset('heckle-chime.mp3');
  const [audioNeedsInteraction, setAudioNeedsInteraction] = useState(false);

  const resolveSettings = useCallback((overrides?: Partial<UserSettings>) => ({
    ...settings,
    ...overrides,
  }), [settings]);

  const tryPlay = useCallback(async (audioRef: React.RefObject<HTMLAudioElement | null>, resetTime = false) => {
    if (!audioRef.current) {
      return false;
    }

    if (resetTime) {
      audioRef.current.currentTime = 0;
    }

    const played = await safePlay(audioRef.current);
    setAudioNeedsInteraction(!played);
    return played;
  }, []);

  const playSfx = useCallback((audioRef: React.RefObject<HTMLAudioElement | null>) => {
    if (settings.soundEnabled && settings.sfxEnabled && audioRef.current) {
      void tryPlay(audioRef, true);
    }
  }, [settings.soundEnabled, settings.sfxEnabled, tryPlay]);

  const playMusic = useCallback((audioRef: React.RefObject<HTMLAudioElement | null>) => {
    if (settings.soundEnabled && settings.musicEnabled && audioRef.current) {
      void tryPlay(audioRef);
    }
  }, [settings.soundEnabled, settings.musicEnabled, tryPlay]);

  const syncAudioState = useCallback((overrides?: Partial<UserSettings>) => {
    const nextSettings = resolveSettings(overrides);
    const musicEnabled = nextSettings.soundEnabled && nextSettings.musicEnabled;

    if (themeAudioRef.current) {
      themeAudioRef.current.volume = 0.3;
      themeAudioRef.current.muted = !musicEnabled;
      if (!musicEnabled) {
        themeAudioRef.current.pause();
        themeAudioRef.current.currentTime = 0;
      }
    }

    if (welcomeAudioRef.current) {
      welcomeAudioRef.current.volume = 1.0;
      welcomeAudioRef.current.muted = !musicEnabled;
      if (!musicEnabled) {
        welcomeAudioRef.current.pause();
        welcomeAudioRef.current.currentTime = 0;
      }
    }

    if (newGameAudioRef.current) {
      newGameAudioRef.current.volume = 1.0;
      newGameAudioRef.current.muted = !musicEnabled;
      if (!musicEnabled) {
        newGameAudioRef.current.pause();
        newGameAudioRef.current.currentTime = 0;
      }
    }

    if (!nextSettings.soundEnabled) {
      [
        correctAudioRef,
        wrongAudioRef,
        timesUpAudioRef,
        wonAudioRef,
        lostAudioRef,
        heckleChimeAudioRef,
      ].forEach((audioRef) => {
        if (!audioRef.current) return;
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      });
      setAudioNeedsInteraction(false);
    }
  }, [resolveSettings]);

  const enableAudioFromGesture = useCallback(async (overrides?: Partial<UserSettings>) => {
    const nextSettings = resolveSettings(overrides);
    syncAudioState(nextSettings);

    if (!nextSettings.soundEnabled) {
      setAudioNeedsInteraction(false);
      return false;
    }

    if (!nextSettings.musicEnabled) {
      setAudioNeedsInteraction(false);
      return true;
    }

    let played = false;

    played = await tryPlay(themeAudioRef);

    if (!played && welcomeAudioRef.current) {
      played = await tryPlay(welcomeAudioRef, true);
    }

    setAudioNeedsInteraction(!played);
    return played;
  }, [resolveSettings, syncAudioState, tryPlay]);

  return {
    themeAudioRef,
    correctAudioRef,
    wrongAudioRef,
    timesUpAudioRef,
    wonAudioRef,
    lostAudioRef,
    welcomeAudioRef,
    newGameAudioRef,
    heckleChimeAudioRef,
    themeAudioSrc,
    correctAudioSrc,
    wrongAudioSrc,
    timesUpAudioSrc,
    wonAudioSrc,
    lostAudioSrc,
    newGameAudioSrc,
    heckleChimeAudioSrc,
    audioNeedsInteraction,
    playSfx,
    playMusic,
    tryPlay,
    syncAudioState,
    enableAudioFromGesture,
    setAudioNeedsInteraction,
  };
}
