import { useState, useEffect, useRef } from 'react';
import { useLicense } from './hooks/useLicense';
import { ToastProvider } from './components/Toast';
import { LogoMark } from './components/Icons';
import NavBar from './components/NavBar';
import LicenseActivation from './components/LicenseActivation';
import SortPage from './pages/SortPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';

type Page = 'sort' | 'history' | 'settings';

// ─── Startup messages that cycle during loading ───
const STARTUP_MESSAGES = [
  'Loading AI models...',
  'Initializing database...',
  'Calibrating color engine...',
  'Warming up classifiers...',
  'Ready.',
];

// ─── Particle background for loading screen ───
function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      opacity: number;
    }

    const particles: Particle[] = Array.from({ length: 40 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.5 + 0.5,
      opacity: Math.random() * 0.3 + 0.05,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around edges
        if (p.x < 0) p.x = window.innerWidth;
        if (p.x > window.innerWidth) p.x = 0;
        if (p.y < 0) p.y = window.innerHeight;
        if (p.y > window.innerHeight) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(239, 68, 68, ${p.opacity})`;
        ctx.fill();
      }

      // Draw subtle connection lines between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(239, 68, 68, ${0.06 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}

// ─── Loading screen with animated logo + progress messages ───
function LoadingScreen() {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    if (msgIndex >= STARTUP_MESSAGES.length - 1) return;
    const delay = msgIndex === STARTUP_MESSAGES.length - 2 ? 600 : 700 + Math.random() * 400;
    const timer = setTimeout(() => setMsgIndex((i) => i + 1), delay);
    return () => clearTimeout(timer);
  }, [msgIndex]);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div className="racing-mesh" />
      <ParticleField />

      <div className="relative z-10 flex flex-col items-center gap-6">
        {/* Animated logo with pulse + glow */}
        <div
          className="relative"
          style={{
            animation: 'logoBreath 2.5s ease-in-out infinite',
          }}
        >
          {/* Glow backdrop */}
          <div
            className="absolute inset-0 rounded-2xl blur-2xl"
            style={{
              background: 'radial-gradient(circle, rgba(239,68,68,0.35) 0%, transparent 70%)',
              animation: 'glowPulse 2.5s ease-in-out infinite',
              transform: 'scale(2.5)',
            }}
          />
          <LogoMark size={56} className="relative drop-shadow-2xl" />
        </div>

        {/* App name */}
        <h1 className="font-heading font-bold text-lg tracking-tight text-white/90">
          AutoHue
        </h1>

        {/* Cycling status messages */}
        <div className="h-5 flex items-center justify-center">
          <p
            key={msgIndex}
            className="text-white/35 text-xs font-mono animate-fade-up"
          >
            {STARTUP_MESSAGES[msgIndex]}
          </p>
        </div>

        {/* Minimal progress dots */}
        <div className="flex gap-1.5">
          {STARTUP_MESSAGES.map((_, i) => (
            <div
              key={i}
              className={`
                h-1 rounded-full transition-all duration-500
                ${i <= msgIndex
                  ? 'w-4 bg-racing-500'
                  : 'w-1 bg-white/10'
                }
              `}
            />
          ))}
        </div>
      </div>

      {/* Inject keyframes for logo breathing animation */}
      <style>{`
        @keyframes logoBreath {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
      `}</style>
    </div>
  );
}

// ─── Page transition wrapper ───
function PageTransition({ pageKey, children }: { pageKey: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [currentKey, setCurrentKey] = useState(pageKey);
  const [content, setContent] = useState(children);

  useEffect(() => {
    if (pageKey !== currentKey) {
      // Fade out, then swap content, then fade in
      setVisible(false);
      const timer = setTimeout(() => {
        setContent(children);
        setCurrentKey(pageKey);
        // Small delay before fading in to allow DOM update
        requestAnimationFrame(() => setVisible(true));
      }, 150);
      return () => clearTimeout(timer);
    } else {
      // Initial mount — fade in
      requestAnimationFrame(() => setVisible(true));
    }
  }, [pageKey, children, currentKey]);

  return (
    <div
      className="transition-all duration-300 ease-out"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(6px)',
      }}
    >
      {content}
    </div>
  );
}

// ─── Main App ───
export default function App() {
  const { license, loading, activate, refresh } = useLicense();
  const [page, setPage] = useState<Page>('sort');

  // Loading screen
  if (loading) {
    return <LoadingScreen />;
  }

  // License activation gate
  if (!license?.active) {
    return (
      <ToastProvider>
        <LicenseActivation license={license} onActivate={activate} />
      </ToastProvider>
    );
  }

  const pageContent = (() => {
    switch (page) {
      case 'sort':
        return <SortPage />;
      case 'history':
        return <HistoryPage />;
      case 'settings':
        return <SettingsPage license={license} onRefresh={refresh} />;
    }
  })();

  return (
    <ToastProvider>
      <div className="min-h-screen">
        <div className="racing-mesh" />
        <NavBar page={page} setPage={setPage} license={license} />

        <div className="pt-2">
          <PageTransition pageKey={page}>
            {pageContent}
          </PageTransition>
        </div>
      </div>
    </ToastProvider>
  );
}
