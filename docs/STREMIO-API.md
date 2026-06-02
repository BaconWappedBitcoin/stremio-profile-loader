# Stremio API & storage contract

This is the (unofficial) contract the loader relies on, verified against the live
`api.strem.io` and the [stremio-core](https://github.com/Stremio/stremio-core) v5
sources (profile `schema_version` **22**). If Stremio changes these, update
`shared/stremio-api.js` and `android/.../StremioApi.kt` together.

## Endpoint

```
POST https://api.strem.io/api/<method>
Content-Type: application/json
```

The API returns **HTTP 200 even on failure**. Errors come back as:

```json
{ "error": { "code": 2, "message": "User not found", "wrongEmail": true } }
```

Success comes back as `{ "result": { ... } }`. Always branch on `error`.

## Methods used

### `login`
```json
{ "type": "Login", "email": "you@example.com", "password": "…", "facebook": false }
```
→ `result`:
```json
{ "authKey": "…", "user": { /* full user object */ } }
```

### `getUser` — validate a token / refresh the user object
```json
{ "type": "GetUser", "authKey": "…" }
```
→ `result` is the user object. Returns an `error` if the authKey is expired/revoked.

### `addonCollectionGet` — the account's installed addons
```json
{ "type": "AddonCollectionGet", "authKey": "…", "update": true }
```
→ `result.addons` is an array of addon descriptors.

## Stremio Web storage (`localStorage`)

| key | value |
|-----|-------|
| `profile` | JSON `Profile` object (below). Present only when signed in. |
| `schema_version` | `"22"` — the persisted-state schema. We set this so the core treats `profile` as current. |
| `installation_id` | set by Stremio itself; we don't touch it. |

### The `profile` object (camelCase, from stremio-core `Profile`)

```jsonc
{
  "auth": {
    "key": "<authKey string>",
    "user": { /* user object from login/getUser */ }
  },
  "addons": [ /* descriptors from addonCollectionGet */ ],
  "addonsLocked": false,
  "settings": { /* see below — ALL fields required */ }
}
```

### `settings` (complete default, mirrors `impl Default for Settings`)

`Settings` has **no serde defaults**, so every field must be present or the whole
profile is discarded on load. Defaults as of schema 22:

```jsonc
{
  "interfaceLanguage": "eng",
  "hideSpoilers": false,
  "gamepadSupport": false,
  "streamingServerUrl": "http://127.0.0.1:11470/",
  "playerType": null,
  "bingeWatching": true,
  "playInBackground": true,
  "hardwareDecoding": true,
  "videoMode": null,
  "frameRateMatchingStrategy": "Disabled",
  "nextVideoNotificationDuration": 35000,
  "audioPassthrough": false,
  "audioLanguage": "eng",
  "secondaryAudioLanguage": null,
  "subtitlesLanguage": "eng",
  "secondarySubtitlesLanguage": null,
  "subtitlesAutoSelect": true,
  "subtitlesSize": 100,
  "subtitlesFont": "Roboto",
  "subtitlesBold": false,
  "subtitlesOffset": 5,
  "subtitlesTextColor": "#FFFFFFFF",
  "subtitlesBackgroundColor": "#00000000",
  "subtitlesOutlineColor": "#000000",
  "subtitlesOpacity": 100,
  "assSubtitlesStyling": false,
  "escExitFullscreen": true,
  "seekTimeDuration": 10000,
  "seekShortTimeDuration": 3000,
  "pauseOnMinimize": false,
  "quitOnClose": true,
  "surroundSound": false,
  "streamingServerWarningDismissed": null,
  "serverInForeground": false,
  "sendCrashReports": true
}
```

> Source of truth: stremio-core `src/types/profile/{profile,settings}.rs` and
> `src/types/api/request.rs`.
