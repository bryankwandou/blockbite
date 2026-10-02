# Testing BlockBite across platforms

BlockBite is a **Next.js 14 web app**. There is no native Android, iOS, Windows or macOS app in this repo (no `android/`, `ios/`, `src-tauri/`, Capacitor or Electron config). "Every platform" therefore means every browser engine and form factor the site runs in, and that is what the Playwright suite covers.

## Running

```bash
npm run test:e2e                 # all projects against BASE_URL (default http://localhost:3100)
npm run test:e2e:mobile          # Android + iPhone + iPad projects only
npx playwright test --project=iphone-14 tests/e2e/game.spec.ts
npx playwright show-report       # HTML report, traces of failures
```

- `BASE_URL=https://preview.example.app npm run test:e2e` tests a deployed preview. When `BASE_URL` is set no server is started.
- Locally with no `BASE_URL`, the suite expects a server on :3100 already running (`npm run dev -- -p 3100`). In CI it starts `next start -p 3100` itself.
- `PW_EDGE=1` adds the `windows-edge` project (needs Microsoft Edge installed).
- One-time: `npx playwright install chromium webkit firefox`.

## Projects (playwright.config.ts)

| Project | Engine | Stands in for |
|---|---|---|
| android-pixel7 | Chromium, Pixel 7 profile (touch, DPR 2.6) | modern Android Chrome |
| android-lowend | Chromium, 360x740, CPU throttled 4x via CDP | Galaxy S8-class / budget Android |
| iphone-14, iphone-se | WebKit, touch | iOS Safari (large and small phone) |
| ipad | WebKit, iPad (gen 7) | iPadOS Safari |
| windows-chromium | Chromium desktop | Windows Chrome |
| windows-edge | msedge channel (opt-in `PW_EDGE=1`) | Windows Edge |
| macos-webkit | WebKit 1440x900 | macOS Safari |
| firefox-desktop | Gecko | Firefox on any desktop |

## What the tests check (tests/e2e)

- **pages.spec.ts**: `/`, `/game`, `/map`, `/play/1`, `/ranked`, `/shop`, `/leaderboard`, `/how-to-play`, `/profile`, `/settings` must return < 400, throw no uncaught page errors and have no horizontal overflow. `/achievements`, `/account`, `/themes`, `/versus`, `/challenge/<id>`, `/admin`, `/partner` are *soft*: if the route folder under `app/` does not exist yet the test is registered as `test.fixme` (shown as skipped, not failed); if it exists but returns 404 it skips. The redesigned `/map` is in the core list. These smoke tests check load/errors/overflow only — not the content of the new pages. RTL: `/?lang=ar` must set `<html dir="rtl" lang="ar">` with no overflow.
- **game.spec.ts**: the free game is wallet-gated, so the test injects a mock Phantom provider (`window.phantom.solana`, signing disabled), connects through the real wallet modal, then picks a tray piece and places it on the board, using `touchscreen.tap` on touch projects and mouse clicks on desktop. Passes when the HUD score changes.
- **pwa.spec.ts**: `/manifest.webmanifest` parses, has name, start_url, standalone display, 192 and 512 PNG icons that resolve, and `/sw.js` is served. Missing `<link rel="manifest">` is a warning annotation (the link belongs in `app/layout.tsx` metadata: `manifest: '/manifest.webmanifest'`, plus registering `/sw.js` from a client component).
- **perf.spec.ts** (android-lowend only): first contentful paint and long tasks on `/game` under 4x CPU throttle. Reported as a `[perf]` log line and annotation, never fails. Budgets: FCP 2500 ms, summed long-task blocking 600 ms. Note: against `next dev` these numbers are much worse than production; trust the CI numbers (`next start`).

## CI (.github/workflows/e2e.yml)

| Runner | Projects |
|---|---|
| ubuntu-latest | android-pixel7, android-lowend, windows-chromium, firefox-desktop |
| macos-latest | iphone-14, iphone-se, ipad, macos-webkit (WebKit on macOS is closest to real Safari) |
| windows-latest | windows-edge (real Edge) |
| ubuntu-latest, optional | real Android Chrome in an API 34 emulator (reactivecircus/android-emulator-runner), smoke only: opens `/game`, screenshots, dumps Chrome errors. Runs only via *Run workflow* with `android_emulator` ticked. |

Each job builds with `next build`, serves with `next start -p 3100`, and uploads `playwright-report/`, `test-results/` (traces, screenshots) and `next.log`.

## Emulated vs. needs a real device

