/* Fleet Film App (Film List has a single Next button; robust for old data; mobile-friendly)
   Pipeline:
     intake -> review_basic -> uk_check -> viewing -> voting -> approved / discarded -> archived

   Film List "Next" rules (exactly one button per film):
     (missing status) -> treat as "intake" => "Move to Basic Criteria"
     intake           -> "Move to Basic Criteria"         (status -> review_basic)
     review_basic     -> "Validate & Move to UK Check"    (runtime<=150 & language required; else sends you to Basic)
     uk_check         -> "Open UK Distributor Check"      (navigate to UK page)
     viewing          -> "Move to Voting"                 (status -> voting)
     voting           -> no "Next" (vote on Voting page)
     approved/discarded/archived -> never shown on Film List

   Notes:
     - Removed Firestore queries that needed composite indexes. We fetch all films and filter/sort client-side.
     - Old records missing fields won’t block the UI anymore.
*/

let app, auth, db;

const els = {
  signedOut: document.getElementById('signed-out'),
  signedIn: document.getElementById('signed-in'),
  nav: document.getElementById('nav'),
  signOut: document.getElementById('btn-signout'),
  // lists
  filmList: document.getElementById('intake-list'),      // Film List container
  basicList: document.getElementById('basic-list'),
  ukList: document.getElementById('uk-list'),
  viewingList: document.getElementById('viewing-list'),
  voteList: document.getElementById('vote-list'),
  approvedList: document.getElementById('approved-list'),
  discardedList: document.getElementById('discarded-list'),
  archiveList: document.getElementById('archive-list'),
  // views
  views: {
    intake: document.getElementById('view-intake'),       // Film List
    submit: document.getElementById('view-submit'),
    basic: document.getElementById('view-basic'),
    uk: document.getElementById('view-uk'),
    viewing: document.getElementById('view-viewing'),
    vote: document.getElementById('view-vote'),
    approved: document.getElementById('view-approved'),
    discarded: document.getElementById('view-discarded'),
    archive: document.getElementById('view-archive'),
  },
  // nav buttons (ensure your HTML has these, in this order)
  navButtons: {
    submit: document.getElementById('nav-submit'),
    intake: document.getElementById('nav-intake'),
    basic: document.getElementById('nav-basic'),
    uk: document.getElementById('nav-uk'),
    viewing: document.getElementById('nav-viewing'),
    vote: document.getElementById('nav-vote'),
    approved: document.getElementById('nav-approved'),
    discarded: document.getElementById('nav-discarded'),
    archive: document.getElementById('nav-archive'),
  },
  // submit form
  title: document.getElementById('f-title'),
  year: document.getElementById('f-year'),
  distributor: document.getElementById('f-distributor'),
  link: document.getElementById('f-link'),
  synopsis: document.getElementById('f-synopsis'),
  submitBtn: document.getElementById('btn-submit-film'),
  submitMsg: document.getElementById('submit-msg'),
  // auth
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  googleBtn: document.getElementById('btn-google'),
  emailSignInBtn: document.getElementById('btn-email-signin'),
  emailCreateBtn: document.getElementById('btn-email-create'),
};

const state = { user: null, role: 'member' };

/* ---------- Firebase ---------- */
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
  Object.values(els.navButtons).forEach(btn => btn && btn.classList.remove('active'));
  if(els.navButtons[name]) els.navButtons[name].classList.add('active');

  Object.values(els.views).forEach(v => v && v.classList.add('hidden'));
  if(els.views[name]) els.views[name].classList.remove('hidden');

  if(name==='intake') loadFilmList();  // Film List
  if(name==='basic') loadBasic();
  if(name==='uk') loadUk();
  if(name==='viewing') loadViewing();
  if(name==='vote') loadVote();
  if(name==='approved') loadApproved();
  if(name==='discarded') loadDiscarded();
  if(name==='archive') loadArchive();
}

function routerFromHash(){
  const h = location.hash.replace('#','') || 'submit';
  setView(h);
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
  const role = (await ref.get()).data().role || 'member';
  state.role = role;
}

