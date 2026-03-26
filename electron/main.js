const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { initDatabase } = require('./database');
const { LicenseManager } = require('./license');
const { WorkerManager } = require('./worker-manager');
const { RulesSync } = require('./rules-sync');

let mainWindow;
let tray = null;
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

  // 2b. Auto-seed trial license if no license exists (frictionless onboarding)
  const current = licenseManager.getCurrent();
  if (!current.active) {
    if (isDev) {
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
    } else {
      // Auto-activate 7-day trial — no key needed, just install and go
      console.log('[license] No license found — auto-activating 7-day trial (50 images/day)');
      const trialExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(`
        INSERT OR REPLACE INTO license (id, license_key, tier, daily_limit, machine_id,
          activated_at, expires_at, last_validated, validation_response, subscription_status)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'AUTO-TRIAL',
        'trial',
        50,
        licenseManager.machineId || 'unknown',
        new Date().toISOString(),
        trialExpiry,
        new Date().toISOString(),
        null,
        'active',
      );
    }
  }

  // 3. Get API keys — Claude + Gemini
  const customKeyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('claude_api_key');
  const claudeKey = (customKeyRow ? customKeyRow.value : null) || licenseManager.getClaudeApiKey();
  const geminiKeyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('gemini_api_key');
  const geminiKey = geminiKeyRow ? geminiKeyRow.value : null;
  const engineRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('vision_engine');
  const visionEngine = engineRow ? engineRow.value : 'auto';
  if (geminiKey) console.log('[main] Gemini API key available — high-speed classifier enabled');
  if (claudeKey) console.log(`[main] Claude Vision API key available (${customKeyRow ? 'custom' : 'platform'})`);

  // 4. Start the AI worker process
  const storagePath = path.join(app.getPath('userData'), 'worker-data');
  const fs = require('fs');
  fs.mkdirSync(storagePath, { recursive: true });
  // Write keyfiles so worker can read them directly
  const claudeKeyPath = path.join(storagePath, '.claude-key');
  const geminiKeyPath = path.join(storagePath, '.gemini-key');
  if (claudeKey) { fs.writeFileSync(claudeKeyPath, claudeKey, 'utf8'); } else { try { fs.unlinkSync(claudeKeyPath); } catch {} }
  if (geminiKey) { fs.writeFileSync(geminiKeyPath, geminiKey, 'utf8'); } else { try { fs.unlinkSync(geminiKeyPath); } catch {} }

  workerManager = new WorkerManager(storagePath);
  if (claudeKey) workerManager.setClaudeApiKey(claudeKey);
  if (geminiKey) workerManager.setGeminiApiKey(geminiKey);
  workerManager.visionEngine = visionEngine;
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

  // 5b. System tray — keeps app running when window is closed
  try {
    // Try multiple icon paths — packaged vs dev, and different sizes
    const iconCandidates = app.isPackaged
      ? [
          path.join(process.resourcesPath, 'app.asar', 'build', 'icon-16.png'),
          path.join(process.resourcesPath, 'app.asar', 'build', 'icon.png'),
          path.join(process.resourcesPath, 'build', 'icon.png'),
          path.join(__dirname, '..', 'build', 'icon.png'),
        ]
      : [
          path.join(__dirname, '..', 'build', 'icon-16.png'),
          path.join(__dirname, '..', 'build', 'icon.png'),
        ];
    const fs2 = require('fs');
    let iconPath = iconCandidates.find(p => fs2.existsSync(p)) || iconCandidates[0];
    console.log(`[tray] Using icon: ${iconPath} (exists: ${fs2.existsSync(iconPath)})`);
    const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(trayIcon);
    tray.setToolTip('AutoHue — AI Car Photo Sorter');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open AutoHue', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createWindow(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.quit(); } },
    ]));
    tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  } catch (err) {
    console.warn('[tray] Failed to create:', err.message);
  }

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
  // Don't quit — keep running in system tray for background sorting
  // Worker keeps processing even without the window
  if (process.platform === 'darwin') return; // macOS convention
  // On Windows, keep alive if there's an active sort
  mainWindow = null;
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
  const geminiRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('gemini_api_key');
  const hasGemini = !!(geminiRow && geminiRow.value);
  const engineRow2 = db.prepare('SELECT value FROM settings WHERE key = ?').get('vision_engine');
  return {
    hasKey: !!activeKey,
    hasGeminiKey: hasGemini,
    source: customKey ? 'custom' : platformKey ? 'platform' : 'none',
    eligible: ['pro', 'unlimited'].includes(tier) || license.isUnlimited === true || license.active,
    tier,
    visionEngine: engineRow2 ? engineRow2.value : 'auto',
  };
});

ipcMain.handle('settings:setClaudeKey', (_, key) => {
  // Custom key override — store in settings, keyfile, and pass to worker
  const fs = require('fs');
  const storagePath = path.join(app.getPath('userData'), 'worker-data');
  const keyFilePath = path.join(storagePath, '.claude-key');
  if (key) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('claude_api_key', key);
    fs.mkdirSync(storagePath, { recursive: true });
    fs.writeFileSync(keyFilePath, key, 'utf8');
    if (workerManager) workerManager.setClaudeApiKey(key);
    console.log('[main] Claude Vision key saved to DB + keyfile + sent to worker');
  } else {
    db.prepare('DELETE FROM settings WHERE key = ?').run('claude_api_key');
    try { fs.unlinkSync(keyFilePath); } catch {}
    const platformKey = licenseManager.getClaudeApiKey();
    if (workerManager && platformKey) workerManager.setClaudeApiKey(platformKey);
  }
  return true;
});

// ─── Gemini API Key ───
ipcMain.handle('settings:setGeminiKey', (_, key) => {
  const fs = require('fs');
  const storagePath = path.join(app.getPath('userData'), 'worker-data');
  const keyFilePath = path.join(storagePath, '.gemini-key');
  if (key) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('gemini_api_key', key);
    fs.mkdirSync(storagePath, { recursive: true });
    fs.writeFileSync(keyFilePath, key, 'utf8');
    if (workerManager) workerManager.setGeminiApiKey(key);
    console.log('[main] Gemini key saved to DB + keyfile + sent to worker');
  } else {
    db.prepare('DELETE FROM settings WHERE key = ?').run('gemini_api_key');
    try { fs.unlinkSync(keyFilePath); } catch {}
  }
  return true;
});

ipcMain.handle('settings:getGeminiKey', () => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('gemini_api_key');
  return { hasKey: !!(row && row.value) };
});

// ─── Vision Engine Selection ───
ipcMain.handle('settings:setVisionEngine', (_, engine) => {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('vision_engine', engine);
  if (workerManager) workerManager.setVisionEngine(engine);
  console.log(`[main] Vision engine set to: ${engine}`);
  return true;
});

ipcMain.handle('settings:getVisionEngine', () => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('vision_engine');
  return row ? row.value : 'auto';
});

// ─── History ───
ipcMain.handle('history:list', () => {
  return db.prepare('SELECT * FROM processing_history ORDER BY created_at DESC LIMIT 100').all();
});

ipcMain.handle('history:delete', (_, id) => {
  db.prepare('DELETE FROM processing_history WHERE id = ?').run(id);
  return true;
});

ipcMain.handle('history:rename', (_, id, name) => {
  db.prepare('UPDATE processing_history SET name = ? WHERE id = ?').run(name, id);
  return true;
});

ipcMain.handle('history:getOutputPath', (_, sessionId) => {
  const storagePath = path.join(app.getPath('userData'), 'worker-data', 'output', sessionId);
  const fs = require('fs');
  return fs.existsSync(storagePath) ? storagePath : null;
});

ipcMain.handle('history:getSessionFiles', (_, sessionId) => {
  const fs = require('fs');
  const outputDir = path.join(app.getPath('userData'), 'worker-data', 'output', sessionId);
  if (!fs.existsSync(outputDir)) return [];
  const result = [];
  for (const colorDir of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (!colorDir.isDirectory()) continue;
    const colorPath = path.join(outputDir, colorDir.name);
    const files = fs.readdirSync(colorPath).filter(f => /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(f));
    for (const file of files) {
      result.push({ color: colorDir.name, filename: file, path: path.join(colorPath, file) });
    }
  }
  return result;
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
