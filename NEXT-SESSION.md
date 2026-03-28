# AutoHue — Next Session: STABILIZATION (v3.4.1)

## What Works (v3.4.0)
- App opens and starts (no more crash/hang)
- License gate works (trial auto-activates)
- Extraction works (ZIP unpacking)
- Classification runs (images get sorted into folders)
- Completion screen shows with Download ZIP / Open in Explorer
- Sharp is bundled (native bindings present)
- In-app update checker + download with progress bar
- API worker deployed with correct pricing + min version enforcement
- Website deployed at autohue.app
- Admin dashboard at autohue-admin.pages.dev
- PayPal plans created (6 plans)

## Critical Bugs to Fix

### 1. Only 1 OpenRouter key loads (should be 5)
- DB has 5 keys, env var passes 5 comma-separated
- Worker debug log shows "1 keys"
- esbuild minification may be mangling `process.env.OPENROUTER_KEY`
- FIX: Add explicit logging in worker source: `console.log('ENV OPENROUTER_KEY length:', (process.env.OPENROUTER_KEY || '').length)`
- Or bypass env and only use the `.openrouter-keys` file (more reliable)

### 2. Color counts show 0 / results not flowing to UI
- Completion screen: "0 color folders", "0 colors detected"
- Speed shows 0.0 img/sec during processing
- The `/status/:sessionId` endpoint returns `new_results` but the frontend isn't receiving them
- CHECK: Is the `color` field in results populated? Is the polling working?

### 3. Stream animation stuck at "STARTING..."
- Animation component receives `results` array from SortPage
- SortPage maps `r.file || r.filename` — worker sends `filename` field
- Animation never shows dots flowing — either results array is empty or animation loop not triggering
- TEST: Add console.log in SortAnimation to see if results arrive

### 4. Gauges don't animate
- Speed, Progress, Accuracy, ETA, Time Saved, Cost Saved — all static during processing
- The TachoGauge component needs values to update — check if stats are being set correctly

### 5. ZIP download needs toast + animation
- User wants visual feedback when ZIP is being built
- Show "Building ZIP..." overlay, then toast when download starts
- The `will-download` handler sends `download:complete` event — hook into that

### 6. Website pricing
- CF Pages build for autohue-site needs build command fixed to `npx next build`
- Current build may be failing — check CF Pages dashboard
- SmartScreen notice added to download page (pushed)

## Performance
- 130 images took 32 minutes — that's ~0.07 img/sec (should be 3-5 img/sec)
- Root cause: 1 key instead of 5, possible sharp not actually being used despite being bundled
- Verify sharp loads: check worker startup log for "sharp not available" vs no message

## Architecture
- Desktop: github.com/3dhuboz/autohue-desktop (v3.4.0)
- Admin: github.com/3dhuboz/autohue-admin
- Website: github.com/3dhuboz/autohue-site
- API: autohue-api.steve-700.workers.dev
- R2: autohue-releases bucket
- 5 OpenRouter keys in DB + .openrouter-keys file
- Model: google/gemini-2.0-flash-001
- NO OBFUSCATION — removed from build pipeline, code in private repo

## Build Process
```bash
cd autohue-desktop
npx vite build renderer
node scripts/build-worker.js    # Must show "Copying native module: sharp"
# DO NOT run obfuscate-electron.js
rm -rf dist/                    # Always clean first
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win nsis
# Verify: npx asar list dist/win-unpacked/resources/app.asar | grep electron/
# All files should be <25KB (not 8MB obfuscated)
```

## Feature Requests (AFTER stabilization)
- Accuracy/speed differences shown per tier
- Vehicle type sorting UI toggles
- Feature shot detection toggles
- ZIP build animation + toast
- Clickable link to return to active session
- Admin: usage stats, bonus credits, enhanced dashboard
