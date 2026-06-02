/**
 * Electron main process for Stremio Profile Loader (Windows/desktop).
 *
 * Flow:
 *  1. Show a profile picker (shared UI from ../../shared/picker).
 *  2. "Add profile" logs in via the Stremio API and stores the returned authKey.
 *  3. Launching a profile (re)starts the NATIVE Stremio desktop app with
 *     remote-debugging enabled, attaches over CDP, and seeds that profile's
 *     session into localStorage so the native app opens already signed in.
 *     See native.js.
 */

'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Resolve the shared/ directory both in dev and when packaged (see extraResources
// in package.json -> it lands next to the app under resources/shared).
const SHARED_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'shared')
  : path.join(__dirname, '..', '..', 'shared');

const api = require(path.join(SHARED_DIR, 'stremio-api.js'));
const { ProfileStore } = require('./profiles');
const native = require('./native');

let pickerWindow = null;
let store = null;

function createPickerWindow() {
  pickerWindow = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 600,
    minHeight: 520,
    backgroundColor: '#0b0b15',
    title: 'STRLoader',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'picker-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  pickerWindow.loadFile(path.join(SHARED_DIR, 'picker', 'index.html'));
  pickerWindow.on('closed', () => { pickerWindow = null; });
}

/** Bring the picker window back to the front (from the in-Stremio "Switch" chip). */
function showPicker() {
  if (!pickerWindow) { createPickerWindow(); return; }
  if (pickerWindow.isMinimized()) pickerWindow.restore();
  pickerWindow.show();
  pickerWindow.focus();
}

// ---- IPC: the renderer's LoaderBridge maps onto these handlers ----

ipcMain.handle('profiles:list', () => store.list());

ipcMain.handle('profiles:add', async (_evt, { label, email, password, icon }) => {
  if (!label || !email || !password) {
    throw new Error('Please fill in the profile name, email and password.');
  }
  const { authKey, user } = await api.login(email, password);
  const created = store.add({ label, email, authKey, user, icon });
  return { id: created.id, label: created.label, email: created.email, avatar: created.avatar, icon: created.icon };
});

ipcMain.handle('profiles:update', async (_evt, id, { label, icon }) => {
  if (!label || !label.trim()) throw new Error('Please enter a profile name.');
  const updated = store.update(id, { label: label.trim(), icon });
  if (!updated) throw new Error('Profile not found.');
  return { id: updated.id, label: updated.label, email: updated.email, avatar: updated.avatar, icon: updated.icon };
});

ipcMain.handle('profiles:delete', async (_evt, id) => {
  store.remove(id);
});

ipcMain.handle('profiles:launch', async (_evt, id) => {
  const profile = store.get(id);
  if (!profile) throw new Error('Profile not found.');

  // Validate / refresh the session. getUser throws on an expired or revoked
  // authKey, which is the signal to ask the user to re-add the profile.
  let user;
  try {
    user = await api.getUser(profile.authKey);
  } catch (e) {
    if (e instanceof api.StremioApiError) {
      throw new Error('This profile\'s Stremio session has expired. Remove it and add it again.');
    }
    throw e;
  }
  store.updateUser(id, user);

  let addons = [];
  try { addons = await api.getAddonCollection(profile.authKey); } catch (_) { addons = []; }

  const profileObject = {
    auth: { key: profile.authKey, user },
    addons,
    addonsLocked: false,
    settings: { ...api.DEFAULT_SETTINGS },
  };

  // (Re)launch the native Stremio app signed in to this profile, and inject the
  // in-app chip that reopens this picker (so the user can switch from inside
  // Stremio without hunting for the picker window).
  await native.launchWithProfile({
    profileObject,
    schemaVersion: api.SCHEMA_VERSION,
    overlayProfiles: store.allWithKeys(),
    currentId: id,
    onOpenPicker: showPicker,
  });

  // Keep the picker around (minimized) so the user can switch again later.
  if (pickerWindow) pickerWindow.minimize();
});

app.whenReady().then(() => {
  store = new ProfileStore(app.getPath('userData'));
  createPickerWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPickerWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
