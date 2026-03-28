import { useEffect, useRef, useCallback } from 'react';

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

const COLOR_HEX: Record<string, string> = {
  red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308',
  orange: '#f97316', purple: '#a855f7', pink: '#ec4899', brown: '#a16207',
  black: '#475569', white: '#e2e8f0', 'silver-grey': '#94a3b8', cream: '#fef3c7',
  gold: '#d97706', unknown: '#f87171', 'please-double-check': '#f59e0b',
};

interface Particle {
  id: number;
  color: string;
  hex: string;
  filename: string;
  progress: number; // 0 (source) → 1 (bucket)
  opacity: number;
  bucketIdx: number;
  speed: number;
  img: HTMLImageElement | null;
  landed: boolean;
}

interface Bucket {
  color: string;
  hex: string;
  count: number;
  flash: number;
}

const MAX_PARTICLES = 30;

export default function SortAnimation({ results, isProcessing, totalProcessed, totalImages }: SortAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    particles: [] as Particle[],
    buckets: new Map<string, Bucket>(),
    processedCount: 0,
    nextId: 0,
    pending: [] as SortResult[],
    lastTime: 0,
    animId: 0,
    spawnTimer: 0,
    engineAngle: 0,
    pulsePhase: 0,
  });

  // Enqueue new results
  useEffect(() => {
    const s = stateRef.current;
    if (results.length > s.processedCount) {
      s.pending.push(...results.slice(s.processedCount));
      s.processedCount = results.length;
    }
  }, [results]);

  // Sync bucket counts
  useEffect(() => {
    const s = stateRef.current;
    const counts = new Map<string, number>();
    results.forEach(r => counts.set(r.color, (counts.get(r.color) || 0) + 1));
    counts.forEach((count, color) => {
      const hex = COLOR_HEX[color] || '#94a3b8';
      if (!s.buckets.has(color)) s.buckets.set(color, { color, hex, count, flash: 0 });
      else s.buckets.get(color)!.count = count;
    });
  }, [results]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);
    }

    const s = stateRef.current;
    const now = performance.now();
    const dt = Math.min(now - (s.lastTime || now), 32);
    s.lastTime = now;
    s.engineAngle += dt * 0.003;
    s.pulsePhase += dt * 0.004;

    // Layout
    const srcX = W * 0.06, engineX = W * 0.38, bucketStartX = W * 0.62;
    const midY = H * 0.45;
    const activeBuckets = Array.from(s.buckets.values()).sort((a, b) => b.count - a.count);
    const bSpacing = Math.min(28, (H - 16) / Math.max(activeBuckets.length, 1));

    // ── Spawn ──
    const spawnRate = s.pending.length > 20 ? 40 : s.pending.length > 5 ? 80 : 140;
    s.spawnTimer += dt;
    while (s.spawnTimer >= spawnRate && s.pending.length > 0 && s.particles.length < MAX_PARTICLES) {
      s.spawnTimer -= spawnRate;
      const item = s.pending.shift()!;
      const hex = COLOR_HEX[item.color] || '#94a3b8';
      if (!s.buckets.has(item.color)) s.buckets.set(item.color, { color: item.color, hex, count: 0, flash: 0 });
      const bIdx = activeBuckets.findIndex(b => b.color === item.color);
      let img: HTMLImageElement | null = null;
      if (item.thumb) { img = new Image(); img.crossOrigin = 'anonymous'; img.src = item.thumb; }
      s.particles.push({
        id: s.nextId++, color: item.color, hex, filename: item.filename,
        progress: 0, opacity: 0, bucketIdx: Math.max(0, bIdx),
        speed: 0.0008 + Math.random() * 0.0004, img, landed: false,
      });
    }

    // ── Clear ──
    ctx.clearRect(0, 0, W, H);

    // ── Track ──
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.moveTo(srcX + 16, midY);
    ctx.lineTo(engineX - 16, midY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(engineX + 16, midY);
    ctx.lineTo(bucketStartX - 8, midY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // ── Source icon ──
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    rr(ctx, srcX - 11, midY - 11, 22, 22, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(249,115,22,0.7)';
    ctx.font = '600 9px "Space Grotesk"';
    ctx.textAlign = 'center';
    const rem = Math.max(0, (totalImages || 0) - (totalProcessed || 0));
    ctx.fillText(String(rem), srcX, midY + 24);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = '500 6px "Outfit"';
    ctx.fillText('QUEUE', srcX, midY + 32);

    // ── Engine ──
    ctx.save();
    ctx.translate(engineX, midY);
    // Ambient glow
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 28);
    const pulseAlpha = 0.04 + Math.sin(s.pulsePhase) * 0.02;
    glow.addColorStop(0, `rgba(220,38,38,${pulseAlpha})`);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(-28, -28, 56, 56);
    // Core
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(22,22,42,0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,38,38,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Spinning arcs
    const arcC = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];
    arcC.forEach((c, i) => {
      const a = s.engineAngle + (i * Math.PI * 2) / 6;
      ctx.beginPath();
      ctx.arc(0, 0, 12, a, a + 0.7);
      ctx.strokeStyle = c + '88';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
    ctx.restore();
    // Engine label
    ctx.fillStyle = isProcessing ? 'rgba(34,197,94,0.45)' : 'rgba(255,255,255,0.12)';
    ctx.font = '600 7px "Space Grotesk"';
    ctx.textAlign = 'center';
    ctx.fillText(isProcessing ? 'CLASSIFYING' : 'AI ENGINE', engineX, midY + 28);

    // ── Buckets ──
    const bListY = 8;
    activeBuckets.forEach((b, i) => {
      const bx = bucketStartX, by = bListY + i * bSpacing;
      b.flash = Math.max(0, b.flash - dt / 250);
      ctx.fillStyle = b.hex + (b.flash > 0 ? '35' : '12');
      ctx.strokeStyle = b.hex + (b.flash > 0 ? '70' : '25');
      ctx.lineWidth = b.flash > 0 ? 1.5 : 0.7;
      rr(ctx, bx, by, 24, 18, 3); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.arc(bx + 7, by + 9, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = b.hex;
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '600 8px "JetBrains Mono"';
      ctx.textAlign = 'left';
      ctx.fillText(String(b.count), bx + 28, by + 12);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = '400 6px "Outfit"';
      const lbl = b.color === 'silver-grey' ? 'Silver' : b.color === 'please-double-check' ? 'Review' : b.color.charAt(0).toUpperCase() + b.color.slice(1);
      ctx.fillText(lbl, bx + 48, by + 12);
    });
    // Sorted total
    ctx.fillStyle = 'rgba(34,197,94,0.6)';
    ctx.font = '700 10px "Space Grotesk"';
    ctx.textAlign = 'left';
    ctx.fillText(String(totalProcessed ?? 0), bucketStartX, H - 6);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = '500 6px "Outfit"';
    ctx.fillText('SORTED', bucketStartX + 32, H - 6);

    // ── Particles ──
    const toRemove: number[] = [];
    for (let i = 0; i < s.particles.length; i++) {
      const p = s.particles[i];
      p.progress += p.speed * dt;
      p.opacity = p.progress < 0.05 ? p.progress / 0.05
        : p.progress > 0.9 ? Math.max(0, (1 - p.progress) / 0.1)
        : 1;

      if (p.progress >= 1 && !p.landed) {
        p.landed = true;
        const bucket = s.buckets.get(p.color);
        if (bucket) { bucket.count++; bucket.flash = 1; }
      }
      if (p.progress >= 1.1) { toRemove.push(i); continue; }

      // Position: cubic bezier path from source → engine → bucket
      const freshBuckets = activeBuckets;
      const bIdx = Math.min(p.bucketIdx, freshBuckets.length - 1);
      const targetY = bListY + Math.max(0, bIdx) * bSpacing + 9;
      let px: number, py: number;

      if (p.progress < 0.4) {
        // Source → engine (straight horizontal)
        const t = p.progress / 0.4;
        px = srcX + (engineX - srcX) * t;
        py = midY + Math.sin(t * Math.PI) * -4; // slight arc up
      } else if (p.progress < 0.55) {
        // Through engine (pulse)
        const t = (p.progress - 0.4) / 0.15;
        px = engineX;
        py = midY;
        // Scale pulse
        p.opacity = 0.6 + Math.sin(t * Math.PI) * 0.4;
      } else {
        // Engine → bucket (curve toward target)
        const t = (p.progress - 0.55) / 0.45;
        const eased = t * t * (3 - 2 * t); // smoothstep
        px = engineX + (bucketStartX - engineX + 4) * eased;
        py = midY + (targetY - midY) * eased;
      }

      if (p.opacity <= 0) continue;
      ctx.globalAlpha = p.opacity;

      const cardW = 22, cardH = 14;
      // Draw card
      if (p.img && p.img.complete && p.img.naturalWidth > 0) {
        ctx.save();
        rr(ctx, px - cardW / 2, py - cardH / 2, cardW, cardH, 2);
        ctx.clip();
        ctx.drawImage(p.img, px - cardW / 2, py - cardH / 2, cardW, cardH);
        ctx.restore();
        ctx.strokeStyle = p.hex;
        ctx.lineWidth = 1.5;
        rr(ctx, px - cardW / 2, py - cardH / 2, cardW, cardH, 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.hex;
        rr(ctx, px - cardW / 2, py - cardH / 2, cardW, cardH, 2);
        ctx.fill();
        // Filename
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '500 5px "Outfit"';
        ctx.textAlign = 'center';
        const short = p.filename.length > 8 ? p.filename.slice(0, 7) + '…' : p.filename;
        ctx.fillText(short, px, py + 2);
      }

      // Glow near engine
      if (p.progress > 0.35 && p.progress < 0.6) {
        ctx.fillStyle = p.hex + '20';
        rr(ctx, px - cardW / 2 - 2, py - cardH / 2 - 2, cardW + 4, cardH + 4, 3);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    for (let i = toRemove.length - 1; i >= 0; i--) s.particles.splice(toRemove[i], 1);

    // Continue loop if active
    if (isProcessing || s.particles.length > 0 || s.pending.length > 0) {
      s.animId = requestAnimationFrame(render);
    }
  }, [isProcessing, totalProcessed, totalImages]);

  useEffect(() => {
    stateRef.current.lastTime = performance.now();
    stateRef.current.animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(stateRef.current.animId);
  }, [render]);

  return <canvas ref={canvasRef} className="w-full" style={{ height: 170, display: 'block' }} />;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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
