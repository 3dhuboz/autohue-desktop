import { useState, useEffect, useRef, useMemo } from 'react';

// ── Types ──
interface SortResult {
  filename: string;
  color: string;
  thumb: string | null;
}

interface SortAnimationProps {
  results: SortResult[];
  isProcessing: boolean;
  totalProcessed?: number;
  totalImages?: number;
}

// ── Color lookup ──
const COLOR_SWATCHES: Record<string, string> = {
  red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308',
  orange: '#f97316', purple: '#a855f7', pink: '#ec4899', brown: '#a16207',
  black: '#334155', white: '#e2e8f0', 'silver-grey': '#94a3b8', cream: '#fef3c7',
  unknown: '#f87171', 'please-double-check': '#f59e0b',
};

const COLOR_LABELS: Record<string, string> = {
  red: 'Red', blue: 'Blue', green: 'Green', yellow: 'Yellow',
  orange: 'Orange', purple: 'Purple', pink: 'Pink', brown: 'Brown',
  black: 'Black', white: 'White', 'silver-grey': 'Silver/Grey', cream: 'Cream',
  unknown: 'Unknown', 'please-double-check': 'Review',
};

// Flying dot in the stream
interface StreamDot {
  id: number;
  color: string;
  x: number; // 0-100 progress across track
  thumb: string | null;
}

