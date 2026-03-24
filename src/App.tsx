/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  doc,
  setDoc,
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  serverTimestamp,
  increment,
  arrayUnion,
  getDoc,
} from 'firebase/firestore';
import { auth, db, signIn, finishSignInRedirect, handleFirestoreError, OperationType } from './firebase';
import { GameInvite, GameState, Player, RecentPlayer, TriviaQuestion, ChatMessage, UserSettings, getPlayableCategories } from './types';
import { ensureQuestionInventory, getQuestionsForSession } from './services/questionRepository';
import { acceptInvite, declineInvite, expireInvite, loadRecentPlayers, sendInvite, subscribeToIncomingInvites } from './services/invites';
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
import { orderBy, limit } from 'firebase/firestore';
import { DEFAULT_USER_SETTINGS, getLocalSettings, loadUserSettings, mergeSettings, saveLocalSettings, saveUserSettings } from './services/userSettings';
import { generateHeckles } from './services/gemini';
import { notifySafe, requestNotificationPermissionSafe } from './services/notify';

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

const InstallPrompt = lazy(() => import('./components/InstallPrompt').then((module) => ({ default: module.InstallPrompt })));
const SettingsModal = lazy(() => import('./components/SettingsModal').then((module) => ({ default: module.SettingsModal })));
const QuestionBankAdmin = lazy(() => import('./components/QuestionBankAdmin').then((module) => ({ default: module.QuestionBankAdmin })));

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