Emulation gives the real engine (Blink, WebKit, Gecko), viewport, DPR, touch events and UA. It does **not** give:

| Gap | Why emulation misses it | How to cover |
|---|---|---|
| iOS Safari audio unlock | Playwright WebKit is not Mobile Safari; autoplay policy and the "first touch must start AudioContext" rule differ | real iPhone: open `/game`, confirm sound plays after first tap and after app-switch/return |
| iOS visual viewport, safe-area insets, URL-bar collapse, 100vh | desktop WebKit has no dynamic toolbars or notch | real iPhone (notch model + SE) |
| Phantom / Solflare mobile wallet deep-links | the in-app browser and the `phantom://` / universal-link round trip only exist in the native wallet apps | real phone with Phantom installed: connect from Safari/Chrome, sign, return to the tab |
| Wallet signing in general | the test wallet refuses to sign; ranked/paid flows are not exercised | manual on devnet, or a dedicated signing test wallet in a separate suite |
| Real GPU / thermal throttling | CPU throttle is a multiplier, not a slow GPU; canvas fill rate is not throttled | a real budget Android (or BrowserStack Galaxy A-series) |
| Install-to-home-screen prompt | `beforeinstallprompt` and iOS "Add to Home Screen" are browser UI | real Android Chrome + iOS Safari |
| Samsung Internet, in-app browsers (TikTok, Instagram, X) | not shipped by Playwright | BrowserStack real devices |

## Paid real devices (BrowserStack / LambdaTest)

The config has a hook: when `BROWSERSTACK_WS` is set, a `real-device` project is added that connects to that endpoint instead of launching a local browser.

```bash
# BrowserStack: caps are JSON, URL-encoded into the wss endpoint
CAPS='{"browser":"chrome","os":"android","os_version":"13.0","device":"Samsung Galaxy S23","browserstack.username":"'$BROWSERSTACK_USERNAME'","browserstack.accessKey":"'$BROWSERSTACK_ACCESS_KEY'","browserstack.local":"false"}'
export BROWSERSTACK_WS="wss://cdp.browserstack.com/playwright?caps=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$CAPS")"
BASE_URL=https://<preview-url> npx playwright test --project=real-device

# LambdaTest uses the same pattern:
# wss://cdp.lambdatest.com/playwright?capabilities=<urlencoded caps with LT:Options user/accessKey>
```

For localhost targets use BrowserStack Local / LambdaTest Tunnel; simpler is to point `BASE_URL` at a Vercel preview. Store the username/key as GitHub secrets and add a job that sets `BROWSERSTACK_WS`; nothing in the repo needs to change. Real iOS Safari on these services runs through their Appium/WebDriver products rather than Playwright, so iOS real-device checks are a separate (manual or Appium) step.

## Native apps: honest status and proposed path

**Today there are no native builds.** Nothing in the repo produces an `.apk`, `.ipa`, `.exe` or `.dmg`. Recommended order:

1. **PWA (done).** `public/manifest.webmanifest`, `public/icons/*` and `public/sw.js` are linked from `app/layout.tsx` (`manifest`, `appleWebApp`) and the worker is registered by `components/PwaRegister.tsx` in production builds. The site installs as an app from Chrome/Edge on Android, Windows and macOS and from Safari's "Add to Home Screen" on iOS. `pwa.spec.ts` fails if the manifest link or the iOS tags go missing, and asks Chromium's own install check (`Page.getInstallabilityErrors`) for zero errors.
2. **Capacitor for Android/iOS store builds.** Wrap the deployed site (or a static export of the non-API pages) in Capacitor. CI: Android with `./gradlew assembleDebug` on ubuntu, then the same `android-emulator-runner` job installing the APK and driving the WebView with Appium or Playwright's `_android` (experimental); iOS with `xcodebuild` on macos-latest and the iOS Simulator (`xcrun simctl`) plus Appium/XCUITest. Wallets: use Solana Mobile Wallet Adapter on Android; iOS needs Phantom deep-link flow and must be verified on a real device.
3. **Tauri for .exe/.dmg.** Small binaries using the OS WebView (WebView2 on Windows, WKWebView on macOS). CI: `tauri-apps/tauri-action` matrix on windows-latest and macos-latest; smoke-test with `tauri-driver` + WebdriverIO on Windows/Linux (macOS has no WebDriver for WKWebView, so macOS relies on the `macos-webkit` Playwright project plus a manual launch check). Browser-extension wallets do not exist inside Tauri; it would need a deep-link or WalletConnect-style flow.

None of these projects are created yet; each is a separate decision.
