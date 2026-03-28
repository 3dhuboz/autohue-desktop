# AutoHue — Next Session (v3.3.5)

## Completed (this session — v3.3.3 → v3.3.4)
1. **Vehicle type sorting UI** — Checkboxes on SortPage for "Sort by vehicle type" (cars/bikes/people) and "Detect feature shots" (wheelstands, flames, burnouts). Settings persist via SQLite.
2. **Stream animation** — Replaced one-at-a-time animation with continuous flowing stream of color dots. Scales with throughput, shows img/s speed, no more "WAITING" stalls.
3. **Admin dashboard deployed** — `autohue-admin.pages.dev` (Cloudflare Pages). Clerk auth, customer/license/payment management.
4. **PayPal plans created** — 6 live subscription plans (3 tiers × monthly/yearly). Env vars set on autohue-site.
5. **GitHub secrets** — CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN set for CI.
6. **Admin API redeployed** — R2 binding active, download endpoints live.
7. **Auto-update working** — GitHub Releases with latest.yml + blockmap for electron-updater.

## Still TODO
1. **Mac build** — Need macOS runner or cross-compile for .dmg
2. **Code signing** — Windows SmartScreen warning without certificate
3. **Test PayPal checkout flow end-to-end** — Verify subscription creates customer + sends license key email
4. **Webhook setup** — Ensure PayPal webhook URL points to `/api/paypal-webhook`
5. **Custom domain for admin** — Optional: `admin.autohue.app` instead of `autohue-admin.pages.dev`

## Architecture
- Worker: worker/server.js (bundled via esbuild)
- Renderer: React + Vite, polls /status/:sessionId every 1.5s
- Electron main: electron/main.js
- License: electron/license.js (sql.js WASM)
- 5 API keys at: %APPDATA%/autohue-desktop/worker-data/.openrouter-keys
- Model: google/gemini-2.0-flash-001
- Downloads: R2 bucket `autohue-releases` served via admin API
- CI: GitHub Actions on tag push → build → GitHub Release + R2 upload
- Admin: autohue-admin.pages.dev (React + Clerk + Cloudflare Pages)
- API: autohue-api.steve-700.workers.dev (Hono + D1 + R2)

## Color Categories (14 total)
red, blue, green, yellow, orange, purple, pink, brown, black, white, silver-grey, cream, please-double-check

## Vehicle Types (when enabled)
car → cars/, motorcycle → bikes/, person → people/, truck → trucks/, other → other/

## Feature Shots (when enabled)
Copied to _highlights/{feature}/ — wheelstand, flames, burnout, drift, launch, crash

## Pricing (yearly / monthly)
- Trial: Free (7 days, 50/day)
- Hobbyist: $19/$24 per month (300/day)
- Pro: $79/$99 per month (2,000/day) — Most Popular
- Unlimited: $199/$249 per month (10,000/day)

## PayPal Plan IDs
- Hobbyist Monthly: P-0E0766276B1139608NHDRU3Y
- Hobbyist Yearly: P-04J7698388447105MNHDRU4A
- Pro Monthly: P-46801253NN0274710NHDRU4A
- Pro Yearly: P-45T46267H7712901ENHDRU4I
- Unlimited Monthly: P-41F22498TS119561PNHDRU4Q
- Unlimited Yearly: P-2B694765K85756836NHDRU4Q
