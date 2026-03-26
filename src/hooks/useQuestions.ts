import { useState, useCallback, useRef } from 'react';
import { TriviaQuestion, getPlayableCategories } from '../types';
import { ensureQuestionInventory, getQuestionsForSession, markQuestionSeen } from '../services/questionRepository';
import { STARTUP_REPLENISH_MIN_APPROVED, AUTO_REPLENISH_BATCH_SIZE } from '../services/questionInventoryConfig';

export function useQuestions(user: any | null, gameId?: string) {
  const [questions, setQuestions] = useState<TriviaQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<TriviaQuestion | null>(null);
  const [isFetchingQuestions, setIsFetchingQuestions] = useState(false);
  const activeQuestionIdRef = useRef<string | null>(null);

  const playableCategories = getPlayableCategories();

  const fetchQuestions = useCallback(async (categories: string[], countPerCategory: number) => {
    setIsFetchingQuestions(true);
    try {
      const q = await getQuestionsForSession({ categories, count: countPerCategory });
      setQuestions(q);
      return q;
    } catch (err) {
      console.error('[fetchQuestions] Failed:', err);
      throw err;
    } finally {
      setIsFetchingQuestions(false);
    }
  }, []);

  const markSeen = useCallback(async (questionId: string) => {
    if (!user?.id) return;
    try {
      await markQuestionSeen({
        userId: user.id,
        questionId,
        gameId,
      });
    } catch (err) {
      console.error('[seenQuestions] Failed:', err);
    }
  }, [user?.id, gameId]);

  const refillInventory = useCallback((categories: string[]) => {
    let staggerDelay = 0;
    categories.forEach((category) => {
      (['easy', 'medium', 'hard'] as const).forEach((difficulty) => {
        const currentDelay = staggerDelay;
        staggerDelay += 400;

        setTimeout(() => {
          ensureQuestionInventory({
            category,
            difficulty,
            minimumApproved: STARTUP_REPLENISH_MIN_APPROVED,
            replenishBatchSize: AUTO_REPLENISH_BATCH_SIZE,
          }).catch((err) => {
            if (import.meta.env.DEV) {
              console.warn(`[questionInventory] Failed for ${category}/${difficulty}:`, err);
            }
          });
        }, currentDelay);
      });
    });
  }, []);

  return {
    questions,
    setQuestions,
    currentQuestion,
    setCurrentQuestion,
    isFetchingQuestions,
    setIsFetchingQuestions,
    fetchQuestions,
    markSeen,
    refillInventory,
    activeQuestionIdRef,
  };
}
