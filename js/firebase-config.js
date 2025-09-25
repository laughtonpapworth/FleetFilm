
window.__FLEETFILM__CONFIG = {
  // --- Firebase required keys ---
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",

  // --- Optional keys used by app.js ---
  omdbApiKey: "YOUR_OMDB_KEY",          // if you have one
  getAddressIoKey: "YOUR_GETADDRESS_KEY" // if you have one
};

// (Optional but safe) If you prefer to initialize here, do it once:
if (window.firebase && firebase.apps && !firebase.apps.length) {
  firebase.initializeApp(window.__FLEETFILM__CONFIG);
}

