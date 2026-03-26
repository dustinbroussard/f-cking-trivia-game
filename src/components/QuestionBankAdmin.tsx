import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { TriviaQuestion, getPlayableCategories } from '../types';
import { ensureQuestionInventory } from '../services/questionRepository';

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

interface QuestionBankAdminProps {
  isOpen: boolean;
  onClose: () => void;
}

type CountsByCategory = Record<string, number>;
type CountsByDifficulty = Record<string, Record<string, number>>;

function normalizeQuestion(row: any): TriviaQuestion {
  const metadata = row.metadata ?? {};

  return {
    id: row.id,
    category: row.category,
    subcategory: row.subcategory,
    difficulty: row.difficulty,
    question: row.question,
    choices: row.choices ?? [],
    correctIndex: row.correct_index ?? row.correctIndex ?? 0,
    explanation: row.explanation,
    tags: row.tags ?? [],
    used: row.used,
    status: row.status,
    presentation: row.presentation ?? {},
    sourceType: row.source_type ?? row.sourceType ?? 'ai',
    createdAt: row.created_at ?? row.createdAt,
    metadata,
  };
}

async function fetchApprovedCount(filters?: { category?: string; difficulty?: string }) {
  let request = supabase
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'approved');

  if (filters?.category) request = request.eq('category', filters.category);
  if (filters?.difficulty) request = request.eq('difficulty', filters.difficulty);

  const { count, error } = await request;
  if (error) throw error;
  return count ?? 0;
}

