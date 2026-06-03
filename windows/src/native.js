/**
 * Drives the NATIVE Stremio desktop app (not a web wrapper).
 *
 * Stremio's desktop shell is a native window wrapping the same web UI; its login
 * lives in the embedded browser engine's localStorage. We launch the real
 * stremio.exe with remote-debugging enabled, attach over the Chrome DevTools
 * Protocol, write the chosen profile into localStorage, and reload — so the
 * native app ends up signed into that account.
 *
 * Two engines are covered by setting both env vars before launch:
 *   - QtWebEngine shell (Stremio 4.x): QTWEBENGINE_REMOTE_DEBUGGING
 *   - WebView2 shell (stremio-shell-ng): WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
 * Whichever engine the installed app uses will expose the DevTools port.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile, execFileSync } = require('child_process');
const WebSocket = require('ws');

const DEBUG_PORT = 9222;
const TARGET_HOST = '127.0.0.1';

// Shell executables in preference order. stremio-shell-ng.exe is the Stremio 5
// (WebView2) shell; stremio.exe is the Stremio 4 (QtWebEngine) shell.
const SHELL_EXE_NAMES = ['stremio-shell-ng.exe', 'stremio.exe', 'Stremio.exe'];

/** Candidate install locations for the native Stremio executable. */
function stremioCandidates() {
  const LOCALAPPDATA = process.env.LOCALAPPDATA || '';
  const PROGRAMFILES = process.env['ProgramFiles'] || 'C:\\Program Files';
  const PROGRAMFILESX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const dirs = [
    path.join(LOCALAPPDATA, 'Programs', 'Stremio'),          // Stremio 5 (shell-ng)
    path.join(LOCALAPPDATA, 'Programs', 'LNV', 'Stremio-4'), // Stremio 4
    path.join(LOCALAPPDATA, 'Programs', 'stremio'),
    path.join(PROGRAMFILES, 'Stremio'),
    path.join(PROGRAMFILESX86, 'Stremio'),
    registryInstallLocation(),
  ].filter(Boolean);

  const list = [];
  if (process.env.STREMIO_EXE) list.push(process.env.STREMIO_EXE); // explicit override
  for (const dir of dirs) {
    for (const name of SHELL_EXE_NAMES) list.push(path.join(dir, name));
  }
  return list;
}

/** Read Stremio's InstallLocation from the Windows uninstall registry, if present. */
function registryInstallLocation() {
  if (process.platform !== 'win32') return null;
  const roots = [
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  for (const root of roots) {
    try {
      // Search key names containing "Stremio" (tightened from generic data search).
      const out = execFileSync('reg', ['query', root, '/s', '/f', 'Stremio', '/k'], {
        encoding: 'utf8', windowsHide: true, timeout: 4000,
      });
      const m = out.match(/InstallLocation\s+REG_SZ\s+(.+)/i);
      if (m) return m[1].trim();
    } catch (_) { /* key missing or reg failed */ }
  }
  return null;
}

/** @returns {string|null} the first existing Stremio exe, or null. */
function findStremioExe() {
  for (const candidate of stremioCandidates()) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch (_) { /* ignore */ }
  }
  return null;
}

function killRunningStremio() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(); return; }
    // /T kills child processes too (the bundled streaming server / runtime).
    const names = ['stremio-shell-ng.exe', 'stremio.exe', 'Stremio.exe', 'stremio-runtime.exe'];
    const procs = names.map((n) => n.toLowerCase());
    let i = 0;
    const next = () => {
      if (i >= names.length) { verifyGone(4); return; }
      execFile('taskkill', ['/F', '/IM', names[i++], '/T'], () => next());
    };
    const verifyGone = (retries) => {
      if (retries <= 0) { resolve(); return; }
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 3000 }, (err, stdout) => {
        if (err) { resolve(); return; }
        const still = (stdout || '').toLowerCase();
        const alive = procs.some((p) => still.includes(p));
        if (!alive) { resolve(); return; }
        setTimeout(() => verifyGone(retries - 1), 400);
      });
    };
    next();
  });
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll the DevTools HTTP endpoint until a Stremio web-UI page target appears. */
async function waitForStremioTarget(port, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const list = await httpGetJson(`http://${TARGET_HOST}:${port}/json/list`);
      const page = list.find((t) =>
        t.type === 'page' && /strem\.io|stremio\.com/i.test(t.url || ''));
      if (page && page.webSocketDebuggerUrl) return page;
      // Fall back to any page target once the engine is up but URL not matched yet.
    } catch (e) {
      lastErr = e;
    }
    await sleep(500);
  }
  throw new Error(
    'Could not reach Stremio\'s debug port. Your Stremio build may not expose ' +
    'remote debugging. Run "npm run doctor" for details.' +
    (lastErr ? ` (${lastErr.message})` : '')
  );
}

