// js/firebase-config.js  (NO <script> TAGS IN THIS FILE)

// 1) Your Firebase config (fill in your real values)
window.__FLEETFILM__CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "fleetfilm-8829e.firebaseapp.com",
  projectId: "fleetfilm-8829e",
  storageBucket: "fleetfilm-8829e.appspot.com",
  messagingSenderId: "464150585740",
  appId: "YOUR_APP_ID",

  // Optional keys used by your app:
  omdbApiKey: "",        // if you have one
  getaddressIoKey: ""    // if you have one
};

// 2) Hard-init Firebase immediately so redirect completion can run on mobile
(function initFirebase() {
  if (!window.firebase) return;               // SDK comes from index.html
  if (firebase.apps && firebase.apps.length) return;
  firebase.initializeApp(window.__FLEETFILM__CONFIG);
})();



