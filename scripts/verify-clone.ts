import {
  DEFAULT_MANIFEST_PATH,
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  assertSafeProjects,
  buildDiffs,
  initializeProject,
  manifestFromDiffs,
  parseArguments,
  snapshotMode,
  structuredLog,
  writeManifest,
  type SyncOptions,
} from './lib/staging-sync';

const args = parseArguments(process.argv.slice(2));
const options: SyncOptions = {
  sourceProjectId: String(args.get('source') || PRODUCTION_PROJECT_ID),
  targetProjectId: String(args.get('target') || STAGING_PROJECT_ID),
  confirmation: String(args.get('confirm') || ''),
  mode: snapshotMode(args.get('mode') || '30d'),
  now: new Date(),
};
assertSafeProjects(options);
const startedAt = new Date().toISOString();
const source = initializeProject(options.sourceProjectId, 'source');
const target = initializeProject(options.targetProjectId, 'target');
const planned = await buildDiffs(source, target, options.mode, options.now);
const diffs = planned.map(item => item.diff);
const passed = diffs.every(item => item.estimatedWrites === 0);
const manifestPath = String(args.get('manifest') || DEFAULT_MANIFEST_PATH);
const manifest = manifestFromDiffs(options, startedAt, passed ? 'PASS' : 'FAIL', diffs);
writeManifest(manifestPath, manifest);
structuredLog('clone_verified', { manifest: manifestPath, status: manifest.status, collections: diffs.length });
if (!passed) process.exitCode = 1;
