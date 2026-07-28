import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import {
  STAGING_PROJECT_ID,
  activeFirebaseProject,
  assertStagingProject,
  command,
  printJson,
} from './lib/infrastructure.mjs';

const PROJECT_NUMBER = '1060612850170';
const ROOT_FOLDER_ID = '1WEiA9U1DONRYHgnoJL17bZqOYJoCKGjO';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const REQUIRED_SECRETS = [
  'GOOGLE_DRIVE_CLIENT_ID',
  'GOOGLE_DRIVE_CLIENT_SECRET',
  'GOOGLE_DRIVE_REFRESH_TOKEN',
];
const SECRET_PROPAGATION_ATTEMPTS = 10;
const SECRET_PROPAGATION_DELAY_MS = 750;
const requireFromFunctions = createRequire(
  new URL('../functions/package.json', import.meta.url),
);
const { google } = requireFromFunctions('googleapis');

function fail(message) {
  throw new Error(message);
}

function hiddenPrompt(label) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      reject(new Error('A local interactive TTY is required.'));
      return;
    }
    let value = '';
    process.stdout.write(`${label}: `);
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    const onData = chunk => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('OAuth bootstrap cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value.trim());
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function secretVersionNumber(resourceName) {
  return resourceName.split('/').at(-1) || '';
}

async function enabledSecretVersion(name, expectedVersion = '') {
  for (let attempt = 1; attempt <= SECRET_PROPAGATION_ATTEMPTS; attempt += 1) {
    const args = expectedVersion
      ? [
          'secrets',
          'versions',
          'describe',
          expectedVersion,
          '--secret',
          name,
          '--project',
          STAGING_PROJECT_ID,
          '--format=json(name,state)',
        ]
      : [
          'secrets',
          'versions',
          'list',
          name,
          '--project',
          STAGING_PROJECT_ID,
          '--sort-by=~createTime',
          '--limit=1',
          '--format=json(name,state)',
        ];
    const result = command('gcloud', args);
    if (result.ok) {
      try {
        const parsed = JSON.parse(result.stdout);
        const metadata = Array.isArray(parsed) ? parsed[0] : parsed;
        if (
          metadata &&
          String(metadata.state || '').toUpperCase() === 'ENABLED' &&
          typeof metadata.name === 'string'
        ) {
          return secretVersionNumber(metadata.name) || expectedVersion || 'latest';
        }
      } catch {
        // Secret Manager metadata may not have propagated yet.
      }
    }
    if (attempt < SECRET_PROPAGATION_ATTEMPTS) {
      await delay(SECRET_PROPAGATION_DELAY_MS);
    }
  }
  fail(`${name} has no enabled secret version after bounded metadata polling.`);
}

async function firebaseSecretSet(name, value) {
  const result = command(
    'npx',
    [
      '-y',
      'firebase-tools@latest',
      'functions:secrets:set',
      name,
      '--data-file',
      '-',
      '--format',
      'string',
      '--project',
      STAGING_PROJECT_ID,
    ],
    { input: `${value}\n` },
  );
  if (!result.ok) {
    fail(
      `Unable to create ${name}: Firebase CLI exited with code ${
        result.status ?? 'unknown'
      }. Diagnostic output was captured and redacted.`,
    );
  }
  const successOutput = `${result.stdout}\n${result.stderr}`;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const successMatch = successOutput.match(
    new RegExp(
      `Created a new secret version projects/[^\\s]+/secrets/${escapedName}/versions/(\\d+)`,
      'i',
    ),
  );
  if (!successMatch?.[1]) {
    fail(
      `Unable to confirm ${name}: Firebase CLI exited successfully but did not confirm a new secret version.`,
    );
  }
  return enabledSecretVersion(name, successMatch[1]);
}

function validateSecretCliInterface() {
  const help = command('npx', [
    '-y',
    'firebase-tools@latest',
    'functions:secrets:set',
    '--help',
  ]);
  if (
    !help.ok ||
    !help.stdout.includes('--data-file <dataFile>') ||
    !help.stdout.includes('Set to "-"')
  ) {
    fail('Firebase CLI does not expose the required stdin secret interface.');
  }
  return {
    command: 'functions:secrets:set',
    stdinInterface: '--data-file -',
    format: 'string',
    writes: 0,
    secretValuesRead: 0,
  };
}

async function receiveAuthorizationCode(clientId, clientSecret) {
  const state = randomBytes(32).toString('hex');
  let resolveRequest;
  let rejectRequest;
  const authorization = new Promise((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname !== '/oauth2callback') {
        response.writeHead(404).end('Not found.');
        return;
      }
      if (url.searchParams.get('state') !== state) {
        response.writeHead(400).end('Invalid OAuth state.');
        rejectRequest(new Error('OAuth state validation failed.'));
        return;
      }
      const oauthError = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (oauthError || !code) {
        response.writeHead(400).end('Authorization was not completed.');
        rejectRequest(new Error(oauthError || 'Authorization code was not returned.'));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Staging authorization received. You may close this window.');
      resolveRequest(code);
    } catch (error) {
      response.writeHead(500).end('Authorization callback failed.');
      rejectRequest(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    fail('Unable to allocate a loopback OAuth callback port.');
  }
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authorizationUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [DRIVE_SCOPE],
    state,
  });

  const browser = spawn('open', [authorizationUrl], {
    detached: true,
    stdio: 'ignore',
  });
  browser.unref();
  process.stdout.write(
    'A browser authorization window was requested. Complete consent using only the staging Drive owner account.\n',
  );

  try {
    const code = await authorization;
    const tokenResponse = await oauth2Client.getToken(code);
    const refreshToken = tokenResponse.tokens.refresh_token;
    if (!refreshToken) fail('Google did not return a refresh token.');
    oauth2Client.setCredentials(tokenResponse.tokens);
    return { oauth2Client, refreshToken };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function validateStagingDrive(oauth2Client) {
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const about = await drive.about.get({ fields: 'user(emailAddress)' });
  const root = await drive.files.get({
    fileId: ROOT_FOLDER_ID,
    fields: 'id,name,mimeType,capabilities(canAddChildren)',
    supportsAllDrives: true,
  });
  if (
    root.data.id !== ROOT_FOLDER_ID ||
    root.data.mimeType !== 'application/vnd.google-apps.folder' ||
    root.data.capabilities?.canAddChildren !== true
  ) {
    fail('The staging Drive root is missing or not writable by the OAuth user.');
  }

  const content = `Smart Guard staging OAuth health check ${new Date().toISOString()}\n`;
  const name = `smart-guard-staging-oauth-healthcheck-${Date.now()}.txt`;
  let fileId = '';
  try {
    const created = await drive.files.create({
      requestBody: { name, parents: [ROOT_FOLDER_ID] },
      media: { mimeType: 'text/plain', body: Readable.from(content) },
      fields: 'id,name,mimeType,size,parents',
      supportsAllDrives: true,
    });
    fileId = created.data.id || '';
    if (!fileId) fail('Synthetic upload did not return a file ID.');

    const metadata = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size,trashed,parents',
      supportsAllDrives: true,
    });
    if (metadata.data.id !== fileId || metadata.data.trashed === true) {
      fail('Synthetic file metadata validation failed.');
    }
    const downloaded = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'text' },
    );
    if (downloaded.data !== content) fail('Synthetic file content validation failed.');
  } finally {
    if (fileId) {
      await drive.files.delete({ fileId, supportsAllDrives: true });
    }
  }

  return {
    authenticatedAccount: String(about.data.user?.emailAddress || '').replace(
      /^(.{2}).*(@.*)$/,
      '$1…$2',
    ),
    rootFolderAccessible: true,
    rootFolderWritable: true,
    syntheticUpload: 'PASS',
    syntheticRead: 'PASS',
    syntheticDelete: 'PASS',
  };
}

