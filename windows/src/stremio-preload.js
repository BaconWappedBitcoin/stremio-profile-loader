/**
 * Preload for the Stremio window. Runs before Stremio Web's own scripts and
 * seeds localStorage with the chosen profile's session, so the app boots signed in.
 *
 * Requires contextIsolation:false so this shares the page's window/localStorage.
 * The seed (a base64 JSON profile) and schema version are passed via
 * additionalArguments from the main process.
 */

'use strict';

(function seedSession() {
  try {
    const seedArg = process.argv.find((a) => a.startsWith('--stremio-seed='));
    const schemaArg = process.argv.find((a) => a.startsWith('--stremio-schema='));
    if (!seedArg) return;

    const profileJson = Buffer.from(seedArg.split('=')[1], 'base64').toString('utf8');
    const schema = schemaArg ? schemaArg.split('=')[1] : '22';

    // localStorage is the web.stremio.com origin's store; setting it here, before
    // Stremio's bundle runs, makes stremio-core deserialize an authenticated profile.
    window.localStorage.setItem('profile', profileJson);
    window.localStorage.setItem('schema_version', schema);
  } catch (e) {
    // Non-fatal: if seeding fails Stremio simply shows its own login screen.
    // eslint-disable-next-line no-console
    console.error('[stremio-profile-loader] failed to seed session:', e);
  }
})();
