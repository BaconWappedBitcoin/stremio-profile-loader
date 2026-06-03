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
const { safeStorage } = require('electron');

class ProfileStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'profiles.json');
    this.data = { version: 1, profiles: [] };
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file);
      if (!raw || raw.length === 0) throw new Error('empty file');
      let json;
      // Try encrypted format first (safeStorage), then plaintext (legacy migration).
      if (safeStorage.isEncryptionAvailable()) {
        try {
          json = safeStorage.decryptString(raw);
        } catch (_) {
          // Not encrypted or wrong key — try plaintext for migration.
          json = raw.toString('utf8');
        }
      } else {
        json = raw.toString('utf8');
      }
      const parsed = JSON.parse(json);
      if (parsed && Array.isArray(parsed.profiles)) {
        // Validate each profile has required fields; skip invalid entries.
        parsed.profiles = parsed.profiles.filter((p) =>
          p && typeof p.id === 'string' && typeof p.label === 'string' && typeof p.authKey === 'string'
        );
        this.data = parsed;
        // Migrate: re-save encrypted if we loaded plaintext successfully.
        // Wrap in its own try/catch — migration failure must not clear profiles.
        if (safeStorage.isEncryptionAvailable()) {
          try { this._save(); } catch (_) { /* non-fatal: will retry on next save */ }
        }
      }
    } catch (_) {
      // Missing, corrupt, or unreadable file -> start fresh.
      this.data = { version: 1, profiles: [] };
    }
  }

  _save() {
    const tmp = this.file + '.tmp';
    try {
      const json = JSON.stringify(this.data, null, 2);
      const content = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(json)
        : Buffer.from(json, 'utf8');
      fs.writeFileSync(tmp, content, { mode: 0o600 });
      // On Windows renameSync fails if the target is locked; retry once.
      try {
        fs.renameSync(tmp, this.file);
      } catch (renameErr) {
        try { fs.copyFileSync(tmp, this.file); fs.unlinkSync(tmp); } catch (_) {
          throw renameErr;
        }
      }
    } catch (writeErr) {
      // If we wrote a temp file but failed the rename/copy, clean up.
      try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ }
      throw writeErr;
    }
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

  /** Profile labels for the in-app overlay selector — NO authKeys (never exposed to page context). */
  allForOverlay() {
    return this.data.profiles.map((p) => ({ id: p.id, label: p.label }));
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
