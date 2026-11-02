/* Fleet Film – keeps phones/tablets on the latest version.
   - Registers the (network-first) service worker.
   - Checks version.json when the app is reopened and every 30 min; shows an "Update now" banner if it changed.
   - Any element with [data-app-refresh] does a full clean refresh (clears caches, reloads).
   To release an update: bump the number in version.json. */
(function () {
  const VERSION_URL = 'version.json';
  const CHECK_EVERY_MS = 30 * 60 * 1000;
  let loadedVersion = null;

  // Tidy the URL after a forced refresh (drop the ?refresh=123 cache-buster, keep anything else)
  const withoutRefresh = () => {
    const p = new URLSearchParams(location.search); p.delete('refresh');
    const qs = p.toString();
    return location.pathname + (qs ? '?' + qs : '');
  };
  if (/[?&]refresh=/.test(location.search)) {
    history.replaceState(null, '', withoutRefresh() + location.hash);
  }

  async function fetchVersion() {
    try {
      const r = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      return (await r.json()).version || null;
    } catch { return null; }
  }

  async function forceRefresh() {
    showBanner('Updating…', false);
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (e) { console.warn('refresh:', e); }
    const base = withoutRefresh();
    location.replace(base + (base.includes('?') ? '&' : '?') + 'refresh=' + Date.now() + location.hash);
  }

  function showBanner(text, withButton = true) {
    let b = document.getElementById('update-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'update-banner';
      b.className = 'update-banner';
      b.setAttribute('role', 'alert');
      document.body.appendChild(b);
    }
    b.innerHTML = `<span>${text}</span>` +
      (withButton ? '<button class="btn btn-primary big" data-app-refresh>Update now</button>' : '');
  }

  async function checkForUpdate() {
    const v = await fetchVersion();
    if (!v) return;
    if (!loadedVersion) { loadedVersion = v; setVersionLabels(v); return; }
    if (v !== loadedVersion) showBanner('A new version of Fleet Film is ready.');
  }

  function setVersionLabels(v) {
    document.querySelectorAll('[data-app-version]').forEach(el => { el.textContent = v; });
  }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-app-refresh]')) { e.preventDefault(); forceRefresh(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
  setInterval(checkForUpdate, CHECK_EVERY_MS);

  window.addEventListener('load', () => {
    checkForUpdate();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then(reg => reg.update())
        .catch(console.error);
    }
  });

  window.FleetUpdate = {
    forceRefresh,
    checkForUpdate,
    get version() { return loadedVersion; },
    setVersionLabels: () => loadedVersion && setVersionLabels(loadedVersion),
  };
})();
