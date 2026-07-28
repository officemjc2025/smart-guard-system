import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const projectId = 'securityprojectv1-staging';
let environment: RulesTestEnvironment;

const emptyMetrics = {
  firstQueuedAt: null, firstAssignedAt: null, workStartedAt: null,
  readyAt: null, completedAt: null, waitingSeconds: 0, workingSeconds: 0,
  totalCycleSeconds: 0, transferCount: 0, reassignCount: 0, releaseCount: 0,
  priorityChangeCount: 0, lastTransitionAt: null, lastEventId: '', metricsVersion: 1,
};

const session = (id: string, assignedTo = 'guard-a') => ({
  session_id: id, site_id: 'site-a', parking_card_id: 'card-a', card_number: 'CARD-A',
  stage: 'CardIssued', status: 'Pending', opened_by: 'guard-a',
  current_owner: assignedTo, last_updated_by: assignedTo,
  assigned_to: assignedTo, assignedTo, assignedBy: assignedTo,
  assignedAt: Timestamp.now(), queueStatus: 'Assigned', priority: 'Normal',
  queuePosition: 1, assignmentVersion: 0, sessionVersion: 1,
  queueMetrics: emptyMetrics, last_activity_at: Timestamp.now(),
  activity: [], created_at: Timestamp.now(), updated_at: Timestamp.now(),
});

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
  });
});

after(async () => environment.cleanup());

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, 'users/guard-a'), {
        status: 'Active', role: 'Guard', site_id: 'site-a', operator_name: 'Guard A',
      }),
      setDoc(doc(database, 'users/guard-b'), {
        status: 'Active', role: 'Guard', site_id: 'site-a', operator_name: 'Guard B',
      }),
      setDoc(doc(database, 'users/manager-a'), {
        status: 'Active', role: 'Manager', site_id: 'site-a', operator_name: 'Manager A',
      }),
      setDoc(doc(database, 'users/admin-a'), {
        status: 'Active', role: 'Admin', site_id: 'site-a', operator_name: 'Admin A',
      }),
      setDoc(doc(database, 'users/shift-a'), {
        status: 'Active', role: 'ShiftHead', site_id: 'site-a', operator_name: 'Shift A',
      }),
      setDoc(doc(database, 'users/inactive-a'), {
        status: 'Inactive', role: 'Guard', site_id: 'site-a', operator_name: 'Inactive A',
      }),
      setDoc(doc(database, 'users/admin-b'), {
        status: 'Active', role: 'Admin', site_id: 'site-b', operator_name: 'Admin B',
      }),
      setDoc(doc(database, 'vehicleSessions/session-a'), session('session-a')),
      setDoc(doc(database, 'siteAnalyticsDaily/site-a_2026-07-24'), {
        site_id: 'site-a', date_key: '2026-07-24', sessions_created: 1,
      }),
      setDoc(doc(database, 'auditLogs/audit-a'), {
        audit_id: 'audit-a', module_name: 'VehicleSessions', record_id: 'session-a',
        action: 'Created', account_uid: 'guard-a', operator_id: 'guard-a',
        site_id: 'site-a', created_at: Timestamp.now(),
      }),
      setDoc(doc(database, 'operatorCredentials/admin'), {
        username: 'admin', operator_id: 'operator-admin', account_id: 'account-admin',
        algorithm: 'scrypt-v1', pin_hash: 'not-client-readable', pin_salt: 'not-client-readable',
        status: 'Active',
      }),
    ]);
  });
});

test('authenticated browser cannot read operator credentials directly', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(getDoc(doc(database, 'operatorCredentials/admin')));
});

test('anonymous browser cannot read operator credentials directly', async () => {
  const database = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(database, 'operatorCredentials/admin')));
});

test('authenticated UID can read its own canonical session profile', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertSucceeds(getDoc(doc(database, 'users/guard-a')));
});

test('another UID cannot read a session profile', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(getDoc(doc(database, 'users/guard-b')));
});

test('non-admin user cannot modify own role, site or status', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  const reference = doc(database, 'users/guard-a');
  await assertFails(updateDoc(reference, { role: 'Admin' }));
  await assertFails(updateDoc(reference, { site_id: 'site-b' }));
  await assertFails(updateDoc(reference, { status: 'Inactive' }));
});

test('cross-site session and analytics reads are denied', async () => {
  const database = environment.authenticatedContext('admin-b').firestore();
  await assertFails(getDoc(doc(database, 'vehicleSessions/session-a')));
  await assertFails(getDoc(doc(database, 'siteAnalyticsDaily/site-a_2026-07-24')));
});

