/**
 * Profile-picker UI logic. Platform-agnostic: it talks only to `window.LoaderBridge`,
 * an async interface each platform provides.
 *
 *   LoaderBridge.platform            -> string ("electron" | "android")
 *   LoaderBridge.listProfiles()      -> Promise<Array<{id,label,email,avatar?}>>
 *   LoaderBridge.addProfile({label,email,password})
 *                                    -> Promise<{id,label,email,avatar?}>   (logs in, stores authKey)
 *   LoaderBridge.deleteProfile(id)   -> Promise<void>
 *   LoaderBridge.launch(id)          -> Promise<void>   (seeds the session, opens Stremio)
 */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const els = {
    profiles: $('#profiles'),
    status: $('#status'),
    modal: $('#modal'),
    form: $('#profile-form'),
    label: $('#f-label'),
    email: $('#f-email'),
    password: $('#f-password'),
    iconPicker: $('#icon-picker'),
    credentialFields: $('#credential-fields'),
    modalTitle: $('#modal-title'),
    formError: $('#form-error'),
    saveBtn: $('#save-btn'),
    cancelBtn: $('#cancel-btn'),
  };

  let selectedIcon = null;
  let editingId = null; // null => add mode; an id => edit mode

  const PENCIL_SVG = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>';

  function bridge() {
    if (!window.LoaderBridge) {
      throw new Error('LoaderBridge is not available — the host app failed to inject it.');
    }
    return window.LoaderBridge;
  }

  function setStatus(msg, isError) {
    els.status.textContent = msg || '';
    els.status.classList.toggle('is-error', !!isError);
  }

  function initials(label) {
    const parts = (label || '?').trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
  }

  function avatarMarkup(p) {
    if (p.icon && window.LoaderIcons) {
      const svg = window.LoaderIcons.render(p.icon);
      if (svg) return svg;
    }
    if (p.avatar) {
      return `<img src="${escapeAttr(p.avatar)}" alt="" />`;
    }
    return escapeHtml(initials(p.label));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function renderProfiles(profiles) {
    els.profiles.innerHTML = '';

    profiles.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'profile';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.dataset.id = p.id;
      card.innerHTML = `
        <button class="profile__edit" title="Edit profile" aria-label="Edit profile">${PENCIL_SVG}</button>
        <button class="profile__delete" title="Remove profile" aria-label="Remove profile">&times;</button>
        <div class="profile__avatar">${avatarMarkup(p)}</div>
        <div class="profile__label">${escapeHtml(p.label)}</div>
        ${p.email ? `<div class="profile__email">${escapeHtml(p.email)}</div>` : ''}
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.profile__delete') || e.target.closest('.profile__edit')) return;
        launchProfile(p, card);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); launchProfile(p, card); }
      });
      card.querySelector('.profile__delete').addEventListener('click', (e) => {
        e.stopPropagation();
        removeProfile(p);
      });
      card.querySelector('.profile__edit').addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(p);
      });

      els.profiles.appendChild(card);
    });

    // "Add profile" card
    const add = document.createElement('div');
    add.className = 'profile profile--add';
    add.setAttribute('role', 'button');
    add.setAttribute('tabindex', '0');
    add.innerHTML = `
      <div class="profile__avatar">+</div>
      <div class="profile__label">Add profile</div>
    `;
    add.addEventListener('click', openModal);
    add.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(); }
    });
    els.profiles.appendChild(add);
  }

  async function refresh() {
    try {
      const profiles = await bridge().listProfiles();
      renderProfiles(Array.isArray(profiles) ? profiles : []);
      setStatus('');
    } catch (e) {
      setStatus('Could not load profiles: ' + e.message, true);
    }
  }

  async function launchProfile(p, card) {
    card.classList.add('is-loading');
    setStatus('Signing in as ' + p.label + '…');
    try {
      await bridge().launch(p.id);
      setStatus('Signed in as ' + p.label + '.');
    } catch (e) {
      setStatus('Could not launch ' + p.label + ': ' + e.message, true);
    } finally {
      card.classList.remove('is-loading');
    }
  }

  async function removeProfile(p) {
    if (!window.confirm('Remove profile "' + p.label + '"? This only deletes it from this loader, not your Stremio account.')) {
      return;
    }
    try {
      await bridge().deleteProfile(p.id);
      await refresh();
    } catch (e) {
      setStatus('Could not remove profile: ' + e.message, true);
    }
  }

  // ---- Icon picker ----
  function buildIconPicker() {
    const order = (window.LoaderIcons && window.LoaderIcons.order) || [];
    els.iconPicker.innerHTML = '';
    order.forEach((id) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-opt';
      btn.dataset.icon = id;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-label', id);
      btn.innerHTML = window.LoaderIcons.render(id);
      btn.addEventListener('click', () => selectIcon(id));
      els.iconPicker.appendChild(btn);
    });
  }

  function selectIcon(id) {
    selectedIcon = id;
    Array.prototype.forEach.call(els.iconPicker.children, (c) => {
      const on = c.dataset.icon === id;
      c.classList.toggle('is-selected', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  // ---- Modal ----
  // Email + password are only needed when adding; toggle them (and their
  // `required` validation) off in edit mode.
  function setCredentialFieldsVisible(visible) {
    els.credentialFields.hidden = !visible;
    els.email.required = visible;
    els.password.required = visible;
  }

  function defaultIcon() {
    const order = (window.LoaderIcons && window.LoaderIcons.order) || [];
    return order.length ? order[0] : null;
  }

  function deselectAllIcons() {
    selectedIcon = null;
    Array.prototype.forEach.call(els.iconPicker.children, (c) => {
      c.classList.remove('is-selected');
      c.setAttribute('aria-checked', 'false');
    });
  }

  function openModal() {
    editingId = null;
    els.form.reset();
    els.formError.hidden = true;
    els.modalTitle.textContent = 'Add profile';
    els.saveBtn.textContent = 'Sign in & save';
    setCredentialFieldsVisible(true);
    deselectAllIcons();
    const d = defaultIcon();
    if (d) selectIcon(d);
    els.modal.hidden = false;
    setTimeout(() => els.label.focus(), 50);
  }

  function openEditModal(p) {
    editingId = p.id;
    els.form.reset();
    els.formError.hidden = true;
    els.modalTitle.textContent = 'Edit profile';
    els.saveBtn.textContent = 'Save';
    setCredentialFieldsVisible(false);
    els.label.value = p.label || '';
    deselectAllIcons();
    const iconToSelect = p.icon || defaultIcon();
    if (iconToSelect) selectIcon(iconToSelect);
    els.modal.hidden = false;
    setTimeout(() => els.label.focus(), 50);
  }

  function closeModal() { els.modal.hidden = true; }

  function setFormError(msg) {
    els.formError.textContent = msg;
    els.formError.hidden = !msg;
  }

  els.cancelBtn.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.modal.hidden) closeModal(); });

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormError('');
    const isEdit = !!editingId;
    const savedLabel = els.saveBtn.textContent;
    els.saveBtn.disabled = true;
    els.saveBtn.textContent = isEdit ? 'Saving…' : 'Signing in…';
    try {
      if (isEdit) {
        await bridge().updateProfile(editingId, {
          label: els.label.value.trim(),
          icon: selectedIcon,
        });
      } else {
        await bridge().addProfile({
          label: els.label.value.trim(),
          email: els.email.value.trim(),
          password: els.password.value,
          icon: selectedIcon,
        });
      }
      closeModal();
      await refresh();
    } catch (err) {
      setFormError(err.message || (isEdit ? 'Could not save profile.' : 'Sign in failed.'));
    } finally {
      els.saveBtn.disabled = false;
      els.saveBtn.textContent = savedLabel;
    }
  });

  buildIconPicker();

  // Boot once the bridge is ready. Electron injects it before load; Android may
  // inject slightly later, so poll briefly.
  (function waitForBridge(attempt) {
    if (window.LoaderBridge) { refresh(); return; }
    if (attempt > 50) { setStatus('Host bridge unavailable.', true); return; }
    setTimeout(() => waitForBridge(attempt + 1), 40);
  })(0);
})();
