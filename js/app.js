/* Fleet Film App – streamlined flow
   Pipeline:
     intake -> review_basic -> viewing -> voting -> uk_check -> greenlist -> next_programme -> archived
   (Discarded can happen at many points.)
*/

let app, auth, db;

/* =================== DOM refs =================== */
const els = {
  signedOut: document.getElementById('signed-out'),
  signedIn: document.getElementById('signed-in'),
  nav: document.getElementById('nav'),
  signOut: document.getElementById('btn-signout'),

  // LIST CONTAINERS
  pendingList: document.getElementById('intake-list'), // reused id; shows "Pending Films"
  basicList: document.getElementById('basic-list'),
  viewingList: document.getElementById('viewing-list'),
  voteList: document.getElementById('vote-list'),
  ukList: document.getElementById('uk-list'),
  greenList: document.getElementById('green-list'),
  nextProgList: document.getElementById('nextprog-list'),
  discardedList: document.getElementById('discarded-list'),
  archiveList: document.getElementById('archive-list'),

  // VIEWS
  views: {
    pending:    document.getElementById('view-intake'),
    submit:     document.getElementById('view-submit'),
    basic:      document.getElementById('view-basic'),
    viewing:    document.getElementById('view-viewing'),
    vote:       document.getElementById('view-vote'),
    uk:         document.getElementById('view-uk'),
    green:      document.getElementById('view-green'),
    nextprog:   document.getElementById('view-nextprog'),
    discarded:  document.getElementById('view-discarded'),
    archive:    document.getElementById('view-archive'),
    calendar:   document.getElementById('view-calendar'),
  },

  // NAV BUTTONS
  navButtons: {
    submit:     document.getElementById('nav-submit'),
    pending:    document.getElementById('nav-intake'),
    basic:      document.getElementById('nav-basic'),
    viewing:    document.getElementById('nav-viewing'),
    vote:       document.getElementById('nav-vote'),
    uk:         document.getElementById('nav-uk'),
    green:      document.getElementById('nav-green'),
    nextprog:   document.getElementById('nav-nextprog'),
    discarded:  document.getElementById('nav-discarded'),
    archive:    document.getElementById('nav-archive'),
    calendar:   document.getElementById('nav-calendar'),
  },

  // SUBMIT
  title: document.getElementById('f-title'),
  year: document.getElementById('f-year'),
  submitBtn: document.getElementById('btn-submit-film'),
  submitMsg: document.getElementById('submit-msg'),

  // AUTH
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  googleBtn: document.getElementById('btn-google'),
  emailSignInBtn: document.getElementById('btn-email-signin'),
  emailCreateBtn: document.getElementById('btn-email-create'),
};

const state = { user: null, role: 'member' };

/* ========= Required fields for Basic ========= */
const REQUIRED_BASIC_FIELDS = [
  'runtimeMinutes',  // number; must be <= 150
  'language',        // string
  'ukAgeRating',     // string
  'genre',           // string
  'country'          // string
];

/* =================== Calendar (Monday-first) =================== */
let calOffset = 0; // months from "now" (0=current, -1=prev, +1=next)

function mondayIndex(jsDay){ return (jsDay + 6) % 7; } // JS: Sun=0..Sat=6 -> Mon=0..Sun=6
function monthLabel(year, month){
  return new Date(year, month, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

/** Build the calendar grid HTML (headers + padded days) using Monday as first day. */
function buildCalendarGridHTML(year, month, eventsByISO) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = mondayIndex(new Date(year, month, 1).getDay()); // 0..6 where 0=Mon
  const headers = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    .map(function(w){ return '<div class="cal-wd">'+w+'</div>'; }).join('');

  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<div class="cal-cell empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const items = eventsByISO[iso] || [];
    const pills = items.map(function(t){ return '<div class="cal-pill">'+t+'</div>'; }).join('');
    cells += '<div class="cal-cell"><div class="cal-day">'+d+'</div>'+pills+'</div>';
  }
  return headers + cells;
}

/** Render the calendar (title + grid) into the Calendar page. */
async function refreshCalendarOnly(){
  const titleEl = document.getElementById('cal-title');
  const gridEl  = document.getElementById('cal-grid');
  if(!titleEl || !gridEl) return;

  // Get all scheduled films (any status) with a viewingDate
  const snap = await db.collection('films').where('viewingDate','!=', null).get();
  const events = snap.docs.map(d=>({ id:d.id, ...d.data() })).filter(f=>f.viewingDate && typeof f.viewingDate.toDate === 'function');

  // Group by YYYY-MM-DD
  const byISO = {};
  events.forEach(function(ev){
    const d = ev.viewingDate.toDate();
    const iso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    const label =
      ev.title +
      (ev.viewingTime ? (' ' + ev.viewingTime) : '') +
      (ev.viewingLocationName ? (' • ' + ev.viewingLocationName) : '');
    if(!byISO[iso]) byISO[iso] = [];
    byISO[iso].push(label);
  });

  const now = new Date();
  const ref = new Date(now.getFullYear(), now.getMonth()+calOffset, 1);
  titleEl.textContent = monthLabel(ref.getFullYear(), ref.getMonth());
  gridEl.innerHTML = buildCalendarGridHTML(ref.getFullYear(), ref.getMonth(), byISO);
}


