import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { applicationDefault, getApps, initializeApp, type App } from 'firebase-admin/app';
import {
  DocumentReference,
  GeoPoint,
  Timestamp,
  getFirestore,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';

export const PRODUCTION_PROJECT_ID = 'securityprojectv1';
export const STAGING_PROJECT_ID = 'securityprojectv1-staging';
export const DEFAULT_DATABASE_ID = '(default)';
export const DEFAULT_MANIFEST_PATH = 'clone-manifest.json';

export const REFERENCE_COLLECTIONS = [
  'sites',
  'accounts',
  'operators',
  'parkingCards',
  'units',
  'patrolPoints',
  'keys',
  'blacklist',
  'systemSettings',
] as const;

export const OPERATIONAL_COLLECTIONS = [
  'vehicleLogs',
  'vehicleSessions',
  'contractorLogs',
  'keyLogs',
  'patrolLogs',
  'incidentReports',
] as const;

export const ENVIRONMENT_COLLECTIONS = [
  'auditLogs',
  'operatorLoginAttempts',
  'analytics',
  'queue',
  'cache',
  'metrics',
] as const;

export type SnapshotMode = '7d' | '30d' | '90d' | 'all';
export type ManagedCollection =
  | (typeof REFERENCE_COLLECTIONS)[number]
  | (typeof OPERATIONAL_COLLECTIONS)[number];

export interface SyncOptions {
  sourceProjectId: string;
  targetProjectId: string;
  confirmation: string;
  mode: SnapshotMode;
  now: Date;
}

export interface CloneDocument {
  id: string;
  data: DocumentData;
  hash: string;
}

export interface CollectionDiff {
  collection: ManagedCollection;
  tier: 'reference' | 'operational';
  sourceCount: number;
  targetCount: number;
  estimatedReads: number;
  estimatedWrites: number;
  missingIds: string[];
  extraIds: string[];
  mismatchedIds: string[];
}

export interface CloneManifest {
  schemaVersion: 1;
  source: string;
  target: string;
  databaseId: string;
  mode: SnapshotMode;
  startedAt: string;
  finishedAt: string;
  backupUri?: string;
  collections: Record<string, number>;
  reads: number;
  writes: number;
  rollbackDeletePaths?: string[];
  status: 'PASS' | 'FAIL' | 'DRY_RUN';
  diffs: CollectionDiff[];
}

const TIMESTAMP_FIELDS: Readonly<Record<(typeof OPERATIONAL_COLLECTIONS)[number], readonly string[]>> = {
  vehicleLogs: ['entry_time', 'created_at', 'updated_at'],
  vehicleSessions: ['created_at', 'last_activity_at', 'updated_at'],
  contractorLogs: ['entry_time', 'created_at', 'updated_at'],
  keyLogs: ['checkout_time', 'created_at', 'updated_at'],
  patrolLogs: ['scan_time', 'patrol_time', 'created_at', 'updated_at'],
  incidentReports: ['incident_time', 'created_at', 'updated_at'],
};
const DATABASE_PROJECTS = new WeakMap<Firestore, string>();

export function structuredLog(event: string, detail: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...detail,
  })}\n`);
}

export function parseArguments(argv: readonly string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  for (const argument of argv) {
    if (!argument.startsWith('--')) continue;
    const separator = argument.indexOf('=');
    if (separator === -1) parsed.set(argument.slice(2), true);
    else parsed.set(argument.slice(2, separator), argument.slice(separator + 1));
  }
  return parsed;
}

export function snapshotMode(value: unknown): SnapshotMode {
  if (value === '7d' || value === '30d' || value === '90d' || value === 'all') return value;
  throw new Error('Invalid snapshot mode. Use --mode=7d, 30d, 90d, or all.');
}

export function assertSafeProjects(options: Pick<SyncOptions, 'sourceProjectId' | 'targetProjectId' | 'confirmation'>): void {
  if (options.sourceProjectId === STAGING_PROJECT_ID) throw new Error('Refusing execution: source cannot be Staging.');
  if (options.sourceProjectId !== PRODUCTION_PROJECT_ID) throw new Error(`Project mismatch: expected source ${PRODUCTION_PROJECT_ID}.`);
  if (options.targetProjectId === PRODUCTION_PROJECT_ID) throw new Error('Refusing execution: destination cannot be Production.');
  if (options.targetProjectId !== STAGING_PROJECT_ID) throw new Error(`Project mismatch: expected target ${STAGING_PROJECT_ID}.`);
  if (options.confirmation !== STAGING_PROJECT_ID) {
    throw new Error(`Execution requires --confirm=${STAGING_PROJECT_ID}.`);
  }
}

export function operationalCutoff(mode: SnapshotMode, now: Date): Date | null {
  if (mode === 'all') return null;
  const days = Number.parseInt(mode, 10);
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
  }
  return null;
}

export function isInsideOperationalWindow(
  collection: (typeof OPERATIONAL_COLLECTIONS)[number],
  data: DocumentData,
  cutoff: Date | null,
): boolean {
  if (!cutoff) return true;
  for (const field of TIMESTAMP_FIELDS[collection]) {
    const candidate = dateValue(data[field]);
    if (candidate) return candidate.getTime() >= cutoff.getTime();
  }
  return false;
}

function canonicalValue(value: unknown): unknown {
  if (value instanceof Timestamp) return { __type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof Date) return { __type: 'date', value: value.toISOString() };
  if (value instanceof DocumentReference) return { __type: 'reference', path: value.path };
  if (value instanceof GeoPoint) return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (Buffer.isBuffer(value)) return { __type: 'bytes', value: value.toString('base64') };
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function documentHash(data: DocumentData): string {
  return createHash('sha256').update(JSON.stringify(canonicalValue(data))).digest('hex');
}

function cloneValueForTarget(value: unknown, target: Firestore): unknown {
  if (value instanceof DocumentReference) return target.doc(value.path);
  if (Array.isArray(value)) return value.map(item => cloneValueForTarget(item, target));
  if (
    value &&
    typeof value === 'object' &&
    !(value instanceof Timestamp) &&
    !(value instanceof Date) &&
    !(value instanceof GeoPoint) &&
    !Buffer.isBuffer(value)
  ) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, cloneValueForTarget(item, target)]),
    );
  }
  return value;
}

export function initializeProject(projectId: string, role: 'source' | 'target'): Firestore {
  const name = `staging-sync-${role}-${projectId}`;
  const existing = getApps().find(app => app.name === name);
  const app: App = existing || initializeApp({
    credential: applicationDefault(),
    projectId,
  }, name);
  const database = getFirestore(app, DEFAULT_DATABASE_ID);
  database.settings({ ignoreUndefinedProperties: false });
  DATABASE_PROJECTS.set(database, projectId);
  return database;
}

export async function readManagedCollection(
  database: Firestore,
  collection: ManagedCollection,
  mode: SnapshotMode,
  now: Date,
): Promise<CloneDocument[]> {
  const snapshot = await database.collection(collection).get();
  const cutoff = operationalCutoff(mode, now);
  const operational = (OPERATIONAL_COLLECTIONS as readonly string[]).includes(collection);
  const roots = snapshot.docs.filter(item => !operational || isInsideOperationalWindow(
      collection as (typeof OPERATIONAL_COLLECTIONS)[number],
      item.data(),
      cutoff,
    ));
  const documents = (await Promise.all(roots.map(item => readDocumentTree(item, collection)))).flat();
  return documents.sort((left, right) => left.id.localeCompare(right.id));
}

async function readDocumentTree(
  snapshot: QueryDocumentSnapshot,
  rootCollection: ManagedCollection,
): Promise<CloneDocument[]> {
  const relativePath = snapshot.ref.path.slice(rootCollection.length + 1);
  const current = {
    id: relativePath,
    data: snapshot.data(),
    hash: documentHash(snapshot.data()),
  };
  const childCollections = await snapshot.ref.listCollections();
  const childDocuments = (
    await Promise.all(childCollections.map(async child => {
      const children = await child.get();
      return (await Promise.all(children.docs.map(item => readDocumentTree(item, rootCollection)))).flat();
    }))
  ).flat();
  return [current, ...childDocuments];
}

export function diffCollection(
  collection: ManagedCollection,
  source: readonly CloneDocument[],
  target: readonly CloneDocument[],
): CollectionDiff {
  const sourceMap = new Map(source.map(item => [item.id, item]));
  const targetMap = new Map(target.map(item => [item.id, item]));
  const missingIds = source.filter(item => !targetMap.has(item.id)).map(item => item.id);
  const extraIds = target.filter(item => !sourceMap.has(item.id)).map(item => item.id);
  const mismatchedIds = source
    .filter(item => targetMap.has(item.id) && targetMap.get(item.id)?.hash !== item.hash)
    .map(item => item.id);
  return {
    collection,
    tier: (REFERENCE_COLLECTIONS as readonly string[]).includes(collection) ? 'reference' : 'operational',
    sourceCount: source.length,
    targetCount: target.length,
    estimatedReads: source.length + target.length,
    estimatedWrites: missingIds.length + extraIds.length + mismatchedIds.length,
    missingIds,
    extraIds,
    mismatchedIds,
  };
}

export async function buildDiffs(
  source: Firestore,
  target: Firestore,
  mode: SnapshotMode,
  now: Date,
): Promise<Array<{ diff: CollectionDiff; source: CloneDocument[] }>> {
  const collections = [...REFERENCE_COLLECTIONS, ...OPERATIONAL_COLLECTIONS];
  const output: Array<{ diff: CollectionDiff; source: CloneDocument[] }> = [];
  for (const collection of collections) {
    const [sourceDocuments, targetDocuments] = await Promise.all([
      readManagedCollection(source, collection, mode, now),
      // Target is intentionally read without a window so records outside the
      // selected operational snapshot are detected as extras and removed.
      readManagedCollection(target, collection, 'all', now),
    ]);
    const diff = diffCollection(collection, sourceDocuments, targetDocuments);
    structuredLog('collection_diff', summarizeDiff(diff));
    output.push({ diff, source: sourceDocuments });
  }
  return output;
}

async function commitWithRetry(
  database: Firestore,
  operations: ReadonlyArray<{ type: 'set' | 'delete'; path: string; data?: DocumentData }>,
  maxAttempts = 4,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const batch = database.batch();
      for (const operation of operations) {
        const reference = database.doc(operation.path);
        if (operation.type === 'delete') batch.delete(reference);
        else batch.set(reference, cloneValueForTarget(operation.data || {}, database) as DocumentData);
      }
      await batch.commit();
      return;
    } catch (error) {
      lastError = error;
      structuredLog('batch_retry', { attempt, maxAttempts, operations: operations.length });
      if (attempt < maxAttempts) await new Promise(resolve => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

export async function applyDiffs(
  target: Firestore,
  planned: ReadonlyArray<{ diff: CollectionDiff; source: CloneDocument[] }>,
): Promise<number> {
  const targetProjectId = DATABASE_PROJECTS.get(target) || '';
  if (targetProjectId !== STAGING_PROJECT_ID) {
    throw new Error(`Write guard refused target project: ${targetProjectId || '(missing)'}`);
  }
  const operations: Array<{ type: 'set' | 'delete'; path: string; data?: DocumentData }> = [];
  for (const item of planned) {
    const writeIds = new Set([...item.diff.missingIds, ...item.diff.mismatchedIds]);
    for (const document of item.source) {
      if (writeIds.has(document.id)) operations.push({
        type: 'set',
        path: `${item.diff.collection}/${document.id}`,
        data: document.data,
      });
    }
    for (const id of item.diff.extraIds) operations.push({
      type: 'delete',
      path: `${item.diff.collection}/${id}`,
    });
  }
  for (let start = 0; start < operations.length; start += 400) {
    const batch = operations.slice(start, start + 400);
    await commitWithRetry(target, batch);
    structuredLog('batch_committed', {
      completed: Math.min(start + batch.length, operations.length),
      total: operations.length,
    });
  }
  return operations.length;
}

export function runStagingBackup(): string {
  const result = spawnSync(process.execPath, [
    'scripts/backup-staging.mjs',
    '--apply',
    `--confirm=${STAGING_PROJECT_ID}`,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`Staging backup failed; clone aborted. ${String(result.stderr || result.stdout).trim()}`);
  }
  const lines = String(result.stdout || '').trim().split(/\r?\n/);
  const payload = JSON.parse(lines.join('\n')) as { success?: boolean; firestore_export_uri?: string };
  if (!payload.success || !payload.firestore_export_uri) {
    throw new Error('Staging backup did not return a verified export URI; clone aborted.');
  }
  return payload.firestore_export_uri;
}

export async function rollbackFromManifest(path: string, confirmation: string): Promise<void> {
  if (confirmation !== STAGING_PROJECT_ID) throw new Error(`Rollback requires --confirm=${STAGING_PROJECT_ID}.`);
  if (!existsSync(path)) throw new Error(`Rollback manifest not found: ${path}`);
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as CloneManifest;
  assertSafeProjects({
    sourceProjectId: manifest.source,
    targetProjectId: manifest.target,
    confirmation,
  });
  if (!manifest.backupUri) throw new Error('Manifest does not contain a staging backup URI.');
  const localGcloud = `${process.cwd()}/.tools/google-cloud-sdk/bin/gcloud`;
  const result = spawnSync(existsSync(localGcloud) ? localGcloud : 'gcloud', [
    'firestore',
    'import',
    manifest.backupUri,
    '--project',
    STAGING_PROJECT_ID,
    '--database',
    DEFAULT_DATABASE_ID,
    '--quiet',
  ], { cwd: process.cwd(), encoding: 'utf8', env: process.env, shell: false });
  if (result.status !== 0) throw new Error(`Rollback import failed: ${String(result.stderr || result.stdout).trim()}`);
  const addedPaths = manifest.rollbackDeletePaths || [];
  if (addedPaths.length) {
    const target = initializeProject(STAGING_PROJECT_ID, 'target');
    for (let start = 0; start < addedPaths.length; start += 400) {
      await commitWithRetry(target, addedPaths.slice(start, start + 400).map(pathValue => ({
        type: 'delete' as const,
        path: pathValue,
      })));
    }
  }
  structuredLog('rollback_completed', {
    project: STAGING_PROJECT_ID,
    backupUri: manifest.backupUri,
    cloneAddedDocumentsRemoved: addedPaths.length,
  });
}

export function summarizeDiff(diff: CollectionDiff): Record<string, unknown> {
  const sample = (values: readonly string[]) => values.slice(0, 20);
  return {
    collection: diff.collection,
    tier: diff.tier,
    sourceCount: diff.sourceCount,
    targetCount: diff.targetCount,
    estimatedReads: diff.estimatedReads,
    estimatedWrites: diff.estimatedWrites,
    missingCount: diff.missingIds.length,
    extraCount: diff.extraIds.length,
    mismatchedCount: diff.mismatchedIds.length,
    missingSample: sample(diff.missingIds),
    extraSample: sample(diff.extraIds),
    mismatchedSample: sample(diff.mismatchedIds),
    truncated: diff.missingIds.length > 20 || diff.extraIds.length > 20 || diff.mismatchedIds.length > 20,
  };
}

export function writeManifest(path: string, manifest: CloneManifest): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function manifestFromDiffs(
  options: SyncOptions,
  startedAt: string,
  status: CloneManifest['status'],
  diffs: readonly CollectionDiff[],
  backupUri?: string,
): CloneManifest {
  return {
    schemaVersion: 1,
    source: options.sourceProjectId,
    target: options.targetProjectId,
    databaseId: DEFAULT_DATABASE_ID,
    mode: options.mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(backupUri ? { backupUri } : {}),
    collections: Object.fromEntries(diffs.map(item => [item.collection, item.sourceCount])),
    reads: diffs.reduce((sum, item) => sum + item.estimatedReads, 0),
    writes: diffs.reduce((sum, item) => sum + item.estimatedWrites, 0),
    status,
    diffs: [...diffs],
  };
}
