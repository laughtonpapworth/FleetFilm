/* Fleet Film App (Archive + UK rating + CSV fix + cleaner UI)
   Pipeline:
     intake -> review_basic -> uk_check -> viewing -> voting -> approved / discarded -> archived

   Testing rules (unchanged):
     - Voting: Yes/No only; auto-approve on first Yes; auto-discard on first No.

   New:
     - Archive status with archivedFrom ('approved'|'discarded'); Archive page + buttons on Approved/Discarded.
     - Export CSV: column "UK Distributor?" outputs Yes/No from hasUkDistributor.
     - UK Age Rating: auto-map from OMDb's MPAA to UK; stored as ukAgeRating; editable in Basic.
     - Remove noisy status badges from cards; Film List shows a small step label instead.
     - Voting UI: Yes before No.
     - Film List shows every film NOT in approved/discarded/archived, with the step label.
*/

let app, auth, db;

const els = {
  signedOut: document.getElementById('signed-out'),
  signedIn: document.getElementById('signed-in'),
  nav: document.getElementById('nav'),
  signOut: document.getElementById('btn-signout'),
  // lists
  filmList: document.getElementById('intake-list'),      // now the Film List area
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
  // nav buttons
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
  // auth inputs
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
  const h = location.hash.replace('#','') || 'submit'; // start on Submit
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
  els.googleBtn.addEventListener('click', async () => {
    try{ await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }catch(e){ alert(e.message); }
  });
  els.emailSignInBtn.addEventListener('click', async () => {
    try{ await auth.signInWithEmailAndPassword(els.email.value, els.password.value); }catch(e){ alert(e.message); }
  });
  els.emailCreateBtn.addEventListener('click', async () => {
    try{ await auth.createUserWithEmailAndPassword(els.email.value, els.password.value); }catch(e){ alert(e.message); }
  });
  window.addEventListener('hashchange', routerFromHash);
}

/* ---------- OMDb helpers (search + details + picker) ---------- */
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

/* ---------- UK rating mapping (best-effort) ---------- */
function mapMpaaToUk(mpaa){
  if(!mpaa) return '';
  const s = mpaa.toUpperCase();
  // rough mapping; editable later
  if(s === 'G') return 'U';
  if(s === 'PG') return 'PG';
  if(s === 'PG-13') return '12A';
  if(s === 'R') return '15';
  if(s === 'NC-17') return '18';
  if(s.includes('NOT RATED') || s === 'N/A') return 'NR';
  return s; // fallback as-is
}

