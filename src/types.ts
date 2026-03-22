export type Category = 'History' | 'Science' | 'Pop Culture' | 'Art & Music' | 'Sports' | 'Technology' | 'Random';

export interface TriviaQuestion {
  id: string;
  questionId?: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  choices: string[];
  correctIndex: number;
  answerIndex: number;
  explanation: string;
  validationStatus: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  usedCount: number;
  correctQuip: string;
  wrongAnswerQuips: Record<number, string>;
  used: boolean;
}

export interface ChatMessage {
  id: string;
  uid: string;
  name: string;
  text: string;
  timestamp: any;
  avatarUrl?: string;
}

export interface Player {
  uid: string;
  name: string;
  score: number;
  streak: number;
  completedCategories: string[];
  avatarUrl?: string;
}

export interface GameState {
  id: string;
  code: string;
  status: 'waiting' | 'active' | 'completed';
  hostId: string;
  playerIds: string[];
  currentTurn: string;
  winnerId: string | null;
  createdAt: any;
  lastUpdated: any;
}

export interface UserSettings {
  themeMode: 'dark' | 'light';
  soundEnabled: boolean;
  musicEnabled: boolean;
  sfxEnabled: boolean;
  commentaryEnabled: boolean;
  updatedAt: number;
}

export const CATEGORIES: Category[] = ['History', 'Science', 'Pop Culture', 'Art & Music', 'Sports', 'Technology', 'Random'];

export function getPlayableCategories(): Exclude<Category, 'Random'>[] {
  return CATEGORIES.filter((category): category is Exclude<Category, 'Random'> => category !== 'Random');
}

export function isPlayableCategory(category: string): boolean {
  return getPlayableCategories().includes(category as Exclude<Category, 'Random'>);
}

export const CATEGORY_COLORS: Record<string, string> = {
  'History': '#F43F5E', // Rose 500
  'Science': '#06B6D4', // Cyan 500
  'Pop Culture': '#D946EF', // Fuchsia 500
  'Art & Music': '#10B981', // Emerald 500
  'Sports': '#F59E0B', // Amber 500
  'Technology': '#3B82F6', // Blue 500
  'Random': '#FFFFFF',
};
