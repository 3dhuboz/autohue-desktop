import { useState, useRef, useCallback, useEffect } from 'react';
import { useLicense } from '../hooks/useLicense';
import { useWorker } from '../hooks/useWorker';
import { useToast } from '../components/Toast';
import TachoGauge from '../components/TachoGauge';
import WatermarkEditor from '../components/WatermarkEditor';
import AiDisclaimer from '../components/AiDisclaimer';
import SortAnimation from '../components/SortAnimation';
import {
  CarIcon,
  FolderIcon,
  ImageIcon,
  UploadIcon,
  DownloadIcon,
  CrosshairIcon,
  PaletteIcon,
  BrainIcon,
  FlagIcon,
  ChartIcon,
  TerminalIcon,
  RefreshIcon,
  CheckIcon,
  AlertIcon,
  CloseIcon,
  SpinnerIcon,
  ExternalIcon,
  TrashIcon,
} from '../components/Icons';

// Manual sorting estimate: photographer opens each large RAW/JPG, waits for it to load,
// examines the car through smoke/dust, decides color category, navigates to correct folder,
// drags/moves file, returns to source folder, repeats. For motorsport photos with smoke
// and multiple cars, this takes 60-90s per image including decision fatigue.
const MANUAL_SECONDS_PER_IMAGE = 75;
const PHOTOGRAPHER_HOURLY_RATE = 85; // USD — professional motorsport photography rate

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const COLOR_INFO: Record<string, { label: string; swatch: string; glow: string }> = {
  'red':         { label: 'Red',         swatch: '#ef4444', glow: 'rgba(239,68,68,0.3)' },
  'blue':        { label: 'Blue',        swatch: '#3b82f6', glow: 'rgba(59,130,246,0.3)' },
  'green':       { label: 'Green',       swatch: '#22c55e', glow: 'rgba(34,197,94,0.3)' },
  'yellow':      { label: 'Yellow',      swatch: '#eab308', glow: 'rgba(234,179,8,0.3)' },
  'orange':      { label: 'Orange',      swatch: '#f97316', glow: 'rgba(249,115,22,0.3)' },
  'purple':      { label: 'Purple',      swatch: '#a855f7', glow: 'rgba(168,85,247,0.3)' },
  'pink':        { label: 'Pink',        swatch: '#ec4899', glow: 'rgba(236,72,153,0.3)' },
  'brown':       { label: 'Brown',       swatch: '#a16207', glow: 'rgba(161,98,7,0.3)' },
  'black':       { label: 'Black',       swatch: '#334155', glow: 'rgba(51,65,85,0.3)' },
  'white':       { label: 'White',       swatch: '#ffffff', glow: 'rgba(255,255,255,0.3)' },
  'silver-grey': { label: 'Silver/Grey', swatch: '#94a3b8', glow: 'rgba(148,163,184,0.3)' },
  'unknown':     { label: 'Unknown',     swatch: '#f87171', glow: 'rgba(248,113,113,0.3)' },
  'please-double-check': { label: 'Needs Review', swatch: '#f59e0b', glow: 'rgba(245,158,11,0.3)' },
};

type Phase = 'upload' | 'processing' | 'complete';

interface ProcessingStats {
  processed: number;
  total: number;
  currentFile: string;
  startTime: number;
  imagesPerSecond: number;
  avgConfidence: number;
  timeSavedSeconds: number;
  results: Array<{ file: string; color: string; confidence: number; thumb?: string | null }>;
  colorCounts: Record<string, number>;
}

