# AutoHue — Next Session (v3.13.1)

## Session Summary — What Was Done
This was a massive session covering CI/CD pipeline, payment integration, animation overhaul, accuracy fixes, and UX improvements.

### CI/CD Pipeline (fully automated)
- Moved GitHub Actions workflow to correct location, added R2 upload
- Fixed filename (spaces not hyphens), fixed --remote flag, fixed CF account ID
- Release flow: `git tag vX.Y.Z && git push` → builds Win+Mac → uploads to GitHub Releases + R2 → auto-update serves to all customers
- Created `release.sh` (desktop), `deploy.sh` (site + admin) — safe deploy scripts with type check + smoke tests

### Payment Integration (live on autohue.app)
- Pricing page: monthly/yearly billing toggle, aligned tiers (Hobbyist $19/$24, Pro $79/$99, Unlimited $199/$249)
- PayPal checkout page with client-side SDK — 6 subscription plan IDs configured
- Credit pack purchases ($5/$10/$20/$50) with one-time PayPal payment
- Credits visually de-emphasized vs subscriptions (per-image cost shown, upsell to Pro)
- Success page shows license key with click-to-copy
- /api/credits/purchase endpoint on admin worker
- /api/paypal/activate-subscription generates + emails license key via Resend
- Site deployed via `_site/` clean directory to Cloudflare Pages

### Desktop App Improvements
- **Sort Animation**: Canvas particle system with bezier paths, thumbnails, color cards
- **Spring Physics Gauges**: Continuous motion with damping (no more stop/start)
- **Interpolated Particles**: Ghost particles fill gaps between poll intervals for smooth flow
- **Bridge Animation**: Shows "Preparing AI Pipeline" for all file types (not just archives)
- **Compact Layout**: Reduced spacing, smaller cards, hidden classification UI during extraction
- **Pipeline Section**: Animated data flow lines, glow on active steps, live stats footer
- **Single Instance Lock**: Prevents duplicate windows
- **Tray Minimize**: Minimize → tray, Close → prompt (Minimize to Tray / Quit)
- **History Delete Confirmation**: Prompt before removing sessions
- **ZIP Timer**: Elapsed seconds on download button
- **Pipeline Step Numbers**: 1-5 badges on each step
- **No Auto-Open Folder**: User clicks "Open in Explorer" on completion

### Accuracy & Sorting
- **Color Prompt**: Always uses proven single-word baseline prompt regardless of sort options
- **Type/Feature**: Asked as secondary question on line 2, can't interfere with color accuracy
- **All 13 Colors**: Consistent across all prompt variants + batch prompt
- **Champagne/Gold Rule**: Added "gold metallic/rose gold/bronze metallic = cream"
- **Vehicle Type Sorting**: Fixed `folderName` → `colorName` bug in ALL 3 processOneImage functions
- **Feature Detection**: _highlights/ folder created with burnout/drift/wheelstand copies
- **Tier Gating**: Vehicle type + feature detection locked to Pro/Unlimited tiers
- **Smart Key Rotation**: Escalating backoff — dead keys disabled for 1hr, rate-limited keys back off exponentially

### Admin Dashboard
- **System Health Tab**: OpenRouter credit monitor (all 5 keys, usage, status badges)
- **Settings Toasts**: Toggle changes show toast confirming worker received the value
- **Debug Logging**: Worker logs model response when SORT_BY_TYPE or DETECT_FEATURES is on
- **Health Endpoint**: Now reports sortByType and detectFeatures state

## Known Issues / Still TODO

### Critical
1. **sql-wasm.js ENOENT on quit** — v3.13.1 adds locateFile fix, needs testing to confirm it's resolved
2. **Vehicle type folders still not created** — Settings show ON, worker may not be receiving IPC. Toasts added in v3.13.0 for debugging. Check toast output after toggling.
3. **Auto-relaunch after update** — Works but takes ~30 seconds. Consider removing /S flag and using interactive NSIS with "Launch AutoHue" checkbox instead.