/* ---------- Submit (Title+Year required, OMDb picker) ---------- */
function showPicker(items){
  return new Promise(resolve=>{
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:9999;
      display:flex; align-items:center; justify-content:center; padding:24px;
    `;
    const modal = document.createElement('div');
    modal.style.cssText = `
      background:#fff; max-width:800px; width:100%; max-height:80vh; overflow:auto;
      border-radius:12px; padding:16px; box-shadow:0 10px 30px rgba(0,0,0,.3);
      font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    `;
    modal.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h2 style="margin:0;font-size:18px;">Select the correct film</h2>
        <button id="ff-picker-cancel" class="btn btn-ghost">Cancel</button>
      </div>
      <div id="ff-picker-list" style="display:grid; grid-template-columns:1fr; gap:8px;"></div>
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
        row.style.cssText = `display:flex; align-items:center; gap:12px; border:1px solid #eee; border-radius:10px; padding:8px;`;
        row.innerHTML = `
          ${poster ? `<img src="${poster}" alt="poster" style="width:60px;height:88px;object-fit:cover;border-radius:6px;">` : ''}
          <div style="flex:1;">
            <div style="font-weight:600;">${it.Title} (${it.Year})</div>
            <div style="font-size:12px;opacity:.7;">${it.Type || 'movie'} • ${it.imdbID}</div>
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
    synopsis: (els.synopsis.value||'').trim(), // editable
    status: 'intake',
    createdBy: state.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    runtimeMinutes: null,
    language: '',
    ageRating: '',     // keep original MPAA if you want, but we’ll use ukAgeRating for UK view
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

/* ---------- Fetch helpers (index-free) ---------- */
async function fetchByStatus(status){
  const snap = await db.collection('films').where('status','==', status).get();
  const docs = snap.docs.sort((a, b) => {
    const ta = a.data().createdAt?.toMillis?.() || 0;
    const tb = b.data().createdAt?.toMillis?.() || 0;
    return tb - ta;
  });
  return docs;
}

async function fetchNotInStatuses(statuses){
  // Firestore supports "not-in" on a single field (max 10 values)
  const snap = await db.collection('films').where('status','not-in', statuses).get();
  const docs = snap.docs.sort((a, b) => {
    const ta = a.data().createdAt?.toMillis?.() || 0;
    const tb = b.data().createdAt?.toMillis?.() || 0;
    return tb - ta;
  });
  return docs;
}

/* ---------- Rendering helpers ---------- */

function statusLabel(status){
  switch(status){
    case 'intake': return 'Submitted';
    case 'review_basic': return 'Basic Criteria';
    case 'uk_check': return 'UK Distributor';
    case 'viewing': return 'Viewing';
    case 'voting': return 'Voting';
    case 'approved': return 'Approved';
    case 'discarded': return 'Discarded';
    case 'archived': return 'Archived';
    default: return status || '';
  }
}

function filmCard(f, actionsHtml='', opts={}){
  const { showStatus=false, showTinyStatus=false } = opts;
  const year = f.year ? `(${f.year})` : '';
  const poster = f.posterUrl ? `<img alt="Poster" src="${f.posterUrl}" style="width:90px;height:auto;border-radius:8px;margin-right:12px;object-fit:cover"/>` : '';
  const statusHtml = showStatus ? `<span class="badge">${statusLabel(f.status)}</span>` : (showTinyStatus ? `<span class="badge" style="opacity:.8">${statusLabel(f.status)}</span>` : '');
  return `<div class="card">
    <div class="item">
      <div style="display:flex;align-items:flex-start;gap:12px;">
        ${poster}
        <div>
          <div class="item-title">${f.title} ${year} ${statusHtml}</div>
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
      <div>${actionsHtml}</div>
    </div>
  </div>`;
}

function minimalCard(f, rightHtml='', opts={}){
  const { showTinyStatus=false } = opts;
  const year = f.year ? `(${f.year})` : '';
  const poster = f.posterUrl ? `<img alt="Poster" src="${f.posterUrl}" style="width:90px;height:auto;border-radius:8px;margin-right:12px;object-fit:cover"/>` : '';
  const statusHtml = showTinyStatus ? `<span class="badge" style="margin-left:6px">${statusLabel(f.status)}</span>` : '';
  return `<div class="card">
    <div class="item">
      <div style="display:flex;align-items:center;gap:12px;">
        ${poster}
        <div class="item-title">${f.title} ${year} ${statusHtml}</div>
      </div>
      <div>${rightHtml}</div>
    </div>
  </div>`;
}

/* ============================
   VIEWS
   ============================ */

// FILM LIST: show everything NOT in approved/discarded/archived + label for which step they’re in
async function loadFilmList(){
  const isCommittee = ['admin','committee'].includes(state.role);
  const docs = await fetchNotInStatuses(['approved','discarded','archived']);
  els.filmList.innerHTML = '';
  if(!docs.length){
    els.filmList.innerHTML = '<div class="notice">Empty. Use Submit to add a film.</div>';
    return;
  }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const actions = isCommittee
      ? `<div class="actions">
           ${f.status==='intake' ? `<button class="btn btn-primary" data-act="to-basic" data-id="${f.id}">Basic Criteria</button>` : ''}
           ${f.status==='review_basic' ? `<button class="btn btn-primary" data-act="basic-validate" data-id="${f.id}">Validate → UK</button>` : ''}
           ${f.status==='uk_check' ? `
             <button class="btn btn-accent" data-act="uk-yes" data-id="${f.id}">Distributor ✓</button>
             <button class="btn btn-warn" data-act="uk-no" data-id="${f.id}">No Distributor</button>` : ''}
           ${f.status==='viewing' ? `<button class="btn btn-primary" data-act="to-voting" data-id="${f.id}">→ Voting</button>` : ''}
           ${f.status==='voting' ? `<!-- votes happen on Voting page -->` : ''}
         </div>`
      : '';
    els.filmList.insertAdjacentHTML('beforeend', minimalCard(f, actions, {showTinyStatus:true}));
  });
  els.filmList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

// BASIC (includes editable synopsis + UK Age Rating)
async function loadBasic(){
  const docs = await fetchByStatus('review_basic');
  els.basicList.innerHTML = '';
  if(!docs.length){ els.basicList.innerHTML = '<div class="notice">Nothing awaiting basic checks.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const form = (['admin','committee'].includes(state.role)) ? `
      <div style="margin-top:8px">
        <label>Runtime Minutes<input type="number" data-edit="runtimeMinutes" data-id="${f.id}" value="${f.runtimeMinutes ?? ''}" /></label>
        <label>Language<input type="text" data-edit="language" data-id="${f.id}" value="${f.language || ''}" /></label>
        <label>UK Age Rating<input type="text" data-edit="ukAgeRating" data-id="${f.id}" value="${f.ukAgeRating || ''}" placeholder="U, PG, 12A, 12, 15, 18, R18, NR" /></label>
        <label>Genre<input type="text" data-edit="genre" data-id="${f.id}" value="${f.genre || ''}" /></label>
        <label>Country<input type="text" data-edit="country" data-id="${f.id}" value="${f.country || ''}" /></label>
        <label>Disk Available?
          <select data-edit="hasDisk" data-id="${f.id}"><option value="false"${f.hasDisk?'':' selected'}>No</option><option value="true"${f.hasDisk?' selected':''}>Yes</option></select>
        </label>
        <label>Where to see (Apple TV, Netflix, DVD, etc.)<input type="text" data-edit="availability" data-id="${f.id}" value="${f.availability || ''}" /></label>
        <label>Synopsis<textarea data-edit="synopsis" data-id="${f.id}" placeholder="Short description">${f.synopsis || ''}</textarea></label>
        <div class="actions">
          <button class="btn btn-accent" data-act="basic-save" data-id="${f.id}">Save</button>
          <button class="btn btn-primary" data-act="basic-validate" data-id="${f.id}">Validate + → UK Check</button>
          <button class="btn btn-danger" data-act="to-discard" data-id="${f.id}">Discard</button>
        </div>
      </div>
    ` : '';
    els.basicList.insertAdjacentHTML('beforeend', filmCard(f, form, {showStatus:false}));
  });
  // inline save on change
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

// UK CHECK
async function loadUk(){
  const docs = await fetchByStatus('uk_check');
  els.ukList.innerHTML = '';
  if(!docs.length){ els.ukList.innerHTML = '<div class="notice">Nothing awaiting UK distributor check.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const actions = (['admin','committee'].includes(state.role)) ? `
      <div class="actions">
        <button class="btn btn-accent" data-act="uk-yes" data-id="${f.id}">Distributor ✓</button>
        <button class="btn btn-warn" data-act="uk-no" data-id="${f.id}">No Distributor</button>
      </div>
    ` : '';
    els.ukList.insertAdjacentHTML('beforeend', filmCard(f, actions, {showStatus:false}));
  });
  els.ukList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

// VIEWING
async function loadViewing(){
  const docs = await fetchByStatus('viewing');
  els.viewingList.innerHTML = '';
  if(!docs.length){ els.viewingList.innerHTML = '<div class="notice">Viewing queue is empty.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const actions = (['admin','committee'].includes(state.role)) ? `
      <div class="actions">
        <button class="btn btn-primary" data-act="to-voting" data-id="${f.id}">→ Voting</button>
        <button class="btn btn-danger" data-act="to-discard" data-id="${f.id}">Discard</button>
      </div>
    ` : '';
    els.viewingList.insertAdjacentHTML('beforeend', filmCard(f, actions, {showStatus:false}));
  });
  els.viewingList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

// VOTING (Yes first, then No)
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
    els.voteList.insertAdjacentHTML('beforeend', filmCard(f, actions, {showStatus:false}));
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

// 1 yes -> approved, 1 no -> discarded (testing)
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

// APPROVED (+ Archive + Export CSV)
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
    const actions = (['admin','committee'].includes(state.role)) ? `
      <div class="actions">
        <button class="btn btn-ghost" data-act="to-voting" data-id="${f.id}">Send back to Voting</button>
        <button class="btn btn-danger" data-act="to-discard" data-id="${f.id}">Discard</button>
        <button class="btn" data-act="to-archive" data-id="${f.id}">Archive</button>
      </div>` : '';
    els.approvedList.insertAdjacentHTML('beforeend', filmCard(f, actions, {showStatus:false}));
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
      (f.hasUkDistributor===true?'Yes':f.hasUkDistributor===false?'No':''), // <- requested change
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

// DISCARDED (+ Archive)
async function loadDiscarded(){
  const docs = await fetchByStatus('discarded');
  els.discardedList.innerHTML = '';
  if(!docs.length){ els.discardedList.innerHTML = '<div class="notice">Discard list is empty.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const actions = (['admin','committee'].includes(state.role)) ? `
      <div class="actions">
        <button class="btn btn-ghost" data-act="restore" data-id="${f.id}">Restore to Film List</button>
        <button class="btn" data-act="to-archive" data-id="${f.id}">Archive</button>
      </div>` : '';
    els.discardedList.insertAdjacentHTML('beforeend', filmCard(f, actions, {showStatus:false}));
  });
  els.discardedList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

// ARCHIVE page
async function loadArchive(){
  const docs = await fetchByStatus('archived');
  els.archiveList.innerHTML = '';
  if(!docs.length){ els.archiveList.innerHTML = '<div class="notice">No archived films yet.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const origin = f.archivedFrom === 'approved' ? 'Approved' : (f.archivedFrom === 'discarded' ? 'Discarded' : '');
    const right = origin ? `<span class="badge">${origin}</span>` : '';
    els.archiveList.insertAdjacentHTML('beforeend', minimalCard(f, right, {showTinyStatus:false}));
  });
}

/* ---------- Admin actions ---------- */
async function adminAction(action, filmId){
  if(!['admin','committee'].includes(state.role)){
    alert('Committee only'); return;
  }
  const ref = db.collection('films').doc(filmId);
  try{
    if(action==='to-basic') await ref.update({ status:'review_basic' });
    if(action==='basic-save'){ /* fields auto-save on change */ }
    if(action==='basic-validate'){
      const snap = await ref.get();
      const f = snap.data();
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
