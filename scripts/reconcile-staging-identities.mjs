import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import cliAuth from 'firebase-tools/lib/auth.js';

const STAGING_PROJECT_ID = 'securityprojectv1-staging';
const CANONICAL = Object.freeze({
  account: 'accounts/account-admin',
  operator: 'operators/operator-admin',
  credential: 'operatorCredentials/admin',
});
const SECRET_FIELDS = new Set([
  'pin',
  'pin_hash',
  'pin_salt',
  'hash',
  'salt',
  'token',
  'refresh_token',
  'access_token',
  'passwordHash',
  'passwordSalt',
]);

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const [key, inlineValue] = argument.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      values[key] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      values[key] = argv[index + 1];
      index += 1;
    } else {
      values[key] = true;
    }
  }
  return values;
}

function requireStaging(projectId) {
  if (projectId !== STAGING_PROJECT_ID) {
    throw new Error(`Refusing identity reconciliation for project: ${projectId || '(missing)'}`);
  }
}

function timestamp(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

function lastActivity(data, authUser) {
  const candidates = [
    data.last_activity_at,
    data.last_login_at,
    data.updated_at,
    data.created_at,
    authUser?.metadata?.lastSignInTime,
    authUser?.metadata?.creationTime,
  ].map(timestamp).filter(Boolean);
  return candidates.sort().at(-1) ?? null;
}

function sanitize(data) {
  return Object.fromEntries(Object.entries(data || {})
    .filter(([key]) => !SECRET_FIELDS.has(key))
    .map(([key, value]) => [key, value]));
}

async function firebaseCredential() {
  const account = cliAuth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) {
    throw new Error('Firebase CLI login is required.');
  }
  return {
    getAccessToken: async () => {
      const token = await cliAuth.getAccessToken(account.tokens.refresh_token, [
        'https://www.googleapis.com/auth/cloud-platform',
      ]);
      return {
        access_token: token.access_token,
        expires_in: Math.max(60, Math.floor(((token.expires_at || Date.now() + 3600000) - Date.now()) / 1000)),
      };
    },
  };
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue.fields || {});
  return null;
}

function decodeFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields || {})
    .map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function firestoreDocument(raw) {
  const path = raw.name.split('/documents/')[1];
  return {
    id: path.split('/').at(-1),
    ref: { path },
    data: () => decodeFirestoreFields(raw.fields || {}),
    get: field => decodeFirestoreFields(raw.fields || {})[field],
  };
}

function firestoreRest(projectId, accessToken) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-goog-user-project': projectId,
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      throw new Error(`Firestore REST ${response.status}: ${await response.text()}`);
    }
    return response.status === 204 ? null : response.json();
  }
  return {
    collection: collectionName => ({
      get: async () => {
        const docs = [];
        let pageToken = '';
        do {
          const url = new URL(`${base}/${collectionName}`);
          url.searchParams.set('pageSize', '1000');
          if (pageToken) url.searchParams.set('pageToken', pageToken);
          const page = await request(url);
          docs.push(...(page.documents || []).map(firestoreDocument));
          pageToken = page.nextPageToken || '';
        } while (pageToken);
        return { docs };
      },
    }),
    doc: path => ({
      delete: async () => request(`${base}/${path}`, { method: 'DELETE' }),
    }),
  };
}

