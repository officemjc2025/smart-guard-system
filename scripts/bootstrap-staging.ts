import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, type DocumentData } from 'firebase-admin/firestore';
import { stdin, stdout } from 'node:process';

const STAGING_PROJECT_ID = 'securityprojectv1-staging';
const PRODUCTION_PROJECT_ID = 'securityprojectv1';
const ADMIN_USERNAME = 'admin';
const ADMIN_ACCOUNT_ID = 'account-admin';
const ADMIN_OPERATOR_ID = 'operator-admin';
const SITE_ID = 'site-01';
const UNIT_DOCUMENT_ID = 'unit-staging-001';
const CARD_DOCUMENT_ID = 'parking-card-staging-001';
const PIN_ALGORITHM = 'scrypt-v1';
const PIN_KEY_LENGTH = 64;

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const apply = args.has('--apply');
const confirmed = args.has(`--confirm=${STAGING_PROJECT_ID}`);
const projectId = String(process.env.GCLOUD_PROJECT || '').trim();

if (dryRun === apply) {
  throw new Error('Choose exactly one mode: --dry-run or --apply.');
}
if (!projectId) throw new Error('GCLOUD_PROJECT is required.');
if (projectId === PRODUCTION_PROJECT_ID || projectId !== STAGING_PROJECT_ID) {
  throw new Error(`Refusing to bootstrap non-staging project: ${projectId}`);
}
if (apply && !confirmed) {
  throw new Error(`Apply requires --confirm=${STAGING_PROJECT_ID}.`);
}

function hiddenPinPrompt(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('A local interactive TTY is required for the hidden PIN prompt.'));
      return;
    }
    let value = '';
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
          reject(new Error('Staging bootstrap cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    stdin.on('data', onData);
  });
}

function pinMatches(pin: string, credential: DocumentData): boolean {
  if (
    credential.algorithm !== PIN_ALGORITHM ||
    typeof credential.pin_salt !== 'string' ||
    typeof credential.pin_hash !== 'string'
  ) {
    return false;
  }
  const actual = scryptSync(pin, credential.pin_salt, PIN_KEY_LENGTH);
  const expected = Buffer.from(credential.pin_hash, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !['created_at', 'updated_at'].includes(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, comparable(item)]),
    );
  }
  return value;
}

function matchesExisting(existing: DocumentData | undefined, desired: DocumentData): boolean {
  if (!existing) return false;
  return JSON.stringify(comparable(existing)) === JSON.stringify(comparable(desired));
}

const now = new Date().toISOString();
const documents = [
  {
    path: 'systemSettings/authBootstrap',
    data: {
      setting_key: 'authBootstrap',
      setting_value: 'completed',
      setting_type: 'system',
      description: 'Anonymous Authentication + operator PIN bootstrap initialized',
      updated_by: 'Staging Bootstrap',
    },
  },
  {
    path: `accounts/${ADMIN_ACCOUNT_ID}`,
    data: {
      account_id: ADMIN_ACCOUNT_ID,
      username: ADMIN_USERNAME,
      role: 'Admin',
      site_id: SITE_ID,
      status: 'Active',
    },
  },
  {
    path: `operators/${ADMIN_OPERATOR_ID}`,
    data: {
      operator_id: ADMIN_OPERATOR_ID,
      account_id: ADMIN_ACCOUNT_ID,
      username: ADMIN_USERNAME,
      operator_name: 'Staging Admin',
      role: 'Admin',
      shift: 'ทั่วไป',
      phone: '',
      site_id: SITE_ID,
      status: 'Active',
    },
  },
  {
    path: `units/${UNIT_DOCUMENT_ID}`,
    data: {
      firestore_document_id: UNIT_DOCUMENT_ID,
      unit_id: 'STG-UNIT-001',
      site_id: SITE_ID,
      building: 'STG-A',
      room_number: 'STG-101',
      floor: '1',
      owner_name: 'Staging Owner',
      resident_name: 'Staging Resident',
      phone: '',
      occupancy_status: 'Active',
      status: 'Active',
      searchable_text: 'stg-101 stg-a 1 staging owner staging resident',
      search_key: 'stg-101',
      is_active: true,
    },
  },
  {
    path: `parkingCards/${CARD_DOCUMENT_ID}`,
    data: {
      firestore_document_id: CARD_DOCUMENT_ID,
      card_id: 'STG-CARD-001',
      site_id: SITE_ID,
      card_number: 'STG-CARD-001',
      card_number_normalized: 'STG-CARD-001',
      qr_code_value: 'STG-CARD-001',
      qr_code_normalized: 'STG-CARD-001',
      card_type: 'Temporary',
      status: 'Available',
      status_normalized: 'Available',
      note: 'Staging bootstrap card',
    },
  },
] as const;

