// js/firebase-config.js  (NO <script> TAGS IN THIS FILE)

// 1) Your Firebase config (fill in your real values)
window.__FLEETFILM__CONFIG = {
  apiKey: "AIzaSyDb3RwlWUutBwBg8BGwAPkMG0Iv1_of5Mg",
  authDomain: "fleetfilm-8829e.firebaseapp.com",
  projectId: "fleetfilm-8829e",
  storageBucket: "fleetfilm-8829e.appspot.com",
  messagingSenderId: "464150585740",
  appId: "1:464150585740:web:a047ae9b57ce149bea76a9",
  getAddressIoKey: 'Ll_nRO8O302rbH7q5roJzA47908',   // if you have one
  omdbApiKey: "3e90e2e2",
  // Optional keys used by your app:
          // if you have one
 
};

// 2) Hard-init Firebase immediately so redirect completion can run on mobile
(function initFirebase() {
  if (!window.firebase) return;               // SDK comes from index.html
  if (firebase.apps && firebase.apps.length) return;
  firebase.initializeApp(window.__FLEETFILM__CONFIG);
})();