async function listAuthUsers(auth) {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

function authProvider(user) {
  if (!user) return null;
  if (user.providerData.length === 0 && !user.email && !user.phoneNumber) return 'anonymous';
  return user.providerData.map(provider => provider.providerId).sort().join(',') || 'non-anonymous';
}

function linkedUsername(path, data) {
  if (path.startsWith('operatorCredentials/')) return path.split('/')[1];
  return String(data.username || '').trim().toLowerCase();
}

function record(path, classification, data, authUser, safeToDelete, reason) {
  return {
    path,
    classification,
    linked_ids: {
      auth_uid: data.auth_uid || data.user_id || authUser?.uid || null,
      account_id: data.account_id || null,
      operator_id: data.operator_id || null,
      username: linkedUsername(path, data) || null,
    },
    role: data.role || null,
    status: data.status || (authUser?.disabled ? 'Disabled' : null),
    site_id: data.site_id || null,
    last_activity_at: lastActivity(data, authUser),
    auth_provider: authProvider(authUser),
    safe_to_delete: safeToDelete,
    reason,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = String(args.confirm || process.env.GCLOUD_PROJECT || STAGING_PROJECT_ID);
  const username = String(args.username || '').trim().toLowerCase();
  const preserveUid = String(args['preserve-current-uid'] || '').trim();
  const dryRun = args['dry-run'] === true;
  const execute = args.execute === true;
  if (dryRun === execute) throw new Error('Choose exactly one mode: --dry-run or --execute.');
  requireStaging(projectId);
  if (username !== 'admin') throw new Error('This recovery utility currently accepts only --username admin.');
  if (execute && args.confirm !== STAGING_PROJECT_ID) {
    throw new Error(`Deletion requires --confirm=${STAGING_PROJECT_ID}.`);
  }
  if (execute && !preserveUid) throw new Error('Deletion requires --preserve-current-uid <uid>.');

  const credential = await firebaseCredential();
  const access = await credential.getAccessToken();
  const app = initializeApp({
    credential,
    projectId,
  }, `identity-reconciliation-${Date.now()}`);
  const firestore = firestoreRest(projectId, access.access_token);
  const auth = getAuth(app);
  const [accounts, operators, credentials, users, authUsers, attempts, loginDirectory] = await Promise.all([
    firestore.collection('accounts').get(),
    firestore.collection('operators').get(),
    firestore.collection('operatorCredentials').get(),
    firestore.collection('users').get(),
    listAuthUsers(auth),
    firestore.collection('operatorLoginAttempts').get(),
    firestore.collection('loginDirectory').get(),
  ]);
  const authByUid = new Map(authUsers.map(user => [user.uid, user]));
  const accountDocs = accounts.docs.filter(item => linkedUsername(item.ref.path, item.data()) === username);
  const operatorDocs = operators.docs.filter(item =>
    linkedUsername(item.ref.path, item.data()) === username ||
    accountDocs.some(account => account.id === item.get('account_id')));
  const credentialDocs = credentials.docs.filter(item => linkedUsername(item.ref.path, item.data()) === username);
  const linkedAccountIds = new Set(accountDocs.map(item => item.id));
  const linkedOperatorIds = new Set(operatorDocs.map(item => item.id));
  const sessionDocs = users.docs.filter(item => {
    const data = item.data();
    return linkedUsername(item.ref.path, data) === username ||
      linkedAccountIds.has(data.account_id) ||
      linkedOperatorIds.has(data.operator_id);
  });
  const report = [];

  for (const item of accountDocs) {
    const canonical = item.ref.path === CANONICAL.account;
    report.push(record(item.ref.path, canonical ? 'canonical account' : 'duplicate account',
      sanitize(item.data()), null, !canonical, canonical ? 'Required canonical record.' : 'Review linkage before deletion.'));
  }
  for (const item of operatorDocs) {
    const canonical = item.ref.path === CANONICAL.operator;
    report.push(record(item.ref.path, canonical ? 'canonical operator' : 'duplicate operator',
      sanitize(item.data()), null, !canonical, canonical ? 'Required canonical record.' : 'Review linkage before deletion.'));
  }
  for (const item of credentialDocs) {
    const canonical = item.ref.path === CANONICAL.credential;
    report.push(record(item.ref.path, 'credential', sanitize(item.data()), null, false,
      canonical ? 'Required canonical credential; secrets omitted.' : 'Credential deletion is outside stale-session cleanup.'));
  }
  for (const item of sessionDocs) {
    const data = sanitize(item.data());
    const authUser = authByUid.get(item.id);
    const provider = authProvider(authUser);
    const isCurrent = Boolean(preserveUid && item.id === preserveUid);
    const canonicalLink = data.account_id === 'account-admin' && data.operator_id === 'operator-admin';
    const classification = isCurrent
      ? 'current active session profile'
      : !authUser
        ? 'orphan session profile'
        : canonicalLink
          ? 'stale session profile'
          : 'orphan session profile';
    const safe = Boolean(preserveUid) && !isCurrent && provider === 'anonymous';
    report.push(record(item.ref.path, classification, data, authUser, safe,
      isCurrent ? 'Explicitly preserved current session.' :
        safe ? 'Linked Admin session profile with an anonymous Auth identity; eligible only after dry-run review.' :
          !preserveUid ? 'No current UID was supplied; deletion classification is intentionally unsafe.' :
          'Not safe for automatic deletion.'));
  }
  const sessionUids = new Set(sessionDocs.map(item => item.id));
  for (const user of authUsers) {
    if (sessionUids.has(user.uid)) continue;
    if (authProvider(user) !== 'anonymous') continue;
    report.push(record(`FirebaseAuth/${user.uid}`, 'orphan Firebase Auth user', {}, user, false,
      'No username linkage exists; automatic deletion is unsafe without corroborating audit/session evidence.'));
  }

  const deletableSessions = report.filter(item =>
    item.path.startsWith('users/') &&
    item.safe_to_delete &&
    item.classification !== 'current active session profile');
  const deletionPlan = deletableSessions.map(item => ({
    session_path: item.path,
    auth_uid: item.linked_ids.auth_uid,
    delete_anonymous_auth_user: item.auth_provider === 'anonymous',
  }));
  const credentialData = credentials.docs.map(item => ({ item, data: sanitize(item.data()) }));
  const shiftRoleAliases = new Set(['ShiftHead', 'Shift Leader', 'ShiftLeader']);
  const shiftCredentials = credentialData.filter(({ data }) => {
    const operator = operators.docs.find(item => item.id === data.operator_id);
    const account = accounts.docs.find(item => item.id === data.account_id);
    return shiftRoleAliases.has(String(operator?.get('role') || account?.get('role') || ''));
  });
  const shiftHeadReconciliation = shiftCredentials.map(({ item, data }) => {
    const operator = operators.docs.find(doc => doc.id === data.operator_id);
    const account = accounts.docs.find(doc => doc.id === data.account_id);
    const sessions = users.docs.filter(doc =>
      doc.get('operator_id') === data.operator_id ||
      doc.get('account_id') === data.account_id);
    const attempt = attempts.docs.find(doc => doc.id === item.id);
    return {
      username: item.id,
      credential_path: item.ref.path,
      credential_exists: true,
      credential_operator_id: data.operator_id || null,
      credential_account_id: data.account_id || null,
      operator_path: operator?.ref.path || null,
      operator_account_id: operator?.get('account_id') || null,
      account_path: account?.ref.path || null,
      status: operator?.get('status') || account?.get('status') || data.status || null,
      current_role: operator?.get('role') || account?.get('role') || null,
      canonical_role: 'ShiftHead',
      site_id: operator?.get('site_id') || account?.get('site_id') || null,
      session_profiles: sessions.map(session => ({
        path: session.ref.path,
        auth_uid: session.id,
        role: session.get('role') || null,
        status: session.get('status') || null,
        site_id: session.get('site_id') || null,
        last_activity_at: lastActivity(session.data(), authByUid.get(session.id)),
        auth_provider: authProvider(authByUid.get(session.id)),
      })),
      lockout_state: attempt ? {
        failed_attempts: Number(attempt.get('failed_attempts') || 0),
        locked_until: timestamp(attempt.get('locked_until')),
        last_success_at: timestamp(attempt.get('last_success_at')),
        last_failed_at: timestamp(attempt.get('last_failed_at')),
      } : null,
      duplicate_account_ids: accounts.docs
        .filter(doc => doc.id !== data.account_id && linkedUsername(doc.ref.path, doc.data()) === item.id)
        .map(doc => doc.id),
      duplicate_operator_ids: operators.docs
        .filter(doc => doc.id !== data.operator_id && linkedUsername(doc.ref.path, doc.data()) === item.id)
        .map(doc => doc.id),
    };
  });
  const representedShiftUsernames = new Set(shiftHeadReconciliation.map(item => item.username));
  for (const session of users.docs.filter(doc => shiftRoleAliases.has(String(doc.get('role') || '')))) {
    const sessionUsername = linkedUsername(session.ref.path, session.data()) || '(missing)';
    if (representedShiftUsernames.has(sessionUsername)) continue;
    const linkedCredential = credentials.docs.find(doc =>
      doc.id === sessionUsername ||
      doc.get('operator_id') === session.get('operator_id') ||
      doc.get('account_id') === session.get('account_id'));
    const linkedOperator = operators.docs.find(doc =>
      doc.id === session.get('operator_id') ||
      doc.get('account_id') === session.get('account_id') ||
      linkedUsername(doc.ref.path, doc.data()) === sessionUsername);
    const linkedAccount = accounts.docs.find(doc =>
      doc.id === session.get('account_id') ||
      doc.id === linkedOperator?.get('account_id') ||
      linkedUsername(doc.ref.path, doc.data()) === sessionUsername);
    const attempt = attempts.docs.find(doc => doc.id === sessionUsername);
    shiftHeadReconciliation.push({
      username: sessionUsername,
      credential_path: linkedCredential?.ref.path || null,
      credential_exists: Boolean(linkedCredential),
      credential_operator_id: linkedCredential?.get('operator_id') || null,
      credential_account_id: linkedCredential?.get('account_id') || null,
      operator_path: linkedOperator?.ref.path || null,
      operator_account_id: linkedOperator?.get('account_id') || null,
      account_path: linkedAccount?.ref.path || null,
      status: linkedOperator?.get('status') || linkedAccount?.get('status') || session.get('status') || null,
      current_role: linkedOperator?.get('role') || linkedAccount?.get('role') || session.get('role') || null,
      canonical_role: 'ShiftHead',
      site_id: linkedOperator?.get('site_id') || linkedAccount?.get('site_id') || session.get('site_id') || null,
      session_profiles: [{
        path: session.ref.path,
        auth_uid: session.id,
        role: session.get('role') || null,
        status: session.get('status') || null,
        site_id: session.get('site_id') || null,
        last_activity_at: lastActivity(session.data(), authByUid.get(session.id)),
        auth_provider: authProvider(authByUid.get(session.id)),
      }],
      lockout_state: attempt ? {
        failed_attempts: Number(attempt.get('failed_attempts') || 0),
        locked_until: timestamp(attempt.get('locked_until')),
        last_success_at: timestamp(attempt.get('last_success_at')),
        last_failed_at: timestamp(attempt.get('last_failed_at')),
      } : null,
      duplicate_account_ids: [],
      duplicate_operator_ids: [],
    });
  }
  for (const authUser of authUsers.filter(user =>
    Boolean(user.email?.toLowerCase().endsWith('@smartguard.local')) &&
    !user.email?.toLowerCase().startsWith('admin@') &&
    !users.docs.some(doc => doc.id === user.uid))) {
    const localPart = String(authUser.email).split('@')[0];
    const legacyUsername = localPart.split('.')[0];
    if (representedShiftUsernames.has(legacyUsername)) continue;
    const linkedCredential = credentials.docs.find(doc => doc.id === legacyUsername);
    const linkedOperator = operators.docs.find(doc =>
      doc.id === linkedCredential?.get('operator_id') ||
      linkedUsername(doc.ref.path, doc.data()) === legacyUsername);
    const linkedAccount = accounts.docs.find(doc =>
      doc.id === linkedCredential?.get('account_id') ||
      doc.id === linkedOperator?.get('account_id') ||
      linkedUsername(doc.ref.path, doc.data()) === legacyUsername);
    shiftHeadReconciliation.push({
      username: legacyUsername,
      credential_path: linkedCredential?.ref.path || null,
      credential_exists: Boolean(linkedCredential),
      credential_operator_id: linkedCredential?.get('operator_id') || null,
      credential_account_id: linkedCredential?.get('account_id') || null,
      operator_path: linkedOperator?.ref.path || null,
      operator_account_id: linkedOperator?.get('account_id') || null,
      account_path: linkedAccount?.ref.path || null,
      status: authUser.disabled ? 'Disabled' : linkedOperator?.get('status') || linkedAccount?.get('status') || 'AuthOnly',
      current_role: linkedOperator?.get('role') || linkedAccount?.get('role') || null,
      canonical_role: 'ShiftHead',
      site_id: linkedOperator?.get('site_id') || linkedAccount?.get('site_id') || null,
      session_profiles: [{
        path: null,
        auth_uid: authUser.uid,
        role: null,
        status: authUser.disabled ? 'Disabled' : 'AuthOnly',
        site_id: null,
        last_activity_at: lastActivity({}, authUser),
        auth_provider: authProvider(authUser),
      }],
      lockout_state: null,
      duplicate_account_ids: [],
      duplicate_operator_ids: [],
      note: 'Legacy non-anonymous Firebase Auth account without a users session profile.',
    });
  }
  for (const directory of loginDirectory.docs.filter(doc => doc.id !== 'admin')) {
    const directoryUsername = directory.id.toLowerCase();
    if (shiftHeadReconciliation.some(item => item.username === directoryUsername)) continue;
    const uid = String(directory.get('uid') || '');
    const authUser = authByUid.get(uid);
    const linkedSession = users.docs.find(doc => doc.id === uid || linkedUsername(doc.ref.path, doc.data()) === directoryUsername);
    const linkedCredential = credentials.docs.find(doc => doc.id === directoryUsername);
    const linkedOperator = operators.docs.find(doc =>
      doc.id === linkedCredential?.get('operator_id') ||
      linkedUsername(doc.ref.path, doc.data()) === directoryUsername);
    const linkedAccount = accounts.docs.find(doc =>
      doc.id === linkedCredential?.get('account_id') ||
      doc.id === linkedOperator?.get('account_id') ||
      linkedUsername(doc.ref.path, doc.data()) === directoryUsername);
    shiftHeadReconciliation.push({
      username: directoryUsername,
      credential_path: linkedCredential?.ref.path || null,
      credential_exists: Boolean(linkedCredential),
      credential_operator_id: linkedCredential?.get('operator_id') || null,
      credential_account_id: linkedCredential?.get('account_id') || null,
      operator_path: linkedOperator?.ref.path || null,
      operator_account_id: linkedOperator?.get('account_id') || null,
      account_path: linkedAccount?.ref.path || null,
      status: linkedOperator?.get('status') || linkedAccount?.get('status') || linkedSession?.get('status') || directory.get('status') || null,
      current_role: linkedOperator?.get('role') || linkedAccount?.get('role') || linkedSession?.get('role') || null,
      canonical_role: 'ShiftHead',
      site_id: linkedOperator?.get('site_id') || linkedAccount?.get('site_id') || linkedSession?.get('site_id') || null,
      session_profiles: uid ? [{
        path: linkedSession?.ref.path || null,
        auth_uid: uid,
        role: linkedSession?.get('role') || null,
        status: linkedSession?.get('status') || (authUser?.disabled ? 'Disabled' : null),
        site_id: linkedSession?.get('site_id') || null,
        last_activity_at: lastActivity(linkedSession?.data() || {}, authUser),
        auth_provider: authProvider(authUser),
      }] : [],
      lockout_state: null,
      duplicate_account_ids: [],
      duplicate_operator_ids: [],
      note: 'Legacy loginDirectory record; canonical ShiftHead linkage is incomplete.',
    });
  }

  if (execute) {
    for (const planned of deletionPlan) {
      if (planned.auth_uid === preserveUid) throw new Error('Internal safety check refused current-session deletion.');
      const authUser = authByUid.get(planned.auth_uid);
      if (!authUser || authProvider(authUser) !== 'anonymous') {
        throw new Error(`Internal safety check refused non-anonymous Auth deletion: ${planned.auth_uid}`);
      }
      await firestore.doc(planned.session_path).delete();
      await auth.deleteUser(planned.auth_uid);
    }
  }

  const output = {
    event_type: 'staging_identity_reconciliation',
    project_id: projectId,
    mode: dryRun ? 'dry-run' : 'execute',
    username,
    preserve_current_uid: preserveUid || null,
    generated_at: new Date().toISOString(),
    canonical_paths: CANONICAL,
    lockout_state: attempts.docs
      .filter(item => item.id.toLowerCase() === username)
      .map(item => ({
        path: item.ref.path,
        failed_attempts: Number(item.get('failed_attempts') || 0),
        locked_until: timestamp(item.get('locked_until')),
        last_success_at: timestamp(item.get('last_success_at')),
        last_failed_at: timestamp(item.get('last_failed_at')),
      })),
    shift_head_reconciliation: shiftHeadReconciliation,
    records: report.sort((left, right) => left.path.localeCompare(right.path)),
    deletion_plan: deletionPlan,
    deleted: execute ? deletionPlan.length : 0,
  };
  const digest = createHash('sha256').update(JSON.stringify(output)).digest('hex');
  const auditPath = resolve(String(args.report || `artifacts/identity-reconciliation-${Date.now()}.json`));
  await mkdir(dirname(auditPath), { recursive: true });
  await writeFile(auditPath, `${JSON.stringify({ ...output, report_sha256: digest }, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    ...output,
    report_path: auditPath,
    report_sha256: digest,
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
