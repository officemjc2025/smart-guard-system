import * as admin from 'firebase-admin';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { normalizeRole } from './validation';

const PIN_HASH_VERSION = 'scrypt-v1';
const PIN_KEY_LENGTH = 64;
const PIN_SALT_BYTES = 16;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const STAFF_ROLES = new Set(['Guard', 'ShiftHead', 'Manager', 'Admin']);

export function normalizeUsername(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

export function assertValidUsername(username: string) {
  if (!/^[a-z0-9._-]{3,24}$/.test(username)) {
    throw new HttpsError('invalid-argument', 'Username is invalid.');
  }
}

export function assertValidPin(pin: string) {
  if (!/^\d{6}$/.test(pin)) {
    throw new HttpsError('invalid-argument', 'PIN must be 6 digits.');
  }
}

export function hashPin(pin: string, salt = randomBytes(PIN_SALT_BYTES).toString('base64')) {
  assertValidPin(pin);
  const hash = scryptSync(pin, salt, PIN_KEY_LENGTH).toString('base64');
  return { algorithm: PIN_HASH_VERSION, salt, hash };
}

export function canonicalStaffRows(
  accounts: Array<{ id: string; data: admin.firestore.DocumentData }>,
  operators: Array<{ id: string; data: admin.firestore.DocumentData }>,
) {
  const accountById = new Map(accounts.map(item => [item.id, item.data]));
  return operators.map(({ id, data }) => {
    const accountId = String(data.account_id || '');
    const account = accountById.get(accountId) || {};
    return {
      user_id: id,
      operator_id: id,
      account_id: accountId,
      username: String(data.username || account.username || ''),
      login_email: '',
      operator_name: String(data.operator_name || ''),
      role: normalizeRole(String(data.role || account.role || 'Guard')),
      shift: String(data.shift || 'ทั่วไป'),
      phone: String(data.phone || ''),
      site_id: String(data.site_id || account.site_id || ''),
      status: data.status === 'Inactive' || account.status === 'Inactive' ? 'Inactive' : 'Active',
      created_at: data.created_at || account.created_at || null,
      updated_at: data.updated_at || account.updated_at || null,
    };
  });
}

async function requireAdmin(
  firestore: admin.firestore.Firestore,
  request: CallableRequest<unknown>,
) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication is required.');
  const profile = await firestore.collection('users').doc(request.auth.uid).get();
  if (!profile.exists || profile.get('status') !== 'Active' || profile.get('role') !== 'Admin') {
    throw new HttpsError('permission-denied', 'Admin role is required.');
  }
  return {
    uid: request.auth.uid,
    name: String(profile.get('operator_name') || profile.get('username') || 'Admin'),
    siteId: String(profile.get('site_id') || ''),
  };
}

export async function listCanonicalStaff(
  firestore: admin.firestore.Firestore,
  request: CallableRequest<Record<string, never>>,
) {
  await requireAdmin(firestore, request);
  const [accountSnapshot, operatorSnapshot] = await Promise.all([
    firestore.collection('accounts').get(),
    firestore.collection('operators').get(),
  ]);
  return {
    staff: canonicalStaffRows(
      accountSnapshot.docs.map(item => ({ id: item.id, data: item.data() })),
      operatorSnapshot.docs.map(item => ({ id: item.id, data: item.data() })),
    ),
  };
}

export interface CreateStaffRequest {
  username: string;
  pin: string;
  operatorName: string;
  role: string;
  shift?: string;
  phone?: string;
  siteId: string;
  status: 'Active' | 'Inactive';
}

