/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
  signInWithPopup
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

console.log('[Smart Guard Firebase Config]', {
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain,
  appId: firebaseConfig.appId,
  origin: window.location.origin
});

export const auth = getAuth(app);

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error('[Smart Guard Auth] Failed to set persistence:', error);
});

export const db = getFirestore(
  app,
  'ai-studio-smartguardsystem-e2a4586d-b4ef-4694-9036-1c64c9967e71'
);

const storageBucket = String(firebaseConfig.storageBucket || '').trim();

if (!storageBucket) {
  throw new Error('Firebase storageBucket is missing');
}

export const storage = getStorage(app, `gs://${storageBucket}`);

console.log('[Smart Guard Storage Config]', {
  configuredBucket: storageBucket,
  runtimeBucket: storage.app.options.storageBucket,
  origin: window.location.origin
});

export const provider = new GoogleAuthProvider();

provider.setCustomParameters({
  prompt: 'select_account'
});

export const handleRedirectResult = async (): Promise<User | null> => {
  try {
    console.log('[Smart Guard Auth] Checking redirect result...');

    const result = await getRedirectResult(auth);

    if (result?.user) {
      console.log('[Smart Guard Auth] Redirect login success:', result.user.email);
      return result.user;
    }

    console.log('[Smart Guard Auth] No redirect result.');
    return null;
  } catch (error) {
    console.error('[Smart Guard Auth] Redirect result error:', error);
    throw error;
  }
};

export const signInWithGooglePopup = async (): Promise<User | null> => {
  try {
    console.log('[Smart Guard Auth] Starting Firebase popup login...');
    const result = await signInWithPopup(auth, provider);
    if (result?.user) {
      console.log('[Smart Guard Auth] Popup login success:', result.user.email);
      return result.user;
    }
    return null;
  } catch (error) {
    console.error('[Smart Guard Auth] Popup login failed:', error);
    throw error;
  }
};

export const signInWithGoogle = async (): Promise<void> => {
  console.log('[Smart Guard Auth] Starting Firebase redirect login...');
  console.log('[Smart Guard Auth] Current origin:', window.location.origin);
  sessionStorage.setItem('smart_guard_login_started', 'true');
  await signInWithRedirect(auth, provider);
};

export const logout = async (): Promise<void> => {
  console.log('[Smart Guard Auth] Signing out...');
  sessionStorage.clear();
  localStorage.removeItem('selected_operator');
  await signOut(auth);
};

export const onAuthStateChange = (
  callback: (user: User | null) => void
): (() => void) => {
  return onAuthStateChanged(auth, (user) => {
    console.log('[Smart Guard Auth] Auth state changed:', {
      email: user?.email || null,
      uid: user?.uid || null
    });
    callback(user);
  });
};

export const isSandboxLoginEnabled = (): boolean => {
  const env = (import.meta as any).env;
  
  // Production environment check: strictly block sandbox login in production mode
  if (env?.PROD === true || env?.MODE === 'production') {
    return false;
  }

  const isBypassEnabled = env?.VITE_ENABLE_SANDBOX_LOGIN === 'true' || env?.VITE_ENABLE_SANDBOX_LOGIN === true;
  
  // Determine if running inside preview frame or local dev
  const isPreview = typeof window !== 'undefined' && (
    window.location.hostname.includes('localhost') || 
    window.location.hostname.includes('127.0.0.1') || 
    window.location.hostname.includes('ais-dev') || 
    window.self !== window.top
  );

  return (isBypassEnabled || isPreview) && env?.DEV === true;
};

export const bypassLoginForSandbox = async () => {
  if (!isSandboxLoginEnabled()) {
    throw new Error('Sandbox login is disabled in production.');
  }

  const mockUser = {
    uid: 'sandbox-bypass-uid',
    displayName: 'Sandbox Admin',
    email: 'sandbox@example.com',
    photoURL: ''
  };

  sessionStorage.setItem('g_mock_user', JSON.stringify(mockUser));
  return mockUser;
};