// The live CDP connection to the running Stremio window. Kept open for the
// window's lifetime so the injected overlay re-mounts on every reload.
let activeCdp = null;

function closeActiveCdp() {
  if (activeCdp && activeCdp.ws) { try { activeCdp.ws.close(); } catch (_) {} }
  activeCdp = null;
}

/**
 * Build the script injected into every Stremio document: the profile-data header
 * + the overlay chip. The chip reopens the picker via the strloaderOpenPicker
 * binding, so no in-page switching / API module is needed.
 */
function buildOverlaySource(profiles, currentId) {
  const overlayBody = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8');
  // Escape U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) which are
  // valid JSON but break JS string literals in pre-ES2019 engines (defense in depth).
  const safeJson = (obj) => JSON.stringify(obj).replace(/\u2028|\u2029/g, '');
  const header =
    'var STRLOADER_PROFILES=' + safeJson(profiles) + ';' +
    'var STRLOADER_CURRENT_ID=' + safeJson(currentId) + ';';
  return '(function(){\n' + header + '\n' + overlayBody + '\n})();';
}

/**
 * Open a CDP websocket (kept open), register the overlay to run on every new
 * document, then seed the launched profile's session and reload.
 */
function setupOverlayAndSeed(webSocketDebuggerUrl, opts) {
  const { profileObject, schemaVersion, overlayProfiles, currentId, onOpenPicker } = opts;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const send = (method, params) =>
      new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        try { ws.send(JSON.stringify({ id: mid, method, params })); }
        catch (e) { pending.delete(mid); rej(e); }
      });

    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error('CDP setup timed out')); }, 20000);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) {
          rej(new Error(`CDP ${msg.error.message || 'unknown error'} (code: ${msg.error.code || 'N/A'})`));
        } else {
          res(msg);
        }
        return;
      }
      // The injected chip calls window.strloaderOpenPicker() -> reopen the picker.
      if (msg.method === 'Runtime.bindingCalled' && msg.params && msg.params.name === 'strloaderOpenPicker') {
        try { if (typeof onOpenPicker === 'function') onOpenPicker(); } catch (_) {}
      }
    });
    ws.on('error', (e) => { clearTimeout(timer); if (activeCdp && activeCdp.ws === ws) activeCdp = null; reject(e); });
    ws.on('close', () => { if (activeCdp && activeCdp.ws === ws) activeCdp = null; });
    ws.on('open', async () => {
      try {
        await send('Page.enable', {});
        await send('Runtime.enable', {});
        // Expose window.strloaderOpenPicker on the page (and future reloads).
        await send('Runtime.addBinding', { name: 'strloaderOpenPicker' });

        const source = buildOverlaySource(overlayProfiles, currentId);
        await send('Page.addScriptToEvaluateOnNewDocument', { source });

        // Seed the launched profile, then reload so the registered script runs
        // on the fresh document (overlay + StremioApi + an authenticated session).
        const seedB64 = Buffer.from(JSON.stringify(profileObject), 'utf8').toString('base64');
        const seedExpr =
          "(function(){try{var b=Uint8Array.from(atob('" + seedB64 + "'),function(c){return c.charCodeAt(0);});" +
          "localStorage.setItem('profile',new TextDecoder('utf-8').decode(b));" +
          "localStorage.setItem('schema_version','" + schemaVersion + "');location.reload();}catch(e){}})()";
        await send('Runtime.evaluate', { expression: seedExpr });

        clearTimeout(timer);
        activeCdp = { ws };
        resolve();
      } catch (e) { clearTimeout(timer); reject(e); }
    });
  });
}

/**
 * Full launch: find exe, restart Stremio with debugging, inject the profile
 * session + the in-app profile selector overlay.
 * @param {object} opts {profileObject, schemaVersion, overlayProfiles, currentId, onOpenPicker}
 */
async function launchWithProfile(opts) {
  const exe = findStremioExe();
  if (!exe) {
    throw new Error(
      'Could not find the native Stremio app. Install it, or set the STREMIO_EXE ' +
      'environment variable to its full path.'
    );
  }

  closeActiveCdp();
  await killRunningStremio();
  await sleep(800); // let the single-instance lock and streaming server clear

  const env = Object.assign({}, process.env, {
    QTWEBENGINE_REMOTE_DEBUGGING: String(DEBUG_PORT),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEBUG_PORT}`,
  });

  const child = spawn(exe, [], { env, detached: true, stdio: 'ignore' });
  child.unref();

  const target = await waitForStremioTarget(DEBUG_PORT);
  await setupOverlayAndSeed(target.webSocketDebuggerUrl, opts);
}

module.exports = {
  DEBUG_PORT,
  findStremioExe,
  killRunningStremio,
  waitForStremioTarget,
  launchWithProfile,
};
