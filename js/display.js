/* Fleet Film – per-device display settings: text size + light/dark theme.
   Loaded in <head> (not deferred) so the settings apply before the page draws. */
(function () {
  const KEY = 'fleetfilm-display';
  const root = document.documentElement;

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  }
  function apply(s) {
    root.dataset.textsize = s.textsize || 'normal';
    root.dataset.theme = s.theme || 'dark';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = root.dataset.theme === 'light' ? '#ffffff' : '#0a0a0f';
  }

  let settings = read();
  apply(settings);

  const OPTIONS = {
    textsize: [['normal', 'Standard'], ['large', 'Large'], ['xlarge', 'Extra large']],
    theme:    [['dark', 'Dark'], ['light', 'Light']],
  };

  function open() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const seg = key => OPTIONS[key].map(([v, label]) =>
      `<button class="btn" data-set="${key}" data-val="${v}" aria-pressed="${(settings[key] || OPTIONS[key][0][0]) === v}">${label}</button>`).join('');
    overlay.innerHTML = `
      <div class="modal" style="max-width:460px;" role="dialog" aria-label="Display settings">
        <div class="modal-head"><h2>Display</h2><button class="btn btn-ghost" data-close>✕ Close</button></div>
        <div class="settings-group"><div class="subhead">Text size</div><div class="seg">${seg('textsize')}</div></div>
        <div class="settings-group"><div class="subhead">Colours</div><div class="seg">${seg('theme')}</div></div>
        <div class="hr"></div>
        <div class="settings-group">
          <div class="subhead">App version</div>
          <p style="color:var(--ink-2);margin-bottom:10px;">You are using version <strong data-app-version>…</strong>.
          If something looks out of date, tap below to load the latest version.</p>
          <button class="btn btn-primary big" data-app-refresh style="width:100%;">⟳ Get latest version</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    window.FleetUpdate?.setVersionLabels();
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-close]')) { overlay.remove(); return; }
      const b = e.target.closest('[data-set]');
      if (!b) return;
      settings = { ...settings, [b.dataset.set]: b.dataset.val };
      save(settings); apply(settings);
      overlay.querySelectorAll(`[data-set="${b.dataset.set}"]`).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    });
  }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-open-display]')) { e.preventDefault(); open(); }
  });
  window.openDisplaySettings = open;
})();
