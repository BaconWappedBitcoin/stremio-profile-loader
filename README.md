# Stremio Profile Loader

Stremio has no built-in profile switching — one app, one logged-in account. This project adds a **"Who's watching?" profile picker** that signs into a chosen Stremio account and opens Stremio already logged in. One monorepo, two apps:

| App | Platform | Tech | Status |
|-----|----------|------|--------|
| [`windows/`](windows/) | Windows / Linux desktop | Electron | ✅ runs & verified |
| [`android/`](android/) | Android phone / tablet / TV | Kotlin WebView | ✅ builds (APK) |

> **How it works in one line:** you add each profile once (email + password); the loader signs in via the Stremio API, stores only a revocable login token, and on launch pre-seeds that session into **Stremio Web** so it boots straight into your account. Your password is never stored.

See [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md) for the full mechanism and [docs/STREMIO-API.md](docs/STREMIO-API.md) for the API/storage contract.

---

## What it is (and isn't)

- ✅ A launcher that wraps **[Stremio Web](https://web.stremio.com)** with a profile picker. It is **not** affiliated with Stremio.
- ✅ Best suited to **debrid / HTTP-addon** setups (Real-Debrid, Premiumize, Torrentio+debrid, direct HTTP addons), which work fully inside the web app with no local server.
- ⚠️ **Torrent (P2P) streaming** needs Stremio's local *streaming server*. The seeded profile already points at `http://127.0.0.1:11470`, so if you run the standalone **Stremio Service** on the same machine the desktop app will use it. On Android there is no bundled server, so plain torrent streaming is a known limitation.
- 🔓 Stores only a Stremio **authKey** (a revocable session token) per profile — never your password.

## Repository layout

```
stremio-profile-loader/
├── shared/
│   ├── stremio-api.js      # Stremio API + profile-building logic (used by Electron)
│   └── picker/             # the profile-picker UI, shared by BOTH apps
│       ├── index.html
│       ├── styles.css
│       └── app.js          # talks only to window.LoaderBridge
├── windows/                # Electron desktop app
├── android/                # Kotlin WebView app (phone/tablet/TV)
└── docs/
```

Both apps render the **same** picker UI and expose the **same** `window.LoaderBridge` interface; only the platform glue (storage + launching) differs.

## Quick start

### Windows / desktop (Electron)

```bash
cd windows
npm install
npm start              # launch the picker
npm run dist           # build an installer (NSIS on Windows / AppImage on Linux)
```

### Android

Open the `android/` folder in **Android Studio** (Otter or newer) and Run, or from the CLI:

```bash
cd android
./gradlew assembleDebug          # -> app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Requires Android SDK with **API 36** + **build-tools 36.0.0** (AGP 8.9.1 / Gradle 8.11.1, JDK 17+). Installs on phones, tablets, and Android TV.

## Usage

1. Launch the app — you'll see the profile picker.
2. **Add profile** → give it a name, enter the Stremio email + password. The loader signs in once and stores the returned token.
3. Click a profile → Stremio opens already signed in to that account.
4. Remove a profile with the × on its card (this only deletes it locally; your Stremio account is untouched).

If a stored token ever expires, the loader will tell you to remove and re-add that profile.

## Security notes

- Passwords are used exactly once (at "Add profile") and never written to disk.
- The stored authKey is a bearer token for that Stremio account — treat the profile file like a password. It lives in the OS per-user app data:
  - Windows: `%APPDATA%/Stremio Profile Loader/profiles.json`
  - Android: app-private `SharedPreferences` (not world-readable)
- You can revoke a token any time by changing the account's Stremio password.

## License

[MIT](LICENSE). Not affiliated with or endorsed by Stremio.
