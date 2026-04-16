/* Fleet Film App – Passport-centric overhaul
   All film details, voting, status changes, and pipeline management
   live inside the Film Passport modal. Simplified nav:
     submit | films | green | nextprog | discarded | archive | calendar | addresses
*/

let app, auth, db;

const state = { user: null, role: 'member' };
function isAdmin() { return state.role === 'admin'; }

function currentActor() {
  return {
    uid: state.user ? state.user.uid : null,
    email: state.user ? (state.user.email || '') : '',
    name: state.user ? (state.user.displayName || state.user.email || '') : ''
  };
}

async function logAudit(filmId, action, details = {}) {
  try {
    if (!filmId) return;
    const a = currentActor();
    await db.collection('films').doc(filmId).collection('audit').add({
      action, details,
      byUid: a.uid, byEmail: a.email, byName: a.name,
      at: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) { console.warn('audit failed:', e && e.message); }
}

async function deleteFilmCompletely(filmId) {
  const ref = db.collection('films').doc(filmId);
  const votesSnap = await ref.collection('votes').get();
  const batch = db.batch();
  votesSnap.forEach(d => batch.delete(d.ref));
  await batch.commit();
  await ref.delete();
  await logAudit(filmId, 'delete', {});
}

/* =================== PAGE DEFS (simplified) =================== */
const PAGE_DEFS = [
  ['submit',    'Submit'],
  ['films',     'Film List'],
  ['green',     'Green List'],
  ['nextprog',  'Next Programme'],
  ['discarded', 'Discarded'],
  ['archive',   'Archive'],
  ['calendar',  'Calendar'],
  ['addresses', 'Addresses'],
];

const STATUS_LABELS = {
  pending:          'Pending',
  greenlist:        'Green List',
  next_programme:   'Next Programme',
  discarded:        'Discarded',
  archived:         'Archived',
};

function humanStatus(s) { return STATUS_LABELS[s] || s || ''; }

/* =================== Calendar helpers =================== */
let calOffset = 0;
function mondayIndex(jsDay) { return (jsDay + 6) % 7; }
function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

function buildCalendarGridHTML(year, month, eventsByISO) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = mondayIndex(new Date(year, month, 1).getDay());
  const headers = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    .map(w => `<div class="cal-wd">${w}</div>`).join('');
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<div class="cal-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const items = eventsByISO[iso] || [];
    const pills = items.map(({text, id}, i) =>
      `<button class="cal-pill c${i%4}" data-film-id="${id}">${escapeHtml(text)}</button>`
    ).join('');
    cells += `<div class="cal-cell"><div class="cal-day">${d}</div>${pills}</div>`;
  }
  return headers + cells;
}

async function refreshCalendarOnly() {
  const titleEl = document.getElementById('cal-title');
  const gridEl  = document.getElementById('cal-grid');
  if (!titleEl || !gridEl) return;

  const snap = await db.collection('films').get();
  const films = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const byISO = {};

  films.forEach(f => {
    if (Array.isArray(f.screenings) && f.screenings.length) {
      f.screenings.forEach(sc => {
        const iso = sc.dateISO;
        if (!iso) return;
        const locName = sc.locationName ? ` • ${sc.locationName}` : '';
        const time = sc.time ? ` ${sc.time}` : '';
        (byISO[iso] ||= []).push({ text: `${f.title}${time}${locName}`, id: f.id });
      });
      return;
    }
    if (f.viewingDate && typeof f.viewingDate.toDate === 'function') {
      const d = f.viewingDate.toDate();
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const locName = f.viewingLocationName ? ` • ${f.viewingLocationName}` : '';
      const time = f.viewingTime ? ` ${f.viewingTime}` : '';
      (byISO[iso] ||= []).push({ text: `${f.title}${time}${locName}`, id: f.id });
    }
  });

  const now = new Date();
  const ref = new Date(now.getFullYear(), now.getMonth() + calOffset, 1);
  titleEl.textContent = monthLabel(ref.getFullYear(), ref.getMonth());
  gridEl.innerHTML = buildCalendarGridHTML(ref.getFullYear(), ref.getMonth(), byISO);

  gridEl.querySelectorAll('.cal-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      const filmId = btn.getAttribute('data-film-id');
      const doc = await db.collection('films').doc(filmId).get();
      if (!doc.exists) return;
      openPassport({ id: doc.id, ...doc.data() });
    });
  });
}

/* =================== Firebase =================== */
function haveFirebaseSDK() { try { return !!window.firebase; } catch { return false; } }
function getFirebaseConfig() { return window.__FLEETFILM__CONFIG || window.firebaseConfig || window.FIREBASE_CONFIG || null; }

async function waitForFirebaseAndConfig(timeoutMs = 10000) {
  const start = Date.now();
  while (!haveFirebaseSDK()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise(r => setTimeout(r, 25));
  }
  while (true) {
    if (firebase.apps && firebase.apps.length > 0) return true;
    if (getFirebaseConfig()) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise(r => setTimeout(r, 50));
  }
}

function initFirebaseOnce() {
  if (firebase.apps && firebase.apps.length > 0) {
    app = firebase.app(); auth = firebase.auth(); db = firebase.firestore(); return;
  }
  const cfg = getFirebaseConfig();
  if (!cfg || !cfg.apiKey) throw new Error('Missing Firebase config');
  app = firebase.initializeApp(cfg);
  auth = firebase.auth();
  db = firebase.firestore();
  auth.useDeviceLanguage?.();
}

/* =================== Router =================== */
const VIEWS = ['submit','films','green','nextprog','discarded','archive','calendar','addresses'];

function setView(name) {
  // Nav active state
  document.querySelectorAll('.nav .btn-pill, .mobile-tabbar button[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });
  // Show/hide sections
  VIEWS.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.toggle('hidden', v !== name);
  });
  // Load data
  if (name === 'films')      return loadFilms();
  if (name === 'green')      return loadGreen();
  if (name === 'nextprog')   return loadNextProg();
  if (name === 'discarded')  return loadDiscarded();
  if (name === 'archive')    return loadArchive();
  if (name === 'calendar')   return loadCalendar();
  if (name === 'addresses')  return loadAddresses();
}

function routerFromHash() {
  const h = location.hash.replace('#', '') || 'submit';
  setView(VIEWS.includes(h) ? h : 'films');
}

function showSignedIn(on) {
  document.getElementById('signed-in').classList.toggle('hidden', !on);
  document.getElementById('signed-out').classList.toggle('hidden', on);
  document.getElementById('nav').classList.toggle('hidden', !on);
  const mbar = document.getElementById('mobile-tabbar');
  if (mbar) mbar.classList.toggle('hidden', !on);
}

