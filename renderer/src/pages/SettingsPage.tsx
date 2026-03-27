import { useState, useEffect } from 'react';
import { useWorker } from '../hooks/useWorker';
import { useToast } from '../components/Toast';
import WatermarkEditor from '../components/WatermarkEditor';
import {
  KeyIcon,
  FolderIcon,
  BrainIcon,
  InfoIcon,
  ExternalIcon,
  CopyIcon,
  StatusDot,
  CheckIcon,
} from '../components/Icons';

interface Props {
  license: LicenseState;
  onRefresh: () => Promise<void>;
}

// ─── Helpers ────────────────────────────────────────────────────

function maskKey(key: string): string {
  if (key.length <= 8) return key;
  return key.slice(0, 4) + '\u2022'.repeat(Math.min(key.length - 8, 20)) + key.slice(-4);
}

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      className="tooltip w-6 h-6 rounded flex items-center justify-center text-white/25 hover:text-white/60 hover:bg-white/5 transition-all"
      data-tooltip={copied ? 'Copied!' : 'Copy'}
    >
      {copied ? <CheckIcon size={12} className="text-green-400" /> : <CopyIcon size={12} />}
    </button>
  );
}

// ─── Section header ─────────────────────────────────────────────

function SectionHeader({ icon, label, tint }: { icon: React.ReactNode; label: string; tint: string }) {
  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 -mx-6 -mt-6 mb-5 rounded-t-2xl"
      style={{ background: `linear-gradient(135deg, ${tint}08, ${tint}03)` }}
    >
      <span style={{ color: tint }}>{icon}</span>
      <h2 className="font-heading font-bold text-sm text-white/70">{label}</h2>
    </div>
  );
}

// ─── Tech badge ─────────────────────────────────────────────────

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-mono text-white/40 bg-white/[0.04] border border-white/[0.06]">
      {children}
    </span>
  );
}

// ─── Main component ─────────────────────────────────────────────

