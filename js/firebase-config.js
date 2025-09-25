
window.__FLEETFILM__CONFIG = {
  // --- Firebase required keys ---
  apiKey: "AIzaSyXXXXXXX-REPLACE_WITH_YOURS",
  authDomain: "fleetfilm-12345.firebaseapp.com",
  projectId: "fleetfilm-12345",
  storageBucket: "fleetfilm-12345.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456",

  // --- Optional keys used by app.js ---
  omdbApiKey: "YOUR_OMDB_KEY",            // if you use OMDb
  getAddressIoKey: "YOUR_GETADDRESS_KEY"  // if you use getAddress.io
};

// (Optional init if not done elsewhere — safe to include)
if (window.firebase && firebase.apps && !firebase.apps.length) {
  firebase.initializeApp(window.__FLEETFILM__CONFIG);
}


