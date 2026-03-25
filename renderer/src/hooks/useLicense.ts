import { useState, useEffect, useCallback } from 'react';

// Dev mode mock license — used when running in browser without Electron
const DEV_LICENSE: LicenseState = {
  active: true,
  tier: 'unlimited',
  tierName: 'Unlimited',
  dailyLimit: -1,
  isUnlimited: true,
  todayUsage: 42,
  remaining: -1,
  offlineMode: false,
  graceDaysLeft: 7,
  licenseKey: 'AH-UNL-DEV0-MODE-TEST-KEY0',
  activatedAt: new Date().toISOString(),
  expiresAt: null,
};

const isDevBrowser = !window.electronAPI;

export function useLicense() {
  const [license, setLicense] = useState<LicenseState | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (isDevBrowser) {
      setLicense(DEV_LICENSE);
      setLoading(false);
      return;
    }
    try {
      const state = await window.electronAPI.getLicense();
      setLicense(state);
    } catch (err) {
      console.error('Failed to get license:', err);
      setLicense({ active: false, reason: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activate = useCallback(async (key: string) => {
    if (isDevBrowser) {
      setLicense(DEV_LICENSE);
      return { success: true, tier: 'unlimited', tierName: 'Unlimited', dailyLimit: -1, expiresAt: null };
    }
    const result = await window.electronAPI.activateLicense(key);
    if (result.success) {
      await refresh();
    }
    return result;
  }, [refresh]);

  const checkQuota = useCallback(async (count: number) => {
    if (isDevBrowser) return { allowed: true, remaining: -1 };
    return window.electronAPI.checkQuota(count);
  }, []);

  const recordUsage = useCallback(async (sessionId: string, count: number, colorCounts: Record<string, number>) => {
    if (isDevBrowser) return { success: true };
    const result = await window.electronAPI.recordUsage(sessionId, count, colorCounts);
    await refresh();
    return result;
  }, [refresh]);

  return { license, loading, activate, checkQuota, recordUsage, refresh };
}