function attachHandlers(){
  Object.values(els.navButtons).forEach(btn => {
    if(!btn) return;
    btn.addEventListener('click', () => { location.hash = btn.dataset.view; });
  });
  els.signOut.addEventListener('click', () => auth.signOut());
  els.submitBtn.addEventListener('click', submitFilm);
  els.googleBtn?.addEventListener('click', async () => {
    try{ await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }catch(e){ alert(e.message); }
  });
  els.emailSignInBtn?.addEventListener('click', async () => {
    try{ await auth.signInWithEmailAndPassword(els.email.value, els.password.value); }catch(e){ alert(e.message); }
  });
  els.emailCreateBtn?.addEventListener('click', async () => {
    try{ await auth.createUserWithEmailAndPassword(els.email.value, els.password.value); }catch(e){ alert(e.message); }
  });
  window.addEventListener('hashchange', routerFromHash);
}

/* ---------- OMDb helpers ---------- */
function getOmdbKey(){
  return (window.__FLEETFILM__CONFIG && window.__FLEETFILM__CONFIG.omdbApiKey) || '';
}

async function omdbSearch(title, year){
  const key = getOmdbKey();
  if(!key) return { Search: [] };
  const params = new URLSearchParams({ apikey: key, s: title, type: 'movie' });
  if(year) params.set('y', String(year));
  const url = `https://www.omdbapi.com/?${params.toString()}`;
  const r = await fetch(url);
  if(!r.ok) return { Search: [] };
  const data = await r.json();
  return data || { Search: [] };
}

async function omdbDetailsById(imdbID){
  const key = getOmdbKey();
  if(!key) return null;
  const params = new URLSearchParams({ apikey: key, i: imdbID, plot: 'short' });
  const url = `https://www.omdbapi.com/?${params.toString()}`;
  const r = await fetch(url);
  if(!r.ok) return null;
  const data = await r.json();
  return (data && data.Response === 'True') ? data : null;
}

function mapMpaaToUk(mpaa){
  if(!mpaa) return '';
  const s = mpaa.toUpperCase();
  if(s === 'G') return 'U';
  if(s === 'PG') return 'PG';
  if(s === 'PG-13') return '12A';
  if(s === 'R') return '15';
  if(s === 'NC-17') return '18';
  if(s.includes('NOT RATED') || s === 'N/A') return 'NR';
  return s;
}

/* ---------- Submit (Title+Year + picker) ---------- */
function showPicker(items){
  return new Promise(resolve=>{
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-head">
        <h2>Select the correct film</h2>
        <button id="ff-picker-cancel" class="btn btn-ghost">Cancel</button>
      </div>
      <div id="ff-picker-list" class="modal-list"></div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const list = modal.querySelector('#ff-picker-list');
    if(!items || !items.length){
      list.innerHTML = `<div class="notice">No matches found. Check the title/year and try again.</div>`;
    }else{
      items.forEach(it=>{
        const poster = (it.Poster && it.Poster!=='N/A') ? it.Poster : '';
        const row = document.createElement('div');
        row.className = 'modal-row';
        row.innerHTML = `
          ${poster ? `<img src="${poster}" alt="poster" class="poster-small">` : ''}
          <div class="modal-row-main">
            <div class="modal-row-title">${it.Title} (${it.Year})</div>
            <div class="modal-row-sub">${it.Type || 'movie'} • ${it.imdbID}</div>
          </div>
          <button data-id="${it.imdbID}" class="btn btn-primary">Select</button>
        `;
        list.appendChild(row);
      });
    }

    modal.querySelector('#ff-picker-cancel').addEventListener('click', ()=>{
      document.body.removeChild(overlay);
      resolve(null);
    });
    list.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-id]');
      if(!btn) return;
      const id = btn.getAttribute('data-id');
      document.body.removeChild(overlay);
      resolve(id);
    });
  });
}

