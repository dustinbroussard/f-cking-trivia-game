import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Trophy, Users, Gamepad2, User, Plus } from 'lucide-react';

interface GameLobbyProps {
  onStartSolo: () => void;
  onStartMulti: () => void;
  onJoinMulti: (code: string) => void;
}

export const GameLobby: React.FC<GameLobbyProps> = ({ onStartSolo, onStartMulti, onJoinMulti }) => {
  const [joinCode, setJoinCode] = useState('');
  const [showJoinInput, setShowJoinInput] = useState(false);

  return (
    <div className="w-full max-w-md mx-auto space-y-12 p-6 flex flex-col items-center">
      {/* Logo Area */}
      <div className="text-center relative">
        <div className="relative inline-block">
          {/* Recreating the logo look with layered text */}
          <h1 className="text-9xl font-black tracking-tighter leading-none select-none relative z-10">
            <span className="text-cyan-400 drop-shadow-[4px_4px_0_rgba(0,0,0,1)]">A</span>
            <span className="text-pink-500 drop-shadow-[4px_4px_0_rgba(0,0,0,1)]">F</span>
            <span className="text-yellow-400 drop-shadow-[4px_4px_0_rgba(0,0,0,1)]">T</span>
            <span className="text-green-400 drop-shadow-[4px_4px_0_rgba(0,0,0,1)]">G</span>
          </h1>
          {/* Scribbles/Accents (simplified) */}
          <div className="absolute -top-4 -left-4 w-full h-full pointer-events-none opacity-50">
             <div className="absolute top-0 left-1/4 w-1 h-8 bg-pink-500 rotate-12" />
             <div className="absolute top-2 right-1/4 w-1 h-6 bg-cyan-400 -rotate-12" />
             <div className="absolute bottom-0 left-1/3 w-8 h-1 bg-yellow-400 rotate-45" />
          </div>
        </div>
        <div className="mt-4">
          <h2 className="font-marker text-3xl text-yellow-400 tracking-tight underline underline-offset-8 decoration-2">
            A F-ING TRIVIA GAME
          </h2>
        </div>
      </div>

      {/* Tagline */}
      <div className="text-center space-y-2">
        <h3 className="text-xl font-black text-cyan-400 uppercase tracking-tight">
          A F-ING TRIVIA GAME
        </h3>
        <p className="text-zinc-400 font-medium text-lg">
          Fast. Funny. Fair. No BS. 🎯
        </p>
      </div>

      {/* Main Action Card */}
      <div className="w-full p-8 bg-black border-2 border-purple-500/30 rounded-[2.5rem] space-y-8 shadow-[0_0_50px_rgba(168,85,247,0.1)]">
        <h4 className="text-3xl font-black text-pink-500 text-center leading-tight">
          Ready to Get Schooled? 🤓
        </h4>

        <div className="space-y-4">
          {/* Solo Mode Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onStartSolo}
            className="w-full h-16 bg-gradient-to-r from-cyan-400 to-green-400 rounded-2xl flex items-center justify-center gap-3 text-white font-bold text-xl shadow-lg"
          >
            <Trophy className="w-6 h-6" />
            Solo Mode
          </motion.button>

          {/* Start New Game Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onStartMulti}
            className="w-full h-16 bg-gradient-to-r from-pink-500 to-purple-600 rounded-2xl flex items-center justify-center gap-3 text-white font-bold text-xl shadow-lg"
          >
            <Gamepad2 className="w-6 h-6" />
            Start New Game
          </motion.button>

          {/* Join Game Button */}
          <div className="space-y-2">
            {!showJoinInput ? (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowJoinInput(true)}
                className="w-full h-16 bg-gradient-to-r from-yellow-400 to-pink-500 rounded-2xl flex items-center justify-center gap-3 text-white font-bold text-xl shadow-lg"
              >
                <Users className="w-6 h-6" />
                Join Game
              </motion.button>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={4}
                  placeholder="CODE"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="flex-1 bg-zinc-900 border-2 border-zinc-800 rounded-2xl px-4 text-xl font-black text-white text-center focus:outline-none focus:border-pink-500 transition-colors"
                />
                <button
                  onClick={() => joinCode.length === 4 && onJoinMulti(joinCode)}
                  disabled={joinCode.length !== 4}
                  className="px-6 bg-pink-500 rounded-2xl font-black text-black uppercase disabled:opacity-50"
                >
                  GO
                </button>
                <button
                  onClick={() => setShowJoinInput(false)}
                  className="px-4 bg-zinc-800 rounded-2xl font-black text-white"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center space-y-4 max-w-xs">
        <p className="text-zinc-500 font-bold text-lg">
          No ads. No coins. No bullsh*t. 🚫
        </p>
        <p className="text-zinc-600 font-medium text-sm leading-relaxed">
          Answer one question from each category to win. Get one wrong and your turn ends. 💀
        </p>
      </div>
    </div>
  );
};