/* =================== Firebase =================== */
function initFirebase(){
  const cfg = window.__FLEETFILM__CONFIG;
  if(!cfg || !cfg.apiKey) {
    alert('Missing Firebase config. Edit js/firebase-config.js');
    throw new Error('Missing Firebase config');
  }
  app = firebase.initializeApp(cfg);
  auth = firebase.auth();
  db = firebase.firestore();
}

function setView(name){
  // Nav active state
  Object.values(els.navButtons).forEach(btn => btn && btn.classList.remove('active'));
  if(els.navButtons[name]) els.navButtons[name].classList.add('active');

  // Show/hide views
  Object.values(els.views).forEach(v => v && v.classList.add('hidden'));
  if(els.views[name]) els.views[name].classList.remove('hidden');

  // Route
  if(name==='pending')    return loadPending();
  if(name==='basic')      return loadBasic();
  if(name==='viewing')    return loadViewing();
  if(name==='vote')       return loadVote();
  if(name==='uk')         return loadUk();
  if(name==='green')      return loadGreen();
  if(name==='nextprog')   return loadNextProgramme();
  if(name==='discarded')  return loadDiscarded();
  if(name==='archive')    return loadArchive();
  if(name==='calendar')   return loadCalendar();
}

function routerFromHash(){
  const h = (location.hash.replace('#','') || 'submit');
  const map = { intake:'pending', approved:'green' }; // legacy -> new
  setView(map[h] || h);
}

function showSignedIn(on){
  els.signedIn.classList.toggle('hidden', !on);
  els.signedOut.classList.toggle('hidden', on);
  els.nav.classList.toggle('hidden', !on);
}

// Create a user doc if missing
async function ensureUserDoc(u){
  const ref = db.collection('users').doc(u.uid);
  const snap = await ref.get();
  if(!snap.exists){
    await ref.set({
      email: u.email || '',
      displayName: u.displayName || u.email || 'User',
      role: 'member',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  const roleSnap = await ref.get();
  const role = (roleSnap.exists && roleSnap.data() && roleSnap.data().role) || 'member';
  state.role = role;
}

function attachHandlers(){
  Object.values(els.navButtons).forEach(btn => {
    if(!btn) return;
    btn.addEventListener('click', () => { location.hash = btn.dataset.view; });
  });
  els.signOut.addEventListener('click', () => auth.signOut());
  els.submitBtn.addEventListener('click', submitFilm);

  // ---- Auth buttons (with safe Google fallback to redirect to avoid COOP/popup issues) ----
  if(els.googleBtn){
    els.googleBtn.addEventListener('click', async () => {
      try{
        await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
      }catch(err){
        console.warn('Popup sign-in failed, falling back to redirect:', err && err.message);
        await auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider());
      }
    });
  }
  if(els.emailSignInBtn){
    els.emailSignInBtn.addEventListener('click', async () => {
      try{ await auth.signInWithEmailAndPassword(els.email.value, els.password.value); }catch(e){ alert(e.message); }
    });
  }
  if(els.emailCreateBtn){
    els.emailCreateBtn.addEventListener('click', async () => {
      try{ await auth.createUserWithEmailAndPassword(els.email.value, els.password.value); }catch(e){ alert(e.message); }
    });
  }

  window.addEventListener('hashchange', routerFromHash);

  // mobile tabbar (if present)
  const mbar = document.getElementById('mobile-tabbar');
  if(mbar){
    mbar.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-view]');
      if(!btn) return;
      location.hash = btn.dataset.view;
    });
  }
}

/* =================== Filters (Pending) =================== */
const filterState = { q:'', status:'' };

function setupPendingFilters(){
  const q = document.getElementById('filter-q');
  const s = document.getElementById('filter-status');
  const clr = document.getElementById('filter-clear');
  if(q){ q.addEventListener('input', ()=>{ filterState.q = q.value.trim().toLowerCase(); loadPending(); }); }
  if(s){ s.addEventListener('change', ()=>{ filterState.status = s.value; loadPending(); }); }
  if(clr){ clr.addEventListener('click', ()=>{ filterState.q=''; filterState.status=''; if(q) q.value=''; if(s) s.value=''; loadPending(); }); }
}

/* =================== OMDb helpers =================== */
function getOmdbKey(){
  return (window.__FLEETFILM__CONFIG && window.__FLEETFILM__CONFIG.omdbApiKey) || '';
}

async function omdbSearch(title, year){
  const key = getOmdbKey();
  if(!key) return { Search: [] };
  const params = new URLSearchParams({ apikey: key, s: title, type: 'movie' });
  if(year) params.set('y', String(year));
  const url = 'https://www.omdbapi.com/?' + params.toString();
  const r = await fetch(url);
  if(!r.ok) return { Search: [] };
  const data = await r.json();
  return data || { Search: [] };
}

async function omdbDetailsById(imdbID){
  const key = getOmdbKey();
  if(!key) return null;
  const params = new URLSearchParams({ apikey: key, i: imdbID, plot: 'short' });
  const url = 'https://www.omdbapi.com/?' + params.toString();
  const r = await fetch(url);
  if(!r.ok) return null;
  const data = await r.json();
  return (data && data.Response === 'True') ? data : null;
}

