import { supabase } from '../lib/supabase';
import { TriviaQuestion } from '../types';

export async function importQuestionBatch(questions: Partial<TriviaQuestion>[]) {
  const formattedQuestions = questions.map((q) => ({
    category: q.category,
    subcategory: q.subcategory,
    difficulty: q.difficulty,
    question: q.question,
    choices: q.choices,
    correct_index: q.correctIndex,
    explanation: q.explanation,
    tags: q.tags || [],
    status: q.status || 'pending',
    presentation: q.presentation || {},
    source_type: q.sourceType || 'ai',
    metadata: q.metadata || {},
  }));

  const { data, error } = await supabase
    .from('questions')
    .insert(formattedQuestions)
    .select();

  if (error) {
    console.error('Error importing questions:', error);
    throw error;
  }

  return data;
}

export async function fetchQuestions(filters: {
  category?: string;
  difficulty?: string;
  status?: string;
}) {
  let query = supabase.from('questions').select('*');

  if (filters.category) query = query.eq('category', filters.category);
  if (filters.difficulty) query = query.eq('difficulty', filters.difficulty);
  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  
  if (error) {
    console.error('Error fetching questions:', error);
    throw error;
  }

  return data;
}
