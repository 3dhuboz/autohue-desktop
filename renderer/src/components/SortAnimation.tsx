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
  red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308',
  orange: '#f97316', purple: '#a855f7', pink: '#ec4899', brown: '#a16207',
  black: '#334155', white: '#e2e8f0', 'silver-grey': '#94a3b8',
  unknown: '#f87171', 'please-double-check': '#f59e0b',
};

const COLOR_LABELS: Record<string, string> = {
  red: 'Red', blue: 'Blue', green: 'Green', yellow: 'Yellow',
  orange: 'Orange', purple: 'Purple', pink: 'Pink', brown: 'Brown',
  black: 'Black', white: 'White', 'silver-grey': 'Silver/Grey',
  unknown: 'Unknown', 'please-double-check': 'Review',
};

// ── Animation phases — FAST to match real processing speed ──
type AnimPhase = 'enter' | 'analyze' | 'result' | 'exit' | 'idle';

export default function SortAnimation({ results, isProcessing }: SortAnimationProps) {
  const [queue, setQueue] = useState<SortResult[]>([]);
  const [current, setCurrent] = useState<SortResult | null>(null);
  const [phase, setPhase] = useState<AnimPhase>('idle');
  const [completed, setCompleted] = useState<SortResult[]>([]);
  const processedRef = useRef(0);
  const animatingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Speed: dynamically adjust animation duration based on queue depth
  // More items queued = faster animation to keep up
  const getSpeed = useCallback(() => {
    const q = queue.length;
    if (q > 20) return { enter: 100, analyze: 150, result: 120, exit: 80 };
    if (q > 10) return { enter: 150, analyze: 200, result: 150, exit: 100 };
    if (q > 3) return { enter: 200, analyze: 300, result: 200, exit: 120 };
    return { enter: 300, analyze: 400, result: 250, exit: 150 };
  }, [queue.length]);

  // Enqueue new results
  useEffect(() => {
    if (results.length > processedRef.current) {
      const newItems = results.slice(processedRef.current);
      processedRef.current = results.length;
      setQueue(prev => [...prev, ...newItems]);
    }
  }, [results]);

  // Process queue
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

      const speed = rest.length > 20 ? { enter: 100, analyze: 150, result: 120, exit: 80 }
        : rest.length > 10 ? { enter: 150, analyze: 200, result: 150, exit: 100 }
        : rest.length > 3 ? { enter: 200, analyze: 300, result: 200, exit: 120 }
        : { enter: 300, analyze: 400, result: 250, exit: 150 };

      setPhase('enter');
      timerRef.current = setTimeout(() => {
        setPhase('analyze');
        timerRef.current = setTimeout(() => {
          setPhase('result');
          timerRef.current = setTimeout(() => {
            setPhase('exit');
            setCompleted(c => [next, ...c].slice(0, 50));
            timerRef.current = setTimeout(() => processNext(), speed.exit);
          }, speed.result);
        }, speed.analyze);
      }, speed.enter);

      return rest;
    });
  }, []);

  useEffect(() => {
    if (queue.length > 0 && !animatingRef.current) processNext();
  }, [queue, processNext]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const swatch = current ? (COLOR_SWATCHES[current.color] || '#94a3b8') : '#dc2626';
  const isWaiting = phase === 'idle' && isProcessing;
  const speed = getSpeed();
  const totalEnterExit = speed.enter + speed.exit;

  return (
    <div className="space-y-4">
      {/* ── Animation Stage ── */}
      <div className="relative w-full select-none overflow-hidden" style={{ height: 180 }}>
        <style>{`
          @keyframes ah-pulse { 0%,100%{transform:scale(1);opacity:.35} 50%{transform:scale(1.4);opacity:.08} }
          @keyframes ah-core-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
          @keyframes ah-spin-slow { from{transform:rotate(0)} to{transform:rotate(360deg)} }
          @keyframes ah-scan { 0%{top:15%;opacity:0} 10%{opacity:.8} 90%{opacity:.8} 100%{top:85%;opacity:0} }
          @keyframes ah-toast-pop { from{transform:translateY(6px) scale(.9);opacity:0} to{transform:translateY(0) scale(1);opacity:1} }
          @keyframes ah-check-draw { from{stroke-dashoffset:24} to{stroke-dashoffset:0} }
          @keyframes ah-folder-bump { 0%{transform:scale(1)} 40%{transform:scale(1.12)} 100%{transform:scale(1)} }
          @keyframes ah-particle-burst { 0%{transform:translate(0,0) scale(1);opacity:.9} 100%{transform:translate(var(--px),var(--py)) scale(0);opacity:0} }
          @keyframes ah-glow { 0%,100%{opacity:.12} 50%{opacity:.3} }
          @keyframes ah-waiting-pulse { 0%,100%{box-shadow:0 0 15px rgba(220,38,38,.15)} 50%{box-shadow:0 0 30px rgba(220,38,38,.3)} }
          @keyframes ah-trail { 0%{width:0;opacity:.6} 50%{width:60px;opacity:.3} 100%{width:0;opacity:0} }
        `}</style>

        {/* Track line */}
        <div className="absolute top-1/2 left-12 right-12 -translate-y-1/2 h-px" style={{
          backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0, rgba(255,255,255,0.06) 4px, transparent 4px, transparent 12px)',
        }} />

        {/* LEFT: Source */}
        <div className="absolute left-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5">
          <div className="w-9 h-9 rounded-lg border border-dashed border-white/10 flex items-center justify-center">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/20">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <circle cx="5.5" cy="5.5" r="1.5" fill="currentColor" fillOpacity=".3" />
              <path d="M2 11L5 8L7 10L10 6L14 11" />
            </svg>
          </div>
          <span className="text-[8px] text-white/20 tracking-widest uppercase">Input</span>
        </div>

        {/* CENTER: AutoHue Brain */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-10">
          {/* Ambient glow */}
          <div className="absolute w-32 h-32 rounded-full pointer-events-none" style={{
            background: `radial-gradient(circle, ${phase === 'analyze' ? `${swatch}20` : 'rgba(220,38,38,0.08)'} 0%, transparent 70%)`,
            animation: 'ah-glow 3s ease-in-out infinite',
          }} />

          <div className="relative w-[72px] h-[72px] flex items-center justify-center">
            {/* Pulse rings */}
            {[0, 0.3, 0.6].map((delay, i) => (
              <div key={i} className="absolute rounded-full" style={{
                inset: `${-6 * (i + 1)}px`,
                border: `1px solid ${phase === 'analyze' ? `${swatch}25` : 'rgba(220,38,38,0.06)'}`,
                animation: `ah-pulse ${isWaiting ? '2.5s' : '1.8s'} ease-in-out infinite ${delay}s`,
                transition: 'border-color 0.3s',
              }} />
            ))}

            {/* Core orb */}
            <div className="relative w-[56px] h-[56px] rounded-full overflow-hidden flex items-center justify-center" style={{
              background: 'radial-gradient(circle at 35% 35%, #2a2a3e, #16162a)',
              boxShadow: phase === 'analyze'
                ? `0 0 25px ${swatch}55, 0 0 50px ${swatch}22, inset 0 0 20px ${swatch}22`
                : isWaiting ? undefined : '0 0 20px rgba(220,38,38,0.12), inset 0 0 12px rgba(220,38,38,0.06)',
              animation: isWaiting ? 'ah-waiting-pulse 2s ease-in-out infinite' : 'ah-core-pulse 2.4s ease-in-out infinite',
              transition: 'box-shadow 0.3s',
            }}>
              {/* Color wheel */}
              <svg viewBox="0 0 40 40" width="30" height="30" style={{
                animation: `ah-spin-slow ${phase === 'analyze' ? '0.6s' : '12s'} linear infinite`,
              }}>
                <defs>
                  {[['r','#ef4444','#f97316'],['y','#f97316','#eab308'],['g','#eab308','#22c55e'],['c','#22c55e','#3b82f6'],['b','#3b82f6','#a855f7'],['p','#a855f7','#ef4444']].map(([id,a,b]) => (
                    <linearGradient key={id} id={`ah-${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={a}/><stop offset="100%" stopColor={b}/></linearGradient>
                  ))}
                </defs>
                {[
                  ['M20 4 A16 16 0 0 1 33.86 12','r'],['M33.86 12 A16 16 0 0 1 33.86 28','y'],
                  ['M33.86 28 A16 16 0 0 1 20 36','g'],['M20 36 A16 16 0 0 1 6.14 28','c'],
                  ['M6.14 28 A16 16 0 0 1 6.14 12','b'],['M6.14 12 A16 16 0 0 1 20 4','p'],
                ].map(([d,id]) => (
                  <path key={id} d={d} stroke={`url(#ah-${id})`} strokeWidth="3" fill="none" strokeLinecap="round" />
                ))}
                <circle cx="20" cy="20" r="3.5" fill="rgba(255,255,255,0.9)" />
                <circle cx="20" cy="20" r="1.5" fill="rgba(220,38,38,0.8)" />
              </svg>

              {/* Scan line */}
              {phase === 'analyze' && (
                <div className="absolute left-2 right-2 h-[2px]" style={{
                  background: `linear-gradient(90deg, transparent, ${swatch}aa, transparent)`,
                  animation: `ah-scan ${speed.analyze}ms ease-in-out`,
                  borderRadius: 1,
                }} />
              )}
            </div>
          </div>

          {/* Label */}
          <span className="mt-1 text-[9px] tracking-[0.15em] uppercase font-medium transition-colors duration-200" style={{
            color: phase === 'analyze' ? `${swatch}dd` : isWaiting ? 'rgba(220,38,38,0.5)' : 'rgba(255,255,255,0.25)',
          }}>
            {phase === 'analyze' ? 'Classifying' : isWaiting ? 'Waiting...' : 'AutoHue'}
          </span>
        </div>

        {/* RIGHT: Sorted folder */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5">
          <div className="w-9 h-9 rounded-lg border border-white/10 flex items-center justify-center bg-white/[0.02]" style={{
            animation: phase === 'exit' ? `ah-folder-bump ${speed.exit}ms ease-out` : 'none',
          }}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-green-400/50">
              <path d="M2 4.5C2 3.67 2.67 3 3.5 3H6L7.5 5H12.5C13.33 5 14 5.67 14 6.5V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V4.5Z" />
            </svg>
          </div>
          <span className="text-[8px] text-white/20 tracking-widest uppercase">Sorted</span>
          {completed.length > 0 && (
            <span className="text-[10px] text-green-400/70 font-bold tabular-nums">{completed.length}</span>
          )}
        </div>

        {/* ── Animated thumbnail sliding across ── */}
        {current && phase !== 'idle' && (
          <div className="absolute top-1/2 -translate-y-1/2 z-20" style={{
            width: 44, height: 44,
            transition: `left ${phase === 'enter' ? speed.enter : phase === 'exit' ? speed.exit : 200}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${speed.exit}ms ease`,
            left: phase === 'enter' ? '12%'
              : phase === 'analyze' ? 'calc(50% - 52px)'
              : phase === 'result' ? 'calc(50% - 52px)'
              : 'calc(100% - 52px)',
            opacity: phase === 'exit' ? 0.3 : 1,
          }}>
            <div className="w-full h-full rounded-lg overflow-hidden border-2 shadow-xl transition-all duration-200" style={{
              borderColor: phase === 'result' ? `${swatch}88` : 'rgba(255,255,255,0.15)',
              boxShadow: phase === 'result' ? `0 4px 25px ${swatch}44` : '0 4px 20px rgba(0,0,0,0.5)',
            }}>
              {current.thumb ? (
                <img src={current.thumb} alt="" className="w-full h-full object-cover" draggable={false} />
              ) : (
                <div className="w-full h-full bg-white/[0.06] flex items-center justify-center">
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-white/15">
                    <rect x="2" y="2" width="12" height="12" rx="2" /><path d="M2 11L5 8L7 10L10 6L14 11" />
                  </svg>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Color result toast ── */}
        {current && (phase === 'result' || phase === 'exit') && (
          <div className="absolute left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full border" style={{
            top: 'calc(50% + 40px)',
            background: 'rgba(10,10,18,0.9)',
            borderColor: 'rgba(34,197,94,0.3)',
            backdropFilter: 'blur(10px)',
            animation: `ah-toast-pop ${speed.result * 0.6}ms cubic-bezier(0.22, 1, 0.36, 1)`,
            boxShadow: `0 4px 20px rgba(0,0,0,0.4), 0 0 15px ${swatch}15`,
          }}>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
              <circle cx="8" cy="8" r="7" fill="rgba(34,197,94,0.15)" stroke="rgba(34,197,94,0.5)" strokeWidth="1" />
              <path d="M4.5 8.5L7 11L11.5 5.5" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: 24, animation: 'ah-check-draw 0.2s ease-out forwards' }} />
            </svg>
            <div className="w-2.5 h-2.5 rounded-full ring-1 shrink-0" style={{ backgroundColor: swatch, boxShadow: `0 0 8px ${swatch}66`, ringColor: `${swatch}44` }} />
            <span className="text-[11px] font-semibold text-white/85 tracking-wide">{COLOR_LABELS[current.color] || current.color}</span>
          </div>
        )}

        {/* Particles on result */}
        {phase === 'result' && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10">
            {Array.from({ length: 8 }).map((_, i) => {
              const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
              const dist = 25 + Math.random() * 20;
              return (
                <div key={i} className="absolute w-1.5 h-1.5 rounded-full" style={{
                  backgroundColor: swatch,
                  '--px': `${Math.cos(angle) * dist}px`,
                  '--py': `${Math.sin(angle) * dist}px`,
                  animation: `ah-particle-burst ${speed.result}ms ease-out forwards`,
                  left: 0, top: 0,
                } as React.CSSProperties} />
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {phase === 'idle' && !isProcessing && results.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[11px] text-white/15 tracking-wider">Drop images to begin sorting</span>
          </div>
        )}
      </div>

      {/* ── Mini Output Feed ── */}
      {completed.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/25 uppercase tracking-widest font-bold">Recent Output</span>
            <span className="text-[9px] text-green-400/50 tabular-nums">{completed.length} sorted</span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
            {completed.slice(0, 20).map((r, i) => {
              const sw = COLOR_SWATCHES[r.color] || '#94a3b8';
              return (
                <div key={`${r.filename}-${i}`} className="shrink-0 flex flex-col items-center gap-1 animate-slide-in-right" style={{ animationDelay: `${i * 30}ms` }}>
                  <div className="w-[52px] h-[38px] rounded overflow-hidden border border-white/[0.06] bg-black/30">
                    {r.thumb ? (
                      <img src={r.thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: sw }} />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: sw }} />
                    <span className="text-[7px] text-white/40">{COLOR_LABELS[r.color] || r.color}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
