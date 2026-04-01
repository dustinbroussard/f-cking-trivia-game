import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { getRandomQuestionFlagLine } from '../content/questionFlagCopy';
import { flagQuestion } from '../services/questionFlags';
import { ConfirmModal } from './ConfirmModal';
import { ResultCard } from './ResultCard';
import { SafeRichText } from './SafeRichText';

interface RoastProps {
  explanation: string;
  isCorrect: boolean;
  questionId: string;
  wrongAnswerQuip?: string;
  userId?: string | null;
  gameId?: string | null;
  onClose: () => void;
}

export const Roast: React.FC<RoastProps> = ({ explanation, isCorrect, questionId, wrongAnswerQuip, userId, gameId, onClose }) => {
  const [flagLine, setFlagLine] = useState(() => getRandomQuestionFlagLine());
  const [isFlagged, setIsFlagged] = useState(false);
  const [isSavingFlag, setIsSavingFlag] = useState(false);
  const [isFlagConfirmOpen, setIsFlagConfirmOpen] = useState(false);

  useEffect(() => {
    setFlagLine(getRandomQuestionFlagLine());
    setIsFlagged(false);
    setIsSavingFlag(false);
    setIsFlagConfirmOpen(false);
  }, [questionId]);

  const handleFlagConfirm = async () => {
    if (isFlagged || isSavingFlag) return;

    setIsSavingFlag(true);
    try {
      await flagQuestion({ questionId, userId, gameId });
      setIsFlagged(true);
      setIsFlagConfirmOpen(false);
    } catch (error) {
      console.error('[questionFlag] Failed to log flag:', error);
    } finally {
      setIsSavingFlag(false);
    }
  };

  return (
    <>
      <motion.div
        key="roast-modal"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center px-6 pt-6 pb-10 sm:pb-12 pointer-events-auto"
      >
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 theme-overlay"
          initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
          animate={{ opacity: 1, backdropFilter: 'blur(4px)' }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
        />

        <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-5 text-center">
          <ResultCard
            variant={isCorrect ? 'correct' : 'wrong'}
            title={isCorrect ? 'Correct!' : 'Wrong!'}
            actionLabel="Continue"
            onAction={onClose}
            className="w-full"
            body={
              <>
                {!isCorrect && (
                  <SafeRichText
                    as="p"
                    className="theme-incorrect-quip mb-4 text-base font-black leading-relaxed"
                    html={wrongAnswerQuip}
                  />
                )}
                <SafeRichText
                  as="div"
                  className="text-lg font-semibold leading-relaxed"
                  html={explanation}
                />
              </>
            }
          />

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.24, ease: 'easeOut' }}
            className="flex w-full max-w-sm flex-col items-center gap-3 px-3"
          >
            <p className="text-center text-sm leading-relaxed theme-text-muted opacity-90">
              {flagLine}
            </p>

            <button
              type="button"
              onClick={() => setIsFlagConfirmOpen(true)}
              disabled={isFlagged || isSavingFlag}
              className={`w-full rounded-xl border px-5 py-3 text-xs font-bold uppercase tracking-[0.18em] transition-all duration-300 ease-in-out active:scale-[0.98] ${
                isFlagged
                  ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200'
                  : 'border-white/12 bg-white/[0.03] theme-text-secondary hover:scale-[1.02] hover:border-rose-400/35 hover:text-rose-200'
              } disabled:cursor-default disabled:hover:scale-100 disabled:opacity-90`}
            >
              {isFlagged ? 'Question flagged' : isSavingFlag ? 'Flagging...' : 'Flag this question for review'}
            </button>

            {isFlagged && (
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300/90">
                Sent to review
              </p>
            )}
          </motion.div>
        </div>
      </motion.div>

      <ConfirmModal
        isOpen={isFlagConfirmOpen}
        title="Flag this question?"
        message="Think this question is wrong, unclear, or broken?"
        confirmLabel="Flag Question"
        isConfirming={isSavingFlag}
        zIndexClass="z-[70]"
        onCancel={() => setIsFlagConfirmOpen(false)}
        onConfirm={handleFlagConfirm}
      />
    </>
  );
};
