// Electron API exposed via preload.js
interface ElectronAPI {
  // License
  getLicense: () => Promise<LicenseState>;
  activateLicense: (key: string) => Promise<ActivationResult>;
  checkQuota: (count: number) => Promise<QuotaCheck>;
  recordUsage: (sessionId: string, count: number, colorCounts: Record<string, number>) => Promise<{ success: boolean }>;

  // File dialogs
  openFolder: () => Promise<string | null>;
  openFiles: () => Promise<string[] | null>;
  selectOutputFolder: () => Promise<string | null>;
  openInExplorer: (path: string) => Promise<string>;

  // Settings
  getSetting: (key: string) => Promise<string | null>;
  setSetting: (key: string, value: string) => Promise<boolean>;

  // Claude Vision API
  getClaudeKeyStatus: () => Promise<ClaudeKeyStatus>;
  setClaudeKey: (key: string) => Promise<{ success: boolean }>;

  // History
  getHistory: () => Promise<HistoryEntry[]>;
  deleteHistory: (id: number) => Promise<boolean>;

  // Worker
  getWorkerHealth: () => Promise<WorkerHealth>;
  getWorkerPort: () => Promise<number>;

  // App
  getVersion: () => Promise<string>;
  getUserDataPath: () => Promise<string>;
}

interface LicenseState {
  active: boolean;
  reason?: string;
  tier?: string;
  tierName?: string;
  dailyLimit?: number;
  isUnlimited?: boolean;
  todayUsage?: number;
  remaining?: number;
  offlineMode?: boolean;
  graceDaysLeft?: number;
  licenseKey?: string;
  activatedAt?: string;
  expiresAt?: string | null;
  expiredAt?: string;
  daysOverdue?: number;
}

interface ActivationResult {
  success: boolean;
  error?: string;
  tier?: string;
  tierName?: string;
  dailyLimit?: number;
  expiresAt?: string | null;
}

interface QuotaCheck {
  allowed: boolean;
  reason?: string;
  remaining?: number;
  dailyLimit?: number;
  todayUsage?: number;
}

interface HistoryEntry {
  id: number;
  session_id: string;
  image_count: number;
  color_counts: string | null;
  input_path: string | null;
  output_path: string | null;
  duration_seconds: number | null;
  status: string;
  created_at: string;
}

interface ClaudeKeyStatus {
  hasKey: boolean;
  source: 'custom' | 'platform' | 'none';
  eligible: boolean;
  tier?: string;
}

interface WorkerHealth {
  status: string;
  ssdMobilenet?: string;
  segformer?: string;
  activeSessions?: number;
  [key: string]: unknown;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