function mapMpaaToUk(mpaa){
  if(!mpaa) return '';
  const s = String(mpaa).toUpperCase();
  if(s === 'G') return 'U';
  if(s === 'PG') return 'PG';
  if(s === 'PG-13') return '12A';
  if(s === 'R') return '15';
  if(s === 'NC-17') return '18';
  if(s.includes('NOT RATED') || s === 'N/A') return 'NR';
  return s;
}

/* =================== Picker (OMDb) =================== */
function showPicker(items){
  return new Promise(resolve=>{
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML =
      '<div class="modal-head">' +
        '<h2>Select the correct film</h2>' +
        '<div style="display:flex; gap:8px; align-items:center;">' +
          '<button id="ff-picker-manual" class="btn btn-ghost">Add manually</button>' +
          '<button id="ff-picker-cancel" class="btn btn-ghost">Cancel</button>' +
        '</div>' +
      '</div>' +
      '<div id="ff-picker-list" class="modal-list"></div>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const list = modal.querySelector('#ff-picker-list');
    if(!items || !items.length){
      list.innerHTML = '<div class="notice">No matches found. You can “Add manually”.</div>';
    }else{
      items.forEach(it=>{
        const poster = (it.Poster && it.Poster!=='N/A') ? it.Poster : '';
        const row = document.createElement('div');
        row.className = 'modal-row';
        row.innerHTML =
          (poster ? '<img src="'+poster+'" alt="poster" class="poster-small">' : '') +
          '<div class="modal-row-main">' +
            '<div class="modal-row-title">'+it.Title+' ('+it.Year+')</div>' +
            '<div class="modal-row-sub">'+(it.Type || 'movie')+' • '+it.imdbID+'</div>' +
          '</div>' +
          '<button data-id="'+it.imdbID+'" class="btn btn-primary">Select</button>';
        list.appendChild(row);
      });
    }

    modal.querySelector('#ff-picker-cancel').addEventListener('click', ()=>{
      document.body.removeChild(overlay);
      resolve({ mode:'cancel' });
    });
    modal.querySelector('#ff-picker-manual').addEventListener('click', ()=>{
      document.body.removeChild(overlay);
      resolve({ mode:'manual' });
    });
    list.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-id]');
      if(!btn) return;
      const id = btn.getAttribute('data-id');
      document.body.removeChild(overlay);
      resolve({ mode:'pick', imdbID:id });
    });
  });
}

/* =================== Submit (Title+Year; manual ok) =================== */
async function submitFilm(){
  const title = (els.title.value||'').trim();
  const yearStr = (els.year.value||'').trim();
  const year = parseInt(yearStr, 10);
  if(!title){ alert('Title required'); return; }
  if(!year || yearStr.length !== 4){ alert('Enter a 4-digit Year (e.g. 1994)'); return; }

  if(!state.user){
    alert('Please sign in first.');
    return;
  }

  let picked = null;
  try{
    const res = await omdbSearch(title, year);
    const candidates = (res && res.Search) ? res.Search.filter(x=>x.Type==='movie') : [];
    const choice = await showPicker(candidates);
    if(choice.mode === 'cancel'){ return; }
    if(choice.mode === 'manual'){ picked = null; }
    if(choice.mode === 'pick' && choice.imdbID){ picked = await omdbDetailsById(choice.imdbID); }
  }catch{
    const ok = confirm('Could not reach OMDb. Add the film manually?');
    if(!ok) return;
  }

  const base = {
    title, year,
    synopsis: '',
    status: 'intake',
    createdBy: state.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    runtimeMinutes: null,
    language: '',
    ageRating: '',
    ukAgeRating: '',
    genre: '',
    country: '',
    hasDisk: false,
    availability: '',
    criteria: { basic_pass: false },
    hasUkDistributor: null,
    distStatus: '',
    posterUrl: '',
    imdbID: '',
    // viewing scheduling
    viewingDate: null,            // Timestamp
    viewingTime: '',
    viewingLocationId: '',
    viewingLocationName: '',
    // green list timestamp
    greenAt: null
  };

  if(picked){
    let runtimeMinutes = null;
    if(picked.Runtime && /\d+/.test(picked.Runtime)){
      runtimeMinutes = parseInt(picked.Runtime.match(/\d+/)[0],10);
    }
    base.posterUrl = (picked.Poster && picked.Poster!=='N/A') ? picked.Poster : '';
    base.ageRating = picked.Rated && picked.Rated!=='N/A' ? picked.Rated : '';
    base.ukAgeRating = mapMpaaToUk(base.ageRating);
    base.genre = picked.Genre && picked.Genre!=='N/A' ? picked.Genre : '';
    base.language = picked.Language && picked.Language!=='N/A' ? picked.Language : '';
    base.country = picked.Country && picked.Country!=='N/A' ? picked.Country : '';
    base.imdbID = picked.imdbID || '';
    if(runtimeMinutes) base.runtimeMinutes = runtimeMinutes;
    if(picked.Plot && picked.Plot!=='N/A') base.synopsis = picked.Plot;
    if(picked.Title) base.title = picked.Title;
    if(picked.Year && /^\d{4}$/.test(picked.Year)) base.year = parseInt(picked.Year,10);
  }

  try{
    await db.collection('films').add(base);
    els.submitMsg.textContent = 'Added to Pending Films.';
    els.submitMsg.classList.remove('hidden');
    els.title.value=''; els.year.value='';
    setTimeout(()=>els.submitMsg.classList.add('hidden'), 1800);
    setView('pending');
  }catch(e){ alert(e.message); }
}

