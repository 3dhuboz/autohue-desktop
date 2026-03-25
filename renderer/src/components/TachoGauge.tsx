import { useEffect, useRef, useState } from 'react';

interface TachoGaugeProps {
  value: number;
  max: number;
  label: string;
  unit: string;
  displayValue: string;
  size?: number;
  variant?: 'red' | 'green' | 'amber' | 'blue';
  redZoneStart?: number;
  subtitle?: string;
}

export default function TachoGauge({
  value, label, unit, displayValue, size = 200, variant = 'red', redZoneStart = 80, subtitle,
}: TachoGaugeProps) {
  const [animatedValue, setAnimatedValue] = useState(0);
  const prevValue = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = prevValue.current;
    const end = Math.min(Math.max(value, 0), 100);
    const duration = 1200;
    const startTime = performance.now();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      const current = start + (end - start) * eased;
      setAnimatedValue(current);
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    prevValue.current = end;
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value]);

  const cx = size / 2, cy = size / 2, radius = size / 2 - 20;
  const startAngle = 135, endAngle = 405, sweepAngle = 270;

  const polarToCartesian = (angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  const describeArc = (start: number, end: number) => {
    const s = polarToCartesian(start), e = polarToCartesian(end);
    const largeArc = end - start > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${largeArc} 1 ${e.x} ${e.y}`;
  };

  const bgArc = describeArc(startAngle, endAngle);
  const fillEnd = startAngle + (sweepAngle * animatedValue) / 100;
  const fillArc = animatedValue > 0.5 ? describeArc(startAngle, fillEnd) : '';
  const redZoneArc = describeArc(startAngle + (sweepAngle * redZoneStart) / 100, endAngle);
  const needleAngle = startAngle + (sweepAngle * animatedValue) / 100 - 90;

  const ticks = Array.from({ length: 11 }, (_, i) => {
    const angle = startAngle + (sweepAngle * i) / 10;
    const inner = polarToCartesian(angle);
    const outerRadius = radius + 10;
    const rad = ((angle - 90) * Math.PI) / 180;
    const outer = { x: cx + outerRadius * Math.cos(rad), y: cy + outerRadius * Math.sin(rad) };
    return { inner, outer, isMajor: i % 2 === 0 };
  });

  const gradientId = `gauge-gradient-${variant}-${size}`;
  const glowId = `gauge-glow-${variant}-${size}`;
  const gradientColors: Record<string, { start: string; end: string }> = {
    red: { start: '#f97316', end: '#dc2626' }, green: { start: '#22c55e', end: '#10b981' },
    amber: { start: '#f59e0b', end: '#ef4444' }, blue: { start: '#3b82f6', end: '#6366f1' },
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={gradientColors[variant].start} />
            <stop offset="100%" stopColor={gradientColors[variant].end} />
          </linearGradient>
          <filter id={glowId}>
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path d={bgArc} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={10} strokeLinecap="round" />
        <path d={redZoneArc} fill="none" stroke="rgba(220,38,38,0.15)" strokeWidth={10} strokeLinecap="round" />
        {ticks.map((tick, i) => (
          <line key={i} x1={tick.inner.x} y1={tick.inner.y} x2={tick.outer.x} y2={tick.outer.y}
            stroke={tick.isMajor ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'} strokeWidth={tick.isMajor ? 2 : 1} />
        ))}
        {fillArc && <path d={fillArc} fill="none" stroke={`url(#${gradientId})`} strokeWidth={10} strokeLinecap="round" filter={`url(#${glowId})`} />}
        <g transform={`rotate(${needleAngle}, ${cx}, ${cy})`}>
          <line x1={cx} y1={cy} x2={cx} y2={cy - radius + 15} stroke="white" strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={6} fill="#dc2626" stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} />
        </g>
        <text x={cx} y={cy + 28} textAnchor="middle" fill="white" fontSize={size * 0.16} fontWeight="800" fontFamily="'JetBrains Mono', monospace">{displayValue}</text>
        <text x={cx} y={cy + 44} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize={size * 0.06} fontWeight="500" fontFamily="'Outfit', sans-serif">{unit}</text>
      </svg>
      <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-white/40">{label}</span>
      {subtitle && <span className="text-[9px] text-white/20 -mt-1">{subtitle}</span>}
    </div>
  );
}
