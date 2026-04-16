/* Fleet Film App – Film List landing, TMDB-powered, Passport-centric */

let app, auth, db;
const state = { user: null, role: 'member' };
function isAdmin() { return state.role === 'admin'; }

function currentActor() {
  return {
    uid:   state.user?.uid   || null,
    email: state.user?.email || '',
    name:  state.user?.displayName || state.user?.email || ''
  };
}

async function logAudit(filmId, action, details = {}) {
  try {
    if (!filmId) return;
    const a = currentActor();
    await db.collection('films').doc(filmId).collection('audit').add({
      action, details, byUid: a.uid, byEmail: a.email, byName: a.name,
      at: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) { console.warn('audit:', e?.message); }
}

async function deleteFilmCompletely(filmId) {
  const ref = db.collection('films').doc(filmId);
  const vs = await ref.collection('votes').get();
  const batch = db.batch();
  vs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  await ref.delete();
}

/* =================== TMDB =================== */
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG  = 'https://image.tmdb.org/t/p/w342';

function getTmdbKey() {
  return (window.__FLEETFILM__CONFIG?.tmdbApiKey) || '01ad889e5a067c30e081abc72e5f93c7';
}

async function tmdbFetch(path, params = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set('api_key', getTmdbKey());
  url.searchParams.set('language', 'en-GB');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}

async function tmdbSearch(query, year) {
  const params = { query, include_adult: false };
  if (year) params.year = year;
  const data = await tmdbFetch('/search/movie', params);
  return data.results || [];
}

async function tmdbDetailsById(id) {
  // Accept TMDB numeric id or IMDb tt-id
  if (String(id).startsWith('tt')) {
    const data = await tmdbFetch('/find/' + id, { external_source: 'imdb_id' });
    const r = data.movie_results || [];
    if (!r.length) return null;
    id = r[0].id;
  }
  const [detail, credits] = await Promise.all([
    tmdbFetch(`/movie/${id}`, { append_to_response: 'release_dates' }),
    tmdbFetch(`/movie/${id}/credits`)
  ]);
  return { detail, credits };
}

function extractUkRating(detail) {
  const rd = detail.release_dates?.results;
  if (!rd) return '';
  const gb = rd.find(r => r.iso_3166_1 === 'GB');
  if (gb) { const c = gb.release_dates?.find(d => d.certification)?.certification; if (c) return c; }
  const us = rd.find(r => r.iso_3166_1 === 'US');
  if (us) return us.release_dates?.find(d => d.certification)?.certification || '';
  return '';
}

function tmdbToFields(detail, credits) {
  return {
    title:         detail.title || detail.original_title || '',
    originalTitle: detail.original_title !== detail.title ? (detail.original_title || '') : '',
    year:          detail.release_date ? parseInt(detail.release_date.slice(0, 4), 10) : null,
    synopsis:      detail.overview || '',
    runtimeMinutes:detail.runtime || null,
    language:      detail.spoken_languages?.map(l => l.english_name || l.name).filter(Boolean).join(', ') || detail.original_language || '',
    country:       detail.production_countries?.map(c => c.name).filter(Boolean).join(', ') || '',
    genre:         detail.genres?.map(g => g.name).filter(Boolean).join(', ') || '',
    ukAgeRating:   extractUkRating(detail),
    ageRating:     extractUkRating(detail),
    posterUrl:     detail.poster_path ? TMDB_IMG + detail.poster_path : '',
    tmdbId:        String(detail.id),
    imdbID:        detail.imdb_id || '',
    director:      credits?.crew?.filter(c => c.job === 'Director').map(c => c.name).join(', ') || '',
  };
}

/* =================== TMDB Picker =================== */
function showTmdbPicker(results, initialQuery) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-head">
          <h2>Select the correct film</h2>
          <div style="display:flex;gap:8px">
            <button id="picker-manual" class="btn btn-ghost">Add manually</button>
            <button id="picker-cancel" class="btn btn-ghost">✕</button>
          </div>
        </div>
        <div class="tmdb-search-row">
          <input id="picker-q" type="text" placeholder="Refine search…" value="${escapeHtml(initialQuery)}">
          <button class="btn btn-primary" id="picker-search">Search</button>
        </div>
        <div id="picker-list" class="modal-list"></div>
      </div>`;
    document.body.appendChild(overlay);

    const renderResults = items => {
      const list = overlay.querySelector('#picker-list');
      if (!items.length) {
        list.innerHTML = `<div class="tmdb-no-result"><div style="font-size:40px;margin-bottom:10px;">🎬</div>No results. Try different spelling or add manually.</div>`;
        return;
      }
      list.innerHTML = '';
      items.forEach(it => {
        const year = it.release_date?.slice(0, 4) || '?';
        const poster = it.poster_path
          ? `<img src="${TMDB_IMG}${it.poster_path}" alt="poster" class="poster-small" loading="lazy">`
          : '<div class="poster-small" style="display:flex;align-items:center;justify-content:center;font-size:20px;background:var(--surface-2);">🎬</div>';
        const row = document.createElement('div');
        row.className = 'modal-row';
        row.innerHTML = poster +
          `<div class="modal-row-main">
            <div class="modal-row-title">${escapeHtml(it.title)}${it.original_title && it.original_title !== it.title ? ` <span style="color:var(--ink-3);font-size:13px;font-style:italic;">(${escapeHtml(it.original_title)})</span>` : ''}</div>
            <div class="modal-row-sub">${year} · <span style="text-transform:uppercase;font-size:10px;background:var(--gold-soft);color:var(--gold);padding:1px 5px;border-radius:4px;">${it.original_language||''}</span>${it.vote_count > 0 ? ` · ★ ${it.vote_average?.toFixed(1)}` : ''}</div>
            ${it.overview ? `<div style="font-size:12px;color:var(--ink-3);margin-top:4px;line-height:1.4;">${escapeHtml(it.overview.slice(0,120))}${it.overview.length>120?'…':''}</div>` : ''}
          </div>
          <button data-tmdb-id="${it.id}" class="btn btn-primary" style="flex-shrink:0;">Select</button>`;
        list.appendChild(row);
      });
    };

    renderResults(results);

    const doSearch = async () => {
      const q = overlay.querySelector('#picker-q').value.trim();
      if (!q) return;
      overlay.querySelector('#picker-list').innerHTML = '<div class="notice">Searching…</div>';
      try { renderResults(await tmdbSearch(q, null)); }
      catch { overlay.querySelector('#picker-list').innerHTML = '<div class="notice">Search failed. Try again.</div>'; }
    };

    overlay.querySelector('#picker-search').onclick = doSearch;
    overlay.querySelector('#picker-q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    overlay.querySelector('#picker-cancel').onclick = () => { document.body.removeChild(overlay); resolve({ mode: 'cancel' }); };
    overlay.querySelector('#picker-manual').onclick = () => { document.body.removeChild(overlay); resolve({ mode: 'manual' }); };
    overlay.querySelector('#picker-list').addEventListener('click', e => {
      const btn = e.target.closest('button[data-tmdb-id]');
      if (!btn) return;
      document.body.removeChild(overlay);
      resolve({ mode: 'pick', tmdbId: btn.getAttribute('data-tmdb-id') });
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) { document.body.removeChild(overlay); resolve({ mode: 'cancel' }); } });
  });
}

/* =================== Add Film Modal (simple) =================== */
function showAddFilmModal() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:480px;">
        <div class="modal-head">
          <h2>Add a Film</h2>
          <button class="btn btn-ghost" id="af-cancel">✕</button>
        </div>
        <div class="notice" style="margin-bottom:4px;">We'll search TMDB for the film details and poster. Great coverage of world cinema and foreign language films.</div>
        <label>Film Title (required)
          <input id="af-title" type="text" placeholder="e.g. Capernaum, Portrait of a Lady on Fire…" autofocus>
        </label>
        <label>Year <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional — helps narrow results)</span>
          <input id="af-year" type="number" placeholder="e.g. 2018">
        </label>
        <div class="actions" style="margin-top:16px;">
          <button class="btn btn-primary big" id="af-search" style="flex:1;">Search TMDB</button>
          <button class="btn btn-ghost" id="af-manual">Add manually</button>
        </div>
        <div id="af-msg" class="notice hidden" style="margin-top:8px;"></div>
      </div>`;
    document.body.appendChild(overlay);

    const $ = sel => overlay.querySelector(sel);
    const close = res => { document.body.removeChild(overlay); resolve(res); };

    $('#af-cancel').onclick = () => close(null);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    $('#af-manual').onclick = () => {
      const title = ($('#af-title').value || '').trim();
      if (!title) { showMsg('Enter a title first'); return; }
      close({ mode: 'manual', title, year: parseInt($('#af-year').value||'0',10)||null });
    };

    const showMsg = msg => { const m = $('#af-msg'); m.textContent = msg; m.classList.remove('hidden'); };

    // Allow Enter key on title to trigger search
    $('#af-title').addEventListener('keydown', e => { if (e.key === 'Enter') $('#af-search').click(); });

    $('#af-search').onclick = async () => {
      const title = ($('#af-title').value || '').trim();
      if (!title) { showMsg('Please enter a film title.'); return; }
      const year = parseInt($('#af-year').value || '0', 10) || null;
      $('#af-search').textContent = 'Searching…';
      $('#af-search').disabled = true;
      try {
        let results = await tmdbSearch(title, year);
        if (!results.length && year) results = await tmdbSearch(title, null); // retry without year
        close({ mode: 'search', title, year, results });
      } catch (e) {
        showMsg('Could not reach TMDB. Check your connection.');
        $('#af-search').textContent = 'Search TMDB';
        $('#af-search').disabled = false;
      }
    };
  });
}

