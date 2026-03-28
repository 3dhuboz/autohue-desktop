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
const API_BASE = 'https://autohue-api.steve-700.workers.dev';

async function checkForUpdates() {
  try {
    const currentVersion = app.getVersion();
    const res = await fetch(`${API_BASE}/api/releases/latest`);
    if (!res.ok) return;
    const data = await res.json();
    const latestVersion = data.version;

    if (!latestVersion || latestVersion === currentVersion) return;

    // Compare semver: only prompt if latest > current
    const current = currentVersion.split('.').map(Number);
    const latest = latestVersion.split('.').map(Number);
    const isNewer = latest[0] > current[0]
      || (latest[0] === current[0] && latest[1] > current[1])
      || (latest[0] === current[0] && latest[1] === current[1] && latest[2] > current[2]);
    if (!isNewer) return;

    const platform = process.platform === 'darwin' ? 'mac' : 'windows';
    const fileInfo = platform === 'mac' ? data.mac : data.windows;
    const sizeMB = fileInfo ? (fileInfo.size / 1024 / 1024).toFixed(0) : '?';

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `AutoHue v${latestVersion} is available`,
      detail: `You're running v${currentVersion}. Download v${latestVersion} (${sizeMB} MB)?\n\nThe update will download and install automatically.`,
      buttons: ['Update Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      downloadAndInstallUpdate(latestVersion, platform);
    }
  } catch (err) {
    console.error('[update-check] Failed:', err.message);
  }
}

