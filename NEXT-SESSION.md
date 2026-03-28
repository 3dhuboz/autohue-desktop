# AutoHue — Next Session: STABILIZATION (v3.4.0)

## CRITICAL: Do NOT add features. Fix bugs first.

## Root Causes Identified
1. **Worker crashes mid-sort (OOM)** — Jimp loads multiple high-res images concurrently for batch classification. With BATCH_CONCURRENCY=5 and large ZIPs (1000+ images), memory spikes and kills the worker process. Worker auto-restarts but session state is lost.
2. **Obfuscation destroys the app** — javascript-obfuscator produces 8MB+ files that infinite-loop. NEVER run `node scripts/obfuscate-electron.js`. Remove it from build pipeline. Code is in a private repo — obfuscation not needed.
3. **Worker only loads 1 OpenRouter key** — Despite 5 keys in `.openrouter-keys` file and env var `OPENROUTER_KEY=key1,key2,...`, the debug log shows "1 keys". The comma-split key loading works in isolation but something in the bundled worker differs.

## Bugs to Fix (in order)

### P0: Worker crash / classification failure
- Add memory limit: process images 1 at a time with serial fallback when memory is low
- Add `--max-old-space-size=4096` to worker fork options
- Reduce BATCH_CONCURRENCY to 2 (not 5)
- Add try/catch around every Jimp.read() with explicit error logging
- Log worker crash reason: capture `process.on('exit')` code and write to debug log

### P1: Key loading
- Debug why 5 keys become 1 in the worker — add explicit logging of OPENROUTER_KEY env var length and split results
- Verify the comma-separated env var works in forked child process

### P2: UI fixes
- Health endpoint: report "ready" when API keys are set even if ONNX models not loaded
- Stream animation: verify it works (never tested in production)
- Extraction animation: hide when paused (code fixed, needs rebuild)
- "Starting..." label in animation: should show actual classification progress

### P3: Website
- CF Pages autohue-site: change build command to `npx next build`, output to `.next`
- Verify pricing shows $24/$99/$249 after deploy
- Remove "Buy Credits" section (not implemented yet)

## Build Process (CORRECT ORDER)
```bash
cd autohue-desktop

# 1. Build renderer
npx vite build renderer

# 2. Build worker bundle
node scripts/build-worker.js

# 3. DO NOT RUN obfuscate-electron.js

# 4. Build installer
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win nsis

# 5. Verify clean electron files in build
npx asar list dist/win-unpacked/resources/app.asar | grep electron/
# Should show: main.js, preload.js, worker-manager.js, license.js, database.js, rules-sync.js
# Each should be <20KB, NOT 8MB

# 6. Test locally before deploying
# Run dist/win-unpacked/AutoHue.exe and verify it opens + sorts
```

## Architecture Reference
- Desktop: github.com/3dhuboz/autohue-desktop (private)
- Admin: github.com/3dhuboz/autohue-admin (private)
- Website: github.com/3dhuboz/autohue-site (private)
- API: autohue-api.steve-700.workers.dev (Hono + D1 + R2)
- Admin UI: autohue-admin.pages.dev
- Website: autohue.app (CF Pages, connected to autohue-site repo)
- R2: autohue-releases bucket
- 5 OpenRouter keys in DB (openrouter_api_keys JSON array)
- Claude Vision key in DB (claude_api_key)
- Model: google/gemini-2.0-flash-001

## Pricing
- Trial: Free (50/day, 7 days)
- Hobbyist: $19/$24/mo (300/day)
- Pro: $79/$99/mo (2,000/day)
- Unlimited: $199/$249/mo (10,000/day)

## PayPal Plan IDs
- Hobbyist Monthly: P-0E0766276B1139608NHDRU3Y
- Hobbyist Yearly: P-04J7698388447105MNHDRU4A
- Pro Monthly: P-46801253NN0274710NHDRU4A
- Pro Yearly: P-45T46267H7712901ENHDRU4I
- Unlimited Monthly: P-41F22498TS119561PNHDRU4Q
- Unlimited Yearly: P-2B694765K85756836NHDRU4Q
