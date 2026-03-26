/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { supabase } from './lib/supabase';
import { signInWithGoogle, signOutUser, onAuthStateChange } from './services/auth';
import {
  recordAnswer,
  subscribeToGame,
  createGame,
  joinGame,
  updateGame,
  getGameById,
  persistQuestionsToGame,
  updatePlayerActivity,
  abandonGame,
  setActiveGameQuestion,
  clearActiveGameQuestion,
  subscribeToMessages,
  getGameQuestions,
  sendMessage,
} from './services/gameService';


import { ChatMessage, GameAnswer, GameInvite, GameState, MatchupSummary, Player, PlayerProfile, RecentCompletedGame, RecentPlayer, RoastState, TriviaQuestion, UserSettings, getPlayableCategories } from './types';
import { QUESTION_COLLECTION } from './services/questionCollections';
import { getQuestionsForSession, markQuestionSeen } from './services/questionRepository';
import { acceptInvite, declineInvite, expireInvite, sendInvite, subscribeToIncomingInvites } from './services/invites';
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
import { HECKLE_ROTATION_MS, shouldEnableHeckles } from './content/heckles';
import { getTrashTalkLine, TrashTalkEvent } from './content/trashTalk';
import { publicAsset } from './assets';
import { motion, AnimatePresence } from 'motion/react';
import { LogOut, RefreshCcw, Trophy, ArrowLeft, Volume2, VolumeX, Send, Loader2, History, X, Sun, Moon, SlidersHorizontal } from 'lucide-react';
import confetti from 'canvas-confetti';
import { omitUndefinedFields } from './services/firestoreData';
import { DEFAULT_USER_SETTINGS, getLocalSettings, loadUserSettings, mergeSettings, saveLocalSettings, saveUserSettings } from './services/userSettings';
import { generateHeckles } from './services/gemini';
import { notifySafe, requestNotificationPermissionSafe } from './services/notify';
import {
  ensurePlayerProfile,
  loadMatchupHistory,
  recordCompletedGame,
  recordQuestionStats,
  removeRecentPlayer,
  subscribePlayerProfile,
  subscribeRecentCompletedGames,
  subscribeRecentPlayers,
  updatePlayer,
} from './services/playerProfiles';


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

const SettingsModal = lazy(() => import('./components/SettingsModal').then((module) => ({ default: module.SettingsModal })));

const QUESTION_LOADING_LINES = [
  'Stealing questions from smarter people...',
  'Calibrating your inevitable disappointment...',
  'Googling things you should already know...',
  'Dusting off facts nobody asked for...',
  'Assembling trivia with suspicious confidence...',
  'Curating questions to expose your weak spots...',
  'Searching for knowledge and bad decisions...',
  'Preheating the humiliation engine...',
  'Loading facts you will absolutely overthink...',
  'Finding questions with just enough cruelty...',
  'Rummaging through humanity’s collective homework...',
  'Preparing multiple-choice regret...',
  'Harvesting obscure confidence destroyers...',
  'Compiling reasons to doubt your education...',
  'Tuning the difficulty to “fairly rude”...',
  'Locating facts that should ring a bell...',
  'Polishing questions for your public struggle...',
  'Stacking the deck with educational menace...',
  'Retrieving trivia from the smug part of the internet...',
  'Warming up the next opportunity to be wrong...',
];

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

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.9-5.4 3.9-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.8 0 3.1.8 3.8 1.4l2.6-2.5C16.7 3.3 14.6 2.4 12 2.4 6.8 2.4 2.6 6.7 2.6 12s4.2 9.6 9.4 9.6c5.4 0 9-3.8 9-9.1 0-.6-.1-1.1-.2-1.6H12Z"
      />
      <path
        fill="#4285F4"
        d="M21 12.5c0-.6-.1-1.1-.2-1.6H12v3.9h5.4c-.3 1.5-1.2 2.7-2.4 3.5l3.7 2.8c2.1-2 3.3-4.9 3.3-8.6Z"
      />
      <path
        fill="#FBBC05"
        d="M6.1 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3L2.3 6.8C1.5 8.4 1 10.1 1 12s.5 3.6 1.3 5.2l3.8-2.9Z"
      />
      <path
        fill="#34A853"
        d="M12 21.6c2.6 0 4.8-.9 6.4-2.5l-3.7-2.8c-1 .7-2.2 1.2-3.7 1.2-3.2 0-5.9-2.7-5.9-6 0-.8.2-1.6.4-2.3L2.3 6.8C1.5 8.4 1 10.1 1 12c0 5.3 4.2 9.6 9.4 9.6Z"
      />
    </svg>
  );
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

