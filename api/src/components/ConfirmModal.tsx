import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  isConfirming?: boolean;
  zIndexClass?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel,
  isConfirming = false,
  zIndexClass = 'z-50',
  onCancel,
  onConfirm,
}) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="confirm-modal"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={`fixed inset-0 flex items-center justify-center p-4 theme-overlay backdrop-blur-sm ${zIndexClass}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="theme-panel-strong backdrop-blur-xl border rounded-2xl p-6 w-full max-w-md"
        >
          <div className="space-y-3">
            <h2 id="confirm-modal-title" className="text-2xl font-black uppercase tracking-tight">{title}</h2>
            <p className="theme-text-muted leading-relaxed">{message}</p>
          </div>

          <div className="flex gap-3 mt-6">
            <button type="button"
              onClick={onCancel}
              disabled={isConfirming}
              className="flex-1 px-5 py-3 rounded-xl theme-button font-bold uppercase tracking-widest text-xs"
            >
              Cancel
            </button>
            <button type="button"
              onClick={onConfirm}
              disabled={isConfirming}
              className="flex-1 px-5 py-3 rounded-xl bg-rose-500 hover:bg-rose-400 disabled:opacity-70 text-white font-bold uppercase tracking-widest text-xs transition-colors"
            >
              {isConfirming ? 'Flagging...' : confirmLabel}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
