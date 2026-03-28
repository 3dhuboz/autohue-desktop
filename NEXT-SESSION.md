# AutoHue — Current State (v3.5.4)

## What's Working
- Desktop app builds and auto-deploys via GitHub Actions → R2 → auto-update
- Canvas sort animation (particle system: queue → AI engine → color buckets)
- Extraction → classification bridge animation ("Initializing AI Engine")
- Pipeline step numbers (1-5)
- ZIP download with elapsed timer
- All 6 gauges animate (Speed, Progress, Accuracy, ETA, Time Saved, Cost Saved)
- History page with date grouping, lightbox, color swatches
- License enforcement on all paths
- In-app update download + install
- Smart API key rotation with escalating backoff (dead keys get sidelined)
- Website live at autohue.app with PayPal checkout (subscriptions + credit packs)
- Monthly/yearly billing toggle on pricing page

## Repos
- Desktop: github.com/3dhuboz/autohue-desktop (v3.5.4)
- Website: github.com/3dhuboz/autohue-site
- Admin: github.com/3dhuboz/autohue-admin
- API Worker: autohue-api.steve-700.workers.dev
- R2: autohue-releases bucket (auto-deployed via CI)

## CI/CD Pipeline
- Push tag `v*` → GitHub Actions builds .exe + .dmg → uploads to GitHub Releases + R2
- Desktop app checks R2 on launch → prompts user to update
- Website: deploy via `npx wrangler pages deploy _site --project-name=autohue-site`

## PayPal Plan IDs
- Hobbyist Monthly: P-7A011980S20678457NHDXQPA ($24/mo)
- Hobbyist Yearly: P-8CX575826F396683UNHDXRKI ($19/mo billed yearly)
- Pro Monthly: P-67S36319Y97790222NHDXTAI ($99/mo)
- Pro Yearly: P-2CF442047U804381PNHDXSKY ($79/mo billed yearly)
- Unlimited Monthly: P-4XX00824VW5461919NHDXT4Y ($249/mo)
- Unlimited Yearly: P-6BJ69046B7785863UNHDXUKI ($199/mo billed yearly)

## OpenRouter Keys
- 5 keys in %APPDATA%/autohue-desktop/worker-data/.openrouter-keys
- Key 1 (...37277d) has $2+ usage — likely low/no credits
- Keys 2-5 barely used — smart rotation now sidelines dead keys
- Model: google/gemini-2.0-flash-001

## Still TODO
1. **Top up OpenRouter credits** — Key 1 exhausted, keys 2-5 low. Add $5-10 per account or switch to direct Gemini API
2. **Code signing** — Windows SmartScreen warns without certificate
3. **Admin worker deploy** — `cd autohue-admin/workers/api && npx wrangler deploy` to activate latest endpoints
4. **Credit purchase backend** — /api/credits/purchase endpoint needs implementing on the admin worker
5. **Post-payment license key email** — PayPal webhook → generate license → email to customer
6. **Mac build testing** — DMG builds via CI but untested on actual Mac hardware

## Architecture
- Worker: worker/server.js (bundled via esbuild)
- Renderer: React + Vite, polls /status/:sessionId every 1.5s
- Electron main: electron/main.js
- License: electron/license.js (sql.js WASM)
- Downloads: R2 bucket served via admin API
- CI: GitHub Actions on tag push → build → GitHub Release + R2 upload

## Color Categories (13 total)
red, blue, green, yellow, orange, purple, pink, brown, black, white, silver-grey, cream, please-double-check
