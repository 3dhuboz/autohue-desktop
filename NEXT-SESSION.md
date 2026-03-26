# AutoHue — Next Session

## Status
- **v1.7.5** deployed, OpenRouter + Gemini Flash WORKING
- Correct classifications confirmed (Yellow, White cars)
- Speed ~0.2 img/sec — needs optimization (local pipeline running after API)
- Fixed: port conflict, XOR key, Gemini quota (switched to OpenRouter)

## Priority Tasks

### 1. Sorting Animation (User's Vision — HIGH PRIORITY)
Replace current live feed with animated pipeline:
- Image slides in from LEFT
- Enters "AutoHue Brain" graphic (centered, pulsing)
- Green toast/tick animation with detected color
- Image animates OUT to folder icon on RIGHT
- One-at-a-time visually (batch processing behind scenes)
- Must look fancy/polished — this is the showcase feature

### 2. Speed Optimization
- Skip local pipeline entirely when OpenRouter returns a result
- Currently: API returns color → local pipeline ALSO runs (wastes 5-7s)
- Should be: API returns → copy file → done
- Target: 2-5 img/sec

### 3. Sort Resume on Crash/Shutdown
- Save state to DB (processed files, remaining, output folder)
- On restart, offer to resume incomplete sessions
- Skip already-processed files

### 4. Progress = OVERALL Progress
- Show total across ALL files (e.g., "382/1200"), not batch (e.g., "3/9")
- Progress bar = total percentage

### 5. Clean Up
- Remove debug logs (openrouter-debug.log, debug-startup.log)
- Re-add IP protection with working XOR (Buffer.from hex approach)
- Consolidate messy version jumps

## Architecture
- **Repo**: github.com/3dhuboz/autohue-desktop
- **Stack**: Electron + React + Express worker (forked process)
- **AI**: OpenRouter → Gemini 2.5 Flash (batch 15, 3 concurrent)
- **Fallback**: Claude Vision → Local ONNX (SSD-MobileNet + LAB)
- **Worker port**: 3099 (bound to 127.0.0.1)
- **Keys**: DB (openrouter_api_key) + keyfile (.openrouter-key)
