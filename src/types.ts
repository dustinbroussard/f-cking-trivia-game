export type Category = 'History' | 'Science' | 'Pop Culture' | 'Art & Music' | 'Sports' | 'Technology' | 'Random';

export interface TriviaQuestion {
  id: string; // uuid
  category: string;
  subcategory?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  choices: string[];
  correctIndex: number;
  answerIndex?: number;
  explanation: string;
  tags: string[];
  used?: boolean;
  status: 'pending' | 'verified' | 'approved' | 'rejected' | 'flagged';
  presentation: {
    questionStyled?: string;
    explanationStyled?: string;
    hostLeadIn?: string;
  };
  sourceType: string;
  createdAt?: number | string; // Supabase uses ISO strings but app may use timestamp
  metadata?: Record<string, any>; // For extra items like usedCount, pipelineVersion, etc.
}


export interface RoastState {
  explanation: string;
  isCorrect: boolean;
  questionId: string;
  userId?: string | null;
  gameId?: string | null;
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
  lastActive?: number;
  lastResumedAt?: number;
}

export interface GameAnswer {
  answerIndex: number;
  submittedAt: number;
  isCorrect: boolean;
  source: 'answer' | 'timeout';
}

export interface CategoryPerformance {
  seen: number;
  correct: number;
  percentageCorrect: number;
}

export interface PlayerStatsSummary {
  completedGames: number;
  wins: number;
  losses: number;
  winPercentage: number;
  totalQuestionsSeen: number;
  totalQuestionsCorrect: number;
  categoryPerformance: Record<string, CategoryPerformance>;
}

export interface PlayerProfile {
  userId: string;
  nickname: string;
  avatarUrl?: string;
  stats?: PlayerStatsSummary;
  createdAt: any;
  updatedAt: any;
}

export interface RecentCompletedGame {
  gameId: string;
  players: { uid: string; nickname: string }[];
  winnerId: string | null;
  finalScores: Record<string, number>;
  categoriesUsed: string[];
  completedAt: number;
  status: 'completed';
  opponentIds?: string[];
}

export interface MatchupSummary {
  opponentId: string;
  opponentNickname: string;
  opponentAvatarUrl?: string;
  wins: number;
  losses: number;
  totalGames: number;
  lastPlayedAt: number;
}

export interface GameState {
  id: string;
  code: string;
  status: 'waiting' | 'active' | 'completed' | 'abandoned';
  hostId: string;
  playerIds: string[];
  players: Player[];
  currentTurn: string;
  winnerId: string | null;
  gameMode?: string;
  gameState?: any;
  result?: any;
  // Convenience fields mapped from JSON columns
  currentQuestionId?: string | null;
  currentQuestionCategory?: string | null;
  currentQuestionIndex?: number;
  currentQuestionStartedAt?: number | null;
  questionIds?: string[];
  answers?: Record<string, Record<string, GameAnswer>>;
  finalScores?: Record<string, number>;
  categoriesUsed?: string[];
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

export interface RecentPlayer {
  uid: string;
  nickname: string;
  avatarUrl?: string;
  lastPlayedAt: number;
  lastGameId?: string;
  hidden?: boolean;
}

export interface GameInvite {
  id: string;
  fromUid: string;
  fromNickname: string;
  fromAvatarUrl?: string;
  toUid: string;
  gameId: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: number;
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

export function getQuestionText(question: TriviaQuestion): string {
  return question.presentation?.questionStyled || question.question;
}

export function getExplanationText(question: TriviaQuestion): string {
  return question.presentation?.explanationStyled || question.explanation;
}

export function getHostLeadIn(question: TriviaQuestion): string | undefined {
  return question.presentation?.hostLeadIn;
}
