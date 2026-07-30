import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listOfflineContractors,
  queueOfflineContractor,
  removeOfflineContractor,
} from '../src/services/contractorOfflineQueue';
import { createInitialContractorForm } from '../src/services/contractorWorkspace';

test('offline Contractor entries remain distinct and can be removed after sync', () => {
  const values = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  const base = {
    siteId: 'site-01',
    guardName: 'Guard One',
    entryTime: '2026-07-30T02:00:00.000Z',
    form: createInitialContractorForm(),
    idCardPhotoDataUrl: '',
    facePhotoDataUrl: '',
  };
  queueOfflineContractor({ ...base, localId: 'CON_offline_1' });
  queueOfflineContractor({ ...base, localId: 'CON_offline_2' });

  assert.deepEqual(listOfflineContractors().map(item => item.localId), [
    'CON_offline_1',
    'CON_offline_2',
  ]);
  removeOfflineContractor('CON_offline_1');
  assert.deepEqual(listOfflineContractors().map(item => item.localId), ['CON_offline_2']);
});