export default function SortPage() {
  const { license, checkQuota, recordUsage, refresh: refreshLicense } = useLicense();
  const { workerUrl, ready: workerReady, health } = useWorker();
  const { showToast } = useToast();

  // Listen for download completion toast
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onDownloadComplete) return;
    api.onDownloadComplete((data: { filename: string; path: string }) => {
      showToast(`Saved: ${data.filename}`, 'success');
    });
    api.onDownloadCancelled?.(() => {
      showToast('Download cancelled', 'info');
    });
  }, [showToast]);

  const [phase, setPhase] = useState<Phase>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [batchName, setBatchName] = useState('');
  const [error, setError] = useState('');
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ percent: number; loaded: number; total: number; speed: number } | null>(null);
  const [expandedColor, setExpandedColor] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [extractionPhase, setExtractionPhase] = useState<{ active: boolean; extracted: number; total: number; currentFile: string }>({ active: false, extracted: 0, total: 0, currentFile: '' });
  const [stats, setStats] = useState<ProcessingStats>({
    processed: 0, total: 0, currentFile: '', startTime: 0,
    imagesPerSecond: 0, avgConfidence: 0, timeSavedSeconds: 0,
    results: [], colorCounts: {},
  });
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cursorRef = useRef(0);
  const completionRecorded = useRef(false);
  const lastRecordedCount = useRef(0);
  const speedHistory = useRef<number[]>([]);
  const confHistory = useRef<number[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Reconnect to active session if we navigated away and came back
    const savedSession = localStorage.getItem('autohue_active_session');
    if (savedSession && workerUrl) {
      const { sid, startTime } = JSON.parse(savedSession);
      fetch(`${workerUrl}/status/${sid}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data || !mountedRef.current) return;
          if (data.status === 'processing' || data.status === 'paused' || data.status === 'extracting') {
            setSessionId(sid);
            setPaused(data.status === 'paused');
            setStats(prev => ({ ...prev, total: data.total, processed: data.processed, startTime: startTime || Date.now(), currentFile: data.current_file || '' }));
            setPhase('processing');
            cursorRef.current = data.processed;
            startPolling(sid);
          } else if (data.status === 'completed') {
            setSessionId(sid);
            setStats(prev => ({ ...prev, total: data.total, processed: data.processed, startTime: startTime || Date.now() }));
            setPhase('complete');
            localStorage.removeItem('autohue_active_session');
          } else {
            localStorage.removeItem('autohue_active_session');
          }
        })
        .catch(() => localStorage.removeItem('autohue_active_session'));
    }

    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerUrl]);

  const handleFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter(f =>
      f.type.startsWith('image/') || /\.(zip|rar)$/i.test(f.name)
    );
    setFiles(prev => [...prev, ...arr]);
    setFolderPath(null);
  }, []);

  const handleFolderPick = async () => {
    const path = await window.electronAPI.openFolder();
    if (path) {
      setFolderPath(path);
      setFiles([]);
    }
  };

  const handleFilePick = async () => {
    const paths = await window.electronAPI.openFiles();
    if (paths) {
      fileInputRef.current?.click();
    }
  };

  const getImageCount = () => folderPath ? -1 : files.length;

  const startProcessing = async () => {
    if (!folderPath && files.length === 0) return;
    setError('');
    setUploading(true);

    // Check quota for ALL paths (files, folders, ZIPs)
    const estimatedCount = files.length || 100; // For folders/ZIPs, estimate — worker enforces the real limit
    const quota = await checkQuota(Math.min(estimatedCount, 1)); // Check if ANY processing is allowed
    if (!quota.allowed) {
      setError(
        quota.reason === 'daily_limit'
          ? `Daily limit reached (${quota.remaining} remaining). Upgrade for more.`
          : quota.reason === 'grace_expired'
          ? 'License validation required. Connect to the internet and restart.'
          : quota.reason === 'expired'
          ? 'Your trial has expired. Activate a license to continue.'
          : 'License issue. Check Settings.'
      );
      setUploading(false);
      return;
    }

    try {
      let data: { session_id: string; total_images?: number };

      // For archives (ZIP/RAR) or folders, use sort-local with the native file path
      // This avoids copying GBs of data through HTTP — the worker reads directly from disk
      const archiveFile = !folderPath && files.length === 1 && /\.(zip|rar)$/i.test(files[0].name) ? files[0] : null;
      let localPath = folderPath;
      if (!localPath && archiveFile) {
        try {
          localPath = (window as any).electronAPI?.getPathForFile?.(archiveFile) || (archiveFile as any).path || null;
        } catch { localPath = null; }
      }

      // Pass the remaining daily quota so the worker stops at the limit
      const maxImages = quota.remaining === -1 ? undefined : quota.remaining;

      if (localPath) {
        const res = await fetch(`${workerUrl}/sort-local`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputPath: localPath, maxImages }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || 'Failed to start processing');
        }
        data = await res.json();
      } else {
        // Multiple loose image files — upload via HTTP with progress
        const formData = new FormData();
        files.forEach(f => formData.append('files', f));
        setUploadProgress({ percent: 0, loaded: 0, total: 0, speed: 0 });
        data = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const uploadStart = Date.now();
          xhr.open('POST', `${workerUrl}/upload`);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const elapsed = (Date.now() - uploadStart) / 1000;
              const speed = elapsed > 0 ? e.loaded / elapsed : 0;
              setUploadProgress({ percent: Math.round((e.loaded / e.total) * 100), loaded: e.loaded, total: e.total, speed });
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try { resolve(JSON.parse(xhr.responseText)); }
              catch { reject(new Error('Invalid response from worker')); }
            } else {
              try { const err = JSON.parse(xhr.responseText); reject(new Error(err.error || 'Upload failed')); }
              catch { reject(new Error('Worker not available. Check Settings.')); }
            }
          };
          xhr.onerror = () => reject(new Error('Upload failed — is the worker running?'));
          xhr.send(formData);
        });
        setUploadProgress(null);
      }

      setSessionId(data.session_id);
      cursorRef.current = 0;
      completionRecorded.current = false;
      lastRecordedCount.current = 0;
      speedHistory.current = [];
      confHistory.current = [];
      setStats({
        processed: 0, total: 0, currentFile: 'Starting...', startTime: Date.now(),
        imagesPerSecond: 0, avgConfidence: 0, timeSavedSeconds: 0,
        results: [], colorCounts: {},
      });
      setPhase('processing');
      setUploading(false);
      localStorage.setItem('autohue_active_session', JSON.stringify({ sid: data.session_id, startTime: Date.now() }));
      startPolling(data.session_id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Processing failed.');
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const startPolling = (sid: string) => {
    pollRef.current = setInterval(async () => {
      if (!mountedRef.current) {
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      try {
        const res = await fetch(`${workerUrl}/status/${sid}?since=${cursorRef.current}`);
        if (res.status === 404) return;
        const data = await res.json();

        if (data.new_results?.length) {
          cursorRef.current += data.new_results.length;
          setStats(prev => {
            const confMap: Record<string, number> = { high: 0.95, medium: 0.75, low: 0.5, none: 0.3 };
            const newResults = [...prev.results, ...data.new_results.map((r: { file: string; color: string; confidence: string | number; thumb?: string | null }) => ({
              file: r.file, color: r.color,
              confidence: typeof r.confidence === 'number' ? r.confidence : (confMap[r.confidence] ?? 0.5),
              thumb: r.thumb || null,
            }))];
            const elapsed = (Date.now() - prev.startTime) / 1000;
            const processed = data.processed || newResults.length;
            const instantIps = elapsed > 0 ? processed / elapsed : 0;

            speedHistory.current.push(instantIps);
            if (speedHistory.current.length > 5) speedHistory.current.shift();
            const smoothIps = speedHistory.current.reduce((a, b) => a + b, 0) / speedHistory.current.length;

            const batchConf = data.new_results.reduce((sum: number, r: { confidence: string | number }) => {
              const c = typeof r.confidence === 'number' ? r.confidence : (confMap[r.confidence] ?? 0.5);
              return sum + c;
            }, 0) / data.new_results.length;
            confHistory.current.push(batchConf);
            if (confHistory.current.length > 5) confHistory.current.shift();
            const smoothConf = confHistory.current.reduce((a, b) => a + b, 0) / confHistory.current.length;

            const manualTime = processed * MANUAL_SECONDS_PER_IMAGE;
            const aiTime = elapsed;
            const counts: Record<string, number> = {};
            newResults.forEach((r: { color: string }) => { counts[r.color] = (counts[r.color] || 0) + 1; });

            return {
              ...prev, processed,
              total: data.total || prev.total,
              currentFile: data.current_file || prev.currentFile,
              imagesPerSecond: smoothIps,
              avgConfidence: smoothConf,
              timeSavedSeconds: Math.max(0, manualTime - aiTime),
              results: newResults,
              colorCounts: counts,
            };
          });
        }

        // Incremental usage recording — every 20 images, update quota counter
        if (processed > 0 && processed - lastRecordedCount.current >= 20) {
          lastRecordedCount.current = processed;
          recordUsage(sid, processed, data.color_counts || {}).then(() => refreshLicense()).catch(() => {});
        }

        if (data.status === 'extracting') {
          setExtractionPhase({
            active: true,
            extracted: data.extracted || data.processed || 0,
            total: data.total || 0,
            currentFile: data.current_file || 'Extracting...',
          });
          setStats(prev => ({
            ...prev,
            total: data.total || 0,
            processed: data.processed || 0,
            currentFile: data.current_file || 'Extracting archive...',
          }));
        } else if (data.status === 'processing' && extractionPhase.active) {
          // Transition from extraction to classification
          setExtractionPhase(prev => ({ ...prev, active: false }));
        }

        if (data.status === 'paused') {
          setPaused(true);
        } else if (data.status === 'processing') {
          setPaused(false);
          // Update total when transitioning from extracting to processing
          if (data.total && data.total > 0) {
            setStats(prev => ({ ...prev, total: data.total }));
          }
        }

        if (data.status === 'completed' || data.status === 'cancelled') {
          if (pollRef.current) clearInterval(pollRef.current);
          localStorage.removeItem('autohue_active_session');
          setPhase('complete');
          if (!completionRecorded.current) {
            completionRecorded.current = true;
            const processed = data.processed || 0;
            const colorCounts = data.color_counts || {};
            const colors = Object.keys(colorCounts).length;
            recordUsage(sid, processed, colorCounts).then(() => refreshLicense()).catch(console.error);

            // Completion toast with stats
            if (data.status === 'completed' && processed > 0) {
              const elapsed = Math.round((Date.now() - (stats.startTime || Date.now())) / 1000);
              const mins = Math.floor(elapsed / 60);
              const secs = elapsed % 60;
              const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
              const manualMins = Math.ceil(processed * 15 / 60);
              showToast(`Done! ${processed} images sorted into ${colors} colors in ${timeStr} (saved ~${manualMins} min vs manual)`, 'success');
            } else if (data.status === 'cancelled') {
              showToast(`Cancelled — ${processed} images already sorted`, 'info');
            }
            // Save batch name if provided
            if (batchName.trim()) {
              window.electronAPI.renameHistory?.(0, batchName.trim()).catch(() => {});
              // Also try by looking up the history entry
              window.electronAPI.getHistory?.().then(hist => {
                const entry = hist.find((h: HistoryEntry) => h.session_id === sid);
                if (entry) window.electronAPI.renameHistory?.(entry.id, batchName.trim());
              }).catch(() => {});
            }
            // Auto-open output folder on completion (not cancellation)
            if (data.status === 'completed') {
              window.electronAPI.getUserDataPath?.().then(udp => {
                window.electronAPI.openInExplorer?.(`${udp}/worker-data/output/${sid}`);
              }).catch(() => {});
            }
          }
        }
      } catch (e) {
        console.error('Polling error:', e);
      }
    }, 1500);
  };

  const reassignImage = async (filename: string, fromFolder: string, toFolder: string) => {
    try {
      const res = await fetch(`${workerUrl}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, filename, fromFolder, toFolder }),
      });
      if (!res.ok) return;
      setStats(prev => {
        const updatedResults = prev.results.map(r =>
          r.file === filename && r.color === fromFolder ? { ...r, color: toFolder } : r
        );
        const counts: Record<string, number> = {};
        updatedResults.forEach(r => { counts[r.color] = (counts[r.color] || 0) + 1; });
        return { ...prev, results: updatedResults, colorCounts: counts };
      });
    } catch (e) { console.error('Reassign failed:', e); }
  };

  const handleOpenOutput = async () => {
    try {
      const userDataPath = await window.electronAPI.getUserDataPath();
      await window.electronAPI.openInExplorer(
        `${userDataPath}/worker-data/output/${sessionId}`
      );
    } catch {
      window.open(`${workerUrl}/download/${sessionId}`, '_blank');
    }
  };

  const progressPct = stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 0;
  const speedPct = Math.min((stats.imagesPerSecond / 10) * 100, 100);
  const confPct = stats.avgConfidence * 100;
  const timeSavedFormatted = formatTimeSaved(stats.timeSavedSeconds);
  const remaining = stats.total - stats.processed;
  const etaSeconds = stats.imagesPerSecond > 0 ? remaining / stats.imagesPerSecond : 0;
  const etaFormatted = etaSeconds > 60
    ? `${Math.floor(etaSeconds / 60)}m ${Math.round(etaSeconds % 60)}s`
    : etaSeconds > 0 ? `${Math.round(etaSeconds)}s` : '--';
  const etaPct = stats.total > 0 ? Math.min((1 - remaining / stats.total) * 100, 100) : 0;

  // Cost saved calculation — based on photographer hourly rate
  const costSaved = (stats.timeSavedSeconds / 3600) * PHOTOGRAPHER_HOURLY_RATE;
  const costSavedFormatted = costSaved >= 1 ? `$${costSaved.toFixed(0)}` : costSaved > 0 ? `$${costSaved.toFixed(2)}` : '$0';
  // Project total cost saved for the full batch
  const projectedTotalCostSaved = stats.total > 0 && stats.processed > 0
    ? ((stats.total * MANUAL_SECONDS_PER_IMAGE) / 3600) * PHOTOGRAPHER_HOURLY_RATE
    : 0;

  /* ── Pipeline step config (hardcoded Tailwind classes for JIT) ── */
  const pipelineSteps = [
    { icon: <UploadIcon size={18} />, label: 'Upload', sub: '', active: stats.processed > 0, done: stats.processed > 0, bgActive: 'bg-green-500/15', borderActive: 'border-green-500/30', textActive: 'text-green-400' },
    { icon: <CrosshairIcon size={18} />, label: 'Detect', sub: 'ONNX', active: stats.processed > 0, done: false, bgActive: 'bg-blue-500/15', borderActive: 'border-blue-500/30', textActive: 'text-blue-400' },
    { icon: <PaletteIcon size={18} />, label: 'Analyze', sub: 'CIE LAB', active: stats.processed > 0, done: false, bgActive: 'bg-purple-500/15', borderActive: 'border-purple-500/30', textActive: 'text-purple-400' },
    { icon: <BrainIcon size={18} />, label: 'Classify', sub: 'AI Engine', active: stats.processed > 0, done: false, bgActive: 'bg-amber-500/15', borderActive: 'border-amber-500/30', textActive: 'text-amber-400' },
    { icon: <FolderIcon size={18} />, label: 'Sort', sub: `${Object.keys(stats.colorCounts).length} folders`, active: stats.processed > 0, done: false, bgActive: 'bg-red-500/15', borderActive: 'border-red-500/30', textActive: 'text-red-400' },
  ];

  return (
    <div className="pb-20">
      <div className="container mx-auto px-6 max-w-6xl mt-6">

        {/* ═══════ UPLOAD PHASE ═══════ */}
        {phase === 'upload' && (
          <div className="animate-fade-up space-y-6">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-heading font-black mb-2">
                Sort Your <span className="text-racing-500">Car Photos</span>
              </h1>
              <p className="text-white/40 text-sm">Drag & drop, pick files, or select an entire folder. Sorted in seconds.</p>
              {license?.active && (
                <>
                  <div className="inline-flex items-center gap-2 mt-3 bg-white/[0.03] border border-white/5 rounded-full px-4 py-1.5 text-xs">
                    <span className="text-racing-500">
                      <CheckIcon size={12} />
                    </span>
                    <span className="text-white/50">
                      {license.isUnlimited ? 'Unlimited processing' : `${license.remaining?.toLocaleString()} images remaining today`}
                    </span>
                  </div>
                  {license.tier === 'trial' && (
                    <div className="mt-3 bg-gradient-to-r from-racing-600/10 to-purple-600/10 border border-racing-500/20 rounded-xl px-5 py-3 text-center">
                      <div className="text-xs text-white/70 font-heading font-bold">🏎️ Free Trial — 50 images/day for 7 days</div>
                      <div className="text-[10px] text-white/40 mt-1">Loving the accuracy? Upgrade for up to 5,000 images/day</div>
                      <button
                        onClick={() => window.electronAPI?.openInExplorer?.('https://autohue.app/pricing')}
                        className="mt-2 text-[11px] font-bold text-racing-400 hover:text-racing-300 underline underline-offset-2 decoration-racing-500/30"
                      >
                        View Plans →
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Error banner */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 flex items-center gap-2">
                <AlertIcon size={16} className="shrink-0" />
                {error}
              </div>
            )}

            {/* Worker loading state */}
            {!workerReady && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-sm text-amber-400 flex items-center gap-3">
                <SpinnerIcon size={16} className="text-amber-400 shrink-0" />
                <div>
                  <span className="font-semibold">AI engine is loading</span>
                  <span className="text-amber-400/60 ml-1">— this may take a moment on first launch.</span>
                </div>
              </div>
            )}

            <AiDisclaimer variant="banner" />

            {/* Drop zone */}
            <div
              className={`drop-zone glass-card rounded-3xl p-12 text-center cursor-pointer relative overflow-hidden transition-all duration-300 ${dragOver ? 'dragover' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.zip,.rar"
                className="hidden"
                title="Select car photos or archives"
                onChange={e => e.target.files && handleFiles(e.target.files)}
              />

              {/* Animated floating color orbs */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute w-3 h-3 rounded-full bg-red-500/20" style={{ top: '15%', left: '10%', animation: 'floatOrb 6s ease-in-out infinite' }} />
                <div className="absolute w-4 h-4 rounded-full bg-blue-500/20" style={{ top: '60%', left: '80%', animation: 'floatOrb 8s ease-in-out 1s infinite' }} />
                <div className="absolute w-3 h-3 rounded-full bg-green-500/20" style={{ top: '30%', left: '70%', animation: 'floatOrb 7s ease-in-out 2s infinite' }} />
                <div className="absolute w-5 h-5 rounded-full bg-yellow-500/15" style={{ top: '70%', left: '20%', animation: 'floatOrb 9s ease-in-out 0.5s infinite' }} />
              </div>

              {/* Car icon */}
              <div className="relative mx-auto mb-6 w-24 h-24">
                <div className="absolute inset-0 rounded-2xl bg-racing-600/10 border border-racing-600/20 animate-pulse" />
                <div className="absolute inset-0 flex items-center justify-center text-racing-500/40">
                  <CarIcon size={48} />
                </div>
                <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-racing-600/20 border border-racing-600/30 flex items-center justify-center" style={{ animation: 'bounceSlow 2s ease-in-out infinite' }}>
                  <UploadIcon size={14} className="text-racing-400" />
                </div>
              </div>

              <p className="text-white/60 font-semibold mb-2 relative z-10">Drop car photos here or click to browse</p>
              <p className="text-white/25 text-xs relative z-10">JPG, PNG, WEBP, ZIP, RAR — up to 5,000+ images per batch</p>
            </div>

            {/* Folder / file picker button group */}
            <div className="flex justify-center">
              <div className="inline-flex items-center rounded-xl overflow-hidden border border-white/10">
                <button
                  onClick={handleFolderPick}
                  className="btn-carbon px-5 py-3 text-sm flex items-center gap-2 rounded-none border-none hover:bg-white/10 transition-colors"
                >
                  <FolderIcon size={16} className="text-racing-400" /> Select Folder
                </button>
                <div className="w-px h-6 bg-white/10" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-carbon px-5 py-3 text-sm flex items-center gap-2 rounded-none border-none hover:bg-white/10 transition-colors"
                >
                  <ImageIcon size={16} className="text-racing-400" /> Pick Files
                </button>
              </div>
            </div>

            {/* Selected folder */}
            {folderPath && (
              <div className="glass-card rounded-3xl p-6 animate-fade-up">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-heading font-bold text-sm flex items-center gap-2">
                    <FolderIcon size={16} className="text-racing-500" />
                    Folder Selected
                  </h3>
                  <button
                    onClick={() => setFolderPath(null)}
                    className="text-xs text-white/30 hover:text-red-400 transition-colors flex items-center gap-1"
                  >
                    <CloseIcon size={10} /> Clear
                  </button>
                </div>
                <p className="text-xs text-white/50 font-mono bg-white/[0.03] rounded-lg px-3 py-2 truncate">{folderPath}</p>
                <div className="flex flex-col items-center gap-4 mt-6">
                  <button
                    onClick={startProcessing}
                    disabled={uploading || !workerReady}
                    className="btn-racing btn-ripple px-10 py-4 rounded-2xl text-lg shadow-xl glow-red disabled:opacity-60 flex items-center gap-3 transition-transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {uploading ? (
                      <><SpinnerIcon size={20} /> Starting...</>
                    ) : (
                      <><FlagIcon size={20} /> Start Sorting</>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* File list */}
            {files.length > 0 && (
              <div className="glass-card rounded-3xl p-6 animate-fade-up">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-heading font-bold text-sm flex items-center gap-2">
                    <ImageIcon size={16} className="text-racing-500" />
                    Ready to Process
                    <span className="bg-racing-600/20 text-racing-400 text-xs font-bold px-2.5 py-0.5 rounded-full">{files.length}</span>
                  </h3>
                  <button
                    onClick={() => setFiles([])}
                    className="text-xs text-white/30 hover:text-red-400 transition-colors flex items-center gap-1"
                  >
                    <TrashIcon size={12} /> Clear
                  </button>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 mb-6">
                  {files.slice(0, 50).map((f, i) => (
                    <div key={i} className="flex items-center gap-3 py-1.5 px-3 rounded-lg bg-white/[0.02] text-xs hover:bg-white/[0.04] transition-colors">
                      <ImageIcon size={14} className="text-white/20 shrink-0" />
                      <span className="text-white/50 truncate flex-1">{f.name}</span>
                      <span className="text-white/20 shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                    </div>
                  ))}
                  {files.length > 50 && (
                    <div className="text-center text-xs text-white/20 py-2">+ {files.length - 50} more files</div>
                  )}
                </div>
                <div className="flex flex-col items-center gap-4">
                  {/* Batch name input */}
                  <div className="w-full max-w-md">
                    <input
                      type="text"
                      value={batchName}
                      onChange={e => setBatchName(e.target.value)}
                      placeholder="Name this batch (e.g. Powercruise Feb Friday)"
                      className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white/70 placeholder:text-white/20 focus:outline-none focus:border-racing-500/40 transition-colors"
                    />
                  </div>
                  <button
                    onClick={startProcessing}
                    disabled={uploading || !workerReady}
                    className="btn-racing btn-ripple px-10 py-4 rounded-2xl text-lg shadow-xl glow-red disabled:opacity-60 flex items-center gap-3 transition-transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {uploading ? (
                      <><SpinnerIcon size={20} /> Uploading & Starting...</>
                    ) : (
                      <><FlagIcon size={20} /> Start Sorting</>
                    )}
                  </button>
                  {uploading && (
                    <div className="w-full max-w-md animate-fade-up">
                      {uploadProgress ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-white/40">
                            <span>Uploading {files.length} file{files.length > 1 ? 's' : ''}...</span>
                            <span className="font-mono text-racing-400">{uploadProgress.percent}%</span>
                          </div>
                          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-racing-600 to-racing-500 rounded-full transition-all duration-300"
                              style={{ width: `${uploadProgress.percent}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-white/20">
                            <span>{formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)}</span>
                            <span>{formatBytes(uploadProgress.speed)}/s</span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-3 text-xs text-white/30">
                          <SpinnerIcon size={14} /> Preparing upload...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════ PROCESSING PHASE ═══════ */}
        {phase === 'processing' && (
          <div className="animate-fade-up space-y-6">
            <div className="text-center mb-4">
              <h2 className="text-2xl font-heading font-black text-white flex items-center justify-center gap-3">
                <FlagIcon size={24} className={`text-racing-500 ${paused ? '' : 'animate-pulse'}`} />
                {paused ? 'Sorting Paused' : 'Sorting in Progress'}
              </h2>
              <p className="text-white/30 text-sm mt-1">
                {paused ? 'Processing is paused — you can navigate away safely' : 'AI is detecting cars and classifying colors'}
              </p>
              {(() => {
                const engine = health?.visionEngine || 'local';
                const isApiEngine = engine === 'openrouter' || engine === 'claude';
                const engineLabel = isApiEngine ? 'AI Vision Pro' : 'Local AI';
                return (
                  <span className={`inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                    isApiEngine
                      ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                      : 'bg-white/5 text-white/30 border border-white/10'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isApiEngine ? 'bg-green-400 animate-pulse' : 'bg-white/30'}`} />
                    {engineLabel}
                  </span>
                );
              })()}
              <div className="flex items-center justify-center gap-3 mt-4">
                {paused ? (
                  <button
                    onClick={() => { fetch(`${workerUrl}/resume/${sessionId}`, { method: 'POST' }); setPaused(false); }}
                    className="btn-racing px-6 py-2 rounded-xl text-sm flex items-center gap-2"
                  >
                    <FlagIcon size={14} /> Resume
                  </button>
                ) : (
                  <button
                    onClick={() => { fetch(`${workerUrl}/pause/${sessionId}`, { method: 'POST' }); setPaused(true); }}
                    className="btn-carbon px-6 py-2 rounded-xl text-sm flex items-center gap-2 border border-white/10"
                  >
                    <span className="w-3 h-3 rounded-sm bg-white/50" /> Pause
                  </button>
                )}
                <button
                  onClick={() => {
                    if (confirm('Cancel sorting? Images already sorted will be kept.')) {
                      fetch(`${workerUrl}/cancel/${sessionId}`, { method: 'POST' });
                      localStorage.removeItem('autohue_active_session');
                      if (pollRef.current) clearInterval(pollRef.current);
                      setPaused(false);
                      // If nothing was sorted, reset to upload; otherwise show results
                      if (stats.processed === 0) {
                        setPhase('upload');
                        setFiles([]);
                        setFolderPath(null);
                        setSessionId('');
                        setError('');
                        setStats({ processed: 0, total: 0, currentFile: '', startTime: 0, imagesPerSecond: 0, avgConfidence: 0, timeSavedSeconds: 0, results: [], colorCounts: {} });
                      } else {
                        setPhase('complete');
                      }
                    }
                  }}
                  className="text-xs text-white/30 hover:text-red-400 transition-colors px-4 py-2 rounded-xl flex items-center gap-2"
                >
                  <CloseIcon size={12} /> Cancel
                </button>
              </div>
            </div>

            {/* ── Extraction Phase UI — show when no images classified yet ── */}
            {stats.processed === 0 && phase === 'sorting' && (
              <div className="glass-card rounded-3xl p-8 text-center animate-fade-up">
                {/* Big animated archive icon */}
                <div className="relative inline-flex items-center justify-center mb-6">
                  <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 border border-amber-500/30 flex items-center justify-center" style={{ animation: 'pulse 2s ease-in-out infinite' }}>
                    <svg viewBox="0 0 24 24" width={40} height={40} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-400">
                      <path d="M21 8v13H3V8M1 3h22v5H1z" /><path d="M10 12h4" />
                    </svg>
                  </div>
                  {/* Flying files animation */}
                  {[0,1,2,3,4].map(i => (
                    <div key={i} className="absolute w-3 h-4 rounded-sm bg-amber-400/40" style={{
                      animation: `extract-fly 1.5s ease-out ${i * 0.3}s infinite`,
                      top: '20%', left: '60%',
                    }} />
                  ))}
                </div>

                <h3 className="text-xl font-heading font-bold text-amber-400 mb-2">
                  Unpacking Your Archive
                </h3>
                <p className="text-white/40 text-sm mb-1">
                  {extractionPhase.total > 0
                    ? `Found ${extractionPhase.total.toLocaleString()} images — extracting to temporary storage`
                    : 'Scanning archive and extracting images...'
                  }
                </p>
                <p className="text-white/20 text-xs mb-6">
                  Larger files take longer to extract. Classification begins once extraction is complete.
                </p>

                {/* Big extraction progress */}
                <div className="max-w-lg mx-auto mb-4">
                  <div className="flex justify-between text-xs text-white/40 mb-2">
                    <span>{extractionPhase.extracted.toLocaleString()} extracted</span>
                    <span>{extractionPhase.total > 0 ? `${extractionPhase.total.toLocaleString()} total` : 'scanning...'}</span>
                  </div>
                  <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 ease-out"
                      style={{
                        width: extractionPhase.total > 0 ? `${Math.min((extractionPhase.extracted / extractionPhase.total) * 100, 100)}%` : '30%',
                        background: 'linear-gradient(90deg, #f59e0b, #f97316, #ef4444)',
                        animation: extractionPhase.total === 0 ? 'indeterminate 2s ease-in-out infinite' : 'none',
                      }}
                    />
                  </div>
                </div>

                <p className="text-[10px] text-white/15 truncate max-w-md mx-auto">{extractionPhase.currentFile}</p>

                <style>{`
                  @keyframes extract-fly {
                    0% { transform: translate(0, 0) rotate(0deg) scale(1); opacity: .6; }
                    100% { transform: translate(40px, -60px) rotate(15deg) scale(0.3); opacity: 0; }
                  }
                  @keyframes indeterminate {
                    0% { margin-left: 0; width: 30%; }
                    50% { margin-left: 40%; width: 40%; }
                    100% { margin-left: 70%; width: 30%; }
                  }
                `}</style>
              </div>
            )}

            {/* Gauges — hide when nothing classified yet (extraction/prep phase) */}
            <div className={`glass-card rounded-3xl p-6 ${stats.processed === 0 && phase === 'sorting' ? 'hidden' : ''}`}>
              <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 items-start">
                <TachoGauge value={speedPct} max={10} label="SPEED" unit="img/sec" displayValue={stats.imagesPerSecond.toFixed(1)} size={150} variant="red" redZoneStart={80} subtitle={stats.imagesPerSecond > 0 ? `~${(1/stats.imagesPerSecond).toFixed(1)}s each` : ''} />
                <TachoGauge value={progressPct} max={100} label="PROGRESS" unit={`${stats.processed}/${stats.total}`} displayValue={`${progressPct}%`} size={150} variant="amber" redZoneStart={90} />
                <TachoGauge value={confPct} max={100} label="ACCURACY" unit="confidence" displayValue={confPct > 0 ? `${confPct.toFixed(0)}%` : '--'} size={150} variant="green" redZoneStart={95} />
                <TachoGauge value={etaPct} max={100} label="ETA" unit="remaining" displayValue={etaFormatted} size={150} variant="blue" redZoneStart={95} subtitle={remaining > 0 ? `${remaining} left` : ''} />
                <TachoGauge value={stats.timeSavedSeconds > 0 ? Math.min((stats.timeSavedSeconds / (stats.processed * MANUAL_SECONDS_PER_IMAGE)) * 100, 100) : 0} max={100} label="TIME SAVED" unit="vs manual" displayValue={timeSavedFormatted} size={150} variant="green" redZoneStart={95} subtitle={`Manual: ~${Math.round(stats.processed * MANUAL_SECONDS_PER_IMAGE / 60)}m`} />
                <TachoGauge value={costSaved > 0 ? Math.min((costSaved / projectedTotalCostSaved) * 100, 100) : 0} max={100} label="COST SAVED" unit={`@ $${PHOTOGRAPHER_HOURLY_RATE}/hr`} displayValue={costSavedFormatted} size={150} variant="green" redZoneStart={95} subtitle={projectedTotalCostSaved > 0 ? `~$${projectedTotalCostSaved.toFixed(0)} total` : ''} />
              </div>
            </div>

            {/* Progress bar */}
            <div className="glass-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/50 flex items-center gap-2">
                  {!paused && <SpinnerIcon size={14} className="text-racing-500" />}
                  {paused && <span className="w-3.5 h-3.5 rounded-full bg-amber-500/50" />}
                  {stats.total === 0 && stats.processed === 0 && stats.currentFile?.toLowerCase().includes('extract')
                    ? <span className="text-amber-400">{stats.currentFile}</span>
                    : stats.total === 0 && stats.processed === 0
                    ? <span className="text-amber-400/80">
                        Preparing — extracting archive and discovering images...
                        <span className="inline-block ml-2 text-[10px] text-white/30 animate-pulse">This may take a moment for large files</span>
                      </span>
                    : stats.currentFile ? `Processing: ${stats.currentFile}` : 'Starting...'
                  }
                </span>
                <span className="digital-readout text-white/60">
                  {stats.total === 0 && stats.processed === 0
                    ? <span className="text-amber-400/60 text-xs animate-pulse">extracting...</span>
                    : `${stats.processed} / ${stats.total}`
                  }
                </span>
              </div>
              <div className="w-full bg-white/5 rounded-full h-4 overflow-hidden relative">
                <div
                  className="h-4 rounded-full transition-all duration-700 ease-out relative"
                  style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #dc2626, #ef4444, #f97316)' }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
                </div>
                {/* Percentage text centered on the bar */}
                <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                  {progressPct}%
                </span>
              </div>
            </div>

            {/* Sorting Animation */}
            <div className="glass-card rounded-2xl p-5 overflow-hidden">
              <SortAnimation
                results={stats.results.map(r => ({
                  filename: r.file || r.filename || '',
                  color: r.color || 'unknown',
                  thumb: r.thumb ? `${workerUrl}${r.thumb}` : null,
                }))}
                isProcessing={phase === 'sorting'}
                totalProcessed={stats.processed}
                totalImages={stats.total}
              />
            </div>

            {/* Pipeline visualization */}
            <div className="glass-card rounded-2xl p-5 relative overflow-hidden">
              <h3 className="text-xs font-bold text-white/30 mb-4 flex items-center gap-2">
                <BrainIcon size={14} className="text-racing-500" /> AI Classification Pipeline
              </h3>
              <div className="flex items-center justify-between gap-1 relative">
                {pipelineSteps.map((step, i) => (
                  <div key={i} className="flex items-center flex-1">
                    {/* Connector arrow */}
                    {i > 0 && (
                      <svg viewBox="0 0 24 12" className="w-6 h-3 shrink-0 -mx-0.5" fill="none">
                        <line x1="0" y1="6" x2="18" y2="6" stroke={step.active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)'} strokeWidth="1.5" />
                        <path d="M16 2L22 6L16 10" stroke={step.active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)'} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {/* Step node */}
                    <div className="flex flex-col items-center gap-1.5 flex-1">
                      <div
                        className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-500 border ${
                          step.active
                            ? `${step.bgActive} ${step.borderActive} ${!step.done ? 'animate-pulse' : ''}`
                            : 'bg-white/5 border-white/10'
                        }`}
                      >
                        <span className={step.active ? step.textActive : 'text-white/20'}>
                          {step.done ? <CheckIcon size={18} /> : step.icon}
                        </span>
                      </div>
                      <span className="text-[9px] text-white/30">{step.label}</span>
                      {step.sub && <span className="text-[8px] text-white/20">{step.sub}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Activity log */}
            {stats.results.length > 0 && (
              <div className="glass-card rounded-2xl p-5">
                <h3 className="text-xs font-bold text-white/30 mb-3 flex items-center gap-2">
                  <TerminalIcon size={14} className="text-racing-500" /> Activity Log
                </h3>
                <div className="bg-black/30 rounded-xl p-3 max-h-36 overflow-y-auto font-mono text-[10px] space-y-1">
                  {stats.results.slice(-20).reverse().map((r, i) => {
                    const info = COLOR_INFO[r.color] || COLOR_INFO['unknown'];
                    const confLabel = r.confidence >= 0.9 ? 'HIGH' : r.confidence >= 0.7 ? 'MED' : 'LOW';
                    const confColor = r.confidence >= 0.9 ? 'text-green-400' : r.confidence >= 0.7 ? 'text-yellow-400' : 'text-red-400';
                    return (
                      <div key={`log-${r.file}-${i}`} className={`flex items-center gap-2 ${i === 0 ? 'text-white/60' : 'text-white/25'}`}>
                        <span className="text-racing-500/50 w-6 text-right shrink-0">{stats.results.length - i}</span>
                        <span className="text-white/10">|</span>
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: info.swatch }} />
                        <span className="truncate flex-1">{r.file}</span>
                        <span className="text-white/10">&rarr;</span>
                        <span style={{ color: info.swatch }}>{info.label}</span>
                        <span className={`${confColor} w-7 text-right`}>{confLabel}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Color distribution */}
            {Object.keys(stats.colorCounts).length > 0 && (
              <div className="glass-card rounded-2xl p-5">
                <h3 className="text-xs font-bold text-white/30 mb-3 flex items-center gap-2">
                  <ChartIcon size={14} className="text-racing-500" /> Live Color Distribution
                </h3>
                <div className="flex h-8 rounded-lg overflow-hidden bg-white/5 mb-3">
                  {Object.entries(stats.colorCounts).sort((a, b) => b[1] - a[1]).map(([color, count]) => {
                    const info = COLOR_INFO[color] || COLOR_INFO['unknown'];
                    const pct = stats.processed > 0 ? (count / stats.processed) * 100 : 0;
                    return <div key={color} className="h-full transition-all duration-700" style={{ width: `${pct}%`, background: info.swatch, minWidth: count > 0 ? '3px' : '0' }} title={`${info.label}: ${count} (${pct.toFixed(0)}%)`} />;
                  })}
                </div>
                <div className="flex flex-wrap gap-3">
                  {Object.entries(stats.colorCounts).sort((a, b) => b[1] - a[1]).map(([color, count]) => {
                    const info = COLOR_INFO[color] || COLOR_INFO['unknown'];
                    return (
                      <div key={color} className="flex items-center gap-1.5 text-[10px] text-white/40">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ background: info.swatch, boxShadow: `0 0 4px ${info.glow}` }} />
                        {info.label} ({count})
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════ COMPLETE PHASE ═══════ */}
        {phase === 'complete' && (
          <div className="animate-fade-up space-y-6">
            <div className="glass-card rounded-3xl p-10 text-center relative overflow-hidden">
              {/* Confetti burst */}
              <div className="absolute top-6 left-1/2 -translate-x-1/2 pointer-events-none">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="confetti-piece" />
                ))}
              </div>

              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-racing-600 to-racing-800 mb-6 glow-red">
                <CheckIcon size={36} className="text-white" />
              </div>
              <h2 className="text-3xl font-heading font-black mb-2">Sorting Complete!</h2>
              <p className="text-white/40 text-sm mb-6">{stats.processed} images sorted into {Object.keys(stats.colorCounts).length} color folders</p>

              {/* Big impact stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
                  <div className="text-3xl font-heading font-black text-racing-500">{stats.processed.toLocaleString()}</div>
                  <div className="text-[10px] text-white/30 mt-1 uppercase tracking-wider">Images Sorted</div>
                </div>
                <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
                  <div className="text-3xl font-heading font-black text-green-400">{timeSavedFormatted}</div>
                  <div className="text-[10px] text-white/30 mt-1 uppercase tracking-wider">Time Saved</div>
                </div>
                <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
                  <div className="text-3xl font-heading font-black text-emerald-400">{costSavedFormatted}</div>
                  <div className="text-[10px] text-white/30 mt-1 uppercase tracking-wider">Cost Saved</div>
                </div>
                <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
                  <div className="text-3xl font-heading font-black text-purple-400">{stats.imagesPerSecond.toFixed(1)}</div>
                  <div className="text-[10px] text-white/30 mt-1 uppercase tracking-wider">Images/Sec</div>
                </div>
              </div>

              {/* Secondary stats */}
              <div className="flex items-center justify-center gap-6 text-xs text-white/30 border-t border-white/5 pt-4">
                <span>{confPct.toFixed(0)}% accuracy</span>
                <span>·</span>
                <span>{Object.keys(stats.colorCounts).length} colors detected</span>
                <span>·</span>
                <span>Manual estimate: ~{Math.ceil(stats.processed * 15 / 60)} min @ 15s/photo</span>
              </div>
            </div>

            {/* Color cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 stagger">
              {Object.entries(stats.colorCounts).sort((a, b) => b[1] - a[1]).map(([color, count]) => {
                const info = COLOR_INFO[color] || COLOR_INFO['unknown'];
                const isExpanded = expandedColor === color;
                return (
                  <button key={color} onClick={() => setExpandedColor(isExpanded ? null : color)}
                    className={`color-card glass-card rounded-2xl p-5 text-left transition-all duration-200 ${isExpanded ? 'ring-2 ring-white/30 scale-[1.02]' : 'hover:scale-[1.03] active:scale-[0.98]'}`}
                    style={{ borderColor: `${info.swatch}20` }}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-xl transition-shadow duration-200" style={{ background: info.swatch, boxShadow: `0 0 12px ${info.glow}`, border: color === 'white' || color === 'silver-grey' ? '1px solid rgba(255,255,255,0.15)' : 'none' }} />
                      <span className="font-heading font-bold text-sm">{info.label}</span>
                      <span className="text-white/20 text-xs ml-auto transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                        <svg viewBox="0 0 12 12" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 5L6 8L9 5" /></svg>
                      </span>
                    </div>
                    <div className="digital-readout text-2xl font-black" style={{ color: info.swatch }}>{count}</div>
                    <div className="text-[10px] text-white/25 mt-1">images — click to review</div>
                  </button>
                );
              })}
            </div>

            {/* Expanded color panel */}
            {expandedColor && (
              <div className="glass-card rounded-2xl p-6 animate-fade-up">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-heading font-bold text-lg flex items-center gap-2">
                    <div className="w-5 h-5 rounded-lg" style={{ background: (COLOR_INFO[expandedColor] || COLOR_INFO['unknown']).swatch }} />
                    {(COLOR_INFO[expandedColor] || COLOR_INFO['unknown']).label} — {stats.results.filter(r => r.color === expandedColor).length} images
                  </h3>
                  <button
                    onClick={() => setExpandedColor(null)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 text-white/30 hover:text-white hover:bg-white/10 transition-all duration-200"
                  >
                    <CloseIcon size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-2">
                  {stats.results.filter(r => r.color === expandedColor).map((result, idx) => (
                    <div key={`${result.file}-${idx}`} className="flex items-center gap-3 bg-white/5 rounded-xl px-3 py-2 hover:bg-white/[0.08] transition-colors">
                      <div className="w-16 h-12 rounded-lg overflow-hidden bg-black/40 shrink-0 cursor-pointer hover:ring-2 hover:ring-racing-500/40 transition-all"
                        onClick={() => {
                          const globalIdx = stats.results.findIndex(r => r.file === result.file && r.color === result.color);
                          if (globalIdx >= 0) setLightboxIdx(globalIdx);
                        }}
                      >
                        {result.thumb ? (
                          <img src={`${workerUrl}${result.thumb}`} alt={result.file} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white/10">
                            <CarIcon size={20} />
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-white/60 truncate flex-1">{result.file}</span>
                      <select
                        value={result.color}
                        onChange={(e) => reassignImage(result.file, result.color, e.target.value)}
                        aria-label={`Color for ${result.file}`}
                        className="appearance-none bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/80 cursor-pointer focus:outline-none focus:border-racing-500 focus:ring-1 focus:ring-racing-500/30 shrink-0 hover:bg-white/15 transition-colors"
                      >
                        {Object.entries(COLOR_INFO).map(([key, ci]) => (
                          <option key={key} value={key} className="bg-gray-900 text-white">{ci.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Watermark editor (always available in desktop) */}
            <WatermarkEditor />

            <AiDisclaimer variant="inline" />

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <button
                onClick={() => window.open(`${workerUrl}/download/${sessionId}`, '_blank')}
                className="btn-racing btn-ripple px-10 py-4 rounded-2xl text-lg shadow-xl glow-red flex items-center gap-3 transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <DownloadIcon size={20} /> Download Sorted ZIP
              </button>
              <button
                onClick={handleOpenOutput}
                className="btn-carbon px-6 py-3 rounded-xl flex items-center gap-2 hover:bg-white/10 transition-colors"
              >
                <ExternalIcon size={16} /> Open in Explorer
              </button>
              <button
                onClick={() => { setPhase('upload'); setFiles([]); setFolderPath(null); setSessionId(''); }}
                className="btn-carbon px-6 py-3 rounded-xl flex items-center gap-2 hover:bg-white/10 transition-colors"
              >
                <RefreshIcon size={16} /> Sort More
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Lightbox Image Viewer ── */}
      {lightboxIdx !== null && stats.results[lightboxIdx] && (() => {
        const r = stats.results[lightboxIdx];
        const info = COLOR_INFO[r.color] || COLOR_INFO['unknown'];
        return (
          <div
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center"
            onClick={() => setLightboxIdx(null)}
          >
            {/* Close button */}
            <button className="absolute top-6 right-6 text-white/40 hover:text-white text-2xl z-10" onClick={() => setLightboxIdx(null)}>
              <CloseIcon size={28} />
            </button>

            {/* Prev */}
            {lightboxIdx > 0 && (
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all z-10"
                onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx - 1); }}
              >
                ‹
              </button>
            )}

            {/* Next */}
            {lightboxIdx < stats.results.length - 1 && (
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all z-10"
                onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx + 1); }}
              >
                ›
              </button>
            )}

            {/* Image — use full-size from output folder, fallback to thumb */}
            <div className="max-w-[90vw] max-h-[90vh] relative" onClick={(e) => e.stopPropagation()}>
              <img
                src={`${workerUrl}/output/${sessionId}/${encodeURIComponent(r.color)}/${encodeURIComponent(r.filename || r.file)}`}
                alt={r.filename || r.file}
                className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
                onError={(e) => {
                  // Fallback to thumbnail if full image not found
                  if (r.thumb) (e.target as HTMLImageElement).src = `${workerUrl}${r.thumb}`;
                }}
              />
              {/* Info bar */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent rounded-b-xl px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full border-2 border-white/30" style={{ backgroundColor: info.swatch, boxShadow: `0 0 10px ${info.glow}` }} />
                    <span className="text-white font-heading font-bold text-lg">{info.label}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-white/50 text-xs truncate max-w-[300px]">{r.file}</div>
                    <div className="text-white/30 text-[10px]">{lightboxIdx + 1} of {stats.results.length}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function formatTimeSaved(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