export default function SettingsPage({ license, onRefresh }: Props) {
  const { health, port, ready } = useWorker();
  const { showToast } = useToast();
  const [version, setVersion] = useState('');
  const [userDataPath, setUserDataPath] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [claudeStatus, setClaudeStatus] = useState<ClaudeKeyStatus | null>(null);
  const [customKey, setCustomKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keySaving, setKeySaving] = useState(false);
  const [orKey, setOrKey] = useState('');
  const [orStatus, setOrStatus] = useState<{ hasKey: boolean } | null>(null);
  const [showOrInput, setShowOrInput] = useState(false);
  const [orSaving, setOrSaving] = useState(false);
  const [sortByType, setSortByType] = useState(false);
  const [detectFeatures, setDetectFeatures] = useState(false);
  const [orTesting, setOrTesting] = useState(false);

  useEffect(() => {
    window.electronAPI.getVersion().then(setVersion);
    window.electronAPI.getUserDataPath().then(setUserDataPath);
    window.electronAPI.getSetting('output_folder').then(v => setOutputFolder(v || ''));
    window.electronAPI.getClaudeKeyStatus().then(setClaudeStatus);
    window.electronAPI.getOpenRouterKeyStatus().then(setOrStatus);
    window.electronAPI.getSetting('sort_by_type').then(v => setSortByType(v === 'true'));
    window.electronAPI.getSetting('detect_features').then(v => setDetectFeatures(v === 'true'));
  }, []);

  const handleSelectOutput = async () => {
    const path = await window.electronAPI.selectOutputFolder();
    if (path) {
      setOutputFolder(path);
      await window.electronAPI.setSetting('output_folder', path);
    }
  };

  const handleOpenDataFolder = () => {
    if (userDataPath) window.electronAPI.openInExplorer(userDataPath);
  };

  const tierColors: Record<string, string> = {
    trial: 'border-yellow-500/30 text-yellow-400',
    hobbyist: 'border-blue-500/30 text-blue-400',
    pro: 'border-racing-500/30 text-racing-400',
    unlimited: 'border-purple-500/30 text-purple-400',
  };

  const trialDaysLeft = license.expiresAt ? daysUntil(license.expiresAt) : null;
  const trialTotalDays = 14; // default trial length

  return (
    <div className="container mx-auto px-6 max-w-3xl mt-6 pb-20 space-y-6">
      <h1 className="text-2xl font-heading font-black">
        <span className="text-racing-500">Settings</span>
      </h1>

      {/* ─── License ─────────────────────────────────────────── */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <SectionHeader icon={<KeyIcon size={15} />} label="License" tint="#eab308" />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-[10px] text-white/30 uppercase tracking-wider block mb-1">Tier</span>
            <span className={`inline-block px-3 py-1 rounded-lg text-sm font-bold border ${tierColors[license.tier || ''] || tierColors.trial}`}>
              {license.tierName || 'Trial'}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-white/30 uppercase tracking-wider block mb-1">Daily Limit</span>
            <span className="text-sm text-white/70">
              {license.isUnlimited ? 'Unlimited' : `${license.dailyLimit?.toLocaleString()} images/day`}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-white/30 uppercase tracking-wider block mb-1">Today's Usage</span>
            <span className="text-sm text-white/70">
              {license.todayUsage?.toLocaleString() || 0} images
              {!license.isUnlimited && license.remaining !== undefined && (
                <span className="text-white/30 ml-1">({license.remaining.toLocaleString()} remaining)</span>
              )}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-white/30 uppercase tracking-wider block mb-1">Status</span>
            <span className="flex items-center gap-2 text-sm">
              <StatusDot
                color={license.offlineMode ? 'yellow' : 'green'}
                pulse={!license.offlineMode}
              />
              <span className={license.offlineMode ? 'text-yellow-400' : 'text-green-400'}>
                {license.offlineMode ? `Offline (${license.graceDaysLeft}d grace left)` : 'Validated'}
              </span>
            </span>
          </div>
        </div>

        {/* License key (masked with copy) */}
        {license.licenseKey && (
          <div>
            <span className="text-[10px] text-white/30 uppercase tracking-wider block mb-1">License Key</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-white/40 font-mono">{maskKey(license.licenseKey)}</span>
              <CopyButton value={license.licenseKey} />
            </div>
          </div>
        )}

        {/* Trial countdown with progress bar */}
        {license.expiresAt && trialDaysLeft !== null && (
          <div className="bg-amber-500/[0.04] border border-amber-500/10 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-amber-400 font-heading font-bold">Trial Period</span>
              <span className="text-[11px] text-amber-400/70">
                {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.max(4, (trialDaysLeft / trialTotalDays) * 100)}%`,
                  background: trialDaysLeft <= 3
                    ? 'linear-gradient(90deg, #ef4444, #f97316)'
                    : 'linear-gradient(90deg, #eab308, #f59e0b)',
                }}
              />
            </div>
            <p className="text-[10px] text-white/30">
              Expires {new Date(license.expiresAt).toLocaleDateString()}
            </p>
          </div>
        )}
      </div>

      {/* ─── Output ──────────────────────────────────────────── */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <SectionHeader icon={<FolderIcon size={15} />} label="Output" tint="#3b82f6" />

        <div>
          <span className="text-[10px] text-white/30 uppercase tracking-wider block mb-2">Default Output Folder</span>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 min-w-0">
              <FolderIcon size={13} className="text-white/25 shrink-0" />
              <span className="text-xs text-white/50 font-mono truncate">
                {outputFolder || '(Default: App Data)'}
              </span>
            </div>
            <button onClick={handleSelectOutput} className="btn-carbon px-4 py-2 rounded-lg text-xs shrink-0">
              Browse
            </button>
          </div>
        </div>

        <div>
          <span className="text-[10px] text-white/30 uppercase tracking-wider block mb-2">App Data Location</span>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 min-w-0">
              <FolderIcon size={13} className="text-white/25 shrink-0" />
              <span className="text-xs text-white/50 font-mono truncate">{userDataPath}</span>
            </div>
            <button onClick={handleOpenDataFolder} className="btn-carbon px-4 py-2 rounded-lg text-xs shrink-0 flex items-center gap-1.5">
              <ExternalIcon size={12} />
              Open
            </button>
          </div>
        </div>
      </div>

      {/* ─── AI Engine ───────────────────────────────────────── */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <SectionHeader icon={<BrainIcon size={15} />} label="AI Engine" tint="#a855f7" />

        {/* Engine status row */}
        <div className="flex items-center justify-between bg-white/[0.02] border border-white/[0.05] rounded-lg px-4 py-3">
          <div className="flex items-center gap-2.5">
            <StatusDot color={ready ? 'green' : 'yellow'} pulse={ready} />
            <span className={`text-sm font-heading font-bold ${ready ? 'text-green-400' : 'text-yellow-400'}`}>
              {ready ? 'Running' : 'Starting\u2026'}
            </span>
          </div>
          <span className="text-xs text-white/30 font-mono">port {port}</span>
        </div>

        {/* Model rows */}
        {health && (
          <div className="space-y-2">
            <div className="flex items-center justify-between py-2 px-1">
              <div className="flex items-center gap-2.5">
                <StatusDot
                  color={health.ssdMobilenet === 'ready' ? 'green' : health.ssdMobilenet === 'error' ? 'red' : 'yellow'}
                  pulse={health.ssdMobilenet === 'ready'}
                />
                <div>
                  <span className="text-xs text-white/70 font-heading font-bold block">SSD-MobileNet</span>
                  <span className="text-[10px] text-white/30">Object detection</span>
                </div>
              </div>
              <span className="text-[11px] text-white/40 capitalize">{health.ssdMobilenet || 'Loading\u2026'}</span>
            </div>

            <div className="h-px bg-white/[0.04]" />

            <div className="flex items-center justify-between py-2 px-1">
              <div className="flex items-center gap-2.5">
                <StatusDot
                  color={health.segformer === 'ready' ? 'green' : health.segformer === 'error' ? 'red' : 'yellow'}
                  pulse={health.segformer === 'ready'}
                />
                <div>
                  <span className="text-xs text-white/70 font-heading font-bold block">SegFormer</span>
                  <span className="text-[10px] text-white/30">Background segmentation</span>
                </div>
              </div>
              <span className="text-[11px] text-white/40 capitalize">{health.segformer || 'Loading\u2026'}</span>
            </div>

            {/* ─── OpenRouter API Key (primary) ─── */}
            <div className="h-px bg-white/[0.04]" />

            <div className="py-2 px-1 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <StatusDot
                    color={orStatus?.hasKey ? 'green' : 'yellow'}
                    pulse={!!orStatus?.hasKey}
                  />
                  <div>
                    <span className="text-xs text-white/70 font-heading font-bold block">OpenRouter</span>
                    <span className="text-[10px] text-white/30">
                      {orStatus?.hasKey ? 'Active — Gemini Flash via OpenRouter' : 'Add key for high-speed AI classification'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setShowOrInput(!showOrInput)}
                  className="text-[11px] text-racing-400 hover:text-racing-300 transition-colors"
                >
                  {showOrInput ? 'Hide' : orStatus?.hasKey ? 'Change key' : 'Configure'}
                </button>
              </div>

              {showOrInput && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="sk-or-... (OpenRouter API key)"
                      value={orKey}
                      onChange={e => setOrKey(e.target.value)}
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/60 font-mono placeholder:text-white/20 focus:outline-none focus:border-racing-500/50"
                    />
                    <button
                      onClick={async () => {
                        setOrSaving(true);
                        await window.electronAPI.setOpenRouterKey(orKey);
                        const status = await window.electronAPI.getOpenRouterKeyStatus();
                        setOrStatus(status);
                        setOrSaving(false);
                        setShowOrInput(false);
                        setOrKey('');
                        showToast('OpenRouter key saved — restart app to activate', 'success');
                      }}
                      disabled={orSaving || !orKey.trim()}
                      className="btn-racing px-4 py-2 rounded-lg text-xs shrink-0"
                    >
                      {orSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={async () => {
                        const keyToTest = orKey.trim() || undefined;
                        setOrTesting(true);
                        try {
                          const testKey = keyToTest || await window.electronAPI.getSetting('openrouter_raw_key');
                          if (!testKey && !orStatus?.hasKey) {
                            showToast('Enter an API key first', 'error');
                            setOrTesting(false);
                            return;
                          }
                          const port = await window.electronAPI.getWorkerPort();
                          const res = await fetch(`http://127.0.0.1:${port}/test-openrouter`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            ...(keyToTest ? { body: JSON.stringify({ key: keyToTest }) } : {}),
                          });
                          const data = await res.json();
                          if (data.success) {
                            showToast(`Connected! Model: ${data.model}`, 'success');
                          } else {
                            showToast(`Connection failed: ${data.error}`, 'error');
                          }
                        } catch (err: any) {
                          showToast(`Test failed: ${err.message}`, 'error');
                        }
                        setOrTesting(false);
                      }}
                      disabled={orTesting}
                      className="text-[11px] text-cyan-400 hover:text-cyan-300 transition-colors"
                    >
                      {orTesting ? 'Testing...' : '⚡ Test Connection'}
                    </button>
                    {orStatus?.hasKey && (
                      <button
                        onClick={async () => {
                          await window.electronAPI.setOpenRouterKey('');
                          const status = await window.electronAPI.getOpenRouterKeyStatus();
                          setOrStatus(status);
                          showToast('OpenRouter key removed', 'info');
                        }}
                        className="text-[10px] text-white/30 hover:text-red-400 transition-colors"
                      >
                        Remove key
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Claude API Key (fallback) */}
              <div className="h-px bg-white/[0.04]" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <StatusDot
                    color={claudeStatus?.hasKey ? 'green' : claudeStatus?.eligible ? 'yellow' : 'red'}
                    pulse={!!claudeStatus?.hasKey}
                  />
                  <div>
                    <span className="text-xs text-white/70 font-heading font-bold block">Claude Vision</span>
                    <span className="text-[10px] text-white/30">
                      {claudeStatus?.hasKey ? 'Active — fallback' : 'Platform key (auto-configured)'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Sort Options ─────────────────────────────────── */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-heading font-bold flex items-center gap-2">
          <span className="text-lg">🚗</span> Sort Options
        </h3>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-white/70 font-heading font-bold block">Sort by Vehicle Type</span>
            <span className="text-[10px] text-white/30">Separate cars, bikes, people into subfolders (cars/white/, bikes/red/)</span>
          </div>
          <button
            onClick={async () => {
              const current = await window.electronAPI.getSetting('sort_by_type');
              const next = current === 'true' ? 'false' : 'true';
              await window.electronAPI.setSetting('sort_by_type', next);
              setSortByType(next === 'true');
            }}
            className={`relative w-11 h-6 rounded-full transition-colors ${sortByType ? 'bg-racing-500' : 'bg-white/10'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${sortByType ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-white/70 font-heading font-bold block">Feature Shot Detection</span>
            <span className="text-[10px] text-white/30">Tag burnouts, wheelstands, flames, drifts → copies to _highlights/ folder</span>
          </div>
          <button
            onClick={async () => {
              const current = await window.electronAPI.getSetting('detect_features');
              const next = current === 'true' ? 'false' : 'true';
              await window.electronAPI.setSetting('detect_features', next);
              setDetectFeatures(next === 'true');
            }}
            className={`relative w-11 h-6 rounded-full transition-colors ${detectFeatures ? 'bg-racing-500' : 'bg-white/10'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${detectFeatures ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      </div>

      {/* ─── Watermark Editor ─────────────────────────────────── */}
      <WatermarkEditor />

      {/* ─── About ───────────────────────────────────────────── */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <SectionHeader icon={<InfoIcon size={15} />} label="About" tint="#6366f1" />

        <div className="flex items-center gap-2">
          <span className="text-sm text-white/60 font-heading font-bold">AutoHue</span>
          <span className="text-xs text-white/30 font-mono">v{version || '1.0.0'}</span>
          <CopyButton value={`AutoHue v${version || '1.0.0'}`} />
        </div>

        <p className="text-xs text-white/40 leading-relaxed">
          AI-powered car photo colour sorter. All processing happens locally &mdash; your images never leave this machine.
        </p>

        <div className="flex flex-wrap gap-1.5">
          <Badge>Electron</Badge>
          <Badge>ONNX Runtime</Badge>
          <Badge>CIE LAB</Badge>
          <Badge>DE2000</Badge>
          <Badge>SSD-MobileNet</Badge>
          <Badge>SegFormer</Badge>
        </div>
      </div>
    </div>
  );
}
