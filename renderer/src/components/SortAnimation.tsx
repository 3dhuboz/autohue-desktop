import { useEffect, useRef, useCallback } from 'react';

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
const COLOR_HEX: Record<string, string> = {
  red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308',
  orange: '#f97316', purple: '#a855f7', pink: '#ec4899', brown: '#a16207',
  black: '#475569', white: '#e2e8f0', 'silver-grey': '#94a3b8', cream: '#fef3c7',
  gold: '#d97706', unknown: '#f87171', 'please-double-check': '#f59e0b',
};

// Particle in the stream
interface Particle {
  id: number;
  color: string;
  hex: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  size: number;
  opacity: number;
  phase: 'enter' | 'travel' | 'sort' | 'done';
  bucketIdx: number;
  speed: number;
  trail: { x: number; y: number }[];
}

// Bucket accumulator
interface Bucket {
  color: string;
  hex: string;
  count: number;
  flashTimer: number;
}

const MAX_PARTICLES = 60;
const BUCKET_COLORS = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'black', 'white', 'silver-grey', 'cream'];

export default function SortAnimation({ results, isProcessing, totalProcessed, totalImages }: SortAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    particles: [] as Particle[],
    buckets: new Map<string, Bucket>(),
    processedCount: 0,
    nextId: 0,
    pendingQueue: [] as SortResult[],
    spawnAccum: 0,
    lastTime: 0,
    animId: 0,
  });

  // Enqueue new results
  useEffect(() => {
    const s = stateRef.current;
    if (results.length > s.processedCount) {
      const newItems = results.slice(s.processedCount);
      s.processedCount = results.length;
      s.pendingQueue.push(...newItems);
    }
  }, [results]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;

    // Resize canvas if needed
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);
    }

    const s = stateRef.current;
    const now = performance.now();
    const dt = Math.min(now - (s.lastTime || now), 33); // cap at ~30fps delta
    s.lastTime = now;

    // ── Layout ──
    const funnelX = W * 0.08;      // left: source
    const engineX = W * 0.42;      // center: AI engine
    const bucketStartX = W * 0.65; // right: color buckets
    const centerY = H * 0.45;
    const bucketW = 28;
    const bucketH = 20;

    // Active buckets (only those with results)
    const activeBuckets = Array.from(s.buckets.values()).sort((a, b) => b.count - a.count);
    const bucketSpacing = Math.min(32, (H - 20) / Math.max(activeBuckets.length, 1));

    // ── Spawn particles from queue ──
    const spawnRate = s.pendingQueue.length > 30 ? 16 : s.pendingQueue.length > 10 ? 30 : 50;
    s.spawnAccum += dt;
    while (s.spawnAccum >= spawnRate && s.pendingQueue.length > 0 && s.particles.length < MAX_PARTICLES) {
      s.spawnAccum -= spawnRate;
      const item = s.pendingQueue.shift()!;
      const hex = COLOR_HEX[item.color] || '#94a3b8';

      // Ensure bucket exists
      if (!s.buckets.has(item.color)) {
        s.buckets.set(item.color, { color: item.color, hex, count: 0, flashTimer: 0 });
      }
      const bucket = s.buckets.get(item.color)!;
      const bucketIdx = activeBuckets.indexOf(bucket);

      s.particles.push({
        id: s.nextId++,
        color: item.color,
        hex,
        x: funnelX - 10,
        y: centerY + (Math.random() - 0.5) * 20,
        targetX: 0,
        targetY: 0,
        size: 5 + Math.random() * 3,
        opacity: 0,
        phase: 'enter',
        bucketIdx: Math.max(0, bucketIdx),
        speed: 0.15 + Math.random() * 0.1,
        trail: [],
      });
    }

    // ── Clear ──
    ctx.clearRect(0, 0, W, H);

    // ── Draw track line ──
    const grad = ctx.createLinearGradient(funnelX, 0, engineX, 0);
    grad.addColorStop(0, 'rgba(220,38,38,0.08)');
    grad.addColorStop(1, 'rgba(220,38,38,0.03)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.moveTo(funnelX + 10, centerY);
    ctx.lineTo(engineX - 18, centerY);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Draw source stack icon ──
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    const srcSize = 22;
    roundRect(ctx, funnelX - srcSize / 2, centerY - srcSize / 2, srcSize, srcSize, 4);
    ctx.fill();
    ctx.stroke();
    // Image icon inside
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(funnelX - 6, centerY + 4);
    ctx.lineTo(funnelX - 2, centerY);
    ctx.lineTo(funnelX + 2, centerY + 3);
    ctx.lineTo(funnelX + 6, centerY - 2);
    ctx.stroke();

    // Remaining count
    const remaining = Math.max(0, (totalImages || 0) - (totalProcessed || 0));
    ctx.fillStyle = 'rgba(249,115,22,0.7)';
    ctx.font = '600 10px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(remaining), funnelX, centerY + srcSize / 2 + 14);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '500 7px "Outfit", sans-serif';
    ctx.fillText('QUEUE', funnelX, centerY + srcSize / 2 + 23);

    // ── Draw AI Engine core ──
    const engineR = 18;
    const spinAngle = (now / 800) % (Math.PI * 2);
    ctx.save();
    ctx.translate(engineX, centerY);

    // Glow
    if (isProcessing && s.particles.length > 0) {
      const lastHex = s.particles[s.particles.length - 1]?.hex || '#dc2626';
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, engineR * 2);
      glow.addColorStop(0, lastHex + '18');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(-engineR * 2, -engineR * 2, engineR * 4, engineR * 4);
    }

    // Ring
    ctx.beginPath();
    ctx.arc(0, 0, engineR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(22,22,42,0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,38,38,0.2)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Spinning color arcs
    const arcColors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];
    arcColors.forEach((c, i) => {
      const startA = spinAngle + (i * Math.PI * 2) / 6;
      const endA = startA + Math.PI / 4;
      ctx.beginPath();
      ctx.arc(0, 0, engineR - 4, startA, endA);
      ctx.strokeStyle = c + '99';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Center dot
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();

    ctx.restore();

    // Engine label
    ctx.fillStyle = isProcessing ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.15)';
    ctx.font = '600 8px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(isProcessing ? 'CLASSIFYING' : 'AI ENGINE', engineX, centerY + engineR + 14);

    // ── Draw buckets ──
    const bucketListStartY = 10;
    activeBuckets.forEach((bucket, i) => {
      const bx = bucketStartX;
      const by = bucketListStartY + i * bucketSpacing;

      // Flash effect
      bucket.flashTimer = Math.max(0, bucket.flashTimer - dt / 300);
      const flash = bucket.flashTimer;

      // Bucket rectangle
      ctx.fillStyle = bucket.hex + (flash > 0 ? '40' : '18');
      ctx.strokeStyle = bucket.hex + (flash > 0 ? '80' : '30');
      ctx.lineWidth = flash > 0 ? 1.5 : 0.8;
      roundRect(ctx, bx, by, bucketW, bucketH, 3);
      ctx.fill();
      ctx.stroke();

      // Color dot
      ctx.beginPath();
      ctx.arc(bx + 8, by + bucketH / 2, 4, 0, Math.PI * 2);
      ctx.fillStyle = bucket.hex;
      ctx.fill();

      // Count
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '600 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(String(bucket.count), bx + bucketW + 6, by + bucketH / 2 + 3);

      // Color label
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '400 7px "Outfit", sans-serif';
      const label = bucket.color === 'silver-grey' ? 'Silver' : bucket.color === 'please-double-check' ? 'Review' : bucket.color.charAt(0).toUpperCase() + bucket.color.slice(1);
      ctx.fillText(label, bx + bucketW + 30, by + bucketH / 2 + 3);
    });

    // Sorted count
    ctx.fillStyle = 'rgba(34,197,94,0.7)';
    ctx.font = '700 11px "Space Grotesk", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(totalProcessed ?? 0), bucketStartX, H - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '500 7px "Outfit", sans-serif';
    ctx.fillText('SORTED', bucketStartX + 36, H - 8);

    // ── Update & draw particles ──
    const toRemove: number[] = [];

    for (let i = 0; i < s.particles.length; i++) {
      const p = s.particles[i];
      const spd = p.speed * dt;

      // Store trail
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 6) p.trail.shift();

      switch (p.phase) {
        case 'enter':
          p.opacity = Math.min(1, p.opacity + 0.06);
          p.x += spd * 1.8;
          if (p.x >= engineX - engineR - 4) {
            p.phase = 'travel';
          }
          break;

        case 'travel':
          // Pulse through the engine
          p.x += spd * 1.2;
          p.size = p.x < engineX ? p.size * 1.003 : p.size * 0.997;
          if (p.x >= engineX + engineR + 4) {
            p.phase = 'sort';
            // Recompute bucket position (it may have shifted)
            const freshBuckets = Array.from(s.buckets.values()).sort((a, b) => b.count - a.count);
            const bIdx = freshBuckets.findIndex(b => b.color === p.color);
            p.bucketIdx = Math.max(0, bIdx);
            p.targetX = bucketStartX + 4;
            p.targetY = bucketListStartY + p.bucketIdx * bucketSpacing + bucketH / 2;
          }
          break;

        case 'sort':
          // Fly toward bucket
          const dx = p.targetX - p.x;
          const dy = p.targetY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 4) {
            p.phase = 'done';
            // Increment bucket
            const bucket = s.buckets.get(p.color);
            if (bucket) {
              bucket.count++;
              bucket.flashTimer = 1;
            }
          } else {
            const factor = Math.min(1, spd * 2.5 / dist);
            p.x += dx * factor;
            p.y += dy * factor;
          }
          p.size *= 0.992;
          break;

        case 'done':
          p.opacity -= 0.12;
          if (p.opacity <= 0) toRemove.push(i);
          break;
      }

      // Draw trail
      if (p.trail.length > 1 && p.opacity > 0.1) {
        ctx.beginPath();
        ctx.moveTo(p.trail[0].x, p.trail[0].y);
        for (let t = 1; t < p.trail.length; t++) {
          ctx.lineTo(p.trail[t].x, p.trail[t].y);
        }
        ctx.strokeStyle = p.hex + '20';
        ctx.lineWidth = p.size * 0.5;
        ctx.stroke();
      }

      // Draw particle
      if (p.opacity > 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
        ctx.fillStyle = p.hex;
        ctx.globalAlpha = p.opacity;
        ctx.fill();

        // Glow
        if (p.phase === 'travel' && p.x > engineX - 8 && p.x < engineX + 8) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = p.hex + '44';
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    // Remove dead particles (reverse order)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      s.particles.splice(toRemove[i], 1);
    }

    // Continue animation
    if (isProcessing || s.particles.length > 0 || s.pendingQueue.length > 0) {
      s.animId = requestAnimationFrame(render);
    }
  }, [isProcessing, totalProcessed, totalImages]);

  // Start/stop animation loop
  useEffect(() => {
    const s = stateRef.current;
    s.lastTime = performance.now();
    s.animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(s.animId);
  }, [render]);

  // Reset buckets from results on mount / results change
  useEffect(() => {
    const s = stateRef.current;
    // Sync bucket counts from actual results
    const counts = new Map<string, number>();
    results.forEach(r => {
      counts.set(r.color, (counts.get(r.color) || 0) + 1);
    });
    counts.forEach((count, color) => {
      const hex = COLOR_HEX[color] || '#94a3b8';
      if (!s.buckets.has(color)) {
        s.buckets.set(color, { color, hex, count, flashTimer: 0 });
      } else {
        s.buckets.get(color)!.count = count;
      }
    });
  }, [results]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{ height: 180, display: 'block' }}
    />
  );
}

// ── Helpers ──
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
