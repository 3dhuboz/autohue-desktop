# AutoHue — Next Session Notes

## Current Version: v3.2.1

## What Works
- OpenRouter API with 5-key rotation (4.4 img/sec achieved)
- Gemini 2.0 Flash model (fast, no thinking overhead)
- ZIP extraction with yauzl pre-scan count
- Vehicle type sorting toggle (cars/bikes/people)
- Feature shot detection toggle (burnout/wheelstand/flames/drift/launch)
- Color accuracy: grey-green metallic -> silver-grey, picks largest car
- Auto-update via electron-updater
- Landing page at autohue.app with direct download link
- CI auto-publishes releases (draft -> publish after both platforms build)
- Pause/Resume works during both extraction and classification

## Known Issues Still to Verify
1. **Completion screen** — finalStatsRef added but needs testing with real sort
2. **Animation stop** — phase check fixed ('processing' not 'sorting'), needs testing
3. **ZIP download** — switched to window.open(), needs testing
4. **History** — recordUsage now updates existing rows, needs testing
5. **Image count** — pre-scan now excludes __MACOSX, total set after extraction

## Architecture
- Electron app: electron/main.js, electron/preload.js, electron/worker-manager.js
- Worker: worker/server.js (bundled to worker/dist/server.js via esbuild)
- Renderer: renderer/src/ (React + Vite)
- Site: separate repo (autohue-site on Cloudflare Pages at autohue.app)

## API Keys
- 5 OpenRouter keys in .openrouter-keys (newline-separated)
- Path: %APPDATA%/autohue-desktop/worker-data/.openrouter-keys
- DB: settings table (openrouter_api_keys as JSON array)
- Worker merges from env var + keyfile + single keyfile (deduplicated via Set)
- Round-robin rotation with 10s backoff on rate limit

## Key Files
- worker/server.js — ALL classification logic, API calls, file sorting
- renderer/src/pages/SortPage.tsx — main UI, polling, completion detection
- renderer/src/pages/SettingsPage.tsx — settings toggles
- electron/main.js — IPC handlers, worker lifecycle
- electron/worker-manager.js — forks/manages worker process
- scripts/build-worker.js — esbuild bundle + native module copy

## Enterprise Feature (Planned for v4.0.0)
- License plate / rego reading from photos
- Car make/model identification
- Per-vehicle folders (by rego: CAL4SX/, by model: HSV-Clubsport/)
- Cross-event database (SQLite: plate -> car_id -> [photos across events])
- Customer portal for car owners to find their photos
- Auto-notify owners when new photos available
- See ROADMAP.md for full details
