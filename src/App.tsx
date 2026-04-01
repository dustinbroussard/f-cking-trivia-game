import React, { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { signInWithGoogle, signInWithMagicLink, signOutUser } from './services/auth';
import {
  recordAnswer,
  subscribeToGame,
  createGame,
  joinGameById,
  getGameByCode,
  updateGame,
  getGameById,
  abandonGame as abandonGameService,
  updatePlayerActivity as updatePlayerActivityService,
  persistQuestionsToGame as persistQuestionsToGameService,
  setActiveGameQuestion as setActiveGameQuestionService,
  clearActiveGameQuestion as clearActiveGameQuestionService,
  getGameQuestions,
  subscribeToMessages,
  sendMessage,
} from './services/gameService';
import {
  acceptInvite,
  declineInvite,
  expireInvite,
  sendInvite,
  subscribeToIncomingInvites,
} from './services/inviteService';
import { ChatMessage, GameAnswer, GameInvite, GameState, MatchupSummary, Player, PlayerProfile, RecentCompletedGame, RecentPlayer, RoastState, TriviaQuestion, UserSettings, getExplanationText, getPlayableCategories, getWrongAnswerQuip } from './types';
import { getQuestionsForSession, markQuestionSeen } from './services/questionRepository';
import { GameLobby } from './components/GameLobby';
import { Wheel } from './components/Wheel';
import { QuestionCard } from './components/QuestionCard';
import { CategoryTracker } from './components/CategoryTracker';
import { ManualCategoryPrompt } from './components/ManualCategoryPrompt';
import { Roast } from './components/Roast';
import { TrashTalkOverlay } from './components/TrashTalkOverlay';
import { HeckleOverlay } from './components/HeckleOverlay';
import { ConfirmModal } from './components/ConfirmModal';
import { CategoryReveal } from './components/CategoryReveal';
import { EndgameOverlay } from './components/EndgameOverlay';
import { InstallPrompt } from './components/InstallPrompt';
import {
  HECKLE_PROLONGED_WAIT_MS,
  HECKLE_REQUEST_COOLDOWN_MS,
  shouldEnableHeckles,
  type RecentAiQuestionContext,
  type HeckleTriggerReason,
} from './content/heckles';
import { getFallbackEndgameMessage, type EndgameRoastResult } from './content/endgameRoast';
import { TrashTalkEvent, type TrashTalkGenerationContext } from './content/trashTalk';
import { publicAsset } from './assets';
import { motion, AnimatePresence } from 'motion/react';
import { LogOut, RefreshCcw, ArrowLeft, Volume2, VolumeX, Send, Loader2, X, Sun, Moon, SlidersHorizontal, Mail, Copy, Check } from 'lucide-react';
import confetti from 'canvas-confetti';
import { DEFAULT_USER_SETTINGS, getLocalSettings, loadUserSettings, mergeSettings, saveLocalSettings, saveUserSettings } from './services/userSettings';
import { generateEndgameRoast, generateHeckles, generateTrashTalk } from './services/gemini';
import { notifySafe, requestNotificationPermissionSafe } from './services/notify';
import { ensurePlayerProfile, loadMatchupHistory, MAX_NICKNAME_LENGTH, recordCompletedGame, recordQuestionStats, removePlayerAvatar, removeRecentPlayer, sanitizeNicknameInput, savePlayerAvatar, savePlayerNickname, subscribePlayerProfile, subscribeRecentCompletedGames, subscribeRecentPlayers, updateRecentPlayer } from './services/playerProfiles';
import { isSupabaseRlsInsertError } from './services/supabaseUtils';
import { isUuid } from './services/supabaseUtils';

// Hooks
import { useAuth } from './hooks/useAuth';
import { useGameStore } from './hooks/useGameStore';
import { useQuestions } from './hooks/useQuestions';
import { useSound } from './hooks/useSound';

const QUESTION_TIME_LIMIT_SECONDS = 30;
const logoSrc = publicAsset('logo.png');
const WELCOME_AUDIO_SOURCES = [
  publicAsset('welcome1.mp3'),
  publicAsset('welcome2.mp3'),
];
const THEME_CHROME = {
  dark: {
    appBg: '#09090b',
    colorScheme: 'dark',
    appleStatusBarStyle: 'black-translucent',
  },
  light: {
    appBg: '#f3eee6',
    colorScheme: 'light',
    appleStatusBarStyle: 'default',
  },
} as const;

type ResultPhase = 'idle' | 'revealing' | 'explaining' | 'specialEvent';
type QueuedSpecialEvent =
  | { kind: 'MANUAL_CATEGORY_UNLOCK' }
  | { kind: 'TRASH_TALK'; event: TrashTalkEvent; message: string };
type LoadingStep =
  | 'idle'
  | 'creating_match'
  | 'joining_match'
  | 'loading_questions'
  | 'finalizing_lobby'
  | 'finalizing_match'
  | 'finalizing_round';

interface PendingHeckleTrigger {
  reason: HeckleTriggerReason;
  dedupeKey: string;
  summary: string;
  requestedAt: number;
}

const SettingsModal = lazy(() => import('./components/SettingsModal').then((module) => ({ default: module.SettingsModal })));
const QuestionBankAdmin = lazy(() => import('./components/QuestionBankAdmin').then((module) => ({ default: module.QuestionBankAdmin })));

const WINNING_CHAT_TITLES = [
  'Shit-Talk Central',
  'Enter Taunts Here',
  'Victory Lap Hotline',
  'Front-Runner Remarks',
  'Cocky Comments Only',
  'Gloat Box',
];

const LOSING_CHAT_TITLES = [
  'Beg For Mercy?',
  'Explain Why You Suck Maybe',
  'Excuse Submission Form',
  'Damage Control Desk',
  'Sad Trombone Hotline',
  'Coping Strategies Chat',
];

const SIGN_IN_MARQUEE_LINES = [
  'Welcome to the game... do your friends know about your humiliation kink?',
  'Sign in. Bad decisions play better with witnesses.',
  'Google knows who you are. We just make it public.',
  'Come on in. The leaderboard needs fresh victims.',
  'This takes seconds. Regret lasts much longer.',
  'One tap and your group chat gets new material.',
  'Your trivia career is about to become a cautionary tale.',
  'Log in. Somebody has to finish in last place.',
  'Ready to test your knowledge and your tolerance for mockery?',
  'You bring the confidence. We will handle the collapse.',
  'Welcome to the game. Let’s explore your relationship with failure.',
  'Come on in. This is where confidence goes to get corrected.',
  'Don’t worry. Nobody remembers second place. Or third. Or you.',
];

const TYPEWRITER_TYPING_DELAY_MS = 62;

const HEADER_DISPLAY_NAME_LIMIT = 10;

function getRandomSignInMarqueeLine() {
  return SIGN_IN_MARQUEE_LINES[Math.floor(Math.random() * SIGN_IN_MARQUEE_LINES.length)] ?? SIGN_IN_MARQUEE_LINES[0];
}

function truncateHeaderDisplayName(value: string, maxLength = HEADER_DISPLAY_NAME_LIMIT) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return trimmed.slice(0, maxLength);
}

const ACTIVE_GAME_STORAGE_KEY = 'activeGameId';

interface ResumePromptState {
  game: GameState;
  isSolo: boolean;
}

interface MatchupHistoryState {
  opponentId: string;
  summary: MatchupSummary | null;
  games: RecentCompletedGame[];
}

function getRecentQuestionHistoryForPlayer(
  activeGame: GameState,
  sessionQuestions: TriviaQuestion[],
  playerId: string
): RecentAiQuestionContext[] {
  const questionById = new Map(sessionQuestions.map((question) => [question.id, question]));
  const questionOrder = activeGame.questionIds ?? Object.keys(activeGame.answers ?? {});

  return [...questionOrder]
    .reverse()
    .flatMap((questionId) => {
      const answer = activeGame.answers?.[questionId]?.[playerId];
      const question = questionById.get(questionId);

      if (!answer || !question) {
        return [];
      }

      const playerAnswer =
        answer.source === 'timeout' || answer.answerIndex < 0
          ? 'No answer before the timer expired'
          : question.choices[answer.answerIndex] ?? 'Unknown answer';

      const result: RecentAiQuestionContext['result'] =
        answer.source === 'timeout' || answer.answerIndex < 0
          ? 'timeout'
          : answer.isCorrect
            ? 'correct'
            : 'wrong';

      return [{
        question: question.question,
        category: question.category,
        difficulty: question.difficulty,
        playerAnswer,
        correctAnswer: question.choices[question.correctIndex] ?? 'Unknown answer',
        result,
        explanation: question.explanation,
      }];
    })
    .slice(0, 2);
}

