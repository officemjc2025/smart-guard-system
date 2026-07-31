import {
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  assertSafeProjects,
  buildDiffs,
  initializeProject,
  parseArguments,
  snapshotMode,
  structuredLog,
  summarizeDiff,
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
const source = initializeProject(options.sourceProjectId, 'source');
const target = initializeProject(options.targetProjectId, 'target');
const planned = await buildDiffs(source, target, options.mode, options.now);
const diffs = planned.map(item => item.diff);
structuredLog('projects_compared', {
  source: options.sourceProjectId,
  target: options.targetProjectId,
  mode: options.mode,
  collections: diffs.map(summarizeDiff),
  totals: {
    source: diffs.reduce((sum, item) => sum + item.sourceCount, 0),
    target: diffs.reduce((sum, item) => sum + item.targetCount, 0),
    missing: diffs.reduce((sum, item) => sum + item.missingIds.length, 0),
    extra: diffs.reduce((sum, item) => sum + item.extraIds.length, 0),
    mismatched: diffs.reduce((sum, item) => sum + item.mismatchedIds.length, 0),
  },
});
