# Commands — Combat Clean

> Template scaffolded from the bishop-game-framework. Trim the sections you don't use.

## Prerequisites
- **Node 18+** and npm.
- **[git-lfs](https://git-lfs.com)** on PATH if you store binary art (`*.png`, audio) in LFS —
  without it, LFS-tracked files stay as text pointer stubs and asset loads silently fail. A
  `postinstall` script can install the smudge filter and pull blobs (see `scripts/lfs-setup.mjs`);
  it should warn non-fatally if `git lfs` isn't found.
- **Android:** Android SDK + `JAVA_HOME` for device builds. **iOS:** macOS + Xcode.

## Dev
- `npm run dev` — Vite dev server (HMR; `src/data/*.json` hot-reloads into the running sim).
- `npm run build` — `tsc` typecheck + production bundle to `dist/`.
- `npm run preview` — serve the built `dist/`.

## Android
First time: `npx cap add android` (the `android/` folder is gitignored).
- `npm run cap:sync` — build web + copy into the native project.
- `npm run cap:android:debug` — assemble a debug APK (WebView-debuggable).
- `npm run cap:android:deploy` — debug APK → `adb install` → launch (device/emulator connected).
- `npm run cap:android:studio` — open the project in Android Studio.
- APK output: `android/app/build/outputs/apk/debug/app-debug.apk`.

Optional device live-reload: bake the LAN/USB dev-server URL into the WebView, build+install, then
run Vite with `--host` so the device hot-reloads. (See `scripts/cap-android-livereload.mjs` if you
port it.)

## iOS
First time: `npx cap add ios` (macOS + Xcode).
- `npm run cap:ios` — build + open the iOS project in Xcode (run from there).

## Native config
- App id: `com.simonhill.combatclean` (see `capacitor.config.ts`).
- `android/` and `ios/` are generated and gitignored — recreate with `npx cap add`.

## Optional advanced tooling (port from the framework's reference game if wanted)
- **Live JSON editor** (`npm run editor`) — a dev-only page for live-tuning `src/data/*.json` with a
  connection banner and a game-fed console. Pairs with the changeset/transcript workflow.
- **On-device perf harness** (`npm run perf:android`) — attaches via adb + Chrome DevTools Protocol,
  drives a scripted play session, and writes a JSON perf report. Required by the `android-perf` agent.
