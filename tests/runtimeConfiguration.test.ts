import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeConfiguration } from '../src/config/runtimeValidation';

const valid = {
  projectId: 'securityprojectv1',
  authDomain: 'securityprojectv1.firebaseapp.com',
  storageBucket: 'securityprojectv1.firebasestorage.app',
  appId: 'app-id',
};

test('development runtime config accepts a complete Firebase configuration', () => {
  assert.equal(validateRuntimeConfiguration(valid, 'development', {}).projectId, 'securityprojectv1');
});

test('runtime config rejects missing Firebase identity fields', () => {
  assert.throws(() => validateRuntimeConfiguration({ projectId: 'x' }, 'development', {}));
});

test('staging environment refuses the Production project', () => {
  assert.throws(() => validateRuntimeConfiguration(valid, 'production', {
    VITE_APP_ENV: 'STAGING',
    VITE_EXPECTED_FIREBASE_PROJECT_ID: 'securityprojectv1',
  }), /Staging build cannot target/);
});

test('production environment refuses a staging project', () => {
  assert.throws(() => validateRuntimeConfiguration({
    ...valid, projectId: 'securityprojectv1-staging',
  }, 'production', {
    VITE_APP_ENV: 'PRODUCTION',
    VITE_EXPECTED_FIREBASE_PROJECT_ID: 'securityprojectv1-staging',
  }), /Production build cannot target/);
});

test('production validation rejects stale upload and private-media regions', () => {
  const base = {
    VITE_APP_ENV: 'PRODUCTION',
    VITE_EXPECTED_FIREBASE_PROJECT_ID: 'securityprojectv1',
    VITE_FUNCTIONS_REGION: 'asia-southeast1',
  };
  assert.throws(() => validateRuntimeConfiguration(valid, 'production', {
    ...base,
    VITE_MEDIA_UPLOAD_URL: 'https://us-central1-securityprojectv1.cloudfunctions.net/uploadVehicleEvidence',
  }), /must match the configured production Functions region/);
  assert.throws(() => validateRuntimeConfiguration(valid, 'production', {
    ...base,
    VITE_PRIVATE_MEDIA_URL: 'https://us-central1-securityprojectv1.cloudfunctions.net/getVehicleEvidenceImage',
  }), /must match the configured production Functions region/);
});
