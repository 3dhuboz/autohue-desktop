import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──

interface SortResult {
  filename: string;
  color: string;
  thumb: string | null;
}

interface SortAnimationProps {
  results: SortResult[];
  isProcessing: boolean;
}

// ── Color lookup ──

const COLOR_SWATCHES: Record<string, string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#eab308',
  orange: '#f97316',
  purple: '#a855f7',
  pink: '#ec4899',
  brown: '#a16207',
  black: '#334155',
  white: '#ffffff',
  'silver-grey': '#94a3b8',
  unknown: '#f87171',
  'please-double-check': '#f59e0b',
};

function colorLabel(color: string): string {
  const labels: Record<string, string> = {
    red: 'Red',
    blue: 'Blue',
    green: 'Green',
    yellow: 'Yellow',
    orange: 'Orange',
    purple: 'Purple',
    pink: 'Pink',
    brown: 'Brown',
    black: 'Black',
    white: 'White',
    'silver-grey': 'Silver / Grey',
    unknown: 'Unknown',
    'please-double-check': 'Needs Review',
  };
  return labels[color] || color.charAt(0).toUpperCase() + color.slice(1);
}

// ── Animation phases per image ──
type AnimPhase = 'enter' | 'analyze' | 'result' | 'exit' | 'idle';

const PHASE_DURATIONS: Record<AnimPhase, number> = {
  enter: 400,
  analyze: 500,
  result: 350,
  exit: 300,
  idle: 0,
};

// ── Component ──

