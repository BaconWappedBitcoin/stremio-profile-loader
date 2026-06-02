/**
 * Profile persistence for the Electron loader.
 *
 * Profiles live in a JSON file under Electron's per-user `userData` directory.
 * We store only a revocable Stremio authKey (plus the cached user object and a
 * display label) — never the password.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ProfileStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'profiles.json');
    this.data = { version: 1, profiles: [] };
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.profiles)) {
        this.data = parsed;
      }
    } catch (_) {
      // Missing or corrupt file -> start fresh.
      this.data = { version: 1, profiles: [] };
    }
  }

  _save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** Public, password/token-free view for the renderer. */
  list() {
    return this.data.profiles.map((p) => ({
      id: p.id,
      label: p.label,
      email: p.email,
      avatar: p.avatar || null,
      icon: p.icon || null,
    }));
  }

  /** Full record (includes authKey) — main process only. */
  get(id) {
    return this.data.profiles.find((p) => p.id === id) || null;
  }

  add({ label, email, authKey, user, icon }) {
    const profile = {
      id: crypto.randomUUID(),
      label,
      email,
      authKey,
      user: user || null,
      avatar: (user && user.avatar) || null,
      icon: icon || null,
    };
    this.data.profiles.push(profile);
    this._save();
    return profile;
  }

  /** Edit user-facing fields (label, icon) without touching credentials. */
  update(id, { label, icon }) {
    const p = this.get(id);
    if (!p) return null;
    if (typeof label === 'string') p.label = label;
    if (icon !== undefined) p.icon = icon || null;
    this._save();
    return { id: p.id, label: p.label, email: p.email, avatar: p.avatar || null, icon: p.icon || null };
  }

  /** Refresh the cached user/avatar after a successful launch. */
  updateUser(id, user) {
    const p = this.get(id);
    if (!p) return;
    p.user = user || p.user;
    p.avatar = (user && user.avatar) || p.avatar;
    this._save();
  }

  remove(id) {
    const before = this.data.profiles.length;
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id);
    if (this.data.profiles.length !== before) this._save();
  }
}

module.exports = { ProfileStore };
