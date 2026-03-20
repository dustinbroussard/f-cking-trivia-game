import React, { useState, useEffect, useRef } from 'react';
import { motion, useAnimation } from 'motion/react';
import { CATEGORIES, CATEGORY_COLORS } from '../types';

interface WheelProps {
  onSpinComplete: (category: string) => void;
  isSpinning: boolean;
  setIsSpinning: (spinning: boolean) => void;
  soundEnabled?: boolean;
}

export const Wheel: React.FC<WheelProps> = ({ onSpinComplete, isSpinning, setIsSpinning, soundEnabled = true }) => {
  const controls = useAnimation();
  const [rotation, setRotation] = useState(0);
  const spinAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (isSpinning) {
      if (soundEnabled && spinAudioRef.current) {
        spinAudioRef.current.currentTime = 0;
        spinAudioRef.current.play().catch(console.error);
      }

      const spinCount = 5 + Math.random() * 5;
      const targetRotation = rotation + spinCount * 360 + Math.random() * 360;
      
      controls.start({
        rotate: targetRotation,
        transition: { duration: 3, ease: "easeOut" }
      }).then(() => {
        setRotation(targetRotation % 360);
        const normalizedRotation = targetRotation % 360;
        const segmentSize = 360 / CATEGORIES.length;
        const index = Math.floor(((360 - normalizedRotation) % 360) / segmentSize);
        setIsSpinning(false);
        onSpinComplete(CATEGORIES[index]);
      });
    }
  }, [isSpinning]);

  return (
    <div className="relative w-64 h-64 mx-auto">
      <audio ref={spinAudioRef} src="/spin.mp3" />
      
      {/* Pointer */}
      <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10 w-0 h-0 border-l-[15px] border-l-transparent border-r-[15px] border-r-transparent border-t-[25px] border-t-white drop-shadow-lg" />
      
      <motion.div
        animate={controls}
        className="w-full h-full rounded-full border-4 border-white overflow-hidden relative shadow-[0_0_30px_rgba(255,255,255,0.2)]"
        style={{ rotate: rotation }}
      >
        {CATEGORIES.map((cat, i) => {
          const angle = (360 / CATEGORIES.length) * i;
          const skew = 90 - (360 / CATEGORIES.length);
          return (
            <div
              key={cat}
              className="absolute top-0 right-0 w-1/2 h-1/2 origin-bottom-left"
              style={{
                transform: `rotate(${angle}deg) skewY(-${skew}deg)`,
                backgroundColor: CATEGORY_COLORS[cat]
              }}
            >
              <div 
                className="absolute bottom-4 left-4 origin-bottom-left text-[10px] font-black text-black uppercase tracking-tighter"
                style={{ transform: `skewY(${skew}deg) rotate(45deg)` }}
              >
                {cat}
              </div>
            </div>
          );
        })}
      </motion.div>
      
      <div className="absolute inset-0 flex items-center justify-center">
        <button 
          onClick={() => !isSpinning && setIsSpinning(true)}
          disabled={isSpinning}
          className="w-16 h-16 bg-zinc-900 border-4 border-white rounded-full flex items-center justify-center z-20 hover:scale-110 transition-transform disabled:opacity-50 disabled:hover:scale-100 shadow-xl"
        >
          <span className="text-xs font-black uppercase tracking-widest text-white">Spin</span>
        </button>
      </div>
    </div>
  );
};
