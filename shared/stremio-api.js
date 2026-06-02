/**
 * stremio-api.js — shared, dependency-free Stremio API helpers.
 *
 * Used directly by the Electron main process (Node 18+ has a global `fetch`).
 * The Android app reimplements this contract in Kotlin (see docs/STREMIO-API.md),
 * keeping the request/response shapes and the seeded-profile layout identical.
 *
 * Everything here was verified against the live api.strem.io and the
 * stremio-core v5 (schema_version 22) profile serialization. See docs/STREMIO-API.md.
 */

'use strict';

const API_URL = 'https://api.strem.io';

/** Stremio Web persists the session under this localStorage key. */
const PROFILE_STORAGE_KEY = 'profile';

/** stremio-core schema version we build profiles for. The app migrates older->newer. */
const SCHEMA_VERSION = '22';

/**
 * Complete default Settings, mirroring `impl Default for Settings` in
 * stremio-core/src/types/profile/settings.rs. The Settings struct has NO serde
 * defaults, so a seeded profile MUST contain every field or stremio-core rejects
 * the whole profile and drops back to the login screen.
 */
const DEFAULT_SETTINGS = Object.freeze({
  interfaceLanguage: 'eng',
  hideSpoilers: false,
  gamepadSupport: false,
  streamingServerUrl: 'http://127.0.0.1:11470/',
  playerType: null,
  bingeWatching: true,
  playInBackground: true,
  hardwareDecoding: true,
  videoMode: null,
  frameRateMatchingStrategy: 'Disabled',
  nextVideoNotificationDuration: 35000,
  audioPassthrough: false,
  audioLanguage: 'eng',
  secondaryAudioLanguage: null,
  subtitlesLanguage: 'eng',
  secondarySubtitlesLanguage: null,
  subtitlesAutoSelect: true,
  subtitlesSize: 100,
  subtitlesFont: 'Roboto',
  subtitlesBold: false,
  subtitlesOffset: 5,
  subtitlesTextColor: '#FFFFFFFF',
  subtitlesBackgroundColor: '#00000000',
  subtitlesOutlineColor: '#000000',
  subtitlesOpacity: 100,
  assSubtitlesStyling: false,
  escExitFullscreen: true,
  seekTimeDuration: 10000,
  seekShortTimeDuration: 3000,
  pauseOnMinimize: false,
  quitOnClose: true,
  surroundSound: false,
  streamingServerWarningDismissed: null,
  serverInForeground: false,
  sendCrashReports: true,
});

class StremioApiError extends Error {
  constructor(message, code, raw) {
    super(message);
    this.name = 'StremioApiError';
    this.code = code;
    this.raw = raw;
  }
}

/**
 * POST https://api.strem.io/api/<method>. The API always returns HTTP 200 and
 * signals failure via an `error` object in the body, so we branch on `error`.
 */
async function apiCall(method, body, fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  if (typeof f !== 'function') {
    throw new StremioApiError('No fetch implementation available', 'NO_FETCH');
  }
  let res;
  try {
    res = await f(`${API_URL}/api/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new StremioApiError(`Network error talking to Stremio: ${networkErr.message}`, 'NETWORK');
  }
  let json;
  try {
    json = await res.json();
  } catch (_) {
    throw new StremioApiError(`Stremio API returned a non-JSON response (HTTP ${res.status})`, 'BAD_RESPONSE');
  }
  if (json && json.error) {
    const err = json.error;
    throw new StremioApiError(err.message || 'Stremio API error', err.code, err);
  }
  return json && json.result;
}

/**
 * Log in with email + password.
 * @returns {Promise<{authKey: string, user: object}>}
 */
async function login(email, password, fetchImpl) {
  const result = await apiCall('login', {
    type: 'Login',
    email,
    password,
    facebook: false,
  }, fetchImpl);
  if (!result || !result.authKey) {
    throw new StremioApiError('Login succeeded but no authKey was returned', 'NO_AUTHKEY', result);
  }
  return { authKey: result.authKey, user: result.user };
}

/** Fetch the current user object for an authKey (used to refresh stale user data). */
async function getUser(authKey, fetchImpl) {
  return apiCall('getUser', { type: 'GetUser', authKey }, fetchImpl);
}

/**
 * Fetch the user's installed addon collection so the seeded profile keeps the
 * exact addons the account has, instead of an empty list.
 * @returns {Promise<Array>} array of addon descriptors
 */
async function getAddonCollection(authKey, fetchImpl) {
  const result = await apiCall('addonCollectionGet', {
    type: 'AddonCollectionGet',
    authKey,
    update: true,
  }, fetchImpl);
  return (result && result.addons) || [];
}

/**
 * Build the full `profile` object that Stremio Web reads from localStorage to
 * consider itself logged in. Pulls fresh user + addons using the authKey.
 *
 * @param {string} authKey
 * @param {object} [knownUser] previously stored user object, used if getUser fails
 * @returns {Promise<object>} the profile object to JSON.stringify into localStorage
 */
async function buildProfile(authKey, knownUser, fetchImpl) {
  let user = knownUser || null;
  let addons = [];

  // Refresh the user object; fall back to the stored one if the call fails.
  try {
    const fresh = await getUser(authKey, fetchImpl);
    if (fresh) user = fresh;
  } catch (e) {
    if (!user) throw e; // no fallback available -> surface the error
  }

  // Addons are best-effort: an empty list still produces a valid, logged-in
  // profile; stremio-core will sync on next change.
  try {
    addons = await getAddonCollection(authKey, fetchImpl);
  } catch (_) {
    addons = [];
  }

  return {
    auth: { key: authKey, user },
    addons,
    addonsLocked: false,
    settings: { ...DEFAULT_SETTINGS },
  };
}

const api = {
  API_URL,
  PROFILE_STORAGE_KEY,
  SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  StremioApiError,
  apiCall,
  login,
  getUser,
  getAddonCollection,
  buildProfile,
};

// Dual export: CommonJS for Electron main, and attach to globalThis for any
// plain-script consumer.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StremioApi = api;
}