export default function App() {
  const QUESTION_TIME_LIMIT_SECONDS = 20;
  const themeAudioSrc = publicAsset('theme.mp3');
  const correctAudioSrc = publicAsset('correct.mp3');
  const wrongAudioSrc = publicAsset('wrong.mp3');
  const timesUpAudioSrc = publicAsset('times-up.mp3');
  const wonAudioSrc = publicAsset('won.mp3');
  const lostAudioSrc = publicAsset('lost.mp3');
  const logoSrc = publicAsset('logo.png');

  const [user, setUser] = useState<any | null>(null);

  const [game, setGame] = useState<GameState | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [questions, setQuestions] = useState<TriviaQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<TriviaQuestion | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [roast, setRoast] = useState<RoastState | null>(null);
  const [resultPhase, setResultPhase] = useState<ResultPhase>('idle');
  const [queuedSpecialEvent, setQueuedSpecialEvent] = useState<QueuedSpecialEvent | null>(null);

  // Granular loading states
  const [hasResolvedInitialAuthState, setHasResolvedInitialAuthState] = useState(false);
  const [hasResolvedRedirectSignIn, setHasResolvedRedirectSignIn] = useState(false);
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [isJoiningGame, setIsJoiningGame] = useState(false);
  const [isFetchingQuestions, setIsFetchingQuestions] = useState(false);
  const [loadingStep, setLoadingStep] = useState<LoadingStep>('idle');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [activeQuestionLoadingLine, setActiveQuestionLoadingLine] = useState(
    () => QUESTION_LOADING_LINES[Math.floor(Math.random() * QUESTION_LOADING_LINES.length)]
  );

  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [isSolo, setIsSolo] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(() => getLocalSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [remoteSettingsResolved, setRemoteSettingsResolved] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const [seenIncomingMessageCount, setSeenIncomingMessageCount] = useState(0);
  const [recentPlayers, setRecentPlayers] = useState<RecentPlayer[]>([]);
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);
  const [incomingInvites, setIncomingInvites] = useState<GameInvite[]>([]);
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);

  const [pastGames, setPastGames] = useState<GameState[]>([]);
  const [recentCompletedGames, setRecentCompletedGames] = useState<RecentCompletedGame[]>([]);
  const [selectedMatchup, setSelectedMatchup] = useState<MatchupHistoryState | null>(null);
  const [isLoadingMatchup, setIsLoadingMatchup] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [correctAnswer, setCorrectAnswer] = useState<number | null>(null);
  const [revealedCategory, setRevealedCategory] = useState<string | null>(null);
  const [questionClockNow, setQuestionClockNow] = useState(() => Date.now());
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState(false);
  const [manualPickReady, setManualPickReady] = useState(false);
  const [showManualPickPrompt, setShowManualPickPrompt] = useState(false);
  const [activeTrashTalk, setActiveTrashTalk] = useState<string | null>(null);
  const [activeTrashTalkEvent, setActiveTrashTalkEvent] = useState<TrashTalkEvent | null>(null);
  const [lastTrashTalkEvent, setLastTrashTalkEvent] = useState<TrashTalkEvent | null>(null);
  const [activeHeckle, setActiveHeckle] = useState<string | null>(null);
  const [showHeckle, setShowHeckle] = useState(false);
  const [heckleQueue, setHeckleQueue] = useState<string[]>([]);
  const [confirmAction, setConfirmAction] = useState<'quit' | 'signout' | null>(null);
  const [shouldBlurQuestionBackground, setShouldBlurQuestionBackground] = useState(false);
  const [resumePrompt, setResumePrompt] = useState<ResumePromptState | null>(null);
  const [isCheckingForResume, setIsCheckingForResume] = useState(false);
  const [resumeBanner, setResumeBanner] = useState<string | null>(null);

  const themeAudioRef = useRef<HTMLAudioElement>(null);
  const welcomeAudioRef = useRef<HTMLAudioElement>(null);
  const correctAudioRef = useRef<HTMLAudioElement>(null);
  const wrongAudioRef = useRef<HTMLAudioElement>(null);
  const timesUpAudioRef = useRef<HTMLAudioElement>(null);
  const wonAudioRef = useRef<HTMLAudioElement>(null);
  const lostAudioRef = useRef<HTMLAudioElement>(null);
  const prevGameStatus = useRef<string | null>(null);
  const revealTimeoutRef = useRef<number | null>(null);
  const categoryRevealTimeoutRef = useRef<number | null>(null);
  const questionTimeoutRef = useRef<number | null>(null);
  const questionDisplayTimerRef = useRef<number | null>(null);
  const activeQuestionIdRef = useRef<string | null>(null);
  const questionDeadlineRef = useRef<number | null>(null);
  const questionResolvedRef = useRef(false);
  const resolvedQuestionIdRef = useRef<string | null>(null);
  const heckleTimer = useRef<number | null>(null);
  const prevPlayersRef = useRef<Player[]>([]);
  const hasWarnedBehindRef = useRef(false);
  const hasTriggeredMatchLossRef = useRef(false);
  const lastSavedRemoteSettingsRef = useRef<string>('');
  const recordedRecentPairKeysRef = useRef<Set<string>>(new Set());
  const lastTurnNotificationKeyRef = useRef<string>('');
  const lastFailureRef = useRef<string>('No recent embarrassment recorded.');
  const lastHeckleTurnKeyRef = useRef<string>('');
  const heckleRequestIdRef = useRef(0);
  const welcomeAudioSrcRef = useRef(
    Math.random() < 0.5 ? publicAsset('welcome1.mp3') : publicAsset('welcome2.mp3')
  );
  const restoredQuestionStartedAtRef = useRef<number | null>(null);
  const pendingResumeRestoreRef = useRef<string | null>(null);
  const firestoreQuotaWarningShownRef = useRef(false);

  const existingQuestionIds = questions.map((question) => question.questionId || question.id);
  const playableCategories = getPlayableCategories();
  const themeMode = settings.themeMode;
  const musicEnabled = settings.soundEnabled && settings.musicEnabled;
  const sfxEnabled = settings.soundEnabled && settings.sfxEnabled;
  const isQuestionActive =
    !!currentQuestion &&
    (resultPhase === 'idle' || resultPhase === 'revealing' || resultPhase === 'explaining');
  const isInitializing = !hasResolvedInitialAuthState || !hasResolvedRedirectSignIn;

  // This function is no longer needed as per instructions
  // const reportFirestoreFailure = (
  //   err: unknown,
  //   operationType: OperationType,
  //   path: string | null,
  //   fallbackMessage: string,
  // ) => {
  //   handleFirestoreError(err, operationType, path);

  //   if (isFirestoreQuotaExceeded(err)) {
  //     if (!firestoreQuotaWarningShownRef.current) {
  //       firestoreQuotaWarningShownRef.current = true;
  //       setError(getFirestoreDisplayMessage(err, fallbackMessage));
  //     }
  //     return;
  //   }

  //   setError(getFirestoreDisplayMessage(err, fallbackMessage));
  // };

  const updateSettings = (patch: Partial<UserSettings>) => {
    setSettings((current) => ({
      ...current,
      ...patch,
      updatedAt: Date.now(),
    }));
  };

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

    if (gameId) {
      window.localStorage.setItem(ACTIVE_GAME_STORAGE_KEY, gameId);
      return;
    }

    window.localStorage.removeItem(ACTIVE_GAME_STORAGE_KEY);
  };

  const getStoredActiveGameId = () => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACTIVE_GAME_STORAGE_KEY);
  };

  const abandonGame = async (gameId: string) => {
    try {
      const gameData = await getGameById(gameId);
      if (!gameData) {
        persistActiveGameId(null);
        return;
      }

      if (gameData.status === 'completed' || gameData.status === 'abandoned') {
        persistActiveGameId(null);
        return;
      }

      await updateGame(gameId, {
        status: 'abandoned',
        current_question_id: null,
        current_question_category: null,
        current_question_started_at: null,
        last_updated: new Date().toISOString(),
      });
      persistActiveGameId(null);
    } catch (err) {
      console.error(`[abandonGame] Failed to abandon game ${gameId}:`, err);
      setError('Failed to abandon game.');
    }
  };

  const clearResumePrompt = () => {
    setResumePrompt(null);
    setIsCheckingForResume(false);
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


  const recordRecentPlayer = async (ownerId: string, player: Player, gameId: string) => {
    try {
      await updatePlayer(ownerId, player.uid, {
        uid: player.uid,
        display_name: player.name,
        photo_url: player.avatarUrl || '',
        last_played_at: new Date().toISOString(),
        last_game_id: gameId,
        hidden: false,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[recordRecentPlayer] Failed to record recent player ${player.uid} for user ${ownerId}:`, err);
      setError('Failed to record recent player.');
    }
  };

  const joinWaitingGameById = async (gameId: string, _avatarUrl: string) => {
    if (!user) return false;

    try {
      const gameData = await getGameById(gameId);
      if (!gameData) {
        setError('Invite expired. That match no longer exists.');
        return false;
      }

      if (gameData.status !== 'waiting') {
        setError('Invite expired. That match already started.');
        return false;
      }

      if (gameData.playerIds.length >= 2 && !gameData.playerIds.includes(user.id)) {
        setError('Invite expired. That match is already full.');
        return false;
      }

      const isNewJoiner = !gameData.playerIds.includes(user.id);

      if (isNewJoiner) {
        await joinGame(gameId, user.id, user.displayName || 'Player', _avatarUrl);
      }



      setLoadingStep('finalizing_lobby');
      setIsSolo(false);
      return true;
    } catch (err) {
      console.error(`[joinWaitingGameById] Failed to join game ${gameId}:`, err);
      setError('Failed to join game.');
      return false;
    }
  };


  const resolveWheelCategory = (category: string) => {
    if (category !== 'Random') return category;
    return playableCategories[Math.floor(Math.random() * playableCategories.length)];
  };

  const setActiveGameQuestion = async (gameId: string, category: string, questionId: string, questionIndex: number, startedAt: number) => {
    try {
      await updateGame(gameId, {
        current_question_id: questionId,
        current_question_category: category,
        current_question_index: questionIndex,
        current_question_started_at: startedAt,
        last_updated: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[setActiveGameQuestion] Failed to set active question for game ${gameId}:`, err);
      setError('Failed to set active question.');
    }
  };

  const clearActiveGameQuestion = async (gameId: string) => {
    try {
      await updateGame(gameId, {
        current_question_id: null,
        current_question_category: null,
        current_question_started_at: null,
        last_updated: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[clearActiveGameQuestion] Failed to clear active question for game ${gameId}:`, err);
      setError('Failed to clear active question.');
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

    if (event.event === 'MATCH_LOSS' && sfxEnabled && lostAudioRef.current) {
      lostAudioRef.current.currentTime = 0;
      lostAudioRef.current.play().catch(console.error);
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

    setActiveHeckle(null);
    setShowHeckle(false);
    setHeckleQueue([]);
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

  const triggerTrashTalk = (event: TrashTalkEvent) => {
    if (!settings.commentaryEnabled) {
      if (event === 'MATCH_LOSS' && sfxEnabled && lostAudioRef.current) {
        lostAudioRef.current.currentTime = 0;
        lostAudioRef.current.play().catch(console.error);
      }
      return;
    }

    queueOrShowSpecialEvent({
      kind: 'TRASH_TALK',
      event,
      message: getTrashTalkLine(event),
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

  // Initial Auth state handling

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setHasResolvedInitialAuthState(true);
      setHasResolvedRedirectSignIn(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setHasResolvedInitialAuthState(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentQuestion || !user?.id) return;

    const questionId = currentQuestion.questionId || currentQuestion.id;
    markQuestionSeen({
      userId: user.id,
      questionId,
      gameId: game?.id,
    }).catch((err) => {
      console.error('[seenQuestions] Failed to record seen question:', err);
    });
  }, [currentQuestion?.id, user?.id, game?.id]);


  const isHighPriorityOverlayActive =
    resultPhase !== 'idle' ||
    !!roast ||
    !!activeTrashTalk ||
    !!activeTrashTalkEvent ||
    showManualPickPrompt ||
    game?.status === 'completed';

  const shouldShowOpponentHeckles =
    shouldEnableHeckles(isSolo) &&
    settings.commentaryEnabled &&
    !!game &&
    !!user &&
    game.status === 'active' &&
    players.length > 1 &&
    game.currentTurn !== user.id &&
    !currentQuestion &&
    !revealedCategory &&
    !isHighPriorityOverlayActive;

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
          console.error(`[setActiveGameQuestion] Failed for game ${game.id}:`, err);
          setError('Failed to set active question.');
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
    if (shouldShowOpponentHeckles) return;
    heckleRequestIdRef.current += 1;
    clearHeckles();
  }, [shouldShowOpponentHeckles]);

  useEffect(() => {
    if (!shouldShowOpponentHeckles || activeHeckle || heckleQueue.length === 0) {
      if (!shouldShowOpponentHeckles && heckleTimer.current) {
        window.clearTimeout(heckleTimer.current);
        heckleTimer.current = null;
      }
      return;
    }

    const [nextHeckle, ...remainingHeckles] = heckleQueue;
    setActiveHeckle(nextHeckle);
    setShowHeckle(true);
    setHeckleQueue(remainingHeckles);

    if (heckleTimer.current) {
      window.clearTimeout(heckleTimer.current);
    }

    heckleTimer.current = window.setTimeout(() => {
      setShowHeckle(false);
      setActiveHeckle(null);
      heckleTimer.current = null;
    }, HECKLE_ROTATION_MS);
  }, [shouldShowOpponentHeckles, activeHeckle, heckleQueue]);

  useEffect(() => {
    if (!shouldShowOpponentHeckles || activeHeckle || heckleQueue.length > 0) return;

    const opponent = players.find((player) => player.uid !== user?.id);
    const currentPlayer = players.find((player) => player.uid === user?.id);
    if (!opponent || !user || !game) return;

    const turnKey = `${game.id}:${game.currentTurn}:${currentPlayer?.score ?? 0}:${opponent.score ?? 0}:${opponent.streak ?? 0}`;
    if (lastHeckleTurnKeyRef.current === turnKey) return;
    lastHeckleTurnKeyRef.current = turnKey;

    const requestId = ++heckleRequestIdRef.current;

    generateHeckles({
      playerName: currentPlayer?.name || user.displayName || 'Player',
      opponentName: opponent.name,
      gameState: `${currentPlayer?.name || 'You'} score ${currentPlayer?.score || 0}, streak ${currentPlayer?.streak || 0}; ${opponent.name} score ${opponent.score || 0}, streak ${opponent.streak || 0}.`,
      recentFailure: lastFailureRef.current,
      isSolo,
    }).then((generatedHeckles) => {
      if (requestId !== heckleRequestIdRef.current) return;
      if (!generatedHeckles.length || !shouldShowOpponentHeckles) return;
      setHeckleQueue(generatedHeckles);
    });
  }, [shouldShowOpponentHeckles, activeHeckle, heckleQueue.length, players, user, game, isSolo]);

  useEffect(() => {
    return () => {
      if (heckleTimer.current) {
        window.clearTimeout(heckleTimer.current);
        heckleTimer.current = null;
      }
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
        console.error(`[clearActiveGameQuestion] Failed for game ${game.id}:`, err);
        setError('Failed to clear active question.');
      });
    }

    if (nextEvent) {
      showSpecialEvent(nextEvent);
      return;
    }

    setResultPhase('idle');
  };

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.body.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    saveLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!user?.id) {
      setRemoteSettingsResolved(true);
      return;
    }

    let cancelled = false;
    setRemoteSettingsResolved(false);

    loadUserSettings(user.id)
      .then((remoteSettings) => {
        if (cancelled) return;
        setSettings((current) => mergeSettings(current, remoteSettings, DEFAULT_USER_SETTINGS));
      })
      .catch((err) => {
        if (import.meta.env.DEV) {
          console.warn('[userSettings] Failed to load remote settings:', err);
        }
        setError('Failed to load user settings.');
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
      })
      .catch((err) => {
        if (import.meta.env.DEV) {
          console.warn('[userSettings] Failed to save remote settings:', err);
        }
        setError('Failed to save user settings.');
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
    // Firebase finishSignInRedirect is no longer needed with Supabase OAuth
  }, []);

  useEffect(() => {
    const subscription = onAuthStateChange((u) => {
      setUser(u);
      setHasResolvedInitialAuthState(true);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setPlayerProfile(null);
      return;
    }

    ensurePlayerProfile(user).catch((err) => {
      if (import.meta.env.DEV) {
        console.warn('[playerProfile] Failed to ensure profile:', err);
      }
      setError('Failed to ensure player profile.');
    });
  }, [user]);

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
    if (!user?.id || game || resumePrompt || isCheckingForResume) return;

    const storedGameId = getStoredActiveGameId();
    if (!storedGameId) return;

    let cancelled = false;
    setIsCheckingForResume(true);

    getGameById(storedGameId)
      .then((storedGame) => {
        if (cancelled) return;

        if (!storedGame) {
          persistActiveGameId(null);
          setIsCheckingForResume(false);
          return;
        }

        if (storedGame.status !== 'active' || !storedGame.playerIds.includes(user.id)) {
          persistActiveGameId(null);
          setIsCheckingForResume(false);
          return;
        }

        setIsSolo(storedGame.playerIds.length === 1);
        setResumePrompt({
          game: storedGame,
          isSolo: storedGame.playerIds.length === 1,
        });
        setIsCheckingForResume(false);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(`[resumeGame] Failed to check for resumable game ${storedGameId}:`, err);
          setError('Failed to check for a resumable game.');
          setIsCheckingForResume(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [game, isCheckingForResume, resumePrompt, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setRecentPlayers([]);
      return;
    }

    return subscribeRecentPlayers(
      user.id,
      setRecentPlayers,
      (err) => {
        setRecentPlayers([]);
        console.error(`[recentPlayers] Failed to subscribe for user ${user.id}:`, err);
        setError('Failed to load recent players.');
      }
    );
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setPlayerProfile(null);
      return;
    }

    return subscribePlayerProfile(
      user.id,
      setPlayerProfile,
      (err) => {
        setPlayerProfile(null);
        console.error(`[playerProfile] Failed to subscribe for user ${user.id}:`, err);
        setError('Failed to load your player profile.');
      }
    );
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setRecentCompletedGames([]);
      return;
    }

    return subscribeRecentCompletedGames(
      user.id,
      (games) => {
        setRecentCompletedGames(games);
        setPastGames(games as any);

      },
      (err) => {
        setRecentCompletedGames([]);
        console.error(`[gameHistory] Failed to subscribe for user ${user.id}:`, err);
        setError('Failed to load recent match history.');
      }
    );

  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setIncomingInvites([]);
      return;
    }

    return subscribeToIncomingInvites(
      user.id,
      setIncomingInvites,
      (err) => {
        setIncomingInvites([]);
        console.error(`[invites] Snapshot listener failed for user ${user.id}:`, err);
        setError('Failed to load incoming invites.');
      }
    );
  }, [user?.id]);

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
    if (!game?.id) {
      setIsMobileChatOpen(false);
      setSeenIncomingMessageCount(0);
      return;
    }

    setIsMobileChatOpen(false);
    setSeenIncomingMessageCount(0);
  }, [game?.id]);

  useEffect(() => {
    if (!isFetchingQuestions) return;

    setActiveQuestionLoadingLine(
      QUESTION_LOADING_LINES[Math.floor(Math.random() * QUESTION_LOADING_LINES.length)]
    );

    const interval = window.setInterval(() => {
      setActiveQuestionLoadingLine(
        QUESTION_LOADING_LINES[Math.floor(Math.random() * QUESTION_LOADING_LINES.length)]
      );
    }, 1800);

    return () => window.clearInterval(interval);
  }, [isFetchingQuestions]);

  // Fetch past games history
  useEffect(() => {
    if (!user?.id) return;
    const unsub = subscribeRecentCompletedGames(
      user.id,
      (games) => {
        setRecentCompletedGames(games);
      },
      (err) => {
        setRecentCompletedGames([]);
        console.error(`[gameHistory] Error fetching history for user ${user.id}:`, err);
        setError('Failed to load match history.');
      },
      10 // limit
    );
    return () => unsub();
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      if (musicEnabled) {
        if (themeAudioRef.current) {
          themeAudioRef.current.volume = 0.3;
          themeAudioRef.current.play().catch(console.error);
        }
        if (welcomeAudioRef.current) {
          welcomeAudioRef.current.volume = 1.0;
          welcomeAudioRef.current.play().catch(console.error);
        }
      } else {
        if (themeAudioRef.current) {
          themeAudioRef.current.pause();
        }
        if (welcomeAudioRef.current) {
          welcomeAudioRef.current.pause();
        }
      }
    }
  }, [musicEnabled, user]);

  useEffect(() => {
    if (game?.status === 'completed' && prevGameStatus.current !== 'completed') {
      if (sfxEnabled) {
        if (game.winnerId === user?.id) {
          if (wonAudioRef.current) {
            wonAudioRef.current.currentTime = 0;
            wonAudioRef.current.play().catch(console.error);
          }
        }
      }

      if (game.winnerId && game.winnerId !== user?.id && !hasTriggeredMatchLossRef.current) {
        hasTriggeredMatchLossRef.current = true;
        triggerTrashTalk('MATCH_LOSS');
      }
    }
    prevGameStatus.current = game?.status || null;
  }, [game?.status, game?.winnerId, user?.id, sfxEnabled, lastTrashTalkEvent]);

  useEffect(() => {
    if (game?.status !== 'abandoned') return;
    resetGame();
    setError('This match was abandoned. Starting fresh.');
  }, [game?.status]);

  useEffect(() => {
    if (!activeTrashTalkEvent || !activeTrashTalk) return;

    const timeoutMs = activeTrashTalkEvent === 'MATCH_LOSS' ? 4500 : 2500;
    const timeout = window.setTimeout(() => {
      setActiveTrashTalk(null);
      setActiveTrashTalkEvent(null);
      if (!showManualPickPrompt) {
        setResultPhase('idle');
      }
    }, timeoutMs);

    return () => window.clearTimeout(timeout);
  }, [activeTrashTalkEvent, activeTrashTalk, showManualPickPrompt]);

  useEffect(() => {
    if (settings.commentaryEnabled) return;
    setActiveTrashTalk(null);
    setActiveTrashTalkEvent(null);
    setQueuedSpecialEvent((current) => current?.kind === 'TRASH_TALK' ? null : current);
  }, [settings.commentaryEnabled]);

  // Game Real-time Listener (Supabase)
  useEffect(() => {
    if (!game?.id) return;

    const unsubGame = subscribeToGame(game.id, (syncedGame) => {
      setGame(syncedGame);
      setPlayers(syncedGame.players as Player[]);
      
      if (syncedGame.questionIds?.length > 0) {
        getGameQuestions(game.id).then(setQuestions).catch(err => {
          console.error('[gameQuestions] Failed to fetch:', err);
          setError('Failed to load game questions.');
        });
      }
    });

    const unsubMessages = subscribeToMessages(game.id, (mList) => {
      setMessages(mList as any); 
    });


    return () => {
      unsubGame();
      unsubMessages();
    };
  }, [game?.id]);


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
      console.error(`[updatePlayerActivity] Failed for game ${resumedGame.id}, player ${user.id}:`, err);
      setError('Failed to update player activity.');
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
      console.error(`[abandonGame] Failed to abandon game ${resumeGameId}:`, err);
      persistActiveGameId(null);
      setError('Failed to abandon game.');
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

    const restoredQuestion = questions.find((question) => question.id === currentQuestionId || question.questionId === currentQuestionId);
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

    setSelectedAnswer(currentQuestionAnswer.correctIndex);
    setCorrectAnswer(restoredQuestion.correctIndex);
    setShouldBlurQuestionBackground(true);
    setRoast({
      id: Math.random().toString(),
      text: '',
      targetId: user.id,
      explanation: restoredQuestion.explanation,
      isCorrect: currentQuestionAnswer.isCorrect,
      questionId: restoredQuestion.questionId || restoredQuestion.id,
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
      const gainedTrophy = (opponent.completedCategories || []).some((category) => !previousCompleted.has(category));
      if (gainedTrophy) {
        triggerTrashTalk('OPPONENT_TROPHY');
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
        triggerTrashTalk('PLAYER_FALLING_BEHIND');
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
        setError('Failed to record recent player.');
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

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.error('[signIn] Error:', err);
      setError(err?.message || 'Failed to sign in.');
    }
  };


  const startSoloGame = async (avatarUrl: string) => {
    if (!user) {
      await handleSignIn();
      return;
    }
    setIsStartingGame(true);
    setLoadingStep('creating_match');
    setIsSolo(true);

    const gameId = `solo-${user.id}-${Date.now()}`;
    const newGame: GameState = {
      id: gameId,
      code: 'SOLO',
      status: 'active',
      hostId: user.id,
      playerIds: [user.id],
      currentTurn: user.id,
      winnerId: null,
      currentQuestionId: null,
      currentQuestionCategory: null,
      currentQuestionIndex: -1,
      currentQuestionStartedAt: null,
      questionIds: [],
      answers: {},
      finalScores: {},
      categoriesUsed: [],
      lastUpdated: Date.now()
    };


    const initialPlayer: Player = {
      uid: user.id,
      name: user.displayName || 'Player 1',
      score: 0,
      streak: 0,
      completedCategories: [],
      avatarUrl,
      lastActive: Date.now(),
    };

    try {
      await createGame(newGame, initialPlayer);

      setIsFetchingQuestions(true);
      setLoadingStep('loading_questions');
      const initialQuestions = await getQuestionsForSession({
        categories: playableCategories,
        count: 3,
        excludeQuestionIds: existingQuestionIds,
        userId: user.id,
      });
      await persistQuestionsToGame(gameId, initialQuestions.map((question) => question.questionId || question.id));

      setIsFetchingQuestions(false);
      setLoadingStep('finalizing_lobby');

      setGame(newGame);
    } catch (err) {
      console.error(`[startSoloGame] Failed to start solo game ${gameId}:`, err);
      setError("Failed to start game.");
    } finally {
      setIsStartingGame(false);
      setIsFetchingQuestions(false);
      setLoadingStep('idle');
    }
  };

  const startMultiplayerGame = async (avatarUrl: string) => {
    if (!user) {
      await handleSignIn();
      return;
    }
    void requestTurnNotificationPermission();
    setIsStartingGame(true);
    setLoadingStep('creating_match');
    setIsSolo(false);

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const gameId = `multi-${code}-${Date.now()}`;

    const newGame: GameState = {
      id: gameId,
      code,
      status: 'waiting',
      hostId: user.id,
      playerIds: [user.id],
      currentTurn: user.id,
      winnerId: null,
      currentQuestionId: null,
      currentQuestionCategory: null,
      currentQuestionIndex: -1,
      currentQuestionStartedAt: null,
      questionIds: [],
      answers: {},
      finalScores: {},
      categoriesUsed: [],
      lastUpdated: Date.now()
    };


    const initialPlayer: Player = {
      uid: user.id,
      name: user.displayName || 'Host',
      score: 0,
      streak: 0,
      completedCategories: [],
      avatarUrl,
      lastActive: Date.now(),
    };

    try {
      await createGame(newGame, initialPlayer);
      setIsFetchingQuestions(true);
      setLoadingStep('loading_questions');
      const initialQuestions = await getQuestionsForSession({
        categories: playableCategories,
        count: 3,
        excludeQuestionIds: questions.map(q => q.id),
        userId: user.id,
      });
      const nextQuestionIds = initialQuestions.map((q) => q.questionId || q.id);
      await persistQuestionsToGame(gameId, nextQuestionIds);
      setIsFetchingQuestions(false);
      setLoadingStep('finalizing_lobby');
      setGame(newGame);
    } catch (err) {

      console.error(`[startMultiplayerGame] Failed to start multiplayer game ${gameId}:`, err);
      setError('Failed to start multiplayer game.');
    } finally {
      setIsStartingGame(false);
      setIsFetchingQuestions(false);
      setLoadingStep('idle');
    }
  };

  const handleJoinGame = async (code: string, avatarUrl: string) => {

    if (!user) {
      await handleSignIn();
      return;
    }
    void requestTurnNotificationPermission();
    setIsJoiningGame(true);
    setLoadingStep('joining_match');

    try {
      const gameData = await getGameById(code, true); // Assuming getGameById can take code and search
      if (!gameData) {
        setError("Game not found or already started.");
        return;
      }

      await joinWaitingGameById(gameData.id, avatarUrl);
    } catch (err) {
      console.error(`[joinGame] Failed to join game with code ${code}:`, err);
      setError('Failed to join game.');
    } finally {
      setIsJoiningGame(false);
      setLoadingStep('idle');
    }
  };

  const inviteRecentPlayer = async (player: RecentPlayer, avatarUrl: string) => {
    if (!user) {
      await handleSignIn();
      return;
    }
    void requestTurnNotificationPermission();

    setIsStartingGame(true);
    setLoadingStep('creating_match');
    setIsSolo(false);

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const gameId = `multi-${code}-${Date.now()}`;

    const newGame: GameState = {
      id: gameId,
      code,
      status: 'waiting',
      hostId: user.id,
      playerIds: [user.id],
      currentTurn: user.id,
      winnerId: null,
      currentQuestionId: null,
      currentQuestionCategory: null,
      currentQuestionIndex: -1,
      currentQuestionStartedAt: null,
      questionIds: [],
      answers: {},
      finalScores: {},
      categoriesUsed: [],
      lastUpdated: Date.now()
    };


    const initialPlayer: Player = {
      uid: user.id,
      name: user.displayName || 'Host',
      score: 0,
      streak: 0,
      completedCategories: [],
      avatarUrl,
      lastActive: Date.now(),
    };

    try {
      await createGame(newGame, initialPlayer);

      setIsFetchingQuestions(true);
      setLoadingStep('loading_questions');
      const initialQuestions = await getQuestionsForSession({
        categories: playableCategories,
        count: 3,
        excludeQuestionIds: existingQuestionIds,
        userId: user.id,
      });
      await persistQuestionsToGame(gameId, initialQuestions.map(q => q.id));

      setIsFetchingQuestions(false);
      setLoadingStep('finalizing_lobby');

      await sendInvite({
        uid: user.id,
        displayName: user.displayName || 'Host',
        photoURL: avatarUrl || user.photoURL || undefined,
      }, player, gameId);

      setInviteFeedback(`Invite sent to ${player.displayName}`);
      setGame(newGame);
    } catch (err) {
      console.error(`[inviteRecentPlayer] Failed to send invite to ${player.uid}:`, err);
      setError('Failed to send invite.');
    } finally {
      setIsStartingGame(false);
      setIsFetchingQuestions(false);
      setLoadingStep('idle');
    }
  };

  const handleAcceptInvite = async (invite: GameInvite, avatarUrl: string) => {
    if (!user) {
      await handleSignIn();
      return;
    }
    void requestTurnNotificationPermission();

    setIsJoiningGame(true);
    setLoadingStep('joining_match');

    try {
      const joined = await joinWaitingGameById(invite.gameId, avatarUrl);
      if (!joined) {
        await expireInvite(invite.id, user.id);
        return;
      }

      await acceptInvite(invite.id, user.id);
      setInviteFeedback(`Joined ${invite.fromDisplayName}'s match`);
    } catch (err) {
      console.error(`[handleAcceptInvite] Failed to accept invite ${invite.id} for user ${user.id}:`, err);
      setError('Failed to accept invite.');
    } finally {
      setIsJoiningGame(false);
      setLoadingStep('idle');
    }
  };

  const handleDeclineInvite = async (invite: GameInvite) => {
    if (!user) return;

    try {
      await declineInvite(invite.id, user.id);
      setInviteFeedback(`Declined invite from ${invite.fromDisplayName}`);
    } catch (err) {
      console.error(`[handleDeclineInvite] Failed to decline invite ${invite.id} for user ${user.id}:`, err);
      setError('Failed to decline invite.');
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
      console.error(`[handleInspectMatchup] Failed to load matchup history for user ${user.id} and opponent ${player.uid}:`, err);
      setError('Failed to load matchup history.');
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
      console.error(`[handleRemoveRecentPlayer] Failed to remove recent player ${player.uid} for user ${user.id}:`, err);
      setError('Failed to remove recent player.');
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
    setResultPhase('idle');
    const resolvedCategory = resolveWheelCategory(category);

    // Find an unused question in this category
    const available = questions.filter(q => !q.used && q.category === resolvedCategory);
    if (available.length > 0) {
      const q = available[Math.floor(Math.random() * available.length)];
      const questionId = q.questionId || q.id;
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
            ...newQs.map((question) => question.questionId || question.id),
          ];
          persistQuestionsToGame(game!.id, newQs.map(q => q.id))
            .then(() => updateGame(game!.id, { questionIds: nextQuestionIds }))

            .then(() => {
              const questionId = q.questionId || q.id;
              const questionIndex = nextQuestionIds.indexOf(questionId);
              showCategoryReveal(resolvedCategory, q, questionIndex >= 0 ? questionIndex : 0);
            })
            .catch((err) => {
              console.error(`[persistQuestionsToGame] Failed for game ${game!.id}:`, err);
              setError('Failed to persist questions.');
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

    if (sfxEnabled) {
      if (isCorrect) {
        if (correctAudioRef.current) {
          correctAudioRef.current.currentTime = 0;
          correctAudioRef.current.play().catch(console.error);
        }
      } else {
        const incorrectAudioRef = resolvedIndex < 0 ? timesUpAudioRef : wrongAudioRef;
        if (incorrectAudioRef.current) {
          incorrectAudioRef.current.currentTime = 0;
          incorrectAudioRef.current.play().catch(console.error);
        }
      }
    }

    const currentPlayer = players.find(p => p.uid === user.id);
    const gameAnswer: GameAnswer = {
      correctIndex: resolvedIndex,
      submittedAt,
      isCorrect,
      source,
      timeTaken: submittedAt - (game.currentQuestionStartedAt ? new Date(game.currentQuestionStartedAt as any).getTime() : Date.now()),
    };
    setResultPhase('revealing');

    try {
      await recordAnswer(game.id, questionId, user.id, gameAnswer);
      
      // Incrementally update player stats even if match isn't finished
      void recordQuestionStats({
        uid: user.id,
        category: currentQuestion.category,
        isCorrect
      }).catch(err => {
        console.error('[playerProfile] Failed to record question stats:', err);
        setError('Failed to record question stats.');
      });

      if (isCorrect) {
        const newStreak = (currentPlayer?.streak || 0) + 1;
        const alreadyCompleted = currentPlayer?.completedCategories.includes(currentQuestion.category);
        const earnedNewTrophy = !alreadyCompleted;

        await updateGame(game.id, {
          players: players.map(p => p.uid === user.id ? {
            ...p,
            score: (p.score || 0) + 1,
            streak: newStreak,
            completedCategories: alreadyCompleted ? p.completedCategories : [...(p.completedCategories || []), currentQuestion.category]
          } : p)
        });

        if (lastAnswerCorrect && !earnedNewTrophy && !manualPickReady) {
          setManualPickReady(true);
          queueSpecialEvent({ kind: 'MANUAL_CATEGORY_UNLOCK' });
        }
        setLastAnswerCorrect(true);

        // Check for win
        const updatedPlayer = { ...currentPlayer!, completedCategories: [...(currentPlayer?.completedCategories || []), currentQuestion.category] };
        if (new Set(updatedPlayer.completedCategories).size >= playableCategories.length) {
          setManualPickReady(false);
          setQueuedSpecialEvent(null);
          const completedAt = Date.now();
          const winnerId = user.id;
          const finalScores = players.reduce<Record<string, number>>((scores, player) => {
            scores[player.uid] = player.uid === user.id ? (player.score || 0) + 1 : (player.score || 0);
            return scores;
          }, {});
          await updateGame(game.id, {
            status: 'completed',
            winner_id: winnerId,
            completed_at: new Date(completedAt).toISOString(),
            final_scores: finalScores,
            last_updated: new Date().toISOString()
          });
          
          await recordCompletedGame({
            gameId: game.id,
            players: players.map((player) => (
              player.uid === user.id
                ? {
                    ...player,
                    score: (player.score || 0) + 1,
                    streak: newStreak,
                    completedCategories: updatedPlayer.completedCategories,
                  }
                : player
            )),
            winnerId: user.id,
            finalScores,
            questions: questions.map((question) => (
              question.id === currentQuestion.id
                ? { ...question, used: true }
                : question
            )),
            status: 'completed',
            completedAt,
          });
          confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        }
      } else {
        setLastAnswerCorrect(false);
        lastFailureRef.current = resolvedIndex >= 0
          ? `Missed "${currentQuestion.question}" in ${currentQuestion.category}. Picked "${selectedChoice}" when the correct answer was "${correctChoice}". ${currentQuestion.explanation}`
          : `Ran out of time on "${currentQuestion.question}" in ${currentQuestion.category}. The correct answer was "${correctChoice}". ${currentQuestion.explanation}`;
        
        // Reset streak in game state
        await updateGame(game.id, {
          players: players.map(p => p.uid === user.id ? { ...p, streak: 0 } : p)
        });

        // End turn in multiplayer
        if (!isSolo && game.playerIds.length > 1) {
          const nextPlayerId = game.playerIds.find(id => id !== user.id);
          await updateGame(game.id, {
            currentTurn: nextPlayerId,
            lastUpdated: Date.now()
          });
        }
      }

      // Mark question as used (already done in game_ids / question mapping logic usually, but let's be explicit if needed)
      // Actually, my gameService can handle this if we add a 'used' field to the junction or similar.
      // For now, let's just assume the flow is correct.
    } catch (err) {
      console.error('[gameLoop] Action failed:', err);
      setError('Failed to process your answer.');
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
          id: Math.random().toString(),
          text: '',
          targetId: user.id,
          explanation: currentQuestion.explanation,
          isCorrect,
          questionId: currentQuestion.questionId || currentQuestion.id,
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

  const shouldShowCurrentTurnStage = !!game && game.status === 'active' && (
    game.currentTurn === user?.uid ||
    !!currentQuestion ||
    !!revealedCategory ||
    resultPhase === 'revealing' ||
    resultPhase === 'explaining' ||
    !!roast
  );

  const currentPlayer = players.find((player) => player.uid === user?.uid);
  const opponentPlayer = players.find((player) => player.uid !== user?.uid);
  const currentPlayerScore = currentPlayer?.score || 0;
  const opponentPlayerScore = opponentPlayer?.score || 0;
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
      (game.currentTurn === user?.uid && !currentQuestion) ||
      game.currentTurn !== user?.uid
    ))
  );
  const incomingMessageCount = messages.filter((message) => message.uid !== user?.uid).length;
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
  const questionLoadingCopy = getLoadingCopy(loadingStep === 'idle' ? 'loading_questions' : loadingStep);
  const isLobbyBusy = isStartingGame || isJoiningGame || isCheckingForResume;

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
    prevPlayersRef.current = [];
    recordedRecentPairKeysRef.current.clear();
    lastTurnNotificationKeyRef.current = '';
    lastHeckleTurnKeyRef.current = '';
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
      // Reset players in the existing game
      const resetPlayers = players.map(p => ({
        ...p,
        score: 0,
        streak: 0,
        completedCategories: []
      }));

      // Generate new questions
      setIsFetchingQuestions(true);
      setLoadingStep('loading_questions');
      const initialQuestions = await getQuestionsForSession({
        categories: playableCategories,
        count: 3,
        excludeQuestionIds: questions.map(q => q.id),
        userId: user.id,
      });
      const nextQuestionIds = initialQuestions.map((q) => q.questionId || q.id);
      await persistQuestionsToGame(game.id, nextQuestionIds);
      setIsFetchingQuestions(false);
      setLoadingStep('finalizing_match');

      // Reset game state
      const firstTurnPlayerId = players.find((player) => player.uid !== game.hostId)?.uid || game.hostId;
      await updateGame(game.id, {
        status: 'active',
        players: resetPlayers,
        currentTurn: firstTurnPlayerId,
        winnerId: null,
        currentQuestionId: null,
        currentQuestionCategory: null,
        currentQuestionIndex: -1,
        currentQuestionStartedAt: null,
        questionIds: nextQuestionIds,
        answers: {},
        lastUpdated: Date.now()
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
      prevPlayersRef.current = [];
      recordedRecentPairKeysRef.current.clear();
      lastTurnNotificationKeyRef.current = '';
      lastHeckleTurnKeyRef.current = '';
      heckleRequestIdRef.current += 1;
      lastFailureRef.current = 'No recent embarrassment recorded.';
      hasWarnedBehindRef.current = false;
      hasTriggeredMatchLossRef.current = false;
    } catch (err) {
      console.error('[playAgain] Failed to restart game:', err);
      setError("Failed to restart game.");
    } finally {
      setIsStartingGame(false);
      setIsFetchingQuestions(false);
      setLoadingStep('idle');
    }
  };


  const sendMessageHandler = async () => {
    if (!game || !user || !chatInput.trim() || isSendingMessage) return;
    setIsSendingMessage(true);
    try {
      await sendMessage(game.id, user.id, chatInput.trim());
      setChatInput('');
    } catch (err) {
      console.error('[sendMessage] Failed:', err);
      setError("Failed to send message.");
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
    <div className="theme-panel backdrop-blur-xl border rounded-2xl p-4 sm:p-6 space-y-4">
      <div className="grid items-center gap-3 grid-cols-1">
        <h3 className="text-center text-sm font-bold uppercase tracking-widest theme-text-muted">
          {matchChatTitle}
        </h3>
      </div>

      <div className="h-[min(40dvh,20rem)] overflow-y-auto space-y-3 pr-1 custom-scrollbar">
        {messages.length === 0 ? (
          <p className="text-center theme-text-muted italic text-sm py-10">No messages yet. Say something funny.</p>
        ) : (
          messages.map(m => (
            <div key={m.id} className={`flex gap-3 ${m.uid === user?.uid ? 'flex-row-reverse' : ''}`}>
              <div className="w-9 h-9 sm:w-10 sm:h-10 theme-avatar-surface rounded-full flex items-center justify-center text-sm shrink-0 overflow-hidden shadow-inner border">
                {m.avatarUrl ? <img src={m.avatarUrl} alt="Avatar" className="w-full h-full object-cover" /> : '👤'}
              </div>
              <div className={`max-w-[78%] p-3 sm:p-4 rounded-2xl text-sm shadow-md ${m.uid === user?.uid
                ? 'bg-purple-600 text-white rounded-tr-sm'
                : 'theme-soft-surface rounded-tl-sm border'
                }`}>
                <p className="text-[10px] font-bold opacity-60 mb-1 uppercase tracking-wider">{m.name}</p>
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
          onKeyDown={(e) => { if (e.key === 'Enter') sendMessageHandler(); }}
          placeholder="Type a message..."
          disabled={isSendingMessage}
          className="flex-1 theme-input border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all duration-300 disabled:opacity-50 theme-inset"
        />
        <button type="button"
          onClick={sendMessageHandler}
          disabled={isSendingMessage || !chatInput.trim()}
          className="p-3 bg-purple-600 rounded-xl hover:bg-purple-500 transition-all duration-300 disabled:opacity-50 flex items-center justify-center shadow-[0_4px_14px_0_rgba(147,51,234,0.39)] hover:shadow-[0_6px_20px_rgba(147,51,234,0.23)] active:scale-[0.96]"
        >
          {isSendingMessage ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
        </button>
      </div>
    </div>
  );

  if (isInitializing) {
    return (
      <>
        <audio ref={themeAudioRef} src={themeAudioSrc} loop />
        <audio ref={welcomeAudioRef} src={welcomeAudioSrcRef.current} />
        <audio ref={correctAudioRef} src={correctAudioSrc} />
        <audio ref={wrongAudioRef} src={wrongAudioSrc} />
        <audio ref={timesUpAudioRef} src={timesUpAudioSrc} />
        <audio ref={wonAudioRef} src={wonAudioSrc} />
        <audio ref={lostAudioRef} src={lostAudioSrc} />

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
    return (
      <>
        <audio ref={themeAudioRef} src={themeAudioSrc} loop />
        <audio ref={welcomeAudioRef} src={welcomeAudioSrcRef.current} />
        <audio ref={correctAudioRef} src={correctAudioSrc} />
        <audio ref={wrongAudioRef} src={wrongAudioSrc} />
        <audio ref={timesUpAudioRef} src={timesUpAudioSrc} />
        <audio ref={wonAudioRef} src={wonAudioSrc} />
        <audio ref={lostAudioRef} src={lostAudioSrc} />

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
              onClick={() => updateSettings({ soundEnabled: !settings.soundEnabled })}
              className="p-4 rounded-full theme-button transition-colors"
              title={settings.soundEnabled ? "Mute Audio" : "Play Audio"}
            >
              {settings.soundEnabled ? <Volume2 className="w-6 h-6 text-cyan-400" /> : <VolumeX className="w-6 h-6 theme-text-muted" />}
            </button>
          </div>

          <div className="flex-1 min-h-0" />

          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center relative mt-4 sm:mt-6"
          >
            <div className="relative inline-block w-[17rem] h-[17rem] sm:w-[20rem] sm:h-[20rem] md:w-80 md:h-80">
              <img
                src={logoSrc}
                alt="A F-cking Trivia Game"
                className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]"
                referrerPolicy="no-referrer"
              />
            </div>
          </motion.div>

          <motion.button type="button"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            onClick={handleSignIn}
            className="mt-8 sm:mt-10 inline-flex h-11 sm:h-12 items-center gap-3 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-[#1f1f1f] shadow-[0_8px_24px_rgba(255,255,255,0.12)] transition-all duration-300 ease-in-out hover:scale-[1.01] hover:bg-[#f8f9fa] hover:shadow-[0_10px_28px_rgba(255,255,255,0.16)] active:scale-[0.99]"
            aria-label="Sign in with Google"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white">
              <GoogleMark />
            </span>
            <span className="tracking-[0.01em]">Sign in with Google</span>
          </motion.button>

          {error && (
            <div
              className="mt-5 max-w-lg rounded-xl border border-rose-500/40 bg-rose-950/40 px-5 py-4 text-center text-sm font-medium text-rose-300 shadow-[0_8px_20px_rgba(244,63,94,0.15)]"
              role="alert"
            >
              <p>{error}</p>
              <button
                type="button"
                onClick={() => setError(null)}
                className="mt-3 rounded-lg border border-rose-400/40 px-3 py-1 text-xs font-black uppercase tracking-wider text-rose-200 hover:bg-rose-500/20"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="flex-1 min-h-0" />

          <div className="w-full max-w-sm text-center space-y-2 shrink-0">
            <p className="theme-text-muted font-bold text-sm sm:text-base">
              No ads. No coins. No bullsh*t. 🚫
            </p>
            <p className="theme-text-secondary font-medium text-xs sm:text-sm leading-relaxed">
              Answer one question from each category to win. Get one wrong and your turn ends. 💀
            </p>
          </div>

        </div>
      </>
    );
  }

  return (
    <>
      <audio ref={themeAudioRef} src={themeAudioSrc} loop />
      <audio ref={welcomeAudioRef} src={welcomeAudioSrcRef.current} />
      <audio ref={correctAudioRef} src={correctAudioSrc} />
      <audio ref={wrongAudioRef} src={wrongAudioSrc} />
      <audio ref={timesUpAudioRef} src={timesUpAudioSrc} />
      <audio ref={wonAudioRef} src={wonAudioSrc} />
      <audio ref={lostAudioRef} src={lostAudioSrc} />

      <div data-theme={themeMode} className="app-theme h-dvh min-h-dvh overflow-hidden font-sans flex flex-col">
        {!isQuestionActive && (
          <header className="px-3 py-2.5 sm:p-4 flex justify-between items-center theme-panel backdrop-blur-md border-b shrink-0 z-40">
            <div className="flex items-center gap-2 sm:gap-4">
              <button type="button"
                onClick={() => updateSettings({ soundEnabled: !settings.soundEnabled })}
                className="p-2 theme-icon-button transition-colors rounded-full"
                aria-label={settings.soundEnabled ? 'Mute all sound' : 'Enable sound'}
              >
                {settings.soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </button>
              <button type="button"
                onClick={() => updateSettings({ themeMode: themeMode === 'dark' ? 'light' : 'dark' })}
                className="p-2 theme-icon-button transition-colors rounded-full"
                title={themeMode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                aria-label={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {themeMode === 'dark' ? <Sun className="w-5 h-5 text-amber-500" /> : <Moon className="w-5 h-5 text-cyan-500" />}
              </button>
              <button type="button"
                onClick={() => setShowSettings(true)}
                className="p-2 theme-icon-button transition-colors rounded-full"
                title="Settings"
                aria-label="Open settings"
              >
                <SlidersHorizontal className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              {game && (
                <button type="button"
                  onClick={openQuitConfirm}
                  className="p-2 theme-icon-button transition-colors rounded-full"
                  title="Pause Match"
                  aria-label="Pause current match"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}
              {!game && (
                <button type="button"
                  onClick={() => setShowHistory(true)}
                  className="p-2 theme-icon-button transition-colors rounded-full"
                  title="Match History"
                  aria-label="Open match history"
                >
                  <History className="w-5 h-5" />
                </button>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest theme-text-muted hidden sm:block">
                  {user.displayName}
                </span>
                <button type="button" onClick={openSignOutConfirm} className="p-2 theme-icon-button transition-colors rounded-full" aria-label="Sign out">
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </div>
          </header>
        )}

        <main className={`w-full max-w-4xl mx-auto flex-1 min-h-0 overflow-hidden px-3 pb-3 sm:px-4 sm:pb-4 flex flex-col ${isQuestionActive ? 'pt-4 sm:pt-6' : 'pt-3 sm:pt-4'}`}>
          <AnimatePresence>
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

          {/* History Modal */}
          <AnimatePresence>
            {showHistory && (
              <motion.div
                key="history-modal"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 theme-overlay backdrop-blur-sm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="history-modal-title"
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0, y: 20 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.95, opacity: 0, y: 20 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  className="theme-panel-strong backdrop-blur-xl border rounded-2xl p-6 w-full max-w-lg max-h-[80vh] flex flex-col"
                >
                  <div className="flex justify-between items-center mb-6">
                    <h2 id="history-modal-title" className="text-2xl font-black uppercase tracking-tight">Match History</h2>
                    <button type="button" onClick={() => setShowHistory(false)} className="p-2 theme-icon-button rounded-lg transition-all duration-300" aria-label="Close match history">
                      <X className="w-6 h-6" />
                    </button>
                  </div>

                  <div className="overflow-y-auto custom-scrollbar flex-1 pr-2 space-y-3">
                    {pastGames.length === 0 ? (
                      <p className="theme-text-muted text-center py-8">No completed games yet.</p>
                    ) : (
                      pastGames.map(g => (
                        <div key={g.id} className="theme-soft-surface border rounded-2xl p-4 flex items-center justify-between">
                          <div>
                            <p className="text-xs theme-text-muted font-medium mb-1">
                              {g.lastUpdated ? new Date(g.lastUpdated).toLocaleDateString() : 'Unknown Date'}

                            </p>
                            <p className="text-sm font-bold">
                              {g.code === 'SOLO' ? 'Solo Game' : 'Multiplayer'}
                            </p>
                          </div>
                          <div className="text-right">
                            {g.winnerId === user.id ? (
                              <span className="inline-flex items-center gap-1 text-emerald-400 font-black text-sm uppercase tracking-wider">
                                <Trophy className="w-4 h-4" /> Won
                              </span>
                            ) : (
                              <span className="theme-text-muted font-bold text-sm uppercase tracking-wider">
                                Lost
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {!game ? (
              <div key="lobby-view" className="relative h-full min-h-0 overflow-hidden">
                {resumePrompt && (
                  <div className="mb-6 rounded-2xl border theme-panel-strong backdrop-blur-xl p-5 shadow-[0_12px_30px_rgba(0,0,0,0.18)]">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] theme-text-muted mb-2">
                      Resume Match
                    </p>
                    <h2 className="text-2xl font-black tracking-tight mb-2">
                      {resumePrompt.isSolo ? 'Resume your solo game?' : 'Resume your multiplayer game?'}
                    </h2>
                    <p className="text-sm theme-text-secondary mb-4">
                      Firestore still has an active {resumePrompt.isSolo ? 'solo' : 'multiplayer'} match for code {resumePrompt.game.code}. Resume it or abandon it and return to the lobby.
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
                {(isStartingGame || isJoiningGame) && (
                  <div className="absolute inset-0 z-40 theme-overlay backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center">
                    <Loader2 className="w-8 h-8 text-pink-500 animate-spin mb-4" />
                    <p className="text-base font-bold theme-text-secondary">
                      {setupLoadingCopy.title}
                    </p>
                    <p className="text-xs font-bold uppercase tracking-widest theme-text-muted mt-2 text-center">
                      {setupLoadingCopy.flow}
                    </p>
                  </div>
                )}
                {isCheckingForResume && (
                  <div className="absolute inset-0 z-40 theme-overlay backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center">
                    <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-4" />
                    <p className="text-base font-bold theme-text-secondary">Checking for an active game</p>
                  </div>
                )}
                <div
                  className={`h-full min-h-0 transition-all duration-300 ${
                    resumePrompt
                      ? 'pointer-events-none opacity-40'
                      : isLobbyBusy
                        ? 'pointer-events-none blur-sm scale-[0.99] opacity-70'
                        : ''
                  }`}
                >
                  <GameLobby
                    onStartSolo={startSoloGame}
                    onStartMulti={startMultiplayerGame}
                    onJoinMulti={handleJoinGame}

                    recentPlayers={recentPlayers}
                    playerProfile={playerProfile}
                    recentCompletedGames={recentCompletedGames}
                    selectedMatchup={selectedMatchup}
                    isLoadingMatchup={isLoadingMatchup}
                    incomingInvites={incomingInvites}
                    onInviteRecentPlayer={inviteRecentPlayer}
                    onInspectMatchup={handleInspectMatchup}
                    onCloseMatchup={handleCloseMatchup}
                    onRemoveRecentPlayer={handleRemoveRecentPlayer}
                    onAcceptInvite={handleAcceptInvite}
                    onDeclineInvite={handleDeclineInvite}
                    inviteFeedback={inviteFeedback}
                  />
                </div>
              </div>
            ) : (
              <motion.div
                key="game-view"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex h-full min-h-0 flex-col gap-4 sm:gap-6"
              >
                {game.status === 'waiting' && (
                  <div className="flex justify-end items-end theme-panel backdrop-blur-sm p-4 sm:p-5 rounded-2xl border shrink-0">
                    <div className="text-right px-4">
                      <p className="text-[10px] font-black uppercase tracking-widest theme-text-muted mb-1">Join Code</p>
                      <p className="text-4xl font-black text-pink-500 tracking-tighter leading-none">{game.code}</p>
                    </div>
                  </div>
                )}

                {!isQuestionActive && (
                  <div className="shrink-0 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                      {players.map(p => (
                        <CategoryTracker
                          key={p.uid}
                          playerName={p.name}
                          avatarUrl={p.avatarUrl}
                          completed={p.completedCategories}
                          isCurrentTurn={game.currentTurn === p.uid}
                          score={p.score}
                          onAvatarClick={shouldShowMatchChat ? openMobileChat : undefined}
                          unreadCount={p.uid !== user?.uid ? unreadIncomingMessageCount : 0}
                          unreadBadgeClassName={mobileChatBadgeClass}
                        />
                      ))}
                    </div>
                    {shouldShowMatchChat && (
                      <p className="md:hidden text-center text-[10px] font-bold uppercase tracking-[0.2em] theme-text-muted">
                        Tap a player avatar to open chat
                      </p>
                    )}
                  </div>
                )}

                {/* Game Content */}
                <div className={`relative flex-1 min-h-0 flex flex-col justify-center ${isQuestionActive ? 'py-2 sm:py-4' : 'py-4 sm:py-8'}`}>
                  {game.status === 'completed' ? (
                    <motion.div
                      initial={{ scale: 0.95, opacity: 0, y: 20 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                      className="text-center space-y-6 sm:space-y-8 theme-panel-strong backdrop-blur-xl border p-6 sm:p-12 rounded-2xl"
                    >
                      <Trophy className="w-24 h-24 mx-auto text-yellow-400 drop-shadow-[0_0_30px_rgba(250,204,21,0.4)] animate-bounce" />
                      <div>
                        <h2 className="text-4xl font-black uppercase tracking-tight mb-2">Game Over</h2>
                        <p className="text-xl theme-text-muted">
                          {game.winnerId === user.id ? "You actually won. Incredible." : "You lost. Shocker."}
                        </p>
                      </div>
                      {game.hostId === user.id ? (
                        <button type="button"
                          onClick={playAgain}
                          disabled={isStartingGame}
                          className="mx-auto flex items-center justify-center gap-3 px-8 py-4 bg-white text-black rounded-xl font-bold text-lg hover:scale-[1.02] transition-all duration-300 shadow-[0_8px_30px_rgba(255,255,255,0.15)] disabled:opacity-50 ease-in-out"
                        >
                          {isStartingGame ? <Loader2 className="w-6 h-6 animate-spin" /> : <RefreshCcw className="w-6 h-6" />}
                          Play Again
                        </button>
                      ) : (
                        <p className="theme-text-muted font-bold uppercase tracking-widest">Waiting for host to play again...</p>
                      )}
                    </motion.div>
                  ) : shouldShowCurrentTurnStage ? (
                    <div className="space-y-5 sm:space-y-8">
                      {!currentQuestion ? (
                        <div className="flex flex-col items-center gap-5 sm:gap-8">
                          <p className="text-sm sm:text-base font-black uppercase tracking-widest text-cyan-400 animate-pulse">Your Turn</p>
                          {manualPickReady && showManualPickPrompt ? (
                            <ManualCategoryPrompt
                              categories={playableCategories}
                              onPickCategory={handleManualCategoryPick}
                              onSpinWheel={handleDeclineManualPick}
                            />
                          ) : (
                            <Wheel
                              onSpinComplete={handleSpinComplete}
                              isSpinning={isSpinning}
                              setIsSpinning={setIsSpinning}
                              soundEnabled={sfxEnabled}
                            />
                          )}
                          {isFetchingQuestions && (
                            <div className="flex items-center gap-2 theme-text-muted text-xs sm:text-sm text-center">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>{activeQuestionLoadingLine}</span>
                              <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                                {questionLoadingCopy.flow}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className={`transition-all duration-300 ${shouldBlurQuestionBackground ? 'blur-sm scale-[0.99]' : ''}`}>
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
                    <div className="text-center p-6 sm:p-12 theme-panel border rounded-3xl">
                      <Loader2 className="w-8 h-8 text-pink-500 animate-spin mx-auto mb-4" />
                      <p className="text-lg font-medium theme-text-muted">
                        Waiting for another player to join...
                      </p>
                    </div>
                  ) : (
                    <div className="text-center p-6 sm:p-12 theme-panel border rounded-3xl space-y-4 sm:space-y-6">
                      <Loader2 className="w-8 h-8 text-pink-500 animate-spin mx-auto mb-4" />
                      <p className="text-lg font-medium theme-text-muted">Waiting for {players.find(p => p.uid === game.currentTurn)?.name} to spin...</p>
                      <HeckleOverlay
                        message={activeHeckle}
                        visible={showHeckle && shouldShowOpponentHeckles}
                      />
                    </div>
                  )}
                </div>

                {shouldShowMatchChat && (
                  <div className="hidden md:block shrink-0">
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
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] theme-text-muted">Match Chat</p>
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
            userId={roast.userId}
            gameId={roast.gameId}
            onClose={nextTurn}
          />
        )}

        <CategoryReveal category={revealedCategory} />

        <TrashTalkOverlay
          event={activeTrashTalkEvent}
          message={activeTrashTalk}
        />

        <Suspense fallback={null}>
          <SettingsModal
            isOpen={showSettings}
            settings={settings}
            onClose={() => setShowSettings(false)}
            onUpdate={updateSettings}
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
      </div>
    </>
  );
}
