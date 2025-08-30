
/* Fleet Film App (Auth + Firestore)
   Roles: 'member' (default), 'committee', 'admin'
   Collections:
     - users/{uid} : {displayName, email, role}
     - films/{id}  : {title, year, distributor, link, synopsis, status, criteria:{basic_pass, screen_program_pass}, createdBy, createdAt}
     - films/{id}/votes/{uid} : {value, createdAt} // value: -1 (No), 1 (Interested), 2 (Strong pick)
*/

let app, auth, db;

const els = {
  signedOut: document.getElementById('signed-out'),
  signedIn: document.getElementById('signed-in'),
  nav: document.getElementById('nav'),
  signOut: document.getElementById('btn-signout'),
  filmList: document.getElementById('film-list'),
  reviewList: document.getElementById('review-list'),
  voteList: document.getElementById('vote-list'),
  programList: document.getElementById('program-list'),
  views: {
    films: document.getElementById('view-films'),
    submit: document.getElementById('view-submit'),
    review: document.getElementById('view-review'),
    vote: document.getElementById('view-vote'),
    program: document.getElementById('view-program'),
  },
  navButtons: {
    films: document.getElementById('nav-films'),
    submit: document.getElementById('nav-submit'),
    review: document.getElementById('nav-review'),
    vote: document.getElementById('nav-vote'),
    program: document.getElementById('nav-program'),
  },
  // submit form
  title: document.getElementById('f-title'),
  year: document.getElementById('f-year'),
  distributor: document.getElementById('f-distributor'),
  link: document.getElementById('f-link'),
  synopsis: document.getElementById('f-synopsis'),
  basicPass: document.getElementById('f-basic-pass'),
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
  // highlight nav
  Object.values(els.navButtons).forEach(btn => btn.classList.remove('active'));
  if(els.navButtons[name]) els.navButtons[name].classList.add('active');
  // show/hide sections
  Object.values(els.views).forEach(v => v.classList.add('hidden'));
  if(els.views[name]) els.views[name].classList.remove('hidden');
  // load data
  if(name==='films') loadFilms();
  if(name==='review') loadReview();
  if(name==='vote') loadVote();
  if(name==='program') loadProgram();
}

function routerFromHash(){
  const h = location.hash.replace('#','') || 'films';
  setView(h);
}

// --- Auth UI ---
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
  // Hide review nav if not committee/admin
  const canReview = ['committee','admin'].includes(role);
  els.navButtons.review.style.display = canReview ? '' : 'none';
  // Only admin sees Program selection tools (we still list published program to all)
}

// --- Event handlers ---
function attachHandlers(){
  // nav
  Object.values(els.navButtons).forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      location.hash = v;
    });
  });
  // signout
  els.signOut.addEventListener('click', () => auth.signOut());
  // submit
  els.submitBtn.addEventListener('click', submitFilm);
  // auth
  els.googleBtn.addEventListener('click', async () => {
    try{
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    }catch(e){ alert(e.message); }
  });
  els.emailSignInBtn.addEventListener('click', async () => {
    try{
      await auth.signInWithEmailAndPassword(els.email.value, els.password.value);
    }catch(e){ alert(e.message); }
  });
  els.emailCreateBtn.addEventListener('click', async () => {
    try{
      await auth.createUserWithEmailAndPassword(els.email.value, els.password.value);
    }catch(e){ alert(e.message); }
  });
  window.addEventListener('hashchange', routerFromHash);
}