async function ensureUserDoc(u) {
  const ref = db.collection('users').doc(u.uid);
  const base = {
    email: u.email || '',
    displayName: u.displayName || u.email || 'User',
    lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({ ...base, role: 'member', createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  } else {
    await ref.set(base, { merge: true });
  }
  const roleSnap = await ref.get();
  state.role = (roleSnap.exists && roleSnap.data() && roleSnap.data().role) || 'member';
  const addrBtn = document.getElementById('nav-addresses');
  if (addrBtn) addrBtn.classList.toggle('hidden', state.role !== 'admin');
}

/* =================== Handlers =================== */
function attachHandlers() {
  // Nav routing
  document.querySelectorAll('.nav .btn-pill').forEach(btn => {
    btn.addEventListener('click', () => { location.hash = btn.dataset.view; });
  });

  document.getElementById('btn-signout')?.addEventListener('click', () => auth.signOut());

  // Submit buttons
  document.getElementById('btn-submit-film')?.addEventListener('click', () => submitFilm({ mode: 'search' }));
  document.getElementById('btn-submit-again')?.addEventListener('click', () => submitFilm({ mode: 'searchAgain' }));
  document.getElementById('btn-submit-manual')?.addEventListener('click', () => submitFilm({ mode: 'manual' }));

  // Google auth
  document.getElementById('btn-google')?.addEventListener('click', async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    try { await auth.signInWithPopup(provider); }
    catch (err) { await auth.signInWithRedirect(provider); }
  });

  auth.getRedirectResult().catch(err => console.warn('Redirect error:', err?.message));

  document.getElementById('btn-email-signin')?.addEventListener('click', async () => {
    try { await auth.signInWithEmailAndPassword(
      document.getElementById('email').value,
      document.getElementById('password').value
    ); } catch (e) { alert(e.message); }
  });

  document.getElementById('btn-email-create')?.addEventListener('click', async () => {
    try { await auth.createUserWithEmailAndPassword(
      document.getElementById('email').value,
      document.getElementById('password').value
    ); } catch (e) { alert(e.message); }
  });

  // CSV export buttons
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-export]');
    if (btn) exportCsv(btn.dataset.export);
  });

  // Hash router
  window.addEventListener('hashchange', routerFromHash);

  // Mobile tabbar
  document.getElementById('mobile-tabbar')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-view]');
    if (btn) location.hash = btn.dataset.view;
  });

  // Mobile "More"
  document.getElementById('tab-more')?.addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-head"><h2>Pages</h2><button class="btn btn-ghost" id="more-close">Close</button></div>
        <div class="modal-list" id="more-list"></div>
      </div>`;
    document.body.appendChild(overlay);
    const list = overlay.querySelector('#more-list');
    PAGE_DEFS.forEach(([view, label]) => {
      const b = document.createElement('button');
      b.className = 'btn'; b.textContent = label;
      b.onclick = () => { location.hash = view; document.body.removeChild(overlay); };
      list.appendChild(b);
    });
    overlay.querySelector('#more-close').onclick = () => document.body.removeChild(overlay);
  });

  // Filters
  setupFilters();
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

/* =================== Utilities =================== */
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function normalizeTitleForSearch(t) {
  return String(t||'').trim().replace(/&/g,'and').replace(/['']/g,'')
    .replace(/[^a-zA-Z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
}

function getOmdbKey() {
  return (window.__FLEETFILM__CONFIG && window.__FLEETFILM__CONFIG.omdbApiKey) || '';
}

async function omdbSearch(title, year) {
  const key = getOmdbKey(); if (!key) return { Search: [] };
  const params = new URLSearchParams({ apikey: key, s: title, type: 'movie' });
  if (year) params.set('y', String(year));
  const r = await fetch('https://www.omdbapi.com/?' + params.toString());
  if (!r.ok) return { Search: [] };
  return (await r.json()) || { Search: [] };
}

async function omdbDetailsById(imdbID) {
  const key = getOmdbKey(); if (!key) return null;
  const params = new URLSearchParams({ apikey: key, i: imdbID, plot: 'short' });
  const r = await fetch('https://www.omdbapi.com/?' + params.toString());
  if (!r.ok) return null;
  const data = await r.json();
  return (data && data.Response === 'True') ? data : null;
}

function mapMpaaToUk(mpaa) {
  if (!mpaa) return '';
  const s = String(mpaa).toUpperCase();
  if (s === 'G') return 'U';
  if (s === 'PG') return 'PG';
  if (s === 'PG-13') return '12A';
  if (s === 'R') return '15';
  if (s === 'NC-17') return '18';
  if (s.includes('NOT RATED') || s === 'N/A') return 'NR';
  return s;
}

function extractImdbId(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const m = s.match(/(tt\d{6,10})/i);
  return m ? m[1].toLowerCase() : '';
}

/* =================== OMDb Picker =================== */
function showPicker(items) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML =
      '<div class="modal-head"><h2>Select the correct film</h2>' +
      '<div style="display:flex;gap:8px">' +
      '<button id="ff-picker-manual" class="btn btn-ghost">Add manually</button>' +
      '<button id="ff-picker-cancel" class="btn btn-ghost">Cancel</button>' +
      '</div></div>' +
      '<div id="ff-picker-list" class="modal-list"></div>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const list = modal.querySelector('#ff-picker-list');
    if (!items || !items.length) {
      list.innerHTML = '<div class="notice">No matches found. Use "Add manually".</div>';
    } else {
      items.forEach(it => {
        const poster = (it.Poster && it.Poster !== 'N/A') ? it.Poster : '';
        const row = document.createElement('div');
        row.className = 'modal-row';
        row.innerHTML =
          (poster ? `<img src="${poster}" alt="poster" class="poster-small">` : '') +
          `<div class="modal-row-main"><div class="modal-row-title">${it.Title} (${it.Year})</div><div class="modal-row-sub">${it.Type||'movie'} • ${it.imdbID}</div></div>` +
          `<button data-id="${it.imdbID}" class="btn btn-primary">Select</button>`;
        list.appendChild(row);
      });
    }

    modal.querySelector('#ff-picker-cancel').onclick = () => { document.body.removeChild(overlay); resolve({ mode: 'cancel' }); };
    modal.querySelector('#ff-picker-manual').onclick = () => { document.body.removeChild(overlay); resolve({ mode: 'manual' }); };
    list.addEventListener('click', e => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      document.body.removeChild(overlay);
      resolve({ mode: 'pick', imdbID: btn.getAttribute('data-id') });
    });
  });
}

/* =================== Submit =================== */
async function submitFilm(opts = { mode: 'search' }) {
  const mode = opts.mode || 'search';
  const imdbRaw = document.getElementById('f-imdb')?.value || '';
  const imdbID = extractImdbId(imdbRaw);
  const title = (document.getElementById('f-title')?.value || '').trim();
  const yearStr = String(document.getElementById('f-year')?.value || '').trim();
  const year = /^\d{4}$/.test(yearStr) ? parseInt(yearStr, 10) : null;
  const useYear = document.getElementById('f-use-year')?.checked !== false;

  if (!state.user) { alert('Please sign in first.'); return; }

  if (mode === 'manual') {
    if (!title) { alert('Title required'); return; }
    await addFilmDoc({ title, year, picked: null }); return;
  }

  if (imdbID) {
    const picked = await omdbDetailsById(imdbID);
    if (!picked) {
      if (!confirm('Could not load that IMDb ID. Add manually?')) return;
      if (!title) { alert('Title required for manual add'); return; }
      await addFilmDoc({ title, year, picked: null }); return;
    }
    await addFilmDoc({ title: picked.Title || title, year: (picked.Year && /^\d{4}$/.test(picked.Year)) ? parseInt(picked.Year, 10) : year, picked });
    return;
  }

  if (!title) { alert('Enter a title or paste an IMDb link/ID.'); return; }

  let picked = null;
  try {
    const doSearch = async (t, y) => {
      const res = await omdbSearch(t, y);
      return (res && res.Search) ? res.Search.filter(x => x.Type === 'movie') : [];
    };
    const titleNorm = normalizeTitleForSearch(title);
    let candidates = [];

    if (mode === 'searchAgain') {
      candidates = await doSearch(title, null);
      if (!candidates.length && titleNorm !== title.toLowerCase()) candidates = await doSearch(titleNorm, null);
    } else {
      candidates = useYear && year ? await doSearch(title, year) : await doSearch(title, null);
      if (!candidates.length && titleNorm && titleNorm.toLowerCase() !== title.toLowerCase()) {
        candidates = useYear && year ? await doSearch(titleNorm, year) : await doSearch(titleNorm, null);
      }
      if (!candidates.length && useYear && year) candidates = await doSearch(titleNorm || title, null);
    }

    const choice = await showPicker(candidates);
    if (choice.mode === 'cancel') return;
    if (choice.mode === 'manual') { await addFilmDoc({ title, year, picked: null }); return; }
    if (choice.mode === 'pick' && choice.imdbID) picked = await omdbDetailsById(choice.imdbID);
  } catch (e) {
    if (!confirm('Could not reach OMDb. Add manually?')) return;
  }

  await addFilmDoc({ title, year, picked });
}

async function addFilmDoc({ title, year, picked }) {
  const base = {
    title: title || '',
    year: (typeof year === 'number' && !Number.isNaN(year)) ? year : null,
    synopsis: '',
    status: 'pending',
    createdBy: state.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    runtimeMinutes: null,
    language: '',
    ageRating: '',
    ukAgeRating: '',
    genre: '',
    country: '',
    distributor: '',
    whereToSee: '',        // "Stream", "Disk", "Screen" or free text
    posterUrl: '',
    imdbID: '',
    screenings: [],
    greenAt: null,
    discardedReason: '',
    notes: '',
  };

  if (picked) {
    let runtimeMinutes = null;
    if (picked.Runtime && /\d+/.test(picked.Runtime)) runtimeMinutes = parseInt(picked.Runtime.match(/\d+/)[0], 10);
    base.posterUrl = (picked.Poster && picked.Poster !== 'N/A') ? picked.Poster : '';
    base.ageRating = picked.Rated && picked.Rated !== 'N/A' ? picked.Rated : '';
    base.ukAgeRating = mapMpaaToUk(base.ageRating);
    base.genre = picked.Genre && picked.Genre !== 'N/A' ? picked.Genre : '';
    base.language = picked.Language && picked.Language !== 'N/A' ? picked.Language : '';
    base.country = picked.Country && picked.Country !== 'N/A' ? picked.Country : '';
    base.imdbID = picked.imdbID || '';
    if (runtimeMinutes) base.runtimeMinutes = runtimeMinutes;
    if (picked.Plot && picked.Plot !== 'N/A') base.synopsis = picked.Plot;
    if (picked.Title) base.title = picked.Title;
    if (picked.Year && /^\d{4}$/.test(picked.Year)) base.year = parseInt(picked.Year, 10);
  }

  const ref = await db.collection('films').add(base);
  await logAudit(ref.id, 'create', { via: picked ? (base.imdbID ? 'omdb' : 'picker') : 'manual' });

  const msg = document.getElementById('submit-msg');
  if (msg) { msg.textContent = 'Film added!'; msg.classList.remove('hidden'); setTimeout(() => msg.classList.add('hidden'), 1800); }
  document.getElementById('f-imdb').value = '';
  document.getElementById('f-title').value = '';
  document.getElementById('f-year').value = '';
  setView('films');
}

/* =================== Fetch helpers =================== */
async function fetchByStatus(status) {
  const snap = await db.collection('films').where('status', '==', status).get();
  const docs = snap.docs.slice();
  docs.sort((a, b) => {
    const ta = String(a.data().title || '').toLowerCase();
    const tb = String(b.data().title || '').toLowerCase();
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  return docs;
}

/* =================== Film List =================== */
async function loadFilms() {
  const list = document.getElementById('films-list');
  list.innerHTML = '<div class="notice">Loading…</div>';

  const snap = await db.collection('films').get();
  let films = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Filter by status
  if (filterState.status) films = films.filter(f => f.status === filterState.status);

  // Filter by search query - search ALL fields
  if (filterState.q) {
    const q = filterState.q;
    films = films.filter(f =>
      (f.title || '').toLowerCase().includes(q) ||
      (f.synopsis || '').toLowerCase().includes(q) ||
      (f.genre || '').toLowerCase().includes(q) ||
      (f.language || '').toLowerCase().includes(q) ||
      (f.country || '').toLowerCase().includes(q) ||
      (f.distributor || '').toLowerCase().includes(q) ||
      (f.whereToSee || '').toLowerCase().includes(q) ||
      (f.ukAgeRating || '').toLowerCase().includes(q) ||
      String(f.year || '').includes(q)
    );
  }

  // Sort
  films.sort((a, b) => {
    const mode = filterState.sort || 'created-desc';
    const titleA = (a.title || '').toString();
    const titleB = (b.title || '').toString();
    const yearA = typeof a.year === 'number' ? a.year : (parseInt(a.year, 10) || 0);
    const yearB = typeof b.year === 'number' ? b.year : (parseInt(b.year, 10) || 0);
    const createdA = (a.createdAt && typeof a.createdAt.toMillis === 'function') ? a.createdAt.toMillis() : 0;
    const createdB = (b.createdAt && typeof b.createdAt.toMillis === 'function') ? b.createdAt.toMillis() : 0;
    switch (mode) {
      case 'title-asc':    return titleA.localeCompare(titleB);
      case 'title-desc':   return titleB.localeCompare(titleA);
      case 'year-desc':    return yearB - yearA;
      case 'year-asc':     return yearA - yearB;
      case 'created-asc':  return createdA - createdB;
      default:             return createdB - createdA;
    }
  });

  list.innerHTML = '';
  if (!films.length) { list.innerHTML = '<div class="notice">No films match the current filters.</div>'; return; }

  films.forEach(f => {
    list.insertAdjacentHTML('beforeend', filmRowCard(f));
  });

  list.querySelectorAll('button[data-open-passport]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.openPassport;
      const doc = await db.collection('films').doc(id).get();
      if (doc.exists) openPassport({ id: doc.id, ...doc.data() });
    });
  });
}

function filmRowCard(f) {
  const year = f.year ? `(${f.year})` : '';
  const poster = f.posterUrl ? `<img alt="Poster" src="${escapeHtml(f.posterUrl)}" class="poster">` : '<div class="poster-placeholder"></div>';
  const statusLabel = humanStatus(f.status);
  const statusClass = {
    pending: 'badge-neutral',
    greenlist: 'badge-green',
    next_programme: 'badge-blue',
    discarded: 'badge-red',
    archived: 'badge-muted',
  }[f.status] || 'badge-neutral';

  return `
    <div class="film-row-card">
      <div class="film-row-poster">${poster}</div>
      <div class="film-row-info">
        <div class="film-row-title">${escapeHtml(f.title)} <span class="film-row-year">${year}</span></div>
        <div class="film-row-meta">
          ${f.genre ? `<span>${escapeHtml(f.genre)}</span>` : ''}
          ${f.language ? `<span>${escapeHtml(f.language)}</span>` : ''}
          ${f.runtimeMinutes ? `<span>${f.runtimeMinutes} min</span>` : ''}
        </div>
        ${f.synopsis ? `<div class="film-row-synopsis">${escapeHtml(f.synopsis.slice(0, 140))}${f.synopsis.length > 140 ? '…' : ''}</div>` : ''}
      </div>
      <div class="film-row-actions">
        <span class="badge ${statusClass}">${statusLabel}</span>
        <button class="btn btn-primary" data-open-passport="${f.id}">Open Passport</button>
      </div>
    </div>`;
}

/* =================== FILM PASSPORT MODAL =================== */
async function openPassport(f) {
  // Always reload fresh data
  const snap = await db.collection('films').doc(f.id).get();
  if (!snap.exists) { alert('Film not found'); return; }
  f = { id: snap.id, ...snap.data() };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay passport-overlay';
  overlay.innerHTML = `
    <div class="modal passport-modal" role="dialog" aria-label="Film Passport: ${escapeHtml(f.title)}">
      <div class="passport-header">
        <div class="passport-title-block">
          <span class="passport-label">FILM PASSPORT</span>
          <h2 class="passport-film-title">${escapeHtml(f.title)} ${f.year ? `<span class="passport-year">(${f.year})</span>` : ''}</h2>
        </div>
        <div class="passport-header-actions">
          <span class="badge ${statusBadgeClass(f.status)}">${humanStatus(f.status)}</span>
          <button class="btn btn-ghost" id="passport-close">✕ Close</button>
        </div>
      </div>

      <div class="passport-body">

        <!-- LEFT: poster + core info -->
        <div class="passport-left">
          ${f.posterUrl ? `<img src="${escapeHtml(f.posterUrl)}" alt="Poster" class="passport-poster">` : '<div class="passport-poster-placeholder">No Poster</div>'}

          <div class="passport-status-block">
            <div class="passport-section-label">Status</div>
            <select id="pp-status" class="passport-status-select">
              <option value="pending" ${f.status==='pending'?'selected':''}>Pending</option>
              <option value="greenlist" ${f.status==='greenlist'?'selected':''}>Green List</option>
              <option value="next_programme" ${f.status==='next_programme'?'selected':''}>Next Programme</option>
              <option value="discarded" ${f.status==='discarded'?'selected':''}>Discarded</option>
              <option value="archived" ${f.status==='archived'?'selected':''}>Archived</option>
            </select>

            <div id="pp-discard-reason-wrap" class="${f.status === 'discarded' ? '' : 'hidden'}" style="margin-top:8px">
              <label style="font-size:12px;color:var(--muted);margin-bottom:4px;display:block;">Reason for discard (required)</label>
              <textarea id="pp-discard-reason" rows="2" placeholder="Why was this film discarded?">${escapeHtml(f.discardedReason || '')}</textarea>
            </div>

            <div id="pp-green-date-wrap" class="${f.status === 'greenlist' || f.status === 'next_programme' || f.status === 'archived' ? '' : 'hidden'}" style="margin-top:6px">
              ${f.greenAt && typeof f.greenAt.toDate === 'function'
                ? `<span class="badge badge-green">Green since: ${f.greenAt.toDate().toISOString().slice(0,10)}</span>`
                : ''}
            </div>

            <button class="btn btn-primary" id="pp-save-status" style="margin-top:10px;width:100%">Save Status</button>
          </div>

          ${isAdmin() ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <button class="btn btn-danger" id="pp-delete" style="width:100%;font-size:13px">🗑 Permanent Delete</button>
          </div>` : ''}
        </div>

        <!-- RIGHT: tabs -->
        <div class="passport-right">
          <div class="passport-tabs">
            <button class="passport-tab active" data-tab="details">Details</button>
            <button class="passport-tab" data-tab="votes">Votes</button>
            <button class="passport-tab" data-tab="screenings">Screenings</button>
            <button class="passport-tab" data-tab="history">History</button>
          </div>

          <!-- DETAILS TAB -->
          <div class="passport-tab-panel" id="pp-tab-details">
            <div class="form-grid" style="margin-top:10px">
              <label>Title
                <input id="pp-title" type="text" value="${escapeHtml(f.title || '')}">
              </label>
              <label>Year
                <input id="pp-year" type="number" value="${f.year || ''}" placeholder="e.g. 2024">
              </label>
              <label>Runtime (minutes)
                <input id="pp-runtime" type="number" value="${f.runtimeMinutes || ''}">
              </label>
              <label>UK Age Rating
                <input id="pp-rating" type="text" value="${escapeHtml(f.ukAgeRating || '')}" placeholder="U, PG, 12A, 15, 18, NR">
              </label>
              <label>Language(s)
                <input id="pp-language" type="text" value="${escapeHtml(f.language || '')}" placeholder="e.g. English, French">
              </label>
              <label>Country(ies)
                <input id="pp-country" type="text" value="${escapeHtml(f.country || '')}" placeholder="e.g. UK, France">
              </label>
              <label>Genre
                <input id="pp-genre" type="text" value="${escapeHtml(f.genre || '')}" placeholder="e.g. Drama, Comedy">
              </label>
              <label>Distributor
                <input id="pp-distributor" type="text" value="${escapeHtml(f.distributor || '')}" placeholder="e.g. Curzon, MUBI, StudioCanal">
              </label>
              <label class="span-2">Where / When to See
                <div class="where-to-see-row">
                  <label class="where-option"><input type="checkbox" id="pp-wts-stream" ${(f.whereToSee||'').includes('Stream') ? 'checked' : ''}> Stream</label>
                  <label class="where-option"><input type="checkbox" id="pp-wts-disk" ${(f.whereToSee||'').includes('Disk') ? 'checked' : ''}> Disk</label>
                  <label class="where-option"><input type="checkbox" id="pp-wts-screen" ${(f.whereToSee||'').includes('Screen') ? 'checked' : ''}> Screen</label>
                  <input id="pp-wts-other" type="text" placeholder="Other / details…" value="${escapeHtml(whereToSeeOther(f.whereToSee || ''))}" style="flex:1;min-width:120px">
                </div>
              </label>
              <label class="span-2">Synopsis
                <textarea id="pp-synopsis" rows="4" placeholder="Short description">${escapeHtml(f.synopsis || '')}</textarea>
              </label>
              <label class="span-2">Notes
                <textarea id="pp-notes" rows="2" placeholder="Additional notes">${escapeHtml(f.notes || '')}</textarea>
              </label>
            </div>
            <div class="actions" style="margin-top:12px">
              <button class="btn btn-primary" id="pp-save-details">Save Details</button>
              <div id="pp-details-msg" class="notice hidden" style="display:inline-block;margin-left:10px"></div>
            </div>
          </div>

          <!-- VOTES TAB -->
          <div class="passport-tab-panel hidden" id="pp-tab-votes">
            <div id="pp-votes-content">
              <div class="notice">Loading votes…</div>
            </div>
          </div>

          <!-- SCREENINGS TAB -->
          <div class="passport-tab-panel hidden" id="pp-tab-screenings">
            <div id="pp-screenings-content">
              <div class="notice">Loading screenings…</div>
            </div>
          </div>

          <!-- HISTORY TAB -->
          <div class="passport-tab-panel hidden" id="pp-tab-history">
            <div id="pp-history-content">
              <div class="notice">Loading history…</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const $ = sel => overlay.querySelector(sel);

  // Close
  $('#passport-close').onclick = () => document.body.removeChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });

  // Tab switching
  overlay.querySelectorAll('.passport-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      overlay.querySelectorAll('.passport-tab').forEach(t => t.classList.remove('active'));
      overlay.querySelectorAll('.passport-tab-panel').forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      const panel = overlay.querySelector(`#pp-tab-${tab.dataset.tab}`);
      if (panel) panel.classList.remove('hidden');
      if (tab.dataset.tab === 'votes') loadPassportVotes(f.id, overlay);
      if (tab.dataset.tab === 'screenings') loadPassportScreenings(f.id, overlay);
      if (tab.dataset.tab === 'history') loadPassportHistory(f.id, overlay);
    });
  });

  // Status change — show/hide discard reason and green date
  $('#pp-status').addEventListener('change', () => {
    const val = $('#pp-status').value;
    $('#pp-discard-reason-wrap').classList.toggle('hidden', val !== 'discarded');
    $('#pp-green-date-wrap').classList.toggle('hidden', !['greenlist','next_programme','archived'].includes(val));
  });

  // Save status
  $('#pp-save-status').onclick = async () => {
    const newStatus = $('#pp-status').value;
    const oldStatus = f.status;
    const updates = { status: newStatus };

    if (newStatus === 'discarded') {
      const reason = ($('#pp-discard-reason')?.value || '').trim();
      if (!reason) { alert('Please enter a reason for discarding this film.'); return; }
      updates.discardedReason = reason;
    }

    if (newStatus === 'greenlist' && oldStatus !== 'greenlist') {
      updates.greenAt = firebase.firestore.FieldValue.serverTimestamp();
    }

    await db.collection('films').doc(f.id).update(updates);
    await logAudit(f.id, 'status_change', { from: oldStatus, to: newStatus });
    document.body.removeChild(overlay);
    routerFromHash();
  };

  // Save details
  $('#pp-save-details').onclick = async () => {
    const wtsParts = [];
    if ($('#pp-wts-stream')?.checked) wtsParts.push('Stream');
    if ($('#pp-wts-disk')?.checked) wtsParts.push('Disk');
    if ($('#pp-wts-screen')?.checked) wtsParts.push('Screen');
    const wtsOther = ($('#pp-wts-other')?.value || '').trim();
    if (wtsOther) wtsParts.push(wtsOther);

    const payload = {
      title: ($('#pp-title')?.value || '').trim() || f.title,
      year: parseInt($('#pp-year')?.value || '0', 10) || null,
      runtimeMinutes: parseInt($('#pp-runtime')?.value || '0', 10) || null,
      ukAgeRating: ($('#pp-rating')?.value || '').trim(),
      language: ($('#pp-language')?.value || '').trim(),
      country: ($('#pp-country')?.value || '').trim(),
      genre: ($('#pp-genre')?.value || '').trim(),
      distributor: ($('#pp-distributor')?.value || '').trim(),
      whereToSee: wtsParts.join(', '),
      synopsis: ($('#pp-synopsis')?.value || '').trim(),
      notes: ($('#pp-notes')?.value || '').trim(),
    };

    try {
      await db.collection('films').doc(f.id).update(payload);
      await logAudit(f.id, 'edit_details', payload);
      const msg = $('#pp-details-msg');
      if (msg) { msg.textContent = 'Saved!'; msg.classList.remove('hidden'); setTimeout(() => msg.classList.add('hidden'), 1800); }
    } catch (e) { alert(e.message || 'Failed to save'); }
  };

  // Permanent delete (admin only)
  if (isAdmin()) {
    $('#pp-delete').onclick = async () => {
      if (!confirm('Permanently delete this film and all its votes? This cannot be undone.')) return;
      await deleteFilmCompletely(f.id);
      document.body.removeChild(overlay);
      routerFromHash();
    };
  }
}

