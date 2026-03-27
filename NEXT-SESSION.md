# AutoHue — Next Session (CRITICAL FIXES NEEDED)

## Version: v3.2.2

## CRITICAL BUGS TO FIX FIRST
1. **Processed count exceeds total (1260/996 = 127%)** — old extracted files from previous sessions are being counted. The cleanup at sort start isn't removing locked files. FIX: each session must use a completely isolated extract directory AND the processed count must be capped at total.

2. **Animation shows "WAITING..."** — isProcessing={phase === 'processing' && !paused} but the animation component might not be receiving the prop correctly, or the results aren't flowing to trigger the animation phases. CHECK: SortAnimation.tsx line ~162, verify isProcessing prop.

3. **Green car classified as black** — prompt says "LARGEST/CLOSEST" but that picks background vehicles. FIX: change to "most PROMINENT/CENTRAL subject — the one the photographer is clearly focusing on. Usually centered in frame, in sharp focus, and the most visually dominant."

4. **Completion screen never appears** — status endpoint returns 288KB payload when all results requested at once. FIX APPLIED in v3.0.2: capped to 50 results per poll. VERIFY this works.

5. **Gauges show 0s/0$** — Time Saved and Cost Saved show zero during processing. The timeSavedSeconds calculation needs stats.startTime to be valid.

## FEATURES ADDED (need testing)
- Vehicle type sorting (cars/bikes/people) — Settings toggle
- Feature shot detection (burnout/wheelstand/flames) — Settings toggle
- 5 API key rotation — keys in .openrouter-keys file
- Green loading bar during engine startup
- Auto-publish releases + auto-update clients

## PROMPT FIX NEEDED
Change from:
"LARGEST/CLOSEST car in this photo"
To:
"most PROMINENT car — the one the photographer is clearly focusing on. Usually centered, in sharp focus, and visually dominant. IGNORE parked/background vehicles."

## KEY ARCHITECTURE NOTES
- Worker: worker/server.js → bundled to worker/dist/server.js
- 5 OpenRouter keys at: %APPDATA%/autohue-desktop/worker-data/.openrouter-keys
- Model: google/gemini-2.0-flash-001
- Batch: 15 images, concurrency = key count (5)
- CI: .github/workflows/release.yml — builds draft, publishes after both platforms
- Site: autohue-site repo → Cloudflare Pages at autohue.app

## FILES TO EDIT
- worker/server.js lines ~423-430: classification prompt
- worker/server.js lines ~368: batch prompt
- worker/server.js line 2209: BATCH_CONCURRENCY = Math.max(3, OPENROUTER_KEYS.length)
- renderer/src/pages/SortPage.tsx line ~977: isProcessing prop
- renderer/src/pages/SortPage.tsx lines ~418-448: completion detection
- renderer/src/components/SortAnimation.tsx: animation logic