async function submitFilm(){
  const title = (els.title.value||'').trim();
  const yearStr = (els.year.value||'').trim();
  const year = parseInt(yearStr, 10);

  if(!title){ alert('Title required'); return; }
  if(!year || yearStr.length !== 4){ alert('Enter a 4-digit Year (e.g. 1994)'); return; }

  let picked = null;
  try{
    const res = await omdbSearch(title, year);
    const candidates = (res && res.Search) ? res.Search.filter(x=>x.Type==='movie') : [];
    const imdbID = await showPicker(candidates);
    if(!imdbID){
      alert('Selection cancelled. Film not added.');
      return;
    }
    picked = await omdbDetailsById(imdbID);
  }catch(e){
    console.warn('OMDb lookup failed', e);
  }

  const base = {
    title,
    year: year,
    distributor: (els.distributor.value||'').trim(),
    link: (els.link.value||'').trim(),
    synopsis: (els.synopsis.value||'').trim(),
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
    criteria: { basic_pass: false, screen_program_pass: false },
    hasUkDistributor: null,
    posterUrl: '',
    imdbID: ''
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
    if(!base.synopsis && picked.Plot && picked.Plot!=='N/A') base.synopsis = picked.Plot;
    if(picked.Title) base.title = picked.Title;
    if(picked.Year && /^\d{4}$/.test(picked.Year)) base.year = parseInt(picked.Year,10);
  }

  try{
    await db.collection('films').add(base);
    els.submitMsg.textContent = 'Added to Film List.';
    els.submitMsg.classList.remove('hidden');
    els.title.value=''; els.year.value=''; els.distributor.value=''; els.link.value=''; els.synopsis.value='';
    setTimeout(()=>els.submitMsg.classList.add('hidden'), 2200);
    setView('intake');
  }catch(e){ alert(e.message); }
}

/* ---------- Fetch helpers (no composite indexes) ---------- */
async function fetchAllFilms(){
  const snap = await db.collection('films').get();
  const docs = snap.docs.sort((a, b) => {
    const ta = a.data().createdAt?.toMillis?.() || 0;
    const tb = b.data().createdAt?.toMillis?.() || 0;
    return tb - ta;
  });
  return docs;
}
async function fetchByStatus(status){
  const all = await fetchAllFilms();
  return all.filter(d => (d.data().status || 'intake') === status);
}

/* ---------- Rendering helpers ---------- */
function filmListCard(f, nextHtml=''){
  const year = f.year ? `(${f.year})` : '';
  const poster = f.posterUrl ? `<img alt="Poster" src="${f.posterUrl}" class="poster">` : '';
  return `<div class="card">
    <div class="item">
      <div class="item-left">
        ${poster}
        <div class="item-title">${f.title} ${year}</div>
      </div>
      <div class="item-right">${nextHtml}</div>
    </div>
  </div>`;
}

function detailCard(f, actionsHtml=''){
  const year = f.year ? `(${f.year})` : '';
  const poster = f.posterUrl ? `<img alt="Poster" src="${f.posterUrl}" class="poster">` : '';
  return `<div class="card">
    <div class="item">
      <div class="item-left">
        ${poster}
        <div>
          <div class="item-title">${f.title} ${year}</div>
          <div class="kv">
            <div>Runtime:</div><div>${f.runtimeMinutes ?? '—'} min</div>
            <div>Language:</div><div>${f.language || '—'}</div>
            <div>UK Age Rating:</div><div>${f.ukAgeRating || '—'}</div>
            <div>Genre:</div><div>${f.genre || '—'}</div>
            <div>Country:</div><div>${f.country || '—'}</div>
            <div>UK Distributor:</div><div>${f.hasUkDistributor===true?'Yes':f.hasUkDistributor===false?'No':'—'}</div>
            <div>Disk available:</div><div>${f.hasDisk ? 'Yes' : 'No'}</div>
            <div>Where to see:</div><div>${f.availability || '—'}</div>
          </div>
        </div>
      </div>
      <div class="item-right">${actionsHtml}</div>
    </div>
  </div>`;
}

