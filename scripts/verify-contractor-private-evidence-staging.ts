import 'dotenv/config';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'securityprojectv1-staging';
const endpoint = 'https://asia-southeast1-securityprojectv1-staging.cloudfunctions.net/getVehicleEvidenceImage';
const apiKey = String(process.env.VITE_FIREBASE_API_KEY || '');
if (!apiKey) throw new Error('VITE_FIREBASE_API_KEY is required.');

const app = initializeApp({ credential: applicationDefault(), projectId }, `contractor-private-read-${Date.now()}`);
const database = getFirestore(app);
const adminAuth = getAuth(app);
const fixtureUids: string[] = [];

const masked = (value: string) =>
  value.length <= 8 ? '***' : `${value.slice(0, 4)}…${value.slice(-4)}`;

async function anonymousSession(): Promise<{ uid: string; token: string }> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    },
  );
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof data.localId !== 'string' || typeof data.idToken !== 'string') {
    throw new Error(`Could not create staging auth fixture (${response.status}).`);
  }
  fixtureUids.push(data.localId);
  return { uid: data.localId, token: data.idToken };
}

async function setProfile(uid: string, siteId: string): Promise<void> {
  await database.doc(`users/${uid}`).set({
    status: 'Active',
    role: 'Guard',
    site_id: siteId,
    operator_id: uid,
    operator_name: 'Staging Evidence Fixture',
    staging_test_fixture: true,
    fixture_kind: 'contractor-private-evidence',
  });
}

async function preview(fileId: string, token?: string): Promise<{
  status: number;
  contentType: string;
  size: number;
}> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mediaReference: fileId }),
  });
  const bytes = await response.arrayBuffer();
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    size: bytes.byteLength,
  };
}

interface EvidenceFixture {
  fileId: string;
  recordId: string;
  siteId: string;
  mediaType: string;
  status: string;
}

async function contractorFixtures(): Promise<EvidenceFixture[]> {
  const snapshot = await database.collection('mediaUploads')
    .where('module', '==', 'Contractor')
    .limit(100)
    .get();
  const fixtures: EvidenceFixture[] = [];
  for (const media of snapshot.docs) {
    const recordId = String(media.get('record_id') || '');
    const contractor = recordId
      ? await database.doc(`contractorLogs/${recordId}`).get()
      : null;
    if (!contractor?.exists || contractor.get('site_id') !== media.get('site_id')) continue;
    fixtures.push({
      fileId: media.id,
      recordId,
      siteId: String(media.get('site_id') || ''),
      mediaType: String(media.get('media_type') || ''),
      status: String(contractor.get('status') || ''),
    });
  }
  return fixtures;
}

async function vehicleFixture(siteId: string): Promise<EvidenceFixture | null> {
  const snapshot = await database.collection('mediaUploads')
    .where('module', '==', 'Vehicle')
    .where('site_id', '==', siteId)
    .limit(50)
    .get();
  for (const media of snapshot.docs) {
    const recordId = String(media.get('record_id') || '');
    const mediaType = String(media.get('media_type') || '');
    if (mediaType === 'activity_evidence') continue;
    const collection = ['entry_plate', 'entry_vehicle', 'visitor_document'].includes(mediaType)
      ? 'vehicleSessions'
      : 'vehicleLogs';
    const record = await database.doc(`${collection}/${recordId}`).get();
    if (record.exists && record.get('site_id') === siteId) {
      return {
        fileId: media.id,
        recordId,
        siteId,
        mediaType,
        status: String(record.get('status') || ''),
      };
    }
  }
  return null;
}

try {
  const fixtures = await contractorFixtures();
  const primary = fixtures[0];
  if (!primary) {
    console.log(JSON.stringify({
      success: false,
      reason: 'No registered Contractor media fixture exists on staging.',
      remaining_fixture_count: 0,
    }, null, 2));
    process.exitCode = 2;
  } else {
    const sameSite = await anonymousSession();
    const crossSite = await anonymousSession();
    await setProfile(sameSite.uid, primary.siteId);
    await setProfile(crossSite.uid, `${primary.siteId}-cross-site-fixture`);

    const tested = [];
    for (const mediaType of ['contractor_id', 'contractor_face', 'contractor_activity']) {
      for (const statusClass of ['active', 'exited']) {
        const fixture = fixtures.find(item =>
          item.mediaType === mediaType
          && (statusClass === 'active'
            ? item.status === 'กำลังปฏิบัติงาน'
            : item.status === 'ออกแล้ว'));
        if (!fixture) {
          tested.push({ media_type: mediaType, status_class: statusClass, result: 'MISSING_FIXTURE' });
          continue;
        }
        const result = await preview(fixture.fileId, sameSite.token);
        tested.push({
          media_type: mediaType,
          status_class: statusClass,
          file_id: masked(fixture.fileId),
          record_id: masked(fixture.recordId),
          http_status: result.status,
          image_response: result.contentType.startsWith('image/') && result.size > 0,
        });
      }
    }

    const unauthenticated = await preview(primary.fileId);
    const crossSiteResult = await preview(primary.fileId, crossSite.token);
    const vehicle = await vehicleFixture(primary.siteId);
    const vehicleResult = vehicle ? await preview(vehicle.fileId, sameSite.token) : null;

    console.log(JSON.stringify({
      success: tested.filter(item => 'http_status' in item)
        .every(item => item.http_status === 200 && item.image_response === true)
        && unauthenticated.status === 401
        && crossSiteResult.status === 403
        && (!vehicleResult || (vehicleResult.status === 200
          && vehicleResult.contentType.startsWith('image/')
          && vehicleResult.size > 0)),
      contractor: tested,
      unauthenticated_status: unauthenticated.status,
      cross_site_status: crossSiteResult.status,
      vehicle_non_regression: vehicleResult
        ? {
          media_type: vehicle?.mediaType,
          file_id: masked(vehicle?.fileId || ''),
          http_status: vehicleResult.status,
          image_response: vehicleResult.contentType.startsWith('image/') && vehicleResult.size > 0,
        }
        : 'MISSING_FIXTURE',
      registered_contractor_media_count: fixtures.length,
    }, null, 2));
  }
} finally {
  for (const uid of fixtureUids) {
    await database.doc(`users/${uid}`).delete().catch(() => undefined);
    await adminAuth.deleteUser(uid).catch(() => undefined);
  }
}