function whereToSeeOther(str) {
  // Extract any non-standard parts (not Stream/Disk/Screen)
  return str.split(',').map(s => s.trim())
    .filter(s => !['Stream','Disk','Screen'].includes(s))
    .join(', ');
}

function statusBadgeClass(status) {
  return { greenlist: 'badge-green', next_programme: 'badge-blue', discarded: 'badge-red', archived: 'badge-muted' }[status] || 'badge-neutral';
}

/* =================== Passport: Votes Tab =================== */
async function loadPassportVotes(filmId, overlay) {
  const container = overlay.querySelector('#pp-votes-content');
  container.innerHTML = '<div class="notice">Loading…</div>';

  const myUid = state.user?.uid;

  const usersSnap = await db.collection('users').get();
  const users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const nameOf = uid => {
    const u = users.find(u => u.uid === uid);
    return u ? (u.displayName || u.email || uid) : uid;
  };

  const vsSnap = await db.collection('films').doc(filmId).collection('votes').get();
  let yes = 0, no = 0, undecided = 0;
  const voters = [];

  vsSnap.forEach(v => {
    const d = v.data() || {};
    if (d.value === 1) yes++;
    else if (d.value === -1) no++;
    else undecided++;
    voters.push({ uid: v.id, value: d.value, comment: d.comment || '' });
  });

  let myVoteVal = null, myComment = '';
  if (myUid) {
    const myVote = await db.collection('films').doc(filmId).collection('votes').doc(myUid).get();
    if (myVote.exists) {
      myVoteVal = myVote.data().value ?? null;
      myComment = myVote.data().comment || '';
    }
  }

  const votedSet = new Set(voters.map(v => v.uid));
  const notVoted = users.filter(u => u.uid && !votedSet.has(u.uid));

  const voterRows = voters.length
    ? voters.map(v => {
        const label = v.value === 1 ? '👍 Yes' : v.value === -1 ? '👎 No' : '🤷 Undecided';
        const badgeClass = v.value === 1 ? 'badge-green' : v.value === -1 ? 'badge-red' : 'badge-neutral';
        return `<div class="vote-entry">
          <div class="vote-entry-header">
            <strong>${escapeHtml(nameOf(v.uid))}</strong>
            <span class="badge ${badgeClass}">${label}</span>
          </div>
          ${v.comment ? `<div class="vote-comment-text">${escapeHtml(v.comment)}</div>` : ''}
        </div>`;
      }).join('')
    : '<div class="notice">No votes yet.</div>';

  const notVotedHtml = notVoted.length
    ? notVoted.map(u => `<span class="badge badge-muted">${escapeHtml(u.displayName || u.email || u.uid)}</span>`).join(' ')
    : '<span class="notice" style="font-size:13px">Everyone has voted.</span>';

  container.innerHTML = `
    <div class="vote-summary-bar">
      <span class="badge badge-green">👍 Yes: ${yes}</span>
      <span class="badge badge-neutral">🤷 Undecided: ${undecided}</span>
      <span class="badge badge-red">👎 No: ${no}</span>
    </div>

    <div class="passport-section-label" style="margin-top:14px">Your Vote</div>
    <div class="vote-buttons" role="group">
      <button class="btn vote-btn ${myVoteVal===1?'vote-active-yes':''}" data-vote-val="1">👍 Yes</button>
      <button class="btn vote-btn ${myVoteVal===0?'vote-active-und':''}" data-vote-val="0">🤷 Undecided</button>
      <button class="btn vote-btn ${myVoteVal===-1?'vote-active-no':''}" data-vote-val="-1">👎 No</button>
    </div>
    <label style="margin-top:10px;display:block;">
      Comment (optional — editable anytime)
      <textarea id="pp-vote-comment" rows="2" placeholder="Your thoughts on this film…">${escapeHtml(myComment)}</textarea>
    </label>
    <button class="btn btn-primary" id="pp-cast-vote" style="margin-top:8px">Save My Vote</button>
    <div id="pp-vote-msg" class="notice hidden" style="margin-top:6px"></div>

    <div class="passport-section-label" style="margin-top:18px">All Votes</div>
    <div class="vote-entries">${voterRows}</div>

    <div class="passport-section-label" style="margin-top:14px">Not Voted Yet</div>
    <div class="not-voted-list">${notVotedHtml}</div>
  `;

  let selectedVote = myVoteVal;

  overlay.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.vote-btn').forEach(b => b.classList.remove('vote-active-yes','vote-active-und','vote-active-no'));
      selectedVote = parseInt(btn.dataset.voteVal, 10);
      if (selectedVote === 1) btn.classList.add('vote-active-yes');
      else if (selectedVote === 0) btn.classList.add('vote-active-und');
      else btn.classList.add('vote-active-no');
    });
  });

  overlay.querySelector('#pp-cast-vote').onclick = async () => {
    if (selectedVote === null && myVoteVal === null) { alert('Select a vote first.'); return; }
    const val = selectedVote !== null ? selectedVote : myVoteVal;
    const comment = (overlay.querySelector('#pp-vote-comment')?.value || '').trim();
    try {
      await db.collection('films').doc(filmId).collection('votes').doc(myUid).set({
        value: val,
        comment,
        voterName: currentActor().name,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      await logAudit(filmId, 'vote', { value: val, comment });
      const msg = overlay.querySelector('#pp-vote-msg');
      if (msg) { msg.textContent = 'Vote saved!'; msg.classList.remove('hidden'); setTimeout(() => msg.classList.add('hidden'), 1800); }
      // Reload votes
      await loadPassportVotes(filmId, overlay);
    } catch (e) { alert(e.message || 'Failed to save vote'); }
  };
}

/* =================== Passport: Screenings Tab =================== */
async function loadPassportScreenings(filmId, overlay) {
  const container = overlay.querySelector('#pp-screenings-content');
  container.innerHTML = '<div class="notice">Loading…</div>';

  const filmSnap = await db.collection('films').doc(filmId).get();
  const f = { id: filmSnap.id, ...filmSnap.data() };
  const screenings = Array.isArray(f.screenings) ? f.screenings : [];

  const locSnap = await db.collection('locations').orderBy('name').get();
  const locs = locSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const locOptions = `<option value="">Select location…</option>` +
    locs.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('') +
    `<option value="__add">+ Add new location…</option>`;

  const fmtScreening = sc => {
    const parts = [];
    if (sc.dateISO) parts.push(sc.dateISO);
    if (sc.time) parts.push(sc.time);
    if (sc.locationName) parts.push(sc.locationName);
    return parts.join(' • ') || '—';
  };

  const screeningRows = screenings.length
    ? screenings.map((sc, idx) => `
        <div class="screening-row">
          <div class="screening-text">${escapeHtml(fmtScreening(sc))}</div>
          <button class="btn btn-ghost btn-sm" data-remove-screening="${idx}">Remove</button>
        </div>`).join('')
    : '<div class="notice">No screenings recorded yet.</div>';

  container.innerHTML = `
    <div class="passport-section-label">Existing Screenings</div>
    <div class="screening-list" id="pp-screening-list">${screeningRows}</div>

    <div class="passport-section-label" style="margin-top:16px">Add Screening</div>
    <div class="form-grid" style="margin-top:6px">
      <label>Location
        <select id="pp-sc-loc">${locOptions}</select>
      </label>
      <label>Date
        <input type="date" id="pp-sc-date">
      </label>
      <label>Time (optional)
        <input type="time" id="pp-sc-time">
      </label>
      <div class="actions" style="align-self:end">
        <button class="btn btn-primary" id="pp-add-screening">+ Add Screening</button>
      </div>
    </div>`;

  // Remove screening
  container.querySelectorAll('[data-remove-screening]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.removeScreening, 10);
      const cur = Array.isArray(f.screenings) ? f.screenings.slice() : [];
      cur.splice(idx, 1);
      await db.collection('films').doc(filmId).update({ screenings: cur });
      await refreshCalendarOnly();
      await loadPassportScreenings(filmId, overlay);
    });
  });

  // Location dropdown: handle "add new"
  container.querySelector('#pp-sc-loc')?.addEventListener('change', async e => {
    if (e.target.value === '__add') {
      const newLoc = await showAddLocationModal();
      if (newLoc) {
        await loadPassportScreenings(filmId, overlay);
      } else {
        e.target.value = '';
      }
    }
  });

  // Add screening
  container.querySelector('#pp-add-screening').onclick = async () => {
    const locSel = container.querySelector('#pp-sc-loc');
    const dateInp = container.querySelector('#pp-sc-date');
    const timeInp = container.querySelector('#pp-sc-time');
    const locId = locSel?.value || '';
    const dateISO = dateInp?.value || '';
    const time = timeInp?.value || '';

    if (!dateISO) { alert('Please add a date.'); return; }

    let locationName = '', locationAddress = '';
    if (locId && locId !== '__add') {
      const ld = await db.collection('locations').doc(locId).get();
      if (ld.exists) { locationName = ld.data().name || ''; locationAddress = ld.data().address || ''; }
    }

    const screening = {
      dateISO, time,
      locationId: (locId && locId !== '__add') ? locId : '',
      locationName, locationAddress,
    };

    const cur = Array.isArray(f.screenings) ? f.screenings.slice() : [];
    cur.push(screening);

    const ts = firebase.firestore.Timestamp.fromDate(new Date(dateISO + 'T00:00:00'));
    await db.collection('films').doc(filmId).update({
      screenings: cur,
      viewingDate: ts,
      viewingTime: time || '',
      viewingLocationId: screening.locationId || '',
      viewingLocationName: screening.locationName || '',
    });

    await refreshCalendarOnly();
    await loadPassportScreenings(filmId, overlay);
  };
}