export const QuestionBankAdmin: React.FC<QuestionBankAdminProps> = ({ isOpen, onClose }) => {
  const playableCategories = getPlayableCategories();
  const [selectedCategory, setSelectedCategory] = useState(playableCategories[0]);
  const [selectedDifficulty, setSelectedDifficulty] = useState<typeof DIFFICULTIES[number]>('medium');
  const [totalCount, setTotalCount] = useState(0);
  const [countsByCategory, setCountsByCategory] = useState<CountsByCategory>({});
  const [countsByDifficulty, setCountsByDifficulty] = useState<CountsByDifficulty>({});
  const [samples, setSamples] = useState<TriviaQuestion[]>([]);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [isLoadingSamples, setIsLoadingSamples] = useState(false);
  const [isReplenishing, setIsReplenishing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadSummary = async () => {
    setIsLoadingSummary(true);
    try {
      setTotalCount(await fetchApprovedCount());

      const categoryEntries = await Promise.all(
        playableCategories.map(async (category) => {
          const categoryCount = await fetchApprovedCount({ category });
          const difficultyEntries = await Promise.all(
            DIFFICULTIES.map(async (difficulty) => [
              difficulty,
              await fetchApprovedCount({ category, difficulty }),
            ] as const)
          );

          return [
            category,
            {
              count: categoryCount,
              difficultyCounts: Object.fromEntries(difficultyEntries),
            },
          ] as const;
        })
      );

      setCountsByCategory(Object.fromEntries(categoryEntries.map(([category, data]) => [category, data.count])));
      setCountsByDifficulty(
        Object.fromEntries(categoryEntries.map(([category, data]) => [category, data.difficultyCounts]))
      );
    } finally {
      setIsLoadingSummary(false);
    }
  };

  const loadSamples = async () => {
    setIsLoadingSamples(true);
    try {
      const { data, error } = await supabase
        .from('questions')
        .select('*')
        .eq('status', 'approved')
        .eq('category', selectedCategory)
        .eq('difficulty', selectedDifficulty)
        .order('created_at', { ascending: false })
        .limit(8);

      if (error) throw error;
      setSamples((data ?? []).map((row) => normalizeQuestion(row)));
    } finally {
      setIsLoadingSamples(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setFeedback(null);
    loadSummary().catch((err) => {
      console.error('[questionBankAdmin] Failed to load summary:', err);
      setFeedback('Failed to load question bank summary.');
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    loadSamples().catch((err) => {
      console.error('[questionBankAdmin] Failed to load samples:', err);
      setFeedback('Failed to load sample questions.');
    });
  }, [isOpen, selectedCategory, selectedDifficulty]);

  const runReplenishment = async (batchSize: number) => {
    setIsReplenishing(true);
    setFeedback(null);
    try {
      const currentCount = countsByDifficulty[selectedCategory]?.[selectedDifficulty] ?? 0;
      await ensureQuestionInventory({
        category: selectedCategory,
        difficulty: selectedDifficulty,
        minimumApproved: currentCount + batchSize,
        replenishBatchSize: batchSize,
      });
      await loadSummary();
      await loadSamples();
      setFeedback(`Replenishment finished for ${selectedCategory} (${selectedDifficulty}).`);
    } catch (err) {
      console.error('[questionBankAdmin] Replenishment failed:', err);
      setFeedback('Replenishment failed. Check console for details.');
    } finally {
      setIsReplenishing(false);
    }
  };

  return (
    <AnimatePresence>
      {!isOpen ? null : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[130] flex items-center justify-center p-4 theme-overlay backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.99 }}
            className="w-full max-w-5xl max-h-[85vh] overflow-hidden theme-panel-strong border rounded-3xl"
          >
            <div className="flex items-center justify-between px-6 py-5 border-b theme-border">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-400 mb-2">Dev Only</p>
                <h2 className="text-2xl font-black">Question Bank Admin</h2>
              </div>
              <button type="button" onClick={onClose} className="p-2 theme-icon-button rounded-xl transition-colors" aria-label="Close question bank admin">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-0 max-h-[calc(85vh-84px)]">
              <div className="p-6 border-r theme-border overflow-y-auto space-y-6">
                <section className="space-y-3">
                  <h3 className="font-black uppercase tracking-widest text-sm theme-text-muted">Summary</h3>
                  <div className="theme-soft-surface border rounded-2xl p-4">
                    <p className="text-xs uppercase tracking-widest theme-text-muted mb-1">Approved Questions</p>
                    <p className="text-4xl font-black">{isLoadingSummary ? '...' : totalCount}</p>
                  </div>
                  <div className="space-y-2">
                    {playableCategories.map((category) => (
                      <div key={category} className="theme-soft-surface border rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold">{category}</span>
                          <span className="theme-text-muted text-sm">{countsByCategory[category] ?? 0}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs theme-text-muted">
                          {DIFFICULTIES.map((difficulty) => (
                            <span key={difficulty}>
                              {difficulty}: {countsByDifficulty[category]?.[difficulty] ?? 0}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="font-black uppercase tracking-widest text-sm theme-text-muted">Controls</h3>
                  <div className="theme-soft-surface border rounded-2xl p-4 space-y-4">
                    <div>
                      <label className="block text-xs uppercase tracking-widest theme-text-muted mb-2">Category</label>
                      <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value as typeof playableCategories[number])}
                        className="w-full theme-input border rounded-xl px-3 py-3"
                      >
                        {playableCategories.map((category) => (
                          <option key={category} value={category}>{category}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-widest theme-text-muted mb-2">Difficulty</label>
                      <select
                        value={selectedDifficulty}
                        onChange={(e) => setSelectedDifficulty(e.target.value as typeof DIFFICULTIES[number])}
                        className="w-full theme-input border rounded-xl px-3 py-3"
                      >
                        {DIFFICULTIES.map((difficulty) => (
                          <option key={difficulty} value={difficulty}>{difficulty}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button type="button"
                        onClick={() => runReplenishment(10)}
                        disabled={isReplenishing}
                        className="theme-button rounded-xl px-4 py-3 font-bold border theme-border disabled:opacity-50"
                      >
                        {isReplenishing ? 'Working...' : 'Replenish 10'}
                      </button>
                      <button type="button"
                        onClick={() => runReplenishment(25)}
                        disabled={isReplenishing}
                        className="theme-button rounded-xl px-4 py-3 font-bold border theme-border disabled:opacity-50"
                      >
                        {isReplenishing ? 'Working...' : 'Replenish 25'}
                      </button>
                    </div>
                    {feedback && (
                      <p className="text-sm theme-text-secondary">{feedback}</p>
                    )}
                  </div>
                </section>
              </div>

              <div className="p-6 overflow-y-auto space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-black uppercase tracking-widest text-sm theme-text-muted mb-2">Sample Questions</h3>
                    <p className="theme-text-secondary text-sm">
                      Showing up to 8 approved questions for {selectedCategory} ({selectedDifficulty})
                    </p>
                  </div>
                  {isLoadingSamples && <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />}
                </div>

                <div className="space-y-4">
                  {samples.length === 0 && !isLoadingSamples ? (
                    <div className="theme-soft-surface border rounded-2xl p-6 theme-text-muted">
                      No approved sample questions found for this bucket.
                    </div>
                  ) : (
                    samples.map((question) => (
                      <div key={question.id} className="theme-soft-surface border rounded-2xl p-5 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-black text-lg">{question.question}</p>
                            <p className="text-sm theme-text-muted">
                              {question.category} · {question.difficulty} · used {question.usedCount ?? question.metadata?.usedCount ?? 0}
                            </p>
                          </div>
                        </div>
                        <ul className="space-y-2">
                          {question.choices.map((choice, index) => (
                            <li
                              key={`${question.id}-${index}`}
                              className={`rounded-xl px-3 py-2 border ${index === question.correctIndex ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'theme-border'}`}
                            >
                              {String.fromCharCode(65 + index)}. {choice}
                            </li>
                          ))}
                        </ul>
                        <p className="text-sm leading-relaxed theme-text-secondary">{question.explanation}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
