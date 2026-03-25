import { useState } from 'react';
import { LogoMark, KeyIcon, StarIcon, RocketIcon, CrownIcon, InfinityIcon, SpinnerIcon } from './Icons';

/* ------------------------------------------------------------------ */
/*  Inline keyframe styles (injected once via <style>)                */
/* ------------------------------------------------------------------ */
const dynamicStyles = `
  @keyframes float-orb {
    0%, 100% { transform: translate(0, 0) scale(1); }
    33% { transform: translate(30px, -40px) scale(1.1); }
    66% { transform: translate(-20px, 20px) scale(0.95); }
  }
  @keyframes fade-up {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes glow-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
    50%      { box-shadow: 0 0 20px 4px rgba(239, 68, 68, 0.35); }
  }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    15%  { transform: translateX(-6px); }
    30%  { transform: translateX(5px); }
    45%  { transform: translateX(-4px); }
    60%  { transform: translateX(3px); }
    75%  { transform: translateX(-2px); }
  }
  @keyframes shimmer {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  @keyframes progress-indeterminate {
    0%   { transform: translateX(-100%); }
    50%  { transform: translateX(0%); }
    100% { transform: translateX(100%); }
  }
  @keyframes underline-grow {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }
  @keyframes ring-glow {
    0%, 100% { box-shadow: 0 0 0 2px rgba(239,68,68,0.3), 0 0 12px 2px rgba(239,68,68,0.15); }
    50%      { box-shadow: 0 0 0 3px rgba(239,68,68,0.5), 0 0 24px 4px rgba(239,68,68,0.25); }
  }
  .anim-fade-up {
    animation: fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .anim-shake {
    animation: shake 0.5s ease-in-out;
  }
`;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Auto-format a license key: keeps prefix intact, inserts dashes every 4 chars after it. */
function formatLicenseKey(raw: string): string {
  // Strip everything except alphanumerics and dashes
  const clean = raw.toUpperCase().replace(/[^A-Z0-9-]/g, '');

  // Detect prefix pattern: AH-TIER-
  const prefixMatch = clean.match(/^(AH-?[A-Z]{0,10}-?)/);
  if (!prefixMatch) {
    // No prefix yet, just group into 4s
    const digits = clean.replace(/-/g, '');
    return digits.match(/.{1,4}/g)?.join('-') ?? digits;
  }

  const prefix = prefixMatch[1].endsWith('-') ? prefixMatch[1] : prefixMatch[1];
  const rest = clean.slice(prefix.length).replace(/-/g, '');
  const grouped = rest.match(/.{1,4}/g)?.join('-') ?? rest;

  return grouped ? `${prefix}${grouped}` : prefix;
}

/* ------------------------------------------------------------------ */
/*  Tier data                                                         */
/* ------------------------------------------------------------------ */

const tierData = [
  {
    tier: 'Trial',
    limit: '50/day',
    price: 'Free (7 days)',
    icon: StarIcon,
    gradient: 'from-amber-500/10 to-amber-600/5',
    border: 'border-amber-500/20',
    accent: 'text-amber-400',
    features: ['50 conversions per day', '7-day trial period', 'All file formats'],
  },
  {
    tier: 'Hobbyist',
    limit: '500/day',
    price: '$49',
    icon: RocketIcon,
    gradient: 'from-sky-500/10 to-sky-600/5',
    border: 'border-sky-500/20',
    accent: 'text-sky-400',
    features: ['500 conversions per day', 'Lifetime license', 'Priority queue'],
  },
  {
    tier: 'Pro',
    limit: '5,000/day',
    price: '$149',
    icon: CrownIcon,
    gradient: 'from-racing-500/10 to-racing-600/5',
    border: 'border-racing-500/20',
    accent: 'text-racing-400',
    features: ['5,000 conversions per day', 'Lifetime license', 'Batch processing'],
  },
  {
    tier: 'Unlimited',
    limit: 'No limit',
    price: '$349',
    icon: InfinityIcon,
    gradient: 'from-purple-500/10 to-purple-600/5',
    border: 'border-purple-500/20',
    accent: 'text-purple-400',
    features: ['Unlimited conversions', 'Lifetime license', 'Commercial use'],
  },
] as const;

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

interface Props {
  license: LicenseState | null;
  onActivate: (key: string) => Promise<ActivationResult>;
}