/* =================== PAGE DEFS =================== */
const PAGE_DEFS = [
  ['films',     'Film List'],
  ['green',     'Green List'],
  ['nextprog',  'Next Programme'],
  ['discarded', 'Discarded'],
  ['archive',   'Archive'],
  ['calendar',  'Calendar'],
  ['addresses', 'Addresses'],
];
const STATUS_LABELS = { pending:'Pending', greenlist:'Green List', next_programme:'Next Programme', discarded:'Discarded', archived:'Archived' };
function humanStatus(s) { return STATUS_LABELS[s] || s || ''; }

/* =================== Calendar =================== */
let calOffset = 0;
function mondayIndex(d) { return (d + 6) % 7; }
function monthLabel(y, m) { return new Date(y, m, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' }); }

function buildCalendarGridHTML(year, month, byISO) {
  const days = new Date(year, month + 1, 0).getDate();
  const first = mondayIndex(new Date(year, month, 1).getDay());
  const hdr = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(w => `<div class="cal-wd">${w}</div>`).join('');
  let cells = '';
  for (let i = 0; i < first; i++) cells += '<div class="cal-cell empty"></div>';
  for (let d = 1; d <= days; d++) {
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const items = byISO[iso] || [];
    const pills = items.map(({text, id}, i) => `<button class="cal-pill c${i%4}" data-film-id="${id}">${escapeHtml(text)}</button>`).join('');
    cells += `<div class="cal-cell"><div class="cal-day">${d}</div>${pills}</div>`;
  }
  return hdr + cells;
}

async function refreshCalendarOnly() {
  const titleEl = document.getElementById('cal-title');
  const gridEl  = document.getElementById('cal-grid');
  if (!titleEl || !gridEl) return;
  const snap = await db.collection('films').get();
  const byISO = {};
  snap.docs.forEach(d => {
    const f = { id: d.id, ...d.data() };
    if (Array.isArray(f.screenings) && f.screenings.length) {
      f.screenings.forEach(sc => {
        if (!sc.dateISO) return;
        (byISO[sc.dateISO] ||= []).push({ text: `${f.title}${sc.time ? ' ' + sc.time : ''}${sc.locationName ? ' · ' + sc.locationName : ''}`, id: f.id });
      });
    } else if (f.viewingDate?.toDate) {
      const d = f.viewingDate.toDate();
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      (byISO[iso] ||= []).push({ text: f.title, id: f.id });
    }
  });
  const now = new Date();
  const ref = new Date(now.getFullYear(), now.getMonth() + calOffset, 1);
  titleEl.textContent = monthLabel(ref.getFullYear(), ref.getMonth());
  gridEl.innerHTML = buildCalendarGridHTML(ref.getFullYear(), ref.getMonth(), byISO);
  gridEl.querySelectorAll('.cal-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      const doc = await db.collection('films').doc(btn.dataset.filmId).get();
      if (doc.exists) openPassport({ id: doc.id, ...doc.data() });
    });
  });
}

/* =================== Firebase =================== */
function initFirebaseOnce() {
  if (firebase.apps?.length > 0) { app = firebase.app(); auth = firebase.auth(); db = firebase.firestore(); return; }
  const cfg = window.__FLEETFILM__CONFIG || window.firebaseConfig || window.FIREBASE_CONFIG;
  if (!cfg?.apiKey) throw new Error('Missing Firebase config');
  app = firebase.initializeApp(cfg);
  auth = firebase.auth();
  db = firebase.firestore();
  auth.useDeviceLanguage?.();
}

/* =================== Router =================== */
const VIEWS = ['films','green','nextprog','discarded','archive','calendar','addresses'];

function setView(name) {
  document.querySelectorAll('.nav .btn-pill, .mobile-tabbar button[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === name));
  VIEWS.forEach(v => document.getElementById(`view-${v}`)?.classList.toggle('hidden', v !== name));
  if (name === 'films')     return loadFilms();
  if (name === 'green')     return loadGreen();
  if (name === 'nextprog')  return loadNextProg();
  if (name === 'discarded') return loadDiscarded();
  if (name === 'archive')   return loadArchive();
  if (name === 'calendar')  return loadCalendar();
  if (name === 'addresses') return loadAddresses();
}

function routerFromHash() {
  const h = location.hash.replace('#', '');
  setView(VIEWS.includes(h) ? h : 'films'); // default to films
}

function showSignedIn(on) {
  document.getElementById('signed-in').classList.toggle('hidden', !on);
  document.getElementById('signed-out').classList.toggle('hidden', on);
  document.getElementById('nav').classList.toggle('hidden', !on);
  document.getElementById('mobile-tabbar')?.classList.toggle('hidden', !on);
}

async function ensureUserDoc(u) {
  const ref = db.collection('users').doc(u.uid);
  const base = { email: u.email||'', displayName: u.displayName||u.email||'User', lastLoginAt: firebase.firestore.FieldValue.serverTimestamp() };
  const snap = await ref.get();
  if (!snap.exists) await ref.set({ ...base, role: 'member', createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  else await ref.set(base, { merge: true });
  const rs = await ref.get();
  state.role = rs.data()?.role || 'member';
  document.getElementById('nav-addresses')?.classList.toggle('hidden', state.role !== 'admin');
  document.getElementById('btn-bulk-refetch')?.classList.toggle('hidden', state.role !== 'admin');
}

/* =================== Handlers =================== */
function attachHandlers() {
  document.querySelectorAll('.nav .btn-pill').forEach(btn => btn.addEventListener('click', () => { location.hash = btn.dataset.view; }));
  document.getElementById('btn-signout')?.addEventListener('click', () => auth.signOut());

  // Add Film button
  document.getElementById('btn-add-film')?.addEventListener('click', () => addFilmFlow());

  // Bulk re-fetch (admin)
  document.getElementById('btn-bulk-refetch')?.addEventListener('click', () => bulkRefetch());

  // Google auth
  document.getElementById('btn-google')?.addEventListener('click', async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    try { await auth.signInWithPopup(provider); } catch { await auth.signInWithRedirect(provider); }
  });
  auth.getRedirectResult().catch(e => console.warn('Redirect:', e?.message));

  document.getElementById('btn-email-signin')?.addEventListener('click', async () => {
    try { await auth.signInWithEmailAndPassword(document.getElementById('email').value, document.getElementById('password').value); }
    catch (e) { alert(e.message); }
  });
  document.getElementById('btn-email-create')?.addEventListener('click', async () => {
    try { await auth.createUserWithEmailAndPassword(document.getElementById('email').value, document.getElementById('password').value); }
    catch (e) { alert(e.message); }
  });

  document.addEventListener('click', e => { const btn = e.target.closest('[data-export]'); if (btn) exportCsv(btn.dataset.export); });
  window.addEventListener('hashchange', routerFromHash);

  document.getElementById('mobile-tabbar')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-view]');
    if (btn) location.hash = btn.dataset.view;
  });

  document.getElementById('tab-more')?.addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" style="max-width:340px;"><div class="modal-head"><h2>More</h2><button class="btn btn-ghost" id="more-close">✕</button></div><div class="modal-list" id="more-list"></div></div>`;
    document.body.appendChild(overlay);
    PAGE_DEFS.forEach(([view, label]) => {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = label;
      b.onclick = () => { location.hash = view; document.body.removeChild(overlay); };
      overlay.querySelector('#more-list').appendChild(b);
    });
    overlay.querySelector('#more-close').onclick = () => document.body.removeChild(overlay);
  });

  setupFilters();
}

