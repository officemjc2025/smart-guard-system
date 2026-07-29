import { Timestamp } from 'firebase-admin/firestore';
import {
  canonicalStaffRows,
  hashPin,
  normalizeUsername,
  verifyOperatorPinLogin,
} from '../operatorAuthService';

describe('canonical employee listing', () => {
  it('returns one employee even when ten session profiles exist for that operator', () => {
    const sessions = Array.from({ length: 10 }, (_, index) => ({
      id: `anonymous-${index}`,
      account_id: 'account-admin',
      operator_id: 'operator-admin',
      role: 'Admin',
    }));
    const rows = canonicalStaffRows(
      [{ id: 'account-admin', data: {
        account_id: 'account-admin', username: 'admin', role: 'Admin',
        site_id: 'site-01', status: 'Active',
      } }],
      [{ id: 'operator-admin', data: {
        operator_id: 'operator-admin', account_id: 'account-admin',
        username: 'admin', operator_name: 'Staging Admin', role: 'Admin',
        site_id: 'site-01', status: 'Active',
      } }],
    );
    expect(sessions).toHaveLength(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operator_id: 'operator-admin',
      account_id: 'account-admin',
      username: 'admin',
      role: 'Admin',
    });
    expect(rows[0].user_id).not.toMatch(/^anonymous-/);
  });
});

type StoredDocument = { exists: boolean; data: () => Record<string, unknown> | undefined };

function fakeFirestore(pin: string) {
  const credential = hashPin(pin, 'test-salt');
  const documents: Record<string, StoredDocument> = {
    'operatorCredentials/admin': {
      exists: true,
      data: () => ({
        username: 'admin',
        operator_id: 'operator-admin',
        account_id: 'account-admin',
        algorithm: credential.algorithm,
        pin_salt: credential.salt,
        pin_hash: credential.hash,
        status: 'Active',
      }),
    },
    'operatorLoginAttempts/admin': { exists: false, data: () => undefined },
    'operators/operator-admin': {
      exists: true,
      data: () => ({
        operator_id: 'operator-admin',
        account_id: 'account-admin',
        username: 'admin',
        operator_name: 'Staging Admin',
        role: 'Admin',
        site_id: 'site-01',
        status: 'Active',
      }),
    },
    'accounts/account-admin': {
      exists: true,
      data: () => ({
        account_id: 'account-admin',
        username: 'admin',
        role: 'Admin',
        site_id: 'site-01',
        status: 'Active',
      }),
    },
  };
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  const firestore = {
    collection: (collectionName: string) => ({
      doc: (documentId: string) => ({ path: `${collectionName}/${documentId}` }),
    }),
    runTransaction: async (operation: (transaction: {
      get: (reference: { path: string }) => Promise<StoredDocument>;
      set: (reference: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<unknown>) => operation({
      get: async reference => documents[reference.path] || { exists: false, data: () => undefined },
      set: (reference, data) => writes.push({ path: reference.path, data }),
    }),
  };
  return { firestore, writes };
}

describe('verifyOperatorPin login contract', () => {
  it('normalizes the client and Function username identically', () => {
    expect(normalizeUsername('  Ad Min  ')).toBe('admin');
  });

  it('rejects a request without Firebase Authentication', async () => {
    const { firestore } = fakeFirestore('123456');
    await expect(verifyOperatorPinLogin(firestore as never, {
      auth: undefined,
      data: { username: 'admin', pin: '123456' },
    } as never)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('accepts an anonymous UID and writes the canonical users/{uid} profile', async () => {
    const { firestore, writes } = fakeFirestore('123456');
    const result = await verifyOperatorPinLogin(firestore as never, {
      auth: { uid: 'anonymous-uid', token: { firebase: { sign_in_provider: 'anonymous' } } },
      data: { username: 'ADMIN', pin: '123456' },
    } as never);
    expect(result.profile).toMatchObject({
      user_id: 'anonymous-uid',
      auth_uid: 'anonymous-uid',
      account_id: 'account-admin',
      operator_id: 'operator-admin',
      username: 'admin',
      role: 'Admin',
      site_id: 'site-01',
      status: 'Active',
    });
    const profileWrite = writes.find(item => item.path === 'users/anonymous-uid');
    expect(profileWrite?.data).toMatchObject({
      auth_uid: 'anonymous-uid',
      role: 'Admin',
      site_id: 'site-01',
      status: 'Active',
    });
    expect(profileWrite?.data.last_login_at).toBeInstanceOf(Timestamp);
  });
});