function downloadAndInstallUpdate(version, platform) {
  const downloadUrl = `${API_BASE}/api/download/latest/${platform}`;
  const fs = require('fs');
  const { spawn } = require('child_process');
  const tmpPath = path.join(app.getPath('temp'), `AutoHue-Setup-${version}.exe`);

  // Show progress in a new window
  const progressWin = new BrowserWindow({
    width: 420, height: 180, resizable: false, frame: false,
    alwaysOnTop: true, backgroundColor: '#09090b',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  progressWin.loadURL(`data:text/html,${encodeURIComponent(`
    <!DOCTYPE html><html><head><style>
      body { margin:0; padding:24px; background:#09090b; color:#fff; font-family:system-ui; display:flex; flex-direction:column; justify-content:center; }
      h3 { margin:0 0 8px; font-size:14px; font-weight:600; }
      .bar { height:6px; background:#1a1a2e; border-radius:3px; overflow:hidden; margin:8px 0; }
      .fill { height:100%; background:linear-gradient(90deg,#dc2626,#ef4444); border-radius:3px; transition:width 0.3s; }
      .info { font-size:11px; color:rgba(255,255,255,0.4); }
    </style></head><body>
      <h3 id="title">Downloading AutoHue v${version}...</h3>
      <div class="bar"><div class="fill" id="bar" style="width:0%"></div></div>
      <div class="info" id="info">Starting download...</div>
    </body></html>
  `)}`);

  // Download using Electron's net module for progress tracking
  const { net } = require('electron');
  const request = net.request(downloadUrl);
  let received = 0;
  let totalSize = 0;
  const chunks = [];

  request.on('response', (response) => {
    totalSize = parseInt(response.headers['content-length'] || '0', 10);

    response.on('data', (chunk) => {
      chunks.push(chunk);
      received += chunk.length;
      const pct = totalSize > 0 ? Math.round((received / totalSize) * 100) : 0;
      const mb = (received / 1024 / 1024).toFixed(1);
      const totalMb = (totalSize / 1024 / 1024).toFixed(0);
      if (!progressWin.isDestroyed()) {
        progressWin.webContents.executeJavaScript(`
          document.getElementById('bar').style.width='${pct}%';
          document.getElementById('info').textContent='${mb} / ${totalMb} MB (${pct}%)';
        `).catch(() => {});
      }
    });

    response.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(tmpPath, buffer);

        if (!progressWin.isDestroyed()) {
          progressWin.webContents.executeJavaScript(`
            document.getElementById('title').textContent='Installing...';
            document.getElementById('info').textContent='Launching installer — the app will restart.';
            document.getElementById('bar').style.width='100%';
            document.getElementById('bar').style.background='linear-gradient(90deg,#22c55e,#4ade80)';
          `).catch(() => {});
        }

        // Launch installer then relaunch app via a helper batch script
        setTimeout(() => {
          const fs = require('fs');
          const exePath = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'autohue-desktop', 'AutoHue.exe');
          const batPath = path.join(app.getPath('temp'), 'autohue-update.bat');
          // Batch script: wait for installer, then launch app
          fs.writeFileSync(batPath, [
            '@echo off',
            `start /wait "" "${tmpPath}" /S`,
            'timeout /t 2 /nobreak >nul',
            `start "" "${exePath}"`,
            `del "%~f0"`,
          ].join('\r\n'));
          spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
          app.quit();
        }, 1500);
      } catch (err) {
        console.error('[update] Failed to save:', err.message);
        if (!progressWin.isDestroyed()) progressWin.close();
        dialog.showErrorBox('Update Failed', 'Could not save the update file. Please download manually from autohue.app/download');
      }
    });

    response.on('error', (err) => {
      console.error('[update] Download error:', err.message);
      if (!progressWin.isDestroyed()) progressWin.close();
      dialog.showErrorBox('Update Failed', 'Download failed. Please try again later.');
    });
  });

  request.on('error', (err) => {
    console.error('[update] Request error:', err.message);
    if (!progressWin.isDestroyed()) progressWin.close();
  });

  request.end();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, '../build/icon.ico'),
    backgroundColor: '#09090b',
    show: true,
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
    mainWindow.focus();
  });

  // Prevent window.open() from creating blank Electron windows (e.g. ZIP download)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('/download/') || url.startsWith('http')) {
      // Use Electron's download manager for worker download URLs
      if (url.includes('/download/')) {
        mainWindow.webContents.downloadURL(url);
      } else {
        require('electron').shell.openExternal(url);
      }
    }
    return { action: 'deny' };
  });

  // Track download completion — show save dialog for large ZIPs
  mainWindow.webContents.session.on('will-download', (event, item) => {
    const filename = item.getFilename() || 'sorted_photos.zip';
    // Let Electron show its save dialog (default behavior)
    // The item already has a suggested filename
    // setSuggestedFilename not available in all Electron versions
    if (typeof item.setSuggestedFilename === 'function') item.setSuggestedFilename(filename);

    item.once('done', (e, state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (state === 'completed') {
          mainWindow.webContents.send('download:complete', { path: item.getSavePath(), filename });
        } else if (state === 'cancelled') {
          mainWindow.webContents.send('download:cancelled');
        }
      }
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const fs = require('fs');
  const logFile = path.join(app.getPath('userData'), 'debug-startup.log');
  const log = (msg) => { const line = `[${new Date().toISOString()}] ${msg}\n`; fs.appendFileSync(logFile, line); console.log(msg); };
  log('App startup — v' + app.getVersion());

  // 1. Initialize SQLite database (async — sql.js loads WASM)
  log('Step 1: initDatabase...');
  const dbPath = path.join(app.getPath('userData'), 'autohue.db');
  db = await initDatabase(dbPath);
  log('Step 1: done');

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

  // 3. Get API keys — OpenRouter + Claude
  const customKeyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('claude_api_key');
  const claudeKey = (customKeyRow ? customKeyRow.value : null) || licenseManager.getClaudeApiKey();
  // Multi-key support: read from openrouter_api_keys (JSON array) or fall back to single key
  let openRouterKeys = [];
  const orKeysRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('openrouter_api_keys');
  if (orKeysRow) {
    try { openRouterKeys = JSON.parse(orKeysRow.value); } catch {}
  }
  if (openRouterKeys.length === 0) {
    const orKeyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('openrouter_api_key');
    if (orKeyRow && orKeyRow.value) openRouterKeys = [orKeyRow.value];
  }
  const modelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('vision_model');
  const visionModel = modelRow ? modelRow.value : 'google/gemini-2.0-flash-001';
  if (openRouterKeys.length > 0) console.log(`[main] OpenRouter: ${openRouterKeys.length} keys loaded`);

  // 4. Start the AI worker process
  const storagePath = path.join(app.getPath('userData'), 'worker-data');
  fs.mkdirSync(storagePath, { recursive: true });
  // Write keyfiles so worker can read them directly
  const claudeKeyPath = path.join(storagePath, '.claude-key');
  const orKeysPath = path.join(storagePath, '.openrouter-keys');
  if (claudeKey) { fs.writeFileSync(claudeKeyPath, claudeKey, 'utf8'); } else { try { fs.unlinkSync(claudeKeyPath); } catch {} }
  if (openRouterKeys.length > 0) { fs.writeFileSync(orKeysPath, openRouterKeys.join('\n'), 'utf8'); }

  const sortByTypeRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('sort_by_type');
  const sortByType = sortByTypeRow ? sortByTypeRow.value === 'true' : false;
  const detectFeaturesRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('detect_features');
  const detectFeatures = detectFeaturesRow ? detectFeaturesRow.value === 'true' : false;

  workerManager = new WorkerManager(storagePath);
  if (claudeKey) workerManager.setClaudeApiKey(claudeKey);
  workerManager.openRouterKeys = openRouterKeys;
  workerManager.visionModel = visionModel;
  workerManager.sortByType = sortByType;
  workerManager.detectFeatures = detectFeatures;
  log('Step 4: starting worker...');
  workerManager.start().then(() => log('Step 4: worker ready')).catch(err => {
    log('Step 4: worker FAILED — ' + err.message);
  });

  // Re-validate license in background (may fetch Claude key if first run after upgrade)
  log('Step 4b: revalidating license...');
  licenseManager.tryRevalidate().then(() => {
    const freshKey = licenseManager.getClaudeApiKey();
    if (freshKey && freshKey !== claudeKey) {
      workerManager.setClaudeApiKey(freshKey);
    }
  }).catch(() => {});

  // 5. Create window
  log('Step 5: createWindow...');
  createWindow();
  log('Step 5: window created');

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

  // 6. Check for updates via R2 API (production only)
  if (!isDev) {
    checkForUpdates();
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
  // Forward relevant settings to worker
  if (key === 'sort_by_type' && workerManager?.process) {
    workerManager.process.send({ type: 'set-sort-by-type', enabled: value === 'true' });
  }
  if (key === 'detect_features' && workerManager?.process) {
    workerManager.process.send({ type: 'set-detect-features', enabled: value === 'true' });
  }
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
  const orRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('openrouter_api_key');
  return {
    hasKey: !!activeKey,
    hasOpenRouterKey: !!(orRow && orRow.value),
    source: customKey ? 'custom' : platformKey ? 'platform' : 'none',
    eligible: ['pro', 'unlimited'].includes(tier) || license.isUnlimited === true || license.active,
    tier,
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

// ─── OpenRouter API Key ───
ipcMain.handle('settings:setOpenRouterKey', (_, key) => {
  const fs = require('fs');
  const storagePath = path.join(app.getPath('userData'), 'worker-data');
  const keyFilePath = path.join(storagePath, '.openrouter-key');
  if (key) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('openrouter_api_key', key);
    fs.mkdirSync(storagePath, { recursive: true });
    fs.writeFileSync(keyFilePath, key, 'utf8');
    if (workerManager) workerManager.setOpenRouterKey(key);
  } else {
    db.prepare('DELETE FROM settings WHERE key = ?').run('openrouter_api_key');
    try { fs.unlinkSync(keyFilePath); } catch {}
  }
  return true;
});

ipcMain.handle('settings:getOpenRouterKey', () => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('openrouter_api_key');
  return { hasKey: !!(row && row.value) };
});

// ─── Sort Resume ───
ipcMain.handle('sort:saveProgress', (_, sessionId, data) => {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO processing_history (session_id, image_count, color_counts, input_path, output_path, status, processed_files, total_count)
      VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?)
    `).run(sessionId, data.processed || 0, data.colorCounts ? JSON.stringify(data.colorCounts) : null,
      data.inputPath || null, data.outputPath || null,
      data.processedFiles ? JSON.stringify(data.processedFiles) : null, data.totalCount || 0);
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('sort:getIncomplete', () => {
  try {
    const rows = db.prepare("SELECT * FROM processing_history WHERE status = 'in_progress' ORDER BY created_at DESC LIMIT 5").all();
    return rows.map(r => ({
      ...r,
      processedFiles: r.processed_files ? JSON.parse(r.processed_files) : [],
      colorCounts: r.color_counts ? JSON.parse(r.color_counts) : {},
    }));
  } catch { return []; }
});

ipcMain.handle('sort:markComplete', (_, sessionId) => {
  try {
    db.prepare("UPDATE processing_history SET status = 'completed' WHERE session_id = ?").run(sessionId);
    return true;
  } catch { return false; }
});

// ─── History ───
ipcMain.handle('history:list', () => {
  return db.prepare("SELECT * FROM processing_history WHERE status != 'in_progress' ORDER BY created_at DESC LIMIT 100").all();
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