/* =================== Add Film Flow =================== */
async function addFilmFlow() {
  const result = await showAddFilmModal();
  if (!result) return;

  if (result.mode === 'manual') {
    await saveFilmDoc({ title: result.title, year: result.year, tmdbFields: null });
    return;
  }

  // Show picker with search results
  const choice = await showTmdbPicker(result.results, result.title);
  if (choice.mode === 'cancel') return;
  if (choice.mode === 'manual') {
    await saveFilmDoc({ title: result.title, year: result.year, tmdbFields: null });
    return;
  }
  if (choice.mode === 'pick') {
    try {
      const res = await tmdbDetailsById(choice.tmdbId);
      const fields = tmdbToFields(res.detail, res.credits);
      await saveFilmDoc({ title: fields.title || result.title, year: null, tmdbFields: fields });
    } catch (e) {
      alert('Failed to load film details. Try again.');
    }
  }
}

async function saveFilmDoc({ title, year, tmdbFields }) {
  const base = {
    title: title || '',
    year: year || null,
    synopsis: '', status: 'pending',
    createdBy: state.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    runtimeMinutes: null, language: '', ageRating: '', ukAgeRating: '',
    genre: '', country: '', director: '', originalTitle: '',
    distributor: '', whereToSee: '',
    posterUrl: '', tmdbId: '', imdbID: '',
    screenings: [], greenAt: null, discardedReason: '', notes: '',
  };
  if (tmdbFields) Object.assign(base, tmdbFields);
  const ref = await db.collection('films').add(base);
  await logAudit(ref.id, 'create', { via: tmdbFields ? 'tmdb' : 'manual' });

  // Show a brief toast then refresh
  showToast(`"${base.title}" added!`);
  loadFilms();
}

/* =================== Re-fetch TMDB (per film) =================== */
async function refetchTmdb(filmId, currentTitle, currentYear) {
  try {
    let results = await tmdbSearch(currentTitle, currentYear);
    if (!results.length && currentYear) results = await tmdbSearch(currentTitle, null);

    const choice = await showTmdbPicker(results, currentTitle);
    if (choice.mode === 'cancel') return false;

    let tmdbFields = null;
    if (choice.mode === 'pick') {
      const res = await tmdbDetailsById(choice.tmdbId);
      tmdbFields = tmdbToFields(res.detail, res.credits);
    }
    if (!tmdbFields) return false;

    await db.collection('films').doc(filmId).update(tmdbFields);
    await logAudit(filmId, 'tmdb_refetch', { tmdbId: tmdbFields.tmdbId });
    return true;
  } catch (e) {
    alert('TMDB re-fetch failed: ' + (e.message || 'unknown error'));
    return false;
  }
}

