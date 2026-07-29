/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  type User
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  doc,
  getDoc,
  getFirestore,
  setDoc,
  updateDoc,
  writeBatch
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { validateRuntimeConfiguration } from './config/runtimeValidation';
import { FUNCTIONS_REGION } from './config/firebaseFunctions';
import {
  firebaseErrorCode,
  firebaseErrorMessage,
  recordAuthStage,
  stagingAuthMessage,
  type AuthStage,
} from './services/authDiagnostics';

const hasEnvironmentFirebaseConfig = Boolean(import.meta.env.VITE_FIREBASE_PROJECT_ID);
const firebaseConfig = hasEnvironmentFirebaseConfig
  ? {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
    }
  : __FIREBASE_FALLBACK_CONFIG__;

export const runtimeConfiguration = validateRuntimeConfiguration(firebaseConfig);
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

const storageBucket = String(firebaseConfig.storageBucket || '').trim();
if (!storageBucket) throw new Error('Firebase storageBucket is missing');
export const storage = getStorage(app, `gs://${storageBucket}`);

recordAuthStage({
  stage: 'AUTH-01',
  status: 'PASS',
  code: 'ok',
  message: `Firebase initialized for ${runtimeConfiguration.projectId}.`,
  source: 'src/firebase.ts module initialization',
});

export type SmartGuardRole = 'Guard' | 'ShiftHead' | 'Manager' | 'Admin';

export interface StaffProfileInput {
  username: string;
  operator_name: string;
  role: SmartGuardRole;
  shift?: string;
  phone?: string;
  status?: 'Active' | 'Inactive';
}

export const normalizeUsername = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, '');

export const validateUsername = (value: string) =>
  /^[a-z0-9._-]{3,24}$/.test(normalizeUsername(value));

export const validatePin = (value: string) => /^\d{6}$/.test(value);

export type AuthSessionState =
  | 'idle'
  | 'anonymous-authenticating'
  | 'pin-verifying'
  | 'profile-loading'
  | 'authenticated'
  | 'failed';

export interface OperatorSessionProfile {
  user_id: string;
  auth_uid: string;
  account_id: string;
  operator_id: string;
  username: string;
  operator_name: string;
  auth_email?: string;
  role: SmartGuardRole;
  site_id: string;
  status: 'Active' | 'Inactive';
  shift?: string;
  phone?: string;
  auth_provider?: string;
  created_at?: unknown;
  updated_at?: unknown;
  last_login_at?: unknown;
}

export class AuthStageError extends Error {
  constructor(
    public readonly stage: AuthStage,
    public readonly firebaseCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthStageError';
  }
}

const failAuthStage = (stage: AuthStage, error: unknown, source: string, path?: string): never => {
  const code = firebaseErrorCode(error);
  recordAuthStage({
    stage,
    status: 'FAIL',
    code,
    message: firebaseErrorMessage(error),
    source,
    path,
  });
  throw new AuthStageError(stage, code, stagingAuthMessage(stage, error));
};

export function validateOperatorSessionProfile(
  uid: string,
  data: Record<string, unknown>,
): OperatorSessionProfile {
  if (data.auth_uid !== uid || data.user_id !== uid || !data.account_id || !data.operator_id) {
    throw new AuthStageError('AUTH-08', 'auth/profile-contract-mismatch', stagingAuthMessage('AUTH-08', {
      code: 'auth/profile-contract-mismatch',
    }));
  }
  if (!['Guard', 'ShiftHead', 'Manager', 'Admin'].includes(String(data.role || ''))) {
    throw new AuthStageError('AUTH-09', 'auth/invalid-role', stagingAuthMessage('AUTH-09', {
      code: 'auth/invalid-role',
    }));
  }
  if (!String(data.site_id || '').trim()) {
    throw new AuthStageError('AUTH-10', 'auth/missing-site', stagingAuthMessage('AUTH-10', {
      code: 'auth/missing-site',
    }));
  }
  if (data.status !== 'Active') {
    throw new AuthStageError('AUTH-08', 'auth/inactive-profile', 'บัญชีนี้ถูกปิดใช้งาน');
  }
  return { ...data, user_id: uid } as unknown as OperatorSessionProfile;
}

