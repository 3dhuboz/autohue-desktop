const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

class WorkerManager {
  constructor(storagePath) {
    this.process = null;
    this.port = 3001;
    this.storagePath = storagePath;
    this.restarting = false;

    // Ensure storage directories exist
    fs.mkdirSync(storagePath, { recursive: true });
  }

  /** Resolve the path to server.js (works in dev and packaged builds). */
  _getServerPath() {
    const { app } = require('electron');
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'worker', 'server.js');
    }
    return path.join(__dirname, '..', 'worker', 'server.js');
  }

  /** Resolve the path to ONNX models. */
  _getModelsPath() {
    const { app } = require('electron');
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'models');
    }
    return path.join(__dirname, '..', 'worker', 'models');
  }

  /** Start the worker process. */
  async start() {
    if (this.process) return;

    const serverPath = this._getServerPath();
    if (!fs.existsSync(serverPath)) {
      throw new Error(`Worker server not found at: ${serverPath}`);
    }

    console.log(`[worker] Starting on port ${this.port}...`);
    console.log(`[worker] Server: ${serverPath}`);
    console.log(`[worker] Storage: ${this.storagePath}`);

    this.process = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: String(this.port),
        STORAGE_ROOT: this.storagePath,
        // No NYCKEL keys = local LAB-only classification (offline)
      },
      silent: true, // capture stdout/stderr
    });

    // Forward worker logs to main process console
    this.process.stdout.on('data', (data) => {
      process.stdout.write(`[worker] ${data}`);
    });
    this.process.stderr.on('data', (data) => {
      process.stderr.write(`[worker:err] ${data}`);
    });

    // Handle unexpected worker exit
    this.process.on('exit', (code, signal) => {
      console.warn(`[worker] Exited (code=${code}, signal=${signal})`);
      this.process = null;

      // Auto-restart unless intentionally stopped
      if (!this.restarting && code !== 0) {
        console.log('[worker] Auto-restarting in 2 seconds...');
        setTimeout(() => this.start().catch(console.error), 2000);
      }
    });

    // Wait for the worker to be ready
    await this._waitForReady();
    console.log(`[worker] Ready on port ${this.port}`);
  }

  /** Poll /health until the worker responds. */
  async _waitForReady(retries = 40, interval = 500) {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(`http://localhost:${this.port}/health`);
        if (res.ok) return;
      } catch {
        // Worker not ready yet
      }
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(`Worker did not start within ${retries * interval / 1000}s`);
  }

  /** Stop the worker process. */
  stop() {
    this.restarting = true;
    if (this.process) {
      console.log('[worker] Stopping...');
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  /** Get the worker base URL. */
  getUrl() {
    return `http://localhost:${this.port}`;
  }

  /** Check worker health. */
  async checkHealth() {
    try {
      const res = await fetch(`http://localhost:${this.port}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return await res.json();
      return { status: 'error', code: res.status };
    } catch (err) {
      return { status: 'unreachable', error: err.message };
    }
  }
}

module.exports = { WorkerManager };
