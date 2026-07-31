import {
  DEFAULT_MANIFEST_PATH,
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  applyDiffs,
  assertSafeProjects,
  buildDiffs,
  initializeProject,
  manifestFromDiffs,
  parseArguments,
  rollbackFromManifest,
  runStagingBackup,
  snapshotMode,
  structuredLog,
  writeManifest,
  type SyncOptions,
} from './lib/staging-sync';

const args = parseArguments(process.argv.slice(2));
const confirmation = String(args.get('confirm') || '');
const rollbackManifest = args.get('rollback');

if (typeof rollbackManifest === 'string') {
  await rollbackFromManifest(rollbackManifest, confirmation);
  process.exit(0);
}

const dryRun = args.get('dry-run') === true;
const apply = args.get('apply') === true;
if (dryRun === apply) throw new Error('Choose exactly one mode: --dry-run or --apply.');

const options: SyncOptions = {
  sourceProjectId: String(args.get('source') || PRODUCTION_PROJECT_ID),
  targetProjectId: String(args.get('target') || STAGING_PROJECT_ID),
  confirmation,
  mode: snapshotMode(args.get('mode') || '30d'),
  now: new Date(),
};
assertSafeProjects(options);

const startedAt = new Date().toISOString();
const manifestPath = String(args.get('manifest') || DEFAULT_MANIFEST_PATH);
structuredLog('clone_started', {
  source: options.sourceProjectId,
  target: options.targetProjectId,
  mode: options.mode,
  operation: dryRun ? 'dry-run' : 'apply',
});

const source = initializeProject(options.sourceProjectId, 'source');
const target = initializeProject(options.targetProjectId, 'target');
const planned = await buildDiffs(source, target, options.mode, options.now);
const diffs = planned.map(item => item.diff);

if (dryRun) {
  const manifest = manifestFromDiffs(options, startedAt, 'DRY_RUN', diffs);
  writeManifest(manifestPath, manifest);
  structuredLog('clone_dry_run_completed', {
    manifest: manifestPath,
    collections: diffs.length,
    documents: Object.values(manifest.collections).reduce((sum, count) => sum + count, 0),
    estimatedReads: manifest.reads,
    estimatedWrites: manifest.writes,
  });
  process.exit(0);
}

let backupUri = '';
try {
  structuredLog('backup_started', { target: options.targetProjectId });
  backupUri = runStagingBackup();
  structuredLog('backup_completed', { target: options.targetProjectId, backupUri });
  const writes = await applyDiffs(target, planned);
  const verification = await buildDiffs(source, target, options.mode, options.now);
  const verificationDiffs = verification.map(item => item.diff);
  const passed = verificationDiffs.every(item => item.estimatedWrites === 0);
  const manifest = manifestFromDiffs(options, startedAt, passed ? 'PASS' : 'FAIL', verificationDiffs, backupUri);
  manifest.writes = writes;
  manifest.rollbackDeletePaths = planned.flatMap(item =>
    item.diff.missingIds.map(id => `${item.diff.collection}/${id}`),
  );
  writeManifest(manifestPath, manifest);
  structuredLog('clone_completed', { manifest: manifestPath, status: manifest.status, writes });
  if (!passed) process.exitCode = 1;
} catch (error) {
  const manifest = manifestFromDiffs(options, startedAt, 'FAIL', diffs, backupUri || undefined);
  writeManifest(manifestPath, manifest);
  structuredLog('clone_failed', {
    manifest: manifestPath,
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
}