/* =================== Passport: History Tab =================== */
async function loadPassportHistory(filmId, overlay) {
  const container = overlay.querySelector('#pp-history-content');
  container.innerHTML = '<div class="notice">Loading…</div>';
  let snap;
  try { snap = await db.collection('films').doc(filmId).collection('audit').orderBy('at', 'desc').limit(100).get(); }
  catch (e) { snap = await db.collection('films').doc(filmId).collection('audit').get(); }

  if (!snap.docs.length) { container.innerHTML = '<div class="notice">No history yet.</div>'; return; }

  const rows = snap.docs.map(d => {
    const a = d.data() || {};
    const at = a.at && typeof a.at.toDate === 'function' ? a.at.toDate().toLocaleString('en-GB') : '';
    const who = a.byName || a.byEmail || a.byUid || '';
    return `<div class="audit-row">
      <div><span class="badge">${escapeHtml(at)}</span> <span class="badge">${escapeHtml(a.action || '')}</span></div>
      <div class="audit-meta">${escapeHtml(who)}</div>
    </div>`;
  }).join('');

  container.innerHTML = `<div class="modal-scroll">${rows}</div>`;
}

/* =================== Status-specific list views =================== */
async function loadGreen() {
  const list = document.getElementById('green-list');
  list.innerHTML = '<div class="notice">Loading…</div>';
  const docs = await fetchByStatus('greenlist');
  list.innerHTML = '';
  if (!docs.length) { list.innerHTML = '<div class="notice">Green List is empty.</div>'; return; }
  docs.forEach(doc => {
    const f = { id: doc.id, ...doc.data() };
    const greenAt = f.greenAt && typeof f.greenAt.toDate === 'function' ? f.greenAt.toDate().toISOString().slice(0,10) : '—';
    list.insertAdjacentHTML('beforeend', simpleFilmCard(f, `<span class="badge badge-green">Green since: ${greenAt}</span>`));
  });
  attachPassportButtons(list);
}

