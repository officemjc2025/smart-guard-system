import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type DocumentData } from 'firebase-admin/firestore';
import { stdin, stdout } from 'node:process';

const STAGING_PROJECT_ID = 'securityprojectv1-staging';
const PRODUCTION_PROJECT_ID = 'securityprojectv1';
const PRIMARY_SITE_ID = 'stg-e2e-site-a';
const SECONDARY_SITE_ID = 'stg-e2e-site-b';
const PIN_ALGORITHM = 'scrypt-v1';
const PIN_KEY_LENGTH = 64;

const fixtures = [
  { username: 'stg_e2e_admin', role: 'Admin', siteId: PRIMARY_SITE_ID },
  { username: 'stg_e2e_manager', role: 'Manager', siteId: PRIMARY_SITE_ID },
  { username: 'stg_e2e_shifthead', role: 'ShiftHead', siteId: PRIMARY_SITE_ID },
  { username: 'stg_e2e_guard', role: 'Guard', siteId: PRIMARY_SITE_ID },
  { username: 'stg_e2e_crosssite_guard', role: 'Guard', siteId: SECONDARY_SITE_ID },
] as const;

const argumentsList = process.argv.slice(2);
const has = (flag: string) => argumentsList.includes(flag);
const value = (flag: string) => {
  const exact = argumentsList.find(argument => argument.startsWith(`${flag}=`));
  if (exact) return exact.slice(flag.length + 1);
  const index = argumentsList.indexOf(flag);
  return index >= 0 ? argumentsList[index + 1] : '';
};
const projectId = value('--project').trim();
const dryRun = has('--dry-run');
const createFixtures = has('--create-test-fixtures');
const cleanupFixtures = has('--cleanup-test-fixtures');
const confirmed = value('--confirm') === STAGING_PROJECT_ID;

if (!projectId) throw new Error('--project is required.');
if (projectId === PRODUCTION_PROJECT_ID || projectId !== STAGING_PROJECT_ID) {
  throw new Error(`Refusing to manage fixtures outside ${STAGING_PROJECT_ID}.`);
}
if (createFixtures === cleanupFixtures) {
  throw new Error('Choose exactly one action: --create-test-fixtures or --cleanup-test-fixtures.');
}
if (!dryRun && !confirmed) {
  throw new Error(`Write operations require --confirm=${STAGING_PROJECT_ID}.`);
}

function hiddenPinPrompt(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('A local interactive TTY is required for the hidden PIN prompt.'));
      return;
    }
    let pin = '';
    stdout.write(`${label}: `);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup();
          stdout.write('\n');
          reject(new Error('Fixture creation cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(pin);
          return;
        }
        if (character === '\u007f' || character === '\b') pin = pin.slice(0, -1);
        else pin += character;
      }
    };
    stdin.on('data', onData);
  });
}

function credentialMatches(pin: string, data: DocumentData): boolean {
  if (
    data.algorithm !== PIN_ALGORITHM
    || typeof data.pin_salt !== 'string'
    || typeof data.pin_hash !== 'string'
  ) return false;
  const actual = scryptSync(pin, data.pin_salt, PIN_KEY_LENGTH);
  const expected = Buffer.from(data.pin_hash, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const summary = {
  event_type: 'staging_authenticated_test_fixtures',
  project_id: projectId,
  mode: dryRun ? 'dry-run' : 'apply',
  action: createFixtures ? 'create' : 'cleanup',
  fixtures: fixtures.map(fixture => ({
    username: fixture.username,
    role: fixture.role,
    site_id: fixture.siteId,
  })),
};

if (dryRun) {
  console.log(JSON.stringify({ ...summary, result: 'validated' }, null, 2));
  process.exit(0);
}

initializeApp({ credential: applicationDefault(), projectId });
const database = getFirestore();

if (createFixtures) {
  const pin = (await hiddenPinPrompt('Shared temporary fixture PIN (6 digits)')).trim();
  if (!/^\d{6}$/.test(pin)) throw new Error('Fixture PIN must contain exactly 6 digits.');

  for (const fixture of fixtures) {
    const accountId = `account-${fixture.username}`;
    const operatorId = `operator-${fixture.username}`;
    const credentialRef = database.doc(`operatorCredentials/${fixture.username}`);
    const credential = await credentialRef.get();
    if (credential.exists && !credentialMatches(pin, credential.data() || {})) {
      throw new Error(`Fixture ${fixture.username} exists with a different PIN; no credentials were rotated.`);
    }

    const batch = database.batch();
    batch.set(database.doc(`accounts/${accountId}`), {
      account_id: accountId,
      username: fixture.username,
      role: fixture.role,
      site_id: fixture.siteId,
      status: 'Active',
      staging_test_fixture: true,
      fixture_kind: 'authenticated-e2e',
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(database.doc(`operators/${operatorId}`), {
      operator_id: operatorId,
      account_id: accountId,
      username: fixture.username,
      operator_name: `Staging E2E ${fixture.role}`,
      role: fixture.role,
      shift: 'E2E',
      phone: '',
      site_id: fixture.siteId,
      status: 'Active',
      staging_test_fixture: true,
      fixture_kind: 'authenticated-e2e',
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (!credential.exists) {
      const salt = randomBytes(16).toString('base64');
      batch.create(credentialRef, {
        username: fixture.username,
        operator_id: operatorId,
        account_id: accountId,
        algorithm: PIN_ALGORITHM,
        pin_salt: salt,
        pin_hash: scryptSync(pin, salt, PIN_KEY_LENGTH).toString('base64'),
        status: 'Active',
        staging_test_fixture: true,
        fixture_kind: 'authenticated-e2e',
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  console.log(JSON.stringify({ ...summary, result: 'completed' }, null, 2));
} else {
  const operatorIds = fixtures.map(fixture => `operator-${fixture.username}`);
  const sessionProfiles = await database.collection('users').where('operator_id', 'in', operatorIds).get();
  const batch = database.batch();
  for (const fixture of fixtures) {
    batch.delete(database.doc(`accounts/account-${fixture.username}`));
    batch.delete(database.doc(`operators/operator-${fixture.username}`));
    batch.delete(database.doc(`operatorCredentials/${fixture.username}`));
    batch.delete(database.doc(`operatorLoginAttempts/${fixture.username}`));
  }
  sessionProfiles.docs.forEach(profile => batch.delete(profile.ref));
  await batch.commit();
  if (sessionProfiles.size) {
    await getAuth().deleteUsers(sessionProfiles.docs.map(profile => profile.id));
  }
  console.log(JSON.stringify({
    ...summary,
    result: 'completed',
    deleted_session_profiles: sessionProfiles.size,
  }, null, 2));
}