const internalEmailFor = (username: string, version?: string) => {
  const normalized = normalizeUsername(username);
  const suffix = version ? `.${version}` : '';
  return `${normalized}${suffix}@smartguard.local`;
};

export async function prepareAuthPersistence(): Promise<void> {
  await setPersistence(auth, browserLocalPersistence);
}

export async function signInWithUsernamePin(
  username: string,
  pin: string,
  onStateChange?: (state: AuthSessionState) => void,
) {
  const normalized = normalizeUsername(username);

  if (!validateUsername(normalized)) {
    throw new Error('Username ไม่ถูกต้อง');
  }

  if (!validatePin(pin)) {
    throw new Error('PIN ต้องเป็นตัวเลข 6 หลัก');
  }

  try {
    await prepareAuthPersistence();
  } catch (error) {
    failAuthStage('AUTH-01', error, 'src/firebase.ts prepareAuthPersistence');
  }

  onStateChange?.('anonymous-authenticating');
  let credential: { user: User };
  try {
    credential = auth.currentUser?.isAnonymous
      ? { user: auth.currentUser }
      : await signInAnonymously(auth);
    recordAuthStage({
      stage: 'AUTH-02',
      status: 'PASS',
      code: 'ok',
      message: 'Anonymous Firebase authentication completed.',
      source: 'src/firebase.ts signInWithUsernamePin',
    });
  } catch (error) {
    failAuthStage('AUTH-02', error, 'src/firebase.ts signInWithUsernamePin');
  }
  if (!credential.user.uid) {
    failAuthStage('AUTH-03', { code: 'auth/missing-uid' }, 'src/firebase.ts signInWithUsernamePin');
  }
  recordAuthStage({
    stage: 'AUTH-03',
    status: 'PASS',
    code: 'ok',
    message: 'Anonymous Firebase UID obtained.',
    source: 'src/firebase.ts signInWithUsernamePin',
  });

  onStateChange?.('pin-verifying');
  const callable = httpsCallable<{ username: string; pin: string }, { profile: any }>(
    getFunctions(undefined, FUNCTIONS_REGION),
    'verifyOperatorPin',
  );
  recordAuthStage({
    stage: 'AUTH-04',
    status: 'PASS',
    code: 'invoked',
    message: 'verifyOperatorPin callable invoked.',
    source: 'src/firebase.ts signInWithUsernamePin',
  });
  let callableResult;
  try {
    callableResult = await callable({ username: normalized, pin });
    recordAuthStage({
      stage: 'AUTH-05',
      status: 'PASS',
      code: 'ok',
      message: 'verifyOperatorPin callable returned successfully.',
      source: 'src/firebase.ts signInWithUsernamePin',
    });
  } catch (error) {
    await signOut(auth).catch(() => undefined);
    failAuthStage('AUTH-05', error, 'src/firebase.ts signInWithUsernamePin');
  }

  if (callableResult.data.profile?.auth_uid !== credential.user.uid) {
    await signOut(auth).catch(() => undefined);
    failAuthStage('AUTH-06', { code: 'auth/profile-write-not-confirmed' }, 'src/firebase.ts signInWithUsernamePin', `users/${credential.user.uid}`);
  }
  recordAuthStage({
    stage: 'AUTH-06',
    status: 'PASS',
    code: 'ok',
    message: 'Callable confirmed canonical session profile creation.',
    source: 'functions/src/operatorAuthService.ts verifyOperatorPinLogin',
    path: `users/${credential.user.uid}`,
  });

  onStateChange?.('profile-loading');
  let profileSnap;
  try {
    profileSnap = await getDoc(doc(db, 'users', credential.user.uid));
  } catch (error) {
    await signOut(auth).catch(() => undefined);
    failAuthStage('AUTH-07', error, 'src/firebase.ts signInWithUsernamePin', `users/${credential.user.uid}`);
  }

  if (!profileSnap.exists()) {
    await signOut(auth);
    failAuthStage('AUTH-07', { code: 'auth/profile-not-found' }, 'src/firebase.ts signInWithUsernamePin', `users/${credential.user.uid}`);
  }
  recordAuthStage({
    stage: 'AUTH-07',
    status: 'PASS',
    code: 'ok',
    message: 'Canonical session profile read completed.',
    source: 'src/firebase.ts signInWithUsernamePin',
    path: `users/${credential.user.uid}`,
  });

  let profile: OperatorSessionProfile;
  try {
    profile = validateOperatorSessionProfile(credential.user.uid, profileSnap.data());
  } catch (error) {
    await signOut(auth).catch(() => undefined);
    if (error instanceof AuthStageError) {
      recordAuthStage({
        stage: error.stage,
        status: 'FAIL',
        code: error.firebaseCode,
        message: error.message,
        source: 'src/firebase.ts validateOperatorSessionProfile',
        path: `users/${credential.user.uid}`,
      });
      throw error;
    }
    failAuthStage('AUTH-08', error, 'src/firebase.ts validateOperatorSessionProfile', `users/${credential.user.uid}`);
  }
  recordAuthStage({ stage: 'AUTH-08', status: 'PASS', code: 'ok', message: 'Account and operator identity resolved.', source: 'src/firebase.ts validateOperatorSessionProfile', path: `users/${credential.user.uid}` });
  recordAuthStage({ stage: 'AUTH-09', status: 'PASS', code: 'ok', message: `Role loaded: ${profile.role}.`, source: 'src/firebase.ts validateOperatorSessionProfile', path: `users/${credential.user.uid}` });
  recordAuthStage({ stage: 'AUTH-10', status: 'PASS', code: 'ok', message: 'Site ID loaded.', source: 'src/firebase.ts validateOperatorSessionProfile', path: `users/${credential.user.uid}` });

  return {
    firebaseUser: credential.user,
    profile
  };
}

