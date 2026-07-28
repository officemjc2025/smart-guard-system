import {
  runTransaction,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase/firestore';

export class SessionConflictError extends Error {
  readonly code = 'SESSION_VERSION_CONFLICT';
  constructor(
    readonly sessionId: string,
    readonly expectedVersion: number,
    readonly actualVersion: number,
    readonly latestSession?: DocumentData,
  ) {
    super('ข้อมูลถูกแก้ไขโดยผู้ใช้อื่นแล้ว');
    this.name = 'SessionConflictError';
  }
}

export function assertExpectedSessionVersion(
  sessionId: string,
  expectedVersion: number,
  actualVersion: unknown,
  latestSession?: DocumentData,
): number {
  const normalized = typeof actualVersion === 'number' && Number.isInteger(actualVersion) && actualVersion >= 0
    ? actualVersion : 0;
  if (normalized !== expectedVersion) {
    throw new SessionConflictError(sessionId, expectedVersion, normalized, latestSession);
  }
  return normalized;
}

export function incrementSessionVersions(
  currentSessionVersion: number,
  currentAssignmentVersion: number,
  assignmentChanged: boolean,
) {
  return {
    sessionVersion: currentSessionVersion + 1,
    assignmentVersion: currentAssignmentVersion + (assignmentChanged ? 1 : 0),
  };
}

export async function updateSessionWithExpectedVersion(
  firestore: Firestore,
  reference: DocumentReference,
  expectedVersion: number,
  update: (transaction: Transaction, current: DocumentData, nextVersion: number) => void,
): Promise<number> {
  return runTransaction(firestore, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Vehicle Session not found.');
    const actual = assertExpectedSessionVersion(snapshot.id, expectedVersion, snapshot.get('sessionVersion'), snapshot.data());
    const nextVersion = actual + 1;
    update(transaction, snapshot.data(), nextVersion);
    return nextVersion;
  });
}
