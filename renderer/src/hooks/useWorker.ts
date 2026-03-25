import { useState, useEffect } from 'react';

const isDevBrowser = typeof window !== 'undefined' && !window.electronAPI;

export function useWorker() {
  const [health, setHealth] = useState<WorkerHealth | null>(
    isDevBrowser ? { status: 'ok', ssdMobilenet: 'ready', segformer: 'ready', activeSessions: 0 } : null
  );
  const [port, setPort] = useState(3001);
  const [ready, setReady] = useState(isDevBrowser);

  useEffect(() => {
    if (isDevBrowser) return; // Mock data already set

    let mounted = true;

    async function check() {
      try {
        const p = await window.electronAPI.getWorkerPort();
        if (mounted) setPort(p);

        const h = await window.electronAPI.getWorkerHealth();
        if (mounted) {
          setHealth(h);
          setReady(h.status === 'ok');
        }
      } catch {
        if (mounted) setReady(false);
      }
    }

    check();
    const interval = setInterval(check, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const workerUrl = `http://localhost:${port}`;

  return { health, port, ready, workerUrl };
}
