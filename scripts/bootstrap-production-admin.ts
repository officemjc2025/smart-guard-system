import { randomUUID } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { hashPin, normalizeUsername } from '../functions/src/operatorAuthService';

const PRODUCTION_PROJECT_ID = 'securityprojectv1';
const CONFIRMATION_ARGUMENT = `--confirm=${PRODUCTION_PROJECT_ID}`;
const BOOTSTRAP_MARKER_ID = 'production-admin-v1';

function requiredEnvironmentVariable(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Required environment variable is missing: ${name}`);
  return value;
}

async function main(): Promise<void> {
  if (!process.argv.slice(2).includes(CONFIRMATION_ARGUMENT)) {
    throw new Error(`Explicit confirmation is required: ${CONFIRMATION_ARGUMENT}`);
  }

  const configuredProjectId = String(
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '',
  ).trim();
  if (configuredProjectId !== PRODUCTION_PROJECT_ID) {
    throw new Error(`Refusing to bootstrap Firebase project: ${configuredProjectId || '(missing)'}`);
  }

  const username = normalizeUsername(requiredEnvironmentVariable('BOOTSTRAP_ADMIN_USERNAME'));
  const pin = requiredEnvironmentVariable('BOOTSTRAP_ADMIN_PIN');
  const operatorName = requiredEnvironmentVariable('BOOTSTRAP_ADMIN_NAME');
  const siteId = requiredEnvironmentVariable('BOOTSTRAP_ADMIN_SITE_ID');

  if (!/^[a-z0-9._-]{3,24}$/.test(username)) {
    throw new Error('BOOTSTRAP_ADMIN_USERNAME is invalid after normalization.');
  }
  if (!/^\d{6}$/.test(pin)) {
    throw new Error('BOOTSTRAP_ADMIN_PIN must contain exactly 6 digits.');
  }

  const accountId = `account-${username}`;
  const operatorId = `operator-${username}`;
  const credential = hashPin(pin);
  const app = initializeApp({
    credential: applicationDefault(),
    projectId: PRODUCTION_PROJECT_ID,
  });
  const firestore = getFirestore(app);

  await firestore.runTransaction(async transaction => {
    const accountRef = firestore.collection('accounts').doc(accountId);
    const operatorRef = firestore.collection('operators').doc(operatorId);
    const credentialRef = firestore.collection('operatorCredentials').doc(username);
    const markerRef = firestore.collection('systemBootstrap').doc(BOOTSTRAP_MARKER_ID);
    const auditRef = firestore.collection('auditLogs').doc(`AUD_${randomUUID()}`);

    const activeAdminQuery = firestore.collection('accounts').where('role', '==', 'Admin');
    const accountUsernameQuery = firestore.collection('accounts').where('username', '==', username);
    const operatorUsernameQuery = firestore.collection('operators').where('username', '==', username);

    const [adminAccounts, matchingAccounts, matchingOperators, credentialSnapshot, markerSnapshot] =
      await Promise.all([
        transaction.get(activeAdminQuery),
        transaction.get(accountUsernameQuery),
        transaction.get(operatorUsernameQuery),
        transaction.get(credentialRef),
        transaction.get(markerRef),
      ]);

    if (adminAccounts.docs.some(document => document.get('status') === 'Active')) {
      throw new Error('An Active Admin account already exists.');
    }
    if (credentialSnapshot.exists) {
      throw new Error('The normalized username already has operator credentials.');
    }
    if (markerSnapshot.exists) {
      throw new Error('Production Admin bootstrap has already been completed.');
    }
    if (!matchingAccounts.empty || !matchingOperators.empty) {
      throw new Error('The normalized username is already in use.');
    }

    const now = FieldValue.serverTimestamp();
    transaction.create(accountRef, {
      account_id: accountId,
      username,
      role: 'Admin',
      site_id: siteId,
      status: 'Active',
      created_at: now,
      updated_at: now,
    });
    transaction.create(operatorRef, {
      operator_id: operatorId,
      account_id: accountId,
      username,
      operator_name: operatorName,
      role: 'Admin',
      shift: 'ทั่วไป',
      phone: '',
      site_id: siteId,
      status: 'Active',
      created_at: now,
      updated_at: now,
    });
    transaction.create(credentialRef, {
      username,
      operator_id: operatorId,
      account_id: accountId,
      algorithm: credential.algorithm,
      pin_salt: credential.salt,
      pin_hash: credential.hash,
      status: 'Active',
      created_at: now,
      updated_at: now,
    });
    transaction.create(auditRef, {
      audit_id: auditRef.id,
      module_name: 'IdentityAdministration',
      record_id: operatorId,
      action: 'BootstrapProductionAdmin',
      operator_id: 'system-bootstrap',
      account_uid: 'system-bootstrap',
      operator_name: 'Production Bootstrap',
      site_id: siteId,
      created_at: now,
      action_result: 'Success',
    });
    transaction.create(markerRef, {
      bootstrap_id: BOOTSTRAP_MARKER_ID,
      project_id: PRODUCTION_PROJECT_ID,
      account_id: accountId,
      operator_id: operatorId,
      site_id: siteId,
      status: 'Completed',
      created_at: now,
    });
  });

  console.log(JSON.stringify({
    username,
    accountId,
    operatorId,
    siteId,
    status: 'Active',
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Production Admin bootstrap failed.');
  process.exitCode = 1;
});
