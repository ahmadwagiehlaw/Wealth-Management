import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDCnrS0znj6l1ZLXCGzlibAPac0KL8s1gA",
    authDomain: "tradingportfolio-fa8c0.firebaseapp.com",
    projectId: "tradingportfolio-fa8c0",
    storageBucket: "tradingportfolio-fa8c0.firebasestorage.app",
    messagingSenderId: "208461626619",
    appId: "1:208461626619:web:2d3714f7fd31452576c45e"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };