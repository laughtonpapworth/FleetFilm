// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDb3RwlWUutBwBg8BGwAPkMG0Iv1_of5Mg",
  authDomain: "fleetfilm-8829e.firebaseapp.com",
  projectId: "fleetfilm-8829e",
  storageBucket: "fleetfilm-8829e.firebasestorage.app",
  messagingSenderId: "464150585740",
  appId: "1:464150585740:web:a047ae9b57ce149bea76a9",
  measurementId: "G-EB6X7G79P8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);