/* =================== Bulk Re-fetch (admin) =================== */
async function bulkRefetch() {
  const snap = await db.collection('films').get();
  const missing = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(f => !f.posterUrl || !f.tmdbId)
    .filter(f => f.status !== 'discarded');

  if (!missing.length) { alert('All films already have poster/TMDB data.'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:560px;">
      <div class="modal-head">
        <h2>Bulk Re-fetch from TMDB</h2>
        <button class="btn btn-ghost" id="bulk-close">✕</button>
      </div>
      <div class="notice">${missing.length} film${missing.length !== 1 ? 's' : ''} without poster / TMDB data. Click each film to search and confirm the correct match.</div>
      <div id="bulk-list" style="margin-top:12px;display:grid;gap:8px;max-height:55vh;overflow-y:auto;padding-right:4px;"></div>
      <div id="bulk-progress" class="notice hidden" style="margin-top:10px;"></div>
    </div>`;
  document.body.appendChild(overlay);

  const listEl = overlay.querySelector('#bulk-list');
  const progress = overlay.querySelector('#bulk-progress');

  missing.forEach(f => {
    const row = document.createElement('div');
    row.className = 'film-row-card';
    row.style.cssText = 'grid-template-columns:auto 1fr auto;';
    row.dataset.filmId = f.id;
    row.innerHTML = `
      <div class="poster-placeholder">🎬</div>
      <div class="film-row-info">
        <div class="film-row-title">${escapeHtml(f.title)} <span class="film-row-year">${f.year ? `(${f.year})` : ''}</span></div>
        <div class="film-row-meta"><span>${humanStatus(f.status)}</span></div>
      </div>
      <div class="film-row-actions">
        <button class="btn btn-primary btn-sm" data-refetch="${f.id}" data-title="${escapeHtml(f.title)}" data-year="${f.year||''}">Search TMDB</button>
        <span class="bulk-done hidden badge badge-green" style="font-size:11px;">✓ Done</span>
      </div>`;
    listEl.appendChild(row);
  });

  overlay.querySelector('#bulk-close').onclick = () => { document.body.removeChild(overlay); loadFilms(); };

  listEl.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-refetch]');
    if (!btn) return;
    const filmId = btn.dataset.refetch;
    const title  = btn.dataset.title;
    const year   = parseInt(btn.dataset.year || '0', 10) || null;
    btn.disabled = true;
    btn.textContent = 'Searching…';

    const ok = await refetchTmdb(filmId, title, year);

    if (ok) {
      btn.classList.add('hidden');
      const done = btn.closest('.film-row-actions').querySelector('.bulk-done');
      if (done) done.classList.remove('hidden');
      const remaining = listEl.querySelectorAll('button[data-refetch]:not(.hidden)').length;
      progress.textContent = `${missing.length - remaining} of ${missing.length} updated.`;
      progress.classList.remove('hidden');
    } else {
      btn.disabled = false;
      btn.textContent = 'Search TMDB';
    }
  });
}

/* =================== Filters =================== */
const filterState = { q: '', status: '', sort: 'created-desc' };
function setupFilters() {
  const q    = document.getElementById('filter-q');
  const s    = document.getElementById('filter-status');
  const sort = document.getElementById('filter-sort');
  const clr  = document.getElementById('filter-clear');
  q?.addEventListener('input', () => { filterState.q = q.value.trim().toLowerCase(); loadFilms(); });
  s?.addEventListener('change', () => { filterState.status = s.value; loadFilms(); });
  sort?.addEventListener('change', () => { filterState.sort = sort.value; loadFilms(); });
  clr?.addEventListener('click', () => {
    filterState.q = ''; filterState.status = ''; filterState.sort = 'created-desc';
    if (q) q.value = ''; if (s) s.value = ''; if (sort) sort.value = 'created-desc';
    loadFilms();
  });
}

/* =================== Utils =================== */
function escapeHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--gold);color:#0a0a0f;padding:10px 22px;border-radius:999px;font-weight:700;font-size:14px;z-index:999;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.style.opacity = '0', 1800);
  setTimeout(() => document.body.removeChild(t), 2200);
}

function statusBadgeClass(s) {
  return { greenlist:'badge-green', next_programme:'badge-blue', discarded:'badge-red', archived:'badge-muted' }[s] || 'badge-neutral';
}

/* =================== Film List =================== */
async function loadFilms() {
  const list = document.getElementById('films-list');
  if (!list) return;
  list.innerHTML = '<div class="notice">Loading…</div>';
  const snap = await db.collection('films').get();
  let films = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (filterState.status) films = films.filter(f => f.status === filterState.status);
  if (filterState.q) {
    const q = filterState.q;
    films = films.filter(f =>
      (f.title||'').toLowerCase().includes(q) ||
      (f.originalTitle||'').toLowerCase().includes(q) ||
      (f.synopsis||'').toLowerCase().includes(q) ||
      (f.genre||'').toLowerCase().includes(q) ||
      (f.language||'').toLowerCase().includes(q) ||
      (f.country||'').toLowerCase().includes(q) ||
      (f.director||'').toLowerCase().includes(q) ||
      (f.distributor||'').toLowerCase().includes(q) ||
      String(f.year||'').includes(q)
    );
  }

  films.sort((a, b) => {
    const m = filterState.sort;
    const tA = a.title||'', tB = b.title||'';
    const yA = +a.year||0, yB = +b.year||0;
    const cA = a.createdAt?.toMillis?.() || 0, cB = b.createdAt?.toMillis?.() || 0;
    if (m==='title-asc')   return tA.localeCompare(tB);
    if (m==='title-desc')  return tB.localeCompare(tA);
    if (m==='year-desc')   return yB - yA;
    if (m==='year-asc')    return yA - yB;
    if (m==='created-asc') return cA - cB;
    return cB - cA;
  });

  list.innerHTML = '';
  if (!films.length) { list.innerHTML = '<div class="notice">No films match the current filters.</div>'; return; }
  films.forEach(f => list.insertAdjacentHTML('beforeend', filmRowCard(f)));
  attachPassportButtons(list);
}

function filmRowCard(f) {
  const year = f.year ? `(${f.year})` : '';
  const poster = f.posterUrl
    ? `<img alt="Poster" src="${escapeHtml(f.posterUrl)}" style="width:66px;height:99px;object-fit:cover;border-radius:8px;border:1px solid var(--border);" loading="lazy">`
    : '<div class="poster-placeholder">🎬</div>';
  const origTitle = f.originalTitle && f.originalTitle !== f.title
    ? `<div style="font-size:12px;color:var(--ink-3);font-style:italic;margin-top:1px;">${escapeHtml(f.originalTitle)}</div>` : '';
  const meta = [f.genre, f.language, f.runtimeMinutes ? `${f.runtimeMinutes} min` : null, f.director].filter(Boolean);
  return `
    <div class="film-row-card">
      <div class="film-row-poster">${poster}</div>
      <div class="film-row-info">
        <div class="film-row-title">${escapeHtml(f.title)} <span class="film-row-year">${year}</span></div>
        ${origTitle}
        <div class="film-row-meta">${meta.map(m => `<span>${escapeHtml(m)}</span>`).join('')}</div>
        ${f.synopsis ? `<div class="film-row-synopsis">${escapeHtml(f.synopsis.slice(0,160))}${f.synopsis.length>160?'…':''}</div>` : ''}
      </div>
      <div class="film-row-actions">
        <span class="badge ${statusBadgeClass(f.status)}">${humanStatus(f.status)}</span>
        <button class="btn btn-primary" data-open-passport="${f.id}">Open Passport</button>
      </div>
    </div>`;
}

function simpleFilmCard(f, extraHtml = '') {
  const year = f.year ? `(${f.year})` : '';
  const poster = f.posterUrl
    ? `<img alt="Poster" src="${escapeHtml(f.posterUrl)}" style="width:66px;height:99px;object-fit:cover;border-radius:8px;border:1px solid var(--border);" loading="lazy">`
    : '<div class="poster-placeholder">🎬</div>';
  const meta = [f.genre, f.language, f.runtimeMinutes ? `${f.runtimeMinutes} min` : null].filter(Boolean);
  return `
    <div class="film-row-card" data-film-card="${f.id}">
      <div class="film-row-poster">${poster}</div>
      <div class="film-row-info">
        <div class="film-row-title">${escapeHtml(f.title)} <span class="film-row-year">${year}</span></div>
        <div class="film-row-meta">${meta.map(m => `<span>${escapeHtml(m)}</span>`).join('')}</div>
        ${extraHtml}
      </div>
      <div class="film-row-actions">
        <button class="btn btn-primary" data-open-passport="${f.id}">Open Passport</button>
      </div>
    </div>`;
}

function attachPassportButtons(container) {
  container.querySelectorAll('button[data-open-passport]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const doc = await db.collection('films').doc(btn.dataset.openPassport).get();
      if (doc.exists) openPassport({ id: doc.id, ...doc.data() });
    });
  });
}

/* =================== Fetch by status =================== */
async function fetchByStatus(status) {
  const snap = await db.collection('films').where('status', '==', status).get();
  return snap.docs.slice().sort((a, b) => String(a.data().title||'').localeCompare(String(b.data().title||'')));
}

/* =================== PASSPORT =================== */
async function openPassport(f) {
  const snap = await db.collection('films').doc(f.id).get();
  if (!snap.exists) { alert('Film not found'); return; }
  f = { id: snap.id, ...snap.data() };

  const wts = f.whereToSee || '';
  const wtsOther = wts.split(',').map(s=>s.trim()).filter(s=>!['Stream','Disk','Screen'].includes(s)).join(', ');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay passport-overlay';
  overlay.innerHTML = `
    <div class="passport-modal" role="dialog">
      <div class="passport-header">
        <div>
          <span class="passport-label">✦ FILM PASSPORT</span>
          <h2 class="passport-film-title">${escapeHtml(f.title)}${f.year ? `<span class="passport-year">(${f.year})</span>` : ''}</h2>
          ${f.originalTitle && f.originalTitle !== f.title ? `<div style="font-size:13px;color:var(--ink-3);font-style:italic;margin-top:2px;">${escapeHtml(f.originalTitle)}</div>` : ''}
        </div>
        <div class="passport-header-actions">
          <span class="badge ${statusBadgeClass(f.status)}">${humanStatus(f.status)}</span>
          <button class="btn btn-ghost" id="passport-close">✕ Close</button>
        </div>
      </div>

      <div class="passport-body">
        <div class="passport-left">
          ${f.posterUrl
            ? `<img src="${escapeHtml(f.posterUrl)}" alt="Poster" class="passport-poster" loading="lazy">`
            : '<div class="passport-poster-placeholder">🎬</div>'}

          <div class="passport-status-block">
            <span class="passport-section-label">Pipeline Status</span>
            <select id="pp-status" class="passport-status-select">
              <option value="pending"        ${f.status==='pending'?'selected':''}>Pending</option>
              <option value="greenlist"      ${f.status==='greenlist'?'selected':''}>Green List</option>
              <option value="next_programme" ${f.status==='next_programme'?'selected':''}>Next Programme</option>
              <option value="discarded"      ${f.status==='discarded'?'selected':''}>Discarded</option>
              <option value="archived"       ${f.status==='archived'?'selected':''}>Archived</option>
            </select>
            <div id="pp-discard-wrap" class="${f.status==='discarded'?'':'hidden'}" style="margin-top:8px">
              <label style="text-transform:none;letter-spacing:0;font-size:12px;">Reason for discarding</label>
              <textarea id="pp-discard-reason" rows="2" placeholder="Why was this discarded?">${escapeHtml(f.discardedReason||'')}</textarea>
            </div>
            <div id="pp-green-wrap" style="margin-top:6px" class="${['greenlist','next_programme','archived'].includes(f.status)?'':'hidden'}">
              ${f.greenAt?.toDate ? `<span class="badge badge-green" style="font-size:11px;">🌿 Green since ${f.greenAt.toDate().toISOString().slice(0,10)}</span>` : ''}
            </div>
            <button class="btn btn-primary" id="pp-save-status" style="width:100%;margin-top:10px;">Save Status</button>
          </div>

          ${isAdmin() ? `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
            <button class="btn btn-danger" id="pp-delete" style="width:100%;font-size:12px;">🗑 Permanent Delete</button>
          </div>` : ''}
        </div>

        <div class="passport-right">
          <div class="passport-tabs">
            <button class="passport-tab active" data-tab="details">Details</button>
            <button class="passport-tab" data-tab="votes">Votes</button>
            <button class="passport-tab" data-tab="screenings">Screenings</button>
            <button class="passport-tab" data-tab="history">History</button>
          </div>

          <div class="passport-tab-panel" id="pp-tab-details">
            <div class="form-grid">
              <label>Title<input id="pp-title" type="text" value="${escapeHtml(f.title||'')}"></label>
              <label>Original Title<input id="pp-orig-title" type="text" value="${escapeHtml(f.originalTitle||'')}" placeholder="If different from title"></label>
              <label>Year<input id="pp-year" type="number" value="${f.year||''}"></label>
              <label>Runtime (minutes)<input id="pp-runtime" type="number" value="${f.runtimeMinutes||''}"></label>
              <label>UK Age Rating<input id="pp-rating" type="text" value="${escapeHtml(f.ukAgeRating||'')}" placeholder="U, PG, 12A, 15, 18…"></label>
              <label>Director<input id="pp-director" type="text" value="${escapeHtml(f.director||'')}"></label>
              <label>Language(s)<input id="pp-language" type="text" value="${escapeHtml(f.language||'')}"></label>
              <label>Country(ies)<input id="pp-country" type="text" value="${escapeHtml(f.country||'')}"></label>
              <label>Genre<input id="pp-genre" type="text" value="${escapeHtml(f.genre||'')}"></label>
              <label>Distributor<input id="pp-distributor" type="text" value="${escapeHtml(f.distributor||'')}"></label>
              <label class="span-2">Where / When to See
                <div class="where-to-see-row">
                  <label class="where-option"><input type="checkbox" id="pp-wts-stream" ${wts.includes('Stream')?'checked':''}> Stream</label>
                  <label class="where-option"><input type="checkbox" id="pp-wts-disk" ${wts.includes('Disk')?'checked':''}> Disk</label>
                  <label class="where-option"><input type="checkbox" id="pp-wts-screen" ${wts.includes('Screen')?'checked':''}> Screen</label>
                  <input id="pp-wts-other" type="text" placeholder="Other details…" value="${escapeHtml(wtsOther)}" style="flex:1;min-width:100px;">
                </div>
              </label>
              <label class="span-2">Synopsis<textarea id="pp-synopsis" rows="4">${escapeHtml(f.synopsis||'')}</textarea></label>
              <label class="span-2">Notes<textarea id="pp-notes" rows="2" placeholder="Additional notes…">${escapeHtml(f.notes||'')}</textarea></label>
            </div>
            <div class="actions" style="margin-top:14px;flex-wrap:wrap;">
              <button class="btn btn-primary" id="pp-save-details">Save Details</button>
              <button class="btn btn-ghost" id="pp-refetch">🔍 Re-fetch from TMDB</button>
              <span id="pp-details-msg" class="notice hidden" style="margin:0;padding:6px 12px;"></span>
            </div>
          </div>

          <div class="passport-tab-panel hidden" id="pp-tab-votes"><div class="notice">Loading votes…</div></div>
          <div class="passport-tab-panel hidden" id="pp-tab-screenings"><div class="notice">Loading screenings…</div></div>
          <div class="passport-tab-panel hidden" id="pp-tab-history"><div class="notice">Loading history…</div></div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const $ = sel => overlay.querySelector(sel);

  $('#passport-close').onclick = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });

  overlay.querySelectorAll('.passport-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      overlay.querySelectorAll('.passport-tab').forEach(t => t.classList.remove('active'));
      overlay.querySelectorAll('.passport-tab-panel').forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      overlay.querySelector(`#pp-tab-${tab.dataset.tab}`)?.classList.remove('hidden');
      if (tab.dataset.tab === 'votes')      loadPassportVotes(f.id, overlay);
      if (tab.dataset.tab === 'screenings') loadPassportScreenings(f.id, overlay);
      if (tab.dataset.tab === 'history')    loadPassportHistory(f.id, overlay);
    });
  });

  $('#pp-status').addEventListener('change', () => {
    const v = $('#pp-status').value;
    $('#pp-discard-wrap').classList.toggle('hidden', v !== 'discarded');
    $('#pp-green-wrap').classList.toggle('hidden', !['greenlist','next_programme','archived'].includes(v));
  });

  $('#pp-save-status').onclick = async () => {
    const newStatus = $('#pp-status').value;
    const updates = { status: newStatus };
    if (newStatus === 'discarded') {
      const reason = ($('#pp-discard-reason')?.value||'').trim();
      if (!reason) { alert('Please enter a reason for discarding this film.'); return; }
      updates.discardedReason = reason;
    }
    if (newStatus === 'greenlist' && f.status !== 'greenlist') updates.greenAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('films').doc(f.id).update(updates);
    await logAudit(f.id, 'status_change', { from: f.status, to: newStatus });
    document.body.removeChild(overlay);
    routerFromHash();
  };

  $('#pp-save-details').onclick = async () => {
    const wtsParts = [];
    if ($('#pp-wts-stream')?.checked) wtsParts.push('Stream');
    if ($('#pp-wts-disk')?.checked)   wtsParts.push('Disk');
    if ($('#pp-wts-screen')?.checked) wtsParts.push('Screen');
    const wtsOtherVal = ($('#pp-wts-other')?.value||'').trim();
    if (wtsOtherVal) wtsParts.push(wtsOtherVal);
    const payload = {
      title:($('#pp-title')?.value||'').trim()||f.title,
      originalTitle:($('#pp-orig-title')?.value||'').trim(),
      year:parseInt($('#pp-year')?.value||'0',10)||null,
      runtimeMinutes:parseInt($('#pp-runtime')?.value||'0',10)||null,
      ukAgeRating:($('#pp-rating')?.value||'').trim(),
      director:($('#pp-director')?.value||'').trim(),
      language:($('#pp-language')?.value||'').trim(),
      country:($('#pp-country')?.value||'').trim(),
      genre:($('#pp-genre')?.value||'').trim(),
      distributor:($('#pp-distributor')?.value||'').trim(),
      whereToSee:wtsParts.join(', '),
      synopsis:($('#pp-synopsis')?.value||'').trim(),
      notes:($('#pp-notes')?.value||'').trim(),
    };
    try {
      await db.collection('films').doc(f.id).update(payload);
      await logAudit(f.id, 'edit_details', {});
      const msg = $('#pp-details-msg');
      if (msg) { msg.textContent='Saved ✓'; msg.classList.remove('hidden'); setTimeout(()=>msg.classList.add('hidden'),2000); }
    } catch (e) { alert(e.message||'Failed to save'); }
  };

  // Re-fetch from TMDB
  $('#pp-refetch').onclick = async () => {
    const btn = $('#pp-refetch');
    btn.textContent = 'Searching…'; btn.disabled = true;
    const ok = await refetchTmdb(f.id, f.title, f.year);
    btn.textContent = '🔍 Re-fetch from TMDB'; btn.disabled = false;
    if (ok) {
      // Reload passport with fresh data
      document.body.removeChild(overlay);
      const fresh = await db.collection('films').doc(f.id).get();
      if (fresh.exists) openPassport({ id: fresh.id, ...fresh.data() });
      routerFromHash();
    }
  };

  if (isAdmin()) {
    $('#pp-delete').onclick = async () => {
      if (!confirm('Permanently delete this film and all votes? This cannot be undone.')) return;
      await deleteFilmCompletely(f.id);
      document.body.removeChild(overlay);
      routerFromHash();
    };
  }
}

