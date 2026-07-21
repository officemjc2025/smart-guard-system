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
  signInWithEmailAndPassword,
  signOut,
  type User
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getFirestore,
  setDoc,
  updateDoc,
  writeBatch
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

const storageBucket = String(firebaseConfig.storageBucket || '').trim();
if (!storageBucket) throw new Error('Firebase storageBucket is missing');
export const storage = getStorage(app, `gs://${storageBucket}`);

export type SmartGuardRole = 'Guard' | 'Shift Leader' | 'Manager' | 'Admin';

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

const internalEmailFor = (username: string, version?: string) => {
  const normalized = normalizeUsername(username);
  const suffix = version ? `.${version}` : '';
  return `${normalized}${suffix}@smartguard.local`;
};

export async function prepareAuthPersistence(): Promise<void> {
  await setPersistence(auth, browserLocalPersistence);
}

export async function signInWithUsernamePin(username: string, pin: string) {
  const normalized = normalizeUsername(username);

  if (!validateUsername(normalized)) {
    throw new Error('Username ไม่ถูกต้อง');
  }

  if (!validatePin(pin)) {
    throw new Error('PIN ต้องเป็นตัวเลข 6 หลัก');
  }

  // Username ถูกแปลงเป็นอีเมลภายในโดยตรง
  // ไม่อ่าน Firestore ก่อน Firebase Authentication
  const authEmail = internalEmailFor(normalized);

  await prepareAuthPersistence();

  const credential = await signInWithEmailAndPassword(
    auth,
    authEmail,
    pin
  );

  const profileSnap = await getDoc(
    doc(db, 'users', credential.user.uid)
  );

  if (!profileSnap.exists()) {
    await signOut(auth);
    throw new Error('ไม่พบข้อมูลผู้ใช้งาน กรุณาติดต่อ Admin');
  }

  const profile = {
    ...profileSnap.data(),
    user_id: credential.user.uid
  } as any;

  if (profile.status !== 'Active') {
    await signOut(auth);
    throw new Error('บัญชีนี้ถูกปิดใช้งาน');
  }

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
  const existing = await getDoc(doc(db, 'loginDirectory', username));
  if (existing.exists()) throw new Error('Username นี้ถูกใช้งานแล้ว');

  const secondaryAuth = getSecondaryAuth();
  const authEmail = internalEmailFor(username);
  const credential = await createUserWithEmailAndPassword(secondaryAuth, authEmail, pin);
  await signOut(secondaryAuth);

  const now = new Date().toISOString();
  const record = {
    user_id: credential.user.uid,
    auth_uid: credential.user.uid,
    auth_email: authEmail,
    username,
    operator_name: profile.operator_name,
    role: profile.role,
    shift: profile.shift || 'ทั่วไป',
    phone: profile.phone || '',
    status: profile.status || 'Active',
    created_at: now,
    updated_at: now
  };
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', credential.user.uid), record);
  batch.set(doc(db, 'loginDirectory', username), {
    username,
    uid: credential.user.uid,
    auth_email: authEmail,
    status: record.status,
    updated_at: now
  });
  await batch.commit();
  return record;
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

  const version = Date.now().toString(36);
  const authEmail = internalEmailFor(username, version);
  const secondaryAuth = getSecondaryAuth();
  const credential = await createUserWithEmailAndPassword(secondaryAuth, authEmail, newPin);
  await signOut(secondaryAuth);

  const now = new Date().toISOString();
  const oldUid = existingUser.auth_uid || existingUser.user_id;
  const replacement = {
    ...existingUser,
    user_id: credential.user.uid,
    auth_uid: credential.user.uid,
    auth_email: authEmail,
    username,
    status: 'Active',
    pinUpdatedAt: now,
    updated_at: now,
    replaced_auth_uid: oldUid || null
  };
  delete replacement.__document_id;
  delete replacement.pinHash;
  delete replacement.pinSalt;
  delete replacement.pinFailedAttempts;
  delete replacement.pinLockedUntil;

  const batch = writeBatch(db);
  batch.set(doc(db, 'users', credential.user.uid), replacement);
  batch.set(doc(db, 'loginDirectory', username), {
    username,
    uid: credential.user.uid,
    auth_email: authEmail,
    status: 'Active',
    updated_at: now
  });
  if (oldUid && oldUid !== credential.user.uid) {
    batch.update(doc(db, 'users', oldUid), {
      status: 'Inactive',
      replaced_by_uid: credential.user.uid,
      updated_at: now
    });
  }
  await batch.commit();
  return replacement;
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
  const uid = user.auth_uid || user.user_id;
  const username = normalizeUsername(user.username || '');
  const now = new Date().toISOString();
  await updateDoc(doc(db, 'users', uid), { status, updated_at: now });
  if (username) await setDoc(doc(db, 'loginDirectory', username), {
    username,
    uid,
    auth_email: user.auth_email,
    status,
    updated_at: now
  }, { merge: true });
}

export const onAuthStateChange = (callback: (user: User | null) => void): (() => void) =>
  onAuthStateChanged(auth, callback);