export default function App() {
  const { user, hasResolvedInitialAuthState } = useAuth();
  const {
    game, setGame, players, setPlayers, messages, setMessages,
    playerProfile, setPlayerProfile, recentPlayers, recentCompletedGames, incomingInvites,
    hasResolvedProfile, profileError,
    recentPlayersStatus, recentPlayersError,
    recentGamesStatus, recentGamesError,
    invitesStatus, invitesError,
  } = useGameStore(user);
  const {
    questions, setQuestions, currentQuestion, setCurrentQuestion,
    isFetchingQuestions, setIsFetchingQuestions, fetchQuestions, markSeen, activeQuestionIdRef
  } = useQuestions(user, game?.id);

  if (import.meta.env.DEV) {
    console.debug('[App] Render state:', {
      user: user ? `User(id=${user.id})` : 'NULL',
      hasResolvedAuth: hasResolvedInitialAuthState,
      hasProfile: !!playerProfile,
      hasResolvedProfile: hasResolvedProfile
    });
  }

  const [settings, setSettings] = useState<UserSettings>(() => getLocalSettings());
  const [welcomeAudioSrc, setWelcomeAudioSrc] = useState(() => WELCOME_AUDIO_SOURCES[0]);
  const {
    themeAudioRef, correctAudioRef, wrongAudioRef, timesUpAudioRef,
    wonAudioRef, lostAudioRef, welcomeAudioRef, newGameAudioRef, heckleChimeAudioRef,
    themeAudioSrc, correctAudioSrc, wrongAudioSrc, timesUpAudioSrc,
    wonAudioSrc, lostAudioSrc, newGameAudioSrc, heckleChimeAudioSrc,
    audioNeedsInteraction, playSfx, playMusic, tryPlay, syncAudioState, enableAudioFromGesture, setAudioNeedsInteraction
  } = useSound(settings);

  const [isSpinning, setIsSpinning] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [roast, setRoast] = useState<RoastState | null>(null);
  const [resultPhase, setResultPhase] = useState<ResultPhase>('idle');
  const [queuedSpecialEvent, setQueuedSpecialEvent] = useState<QueuedSpecialEvent | null>(null);

  // Granular loading states
  const [hasResolvedRedirectSignIn, setHasResolvedRedirectSignIn] = useState(true);
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [isJoiningGame, setIsJoiningGame] = useState(false);
  const [loadingStep, setLoadingStep] = useState<LoadingStep>('idle');
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [isSolo, setIsSolo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showQuestionBankAdmin, setShowQuestionBankAdmin] = useState(false);
  const [remoteSettingsResolved, setRemoteSettingsResolved] = useState(false);
  const [remoteSettingsError, setRemoteSettingsError] = useState<string | null>(null);
  const [isEnsuringProfile, setIsEnsuringProfile] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const [seenIncomingMessageCount, setSeenIncomingMessageCount] = useState(0);
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authLoadingMode, setAuthLoadingMode] = useState<'magic-link' | 'google' | null>(null);
  const [isMagicLinkSent, setIsMagicLinkSent] = useState(false);
  const [showEmailSignIn, setShowEmailSignIn] = useState(false);
  const [activeSignInMarqueeLine, setActiveSignInMarqueeLine] = useState(() => getRandomSignInMarqueeLine());
  const [renderedSignInMarqueeLine, setRenderedSignInMarqueeLine] = useState('');
  const [nickname, setNickname] = useState('');
  const [isSavingNickname, setIsSavingNickname] = useState(false);
  const [isEditingNickname, setIsEditingNickname] = useState(false);

  const [selectedMatchup, setSelectedMatchup] = useState<MatchupHistoryState | null>(null);
  const [isLoadingMatchup, setIsLoadingMatchup] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [correctAnswer, setCorrectAnswer] = useState<number | null>(null);
  const [revealedCategory, setRevealedCategory] = useState<string | null>(null);
  const [questionClockNow, setQuestionClockNow] = useState(() => Date.now());
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState(false);
  const [manualPickReady, setManualPickReady] = useState(false);
  const [showManualPickPrompt, setShowManualPickPrompt] = useState(false);
  const [manualPickSource, setManualPickSource] = useState<'streak' | 'wheel'>('streak');
  const [activeTrashTalk, setActiveTrashTalk] = useState<string | null>(null);
  const [activeTrashTalkEvent, setActiveTrashTalkEvent] = useState<TrashTalkEvent | null>(null);
  const [lastTrashTalkEvent, setLastTrashTalkEvent] = useState<TrashTalkEvent | null>(null);
  const [activeHeckle, setActiveHeckle] = useState<string | null>(null);
  const [showHeckle, setShowHeckle] = useState(false);
  const [heckleQueue, setHeckleQueue] = useState<string[]>([]);
  const [pendingHeckleTrigger, setPendingHeckleTrigger] = useState<PendingHeckleTrigger | null>(null);
  const [confirmAction, setConfirmAction] = useState<'quit' | 'signout' | null>(null);
  const [endgameRoast, setEndgameRoast] = useState<EndgameRoastResult | null>(null);
  const [isGeneratingEndgameRoast, setIsGeneratingEndgameRoast] = useState(false);

  useEffect(() => {
    if (isMagicLinkSent) {
      return undefined;
    }

    const currentLine = activeSignInMarqueeLine;
    if (renderedSignInMarqueeLine.length >= currentLine.length) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setRenderedSignInMarqueeLine(currentLine.slice(0, renderedSignInMarqueeLine.length + 1));
    }, TYPEWRITER_TYPING_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [activeSignInMarqueeLine, isMagicLinkSent, renderedSignInMarqueeLine]);
  const [shouldBlurQuestionBackground, setShouldBlurQuestionBackground] = useState(false);
  const [resumePrompt, setResumePrompt] = useState<ResumePromptState | null>(null);
  const [isCheckingForResume, setIsCheckingForResume] = useState(false);
  const [resumeBanner, setResumeBanner] = useState<string | null>(null);
  const [matchIdCopied, setMatchIdCopied] = useState(false);

  const prevGameStatus = useRef<string | null>(null);
  const prevGameIdRef = useRef<string | null>(null);
  const revealTimeoutRef = useRef<number | null>(null);
  const categoryRevealTimeoutRef = useRef<number | null>(null);
  const questionTimeoutRef = useRef<number | null>(null);
  const questionDisplayTimerRef = useRef<number | null>(null);
  const questionDeadlineRef = useRef<number | null>(null);
  const questionResolvedRef = useRef(false);
  const resolvedQuestionIdRef = useRef<string | null>(null);
  const heckleTimer = useRef<number | null>(null);
  const prolongedWaitTimerRef = useRef<number | null>(null);
  const prevPlayersRef = useRef<Player[]>([]);
  const hasWarnedBehindRef = useRef(false);
  const hasTriggeredMatchLossRef = useRef(false);
  const lastSavedRemoteSettingsRef = useRef<string>('');
  const recordedRecentPairKeysRef = useRef<Set<string>>(new Set());
  const lastTurnNotificationKeyRef = useRef<string>('');
  const lastFailureRef = useRef<string>('No recent embarrassment recorded.');
  const recentAiQuestionHistoryRef = useRef<RecentAiQuestionContext[]>([]);
  const lastHeckleWaitStateKeyRef = useRef<string>('');
  const heckleRequestIdRef = useRef(0);
  const heckleRequestInFlightRef = useRef<null | { requestId: number; waitStateKey: string }>(null);
  const lastHeckleRequestAtRef = useRef(0);
  const currentWaitingStateKeyRef = useRef<string | null>(null);
  const waitingStateEnteredAtRef = useRef<number | null>(null);
  const lastHeckleEligibilityLogRef = useRef<string>('');
  const endgameRoastRequestKeyRef = useRef<string>('');
  const latestHeckleEligibilityRef = useRef<{ allowed: boolean; reason: string }>({
    allowed: false,
    reason: 'uninitialized',
  });
  const previousUserIdRef = useRef<string | null>(null);
  const restoredQuestionStartedAtRef = useRef<number | null>(null);
  const pendingResumeRestoreRef = useRef<string | null>(null);
  const persistenceWarningShownRef = useRef(false);
  const resumeCheckRequestIdRef = useRef(0);
  const resumeCheckInFlightGameIdRef = useRef<string | null>(null);
  const resumeCheckDepsRef = useRef<{
    userId: string | null;
    gameId: string | null;
    resumePromptGameId: string | null;
    isCheckingForResume: boolean;
  } | null>(null);

  const existingQuestionIds = questions.map((question) => question.id);
  const playableCategories = getPlayableCategories();
  const themeMode = settings.themeMode;
  const musicEnabled = settings.soundEnabled && settings.musicEnabled;
  const sfxEnabled = settings.soundEnabled && settings.sfxEnabled;
  const isQuestionActive =
    !!currentQuestion &&
    (resultPhase === 'idle' || resultPhase === 'revealing' || resultPhase === 'explaining');
  const isInitializing = !hasResolvedInitialAuthState;

  const reportServiceFailure = (
    err: unknown,
    path: string | null,
    fallbackMessage: string,
  ) => {
    console.error(`[Service Failure] at ${path}:`, err);
    setError(fallbackMessage);
  };

  const getFriendlyGameCreateError = (err: any) => {
    if (isSupabaseRlsInsertError(err)) {
      return 'Game creation is blocked by database permissions right now.';
    }

    return 'Failed to start game.';
  };

  const navigateToJoinedGame = (joinedGame: GameState, source: 'joinGame' | 'joinWaitingGameById') => {
    console.info('[joinFlow] Navigating to game screen', {
      source,
      targetView: 'game-view',
      gameId: joinedGame.id,
      status: joinedGame.status,
      playerIds: joinedGame.playerIds,
      playerCount: joinedGame.playerIds.length,
    });
    setIsSolo(joinedGame.playerIds.length === 1);
    setPlayers(joinedGame.players || []);
    setGame(joinedGame);
  };

  const playNewGameCue = useCallback(async () => {
    if (!settings.soundEnabled || !settings.musicEnabled || !newGameAudioRef.current) {
      return;
    }

    if (themeAudioRef.current) {
      themeAudioRef.current.pause();
    }
    if (welcomeAudioRef.current) {
      welcomeAudioRef.current.pause();
    }

    const newGameAudio = newGameAudioRef.current;
    newGameAudio.onended = null;
    newGameAudio.currentTime = 0;

    const played = await tryPlay(newGameAudioRef, true);
    if (!played) {
      return;
    }

    newGameAudio.onended = () => {
      newGameAudio.onended = null;
      if (!themeAudioRef.current || !settings.soundEnabled || !settings.musicEnabled) {
        return;
      }
      themeAudioRef.current.currentTime = 0;
      void tryPlay(themeAudioRef);
    };
  }, [settings.soundEnabled, settings.musicEnabled, newGameAudioRef, themeAudioRef, welcomeAudioRef, tryPlay]);

  const playRandomWelcomeCue = useCallback(async () => {
    if (!settings.soundEnabled || !settings.musicEnabled || !welcomeAudioRef.current) {
      return;
    }

    const selectedSrc = WELCOME_AUDIO_SOURCES[Math.floor(Math.random() * WELCOME_AUDIO_SOURCES.length)];
    setWelcomeAudioSrc(selectedSrc);

    if (themeAudioRef.current) {
      themeAudioRef.current.pause();
    }

    const welcomeAudio = welcomeAudioRef.current;
    welcomeAudio.onended = null;
    welcomeAudio.pause();
    welcomeAudio.src = selectedSrc;
    welcomeAudio.load();
    welcomeAudio.currentTime = 0;

    const played = await tryPlay(welcomeAudioRef, true);
    if (!played) {
      if (themeAudioRef.current) {
        themeAudioRef.current.currentTime = 0;
        void tryPlay(themeAudioRef);
      }
      return;
    }

    welcomeAudio.onended = () => {
      welcomeAudio.onended = null;
      if (!themeAudioRef.current || !settings.soundEnabled || !settings.musicEnabled) {
        return;
      }
      themeAudioRef.current.currentTime = 0;
      void tryPlay(themeAudioRef);
    };
  }, [settings.soundEnabled, settings.musicEnabled, themeAudioRef, tryPlay, welcomeAudioRef]);

  const updateSettings = useCallback((patch: Partial<UserSettings>) => {
    setSettings((current) => ({
      ...current,
      ...patch,
      updatedAt: Date.now(),
    }));
  }, []);

  const applySettingsPatch = useCallback(async (
    patch: Partial<UserSettings>,
    options?: { unlockAudio?: boolean }
  ) => {
    const nextSettings: UserSettings = {
      ...settings,
      ...patch,
      updatedAt: Date.now(),
    };

    setSettings(nextSettings);
    syncAudioState(nextSettings);

    if (patch.soundEnabled === false) {
      setAudioNeedsInteraction(false);
      return;
    }

    if (options?.unlockAudio && nextSettings.soundEnabled) {
      const played = await enableAudioFromGesture(nextSettings);
      if (!played && nextSettings.musicEnabled) {
        setAudioNeedsInteraction(true);
      }
    }
  }, [enableAudioFromGesture, settings, setAudioNeedsInteraction, syncAudioState]);

  const handleEnableSound = useCallback(async () => {
    await applySettingsPatch({ soundEnabled: true }, { unlockAudio: true });
  }, [applySettingsPatch]);

  const getLoadingCopy = (step: LoadingStep) => {
    switch (step) {
      case 'creating_match':
        return {
          title: 'Creating match',
          flow: 'Creating match -> Loading questions -> Finalizing lobby',
        };
      case 'joining_match':
        return {
          title: 'Joining lobby',
          flow: 'Joining lobby -> Finalizing lobby',
        };
      case 'loading_questions':
        return {
          title: 'Loading questions',
          flow: 'Creating match -> Loading questions -> Finalizing lobby',
        };
      case 'finalizing_lobby':
        return {
          title: 'Finalizing lobby',
          flow: 'Creating match -> Loading questions -> Finalizing lobby',
        };
      case 'finalizing_match':
        return {
          title: 'Finalizing match',
          flow: 'Resetting match -> Loading questions -> Finalizing match',
        };
      case 'finalizing_round':
        return {
          title: 'Finalizing round',
          flow: 'Loading questions -> Finalizing round',
        };
      default:
        return {
          title: 'Working',
          flow: 'Working',
        };
    }
  };

  const requestTurnNotificationPermission = async () => {
    await requestNotificationPermissionSafe();
  };

  const openQuitConfirm = () => setConfirmAction('quit');
  const openSignOutConfirm = () => setConfirmAction('signout');
  const closeConfirm = () => setConfirmAction(null);

  const persistActiveGameId = (gameId: string | null) => {
    if (typeof window === 'undefined') return;

    if (gameId && isUuid(gameId)) {
      window.localStorage.setItem(ACTIVE_GAME_STORAGE_KEY, gameId);
      return;
    }

    window.localStorage.removeItem(ACTIVE_GAME_STORAGE_KEY);
  };

  const getStoredActiveGameId = () => {
    if (typeof window === 'undefined') return null;
    const stored = window.localStorage.getItem(ACTIVE_GAME_STORAGE_KEY);
    if (!stored || !isUuid(stored)) {
      window.localStorage.removeItem(ACTIVE_GAME_STORAGE_KEY);
      return null;
    }
    return stored;
  };

  const updatePlayerActivity = async (gameId: string, playerUid: string, isResume = false) => {
    try {
      await updatePlayerActivityService(gameId, playerUid, isResume);
    } catch (err) {
      console.error(`[updatePlayerActivity] Failed for game ${gameId}:`, err);
    }
  };

  const abandonGame = async (gameId: string) => {
    try {
      await abandonGameService(gameId);
      persistActiveGameId(null);
    } catch (err) {
      console.error(`[abandonGame] Failed to abandon game ${gameId}:`, err);
      setError('Failed to abandon game.');
    }
  };

  const clearResumePrompt = () => {
    setResumePrompt(null);
    setResumeCheckLoading(false, 'clearResumePrompt');
  };

  const setResumeCheckLoading = (nextValue: boolean, reason: string, extra: Record<string, unknown> = {}) => {
    console.info('[resumeCheck] Loading flag update', {
      nextValue,
      reason,
      ...extra,
    });
    setIsCheckingForResume(nextValue);
  };

  const handleConfirmedQuit = () => {
    closeConfirm();
    resetGame();
  };

  const handleConfirmedSignOut = async () => {
    closeConfirm();
    persistActiveGameId(null);
    resetGame();
    await signOutUser();
  };


  const recordRecentPlayer = async (ownerUid: string, player: Player, gameId: string) => {
    try {
      await updateRecentPlayer(ownerUid, player.uid, {
        nickname: player.name,
        avatar_url: player.avatarUrl || null,
        last_played_at: new Date().toISOString(),
        last_game_id: gameId,
        hidden: false,
      });
    } catch (err) {
      console.error(`[recordRecentPlayer] Failed to record recent player ${player.uid}:`, err);
    }
  };

  const joinWaitingGameById = async (gameId: string, _avatarUrl: string) => {
    if (!user) return false;

    console.info('[joinWaitingGameById] Submitted match ID', {
      submittedMatchId: gameId,
      userId: user.id,
      feature: 'invite-accept',
    });

    try {
      const gameData = await getGameById(gameId);
      console.info('[joinWaitingGameById] Lookup result', {
        submittedMatchId: gameId,
        found: !!gameData,
        foundGameId: gameData?.id ?? null,
        status: gameData?.status ?? null,
        playerIds: gameData?.playerIds ?? [],
      });

      if (!gameData) {
        console.warn('[joinWaitingGameById] Early return: no game found for match ID', {
          submittedMatchId: gameId,
        });
        setError('Invite expired. That match no longer exists.');
        return false;
      }

      if (gameData.status !== 'waiting') {
        console.warn('[joinWaitingGameById] Early return: game filtered by status', {
          submittedMatchId: gameId,
          foundGameId: gameData.id,
          status: gameData.status,
        });
        setError('Invite expired. That match already started.');
        return false;
      }

      if (gameData.playerIds.length >= 2 && !gameData.playerIds.includes(user.id)) {
        console.warn('[joinWaitingGameById] Early return: game already full', {
          submittedMatchId: gameId,
          foundGameId: gameData.id,
          playerIds: gameData.playerIds,
        });
        setError('Invite expired. That match is already full.');
        return false;
      }

      const isNewJoiner = !gameData.playerIds.includes(user.id);
      let joinedGame = gameData;

      if (isNewJoiner) {
        joinedGame = await joinGameById(gameId, user.id, playerProfile?.nickname || user.email || 'Player', _avatarUrl);
        console.info('[joinWaitingGameById] Joining player update result', {
          submittedMatchId: gameId,
          foundGameId: joinedGame?.id ?? gameData.id,
          updateSucceeded: !!joinedGame,
        });
      } else {
        console.info('[joinWaitingGameById] Player already present in game', {
          submittedMatchId: gameId,
          foundGameId: gameData.id,
          userId: user.id,
        });
      }

      if (!joinedGame) {
        console.warn('[joinWaitingGameById] Early return: join update did not return a refreshed game', {
          submittedMatchId: gameId,
          foundGameId: gameData.id,
        });
        setError('Failed to join game.');
        return false;
      }

      setLoadingStep('finalizing_lobby');
      navigateToJoinedGame(joinedGame, 'joinWaitingGameById');
      return true;
    } catch (err) {
      console.error(`[joinWaitingGameById] Failed to join game ${gameId}:`, err);
      setError('Failed to join game.');
      return false;
    }
  };

  const persistQuestionsToGame = async (gameId: string, sessionQuestions: TriviaQuestion[]) => {
    try {
      const questionIds = sessionQuestions.map(q => q.id);
      await persistQuestionsToGameService(gameId, questionIds);
    } catch (err) {
      console.error(`[persistQuestionsToGame] Failed for game ${gameId}:`, err);
    }
  };

  const syncGameQuestionIds = async (gameId: string, questionIds: string[]) => {
    try {
      await updateGame(gameId, { question_ids: questionIds });
    } catch (err) {
      console.error(`[syncGameQuestionIds] Failed for game ${gameId}:`, err);
    }
  };

  const setActiveGameQuestion = async (gameId: string, category: string, questionId: string, questionIndex: number, startedAt: number) => {
    try {
      await setActiveGameQuestionService(gameId, category, questionId, questionIndex, startedAt);
    } catch (err) {
      console.error(`[setActiveGameQuestion] Failed for game ${gameId}:`, err);
    }
  };

  const clearActiveGameQuestion = async (gameId: string) => {
    try {
      await clearActiveGameQuestionService(gameId);
    } catch (err) {
      console.error(`[clearActiveGameQuestion] Failed for game ${gameId}:`, err);
    }
  };

  const recordGameAnswer = async (gameId: string, questionId: string, playerUid: string, answer: GameAnswer) => {
    try {
      await recordAnswer(gameId, questionId, playerUid, answer);
    } catch (err) {
      console.error(`[recordGameAnswer] Failed for game ${gameId}:`, err);
    }
  };

  const specialEventPriority = (event: QueuedSpecialEvent) => {
    if (event.kind === 'MANUAL_CATEGORY_UNLOCK') return 3;
    if (event.event === 'MATCH_LOSS') return 4;
    if (event.event === 'OPPONENT_TROPHY') return 2;
    return 1;
  };

  const queueSpecialEvent = (event: QueuedSpecialEvent) => {
    setQueuedSpecialEvent((current) => {
      if (!current || specialEventPriority(event) > specialEventPriority(current)) {
        return event;
      }
      return current;
    });
  };

  const showSpecialEvent = (event: QueuedSpecialEvent) => {
    if (event.kind === 'MANUAL_CATEGORY_UNLOCK') {
      setShowManualPickPrompt(true);
      setResultPhase('specialEvent');
      return;
    }

    if (event.event === 'MATCH_LOSS' && lostAudioRef.current) {
      lostAudioRef.current.currentTime = 0;
      void tryPlay(lostAudioRef, true);
    }

    setActiveTrashTalk(event.message);
    setActiveTrashTalkEvent(event.event);
    setLastTrashTalkEvent(event.event);
    setResultPhase('specialEvent');
  };

  const queueOrShowSpecialEvent = (event: QueuedSpecialEvent) => {
    const isBusy = resultPhase === 'revealing' || resultPhase === 'explaining' || showManualPickPrompt || !!roast;
    if (isBusy) {
      queueSpecialEvent(event);
      return;
    }

    showSpecialEvent(event);
  };

  const clearHeckles = () => {
    if (heckleTimer.current) {
      window.clearTimeout(heckleTimer.current);
      heckleTimer.current = null;
    }

    if (prolongedWaitTimerRef.current) {
      window.clearTimeout(prolongedWaitTimerRef.current);
      prolongedWaitTimerRef.current = null;
    }

    setActiveHeckle(null);
    setShowHeckle(false);
    setHeckleQueue([]);
  };

  const dismissHeckleOverlay = () => {
    if (heckleTimer.current) {
      window.clearTimeout(heckleTimer.current);
      heckleTimer.current = null;
    }

    setShowHeckle(false);
    setActiveHeckle(null);
  };

  const dismissTrashTalkOverlay = () => {
    setActiveTrashTalk(null);
    setActiveTrashTalkEvent(null);
    if (!showManualPickPrompt) {
      setResultPhase('idle');
    }
  };

  const getHeckleTriggerPriority = (reason: HeckleTriggerReason) => {
    if (reason === 'wrong_answer' || reason === 'round_loss') return 3;
    if (reason === 'score_deficit') return 2;
    return 1;
  };

  const queueHeckleTrigger = (reason: HeckleTriggerReason, dedupeKey: string, summary: string) => {
    const nextTrigger: PendingHeckleTrigger = {
      reason,
      dedupeKey,
      summary,
      requestedAt: Date.now(),
    };

    setPendingHeckleTrigger((current) => {
      if (current?.dedupeKey === dedupeKey) {
        console.info('[heckles] Trigger skipped: duplicate event key', nextTrigger);
        return current;
      }

      if (!current || getHeckleTriggerPriority(reason) >= getHeckleTriggerPriority(current.reason)) {
        console.info('[heckles] Trigger queued', {
          nextTrigger,
          replacedTrigger: current,
        });
        return nextTrigger;
      }

      console.info('[heckles] Trigger skipped: lower priority than pending trigger', {
        nextTrigger,
        pendingTrigger: current,
      });
      return current;
    });
  };

  const clearQuestionTimer = () => {
    if (questionTimeoutRef.current) {
      window.clearTimeout(questionTimeoutRef.current);
      questionTimeoutRef.current = null;
    }

    if (questionDisplayTimerRef.current) {
      window.clearTimeout(questionDisplayTimerRef.current);
      questionDisplayTimerRef.current = null;
    }
  };

  const resetQuestionResolutionState = () => {
    activeQuestionIdRef.current = null;
    questionDeadlineRef.current = null;
    questionResolvedRef.current = false;
    resolvedQuestionIdRef.current = null;
  };

  const triggerTrashTalk = async (event: TrashTalkEvent, contextOverrides: Partial<TrashTalkGenerationContext> = {}) => {
    if (!settings.commentaryEnabled) {
      if (event === 'MATCH_LOSS' && lostAudioRef.current) {
        lostAudioRef.current.currentTime = 0;
        void tryPlay(lostAudioRef, true);
      }
      return;
    }

    const currentPlayer = contextOverrides.playerName
      ? null
      : players.find((player) => player.uid === user?.id) || null;
    const opponentPlayer = contextOverrides.opponentName
      ? null
      : players.find((player) => player.uid !== user?.id) || null;

    const context: TrashTalkGenerationContext = {
      event,
      playerName: contextOverrides.playerName || currentPlayer?.name || playerProfile?.nickname || user?.email || 'Player',
      opponentName: contextOverrides.opponentName || opponentPlayer?.name || 'Opponent',
      playerScore: contextOverrides.playerScore ?? currentPlayer?.score ?? 0,
      opponentScore: contextOverrides.opponentScore ?? opponentPlayer?.score ?? 0,
      scoreDelta: contextOverrides.scoreDelta ?? ((opponentPlayer?.score ?? 0) - (currentPlayer?.score ?? 0)),
      playerTrophies: contextOverrides.playerTrophies ?? (currentPlayer?.completedCategories?.length ?? 0),
      opponentTrophies: contextOverrides.opponentTrophies ?? (opponentPlayer?.completedCategories?.length ?? 0),
      latestCategory: contextOverrides.latestCategory,
      outcomeSummary: contextOverrides.outcomeSummary || `${event} triggered during live play.`,
      recentQuestionHistory: recentAiQuestionHistoryRef.current,
      isSolo,
    };

    const generatedMessage = await Promise.race<string | null>([
      generateTrashTalk(context),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 5000)),
    ]);

    if (!generatedMessage) {
      return;
    }

    queueOrShowSpecialEvent({
      kind: 'TRASH_TALK',
      event,
      message: generatedMessage,
    });
  };

  const clearCurrentTurnView = () => {
    if (revealTimeoutRef.current) {
      window.clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = null;
    }

    if (categoryRevealTimeoutRef.current) {
      window.clearTimeout(categoryRevealTimeoutRef.current);
      categoryRevealTimeoutRef.current = null;
    }

    clearQuestionTimer();
    resetQuestionResolutionState();

    setRoast(null);
    setRevealedCategory(null);
    setCurrentQuestion(null);
    setSelectedCategory(null);
    setSelectedAnswer(null);
    setCorrectAnswer(null);
    setShouldBlurQuestionBackground(false);
    setQuestionClockNow(Date.now());
  };

  const getRemainingQuestionMs = (deadline: number | null, now = Date.now()) => {
    if (!deadline) return 0;
    return Math.max(0, deadline - now);
  };

  const getQuestionTimeRemaining = (deadline: number | null, now = Date.now()) => {
    if (!deadline) return QUESTION_TIME_LIMIT_SECONDS;
    return Math.ceil(getRemainingQuestionMs(deadline, now) / 1000);
  };

  const getQuestionTimerProgress = (deadline: number | null, now = Date.now()) => {
    return getRemainingQuestionMs(deadline, now) / (QUESTION_TIME_LIMIT_SECONDS * 1000);
  };

  const questionTimeRemaining = currentQuestion
    ? getQuestionTimeRemaining(questionDeadlineRef.current, questionClockNow)
    : QUESTION_TIME_LIMIT_SECONDS;
  const questionTimerProgress = currentQuestion
    ? getQuestionTimerProgress(questionDeadlineRef.current, questionClockNow)
    : 1;

  useEffect(() => {
    if (!currentQuestion) {
      resetQuestionResolutionState();
      return;
    }

    activeQuestionIdRef.current = currentQuestion.id;
    const questionStartedAt = restoredQuestionStartedAtRef.current ?? Date.now();
    restoredQuestionStartedAtRef.current = null;
    questionDeadlineRef.current = questionStartedAt + (QUESTION_TIME_LIMIT_SECONDS * 1000);
    questionResolvedRef.current = false;
    resolvedQuestionIdRef.current = null;
    setQuestionClockNow(Date.now());
  }, [currentQuestion?.id]);

  useEffect(() => {
    if (!currentQuestion || !user?.id) return;

    markSeen(currentQuestion.id);
  }, [currentQuestion?.id, user?.id, game?.id]);

  const shouldShowCurrentTurnStage = !!game && game.status === 'active' && (
    game.currentTurn === user?.id ||
    !!currentQuestion ||
    !!revealedCategory ||
    resultPhase === 'revealing' ||
    resultPhase === 'explaining' ||
    !!roast
  );

  const isHighPriorityOverlayActive =
    resultPhase !== 'idle' ||
    !!roast ||
    !!activeTrashTalk ||
    !!activeTrashTalkEvent ||
    showManualPickPrompt ||
    game?.status === 'completed';

  const currentPlayer = players.find((player) => player.uid === user?.id);
  const opponentPlayer = players.find((player) => player.uid !== user?.id);
  const isCompletedMatch = game?.status === 'completed';
  const completedMatchWinner = isCompletedMatch
    ? players.find((player) => player.uid === game.winnerId) ?? null
    : null;
  const completedMatchLoser = isCompletedMatch
    ? players.find((player) => player.uid !== game.winnerId) ?? null
    : null;
  const isViewingWinningEndgame = !!user?.id && game?.winnerId === user.id;
  const trophyTarget = playableCategories.length;
  const endgameViewerMessage = completedMatchWinner && completedMatchLoser
    ? (
      isViewingWinningEndgame
        ? endgameRoast?.winnerCompliment
        : endgameRoast?.loserRoast
    ) || getFallbackEndgameMessage({
      winnerName: completedMatchWinner.name || 'Winner',
      loserName: completedMatchLoser.name || 'Loser',
    }, isViewingWinningEndgame)
    : '';
  const currentPlayerScore = currentPlayer?.score || 0;
  const opponentPlayerScore = opponentPlayer?.score || 0;
  const scoreDelta = currentPlayerScore - opponentPlayerScore;
  const isBlockingHeckleModalOpen =
    !!confirmAction ||
    showSettings ||
    !!resumePrompt ||
    isMobileChatOpen;
  const isWaitingForOpponent =
    shouldEnableHeckles(isSolo) &&
    settings.commentaryEnabled &&
    !!game &&
    !!user &&
    game.status === 'active' &&
    players.length > 1 &&
    game.currentTurn !== user.id &&
    !currentQuestion &&
    !revealedCategory;
  const heckleWaitStateKey =
    isWaitingForOpponent && game && user
      ? `${game.id}:${game.status}:${game.currentTurn}:${user.id}:${currentPlayerScore}:${opponentPlayerScore}`
      : null;
  const heckleEligibility = (() => {
    if (!settings.commentaryEnabled) {
      return { allowed: false, reason: 'commentary_disabled' };
    }
    if (isSolo) {
      return { allowed: false, reason: 'solo_mode' };
    }
    if (!game || !user) {
      return { allowed: false, reason: 'missing_game_or_user' };
    }
    if (game.status !== 'active') {
      return { allowed: false, reason: `game_status_${game.status}` };
    }
    if (players.length < 2) {
      return { allowed: false, reason: 'not_multiplayer' };
    }
    if (game.currentTurn === user.id) {
      return { allowed: false, reason: 'current_player_can_act' };
    }
    if (currentQuestion) {
      return { allowed: false, reason: 'question_input_expected' };
    }
    if (revealedCategory) {
      return { allowed: false, reason: 'category_reveal_active' };
    }
    if (isHighPriorityOverlayActive) {
      return { allowed: false, reason: 'critical_transition_active' };
    }
    if (isBlockingHeckleModalOpen) {
      return { allowed: false, reason: 'modal_or_sheet_open' };
    }
    if (!currentPlayer || !opponentPlayer) {
      return { allowed: false, reason: 'missing_player_context' };
    }
    return { allowed: true, reason: 'eligible_waiting_state' };
  })();
  const shouldShowOpponentHeckles = heckleEligibility.allowed;

  const showCategoryReveal = (category: string, question: TriviaQuestion, questionIndex: number) => {
    if (categoryRevealTimeoutRef.current) {
      window.clearTimeout(categoryRevealTimeoutRef.current);
    }

    setSelectedCategory(category);
    setRevealedCategory(category);
    setCurrentQuestion(null);

    categoryRevealTimeoutRef.current = window.setTimeout(() => {
      setRevealedCategory(null);
      const questionStartedAt = Date.now();
      restoredQuestionStartedAtRef.current = questionStartedAt;
      setCurrentQuestion(question);
      setQuestionClockNow(questionStartedAt);
      categoryRevealTimeoutRef.current = null;
      if (game?.id) {
        void setActiveGameQuestion(game.id, category, question.id, questionIndex, questionStartedAt).catch((err) => {
          console.error(err);
        });
      }
    }, 1100);
  };

  useEffect(() => {
    if (!currentQuestion || selectedAnswer !== null || resultPhase !== 'idle') {
      clearQuestionTimer();
      setQuestionClockNow(Date.now());
      return;
    }

    const questionId = currentQuestion.id;
    const deadline = questionDeadlineRef.current;
    setQuestionClockNow(Date.now());

    const updateDisplayClock = () => {
      if (activeQuestionIdRef.current !== questionId || questionResolvedRef.current) {
        return;
      }

      const now = Date.now();
      setQuestionClockNow(now);

      if (getRemainingQuestionMs(deadline, now) <= 0) {
        return;
      }

      questionDisplayTimerRef.current = window.setTimeout(updateDisplayClock, 100);
    };

    const resolveTimeout = () => {
      if (activeQuestionIdRef.current !== questionId || questionResolvedRef.current) {
        return;
      }

      setQuestionClockNow(Date.now());
      void handleAnswer(-1, {
        source: 'timeout',
        questionId,
        submittedAt: deadline ?? Date.now(),
      });
    };

    updateDisplayClock();
    questionTimeoutRef.current = window.setTimeout(
      resolveTimeout,
      Math.max(0, getRemainingQuestionMs(deadline))
    );

    return () => {
      clearQuestionTimer();
    };
  }, [currentQuestion, selectedAnswer, resultPhase]);

  useEffect(() => {
    latestHeckleEligibilityRef.current = {
      allowed: heckleEligibility.allowed,
      reason: heckleEligibility.reason,
    };

    const logSignature = JSON.stringify({
      allowed: heckleEligibility.allowed,
      reason: heckleEligibility.reason,
      waitStateKey: heckleWaitStateKey,
      pendingTrigger: pendingHeckleTrigger?.reason ?? null,
      hasQueue: heckleQueue.length > 0,
      activeHeckle: !!activeHeckle,
    });

    if (lastHeckleEligibilityLogRef.current === logSignature) return;
    lastHeckleEligibilityLogRef.current = logSignature;

    console.info('[heckles] Eligibility evaluated', {
      allowed: heckleEligibility.allowed,
      reason: heckleEligibility.reason,
      waitStateKey: heckleWaitStateKey,
      trigger: pendingHeckleTrigger?.reason ?? null,
      multiplayerActive: !isSolo,
      waitingForOpponent: isWaitingForOpponent,
      currentTurn: game?.currentTurn ?? null,
      userId: user?.id ?? null,
      currentQuestionId: currentQuestion?.id ?? null,
      resultPhase,
      roastVisible: !!roast,
      activeTrashTalkEvent,
      confirmAction,
      showSettings,
      isMobileChatOpen,
      requestInFlight: !!heckleRequestInFlightRef.current,
      existingHeckleShown: !!activeHeckle,
      queuedHeckles: heckleQueue.length,
    });
  }, [
    heckleEligibility.allowed,
    heckleEligibility.reason,
    heckleWaitStateKey,
    pendingHeckleTrigger?.reason,
    heckleQueue.length,
    activeHeckle,
    isSolo,
    isWaitingForOpponent,
    game?.currentTurn,
    user?.id,
    currentQuestion?.id,
    resultPhase,
    roast,
    activeTrashTalkEvent,
    confirmAction,
    showSettings,
    isMobileChatOpen,
  ]);

  useEffect(() => {
    if (currentWaitingStateKeyRef.current !== heckleWaitStateKey) {
      currentWaitingStateKeyRef.current = heckleWaitStateKey;
      waitingStateEnteredAtRef.current = heckleWaitStateKey ? Date.now() : null;
    }

    if (shouldShowOpponentHeckles) return;
    heckleRequestIdRef.current += 1;
    heckleRequestInFlightRef.current = null;
    clearHeckles();
  }, [shouldShowOpponentHeckles]);

  useEffect(() => {
    if (prolongedWaitTimerRef.current) {
      window.clearTimeout(prolongedWaitTimerRef.current);
      prolongedWaitTimerRef.current = null;
    }

    if (!heckleWaitStateKey || !shouldShowOpponentHeckles || lastHeckleWaitStateKeyRef.current === heckleWaitStateKey) {
      return;
    }

    prolongedWaitTimerRef.current = window.setTimeout(() => {
      const waitingMs = waitingStateEnteredAtRef.current
        ? Date.now() - waitingStateEnteredAtRef.current
        : HECKLE_PROLONGED_WAIT_MS;
      queueHeckleTrigger(
        'prolonged_wait',
        `${heckleWaitStateKey}:prolonged_wait`,
        `Player has been waiting on the opponent for ${Math.round(waitingMs / 1000)} seconds.`
      );
      prolongedWaitTimerRef.current = null;
    }, HECKLE_PROLONGED_WAIT_MS);

    return () => {
      if (prolongedWaitTimerRef.current) {
        window.clearTimeout(prolongedWaitTimerRef.current);
        prolongedWaitTimerRef.current = null;
      }
    };
  }, [heckleWaitStateKey, shouldShowOpponentHeckles]);

  useEffect(() => {
    if (!shouldShowOpponentHeckles || activeHeckle || heckleQueue.length === 0) {
      return;
    }

    const [nextHeckle, ...remainingHeckles] = heckleQueue;
    if (sfxEnabled) {
      playSfx(heckleChimeAudioRef);
    }
    setActiveHeckle(nextHeckle);
    setShowHeckle(true);
    setHeckleQueue(remainingHeckles);
  }, [shouldShowOpponentHeckles, activeHeckle, heckleQueue, sfxEnabled, playSfx, heckleChimeAudioRef]);

  useEffect(() => {
    if (!pendingHeckleTrigger || !shouldShowOpponentHeckles || activeHeckle || heckleQueue.length > 0) return;
    if (!heckleWaitStateKey || !game || !user || !currentPlayer || !opponentPlayer) return;

    if (lastHeckleWaitStateKeyRef.current === heckleWaitStateKey) {
      console.info('[heckles] Request skipped: wait state already heckled', {
        waitStateKey: heckleWaitStateKey,
        trigger: pendingHeckleTrigger,
      });
      setPendingHeckleTrigger(null);
      return;
    }

    const now = Date.now();
    if (now - lastHeckleRequestAtRef.current < HECKLE_REQUEST_COOLDOWN_MS) {
      console.info('[heckles] Request skipped: cooldown active', {
        waitStateKey: heckleWaitStateKey,
        trigger: pendingHeckleTrigger,
        msRemaining: HECKLE_REQUEST_COOLDOWN_MS - (now - lastHeckleRequestAtRef.current),
      });
      setPendingHeckleTrigger(null);
      return;
    }

    const requestId = ++heckleRequestIdRef.current;
    const recentQuestionHistory = recentAiQuestionHistoryRef.current;
    const latestQuestionContext = recentQuestionHistory[0];
    const requestPayload = {
      playerName: currentPlayer.name || playerProfile?.nickname || user.email || 'Player',
      opponentName: opponentPlayer.name,
      trigger: pendingHeckleTrigger.reason,
      waitingReason: `Waiting for ${opponentPlayer.name} to finish their turn.`,
      playerScore: currentPlayerScore,
      opponentScore: opponentPlayerScore,
      scoreDelta,
      recentPerformanceSummary: `${currentPlayer.name || 'You'}: ${currentPlayerScore} points, streak ${currentPlayer.streak || 0}. ${opponentPlayer.name}: ${opponentPlayerScore} points, streak ${opponentPlayer.streak || 0}.`,
      lastQuestion: latestQuestionContext?.question,
      playerMissedLastQuestion: latestQuestionContext?.result !== 'correct',
      category: latestQuestionContext?.category,
      difficulty: latestQuestionContext?.difficulty,
      recentFailure: lastFailureRef.current,
      recentQuestionHistory,
      isSolo,
    };

    heckleRequestInFlightRef.current = { requestId, waitStateKey: heckleWaitStateKey };
    lastHeckleRequestAtRef.current = now;
    setPendingHeckleTrigger(null);

    console.info('[heckles] Request allowed', {
      waitStateKey: heckleWaitStateKey,
      requestId,
      trigger: pendingHeckleTrigger,
      payloadSummary: {
        playerName: requestPayload.playerName,
        opponentName: requestPayload.opponentName,
        trigger: requestPayload.trigger,
        playerScore: requestPayload.playerScore,
        opponentScore: requestPayload.opponentScore,
        scoreDelta: requestPayload.scoreDelta,
        category: requestPayload.category ?? null,
        difficulty: requestPayload.difficulty ?? null,
        playerMissedLastQuestion: requestPayload.playerMissedLastQuestion,
      },
    });

    generateHeckles(requestPayload)
      .then((generatedHeckles) => {
        const requestStillActive =
          heckleRequestInFlightRef.current?.requestId === requestId &&
          heckleRequestInFlightRef.current?.waitStateKey === heckleWaitStateKey;

        if (!requestStillActive || requestId !== heckleRequestIdRef.current) {
          console.info('[heckles] Response discarded: superseded request', {
            requestId,
            waitStateKey: heckleWaitStateKey,
          });
          return;
        }

        if (!generatedHeckles.length) {
          console.info('[heckles] Response returned no heckles', {
            requestId,
            waitStateKey: heckleWaitStateKey,
          });
          return;
        }

        const latestEligibility = latestHeckleEligibilityRef.current;
        const waitStateStillEligible =
          currentWaitingStateKeyRef.current === heckleWaitStateKey &&
          latestEligibility.allowed;

        if (!waitStateStillEligible) {
          console.info('[heckles] Response discarded because waiting ended', {
            requestId,
            waitStateKey: heckleWaitStateKey,
            currentWaitStateKey: currentWaitingStateKeyRef.current,
            eligibilityReason: latestEligibility.reason,
          });
          return;
        }

        console.info('[heckles] Response accepted', {
          requestId,
          waitStateKey: heckleWaitStateKey,
          returnedCount: generatedHeckles.length,
        });
        lastHeckleWaitStateKeyRef.current = heckleWaitStateKey;
        setHeckleQueue(generatedHeckles);
      })
      .catch((error) => {
        console.error('[heckles] Request failed', {
          requestId,
          waitStateKey: heckleWaitStateKey,
          error,
        });
      })
      .finally(() => {
        if (heckleRequestInFlightRef.current?.requestId === requestId) {
          heckleRequestInFlightRef.current = null;
        }
      });
  }, [
    pendingHeckleTrigger,
    shouldShowOpponentHeckles,
    activeHeckle,
    heckleQueue.length,
    heckleWaitStateKey,
    game,
    user,
    currentPlayer,
    opponentPlayer,
    playerProfile?.nickname,
    user?.email,
    currentPlayerScore,
    opponentPlayerScore,
    scoreDelta,
    isSolo,
  ]);

  useEffect(() => {
    return () => {
      if (heckleTimer.current) {
        window.clearTimeout(heckleTimer.current);
        heckleTimer.current = null;
      }
      if (prolongedWaitTimerRef.current) {
        window.clearTimeout(prolongedWaitTimerRef.current);
        prolongedWaitTimerRef.current = null;
      }
      heckleRequestInFlightRef.current = null;
      heckleRequestIdRef.current += 1;
    };
  }, []);

  const continueAfterExplanation = () => {
    if (game?.status === 'completed' && game.winnerId === user?.id) {
      setQueuedSpecialEvent(null);
      clearCurrentTurnView();
      if (game.id) {
        persistActiveGameId(null);
      }
      setResultPhase('idle');
      return;
    }

    const nextEvent = queuedSpecialEvent;
    setQueuedSpecialEvent(null);
    clearCurrentTurnView();
    if (game?.id) {
      void clearActiveGameQuestion(game.id).catch((err) => {
        console.error(err);
      });
    }

    if (nextEvent) {
      showSpecialEvent(nextEvent);
      return;
    }

    setResultPhase('idle');
  };

  useEffect(() => {
    const chromeTheme = THEME_CHROME[settings.themeMode];

    document.documentElement.dataset.theme = settings.themeMode;
    document.body.dataset.theme = settings.themeMode;
    document.documentElement.style.colorScheme = chromeTheme.colorScheme;
    document.body.style.colorScheme = chromeTheme.colorScheme;

    document
      .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      .forEach((metaTag) => metaTag.setAttribute('content', chromeTheme.appBg));

    document
      .querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')
      ?.setAttribute('content', chromeTheme.appleStatusBarStyle);
  }, [settings.themeMode]);

  useEffect(() => {
    saveLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!user) {
      setIsEnsuringProfile(false);
      return;
    }

    let cancelled = false;
    setIsEnsuringProfile(true);

    ensurePlayerProfile(user)
      .catch((err) => {
        if (!cancelled) {
          console.error('[profile] Failed to ensure profile row:', err);
          setError('We signed you in, but failed to finish your profile setup.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsEnsuringProfile(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setRemoteSettingsResolved(true);
      setRemoteSettingsError(null);
      return;
    }

    let cancelled = false;
    setRemoteSettingsResolved(false);
    setRemoteSettingsError(null);

    loadUserSettings(user.id)
      .then((remoteSettings) => {
        if (cancelled) return;
        setSettings((current) => mergeSettings(current, remoteSettings, DEFAULT_USER_SETTINGS));
      })
      .catch((err) => {
        if (!cancelled) {
          setRemoteSettingsError('Failed to load your settings.');
        }
        if (import.meta.env.DEV) {
          console.warn('[userSettings] Failed to load remote settings:', err);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRemoteSettingsResolved(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !remoteSettingsResolved) return;

    const serialized = JSON.stringify(settings);
    if (lastSavedRemoteSettingsRef.current === serialized) return;

    saveUserSettings(user.id, settings)
      .then(() => {
        lastSavedRemoteSettingsRef.current = serialized;
        setRemoteSettingsError(null);
      })
      .catch((err) => {
        setRemoteSettingsError('Failed to save your settings.');
        if (import.meta.env.DEV) {
          console.warn('[userSettings] Failed to save remote settings:', err);
        }
      });
  }, [settings, user?.id, remoteSettingsResolved]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!game?.id) return;

    if (game.status === 'active') {
      persistActiveGameId(game.id);
      return;
    }

    if (game.status === 'completed' || game.status === 'abandoned') {
      persistActiveGameId(null);
    }
  }, [game?.id, game?.status]);

  useEffect(() => {
    const dependencySnapshot = {
      userId: user?.id ?? null,
      gameId: game?.id ?? null,
      resumePromptGameId: resumePrompt?.game.id ?? null,
      isCheckingForResume,
    };
    const previousDependencySnapshot = resumeCheckDepsRef.current;
    resumeCheckDepsRef.current = dependencySnapshot;

    console.info('[resumeCheck] Effect evaluation', {
      previousDependencies: previousDependencySnapshot,
      currentDependencies: dependencySnapshot,
      rerunReasons: {
        userChanged: previousDependencySnapshot?.userId !== dependencySnapshot.userId,
        gameChanged: previousDependencySnapshot?.gameId !== dependencySnapshot.gameId,
        resumePromptChanged: previousDependencySnapshot?.resumePromptGameId !== dependencySnapshot.resumePromptGameId,
        loadingChanged: previousDependencySnapshot?.isCheckingForResume !== dependencySnapshot.isCheckingForResume,
      },
    });

    if (!user?.id || game || resumePrompt) {
      console.info('[resumeCheck] Skipping resume check because prerequisites are not met', {
        userId: user?.id ?? null,
        hasGame: !!game,
        hasResumePrompt: !!resumePrompt,
      });
      return;
    }

    const storedGameId = getStoredActiveGameId();
    console.info('[resumeCheck] Evaluating startup resume check', {
      userId: user?.id ?? null,
      hasGame: !!game,
      hasResumePrompt: !!resumePrompt,
      isCheckingForResume,
      storedGameId,
      inFlightStoredGameId: resumeCheckInFlightGameIdRef.current,
    });
    if (!storedGameId) {
      console.info('[resumeCheck] No stored active game found; skipping resume check', {
        userId: user?.id ?? null,
      });
      if (isCheckingForResume) {
        setResumeCheckLoading(false, 'resumeCheckSkippedNoStoredGame');
      }
      return;
    }

    if (resumeCheckInFlightGameIdRef.current === storedGameId) {
      console.info('[resumeCheck] Resume check already in flight for stored game; skipping duplicate start', {
        storedGameId,
      });
      return;
    }

    const requestId = ++resumeCheckRequestIdRef.current;
    resumeCheckInFlightGameIdRef.current = storedGameId;

    let cancelled = false;
    let finished = false;
    let timeoutId: number | null = null;
    const finishResumeCheck = (reason: string, extra: Record<string, unknown> = {}) => {
      if (finished) return;
      finished = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (resumeCheckRequestIdRef.current === requestId) {
        resumeCheckInFlightGameIdRef.current = null;
        setResumeCheckLoading(false, reason, {
          requestId,
          storedGameId,
          cancelled,
          ...extra,
        });
      } else {
        console.info('[resumeCheck] Ignoring finish from superseded request', {
          requestId,
          activeRequestId: resumeCheckRequestIdRef.current,
          reason,
          storedGameId,
          cancelled,
          ...extra,
        });
      }
    };

    console.info('[resumeCheck] Starting resume check request', {
      requestId,
      userId: user.id,
      storedGameId,
      request: 'getGameById',
    });
    setResumeCheckLoading(true, 'resumeCheckStart', { requestId, userId: user.id, storedGameId });
    timeoutId = window.setTimeout(() => {
      console.error('[resumeCheck] Resume check timed out', {
        requestId,
        userId: user.id,
        storedGameId,
      });
      finishResumeCheck('resumeCheckTimeout');
    }, 8000);

    getGameById(storedGameId)
      .then((storedGame) => {
        if (cancelled || finished) {
          console.info('[resumeCheck] Ignoring response from cancelled or finished request', {
            requestId,
            storedGameId,
            cancelled,
            finished,
          });
          return;
        }

        console.info('[resumeCheck] Resume check response received', {
          requestId,
          storedGameId,
          foundGame: !!storedGame,
          gameStatus: storedGame?.status ?? null,
          playerIds: storedGame?.playerIds ?? [],
          resumedGameOwnershipMatchesCurrentSession: !!storedGame && storedGame.playerIds.includes(user.id),
        });

        if (!storedGame) {
          console.info('[resumeCheck] No resumable game found; clearing stored active game', {
            requestId,
            storedGameId,
          });
          persistActiveGameId(null);
          finishResumeCheck('resumeCheckNoStoredGame');
          return;
        }

        if (storedGame.status !== 'active' || !storedGame.playerIds.includes(user.id)) {
          console.info('[resumeCheck] Stored game is not resumable for current user', {
            requestId,
            storedGameId,
            gameStatus: storedGame.status,
            playerIds: storedGame.playerIds,
            userId: user.id,
          });
          persistActiveGameId(null);
          finishResumeCheck('resumeCheckGameNotResumable', {
            gameStatus: storedGame.status,
          });
          return;
        }

        console.info('[resumeCheck] Resumable game found', {
          requestId,
          storedGameId,
          gameStatus: storedGame.status,
          playerIds: storedGame.playerIds,
          resumedGameOwnershipMatchesCurrentSession: storedGame.playerIds.includes(user.id),
        });
        setIsSolo(storedGame.playerIds.length === 1);
        setResumePrompt({
          game: storedGame as GameState,
          isSolo: storedGame.playerIds.length === 1,
        });
        finishResumeCheck('resumeCheckResumableGameFound');
      })
      .catch((err) => {
        if (cancelled || finished) {
          console.info('[resumeCheck] Ignoring error from cancelled or finished request', {
            requestId,
            storedGameId,
            cancelled,
            finished,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        console.error('[resumeCheck] Failed to check for resumable game:', err);
        finishResumeCheck('resumeCheckError', {
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (!finished && resumeCheckRequestIdRef.current === requestId) {
        resumeCheckInFlightGameIdRef.current = null;
        setResumeCheckLoading(false, 'resumeCheckCleanupBeforeCompletion', {
          requestId,
          storedGameId,
          previousDependencies: previousDependencySnapshot,
          currentDependencies: dependencySnapshot,
        });
        finished = true;
      }
      console.info('[resumeCheck] Resume check effect cleanup', {
        requestId,
        storedGameId,
        finished,
        cancelled,
      });
    };
  }, [game?.id, resumePrompt?.game.id, user?.id]);


  useEffect(() => {
    if (!inviteFeedback) return;
    const timeout = window.setTimeout(() => setInviteFeedback(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [inviteFeedback]);

  useEffect(() => {
    if (!resumeBanner) return;
    const timeout = window.setTimeout(() => setResumeBanner(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [resumeBanner]);

  useEffect(() => {
    if (!matchIdCopied) return;
    const timeout = window.setTimeout(() => setMatchIdCopied(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [matchIdCopied]);

  useEffect(() => {
    if (!game?.id) {
      setIsMobileChatOpen(false);
      setSeenIncomingMessageCount(0);
      return;
    }

    setIsMobileChatOpen(false);
    setSeenIncomingMessageCount(0);
  }, [game?.id]);

  useEffect(() => {
    syncAudioState();
  }, [syncAudioState]);

  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    const currentUserId = user?.id ?? null;

    if (!previousUserId && currentUserId) {
      void playRandomWelcomeCue();
    }

    previousUserIdRef.current = currentUserId;
  }, [playRandomWelcomeCue, user?.id]);

  useEffect(() => {
    const previousGameId = prevGameIdRef.current;
    const currentGameId = game?.id ?? null;

    if (!previousGameId && currentGameId) {
      void playNewGameCue();
    }

    prevGameIdRef.current = currentGameId;
  }, [game?.id, playNewGameCue]);

  useEffect(() => {
    if (game?.status === 'completed' && prevGameStatus.current !== 'completed') {
      if (settings.soundEnabled && settings.sfxEnabled) {
        if (game.winnerId === user?.id) {
          if (wonAudioRef.current) {
            wonAudioRef.current.currentTime = 0;
            void tryPlay(wonAudioRef, true);
          }
        }
      }

      if (game.winnerId && game.winnerId !== user?.id && !hasTriggeredMatchLossRef.current) {
        hasTriggeredMatchLossRef.current = true;
        void triggerTrashTalk('MATCH_LOSS', {
          outcomeSummary: `${players.find((player) => player.uid === game.winnerId)?.name || 'Your opponent'} closed out the match.`,
        });
      }
    }
    prevGameStatus.current = game?.status || null;
  }, [game?.status, game?.winnerId, user?.id, settings.soundEnabled, settings.sfxEnabled, lastTrashTalkEvent, tryPlay]);

  useEffect(() => {
    if (game?.status !== 'completed' || !game.id || questions.length > 0 || (game.questionIds?.length ?? 0) === 0) {
      return;
    }

    let cancelled = false;

    getGameQuestions(game.id)
      .then((storedQuestions) => {
        if (cancelled || storedQuestions.length === 0) {
          return;
        }

        setQuestions(storedQuestions);
      })
      .catch((error) => {
        console.error('[endgame-roast] Failed to load stored game questions', {
          gameId: game.id,
          error,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [game?.status, game?.id, game?.questionIds, questions.length, setQuestions]);

  useEffect(() => {
    if (game?.status !== 'completed' || !game?.id) {
      setEndgameRoast(null);
      setIsGeneratingEndgameRoast(false);
      endgameRoastRequestKeyRef.current = '';
      return;
    }

    if ((game.questionIds?.length ?? 0) > 0 && questions.length === 0) {
      return;
    }

    if (isSolo || !game.winnerId || players.length < 2) {
      setEndgameRoast(null);
      setIsGeneratingEndgameRoast(false);
      return;
    }

    const winner = players.find((player) => player.uid === game.winnerId);
    const loser = players.find((player) => player.uid !== game.winnerId);

    if (!winner || !loser) {
      return;
    }

    const winnerRecentQuestionHistory = getRecentQuestionHistoryForPlayer(game, questions, winner.uid);
    const loserRecentQuestionHistory = getRecentQuestionHistoryForPlayer(game, questions, loser.uid);
    const requestKey = `${game.id}:${winner.uid}:${loser.uid}:${winnerRecentQuestionHistory.length}:${loserRecentQuestionHistory.length}`;

    if (endgameRoastRequestKeyRef.current === requestKey) {
      return;
    }

    endgameRoastRequestKeyRef.current = requestKey;
    setIsGeneratingEndgameRoast(true);
    setEndgameRoast(null);

    const requestPayload = {
      winnerName: winner.name || 'Winner',
      loserName: loser.name || 'Loser',
      winnerScore: winner.score,
      loserScore: loser.score,
      winnerTrophies: winner.completedCategories?.length ?? 0,
      loserTrophies: loser.completedCategories?.length ?? 0,
      winnerRecentQuestionHistory,
      loserRecentQuestionHistory,
      isSolo,
    };

    Promise.race<EndgameRoastResult | null>([
      generateEndgameRoast(requestPayload),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 7000)),
    ])
      .then((generatedRoast) => {
        if (endgameRoastRequestKeyRef.current !== requestKey) {
          return;
        }

        setEndgameRoast(generatedRoast);
      })
      .catch((error) => {
        console.error('[endgame-roast] Request failed', {
          gameId: game.id,
          requestKey,
          error,
        });
      })
      .finally(() => {
        if (endgameRoastRequestKeyRef.current === requestKey) {
          setIsGeneratingEndgameRoast(false);
        }
      });
  }, [game, isSolo, players, questions]);

  useEffect(() => {
    if (game?.status !== 'abandoned') return;
    resetGame();
    setError('This match was abandoned. Starting fresh.');
  }, [game?.status]);

  useEffect(() => {
    if (settings.commentaryEnabled) return;
    setActiveTrashTalk(null);
    setActiveTrashTalkEvent(null);
    setQueuedSpecialEvent((current) => current?.kind === 'TRASH_TALK' ? null : current);
    setPendingHeckleTrigger(null);
  }, [settings.commentaryEnabled]);


  const handleResumeGame = async () => {
    if (!resumePrompt || !user?.id) return;


    const resumedGame = resumePrompt.game;
    if (!resumePrompt.isSolo) {
      void requestTurnNotificationPermission();
    }
    setIsSolo(resumePrompt.isSolo);
    setGame(resumedGame);
    pendingResumeRestoreRef.current = resumedGame.id;
    persistActiveGameId(resumedGame.id);
    clearResumePrompt();

    try {
      await updatePlayerActivity(resumedGame.id, user.id, true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleStartNewInstead = async () => {
    const resumeGameId = resumePrompt?.game.id || getStoredActiveGameId();
    clearResumePrompt();
    setIsSolo(false);

    if (!resumeGameId) {
      persistActiveGameId(null);
      return;
    }

    try {
      await abandonGame(resumeGameId);
    } catch (err) {
      console.error(err);
      persistActiveGameId(null);
    }
  };

  useEffect(() => {
    if (!pendingResumeRestoreRef.current || pendingResumeRestoreRef.current !== game?.id || !user?.id) return;


    const questionOrder = game.questionIds || [];
    const currentQuestionId = game.currentQuestionId || (
      typeof game.currentQuestionIndex === 'number' && game.currentQuestionIndex >= 0
        ? questionOrder[game.currentQuestionIndex] || null
        : null
    );

    const currentQuestionAnswer = currentQuestionId ? game.answers?.[currentQuestionId]?.[user.id] : undefined;
    const shouldRestoreQuestionCard =
      !!currentQuestionId &&
      (game.currentTurn === user.id || !!currentQuestionAnswer);

    if (shouldRestoreQuestionCard && questions.length === 0) {
      return;
    }

    pendingResumeRestoreRef.current = null;
    setRevealedCategory(null);
    setSelectedCategory(game.currentQuestionCategory || null);
    setShouldBlurQuestionBackground(false);

    if (!shouldRestoreQuestionCard || !currentQuestionId) {
      setRoast(null);
      setSelectedAnswer(null);
      setCorrectAnswer(null);
      setCurrentQuestion(null);
      setResultPhase('idle');
      return;
    }

    const restoredQuestion = questions.find((question) => question.id === currentQuestionId);
    if (!restoredQuestion) {
      setRoast(null);
      setSelectedAnswer(null);
      setCorrectAnswer(null);
      setCurrentQuestion(null);
      setResultPhase('idle');
      return;
    }

    restoredQuestionStartedAtRef.current = game.currentQuestionStartedAt || Date.now();
    setCurrentQuestion(restoredQuestion);

    if (!currentQuestionAnswer) {
      setRoast(null);
      setSelectedAnswer(null);
      setCorrectAnswer(null);
      setResultPhase('idle');
      return;
    }

    setSelectedAnswer(currentQuestionAnswer.answerIndex);
    setCorrectAnswer(restoredQuestion.correctIndex);
    setShouldBlurQuestionBackground(true);
    setRoast({
      explanation: getExplanationText(restoredQuestion),
      isCorrect: currentQuestionAnswer.isCorrect,
      questionId: restoredQuestion.id,
      wrongAnswerQuip: currentQuestionAnswer.isCorrect ? undefined : getWrongAnswerQuip(restoredQuestion, currentQuestionAnswer.answerIndex),
      userId: user.id,
      gameId: game.id,
    });
    setResultPhase('explaining');
  }, [game, questions, user?.id]);

  useEffect(() => {
    if (!game || !user || players.length === 0) {
      prevPlayersRef.current = players;
      return;
    }

    const currentPlayer = players.find((player) => player.uid === user.id);
    const opponent = players.find((player) => player.uid !== user.id);
    const previousPlayers = prevPlayersRef.current;
    const previousOpponent = previousPlayers.find((player) => player.uid === opponent?.uid);

    if (opponent && previousOpponent) {
      const previousCompleted = new Set(previousOpponent.completedCategories || []);
      const gainedCategory = (opponent.completedCategories || []).find((category) => !previousCompleted.has(category));
      const gainedTrophy = !!gainedCategory;
      if (gainedTrophy) {
        void triggerTrashTalk('OPPONENT_TROPHY', {
          playerName: currentPlayer?.name || playerProfile?.nickname || user.email || 'Player',
          opponentName: opponent.name,
          playerScore: currentPlayer?.score ?? 0,
          opponentScore: opponent.score ?? 0,
          playerTrophies: currentPlayer?.completedCategories?.length ?? 0,
          opponentTrophies: opponent.completedCategories?.length ?? 0,
          latestCategory: gainedCategory,
          outcomeSummary: `${opponent.name} just claimed ${gainedCategory || 'another category'}.`,
        });
      }

      const opponentResumed = (
        typeof opponent.lastResumedAt === 'number' &&
        typeof previousOpponent.lastResumedAt === 'number' &&
        opponent.lastResumedAt > previousOpponent.lastResumedAt
      ) || (
          typeof opponent.lastResumedAt === 'number' &&
          typeof previousOpponent.lastResumedAt !== 'number'
        );

      if (game.status === 'active' && opponentResumed) {
        const message = `${opponent.name} resumed the game.`;
        setResumeBanner(message);
        void notifySafe('Player resumed', {
          body: message,
          icon: logoSrc,
          tag: `resume-${game.id}-${opponent.uid}`,
          onClickFocusWindow: true,
        });
      }
    }

    if (currentPlayer && opponent) {
      const scoreGap = (opponent.score || 0) - (currentPlayer.score || 0);
      if (scoreGap >= 3 && !hasWarnedBehindRef.current) {
        hasWarnedBehindRef.current = true;
        void triggerTrashTalk('PLAYER_FALLING_BEHIND', {
          playerName: currentPlayer.name,
          opponentName: opponent.name,
          playerScore: currentPlayer.score || 0,
          opponentScore: opponent.score || 0,
          playerTrophies: currentPlayer.completedCategories?.length ?? 0,
          opponentTrophies: opponent.completedCategories?.length ?? 0,
          outcomeSummary: `${currentPlayer.name} dropped behind by ${scoreGap} points while ${opponent.name} kept control.`,
        });
        queueHeckleTrigger(
          'score_deficit',
          `${game.id}:${currentPlayer.uid}:score_deficit:${scoreGap}`,
          `${currentPlayer.name} fell behind by ${scoreGap} points while waiting on ${opponent.name}.`
        );
      } else if (scoreGap < 3) {
        hasWarnedBehindRef.current = false;
      }
    }

    prevPlayersRef.current = players;
  }, [players, game?.id, user?.id, lastTrashTalkEvent]);

  useEffect(() => {
    if (!game?.id || !user?.id || isSolo || players.length < 2) return;

    const opponent = players.find((player) => player.uid !== user.id);
    if (!opponent) return;

    const pairKey = `${game.id}:${user.id}:${opponent.uid}`;
    if (recordedRecentPairKeysRef.current.has(pairKey)) return;
    recordedRecentPairKeysRef.current.add(pairKey);

    recordRecentPlayer(user.id, opponent, game.id)
      .then(() => undefined)
      .catch((err) => {
        recordedRecentPairKeysRef.current.delete(pairKey);
        if (import.meta.env.DEV) {
          console.warn('[recentPlayers] Failed to record:', err);
        }
      });
  }, [game?.id, isSolo, players, user?.id]);

  useEffect(() => {
    if (!game?.id || !user?.id || game.status !== 'active' || isSolo || players.length < 2) return;
    if (game.currentTurn !== user.id) return;

    const notificationKey = `${game.id}:${game.currentTurn}:${game.status}`;
    if (lastTurnNotificationKeyRef.current === notificationKey) return;
    lastTurnNotificationKeyRef.current = notificationKey;

    const opponent = players.find((player) => player.uid !== user.id);
    void notifySafe('Your turn', {
      body: opponent ? `${opponent.name} is done. Time to spin.` : 'Time to spin.',
      icon: logoSrc,
      tag: `turn-${game.id}`,
      onClickFocusWindow: true,
    });
  }, [game?.id, game?.currentTurn, game?.status, isSolo, logoSrc, players, user?.id]);

  const handleSendMagicLink = async () => {
    if (!email) {
      setError('Please enter your email.');
      return;
    }

    // Simple email validation
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    setError(null);
    setAuthLoading(true);
    setAuthLoadingMode('magic-link');
    try {
      await signInWithMagicLink(email);
      setIsMagicLinkSent(true);
    } catch (err: any) {
      console.error('[handleSendMagicLink] Failed:', err);
      let message = err.message || 'Failed to send login link. Please try again.';
      if (message.includes('rate limit')) {
        message = 'Slow down! Too many requests. Try again in a minute.';
      } else if (message.includes('invalid email')) {
        message = 'That email looks like bullshit. Try a real one.';
      }
      setError(message);
    } finally {
      setAuthLoading(false);
      setAuthLoadingMode(null);
    }
  };

  const handleGoogleSignIn = async () => {
    if (authLoading) return;

    setError(null);
    setAuthLoading(true);
    setAuthLoadingMode('google');
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.error('[handleGoogleSignIn] Failed:', err);
      setError(err.message || 'Failed to start Google sign-in. Please try again.');
      setAuthLoading(false);
      setAuthLoadingMode(null);
    }
  };

  const handleShowEmailSignIn = () => {
    setError(null);
    setShowEmailSignIn(true);
  };

  const handleSaveNickname = async () => {
    if (!user || !sanitizeNicknameInput(nickname) || isSavingNickname) return;
    setIsSavingNickname(true);
    setError(null);
    try {
      const updatedProfile = await savePlayerNickname(user, nickname);
      setPlayerProfile(updatedProfile);
      setNickname(updatedProfile.nickname || '');
      setIsEditingNickname(false);
      if (game && players.some((player) => player.uid === user.id)) {
        const updatedPlayers = players.map((player) =>
          player.uid === user.id
            ? { ...player, name: updatedProfile.nickname || player.name }
            : player
        );
        setPlayers(updatedPlayers);
        setGame((current) => current ? { ...current, players: updatedPlayers } : current);
        await updateGame(game.id, { players: updatedPlayers });
      }
    } catch (err: any) {
      console.error('[handleSaveNickname] Failed:', err);
      setError(err?.message || "Failed to save nickname. Try something else.");
    } finally {
      setIsSavingNickname(false);
    }
  };

  const handleStartNicknameEdit = () => {
    setNickname(playerProfile?.nickname || '');
    setIsEditingNickname(true);
    setError(null);
  };

  const handleCancelNicknameEdit = () => {
    setNickname(playerProfile?.nickname || '');
    setIsEditingNickname(false);
  };

  const handleSaveAvatar = async (avatarUrl: string) => {
    if (!user) return;

    try {
      const updatedProfile = await savePlayerAvatar(user, avatarUrl);
      setPlayerProfile(updatedProfile);
    } catch (err) {
      console.error('[handleSaveAvatar] Failed:', err);
      setError('Failed to save avatar.');
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user) return;

    try {
      const updatedProfile = await removePlayerAvatar(user);
      setPlayerProfile(updatedProfile);
    } catch (err) {
      console.error('[handleRemoveAvatar] Failed:', err);
      setError('Failed to remove avatar.');
    }
  };

  const startSoloGame = async (avatarUrl: string) => {
    setIsStartingGame(true);
    setLoadingStep('creating_match');
    setIsSolo(true);
    setError(null);
    if (settings.soundEnabled) {
      void enableAudioFromGesture();
    }

    try {
      const effectiveAvatarUrl = avatarUrl || playerProfile?.avatarUrl || '';
      const newGame = await createGame(user.id, playerProfile?.nickname || user.email || 'Player 1', effectiveAvatarUrl, true);
      const gameId = newGame.id;

      setIsFetchingQuestions(true);
      setLoadingStep('loading_questions');
      const initialQuestions = await getQuestionsForSession({
        categories: playableCategories,
        count: 3,
        excludeQuestionIds: existingQuestionIds,
        userId: user.id,
      });
      await persistQuestionsToGameService(gameId, initialQuestions.map(q => q.id));

      setGame(newGame);
    } catch (err) {
      console.error(err);
      setError(getFriendlyGameCreateError(err));
    } finally {
      setIsStartingGame(false);
      setIsFetchingQuestions(false);
      setLoadingStep('idle');
    }
  };

  const startMultiplayerGame = async (avatarUrl: string) => {
    void requestTurnNotificationPermission();
    setIsStartingGame(true);
    setLoadingStep('creating_match');
    setIsSolo(false);
    setError(null);
    if (settings.soundEnabled) {
      void enableAudioFromGesture();
    }

    try {
      const effectiveAvatarUrl = avatarUrl || playerProfile?.avatarUrl || '';
      const newGame = await createGame(user.id, playerProfile?.nickname || user.email || 'Host', effectiveAvatarUrl, false);
      const gameId = newGame.id;

      setIsFetchingQuestions(true);
      setLoadingStep('loading_questions');
      const initialQuestions = await getQuestionsForSession({
        categories: playableCategories,
        count: 3,
        excludeQuestionIds: existingQuestionIds,
        userId: user.id,
      });
      await persistQuestionsToGameService(gameId, initialQuestions.map(q => q.id));

      setGame(newGame);
    } catch (err) {
      console.error('[startMultiplayerGame] Failed:', err);
      setError(isSupabaseRlsInsertError(err) ? 'Game creation is blocked by database permissions right now.' : 'Failed to start multiplayer game.');
    } finally {
      setIsStartingGame(false);
      setIsFetchingQuestions(false);
      setLoadingStep('idle');
    }
  };

  const joinGame = async (code: string, avatarUrl: string) => {
    void requestTurnNotificationPermission();
    setIsJoiningGame(true);
    setLoadingStep('joining_match');
    setError(null);
    if (settings.soundEnabled) {
      void enableAudioFromGesture();
    }

    try {
      console.info('[joinGame] Submitted match ID', {
        submittedMatchId: code,
        userId: user.id,
      });
      const waitingGame = await getGameByCode(code);
      console.info('[joinGame] Lookup result', {
        submittedMatchId: code,
        found: !!waitingGame,
        foundGameId: waitingGame?.id ?? null,
        status: waitingGame?.status ?? null,
        playerIds: waitingGame?.playerIds ?? [],
      });

      if (!waitingGame) {
        console.warn('[joinGame] Early return: no game found for match ID', {
          submittedMatchId: code,
        });
        setError("Match not found. Paste a valid match ID.");
        return;
      }

      if (waitingGame.status !== 'waiting' && !waitingGame.playerIds.includes(user.id)) {
        console.warn('[joinGame] Early return: game filtered by status', {
          submittedMatchId: code,
          foundGameId: waitingGame.id,
          status: waitingGame.status,
        });
        setError('That match is no longer joinable.');
        return;
      }

      if (waitingGame.playerIds.length >= 2 && !waitingGame.playerIds.includes(user.id)) {
        console.warn('[joinGame] Early return: game already full', {
          submittedMatchId: code,
          foundGameId: waitingGame.id,
          playerIds: waitingGame.playerIds,
        });
        setError('That match is already full.');
        return;
      }

      const joinedGame = waitingGame.playerIds.includes(user.id)
        ? waitingGame
        : await joinGameById(waitingGame.id, user.id, playerProfile?.nickname || user.email || 'Player', avatarUrl || playerProfile?.avatarUrl || '');

      console.info('[joinGame] Joining player update result', {
        submittedMatchId: code,
        foundGameId: waitingGame.id,
        updateSucceeded: !!joinedGame,
      });

      if (!joinedGame) {
        console.warn('[joinGame] Early return: join update did not return a refreshed game', {
          submittedMatchId: code,
          foundGameId: waitingGame.id,
        });
        setError('Failed to join game.');
        return;
      }

      setLoadingStep('finalizing_lobby');
      navigateToJoinedGame(joinedGame, 'joinGame');
    } catch (err) {
      console.error('[joinGame] Failed:', err);
      setError("Failed to join game.");
    } finally {
      setIsJoiningGame(false);
      setLoadingStep('idle');
    }
  };

  const inviteRecentPlayer = async (player: RecentPlayer, avatarUrl: string) => {
    void requestTurnNotificationPermission();

    setIsStartingGame(true);
    setLoadingStep('creating_match');
    setIsSolo(false);
    setError(null);
    if (settings.soundEnabled) {
      void enableAudioFromGesture();
    }

    try {
      const effectiveAvatarUrl = avatarUrl || playerProfile?.avatarUrl || '';
      const newGame = await createGame(user.id, playerProfile?.nickname || user.email || 'Host', effectiveAvatarUrl, false);
      const gameId = newGame.id;

      setIsFetchingQuestions(true);
      setLoadingStep('loading_questions');
      const initialQuestions = await getQuestionsForSession({
        categories: playableCategories,
        count: 3,
        excludeQuestionIds: existingQuestionIds,
        userId: user.id,
      });
      await persistQuestionsToGameService(gameId, initialQuestions.map(q => q.id));

      await sendInvite({
        uid: user.id,
        nickname: playerProfile?.nickname || user?.email || 'Host',
        avatarUrl: effectiveAvatarUrl || playerProfile?.avatarUrl || undefined,
      }, player, gameId);
      await updateRecentPlayer(user.id, player.uid, {
        nickname: player.nickname,
        avatar_url: player.avatarUrl || null,
        last_played_at: new Date().toISOString(),
        last_game_id: gameId,
        hidden: false,
      });

      setInviteFeedback(`Invite sent to ${player.nickname}`);
      setGame(newGame);
    } catch (err) {
      console.error('[inviteRecentPlayer] Failed:', err);
      setError(isSupabaseRlsInsertError(err) ? 'Game creation is blocked by database permissions right now.' : 'Failed to send invite.');
    } finally {
      setIsStartingGame(false);
      setIsFetchingQuestions(false);
      setLoadingStep('idle');
    }
  };

  const handleAcceptInvite = async (invite: GameInvite, avatarUrl: string) => {
    void requestTurnNotificationPermission();

    setIsJoiningGame(true);
    setLoadingStep('joining_match');
    setError(null);
    if (settings.soundEnabled) {
      void enableAudioFromGesture();
    }

    try {
      const joined = await joinWaitingGameById(invite.gameId, avatarUrl || playerProfile?.avatarUrl || '');
      if (!joined) {
        await expireInvite(invite.id, user.id);
        return;
      }
      await acceptInvite(invite.id, user.id);
      await updateRecentPlayer(user.id, invite.fromUid, {
        nickname: invite.fromNickname,
        avatar_url: invite.fromAvatarUrl || null,
        last_played_at: new Date().toISOString(),
        last_game_id: invite.gameId,
        hidden: false,
      });
      setInviteFeedback(`Joined ${invite.fromNickname}'s match`);
    } catch (err) {
      console.error('[handleAcceptInvite] Failed:', err);
      setError("Failed to accept invite.");
    } finally {
      setIsJoiningGame(false);
      setLoadingStep('idle');
    }
  };

  const handleDeclineInvite = async (invite: GameInvite) => {
    if (!user) return;

    try {
      await declineInvite(invite.id, user.id);
      setInviteFeedback(`Declined invite from ${invite.fromNickname}`);
    } catch (err) {
      console.error('[handleDeclineInvite] Failed:', err);
      setError("Failed to decline invite.");
    }
  };

  const handleInspectMatchup = async (player: RecentPlayer) => {
    if (!user?.id) return;

    setIsLoadingMatchup(true);
    try {
      const matchup = await loadMatchupHistory(user.id, player.uid);
      setSelectedMatchup({
        opponentId: player.uid,
        summary: matchup.summary,
        games: matchup.games,
      });
    } catch (err) {
      reportServiceFailure(err, `users/${user.id}/matchups/${player.uid}`, 'Failed to load matchup history.');
    } finally {
      setIsLoadingMatchup(false);
    }
  };

  const handleRemoveRecentPlayer = async (player: RecentPlayer) => {
    if (!user?.id) return;

    try {
      await removeRecentPlayer(user.id, player.uid);
      if (selectedMatchup?.opponentId === player.uid) {
        setSelectedMatchup(null);
      }
    } catch (err) {
      reportServiceFailure(err, `users/${user.id}/recentPlayers/${player.uid}`, 'Failed to remove recent player.');
    }
  };

  const handleCloseMatchup = () => {
    setSelectedMatchup(null);
  };

  const handleSpinComplete = (category: string) => {
    if (!game || game.status !== 'active') {
      setIsSpinning(false);
      return;
    }

    setIsSpinning(false);
    if (category === 'Random') {
      setManualPickReady(true);
      setManualPickSource('wheel');
      setShowManualPickPrompt(true);
      setResultPhase('specialEvent');
      return;
    }

    setResultPhase('idle');
    const resolvedCategory = category;

    // Find an unused question in this category
    const available = questions.filter(q => !q.used && q.category === resolvedCategory);
    if (available.length > 0) {
      const q = available[Math.floor(Math.random() * available.length)];
      const questionId = q.id;
      const questionIndex = game.questionIds?.indexOf(questionId) ?? -1;
      showCategoryReveal(resolvedCategory, q, questionIndex >= 0 ? questionIndex : 0);
    } else {
      // Fetch more questions if needed
      setIsFetchingQuestions(true);
      setLoadingStep('loading_questions');
      getQuestionsForSession({
        categories: [resolvedCategory],
        count: 3,
        excludeQuestionIds: existingQuestionIds,
        userId: user!.id,
      }).then(newQs => {
        if (newQs.length > 0) {
          setLoadingStep('finalizing_round');
          const q = newQs[0];
          const nextQuestionIds = [
            ...(game.questionIds || []),
            ...newQs.map((question) => question.id),
          ];
          persistQuestionsToGameService(game!.id, newQs.map(q => q.id))
            .then(() => syncGameQuestionIds(game!.id, nextQuestionIds))
            .then(() => {
              const questionId = q.id;
              const questionIndex = nextQuestionIds.indexOf(questionId);
              showCategoryReveal(resolvedCategory, q, questionIndex >= 0 ? questionIndex : 0);
            })
            .catch((err) => {
              console.error(`[onSpinComplete] Failed for game ${game!.id}:`, err);
            });
        } else {
          setError("Failed to load questions. Please try again.");
        }
        setIsFetchingQuestions(false);
        setLoadingStep('idle');
      });
    }
  };

  const consumeManualPick = () => {
    setManualPickReady(false);
    setShowManualPickPrompt(false);
    setManualPickSource('streak');
    setLastAnswerCorrect(false);
  };

  const handleManualCategoryPick = (category: string) => {
    consumeManualPick();
    setResultPhase('idle');
    handleSpinComplete(category);
  };

  const handleDeclineManualPick = () => {
    consumeManualPick();
    setResultPhase('idle');
  };

  const handleCopyMatchId = async () => {
    if (!game?.id) return;

    try {
      await navigator.clipboard.writeText(game.id);
      setMatchIdCopied(true);
    } catch (err) {
      console.error('[copyMatchId] Failed to copy match ID:', err);
      setError('Failed to copy match ID.');
    }
  };

  const getOpponentTurnOwner = (activeGame: GameState, activeUserId: string) => {
    const opponentFromIds = activeGame.playerIds.find((playerId) => playerId !== activeUserId);
    if (opponentFromIds) {
      return opponentFromIds;
    }

    return activeGame.players.find((player) => player.uid !== activeUserId)?.uid ?? null;
  };

  const handleAnswer = async (
    index: number,
    options?: { source?: 'answer' | 'timeout'; questionId?: string; submittedAt?: number }
  ) => {
    if (!currentQuestion || !game || !user || game.status !== 'active' || resultPhase !== 'idle') return;

    const source = options?.source ?? 'answer';
    const questionId = options?.questionId ?? currentQuestion.id;
    const submittedAt = options?.submittedAt ?? Date.now();
    if (questionId !== currentQuestion.id || questionId !== activeQuestionIdRef.current) return;
    if (questionResolvedRef.current) return;

    const deadline = questionDeadlineRef.current;
    const treatedAsTimeout = source === 'timeout' || (deadline !== null && submittedAt > deadline);
    const resolvedIndex = treatedAsTimeout ? -1 : index;

    // Lock immediately so duplicate clicks, timer expiry, and delayed callbacks cannot resolve twice.
    questionResolvedRef.current = true;
    resolvedQuestionIdRef.current = questionId;
    clearQuestionTimer();

    setSelectedAnswer(resolvedIndex);
    setCorrectAnswer(currentQuestion.correctIndex);
    const isCorrect = resolvedIndex === currentQuestion.correctIndex;
    const selectedChoice = resolvedIndex >= 0 ? currentQuestion.choices[resolvedIndex] : 'No answer before the timer expired';
    const correctChoice = currentQuestion.choices[currentQuestion.correctIndex];
    const questionResult: RecentAiQuestionContext['result'] =
      resolvedIndex < 0 ? 'timeout' : isCorrect ? 'correct' : 'wrong';
    recentAiQuestionHistoryRef.current = [{
      question: currentQuestion.question,
      category: currentQuestion.category,
      difficulty: currentQuestion.difficulty,
      playerAnswer: selectedChoice,
      correctAnswer: correctChoice,
      result: questionResult,
      explanation: currentQuestion.explanation,
    }, ...recentAiQuestionHistoryRef.current].slice(0, 2);

    if (sfxEnabled) {
      if (isCorrect) {
        if (correctAudioRef.current) {
          correctAudioRef.current.currentTime = 0;
          void tryPlay(correctAudioRef, true);
        }
      } else {
        const incorrectAudioRef = resolvedIndex < 0 ? timesUpAudioRef : wrongAudioRef;
        if (incorrectAudioRef.current) {
          incorrectAudioRef.current.currentTime = 0;
          void tryPlay(incorrectAudioRef, true);
        }
      }
    }

    const currentPlayer = players.find(p => p.uid === user.id);
    const gameAnswer: GameAnswer = {
      answerIndex: resolvedIndex,
      submittedAt,
      isCorrect,
      source,
    };
    console.info('[turnSync] Answer submitted', {
      gameId: game.id,
      questionId,
      submittedBy: user.id,
      submittedByName: currentPlayer?.name ?? null,
      wasCorrect: isCorrect,
      source,
      previousTurnOwner: game.currentTurn,
      selectedAnswerIndex: resolvedIndex,
    });
    setResultPhase('revealing');

    try {
      await recordAnswer(game.id, questionId, user.id, gameAnswer);
      console.info('[record_game_answer] RPC completed; waiting for realtime game refresh', {
        gameId: game.id,
        relyingOnSubscriptionRefresh: true,
      });

      // Incrementally update player stats even if match isn't finished
      void recordQuestionStats({
        uid: user.id,
        category: currentQuestion.category,
        isCorrect
      }).catch(err => {
        console.warn('[playerProfile] Failed to record question stats:', err);
      });

      if (isCorrect) {
        const newStreak = (currentPlayer?.streak || 0) + 1;
        const alreadyCompleted = currentPlayer?.completedCategories.includes(currentQuestion.category);
        const earnedNewTrophy = !alreadyCompleted;
        const newCompletedCategories = alreadyCompleted
          ? currentPlayer?.completedCategories || []
          : [...(currentPlayer?.completedCategories || []), currentQuestion.category];

        const updatedPlayers = players.map(p => {
          if (p.uid === user.id) {
            return {
              ...p,
              score: (p.score || 0) + 1,
              streak: newStreak,
              completedCategories: newCompletedCategories
            };
          }
          return p;
        });

        console.info('[turnSync] Correct-answer branch selected', {
          gameId: game.id,
          submittedBy: user.id,
          previousTurnOwner: game.currentTurn,
          nextTurnOwner: game.currentTurn,
          updatedFields: ['game_state.players'],
          localTurnHandlingDisabled: true,
        });
        await updateGame(game.id, { players: updatedPlayers });
        setPlayers(updatedPlayers);
        setGame((current) => current ? { ...current, players: updatedPlayers } : current);

        if (lastAnswerCorrect && !earnedNewTrophy && !manualPickReady) {
          setManualPickReady(true);
          setManualPickSource('streak');
          queueSpecialEvent({ kind: 'MANUAL_CATEGORY_UNLOCK' });
        }
        setLastAnswerCorrect(true);

        // Check for win
        if (newCompletedCategories.length >= playableCategories.length) {
          setManualPickReady(false);
          setQueuedSpecialEvent(null);
          const completedAt = Date.now();
          const finalScores = updatedPlayers.reduce<Record<string, number>>((scores, p) => {
            scores[p.uid] = p.score || 0;
            return scores;
          }, {});
          const categoriesUsed = Array.from(new Set(
            questions.filter((question) => question.used).map((question) => question.category)
          ));

          await updateGame(game.id, {
            status: 'completed',
            winner_id: user.id,
            final_scores: finalScores,
            categories_used: categoriesUsed,
            current_turn: null,
          });

          confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        }
      } else {
        setLastAnswerCorrect(false);
        lastFailureRef.current = resolvedIndex >= 0
          ? `Missed "${currentQuestion.question}" in ${currentQuestion.category}. Picked "${selectedChoice}" when the correct answer was "${correctChoice}". ${currentQuestion.explanation}`
          : `Ran out of time on "${currentQuestion.question}" in ${currentQuestion.category}. The correct answer was "${correctChoice}". ${currentQuestion.explanation}`;
        queueHeckleTrigger(
          resolvedIndex >= 0 ? 'wrong_answer' : 'round_loss',
          `${game.id}:${questionId}:${resolvedIndex >= 0 ? 'wrong_answer' : 'round_loss'}`,
          resolvedIndex >= 0
            ? `Player missed ${currentQuestion.category} question and turn is handing to the opponent.`
            : `Player timed out in ${currentQuestion.category} and lost the round tempo.`
        );

        const updatedPlayers = players.map(p => {
          if (p.uid === user.id) return { ...p, streak: 0 };
          return p;
        });
        const nextTurnOwner = isSolo ? user.id : getOpponentTurnOwner(game, user.id) ?? game.currentTurn;
        const gamePatch = isSolo
          ? { players: updatedPlayers, current_turn: user.id }
          : { players: updatedPlayers };

        console.info('[turnSync] Incorrect-answer branch selected', {
          gameId: game.id,
          submittedBy: user.id,
          wasCorrect: false,
          previousTurnOwner: game.currentTurn,
          nextTurnOwner,
          updatedFields: ['game_state.players'],
          dbPatch: {
            players: updatedPlayers.map((player) => ({
              uid: player.uid,
              score: player.score,
              streak: player.streak,
            })),
            ...(isSolo ? { current_turn: user.id } : {}),
          },
          realtimeWillOwnTurnSwitch: !isSolo,
        });
        await updateGame(game.id, gamePatch);
        setPlayers(updatedPlayers);
        setGame((current) =>
          current
            ? {
              ...current,
              players: updatedPlayers,
              currentTurn: isSolo ? user.id : current.currentTurn,
            }
            : current
        );
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (revealTimeoutRef.current) {
        window.clearTimeout(revealTimeoutRef.current);
      }

      revealTimeoutRef.current = window.setTimeout(() => {
        if (activeQuestionIdRef.current !== questionId || resolvedQuestionIdRef.current !== questionId) {
          return;
        }

        setShouldBlurQuestionBackground(true);
        setRoast({
          explanation: getExplanationText(currentQuestion),
          isCorrect,
          questionId: currentQuestion.id,
          wrongAnswerQuip: isCorrect ? undefined : getWrongAnswerQuip(currentQuestion, resolvedIndex >= 0 ? resolvedIndex : 0),
          userId: user.id,
          gameId: game.id,
        });
        setResultPhase('explaining');
      }, 650);
    }
  };

  const nextTurn = () => {
    continueAfterExplanation();
  };

  const chatTitleRotationSeed = currentPlayerScore + opponentPlayerScore + messages.length;

  const getMatchChatTitle = () => {
    if (!game || game.status !== 'active' || isSolo) {
      return game?.status === 'waiting' ? 'Lobby Chat' : 'Match Chat';
    }

    if (currentPlayerScore === opponentPlayerScore) {
      return 'Match Chat';
    }

    const titles = currentPlayerScore > opponentPlayerScore
      ? WINNING_CHAT_TITLES
      : LOSING_CHAT_TITLES;

    return titles[chatTitleRotationSeed % titles.length];
  };

  const matchChatTitle = getMatchChatTitle();

  const shouldShowMatchChat = !!game && !isSolo && (
    game.status === 'waiting' ||
    (game.status === 'active' && (
      (game.currentTurn === user?.id && !currentQuestion) ||
      game.currentTurn !== user?.id
    ))
  );
  const incomingMessageCount = messages.filter((message) => message.uid !== user?.id).length;
  const unreadIncomingMessageCount = Math.max(0, incomingMessageCount - seenIncomingMessageCount);
  const mobileChatBadgeClasses = [
    'bg-rose-500 text-white',
    'bg-emerald-500 text-emerald-950',
    'bg-fuchsia-500 text-white',
    'bg-cyan-400 text-cyan-950',
  ];
  const mobileChatBadgeClass =
    mobileChatBadgeClasses[(messages.length + (game?.id?.length || 0)) % mobileChatBadgeClasses.length];
  const setupLoadingCopy = getLoadingCopy(loadingStep);
  const isLobbyBusy = isStartingGame || isJoiningGame || isCheckingForResume;
  const lobbyLoadingCopy = isCheckingForResume
    ? { title: 'Checking for an active game', flow: 'Checking account state -> Looking for active matches' }
    : setupLoadingCopy;

  useEffect(() => {
    if (!game || !user?.id) return;

    const waitingMessage =
      game.status === 'waiting'
        ? 'Waiting for another player to join...'
        : !shouldShowCurrentTurnStage
          ? `Waiting for ${players.find((p) => p.uid === game.currentTurn)?.name} to spin...`
          : 'Current player can act';

    console.info('[multiplayerSync] Waiting-state evaluation', {
      gameId: game.id,
      userId: user.id,
      fullGameRecordUsedByUi: {
        id: game.id,
        status: game.status,
        currentTurn: game.currentTurn,
        playerIds: game.playerIds,
        players,
      },
      sourceOfTruthFields: {
        playerTwoJoined: {
          gameStatus: game.status,
          playerIds: game.playerIds,
          playersCount: players.length,
        },
        hostShouldSpin: {
          gameStatus: game.status,
          currentTurn: game.currentTurn,
          shouldShowCurrentTurnStage,
        },
        joiningPlayerShouldWait: {
          gameStatus: game.status,
          currentTurn: game.currentTurn,
          shouldShowCurrentTurnStage,
        },
      },
      chosenWaitingMessage: waitingMessage,
      chosenReason:
        game.status === 'waiting'
          ? 'statusWaitingSoHostWaitsForJoin'
          : !shouldShowCurrentTurnStage
            ? 'statusNotWaitingAndCurrentPlayerCannotActSoWaitForSpinner'
            : 'gameReadyForCurrentPlayerAction',
      staleCachedGameStateSuspected:
        game.status === 'waiting' && (game.playerIds.length > 1 || players.length > 1),
    });
  }, [game, players, shouldShowCurrentTurnStage, user?.id]);

  useEffect(() => {
    if (!game || !user?.id) return;

    console.info('[turnSync] UI active-player evaluation', {
      gameId: game.id,
      userId: user.id,
      currentTurnField: game.currentTurn,
      localPlayersField: players.map((player) => ({
        uid: player.uid,
        score: player.score,
        streak: player.streak,
      })),
      currentQuestionId: currentQuestion?.id ?? null,
      resultPhase,
      roastVisible: !!roast,
      revealedCategoryVisible: !!revealedCategory,
      shouldShowCurrentTurnStage,
      reasonSamePlayerCanKeepGoing:
        shouldShowCurrentTurnStage
          ? {
            currentTurnMatchesUser: game.currentTurn === user.id,
            currentQuestionVisible: !!currentQuestion,
            revealedCategoryVisible: !!revealedCategory,
            resultPhase,
            roastVisible: !!roast,
          }
          : null,
    });
  }, [currentQuestion, game, players, revealedCategory, resultPhase, roast, shouldShowCurrentTurnStage, user?.id]);

  useEffect(() => {
    console.info('[joinFlow] Screen guard evaluation', {
      currentView: game ? 'game-view' : 'lobby-view',
      gameId: game?.id ?? null,
      gameStatus: game?.status ?? null,
      isJoiningGame,
      isCheckingForResume,
      hasResumePrompt: !!resumePrompt,
      guardReason: game
        ? 'localGamePresent'
        : isJoiningGame
          ? 'joiningInProgressWithoutLocalGame'
          : resumePrompt
            ? 'resumePromptShowing'
            : 'noLocalGameStateSoLobbyRenders',
    });
  }, [game, isJoiningGame, isCheckingForResume, resumePrompt]);

  useEffect(() => {
    if (!isMobileChatOpen) return;
    setSeenIncomingMessageCount(incomingMessageCount);
  }, [incomingMessageCount, isMobileChatOpen]);


  const resetGame = () => {
    if (categoryRevealTimeoutRef.current) {
      window.clearTimeout(categoryRevealTimeoutRef.current);
      categoryRevealTimeoutRef.current = null;
    }

    persistActiveGameId(null);
    pendingResumeRestoreRef.current = null;
    setGame(null);
    setPlayers([]);
    setQuestions([]);
    setMessages([]);
    setChatInput('');
    setIsMobileChatOpen(false);
    setSeenIncomingMessageCount(0);
    setCurrentQuestion(null);
    setIsSolo(false);
    setError(null);
    setLastAnswerCorrect(false);
    setManualPickReady(false);
    setShowManualPickPrompt(false);
    setRevealedCategory(null);
    setShouldBlurQuestionBackground(false);
    setResultPhase('idle');
    setQueuedSpecialEvent(null);
    setActiveTrashTalk(null);
    setActiveTrashTalkEvent(null);
    setLastTrashTalkEvent(null);
    clearHeckles();
    setPendingHeckleTrigger(null);
    prevPlayersRef.current = [];
    recordedRecentPairKeysRef.current.clear();
    lastTurnNotificationKeyRef.current = '';
    recentAiQuestionHistoryRef.current = [];
    lastHeckleWaitStateKeyRef.current = '';
    currentWaitingStateKeyRef.current = null;
    heckleRequestInFlightRef.current = null;
    lastHeckleRequestAtRef.current = 0;
    heckleRequestIdRef.current += 1;
    lastFailureRef.current = 'No recent embarrassment recorded.';
    hasWarnedBehindRef.current = false;
    hasTriggeredMatchLossRef.current = false;
    resetQuestionResolutionState();
  };

  const playAgain = async () => {
    if (!game || !user || game.hostId !== user.id) return;
    setIsStartingGame(true);
    setLoadingStep('creating_match');
    try {
      // Generate new questions
      setIsFetchingQuestions(true);
      setLoadingStep('loading_questions');
      const initialQuestions = await getQuestionsForSession({
        categories: playableCategories,
        count: 3,
        excludeQuestionIds: existingQuestionIds, // maybe clear this for new game?
        userId: user.id,
      });
      await persistQuestionsToGameService(game.id, initialQuestions.map(q => q.id));
      const nextQuestionIds = initialQuestions.map((question) => question.id);

      const resetPlayers = players.map(p => ({
        ...p,
        score: 0,
        streak: 0,
        completedCategories: []
      }));

      // Reset game state
      const firstTurnPlayerId = players.find((player) => player.uid !== game.hostId)?.uid || game.hostId;
      await updateGame(game.id, {
        status: 'active',
        current_turn: firstTurnPlayerId,
        winner_id: null,
        current_question_id: null,
        current_question_category: null,
        current_question_index: -1,
        current_question_started_at: null,
        question_ids: nextQuestionIds,
        answers: {},
        players: resetPlayers
      });

      setLastAnswerCorrect(false);
      setManualPickReady(false);
      setShowManualPickPrompt(false);
      setShouldBlurQuestionBackground(false);
      setResultPhase('idle');
      setQueuedSpecialEvent(null);
      setActiveTrashTalk(null);
      setActiveTrashTalkEvent(null);
      setLastTrashTalkEvent(null);
      clearHeckles();
      setPendingHeckleTrigger(null);
      prevPlayersRef.current = [];
      recordedRecentPairKeysRef.current.clear();
      lastTurnNotificationKeyRef.current = '';
      recentAiQuestionHistoryRef.current = [];
      lastHeckleWaitStateKeyRef.current = '';
      currentWaitingStateKeyRef.current = null;
      heckleRequestInFlightRef.current = null;
      lastHeckleRequestAtRef.current = 0;
      heckleRequestIdRef.current += 1;
      lastFailureRef.current = 'No recent embarrassment recorded.';
      hasWarnedBehindRef.current = false;
      hasTriggeredMatchLossRef.current = false;
    } catch (err) {
      console.error(err);
      setError("Failed to restart game.");
    } finally {
      setIsStartingGame(false);
      setIsFetchingQuestions(false);
      setLoadingStep('idle');
    }
  };

  const exitCompletedMatchToLobby = () => {
    if (!game || game.status !== 'completed') return;
    resetGame();
  };

  const handleSendMessage = async () => {
    if (!game || !user || !chatInput.trim() || isSendingMessage) return;
    setIsSendingMessage(true);

    try {
      const avatarUrlSnapshot =
        playerProfile?.avatarUrl ||
        user.user_metadata?.avatar_url ||
        user.user_metadata?.picture ||
        null;

      await sendMessage({
        gameId: game.id,
        userId: user.id,
        content: chatInput.trim(),
        avatarUrlSnapshot,
      });
      setChatInput('');
      setError(null);
    } catch (err) {
      console.error('[chat] Failed to send player message', {
        gameId: game.id,
        userId: user.id,
        error: err,
      });
      setError(err instanceof Error ? `Failed to send chat message: ${err.message}` : 'Failed to send chat message.');
    } finally {
      setIsSendingMessage(false);
    }
  };

  const openMobileChat = () => {
    if (!shouldShowMatchChat) return;
    setIsMobileChatOpen(true);
    setSeenIncomingMessageCount(incomingMessageCount);
  };

  const closeMobileChat = () => {
    setIsMobileChatOpen(false);
  };

  const matchChatPanel = (
    <div className="space-y-4 rounded-2xl border p-4 theme-panel backdrop-blur-xl sm:p-6 lg:w-full lg:max-w-[min(860px,90vw)] lg:max-h-[clamp(16rem,35vh,20rem)] lg:overflow-hidden">
      <div className="grid items-center gap-3 grid-cols-1">
        <h3 className="text-center text-sm font-bold uppercase tracking-widest theme-text-muted">
          {matchChatTitle}
        </h3>
      </div>

      <div className="h-[min(44dvh,22rem)] space-y-3 overflow-y-auto pr-1 custom-scrollbar lg:h-auto lg:max-h-[clamp(10rem,22vh,14rem)]">
        {messages.length === 0 ? (
          <p className="text-center theme-text-muted italic text-sm py-10">No messages yet. Say something funny.</p>
        ) : (
          messages.map(m => (
            <div key={m.id} className={`flex gap-3 ${m.uid === user?.id ? 'flex-row-reverse' : ''}`}>
              <div className="w-9 h-9 sm:w-10 sm:h-10 theme-avatar-surface rounded-full flex items-center justify-center text-sm shrink-0 overflow-hidden shadow-inner border">
                {m.avatarUrl ? <img src={m.avatarUrl} alt="Avatar" className="w-full h-full object-cover" decoding="async" /> : '👤'}
              </div>
              <div className={`max-w-[78%] p-3 sm:p-4 rounded-2xl text-sm shadow-md ${m.messageType === 'system'
                ? 'mx-auto theme-soft-surface border text-center'
                : m.uid === user?.id
                  ? 'bg-purple-600 text-white rounded-tr-sm'
                  : 'theme-soft-surface rounded-tl-sm border'
                }`}>
                <p className="text-[0.625rem] font-bold opacity-60 mb-1 uppercase tracking-wider">{m.name}</p>
                <p className="leading-relaxed">{m.text}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-3 pt-1">
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
          placeholder="Type a message..."
          disabled={isSendingMessage}
          className="min-h-12 flex-1 rounded-xl border px-4 py-3 text-sm theme-input theme-inset transition-all duration-300 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
        />
        <button type="button"
          onClick={() => handleSendMessage()}
          disabled={isSendingMessage || !chatInput.trim()}
          className="flex min-h-12 min-w-12 items-center justify-center rounded-xl bg-purple-600 p-3 transition-all duration-300 hover:bg-purple-500 shadow-[0_4px_14px_0_rgba(147,51,234,0.39)] hover:shadow-[0_6px_20px_rgba(147,51,234,0.23)] active:scale-[0.96] disabled:opacity-50"
        >
          {isSendingMessage ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
        </button>
      </div>
    </div>
  );

  if (isInitializing) {
    console.debug('[App] Initializing auth...');
    return (
      <>
        <audio ref={themeAudioRef} src={themeAudioSrc} loop />
        <audio ref={welcomeAudioRef} src={welcomeAudioSrc} />
        <audio ref={correctAudioRef} src={correctAudioSrc} />
        <audio ref={wrongAudioRef} src={wrongAudioSrc} />
        <audio ref={timesUpAudioRef} src={timesUpAudioSrc} />
        <audio ref={wonAudioRef} src={wonAudioSrc} />
        <audio ref={lostAudioRef} src={lostAudioSrc} />
        <audio ref={newGameAudioRef} src={newGameAudioSrc} />
        <audio ref={heckleChimeAudioRef} src={heckleChimeAudioSrc} />

        <div data-theme={themeMode} className="app-theme min-h-screen flex flex-col items-center justify-center p-6 space-y-6 relative">
          <Loader2 className="h-10 w-10 animate-spin text-pink-500" />
          <div className="text-center space-y-2">
            <p className="text-sm font-black uppercase tracking-[0.3em] theme-text-muted">Checking sign-in</p>
            <p className="text-sm theme-text-muted">Finishing login and restoring your session...</p>
          </div>
        </div>
      </>
    );
  }

  if (!user) {
    console.debug('[App] No user found. Showing AuthScreen.');
    return (
      <>
        <audio ref={themeAudioRef} src={themeAudioSrc} loop />
        <audio ref={welcomeAudioRef} src={welcomeAudioSrc} />
        <audio ref={correctAudioRef} src={correctAudioSrc} />
        <audio ref={wrongAudioRef} src={wrongAudioSrc} />
        <audio ref={timesUpAudioRef} src={timesUpAudioSrc} />
        <audio ref={wonAudioRef} src={wonAudioSrc} />
        <audio ref={lostAudioRef} src={lostAudioSrc} />
        <audio ref={newGameAudioRef} src={newGameAudioSrc} />
        <audio ref={heckleChimeAudioRef} src={heckleChimeAudioSrc} />

        <div data-theme={themeMode} className="app-theme h-dvh min-h-dvh flex flex-col items-center px-4 pt-6 pb-5 sm:px-6 sm:pt-8 sm:pb-6 relative overflow-hidden">
          <div className="absolute top-6 right-6 flex gap-3 z-50">
            <button type="button"
              onClick={() => updateSettings({ themeMode: themeMode === 'dark' ? 'light' : 'dark' })}
              className="p-4 rounded-full theme-button transition-colors"
              title={themeMode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {themeMode === 'dark' ? <Sun className="w-5 h-5 text-amber-500" /> : <Moon className="w-5 h-5 text-cyan-500" />}
            </button>
            <button type="button"
              onClick={() => {
                if (settings.soundEnabled) {
                  void applySettingsPatch({ soundEnabled: false });
                  return;
                }
                void handleEnableSound();
              }}
              className="p-4 rounded-full theme-button transition-colors"
              title={settings.soundEnabled ? "Mute Audio" : "Play Audio"}
            >
              {settings.soundEnabled ? <Volume2 className="w-6 h-6 text-cyan-400" /> : <VolumeX className="w-6 h-6 theme-text-muted" />}
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm space-y-4 sm:space-y-5 mt-6 sm:mt-8">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center relative"
            >
              <div className="relative inline-block aspect-square w-[min(70vw,19.125rem)] sm:w-[min(53.5vw,22.95rem)]">
                <img
                  src={logoSrc}
                  alt="A F-cking Trivia Game"
                  className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]"
                  referrerPolicy="no-referrer"
                />
              </div>
            </motion.div>

            {!isMagicLinkSent ? (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full h-[8.5rem] px-3 sm:h-[9rem] sm:px-4"
              >
                <div className="mx-auto flex h-full max-w-xl items-center justify-center rounded-2xl border border-white/10 bg-black/15 px-5 py-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm">
                  <div className="relative flex w-full items-center justify-center">
                    <p
                      aria-hidden="true"
                      className="invisible text-[1.28rem] leading-relaxed sm:text-[1.5rem]"
                      style={{ fontFamily: 'var(--font-typewriter)', color: 'var(--app-text)' }}
                    >
                      {activeSignInMarqueeLine}
                    </p>
                    <p
                      className="absolute inset-0 flex items-center justify-center text-[1.28rem] leading-relaxed sm:text-[1.5rem]"
                      style={{ fontFamily: 'var(--font-typewriter)', color: 'var(--app-text)' }}
                    >
                      <span>
                        {renderedSignInMarqueeLine}
                        {renderedSignInMarqueeLine.length < activeSignInMarqueeLine.length ? (
                          <span className="ml-0.5 inline-block h-[1.05em] w-[0.55ch] translate-y-[0.08em] animate-pulse rounded-[1px] bg-pink-400/90 align-middle" />
                        ) : null}
                      </span>
                    </p>
                  </div>
                </div>
              </motion.div>
            ) : null}

            <AnimatePresence mode="wait">
              {isMagicLinkSent ? (
                <motion.div
                  key="success-step"
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="w-full theme-panel border p-6 rounded-2xl text-center space-y-4 shadow-xl"
                >
                  <div className="w-16 h-16 bg-pink-600/20 rounded-full flex items-center justify-center mx-auto">
                    <Mail className="w-8 h-8 text-pink-500" />
                  </div>
                  <h3 className="text-xl font-black uppercase">Check Your Inbox</h3>
                  <p className="text-sm theme-text-secondary leading-relaxed">
                    We sent a sign-in link to <span className="text-pink-500 font-bold">{email}</span>.<br />
                    Click it to join the game instantly.
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setIsMagicLinkSent(false)}
                      className="text-xs font-bold uppercase tracking-widest theme-text-muted hover:text-pink-500 transition-colors"
                    >
                      Wrong email? Try again
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="form-step"
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -20, opacity: 0 }}
                  className="w-full space-y-6"
                >
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => void handleGoogleSignIn()}
                      disabled={authLoading}
                      className="group w-full h-14 flex items-center justify-center gap-3 rounded-2xl border bg-white text-[#1f1f1f] font-bold tracking-[0.01em] transition-all active:scale-[0.99] disabled:opacity-50 shadow-[0_10px_30px_rgba(0,0,0,0.16)] hover:shadow-[0_14px_36px_rgba(0,0,0,0.2)]"
                      style={{ borderColor: 'rgba(0,0,0,0.12)' }}
                    >
                      {authLoading && authLoadingMode === 'google' ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]">
                            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4.5 w-4.5">
                              <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.26-.96 2.32-2.04 3.03l3.3 2.56c1.92-1.77 3.03-4.38 3.03-7.48 0-.71-.06-1.4-.18-2.06H12z" />
                              <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.3-2.56c-.91.61-2.08.97-3.32.97-2.55 0-4.72-1.72-5.49-4.03l-3.41 2.63A9.99 9.99 0 0 0 12 22z" />
                              <path fill="#4A90E2" d="M3.59 14.55A9.98 9.98 0 0 1 3 11.99c0-.89.15-1.75.41-2.55L0 6.82A10 10 0 0 0 0 17.18l3.59-2.63z" />
                              <path fill="#FBBC05" d="M12 4.02c1.47 0 2.8.51 3.84 1.52l2.88-2.88C16.95 1.03 14.7 0 12 0 8.09 0 4.73 2.24 3.1 5.5l3.41 2.64C7.28 5.75 9.45 4.02 12 4.02z" />
                            </svg>
                          </span>
                          <span className="text-[0.95rem]">Sign in with Google</span>
                        </>
                      )}
                    </button>

                    {showEmailSignIn ? (
                      <div className="space-y-4 rounded-2xl theme-panel border p-4">
                        <div className="relative group">
                          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 theme-text-muted group-focus-within:text-pink-500 transition-colors" />
                          <input
                            type="email"
                            placeholder="your@email.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMagicLink()}
                            className="w-full h-14 pl-12 pr-4 rounded-2xl theme-panel border bg-transparent focus:outline-none focus:ring-2 focus:ring-pink-500/50 transition-all text-base theme-inset"
                            autoComplete="email"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={handleSendMagicLink}
                          disabled={authLoading}
                          className="w-full h-14 flex items-center justify-center rounded-2xl bg-pink-600 text-white font-black uppercase tracking-widest hover:bg-pink-500 transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-pink-900/20"
                        >
                          {authLoading && authLoadingMode === 'magic-link' ? (
                            <Loader2 className="w-6 h-6 animate-spin" />
                          ) : (
                            'Send Login Link'
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="text-center">
                        <button
                          type="button"
                          onClick={handleShowEmailSignIn}
                          disabled={authLoading}
                          className="text-[0.63rem] font-semibold uppercase tracking-[0.18em] theme-text-muted transition-colors hover:text-pink-500 disabled:opacity-50"
                        >
                          Prefer email instead?
                        </button>
                      </div>
                    )}
                  </div>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 rounded-2xl border border-rose-500/40 bg-rose-950/40 text-rose-100 text-sm font-bold text-center shadow-inner"
                    >
                      {error}
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="w-full text-center space-y-2">
              {audioNeedsInteraction && settings.soundEnabled && (
                <button
                  type="button"
                  onClick={() => void handleEnableSound()}
                  className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-100"
                >
                  Tap to enable sound
                </button>
              )}
              <p className="theme-text-muted font-bold text-[0.625rem] uppercase tracking-widest opacity-60">
                Pure Trivia. No Ads. No Bullsh*t. 🚫
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!hasResolvedProfile || isEnsuringProfile) {
    console.debug('[App] User present but profile still resolving...');
    return (
      <div data-theme={themeMode} className="app-theme min-h-screen flex flex-col items-center justify-center p-6 space-y-6 relative">
        <Loader2 className="h-10 w-10 animate-spin text-pink-500" />
        <div className="text-center space-y-2">
          <p className="text-sm font-black uppercase tracking-[0.3em] theme-text-muted">Checking Profile</p>
          <p className="text-sm theme-text-muted">One moment, while we gear up for your game...</p>
        </div>
      </div>
    );
  }

  if (user && !playerProfile && hasResolvedProfile) {
    console.debug('[App] No profile found. Showing NicknameScreen.');
    return (
      <div data-theme={themeMode} className="app-theme h-dvh min-h-dvh flex flex-col items-center px-4 pt-12 pb-5 relative overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm space-y-8">
          <div className="text-center space-y-4">
            <h2 className="text-3xl font-black uppercase tracking-tight">One Last Thing</h2>
            <p className="theme-text-muted">What should we call you while we’re roasting you?</p>
          </div>

          <div className="w-full space-y-4">
            <div className="relative group">
              <input
                type="text"
                placeholder="Pick a nickname..."
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveNickname()}
                maxLength={MAX_NICKNAME_LENGTH}
                className="w-full h-14 px-6 rounded-2xl theme-panel border bg-transparent focus:outline-none focus:ring-2 focus:ring-pink-500/50 transition-all text-lg font-bold theme-inset text-center"
                autoFocus
              />
            </div>

            <button
              type="button"
              onClick={handleSaveNickname}
              disabled={isSavingNickname || !sanitizeNicknameInput(nickname)}
              className="w-full h-14 flex items-center justify-center rounded-2xl bg-pink-600 text-white font-black uppercase tracking-widest hover:bg-pink-500 transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-pink-900/20"
            >
              {isSavingNickname ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                'Start Playing'
              )}
            </button>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-2xl border border-rose-500/40 bg-rose-950/40 text-rose-100 text-sm font-bold text-center shadow-inner"
            >
              {error}
            </motion.div>
          )}

          <button
            onClick={() => signOutUser()}
            className="text-xs font-bold uppercase tracking-widest theme-text-muted hover:text-pink-500 transition-colors"
          >
            Actually, let me out of here
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <audio ref={themeAudioRef} src={themeAudioSrc} loop />
      <audio ref={welcomeAudioRef} src={welcomeAudioSrc} />
      <audio ref={correctAudioRef} src={correctAudioSrc} />
      <audio ref={wrongAudioRef} src={wrongAudioSrc} />
      <audio ref={timesUpAudioRef} src={timesUpAudioSrc} />
      <audio ref={wonAudioRef} src={wonAudioSrc} />
      <audio ref={lostAudioRef} src={lostAudioSrc} />
      <audio ref={newGameAudioRef} src={newGameAudioSrc} />
      <audio ref={heckleChimeAudioRef} src={heckleChimeAudioSrc} />
      <InstallPrompt />

      <div data-theme={themeMode} className="app-theme flex min-h-dvh flex-col overflow-x-hidden font-sans">
        {!isQuestionActive && (
          <header className="z-40 shrink-0 border-b px-3 py-2.5 theme-panel backdrop-blur-md sm:px-4 sm:py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 sm:gap-4">
                <button type="button"
                  onClick={() => {
                    if (settings.soundEnabled) {
                      void applySettingsPatch({ soundEnabled: false });
                      return;
                    }
                    void handleEnableSound();
                  }}
                  className="min-h-12 min-w-12 rounded-full p-2 theme-icon-button transition-colors"
                  aria-label={settings.soundEnabled ? 'Mute all sound' : 'Enable sound'}
                >
                  {settings.soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                </button>
                <button type="button"
                  onClick={() => updateSettings({ themeMode: themeMode === 'dark' ? 'light' : 'dark' })}
                  className="min-h-12 min-w-12 rounded-full p-2 theme-icon-button transition-colors"
                  title={themeMode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                  aria-label={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {themeMode === 'dark' ? <Sun className="w-5 h-5 text-amber-500" /> : <Moon className="w-5 h-5 text-cyan-500" />}
                </button>
                <button type="button"
                  onClick={() => setShowSettings(true)}
                  className="min-h-12 min-w-12 rounded-full p-2 theme-icon-button transition-colors"
                  title="Settings"
                  aria-label="Open settings"
                >
                  <SlidersHorizontal className="w-5 h-5" />
                </button>
                {import.meta.env.DEV && (
                  <button type="button"
                    onClick={() => setShowQuestionBankAdmin(true)}
                    className="rounded-xl px-3 py-2 text-xs font-black uppercase tracking-widest theme-button"
                    title="Question Bank Admin"
                    aria-label="Open question bank admin"
                  >
                    Dev
                  </button>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:gap-4">
                {game && (
                  <button type="button"
                    onClick={openQuitConfirm}
                    className="min-h-12 min-w-12 rounded-full p-2 theme-icon-button transition-colors"
                    title="Pause Match"
                    aria-label="Pause current match"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <button type="button" onClick={openSignOutConfirm} className="min-h-12 min-w-12 rounded-full p-2 theme-icon-button transition-colors" aria-label="Sign out">
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </div>
          </header>
        )}

        <main className={`mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 pb-4 sm:px-4 sm:pb-5 ${isQuestionActive ? 'pt-4 sm:pt-6' : 'pt-3 sm:pt-4'}`}>
          <AnimatePresence>
            {audioNeedsInteraction && settings.soundEnabled && (
              <motion.div
                key="audio-banner"
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="mb-6 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 shadow-[0_8px_20px_rgba(6,182,212,0.12)]"
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-cyan-950 dark:text-cyan-100">Tap to enable sound.</p>
                  <button
                    type="button"
                    onClick={() => void handleEnableSound()}
                    className="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-black uppercase tracking-widest text-cyan-950"
                  >
                    Enable
                  </button>
                </div>
              </motion.div>
            )}
            {!isOnline && (
              <motion.div
                key="offline-banner"
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 shadow-[0_8px_20px_rgba(245,158,11,0.12)]"
                role="status"
                aria-live="polite"
              >
                <p className="mb-1 text-xs font-black uppercase tracking-[0.22em] text-amber-400">
                  Offline mode
                </p>
                <p className="text-sm theme-text-secondary">
                  Reconnect to resume multiplayer sync, AI question generation, and invite updates.
                </p>
              </motion.div>
            )}
            {error && (
              <motion.div
                key="error-banner"
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="mb-6 p-4 bg-rose-950/40 border border-rose-500/30 rounded-xl flex items-center justify-between shadow-[0_8px_20px_rgba(244,63,94,0.15)]"
                role="alert"
              >
                <span className="text-rose-400 text-sm font-medium">{error}</span>
                <button type="button" onClick={() => setError(null)} className="p-1 hover:bg-rose-500/20 rounded-lg transition-colors text-rose-400" aria-label="Dismiss error message">
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}
            {resumeBanner && (
              <motion.div
                key="resume-banner"
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="mb-6 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 shadow-[0_8px_20px_rgba(6,182,212,0.12)]"
                role="status"
                aria-live="polite"
              >
                <p className="text-sm font-medium text-cyan-100">{resumeBanner}</p>
              </motion.div>
            )}
          </AnimatePresence>


          <AnimatePresence mode="wait">
            {!game ? (
              <div key="lobby-view" className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
                {resumePrompt && (
                  <div className="mb-6 rounded-2xl border theme-panel-strong backdrop-blur-xl p-5 shadow-[0_12px_30px_rgba(0,0,0,0.18)]">
                    <p className="text-[0.625rem] font-black uppercase tracking-[0.22em] theme-text-muted mb-2">
                      Resume Match
                    </p>
                    <h2 className="text-2xl font-black tracking-tight mb-2">
                      {resumePrompt.isSolo ? 'Resume your solo game?' : 'Resume your multiplayer game?'}
                    </h2>
                    <p className="text-sm theme-text-secondary mb-4">
                      There is still an active {resumePrompt.isSolo ? 'solo' : 'multiplayer'} match for ID {resumePrompt.game.id}. Resume it or abandon it and return to the lobby.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        type="button"
                        onClick={handleResumeGame}
                        className="flex-1 rounded-xl bg-cyan-500 px-5 py-3 text-sm font-black uppercase tracking-widest text-cyan-950 transition-all duration-300 hover:bg-cyan-400"
                      >
                        Resume Game
                      </button>
                      <button
                        type="button"
                        onClick={handleStartNewInstead}
                        className="flex-1 rounded-xl theme-button px-5 py-3 text-sm font-black uppercase tracking-widest transition-all duration-300"
                      >
                        Start New Game
                      </button>
                    </div>
                  </div>
                )}
                <div
                  className={`h-full min-h-0 transition-all duration-300 ${resumePrompt
                      ? 'pointer-events-none opacity-40'
                      : ''
                    }`}
                >
                  <GameLobby
                    onStartSolo={startSoloGame}
                    onStartMulti={startMultiplayerGame}
                    onJoinMulti={joinGame}
                    isLoading={isLobbyBusy}
                    loadingTitle={lobbyLoadingCopy.title}
                    loadingFlow={lobbyLoadingCopy.flow}
                    recentPlayers={recentPlayers}
                    recentPlayersStatus={recentPlayersStatus}
                    recentPlayersError={recentPlayersError}
                    playerProfile={playerProfile}
                    profileError={profileError}
                    recentCompletedGames={recentCompletedGames}
                    recentCompletedGamesStatus={recentGamesStatus}
                    recentCompletedGamesError={recentGamesError}
                    selectedMatchup={selectedMatchup}
                    isLoadingMatchup={isLoadingMatchup}
                    incomingInvites={incomingInvites}
                    incomingInvitesStatus={invitesStatus}
                    incomingInvitesError={invitesError}
                    onInviteRecentPlayer={inviteRecentPlayer}
                    onInspectMatchup={handleInspectMatchup}
                    onCloseMatchup={handleCloseMatchup}
                    onRemoveRecentPlayer={handleRemoveRecentPlayer}
                    onAcceptInvite={handleAcceptInvite}
                    onDeclineInvite={handleDeclineInvite}
                    onAvatarChange={handleSaveAvatar}
                    onAvatarRemove={handleRemoveAvatar}
                    inviteFeedback={inviteFeedback}
                    displayName={truncateHeaderDisplayName(playerProfile?.nickname || user?.email || 'Player')}
                    nickname={nickname}
                    isEditingNickname={isEditingNickname}
                    isSavingNickname={isSavingNickname}
                    onNicknameChange={setNickname}
                    onStartNicknameEdit={handleStartNicknameEdit}
                    onSaveNickname={handleSaveNickname}
                    onCancelNicknameEdit={handleCancelNicknameEdit}
                  />
                </div>
              </div>
            ) : (
              <motion.div
                key="game-view"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden sm:gap-6 lg:items-center lg:gap-7 lg:pb-4"
              >
                {game.status === 'waiting' && (
                  <div className="flex shrink-0 self-stretch rounded-2xl border p-4 theme-panel backdrop-blur-sm sm:self-end sm:p-5">
                    <div className="flex items-center gap-3 px-4">
                      <button
                        type="button"
                        onClick={() => void handleCopyMatchId()}
                        className="inline-flex items-center gap-2 rounded-xl theme-button px-3 py-2 text-xs font-black uppercase tracking-widest transition-all duration-300"
                        aria-label="Copy match ID"
                        title="Copy match ID"
                      >
                        {matchIdCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        {matchIdCopied ? 'Copied' : 'Copy'}
                      </button>
                      <div className="text-right">
                        <p className="text-[0.625rem] font-black uppercase tracking-widest theme-text-muted mb-1">Match ID</p>
                        <p className="text-lg sm:text-xl font-black text-pink-500 tracking-tight leading-tight break-all">{game.id}</p>
                      </div>
                    </div>
                  </div>
                )}

                {!isQuestionActive && (
                  <div className="mx-auto w-[90%] shrink-0 space-y-2 min-[520px]:w-full lg:w-full lg:max-w-[min(860px,90vw)] lg:space-y-4">
                    <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 sm:gap-4">
                      {players.map(p => (
                        <CategoryTracker
                          key={p.uid}
                          playerName={p.name}
                          avatarUrl={p.avatarUrl}
                          completed={p.completedCategories}
                          isCurrentTurn={game.currentTurn === p.uid}
                          score={p.score}
                          onAvatarClick={shouldShowMatchChat ? openMobileChat : undefined}
                          unreadCount={p.uid !== user?.id ? unreadIncomingMessageCount : 0}
                          unreadBadgeClassName={mobileChatBadgeClass}
                        />
                      ))}
                    </div>
                    {shouldShowMatchChat && (
                      <p className="md:hidden text-center text-[0.625rem] font-bold uppercase tracking-[0.2em] theme-text-muted">
                        Tap a player avatar to open chat
                      </p>
                    )}
                  </div>
                )}

                {/* Game Content */}
                <div className={`relative flex-1 min-h-0 flex flex-col justify-center ${isQuestionActive ? 'py-2 sm:py-4' : 'py-4 sm:py-8'} lg:flex-none lg:w-full lg:max-w-[min(860px,90vw)] lg:justify-start lg:py-0`}>
                  {game.status === 'completed' ? (
                    <div className="rounded-3xl border p-6 text-center theme-panel opacity-70 sm:p-12 lg:w-full">
                      <p className="text-sm font-bold uppercase tracking-[0.24em] theme-text-muted">
                        Match Complete
                      </p>
                    </div>
                  ) : shouldShowCurrentTurnStage ? (
                    <div className="space-y-5 sm:space-y-8 lg:flex lg:w-full lg:flex-col lg:items-center lg:gap-6 lg:space-y-0">
                      {!currentQuestion ? (
                        <div className="flex flex-col items-center gap-5 sm:gap-8 lg:w-full lg:gap-0">
                          <div className="lg:flex lg:w-full lg:justify-center lg:pb-5">
                            <p className="text-sm sm:text-base font-black uppercase tracking-widest text-cyan-400 animate-pulse lg:text-center">Your Turn</p>
                          </div>
                          {manualPickReady && showManualPickPrompt ? (
                            <ManualCategoryPrompt
                              source={manualPickSource}
                              categories={playableCategories}
                              completedCategories={currentPlayer?.completedCategories ?? []}
                              onPickCategory={handleManualCategoryPick}
                              onSpinWheel={handleDeclineManualPick}
                            />
                          ) : (
                            <div className="lg:relative lg:flex lg:w-full lg:justify-center lg:py-4">
                              <Wheel
                                onSpinComplete={handleSpinComplete}
                                isSpinning={isSpinning}
                                setIsSpinning={setIsSpinning}
                                soundEnabled={sfxEnabled}
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className={`transition-all duration-300 lg:w-full ${shouldBlurQuestionBackground ? 'blur-sm scale-[0.99]' : ''}`}>
                          <QuestionCard
                            question={currentQuestion}
                            onSelect={handleAnswer}
                            disabled={resultPhase !== 'idle' || !!roast || selectedAnswer !== null}
                            selectedId={selectedAnswer}
                            correctId={correctAnswer}
                            timerProgress={questionTimerProgress}
                            timeRemaining={questionTimeRemaining}
                          />
                        </div>
                      )}
                    </div>
                  ) : game.status === 'waiting' ? (
                    <div className="rounded-3xl border p-6 text-center theme-panel sm:p-12 lg:w-full">
                      <Loader2 className="w-8 h-8 text-pink-500 animate-spin mx-auto mb-4" />
                      <p className="text-lg font-medium theme-text-muted">
                        Waiting for another player to join...
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-3xl border p-6 text-center theme-panel sm:space-y-5 sm:p-12 lg:w-full">
                      <Loader2 className="w-8 h-8 text-pink-500 animate-spin mx-auto mb-4" />
                      <p className="text-lg font-medium theme-text-muted">Waiting for {players.find(p => p.uid === game.currentTurn)?.name} to spin...</p>
                      <HeckleOverlay
                        message={activeHeckle}
                        visible={showHeckle && shouldShowOpponentHeckles}
                        onClose={dismissHeckleOverlay}
                      />
                    </div>
                  )}
                </div>

                {shouldShowMatchChat && (
                  <div className="hidden md:block shrink-0 lg:w-full lg:max-w-[min(860px,90vw)]">
                    {matchChatPanel}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <AnimatePresence>
          {shouldShowMatchChat && isMobileChatOpen && (
            <motion.div
              key="mobile-chat-sheet"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[120] flex items-end md:hidden theme-overlay backdrop-blur-sm"
              onClick={closeMobileChat}
              role="dialog"
              aria-modal="true"
              aria-label={matchChatTitle}
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                className="w-full max-h-[82dvh] rounded-t-[1.75rem] p-3"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="theme-panel-strong border rounded-t-[1.5rem] rounded-b-2xl p-3 shadow-[0_-20px_50px_rgba(0,0,0,0.35)]">
                  <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-white/20" />
                  <div className="mb-3 flex items-center justify-between gap-3 px-1">
                    <div>
                      <p className="text-[0.625rem] font-black uppercase tracking-[0.22em] theme-text-muted">Match Chat</p>
                      <h3 className="text-base font-black">{matchChatTitle}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={closeMobileChat}
                      className="p-2 rounded-full theme-icon-button transition-colors"
                      aria-label="Close chat"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  {matchChatPanel}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Roast Overlay */}
        {roast && (
          <Roast
            explanation={roast.explanation}
            isCorrect={roast.isCorrect}
            questionId={roast.questionId}
            wrongAnswerQuip={roast.wrongAnswerQuip}
            userId={roast.userId}
            gameId={roast.gameId}
            onClose={nextTurn}
          />
        )}

        <CategoryReveal category={revealedCategory} />

        <TrashTalkOverlay
          event={activeTrashTalkEvent}
          message={activeTrashTalk}
          onClose={dismissTrashTalkOverlay}
        />

        {isCompletedMatch && completedMatchWinner && completedMatchLoser && (
          <EndgameOverlay
            isOpen={true}
            isWinner={isViewingWinningEndgame}
            winnerName={completedMatchWinner.name || 'Winner'}
            loserName={completedMatchLoser.name || 'Loser'}
            winnerScore={completedMatchWinner.score || 0}
            loserScore={completedMatchLoser.score || 0}
            winnerTrophies={completedMatchWinner.completedCategories?.length ?? 0}
            loserTrophies={completedMatchLoser.completedCategories?.length ?? 0}
            trophyTarget={trophyTarget}
            message={endgameViewerMessage}
            isGeneratingMessage={isGeneratingEndgameRoast && !endgameRoast}
            canPlayAgain={game.hostId === user.id}
            isStartingGame={isStartingGame}
            onPlayAgain={playAgain}
            onExitToLobby={exitCompletedMatchToLobby}
          />
        )}

        <Suspense fallback={null}>
          <SettingsModal
            isOpen={showSettings}
            settings={settings}
            syncStatus={remoteSettingsResolved ? 'idle' : 'loading'}
            syncError={remoteSettingsError}
            onClose={() => setShowSettings(false)}
            onUpdate={(patch) => {
              const shouldUnlockAudio =
                (patch.soundEnabled === true && !settings.soundEnabled) ||
                (patch.musicEnabled === true && settings.soundEnabled);
              void applySettingsPatch(patch, { unlockAudio: shouldUnlockAudio });
            }}
            onSignOut={openSignOutConfirm}
          />
        </Suspense>

        <ConfirmModal
          isOpen={confirmAction !== null}
          title={confirmAction === 'quit' ? 'Pause Match?' : 'Sign Out?'}
          message={
            confirmAction === 'quit'
              ? 'Leave this match for now? You can resume it later from the lobby.'
              : 'Sign out and return to the login screen?'
          }
          confirmLabel={confirmAction === 'quit' ? 'Back to Lobby' : 'Sign Out'}
          onCancel={closeConfirm}
          onConfirm={confirmAction === 'quit' ? handleConfirmedQuit : handleConfirmedSignOut}
        />

        {import.meta.env.DEV && (
          <Suspense fallback={null}>
            <QuestionBankAdmin
              isOpen={showQuestionBankAdmin}
              onClose={() => setShowQuestionBankAdmin(false)}
            />
          </Suspense>
        )}
      </div>
    </>
  );
}