/* =================== Fetch helpers =================== */
async function fetchByStatus(status){
  const snap = await db.collection('films').where('status','==', status).get();
  const docs = snap.docs.sort((a, b) => {
    const ta = a.data().createdAt && typeof a.data().createdAt.toMillis === 'function' ? a.data().createdAt.toMillis() : 0;
    const tb = b.data().createdAt && typeof b.data().createdAt.toMillis === 'function' ? b.data().createdAt.toMillis() : 0;
    return tb - ta;
  });
  return docs;
}

/* =================== Rendering helpers =================== */

// Pending card: poster + title + actions only
function pendingCard(f, actionsHtml){
  const year = f.year ? '('+f.year+')' : '';
  const poster = f.posterUrl ? '<img alt="Poster" src="'+f.posterUrl+'" class="poster">' : '';
  return '<div class="card">' +
    '<div class="item">' +
      '<div class="item-left">' +
        poster +
        '<div class="item-title">'+f.title+' '+year+'</div>' +
      '</div>' +
      '<div class="item-right">'+(actionsHtml || '')+'</div>' +
    '</div>' +
  '</div>';
}

// Detailed card
function detailCard(f, actionsHtml){
  const year = f.year ? '('+f.year+')' : '';
  const poster = f.posterUrl ? '<img alt="Poster" src="'+f.posterUrl+'" class="poster">' : '';
  const kv = 
    '<div class="kv">' +
      '<div>Runtime:</div><div>' + (f.runtimeMinutes != null ? f.runtimeMinutes : '—') + ' min</div>' +
      '<div>Language:</div><div>' + (f.language || '—') + '</div>' +
      '<div>UK Age Rating:</div><div>' + (f.ukAgeRating || '—') + '</div>' +
      '<div>Genre:</div><div>' + (f.genre || '—') + '</div>' +
      '<div>Country:</div><div>' + (f.country || '—') + '</div>' +
      '<div>UK Distributor:</div><div>' + (f.hasUkDistributor===true?'Yes':(f.hasUkDistributor===false?'No':'—')) + '</div>' +
      '<div>Disk available:</div><div>' + (f.hasDisk ? 'Yes' : 'No') + '</div>' +
      '<div>Where to see:</div><div>' + (f.availability || '—') + '</div>' +
    '</div>';
  return '<div class="card detail-card">' +
    '<div class="item item--split">' +
      '<div class="item-left">' +
        poster +
        '<div>' +
          '<div class="item-title">'+f.title+' '+year+'</div>' +
          kv +
        '</div>' +
      '</div>' +
      '<div class="item-right">'+(actionsHtml || '')+'</div>' +
    '</div>' +
  '</div>';
}

/* =================== Pending Films =================== */
async function loadPending(){
  // IMPORTANT: Pending shows ONLY 'intake'
  const docs = await fetchByStatus('intake');

  let films = docs.map(d=>({ id:d.id, ...d.data() }));
  if(filterState.q){ films = films.filter(x => (x.title||'').toLowerCase().includes(filterState.q)); }

  els.pendingList.innerHTML = '';
  if(!films.length){ els.pendingList.innerHTML = '<div class="notice">Nothing pending.</div>'; return; }

  films.forEach(f=>{
    const actions = 
      '<button class="btn btn-primary" data-next="'+f.id+'">Basic Criteria</button>' +
      '<button class="btn btn-danger" data-act="to-discard" data-id="'+f.id+'">Discard</button>' +
      '<button class="btn" data-archive="'+f.id+'">Archive</button>';
    els.pendingList.insertAdjacentHTML('beforeend', pendingCard(f, actions));
  });

  // Move to Basic
  els.pendingList.querySelectorAll('button[data-next]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.next;
      const ref = db.collection('films').doc(id);
      await ref.update({ status:'review_basic' });
      loadPending(); // immediately disappear from pending
    });
  });

  // Discard from pending
  els.pendingList.querySelectorAll('button[data-discard]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.discard;
      await db.collection('films').doc(id).update({ status:'discarded' });
      loadPending();
    });
  });

  // Archive from pending
  els.pendingList.querySelectorAll('button[data-archive]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.archive;
      await db.collection('films').doc(id).update({ status:'archived', archivedFrom:'intake' });
      loadPending();
    });
  });

  // set up toolbar listeners once
  setupPendingFilters();
}

