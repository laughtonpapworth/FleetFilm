/* Fleet Film App (Updated workflow)
   Status pipeline:
     intake -> review_basic -> uk_check -> viewing -> voting -> approved / discarded
   Auto rules:
     - Voting: at >=3 yes votes -> approved; >=3 no votes -> discarded
   Metadata captured at Basic stage:
     runtimeMinutes, language, ageRating, genre, country, hasDisk (bool), availability (string), hasUkDistributor (bool)
*/

let app, auth, db;

const els = {
  signedOut: document.getElementById('signed-out'),
  signedIn: document.getElementById('signed-in'),
  nav: document.getElementById('nav'),
  signOut: document.getElementById('btn-signout'),
  // lists
  intakeList: document.getElementById('intake-list'),
  basicList: document.getElementById('basic-list'),
  ukList: document.getElementById('uk-list'),
  viewingList: document.getElementById('viewing-list'),
  voteList: document.getElementById('vote-list'),
  approvedList: document.getElementById('approved-list'),
  discardedList: document.getElementById('discarded-list'),
  // views
  views: {
    intake: document.getElementById('view-intake'),
    submit: document.getElementById('view-submit'),
    basic: document.getElementById('view-basic'),
    uk: document.getElementById('view-uk'),
    viewing: document.getElementById('view-viewing'),
    vote: document.getElementById('view-vote'),
    approved: document.getElementById('view-approved'),
    discarded: document.getElementById('view-discarded'),
  },
  // nav buttons
  navButtons: {
    intake: document.getElementById('nav-intake'),
    submit: document.getElementById('nav-submit'),
    basic: document.getElementById('nav-basic'),
    uk: document.getElementById('nav-uk'),
    viewing: document.getElementById('nav-viewing'),
    vote: document.getElementById('nav-vote'),
    approved: document.getElementById('nav-approved'),
    discarded: document.getElementById('nav-discarded'),
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

  if(name==='intake') loadIntake();
  if(name==='basic') loadBasic();
  if(name==='uk') loadUk();
  if(name==='viewing') loadViewing();
  if(name==='vote') loadVote();
  if(name==='approved') loadApproved();
  if(name==='discarded') loadDiscarded();
}

function routerFromHash(){
  const h = location.hash.replace('#','') || 'intake';
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

// Submit: minimal intake (title only is fine)
async function submitFilm(){
  const title = (els.title.value||'').trim();
  if(!title){ alert('Title required'); return; }
  const doc = {
    title,
    year: parseInt(els.year.value || '0', 10) || null,
    distributor: (els.distributor.value||'').trim(),
    link: (els.link.value||'').trim(),
    synopsis: (els.synopsis.value||'').trim(),
    status: 'intake',
    createdBy: state.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    // metadata defaults
    runtimeMinutes: null,
    language: '',
    ageRating: '',
    genre: '',
    country: '',
    hasDisk: false,
    availability: '',
    criteria: { basic_pass: false, screen_program_pass: false },
    hasUkDistributor: null
  };
  try{
    await db.collection('films').add(doc);
    els.submitMsg.textContent = 'Submitted to Intake. Thank you!';
    els.submitMsg.classList.remove('hidden');
    els.title.value=''; els.year.value=''; els.distributor.value=''; els.link.value=''; els.synopsis.value='';
    setTimeout(()=>els.submitMsg.classList.add('hidden'), 3500);
    setView('intake');
  }catch(e){ alert(e.message); }
}

// ---- Helper: fetch by status without requiring a Firestore composite index
async function fetchByStatus(status){
  const snap = await db.collection('films').where('status','==', status).get();
  // sort newest first by createdAt (handles missing timestamps safely)
  const docs = snap.docs.sort((a, b) => {
    const ta = a.data().createdAt?.toMillis?.() || 0;
    const tb = b.data().createdAt?.toMillis?.() || 0;
    return tb - ta;
  });
  return docs;
}

// Rendering helpers
function filmCard(f, actionsHtml=''){
  const year = f.year ? `(${f.year})` : '';
  return `<div class="card">
    <div class="item">
      <div>
        <div class="item-title">${f.title} ${year} <span class="badge">${f.status}</span></div>
        <div class="kv">
          <div>Runtime:</div><div>${f.runtimeMinutes ?? '—'} min</div>
          <div>Language:</div><div>${f.language || '—'}</div>
          <div>Age Rating:</div><div>${f.ageRating || '—'}</div>
          <div>Genre:</div><div>${f.genre || '—'}</div>
          <div>Country:</div><div>${f.country || '—'}</div>
          <div>UK Distributor:</div><div>${f.hasUkDistributor===true?'Yes':f.hasUkDistributor===false?'No':'—'}</div>
          <div>Disk available:</div><div>${f.hasDisk ? 'Yes' : 'No'}</div>
          <div>Where to see:</div><div>${f.availability || '—'}</div>
        </div>
      </div>
      <div>${actionsHtml}</div>
    </div>
  </div>`;
}

// INTAKE (waiting for review)
async function loadIntake(){
  const docs = await fetchByStatus('intake');
  els.intakeList.innerHTML = '';
  if(!docs.length){ els.intakeList.innerHTML = '<div class="notice">No films in Intake.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const actions = (['admin','committee'].includes(state.role))
      ? `<div class="actions">
           <button class="btn btn-primary" data-act="to-basic" data-id="${f.id}">→ Basic Criteria</button>
         </div>` : '';
    els.intakeList.insertAdjacentHTML('beforeend', filmCard(f, actions));
  });
  els.intakeList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

// BASIC CRITERIA list + editor
async function loadBasic(){
  const docs = await fetchByStatus('review_basic');
  els.basicList.innerHTML = '';
  if(!docs.length){ els.basicList.innerHTML = '<div class="notice">Nothing awaiting basic checks.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const form = (['admin','committee'].includes(state.role)) ? `
      <div class="actions"></div>
      <div style="margin-top:8px">
        <label>Runtime Minutes<input type="number" data-edit="runtimeMinutes" data-id="${f.id}" value="${f.runtimeMinutes ?? ''}" /></label>
        <label>Language<input type="text" data-edit="language" data-id="${f.id}" value="${f.language || ''}" /></label>
        <label>Age Rating<input type="text" data-edit="ageRating" data-id="${f.id}" value="${f.ageRating || ''}" /></label>
        <label>Genre<input type="text" data-edit="genre" data-id="${f.id}" value="${f.genre || ''}" /></label>
        <label>Country<input type="text" data-edit="country" data-id="${f.id}" value="${f.country || ''}" /></label>
        <label>Disk Available?
          <select data-edit="hasDisk" data-id="${f.id}"><option value="false"${f.hasDisk?'':' selected'}>No</option><option value="true"${f.hasDisk?' selected':''}>Yes</option></select>
        </label>
        <label>Where to see (Apple TV, Netflix, DVD, etc.)<input type="text" data-edit="availability" data-id="${f.id}" value="${f.availability || ''}" /></label>
        <div class="actions">
          <button class="btn btn-accent" data-act="basic-save" data-id="${f.id}">Save</button>
          <button class="btn btn-primary" data-act="basic-validate" data-id="${f.id}">Validate + → UK Check</button>
          <button class="btn btn-danger" data-act="to-discard" data-id="${f.id}">Discard</button>
        </div>
      </div>
    ` : '';
    els.basicList.insertAdjacentHTML('beforeend', filmCard(f, form));
  });
  // handlers
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
    els.ukList.insertAdjacentHTML('beforeend', filmCard(f, actions));
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
    els.viewingList.insertAdjacentHTML('beforeend', filmCard(f, actions));
  });
  els.viewingList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

// VOTING
async function loadVote(){
  const docs = await fetchByStatus('voting');
  els.voteList.innerHTML='';
  if(!docs.length){ els.voteList.innerHTML = '<div class="notice">No films in Voting.</div>'; return; }
  const my = state.user.uid;
  for(const doc of docs){
    const f = { id: doc.id, ...doc.data() };
    // tally votes
    const vs = await db.collection('films').doc(f.id).collection('votes').get();
    let yes=0, no=0, strong=0;
    vs.forEach(v=>{
      const val = v.data().value;
      if(val===2) strong+=1;
      if(val===1 || val===2) yes+=1;  // treat strong as yes
      if(val===-1) no+=1;
    });
    // my vote
    let myVoteVal = 0;
    const vSnap = await db.collection('films').doc(f.id).collection('votes').doc(my).get();
    if(vSnap.exists) myVoteVal = vSnap.data().value || 0;
    const actions = `<div class="actions" role="group" aria-label="Vote buttons">
      <button class="btn btn-ghost" data-vote="-1" data-id="${f.id}" aria-pressed="${myVoteVal===-1}">👎 No</button>
      <button class="btn btn-ghost" data-vote="1" data-id="${f.id}" aria-pressed="${myVoteVal===1}">👍 Yes</button>
      <button class="btn btn-ghost" data-vote="2" data-id="${f.id}" aria-pressed="${myVoteVal===2}">⭐ Strong Yes</button>
    </div>
    <div class="badge">Yes: ${yes} (⭐ ${strong})</div> <div class="badge">No: ${no}</div>`;
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
    // after vote, check auto-thresholds (3 yes -> approved, 3 no -> discarded)
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
    if(val===2 || val===1) yes+=1;
    if(val===-1) no+=1;
  });
  if(yes>=3){
    await ref.update({ status:'approved' });
  } else if(no>=3){
    await ref.update({ status:'discarded' });
  }
}

// APPROVED
async function loadApproved(){
  const docs = await fetchByStatus('approved');
  els.approvedList.innerHTML = '';
  if(!docs.length){ els.approvedList.innerHTML = '<div class="notice">No approved films yet.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const actions = (['admin','committee'].includes(state.role)) ? `
      <div class="actions">
        <button class="btn btn-ghost" data-act="to-voting" data-id="${f.id}">Send back to Voting</button>
        <button class="btn btn-danger" data-act="to-discard" data-id="${f.id}">Discard</button>
      </div>` : '';
    els.approvedList.insertAdjacentHTML('beforeend', filmCard(f, actions));
  });
  els.approvedList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

// DISCARDED (with restore)
async function loadDiscarded(){
  const docs = await fetchByStatus('discarded');
  els.discardedList.innerHTML = '';
  if(!docs.length){ els.discardedList.innerHTML = '<div class="notice">Discard list is empty.</div>'; return; }
  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const actions = (['admin','committee'].includes(state.role)) ? `
      <div class="actions">
        <button class="btn btn-ghost" data-act="restore" data-id="${f.id}">Restore to Intake</button>
      </div>` : '';
    els.discardedList.insertAdjacentHTML('beforeend', filmCard(f, actions));
  });
  els.discardedList.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id)));
}

// Admin actions to move statuses / set checks
async function adminAction(action, filmId){
  if(!['admin','committee'].includes(state.role)){
    alert('Committee only'); return;
  }
  const ref = db.collection('films').doc(filmId);
  try{
    if(action==='to-basic') await ref.update({ status:'review_basic' });
    if(action==='basic-save'){ /* no-op here; fields auto-save on change */ }
    if(action==='basic-validate'){
      // Must be <= 150 minutes and have language captured
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
    // reload current view
    routerFromHash();
  }catch(e){ alert(e.message); }
}

// Boot
function boot(){
  initFirebase();
  attachHandlers();
  auth.onAuthStateChanged(async (u) => {
    state.user = u;
    if(!u){
      showSignedIn(false);
      location.hash = 'intake';
      return;
    }
    await ensureUserDoc(u);
    showSignedIn(true);
    routerFromHash();
  });
}

document.addEventListener('DOMContentLoaded', boot);

