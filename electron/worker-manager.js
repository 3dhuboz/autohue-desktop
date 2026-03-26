const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

class WorkerManager {
  constructor(storagePath) {
    this.process = null;
    this.port = 3099;
    this.storagePath = storagePath;
    this.restarting = false;
    this.claudeApiKey = null;
    this.openRouterKey = null;
    this.visionModel = 'google/gemini-2.0-flash-001';

    // Ensure storage directories exist
    fs.mkdirSync(storagePath, { recursive: true });
  }

  /** Set the Claude API key for Vision classification. */
  setClaudeApiKey(key) {
    this.claudeApiKey = key;
    if (this.process && key) {
      this.process.send({ type: 'set-claude-key', key });
      console.log('[worker] Sent Claude API key to running worker');
    }
  }

  /** Set the OpenRouter API key. */
  setOpenRouterKey(key) {
    this.openRouterKey = key;
    if (this.process && key) {
      this.process.send({ type: 'set-openrouter-key', key });
      console.log('[worker] Sent OpenRouter key to running worker');
    }
  }

  /** Set the vision model (e.g. google/gemini-2.0-flash-001). */
  setVisionModel(model) {
    this.visionModel = model;
    if (this.process) {
      this.process.send({ type: 'set-vision-model', model });
    }
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
    console.log(`[worker] Claude API key: ${this.claudeApiKey ? 'SET (' + this.claudeApiKey.slice(0, 12) + '...)' : 'NOT SET'}`);

    // Read Claude key from DB directly as fallback (belt + suspenders)
    let claudeKey = this.claudeApiKey;
    if (!claudeKey) {
      try {
        const { app } = require('electron');
        const dbPath = path.join(app.getPath('userData'), 'autohue.db');
        if (fs.existsSync(dbPath)) {
          const initSqlJs = require('sql.js');
          const SQL = await initSqlJs();
          const buf = fs.readFileSync(dbPath);
          const db = new SQL.Database(buf);
          const result = db.exec("SELECT value FROM settings WHERE key='claude_api_key'");
          if (result.length > 0 && result[0].values.length > 0) {
            claudeKey = result[0].values[0][0];
            if (claudeKey) console.log(`[worker] Claude key found in DB: ${claudeKey.slice(0, 12)}...`);
          }
          db.close();
        }
      } catch (err) {
        console.warn('[worker] Failed to read Claude key from DB:', err.message);
      }
    }

    if (claudeKey) {
      console.log(`[worker] Passing CLAUDE_API_KEY to worker env: ${claudeKey.slice(0, 12)}...`);
    }

    const orKey = this.openRouterKey;
    this.process = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: String(this.port),
        STORAGE_ROOT: this.storagePath,
        ...(claudeKey ? { CLAUDE_API_KEY: claudeKey } : {}),
        ...(orKey ? { OPENROUTER_KEY: orKey } : {}),
        VISION_MODEL: this.visionModel || 'google/gemini-2.0-flash-001',
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
        const res = await fetch(`http://127.0.0.1:${this.port}/health`);
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

  /** Check worker health. */
  async checkHealth() {
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/health`, {
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
