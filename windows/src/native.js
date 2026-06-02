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
const { spawn, execFile } = require('child_process');
const WebSocket = require('ws');

const DEBUG_PORT = 9222;
const TARGET_HOST = '127.0.0.1';

/** Candidate install locations for the native Stremio executable. */
function stremioCandidates() {
  const LOCALAPPDATA = process.env.LOCALAPPDATA || '';
  const PROGRAMFILES = process.env['ProgramFiles'] || 'C:\\Program Files';
  const PROGRAMFILESX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    process.env.STREMIO_EXE, // explicit override
    path.join(LOCALAPPDATA, 'Programs', 'LNV', 'Stremio-4', 'stremio.exe'),
    path.join(LOCALAPPDATA, 'Programs', 'stremio', 'Stremio.exe'),
    path.join(LOCALAPPDATA, 'Programs', 'stremio-shell-ng', 'Stremio.exe'),
    path.join(PROGRAMFILES, 'Stremio', 'stremio.exe'),
    path.join(PROGRAMFILESX86, 'Stremio', 'stremio.exe'),
  ].filter(Boolean);
}

/** @returns {string|null} the first existing Stremio exe, or null. */
function findStremioExe() {
  for (const candidate of stremioCandidates()) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) { /* ignore */ }
  }
  return null;
}

function killRunningStremio() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(); return; }
    // /T kills child processes too (the bundled streaming server).
    execFile('taskkill', ['/F', '/IM', 'stremio.exe', '/T'], () => {
      execFile('taskkill', ['/F', '/IM', 'Stremio.exe', '/T'], () => resolve());
    });
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

/** Open a CDP websocket, run a sequence of Runtime.evaluate calls, then close. */
function cdpInject(webSocketDebuggerUrl, profileObject, schemaVersion) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const send = (method, params) =>
      new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });

    const seedB64 = Buffer.from(JSON.stringify(profileObject), 'utf8').toString('base64');
    const expr = `(() => {
      try {
        const bytes = Uint8Array.from(atob('${seedB64}'), c => c.charCodeAt(0));
        const json = new TextDecoder('utf-8').decode(bytes);
        localStorage.setItem('profile', json);
        localStorage.setItem('schema_version', '${schemaVersion}');
        location.reload();
        return 'ok';
      } catch (e) { return 'err: ' + e.message; }
    })()`;

    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error('CDP injection timed out')); }, 15000);

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.on('open', async () => {
      try {
        await send('Runtime.enable', {});
        const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        clearTimeout(timer);
        const val = r && r.result && r.result.result && r.result.result.value;
        ws.close();
        if (typeof val === 'string' && val.startsWith('err')) reject(new Error('Injection failed: ' + val));
        else resolve();
      } catch (e) { clearTimeout(timer); reject(e); }
    });
  });
}

/**
 * Full launch: find exe, restart Stremio with debugging, inject the profile.
 * @param {object} profileObject  the localStorage `profile` object
 * @param {string} schemaVersion
 */
async function launchWithProfile(profileObject, schemaVersion) {
  const exe = findStremioExe();
  if (!exe) {
    throw new Error(
      'Could not find the native Stremio app. Install it, or set the STREMIO_EXE ' +
      'environment variable to its full path.'
    );
  }

  await killRunningStremio();
  await sleep(800); // let the single-instance lock and streaming server clear

  const env = Object.assign({}, process.env, {
    QTWEBENGINE_REMOTE_DEBUGGING: String(DEBUG_PORT),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEBUG_PORT}`,
  });

  const child = spawn(exe, [], { env, detached: true, stdio: 'ignore' });
  child.unref();

  const target = await waitForStremioTarget(DEBUG_PORT);
  await cdpInject(target.webSocketDebuggerUrl, profileObject, schemaVersion);
}

module.exports = {
  DEBUG_PORT,
  findStremioExe,
  killRunningStremio,
  waitForStremioTarget,
  launchWithProfile,
};
