// js/firebase-config.js  (NO <script> TAGS IN THIS FILE)

// 1) Your Firebase config (fill in your real values)
window.__FLEETFILM__CONFIG = {
  apiKey: "AIzaSyDb3RwlWUutBwBg8BGwAPkMG0Iv1_of5Mg",
  authDomain: "fleetfilm-8829e.firebaseapp.com",
  projectId: "fleetfilm-8829e",
  storageBucket: "fleetfilm-8829e.appspot.com",
  messagingSenderId: "464150585740",
  appId: "1:464150585740:web:a047ae9b57ce149bea76a9",
  getAddressIoKey: "Ll_nRO8O302rbH7q5roJzA47908",   // if you have one
  getAddressDomainToken: "dtoken_hEDzcyiWMr29d_9lXHs78ecw0pF6Q4P4G0bkXcztoXw4dkgerrsti41eyhADhPZyhn4J_DUwC8pBLxe0gvr8wYRW_IZ8lIihzOckSHe538gkcwB05z-gGl1oKCkonCW00c5O4NBUPk9s9Sc-5BDfHJPHxrq0AfRqeAzBRy8C06NoLZw4Srsc6zhep0E9LZp_Tv5IOznsZsbwURVrLxCWPZACFMZCIWfH55A4k_6-r-Y",
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



