import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { initializeFirestore, doc, getDoc, setDoc, deleteDoc, onSnapshot, collection, query, orderBy, limit, Timestamp, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true
}, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export { signInWithPopup, onAuthStateChanged, doc, getDoc, setDoc, deleteDoc, onSnapshot, collection, query, orderBy, limit, Timestamp, getDocFromServer };
export type { User };
