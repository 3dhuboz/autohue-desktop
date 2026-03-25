import { useRef, useEffect, useState } from 'react';
import { LogoMark, SortIcon, HistoryIcon, SettingsIcon, StatusDot } from './Icons';

type Page = 'sort' | 'history' | 'settings';

interface NavBarProps {
  page: Page;
  setPage: (page: Page) => void;
  license: LicenseState;
}

const tabs: { id: Page; label: string; Icon: typeof SortIcon }[] = [
  { id: 'sort', label: 'Sort Photos', Icon: SortIcon },
  { id: 'history', label: 'History', Icon: HistoryIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export default function NavBar({ page, setPage, license }: NavBarProps) {
  const tabsRef = useRef<Map<Page, HTMLButtonElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  // Compute sliding indicator position whenever page changes
  useEffect(() => {
    const btn = tabsRef.current.get(page);
    const container = containerRef.current;
    if (btn && container) {
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      setIndicator({
        left: btnRect.left - containerRect.left,
        width: btnRect.width,
      });
    }
  }, [page]);

  // ── Quota helpers ──
  const hasQuota = license.active && !license.isUnlimited && license.remaining !== undefined && license.dailyLimit !== undefined;
  const usedPct = hasQuota ? ((license.dailyLimit! - license.remaining!) / license.dailyLimit!) * 100 : 0;
  const quotaColor = usedPct >= 80 ? 'red' : usedPct >= 50 ? 'amber' : 'green';

  const quotaColors = {
    green: {
      bg: 'bg-green-500/10',
      border: 'border-green-500/20',
      bar: 'bg-green-500',
      text: 'text-green-400',
    },
    amber: {
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      bar: 'bg-amber-500',
      text: 'text-amber-400',
    },
    red: {
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
      bar: 'bg-red-500',
      text: 'text-red-400',
    },
  };

  // ── Tier badge styling ──
  const tierStyles: Record<string, string> = {
    trial: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
    hobbyist: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    pro: 'bg-racing-500/15 text-racing-400 border-racing-500/25',
    unlimited: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
  };
  const tierClass = tierStyles[license.tier || ''] || tierStyles.trial;

  return (
    <nav className="titlebar-drag sticky top-0 z-50 bg-carbon-300/80 backdrop-blur-xl">
      <div className="flex items-center justify-between px-4 h-[52px]">
        {/* ── Logo + Tabs ── */}
        <div className="flex items-center gap-5 titlebar-no-drag">
          {/* Brand */}
          <div className="flex items-center gap-2.5 mr-1">
            <LogoMark size={26} />
            <span className="font-heading font-bold text-[13px] tracking-tight text-white/85">
              AutoHue
            </span>
          </div>

          {/* Tab bar with sliding indicator */}
          <div ref={containerRef} className="relative flex gap-0.5">
            {tabs.map(({ id, label, Icon }) => {
              const active = page === id;
              return (
                <button
                  key={id}
                  ref={(el) => {
                    if (el) tabsRef.current.set(id, el);
                  }}
                  onClick={() => setPage(id)}
                  className={`
                    relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
                    transition-colors duration-200 select-none
                    ${active
                      ? 'text-white bg-white/[0.07]'
                      : 'text-white/40 hover:text-white/70 hover:bg-white/[0.04]'
                    }
                  `}
                >
                  <Icon
                    size={13}
                    className={`transition-colors duration-200 ${active ? 'text-racing-400' : ''}`}
                  />
                  {label}
                </button>
              );
            })}

            {/* Animated sliding underline */}
            <div
              className="absolute bottom-0 h-[2px] rounded-full bg-racing-500 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
              style={{
                left: indicator.left,
                width: indicator.width,
                boxShadow: '0 0 8px rgba(239,68,68,0.5), 0 0 16px rgba(239,68,68,0.2)',
              }}
            />
          </div>
        </div>

        {/* ── Right section: quota + badge (pr-32 = space for Windows window controls) ── */}
        <div className="flex items-center gap-3 titlebar-no-drag pr-32">
          {/* Daily quota progress pill */}
          {hasQuota && (
            <div
              className={`
                flex items-center gap-2 px-2.5 py-1 rounded-full border
                ${quotaColors[quotaColor].bg} ${quotaColors[quotaColor].border}
              `}
              title={`${license.remaining!.toLocaleString()} of ${license.dailyLimit!.toLocaleString()} remaining today`}
            >
              <span className={`text-[10px] font-mono font-medium ${quotaColors[quotaColor].text}`}>
                {license.remaining!.toLocaleString()} / {license.dailyLimit!.toLocaleString()}
              </span>
              <div className="w-14 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${quotaColors[quotaColor].bar}`}
                  style={{ width: `${Math.min(usedPct, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* License tier badge */}
          <div className="flex items-center gap-1.5">
            <StatusDot
              color={license.active ? 'green' : 'red'}
              pulse={license.active}
            />
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${tierClass}`}>
              {license.tierName || 'Trial'}
            </span>
          </div>

          {/* Upgrade link for trial users */}
          {license.tier === 'trial' && (
            <button
              onClick={() => {
                window.electronAPI?.openInExplorer?.('https://autohue.app/pricing');
              }}
              className="text-[10px] font-medium text-racing-400 hover:text-racing-300 transition-colors duration-200 underline underline-offset-2 decoration-racing-400/30 hover:decoration-racing-300/50"
            >
              Upgrade
            </button>
          )}

          {/* Offline indicator */}
          {license.offlineMode && (
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
              Offline
            </span>
          )}
        </div>
      </div>

      {/* Gradient border-bottom: red glow fading from center */}
      <div
        className="h-px w-full"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(239,68,68,0.4) 0%, rgba(239,68,68,0.08) 50%, transparent 80%)',
        }}
      />
    </nav>
  );
}
