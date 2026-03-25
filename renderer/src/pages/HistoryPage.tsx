import { useState, useEffect, useMemo, useRef } from 'react';
import { useWorker } from '../hooks/useWorker';
import {
  FolderIcon,
  TrashIcon,
  CheckIcon,
  SpinnerIcon,
  CloseIcon,
  AlertIcon,
  ImageIcon,
  FlagIcon,
} from '../components/Icons';

// ─── Date grouping helpers ──────────────────────────────────────

type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'Older';

function classifyDate(dateStr: string): DateGroup {
  const d = new Date(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  const startOfWeek = new Date(startOfToday.getTime() - startOfToday.getDay() * 86_400_000);

  if (d >= startOfToday) return 'Today';
  if (d >= startOfYesterday) return 'Yesterday';
  if (d >= startOfWeek) return 'This Week';
  return 'Older';
}

function groupByDate(entries: HistoryEntry[]): { label: DateGroup; items: HistoryEntry[] }[] {
  const order: DateGroup[] = ['Today', 'Yesterday', 'This Week', 'Older'];
  const map = new Map<DateGroup, HistoryEntry[]>();
  for (const e of entries) {
    const g = classifyDate(e.created_at);
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(e);
  }
  return order.filter(l => map.has(l)).map(l => ({ label: l, items: map.get(l)! }));
}

// ─── Color swatch map ───────────────────────────────────────────

const SWATCH: Record<string, string> = {
  red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308',
  orange: '#f97316', purple: '#a855f7', pink: '#ec4899', brown: '#a16207',
  black: '#334155', white: '#e2e8f0', 'silver-grey': '#94a3b8',
};

// ─── Status accent colours ──────────────────────────────────────

const STATUS_ACCENT: Record<string, string> = {
  completed: '#22c55e',
  error: '#ef4444',
  processing: '#eab308',
};

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  completed: { bg: 'bg-green-500/10', text: 'text-green-400' },
  error:     { bg: 'bg-red-500/10',   text: 'text-red-400' },
  processing:{ bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
};

function StatusBadgeIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckIcon size={10} className="text-green-400" />;
  if (status === 'error')     return <CloseIcon size={10} className="text-red-400" />;
  return <SpinnerIcon size={10} className="text-yellow-400" />;
}