// --- Submit film ---
async function submitFilm(){
  const title = els.title.value.trim();
  if(!title){ alert('Title required'); return; }
  const doc = {
    title,
    year: parseInt(els.year.value || '0', 10) || null,
    distributor: els.distributor.value.trim(),
    link: els.link.value.trim(),
    synopsis: els.synopsis.value.trim(),
    status: 'submitted', // submitted -> reviewing -> voting -> selected/archived
    criteria: { basic_pass: !!els.basicPass.checked, screen_program_pass: false },
    createdBy: state.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  try{
    await db.collection('films').add(doc);
    els.submitMsg.textContent = 'Submitted. Thank you!';
    els.submitMsg.classList.remove('hidden');
    els.title.value=''; els.year.value=''; els.distributor.value=''; els.link.value=''; els.synopsis.value=''; els.basicPass.checked=false;
    setTimeout(()=>els.submitMsg.classList.add('hidden'), 3500);
  }catch(e){ alert(e.message); }
}

// --- Render helpers ---
function filmStatusBadge(status){
  const map = {
    submitted: 'Submitted',
    reviewing: 'Reviewing',
    voting: 'Voting',
    selected: 'Selected',
    archived: 'Archived'
  };
  return `<span class="badge">${map[status]||status}</span>`;
}

function filmCard(f, actionsHtml=''){
  const year = f.year ? `(${f.year})` : '';
  const link = f.link ? `<a href="${f.link}" target="_blank" rel="noopener">link</a>` : '';
  const by = f.createdBy || '';
  const criteria = f.criteria || {};
  const dist = f.distributor ? `<div><strong>Distributor:</strong> ${f.distributor}</div>` : '';
  return `<div class="card">
    <div class="item">
      <div>
        <div class="item-title">${f.title} ${year} ${filmStatusBadge(f.status)}</div>
        <div class="kv">
          <div>Basic Criteria:</div><div>${criteria.basic_pass ? 'Yes' : 'No'}</div>
          <div>Screen/Program:</div><div>${criteria.screen_program_pass ? 'Yes' : 'No'}</div>
        </div>
        ${dist}
        <div>${link}</div>
        <p>${f.synopsis||''}</p>
      </div>
      <div>${actionsHtml}</div>
    </div>
  </div>`;
}

// --- Load films ---
async function loadFilms(){
  const q = db.collection('films').orderBy('createdAt', 'desc').limit(50);
  const snap = await q.get();
  els.filmList.innerHTML = '';
  snap.forEach(doc => {
    const f = { id: doc.id, ...doc.data() };
    const actions = (state.role==='admin' || state.role==='committee')
      ? `<div class="actions">
           <button class="btn btn-ghost" data-act="move-review" data-id="${f.id}">Move to Review</button>
           <button class="btn btn-ghost" data-act="move-vote" data-id="${f.id}">Move to Voting</button>
           <button class="btn btn-ghost" data-act="select" data-id="${f.id}">Select</button>
           <button class="btn btn-danger" data-act="archive" data-id="${f.id}">Archive</button>
         </div>` : '';
    els.filmList.insertAdjacentHTML('beforeend', filmCard(f, actions));
  });
  els.filmList.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => adminAction(btn.dataset.act, btn.dataset.id));
  });
}

// --- Review queue ---
async function loadReview(){
  if(!['admin','committee'].includes(state.role)){
    els.reviewList.innerHTML = '<div class="notice">Committee only.</div>';
    return;
  }
  const q = db.collection('films').where('status','in',['submitted','reviewing']).orderBy('createdAt','desc').limit(50);
  const snap = await q.get();
  els.reviewList.innerHTML='';
  snap.forEach(doc => {
    const f = { id: doc.id, ...doc.data() };
    const actions = `<div class="actions">
      <button class="btn btn-accent" data-act="mark-basic-yes" data-id="${f.id}">Basic ✓</button>
      <button class="btn btn-warn" data-act="mark-basic-no" data-id="${f.id}">Basic ✗</button>
      <button class="btn btn-accent" data-act="mark-screenprog-yes" data-id="${f.id}">Screen/Program ✓</button>
      <button class="btn btn-warn" data-act="mark-screenprog-no" data-id="${f.id}">Screen/Program ✗</button>
      <button class="btn btn-primary" data-act="move-vote" data-id="${f.id}">→ Voting</button>
      <button class="btn btn-danger" data-act="archive" data-id="${f.id}">Discard + Archive</button>
    </div>`;
    els.reviewList.insertAdjacentHTML('beforeend', filmCard(f, actions));
  });
  els.reviewList.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => adminAction(btn.dataset.act, btn.dataset.id));
  });
}