/* =================== Passport: Votes =================== */
async function loadPassportVotes(filmId, overlay) {
  const container = overlay.querySelector('#pp-tab-votes');
  container.innerHTML = '<div class="notice">Loading…</div>';
  const myUid = state.user?.uid;
  const usersSnap = await db.collection('users').get();
  const users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const nameOf = uid => { const u = users.find(u => u.uid === uid); return u ? (u.displayName||u.email||uid) : uid; };
  const vsSnap = await db.collection('films').doc(filmId).collection('votes').get();
  let yes=0, no=0, und=0;
  const voters = [];
  vsSnap.forEach(v => {
    const d = v.data()||{};
    if (d.value===1) yes++; else if (d.value===-1) no++; else und++;
    voters.push({ uid: v.id, value: d.value, comment: d.comment||'' });
  });
  let myVoteVal=null, myComment='';
  if (myUid) {
    const mv = await db.collection('films').doc(filmId).collection('votes').doc(myUid).get();
    if (mv.exists) { myVoteVal = mv.data().value??null; myComment = mv.data().comment||''; }
  }
  const votedSet = new Set(voters.map(v => v.uid));
  const notVoted = users.filter(u => u.uid && !votedSet.has(u.uid));
  const voterRows = voters.length
    ? voters.map(v => {
        const label = v.value===1?'👍 Yes':v.value===-1?'👎 No':'🤷 Undecided';
        const bc = v.value===1?'badge-green':v.value===-1?'badge-red':'badge-neutral';
        return `<div class="vote-entry"><div class="vote-entry-header"><span class="vote-entry-name">${escapeHtml(nameOf(v.uid))}</span><span class="badge ${bc}">${label}</span></div>${v.comment?`<div class="vote-comment-text">${escapeHtml(v.comment)}</div>`:''}</div>`;
      }).join('')
    : '<div class="notice">No votes yet.</div>';
  const notVotedHtml = notVoted.length
    ? notVoted.map(u=>`<span class="badge badge-muted">${escapeHtml(u.displayName||u.email||u.uid)}</span>`).join(' ')
    : '<span style="font-size:13px;color:var(--ink-3)">Everyone has voted.</span>';

  container.innerHTML = `
    <div class="vote-summary-bar">
      <span class="badge badge-green">👍 Yes: ${yes}</span>
      <span class="badge badge-neutral">🤷 Undecided: ${und}</span>
      <span class="badge badge-red">👎 No: ${no}</span>
    </div>
    <div class="subhead">Your Vote</div>
    <div class="vote-buttons">
      <button class="btn vote-btn ${myVoteVal===1?'vote-active-yes':''}" data-v="1">👍 Yes</button>
      <button class="btn vote-btn ${myVoteVal===0?'vote-active-und':''}" data-v="0">🤷 Undecided</button>
      <button class="btn vote-btn ${myVoteVal===-1?'vote-active-no':''}" data-v="-1">👎 No</button>
    </div>
    <label style="margin-top:12px;display:block;text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink-2);">Comment — editable anytime
      <textarea id="pp-vote-comment" rows="2" placeholder="Your thoughts…">${escapeHtml(myComment)}</textarea>
    </label>
    <button class="btn btn-primary" id="pp-cast-vote" style="margin-top:8px;">Save My Vote</button>
    <div id="pp-vote-msg" class="notice hidden" style="margin-top:6px;"></div>
    <div class="subhead" style="margin-top:20px;">All Votes</div>
    <div class="vote-entries">${voterRows}</div>
    <div class="subhead" style="margin-top:14px;">Not Voted Yet</div>
    <div class="not-voted-list">${notVotedHtml}</div>`;

  let selectedVote = myVoteVal;
  container.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.vote-btn').forEach(b => b.classList.remove('vote-active-yes','vote-active-und','vote-active-no'));
      selectedVote = parseInt(btn.dataset.v, 10);
      btn.classList.add(selectedVote===1?'vote-active-yes':selectedVote===0?'vote-active-und':'vote-active-no');
    });
  });
  container.querySelector('#pp-cast-vote').onclick = async () => {
    const val = selectedVote !== null ? selectedVote : myVoteVal;
    if (val === null) { alert('Select a vote first.'); return; }
    const comment = (container.querySelector('#pp-vote-comment')?.value||'').trim();
    try {
      await db.collection('films').doc(filmId).collection('votes').doc(myUid).set({ value:val, comment, voterName:currentActor().name, updatedAt:firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
      await logAudit(filmId, 'vote', { value:val });
      const msg = container.querySelector('#pp-vote-msg');
      if (msg) { msg.textContent='Vote saved ✓'; msg.classList.remove('hidden'); setTimeout(()=>msg.classList.add('hidden'),2000); }
      await loadPassportVotes(filmId, overlay);
    } catch (e) { alert(e.message||'Failed to save vote'); }
  };
}

/* =================== Passport: Screenings =================== */
async function loadPassportScreenings(filmId, overlay) {
  const container = overlay.querySelector('#pp-tab-screenings');
  container.innerHTML = '<div class="notice">Loading…</div>';
  const filmSnap = await db.collection('films').doc(filmId).get();
  const f = { id: filmSnap.id, ...filmSnap.data() };
  const screenings = Array.isArray(f.screenings) ? f.screenings : [];
  const locSnap = await db.collection('locations').orderBy('name').get();
  const locs = locSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const locOpts = `<option value="">Select location…</option>` +
    locs.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('') +
    `<option value="__add">+ Add new location…</option>`;
  const fmtSc = sc => [sc.dateISO, sc.time, sc.locationName].filter(Boolean).join(' · ') || '—';
  const rows = screenings.length
    ? screenings.map((sc,i) => `<div class="screening-row"><div class="screening-text">${escapeHtml(fmtSc(sc))}</div><button class="btn btn-ghost btn-sm" data-rm="${i}">Remove</button></div>`).join('')
    : '<div class="notice">No screenings recorded yet.</div>';

  container.innerHTML = `
    <div class="subhead">Existing Screenings</div>
    <div class="screening-list">${rows}</div>
    <div class="subhead" style="margin-top:18px;">Add Screening</div>
    <div class="form-grid" style="margin-top:6px">
      <label>Location<select id="pp-sc-loc">${locOpts}</select></label>
      <label>Date<input type="date" id="pp-sc-date"></label>
      <label>Time (optional)<input type="time" id="pp-sc-time"></label>
      <div class="actions" style="align-self:end"><button class="btn btn-primary" id="pp-add-sc">+ Add</button></div>
    </div>`;

  container.querySelectorAll('button[data-rm]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cur = Array.isArray(f.screenings) ? f.screenings.slice() : [];
      cur.splice(parseInt(btn.dataset.rm,10),1);
      await db.collection('films').doc(filmId).update({ screenings: cur });
      await refreshCalendarOnly();
      await loadPassportScreenings(filmId, overlay);
    });
  });

  container.querySelector('#pp-sc-loc')?.addEventListener('change', async e => {
    if (e.target.value === '__add') {
      const nl = await showAddLocationModal();
      if (nl) await loadPassportScreenings(filmId, overlay); else e.target.value = '';
    }
  });

  container.querySelector('#pp-add-sc').onclick = async () => {
    const locId = container.querySelector('#pp-sc-loc')?.value||'';
    const dateISO = container.querySelector('#pp-sc-date')?.value||'';
    const time = container.querySelector('#pp-sc-time')?.value||'';
    if (!dateISO) { alert('Please add a date.'); return; }
    let locationName='', locationAddress='';
    if (locId && locId!=='__add') {
      const ld = await db.collection('locations').doc(locId).get();
      if (ld.exists) { locationName=ld.data().name||''; locationAddress=ld.data().address||''; }
    }
    const sc = { dateISO, time, locationId:locId!=='__add'?locId:'', locationName, locationAddress };
    const cur = Array.isArray(f.screenings)?f.screenings.slice():[];
    cur.push(sc);
    const ts = firebase.firestore.Timestamp.fromDate(new Date(dateISO+'T00:00:00'));
    await db.collection('films').doc(filmId).update({ screenings:cur, viewingDate:ts, viewingTime:time, viewingLocationId:sc.locationId, viewingLocationName:sc.locationName });
    await refreshCalendarOnly();
    await loadPassportScreenings(filmId, overlay);
  };
}

