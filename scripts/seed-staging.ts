import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const STAGING_PROJECT_ID = 'securityprojectv1-staging';
const PRODUCTION_PROJECT_ID = 'securityprojectv1';
const args = new Set(process.argv.slice(2));
const projectId = String(process.env.GCLOUD_PROJECT || '').trim();
const apply = args.has('--apply');
const rollback = args.has('--rollback');
const confirmed = args.has(`--confirm=${STAGING_PROJECT_ID}`);

if (!projectId) throw new Error('GCLOUD_PROJECT runtime configuration is required.');
if (projectId === PRODUCTION_PROJECT_ID || projectId !== STAGING_PROJECT_ID) {
  throw new Error(`Refusing to seed non-staging project: ${projectId}`);
}
if (apply && rollback) throw new Error('Choose either --apply or --rollback.');
if ((apply || rollback) && !confirmed) {
  throw new Error(`Apply/rollback requires --confirm=${STAGING_PROJECT_ID}.`);
}

const primarySiteId = 'site-synthetic-01';
const secondarySiteId = 'site-synthetic-02';
const now = Timestamp.fromMillis(Date.UTC(2026, 0, 1));
const syntheticUsers = [
  { username: 'stg-admin-01', operatorName: 'STG Admin 01', role: 'Admin', status: 'Active', siteId: primarySiteId },
  { username: 'stg-manager-01', operatorName: 'STG Manager 01', role: 'Manager', status: 'Active', siteId: primarySiteId },
  { username: 'stg-shifthead-01', operatorName: 'STG ShiftHead 01', role: 'ShiftHead', status: 'Active', siteId: primarySiteId },
  { username: 'stg-guard-a', operatorName: 'STG Guard A', role: 'Guard', status: 'Active', siteId: primarySiteId },
  { username: 'stg-guard-b', operatorName: 'STG Guard B', role: 'Guard', status: 'Active', siteId: primarySiteId },
  { username: 'stg-inactive', operatorName: 'STG Inactive', role: 'Guard', status: 'Inactive', siteId: primarySiteId },
  { username: 'stg-second-site', operatorName: 'STG Second Site', role: 'Guard', status: 'Active', siteId: secondarySiteId },
] as const;

const parkingStatuses = [
  'Available',
  'Available',
  'Available',
  'Reserved',
  'Reserved',
  'InUse',
  'InUse',
  'Returned',
  'Returned',
  'Suspended',
] as const;

