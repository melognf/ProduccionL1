import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCjXg0AdNEablAHrdwY2Hgw43txb6WRE8w",
  authDomain: "control-de-produccion-50f3b.firebaseapp.com",
  projectId: "control-de-produccion-50f3b",
  storageBucket: "control-de-produccion-50f3b.firebasestorage.app",
  messagingSenderId: "883965428389",
  appId: "1:883965428389:web:ae02ae4df0bc5a04af434c"
};

export const app = initializeApp(firebaseConfig);
export const db  = getFirestore(app);








