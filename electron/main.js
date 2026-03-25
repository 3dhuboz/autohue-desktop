const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { initDatabase } = require('./database');
const { LicenseManager } = require('./license');
const { WorkerManager } = require('./worker-manager');
const { RulesSync } = require('./rules-sync');

let mainWindow;
let db;
let licenseManager;
let workerManager;
let rulesSync;

const isDev = !app.isPackaged;

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
          activated_at, expires_at, last_validated, validation_response, subscription_status)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'AH-UNL-DEV0-MODE-TEST-KEY0',
        'unlimited',
        -1,
        'dev-machine',
        new Date().toISOString(),
        null,
        new Date().toISOString(),
        null,
        'active',
      );
      console.log('[dev] Unlimited license activated');
    }
  }

  // 3. Try to get Claude API key — check custom key first, then platform key
  const customKeyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('claude_api_key');
  const claudeKey = (customKeyRow ? customKeyRow.value : null) || licenseManager.getClaudeApiKey();
  if (claudeKey) {
    console.log(`[main] Claude Vision API key available (${customKeyRow ? 'custom' : 'platform'}) — enabling fast pipeline`);
  }

  // 4. Start the AI worker process
  const storagePath = path.join(app.getPath('userData'), 'worker-data');
  workerManager = new WorkerManager(storagePath);
  if (claudeKey) workerManager.setClaudeApiKey(claudeKey);
  workerManager.start().catch(err => {
    console.error('Worker failed to start:', err.message);
  });

  // Re-validate license in background (may fetch Claude key if first run after upgrade)
  licenseManager.tryRevalidate().then(() => {
    const freshKey = licenseManager.getClaudeApiKey();
    if (freshKey && freshKey !== claudeKey) {
      workerManager.setClaudeApiKey(freshKey);
    }
  }).catch(() => {});

  // 5. Create window
  createWindow();

  // 6. Check for updates (production only)
  if (!isDev) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
      console.error('Auto-updater error:', err.message);
    }
  }

  // 7. Start rules sync — checks cloud for updated learned rules every 6 hours
  rulesSync = new RulesSync(storagePath, workerManager.port || 3001);
  rulesSync.start();
});

app.on('window-all-closed', () => {
  if (rulesSync) rulesSync.stop();
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
ipcMain.handle('license:activate', (_, key) => licenseManager.activate(key));
ipcMain.handle('license:checkQuota', (_, count) => licenseManager.canProcess(count));
ipcMain.handle('license:recordUsage', (_, sessionId, count, colorCounts) => {
  return licenseManager.recordUsage(sessionId, count, colorCounts);
});

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

// ─── Claude Vision API Key ───
ipcMain.handle('settings:getClaudeKey', () => {
  // Check custom key first (user-entered), then platform key (from license validation)
  const customRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('claude_api_key');
  const customKey = customRow ? customRow.value : null;
  const platformKey = licenseManager.getClaudeApiKey();
  const activeKey = customKey || platformKey;

  const license = licenseManager.getCurrent();
  const tier = (license.tier || '').toLowerCase();
  return {
    hasKey: !!activeKey,
    source: customKey ? 'custom' : platformKey ? 'platform' : 'none',
    eligible: ['pro', 'unlimited'].includes(tier) || license.isUnlimited === true || license.active,
    tier,
  };
});

ipcMain.handle('settings:setClaudeKey', (_, key) => {
  // Custom key override — store in settings and pass to worker
  if (key) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('claude_api_key', key);
    if (workerManager) workerManager.setClaudeApiKey(key);
    console.log('[main] Claude Vision key saved and sent to worker');
  } else {
    db.prepare('DELETE FROM settings WHERE key = ?').run('claude_api_key');
    // Revert to platform key if available
    const platformKey = licenseManager.getClaudeApiKey();
    if (workerManager && platformKey) workerManager.setClaudeApiKey(platformKey);
  }
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
