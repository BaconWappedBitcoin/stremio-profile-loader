# How it works

Every Stremio client — web, desktop, Android — is a thin shell around the same web UI, and its login lives in that UI's `localStorage` under the key `profile`. The loader's whole job is to put the right `profile` value in front of the right Stremio before it boots. *How* it reaches that `localStorage` differs per platform:

- **Windows (native app):** the desktop shell embeds a Chromium-family browser engine (QtWebEngine, or WebView2 in newer builds). We restart it with **remote debugging** enabled, attach over the Chrome DevTools Protocol, write `localStorage` directly, and reload. This drives the **real installed app**, so torrents/streaming server work normally.
- **Android (web wrapper):** the official Android app is closed-source and sandboxed (root-only storage), so it can't be driven externally. Instead our app embeds Stremio Web in a `WebView` and seeds `localStorage` there.

## The flow

```
┌─────────────┐   add profile    ┌──────────────────┐
│   Picker    │ ───────────────▶ │  Stremio API     │  POST /api/login
│   (shared   │   email+password │  api.strem.io    │  → { authKey, user }
│    UI)      │ ◀─────────────── └──────────────────┘
└─────────────┘   store authKey only
       │
       │ click a profile (launch)
       ▼
┌─────────────────────────────────────────────────────────┐
│ 1. Validate the authKey  (GET user; expired → re-add)    │
│ 2. Fetch the account's addon collection                  │
│ 3. Assemble the full `profile` object (auth+addons+      │
│    addonsLocked+settings)                                 │
│ 4. Get that `profile` object into the target Stremio's    │
│    localStorage (native app via CDP / WebView via JS)    │
└─────────────────────────────────────────────────────────┘
       ▼
   Stremio loads already signed in to the chosen account.
```

## Why we must seed the *whole* profile

Stremio Web runs on **stremio-core** (a Rust/WASM core). On boot it deserializes `localStorage.profile` into its `Profile` struct. Two facts shape the implementation:

1. **`Settings` has no serde defaults.** Every one of its ~35 fields must be present or the *entire* profile fails to deserialize and Stremio drops back to the login screen. We therefore seed a complete default `Settings` mirroring `impl Default for Settings` in stremio-core.
2. **The core does not auto-pull on init.** Having only `auth` present won't fetch the user's addons, so we fetch the addon collection ourselves and include it.

The profile object we write looks like:

```jsonc
{
  "auth": { "key": "<authKey>", "user": { /* user object from the API */ } },
  "addons": [ /* the account's installed addons */ ],
  "addonsLocked": false,
  "settings": { /* complete default Settings, camelCase */ }
}
```

We also set `localStorage.schema_version = "22"` so stremio-core treats it as a current-schema profile. If Stremio bumps the schema later, its built-in migrations upgrade our v22 profile, so this stays forward-compatible.

## Platform glue

The picker UI is identical on both platforms. It only ever calls `window.LoaderBridge`:

```js
LoaderBridge.platform            // "electron" | "android"
LoaderBridge.listProfiles()      // -> [{ id, label, email, avatar }]
LoaderBridge.addProfile({label,email,password})  // logs in, stores authKey
LoaderBridge.deleteProfile(id)
LoaderBridge.launch(id)          // seeds the session and opens Stremio
```

| | Windows (Electron launcher) | Android (Kotlin) |
|---|---|---|
| Picker UI | renderer `BrowserWindow` loads `shared/picker` | `WebView` loads `picker/` from assets |
| Bridge | `contextBridge` + IPC (`picker-preload.js`) | `addJavascriptInterface` + a JS shim (`MainActivity.BRIDGE_JS`) |
| Login / API | `shared/stremio-api.js` in the main process (no CORS) | `StremioApi.kt` (HttpURLConnection) |
| Storage | `profiles.json` in `userData` | `SharedPreferences` |
| Target | the **native** `stremio.exe` | embedded **Stremio Web** in a `WebView` |
| Seeding | `native.js`: restart Stremio with remote debugging, attach over CDP, set `localStorage`, reload | `StremioActivity` sets `localStorage` on first load, then reloads once |

### Windows: driving the native app (`native.js`)

1. **Find** the installed `stremio.exe` (common install paths, or the `STREMIO_EXE` override).
2. **Restart it with debugging.** The shell is single-instance, so we `taskkill` any running Stremio, then `spawn` it with two env vars set — `QTWEBENGINE_REMOTE_DEBUGGING=9222` (Qt shell) and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` (WebView2 shell). Whichever engine the build uses opens the DevTools port.
3. **Attach & inject.** Poll `http://127.0.0.1:9222/json/list` for the Stremio web-UI page target, open its CDP websocket, and `Runtime.evaluate` a snippet that writes `localStorage.profile` + `schema_version` and calls `location.reload()`.

`npm run doctor` runs steps 1–2 and reports whether the port opens — the one thing that varies between Stremio builds.

### Android: seeding the WebView

A `WebView` can't reliably inject before page scripts, so on the first `onPageFinished` we write `localStorage` and call `location.reload()` once. The reloaded page has the session present before stremio-core runs.

## Limitations

- **Windows** depends on the native shell exposing remote debugging. Most Chromium/Qt/WebView2 builds honour the env vars above, but a hardened build could disable it — hence `doctor`. If that ever fails, the fallback is seeding the shell's `localStorage` LevelDB on disk while the app is closed (more fragile, not implemented).
- **Android torrent (P2P) streaming** needs a local streaming server (`http://127.0.0.1:11470`) that a WebView can't provide, so the Android app targets debrid/HTTP addons. (The Windows native app bundles its own server, so torrents work there.)
- If Stremio changes how it persists sessions, the seeded shape is centralised in `shared/stremio-api.js` (`DEFAULT_SETTINGS`, `SCHEMA_VERSION`) and `StremioApi.kt`.
