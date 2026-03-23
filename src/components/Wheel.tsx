import React, { useState, useEffect, useRef } from 'react';
import { motion, useAnimation } from 'motion/react';
import { CATEGORIES, CATEGORY_COLORS } from '../types';
import { getCategoryIcon } from '../content/categoryIcons';

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

  const N = CATEGORIES.length;
  const segmentAngle = 360 / N;
  const wheelInitialOffset = -90 - (segmentAngle / 2); // Makes index 0 perfectly centered at the top

  useEffect(() => {
    if (isSpinning) {
      if (soundEnabled && spinAudioRef.current) {
        spinAudioRef.current.currentTime = 0;
        spinAudioRef.current.play().catch(console.error);
      }

      // Smooth spin with many extra rotations
      const spinCount = 5 + Math.floor(Math.random() * 5);
      const randomExtra = Math.random() * 360;
      const targetRotation = rotation + (spinCount * 360) + randomExtra;
      
      controls.start({
        rotate: targetRotation,
        transition: { duration: 4, ease: [0.2, 0.8, 0.1, 1] } // Decelerating curve
      }).then(() => {
        setRotation(targetRotation % 360);
        const normalizedRotation = targetRotation % 360;
        const offsetAngle = (360 - (normalizedRotation % 360)) % 360;
        const index = Math.floor(offsetAngle / segmentAngle);
        setIsSpinning(false);
        onSpinComplete(CATEGORIES[index]);
      });
    }
  }, [isSpinning]);

  return (
    <div className="relative w-80 h-80 mx-auto drop-shadow-2xl">
      <audio ref={spinAudioRef} src="/spin.mp3" />
      
      <motion.div
        animate={controls}
        initial={{ rotate: rotation }}
        className="w-full h-full rounded-full border-8 overflow-hidden relative ring-4"
        style={{ borderColor: 'var(--app-border-strong)', boxShadow: 'var(--app-shadow-soft)' }}
      >
        {/* SVG Wheel Background */}
        <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-xl" style={{ transform: `rotate(${wheelInitialOffset}deg)` }}>
          <circle cx="100" cy="100" r="100" fill="var(--app-bg-elevated)" />
          {CATEGORIES.map((cat, i) => {
            const startAngle = i * segmentAngle;
            const endAngle = (i + 1) * segmentAngle;

            const startRad = (startAngle * Math.PI) / 180;
            const endRad = (endAngle * Math.PI) / 180;

            const radius = 100;
            const cx = 100;
            const cy = 100;

            const x1 = cx + radius * Math.cos(startRad);
            const y1 = cy + radius * Math.sin(startRad);
            const x2 = cx + radius * Math.cos(endRad);
            const y2 = cy + radius * Math.sin(endRad);

            const largeArcFlag = segmentAngle > 180 ? 1 : 0;
            const pathData = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

            const textAngle = startAngle + segmentAngle / 2;
            const textRad = (textAngle * Math.PI) / 180;
            
            // Push icon outward, closer to rim
            const iconRadius = 65;
            const iconX = cx + iconRadius * Math.cos(textRad);
            const iconY = cy + iconRadius * Math.sin(textRad);

            return (
              <g key={cat} className="transition-opacity hover:opacity-90">
                <path 
                  d={pathData} 
                  fill={CATEGORY_COLORS[cat]} 
                  stroke="rgba(0,0,0,0.2)" 
                  strokeWidth="0.5" 
                />
                {(() => {
                  const Icon = getCategoryIcon(cat);
                  const iconSize = 26;
                  const iconColor = cat === 'Random' ? '#18181B' : '#FFFFFF';
                  
                  return (
                    <g transform={`rotate(${textAngle + 90}, ${iconX}, ${iconY})`} style={{ pointerEvents: 'none' }}>
                      {Icon && (
                        <Icon 
                          x={iconX - iconSize/2} 
                          y={iconY - iconSize/2} 
                          width={iconSize} 
                          height={iconSize} 
                          color={iconColor}
                          strokeWidth={2.5}
                        />
                      )}
                    </g>
                  );
                })()}
              </g>
            );
          })}
          
          {/* Inner center peg for design */}
          <circle cx="100" cy="100" r="28" fill="#18181b" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
        </svg>
      </motion.div>
      
      <div className="absolute inset-0 flex items-center justify-center">
        <button 
          onClick={() => !isSpinning && setIsSpinning(true)}
          disabled={isSpinning}
          className="w-20 h-20 theme-button border-[6px] rounded-full flex items-center justify-center z-30 hover:scale-110 active:scale-95 transition-all duration-300 disabled:opacity-50 disabled:hover:scale-100"
          style={{ borderColor: 'var(--app-text)' }}
        >
          <span className="text-sm font-black uppercase tracking-[0.2em] ml-1">Spin</span>
        </button>
      </div>
    </div>
  );
};
