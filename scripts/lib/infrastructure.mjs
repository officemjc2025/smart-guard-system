import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export const PRODUCTION_PROJECT_ID = 'securityprojectv1';
export const STAGING_PROJECT_ID = 'securityprojectv1-staging';
export const FIRESTORE_REGION = 'asia-southeast3';
export const FUNCTIONS_REGION = 'asia-southeast1';

export function command(command, args, options = {}) {
  const root = process.cwd();
  const javaHome = `${root}/.tools/jdk/Contents/Home`;
  const toolPath = [
    `${javaHome}/bin`,
    `${root}/.tools/google-cloud-sdk/bin`,
    process.env.PATH,
  ].filter(Boolean).join(':');
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    env: {
      ...process.env,
      DEBUG: '',
      JAVA_HOME: javaHome,
      CLOUDSDK_CONFIG: `${root}/.tools/gcloud-config`,
      PATH: toolPath,
    },
    ...options,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

export function firebase(args) {
  return command('npx', ['-y', 'firebase-tools@latest', ...args]);
}

export function activeFirebaseProject() {
  const active = firebase(['use']);
  const projectId = active.stdout.split(/\r?\n/).at(-1)?.trim() || '';
  return { ...active, projectId };
}

export function result(name, status, detail, remediation = null) {
  return { name, status, detail, remediation };
}

export function statusFrom(check) {
  return check ? 'PASS' : 'FAIL';
}

export function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

export function assertStagingProject(projectId, operation) {
  if (projectId === PRODUCTION_PROJECT_ID || projectId !== STAGING_PROJECT_ID) {
    throw new Error(`Refusing ${operation} for project: ${projectId || '(missing)'}`);
  }
}

export function redact(value) {
  if (!value) return '(missing)';
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
}

export function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