export default function SortAnimation({ results, isProcessing }: SortAnimationProps) {
  const [queue, setQueue] = useState<SortResult[]>([]);
  const [current, setCurrent] = useState<SortResult | null>(null);
  const [phase, setPhase] = useState<AnimPhase>('idle');
  const [completedCount, setCompletedCount] = useState(0);
  const processedIndexRef = useRef(0);
  const animatingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Enqueue new results as they arrive
  useEffect(() => {
    if (results.length > processedIndexRef.current) {
      const newItems = results.slice(processedIndexRef.current);
      processedIndexRef.current = results.length;
      setQueue(prev => [...prev, ...newItems]);
    }
  }, [results]);

  // Process queue one at a time
  const processNext = useCallback(() => {
    setQueue(prev => {
      if (prev.length === 0) {
        animatingRef.current = false;
        setCurrent(null);
        setPhase('idle');
        return prev;
      }
      const [next, ...rest] = prev;
      animatingRef.current = true;
      setCurrent(next);
      setPhase('enter');

      // Chain: enter -> analyze -> result -> exit -> next
      const chain = (phases: AnimPhase[], idx: number) => {
        if (idx >= phases.length) {
          setCompletedCount(c => c + 1);
          // Small gap before next image
          timerRef.current = setTimeout(() => processNext(), 50);
          return;
        }
        timerRef.current = setTimeout(() => {
          setPhase(phases[idx]);
          chain(phases, idx + 1);
        }, PHASE_DURATIONS[phases[idx - 1] || 'enter']);
      };
      chain(['enter', 'analyze', 'result', 'exit'], 0);

      return rest;
    });
  }, []);

  useEffect(() => {
    if (queue.length > 0 && !animatingRef.current) {
      processNext();
    }
  }, [queue, processNext]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const swatch = current ? (COLOR_SWATCHES[current.color] || '#94a3b8') : '#94a3b8';
  const isWaiting = phase === 'idle' && isProcessing;

  return (
    <div className="relative w-full select-none" style={{ height: 200 }}>
      {/* Inline keyframes */}
      <style>{`
        @keyframes ah-pulse-ring {
          0%, 100% { transform: scale(1); opacity: 0.35; }
          50% { transform: scale(1.35); opacity: 0.08; }
        }
        @keyframes ah-pulse-core {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          50% { transform: scale(1.06); filter: brightness(1.3); }
        }
        @keyframes ah-spin-wheel {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes ah-scan-line {
          0% { top: 20%; opacity: 0; }
          10% { opacity: 0.7; }
          90% { opacity: 0.7; }
          100% { top: 80%; opacity: 0; }
        }
        @keyframes ah-toast-in {
          from { transform: translateY(8px) scale(0.92); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes ah-folder-receive {
          0% { transform: scale(1); }
          40% { transform: scale(1.08); }
          100% { transform: scale(1); }
        }
        @keyframes ah-particle {
          0% { transform: translate(0,0) scale(1); opacity: 0.8; }
          100% { transform: translate(var(--px), var(--py)) scale(0); opacity: 0; }
        }
        @keyframes ah-checkmark-draw {
          from { stroke-dashoffset: 24; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes ah-glow-breathe {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.35; }
        }
      `}</style>

      {/* ── Track line ── */}
      <div className="absolute top-1/2 left-8 right-8 -translate-y-1/2 h-px bg-white/[0.06] rounded-full" />
      {/* dashed motion guide */}
      <div
        className="absolute top-1/2 left-8 right-8 -translate-y-1/2"
        style={{
          height: 1,
          backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0, rgba(255,255,255,0.08) 6px, transparent 6px, transparent 14px)',
        }}
      />

      {/* ── LEFT: Image entry zone ── */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1">
        <div className="w-10 h-10 rounded-lg border border-dashed border-white/10 flex items-center justify-center">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/20">
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <circle cx="5.5" cy="5.5" r="1.5" fill="currentColor" fillOpacity="0.3" />
            <path d="M2 11L5 8L7 10L10 6L14 11" />
          </svg>
        </div>
        <span className="text-[10px] text-white/25 tracking-wide uppercase">Source</span>
      </div>

      {/* ── CENTER: AutoHue Brain ── */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
        {/* Outer pulse rings */}
        <div className="relative w-20 h-20 flex items-center justify-center">
          {/* Ring 1 */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `radial-gradient(circle, ${isWaiting ? 'rgba(220,38,38,0.15)' : phase === 'analyze' ? `${swatch}22` : 'rgba(220,38,38,0.10)'} 0%, transparent 70%)`,
              animation: `ah-pulse-ring ${isWaiting ? '2.4s' : '1.6s'} ease-in-out infinite`,
            }}
          />
          {/* Ring 2 (offset) */}
          <div
            className="absolute inset-[-8px] rounded-full"
            style={{
              background: `radial-gradient(circle, ${isWaiting ? 'rgba(220,38,38,0.08)' : phase === 'analyze' ? `${swatch}11` : 'rgba(220,38,38,0.05)'} 0%, transparent 70%)`,
              animation: `ah-pulse-ring ${isWaiting ? '2.4s' : '1.6s'} ease-in-out infinite 0.4s`,
            }}
          />
          {/* Ring 3 */}
          <div
            className="absolute inset-[-16px] rounded-full"
            style={{
              border: `1px solid ${phase === 'analyze' ? `${swatch}33` : 'rgba(220,38,38,0.08)'}`,
              animation: `ah-pulse-ring 3s ease-in-out infinite 0.8s`,
            }}
          />

          {/* Core orb */}
          <div
            className="relative w-16 h-16 rounded-full flex items-center justify-center overflow-hidden"
            style={{
              background: 'radial-gradient(circle at 35% 35%, rgba(40,40,60,1), rgba(20,20,35,1))',
              boxShadow: phase === 'analyze'
                ? `0 0 20px ${swatch}44, 0 0 40px ${swatch}22, inset 0 0 15px ${swatch}22`
                : '0 0 20px rgba(220,38,38,0.15), 0 0 40px rgba(220,38,38,0.08), inset 0 0 15px rgba(220,38,38,0.08)',
              animation: 'ah-pulse-core 2.4s ease-in-out infinite',
              transition: 'box-shadow 0.4s ease',
            }}
          >
            {/* Color wheel SVG */}
            <svg
              viewBox="0 0 40 40"
              width="32"
              height="32"
              style={{
                animation: phase === 'analyze' ? 'ah-spin-wheel 1.2s linear infinite' : 'ah-spin-wheel 8s linear infinite',
                transition: 'animation-duration 0.3s',
              }}
            >
              <defs>
                <linearGradient id="ah-seg-r" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#ef4444"/><stop offset="100%" stopColor="#f97316"/></linearGradient>
                <linearGradient id="ah-seg-y" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#f97316"/><stop offset="100%" stopColor="#eab308"/></linearGradient>
                <linearGradient id="ah-seg-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#eab308"/><stop offset="100%" stopColor="#22c55e"/></linearGradient>
                <linearGradient id="ah-seg-c" x1="1" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e"/><stop offset="100%" stopColor="#3b82f6"/></linearGradient>
                <linearGradient id="ah-seg-b" x1="1" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="#3b82f6"/><stop offset="100%" stopColor="#a855f7"/></linearGradient>
                <linearGradient id="ah-seg-p" x1="1" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="#a855f7"/><stop offset="100%" stopColor="#ef4444"/></linearGradient>
              </defs>
              {/* 6 arcs forming a color wheel */}
              <path d="M20 4 A16 16 0 0 1 33.86 12" stroke="url(#ah-seg-r)" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M33.86 12 A16 16 0 0 1 33.86 28" stroke="url(#ah-seg-y)" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M33.86 28 A16 16 0 0 1 20 36" stroke="url(#ah-seg-g)" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M20 36 A16 16 0 0 1 6.14 28" stroke="url(#ah-seg-c)" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M6.14 28 A16 16 0 0 1 6.14 12" stroke="url(#ah-seg-b)" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M6.14 12 A16 16 0 0 1 20 4" stroke="url(#ah-seg-p)" strokeWidth="3" fill="none" strokeLinecap="round" />
              {/* Center brain dot */}
              <circle cx="20" cy="20" r="4" fill="rgba(255,255,255,0.9)" />
              <circle cx="20" cy="20" r="2" fill="rgba(220,38,38,0.7)" />
            </svg>

            {/* Scanning line during analyze */}
            {phase === 'analyze' && (
              <div
                className="absolute left-2 right-2 h-px"
                style={{
                  background: `linear-gradient(90deg, transparent, ${swatch}88, transparent)`,
                  animation: 'ah-scan-line 0.5s ease-in-out infinite',
                }}
              />
            )}
          </div>
        </div>

        {/* Brain label */}
        <span
          className="mt-1.5 text-[10px] tracking-widest uppercase transition-colors duration-300"
          style={{
            color: phase === 'analyze' ? `${swatch}cc` : 'rgba(255,255,255,0.3)',
          }}
        >
          {phase === 'analyze' ? 'Classifying' : 'AutoHue'}
        </span>
      </div>

      {/* ── RIGHT: Folder destination ── */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1">
        <div
          className="w-10 h-10 rounded-lg border border-white/10 flex items-center justify-center bg-white/[0.02]"
          style={{
            animation: phase === 'exit' ? 'ah-folder-receive 0.3s ease-out' : 'none',
          }}
        >
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
            <path d="M2 4.5C2 3.67 2.67 3 3.5 3H6L7.5 5H12.5C13.33 5 14 5.67 14 6.5V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V4.5Z" />
          </svg>
        </div>
        <span className="text-[10px] text-white/25 tracking-wide uppercase">Sorted</span>
        {completedCount > 0 && (
          <span className="text-[10px] text-green-400/70 tabular-nums">{completedCount}</span>
        )}
      </div>

      {/* ── Animated thumbnail ── */}
      {current && phase !== 'idle' && (
        <div
          className="absolute top-1/2 -translate-y-1/2"
          style={{
            width: 48,
            height: 48,
            transition: 'left 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s ease',
            left:
              phase === 'enter' ? '15%'
              : phase === 'analyze' ? 'calc(50% - 56px)'
              : phase === 'result' ? 'calc(50% - 56px)'
              : 'calc(100% - 56px)',
            opacity: phase === 'exit' ? 0 : 1,
          }}
        >
          <div
            className="w-full h-full rounded-lg overflow-hidden border shadow-lg"
            style={{
              borderColor: phase === 'result' ? `${swatch}66` : 'rgba(255,255,255,0.12)',
              boxShadow: phase === 'result'
                ? `0 4px 20px ${swatch}33`
                : '0 4px 20px rgba(0,0,0,0.4)',
              transition: 'border-color 0.3s, box-shadow 0.3s',
            }}
          >
            {current.thumb ? (
              <img
                src={current.thumb}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="w-full h-full bg-white/[0.06] flex items-center justify-center">
                <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-white/20">
                  <rect x="2" y="2" width="12" height="12" rx="2" />
                  <circle cx="5.5" cy="5.5" r="1.5" fill="currentColor" fillOpacity="0.3" />
                  <path d="M2 11L5 8L7 10L10 6L14 11" />
                </svg>
              </div>
            )}
          </div>

          {/* Filename label under thumb */}
          <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap">
            <span className="text-[9px] text-white/30 max-w-[80px] truncate block text-center">
              {current.filename.length > 16
                ? current.filename.slice(0, 13) + '...'
                : current.filename}
            </span>
          </div>
        </div>
      )}

      {/* ── Result toast ── */}
      {current && (phase === 'result' || phase === 'exit') && (
        <div
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full border"
          style={{
            top: 'calc(50% + 42px)',
            background: 'rgba(10,10,18,0.85)',
            borderColor: 'rgba(34,197,94,0.25)',
            backdropFilter: 'blur(8px)',
            animation: 'ah-toast-in 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
          }}
        >
          {/* Animated checkmark */}
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" className="shrink-0">
            <circle cx="8" cy="8" r="7" fill="rgba(34,197,94,0.15)" stroke="rgba(34,197,94,0.5)" strokeWidth="1" />
            <path
              d="M4.5 8.5L7 11L11.5 5.5"
              stroke="#22c55e"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                strokeDasharray: 24,
                animation: 'ah-checkmark-draw 0.3s ease-out forwards',
              }}
            />
          </svg>

          {/* Color dot */}
          <div
            className="w-2.5 h-2.5 rounded-full shrink-0 ring-1"
            style={{
              backgroundColor: swatch,
              boxShadow: `0 0 6px ${swatch}66`,
              ringColor: `${swatch}44`,
            }}
          />

          {/* Color name */}
          <span className="text-xs font-medium text-white/80 tracking-wide">
            {colorLabel(current.color)}
          </span>
        </div>
      )}

      {/* ── Particles on result ── */}
      {phase === 'result' && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          {Array.from({ length: 6 }).map((_, i) => {
            const angle = (i / 6) * Math.PI * 2;
            const dist = 30 + Math.random() * 15;
            return (
              <div
                key={i}
                className="absolute w-1 h-1 rounded-full"
                style={{
                  backgroundColor: swatch,
                  '--px': `${Math.cos(angle) * dist}px`,
                  '--py': `${Math.sin(angle) * dist}px`,
                  animation: 'ah-particle 0.5s ease-out forwards',
                  left: 0,
                  top: 0,
                } as React.CSSProperties}
              />
            );
          })}
        </div>
      )}

      {/* ── Idle / waiting state ── */}
      {phase === 'idle' && !isProcessing && results.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-white/20 tracking-wide">Waiting for images...</span>
        </div>
      )}

      {/* ── Ambient glow under brain when active ── */}
      {(isProcessing || phase !== 'idle') && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full pointer-events-none"
          style={{
            background: `radial-gradient(circle, ${phase === 'analyze' ? `${swatch}18` : 'rgba(220,38,38,0.06)'} 0%, transparent 70%)`,
            animation: 'ah-glow-breathe 3s ease-in-out infinite',
          }}
        />
      )}
    </div>
  );
}
