import { useRef, useCallback } from 'react';
import { publicAsset } from '../assets';
import { UserSettings } from '../types';

export function useSound(settings: UserSettings) {
  const themeAudioRef = useRef<HTMLAudioElement>(null);
  const correctAudioRef = useRef<HTMLAudioElement>(null);
  const wrongAudioRef = useRef<HTMLAudioElement>(null);
  const timesUpAudioRef = useRef<HTMLAudioElement>(null);
  const wonAudioRef = useRef<HTMLAudioElement>(null);
  const lostAudioRef = useRef<HTMLAudioElement>(null);
  const welcomeAudioRef = useRef<HTMLAudioElement>(null);

  const themeAudioSrc = publicAsset('theme.mp3');
  const correctAudioSrc = publicAsset('correct.mp3');
  const wrongAudioSrc = publicAsset('wrong.mp3');
  const timesUpAudioSrc = publicAsset('times-up.mp3');
  const wonAudioSrc = publicAsset('won.mp3');
  const lostAudioSrc = publicAsset('lost.mp3');

  const playSfx = useCallback((audioRef: React.RefObject<HTMLAudioElement | null>) => {
    if (settings.soundEnabled && settings.sfxEnabled && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(console.error);
    }
  }, [settings.soundEnabled, settings.sfxEnabled]);

  const playMusic = useCallback((audioRef: React.RefObject<HTMLAudioElement | null>) => {
    if (settings.soundEnabled && settings.musicEnabled && audioRef.current) {
      audioRef.current.play().catch(console.error);
    }
  }, [settings.soundEnabled, settings.musicEnabled]);

  return {
    themeAudioRef,
    correctAudioRef,
    wrongAudioRef,
    timesUpAudioRef,
    wonAudioRef,
    lostAudioRef,
    welcomeAudioRef,
    themeAudioSrc,
    correctAudioSrc,
    wrongAudioSrc,
    timesUpAudioSrc,
    wonAudioSrc,
    lostAudioSrc,
    playSfx,
    playMusic,
  };
}
