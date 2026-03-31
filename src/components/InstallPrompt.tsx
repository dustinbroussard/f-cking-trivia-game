import React, { useEffect, useMemo, useState } from 'react';
import { Download, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { publicAsset } from '../assets';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const INSTALL_PROMPT_SESSION_KEY = 'installPromptHandledThisSession';

function isAppInstalled() {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // @ts-expect-error iOS standalone mode is non-standard.
    window.navigator.standalone === true
  );
}

export function InstallPrompt() {
  const logoSrc = publicAsset('logo.png');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(() => isAppInstalled());
  const [hasHandledPromptThisSession, setHasHandledPromptThisSession] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return sessionStorage.getItem(INSTALL_PROMPT_SESSION_KEY) === 'true';
  });

  const isVisible = useMemo(
    () => !!deferredPrompt && !isInstalled && !hasHandledPromptThisSession,
    [deferredPrompt, hasHandledPromptThisSession, isInstalled]
  );

  useEffect(() => {
    if (isInstalled || hasHandledPromptThisSession) {
      return;
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      const installEvent = event as BeforeInstallPromptEvent;
      installEvent.preventDefault();
      setDeferredPrompt(installEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [hasHandledPromptThisSession, isInstalled]);

  useEffect(() => {
    const displayModeMediaQuery = window.matchMedia('(display-mode: standalone)');
    const syncInstalledState = () => setIsInstalled(isAppInstalled());

    syncInstalledState();
    displayModeMediaQuery.addEventListener?.('change', syncInstalledState);

    return () => {
      displayModeMediaQuery.removeEventListener?.('change', syncInstalledState);
    };
  }, []);

  const markPromptHandledForSession = () => {
    sessionStorage.setItem(INSTALL_PROMPT_SESSION_KEY, 'true');
    setHasHandledPromptThisSession(true);
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      setIsInstalled(true);
    }

    markPromptHandledForSession();
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    markPromptHandledForSession();
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="fixed bottom-6 left-6 right-6 md:left-auto md:right-6 md:w-96 theme-panel-strong rounded-xl p-4 z-[100] flex flex-col gap-3"
          role="dialog"
          aria-modal="false"
          aria-label="Install app"
        >
          <div className="flex items-start justify-between">
            <div className="flex gap-3 items-center">
              <div className="w-12 h-12 theme-avatar-surface rounded-lg shrink-0 flex items-center justify-center p-2 shadow-inner border">
                <img src={logoSrc} alt="AFTG Logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <h3 className="font-bold text-sm tracking-wide">Install A F-cking Trivia Game</h3>
                <p className="theme-text-muted text-xs mt-0.5">Play faster, offline, and full-screen.</p>
              </div>
            </div>
            <button type="button"
              onClick={handleDismiss}
              className="p-1 theme-icon-button rounded-md transition-colors"
              aria-label="Dismiss install prompt"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <button type="button"
            onClick={handleInstallClick}
            className="w-full py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-lg text-sm font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-pink-500/25 active:scale-[0.98]"
          >
            <Download className="w-4 h-4" />
            Install App
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
