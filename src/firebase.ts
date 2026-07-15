/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const requiredEnv = (name: string): string => {
  const value = import.meta.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const firebaseConfig = {
  apiKey: requiredEnv('VITE_FIREBASE_API_KEY'),
  authDomain: requiredEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: requiredEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: requiredEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: requiredEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: requiredEnv('VITE_FIREBASE_APP_ID'),
};

// ต้อง initialize ก่อนเรียก getAuth/getFirestore/getStorage
export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// ใช้ฐานข้อมูล default ของ SecurityProjectV1
export const db = getFirestore(app);

export const storage = getStorage(app);

export const provider = new GoogleAuthProvider();

provider.setCustomParameters({
  prompt: 'select_account',
});

setPersistence(auth, browserLocalPersistence).catch((error: unknown) => {
  console.error('[Smart Guard Auth] Failed to set persistence:', error);
});

console.log('[Smart Guard Firebase Config]', {
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain,
  origin: window.location.origin,
});

export const handleRedirectResult = async (): Promise<User | null> => {
  try {
    const result = await getRedirectResult(auth);
    return result?.user ?? null;
  } catch (error) {
    console.error('[Smart Guard Auth] Redirect result error:', error);
    throw error;
  }
};

export const signInWithGooglePopup = async (): Promise<User | null> => {
  try {
    const result = await signInWithPopup(auth, provider);
    return result?.user ?? null;
  } catch (error) {
    console.error('[Smart Guard Auth] Popup login failed:', error);
    throw error;
  }
};

export const signInWithGoogle = async (): Promise<void> => {
  console.log('[Smart Guard Auth] Starting Google login...', {
    origin: window.location.origin,
    projectId: firebaseConfig.projectId,
  });

  sessionStorage.setItem('smart_guard_login_started', 'true');

  const isLocalDevelopment =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  if (isLocalDevelopment) {
    const result = await signInWithPopup(auth, provider);

    console.log(
      '[Smart Guard Auth] Popup login successful:',
      result.user.email,
    );

    return;
  }

  await signInWithRedirect(auth, provider);
};

export const logout = async (): Promise<void> => {
  sessionStorage.clear();
  localStorage.removeItem('selected_operator');
  await signOut(auth);
};

export const onAuthStateChange = (
  callback: (user: User | null) => void,
): (() => void) => {
  return onAuthStateChanged(auth, callback);
};

export const isSandboxLoginEnabled = (): boolean => false;

export const bypassLoginForSandbox = async (): Promise<never> => {
  throw new Error('Sandbox login is disabled.');
};