/* ---------- Film List (single Next action; robust defaults) ---------- */
function normalizeStatus(s){
  // Treat missing/empty as 'intake'
  if(!s || typeof s !== 'string') return 'intake';
  return s;
}
function nextActionFor(f){
  const status = normalizeStatus(f.status);
  switch(status){
    case 'intake':
      return { label: 'Move to Basic Criteria', type: 'update', handler: async (ref)=>{ await ref.update({ status:'review_basic' }); } };
    case 'review_basic':
      return { label: 'Validate & Move to UK Check', type: 'update', handler: async (ref)=>{
        const snap = await ref.get();
        const x = snap.data() || {};
        const okRuntime = (x.runtimeMinutes != null) && (x.runtimeMinutes <= 150);
        const okLang = (x.language || '').trim().length > 0;
        if(!okRuntime || !okLang){
          alert('Fill in Basic: runtime ≤ 150 and language required.');
          location.hash = 'basic';
          return;
        }
        await ref.update({ 'criteria.basic_pass': true, status:'uk_check' });
      }};
    case 'uk_check':
      return { label: 'Open UK Distributor Check', type: 'nav', handler: ()=>{ location.hash = 'uk'; } };
    case 'viewing':
      return { label: 'Move to Voting', type: 'update', handler: async (ref)=>{ await ref.update({ status:'voting' }); } };
    case 'voting':
      return null; // vote on Voting page
    default:
      return null; // approved/discarded/archived never listed here
  }
}

async function loadFilmList(){
  const all = await fetchAllFilms();
  const docs = all.filter(d=>{
    const st = normalizeStatus(d.data().status);
    return !['approved','discarded','archived'].includes(st);
  });

  els.filmList.innerHTML = '';
  if(!docs.length){
    els.filmList.innerHTML = '<div class="notice">Empty. Use Submit to add a film.</div>';
    return;
  }

  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const act = nextActionFor(f);
    const right = act ? `<button class="btn btn-primary" data-next="${f.id}">${act.label}</button>` : '';
    els.filmList.insertAdjacentHTML('beforeend', filmListCard(f, right));
  });

  els.filmList.querySelectorAll('button[data-next]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-next');
      const ref = db.collection('films').doc(id);
      const snap = await ref.get();
      if(!snap.exists) return;
      const f = snap.data() || {};
      const act = nextActionFor(f);
      if(!act) return;
      try{
        if(act.type==='update'){ await act.handler(ref); }
        if(act.type==='nav'){ act.handler(); }
        routerFromHash();
      }catch(e){ alert(e.message); }
    });
  });
}

