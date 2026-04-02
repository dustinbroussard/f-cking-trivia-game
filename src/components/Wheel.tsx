import React, { useState, useEffect, useRef } from 'react';
import { motion, useAnimation } from 'motion/react';
import { CATEGORIES, Category } from '../types';
import { getCategoryIcon } from '../content/categoryIcons';
import { publicAsset } from '../assets';
import { safePlay } from '../hooks/useSound';

interface WheelProps {
  onSpinComplete: (category: string) => void;
  isSpinning: boolean;
  setIsSpinning: (spinning: boolean) => void;
  disabled?: boolean;
  soundEnabled?: boolean;
}

export const Wheel: React.FC<WheelProps> = ({ onSpinComplete, isSpinning, setIsSpinning, disabled = false, soundEnabled = true }) => {
  const controls = useAnimation();
  const [rotation, setRotation] = useState(0);
  const [landedIndex, setLandedIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const spinAudioRef = useRef<HTMLAudioElement>(null);
  const spinAudioSrc = publicAsset('spin.mp3');

  const N = CATEGORIES.length;
  const segmentAngle = 360 / N;
  const wheelInitialOffset = 90 - (segmentAngle / 2);
  const pointerAngle = 90;
  const wheelSegmentColorVars: Record<Category, string> = {
    'History': 'var(--wheel-history)',
    'Science': 'var(--wheel-science)',
    'Pop Culture': 'var(--wheel-pop-culture)',
    'Art & Music': 'var(--wheel-art-music)',
    'Sports': 'var(--wheel-sports)',
    'Technology': 'var(--wheel-technology)',
    'Random': 'var(--wheel-random)',
  };
  const wheelIconColorVars: Record<Category, string> = {
    'History': 'var(--wheel-history-icon)',
    'Science': 'var(--wheel-science-icon)',
    'Pop Culture': 'var(--wheel-pop-culture-icon)',
    'Art & Music': 'var(--wheel-art-music-icon)',
    'Sports': 'var(--wheel-sports-icon)',
    'Technology': 'var(--wheel-technology-icon)',
    'Random': 'var(--wheel-random-icon)',
  };

  useEffect(() => {
    if (isSpinning) {
      if (soundEnabled && spinAudioRef.current) {
        spinAudioRef.current.currentTime = 0;
        void safePlay(spinAudioRef.current);
      }

      // Smooth spin with many extra rotations
      const spinCount = 5 + Math.floor(Math.random() * 5);
      const randomExtra = Math.random() * 360;
      const targetRotation = rotation + (spinCount * 360) + randomExtra;

      controls.start({
        rotate: targetRotation,
        transition: { duration: 4, ease: [0.2, 0.8, 0.1, 1] } // Decelerating curve
      }).then(() => {
        const normalizedRotation = targetRotation % 360;
        const selectionAngle = (pointerAngle - wheelInitialOffset - normalizedRotation + 360) % 360;
        const index = Math.floor(selectionAngle / segmentAngle);
        setRotation(normalizedRotation);
        setLandedIndex(index);
        setIsSpinning(false);
        onSpinComplete(CATEGORIES[index]);
      });
    }
  }, [controls, isSpinning, onSpinComplete, pointerAngle, rotation, segmentAngle, setIsSpinning, soundEnabled, wheelInitialOffset]);

  return (
    <div className="relative mx-auto w-full max-w-[min(92vw,24rem)] drop-shadow-2xl">
      <audio ref={spinAudioRef} src={spinAudioSrc} />

      {/* Shared Coordinate Space for Wheel and Button */}
      <div className="relative mx-auto aspect-square w-full">
        <motion.div
          animate={controls}
          initial={{ rotate: rotation }}
          className="size-full rounded-full border-[0.5rem] overflow-hidden relative ring-4"
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
                const accentColor = wheelSegmentColorVars[cat as Category];
                const isEmphasized = landedIndex === i || hoveredIndex === i;
                const segmentSurfaceFill = isEmphasized
                  ? 'var(--wheel-segment-active-fill)'
                  : i % 2 === 0
                    ? 'var(--wheel-segment-fill)'
                    : 'var(--wheel-segment-fill-alt)';
                const accentOpacity = isEmphasized
                  ? 'var(--wheel-segment-accent-opacity-active)'
                  : 'var(--wheel-segment-accent-opacity)';
                const accentWidth = isEmphasized
                  ? 'var(--wheel-segment-accent-width-active)'
                  : 'var(--wheel-segment-accent-width)';
                const accentGlow = isEmphasized
                  ? 'var(--wheel-segment-accent-glow-active)'
                  : 'var(--wheel-segment-accent-glow)';
                const iconGlow = isEmphasized
                  ? 'var(--wheel-icon-glow-active)'
                  : 'var(--wheel-icon-glow)';

                // Push icon outward, closer to rim
                const iconRadius = 65;
                const iconX = cx + iconRadius * Math.cos(textRad);
                const iconY = cy + iconRadius * Math.sin(textRad);

                return (
                  <g
                    key={cat}
                    className="transition-opacity"
                    onMouseEnter={() => setHoveredIndex(i)}
                    onMouseLeave={() => setHoveredIndex((current) => (current === i ? null : current))}
                  >
                    <path
                      d={pathData}
                      fill={accentColor}
                      stroke="var(--wheel-segment-separator)"
                      strokeWidth="0.9"
                    />
                    <path
                      d={pathData}
                      fill={segmentSurfaceFill}
                      stroke="none"
                    />
                    <path
                      d={pathData}
                      fill="none"
                      stroke={accentColor}
                      strokeOpacity={accentOpacity}
                      strokeWidth={accentWidth}
                      style={{
                        filter: `drop-shadow(0 0 ${accentGlow} ${accentColor})`,
                      }}
                    />
                    {(() => {
                      const Icon = getCategoryIcon(cat);
                      const iconSize = 26;
                      const iconColor = wheelIconColorVars[cat as Category];

                      return (
                        <g transform={`rotate(${textAngle + 90}, ${iconX}, ${iconY})`} style={{ pointerEvents: 'none' }}>
                          {Icon && (
                            <Icon
                              x={iconX - iconSize / 2}
                              y={iconY - iconSize / 2}
                              width={iconSize}
                              height={iconSize}
                              color={iconColor}
                              strokeWidth={2.5}
                              style={{
                                filter: `drop-shadow(0 0 ${iconGlow} ${accentColor})`,
                              }}
                            />
                          )}
                        </g>
                      );
                    })()}
                  </g>
                );
              })}
            </svg>
          </motion.div>

          {/* Spin Button - Simplified without border to remove alignment friction */}
          <div className="absolute inset-0 flex items-center justify-center">
            <button type="button"
              onClick={() => {
                if (!isSpinning && !disabled) {
                  setHoveredIndex(null);
                  setLandedIndex(null);
                  setIsSpinning(true);
                }
              }}
              disabled={isSpinning || disabled}
              className="z-30 flex min-h-20 min-w-20 items-center justify-center rounded-full theme-button px-4 hover:scale-110 active:scale-95 transition-all duration-300 disabled:opacity-50 disabled:hover:scale-100 sm:min-h-24 sm:min-w-24"
              aria-label="Spin the category wheel"
              style={{
                background:
                  'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.08), transparent 45%), var(--wheel-center)',
                border: '1px solid var(--wheel-center-stroke)',
                boxShadow: 'var(--wheel-center-shadow)',
              }}
            >
              <span className="ml-1 text-sm font-black uppercase tracking-[0.2em] text-white sm:text-base">Spin</span>
            </button>
          </div>
        </div>

      {/* Pointer at the bottom */}
      <div className="mt-4 flex flex-col items-center pointer-events-none">
        <div
          className="h-0 w-0 border-l-[18px] border-r-[18px] border-b-[26px] border-l-transparent border-r-transparent drop-shadow-[0_6px_14px_rgba(0,0,0,0.28)]"
          style={{ borderBottomColor: 'var(--wheel-pointer)' }}
        />
      </div>
    </div>
  );
};