export async function signOutSmartGuard(): Promise<void> {
  await signOut(auth);
}

/** Returns whether the one-time Admin bootstrap marker has not been created. */
export async function isFirstAdminSetupAvailable(): Promise<boolean> {
  const bootstrapSnapshot = await getDoc(
    doc(db, 'systemSettings', 'authBootstrap'),
  );
  return !bootstrapSnapshot.exists();
}

/** First-run setup. Firestore rules allow this only while authBootstrap does not exist. */
export async function bootstrapFirstAdmin(pin: string, operatorName = 'แอดมิน สูงสุด (MJC)') {
  if (!validatePin(pin)) throw new Error('PIN ต้องเป็นตัวเลข 6 หลัก');
  if (!(await isFirstAdminSetupAvailable())) {
    throw new Error('ระบบถูกตั้งค่าแล้ว');
  }
  await prepareAuthPersistence();
  const credential = await createUserWithEmailAndPassword(auth, internalEmailFor('admin'), pin);
  if (!(await isFirstAdminSetupAvailable())) {
    await signOutSmartGuard();
    throw new Error('ระบบถูกตั้งค่าแล้ว');
  }
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', credential.user.uid), {
    user_id: credential.user.uid,
    auth_uid: credential.user.uid,
    auth_email: internalEmailFor('admin'),
    username: 'admin',
    operator_name: operatorName,
    role: 'Admin',
    shift: 'ทั่วไป',
    phone: '',
    status: 'Active',
    created_at: now,
    updated_at: now
  });
  batch.set(doc(db, 'loginDirectory', 'admin'), {
    username: 'admin',
    uid: credential.user.uid,
    auth_email: internalEmailFor('admin'),
    status: 'Active',
    updated_at: now
  });
  batch.set(doc(db, 'systemSettings', 'authBootstrap'), {
    setting_key: 'authBootstrap',
    setting_value: 'completed',
    setting_type: 'system',
    description: 'Username + PIN authentication initialized',
    updated_by: operatorName,
    updated_at: now
  });
  await batch.commit();
  return { firebaseUser: credential.user, profile: {
    user_id: credential.user.uid,
    auth_uid: credential.user.uid,
    auth_email: internalEmailFor('admin'),
    username: 'admin',
    operator_name: operatorName,
    role: 'Admin' as const,
    shift: 'ทั่วไป',
    phone: '',
    status: 'Active',
    created_at: now,
    updated_at: now
  }};
}

