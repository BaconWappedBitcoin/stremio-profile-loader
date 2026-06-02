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
      // /s recurses subkeys; find a Stremio entry's InstallLocation value.
      const out = execFileSync('reg', ['query', root, '/s', '/f', 'Stremio', '/d'], {
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
    let i = 0;
    const next = () => {
      if (i >= names.length) { resolve(); return; }
      execFile('taskkill', ['/F', '/IM', names[i++], '/T'], () => next());
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
 * Build the script injected into every Stremio document: the shared API module
 * (defines window.StremioApi) + the profile data header + the overlay UI. Uses
 * string concatenation (not a template literal) so backticks inside apiSource /
 * overlay are preserved verbatim.
 */
function buildOverlaySource(apiSource, profiles, currentId, schemaVersion) {
  const overlayBody = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8');
  const header =
    'var STRLOADER_PROFILES=' + JSON.stringify(profiles) + ';' +
    'var STRLOADER_CURRENT_ID=' + JSON.stringify(currentId) + ';' +
    'var STRLOADER_SCHEMA=' + JSON.stringify(schemaVersion) + ';';
  return '(function(){\n' + apiSource + '\n' + header + '\n' + overlayBody + '\n})();';
}

/**
 * Open a CDP websocket (kept open), register the overlay to run on every new
 * document, then seed the launched profile's session and reload.
 */
function setupOverlayAndSeed(webSocketDebuggerUrl, opts) {
  const { profileObject, schemaVersion, overlayProfiles, currentId, apiSource } = opts;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const send = (method, params) =>
      new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });

    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error('CDP setup timed out')); }, 20000);

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    ws.on('error', (e) => { clearTimeout(timer); if (activeCdp && activeCdp.ws === ws) activeCdp = null; reject(e); });
    ws.on('close', () => { if (activeCdp && activeCdp.ws === ws) activeCdp = null; });
    ws.on('open', async () => {
      try {
        await send('Page.enable', {});
        await send('Runtime.enable', {});

        const source = buildOverlaySource(apiSource, overlayProfiles, currentId, schemaVersion);
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
 * @param {object} opts {profileObject, schemaVersion, overlayProfiles, currentId, apiSource}
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