const activeFirebase = activeFirebaseProject();
if (!activeFirebase.ok) fail(`Unable to detect active Firebase project: ${activeFirebase.stderr}`);
assertStagingProject(activeFirebase.projectId, 'Drive OAuth bootstrap');
const activeGcloud = command('gcloud', ['config', 'get-value', 'project']);
assertStagingProject(activeGcloud.stdout.split(/\r?\n/).at(-1)?.trim() || '', 'Drive OAuth bootstrap');
const projectNumber = command('gcloud', [
  'projects',
  'describe',
  STAGING_PROJECT_ID,
  '--format=value(projectNumber)',
]);
if (!projectNumber.ok || projectNumber.stdout !== PROJECT_NUMBER) {
  fail('Staging project number verification failed.');
}

if (process.argv.includes('--validate-secret-cli')) {
  const secretMetadata = {};
  for (const name of [...REQUIRED_SECRETS, 'GOOGLE_DRIVE_ROOT_FOLDER_ID']) {
    secretMetadata[name] = await enabledSecretVersion(name);
  }
  printJson({
    event_type: 'staging_drive_secret_cli_validation',
    project_id: STAGING_PROJECT_ID,
    cli: validateSecretCliInterface(),
    secret_versions: secretMetadata,
    success: true,
  });
  process.exit(0);
}

let clientId = await hiddenPrompt('OAuth Desktop Client ID');
let clientSecret = await hiddenPrompt('OAuth Desktop Client Secret');
if (!clientId || !clientSecret) fail('OAuth client credentials are required.');
const authorization = await receiveAuthorizationCode(
  clientId,
  clientSecret,
);
let refreshToken = authorization.refreshToken;
const oauth2Client = authorization.oauth2Client;
try {
  const secretVersions = {};
  secretVersions.GOOGLE_DRIVE_CLIENT_ID = await firebaseSecretSet(
    'GOOGLE_DRIVE_CLIENT_ID',
    clientId,
  );
  clientId = '';
  secretVersions.GOOGLE_DRIVE_CLIENT_SECRET = await firebaseSecretSet(
    'GOOGLE_DRIVE_CLIENT_SECRET',
    clientSecret,
  );
  clientSecret = '';
  secretVersions.GOOGLE_DRIVE_REFRESH_TOKEN = await firebaseSecretSet(
    'GOOGLE_DRIVE_REFRESH_TOKEN',
    refreshToken,
  );
  refreshToken = '';
  secretVersions.GOOGLE_DRIVE_ROOT_FOLDER_ID = await enabledSecretVersion(
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
  );
  const driveValidation = await validateStagingDrive(oauth2Client);

  printJson({
    event_type: 'staging_drive_oauth_bootstrap',
    project_id: STAGING_PROJECT_ID,
    project_number: PROJECT_NUMBER,
    oauth_client_type: 'Desktop',
    oauth_scope: DRIVE_SCOPE,
    secret_versions: secretVersions,
    drive_validation: driveValidation,
    success: true,
  });
} finally {
  clientId = '';
  clientSecret = '';
  refreshToken = '';
  oauth2Client.setCredentials({});
}