async function loadNextProg() {
  const controls = document.getElementById('nextprog-controls');
  const list = document.getElementById('nextprog-list');
  list.innerHTML = '<div class="notice">Loading…</div>';
  const docs = await fetchByStatus('next_programme');

  controls.innerHTML = `
    <div class="form-grid" style="margin-bottom:12px;padding:12px;background:#f9fafb;border:1px dashed var(--border);border-radius:10px;">
      <label>Programme date
        <input type="date" id="programme-date">
      </label>
      <div class="actions" style="align-self:end;flex-wrap:wrap;">
        <button class="btn btn-primary" id="btn-archive-9">Archive first 9 (programme)</button>
        <button class="btn btn-danger" id="btn-archive-selected">Archive selected</button>
        <button class="btn btn-ghost" id="btn-select-first9">Select first 9</button>
        <button class="btn btn-ghost" id="btn-clear-select">Clear selection</button>
      </div>
      <div class="span-2 notice" style="margin-top:0">Select films and a programme date, then click Archive to create a Programme record.</div>
    </div>`;

  const getProgrammeDate = () => document.getElementById('programme-date')?.value || '';

  const archiveFilms = async (ids, dateISO) => {
    if (!ids.length) { alert('Select some films first.'); return; }
    if (!dateISO) { alert('Add a programme date first.'); return; }
    const progRef = await db.collection('programmes').add({
      dateISO, filmIds: ids,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: state.user?.uid || null,
    });
    const batch = db.batch();
    ids.forEach(id => batch.update(db.collection('films').doc(id), {
      status: 'archived', archivedFrom: 'next_programme',
      programmeId: progRef.id, programmeDate: dateISO,
      archivedAt: firebase.firestore.FieldValue.serverTimestamp()
    }));
    await batch.commit();
    for (const id of ids) await logAudit(id, 'archive_programme', { programmeId: progRef.id, programmeDate: dateISO });
    loadNextProg();
  };

  document.getElementById('btn-archive-9')?.addEventListener('click', () =>
    archiveFilms(docs.slice(0, 9).map(d => d.id), getProgrammeDate()));
  document.getElementById('btn-archive-selected')?.addEventListener('click', () => {
    const ids = Array.from(list.querySelectorAll('input[type="checkbox"][data-select-film]:checked')).map(cb => cb.dataset.selectFilm);
    archiveFilms(ids, getProgrammeDate());
  });
  document.getElementById('btn-select-first9')?.addEventListener('click', () => {
    const cbs = Array.from(list.querySelectorAll('input[type="checkbox"][data-select-film]'));
    cbs.forEach((cb, i) => cb.checked = i < 9);
  });
  document.getElementById('btn-clear-select')?.addEventListener('click', () => {
    list.querySelectorAll('input[type="checkbox"][data-select-film]').forEach(cb => cb.checked = false);
  });

  list.innerHTML = '';
  if (!docs.length) { list.innerHTML = '<div class="notice">No films in Next Programme.</div>'; return; }
  docs.forEach(doc => {
    const f = { id: doc.id, ...doc.data() };
    const greenAt = f.greenAt && typeof f.greenAt.toDate === 'function' ? f.greenAt.toDate().toISOString().slice(0,10) : '—';
    const extra = `
      <label class="badge" style="display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input type="checkbox" data-select-film="${f.id}"> Select
      </label>
      <span class="badge badge-green">Green since: ${greenAt}</span>`;
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
    const f = { id: doc.id, ...doc.data() };
    const reason = f.discardedReason ? `<div class="discard-reason">Reason: ${escapeHtml(f.discardedReason)}</div>` : '<div class="discard-reason notice" style="font-size:12px">No reason recorded — open Passport to add one.</div>';
    list.insertAdjacentHTML('beforeend', simpleFilmCard(f, reason));
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
    const f = { id: doc.id, ...doc.data() };
    const progDate = f.programmeDate ? `<span class="badge badge-muted">Programme: ${f.programmeDate}</span>` : '';
    list.insertAdjacentHTML('beforeend', simpleFilmCard(f, progDate));
  });
  attachPassportButtons(list);
}

