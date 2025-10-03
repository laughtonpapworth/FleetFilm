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
navToggle: document.getElementById('nav-toggle'),
mobileTabbar: document.getElementById('mobile-tabbar'),
signOut: document.getElementById('btn-signout'),
// LIST CONTAINERS
pendingList: document.getElementById('intake-list'),
basicList: document.getElementById('basic-list'),
viewingList: document.getElementById('viewing-list'),
voteList: document.getElementById('vote-list'),
ukList: document.getElementById('uk-list'),
greenList: document.getElementById('green-list'),
nextProgList: document.getElementById('nextprog-list'),
discardedList: document.getElementById('discarded-list'),
archiveList: document.getElementById('archive-list'),
addressesList: document.getElementById('addresses-list'),
addressesTable: document.querySelector('#addresses-table tbody'),
addressesAdminMsg: document.getElementById('addresses-admin-msg'),
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
addresses:  document.getElementById('view-addresses'),
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
addresses:  document.getElementById('nav-addresses'),
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
.map(w => <div class="cal-wd">${w}</div>).join('');
let cells = '';
for (let i = 0; i < firstDow; i++) cells += '';
for (let d = 1; d <= daysInMonth; d++) {
const iso = ${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')};
const items = eventsByISO[iso] || [];
const pills = items.map(({text, id}, i) =>
<button class="cal-pill c${i%4}" data-film-id="${id}" style="display:block;width:100%;text-align:left;cursor:pointer">${text}</button>
).join('');
cells += <div class="cal-cell"><div class="cal-day">${d}</div>${pills}</div>;
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
const events = snap.docs.map(d=>({ id:d.id, ...d.data() }))
.filter(f=>f.viewingDate && typeof f.viewingDate.toDate === 'function');
// Group by YYYY-MM-DD
const byISO = {};
events.forEach(ev=>{
const d = ev.viewingDate.toDate();
const iso = ${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')};
const locName = ev.viewingLocationName ?  • ${ev.viewingLocationName} : '';
const time = ev.viewingTime ?  ${ev.viewingTime} : '';
const label = ${ev.title}${time}${locName};
(byISO[iso] ||= []).push({ text: label, id: ev.id });
});
const now = new Date();
const ref = new Date(now.getFullYear(), now.getMonth()+calOffset, 1);
titleEl.textContent = monthLabel(ref.getFullYear(), ref.getMonth());
gridEl.innerHTML = buildCalendarGridHTML(ref.getFullYear(), ref.getMonth(), byISO);
// Wire pill clicks -> quick actions modal
gridEl.querySelectorAll('.cal-pill').forEach(p=>{
p.addEventListener('click', async ()=>{
const filmId = p.getAttribute('data-film-id');
const doc = await db.collection('films').doc(filmId).get();
if(!doc.exists) return;
const f = { id: doc.id, ...doc.data() };
openCalendarQuickActions(f);
});
});
}
/* Small modal for calendar quick actions */
function openCalendarQuickActions(film){
const overlay = document.createElement('div');
overlay.className = 'modal-overlay';
overlay.innerHTML = `
    
      
        Edit schedule
        <button class="btn btn-ghost" id="calqa-close">Close</button>
      
      
        ${film.title}
        <button class="btn btn-primary" id="calqa-edit">Open editor below</button>
        <button class="btn" id="calqa-details">Open full details</button>
        <button class="btn btn-danger" id="calqa-delete">Remove from calendar</button>
      
    `;
  document.body.appendChild(overlay);
function close(){ document.body.removeChild(overlay); }
overlay.querySelector('#calqa-close').onclick = close;
overlay.querySelector('#calqa-edit').onclick = async ()=>{
close();
await prefillCalendarEditor(film.id);
document.getElementById('calendar-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
overlay.querySelector('#calqa-details').onclick = ()=>{
close();
location.hash = 'viewing';
setTimeout(()=>{
document.querySelector([data-film-card="${film.id}"])?.scrollIntoView({behavior:'smooth', block:'start'});
}, 250);
};
overlay.querySelector('#calqa-delete').onclick = async ()=>{
if(!confirm('Remove this film from the calendar?')) return;
await db.collection('films').doc(film.id).update({
viewingDate: null,
viewingTime: '',
viewingLocationId: '',
viewingLocationName: ''
});
close();
await refreshCalendarOnly();
};
}
/* =================== Firebase =================== */
function haveFirebaseSDK(){
try { return !!window.firebase; } catch { return false; }
}
function getFirebaseConfig(){
return window.__FLEETFILM__CONFIG || window.firebaseConfig || window.FIREBASE_CONFIG || null;
}
async function waitForFirebaseAndConfig(timeoutMs = 10000){
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
function initFirebaseOnce(){
if (firebase.apps && firebase.apps.length > 0) {
app  = firebase.app();
auth = firebase.auth();
db   = firebase.firestore();
return;
}
const cfg = getFirebaseConfig();
if (!cfg || !cfg.apiKey) throw new Error('Missing Firebase config');
app  = firebase.initializeApp(cfg);
auth = firebase.auth();
db   = firebase.firestore();
auth.useDeviceLanguage?.();
}
/* =================== Router / Views =================== */
function setView(name){
Object.values(els.navButtons).forEach(btn => btn && btn.classList.remove('active'));
if(els.navButtons[name]) els.navButtons[name].classList.add('active');
Object.values(els.views).forEach(v => v && v.classList.add('hidden'));
if(els.views[name]) els.views[name].classList.remove('hidden');
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
if(name==='addresses')  return loadAddressesAdmin();
}
function routerFromHash(){
const h = (location.hash.replace('#','') || 'submit');
const map = { intake:'pending', approved:'green' };
setView(map[h] || h);
}
function setNavOpen(open){
if(!els.nav) return;
if(open) els.nav.classList.add('nav--open');
else els.nav.classList.remove('nav--open');
}
function showSignedIn(on){
els.signedIn.classList.toggle('hidden', !on);
els.signedOut.classList.toggle('hidden', on);
els.nav.classList.toggle('hidden', !on);
// Mobile tab bar is hidden by default (.hidden in HTML/CSS); show it only when signed-in
const mbar = document.getElementById('mobile-tabbar');
if (mbar) mbar.classList.toggle('hidden', !on);
// Ensure the collapsible nav is closed when signed out
if (!on) els.nav.classList.remove('nav--open');
}
/* Create a user doc if missing */
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
// Admin-only nav button visibility
if(els.navButtons.addresses){
els.navButtons.addresses.classList.toggle('hidden', role!=='admin');
}
}
function attachHandlers(){
// Header Menu (mobile)
if(els.navToggle){
els.navToggle.addEventListener('click', ()=>{
if(els.nav?.classList.contains('nav--open')) setNavOpen(false);
else setNavOpen(true);
});
}
// Top nav routing
Object.values(els.navButtons).forEach(btn => {
if(!btn) return;
btn.addEventListener('click', () => {
setNavOpen(false);
location.hash = btn.dataset.view;
});
});
// Sign out
if(els.signOut){
els.signOut.addEventListener('click', () => auth.signOut());
}
// Submit button
if(els.submitBtn){
els.submitBtn.addEventListener('click', submitFilm);
}
// ---- Auth buttons (popup-first, redirect fallback) ----
if (els.googleBtn) {
els.googleBtn.addEventListener('click', async () => {
const provider = new firebase.auth.GoogleAuthProvider();
try {
// Try popup first (works on desktop and most mobile when triggered by a user click)
await auth.signInWithPopup(provider);
} catch (err) {
console.warn('Popup failed, falling back to redirect:', err && err.message);
await auth.signInWithRedirect(provider);
}
});
}
// Optional: surface redirect errors after returning from Google
auth.getRedirectResult().catch(err => {
// This call is important on mobile: it completes the redirect flow.
console.warn('Redirect sign-in error:', err && err.message);
});
// Email auth
if(els.emailSignInBtn){
els.emailSignInBtn.addEventListener('click', async () => {
try {
await auth.signInWithEmailAndPassword(els.email.value, els.password.value);
} catch(e) { alert(e.message); }
});
}
if(els.emailCreateBtn){
els.emailCreateBtn.addEventListener('click', async () => {
try {
await auth.createUserWithEmailAndPassword(els.email.value, els.password.value);
} catch(e) { alert(e.message); }
});
}
// Hash router
window.addEventListener('hashchange', routerFromHash);
// Mobile bottom tabbar
const mbar = document.getElementById('mobile-tabbar');
if (mbar) {
mbar.addEventListener('click', (e)=>{
const btn = e.target.closest('button[data-view]');
if(!btn) return;
location.hash = btn.dataset.view;
});
const moreBtn = document.getElementById('tab-more');
if (moreBtn) {
moreBtn.addEventListener('click', () => {
// Build the "More" list = everything except the 4 quick ones
const rest = [
['pending',   'Pending'],
['basic',     'Basic'],
['uk',        'UK Check'],
['green',     'Green'],
['nextprog',  'Next Programme'],
['discarded', 'Discarded'],
['archive',   'Archive'],
['addresses', 'Addresses'],
];
const overlay = document.createElement('div');
overlay.className = 'modal-overlay';
overlay.innerHTML = `
        
          
            More pages
            <button class="btn btn-ghost" id="more-close">Close</button>
          
          
        `;
      document.body.appendChild(overlay);
const list = overlay.querySelector('#more-list');
rest.forEach(([view, label])=>{
const b = document.createElement('button');
b.className = 'btn';
b.textContent = label;
b.onclick = () => {
location.hash = view;           // navigate
document.body.removeChild(overlay); // auto-hide
};
list.appendChild(b);
});
overlay.querySelector('#more-close').onclick = () => {
document.body.removeChild(overlay);
};
});
}
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
'' +
'Select the correct film' +
'' +
'<button id="ff-picker-manual" class="btn btn-ghost">Add manually</button>' +
'<button id="ff-picker-cancel" class="btn btn-ghost">Cancel</button>' +
'' +
'' +
'';
overlay.appendChild(modal);
document.body.appendChild(overlay);
const list = modal.querySelector('#ff-picker-list');
if(!items || !items.length){
list.innerHTML = 'No matches found. You can “Add manually”.';
}else{
items.forEach(it=>{
const poster = (it.Poster && it.Poster!=='N/A') ? it.Poster : '';
const row = document.createElement('div');
row.className = 'modal-row';
row.innerHTML =
(poster ? '<img src="'+poster+'" alt="poster" class="poster-small">' : '') +
'' +
''+it.Title+' ('+it.Year+')' +
''+(it.Type || 'movie')+' • '+it.imdbID+'' +
'' +
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
async function fetchAddressesByPostcode(pc) {
const cfg = window.__FLEETFILM__CONFIG || {};
const domainToken = cfg.getAddressDomainToken || '';
const apiKey = cfg.getAddressIoKey || cfg.getaddressIoKey || '';
const norm = (pc || '').trim().toUpperCase().replace(/\s+/g, '');
if (!norm) return [];
// Helper to hit getaddress and normalize results to our fields
const callGetAddress = async (url) => {
const r = await fetch(url, { method: 'GET' });
if (!r.ok) {
const txt = await r.text().catch(()=> '');
throw new Error(getaddress ${r.status}: ${txt || r.statusText});
}
const data = await r.json();
const raw = Array.isArray(data.addresses) ? data.addresses : (data.Address || data.address || []);
// Normalize each to house/street/town/county/postcode/label
return raw.map(a => {
// Expanded format when ?expand=true:
const line1 = a.line_1 || a.building_name || a.building_number || '';
const number = (a.building_number || '').toString();
const house  = line1 || number;
const street = a.thoroughfare || a.line_2 || '';
const town   = a.town_or_city || a.post_town || a.town || '';
const county = a.county || a.county_name || '';
const postcode = (a.postcode || pc).toUpperCase();
const labelParts = [
house,
street,
town,
county,
postcode
].filter(Boolean);
return {
house: house || '',
street: street || '',
town: town || '',
county: county || '',
postcode,
address: [house, street].filter(Boolean).join(' '),
label: labelParts.join(', ')
};
});
};
// 1) Try Domain Token (browser-safe)
if (domainToken) {
try {
// Note: /find/{postcode} with ?expand=true
const url = https://api.getaddress.io/find/${encodeURIComponent(norm)}?expand=true&domain_token=${encodeURIComponent(domainToken)};
const list = await callGetAddress(url);
if (list.length) return list;
} catch (e) {
console.warn('[getaddress] domain token path failed:', e?.message);
}
}
// 2) Fallback to API key (works even if domain token is blocked)
if (apiKey) {
try {
const url = https://api.getaddress.io/find/${encodeURIComponent(norm)}?expand=true&api-key=${encodeURIComponent(apiKey)};
const list = await callGetAddress(url);
if (list.length) return list;
} catch (e) {
console.warn('[getaddress] api key path failed:', e?.message);
}
}
// 3) Last resort: postcodes.io (gives town/county only — no property list)
try {
const r = await fetch(https://api.postcodes.io/postcodes/${encodeURIComponent(norm)});
if (r.ok) {
const data = await r.json();
if (data && data.status === 200 && data.result) {
const res = data.result;
return [{
house: '',
street: '',
town: res.admin_district || res.parish || res.region || '',
county: res.ccg || res.region || '',
postcode: norm,
address: '',
label: ${norm} (${res.admin_district || res.parish || res.region || res.country || 'UK'})
}];
}
}
} catch {}
return [];
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
if(els.submitMsg){
els.submitMsg.textContent = 'Added to Pending Films.';
els.submitMsg.classList.remove('hidden');
setTimeout(()=>els.submitMsg.classList.add('hidden'), 1800);
}
if(els.title) els.title.value='';
if(els.year) els.year.value='';
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
function pendingCard(f, actionsHtml=''){
const year = f.year ? (${f.year}) : '';
const poster = f.posterUrl ? <img alt="Poster" src="${f.posterUrl}" class="poster"> : '';
return `
    
      
        ${poster}
        ${f.title} ${year}
      
      ${actionsHtml}
    
  `;
}
function detailCard(f, actionsHtml=''){
const year = f.year ? (${f.year}) : '';
const poster = f.posterUrl ? <img alt="Poster" src="${f.posterUrl}" class="poster"> : '';
return `
    
      
        ${poster}
        
          ${f.title} ${year}
          
            Runtime:${f.runtimeMinutes ?? '—'} min
            Language:${f.language || '—'}
            UK Age Rating:${f.ukAgeRating || '—'}
            Genre:${f.genre || '—'}
            Country:${f.country || '—'}
            UK Distributor:${f.hasUkDistributor===true?'Yes':f.hasUkDistributor===false?'No':'—'}
            Disk available:${f.hasDisk ? 'Yes' : 'No'}
            Where to see:${f.availability || '—'}
          
        
      
      ${actionsHtml}
    
  `;
}
/* =================== Pending Films =================== */
async function loadPending(){
const docs = await fetchByStatus('intake');
let films = docs.map(d=>({ id:d.id, ...d.data() }));
if(filterState.q){ films = films.filter(x => (x.title||'').toLowerCase().includes(filterState.q)); }
els.pendingList.innerHTML = '';
if(!films.length){ els.pendingList.innerHTML = 'Nothing pending.'; return; }
films.forEach(f=>{
const actions =       <button class="btn btn-primary" data-next="${f.id}">Basic Criteria</button>       <button class="btn btn-danger" data-discard="${f.id}">Discard</button>       <button class="btn" data-archive="${f.id}">Archive</button>    ;
els.pendingList.insertAdjacentHTML('beforeend', pendingCard(f, actions));
});
els.pendingList.querySelectorAll('button[data-next]').forEach(btn=>{
btn.addEventListener('click', async ()=>{
const id = btn.dataset.next;
const ref = db.collection('films').doc(id);
await ref.update({ status:'review_basic' });
loadPending();
});
});
els.pendingList.querySelectorAll('button[data-discard]').forEach(btn=>{
btn.addEventListener('click', async ()=>{
const id = btn.dataset.discard;
await db.collection('films').doc(id).update({ status:'discarded' });
loadPending();
});
});
els.pendingList.querySelectorAll('button[data-archive]').forEach(btn=>{
btn.addEventListener('click', async ()=>{
const id = btn.dataset.archive;
await db.collection('films').doc(id).update({ status:'archived', archivedFrom:'intake' });
loadPending();
});
});
setupPendingFilters();
}
/* =================== BASIC =================== */
async function loadBasic(){
const docs = await fetchByStatus('review_basic');
els.basicList.innerHTML = '';
if(!docs.length){ els.basicList.innerHTML = 'Nothing awaiting basic checks.'; return; }
docs.forEach(doc=>{
const f = { id: doc.id, ...doc.data() };
const form = `
      
        Runtime Minutes
        Language
        UK Age Rating
        Genre
        Country
        Disk Available?
          <select data-edit="hasDisk" data-id="${f.id}"><option value="false" ${f.hasdisk?&#x27;&#x27;:&#x27;="" selected&#x27;}="">No</option><option value="true" ${f.hasdisk?&#x27;="" selected&#x27;:&#x27;&#x27;}="">Yes</option></select>
        
        Where to see
        Synopsis<textarea data-edit="synopsis" data-id="${f.id}" placeholder="Short description">${f.synopsis || ''}</textarea>
        
          <button class="btn btn-primary" data-act="basic-validate" data-id="${f.id}">Validate + → Viewing</button>
          <button class="btn btn-danger" data-act="to-discard" data-id="${f.id}">Discard</button>
        
      
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
  els.basicList.querySelectorAll('button[data-id]').forEach(b=>{
    b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id));
  });
}
/* =================== VIEWING =================== */
async function loadViewing(){
els.viewingList.innerHTML = '';
const docs = await fetchByStatus('viewing');
if(!docs.length){
els.viewingList.insertAdjacentHTML('beforeend','Viewing queue is empty.');
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
locs.forEach(l=>{
const sel = (f.viewingLocationId===l.id) ? ' selected' : '';
locOptions += <option value="${l.id}"${sel}>${l.name}</option>;
});
locOptions += '<option value="__add">+ Add new location…</option>';
const actions = `
      
        Location
          <select data-edit="viewingLocationId" data-id="${f.id}">
            ${locOptions}
          </select>
        
Date


Time (optional)


        
          <button class="btn btn-primary" data-act="set-datetime" data-id="${f.id}">Open Calendar</button>
          <button class="btn btn-ghost" data-act="to-voting" data-id="${f.id}">→ Voting</button>
          <button class="btn btn-danger" data-act="to-discard" data-id="${f.id}">Discard</button>
        
      
    `;
    els.viewingList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });
// Location dropdown changes (including "Add new")
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
// Inline date/time edits
els.viewingList.querySelectorAll('input[data-edit="viewingDate"]').forEach(inp=>{
inp.addEventListener('change', async ()=>{
const id = inp.dataset.id;
const val = inp.value;
const ts = val ? firebase.firestore.Timestamp.fromDate(new Date(val+'T00:00:00')) : null;
await db.collection('films').doc(id).update({ viewingDate: ts });
await refreshCalendarOnly();
});
});
els.viewingList.querySelectorAll('input[data-edit="viewingTime"]').forEach(inp=>{
inp.addEventListener('change', async ()=>{
const id = inp.dataset.id;
await db.collection('films').doc(id).update({ viewingTime: inp.value || '' });
await refreshCalendarOnly();
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
function showAddLocationModal(prefill = {}) {
return new Promise(resolve => {
const overlay = document.createElement('div');
overlay.className = 'modal-overlay';
overlay.innerHTML = `
      
        
          ${prefill.id ? 'Edit location' : 'Add new location'}
          <button class="btn btn-ghost" id="loc-cancel">Cancel</button>
        
        
          Location Name (required)
            
          
Postcode


          
            <button class="btn" id="loc-lookup">Lookup</button>
          
          
          
House / Name


Street


Town / City


County


          
          
            
            <button class="btn btn-primary" id="loc-save">
              ${prefill.id ? 'Save changes' : 'Save'}
            </button>
          
        
      `;
    document.body.appendChild(overlay);
const $ = sel => overlay.querySelector(sel);
const close = (res) => { document.body.removeChild(overlay); resolve(res || null); };
$('#loc-cancel').onclick = () => close(null);
// Lookup click: fetch + render suggestions
$('#loc-lookup').onclick = async () => {
const pc = ($('#loc-postcode').value || '').trim();
if (!pc) { toast('Enter a postcode first'); return; }
const listEl = $('#loc-options');
listEl.innerHTML = 'Searching…';
try {
const results = await fetchAddressesByPostcode(pc);
listEl.innerHTML = '';
if (!results.length) {
listEl.innerHTML = 'No addresses found.';
return;
}
results.forEach(a => {
const b = document.createElement('button');
b.className = 'btn btn-ghost';
b.type = 'button';
b.style.width = '100%';
b.style.textAlign = 'left';
b.textContent = a.label;
// When clicked, fill the fields from this selected address
b.onclick = () => {
$('#loc-house').value    = a.house    || '';
$('#loc-street').value   = a.street   || '';
$('#loc-town').value     = a.town     || '';
$('#loc-county').value   = a.county   || '';
$('#loc-postcode').value = a.postcode || (pc.toUpperCase());
};
listEl.appendChild(b);
});
} catch (e) {
console.warn('[getaddress] lookup error:', e?.message);
listEl.innerHTML = 'Lookup failed (network, token, or CORS).';
}
};
// Save
$('#loc-save').onclick = async () => {
const name     = ($('#loc-name').value || '').trim();
const house    = ($('#loc-house').value || '').trim();
const street   = ($('#loc-street').value || '').trim();
const town     = ($('#loc-town').value || '').trim();
const county   = ($('#loc-county').value || '').trim();
const postcode = ($('#loc-postcode').value || '').trim().toUpperCase();
if (!name) { toast('Location Name is required.'); return; }
// Keep combined line for legacy UI; also store structured fields
const addressCombined = [house, street].filter(Boolean).join(' ').trim();
try {
if (prefill.id) {
await db.collection('locations').doc(prefill.id).update({
name, address: addressCombined, postcode, city: town,
house, street, town, county
});
close({ id: prefill.id, name });
} else {
const ref = await db.collection('locations').add({
name, address: addressCombined, postcode, city: town,
house, street, town, county,
createdAt: firebase.firestore.FieldValue.serverTimestamp()
});
close({ id: ref.id, name });
}
} catch (e) {
toast(e.message || 'Could not save');
}
};
function toast(msg) {
const m = $('#loc-msg');
m.textContent = msg;
m.classList.remove('hidden');
setTimeout(() => m.classList.add('hidden'), 1800);
}
});
}
/* =================== CALENDAR PAGE =================== */
async function loadCalendar(){
const wrap = document.getElementById('calendar-list');
if(wrap && !document.getElementById('cal-grid')){
wrap.innerHTML = `
      
        
          <button class="btn btn-ghost" id="cal-back" aria-label="Back">◀ Back</button>
          Month YYYY
          
            <button class="btn btn-ghost" id="cal-prev" aria-label="Previous month">◀</button>
            <button class="btn btn-ghost" id="cal-next" aria-label="Next month">▶</button>
          
        
        
        
        
        
          Date
          Time (optional)
Location
<select id="cal-loc-select"></select>

          
            <button class="btn" id="cal-add-loc">+ Add new location</button>
          
          
            <button class="btn btn-primary" id="cal-save">Save schedule</button>
            <button class="btn btn-danger" id="cal-clear">Remove from calendar</button>
          
        
      `;
  }
await refreshCalendarOnly();
const back = document.getElementById('cal-back');
if(back){ back.onclick = ()=>{ location.hash = 'viewing'; }; }
const prev = document.getElementById('cal-prev');
const next = document.getElementById('cal-next');
if(prev) prev.onclick = ()=>{ calOffset -= 1; refreshCalendarOnly(); };
if(next) next.onclick = ()=>{ calOffset += 1; refreshCalendarOnly(); };
await populateCalendarEditor();
}
async function populateCalendarEditor(){
const filmId = sessionStorage.getItem('scheduleTarget');
const dateInp = document.getElementById('cal-date');
const timeInp = document.getElementById('cal-time');
const sel     = document.getElementById('cal-loc-select');
const saveBtn = document.getElementById('cal-save');
const clearBtn= document.getElementById('cal-clear');
const addBtn  = document.getElementById('cal-add-loc');
if(!dateInp || !timeInp || !sel) return;
const locSnap = await db.collection('locations').orderBy('name').get();
const locs = locSnap.docs.map(d=>({ id:d.id, ...(d.data()) }));
sel.innerHTML = <option value="">Select location…</option> +
locs.map(l=><option value="${l.id}">${l.name||'(no name)'}</option>).join('');
if(!filmId){
if(saveBtn) saveBtn.disabled = true;
if(clearBtn) clearBtn.disabled = true;
}else{
if(saveBtn) saveBtn.disabled = false;
if(clearBtn) clearBtn.disabled = false;
const snap = await db.collection('films').doc(filmId).get();
if(snap.exists){
const f = snap.data();
if(f.viewingDate && typeof f.viewingDate.toDate === 'function'){
dateInp.value = f.viewingDate.toDate().toISOString().slice(0,10);
} else dateInp.value = '';
timeInp.value = f.viewingTime || '';
sel.value = f.viewingLocationId || '';
}
}
if(addBtn){
addBtn.onclick = async ()=>{
const created = await showAddLocationModal();
if(created){
await populateCalendarEditor();
sel.value = created.id;
}
};
}
if(saveBtn){
saveBtn.onclick = async ()=>{
if(!filmId){ alert('Select a film from Viewing or a pill in the calendar first.'); return; }
const dateVal = dateInp.value;
const timeVal = timeInp.value || '';
const locId   = sel.value;
if(!dateVal){ alert('Pick a date'); return; }
let locName = '';
if(locId){
const ld = await db.collection('locations').doc(locId).get();
locName = ld.exists ? (ld.data().name || '') : '';
}
const ts = firebase.firestore.Timestamp.fromDate(new Date(dateVal+'T00:00:00'));
await db.collection('films').doc(filmId).update({
viewingDate: ts,
viewingTime: timeVal,
viewingLocationId: locId || '',
viewingLocationName: locName
});
await refreshCalendarOnly();
alert('Saved.');
};
}
if(clearBtn){
clearBtn.onclick = async ()=>{
if(!filmId) return;
if(!confirm('Remove from calendar?')) return;
await db.collection('films').doc(filmId).update({
viewingDate: null,
viewingTime: '',
viewingLocationId: '',
viewingLocationName: ''
});
dateInp.value=''; timeInp.value=''; sel.value='';
await refreshCalendarOnly();
};
}
}
async function prefillCalendarEditor(filmId){
sessionStorage.setItem('scheduleTarget', filmId);
await populateCalendarEditor();
}
/* =================== VOTING =================== */
async function loadVote(){
const docs = await fetchByStatus('voting');
els.voteList.innerHTML='';
if(!docs.length){ els.voteList.innerHTML = 'No films in Voting.'; return; }
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
parts.push(<span class="badge">${who}: ${what}</span>);
}
return parts.join(' ');
})();
let myVoteVal = 0;
if(my){
const vSnap = await db.collection('films').doc(f.id).collection('votes').doc(my).get();
if(vSnap.exists) myVoteVal = vSnap.data().value || 0;
}
const actions = `
      
        <button class="btn btn-ghost" data-vote="1" data-id="${f.id}" aria-pressed="${myVoteVal===1}">👍 Yes</button>
        <button class="btn btn-ghost" data-vote="-1" data-id="${f.id}" aria-pressed="${myVoteVal===-1}">👎 No</button>
      
      Yes: ${yes} No: ${no}
      ${listVotes}
      
        <button class="btn" data-act="to-discard" data-id="${f.id}">Discard</button>
      
    `;
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
if(yes>=4){
await ref.update({ status:'uk_check' });
} else if(no>=4){
await ref.update({ status:'discarded' });
}
}
/* =================== UK CHECK =================== */
async function loadUk(){
const docs = await fetchByStatus('uk_check');
els.ukList.innerHTML = '';
if(!docs.length){ els.ukList.innerHTML = 'Nothing awaiting UK distributor check.'; return; }
docs.forEach(doc=>{
const f = { id: doc.id, ...doc.data() };
const actions = `
      
        <button class="btn btn-accent" data-act="uk-yes" data-id="${f.id}">Distributor Confirmed ✓</button>
        <button class="btn btn-warn" data-act="uk-no" data-id="${f.id}">No Distributor</button>
      
    `;
    els.ukList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });
  els.ukList.querySelectorAll('button[data-id]').forEach(b=>{
    b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id));
  });
}
/* =================== GREEN LIST =================== */
async function loadGreen(){
const docs = await fetchByStatus('greenlist');
els.greenList.innerHTML = '';
if(!docs.length){ els.greenList.innerHTML = 'Green List is empty.'; return; }
docs.forEach(doc=>{
const f = { id: doc.id, ...doc.data() };
const greenAt = (f.greenAt && typeof f.greenAt.toDate === 'function') ? f.greenAt.toDate().toISOString().slice(0,10) : '—';
const actions = `
      
        Green since: ${greenAt}
        <button class="btn btn-primary" data-act="to-nextprog" data-id="${f.id}">→ Next Programme</button>
        <button class="btn" data-act="to-archive" data-id="${f.id}">Archive</button>
      `;
    els.greenList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });
  els.greenList.querySelectorAll('button[data-id]').forEach(b=>{
    b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id));
  });
}
/* =================== NEXT PROGRAMME =================== */
async function loadNextProgramme(){
const docs = await fetchByStatus('next_programme');
els.nextProgList.innerHTML = `
    
      <button class="btn btn-danger" id="btn-archive-all">Archive all</button>
    
  `;
  const ba = document.getElementById('btn-archive-all');
  if(ba) ba.addEventListener('click', archiveAllNextProg);
if(!docs.length){
els.nextProgList.insertAdjacentHTML('beforeend', 'No films in Next Programme.');
return;
}
docs.forEach(doc=>{
const f = { id: doc.id, ...doc.data() };
const greenAt = (f.greenAt && typeof f.greenAt.toDate === 'function') ? f.greenAt.toDate().toISOString().slice(0,10) : '—';
const actions = `
      
        Green since: ${greenAt}
        <button class="btn" data-act="to-archive" data-id="${f.id}">Archive</button>
      `;
    els.nextProgList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });
  els.nextProgList.querySelectorAll('button[data-id]').forEach(b=>{
    b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id));
  });
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
if(!docs.length){ els.discardedList.innerHTML = 'Discard list is empty.'; return; }
docs.forEach(doc=>{
const f = { id: doc.id, ...doc.data() };
const actions = `
      
        <button class="btn btn-ghost" data-act="restore" data-id="${f.id}">Restore to Pending</button>
        <button class="btn" data-act="to-archive" data-id="${f.id}">Archive</button>
      `;
    els.discardedList.insertAdjacentHTML('beforeend', detailCard(f, actions));
  });
  els.discardedList.querySelectorAll('button[data-id]').forEach(b=>{
    b.addEventListener('click',()=>adminAction(b.dataset.act,b.dataset.id));
  });
}
/* =================== ARCHIVE =================== */
async function loadArchive(){
const docs = await fetchByStatus('archived');
els.archiveList.innerHTML = '';
if(!docs.length){ els.archiveList.innerHTML = 'No archived films yet.'; return; }
docs.forEach(doc=>{
const f = { id: doc.id, ...doc.data() };
const origin = f.archivedFrom || '';
const right = origin ? <span class="badge">${origin}</span> : '';
els.archiveList.insertAdjacentHTML('beforeend', pendingCard(f, right));
});
}
/* =================== Addresses (Admin) =================== */
async function loadAddressesAdmin(){
const tbody = els.addressesTable;
const msg = els.addressesAdminMsg;
if(!tbody) return;
tbody.innerHTML = '';
const snap = await db.collection('locations').orderBy('name').get();
if (snap.empty) {
if (msg){ msg.textContent = 'No saved addresses yet.'; msg.classList.remove('hidden'); }
return;
}
if (msg) msg.classList.add('hidden');
snap.docs.forEach(d=>{
const l = { id:d.id, ...d.data() };
const tr = document.createElement('tr');
tr.innerHTML = `
      ${l.name || ''}
      ${l.address || ''}
      ${l.city || ''}
      ${l.postcode || ''}
      
        <button class="btn btn-ghost" data-edit="${l.id}">Edit</button>
        <button class="btn btn-danger" data-del="${l.id}">Delete</button>
      `;
    tbody.appendChild(tr);
  });
tbody.addEventListener('click', async (e)=>{
const editBtn = e.target.closest('button[data-edit]');
const delBtn = e.target.closest('button[data-del]');
if (editBtn){
const id = editBtn.dataset.edit;
await showAddLocationModal({ id });
loadAddressesAdmin();
}
if (delBtn){
const id = delBtn.dataset.del;
if (confirm('Delete this address?')){
await db.collection('locations').doc(id).delete();
loadAddressesAdmin();
}
}
});
document.getElementById('addr-refresh')?.addEventListener('click', loadAddressesAdmin);
}
/* =================== Admin actions =================== */
async function adminAction(action, filmId){
const ref = db.collection('films').doc(filmId);
try{
if(action==='to-discard') await ref.update({ status:'discarded' });
if(action==='restore')    await ref.update({ status:'intake' });
if(action==='to-voting')  await ref.update({ status:'voting' });
if (action === 'basic-validate') {
const snap = await ref.get();
const f = snap.data() || {};
const okRuntime = (f.runtimeMinutes != null) && (f.runtimeMinutes <= 150);
const missing = REQUIRED_BASIC_FIELDS.filter(k=>{
const v = f[k];
return v == null || (typeof v === 'string' && v.trim().length === 0);
});
if (!okRuntime) { alert('Runtime must be 150 min or less.'); return; }
if (missing.length) { alert('Complete Basic fields: ' + missing.join(', ')); return; }
try {
await ref.update({ 'criteria.basic_pass': true });
} catch (e) {
console.warn('criteria.basic_pass write blocked by rules; continuing with status only.', e);
}
await ref.update({ status: 'viewing' });
setView('viewing');
return;
}
if(action==='uk-yes'){
await ref.update({ hasUkDistributor:true, status:'greenlist', greenAt: firebase.firestore.FieldValue.serverTimestamp() });
}
if(action==='uk-no'){
await ref.update({ hasUkDistributor:false, status:'discarded' });
}
if(action==='to-nextprog'){ await ref.update({ status:'next_programme' }); }
if(action==='to-archive'){
const snap2 = await ref.get();
const cur = (snap2.exists && snap2.data().status) || '';
await ref.update({ status:'archived', archivedFrom: cur || '' });
}
routerFromHash();
}catch(e){ alert(e.message); }
}
/* =================== Boot =================== */
async function boot(){
const ok = await waitForFirebaseAndConfig(10000);
if(!ok){ alert('Missing Firebase config'); return; }
try { initFirebaseOnce(); } catch(e){ alert('Missing Firebase config'); return; }
// ✅ Complete Google redirect ASAP (mobile needs this)
try {
await firebase.auth().getRedirectResult();
} catch (err) {
console.warn('Redirect error:', err && err.message);
}
attachHandlers();
firebase.auth().onAuthStateChanged(async (u) => {
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
