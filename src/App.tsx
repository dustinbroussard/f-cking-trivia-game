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
import { GameState, Player, TriviaQuestion, CATEGORIES } from './types';
import { generateQuestions } from './services/gemini';
import { GameLobby } from './components/GameLobby';
import { Wheel } from './components/Wheel';
import { QuestionCard } from './components/QuestionCard';
import { CategoryTracker } from './components/CategoryTracker';
import { Roast } from './components/Roast';
import { motion, AnimatePresence } from 'motion/react';
import { LogOut, RefreshCcw, Trophy, ArrowLeft, Volume2, VolumeX } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [questions, setQuestions] = useState<TriviaQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<TriviaQuestion | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [roast, setRoast] = useState<{ message: string; isCorrect: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSolo, setIsSolo] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);

  const themeAudioRef = useRef<HTMLAudioElement>(null);
  const welcomeAudioRef = useRef<HTMLAudioElement>(null);
  const correctAudioRef = useRef<HTMLAudioElement>(null);
  const wrongAudioRef = useRef<HTMLAudioElement>(null);
  const wonAudioRef = useRef<HTMLAudioElement>(null);
  const lostAudioRef = useRef<HTMLAudioElement>(null);
  const prevGameStatus = useRef<string | null>(null);

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
      const pList = snapshot.docs.map(d => d.data() as Player);
      setPlayers(pList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `games/${game.id}/players`));

    const unsubQuestions = onSnapshot(questionsRef, (snapshot) => {
      const qList = snapshot.docs.map(d => d.data() as TriviaQuestion);
      setQuestions(qList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `games/${game.id}/questions`));

    return () => {
      unsubGame();
      unsubPlayers();
      unsubQuestions();
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

  const startSoloGame = async () => {
    if (!user) {
      await handleSignIn();
      return;
    }
    setLoading(true);
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
      completedCategories: []
    };

    try {
      await setDoc(doc(db, 'games', gameId), newGame);
      await setDoc(doc(db, 'games', gameId, 'players', user.uid), initialPlayer);
      
      const initialQuestions = await generateQuestions(CATEGORIES.filter(c => c !== 'Random'));
      for (const q of initialQuestions) {
        await setDoc(doc(db, 'games', gameId, 'questions', q.id), q);
      }
      
      setGame(newGame);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `games/${gameId}`);
    } finally {
      setLoading(false);
    }
  };

  const startMultiplayerGame = async () => {
    if (!user) {
      await handleSignIn();
      return;
    }
    setLoading(true);
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
      completedCategories: []
    };

    try {
      await setDoc(doc(db, 'games', gameId), newGame);
      await setDoc(doc(db, 'games', gameId, 'players', user.uid), initialPlayer);
      
      const initialQuestions = await generateQuestions(CATEGORIES.filter(c => c !== 'Random'));
      for (const q of initialQuestions) {
        await setDoc(doc(db, 'games', gameId, 'questions', q.id), q);
      }
      
      setGame(newGame);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `games/${gameId}`);
    } finally {
      setLoading(false);
    }
  };

  const joinGame = async (code: string) => {
    if (!user) {
      await handleSignIn();
      return;
    }
    setLoading(true);
    
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
        completedCategories: []
      });

      await updateDoc(doc(db, 'games', gameDoc.id), {
        playerIds: arrayUnion(user.uid),
        status: 'active',
        lastUpdated: serverTimestamp()
      });

      setGame({ id: gameDoc.id, ...gameData } as GameState);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `games/join`);
    } finally {
      setLoading(false);
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
      setLoading(true);
      generateQuestions([category === 'Random' ? 'General' : category]).then(newQs => {
        if (newQs.length > 0) {
          const q = newQs[0];
          setCurrentQuestion(q);
          // Save new questions to DB
          newQs.forEach(nq => setDoc(doc(db, 'games', game!.id, 'questions', nq.id), nq));
        }
        setLoading(false);
      });
    }
  };

  const handleAnswer = async (index: number) => {
    if (!currentQuestion || !game || !user) return;

    const isCorrect = index === currentQuestion.answerIndex;
    const quip = isCorrect ? currentQuestion.correctQuip : currentQuestion.wrongAnswerQuips[index];
    
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

    setRoast({ message: quip, isCorrect });

    const playerRef = doc(db, 'games', game.id, 'players', user.uid);
    const currentPlayer = players.find(p => p.uid === user.uid);

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
    setLoading(true);
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
      const initialQuestions = await generateQuestions(CATEGORIES.filter(c => c !== 'Random'));
      for (const q of initialQuestions) {
        await setDoc(doc(db, 'games', game.id, 'questions', q.id), q);
      }

      // Reset game state
      await updateDoc(doc(db, 'games', game.id), {
        status: 'active',
        currentTurn: game.hostId,
        winnerId: null,
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `games/${game.id}`);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <>
        <audio ref={themeAudioRef} src="/theme.mp3" loop />
        <audio ref={welcomeAudioRef} src="/welcome.mp3" />
        <audio ref={correctAudioRef} src="/correct.mp3" />
        <audio ref={wrongAudioRef} src="/wrong.mp3" />
        <audio ref={wonAudioRef} src="/won.mp3" />
        <audio ref={lostAudioRef} src="/lost.mp3" />

        <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 space-y-12 relative">
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
              src="/logo.png" 
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
          className="px-12 py-5 bg-white text-black rounded-full text-xl font-black uppercase tracking-widest hover:scale-105 transition-transform shadow-[0_0_30px_rgba(255,255,255,0.2)]"
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
      <audio ref={themeAudioRef} src="/theme.mp3" loop />
      <audio ref={welcomeAudioRef} src="/welcome.mp3" />
      <audio ref={correctAudioRef} src="/correct.mp3" />
      <audio ref={wrongAudioRef} src="/wrong.mp3" />
      <audio ref={wonAudioRef} src="/won.mp3" />
      <audio ref={lostAudioRef} src="/lost.mp3" />

      <div className="min-h-screen bg-black text-white font-sans selection:bg-pink-500 selection:text-white">
        {/* Header */}
        <header className="p-4 flex justify-between items-center border-b border-zinc-900 sticky top-0 bg-black/80 backdrop-blur-md z-40">
          <div className="flex items-center gap-2 cursor-pointer" onClick={resetGame}>
            <span className="text-2xl font-black tracking-tighter italic">AFTG</span>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2 text-zinc-500 hover:text-white transition-colors"
              title={soundEnabled ? "Mute Audio" : "Play Audio"}
            >
              {soundEnabled ? <Volume2 className="w-5 h-5 text-cyan-400" /> : <VolumeX className="w-5 h-5" />}
            </button>
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 hidden sm:block">
              {user.displayName}
            </span>
            <button onClick={() => auth.signOut()} className="p-2 text-zinc-500 hover:text-white transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

      <main className="max-w-2xl mx-auto p-4 pb-24">
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-4 p-4 bg-rose-500/10 border border-rose-500/50 rounded-2xl text-rose-500 text-xs font-bold text-center"
            >
              {error}
              <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
            </motion.div>
          )}

          {!game ? (
            <GameLobby 
              onStartSolo={startSoloGame} 
              onStartMulti={startMultiplayerGame} 
              onJoinMulti={joinGame} 
            />
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              {/* Game Info */}
              <div className="flex justify-between items-end">
                <button onClick={resetGame} className="flex items-center gap-2 text-zinc-500 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Quit</span>
                </button>
                {game.status === 'waiting' && (
                  <div className="text-right">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Join Code</p>
                    <p className="text-4xl font-black text-pink-500 tracking-tighter">{game.code}</p>
                  </div>
                )}
              </div>

              {/* Player Progress */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {players.map(p => (
                  <CategoryTracker 
                    key={p.uid} 
                    playerName={p.name} 
                    completed={p.completedCategories} 
                    isCurrentTurn={game.currentTurn === p.uid}
                    score={p.score}
                  />
                ))}
              </div>

              {/* Game Content */}
              <div className="relative py-12">
                {game.status === 'completed' ? (
                  <div className="text-center space-y-6 py-12">
                    <Trophy className="w-24 h-24 text-yellow-500 mx-auto animate-bounce" />
                    <h2 className="text-5xl font-black uppercase italic leading-none">
                      {players.find(p => p.uid === game.winnerId)?.name} WINS!
                    </h2>
                    <p className="text-zinc-500 font-bold uppercase tracking-widest">Total Domination.</p>
                    {game.hostId === user.uid ? (
                      <button 
                        onClick={playAgain}
                        disabled={loading}
                        className="px-8 py-4 bg-white text-black rounded-full font-black uppercase tracking-widest"
                      >
                        {loading ? 'Loading...' : 'Play Again'}
                      </button>
                    ) : (
                      <p className="text-zinc-500 font-bold uppercase tracking-widest">Waiting for host to play again...</p>
                    )}
                    <button 
                      onClick={resetGame}
                      className="px-8 py-4 bg-transparent border-2 border-zinc-800 text-white rounded-full font-black uppercase tracking-widest mt-4 block mx-auto"
                    >
                      Leave Game
                    </button>
                  </div>
                ) : game.currentTurn === user.uid ? (
                  <div className="space-y-8">
                    {!currentQuestion ? (
                      <div className="text-center space-y-8">
                        <h2 className="text-3xl font-black uppercase italic">Spin for Category</h2>
                        <Wheel 
                          isSpinning={isSpinning} 
                          onSpinComplete={handleSpinComplete} 
                        />
                        <button
                          disabled={isSpinning || loading}
                          onClick={() => setIsSpinning(true)}
                          className="px-12 py-6 bg-gradient-to-r from-cyan-400 via-pink-500 to-yellow-400 text-white rounded-full text-2xl font-black uppercase tracking-widest disabled:opacity-50 shadow-[0_0_40px_rgba(255,255,255,0.1)] hover:scale-105 transition-transform"
                        >
                          {loading ? 'Loading...' : 'SPIN IT!'}
                        </button>
                      </div>
                    ) : (
                      <QuestionCard 
                        question={currentQuestion} 
                        onSelect={handleAnswer}
                        disabled={!!roast}
                      />
                    )}
                  </div>
                ) : (
                  <div className="text-center py-24 space-y-4">
                    <RefreshCcw className="w-12 h-12 text-zinc-800 mx-auto animate-spin" />
                    <p className="text-zinc-500 font-black uppercase tracking-widest text-sm">Waiting for opponent...</p>
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

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-[10px] font-black uppercase tracking-widest text-white">Summoning trivia gods...</p>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
