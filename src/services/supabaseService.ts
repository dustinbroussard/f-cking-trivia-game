import { supabase } from '../lib/supabase';
import { TriviaQuestion } from '../types';

export const QUESTION_TABLE = 'questions';

export async function storeQuestionsInBank(questions: TriviaQuestion[]) {
  const transformed = questions.map(q => ({
    id: q.questionId || q.id,
    content: q.question,
    correct_answer: q.choices[q.correctIndex],
    distractors: q.choices.filter((_, i) => i !== q.correctIndex),
    category: q.category,
    difficulty_level: q.difficulty || 'medium',
    explanation: q.explanation,
    styling: {
      hostLeadIn: q.hostLeadIn,
      questionStyled: q.questionStyled,
      explanationStyled: q.explanationStyled
    },
    batch_id: q.batchId,
    metadata: q
  }));

  const { error } = await supabase
    .from(QUESTION_TABLE)
    .upsert(transformed, { onConflict: 'content' });

  if (error) {
    console.error('[supabaseService] Error storing questions:', error.message);
    throw error;
  }
}

export async function fetchApprovedQuestionsByCategory(category: string, count: number, excludeIds: Set<string> = new Set()) {
  let { data, error } = await supabase
    .from(QUESTION_TABLE)
    .select('*')
    .eq('category', category)
    .order('created_at', { ascending: true })
    .limit(count * 5);

  if (error) {
    console.error('[supabaseService] Error fetching questions:', error.message);
    return [];
  }

  // Filter out excluded IDs client-side or add to query if not too many
  const filtered = (data || [])
    .filter(q => !excludeIds.has(q.id))
    .slice(0, count)
    .map(q => mapRowToQuestion(q));

  return filtered;
}

function mapRowToQuestion(row: any): TriviaQuestion {
  return {
    id: row.id,
    questionId: row.id,
    question: row.content,
    choices: [row.correct_answer, ...row.distractors],
    correctIndex: 0, // Since we put correct answer first in this map
    answerIndex: 0,
    category: row.category,
    difficulty: row.difficulty_level,
    explanation: row.explanation,
    questionStyled: row.styling?.questionStyled,
    explanationStyled: row.styling?.explanationStyled,
    hostLeadIn: row.styling?.hostLeadIn,
    batchId: row.batch_id,
    used: false,
    usedCount: 0,
  };
}