// --- Voting ---
async function loadVote(){
  const q = db.collection('films').where('status','==','voting').orderBy('createdAt','desc').limit(50);
  const snap = await q.get();
  els.voteList.innerHTML='';
  const my = state.user.uid;
  for (const doc of snap.docs){
    const f = { id: doc.id, ...doc.data() };
    // Fetch my vote
    let myVoteVal = 0;
    const vSnap = await db.collection('films').doc(f.id).collection('votes').doc(my).get();
    if(vSnap.exists) myVoteVal = vSnap.data().value || 0;
    const actions = `<div class="actions" role="group" aria-label="Vote buttons">
      <button class="btn btn-ghost" data-vote="-1" data-id="${f.id}" aria-pressed="${myVoteVal===-1}">👎 Not for now</button>
      <button class="btn btn-ghost" data-vote="1" data-id="${f.id}" aria-pressed="${myVoteVal===1}">👍 Interested</button>
      <button class="btn btn-ghost" data-vote="2" data-id="${f.id}" aria-pressed="${myVoteVal===2}">⭐ Strong pick</button>
    </div>`;
    els.voteList.insertAdjacentHTML('beforeend', filmCard(f, actions));
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
    loadVote();
  }catch(e){ alert(e.message); }
}

// --- Program ---
async function loadProgram(){
  // show selected films + quick select (committee/admin)
  const qSel = db.collection('films').where('status','==','selected').orderBy('createdAt','desc').limit(50);
  const snapSel = await qSel.get();
  els.programList.innerHTML = '';
  if(snapSel.empty) els.programList.innerHTML = '<div class="notice">No selected films yet.</div>';
  snapSel.forEach(doc => {
    const f = { id: doc.id, ...doc.data() };
    const actions = (state.role==='admin' || state.role==='committee')
      ? `<div class="actions">
           <button class="btn btn-ghost" data-act="unselect" data-id="${f.id}">Unselect</button>
           <button class="btn btn-danger" data-act="archive" data-id="${f.id}">Archive</button>
         </div>` : '';
    els.programList.insertAdjacentHTML('beforeend', filmCard(f, actions));
  });
  els.programList.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => adminAction(btn.dataset.act, btn.dataset.id));
  });
}

// --- Admin actions ---
async function adminAction(action, filmId){
  if(!['admin','committee'].includes(state.role)){
    alert('Committee only');
    return;
  }
  const ref = db.collection('films').doc(filmId);
  try{
    if(action==='archive') await ref.update({ status:'archived' });
    if(action==='select') await ref.update({ status:'selected' });
    if(action==='unselect') await ref.update({ status:'voting' });
    if(action==='move-review') await ref.update({ status:'reviewing' });
    if(action==='move-vote') await ref.update({ status:'voting' });
    if(action==='mark-basic-yes') await ref.update({ 'criteria.basic_pass': true });
    if(action==='mark-basic-no') await ref.update({ 'criteria.basic_pass': false });
    if(action==='mark-screenprog-yes') await ref.update({ 'criteria.screen_program_pass': true });
    if(action==='mark-screenprog-no') await ref.update({ 'criteria.screen_program_pass': false });
    // reload relevant lists
    loadFilms(); loadReview(); loadProgram();
  }catch(e){ alert(e.message); }
}

// --- Boot ---
function boot(){
  initFirebase();
  attachHandlers();
  auth.onAuthStateChanged(async (u) => {
    state.user = u;
    if(!u){
      showSignedIn(false);
      location.hash = 'films';
      return;
    }
    await ensureUserDoc(u);
    showSignedIn(true);
    routerFromHash();
  });
}

document.addEventListener('DOMContentLoaded', boot);
