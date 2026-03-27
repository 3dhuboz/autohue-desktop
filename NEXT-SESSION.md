# AutoHue — Next Session (v3.3.2)

## CRITICAL: Still Broken
1. **Animation shows "WAITING..."** — never animates during sort. isProcessing prop is correct but results aren't flowing to trigger animation phases. The SortAnimation component needs results in stats.results to animate, but the capped status endpoint (50 per poll) may not be advancing the cursor.

2. **Gauges show 0s/$0** — TIME SAVED and COST SAVED stay at zero during processing. timeSavedSeconds calculation: `Math.max(0, manualTime - aiTime)` where manualTime = processed * 15 and aiTime = elapsed. If elapsed > manualTime (slow processing), result is 0. The formula is wrong — timeSaved should ALWAYS be processed * 15 regardless of actual speed.

3. **Processed count was exceeding total (1170/996)** — FIXED in v3.3.2 with hard cap in grabBatch + status endpoint clamp. NEEDS TESTING.

4. **Sort hangs after completion** — stall detector added (15s at 95%+) but untested. The completion check `data.processed >= data.total` should work now that counts are capped.

5. **ZIP download** — switched from <a> tag to window.open() for Electron handler. UNTESTED.

6. **History empty** — recordUsage fix applied (UPDATE instead of INSERT OR REPLACE). UNTESTED.

## What Works Well
- 5 API key rotation: 4.4 img/sec achieved
- Gemini 2.0 Flash via OpenRouter
- Extraction with yauzl pre-scan
- Color accuracy much improved (cream separate, grey-green → silver-grey)
- Vehicle type sorting toggle
- Feature shot detection toggle
- Auto-publish releases + auto-update clients
- Green loading bar during engine startup

## Color Categories (13 total)
red, blue, green, yellow, orange, purple, pink, brown, black, white, silver-grey, cream, please-double-check

## Known Accuracy Issues
- Rat rod / patina cars (multi-color) → should go to please-double-check
- Background vehicles can still influence classification
- Cream vs yellow edge cases (champagne metallic)

## Architecture
- Worker: worker/server.js → bundled via esbuild to worker/dist/server.js
- TWO processing paths exist (potential double-processing bug):
  - `processSession()` — old pipeline, called from upload endpoint
  - Phase 2 pipeline — new, called from sort-local endpoint for archives
  - BOTH call collectImageFiles() and process images
  - Need to verify only ONE runs per session
- Renderer: React + Vite, polls /status/:sessionId every 1s
- 5 keys at: %APPDATA%/autohue-desktop/worker-data/.openrouter-keys
- Model: google/gemini-2.0-flash-001
- CI: draft → build → publish (auto)

## Enterprise Roadmap (v4.0.0)
- License plate / rego reading
- Cross-event car database
- Customer portal
- See ROADMAP.md

## Fix Priority for Next Session
1. Fix timeSaved formula (always = processed * 15, not dependent on elapsed)
2. Test completion transition with capped counts
3. Fix animation — ensure results flow to SortAnimation component
4. Test ZIP download via window.open()
5. Test history recording
6. Investigate double-processing (two code paths)
