#!/usr/bin/env node
/**
 * Diagnostic: verifies that the native Stremio app can be driven by this loader.
 *
 * Run it on a machine with Stremio installed:   npm run doctor
 *
 * It locates Stremio, restarts it with remote-debugging enabled, and reports
 * whether a Stremio web-UI page target shows up on the DevTools port — which is
 * exactly what profile injection relies on.
 */

'use strict';

const http = require('http');
const { spawn } = require('child_process');
const native = require('../src/native');

const PORT = native.DEBUG_PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
  });
}

(async () => {
  console.log('Stremio Profile Loader — doctor\n');

  const exe = native.findStremioExe();
  if (!exe) {
    console.error('✗ Could not find the native Stremio app.');
    console.error('  Install Stremio, or set STREMIO_EXE to its full path, then re-run.');
    process.exit(1);
  }
  console.log('✓ Found Stremio:', exe);

  console.log('• Closing any running Stremio…');
  await native.killRunningStremio();
  await sleep(800);

  console.log(`• Launching Stremio with remote-debugging on port ${PORT}…`);
  const env = Object.assign({}, process.env, {
    QTWEBENGINE_REMOTE_DEBUGGING: String(PORT),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
  });
  const child = spawn(exe, [], { env, detached: true, stdio: 'ignore' });
  child.unref();

  console.log('• Waiting for the DevTools port…');
  const deadline = Date.now() + 40000;
  let targets = null;
  while (Date.now() < deadline) {
    try { targets = await getJson(`http://127.0.0.1:${PORT}/json/list`); break; }
    catch (_) { await sleep(500); }
  }

  if (!targets) {
    console.error(`\n✗ Nothing answered on http://127.0.0.1:${PORT}.`);
    console.error('  This Stremio build likely does NOT expose remote debugging,');
    console.error('  so the native-app injection method will not work as-is.');
    console.error('  Tell the maintainer your Stremio version (Settings → About).');
    process.exit(2);
  }

  console.log(`\n✓ DevTools port is live. Targets seen (${targets.length}):`);
  targets.forEach((t) => console.log(`   [${t.type}] ${t.url}`));

  const page = targets.find((t) => t.type === 'page' && /strem\.io|stremio\.com/i.test(t.url || ''));
  if (page) {
    console.log('\n✓ Found the Stremio web-UI page target:');
    console.log('   ' + page.url);
    console.log('\nThis machine CAN be driven by the loader. 🎉');
    process.exit(0);
  } else {
    console.log('\n△ Port is open but no strem.io page target was matched yet.');
    console.log('  Injection may still work; share the target list above with the maintainer.');
    process.exit(3);
  }
})().catch((e) => { console.error('doctor failed:', e); process.exit(1); });
