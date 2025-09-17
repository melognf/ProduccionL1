import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBbvxJbxIIjM45-woFxNIfzCwV0dgrBuNs",
  authDomain: "produccion-51765.firebaseapp.com",
  projectId: "produccion-51765",
  storageBucket: "produccion-51765.firebasestorage.app",
  messagingSenderId: "360320005119",
  appId: "1:360320005119:web:781e2820f1456d66166dca"
};

export const app = initializeApp(firebaseConfig);
export const db  = getFirestore(app);