export default function SortAnimation({ results, isProcessing, totalProcessed, totalImages }: SortAnimationProps) {
  const [dots, setDots] = useState<StreamDot[]>([]);
  const [recentColors, setRecentColors] = useState<{ color: string; id: number }[]>([]);
  const processedRef = useRef(0);
  const dotIdRef = useRef(0);
  const animFrameRef = useRef<number>(0);
  const lastTickRef = useRef(performance.now());
  const pendingRef = useRef<SortResult[]>([]);
  const spawnTimerRef = useRef(0);

  // Track throughput for speed display
  const throughputRef = useRef<number[]>([]);
  const lastCountRef = useRef(0);
  const throughputTimerRef = useRef<ReturnType<typeof setInterval>>();

  // Measure throughput every second
  useEffect(() => {
    throughputTimerRef.current = setInterval(() => {
      const current = processedRef.current;
      const delta = current - lastCountRef.current;
      lastCountRef.current = current;
      throughputRef.current.push(delta);
      if (throughputRef.current.length > 5) throughputRef.current.shift();
    }, 1000);
    return () => clearInterval(throughputTimerRef.current);
  }, []);

  const avgSpeed = useMemo(() => {
    const arr = throughputRef.current;
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }, [dots]); // recalc when dots change

  // Enqueue new results
  useEffect(() => {
    if (results.length > processedRef.current) {
      const newItems = results.slice(processedRef.current);
      processedRef.current = results.length;
      pendingRef.current.push(...newItems);
    }
  }, [results]);

  // Animation loop — spawns dots from pending queue and moves them across
  useEffect(() => {
    if (!isProcessing && pendingRef.current.length === 0 && dots.length === 0) return;

    const tick = (now: number) => {
      const dt = Math.min(now - lastTickRef.current, 50); // cap delta
      lastTickRef.current = now;

      // Speed: how fast dots travel (% per ms) — scales with throughput
      const speed = Math.max(0.04, Math.min(0.15, avgSpeed * 0.025 + 0.04));

      // Spawn interval: faster spawn when more pending
      const spawnInterval = pendingRef.current.length > 20 ? 60
        : pendingRef.current.length > 5 ? 120
        : 200;

      spawnTimerRef.current += dt;

      // Spawn new dots from pending queue
      if (pendingRef.current.length > 0 && spawnTimerRef.current >= spawnInterval) {
        spawnTimerRef.current = 0;
        // Spawn multiple if heavily backed up
        const spawnCount = pendingRef.current.length > 30 ? 3 : pendingRef.current.length > 10 ? 2 : 1;
        const newDots: StreamDot[] = [];
        for (let i = 0; i < spawnCount && pendingRef.current.length > 0; i++) {
          const item = pendingRef.current.shift()!;
          newDots.push({
            id: dotIdRef.current++,
            color: item.color,
            x: -2 - i * 3, // stagger start positions slightly
            thumb: item.thumb,
          });
        }
        setDots(prev => [...prev, ...newDots]);
        setRecentColors(prev => {
          const updated = [...newDots.map(d => ({ color: d.color, id: d.id })), ...prev];
          return updated.slice(0, 30);
        });
      }

      // Move all dots forward and remove completed ones
      setDots(prev => {
        const updated = prev.map(d => ({ ...d, x: d.x + speed * dt })).filter(d => d.x < 105);
        return updated;
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isProcessing, avgSpeed, dots.length]);

  const remaining = Math.max(0, (totalImages || 0) - (totalProcessed || 0));
  const progress = totalImages && totalImages > 0 ? Math.min(100, ((totalProcessed || 0) / totalImages) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* ── Stream Animation ── */}
      <div className="relative w-full select-none overflow-hidden" style={{ height: 160 }}>
        <style>{`
          @keyframes ah-core-spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
          @keyframes ah-glow-pulse { 0%,100%{opacity:.15} 50%{opacity:.35} }
          @keyframes ah-dot-pop { from{transform:scale(0);opacity:0} to{transform:scale(1);opacity:1} }
          @keyframes ah-folder-bump { 0%{transform:scale(1)} 40%{transform:scale(1.15)} 100%{transform:scale(1)} }
        `}</style>

        {/* Track line with gradient */}
        <div className="absolute top-1/2 left-14 right-14 -translate-y-1/2 h-[2px] rounded-full" style={{
          background: `linear-gradient(90deg, rgba(220,38,38,0.15), rgba(220,38,38,0.08) 40%, rgba(34,197,94,0.08) 60%, rgba(34,197,94,0.15))`,
        }} />
        {/* Track dots */}
        <div className="absolute top-1/2 left-14 right-14 -translate-y-1/2 h-px" style={{
          backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0, rgba(255,255,255,0.04) 2px, transparent 2px, transparent 10px)',
        }} />

        {/* LEFT: Source stack */}
        <div className="absolute left-1 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-10">
          <div className="w-11 h-11 rounded-xl border border-dashed border-white/10 flex items-center justify-center bg-white/[0.02]">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/20">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <circle cx="5.5" cy="5.5" r="1.5" fill="currentColor" fillOpacity=".3" />
              <path d="M2 11L5 8L7 10L10 6L14 11" />
            </svg>
          </div>
          <span className="text-[12px] text-orange-400/80 font-bold tabular-nums">{remaining}</span>
          <span className="text-[7px] text-white/20 tracking-widest uppercase">Remaining</span>
        </div>

        {/* CENTER: AutoHue engine */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20">
          <div className="relative w-14 h-14 flex items-center justify-center">
            {/* Outer ring glow */}
            <div className="absolute inset-[-8px] rounded-full" style={{
              background: dots.length > 0
                ? `radial-gradient(circle, ${COLOR_SWATCHES[dots[dots.length - 1]?.color] || '#dc2626'}12 0%, transparent 70%)`
                : 'radial-gradient(circle, rgba(220,38,38,0.06) 0%, transparent 70%)',
              animation: 'ah-glow-pulse 2s ease-in-out infinite',
            }} />

            {/* Core */}
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{
              background: 'radial-gradient(circle at 35% 35%, #2a2a3e, #16162a)',
              boxShadow: isProcessing && dots.length > 0
                ? `0 0 20px ${COLOR_SWATCHES[dots[dots.length - 1]?.color] || '#dc2626'}33`
                : '0 0 15px rgba(220,38,38,0.08)',
            }}>
              <svg viewBox="0 0 40 40" width="26" height="26" style={{
                animation: `ah-core-spin ${isProcessing ? Math.max(0.4, 3 - avgSpeed * 0.4) + 's' : '12s'} linear infinite`,
                animationPlayState: isProcessing ? 'running' : 'paused',
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
                <circle cx="20" cy="20" r="3" fill="rgba(255,255,255,0.9)" />
                <circle cx="20" cy="20" r="1.2" fill="rgba(220,38,38,0.8)" />
              </svg>
            </div>
          </div>
          {/* Speed label */}
          <span className="mt-0.5 text-[9px] tracking-[0.12em] uppercase font-medium tabular-nums" style={{
            color: isProcessing && avgSpeed > 0 ? 'rgba(34,197,94,0.6)' : 'rgba(255,255,255,0.2)',
          }}>
            {isProcessing && avgSpeed > 0 ? `${avgSpeed.toFixed(1)} img/s` : isProcessing ? 'Starting...' : 'AutoHue'}
          </span>
        </div>

        {/* RIGHT: Output folder */}
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-10">
          <div className="w-11 h-11 rounded-xl border border-white/10 flex items-center justify-center bg-white/[0.02]" style={{
            animation: dots.some(d => d.x > 95) ? 'ah-folder-bump 300ms ease-out' : 'none',
          }}>
            <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-green-400/50">
              <path d="M2 4.5C2 3.67 2.67 3 3.5 3H6L7.5 5H12.5C13.33 5 14 5.67 14 6.5V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V4.5Z" />
            </svg>
          </div>
          <span className="text-[12px] text-green-400/80 font-bold tabular-nums">{totalProcessed ?? 0}</span>
          <span className="text-[7px] text-white/20 tracking-widest uppercase">Sorted</span>
        </div>

        {/* ── Flying color dots ── */}
        {dots.map(dot => {
          const sw = COLOR_SWATCHES[dot.color] || '#94a3b8';
          // Map 0-100 to actual pixel positions (left 14 to right 14 of container)
          const leftPct = 6 + dot.x * 0.88; // 6% to 94%
          const isNearCenter = dot.x > 38 && dot.x < 62;
          const size = isNearCenter ? 10 : 7;
          return (
            <div key={dot.id} className="absolute top-1/2 -translate-y-1/2 rounded-full" style={{
              left: `${leftPct}%`,
              width: size,
              height: size,
              backgroundColor: sw,
              boxShadow: isNearCenter ? `0 0 12px ${sw}88, 0 0 4px ${sw}44` : `0 0 6px ${sw}44`,
              transition: 'width 150ms, height 150ms, box-shadow 150ms',
              zIndex: isNearCenter ? 15 : 5,
            }} />
          );
        })}
      </div>

      {/* ── Progress bar ── */}
      {totalImages && totalImages > 0 && (
        <div className="px-1">
          <div className="w-full h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500 ease-out" style={{
              width: `${progress}%`,
              background: progress >= 100 ? 'linear-gradient(90deg, #22c55e, #4ade80)' : 'linear-gradient(90deg, #dc2626, #ef4444)',
            }} />
          </div>
        </div>
      )}

      {/* ── Color distribution feed ── */}
      {recentColors.length > 0 && (
        <div className="flex gap-0.5 overflow-hidden h-3 px-1">
          {recentColors.slice(0, 40).map((r, i) => {
            const sw = COLOR_SWATCHES[r.color] || '#94a3b8';
            return (
              <div key={r.id} className="shrink-0 rounded-sm" style={{
                width: 6, height: 10,
                backgroundColor: sw,
                opacity: 1 - i * 0.02,
                animation: i === 0 ? 'ah-dot-pop 150ms ease-out' : undefined,
              }} />
            );
          })}
        </div>
      )}
    </div>
  );
}