/* ---------- BASIC ---------- */
async function loadBasic(){
  const docs = await fetchByStatus('review_basic');
  els.basicList.innerHTML = '';
  if(!docs.length){ els.basicList.innerHTML = '<div class="notice">Nothing awaiting basic checks.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const form = `
      <div class="form-grid">
        <label>Runtime Minutes<input type="number" data-edit="runtimeMinutes" data-id="${f.id}" value="${f.runtimeMinutes ?? ''}" /></label>
        <label>Language<input type="text" data-edit="language" data-id="${f.id}" value="${f.language || ''}" /></label>
        <label>UK Age Rating<input type="text" data-edit="ukAgeRating" data-id="${f.id}" value="${f.ukAgeRating || ''}" placeholder="U, PG, 12A, 12, 15, 18, R18, NR" /></label>
        <label>Genre<input type="text" data-edit="genre" data-id="${f.id}" value="${f.genre || ''}" /></label>
        <label>Country<input type="text" data-edit="country" data-id="${f.id}" value="${f.country || ''}" /></label>
        <label>Disk Available?
          <select data-edit="hasDisk" data-id="${f.id}"><option value="false"${f.hasDisk?'':' selected'}>No</option><option value="true"${f.hasDisk?' selected':''}>Yes</option></select>
        </label>
        <label>Where to see<input type="text" data-edit="availability" data-id="${f.id}" value="${f.availability || ''}" placeholder="Apple TV, Netflix, DVD..." /></label>
        <label class="span-2">Synopsis<textarea data-edit="synopsis" data-id="${f.id}" placeholder="Short description">${f.synopsis || ''}</textarea></label>
        <div class="actions span-2">
          <button class="btn btn-primary" data-act="basic-validate" data-id="${f.id}">Validate + → UK Check</button>
          <button class="btn btn-danger" data-act="to-discard" data-id="${f.id}">Discard</button>
        </div>
      </div>
    `;
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

/* ---------- UK CHECK ---------- */
async function loadUk(){
  const docs = await fetchByStatus('uk_check');
  els.ukList.innerHTML = '';
  if(!docs.length){ els.ukList.innerHTML = '<div class="notice">Nothing awaiting UK distributor check.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const actions = `
      <div class="actions">
        <button class="btn btn-accent" data-act="uk-yes" data-id="${f.id}">Distributor ✓</button>
        <button class="btn btn-warn" data-act="uk-no" data-id="${f.id}">No Distributor</button>
      </div>
    `;
    els.ukList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });
  els.ukList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

/* ---------- VIEWING ---------- */
async function loadViewing(){
  const docs = await fetchByStatus('viewing');
  els.viewingList.innerHTML = '';
  if(!docs.length){ els.viewingList.innerHTML = '<div class="notice">Viewing queue is empty.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const actions = `
      <div class="actions">
        <button class="btn btn-primary" data-act="to-voting" data-id="${f.id}">→ Voting</button>
        <button class="btn btn-danger" data-act="to-discard" data-id="${f.id}">Discard</button>
      </div>
    `;
    els.viewingList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });
  els.viewingList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

/* ---------- VOTING (Yes before No) ---------- */
async function loadVote(){
  const docs = await fetchByStatus('voting');
  els.voteList.innerHTML='';
  if(!docs.length){ els.voteList.innerHTML = '<div class="notice">No films in Voting.</div>'; return; }
  const my = state.user.uid;
  for(const doc of docs){
    const f = { id: doc.id, ...doc.data() };
    const vs = await db.collection('films').doc(f.id).collection('votes').get();
    let yes=0, no=0;
    vs.forEach(v=>{
      const val = v.data().value;
      if(val===1) yes+=1;
      if(val===-1) no+=1;
    });
    let myVoteVal = 0;
    const vSnap = await db.collection('films').doc(f.id).collection('votes').doc(my).get();
    if(vSnap.exists) myVoteVal = vSnap.data().value || 0;

    const actions = `<div class="actions" role="group" aria-label="Vote buttons">
      <button class="btn btn-ghost" data-vote="1" data-id="${f.id}" aria-pressed="${myVoteVal===1}">👍 Yes</button>
      <button class="btn btn-ghost" data-vote="-1" data-id="${f.id}" aria-pressed="${myVoteVal===-1}">👎 No</button>
    </div>
    <div class="badge">Yes: ${yes}</div> <div class="badge">No: ${no}</div>`;
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
    // TEST setting: 1 yes -> approved, 1 no -> discarded
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
  if(yes>=1){
    await ref.update({ status:'approved' });
  } else if(no>=1){
    await ref.update({ status:'discarded' });
  }
}

/* ---------- APPROVED (Export + Archive) ---------- */
async function loadApproved(){
  const docs = await fetchByStatus('approved');
  els.approvedList.innerHTML = `
    <div class="actions" style="margin-bottom:12px;">
      <button class="btn btn-primary" id="btn-export-approved">Export CSV</button>
    </div>
  `;
  document.getElementById('btn-export-approved').addEventListener('click', exportApprovedCSV);

  if(!docs.length){
    els.approvedList.insertAdjacentHTML('beforeend','<div class="notice">No approved films yet.</div>');
    return;
  }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const actions = `
      <div class="actions">
        <button class="btn btn-ghost" data-act="to-voting" data-id="${f.id}">Send back to Voting</button>
        <button class="btn btn-danger" data-act="to-discard" data-id="${f.id}">Discard</button>
        <button class="btn" data-act="to-archive" data-id="${f.id}">Archive</button>
      </div>`;
    els.approvedList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });
  els.approvedList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

function csvEscape(v){
  if(v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

async function exportApprovedCSV(){
  const docs = await fetchByStatus('approved');
  const headers = [
    'title','year','UK Distributor?','link','synopsis',
    'runtimeMinutes','language','ukAgeRating','genre','country',
    'hasDisk','availability','posterUrl','imdbID','createdAt'
  ];
  const rows = [headers.join(',')];
  docs.forEach(d=>{
    const f = d.data();
    const createdAt = f.createdAt?.toDate?.() ? f.createdAt.toDate().toISOString() : '';
    const line = [
      f.title || '',
      f.year || '',
      (f.hasUkDistributor===true?'Yes':f.hasUkDistributor===false?'No':''), // Yes/No
      f.link || '',
      f.synopsis || '',
      f.runtimeMinutes ?? '',
      f.language || '',
      f.ukAgeRating || '',
      f.genre || '',
      f.country || '',
      f.hasDisk ? 'Yes' : 'No',
      f.availability || '',
      f.posterUrl || '',
      f.imdbID || '',
      createdAt
    ].map(csvEscape).join(',');
    rows.push(line);
  });
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `approved_films_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- DISCARDED (Restore + Archive) ---------- */
async function loadDiscarded(){
  const docs = await fetchByStatus('discarded');
  els.discardedList.innerHTML = '';
  if(!docs.length){ els.discardedList.innerHTML = '<div class="notice">Discard list is empty.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const actions = `
      <div class="actions">
        <button class="btn btn-ghost" data-act="restore" data-id="${f.id}">Restore to Film List</button>
        <button class="btn" data-act="to-archive" data-id="${f.id}">Archive</button>
      </div>`;
    els.discardedList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });
  els.discardedList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

/* ---------- ARCHIVE ---------- */
async function loadArchive(){
  const docs = await fetchByStatus('archived');
  els.archiveList.innerHTML = '';
  if(!docs.length){ els.archiveList.innerHTML = '<div class="notice">No archived films yet.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const origin = f.archivedFrom === 'approved' ? 'Approved' : (f.archivedFrom === 'discarded' ? 'Discarded' : '');
    const right = origin ? `<span class="badge">${origin}</span>` : '';
    els.archiveList.insertAdjacentHTML('beforeend', filmListCard(f, right));
  });
}

/* ---------- Admin actions ---------- */
async function adminAction(action, filmId){
  const ref = db.collection('films').doc(filmId);
  try{
    if(action==='basic-validate'){
      const snap = await ref.get();
      const f = snap.data() || {};
      const okRuntime = (f.runtimeMinutes != null) && (f.runtimeMinutes <= 150);
      const okLang = (f.language || '').trim().length > 0;
      if(!okRuntime){ alert('Runtime must be 2h30 (150 min) or less.'); return; }
      if(!okLang){ alert('Please capture Language.'); return; }
      await ref.update({ 'criteria.basic_pass': true, status:'uk_check' });
    }
    if(action==='uk-yes') await ref.update({ hasUkDistributor:true, status:'viewing' });
    if(action==='uk-no') await ref.update({ hasUkDistributor:false, status:'discarded' });
    if(action==='to-voting') await ref.update({ status:'voting' });
    if(action==='to-discard') await ref.update({ status:'discarded' });
    if(action==='restore') await ref.update({ status:'intake' });
    if(action==='to-archive'){
      const snap = await ref.get();
      const current = (snap.exists && snap.data().status) || '';
      const origin = (current === 'approved' || current === 'discarded') ? current : '';
      await ref.update({ status:'archived', archivedFrom: origin });
    }
    routerFromHash();
  }catch(e){ alert(e.message); }
}

/* ---------- Boot ---------- */
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