if (dryRun) {
  console.log(JSON.stringify({
    event_type: 'staging_bootstrap',
    project_id: projectId,
    mode: 'dry-run',
    result: 'validated',
    operations: [
      ...documents.map(item => ({
        collection: item.path.split('/')[0],
        path: item.path,
        action: 'ensure',
      })),
      {
        collection: 'operatorCredentials',
        path: `operatorCredentials/${ADMIN_USERNAME}`,
        action: 'ensure-with-hidden-pin',
      },
    ],
  }, null, 2));
  process.exit(0);
}

initializeApp({ credential: applicationDefault(), projectId });
const database = getFirestore();
const snapshots = await Promise.all(documents.map(item => database.doc(item.path).get()));
const credentialRef = database.doc(`operatorCredentials/${ADMIN_USERNAME}`);
const credentialSnapshot = await credentialRef.get();
const planned: Array<{ collection: string; path: string; action: string }> = documents.map((item, index) => ({
  collection: item.path.split('/')[0],
  path: item.path,
  action: snapshots[index].exists
    ? matchesExisting(snapshots[index].data(), item.data) ? 'unchanged' : 'update'
    : 'create',
}));
planned.push({
  collection: 'operatorCredentials',
  path: `operatorCredentials/${ADMIN_USERNAME}`,
  action: credentialSnapshot.exists ? 'verify-pin' : 'create',
});

const pin = (await hiddenPinPrompt('Admin PIN (6 digits)')).trim();
if (!/^\d{6}$/.test(pin)) throw new Error('Admin PIN must contain exactly 6 digits.');

let newCredential: DocumentData | null = null;
if (credentialSnapshot.exists) {
  if (!pinMatches(pin, credentialSnapshot.data() || {})) {
    throw new Error('Existing Admin credential uses a different PIN; bootstrap will not rotate credentials.');
  }
} else {
  const pinSalt = randomBytes(16).toString('base64');
  planned[planned.length - 1].action = 'create';
  const pinHash = scryptSync(pin, pinSalt, PIN_KEY_LENGTH).toString('base64');
  newCredential = {
    username: ADMIN_USERNAME,
    operator_id: ADMIN_OPERATOR_ID,
    account_id: ADMIN_ACCOUNT_ID,
    algorithm: PIN_ALGORITHM,
    pin_salt: pinSalt,
    pin_hash: pinHash,
    status: 'Active',
    created_at: now,
    updated_at: now,
  };
}

const batch = database.batch();
if (newCredential) batch.create(credentialRef, newCredential);
for (let index = 0; index < documents.length; index += 1) {
  const item = documents[index];
  if (planned[index].action === 'unchanged') continue;
  const existing = snapshots[index].data();
  batch.set(database.doc(item.path), {
    ...item.data,
    created_at: existing?.created_at || now,
    updated_at: now,
  }, { merge: true });
}
await batch.commit();

console.log(JSON.stringify({
  event_type: 'staging_bootstrap',
  project_id: projectId,
  mode: 'apply',
  result: 'completed',
  operations: planned,
}, null, 2));