function simpleFilmCard(f, extraHtml = '') {
  const year = f.year ? `(${f.year})` : '';
  const poster = f.posterUrl ? `<img alt="Poster" src="${escapeHtml(f.posterUrl)}" class="poster">` : '';
  return `
    <div class="film-row-card" data-film-card="${f.id}">
      <div class="film-row-poster">${poster}</div>
      <div class="film-row-info">
        <div class="film-row-title">${escapeHtml(f.title)} <span class="film-row-year">${year}</span></div>
        <div class="film-row-meta">
          ${f.genre ? `<span>${escapeHtml(f.genre)}</span>` : ''}
          ${f.language ? `<span>${escapeHtml(f.language)}</span>` : ''}
          ${f.runtimeMinutes ? `<span>${f.runtimeMinutes} min</span>` : ''}
        </div>
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
      const id = btn.dataset.openPassport;
      const doc = await db.collection('films').doc(id).get();
      if (doc.exists) openPassport({ id: doc.id, ...doc.data() });
    });
  });
}

/* =================== CSV Export =================== */
async function exportCsv(type) {
  const statusMap = { green: 'greenlist', nextprog: 'next_programme', archive: 'archived' };
  const status = statusMap[type];
  if (!status) return;

  const docs = await fetchByStatus(status);
  if (!docs.length) { alert('No films to export.'); return; }

  const safe = v => `"${String(v === null || v === undefined ? '' : v).replace(/"/g,'""')}"`;

  const headers = ['Title','Year','Runtime (min)','Language(s)','Country(ies)','Genre','Distributor','Rating','Where to See','Synopsis','Notes','Status'];
  const rows = [headers.join(',')];

  docs.forEach(doc => {
    const f = { id: doc.id, ...doc.data() };
    rows.push([
      safe(f.title), safe(f.year), safe(f.runtimeMinutes), safe(f.language),
      safe(f.country), safe(f.genre), safe(f.distributor), safe(f.ukAgeRating),
      safe(f.whereToSee), safe(f.synopsis), safe(f.notes), safe(humanStatus(f.status))
    ].join(','));
  });

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fleetfilm-${type}-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* =================== Calendar =================== */
async function loadCalendar() {
  const container = document.getElementById('calendar-container');
  container.innerHTML = `
    <div class="card" style="padding:14px">
      <div class="cal-head">
        <button class="btn btn-ghost" id="cal-prev">◀ Prev</button>
        <div class="cal-title" id="cal-title">Month YYYY</div>
        <button class="btn btn-ghost" id="cal-next">Next ▶</button>
      </div>
      <div class="cal-grid" id="cal-grid"></div>
    </div>`;

  document.getElementById('cal-prev').onclick = () => { calOffset -= 1; refreshCalendarOnly(); };
  document.getElementById('cal-next').onclick = () => { calOffset += 1; refreshCalendarOnly(); };
  await refreshCalendarOnly();
}

