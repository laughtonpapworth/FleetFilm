/* Fleet Film – cleaned flow
   intake -> review_basic -> viewing -> voting -> uk_check -> greenlist -> next_programme -> archived
*/

let app, auth, db;

/* =================== DOM refs =================== */
const els = {
  signedOut: document.getElementById('signed-out'),
  signedIn: document.getElementById('signed-in'),
  nav: document.getElementById('nav'),
  signOut: document.getElementById('btn-signout'),

  // lists
  pendingList: document.getElementById('intake-list'),
  basicList: document.getElementById('basic-list'),
  viewingList: document.getElementById('viewing-list'),
  voteList: document.getElementById('vote-list'),
  ukList: document.getElementById('uk-list'),
  greenList: document.getElementById('green-list'),
  nextProgList: document.getElementById('nextprog-list'),
  discardedList: document.getElementById('discarded-list'),
  archiveList: document.getElementById('archive-list'),

  // calendar bits (dedicated page)
  calTitle: document.getElementById('cal-title'),
  calGrid: document.getElementById('cal-grid'),
  calPrev: document.getElementById('cal-prev'),
  calNext: document.getElementById('cal-next'),

  // views
  views: {
    pending:   document.getElementById('view-intake'),
    submit:    document.getElementById('view-submit'),
    basic:     document.getElementById('view-basic'),
    viewing:   document.getElementById('view-viewing'),
    vote:      document.getElementById('view-vote'),
    uk:        document.getElementById('view-uk'),
    green:     document.getElementById('view-green'),
    nextprog:  document.getElementById('view-nextprog'),
    discarded: document.getElementById('view-discarded'),
    archive:   document.getElementById('view-archive'),
    calendar:  document.getElementById('view-calendar')
  },

  // nav buttons
  navButtons: {
    submit:    document.getElementById('nav-submit'),
    pending:   document.getElementById('nav-intake'),
    basic:     document.getElementById('nav-basic'),
    viewing:   document.getElementById('nav-viewing'),
    vote:      document.getElementById('nav-vote'),
    uk:        document.getElementById('nav-uk'),
    green:     document.getElementById('nav-green'),
    nextprog:  document.getElementById('nav-nextprog'),
    discarded: document.getElementById('nav-discarded'),
    archive:   document.getElementById('nav-archive'),
    calendar:  document.getElementById('nav-calendar')
  },

  // submit
  title: document.getElementById('f-title'),
  year: document.getElementById('f-year'),
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

/* ========= Required Basic fields ========= */
const REQUIRED_BASIC_FIELDS = ['runtimeMinutes','language','ukAgeRating','genre','country'];

/* =================== Calendar helpers (Mon-first) =================== */
let calOffset = 0;
const mondayIndex = jsDay => (jsDay + 6) % 7;
const monthLabel = (y,m) => new Date(y,m,1).toLocaleString('en-GB',{month:'long',year:'numeric'});

function buildCalendarGridHTML(year, month, eventsByISO){
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const firstDow = mondayIndex(new Date(year, month, 1).getDay());
  const headers = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(w=>`<div class="cal-wd">${w}</div>`).join('');

  let cells = '';
  for(let i=0;i<firstDow;i++) cells += `<div class="cal-cell empty"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const items = eventsByISO[iso] || [];
    const pills = items.map(t=>`<div class="cal-pill">${t}</div>`).join('');
    cells += `<div class="cal-cell"><div class="cal-day">${d}</div>${pills}</div>`;
  }
  return headers + cells;
}
function renderCalendar(events=[]){
  if(!els.calTitle || !els.calGrid) return;
  const base = new Date();
  const ref = new Date(base.getFullYear(), base.getMonth()+calOffset, 1);
  const y = ref.getFullYear(), m = ref.getMonth();
  const byISO = {};
  events.forEach(ev=>{
    const d = ev.viewingDate?.toDate?.(); if(!d) return;
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const label = `${ev.title}${ev.viewingLocationName?` • ${ev.viewingLocationName}`:''}${ev.viewingTime?` • ${ev.viewingTime}`:''}`;
    (byISO[iso] ||= []).push(label);
  });
  els.calTitle.textContent = monthLabel(y,m);
  els.calGrid.innerHTML = buildCalendarGridHTML(y,m,byISO);
}
async function refreshCalendarOnly(){
  const snap = await db.collection('films').where('viewingDate','!=', null).get();
  const events = snap.docs.map(d=>({id:d.id, ...d.data()})).filter(f=>f.viewingDate?.toDate);
  renderCalendar(events);
}

/* =================== Firebase =================== */
function initFirebase(){
  const cfg = window.__FLEETFILM__CONFIG;
  if(!cfg || !cfg.apiKey){
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

  if(name==='pending')    loadPending();
  if(name==='basic')      loadBasic();
  if(name==='viewing')    loadViewing();
  if(name==='vote')       loadVote();
  if(name==='uk')         loadUk();
  if(name==='green')      loadGreen();
  if(name==='nextprog')   loadNextProgramme();
  if(name==='discarded')  loadDiscarded();
  if(name==='archive')    loadArchive();
  if(name==='calendar')   loadCalendar();
}

function routerFromHash(){
  const h = location.hash.replace('#','') || 'submit';
  const map = { intake:'pending', approved:'green' }; // legacy keys → new
  setView(map[h] || h);
}
function showSignedIn(on){
  els.signedIn.classList.toggle('hidden', !on);
  els.signedOut.classList.toggle('hidden', on);
  els.nav.classList.toggle('hidden', !on);
}

/* =================== Auth helpers =================== */
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
  state.role = (await ref.get()).data().role || 'member';
}
function attachHandlers(){
  Object.values(els.navButtons).forEach(btn=>{
    if(!btn) return;
    btn.addEventListener('click', ()=>{ location.hash = btn.dataset.view; });
  });
  els.signOut.addEventListener('click', ()=>auth.signOut());
  els.submitBtn.addEventListener('click', submitFilm);
  els.googleBtn?.addEventListener('click', async ()=>{ try{ await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); } catch(e){ alert(e.message); }});
  els.emailSignInBtn?.addEventListener('click', async ()=>{ try{ await auth.signInWithEmailAndPassword(els.email.value, els.password.value); } catch(e){ alert(e.message); }});
  els.emailCreateBtn?.addEventListener('click', async ()=>{ try{ await auth.createUserWithEmailAndPassword(els.email.value, els.password.value); } catch(e){ alert(e.message); }});
  window.addEventListener('hashchange', routerFromHash);
  setupPendingFilters();
}

/* =================== Filters (Pending) =================== */
const filterState = { q:'', status:'' };
function setupPendingFilters(){
  const q = document.getElementById('filter-q');
  const s = document.getElementById('filter-status');
  const clr = document.getElementById('filter-clear');
  if(q)  q.addEventListener('input', ()=>{ filterState.q = q.value.trim().toLowerCase(); loadPending(); });
  if(s)  s.addEventListener('change', ()=>{ filterState.status = s.value; loadPending(); });
  if(clr) clr.addEventListener('click', ()=>{ filterState.q=''; filterState.status=''; if(q) q.value=''; if(s) s.value=''; loadPending(); });
}

/* =================== OMDb helpers =================== */
function getOmdbKey(){ return (window.__FLEETFILM__CONFIG && window.__FLEETFILM__CONFIG.omdbApiKey) || ''; }
async function omdbSearch(title, year){
  const key = getOmdbKey(); if(!key) return { Search: [] };
  const params = new URLSearchParams({ apikey:key, s:title, type:'movie' });
  if(year) params.set('y', String(year));
  const r = await fetch(`https://www.omdbapi.com/?${params.toString()}`); if(!r.ok) return { Search: [] };
  return await r.json();
}
async function omdbDetailsById(imdbID){
  const key = getOmdbKey(); if(!key) return null;
  const params = new URLSearchParams({ apikey:key, i:imdbID, plot:'short' });
  const r = await fetch(`https://www.omdbapi.com/?${params.toString()}`); if(!r.ok) return null;
  const data = await r.json(); return (data && data.Response==='True') ? data : null;
}
function mapMpaaToUk(mpaa){
  if(!mpaa) return ''; const s = mpaa.toUpperCase();
  if(s==='G') return 'U'; if(s==='PG') return 'PG'; if(s==='PG-13') return '12A'; if(s==='R') return '15'; if(s==='NC-17') return '18';
  if(s.includes('NOT RATED') || s==='N/A') return 'NR'; return s;
}

/* =================== Picker (OMDb) =================== */
function showPicker(items){
  return new Promise(resolve=>{
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-head">
        <h2>Select the correct film</h2>
        <div style="display:flex; gap:8px; align-items:center;">
          <button id="ff-picker-manual" class="btn btn-ghost">Add manually</button>
          <button id="ff-picker-cancel" class="btn btn-ghost">Cancel</button>
        </div>
      </div>
      <div id="ff-picker-list" class="modal-list"></div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const list = modal.querySelector('#ff-picker-list');
    if(!items || !items.length){
      list.innerHTML = `<div class="notice">No matches found. You can “Add manually”.</div>`;
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

/* =================== Submit =================== */
async function submitFilm(){
  const title = (els.title.value||'').trim();
  const yearStr = (els.year.value||'').trim();
  const year = parseInt(yearStr,10);
  if(!title){ alert('Title required'); return; }
  if(!year || yearStr.length!==4){ alert('Enter a 4-digit Year (e.g. 1994)'); return; }

  let picked = null;
  try{
    const res = await omdbSearch(title, year);
    const candidates = (res && res.Search) ? res.Search.filter(x=>x.Type==='movie') : [];
    const choice = await showPicker(candidates);
    if(choice.mode==='cancel') return;
    if(choice.mode==='manual') picked = null;
    if(choice.mode==='pick' && choice.imdbID) picked = await omdbDetailsById(choice.imdbID);
  }catch{
    const ok = confirm('Could not reach OMDb. Add the film manually?');
    if(!ok) return; picked = null;
  }

  const base = {
    title, year, synopsis:'', status:'intake',
    createdBy: state.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    runtimeMinutes: null, language:'', ageRating:'', ukAgeRating:'', genre:'', country:'',
    hasDisk:false, availability:'', criteria:{ basic_pass:false },
    hasUkDistributor:null, distStatus:'', posterUrl:'', imdbID:'',
    viewingDate:null, viewingTime:'', viewingLocationId:'', viewingLocationName:'',
    greenAt:null
  };

  if(picked){
    let runtimeMinutes = null;
    if(picked.Runtime && /\d+/.test(picked.Runtime)){ runtimeMinutes = parseInt(picked.Runtime.match(/\d+/)[0],10); }
    base.posterUrl   = (picked.Poster && picked.Poster!=='N/A') ? picked.Poster : '';
    base.ageRating   = picked.Rated && picked.Rated!=='N/A' ? picked.Rated : '';
    base.ukAgeRating = mapMpaaToUk(base.ageRating);
    base.genre       = picked.Genre && picked.Genre!=='N/A' ? picked.Genre : '';
    base.language    = picked.Language && picked.Language!=='N/A' ? picked.Language : '';
    base.country     = picked.Country && picked.Country!=='N/A' ? picked.Country : '';
    base.imdbID      = picked.imdbID || '';
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
    setTimeout(()=>els.submitMsg.classList.add('hidden'), 2200);
    setView('pending');
  }catch(e){ alert(e.message); }
}

/* =================== Fetch helper =================== */
async function fetchByStatus(status){
  const snap = await db.collection('films').where('status','==', status).get();
  const docs = snap.docs.sort((a,b)=>{
    const ta = a.data().createdAt?.toMillis?.() || 0;
    const tb = b.data().createdAt?.toMillis?.() || 0;
    return tb - ta;
  });
  return docs;
}

/* =================== Rendering helpers =================== */
function pendingCard(f, actionsHtml=''){
  const year = f.year ? `(${f.year})` : '';
  const poster = f.posterUrl ? `<img alt="Poster" src="${f.posterUrl}" class="poster">` : '';
  return `<div class="card">
    <div class="item">
      <div class="item-left">
        ${poster}
        <div class="item-title">${f.title} ${year}</div>
      </div>
      <div class="item-right">${actionsHtml}</div>
    </div>
  </div>`;
}
function detailCard(f, actionsHtml=''){
  const year = f.year ? `(${f.year})` : '';
  const poster = f.posterUrl ? `<img alt="Poster" src="${f.posterUrl}" class="poster">` : '';
  return `<div class="card detail-card">
    <div class="item item--split">
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

/* =================== Pending Films (intake only) =================== */
async function loadPending(){
  // Only show truly pending items
  let films = (await fetchByStatus('intake')).map(d=>({ id:d.id, ...d.data() }));

  if(filterState.q){ films = films.filter(x => (x.title||'').toLowerCase().includes(filterState.q)); }
  // optional: if the dropdown is used, it will only show "intake" anyway

  els.pendingList.innerHTML = '';
  if(!films.length){ els.pendingList.innerHTML = '<div class="notice">Nothing pending.</div>'; return; }

  films.forEach(f=>{
    const actions = `
      <button class="btn btn-primary" data-next="${f.id}">Basic Criteria</button>
      <button class="btn btn-danger" data-discard="${f.id}">Discard</button>
    `;
    els.pendingList.insertAdjacentHTML('beforeend', pendingCard(f, actions));
  });

  // move to Basic
  els.pendingList.querySelectorAll('button[data-next]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.next;
      await db.collection('films').doc(id).update({ status:'review_basic' });
      location.hash = 'basic';
    });
  });

  // discard
  els.pendingList.querySelectorAll('button[data-discard]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.discard;
      await db.collection('films').doc(id).update({ status:'discarded' });
      loadPending();
    });
  });
}

/* =================== BASIC =================== */
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
        <label>UK Age Rating<input type="text" data-edit="ukAgeRating" data-id="${f.id}" value="${f.ukAgeRating || ''}" placeholder="U, PG, 12A, 12, 15, 18, NR" /></label>
        <label>Genre<input type="text" data-edit="genre" data-id="${f.id}" value="${f.genre || ''}" /></label>
        <label>Country<input type="text" data-edit="country" data-id="${f.id}" value="${f.country || ''}" /></label>
        <label>Disk Available?
          <select data-edit="hasDisk" data-id="${f.id}">
            <option value="false"${f.hasDisk?'':' selected'}>No</option>
            <option value="true"${f.hasDisk?' selected':''}>Yes</option>
          </select>
        </label>
        <label>Where to see<input type="text" data-edit="availability" data-id="${f.id}" value="${f.availability || ''}" placeholder="Apple TV, Netflix, DVD…" /></label>
        <label class="span-2">Synopsis<textarea data-edit="synopsis" data-id="${f.id}" placeholder="Short description">${f.synopsis || ''}</textarea></label>
        <div class="actions span-2">
          <button class="btn btn-primary" data-act="basic-validate" data-id="${f.id}">Validate + → Viewing</button>
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

/* =================== VIEWING =================== */
async function loadViewing(){
  els.viewingList.innerHTML = '';
  const docs = await fetchByStatus('viewing');

  if(!docs.length){
    els.viewingList.insertAdjacentHTML('beforeend','<div class="notice">Viewing queue is empty.</div>');
    return;
  }

  // locations for dropdown
  const locSnap = await db.collection('locations').orderBy('name').get();
  const locs = locSnap.docs.map(d=>({ id:d.id, ...(d.data()) }));

  docs.forEach(doc=>{
    const f = { id: doc.id, ...doc.data() };
    const dateISO = f.viewingDate?.toDate?.() ? f.viewingDate.toDate().toISOString().slice(0,10) : '';

    const locOptions =
      `<option value="">Select location…</option>` +
      locs.map(l=>`<option value="${l.id}" ${f.viewingLocationId===l.id?'selected':''}>${l.name}</option>`).join('') +
      `<option value="__add">+ Add new location…</option>`;

    const actions = `
      <div class="form-grid">
        <label>Location
          <select data-edit="viewingLocationId" data-id="${f.id}">
            ${locOptions}
          </select>
        </label>
        <label>Date (read-only here)
          <input type="date" value="${dateISO}" disabled>
        </label>
        <div class="actions span-2" style="margin-top:4px">
          <button class="btn btn-primary" data-act="set-datetime" data-id="${f.id}">Set date & time</button>
          <button class="btn btn-ghost" data-act="to-voting" data-id="${f.id}">→ Voting</button>
          <button class="btn btn-danger" data-act="to-discard" data-id="${f.id}">Discard</button>
        </div>
      </div>
    `;
    els.viewingList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });

  // location dropdown handler
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
        }else{
          sel.value = '';
        }
        loadViewing();
        return;
      }

      if(!val){
        await db.collection('films').doc(id).update({ viewingLocationId:'', viewingLocationName:'' });
        return;
      }
      const ldoc = await db.collection('locations').doc(val).get();
      const name = ldoc.exists ? (ldoc.data().name || '') : '';
      await db.collection('films').doc(id).update({ viewingLocationId: val, viewingLocationName: name });
    });
  });

  // buttons
  els.viewingList.querySelectorAll('button[data-act]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if(act==='set-datetime'){
        sessionStorage.setItem('scheduleTarget', id);
        location.hash = 'calendar';
        return;
      }
      await adminAction(act, id);
    });
  });
}

/* ---------- Add Location Modal (postcode lookup) ---------- */
function showAddLocationModal(){
  return new Promise(resolve=>{
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-head">
        <h2>Add new location</h2>
        <div style="display:flex; gap:8px">
          <button class="btn btn-ghost" id="loc-cancel">Cancel</button>
        </div>
      </div>
      <div class="form-grid">
        <label class="span-2">Location Name
          <input id="loc-name" type="text" placeholder="e.g. Church Hall">
        </label>
        <label class="span-2">Address
          <input id="loc-addr" type="text" placeholder="Street, Town">
        </label>
        <label>Postcode
          <input id="loc-postcode" type="text" placeholder="e.g. GU51 3XX">
        </label>
        <label>City
          <input id="loc-city" type="text" placeholder="(optional)">
        </label>
        <div class="actions span-2">
          <button class="btn btn-ghost" id="loc-lookup">Lookup postcode</button>
          <div class="spacer"></div>
          <button class="btn btn-primary" id="loc-save">Save</button>
        </div>
        <div id="loc-msg" class="notice hidden"></div>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = (result)=>{ document.body.removeChild(overlay); resolve(result); };

    modal.querySelector('#loc-cancel').addEventListener('click', ()=>close(null));
    modal.querySelector('#loc-lookup').addEventListener('click', async ()=>{
      const pc = (document.getElementById('loc-postcode').value || '').trim();
      if(!pc){ toast('Enter a postcode first'); return; }
      try{
        const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
        const data = await r.json();
        if(data && data.status===200){
          const res = data.result;
          document.getElementById('loc-city').value = res.admin_district || res.parish || res.region || '';
          toast(`Found: ${res.country}${res.admin_district? ' • '+res.admin_district:''}`);
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
      }catch(e){ toast(e.message || 'Could not save'); }
    });

    function toast(msg){
      const m = modal.querySelector('#loc-msg');
      m.textContent = msg;
      m.classList.remove('hidden');
      setTimeout(()=>m.classList.add('hidden'), 1800);
    }
  });
}

/* =================== VOTING =================== */
async function loadVote(){
  const docs = await fetchByStatus('voting');
  els.voteList.innerHTML='';
  if(!docs.length){ els.voteList.innerHTML = '<div class="notice">No films in Voting.</div>'; return; }
  const my = state.user.uid;
  const nameCache = {};

  for(const doc of docs){
    const f = { id: doc.id, ...doc.data() };
    const vs = await db.collection('films').doc(f.id).collection('votes').get();
    let yes=0, no=0; const voters=[];
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
        parts.push(`<span class="badge">${who}: ${what}</span>`);
      }
      return parts.join(' ');
    })();

    let myVoteVal = 0;
    const vSnap = await db.collection('films').doc(f.id).collection('votes').doc(my).get();
    if(vSnap.exists) myVoteVal = vSnap.data().value || 0;

    const actions = `
      <div class="actions" role="group" aria-label="Vote buttons">
        <button class="btn btn-ghost" data-vote="1"  data-id="${f.id}" aria-pressed="${myVoteVal===1}">👍 Yes</button>
        <button class="btn btn-ghost" data-vote="-1" data-id="${f.id}" aria-pressed="${myVoteVal===-1}">👎 No</button>
      </div>
      <div class="badge">Yes: ${yes}</div> <div class="badge">No: ${no}</div>
      <div style="margin-top:6px">${listVotes}</div>
      <div class="actions" style="margin-top:8px">
        <button class="btn" data-act="to-discard" data-id="${f.id}">Discard</button>
      </div>
    `;
    els.voteList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  }

  els.voteList.querySelectorAll('button[data-vote]').forEach(btn=>{
    btn.addEventListener('click', ()=>castVote(btn.dataset.id, parseInt(btn.dataset.vote,10)));
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
 