export default function App() {
  const QUESTION_TIME_LIMIT_SECONDS = 20;
  const themeAudioSrc = publicAsset('theme.mp3');
  const correctAudioSrc = publicAsset('correct.mp3');
  const wrongAudioSrc = publicAsset('wrong.mp3');
  const timesUpAudioSrc = publicAsset('times-up.mp3');
  const wonAudioSrc = publicAsset('won.mp3');
  const lostAudioSrc = publicAsset('lost.mp3');
  const logoSrc = publicAsset('logo.png');

  const [user, setUser] = useState<User | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [questions, setQuestions] = useState<TriviaQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<TriviaQuestion | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [roast, setRoast] = useState<{ explanation: string; isCorrect: boolean } | null>(null);
  const [resultPhase, setResultPhase] = useState<ResultPhase>('idle');
  const [queuedSpecialEvent, setQueuedSpecialEvent] = useState<QueuedSpecialEvent | null>(null);

  // Granular loading states
  const [isInitializing, setIsInitializing] = useState(true);
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
  const [showQuestionBankAdmin, setShowQuestionBankAdmin] = useState(false);
  const [remoteSettingsResolved, setRemoteSettingsResolved] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [recentPlayers, setRecentPlayers] = useState<RecentPlayer[]>([]);
  const [incomingInvites, setIncomingInvites] = useState<GameInvite[]>([]);
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);

  const [pastGames, setPastGames] = useState<GameState[]>([]);
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

  const existingQuestionIds = questions.map((question) => question.questionId || question.id);
  const playableCategories = getPlayableCategories();
  const themeMode = settings.themeMode;
  const musicEnabled = settings.soundEnabled && settings.musicEnabled;
  const sfxEnabled = settings.soundEnabled && settings.sfxEnabled;
  const isQuestionActive =
    !!currentQuestion &&
    (resultPhase === 'idle' || resultPhase === 'revealing' || resultPhase === 'explaining');
  const isQuestionResolutionActive =
    !!currentQuestion && (resultPhase === 'revealing' || resultPhase === 'explaining' || !!roast);

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

  const handleConfirmedQuit = () => {
    closeConfirm();
    resetGame();
  };

  const handleConfirmedSignOut = async () => {
    closeConfirm();
    await auth.signOut();
  };

  const recordRecentPlayer = async (ownerUid: string, player: Player, gameId: string) => {
    const recentPlayerRef = doc(db, 'users', ownerUid, 'recentPlayers', player.uid);
    await setDoc(recentPlayerRef, {
      uid: player.uid,
      displayName: player.name,
      photoURL: player.avatarUrl || '',
      lastPlayedAt: Date.now(),
      lastGameId: gameId,
    }, { merge: true });
  };

  const joinWaitingGameById = async (gameId: string, avatarUrl: string) => {
    if (!user) return false;

    const gameRef = doc(db, 'games', gameId);
    const gameSnapshot = await getDoc(gameRef);
    if (!gameSnapshot.exists()) {
      setError('Invite expired. That match no longer exists.');
      return false;
    }

    const gameData = gameSnapshot.data() as GameState;
    if (gameData.status !== 'waiting') {
      setError('Invite expired. That match already started.');
      return false;
    }

    if (gameData.playerIds.length >= 2 && !gameData.playerIds.includes(user.uid)) {
      setError('Invite expired. That match is already full.');
      return false;
    }

    if (!gameData.playerIds.includes(user.uid)) {
      const playerRef = doc(db, 'games', gameId, 'players', user.uid);
      await setDoc(playerRef, {
        uid: user.uid,
        name: user.displayName || 'Guest',
        score: 0,
        streak: 0,
        completedCategories: [],
        avatarUrl
      });

      await updateDoc(gameRef, {
        playerIds: arrayUnion(user.uid),
        lastUpdated: serverTimestamp()
      });
    }

    setLoadingStep('finalizing_lobby');
    setIsSolo(false);
    setGame({ id: gameId, ...gameData } as GameState);
    return true;
  };

  const resolveWheelCategory = (category: string) => {
    if (category !== 'Random') return category;
    return playableCategories[Math.floor(Math.random() * playableCategories.length)];
  };

  const kickOffInventoryReplenishment = (categories: string[]) => {
    categories.forEach((category) => {
      (['easy', 'medium', 'hard'] as const).forEach((difficulty) => {
        ensureQuestionInventory({
          category,
          difficulty,
          minimumApproved: 8,
          replenishBatchSize: 4,
        }).catch((err) => {
          if (import.meta.env.DEV) {
            console.warn(`[questionInventory] Failed for ${category}/${difficulty}:`, err);
          }
        });
      });
    });
  };

  const persistQuestionsToGame = async (gameId: string, sessionQuestions: TriviaQuestion[]) => {
    for (const question of sessionQuestions) {
      const questionId = question.questionId || question.id;
      await setDoc(doc(db, 'games', gameId, 'questions', questionId), {
        ...question,
        id: questionId,
        questionId,
      });
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
    questionDeadlineRef.current = Date.now() + (QUESTION_TIME_LIMIT_SECONDS * 1000);
    questionResolvedRef.current = false;
    resolvedQuestionIdRef.current = null;
    setQuestionClockNow(Date.now());
  }, [currentQuestion?.id]);

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
    game.currentTurn !== user.uid &&
    !currentQuestion &&
    !revealedCategory &&
    !isHighPriorityOverlayActive;

  const showCategoryReveal = (category: string, question: TriviaQuestion) => {
    if (categoryRevealTimeoutRef.current) {
      window.clearTimeout(categoryRevealTimeoutRef.current);
    }

    setSelectedCategory(category);
    setRevealedCategory(category);
    setCurrentQuestion(null);

    categoryRevealTimeoutRef.current = window.setTimeout(() => {
      setRevealedCategory(null);
      setCurrentQuestion(question);
      setQuestionClockNow(Date.now());
      categoryRevealTimeoutRef.current = null;
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

    const opponent = players.find((player) => player.uid !== user?.uid);
    const currentPlayer = players.find((player) => player.uid === user?.uid);
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
    if (game?.status === 'completed' && game.winnerId === user?.uid) {
      setQueuedSpecialEvent(null);
      clearCurrentTurnView();
      setResultPhase('idle');
      return;
    }

    const nextEvent = queuedSpecialEvent;
    setQueuedSpecialEvent(null);
    clearCurrentTurnView();

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
    if (!user?.uid) {
      setRemoteSettingsResolved(true);
      return;
    }

    let cancelled = false;
    setRemoteSettingsResolved(false);

    loadUserSettings(user.uid)
      .then((remoteSettings) => {
        if (cancelled) return;
        setSettings((current) => mergeSettings(current, remoteSettings, DEFAULT_USER_SETTINGS));
      })
      .catch((err) => {
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
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || !remoteSettingsResolved) return;

    const serialized = JSON.stringify(settings);
    if (lastSavedRemoteSettingsRef.current === serialized) return;

    saveUserSettings(user.uid, settings)
      .then(() => {
        lastSavedRemoteSettingsRef.current = serialized;
      })
      .catch((err) => {
        if (import.meta.env.DEV) {
          console.warn('[userSettings] Failed to save remote settings:', err);
        }
      });
  }, [settings, user?.uid, remoteSettingsResolved]);

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
    finishSignInRedirect().catch((err: any) => {
      setError(err?.message || 'Google sign-in failed.');
    });
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsInitializing(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setRecentPlayers([]);
      return;
    }

    loadRecentPlayers(user.uid)
      .then(setRecentPlayers)
      .catch((err) => {
        if (import.meta.env.DEV) {
          console.warn('[recentPlayers] Failed to load:', err);
        }
      });
  }, [user?.uid, game?.id]);

  useEffect(() => {
    if (!user?.uid) {
      setIncomingInvites([]);
      return;
    }

    return subscribeToIncomingInvites(
      user.uid,
      setIncomingInvites,
      (err) => {
        setIncomingInvites([]);
        if (import.meta.env.DEV) {
          console.warn('[invites] Snapshot listener failed:', err);
        }
      }
    );
  }, [user?.uid]);

  useEffect(() => {
    if (!inviteFeedback) return;
    const timeout = window.setTimeout(() => setInviteFeedback(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [inviteFeedback]);

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
    if (!user) return;
    const q = query(
      collection(db, 'games'),
      where('playerIds', 'array-contains', user.uid)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const games = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as GameState));
      const completed = games
        .filter(g => g.status === 'completed')
        .sort((a, b) => (b.lastUpdated?.toMillis() || 0) - (a.lastUpdated?.toMillis() || 0));
      setPastGames(completed.slice(0, 10));
    }, (err) => console.error("Error fetching history:", err));
    return () => unsub();
  }, [user]);

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
        if (game.winnerId === user?.uid) {
          if (wonAudioRef.current) {
            wonAudioRef.current.currentTime = 0;
            wonAudioRef.current.play().catch(console.error);
          }
        }
      }

      if (game.winnerId && game.winnerId !== user?.uid && !hasTriggeredMatchLossRef.current) {
        hasTriggeredMatchLossRef.current = true;
        triggerTrashTalk('MATCH_LOSS');
      }
    }
    prevGameStatus.current = game?.status || null;
  }, [game?.status, game?.winnerId, user?.uid, sfxEnabled, lastTrashTalkEvent]);

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

  // Auth Listener
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  // Game Real-time Listener
  useEffect(() => {
    if (!game?.id) return;

    const gameRef = doc(db, 'games', game.id);
    const playersRef = collection(db, 'games', game.id, 'players');
    const questionsRef = collection(db, 'games', game.id, 'questions');

    const unsubGame = onSnapshot(gameRef, (snapshot) => {
      if (snapshot.exists()) {
        setGame({ id: snapshot.id, ...snapshot.data() } as GameState);
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `games/${game.id}`));

    const unsubPlayers = onSnapshot(playersRef, (snapshot) => {
      const pList = snapshot.docs.map(d => ({ ...d.data(), uid: d.id } as Player));
      setPlayers(pList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `games/${game.id}/players`));

    const unsubQuestions = onSnapshot(questionsRef, (snapshot) => {
      const qList = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as TriviaQuestion));
      setQuestions(qList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `games/${game.id}/questions`));

    const messagesRef = collection(db, 'games', game.id, 'messages');
    const qMessages = query(messagesRef, orderBy('timestamp', 'asc'), limit(50));
    const unsubMessages = onSnapshot(qMessages, (snapshot) => {
      const mList = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as ChatMessage));
      setMessages(mList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `games/${game.id}/messages`));

    return () => {
      unsubGame();
      unsubPlayers();
      unsubQuestions();
      unsubMessages();
    };
  }, [game?.id]);

  useEffect(() => {
    if (!game || !user || players.length === 0) {
      prevPlayersRef.current = players;
      return;
    }

    const currentPlayer = players.find((player) => player.uid === user.uid);
    const opponent = players.find((player) => player.uid !== user.uid);
    const previousPlayers = prevPlayersRef.current;
    const previousOpponent = previousPlayers.find((player) => player.uid === opponent?.uid);

    if (opponent && previousOpponent) {
      const previousCompleted = new Set(previousOpponent.completedCategories || []);
      const gainedTrophy = (opponent.completedCategories || []).some((category) => !previousCompleted.has(category));
      if (gainedTrophy) {
        triggerTrashTalk('OPPONENT_TROPHY');
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
  }, [players, game?.id, user?.uid, lastTrashTalkEvent]);

  useEffect(() => {
    if (!game?.id || !user?.uid || isSolo || players.length < 2) return;

    const opponent = players.find((player) => player.uid !== user.uid);
    if (!opponent) return;

    const pairKey = `${game.id}:${user.uid}:${opponent.uid}`;
    if (recordedRecentPairKeysRef.current.has(pairKey)) return;
    recordedRecentPairKeysRef.current.add(pairKey);

    recordRecentPlayer(user.uid, opponent, game.id)
      .then(() => {
        setRecentPlayers((current) => {
          const next = [
            {
              uid: opponent.uid,
              displayName: opponent.name,
              photoURL: opponent.avatarUrl,
              lastPlayedAt: Date.now(),
              lastGameId: game.id,
            },
            ...current.filter((player) => player.uid !== opponent.uid),
          ];

          return next.slice(0, 8);
        });
      })
      .catch((err) => {
        recordedRecentPairKeysRef.current.delete(pairKey);
        if (import.meta.env.DEV) {
          console.warn('[recentPlayers] Failed to record:', err);
        }
      });
  }, [game?.id, isSolo, players, user?.uid]);

  useEffect(() => {
    if (!game?.id || !user?.uid || game.status !== 'active' || isSolo || players.length < 2) return;
    if (game.currentTurn !== user.uid) return;

    const notificationKey = `${game.id}:${game.currentTurn}:${game.status}`;
    if (lastTurnNotificationKeyRef.current === notificationKey) return;
    lastTurnNotificationKeyRef.current = notificationKey;

    const opponent = players.find((player) => player.uid !== user.uid);
    void notifySafe('Your turn', {
      body: opponent ? `${opponent.name} is done. Time to spin.` : 'Time to spin.',
      icon: logoSrc,
      tag: `turn-${game.id}`,
      onClickFocusWindow: true,
    });
  }, [game?.id, game?.currentTurn, game?.status, isSolo, logoSrc, players, user?.uid]);

  const handleSignIn = async () => {
    try {
      await signIn();
    } catch (err: any) {
      if (err.code === 'auth/cancelled-popup-request' || err.code === 'auth/popup-closed-by-user') {
        return;
      }
      if (err.code === 'auth/internal-error' || err.code === 'auth/operation-not-supported-in-this-environment') {
        setError('Google sign-in failed in this browser context. If you opened this from another app, tap the menu and open in Safari/Chrome, then try again.');
        return;
      }
      setError(err.message);
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

    const gameId = `solo-${user.uid}-${Date.now()}`;
    const newGame: GameState = {
      id: gameId,
      code: 'SOLO',
      status: 'active',
      hostId: user.uid,
      playerIds: [user.uid],
      currentTurn: user.uid,
      winnerId: null,
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp()
    };

    const initialPlayer: Player = {
      uid: user.uid,
      name: user.displayName || 'Player 1',
      score: 0,
      streak: 0,
      completedCategories: [],
      avatarUrl
    };

    try {
      await setDoc(doc(db, 'games', gameId), newGame);
      await setDoc(doc(db, 'games', gameId, 'players', user.uid), initialPlayer);

      setIsFetchingQuestions(true);
      setLoadingStep('loading_questions');
      const initialQuestions = await getQuestionsForSession({
        categories: playableCategories,
        count: 3,
        excludeQuestionIds: existingQuestionIds
      });
      await persistQuestionsToGame(gameId, initialQuestions);
      kickOffInventoryReplenishment(playableCategories);
      setIsFetchingQuestions(false);
      setLoadingStep('finalizing_lobby');

      setGame(newGame);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `games/${gameId}`);
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
      hostId: user.uid,
      playerIds: [user.uid],
      currentTurn: user.uid,
      winnerId: null,
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp()
    };

    const initialPlayer: Player = {
      uid: user.uid,
      name: user.displayName || 'Host',
      score: 0,
      streak: 0,
      completedCategories: [],
      avatarUrl
    };

    try {
      await setDoc(doc(db, 'games', gameId), newGame);
      await setDoc(doc(db, 'games', gameId, 'players', user.uid), initialPlayer);

      setIsFetchingQuestions(true);
      setLoadingStep('loading_questions');
      const initialQuestions = await getQuestionsForSession({
        categories: playableCategories,
        count: 3,
        excludeQuestionIds: existingQuestionIds
      });
      await persistQuestionsToGame(gameId, initialQuestions);
      kickOffInventoryReplenishment(playableCategories);
      setIsFetchingQuestions(false);
      setLoadingStep('finalizing_lobby');

      setGame(newGame);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `games/${gameId}`);
      setError("Failed to start multiplayer game.");
    } finally {
      setIsStartingGame(false);
      setIsFetchingQuestions(false);
      setLoadingStep('idle');
    }
  };

  const joinGame = async (code: string, avatarUrl: string) => {
    if (!user) {
      await handleSignIn();
      return;
    }
    void requestTurnNotificationPermission();
    setIsJoiningGame(true);
    setLoadingStep('joining_match');

    try {
      const q = query(collection(db, 'games'), where('code', '==', code), where('status', '==', 'waiting'));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setError("Game not found or already started.");
        return;
      }

      const gameDoc = snapshot.docs[0];
      await joinWaitingGameById(gameDoc.id, avatarUrl);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `games/join`);
      setError("Failed to join game.");
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
      hostId: user.uid,
      playerIds: [user.uid],
      currentTurn: user.uid,
      winnerId: null,
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp()
    };

    const initialPlayer: Player = {
      uid: user.uid,
      name: user.displayName || 'Host',
      score: 0,
      streak: 0,
      completedCategories: [],
      avatarUrl
    };

    try {
      await setDoc(doc(db, 'games', gameId), newGame);
      await setDoc(doc(db, 'games', gameId, 'players', user.uid), initialPlayer);

      setIsFetchingQuestions(true);
      setLoadingStep('loading_questions');
      const initialQuestions = await getQuestionsForSession({
        categories: playableCategories,
        count: 3,
        excludeQuestionIds: existingQuestionIds
      });
      await persistQuestionsToGame(gameId, initialQuestions);
      kickOffInventoryReplenishment(playableCategories);
      setIsFetchingQuestions(false);
      setLoadingStep('finalizing_lobby');

      await sendInvite({
        uid: user.uid,
        displayName: user.displayName || 'Host',
        photoURL: avatarUrl || user.photoURL || undefined,
      }, player, gameId);

      setInviteFeedback(`Invite sent to ${player.displayName}`);
      setGame(newGame);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${player.uid}/invites`);
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
        await expireInvite(invite.id, user.uid);
        return;
      }

      await acceptInvite(invite.id, user.uid);
      setInviteFeedback(`Joined ${invite.fromDisplayName}'s match`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/invites/${invite.id}`);
      setError('Failed to accept invite.');
    } finally {
      setIsJoiningGame(false);
      setLoadingStep('idle');
    }
  };

  const handleDeclineInvite = async (invite: GameInvite) => {
    if (!user) return;

    try {
      await declineInvite(invite.id, user.uid);
      setInviteFeedback(`Declined invite from ${invite.fromDisplayName}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/invites/${invite.id}`);
      setError('Failed to decline invite.');
    }
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
      showCategoryReveal(resolvedCategory, q);
      ensureQuestionInventory({
        category: resolvedCategory,
        difficulty: q.difficulty || 'medium',
        minimumApproved: 8,
        replenishBatchSize: 4,
      }).catch((err) => {
        if (import.meta.env.DEV) {
          console.warn(`[questionInventory] Failed for ${resolvedCategory}/${q.difficulty || 'medium'}:`, err);
        }
      });
    } else {
      // Fetch more questions if needed
      setIsFetchingQuestions(true);
      setLoadingStep('loading_questions');
      getQuestionsForSession({
        categories: [resolvedCategory],
        count: 3,
        excludeQuestionIds: existingQuestionIds
      }).then(newQs => {
        if (newQs.length > 0) {
          setLoadingStep('finalizing_round');
          const q = newQs[0];
          showCategoryReveal(resolvedCategory, q);
          // Save new questions to DB
          persistQuestionsToGame(game!.id, newQs).catch((err) => {
            handleFirestoreError(err, OperationType.WRITE, `games/${game!.id}/questions`);
          });
          ensureQuestionInventory({
            category: resolvedCategory,
            difficulty: q.difficulty || 'medium',
            minimumApproved: 8,
            replenishBatchSize: 4,
          }).catch((err) => {
            if (import.meta.env.DEV) {
              console.warn(`[questionInventory] Failed for ${resolvedCategory}/${q.difficulty || 'medium'}:`, err);
            }
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
    setCorrectAnswer(currentQuestion.answerIndex);
    const isCorrect = resolvedIndex === currentQuestion.answerIndex;
    const selectedChoice = resolvedIndex >= 0 ? currentQuestion.choices[resolvedIndex] : 'No answer before the timer expired';
    const correctChoice = currentQuestion.choices[currentQuestion.answerIndex];

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

    const playerRef = doc(db, 'games', game.id, 'players', user.uid);
    const currentPlayer = players.find(p => p.uid === user.uid);
    setResultPhase('revealing');

    try {
      if (isCorrect) {
        const newStreak = (currentPlayer?.streak || 0) + 1;
        const alreadyCompleted = currentPlayer?.completedCategories.includes(currentQuestion.category);
        const earnedNewTrophy = !alreadyCompleted;

        await updateDoc(playerRef, {
          score: increment(1),
          streak: newStreak,
          completedCategories: alreadyCompleted ? arrayUnion() : arrayUnion(currentQuestion.category)
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
          await updateDoc(doc(db, 'games', game.id), {
            status: 'completed',
            winnerId: user.uid,
            lastUpdated: serverTimestamp()
          });
          confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        }
      } else {
        setLastAnswerCorrect(false);
        lastFailureRef.current = resolvedIndex >= 0
          ? `Missed "${currentQuestion.question}" in ${currentQuestion.category}. Picked "${selectedChoice}" when the correct answer was "${correctChoice}". ${currentQuestion.explanation}`
          : `Ran out of time on "${currentQuestion.question}" in ${currentQuestion.category}. The correct answer was "${correctChoice}". ${currentQuestion.explanation}`;
        await updateDoc(playerRef, { streak: 0 });

        // End turn in multiplayer
        if (!isSolo && game.playerIds.length > 1) {
          const nextPlayerId = game.playerIds.find(id => id !== user.uid);
          await updateDoc(doc(db, 'games', game.id), {
            currentTurn: nextPlayerId,
            lastUpdated: serverTimestamp()
          });
        }
      }

      // Mark question as used
      await updateDoc(doc(db, 'games', game.id, 'questions', currentQuestion.id), { used: true });
      if (currentQuestion.questionId) {
        await updateDoc(doc(db, 'questionBank', currentQuestion.questionId), {
          usedCount: increment(1)
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `games/${game.id}/action`);
    } finally {
      if (revealTimeoutRef.current) {
        window.clearTimeout(revealTimeoutRef.current);
      }

      revealTimeoutRef.current = window.setTimeout(() => {
        if (activeQuestionIdRef.current !== questionId || resolvedQuestionIdRef.current !== questionId) {
          return;
        }

        setRoast({
          explanation: currentQuestion.explanation,
          isCorrect,
        });
        setResultPhase('explaining');
      }, 650);
    }
  };

  const nextTurn = () => {
    continueAfterExplanation();
  };

  const shouldShowMatchChat = !!game && !isSolo && (
    game.status === 'waiting' ||
    (game.status === 'active' && (
      (game.currentTurn === user?.uid && !currentQuestion) ||
      game.currentTurn !== user?.uid
    ))
  );
  const setupLoadingCopy = getLoadingCopy(loadingStep);
  const questionLoadingCopy = getLoadingCopy(loadingStep === 'idle' ? 'loading_questions' : loadingStep);

  const resetGame = () => {
    if (categoryRevealTimeoutRef.current) {
      window.clearTimeout(categoryRevealTimeoutRef.current);
      categoryRevealTimeoutRef.current = null;
    }

    setGame(null);
    setPlayers([]);
    setQuestions([]);
    setCurrentQuestion(null);
    setIsSolo(false);
    setError(null);
    setLastAnswerCorrect(false);
    setManualPickReady(false);
    setShowManualPickPrompt(false);
    setRevealedCategory(null);
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
    if (!game || !user || game.hostId !== user.uid) return;
    setIsStartingGame(true);
    setLoadingStep('creating_match');
    try {
      // Reset players
      for (const p of players) {
        await updateDoc(doc(db, 'games', game.id, 'players', p.uid), {
          score: 0,
          streak: 0,
          completedCategories: []
        });
      }

      // Generate new questions
      setIsFetchingQuestions(true);
      setLoadingStep('loading_questions');
      const initialQuestions = await getQuestionsForSession({
        categories: playableCategories,
        count: 3,
        excludeQuestionIds: existingQuestionIds
      });
      await persistQuestionsToGame(game.id, initialQuestions);
      kickOffInventoryReplenishment(playableCategories);
      setIsFetchingQuestions(false);
      setLoadingStep('finalizing_match');

      // Reset game state
      const firstTurnPlayerId = players.find((player) => player.uid !== game.hostId)?.uid || game.hostId;
      await updateDoc(doc(db, 'games', game.id), {
        status: 'active',
        currentTurn: firstTurnPlayerId,
        winnerId: null,
        lastUpdated: serverTimestamp()
      });
      setLastAnswerCorrect(false);
      setManualPickReady(false);
      setShowManualPickPrompt(false);
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
      handleFirestoreError(err, OperationType.UPDATE, `games/${game.id}`);
      setError("Failed to restart game.");
    } finally {
      setIsStartingGame(false);
      setIsFetchingQuestions(false);
      setLoadingStep('idle');
    }
  };

  const sendMessage = async () => {
    if (!game || !user || !chatInput.trim() || isSendingMessage) return;
    setIsSendingMessage(true);
    const currentPlayer = players.find(p => p.uid === user.uid);
    const messageRef = collection(db, 'games', game.id, 'messages');

    try {
      await setDoc(doc(messageRef), {
        uid: user.uid,
        name: currentPlayer?.name || 'Player',
        text: chatInput.trim(),
        timestamp: serverTimestamp(),
        avatarUrl: currentPlayer?.avatarUrl
      });
      setChatInput('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `games/${game.id}/messages`);
      setError("Failed to send message.");
    } finally {
      setIsSendingMessage(false);
    }
  };

  const startGame = async () => {
    if (!game || game.hostId !== user?.uid) return;
    const firstTurnPlayerId = players.find((player) => player.uid !== game.hostId)?.uid;
    if (!firstTurnPlayerId) return;

    try {
      await updateDoc(doc(db, 'games', game.id), {
        status: 'active',
        currentTurn: firstTurnPlayerId,
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `games/${game.id}`);
    }
  };

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

        <div data-theme={themeMode} className="app-theme min-h-screen flex flex-col items-center justify-center p-6 space-y-12 relative">
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

          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center relative"
          >
            <div className="relative inline-block w-64 h-64 md:w-80 md:h-80">
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
            className="px-8 py-4 bg-white hover:bg-gray-100 text-zinc-900 rounded-xl text-lg font-black uppercase tracking-widest hover:scale-[1.02] transition-all duration-300 ease-in-out shadow-[0_8px_30px_rgba(255,255,255,0.15)] flex items-center gap-3"
          >
            Login with Google
          </motion.button>

          {error && (
            <div
              className="max-w-lg rounded-xl border border-rose-500/40 bg-rose-950/40 px-5 py-4 text-center text-sm font-medium text-rose-300 shadow-[0_8px_20px_rgba(244,63,94,0.15)]"
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

      <Suspense fallback={null}>
        <InstallPrompt />
      </Suspense>

      <div data-theme={themeMode} className="app-theme min-h-screen font-sans">
        {!isQuestionActive && (
          <header className="p-4 flex justify-between items-center theme-panel backdrop-blur-md border-b sticky top-0 z-40">
            <div className="flex items-center gap-4">
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
              {import.meta.env.DEV && (
                <button type="button"
                  onClick={() => setShowQuestionBankAdmin(true)}
                  className="px-3 py-2 rounded-xl theme-button text-xs font-black uppercase tracking-widest"
                  title="Question Bank Admin"
                  aria-label="Open question bank admin"
                >
                  Dev
                </button>
              )}
            </div>
            <div className="flex items-center gap-4">
              {game && (
                <button type="button"
                  onClick={openQuitConfirm}
                  className="p-2 theme-icon-button transition-colors rounded-full"
                  title="Quit Match"
                  aria-label="Quit current match"
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

        <main className={`max-w-3xl mx-auto p-4 pb-24 ${isQuestionActive ? 'pt-6' : ''}`}>
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
                              {g.lastUpdated ? new Date(g.lastUpdated.toMillis()).toLocaleDateString() : 'Unknown Date'}
                            </p>
                            <p className="text-sm font-bold">
                              {g.code === 'SOLO' ? 'Solo Game' : 'Multiplayer'}
                            </p>
                          </div>
                          <div className="text-right">
                            {g.winnerId === user.uid ? (
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
              <div key="lobby-view" className="relative">
                {(isStartingGame || isJoiningGame) && (
                  <div className="absolute inset-0 z-10 theme-overlay backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center">
                    <Loader2 className="w-8 h-8 text-pink-500 animate-spin mb-4" />
                    <p className="text-base font-bold theme-text-secondary">
                      {setupLoadingCopy.title}
                    </p>
                    <p className="text-xs font-bold uppercase tracking-widest theme-text-muted mt-2 text-center">
                      {setupLoadingCopy.flow}
                    </p>
                  </div>
                )}
                <GameLobby
                  onStartSolo={startSoloGame}
                  onStartMulti={startMultiplayerGame}
                  onJoinMulti={joinGame}
                  recentPlayers={recentPlayers}
                  incomingInvites={incomingInvites}
                  onInviteRecentPlayer={inviteRecentPlayer}
                  onAcceptInvite={handleAcceptInvite}
                  onDeclineInvite={handleDeclineInvite}
                  inviteFeedback={inviteFeedback}
                />
              </div>
            ) : (
              <motion.div
                key="game-view"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-8"
              >
                {game.status === 'waiting' && (
                  <div className="flex justify-end items-end theme-panel backdrop-blur-sm p-5 rounded-2xl border">
                    <div className="text-right px-4">
                      <p className="text-[10px] font-black uppercase tracking-widest theme-text-muted mb-1">Join Code</p>
                      <p className="text-4xl font-black text-pink-500 tracking-tighter leading-none">{game.code}</p>
                    </div>
                  </div>
                )}

                {!isQuestionActive && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {players.map(p => (
                      <CategoryTracker
                        key={p.uid}
                        playerName={p.name}
                        avatarUrl={p.avatarUrl}
                        completed={p.completedCategories}
                        isCurrentTurn={game.currentTurn === p.uid}
                        score={p.score}
                      />
                    ))}
                  </div>
                )}

                {/* Game Content */}
                <div className={`relative ${isQuestionActive ? 'py-4' : 'py-12'}`}>
                  {game.status === 'completed' ? (
                    <motion.div
                      initial={{ scale: 0.95, opacity: 0, y: 20 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                      className="text-center space-y-8 theme-panel-strong backdrop-blur-xl border p-12 rounded-2xl"
                    >
                      <Trophy className="w-24 h-24 mx-auto text-yellow-400 drop-shadow-[0_0_30px_rgba(250,204,21,0.4)] animate-bounce" />
                      <div>
                        <h2 className="text-4xl font-black uppercase tracking-tight mb-2">Game Over</h2>
                        <p className="text-xl theme-text-muted">
                          {game.winnerId === user.uid ? "You actually won. Incredible." : "You lost. Shocker."}
                        </p>
                      </div>
                      {game.hostId === user.uid ? (
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
                  ) : game.status === 'active' && game.currentTurn === user.uid ? (
                    <div className="space-y-8">
                      {!currentQuestion ? (
                        <div className="flex flex-col items-center gap-8">
                          <p className="text-base font-black uppercase tracking-widest text-cyan-400 animate-pulse">Your Turn</p>
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
                            <div className="flex items-center gap-2 theme-text-muted text-sm">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>{activeQuestionLoadingLine}</span>
                              <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                                {questionLoadingCopy.flow}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className={`transition-all duration-300 ${isQuestionResolutionActive ? 'blur-sm scale-[0.99]' : ''}`}>
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
                    <div className="text-center p-12 theme-panel border rounded-3xl">
                      <Loader2 className="w-8 h-8 text-pink-500 animate-spin mx-auto mb-4" />
                      <p className="text-lg font-medium theme-text-muted">
                        Waiting for another player to join and for the host to start the game...
                      </p>
                    </div>
                  ) : (
                    <div className="text-center p-12 theme-panel border rounded-3xl space-y-6">
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
                  <div className="theme-panel backdrop-blur-xl border rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold uppercase tracking-widest theme-text-muted">
                        {game.status === 'waiting' ? 'Lobby Chat' : 'Match Chat'}
                      </h3>
                      {game.status === 'waiting' && game.hostId === user.uid && players.length >= 2 && (
                        <button type="button"
                          onClick={startGame}
                          className="px-6 py-2.5 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:scale-[1.02] transition-all duration-300 shadow-lg hover:shadow-pink-500/25 ease-in-out"
                        >
                          Start Game
                        </button>
                      )}
                    </div>

                    <div className="h-64 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                      {messages.length === 0 ? (
                        <p className="text-center theme-text-muted italic text-sm py-12">No messages yet. Say something funny.</p>
                      ) : (
                        messages.map(m => (
                          <div key={m.id} className={`flex gap-3 ${m.uid === user.uid ? 'flex-row-reverse' : ''}`}>
                            <div className="w-10 h-10 theme-avatar-surface rounded-full flex items-center justify-center text-sm shrink-0 overflow-hidden shadow-inner border">
                              {m.avatarUrl ? <img src={m.avatarUrl} alt="Avatar" className="w-full h-full object-cover" /> : '👤'}
                            </div>
                            <div className={`max-w-[75%] p-4 rounded-2xl text-sm shadow-md ${m.uid === user.uid
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

                    <div className="flex gap-3 pt-2">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                        placeholder="Type a message..."
                        disabled={isSendingMessage}
                        className="flex-1 theme-input border rounded-xl px-5 py-3 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all duration-300 disabled:opacity-50 theme-inset"
                      />
                      <button type="button"
                        onClick={sendMessage}
                        disabled={isSendingMessage || !chatInput.trim()}
                        className="p-3 bg-purple-600 rounded-xl hover:bg-purple-500 transition-all duration-300 disabled:opacity-50 flex items-center justify-center shadow-[0_4px_14px_0_rgba(147,51,234,0.39)] hover:shadow-[0_6px_20px_rgba(147,51,234,0.23)] active:scale-[0.96]"
                      >
                        {isSendingMessage ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Roast Overlay */}
        {roast && (
          <Roast
            explanation={roast.explanation}
            isCorrect={roast.isCorrect}
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
          title={confirmAction === 'quit' ? 'Quit Match?' : 'Sign Out?'}
          message={
            confirmAction === 'quit'
              ? 'Leave this match and return to the lobby? Your current game view will close.'
              : 'Sign out and return to the login screen?'
          }
          confirmLabel={confirmAction === 'quit' ? 'Quit' : 'Sign Out'}
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