function getSecondaryAuth() {
  const name = 'smartguard-admin-user-creator';
  const secondaryApp = getApps().find(a => a.name === name) || initializeApp(firebaseConfig, name);
  return getAuth(secondaryApp);
}

export async function createStaffAccount(profile: StaffProfileInput, pin: string) {
  const username = normalizeUsername(profile.username);
  if (!validateUsername(username)) throw new Error('Username ต้องมี 3–24 ตัว ใช้ a-z, 0-9, จุด, ขีดกลาง หรือขีดล่าง');
  if (!validatePin(pin)) throw new Error('PIN ต้องเป็นตัวเลข 6 หลัก');
  const callable = httpsCallable(getFunctions(undefined, FUNCTIONS_REGION), 'createStaffAccount');
  const result = await callable({
    username,
    pin,
    operatorName: profile.operator_name,
    role: profile.role,
    shift: profile.shift || 'ทั่วไป',
    phone: profile.phone || '',
    siteId: sessionStorage.getItem('selected_site_id') || '',
    status: profile.status || 'Active',
  });
  return result.data as any;
}

/**
 * Free-tier PIN reset: creates a replacement Firebase Auth account and moves the
 * active Firestore profile to the new UID. The old Auth identity remains orphaned,
 * but its Firestore profile is disabled so it cannot access application data.
 */
export async function rotateStaffPin(existingUser: any, newPin: string) {
  if (!validatePin(newPin)) throw new Error('PIN ต้องเป็นตัวเลข 6 หลัก');
  const username = normalizeUsername(existingUser.username || '');
  if (!validateUsername(username)) throw new Error('ผู้ใช้นี้ยังไม่มี Username ที่ถูกต้อง');

  const callable = httpsCallable(getFunctions(undefined, FUNCTIONS_REGION), 'resetStaffPin');
  await callable({ username, pin: newPin });
  return { ...existingUser, username };
}


export interface StaffProfileUpdateInput {
  operator_name: string;
  role: SmartGuardRole;
  shift: string;
  phone: string;
  status: 'Active' | 'Inactive';
}

export async function updateStaffProfile(
  existingUser: any,
  updates: StaffProfileUpdateInput
) {
  const uid = String(
    existingUser.auth_uid ||
    existingUser.user_id ||
    existingUser.__document_id ||
    ''
  ).trim();

  const username = normalizeUsername(existingUser.username || '');

  if (!uid) {
    throw new Error('ไม่พบ Firebase UID ของผู้ใช้งาน');
  }

  if (!updates.operator_name.trim()) {
    throw new Error('กรุณากรอกชื่อผู้ปฏิบัติงาน');
  }

  const now = new Date().toISOString();

  const userUpdate = {
    operator_name: updates.operator_name.trim(),
    role: updates.role,
    shift: updates.shift || 'ทั่วไป',
    phone: updates.phone.trim(),
    status: updates.status,
    updated_at: now
  };

  const batch = writeBatch(db);

  batch.update(
    doc(db, 'users', uid),
    userUpdate
  );

  if (username) {
    batch.set(
      doc(db, 'loginDirectory', username),
      {
        username,
        uid,
        auth_email: existingUser.auth_email || internalEmailFor(username),
        status: updates.status,
        updated_at: now
      },
      { merge: true }
    );
  }

  await batch.commit();

  return {
    ...existingUser,
    ...userUpdate,
    user_id: uid,
    auth_uid: uid,
    username
  };
}

export async function setStaffStatus(user: any, status: 'Active' | 'Inactive') {
  const username = normalizeUsername(user.username || '');
  if (!validateUsername(username)) throw new Error('ผู้ใช้นี้ยังไม่มี Username ที่ถูกต้อง');
  const callable = httpsCallable(getFunctions(undefined, FUNCTIONS_REGION), 'setStaffAccountStatus');
  await callable({ username, status });
}

export async function listStaffAccounts() {
  const callable = httpsCallable<Record<string, never>, { staff: any[] }>(
    getFunctions(undefined, FUNCTIONS_REGION),
    'listStaffAccounts',
  );
  const result = await callable({});
  return result.data.staff;
}

export const onAuthStateChange = (callback: (user: User | null) => void): (() => void) =>
  onAuthStateChanged(auth, callback);