export async function createCanonicalStaff(
  firestore: admin.firestore.Firestore,
  request: CallableRequest<CreateStaffRequest>,
) {
  const actor = await requireAdmin(firestore, request);
  const username = normalizeUsername(request.data.username);
  const pin = String(request.data.pin || '');
  const operatorName = String(request.data.operatorName || '').trim();
  const siteId = String(request.data.siteId || '').trim();
  const role = normalizeRole(String(request.data.role || ''));
  const status = request.data.status;
  assertValidUsername(username);
  assertValidPin(pin);
  if (!operatorName || !siteId) throw new HttpsError('invalid-argument', 'Operator name and site are required.');
  if (!STAFF_ROLES.has(role)) throw new HttpsError('invalid-argument', 'Role is invalid.');
  if (status !== 'Active' && status !== 'Inactive') {
    throw new HttpsError('invalid-argument', 'Status is invalid.');
  }
  const accountId = `account-${username}`;
  const operatorId = `operator-${username}`;
  const credential = hashPin(pin);
  const now = admin.firestore.FieldValue.serverTimestamp();
  await firestore.runTransaction(async transaction => {
    const credentialRef = firestore.collection('operatorCredentials').doc(username);
    const accountRef = firestore.collection('accounts').doc(accountId);
    const operatorRef = firestore.collection('operators').doc(operatorId);
    const existing = await transaction.get(credentialRef);
    if (existing.exists) throw new HttpsError('already-exists', 'Username is already in use.');
    transaction.create(accountRef, {
      account_id: accountId, username, role, site_id: siteId, status,
      created_at: now, updated_at: now,
    });
    transaction.create(operatorRef, {
      operator_id: operatorId, account_id: accountId, username,
      operator_name: operatorName, role, shift: String(request.data.shift || 'ทั่วไป'),
      phone: String(request.data.phone || ''), site_id: siteId, status,
      created_at: now, updated_at: now,
    });
    transaction.create(credentialRef, {
      username, operator_id: operatorId, account_id: accountId,
      algorithm: credential.algorithm, pin_salt: credential.salt, pin_hash: credential.hash,
      status, created_at: now, updated_at: now,
    });
    const auditRef = firestore.collection('auditLogs').doc(`AUD_${randomUUID()}`);
    transaction.create(auditRef, {
      module_name: 'IdentityAdministration', record_id: operatorId,
      action: 'CreateStaff', operator_id: actor.uid, account_uid: actor.uid,
      operator_name: actor.name, site_id: siteId, created_at: now,
      action_result: 'Success',
    });
  });
  return { accountId, operatorId, username, role, status, siteId };
}

