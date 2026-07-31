import 'dotenv/config';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'securityprojectv1-staging';
const endpoint = 'https://asia-southeast1-securityprojectv1-staging.cloudfunctions.net/getVehicleEvidenceImage';
const apiKey = String(process.env.VITE_FIREBASE_API_KEY || '');
if (!apiKey) throw new Error('VITE_FIREBASE_API_KEY is required.');

const app = initializeApp({ credential: applicationDefault(), projectId }, `key-private-read-${Date.now()}`);
const database = getFirestore(app);
const adminAuth = getAuth(app);
const fixtureUids: string[] = [];
const masked = (value: string) =>
  value.length <= 8 ? '***' : `${value.slice(0, 4)}…${value.slice(-4)}`;

interface EvidenceFixture {
  mediaReference: string;
  fileId: string;
  recordId: string;
  siteId: string;
  mediaType: string;
  status: string;
  moduleName: string;
}

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
    operator_name: 'Staging Key Evidence Fixture',
    staging_test_fixture: true,
    fixture_kind: 'key-private-evidence',
  });
}

async function preview(mediaReference: string, token?: string) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mediaReference }),
  });
  const bytes = await response.arrayBuffer();
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    size: bytes.byteLength,
  };
}

async function keyFixtures(): Promise<EvidenceFixture[]> {
  const snapshot = await database.collection('mediaUploads')
    .where('module', '==', 'Key')
    .limit(100)
    .get();
  const fixtures: EvidenceFixture[] = [];
  for (const media of snapshot.docs) {
    const recordId = String(media.get('record_id') || '');
    const mediaType = String(media.get('media_type') || '');
    const keyLog = recordId ? await database.doc(`keyLogs/${recordId}`).get() : null;
    if (!keyLog?.exists || keyLog.get('site_id') !== media.get('site_id')) continue;
    const referenceField = {
      key_borrower: 'borrower_photo_url',
      sig_key: 'signature_image_url',
      key_return: 'return_photo_url',
      sig_key_return: 'return_signature_url',
    }[mediaType] || '';
    const mediaReference = referenceField ? String(keyLog.get(referenceField) || '') : '';
    if (!mediaReference || !mediaReference.includes(media.id)) continue;
    fixtures.push({
      mediaReference,
      fileId: media.id,
      recordId,
      siteId: String(media.get('site_id') || ''),
      mediaType,
      status: String(keyLog.get('status') || ''),
      moduleName: String(media.get('module_name') || ''),
    });
  }
  return fixtures;
}

async function nonKeyFixture(module: 'Vehicle' | 'Contractor', siteId: string) {
  const snapshot = await database.collection('mediaUploads')
    .where('module', '==', module)
    .where('site_id', '==', siteId)
    .limit(50)
    .get();
  for (const media of snapshot.docs) {
    const recordId = String(media.get('record_id') || '');
    const mediaType = String(media.get('media_type') || '');
    if (mediaType === 'activity_evidence') continue;
    const collection = module === 'Contractor'
      ? 'contractorLogs'
      : ['entry_plate', 'entry_vehicle', 'visitor_document'].includes(mediaType)
        ? 'vehicleSessions' : 'vehicleLogs';
    const record = await database.doc(`${collection}/${recordId}`).get();
    if (record.exists && record.get('site_id') === siteId) return media.id;
  }
  return '';
}

try {
  const fixtures = await keyFixtures();
  const primary = fixtures[0];
  if (!primary) {
    console.log(JSON.stringify({
      success: false,
      reason: 'No securely linked Key media fixture exists on staging.',
      registered_key_media_count: 0,
    }, null, 2));
    process.exitCode = 2;
  } else {
    const sameSite = await anonymousSession();
    const crossSiteSession = await anonymousSession();
    await setProfile(sameSite.uid, primary.siteId);
    await setProfile(crossSiteSession.uid, `${primary.siteId}-cross-site-fixture`);

    const keyResults = [];
    for (const mediaType of ['key_borrower', 'sig_key', 'key_return', 'sig_key_return']) {
      const statuses = mediaType === 'key_return' || mediaType === 'sig_key_return'
        ? ['คืนแล้ว'] : ['ถูกเบิก', 'คืนแล้ว'];
      for (const status of statuses) {
        const fixture = fixtures.find(item => item.mediaType === mediaType && item.status === status);
        if (!fixture) {
          keyResults.push({ media_type: mediaType, status, result: 'MISSING_FIXTURE' });
          continue;
        }
        const result = await preview(fixture.mediaReference, sameSite.token);
        keyResults.push({
          media_type: mediaType,
          status,
          module_name: fixture.moduleName || '(missing legacy metadata)',
          file_id: masked(fixture.fileId),
          record_id: masked(fixture.recordId),
          http_status: result.status,
          image_response: result.contentType.startsWith('image/') && result.size > 0,
        });
      }
    }

    const unauthenticated = await preview(primary.mediaReference);
    const crossSiteResult = await preview(primary.mediaReference, crossSiteSession.token);
    const vehicleReference = await nonKeyFixture('Vehicle', primary.siteId);
    const contractorReference = await nonKeyFixture('Contractor', primary.siteId);
    const vehicle = vehicleReference ? await preview(vehicleReference, sameSite.token) : null;
    const contractor = contractorReference ? await preview(contractorReference, sameSite.token) : null;
    const exercised = keyResults.filter(result => 'http_status' in result);
    const regressions = [vehicle, contractor].filter(result => result !== null);

    console.log(JSON.stringify({
      success: exercised.length > 0
        && exercised.every(result => result.http_status === 200 && result.image_response)
        && unauthenticated.status === 401
        && crossSiteResult.status === 403
        && regressions.every(result => result?.status === 200
          && result.contentType.startsWith('image/') && result.size > 0),
      endpoint,
      key: keyResults,
      unauthenticated_status: unauthenticated.status,
      cross_site_status: crossSiteResult.status,
      vehicle_non_regression: vehicle
        ? { http_status: vehicle.status, image_response: vehicle.contentType.startsWith('image/') && vehicle.size > 0 }
        : 'MISSING_FIXTURE',
      contractor_non_regression: contractor
        ? { http_status: contractor.status, image_response: contractor.contentType.startsWith('image/') && contractor.size > 0 }
        : 'MISSING_FIXTURE',
      registered_key_media_count: fixtures.length,
    }, null, 2));
  }
} finally {
  for (const uid of fixtureUids) {
    await database.doc(`users/${uid}`).delete().catch(() => undefined);
    await adminAuth.deleteUser(uid).catch(() => undefined);
  }
}