/* =================== Passport: History =================== */
async function loadPassportHistory(filmId, overlay) {
  const container = overlay.querySelector('#pp-tab-history');
  container.innerHTML = '<div class="notice">Loading…</div>';
  let snap;
  try { snap = await db.collection('films').doc(filmId).collection('audit').orderBy('at','desc').limit(100).get(); }
  catch { snap = await db.collection('films').doc(filmId).collection('audit').get(); }
  if (!snap.docs.length) { container.innerHTML = '<div class="notice">No history yet.</div>'; return; }
  container.innerHTML = '<div class="modal-scroll">' + snap.docs.map(d => {
    const a = d.data()||{};
    const at = a.at?.toDate?.()?.toLocaleString('en-GB')||'';
    const who = a.byName||a.byEmail||'';
    return `<div class="audit-row"><div><span class="badge">${escapeHtml(at)}</span> <span class="badge badge-gold">${escapeHtml(a.action||'')}</span></div><div class="audit-meta">${escapeHtml(who)}</div></div>`;
  }).join('') + '</div>';
}

/* =================== Status views =================== */
async function loadGreen() {
  const list = document.getElementById('green-list');
  list.innerHTML = '<div class="notice">Loading…</div>';
  const docs = await fetchByStatus('greenlist');
  list.innerHTML = '';
  if (!docs.length) { list.innerHTML = '<div class="notice">Green List is empty.</div>'; return; }
  docs.forEach(doc => {
    const f = { id:doc.id, ...doc.data() };
    const greenAt = f.greenAt?.toDate?.()?.toISOString?.().slice(0,10)||'—';
    list.insertAdjacentHTML('beforeend', simpleFilmCard(f, `<span class="badge badge-green" style="margin-top:6px;">🌿 Green since: ${greenAt}</span>`));
  });
  attachPassportButtons(list);
}

