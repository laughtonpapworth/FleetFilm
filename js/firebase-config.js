
<!-- js/firebase-config.js -->
<script>
  // Your Firebase project config
  window.__FLEETFILM__CONFIG = {
    apiKey: "AIza...your_key...",
    authDomain: "fleetfilm-8829e.firebaseapp.com",
    projectId: "fleetfilm-8829e",
    storageBucket: "fleetfilm-8829e.appspot.com",
    messagingSenderId: "464150585740",
    appId: "1:464150585740:web:xxxxxxxxxxxxxxxx",
    // Optional keys used elsewhere in your app:
    omdbApiKey: "",          // if you have one
    getaddressIoKey: ""      // if you have one
  };

  // **Hard-init Firebase here** so it’s ready the moment app.js runs
  (function initFirebase() {
    if (!window.firebase) return; // Firebase SDK is loaded by index.html
    if (firebase.apps && firebase.apps.length) return;
    firebase.initializeApp(window.__FLEETFILM__CONFIG);
  })();
</script>