/* =================== Add Location Modal =================== */
async function fetchAddressesByPostcode(pc) {
  const norm = (pc || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!norm) return [];
  try {
    const params = new URLSearchParams({ q: norm, format: 'json', addressdetails: 1, countrycodes: 'gb', zoom: 18, limit: 50 });
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': 'FleetFilmApp/1.0' }
    });
    if (!r.ok) return [];
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return [];
    return data.map(item => {
      if (!item.address) return null;
      const addr = item.address;
      const house = addr.house_number || addr.building || '';
      const street = addr.road || addr.street || '';
      const town = addr.town || addr.city || addr.village || addr.suburb || '';
      const county = addr.county || addr.state || '';
      const postcode = addr.postcode ? addr.postcode.toUpperCase().replace(/\s+/g,'') : norm;
      const label = [house, street, town, county, postcode].filter(Boolean).join(', ');
      return { house, street, town, county, postcode, address: [house, street].filter(Boolean).join(' '), label };
    }).filter(a => a && (a.house || a.street));
  } catch (e) { return []; }
}

function showAddLocationModal(prefill = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-head">
          <h2>${prefill.id ? 'Edit location' : 'Add new location'}</h2>
          <button class="btn btn-ghost" id="loc-cancel">Cancel</button>
        </div>
        <div class="form-grid">
          <label class="span-2">Location Name (required)<input id="loc-name" type="text" placeholder="e.g. Church Hall" value="${escapeHtml(prefill.name||'')}"></label>
          <label>Postcode<input id="loc-postcode" type="text" placeholder="e.g. GU51 3RA" value="${escapeHtml(prefill.postcode||'')}"></label>
          <div class="actions"><button class="btn" id="loc-lookup">Lookup</button></div>
          <div class="span-2" id="loc-options"></div>
          <label>House / Name<input id="loc-house" type="text" value="${escapeHtml(prefill.house||'')}"></label>
          <label>Street<input id="loc-street" type="text" value="${escapeHtml(prefill.street||prefill.address||'')}"></label>
          <label>Town / City<input id="loc-town" type="text" value="${escapeHtml(prefill.town||prefill.city||'')}"></label>
          <label>County<input id="loc-county" type="text" value="${escapeHtml(prefill.county||'')}"></label>
          <div id="loc-msg" class="notice hidden span-2"></div>
          <div class="actions span-2">
            <div class="spacer"></div>
            <button class="btn btn-primary" id="loc-save">${prefill.id ? 'Save changes' : 'Save'}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const $ = sel => overlay.querySelector(sel);
    const close = res => { document.body.removeChild(overlay); resolve(res || null); };
    const toast = msg => { const m = $('#loc-msg'); m.textContent = msg; m.classList.remove('hidden'); setTimeout(() => m.classList.add('hidden'), 1800); };

    $('#loc-cancel').onclick = () => close(null);

    $('#loc-lookup').onclick = async () => {
      const pc = ($('#loc-postcode').value || '').trim();
      if (!pc) { toast('Enter a postcode first'); return; }
      const listEl = $('#loc-options');
      listEl.innerHTML = '<div class="notice">Searching…</div>';
      const results = await fetchAddressesByPostcode(pc);
      listEl.innerHTML = '';
      if (!results.length) { listEl.innerHTML = '<div class="notice">No results. Enter manually below.</div>'; return; }
      results.forEach((a, i) => {
        const b = document.createElement('button');
        b.className = 'btn btn-ghost'; b.type = 'button'; b.style.cssText = 'width:100%;text-align:left;margin-bottom:4px';
        b.textContent = a.label;
        b.onclick = () => {
          $('#loc-house').value = a.house || '';
          $('#loc-street').value = a.street || '';
          $('#loc-town').value = a.town || '';
          $('#loc-county').value = a.county || '';
          $('#loc-postcode').value = a.postcode || pc.toUpperCase();
          listEl.innerHTML = '';
        };
        listEl.appendChild(b);
      });
    };

    $('#loc-save').onclick = async () => {
      const name = ($('#loc-name').value || '').trim();
      if (!name) { toast('Location Name is required.'); return; }
      const house = ($('#loc-house').value || '').trim();
      const street = ($('#loc-street').value || '').trim();
      const town = ($('#loc-town').value || '').trim();
      const county = ($('#loc-county').value || '').trim();
      const postcode = ($('#loc-postcode').value || '').trim().toUpperCase();
      const addressCombined = [house, street].filter(Boolean).join(' ');
      try {
        if (prefill.id) {
          await db.collection('locations').doc(prefill.id).update({ name, address: addressCombined, postcode, city: town, house, street, town, county });
          close({ id: prefill.id, name });
        } else {
          const ref = await db.collection('locations').add({ name, address: addressCombined, postcode, city: town, house, street, town, county, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
          close({ id: ref.id, name });
        }
      } catch (e) { toast(e.message || 'Could not save'); }
    };
  });
}

