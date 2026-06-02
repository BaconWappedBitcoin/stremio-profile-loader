/**
 * STRLoader chip injected into the NATIVE Stremio app's page via CDP
 * (Page.addScriptToEvaluateOnNewDocument, so it re-mounts on every reload).
 *
 * It shows the current profile and, when clicked, reopens the STRLoader picker
 * (the Electron window) via the `strloaderOpenPicker` CDP binding — switching
 * happens there, in a guaranteed-interactive native window, rather than in a
 * fragile in-page menu. Hidden while a video is playing (the player route).
 *
 * Reads STRLOADER_PROFILES / STRLOADER_CURRENT_ID from the injected header
 * (see native.js buildOverlaySource).
 */
(function () {
  'use strict';

  var PROFILES = (typeof STRLOADER_PROFILES !== 'undefined') ? STRLOADER_PROFILES : [];
  var FALLBACK_ID = (typeof STRLOADER_CURRENT_ID !== 'undefined') ? STRLOADER_CURRENT_ID : null;
  if (!PROFILES.length) return;

  // Matches the picker's avatar (purple accent gradient).
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
  function openPicker() { try { if (window.strloaderOpenPicker) window.strloaderOpenPicker(''); } catch (e) { /* ignore */ } }

  function mount() {
    if (document.getElementById('strloader-overlay')) return;
    if (!document.body) { setTimeout(mount, 200); return; }

    var cur = byId(currentId());

    // Bottom-center: window corners are OS resize grips and the top strip is the
    // title-bar drag region, both of which eat clicks before the page sees them.
    var wrap = el('div', 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:2147483647;font-family:sans-serif;-webkit-app-region:no-drag;');
    wrap.id = 'strloader-overlay';

    var chip = el('div', 'display:flex;align-items:center;gap:8px;background:rgba(17,17,31,0.94);border:1px solid #2a2a44;border-radius:22px;padding:5px 14px 5px 6px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.45);');
    chip.appendChild(avatar(cur.label, 28));
    chip.appendChild(el('span', 'color:#fff;font-size:13px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', cur.label));
    chip.appendChild(el('span', 'color:#b9a9ff;font-size:12px;font-weight:600;margin-left:4px;', 'Switch ▸'));
    chip.title = 'Switch profile';
    chip.onclick = openPicker;
    wrap.appendChild(chip);

    // Hide while a video is playing (the player route).
    function updateVisibility() {
      var onPlayer = (location.hash || '').indexOf('/player') !== -1;
      wrap.style.display = onPlayer ? 'none' : '';
    }
    window.addEventListener('hashchange', updateVisibility);
    setInterval(updateVisibility, 600);
    updateVisibility();

    document.body.appendChild(wrap);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  setTimeout(mount, 1000);
  setTimeout(mount, 3000);
})();