async function loadNextProg() {
  const controls = document.getElementById('nextprog-controls');
  const list = document.getElementById('nextprog-list');
  list.innerHTML = '<div class="notice">Loading…</div>';
  const docs = await fetchByStatus('next_programme');
  controls.innerHTML = `
    <div class="form-grid" style="margin-bottom:14px;">
      <label>Programme date<input type="date" id="programme-date"></label>
      <div class="actions" style="align-self:end;flex-wrap:wrap;">
        <button class="btn btn-primary" id="btn-archive-9">Archive first 9</button>
        <button class="btn btn-danger" id="btn-archive-selected">Archive selected</button>
        <button class="btn btn-ghost" id="btn-select-first9">Select first 9</button>
        <button class="btn btn-ghost" id="btn-clear-select">Clear</button>
      </div>
    </div>`;
  const getDate = () => document.getElementById('programme-date')?.value||'';
  const archiveFilms = async (ids, dateISO) => {
    if (!ids.length) { alert('Select some films first.'); return; }
    if (!dateISO) { alert('Add a programme date first.'); return; }
    const progRef = await db.collection('programmes').add({ dateISO, filmIds:ids, createdAt:firebase.firestore.FieldValue.serverTimestamp(), createdBy:state.user?.uid });
    const batch = db.batch();
    ids.forEach(id => batch.update(db.collection('films').doc(id), { status:'archived', archivedFrom:'next_programme', programmeId:progRef.id, programmeDate:dateISO, archivedAt:firebase.firestore.FieldValue.serverTimestamp() }));
    await batch.commit();
    loadNextProg();
  };
  document.getElementById('btn-archive-9')?.addEventListener('click', () => archiveFilms(docs.slice(0,9).map(d=>d.id), getDate()));
  document.getElementById('btn-archive-selected')?.addEventListener('click', () => {
    const ids = Array.from(list.querySelectorAll('input[data-select-film]:checked')).map(cb=>cb.dataset.selectFilm);
    archiveFilms(ids, getDate());
  });
  document.getElementById('btn-select-first9')?.addEventListener('click', () => Array.from(list.querySelectorAll('input[data-select-film]')).forEach((cb,i)=>cb.checked=i<9));
  document.getElementById('btn-clear-select')?.addEventListener('click', () => list.querySelectorAll('input[data-select-film]').forEach(cb=>cb.checked=false));
  list.innerHTML = '';
  if (!docs.length) { list.innerHTML = '<div class="notice">No films in Next Programme.</div>'; return; }
  docs.forEach(doc => {
    const f = { id:doc.id, ...doc.data() };
    const greenAt = f.greenAt?.toDate?.()?.toISOString?.().slice(0,10)||'—';
    const extra = `<div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink-2);">
        <input type="checkbox" data-select-film="${f.id}" style="width:auto;margin:0;accent-color:var(--gold);"> Select
      </label>
      <span class="badge badge-green" style="font-size:11px;">🌿 ${greenAt}</span>
    </div>`;
    list.insertAdjacentHTML('beforeend', simpleFilmCard(f, extra));
  });
  attachPassportButtons(list);
}

async function loadDiscarded() {
  const list = document.getElementById('discarded-list');
  list.innerHTML = '<div class="notice">Loading…</div>';
  const docs = await fetchByStatus('discarded');
  list.innerHTML = '';
  if (!docs.length) { list.innerHTML = '<div class="notice">Discard list is empty.</div>'; return; }
  docs.forEach(doc => {
    const f = { id:doc.id, ...doc.data() };
    list.insertAdjacentHTML('beforeend', simpleFilmCard(f,
      f.discardedReason ? `<div class="discard-reason">Reason: ${escapeHtml(f.discardedReason)}</div>` : '<div class="discard-reason">No reason — open Passport to add one.</div>'
    ));
  });
  attachPassportButtons(list);
}

async function loadArchive() {
  const list = document.getElementById('archive-list');
  list.innerHTML = '<div class="notice">Loading…</div>';
  const docs = await fetchByStatus('archived');
  list.innerHTML = '';
  if (!docs.length) { list.innerHTML = '<div class="notice">No archived films yet.</div>'; return; }
  docs.forEach(doc => {
    const f = { id:doc.id, ...doc.data() };
    list.insertAdjacentHTML('beforeend', simpleFilmCard(f, f.programmeDate ? `<span class="badge badge-muted" style="margin-top:6px;">Programme: ${f.programmeDate}</span>` : ''));
  });
  attachPassportButtons(list);
}