export async function resetCanonicalStaffPin(
  firestore: admin.firestore.Firestore,
  request: CallableRequest<{ username: string; pin: string }>,
) {
  const actor = await requireAdmin(firestore, request);
  const username = normalizeUsername(request.data.username);
  const pin = String(request.data.pin || '');
  assertValidUsername(username);
  assertValidPin(pin);
  const credential = hashPin(pin);
  await firestore.runTransaction(async transaction => {
    const credentialRef = firestore.collection('operatorCredentials').doc(username);
    const snapshot = await transaction.get(credentialRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Staff credential was not found.');
    transaction.update(credentialRef, {
      algorithm: credential.algorithm,
      pin_salt: credential.salt,
      pin_hash: credential.hash,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.create(firestore.collection('auditLogs').doc(`AUD_${randomUUID()}`), {
      module_name: 'IdentityAdministration',
      record_id: String(snapshot.get('operator_id') || username),
      action: 'ResetStaffPin', operator_id: actor.uid, account_uid: actor.uid,
      operator_name: actor.name, site_id: actor.siteId,
      created_at: admin.firestore.FieldValue.serverTimestamp(), action_result: 'Success',
    });
  });
  return { username, reset: true };
}

export async function setCanonicalStaffStatus(
  firestore: admin.firestore.Firestore,
  request: CallableRequest<{ username: string; status: 'Active' | 'Inactive' }>,
) {
  const actor = await requireAdmin(firestore, request);
  const username = normalizeUsername(request.data.username);
  const status = request.data.status;
  assertValidUsername(username);
  if (status !== 'Active' && status !== 'Inactive') {
    throw new HttpsError('invalid-argument', 'Status is invalid.');
  }
  await firestore.runTransaction(async transaction => {
    const credentialRef = firestore.collection('operatorCredentials').doc(username);
    const credential = await transaction.get(credentialRef);
    if (!credential.exists) throw new HttpsError('not-found', 'Staff credential was not found.');
    const accountRef = firestore.collection('accounts').doc(String(credential.get('account_id')));
    const operatorRef = firestore.collection('operators').doc(String(credential.get('operator_id')));
    const now = admin.firestore.FieldValue.serverTimestamp();
    transaction.update(credentialRef, { status, updated_at: now });
    transaction.update(accountRef, { status, updated_at: now });
    transaction.update(operatorRef, { status, updated_at: now });
    transaction.create(firestore.collection('auditLogs').doc(`AUD_${randomUUID()}`), {
      module_name: 'IdentityAdministration',
      record_id: operatorRef.id,
      action: 'SetStaffStatus', operator_id: actor.uid, account_uid: actor.uid,
      operator_name: actor.name, site_id: actor.siteId, status,
      created_at: now, action_result: 'Success',
    });
  });
  return { username, status };
}

function verifyPin(pin: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(scryptSync(pin, salt, PIN_KEY_LENGTH).toString('base64'), 'base64');
  const expected = Buffer.from(expectedHash, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function publicOperatorProfile(
  authUid: string,
  operatorId: string,
  operator: admin.firestore.DocumentData,
) {
  return {
    user_id: authUid,
    auth_uid: authUid,
    operator_id: operatorId,
    account_id: String(operator.account_id || ''),
    username: String(operator.username || ''),
    operator_name: String(operator.operator_name || ''),
    role: String(operator.role || 'Guard'),
    shift: String(operator.shift || 'ทั่วไป'),
    phone: String(operator.phone || ''),
    site_id: String(operator.site_id || 'site-01'),
    status: String(operator.status || 'Inactive'),
    auth_provider: 'anonymous',
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  };
}

export async function verifyOperatorPinLogin(
  firestore: admin.firestore.Firestore,
  request: CallableRequest<{ username: string; pin: string }>,
) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Anonymous authentication is required.');
  const authenticatedUid = request.auth.uid;
  const username = normalizeUsername(request.data.username);
  const pin = String(request.data.pin || '');
  assertValidUsername(username);
  assertValidPin(pin);

  const credentialRef = firestore.collection('operatorCredentials').doc(username);
  const loginAttemptRef = firestore.collection('operatorLoginAttempts').doc(username);
  const now = admin.firestore.Timestamp.now();
  return firestore.runTransaction(async transaction => {
    const [credentialSnapshot, attemptSnapshot] = await Promise.all([
      transaction.get(credentialRef),
      transaction.get(loginAttemptRef),
    ]);
    const attempt = attemptSnapshot.data() || {};
    const lockedUntil = attempt.locked_until;
    if (lockedUntil instanceof admin.firestore.Timestamp && lockedUntil.toMillis() > Date.now()) {
      throw new HttpsError('resource-exhausted', 'Too many failed login attempts. Try again later.');
    }
    if (!credentialSnapshot.exists) {
      transaction.set(loginAttemptRef, {
        username,
        failed_attempts: Number(attempt.failed_attempts || 0) + 1,
        last_failed_at: now,
      }, { merge: true });
      throw new HttpsError('unauthenticated', 'Username or PIN is incorrect.');
    }
    const credential = credentialSnapshot.data() || {};
    const operatorId = String(credential.operator_id || '');
    const accountId = String(credential.account_id || '');
    const salt = String(credential.pin_salt || '');
    const expectedHash = String(credential.pin_hash || '');
    if (credential.algorithm !== PIN_HASH_VERSION || !operatorId || !accountId || !salt || !expectedHash) {
      throw new HttpsError('failed-precondition', 'Operator credential is not initialized.');
    }
    const operatorRef = firestore.collection('operators').doc(operatorId);
    const accountRef = firestore.collection('accounts').doc(accountId);
    const [operatorSnapshot, accountSnapshot] = await Promise.all([
      transaction.get(operatorRef),
      transaction.get(accountRef),
    ]);
    if (!operatorSnapshot.exists || !accountSnapshot.exists) {
      throw new HttpsError('failed-precondition', 'Operator account is not initialized.');
    }
    const operator = operatorSnapshot.data() || {};
    const account = accountSnapshot.data() || {};
    if (operator.status !== 'Active' || account.status !== 'Active') {
      throw new HttpsError('permission-denied', 'Operator account is inactive.');
    }
    if (!verifyPin(pin, salt, expectedHash)) {
      const failedAttempts = Number(attempt.failed_attempts || 0) + 1;
      transaction.set(loginAttemptRef, {
        username,
        failed_attempts: failedAttempts,
        last_failed_at: now,
        ...(failedAttempts >= MAX_FAILED_ATTEMPTS
          ? { locked_until: admin.firestore.Timestamp.fromMillis(Date.now() + LOCKOUT_MS) }
          : {}),
      }, { merge: true });
      throw new HttpsError('unauthenticated', 'Username or PIN is incorrect.');
    }
    const profile = publicOperatorProfile(authenticatedUid, operatorId, operator);
    transaction.set(firestore.collection('users').doc(authenticatedUid), {
      ...profile,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      last_login_at: now,
    }, { merge: true });
    transaction.set(loginAttemptRef, {
      username,
      failed_attempts: 0,
      locked_until: null,
      last_success_at: now,
    }, { merge: true });
    const auditId = `AUD_${randomUUID()}`;
    transaction.set(firestore.collection('auditLogs').doc(auditId), {
      audit_id: auditId,
      module_name: 'Authentication',
      record_id: operatorId,
      action: 'OperatorPinLogin',
      operator_id: authenticatedUid,
      account_uid: authenticatedUid,
      operator_name: profile.operator_name,
      site_id: profile.site_id,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      action_result: 'Success',
    });
    return { profile };
  });
}