const baseDocuments: Array<{ path: string; data: Record<string, unknown> }> = [
  {
    path: `sites/${primarySiteId}`,
    data: {
      site_id: primarySiteId,
      name: 'Synthetic Staging Site',
      timezone: 'Asia/Bangkok',
      status: 'Active',
      created_at: now,
      updated_at: now,
    },
  },
  {
    path: `sites/${secondarySiteId}`,
    data: {
      site_id: secondarySiteId,
      name: 'Synthetic Second Site',
      timezone: 'Asia/Bangkok',
      status: 'Active',
      created_at: now,
      updated_at: now,
    },
  },
  ...parkingStatuses.map((status, index) => {
    const sequence = String(index + 1).padStart(3, '0');
    const card = `STG-CARD-${sequence}`;
    return {
      path: `parkingCards/${card.toLowerCase()}`,
      data: {
        firestore_document_id: card.toLowerCase(),
        card_id: card,
        card_number: card,
        card_number_normalized: card,
        qr_code_value: card,
        qr_code_normalized: card,
        card_type: 'Temporary',
        status,
        status_normalized: status,
        site_id: primarySiteId,
        note: 'Synthetic staging only',
        created_at: now,
        updated_at: now,
      },
    };
  }),
  ...Array.from({ length: 5 }, (_, index) => {
    const sequence = String(index + 1).padStart(3, '0');
    return {
      path: `units/stg-unit-${sequence}`,
      data: {
        firestore_document_id: `stg-unit-${sequence}`,
        unit_id: `STG-UNIT-${sequence}`,
        site_id: primarySiteId,
        building: index < 3 ? 'STG-A' : 'STG-B',
        room_number: `STG-${index + 101}`,
        floor: String(index + 1),
        owner_name: `Synthetic Owner ${sequence}`,
        resident_name: `Synthetic Resident ${sequence}`,
        phone: `0000000${sequence}`,
        status: 'Active',
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    };
  }),
  ...Array.from({ length: 3 }, (_, index) => ({
    path: `patrolPoints/stg-patrol-${index + 1}`,
    data: {
      point_id: `STG-PATROL-${index + 1}`,
      point_name: `Synthetic Patrol Point ${index + 1}`,
      site_id: primarySiteId,
      status: 'Active',
      created_at: now,
      updated_at: now,
    },
  })),
  ...Array.from({ length: 2 }, (_, index) => ({
    path: `keys/stg-key-${index + 1}`,
    data: {
      key_id: `STG-KEY-${index + 1}`,
      key_name: `Synthetic Key ${index + 1}`,
      site_id: primarySiteId,
      status: 'Available',
      created_at: now,
      updated_at: now,
    },
  })),
  {
    path: 'blacklist/stg-blacklist-001',
    data: {
      blacklist_id: 'STG-BLACKLIST-001',
      full_name: 'Synthetic Blocked Person',
      vehicle_plate: 'STG-BLOCK-001',
      reason: 'Synthetic staging verification',
      site_id: primarySiteId,
      status: 'Active',
      created_at: now,
      updated_at: now,
    },
  },
  {
    path: 'vehicleSessions/stg-session-waiting-001',
    data: {
      session_id: 'stg-session-waiting-001',
      site_id: primarySiteId,
      status: 'Active',
      queueStatus: 'Waiting',
      priority: 'Normal',
      queuePosition: 1,
      session_version: 1,
      assignment_version: 0,
      vehicle_plate: 'STG-QUEUE-001',
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    },
  },
  {
    path: 'vehicleSessions/stg-session-completed-001',
    data: {
      session_id: 'stg-session-completed-001',
      site_id: primarySiteId,
      status: 'Completed',
      queueStatus: 'Completed',
      priority: 'High',
      session_version: 3,
      assignment_version: 1,
      vehicle_plate: 'STG-DONE-001',
      created_at: now,
      updated_at: now,
      last_activity_at: now,
      queueMetrics: {
        waitingSeconds: 120,
        workingSeconds: 300,
        totalCycleSeconds: 420,
        transferCount: 0,
        reassignCount: 0,
        releaseCount: 0,
        priorityChangeCount: 1,
        completedAt: now,
      },
    },
  },
  {
    path: 'siteAnalyticsDaily/site-synthetic-01_2026-01-01',
    data: {
      site_id: primarySiteId,
      date_key: '2026-01-01',
      timezone: 'Asia/Bangkok',
      schema_version: 1,
      sessions_created: 1,
      sessions_completed: 1,
      total_waiting_seconds: 120,
      total_working_seconds: 300,
      total_cycle_seconds: 420,
      updated_at: now,
    },
  },
];

const result = {
  event_type: 'staging_seed',
  project_id: projectId,
  mode: rollback ? 'rollback' : apply ? 'apply' : 'dry-run',
  synthetic_users: syntheticUsers.length,
  documents: baseDocuments.length + syntheticUsers.length * 2,
  collections: {
    sites: 2,
    users: syntheticUsers.length,
    loginDirectory: syntheticUsers.length,
    parkingCards: parkingStatuses.length,
    units: 5,
    patrolPoints: 3,
    keys: 2,
    blacklist: 1,
    vehicleSessions: 2,
    siteAnalyticsDaily: 1,
  },
  result: 'validated',
};

if (!apply && !rollback) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const pin = String(process.env.STAGING_SEED_PIN || '').trim();
if (!/^\d{6}$/.test(pin)) {
  throw new Error('STAGING_SEED_PIN must be a synthetic 6-digit PIN.');
}

initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();
const database = getFirestore();
const userDocuments: Array<{ path: string; data: Record<string, unknown> }> = [];

if (rollback) {
  const batch = database.batch();
  for (const item of baseDocuments) batch.delete(database.doc(item.path));
  let authUsersDeleted = 0;
  for (const user of syntheticUsers) {
    const email = `${user.username}@smartguard.local`;
    try {
      const authUser = await auth.getUserByEmail(email);
      batch.delete(database.doc(`users/${authUser.uid}`));
      batch.delete(database.doc(`loginDirectory/${user.username}`));
      await auth.deleteUser(authUser.uid);
      authUsersDeleted += 1;
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'auth/user-not-found'
      ) {
        throw error;
      }
    }
  }
  await batch.commit();
  console.log(JSON.stringify({
    ...result,
    result: 'rolled-back',
    auth_users_deleted: authUsersDeleted,
    firestore_documents_deleted: baseDocuments.length + authUsersDeleted * 2,
  }, null, 2));
  process.exit(0);
}

for (const user of syntheticUsers) {
  const email = `${user.username}@smartguard.local`;
  let authUser;
  try {
    authUser = await auth.getUserByEmail(email);
    await auth.updateUser(authUser.uid, {
      password: pin,
      disabled: user.status !== 'Active',
      displayName: user.operatorName,
    });
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'auth/user-not-found'
    ) {
      throw error;
    }
    authUser = await auth.createUser({
      email,
      password: pin,
      disabled: user.status !== 'Active',
      displayName: user.operatorName,
    });
  }
  const profile = {
    user_id: authUser.uid,
    auth_uid: authUser.uid,
    auth_email: email,
    username: user.username,
    operator_name: user.operatorName,
    role: user.role,
    site_id: user.siteId,
    shift: 'Synthetic',
    phone: '',
    status: user.status,
    created_at: now,
    updated_at: now,
  };
  userDocuments.push(
    { path: `users/${authUser.uid}`, data: profile },
    {
      path: `loginDirectory/${user.username}`,
      data: {
        username: user.username,
        uid: authUser.uid,
        auth_email: email,
        status: user.status,
        updated_at: now,
      },
    },
  );
}

const batch = database.batch();
for (const item of [...baseDocuments, ...userDocuments]) {
  batch.set(database.doc(item.path), item.data, { merge: true });
}
await batch.commit();
console.log(JSON.stringify({ ...result, result: 'written' }, null, 2));