/* =================== CSV Export =================== */
async function exportCsv(type) {
  const statusMap = { green:'greenlist', nextprog:'next_programme', archive:'archived' };
  const status = statusMap[type];
  if (!status) return;
  const docs = await fetchByStatus(status);
  if (!docs.length) { alert('No films to export.'); return; }
  const safe = v => `"${String(v??'').replace(/"/g,'""')}"`;
  const headers = ['Title','Original Title','Year','Runtime (min)','Director','Language(s)','Country(ies)','Genre','Distributor','UK Rating','Where to See','Synopsis','Notes'];
  const rows = [headers.join(',')];
  docs.forEach(doc => {
    const f = { id:doc.id, ...doc.data() };
    rows.push([safe(f.title),safe(f.originalTitle),safe(f.year),safe(f.runtimeMinutes),safe(f.director),safe(f.language),safe(f.country),safe(f.genre),safe(f.distributor),safe(f.ukAgeRating),safe(f.whereToSee),safe(f.synopsis),safe(f.notes)].join(','));
  });
  const blob = new Blob([rows.join('\n')], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=`fleetfilm-${type}-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* =================== Calendar =================== */
async function loadCalendar() {
  const container = document.getElementById('calendar-container');
  container.innerHTML = `
    <div class="cal-head">
      <button class="btn btn-ghost" id="cal-prev">◀ Prev</button>
      <div class="cal-title" id="cal-title">Month YYYY</div>
      <button class="btn btn-ghost" id="cal-next">Next ▶</button>
    </div>
    <div class="cal-grid" id="cal-grid"></div>`;
  document.getElementById('cal-prev').onclick = () => { calOffset--; refreshCalendarOnly(); };
  document.getElementById('cal-next').onclick = () => { calOffset++; refreshCalendarOnly(); };
  await refreshCalendarOnly();
}

/* =================== Add Location Modal =================== */
async function fetchAddressesByPostcode(pc) {
  const norm = (pc||'').trim().toUpperCase().replace(/\s+/g,'');
  if (!norm) return [];
  try {
    const params = new URLSearchParams({ q:norm, format:'json', addressdetails:1, countrycodes:'gb', zoom:18, limit:50 });
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers:{'User-Agent':'FleetFilmApp/1.0'} });
    if (!r.ok) return [];
    const data = await r.json();
    if (!Array.isArray(data)||!data.length) return [];
    return data.map(item => {
      if (!item.address) return null;
      const a=item.address, house=a.house_number||a.building||'', street=a.road||a.street||'', town=a.town||a.city||a.village||a.suburb||'', county=a.county||a.state||'', postcode=a.postcode?a.postcode.toUpperCase().replace(/\s+/g,''):norm;
      return { house, street, town, county, postcode, address:[house,street].filter(Boolean).join(' '), label:[house,street,town,county,postcode].filter(Boolean).join(', ') };
    }).filter(a=>a&&(a.house||a.street));
  } catch { return []; }
}

function showAddLocationModal(prefill={}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-head"><h2>${prefill.id?'Edit location':'Add location'}</h2><button class="btn btn-ghost" id="loc-cancel">✕</button></div>
        <div class="form-grid">
          <label class="span-2">Location Name (required)<input id="loc-name" type="text" value="${escapeHtml(prefill.name||'')}"></label>
          <label>Postcode<input id="loc-postcode" type="text" value="${escapeHtml(prefill.postcode||'')}"></label>
          <div class="actions"><button class="btn" id="loc-lookup">Lookup</button></div>
          <div class="span-2" id="loc-options"></div>
          <label>House / Name<input id="loc-house" type="text" value="${escapeHtml(prefill.house||'')}"></label>
          <label>Street<input id="loc-street" type="text" value="${escapeHtml(prefill.street||prefill.address||'')}"></label>
          <label>Town / City<input id="loc-town" type="text" value="${escapeHtml(prefill.town||prefill.city||'')}"></label>
          <label>County<input id="loc-county" type="text" value="${escapeHtml(prefill.county||'')}"></label>
          <div id="loc-msg" class="notice hidden span-2"></div>
          <div class="actions span-2" style="justify-content:flex-end"><button class="btn btn-primary" id="loc-save">${prefill.id?'Save changes':'Save'}</button></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const $=sel=>overlay.querySelector(sel), close=res=>{document.body.removeChild(overlay);resolve(res||null);}, toast=msg=>{const m=$('#loc-msg');m.textContent=msg;m.classList.remove('hidden');setTimeout(()=>m.classList.add('hidden'),2000);};
    $('#loc-cancel').onclick=()=>close(null);
    $('#loc-lookup').onclick=async()=>{
      const pc=($('#loc-postcode').value||'').trim(); if(!pc){toast('Enter a postcode first');return;}
      const listEl=$('#loc-options'); listEl.innerHTML='<div class="notice">Searching…</div>';
      const results=await fetchAddressesByPostcode(pc); listEl.innerHTML='';
      if(!results.length){listEl.innerHTML='<div class="notice">No results. Enter manually.</div>';return;}
      results.forEach(a=>{const b=document.createElement('button');b.className='btn btn-ghost';b.type='button';b.style.cssText='width:100%;text-align:left;margin-bottom:4px;font-size:13px;';b.textContent=a.label;b.onclick=()=>{$('#loc-house').value=a.house||'';$('#loc-street').value=a.street||'';$('#loc-town').value=a.town||'';$('#loc-county').value=a.county||'';$('#loc-postcode').value=a.postcode;listEl.innerHTML='';};listEl.appendChild(b);});
    };
    $('#loc-save').onclick=async()=>{
      const name=($('#loc-name').value||'').trim(); if(!name){toast('Location Name is required.');return;}
      const house=$('#loc-house').value.trim(),street=$('#loc-street').value.trim(),town=$('#loc-town').value.trim(),county=$('#loc-county').value.trim(),postcode=$('#loc-postcode').value.trim().toUpperCase();
      const addr=[house,street].filter(Boolean).join(' ');
      try{if(prefill.id){await db.collection('locations').doc(prefill.id).update({name,address:addr,postcode,city:town,house,street,town,county});close({id:prefill.id,name});}else{const ref=await db.collection('locations').add({name,address:addr,postcode,city:town,house,street,town,county,createdAt:firebase.firestore.FieldValue.serverTimestamp()});close({id:ref.id,name});}}catch(e){toast(e.message||'Could not save');}
    };
  });
}

/* =================== Addresses =================== */
async function loadAddresses() {
  const tbody=document.querySelector('#addresses-table tbody'), msg=document.getElementById('addresses-admin-msg');
  if(!tbody)return;
  tbody.innerHTML='';
  const snap=await db.collection('locations').orderBy('name').get();
  if(snap.empty){if(msg){msg.textContent='No saved addresses yet.';msg.classList.remove('hidden');}}
  else{
    if(msg)msg.classList.add('hidden');
    snap.docs.forEach(d=>{const l={id:d.id,...d.data()};const tr=document.createElement('tr');tr.innerHTML=`<td data-label="Name">${escapeHtml(l.name||'')}</td><td data-label="Address">${escapeHtml(l.address||'')}</td><td data-label="Town/City">${escapeHtml(l.city||'')}</td><td data-label="Postcode">${escapeHtml(l.postcode||'')}</td><td data-label="Actions"><button class="btn btn-ghost btn-sm" data-edit="${l.id}">Edit</button> <button class="btn btn-danger btn-sm" data-del="${l.id}">Delete</button></td>`;tbody.appendChild(tr);});
  }
  tbody.onclick=async e=>{
    const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-del]');
    if(edit){const s=await db.collection('locations').doc(edit.dataset.edit).get();const d=s.exists?s.data():{};await showAddLocationModal({id:edit.dataset.edit,name:d.name||'',postcode:d.postcode||'',house:d.house||'',street:d.street||d.address||'',town:d.town||d.city||'',county:d.county||''});loadAddresses();}
    if(del&&confirm('Delete this address?')){await db.collection('locations').doc(del.dataset.del).delete();loadAddresses();}
  };
  document.getElementById('addr-add').onclick=async()=>{const c=await showAddLocationModal();if(c)loadAddresses();};
  document.getElementById('addr-refresh').onclick=loadAddresses;
}

/* =================== Boot =================== */
async function boot() {
  try { initFirebaseOnce(); } catch (e) { alert('Missing Firebase config.'); return; }
  try { await auth.getRedirectResult(); } catch (e) { console.warn('Redirect:', e?.message); }
  attachHandlers();
  auth.onAuthStateChanged(async u => {
    state.user = u;
    if (!u) { showSignedIn(false); location.hash = ''; return; }
    await ensureUserDoc(u);
    showSignedIn(true);
    routerFromHash();
  });
}

document.addEventListener('DOMContentLoaded', () => boot().catch(err => console.error('[boot]', err)));
