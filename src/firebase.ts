import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
console.log("Firebase Config:", firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || "(default)");
console.log("Firestore initialized with DB:", firebaseConfig.firestoreDatabaseId || "(default)");
export default app;
