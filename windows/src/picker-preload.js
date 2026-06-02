/**
 * Preload for the picker window. Exposes the async `window.LoaderBridge` API that
 * the shared picker UI expects, backed by IPC to the main process.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ipcMain.handle rejections reach the renderer as
//   "Error invoking remote method 'X': SomeError: real message"
// Strip the IPC + error-class prefixes so the UI shows a clean message.
function clean(err) {
  let msg = (err && err.message) || String(err);
  msg = msg.replace(/^Error invoking remote method '[^']*':\s*/, '');
  msg = msg.replace(/^[A-Za-z]*Error:\s*/, '');
  return new Error(msg);
}

const invoke = (channel, ...args) =>
  ipcRenderer.invoke(channel, ...args).catch((e) => { throw clean(e); });

contextBridge.exposeInMainWorld('LoaderBridge', {
  platform: 'electron',
  listProfiles: () => invoke('profiles:list'),
  addProfile: (data) => invoke('profiles:add', data),
  updateProfile: (id, data) => invoke('profiles:update', id, data),
  deleteProfile: (id) => invoke('profiles:delete', id),
  launch: (id) => invoke('profiles:launch', id),
});
