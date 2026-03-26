export interface TriviaQuestion {
  id: string;
  category: string;
  subcategory?: string;
  difficulty: string;
  question: string;
  choices: string[];
  correctIndex: number;
  answerIndex?: number;
  explanation: string;
  tags?: string[];
  status: string;
  validationStatus?: 'pending' | 'approved' | 'rejected';
  questionStyled?: string;
  explanationStyled?: string;
  hostLeadIn?: string;
  presentation?: {
    questionStyled?: string;
    explanationStyled?: string;
    hostLeadIn?: string;
  };
  sourceType: string;
  source?: string;
  used?: boolean;
  usedCount?: number;
  questionId?: string;
  batchId?: string;
  verificationVerdict?: string;
  verificationConfidence?: 'low' | 'medium' | 'high';
  verificationIssues?: string[];
  verificationReason?: string;
  pipelineVersion?: string;
  createdAt?: number;
  correctQuip?: string;
  wrongAnswerQuips?: Record<number, string>;
}

export interface Player {
  uid: string;
  name: string;
  displayName?: string;
  score: number;
  streak: number;
  completedCategories: string[];
  avatarUrl?: string;
  photoURL?: string;
  lastActive?: number;
  lastResumedAt?: number;
}


export interface GameState {
  id: string;
  code: string;
  status: 'waiting' | 'active' | 'completed' | 'abandoned';
  hostId: string;
  playerIds: string[];
  players?: Player[];
  currentTurn: string;
  winnerId: string | null;
  currentQuestionId: string | null;
  currentQuestionCategory: string | null;
  currentQuestionIndex: number;
  currentQuestionStartedAt: number | null;
  questionIds: string[];
  answers: Record<string, Record<string, GameAnswer>>;
  finalScores: Record<string, number>;
  categoriesUsed: string[];
  statsRecordedAt?: number;
  lastUpdated: number;
  createdAt?: string;
}


export interface GameAnswer {
  correctIndex: number;
  submittedAt: number;
  isCorrect: boolean;
  source: string;
  timeTaken: number;
}

export interface GameInvite {
  id: string;
  fromUid: string;
  fromDisplayName: string;
  fromPhotoURL?: string;
  toUid: string;
  gameId: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: number;
}

export interface RecentPlayer {
  uid: string;
  displayName: string;
  photoURL?: string;
  lastPlayedAt: number;
  lastGameId: string;
  hidden: boolean;
  updatedAt: number;
}

export interface PlayerProfile {
  id: string;
  display_name: string;
  photo_url?: string;
  stats: PlayerStatsSummary;
  created_at: string;
  updated_at: string;
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

export interface CategoryPerformance {
  seen: number;
  correct: number;
  percentageCorrect: number;
}

export interface UserSettings {
  themeMode: 'light' | 'dark';
  soundEnabled: boolean;
  musicEnabled: boolean;
  sfxEnabled: boolean;
  commentaryEnabled: boolean;
  updatedAt: number;
}

export interface MatchupSummary {
  opponentId: string;
  opponentDisplayName: string;
  opponentPhotoURL?: string;
  wins: number;
  losses: number;
  totalGames: number;
  lastPlayedAt: number;
}

export interface RecentCompletedGame {
  gameId: string;
  players: Player[];
  winnerId: string | null;
  finalScores: Record<string, number>;
  categoriesUsed: string[];
  completedAt: number;
  status: string;
  opponentIds: string[];
}

export interface ChatMessage {
  id: string;
  userId: string;
  uid: string; // for compatibility
  name: string;
  avatarUrl?: string;
  text: string;
  timestamp: number;
}

export interface RoastState {
  id: string;
  text: string;
  targetId: string;
  explanation: string;
  isCorrect: boolean;
  questionId: string;
  userId: string;
  gameId: string;
}


export function getPlayableCategories(): string[] {
  return [
    'Science',
    'History',
    'Geography',
    'Literature',
    'Pop Culture',
    'Sports',
    'Music',
    'Art',
    'Technology',
    'Animals'
  ];
}

export const CATEGORIES = [...getPlayableCategories(), 'Random'] as const;

export const CATEGORY_COLORS: Record<string, string> = {
  Science: '#22d3ee',
  History: '#f97316',
  Geography: '#84cc16',
  Literature: '#facc15',
  'Pop Culture': '#f472b6',
  Sports: '#34d399',
  Music: '#a78bfa',
  Art: '#fb7185',
  Technology: '#60a5fa',
  Animals: '#f59e0b',
  Random: '#f8fafc',
};

export function isPlayableCategory(category: string): boolean {
  return getPlayableCategories().includes(category);
}

export const getQuestionText = (question: TriviaQuestion): string =>
  question.presentation?.questionStyled || question.question;

export const getExplanationText = (question: TriviaQuestion): string =>
  question.presentation?.explanationStyled || question.explanation;

export const getHostLeadIn = (question: TriviaQuestion): string =>
  question.presentation?.hostLeadIn || "Here's the next one.";
