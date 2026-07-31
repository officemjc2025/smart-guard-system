import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  activeFirebaseProject,
  command,
  printJson,
} from './lib/infrastructure.mjs';

const ROUTES = Object.freeze({
  [STAGING_PROJECT_ID]: Object.freeze({
    environment: 'STAGING',
    validator: 'scripts/predeploy-staging.mjs',
    build: 'build:staging',
  }),
  [PRODUCTION_PROJECT_ID]: Object.freeze({
    environment: 'PRODUCTION',
    validator: 'scripts/predeploy-production.mjs',
    build: 'build:production',
  }),
});

export function selectPredeployRoute(projectId) {
  const route = ROUTES[projectId];
  if (!route) throw new Error(`Unknown Firebase project is blocked: ${projectId || '(missing)'}`);
  return route;
}

export function runChecked(commandRunner, executable, args, name) {
  const child = commandRunner(executable, args, { stdio: 'inherit' });
  if (!child.ok) throw new Error(`${name} failed with exit code ${child.status ?? 'unknown'}`);
  return child;
}

const cachePath = (projectId) => {
  const identity = createHash('sha256')
    .update(`${process.cwd()}\0${process.ppid}\0${projectId}`)
    .digest('hex').slice(0, 24);
  return join(tmpdir(), `smart-guard-predeploy-${identity}.json`);
};

const readCache = (path) => {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed.created_at || Date.now() - parsed.created_at > 10 * 60 * 1000) return {};
    return parsed;
  } catch {
    return {};
  }
};

export function executePredeploy({ projectId, target, commandRunner = command, cache = null }) {
  const route = selectPredeployRoute(projectId);
  if (!['functions', 'hosting'].includes(target)) throw new Error(`Unsupported predeploy target: ${target || '(missing)'}`);
  const state = cache || {};
  const steps = [];

  if (!state.validated) {
    runChecked(commandRunner, process.execPath, [route.validator], `${route.environment} validator`);
    state.validated = true;
    steps.push({ name: 'validation', status: 'PASS', action: 'executed' });
  } else {
    steps.push({ name: 'validation', status: 'PASS', action: 'reused_for_same_firebase_process' });
  }

  if (target === 'hosting') {
    if (!state.built) {
      runChecked(commandRunner, 'npm', ['run', route.build], `${route.environment} build`);
      state.built = true;
      steps.push({ name: 'build', status: 'PASS', action: 'executed' });
    } else {
      steps.push({ name: 'build', status: 'PASS', action: 'reused_for_same_firebase_process' });
    }
  } else {
    steps.push({ name: 'build', status: 'NOT_REQUIRED', action: 'functions_target' });
  }

  return { route, state, steps };
}

async function main() {
  const target = process.argv[2];
  const active = activeFirebaseProject();
  if (!active.ok || !active.projectId) throw new Error(`Unable to determine active Firebase project: ${active.stderr || active.stdout || '(no output)'}`);
  const path = cachePath(active.projectId);
  const execution = executePredeploy({
    projectId: active.projectId,
    target,
    cache: readCache(path),
  });
  const nextState = { ...execution.state, created_at: Date.now() };
  writeFileSync(path, `${JSON.stringify(nextState)}\n`, { mode: 0o600 });
  printJson({
    event_type: 'environment_predeploy',
    success: true,
    project_id: active.projectId,
    environment: execution.route.environment,
    target,
    steps: execution.steps,
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch(error => {
    printJson({
      event_type: 'environment_predeploy',
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
