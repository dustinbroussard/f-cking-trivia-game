/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  getDocs,
  updateDoc,
  serverTimestamp,
  increment,
  arrayUnion,
  deleteDoc
} from 'firebase/firestore';
import { auth, db, signIn, handleFirestoreError, OperationType } from './firebase';
import { GameState, Player, TriviaQuestion, CATEGORIES, ChatMessage } from './types';
import { generateQuestions, generateRoast } from './services/gemini';
import { GameLobby } from './components/GameLobby';
import { Wheel } from './components/Wheel';
import { QuestionCard } from './components/QuestionCard';
import { CategoryTracker } from './components/CategoryTracker';
import { Roast } from './components/Roast';
import { InstallPrompt } from './components/InstallPrompt';
import { publicAsset } from './assets';
import { motion, AnimatePresence } from 'motion/react';
import { LogOut, RefreshCcw, Trophy, ArrowLeft, Volume2, VolumeX, Send, Loader2, History, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import { orderBy, limit } from 'firebase/firestore';

export default function App() {
  const themeAudioSrc = publicAsset('theme.mp3');
  const welcomeAudioSrc = publicAsset('welcome.mp3');
  const correctAudioSrc = publicAsset('correct.mp3');
  const wrongAudioSrc = publicAsset('wrong.mp3');
  const wonAudioSrc = publicAsset('won.mp3');
  const lostAudioSrc = publicAsset('lost.mp3');
  const logoSrc = publicAsset('logo.jpg');

  const [user, setUser] = useState<User | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [questions, setQuestions] = useState<TriviaQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<TriviaQuestion | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [roast, setRoast] = useState<{ message: string; isCorrect: boolean } | null>(null);
  
  // Granular loading states
  const [isInitializing, setIsInitializing] = useState(true);
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [isJoiningGame, setIsJoiningGame] = useState(false);
  const [isFetchingQuestions, setIsFetchingQuestions] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  const [isSolo, setIsSolo] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  
  const [pastGames, setPastGames] = useState<GameState[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [correctAnswer, setCorrectAnswer] = useState<number | null>(null);

  const themeAudioRef = useRef<HTMLAudioElement>(null);
  const welcomeAudioRef = useRef<HTMLAudioElement>(null);
  const correctAudioRef = useRef<HTMLAudioElement>(null);
  const wrongAudioRef = useRef<HTMLAudioElement>(null);
  const wonAudioRef = useRef<HTMLAudioElement>(null);
  const lostAudioRef = useRef<HTMLAudioElement>(null);
  const prevGameStatus = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsInitializing(false);
    });
    return () => unsubscribe();
  }, []);

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
      if (soundEnabled) {
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
  }, [soundEnabled, user]);

  useEffect(() => {
    if (game?.status === 'completed' && prevGameStatus.current !== 'completed') {
      if (soundEnabled) {
        if (game.winnerId === user?.uid) {
          if (wonAudioRef.current) {
            wonAudioRef.current.currentTime = 0;
            wonAudioRef.current.play().catch(console.error);
          }
        } else {
          if (lostAudioRef.current) {
            lostAudioRef.current.currentTime = 0;
            lostAudioRef.current.play().catch(console.error);
          }
        }
      }
    }
    prevGameStatus.current = game?.status || null;
  }, [game?.status, game?.winnerId, user?.uid, soundEnabled]);

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

  const handleSignIn = async () => {
    try {
      await signIn();
    } catch (err: any) {
      if (err.code === 'auth/cancelled-popup-request') {
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
      const initialQuestions = await generateQuestions(CATEGORIES.filter(c => c !== 'Random'));
      for (const q of initialQuestions) {
        await setDoc(doc(db, 'games', gameId, 'questions', q.id), q);
      }
      setIsFetchingQuestions(false);
      
      setGame(newGame);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `games/${gameId}`);
      setError("Failed to start game.");
    } finally {
      setIsStartingGame(false);
      setIsFetchingQuestions(false);
    }
  };

  const startMultiplayerGame = async (avatarUrl: string) => {
    if (!user) {
      await handleSignIn();
      return;
    }
    setIsStartingGame(true);
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
      const initialQuestions = await generateQuestions(CATEGORIES.filter(c => c !== 'Random'));
      for (const q of initialQuestions) {
        await setDoc(doc(db, 'games', gameId, 'questions', q.id), q);
      }
      setIsFetchingQuestions(false);
      
      setGame(newGame);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `games/${gameId}`);
      setError("Failed to start multiplayer game.");
    } finally {
      setIsStartingGame(false);
      setIsFetchingQuestions(false);
    }
  };

  const joinGame = async (code: string, avatarUrl: string) => {
    if (!user) {
      await handleSignIn();
      return;
    }
    setIsJoiningGame(true);
    
    try {
      const q = query(collection(db, 'games'), where('code', '==', code), where('status', '==', 'waiting'));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        setError("Game not found or already started.");
        return;
      }

      const gameDoc = snapshot.docs[0];
      const gameData = gameDoc.data() as GameState;
      
      if (gameData.playerIds.length >= 2) {
        setError("Game is full.");
        return;
      }

      const playerRef = doc(db, 'games', gameDoc.id, 'players', user.uid);
      await setDoc(playerRef, {
        uid: user.uid,
        name: user.displayName || 'Guest',
        score: 0,
        streak: 0,
        completedCategories: [],
        avatarUrl
      });

      await updateDoc(doc(db, 'games', gameDoc.id), {
        playerIds: arrayUnion(user.uid),
        status: 'active',
        lastUpdated: serverTimestamp()
      });

      setGame({ id: gameDoc.id, ...gameData } as GameState);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `games/join`);
      setError("Failed to join game.");
    } finally {
      setIsJoiningGame(false);
    }
  };

  const handleSpinComplete = (category: string) => {
    setIsSpinning(false);
    setSelectedCategory(category);
    
    // Find an unused question in this category
    const available = questions.filter(q => !q.used && (category === 'Random' || q.category === category));
    if (available.length > 0) {
      const q = available[Math.floor(Math.random() * available.length)];
      setCurrentQuestion(q);
    } else {
      // Fetch more questions if needed
      setIsFetchingQuestions(true);
      generateQuestions([category === 'Random' ? 'General' : category]).then(newQs => {
        if (newQs.length > 0) {
          const q = newQs[0];
          setCurrentQuestion(q);
          // Save new questions to DB
          newQs.forEach(nq => setDoc(doc(db, 'games', game!.id, 'questions', nq.id), nq));
        } else {
          setError("Failed to load questions. Please try again.");
        }
        setIsFetchingQuestions(false);
      });
    }
  };

  const handleAnswer = async (index: number) => {
    if (!currentQuestion || !game || !user) return;

    setSelectedAnswer(index);
    setCorrectAnswer(currentQuestion.answerIndex);
    const isCorrect = index === currentQuestion.answerIndex;
    
    if (soundEnabled) {
      if (isCorrect) {
        if (correctAudioRef.current) {
          correctAudioRef.current.currentTime = 0;
          correctAudioRef.current.play().catch(console.error);
        }
      } else {
        if (wrongAudioRef.current) {
          wrongAudioRef.current.currentTime = 0;
          wrongAudioRef.current.play().catch(console.error);
        }
      }
    }

    const playerRef = doc(db, 'games', game.id, 'players', user.uid);
    const currentPlayer = players.find(p => p.uid === user.uid);

    // Generate context-aware roast
    const roastMessage = await generateRoast(
      currentQuestion.category,
      currentQuestion.question,
      currentQuestion.choices[index],
      isCorrect,
      currentPlayer?.name || 'Player',
      currentPlayer?.streak || 0,
      currentPlayer?.score || 0,
      currentPlayer?.completedCategories || []
    );

    setRoast({ message: roastMessage, isCorrect });

    try {
      if (isCorrect) {
        const newStreak = (currentPlayer?.streak || 0) + 1;
        const alreadyCompleted = currentPlayer?.completedCategories.includes(currentQuestion.category);
        
        await updateDoc(playerRef, {
          score: increment(1),
          streak: newStreak,
          completedCategories: alreadyCompleted ? arrayUnion() : arrayUnion(currentQuestion.category)
        });

        // Check for win
        const updatedPlayer = { ...currentPlayer!, completedCategories: [...(currentPlayer?.completedCategories || []), currentQuestion.category] };
        if (updatedPlayer.completedCategories.length >= 6) {
          await updateDoc(doc(db, 'games', game.id), {
            status: 'completed',
            winnerId: user.uid,
            lastUpdated: serverTimestamp()
          });
          confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        }
      } else {
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
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `games/${game.id}/action`);
    }
  };

  const nextTurn = () => {
    setRoast(null);
    setCurrentQuestion(null);
    setSelectedCategory(null);
    setSelectedAnswer(null);
    setCorrectAnswer(null);
  };

  const resetGame = () => {
    setGame(null);
    setPlayers([]);
    setQuestions([]);
    setCurrentQuestion(null);
    setIsSolo(false);
    setError(null);
  };

  const playAgain = async () => {
    if (!game || !user || game.hostId !== user.uid) return;
    setIsStartingGame(true);
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
      const initialQuestions = await generateQuestions(CATEGORIES.filter(c => c !== 'Random'));
      for (const q of initialQuestions) {
        await setDoc(doc(db, 'games', game.id, 'questions', q.id), q);
      }
      setIsFetchingQuestions(false);

      // Reset game state
      await updateDoc(doc(db, 'games', game.id), {
        status: 'active',
        currentTurn: game.hostId,
        winnerId: null,
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `games/${game.id}`);
      setError("Failed to restart game.");
    } finally {
      setIsStartingGame(false);
      setIsFetchingQuestions(false);
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
    try {
      await updateDoc(doc(db, 'games', game.id), {
        status: 'active',
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
        <audio ref={welcomeAudioRef} src={welcomeAudioSrc} />
        <audio ref={correctAudioRef} src={correctAudioSrc} />
        <audio ref={wrongAudioRef} src={wrongAudioSrc} />
        <audio ref={wonAudioRef} src={wonAudioSrc} />
        <audio ref={lostAudioRef} src={lostAudioSrc} />

        <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 space-y-12 relative">
          <button 
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="absolute top-6 right-6 p-4 bg-zinc-900 rounded-full text-white hover:bg-zinc-800 transition-colors shadow-lg z-50"
            title={soundEnabled ? "Mute Audio" : "Play Audio"}
          >
            {soundEnabled ? <Volume2 className="w-6 h-6 text-cyan-400" /> : <VolumeX className="w-6 h-6 text-zinc-500" />}
          </button>

          <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center relative"
        >
          <div className="relative inline-block w-64 h-64 md:w-80 md:h-80">
            <img 
              src={logoSrc} 
              alt="AFTG: A F-ing Trivia Game" 
              className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]"
              referrerPolicy="no-referrer"
            />
          </div>
        </motion.div>

        <motion.button
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          onClick={handleSignIn}
          className="px-8 py-4 bg-white hover:bg-gray-100 text-zinc-900 rounded-xl text-lg font-black uppercase tracking-widest hover:scale-[1.02] transition-all duration-300 ease-in-out shadow-[0_8px_30px_rgba(255,255,255,0.15)] flex items-center gap-3"
        >
          Login with Google
        </motion.button>

        <div className="text-center space-y-2 max-w-xs opacity-50">
          <p className="text-zinc-500 font-bold text-sm uppercase tracking-widest">
            Fast. Funny. Fair. No BS.
          </p>
        </div>
        </div>
      </>
    );
  }

  return (
    <>
      <audio ref={themeAudioRef} src={themeAudioSrc} loop />
      <audio ref={welcomeAudioRef} src={welcomeAudioSrc} />
      <audio ref={correctAudioRef} src={correctAudioSrc} />
      <audio ref={wrongAudioRef} src={wrongAudioSrc} />
      <audio ref={wonAudioRef} src={wonAudioSrc} />
      <audio ref={lostAudioRef} src={lostAudioSrc} />

      <InstallPrompt />

      <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-pink-500/30">
        {/* Header */}
        <header className="p-4 flex justify-between items-center bg-zinc-900/50 backdrop-blur-md border-b border-white/5 sticky top-0 z-40">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-cyan-400 uppercase cursor-pointer" onClick={resetGame}>
              AFTG
            </h1>
            <button 
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2 text-zinc-400 hover:text-white transition-colors rounded-full hover:bg-white/5"
            >
              {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
          </div>
          <div className="flex items-center gap-4">
            {!game && (
              <button 
                onClick={() => setShowHistory(true)}
                className="p-2 text-zinc-400 hover:text-white transition-colors rounded-full hover:bg-white/5"
                title="Match History"
              >
                <History className="w-5 h-5" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-400 hidden sm:block">
                {user.displayName}
              </span>
              <button onClick={() => auth.signOut()} className="p-2 text-zinc-400 hover:text-white transition-colors rounded-full hover:bg-white/5">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

      <main className="max-w-3xl mx-auto p-4 pb-24">
        <AnimatePresence>
          {error && (
            <motion.div
              key="error-banner"
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="mb-6 p-4 bg-rose-950/40 border border-rose-500/30 rounded-xl flex items-center justify-between shadow-[0_8px_20px_rgba(244,63,94,0.15)]"
            >
              <span className="text-rose-400 text-sm font-medium">{error}</span>
              <button onClick={() => setError(null)} className="p-1 hover:bg-rose-500/20 rounded-lg transition-colors text-rose-400">
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
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            >
                <motion.div 
                  initial={{ scale: 0.95, opacity: 0, y: 20 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.95, opacity: 0, y: 20 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  className="bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-6 w-full max-w-lg shadow-[0_20px_50px_rgba(0,0,0,0.5)] max-h-[80vh] flex flex-col"
                >
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-black uppercase tracking-tight text-white">Match History</h2>
                    <button onClick={() => setShowHistory(false)} className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-all duration-300">
                      <X className="w-6 h-6" />
                    </button>
                  </div>
                  
                  <div className="overflow-y-auto custom-scrollbar flex-1 pr-2 space-y-3">
                    {pastGames.length === 0 ? (
                      <p className="text-zinc-500 text-center py-8">No completed games yet.</p>
                    ) : (
                      pastGames.map(g => (
                        <div key={g.id} className="bg-zinc-800/50 border border-white/5 rounded-2xl p-4 flex items-center justify-between">
                          <div>
                            <p className="text-xs text-zinc-400 font-medium mb-1">
                              {g.lastUpdated ? new Date(g.lastUpdated.toMillis()).toLocaleDateString() : 'Unknown Date'}
                            </p>
                            <p className="text-sm font-bold text-white">
                              {g.code === 'SOLO' ? 'Solo Game' : 'Multiplayer'}
                            </p>
                          </div>
                          <div className="text-right">
                            {g.winnerId === user.uid ? (
                              <span className="inline-flex items-center gap-1 text-emerald-400 font-black text-sm uppercase tracking-wider">
                                <Trophy className="w-4 h-4" /> Won
                              </span>
                            ) : (
                              <span className="text-zinc-500 font-bold text-sm uppercase tracking-wider">
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
                <div className="absolute inset-0 z-10 bg-zinc-950/80 backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center">
                  <Loader2 className="w-8 h-8 text-pink-500 animate-spin mb-4" />
                  <p className="text-sm font-medium text-zinc-300">
                    {isFetchingQuestions ? "Generating sarcastic questions..." : "Setting up game..."}
                  </p>
                </div>
              )}
              <GameLobby 
                onStartSolo={startSoloGame} 
                onStartMulti={startMultiplayerGame} 
                onJoinMulti={joinGame} 
              />
            </div>
          ) : (
            <motion.div
              key="game-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              {/* Game Info */}
              <div className="flex justify-between items-end bg-zinc-900/40 backdrop-blur-sm p-5 rounded-2xl border border-white/5 shadow-sm">
                <button onClick={resetGame} className="flex items-center gap-2 text-zinc-400 hover:text-white transition-all duration-300 px-4 py-2.5 rounded-xl hover:bg-white/10">
                  <ArrowLeft className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Quit</span>
                </button>
                {game.status === 'waiting' && (
                  <div className="text-right px-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Join Code</p>
                    <p className="text-4xl font-black text-pink-500 tracking-tighter leading-none">{game.code}</p>
                  </div>
                )}
              </div>

              {/* Player Progress */}
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

              {/* Chat in Waiting Room */}
              {game.status === 'waiting' && (
                <div className="bg-zinc-900/60 backdrop-blur-xl border border-white/5 rounded-2xl p-6 space-y-4 shadow-[0_8px_30px_rgb(0,0,0,0.2)]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">Lobby Chat</h3>
                    {game.hostId === user.uid && players.length >= 2 && (
                      <button 
                        onClick={startGame}
                        className="px-6 py-2.5 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:scale-[1.02] transition-all duration-300 shadow-lg hover:shadow-pink-500/25 ease-in-out"
                      >
                        Start Game
                      </button>
                    )}
                  </div>
                  
                  <div className="h-64 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                    {messages.length === 0 ? (
                      <p className="text-center text-zinc-500 italic text-sm py-12">No messages yet. Say something funny.</p>
                    ) : (
                      messages.map(m => (
                        <div key={m.id} className={`flex gap-3 ${m.uid === user.uid ? 'flex-row-reverse' : ''}`}>
                          <div className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center text-sm shrink-0 overflow-hidden shadow-inner border border-white/5">
                            {m.avatarUrl ? <img src={m.avatarUrl} alt="Avatar" className="w-full h-full object-cover" /> : '👤'}
                          </div>
                          <div className={`max-w-[75%] p-4 rounded-2xl text-sm shadow-md ${
                            m.uid === user.uid 
                              ? 'bg-purple-600 text-white rounded-tr-sm' 
                              : 'bg-zinc-800 text-zinc-200 rounded-tl-sm border border-white/5'
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
                      className="flex-1 bg-zinc-950/80 border border-white/10 rounded-xl px-5 py-3 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all duration-300 disabled:opacity-50 shadow-inner"
                    />
                    <button 
                      onClick={sendMessage}
                      disabled={isSendingMessage || !chatInput.trim()}
                      className="p-3 bg-purple-600 rounded-xl hover:bg-purple-500 transition-all duration-300 disabled:opacity-50 flex items-center justify-center shadow-[0_4px_14px_0_rgba(147,51,234,0.39)] hover:shadow-[0_6px_20px_rgba(147,51,234,0.23)] active:scale-[0.96]"
                    >
                      {isSendingMessage ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Game Content */}
              <div className="relative py-12">
                {game.status === 'completed' ? (
                  <motion.div 
                    initial={{ scale: 0.95, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                    className="text-center space-y-8 bg-zinc-900/60 backdrop-blur-xl border border-white/10 p-12 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
                  >
                    <Trophy className="w-24 h-24 mx-auto text-yellow-400 drop-shadow-[0_0_30px_rgba(250,204,21,0.4)] animate-bounce" />
                    <div>
                      <h2 className="text-4xl font-black text-white uppercase tracking-tight mb-2">Game Over</h2>
                      <p className="text-xl text-zinc-400">
                        {game.winnerId === user.uid ? "You actually won. Incredible." : "You lost. Shocker."}
                      </p>
                    </div>
                    {game.hostId === user.uid ? (
                      <button
                        onClick={playAgain}
                        disabled={isStartingGame}
                        className="mx-auto flex items-center justify-center gap-3 px-8 py-4 bg-white text-black rounded-xl font-bold text-lg hover:scale-[1.02] transition-all duration-300 shadow-[0_8px_30px_rgba(255,255,255,0.15)] disabled:opacity-50 ease-in-out"
                      >
                        {isStartingGame ? <Loader2 className="w-6 h-6 animate-spin" /> : <RefreshCcw className="w-6 h-6" />}
                        Play Again
                      </button>
                    ) : (
                      <p className="text-zinc-500 font-bold uppercase tracking-widest">Waiting for host to play again...</p>
                    )}
                  </motion.div>
                ) : game.currentTurn === user.uid ? (
                  <div className="space-y-8">
                    {!currentQuestion ? (
                      <div className="flex flex-col items-center gap-8">
                        <p className="text-sm font-bold uppercase tracking-widest text-cyan-400 animate-pulse">Your Turn</p>
                        <Wheel 
                          onSpinComplete={handleSpinComplete} 
                          isSpinning={isSpinning}
                          setIsSpinning={setIsSpinning}
                          soundEnabled={soundEnabled}
                        />
                        {isFetchingQuestions && (
                          <div className="flex items-center gap-2 text-zinc-400 text-sm">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Generating questions...
                          </div>
                        )}
                      </div>
                    ) : (
                      <QuestionCard
                        question={currentQuestion}
                        onSelect={handleAnswer}
                        disabled={!!roast}
                        selectedId={selectedAnswer}
                        correctId={correctAnswer}
                      />
                    )}
                  </div>
                ) : (
                  <div className="text-center p-12 bg-zinc-900/50 border border-white/5 rounded-3xl">
                    <Loader2 className="w-8 h-8 text-pink-500 animate-spin mx-auto mb-4" />
                    <p className="text-lg font-medium text-zinc-400">Waiting for {players.find(p => p.uid === game.currentTurn)?.name} to spin...</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Roast Overlay */}
      {roast && (
        <Roast 
          message={roast.message} 
          isCorrect={roast.isCorrect} 
          onClose={nextTurn} 
        />
      )}
    </div>
    </>
  );
}
