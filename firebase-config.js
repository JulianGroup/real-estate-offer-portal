import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDoc, doc, setDoc, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAsIOzW20GIdsk1p0P8C3mFJsZVXUnFQrI",
  authDomain: "home-offer-in.firebaseapp.com",
  projectId: "home-offer-in",
  storageBucket: "home-offer-in.firebasestorage.app",
  messagingSenderId: "455066208575",
  appId: "1:455066208575:web:8526ef03f66f2a74ac2b8a",
  measurementId: "G-R860T3RZPX"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Export for use in other JS files
export { 
    auth, 
    db, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut, 
    updateProfile,
    sendPasswordResetEmail,
    doc, 
    setDoc, 
    getDoc,
    collection, 
    addDoc, 
    query, 
    where, 
    onSnapshot,
    getDocs
};
