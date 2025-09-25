
window.__FLEETFILM__CONFIG = {
  // --- Firebase required keys ---
  apiKey: "AIzaSyDb3RwlWUutBwBg8BGwAPkMG0Iv1_of5Mg",
  authDomain: "fleetfilm-8829e.firebaseapp.com",
  projectId: "fleetfilm-8829e",
  storageBucket: "fleetfilm-8829e.appspot.com",
  messagingSenderId: "464150585740",
  appId: "1:464150585740:web:a047ae9b57ce149bea76a9",
  measurementId: "G-EB6X7G79P8",

  // --- Optional keys used by app.js ---
  omdbApiKey: "3e90e2e2",            // if you use OMDb
  getAddressIoKey: "Ll_nRO8O302rbH7q5roJzA47908"  // if you use getAddress.io
};

// (Optional init if not done elsewhere — safe to include)
if (window.firebase && firebase.apps && !firebase.apps.length) {
  firebase.initializeApp(window.__FLEETFILM__CONFIG);
}