test('exact sessionVersion increment by one succeeds', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  const reference = doc(database, 'vehicleSessions/session-a');
  await assertSucceeds(updateDoc(reference, {
    note: 'current', sessionVersion: 2, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('same sessionVersion is denied when an update requires an increment', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  const reference = doc(database, 'vehicleSessions/session-a');
  await assertFails(updateDoc(reference, {
    note: 'stale', last_updated_by: 'guard-a', updated_at: Timestamp.now(),
  }));
});

test('sessionVersion increment greater than one is denied', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    note: 'skip', sessionVersion: 3, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('sessionVersion decrement and non-numeric versions are denied', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  const reference = doc(database, 'vehicleSessions/session-a');
  await assertFails(updateDoc(reference, {
    note: 'decrement', sessionVersion: 0, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
  await assertFails(updateDoc(reference, {
    note: 'type-confusion', sessionVersion: '2', last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('protected vehicle-session identity fields cannot be changed', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    opened_by: 'guard-b', sessionVersion: 2, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('cross-site and inactive accounts cannot update a vehicle session', async () => {
  const crossSite = environment.authenticatedContext('admin-b').firestore();
  const inactive = environment.authenticatedContext('inactive-a').firestore();
  const update = {
    note: 'denied', sessionVersion: 2, last_updated_by: 'admin-b',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  };
  await assertFails(updateDoc(doc(crossSite, 'vehicleSessions/session-a'), update));
  await assertFails(updateDoc(doc(inactive, 'vehicleSessions/session-a'), {
    ...update, last_updated_by: 'inactive-a',
  }));
});

test('guard may complete an owned exit transition', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertSucceeds(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    stage: 'VehicleExited', status: 'Completed', queueStatus: 'Completed',
    sessionVersion: 2, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('guard cannot change administrative priority', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    priority: 'Emergency', sessionVersion: 2, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('same-site Manager and Admin may perform intended session updates', async () => {
  const manager = environment.authenticatedContext('manager-a').firestore();
  const admin = environment.authenticatedContext('admin-a').firestore();
  const reference = doc(manager, 'vehicleSessions/session-a');
  await assertSucceeds(updateDoc(reference, {
    priority: 'High', sessionVersion: 2, last_updated_by: 'manager-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'vehicleSessions/session-a'), session('session-a'));
  });
  await assertSucceeds(updateDoc(doc(admin, 'vehicleSessions/session-a'), {
    priority: 'Low', sessionVersion: 2, last_updated_by: 'admin-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('unauthenticated clients cannot update a vehicle session', async () => {
  const database = environment.unauthenticatedContext().firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    note: 'anonymous', sessionVersion: 2, last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('unauthenticated clients cannot read or list vehicle sessions', async () => {
  const database = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(database, 'vehicleSessions/session-a')));
});

test('schema pollution and oversized strings are denied on update', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  const reference = doc(database, 'vehicleSessions/session-a');
  await assertFails(updateDoc(reference, {
    arbitrary_admin_override: true,
    sessionVersion: 2,
    last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  }));
  await assertFails(updateDoc(reference, {
    note: 'x'.repeat(2001),
    sessionVersion: 2,
    last_updated_by: 'guard-a',
    last_activity_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  }));
});

test('created timestamp remains immutable', async () => {
  const database = environment.authenticatedContext('manager-a').firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    created_at: Timestamp.now(),
    sessionVersion: 2,
    last_updated_by: 'manager-a',
    last_activity_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  }));
});

test('a guard cannot mutate a session owned by another guard', async () => {
  const database = environment.authenticatedContext('guard-b').firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    note: 'ownership bypass', sessionVersion: 2, last_updated_by: 'guard-b',
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('clients cannot modify trusted queue metrics', async () => {
  const database = environment.authenticatedContext('manager-a').firestore();
  await assertFails(updateDoc(doc(database, 'vehicleSessions/session-a'), {
    sessionVersion: 2, last_updated_by: 'manager-a',
    queueMetrics: { ...emptyMetrics, waitingSeconds: 999999 },
    last_activity_at: Timestamp.now(), updated_at: Timestamp.now(),
  }));
});

test('analytics collections reject client writes', async () => {
  const database = environment.authenticatedContext('manager-a').firestore();
  await assertFails(setDoc(doc(database, 'siteAnalyticsDaily/site-a_2026-07-25'), {
    site_id: 'site-a', date_key: '2026-07-25', sessions_created: 999,
  }));
});

test('same-site supervisor can read analytics while inactive user cannot', async () => {
  const shiftDatabase = environment.authenticatedContext('shift-a').firestore();
  const inactiveDatabase = environment.authenticatedContext('inactive-a').firestore();
  await assertSucceeds(getDoc(doc(shiftDatabase, 'siteAnalyticsDaily/site-a_2026-07-24')));
  await assertFails(getDoc(doc(inactiveDatabase, 'vehicleSessions/session-a')));
});

test('session activity is append-only', async () => {
  const database = environment.authenticatedContext('guard-a').firestore();
  const reference = doc(database, 'vehicleSessions/session-a/activities/activity-a');
  await assertSucceeds(setDoc(reference, {
    activity_id: 'activity-a', client_event_id: 'activity-a', session_id: 'session-a',
    action: 'QueueStatusChange', from_stage: 'CardIssued', to_stage: 'CardIssued',
    from_status: 'Pending', to_status: 'Pending', actor_uid: 'guard-a',
    actor_operator_id: 'guard-a', actor_name: 'Guard A', actor_role: 'Guard',
    site_id: 'site-a', details: {}, created_at: serverTimestamp(), schema_version: 1,
  }));
  await assertFails(updateDoc(reference, { action: 'Tampered' }));
  await assertFails(deleteDoc(reference));
});

test('audit logs remain immutable', async () => {
  const database = environment.authenticatedContext('manager-a').firestore();
  await assertFails(updateDoc(doc(database, 'auditLogs/audit-a'), { action: 'Tampered' }));
  await assertFails(deleteDoc(doc(database, 'auditLogs/audit-a')));
});
