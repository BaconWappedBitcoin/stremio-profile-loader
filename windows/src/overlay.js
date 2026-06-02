/**
 * STRLoader in-app profile selector, injected into the NATIVE Stremio app's page
 * via CDP (Page.addScriptToEvaluateOnNewDocument) so it re-mounts on every reload.
 *
 * Self-contained (option 1): it switches profiles by rebuilding the session
 * in-page with window.StremioApi and reloading. Reads STRLOADER_PROFILES /
 * STRLOADER_CURRENT_ID / STRLOADER_SCHEMA from the injected header (see
 * native.js buildOverlaySource). The current profile is derived from the live
 * session (localStorage profile authKey), so it stays correct after switches.
 */
(function () {
  'use strict';

  var PROFILES = (typeof STRLOADER_PROFILES !== 'undefined') ? STRLOADER_PROFILES : [];
  var SCHEMA = (typeof STRLOADER_SCHEMA !== 'undefined') ? STRLOADER_SCHEMA : '22';
  var FALLBACK_ID = (typeof STRLOADER_CURRENT_ID !== 'undefined') ? STRLOADER_CURRENT_ID : null;
  if (!PROFILES.length) return;

  // Matches the picker's avatar (the purple accent gradient).
  var AVATAR_BG = 'linear-gradient(135deg,#7B5BF5,#4A2FB0)';
  function initial(s) { s = (s || '?').trim(); return (s.charAt(0) || '?').toUpperCase(); }
  function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
  function avatar(label, size) {
    return el('div', 'width:' + size + 'px;height:' + size + 'px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-family:sans-serif;font-size:' + (size * 0.42) + 'px;background:' + AVATAR_BG + ';flex:0 0 auto;', initial(label));
  }
  function currentId() {
    try {
      var pf = JSON.parse(localStorage.getItem('profile') || '{}');
      var k = pf && pf.auth && pf.auth.key;
      var m = PROFILES.filter(function (p) { return p.authKey === k; })[0];
      if (m) return m.id;
    } catch (e) { /* ignore */ }
    return FALLBACK_ID;
  }
  function byId(id) { return PROFILES.filter(function (p) { return p.id === id; })[0] || PROFILES[0]; }

  function switchTo(p) {
    if (p.id === currentId()) return;
    if (!window.StremioApi) { window.alert('STRLoader: not ready yet, try again in a moment.'); return; }
    window.StremioApi.buildProfile(p.authKey).then(function (prof) {
      localStorage.setItem('profile', JSON.stringify(prof));
      localStorage.setItem('schema_version', SCHEMA);
      location.reload();
    }).catch(function (e) { window.alert('STRLoader: switch failed — ' + (e && e.message || e)); });
  }

  function mount() {
    if (document.getElementById('strloader-overlay')) return;
    if (!document.body) { setTimeout(mount, 200); return; }

    var cid = currentId();
    var cur = byId(cid);

    var wrap = el('div', 'position:fixed;top:8px;right:12px;z-index:2147483647;font-family:sans-serif;');
    wrap.id = 'strloader-overlay';

    var chip = el('div', 'display:flex;align-items:center;gap:8px;background:rgba(17,17,31,0.92);border:1px solid #2a2a44;border-radius:22px;padding:5px 10px 5px 6px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.45);');
    chip.appendChild(avatar(cur.label, 28));
    chip.appendChild(el('span', 'color:#fff;font-size:13px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', cur.label));
    chip.appendChild(el('span', 'color:#a9a9c7;font-size:11px;margin-left:2px;', '▾'));
    wrap.appendChild(chip);

    var menu = el('div', 'position:absolute;top:46px;right:0;min-width:210px;max-height:70vh;overflow:auto;background:#16162a;border:1px solid #2a2a44;border-radius:12px;padding:6px;box-shadow:0 12px 34px rgba(0,0,0,0.55);display:none;');
    PROFILES.forEach(function (p) {
      var row = el('div', 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;');
      row.onmouseenter = function () { row.style.background = '#20203a'; };
      row.onmouseleave = function () { row.style.background = 'transparent'; };
      row.appendChild(avatar(p.label, 30));
      row.appendChild(el('span', 'color:#fff;font-size:14px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', p.label));
      if (p.id === cid) { row.appendChild(el('span', 'color:#8e72ff;font-size:15px;', '✓')); }
      row.onclick = function () { menu.style.display = 'none'; switchTo(p); };
      menu.appendChild(row);
    });
    wrap.appendChild(menu);

    chip.onclick = function (ev) { ev.stopPropagation(); menu.style.display = (menu.style.display === 'none' ? 'block' : 'none'); };
    document.addEventListener('click', function (ev) { if (!wrap.contains(ev.target)) menu.style.display = 'none'; });

    document.body.appendChild(wrap);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  // Stremio renders asynchronously; retry a couple of times in case body/app
  // isn't ready on first pass.
  setTimeout(mount, 1000);
  setTimeout(mount, 3000);
})();
