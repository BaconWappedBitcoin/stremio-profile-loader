# STRLoader

A **"Who's watching?" profile picker for Stremio.** Stremio has no built-in profile switching — one app, one logged-in account. STRLoader signs into a chosen account and opens Stremio already logged in. One monorepo, two apps:

> Not affiliated with, endorsed by, or sponsored by Stremio. "Stremio" is used only to describe compatibility.

| App | Platform | What it drives | Tech | Status |
|-----|----------|----------------|------|--------|
| [`windows/`](windows/) | Windows desktop | the **native** Stremio app | Electron launcher | ✅ runs; native injection needs verifying on a real install (`npm run doctor`) |
| [`android/`](android/) | Android phone / tablet / TV | a wrapped **Stremio Web** session | Kotlin WebView | ✅ builds (APK) |

> **How it works in one line:** you add each profile once (email + password); the loader signs in via the Stremio API, stores only a revocable login token, and on launch seeds that session into Stremio so it opens straight into your account. Your password is never stored.

The two platforms reach Stremio differently — see below — but both share the same picker UI and login logic. Full details in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md); the API/storage contract is in [docs/STREMIO-API.md](docs/STREMIO-API.md).

---

## What it is (and isn't)

Not affiliated with or endorsed by Stremio. Stores only a Stremio **authKey** (a revocable session token) per profile — never your password.

**Windows → drives the real native app.** Picking a profile (re)starts the installed `stremio.exe` with its embedded browser engine's remote-debugging enabled, attaches over the Chrome DevTools Protocol, seeds the chosen session into `localStorage`, and reloads — so your **native** Stremio opens signed into that account. Because it's the native app, **torrent (P2P) streaming and the bundled streaming server work normally.** Switching profiles = relaunch into the other account (not a live in-app switch).

> ⚠️ This relies on the native shell exposing remote debugging. Builds vary, so run `npm run doctor` on your machine first — it tells you whether your Stremio can be driven this way.

**Android → wraps Stremio Web.** Android's official Stremio app is closed-source and sandboxed, so no external launcher can change its profile without root. Instead the Android app embeds a Stremio Web session and seeds the chosen profile into it. Best suited to **debrid / HTTP-addon** setups (Real-Debrid, Premiumize, Torrentio+debrid, direct HTTP addons); plain torrent P2P needs a local streaming server that a WebView can't provide.

## Repository layout

```
stremio-profile-loader/
├── shared/
│   ├── stremio-api.js      # Stremio API + profile-building logic (used by Electron)
│   └── picker/             # the profile-picker UI, shared by BOTH apps
│       ├── index.html
│       ├── styles.css
│       └── app.js          # talks only to window.LoaderBridge
├── windows/                # Electron launcher that drives the native Stremio app
│   ├── src/native.js       #   finds Stremio, restarts it with debugging, injects via CDP
│   └── scripts/doctor.js   #   `npm run doctor` — checks your install is drivable
├── android/                # Kotlin WebView app (phone/tablet/TV)
└── docs/
```

Both apps render the **same** picker UI and expose the **same** `window.LoaderBridge` interface; only the platform glue (storage + launching) differs.

## Quick start

### Windows (Electron launcher + native Stremio app)

Requires the official **Stremio desktop app** installed.

```bash
cd windows
npm install
npm run doctor         # FIRST: verify your Stremio install can be driven
npm start              # launch the profile picker
npm run dist           # build an installer (NSIS)
```

> Building the installer locally needs Windows **Developer Mode** on (Settings → Privacy & security → For developers) or an elevated shell, so electron-builder can extract its signing tools (they contain symlinks). CI does this automatically — see [Releases](#releases).

If `npm run doctor` reports the DevTools port never opened, your Stremio build doesn't expose remote debugging — [open an issue](../../issues) with your version (Settings → About) so the injection method can be adapted.

### Android

Open the `android/` folder in **Android Studio** (Otter or newer) and Run, or from the CLI:

```bash
cd android
./gradlew assembleDebug          # -> app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Requires Android SDK with **API 36** + **build-tools 36.0.0** (AGP 8.9.1 / Gradle 8.11.1, JDK 17+). Installs on phones, tablets, and Android TV.

## Usage

1. Launch the loader — you'll see the profile picker.
2. **Add profile** → give it a name, enter the Stremio email + password. The loader signs in once and stores the returned token.
3. Click a profile:
   - **Windows:** any running Stremio is closed and the native app relaunches signed into that account.
   - **Android:** Stremio Web opens signed into that account.
4. To switch, return to the picker and pick another profile (Windows relaunches the native app).
5. Remove a profile with the × on its card (this only deletes it locally; your Stremio account is untouched).

If a stored token ever expires, the loader will tell you to remove and re-add that profile.

## Security notes

- Passwords are used exactly once (at "Add profile") and never written to disk.
- The stored authKey is a bearer token for that Stremio account — treat the profile file like a password. It lives in the OS per-user app data:
  - Windows: `%APPDATA%/STRLoader/profiles.json`
  - Android: app-private `SharedPreferences` (not world-readable)
- You can revoke a token any time by changing the account's Stremio password.

## Releases

A [GitHub Actions workflow](.github/workflows/release.yml) builds the Windows installer and the Android APK. To cut a release:

```bash
# bump versions in windows/package.json and android/app/build.gradle.kts, then:
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds both apps and attaches `*.exe` + `STRLoader.apk` to a GitHub Release for that tag. You can also trigger it manually (Actions → Build & Release → Run workflow) to get the artifacts without making a release.

## License

[MIT](LICENSE). Not affiliated with or endorsed by Stremio.
