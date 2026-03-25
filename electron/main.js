const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { initDatabase } = require('./database');
const { LicenseManager } = require('./license');
const { WorkerManager } = require('./worker-manager');

let mainWindow;
let db;
let licenseManager;
let workerManager;

const isDev = !app.isPackaged;

// Prevent EPIPE crashes from auto-updater pipe errors
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') return; // silently ignore broken pipe
  console.error('[uncaught]', err);
});
process.on('unhandledRejection', (err) => {
  if (err && err.code === 'EPIPE') return;
  console.warn('[unhandled]', err);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, '../build/icon.ico'),
    backgroundColor: '#09090b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#09090b',
      symbolColor: '#ef4444',
      height: 36,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // 1. Initialize SQLite database (async — sql.js loads WASM)
  const dbPath = path.join(app.getPath('userData'), 'autohue.db');
  db = await initDatabase(dbPath);

  // 2. Initialize license manager
  licenseManager = new LicenseManager(db);

  // 2b. Dev mode: auto-seed Unlimited test license if none exists
  if (isDev) {
    const current = licenseManager.getCurrent();
    if (!current.active) {
      console.log('[dev] No license found — seeding Unlimited test license');
      db.prepare(`
        INSERT OR REPLACE INTO license (id, license_key, tier, daily_limit, machine_id,
          activated_at, expires_at, last_validated, validation_response)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'AH-UNL-DEV0-MODE-TEST-KEY0',
        'unlimited',
        -1,
        'dev-machine',
        new Date().toISOString(),
        null,
        new Date().toISOString(),
        null,
      );
      console.log('[dev] Unlimited license activated');
    }
  }

  // 3. Start the AI worker process
  const storagePath = path.join(app.getPath('userData'), 'worker-data');
  workerManager = new WorkerManager(storagePath);
  workerManager.start().then(() => {
    // Push Claude API key + tier to worker after it starts
    syncClaudeConfigToWorker();
  }).catch(err => {
    console.error('Worker failed to start:', err.message);
  });

  // 4. Create window
  createWindow();

  // 5. Check for updates (production only — silent fail for private repos)
  if (!isDev) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.logger = { info: () => {}, warn: () => {}, error: () => {} };
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    } catch (_) {}
  }
});

app.on('window-all-closed', () => {
  if (workerManager) workerManager.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ═══════════════════════════════════════════════════════════
// IPC Handlers
// ═══════════════════════════════════════════════════════════

// ─── License ───
ipcMain.handle('license:get', () => licenseManager.getCurrent());
ipcMain.handle('license:activate', async (_, key) => {
  const result = await licenseManager.activate(key);
  // Push Claude API key + tier to worker after activation
  if (result.success) syncClaudeConfigToWorker();
  return result;
});
ipcMain.handle('license:checkQuota', (_, count) => licenseManager.canProcess(count));
ipcMain.handle('license:recordUsage', (_, sessionId, count, colorCounts) => {
  return licenseManager.recordUsage(sessionId, count, colorCounts);
});

// ─── Claude Vision API Key ───
ipcMain.handle('settings:getClaudeKey', () => {
  const custom = licenseManager.getClaudeApiKey();
  const license = licenseManager.getCurrent();
  const hasEmbedded = !!licenseManager.db.prepare("SELECT value FROM settings WHERE key = 'claude_api_key_embedded'").get()?.value;
  const hasCustom = !!licenseManager.db.prepare("SELECT value FROM settings WHERE key = 'claude_api_key_custom'").get()?.value;
  const tier = (license.tier || '').toLowerCase();
  console.log(`[claude-key-status] tier=${tier}, active=${license.active}, hasCustom=${hasCustom}, hasEmbedded=${hasEmbedded}`);
  return {
    hasKey: !!custom,
    source: hasCustom ? 'custom' : hasEmbedded ? 'platform' : 'none',
    eligible: ['pro', 'unlimited'].includes(tier) || license.isUnlimited === true,
    tier,
  };
});
ipcMain.handle('settings:setClaudeKey', (_, key) => {
  licenseManager.setClaudeApiKey(key);
  syncClaudeConfigToWorker();
  return { success: true };
});

/** Push Claude API key and tier to the running worker process. */
function syncClaudeConfigToWorker() {
  const claudeKey = licenseManager.getClaudeApiKey();
  const license = licenseManager.getCurrent();
  const workerUrl = workerManager?.getUrl?.() || 'http://localhost:3001';
  fetch(`${workerUrl}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claudeApiKey: claudeKey || '', tier: license.tier || '' }),
  }).catch(err => console.warn('[main] Failed to sync Claude config to worker:', err.message));
}

// ─── File Dialogs ───
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select folder of car photos',
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] },
      { name: 'Archives', extensions: ['zip', 'rar'] },
    ],
    title: 'Select car photos or archives',
  });
  return result.canceled ? null : result.filePaths;
});

ipcMain.handle('dialog:selectOutputFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select output folder for sorted photos',
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('shell:openFolder', (_, folderPath) => {
  return shell.openPath(folderPath);
});

// ─── Settings ───
ipcMain.handle('settings:get', (_, key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
});

ipcMain.handle('settings:set', (_, key, value) => {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  return true;
});

// ─── History ───
ipcMain.handle('history:list', () => {
  return db.prepare('SELECT * FROM processing_history ORDER BY created_at DESC LIMIT 100').all();
});

ipcMain.handle('history:delete', (_, id) => {
  db.prepare('DELETE FROM processing_history WHERE id = ?').run(id);
  return true;
});

// ─── Worker ───
ipcMain.handle('worker:health', async () => {
  return workerManager ? workerManager.checkHealth() : { status: 'not_started' };
});

ipcMain.handle('worker:port', () => {
  return workerManager ? workerManager.port : 3001;
});

// ─── App Info ───
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:userData', () => app.getPath('userData'));