/* =================== BASIC =================== */
async function loadBasic(){
  const docs = await fetchByStatus('review_basic');
  els.basicList.innerHTML = '';
  if(!docs.length){ els.basicList.innerHTML = '<div class="notice">Nothing awaiting basic checks.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const form = 
      '<div class="form-grid">' +
        '<label>Runtime Minutes<input type="number" data-edit="runtimeMinutes" data-id="'+f.id+'" value="'+(f.runtimeMinutes ?? '')+'" /></label>' +
        '<label>Language<input type="text" data-edit="language" data-id="'+f.id+'" value="'+(f.language || '')+'" /></label>' +
        '<label>UK Age Rating<input type="text" data-edit="ukAgeRating" data-id="'+f.id+'" value="'+(f.ukAgeRating || '')+'" placeholder="U, PG, 12A, 12, 15, 18, NR" /></label>' +
        '<label>Genre<input type="text" data-edit="genre" data-id="'+f.id+'" value="'+(f.genre || '')+'" /></label>' +
        '<label>Country<input type="text" data-edit="country" data-id="'+f.id+'" value="'+(f.country || '')+'" /></label>' +
        '<label>Disk Available?' +
          '<select data-edit="hasDisk" data-id="'+f.id+'"><option value="false"'+(f.hasDisk?'':' selected')+'>No</option><option value="true"'+(f.hasDisk?' selected':'')+'>Yes</option></select>' +
        '</label>' +
        '<label>Where to see<input type="text" data-edit="availability" data-id="'+f.id+'" value="'+(f.availability || '')+'" placeholder="Apple TV, Netflix, DVD..." /></label>' +
        '<label class="span-2">Synopsis<textarea data-edit="synopsis" data-id="'+f.id+'" placeholder="Short description">'+(f.synopsis || '')+'</textarea></label>' +
        '<div class="actions span-2">' +
          '<button class="btn btn-primary" data-act="basic-validate" data-id="'+f.id+'">Validate + → Viewing</button>' +
          '<button class="btn btn-danger" data-act="to-discard" data-id="'+f.id}">Discard</button>' +
        '</div>' +
      '</div>';
    els.basicList.insertAdjacentHTML('beforeend', detailCard(f, form));
  });
  els.basicList.querySelectorAll('[data-edit]').forEach(inp=>{
    inp.addEventListener('change', async ()=>{
      const id = inp.dataset.id;
      let val = inp.value;
      const field = inp.dataset.edit;
      if(field==='runtimeMinutes') val = parseInt(val||'0',10) || null;
      if(field==='hasDisk') val = (val==='true');
      await db.collection('films').doc(id).update({ [field]: val });
    });
  });
  els.basicList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

/* =================== VIEWING (location + jump to calendar) =================== */
async function loadViewing(){
  els.viewingList.innerHTML = '';

  const docs = await fetchByStatus('viewing');
  if(!docs.length){
    els.viewingList.insertAdjacentHTML('beforeend','<div class="notice">Viewing queue is empty.</div>');
    return;
  }

  // Locations
  const locSnap = await db.collection('locations').orderBy('name').get();
  const locs = locSnap.docs.map(d=>({ id:d.id, ...(d.data()) }));

  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const dateISO = (f.viewingDate && typeof f.viewingDate.toDate === 'function')
      ? f.viewingDate.toDate().toISOString().slice(0,10)
      : '';
    let locOptions = '<option value="">Select location…</option>';
    locs.forEach(function(l){
      const sel = (f.viewingLocationId===l.id) ? ' selected' : '';
      locOptions += '<option value="'+l.id+'"'+sel+'>'+l.name+'</option>';
    });
    locOptions += '<option value="__add">+ Add new location…</option>';

    const actions =
      '<div class="form-grid">' +
        '<label>Location' +
          '<select data-edit="viewingLocationId" data-id="'+f.id+'">' +
            locOptions +
          '</select>' +
        '</label>' +
        '<label>Date (read-only here)' +
          '<input type="date" value="'+dateISO+'" disabled>' +
        '</label>' +
        '<div class="actions span-2" style="margin-top:4px">' +
          '<button class="btn btn-primary" data-act="set-datetime" data-id="'+f.id+'">Set date & time</button>' +
          '<button class="btn btn-ghost" data-act="to-voting" data-id="'+f.id+'">→ Voting</button>' +
          '<button class="btn btn-danger" data-act="to-discard" data-id="'+f.id+'">Discard</button>' +
        '</div>' +
      '</div>';
    els.viewingList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });

  // Handle location dropdown changes (including "Add new")
  els.viewingList.querySelectorAll('select[data-edit="viewingLocationId"]').forEach(sel=>{
    sel.addEventListener('change', async ()=>{
      const id = sel.dataset.id;
      const val = sel.value;

      if(val === '__add'){
        const newLoc = await showAddLocationModal();
        if(newLoc){
          await db.collection('films').doc(id).update({
            viewingLocationId: newLoc.id,
            viewingLocationName: newLoc.name || ''
          });
        }
        loadViewing();
        return;
      }

      if(!val){
        await db.collection('films').doc(id).update({
          viewingLocationId: '',
          viewingLocationName: ''
        });
        loadViewing();
        return;
      }

      const locDoc = await db.collection('locations').doc(val).get();
      const name = locDoc.exists ? (locDoc.data().name || '') : '';
      await db.collection('films').doc(id).update({
        viewingLocationId: val,
        viewingLocationName: name
      });
      loadViewing();
    });
  });

  // Buttons
  els.viewingList.querySelectorAll('button[data-act]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.id;
      const act = btn.dataset.act;

      if(act === 'set-datetime'){
        sessionStorage.setItem('scheduleTarget', id);
        location.hash = 'calendar';
        return;
      }
      await adminAction(act, id);
    });
  });
}