### UI/Animation
4. **Sort animation still has some burst behavior** — v3.13.0 added ghost particles for interpolation. Needs testing to verify smooth flow.
5. **Gauges show 0 speed on some sessions** — Fixed in v3.10.0 (calculates from elapsed time) but may still occur if startTime not set on session resume.
6. **Completion screen speed bug** — Fixed 996 img/sec bug in v3.10.1. Verify it shows realistic values.
7. **Progress bar could be smoother** — Currently 1000ms CSS transition, could use spring physics like gauges.

### Features
8. **Pause during extraction** — Pause button sets status to 'paused' but ZIP stream extraction can't be interrupted mid-stream. Show "Will pause after extraction completes" message.
9. **History shows "No sessions"** — History page works but may not show sessions if recording failed. Check if completion recording fires correctly.
10. **Credit top-up in-app** — Currently only via website. Could add a "Buy Credits" button in the app.
11. **RESEND_API_KEY** — Needs to be set on admin worker for license key emails: `cd autohue-admin/workers/api && npx wrangler secret put RESEND_API_KEY`

### Accuracy Refinement
12. **Color rules are iterative** — More testing with real event photos needed. Rules in COLOR_LIST_STR and prompt text.
13. **Brown vs Cream** — Champagne/gold cars sometimes classified as brown. Added "gold metallic/rose gold/bronze metallic = cream" rule.
14. **Two-line prompt format** — Model may not always return type/feature on line 2. Parser has fallback for single-line format.

### Infrastructure
15. **Code signing** — Windows SmartScreen warns without certificate (manual purchase needed)
16. **Mac build testing** — DMG builds via CI but untested on actual Mac hardware
17. **Node.js 20 deprecation** — GitHub Actions warns about Node.js 20 in actions. Need to update to actions/checkout@v5 etc before June 2026.

## Architecture
- **Desktop**: github.com/3dhuboz/autohue-desktop (v3.13.1)
- **Website**: github.com/3dhuboz/autohue-site (deployed via `bash deploy.sh`)
- **Admin**: github.com/3dhuboz/autohue-admin (deployed via `bash workers/api/deploy.sh`)
- **API Worker**: autohue-api.steve-700.workers.dev
- **R2**: autohue-releases bucket (auto-deployed via CI)
- **Worker**: worker/server.js (bundled via esbuild)
- **Renderer**: React + Vite, polls /status/:sessionId every 800ms
- **Electron main**: electron/main.js (single instance, tray, auto-update)
- **License**: electron/license.js + electron/database.js (sql.js WASM)
- **5 OpenRouter keys**: %APPDATA%/autohue-desktop/worker-data/.openrouter-keys
- **Model**: google/gemini-2.0-flash-001

## PayPal Plan IDs
- Hobbyist Monthly: P-7A011980S20678457NHDXQPA ($24/mo)
- Hobbyist Yearly: P-8CX575826F396683UNHDXRKI ($19/mo billed yearly)
- Pro Monthly: P-67S36319Y97790222NHDXTAI ($99/mo)
- Pro Yearly: P-2CF442047U804381PNHDXSKY ($79/mo billed yearly)
- Unlimited Monthly: P-4XX00824VW5461919NHDXT4Y ($249/mo)
- Unlimited Yearly: P-6BJ69046B7785863UNHDXUKI ($199/mo billed yearly)

## Color Categories (13 total)
red, blue, green, yellow, orange, purple, pink, brown, black, white, silver-grey, cream, please-double-check

## Deploy Commands
```bash
# Desktop release
cd autohue-desktop
bash release.sh  # prompts for version, tags, pushes, monitors CI, verifies R2

# Website
cd autohue-site
bash deploy.sh  # validates files, builds _site, deploys to CF Pages, smoke tests

# Admin API
cd autohue-admin/workers/api
bash deploy.sh  # type checks, snapshots endpoints, deploys, smoke tests

# Admin Dashboard
cd autohue-admin
npx vite build && npx wrangler pages deploy dist --project-name=autohue-admin
```

## Git Push (if credential prompt hangs)
Use the GitHub PAT token in the push URL — check credential manager or use `gh auth` to authenticate.