// ─── Component ──────────────────────────────────────────────────

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { workerUrl } = useWorker();
  const [activeSession, setActiveSession] = useState<{ sid: string; status: string; processed: number; total: number; currentFile: string } | null>(null);
  const activePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    window.electronAPI.getHistory()
      .then(setHistory)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Poll for active session from localStorage
  useEffect(() => {
    const checkActive = () => {
      const saved = localStorage.getItem('autohue_active_session');
      if (!saved || !workerUrl) { setActiveSession(null); return; }
      const { sid } = JSON.parse(saved);
      fetch(`${workerUrl}/status/${sid}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) { setActiveSession(null); return; }
          if (data.status === 'processing' || data.status === 'paused') {
            setActiveSession({ sid, status: data.status, processed: data.processed, total: data.total, currentFile: data.current_file || '' });
          } else {
            setActiveSession(null);
            localStorage.removeItem('autohue_active_session');
          }
        })
        .catch(() => setActiveSession(null));
    };
    checkActive();
    activePollRef.current = setInterval(checkActive, 2000);
    return () => { if (activePollRef.current) clearInterval(activePollRef.current); };
  }, [workerUrl]);

  const handlePauseResume = () => {
    if (!activeSession || !workerUrl) return;
    const action = activeSession.status === 'paused' ? 'resume' : 'pause';
    fetch(`${workerUrl}/${action}/${activeSession.sid}`, { method: 'POST' });
  };

  const handleCancel = () => {
    if (!activeSession || !workerUrl) return;
    if (confirm('Cancel sorting? Already-sorted images will be kept.')) {
      fetch(`${workerUrl}/cancel/${activeSession.sid}`, { method: 'POST' });
      localStorage.removeItem('autohue_active_session');
      setActiveSession(null);
    }
  };

  const handleDelete = async (id: number) => {
    await window.electronAPI.deleteHistory(id);
    setHistory(prev => prev.filter(h => h.id !== id));
  };

  const handleOpenFolder = async (outputPath: string | null) => {
    if (outputPath) {
      await window.electronAPI.openInExplorer(outputPath);
    }
  };

  const parseColorCounts = (json: string | null): Record<string, number> => {
    if (!json) return {};
    try { return JSON.parse(json); } catch { return {}; }
  };

  const groups = useMemo(() => groupByDate(history), [history]);

  // ─── Loading skeleton ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="container mx-auto px-6 max-w-4xl mt-6 pb-20">
        <h1 className="text-2xl font-heading font-black mb-6">
          Processing <span className="text-racing-500">History</span>
        </h1>
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 space-y-2">
                  <div className="skeleton rounded h-4 w-32" />
                  <div className="skeleton rounded h-3 w-48" />
                  <div className="flex gap-1.5 mt-2">
                    {[0, 1, 2, 3].map(j => (
                      <div key={j} className="skeleton rounded-sm h-3 w-6" />
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="skeleton rounded-lg h-8 w-8" />
                  <div className="skeleton rounded-lg h-8 w-8" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Empty state ──────────────────────────────────────────────

  if (history.length === 0) {
    return (
      <div className="container mx-auto px-6 max-w-4xl mt-6 pb-20">
        <h1 className="text-2xl font-heading font-black mb-6">
          Processing <span className="text-racing-500">History</span>
        </h1>
        <div className="glass-card rounded-2xl p-16 text-center flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
            <ImageIcon size={28} className="text-white/20" />
          </div>
          <div>
            <p className="text-white/50 text-sm font-heading font-bold mb-1">No sessions yet</p>
            <p className="text-white/25 text-xs leading-relaxed max-w-xs mx-auto">
              Sort some car photos by colour and your processing history will appear here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── History list ─────────────────────────────────────────────

  return (
    <div className="container mx-auto px-6 max-w-4xl mt-6 pb-20">
      <h1 className="text-2xl font-heading font-black mb-6">
        Processing <span className="text-racing-500">History</span>
      </h1>

      {/* Active session banner */}
      {activeSession && (
        <div className="glass-card rounded-2xl p-4 mb-6 border border-racing-600/20 animate-fade-up">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${activeSession.status === 'paused' ? 'bg-yellow-500/10' : 'bg-racing-600/10'}`}>
                {activeSession.status === 'paused'
                  ? <span className="w-3 h-3 rounded-sm bg-yellow-400" />
                  : <SpinnerIcon size={18} className="text-racing-500" />
                }
              </div>
              <div className="min-w-0">
                <div className="text-sm font-heading font-bold flex items-center gap-2">
                  {activeSession.status === 'paused' ? 'Sorting Paused' : 'Sorting in Progress'}
                  <span className="text-xs text-white/30 font-normal">{activeSession.processed} / {activeSession.total}</span>
                </div>
                <p className="text-[11px] text-white/30 truncate">{activeSession.currentFile}</p>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mt-1.5 max-w-xs">
                  <div
                    className="h-full bg-gradient-to-r from-racing-600 to-racing-500 rounded-full transition-all duration-500"
                    style={{ width: `${activeSession.total > 0 ? Math.round((activeSession.processed / activeSession.total) * 100) : 0}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={handlePauseResume}
                className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                  activeSession.status === 'paused'
                    ? 'btn-racing'
                    : 'btn-carbon border border-white/10'
                }`}
              >
                {activeSession.status === 'paused' ? <><FlagIcon size={12} /> Resume</> : <><span className="w-2.5 h-2.5 rounded-sm bg-white/50" /> Pause</>}
              </button>
              <button
                onClick={handleCancel}
                className="px-3 py-2 rounded-lg text-xs text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <CloseIcon size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-5">
        {groups.map(group => (
          <section key={group.label}>
            {/* Date group header */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[11px] font-heading font-bold text-white/30 uppercase tracking-widest shrink-0">
                {group.label}
              </span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>

            <div className="space-y-2">
              {group.items.map(entry => {
                const colors = parseColorCounts(entry.color_counts);
                const colorKeys = Object.keys(colors);
                const date = new Date(entry.created_at);
                const accent = STATUS_ACCENT[entry.status] || STATUS_ACCENT.processing;
                const badge = STATUS_BADGE[entry.status] || STATUS_BADGE.processing;

                return (
                  <div
                    key={entry.id}
                    className="glass-card rounded-xl overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-black/20"
                    style={{ transform: 'translateY(0)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; }}
                  >
                    <div className="flex">
                      {/* Left accent stripe */}
                      <div className="w-[2px] shrink-0" style={{ background: accent }} />

                      <div className="flex items-center gap-4 p-4 flex-1 min-w-0">
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-heading font-bold text-white/80">
                              {entry.image_count} image{entry.image_count !== 1 ? 's' : ''}
                            </span>
                            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-bold ${badge.bg} ${badge.text}`}>
                              <StatusBadgeIcon status={entry.status} />
                              {entry.status}
                            </span>
                          </div>

                          <p className="text-[11px] text-white/30">
                            {date.toLocaleDateString()} at {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {entry.duration_seconds != null && ` \u2014 ${entry.duration_seconds.toFixed(1)}s`}
                          </p>

                          {/* Colour swatches */}
                          {colorKeys.length > 0 && (
                            <div className="flex gap-1.5 mt-2">
                              {colorKeys.slice(0, 8).map(color => {
                                const hex = SWATCH[color] || '#666';
                                return (
                                  <div
                                    key={color}
                                    className="group/swatch flex items-center gap-0.5"
                                    title={`${color}: ${colors[color]}`}
                                  >
                                    <div
                                      className="w-3 h-3 rounded-[3px] border border-white/10 transition-shadow duration-200 group-hover/swatch:shadow-[0_0_6px_var(--sw)]"
                                      style={{ background: hex, '--sw': `${hex}88` } as React.CSSProperties}
                                    />
                                    <span className="text-[9px] text-white/25 tabular-nums">{colors[color]}</span>
                                  </div>
                                );
                              })}
                              {colorKeys.length > 8 && (
                                <span className="text-[9px] text-white/15 self-center">+{colorKeys.length - 8}</span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-1.5 shrink-0">
                          {entry.output_path && (
                            <button
                              onClick={() => handleOpenFolder(entry.output_path)}
                              className="tooltip btn-carbon w-8 h-8 rounded-lg flex items-center justify-center"
                              data-tooltip="Open folder"
                            >
                              <FolderIcon size={14} className="text-white/60" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(entry.id)}
                            className="tooltip w-8 h-8 rounded-lg flex items-center justify-center text-white/20 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all"
                            data-tooltip="Delete"
                          >
                            <TrashIcon size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
