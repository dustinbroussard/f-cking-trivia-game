import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { UserSettings } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  settings: UserSettings;
  onClose: () => void;
  onUpdate: (patch: Partial<UserSettings>) => void;
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 theme-soft-surface border rounded-2xl px-4 py-4">
      <div>
        <p className="font-bold">{label}</p>
        <p className="text-sm theme-text-muted">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`w-14 h-8 rounded-full transition-all duration-300 ${checked ? 'bg-cyan-500' : 'bg-zinc-500/40'}`}
      >
        <span
          className={`block w-6 h-6 rounded-full bg-white transition-transform duration-300 ${checked ? 'translate-x-7' : 'translate-x-1'}`}
        />
      </button>
    </div>
  );
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  onClose,
  onUpdate,
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 theme-overlay backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 12 }}
            className="w-full max-w-lg theme-panel-strong border rounded-3xl p-6 sm:p-7"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-400 mb-2">Settings</p>
                <h2 className="text-2xl font-black">Game Preferences</h2>
              </div>
              <button onClick={onClose} className="p-2 theme-icon-button rounded-xl transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="theme-soft-surface border rounded-2xl px-4 py-4">
                <p className="font-bold mb-3">Theme</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => onUpdate({ themeMode: 'dark' })}
                    className={`rounded-xl px-4 py-3 font-bold border transition-all ${settings.themeMode === 'dark' ? 'border-cyan-400 bg-cyan-400/10 text-cyan-400' : 'theme-border'}`}
                  >
                    Dark
                  </button>
                  <button
                    onClick={() => onUpdate({ themeMode: 'light' })}
                    className={`rounded-xl px-4 py-3 font-bold border transition-all ${settings.themeMode === 'light' ? 'border-cyan-400 bg-cyan-400/10 text-cyan-400' : 'theme-border'}`}
                  >
                    Light
                  </button>
                </div>
              </div>

              <ToggleRow
                label="Master Sound"
                description="Turns all game audio on or off."
                checked={settings.soundEnabled}
                onChange={(checked) => onUpdate({ soundEnabled: checked })}
              />
              <ToggleRow
                label="Music"
                description="Controls theme and welcome audio."
                checked={settings.musicEnabled}
                onChange={(checked) => onUpdate({ musicEnabled: checked })}
              />
              <ToggleRow
                label="Sound Effects"
                description="Controls correct, wrong, win, loss, and wheel audio."
                checked={settings.sfxEnabled}
                onChange={(checked) => onUpdate({ sfxEnabled: checked })}
              />
              <ToggleRow
                label="Commentary"
                description="Controls event-based trash talk overlays."
                checked={settings.commentaryEnabled}
                onChange={(checked) => onUpdate({ commentaryEnabled: checked })}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
