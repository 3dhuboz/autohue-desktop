# AutoHue — Next Session Focus: POLISH & SPEED

## Current State: v1.5.2
- Repo: C:\Users\Steve\Desktop\GitHub\autohue-desktop
- Deploy repo: github.com/3dhuboz/autohue-desktop
- API: autohue-api.steve-700.workers.dev
- Admin: autohue-admin.pages.dev

## Priority 1: SPEED (must feel instant)
- Currently ~7-10s per image with Claude Sonnet 4
- Jimp skip threshold at 10MB but large motorsport JPEGs still slow
- Consider: sharp native bindings for instant resize
- Consider: claude-3-5-haiku if available on the API key
- Consider: increase batch size to 6-8 images per API call
- Consider: pre-read file buffers while previous batch is being classified

## Priority 2: UI POLISH
- Live Sort Feed needs dramatic "fly into folder" animation
- Badge still flickers between Local AI / AI Vision Pro
- Cancel button needs full UI reset
- White swatch dot needs to be clearly white
- Extraction phase needs exciting progress (not just spinning)
- Output folder should open automatically on completion
- First-run onboarding flow

## Priority 3: ACCURACY EDGE CASES  
- White vs Silver/Grey in heavy smoke (improved but not perfect)
- Small cars in frame with dominant grass → misclassified as yellow/green
- Dark blue vs black in low light
- Prompt: "Focus on the LARGEST vehicle, not background"

## Priority 4: REVENUE FEATURES
- Token top-up packs (buy extra when daily limit hit)
- Code signing ($200-400/yr) to remove Smart App Control warning

## Architecture Notes
- Worker is esbuild-bundled to worker/dist/server.js (MUST rebuild after source changes)
- Claude API key flows via: DB settings → .claude-key file → worker reads on startup
- Model: claude-sonnet-4-20250514 (haiku-4 not available on this key)
- Pricing: Trial free 50/day, Hobbyist $9 500/day, Pro $29 2K/day, Unlimited $79 5K/day
- Claude Vision key given to ALL tiers (trial sees real accuracy)
