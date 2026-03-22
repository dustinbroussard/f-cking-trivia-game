import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { Trophy, Users, Gamepad2, User, Plus, Upload } from 'lucide-react';
import { publicAsset } from '../assets';

interface GameLobbyProps {
  onStartSolo: (avatarUrl: string) => void;
  onStartMulti: (avatarUrl: string) => void;
  onJoinMulti: (code: string, avatarUrl: string) => void;
}

export const GameLobby: React.FC<GameLobbyProps> = ({ onStartSolo, onStartMulti, onJoinMulti }) => {
  const logoSrc = publicAsset('logo.jpg');
  const [joinCode, setJoinCode] = useState('');
  const [showJoinInput, setShowJoinInput] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 150;
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        // Compress to base64 jpeg
        setSelectedAvatar(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-12 p-6 flex flex-col items-center">
      {/* Logo Area */}
      <div className="text-center relative">
        <div className="relative inline-block w-64 h-64 md:w-80 md:h-80">
          <img 
            src={logoSrc} 
            alt="A F-cking Trivia Game" 
            className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>

      {/* Avatar Selection */}
      <div className="w-full space-y-4 flex flex-col items-center">
        <p className="text-center text-[10px] font-black uppercase tracking-widest theme-text-muted">Choose Your Fighter</p>
        
        <input 
          type="file" 
          accept="image/*" 
          ref={fileInputRef} 
          className="hidden" 
          onChange={handleImageUpload} 
        />
        
        <button 
          onClick={() => fileInputRef.current?.click()} 
          className="relative w-24 h-24 rounded-2xl theme-panel-strong border-2 overflow-hidden flex items-center justify-center hover:border-pink-500 transition-all group shadow-xl hover:shadow-pink-500/20 duration-300 ease-in-out"
        >
          {selectedAvatar ? (
            <img src={selectedAvatar} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            <User className="w-10 h-10 theme-text-muted group-hover:text-pink-500 transition-colors" />
          )}
          
          <div className="absolute inset-0 theme-overlay flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white">
            <Upload className="w-6 h-6" />
          </div>
        </button>
      </div>

      {/* Tagline */}
      <div className="text-center space-y-2">
        <h3 className="text-xl font-black text-cyan-400 uppercase tracking-tight">
          A F-CKING TRIVIA GAME
        </h3>
        <p className="theme-text-secondary font-medium text-lg">
          Fast. Funny. Fair. No BS. 🎯
        </p>
      </div>

      {/* Main Actions */}
      <div className="w-full space-y-4">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onStartSolo(selectedAvatar)}
          className="w-full h-16 bg-gradient-to-r from-cyan-500 to-emerald-500 rounded-xl flex items-center justify-center gap-3 text-white font-bold text-xl shadow-lg hover:shadow-cyan-500/25 transition-all duration-300 ease-in-out"
        >
          <Trophy className="w-6 h-6" />
          Solo Mode
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onStartMulti(selectedAvatar)}
          className="w-full h-16 bg-gradient-to-r from-pink-500 to-purple-600 rounded-xl flex items-center justify-center gap-3 text-white font-bold text-xl shadow-lg hover:shadow-pink-500/25 transition-all duration-300 ease-in-out"
        >
          <Gamepad2 className="w-6 h-6" />
          Start New Game
        </motion.button>

        <div className="space-y-2">
          {!showJoinInput ? (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowJoinInput(true)}
              className="w-full h-16 bg-gradient-to-r from-amber-500 to-pink-500 rounded-xl flex items-center justify-center gap-3 text-white font-bold text-xl shadow-lg hover:shadow-amber-500/25 transition-all duration-300 ease-in-out"
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
                className="flex-1 theme-input border rounded-xl px-4 text-xl font-black text-center focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 transition-all duration-300 ease-in-out shadow-inner"
              />
              <button
                onClick={() => joinCode.length === 4 && onJoinMulti(joinCode, selectedAvatar)}
                disabled={joinCode.length !== 4}
                className="px-6 bg-pink-500 hover:bg-pink-600 rounded-xl font-black text-white uppercase disabled:opacity-50 transition-all duration-300 ease-in-out shadow-md"
              >
                GO
              </button>
              <button
                onClick={() => setShowJoinInput(false)}
                className="px-4 theme-button rounded-xl font-black transition-all duration-300 ease-in-out shadow-md"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center space-y-4 max-w-xs">
        <p className="theme-text-muted font-bold text-lg">
          No ads. No coins. No bullsh*t. 🚫
        </p>
        <p className="theme-text-secondary font-medium text-sm leading-relaxed">
          Answer one question from each category to win. Get one wrong and your turn ends. 💀
        </p>
      </div>
    </div>
  );
};