export default function LicenseActivation({ license, onActivate }: Props) {
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shakeCard, setShakeCard] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  const handleActivate = async () => {
    if (!key.trim()) return;
    setLoading(true);
    setError('');

    const result = await onActivate(key.replace(/-/g, '').trim());
    if (!result.success) {
      setError(result.error || 'Activation failed');
      setShakeCard(true);
      setTimeout(() => setShakeCard(false), 600);
    }
    setLoading(false);
  };

  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatLicenseKey(e.target.value);
    setKey(formatted);
    if (error) setError('');
  };

  const reason = license?.reason;
  const isExpired = reason === 'expired';
  const isGraceExpired = reason === 'grace_expired';

  return (
    <>
      {/* Inject dynamic keyframes */}
      <style>{dynamicStyles}</style>

      <div className="min-h-screen flex items-center justify-center p-8 relative overflow-hidden">
        {/* Racing mesh background */}
        <div className="racing-mesh" />

        {/* ---- Floating gradient orbs ---- */}
        <div
          className="absolute w-[500px] h-[500px] rounded-full opacity-[0.07] blur-3xl pointer-events-none"
          style={{
            background: 'radial-gradient(circle, #ef4444 0%, transparent 70%)',
            top: '-10%',
            left: '-10%',
            animation: 'float-orb 20s ease-in-out infinite',
          }}
        />
        <div
          className="absolute w-[400px] h-[400px] rounded-full opacity-[0.05] blur-3xl pointer-events-none"
          style={{
            background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)',
            bottom: '-8%',
            right: '-8%',
            animation: 'float-orb 25s ease-in-out infinite reverse',
          }}
        />
        <div
          className="absolute w-[300px] h-[300px] rounded-full opacity-[0.04] blur-3xl pointer-events-none"
          style={{
            background: 'radial-gradient(circle, #f59e0b 0%, transparent 70%)',
            top: '50%',
            right: '20%',
            animation: 'float-orb 18s ease-in-out infinite 3s',
          }}
        />

        {/* ---- Main card ---- */}
        <div
          className={`glass-card rounded-2xl p-8 max-w-lg w-full text-center relative z-10 ${
            shakeCard ? 'anim-shake' : ''
          }`}
        >
          {/* Logo */}
          <div
            className="anim-fade-up flex justify-center mb-6"
            style={{ animationDelay: '0ms' }}
          >
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-racing-500 to-racing-700 flex items-center justify-center glow-red">
              <LogoMark size={36} className="text-white" />
            </div>
          </div>

          {/* Title */}
          <h1
            className="anim-fade-up text-2xl font-heading font-black text-white mb-2"
            style={{ animationDelay: '60ms' }}
          >
            {isExpired
              ? 'Trial Expired'
              : isGraceExpired
                ? 'License Validation Required'
                : 'Activate AutoHue'}
          </h1>

          {/* Subtitle */}
          <div className="anim-fade-up" style={{ animationDelay: '120ms' }}>
            {isExpired && (
              <p className="text-white/40 text-sm mb-6">
                Your trial has expired. Enter a license key to continue using AutoHue.
              </p>
            )}

            {isGraceExpired && (
              <p className="text-white/40 text-sm mb-6">
                Your license needs to be re-validated. Please connect to the internet and restart,
                or enter a new license key.
              </p>
            )}

            {!isExpired && !isGraceExpired && (
              <p className="text-white/40 text-sm mb-6">
                Enter your license key to get started. Purchase one at{' '}
                <span className="text-racing-400 font-medium">autohue.app</span>
              </p>
            )}
          </div>

          {/* ---- Key input ---- */}
          <div
            className="anim-fade-up mb-4 relative"
            style={{ animationDelay: '180ms' }}
          >
            {/* Key icon inside input */}
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 pointer-events-none">
              <KeyIcon size={16} />
            </div>

            <input
              type="text"
              value={key}
              onChange={handleKeyChange}
              onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="AH-PRO-XXXX-XXXX-XXXX-XXXX"
              className={`
                w-full pl-10 pr-4 py-3.5 rounded-lg bg-white/5 border text-white font-mono text-sm tracking-wide
                placeholder:text-white/20 focus:outline-none transition-all duration-300
                ${error
                  ? 'border-red-500/60'
                  : inputFocused
                    ? 'border-racing-500/60'
                    : 'border-white/10'
                }
              `}
              style={
                error
                  ? { animation: 'glow-pulse 1.5s ease-in-out infinite' }
                  : inputFocused
                    ? { animation: 'ring-glow 2s ease-in-out infinite' }
                    : undefined
              }
              disabled={loading}
            />

            {/* Animated underline */}
            <div
              className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] bg-gradient-to-r from-transparent via-racing-500 to-transparent transition-all duration-500 rounded-full"
              style={{
                width: inputFocused ? '90%' : '0%',
                opacity: inputFocused ? 1 : 0,
                animation: inputFocused ? 'underline-grow 0.4s ease-out forwards' : 'none',
                transformOrigin: 'center',
              }}
            />
          </div>

          {/* Error message */}
          {error && (
            <p className="text-red-400 text-xs mb-4 anim-fade-up flex items-center justify-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
              {error}
            </p>
          )}

          {/* ---- Activate button ---- */}
          <div className="anim-fade-up" style={{ animationDelay: '240ms' }}>
            <button
              onClick={handleActivate}
              disabled={loading || !key.trim()}
              className="
                relative overflow-hidden w-full py-3.5 rounded-lg text-sm font-semibold
                bg-gradient-to-r from-racing-600 to-racing-500 text-white
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-all duration-300 group
                hover:shadow-[0_0_24px_rgba(239,68,68,0.3)]
                active:scale-[0.98]
              "
            >
              {/* Shimmer overlay on hover */}
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.15) 50%, transparent 60%)',
                  animation: 'shimmer 2s ease-in-out infinite',
                }}
              />

              {/* Loading progress bar */}
              {loading && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-white/50 w-1/3"
                    style={{ animation: 'progress-indeterminate 1.2s ease-in-out infinite' }}
                  />
                </div>
              )}

              {loading ? (
                <span className="flex items-center justify-center gap-2 relative z-10">
                  <SpinnerIcon size={16} className="animate-spin" />
                  Activating...
                </span>
              ) : (
                <span className="relative z-10">Activate License</span>
              )}
            </button>
          </div>

          {/* ---- Help toggle ---- */}
          <div
            className="anim-fade-up mt-5"
            style={{ animationDelay: '300ms' }}
          >
            <button
              onClick={() => setHelpOpen(!helpOpen)}
              className="text-white/30 hover:text-white/50 text-xs transition-colors duration-200 flex items-center justify-center gap-1.5 mx-auto"
            >
              <svg
                className={`w-3 h-3 transition-transform duration-300 ${helpOpen ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              What&apos;s a license key?
            </button>

            <div
              className="overflow-hidden transition-all duration-300 ease-in-out"
              style={{
                maxHeight: helpOpen ? '200px' : '0px',
                opacity: helpOpen ? 1 : 0,
              }}
            >
              <div className="mt-3 p-4 rounded-lg bg-white/[0.03] border border-white/5 text-left text-xs text-white/40 leading-relaxed">
                <p className="mb-2">
                  A license key is a unique code (e.g. <span className="font-mono text-white/50">AH-PRO-A1B2-C3D4-E5F6-G7H8</span>) that
                  unlocks AutoHue features based on your purchased tier.
                </p>
                <p>
                  You can purchase a key at{' '}
                  <span className="text-racing-400 font-medium">autohue.app</span>. After
                  purchase, it will be emailed to you instantly.
                </p>
              </div>
            </div>
          </div>

          {/* ---- Tier cards ---- */}
          <div className="mt-8 pt-6 border-t border-white/5">
            <p
              className="anim-fade-up text-white/30 text-[10px] uppercase tracking-widest mb-4 font-medium"
              style={{ animationDelay: '360ms' }}
            >
              License Tiers
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              {tierData.map((t, i) => {
                const Icon = t.icon;
                return (
                  <div
                    key={t.tier}
                    className={`
                      anim-fade-up rounded-xl p-3 text-left border transition-all duration-300
                      bg-gradient-to-br ${t.gradient} ${t.border}
                      hover:scale-[1.02] hover:border-opacity-40
                    `}
                    style={{ animationDelay: `${420 + i * 60}ms` }}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <Icon size={14} className={t.accent} />
                      <span className="text-white/80 text-[11px] font-semibold">{t.tier}</span>
                    </div>
                    <div className="text-white/40 text-[10px] mb-2">
                      {t.limit} &middot; {t.price}
                    </div>
                    <ul className="space-y-0.5">
                      {t.features.map((f) => (
                        <li
                          key={f}
                          className="text-white/25 text-[9px] flex items-start gap-1"
                        >
                          <span className={`mt-[3px] w-1 h-1 rounded-full ${t.accent} bg-current shrink-0`} />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
