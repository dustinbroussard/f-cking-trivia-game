export type Category = 'History' | 'Science' | 'Pop Culture' | 'Art & Music' | 'Sports' | 'Random';

export interface TriviaQuestion {
  id: string;
  category: string;
  question: string;
  choices: string[];
  answerIndex: number;
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

export const CATEGORIES: Category[] = ['History', 'Science', 'Pop Culture', 'Art & Music', 'Sports', 'Random'];

export const CATEGORY_COLORS: Record<string, string> = {
  'History': '#F43F5E', // Rose 500
  'Science': '#06B6D4', // Cyan 500
  'Pop Culture': '#D946EF', // Fuchsia 500
  'Art & Music': '#10B981', // Emerald 500
  'Sports': '#F59E0B', // Amber 500
  'Random': '#FFFFFF',
};
