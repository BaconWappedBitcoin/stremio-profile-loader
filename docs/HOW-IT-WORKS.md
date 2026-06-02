# How it works

Stremio's account lives in **Stremio Web** (`web.stremio.com`), whose login state is held in the browser's `localStorage` under the key `profile`. The desktop and Android *official* apps keep that state in storage we can't safely touch (an embedded LevelDB on desktop; private app storage — root-only — on Android).

So instead of fighting the official apps, this loader wraps Stremio Web itself and controls that `localStorage` directly.

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
│ 4. Open web.stremio.com with that object pre-seeded into  │
│    localStorage BEFORE Stremio's scripts run             │
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

| | Windows (Electron) | Android (Kotlin) |
|---|---|---|
| Picker UI | renderer `BrowserWindow` loads `shared/picker` | `WebView` loads `picker/` from assets |
| Bridge | `contextBridge` + IPC (`picker-preload.js`) | `addJavascriptInterface` + a JS shim (`MainActivity.BRIDGE_JS`) |
| Login / API | `shared/stremio-api.js` in the main process (no CORS) | `StremioApi.kt` (HttpURLConnection) |
| Storage | `profiles.json` in `userData` | `SharedPreferences` |
| Seeding | new `BrowserWindow` with `stremio-preload.js` that sets `localStorage` before page scripts (`contextIsolation:false`) | `StremioActivity` sets `localStorage` on first load, then reloads once |

### Seeding timing

- **Electron:** the Stremio window uses a preload that runs *before* the page's own JavaScript, so it sets `localStorage` and Stremio reads an authenticated profile on first parse. The window uses a per-profile persistent session partition (`persist:stremio-<id>`), so profiles stay isolated.
- **Android:** a `WebView` can't reliably inject before page scripts, so on the first `onPageFinished` we write `localStorage` and call `location.reload()` once. The reloaded page then has the session present before stremio-core runs.

## Limitations

- **Torrent (P2P) streaming** depends on a local streaming server (`http://127.0.0.1:11470`). On desktop you can run the standalone *Stremio Service* and it'll be used automatically. On Android there's no bundled server, so use debrid/HTTP addons.
- If Stremio Web significantly changes how it persists sessions, the seeding shape may need updating — it's centralised in `shared/stremio-api.js` (`DEFAULT_SETTINGS`, `SCHEMA_VERSION`) and `StremioApi.kt`.