/* ---------- Add Location Modal (with postcode lookup) ---------- */
function showAddLocationModal(){
  return new Promise(resolve=>{
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML =
      '<div class="modal-head">' +
        '<h2>Add new location</h2>' +
        '<div style="display:flex; gap:8px">' +
          '<button class="btn btn-ghost" id="loc-cancel">Cancel</button>' +
        '</div>' +
      '</div>' +
      '<div class="form-grid">' +
        '<label class="span-2">Location Name' +
          '<input id="loc-name" type="text" placeholder="e.g. Church Hall">' +
        '</label>' +
        '<label class="span-2">Address' +
          '<input id="loc-addr" type="text" placeholder="Street, Town">' +
        '</label>' +
        '<label>Postcode' +
          '<input id="loc-postcode" type="text" placeholder="e.g. GU51 3XX">' +
        '</label>' +
        '<label>City' +
          '<input id="loc-city" type="text" placeholder="(optional)">' +
        '</label>' +
        '<div class="actions span-2">' +
          '<button class="btn btn-ghost" id="loc-lookup">Lookup postcode</button>' +
          '<div class="spacer"></div>' +
          '<button class="btn btn-primary" id="loc-save">Save</button>' +
        '</div>' +
        '<div id="loc-msg" class="notice hidden"></div>' +
      '</div>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = (result)=>{ document.body.removeChild(overlay); resolve(result); };

    modal.querySelector('#loc-cancel').addEventListener('click', ()=>close(null));
    modal.querySelector('#loc-lookup').addEventListener('click', async ()=>{
      const pc = (document.getElementById('loc-postcode').value || '').trim();
      if(!pc){ toast('Enter a postcode first'); return; }
      try{
        const r = await fetch('https://api.postcodes.io/postcodes/'+encodeURIComponent(pc));
        const data = await r.json();
        if(data && data.status===200){
          const res = data.result;
          document.getElementById('loc-city').value = res.admin_district || res.parish || res.region || '';
          toast('Found: '+res.country+(res.admin_district? ' • '+res.admin_district:''));
        }else{
          toast('No match for that postcode');
        }
      }catch{
        toast('Lookup failed (network)');
      }
    });

    modal.querySelector('#loc-save').addEventListener('click', async ()=>{
      const name = (document.getElementById('loc-name').value||'').trim();
      const address = (document.getElementById('loc-addr').value||'').trim();
      const postcode = (document.getElementById('loc-postcode').value||'').trim();
      const city = (document.getElementById('loc-city').value||'').trim();
      if(!name){ toast('Name required'); return; }
      try{
        const ref = await db.collection('locations').add({
          name, address, postcode, city,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        close({ id: ref.id, name });
      }catch(e){
        toast(e.message || 'Could not save');
      }
    });

    function toast(msg){
      const m = modal.querySelector('#loc-msg');
      m.textContent = msg;
      m.classList.remove('hidden');
      setTimeout(()=>m.classList.add('hidden'), 1800);
    }
  });
}

/* =================== CALENDAR PAGE =================== */
async function loadCalendar(){
  // If your calendar page doesn't already contain the header+grid markup,
  // build it now inside #calendar-list:
  const wrap = document.getElementById('calendar-list');
  if(wrap && !document.getElementById('cal-grid')){
    wrap.innerHTML =
      '<div class="card" id="calendar-card">' +
        '<div class="cal-head">' +
          '<button class="btn btn-ghost" id="cal-back" aria-label="Back">◀ Back</button>' +
          '<div class="cal-title" id="cal-title">Month YYYY</div>' +
          '<div>' +
            '<button class="btn btn-ghost" id="cal-prev" aria-label="Previous month">◀</button>' +
            '<button class="btn btn-ghost" id="cal-next" aria-label="Next month">▶</button>' +
          '</div>' +
        '</div>' +
        '<div class="cal-grid" id="cal-grid"></div>' +
        '<div class="hr"></div>' +
        '<div class="form-grid">' +
          '<label>Date<input id="cal-date" type="date"></label>' +
          '<label>Time (optional)<input id="cal-time" type="time"></label>' +
          '<label class="span-2">Location (read-only, set on Viewing)<input id="cal-loc" type="text" disabled></label>' +
          '<div class="actions span-2"><button class="btn btn-primary" id="cal-save">Save schedule</button></div>' +
        '</div>' +
      '</div>';
  }

  // render month grid
  await refreshCalendarOnly();

  // Back button
  const back = document.getElementById('cal-back');
  if(back){ back.onclick = ()=>{ location.hash = 'viewing'; }; }

  // Month nav
  const prev = document.getElementById('cal-prev');
  const next = document.getElementById('cal-next');
  if(prev) prev.onclick = ()=>{ calOffset -= 1; refreshCalendarOnly(); };
  if(next) next.onclick = ()=>{ calOffset += 1; refreshCalendarOnly(); };

  // Scheduling editor
  const filmId = sessionStorage.getItem('scheduleTarget');
  const dateInp = document.getElementById('cal-date');
  const timeInp = document.getElementById('cal-time');
  const locInp  = document.getElementById('cal-loc');
  const saveBtn = document.getElementById('cal-save');

  if(!filmId){
    if(saveBtn) saveBtn.disabled = true;
    return;
  }

  const snap = await db.collection('films').doc(filmId).get();
  if(snap.exists){
    const f = snap.data();
    if(f.viewingDate && typeof f.viewingDate.toDate === 'function'){
      dateInp.value = f.viewingDate.toDate().toISOString().slice(0,10);
    }
    if(f.viewingTime){ timeInp.value = f.viewingTime; }
    if(locInp) locInp.value = f.viewingLocationName || '';
  }

  if(saveBtn){
    saveBtn.onclick = async ()=>{
      const dateVal = dateInp.value;
      const timeVal = timeInp.value || '';
      if(!dateVal){ alert('Pick a date'); return; }
      const ts = firebase.firestore.Timestamp.fromDate(new Date(dateVal+'T00:00:00'));
      await db.collection('films').doc(filmId).update({
        viewingDate: ts,
        viewingTime: timeVal
      });
      await refreshCalendarOnly();
      sessionStorage.removeItem('scheduleTarget');
      location.hash = 'viewing';
    };
  }
}

/* =================== VOTING (4 YES to proceed; show who voted) =================== */
async function loadVote(){
  const docs = await fetchByStatus('voting');
  els.voteList.innerHTML='';
  if(!docs.length){ els.voteList.innerHTML = '<div class="notice">No films in Voting.</div>'; return; }
  const my = state.user && state.user.uid;

  const nameCache = {};

  for(const doc of docs){
    const f = { id: doc.id, ...doc.data() };
    const vs = await db.collection('films').doc(f.id).collection('votes').get();
    let yes=0, no=0;
    const voters = [];
    vs.forEach(v=>{
      const d = v.data(); const val = d.value;
      if(val===1) yes+=1;
      if(val===-1) no+=1;
      voters.push({ uid:v.id, value:val, at:d.createdAt });
    });

    const listVotes = await (async ()=>{
      if(!voters.length) return '';
      const parts = [];
      for(const v of voters){
        if(!nameCache[v.uid]){
          const u = await db.collection('users').doc(v.uid).get();
          nameCache[v.uid] = u.exists ? (u.data().displayName || u.data().email || v.uid) : v.uid;
        }
        const who = nameCache[v.uid];
        const what = v.value===1 ? 'Yes' : v.value===-1 ? 'No' : '—';
        parts.push('<span class="badge">'+who+': '+what+'</span>');
      }
      return parts.join(' ');
    })();

    let myVoteVal = 0;
    if(my){
      const vSnap = await db.collection('films').doc(f.id).collection('votes').doc(my).get();
      if(vSnap.exists) myVoteVal = vSnap.data().value || 0;
    }

    const actions =
      '<div class="actions" role="group" aria-label="Vote buttons">' +
        '<button class="btn btn-ghost" data-vote="1" data-id="'+f.id+'" aria-pressed="'+(myVoteVal===1)+'">👍 Yes</button>' +
        '<button class="btn btn-ghost" data-vote="-1" data-id="'+f.id+'" aria-pressed="'+(myVoteVal===-1)+'">👎 No</button>' +
      '</div>' +
      '<div class="badge">Yes: '+yes+'</div> <div class="badge">No: '+no+'</div>' +
      '<div style="margin-top:6px">'+listVotes+'</div>' +
      '<div class="actions" style="margin-top:8px">' +
        '<button class="btn" data-act="to-discard" data-id="'+f.id+'">Discard</button>' +
      '</div>';
    els.voteList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  }

  els.voteList.querySelectorAll('button[data-vote]').forEach(btn => {
    btn.addEventListener('click', () => castVote(btn.dataset.id, parseInt(btn.dataset.vote,10)));
  });
}

async function castVote(filmId, value){
  try{
    await db.collection('films').doc(filmId).collection('votes').doc(state.user.uid).set({
      value, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, {merge:true});
    await checkAutoOutcome(filmId);
    loadVote();
  }catch(e){ alert(e.message); }
}

async function checkAutoOutcome(filmId){
  const ref = db.collection('films').doc(filmId);
  const vs = await ref.collection('votes').get();
  let yes=0, no=0;
  vs.forEach(v=>{
    const val = v.data().value;
    if(val===1) yes+=1;
    if(val===-1) no+=1;
  });
  // New rule: 4 YES -> move to UK Distributor; 4 NO -> Discard
  if(yes>=4){
    await ref.update({ status:'uk_check' });
  } else if(no>=4){
    await ref.update({ status:'discarded' });
  }
}

/* =================== UK CHECK (after Voting) =================== */
async function loadUk(){
  const docs = await fetchByStatus('uk_check');
  els.ukList.innerHTML = '';
  if(!docs.length){ els.ukList.innerHTML = '<div class="notice">Nothing awaiting UK distributor check.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const actions =
      '<div class="actions">' +
        '<button class="btn btn-accent" data-act="uk-yes" data-id="'+f.id+'">Distributor Confirmed ✓</button>' +
        '<button class="btn btn-warn" data-act="uk-no" data-id="'+f.id+'">No Distributor</button>' +
      '</div>';
    els.ukList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });
  els.ukList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

/* =================== GREEN LIST =================== */
async function loadGreen(){
  const docs = await fetchByStatus('greenlist');
  els.greenList.innerHTML = '';
  if(!docs.length){ els.greenList.innerHTML = '<div class="notice">Green List is empty.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const greenAt = (f.greenAt && typeof f.greenAt.toDate === 'function') ? f.greenAt.toDate().toISOString().slice(0,10) : '—';
    const actions =
      '<div class="actions">' +
        '<span class="badge">Green since: '+greenAt+'</span>' +
        '<button class="btn btn-primary" data-act="to-nextprog" data-id="'+f.id+'">→ Next Programme</button>' +
        '<button class="btn" data-act="to-archive" data-id="'+f.id+'">Archive</button>' +
      '</div>';
    els.greenList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });
  els.greenList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

/* =================== NEXT PROGRAMME =================== */
async function loadNextProgramme(){
  const docs = await fetchByStatus('next_programme');
  els.nextProgList.innerHTML =
    '<div class="actions" style="margin-bottom:8px">' +
      '<button class="btn btn-danger" id="btn-archive-all">Archive all</button>' +
    '</div>';
  const ba = document.getElementById('btn-archive-all');
  if(ba) ba.addEventListener('click', archiveAllNextProg);

  if(!docs.length){
    els.nextProgList.insertAdjacentHTML('beforeend', '<div class="notice">No films in Next Programme.</div>');
    return;
  }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const greenAt = (f.greenAt && typeof f.greenAt.toDate === 'function') ? f.greenAt.toDate().toISOString().slice(0,10) : '—';
    const actions =
      '<div class="actions">' +
        '<span class="badge">Green since: '+greenAt+'</span>' +
        '<button class="btn" data-act="to-archive" data-id="'+f.id+'">Archive</button>' +
      '</div>';
    els.nextProgList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });
  els.nextProgList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

async function archiveAllNextProg(){
  const docs = await fetchByStatus('next_programme');
  const batch = db.batch();
  docs.forEach(d=>{
    const ref = db.collection('films').doc(d.id);
    batch.update(ref, { status:'archived', archivedFrom:'next_programme' });
  });
  await batch.commit();
  loadNextProgramme();
}

/* =================== DISCARDED =================== */
async function loadDiscarded(){
  const docs = await fetchByStatus('discarded');
  els.discardedList.innerHTML = '';
  if(!docs.length){ els.discardedList.innerHTML = '<div class="notice">Discard list is empty.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const actions =
      '<div class="actions">' +
        '<button class="btn btn-ghost" data-act="restore" data-id="'+f.id+'">Restore to Pending</button>' +
        '<button class="btn" data-act="to-archive" data-id="'+f.id+'">Archive</button>' +
      '</div>';
    els.discardedList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });
  els.discardedList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

/* =================== ARCHIVE =================== */
async function loadArchive(){
  const docs = await fetchByStatus('archived');
  els.archiveList.innerHTML = '';
  if(!docs.length){ els.archiveList.innerHTML = '<div class="notice">No archived films yet.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const origin = f.archivedFrom || '';
    const right = origin ? '<span class="badge">'+origin+'</span>' : '';
    els.archiveList.insertAdjacentHTML('beforeend', pendingCard(f, right));
  });
}

/* =================== Admin actions =================== */
async function adminAction(action, filmId){
  const ref = db.collection('films').doc(filmId);
  try{
    if(action==='to-discard') await ref.update({ status:'discarded' });
    if(action==='restore')    await ref.update({ status:'intake' });
    if(action==='to-voting')  await ref.update({ status:'voting' });

    // Basic validate
    if(action==='basic-validate'){
      const snap = await ref.get();
      const f = snap.data() || {};
      const okRuntime = (f.runtimeMinutes != null) && (f.runtimeMinutes <= 150);
      const missing = REQUIRED_BASIC_FIELDS.filter(k=>{
        const v = f[k];
        return v == null || (typeof v === 'string' && v.trim().length === 0);
      });
      if(!okRuntime){ alert('Runtime must be 150 min or less.'); return; }
      if(missing.length){ alert('Complete Basic fields: ' + missing.join(', ')); return; }
      await ref.update({ 'criteria.basic_pass': true, status:'viewing' });
    }

    // UK decisions
    if(action==='uk-yes'){ 
      await ref.update({ hasUkDistributor:true, status:'greenlist', greenAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
    if(action==='uk-no'){ 
      await ref.update({ hasUkDistributor:false, status:'discarded' });
    }

    // Green list move
    if(action==='to-nextprog'){ await ref.update({ status:'next_programme' }); }

    // Archive / provenance
    if(action==='to-archive'){
      const snap2 = await ref.get();
      const cur = (snap2.exists && snap2.data().status) || '';
      await ref.update({ status:'archived', archivedFrom: cur || '' });
    }

    routerFromHash();
  }catch(e){ alert(e.message); }
}

/* =================== Boot =================== */
function boot(){
  initFirebase();
  attachHandlers();
  auth.onAuthStateChanged(async (u) => {
    state.user = u;
    if(!u){
      showSignedIn(false);
      location.hash = 'submit';
      return;
    }
    await ensureUserDoc(u);
    showSignedIn(true);
    routerFromHash();
  });
}
document.addEventListener('DOMContentLoaded', boot);
