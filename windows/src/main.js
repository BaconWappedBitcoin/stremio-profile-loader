/**
 * Electron main process for Stremio Profile Loader (Windows/desktop).
 *
 * Flow:
 *  1. Show a profile picker (shared UI from ../../shared/picker).
 *  2. "Add profile" logs in via the Stremio API and stores the returned authKey.
 *  3. Launching a profile opens web.stremio.com in a fresh window whose
 *     localStorage is pre-seeded with that profile's session, so Stremio loads
 *     already signed in.
 */

'use strict';

const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');

// Resolve the shared/ directory both in dev and when packaged (see extraResources
// in package.json -> it lands next to the app under resources/shared).
const SHARED_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'shared')
  : path.join(__dirname, '..', '..', 'shared');

const api = require(path.join(SHARED_DIR, 'stremio-api.js'));
const { ProfileStore } = require('./profiles');

const STREMIO_WEB_URL = 'https://web.stremio.com/';

let pickerWindow = null;
let store = null;

function createPickerWindow() {
  pickerWindow = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 600,
    minHeight: 520,
    backgroundColor: '#0b0b15',
    title: 'Stremio Profile Loader',
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

/**
 * Open Stremio Web in a dedicated window, pre-seeded with the given profile JSON.
 * Each profile gets its own persistent session partition so they stay isolated.
 */
function openStremio(profileId, profileObject) {
  const seed = Buffer.from(JSON.stringify(profileObject), 'utf8').toString('base64');

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0b0b15',
    title: 'Stremio',
    autoHideMenuBar: true,
    webPreferences: {
      partition: `persist:stremio-${profileId}`,
      preload: path.join(__dirname, 'stremio-preload.js'),
      // contextIsolation must be off so the preload can write the page's
      // localStorage before Stremio's own scripts read it. The window only ever
      // loads the trusted web.stremio.com origin.
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
      additionalArguments: [
        `--stremio-seed=${seed}`,
        `--stremio-schema=${api.SCHEMA_VERSION}`,
      ],
    },
  });

  // Open external links (addon configure pages, etc.) in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  win.loadURL(STREMIO_WEB_URL);
  return win;
}

// ---- IPC: the renderer's LoaderBridge maps onto these handlers ----

ipcMain.handle('profiles:list', () => store.list());

ipcMain.handle('profiles:add', async (_evt, { label, email, password }) => {
  if (!label || !email || !password) {
    throw new Error('Please fill in the profile name, email and password.');
  }
  const { authKey, user } = await api.login(email, password);
  const created = store.add({ label, email, authKey, user });
  return { id: created.id, label: created.label, email: created.email, avatar: created.avatar };
});

ipcMain.handle('profiles:delete', async (_evt, id) => {
  store.remove(id);
  // Best-effort: wipe that profile's isolated Stremio session data.
  try {
    await session.fromPartition(`persist:stremio-${id}`).clearStorageData();
  } catch (_) { /* ignore */ }
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

  openStremio(id, profileObject);

  // Close the picker once Stremio is launching.
  if (pickerWindow) pickerWindow.close();
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
