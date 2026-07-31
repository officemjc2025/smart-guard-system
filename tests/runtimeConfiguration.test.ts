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