/* =================== Addresses (admin) =================== */
async function loadAddresses() {
  const tbody = document.querySelector('#addresses-table tbody');
  const msg = document.getElementById('addresses-admin-msg');
  if (!tbody) return;

  tbody.innerHTML = '';
  const snap = await db.collection('locations').orderBy('name').get();

  if (snap.empty) {
    if (msg) { msg.textContent = 'No saved addresses yet.'; msg.classList.remove('hidden'); }
  } else {
    if (msg) msg.classList.add('hidden');
    snap.docs.forEach(d => {
      const l = { id: d.id, ...d.data() };
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Name">${escapeHtml(l.name||'')}</td>
        <td data-label="Address">${escapeHtml(l.address||'')}</td>
        <td data-label="Town/City">${escapeHtml(l.city||'')}</td>
        <td data-label="Postcode">${escapeHtml(l.postcode||'')}</td>
        <td data-label="Actions">
          <button class="btn btn-ghost" data-edit="${l.id}">Edit</button>
          <button class="btn btn-danger" data-del="${l.id}">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  tbody.onclick = async e => {
    const editBtn = e.target.closest('button[data-edit]');
    const delBtn  = e.target.closest('button[data-del]');
    if (editBtn) {
      const snap = await db.collection('locations').doc(editBtn.dataset.edit).get();
      const data = snap.exists ? snap.data() : {};
      await showAddLocationModal({ id: editBtn.dataset.edit, name: data.name||'', postcode: data.postcode||'', house: data.house||'', street: data.street||data.address||'', town: data.town||data.city||'', county: data.county||'' });
      loadAddresses();
    }
    if (delBtn) {
      if (confirm('Delete this address?')) {
        await db.collection('locations').doc(delBtn.dataset.del).delete();
        loadAddresses();
      }
    }
  };

  document.getElementById('addr-add').onclick = async () => { const c = await showAddLocationModal(); if (c) loadAddresses(); };
  document.getElementById('addr-refresh').onclick = loadAddresses;
}

/* =================== Boot =================== */
async function boot() {
  try { initFirebaseOnce(); }
  catch (e) { alert('Missing Firebase config.'); return; }

  try { await auth.getRedirectResult(); } catch (e) { console.warn('Redirect error:', e?.message); }

  attachHandlers();

  auth.onAuthStateChanged(async u => {
    state.user = u;
    if (!u) { showSignedIn(false); location.hash = 'submit'; return; }
    await ensureUserDoc(u);
    showSignedIn(true);
    routerFromHash();
  });
}

document.addEventListener('DOMContentLoaded', () => { boot().catch(err => console.error('[boot] error:', err)); });
