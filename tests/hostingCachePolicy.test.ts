import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

type HostingHeader = {
  source: string;
  headers: Array<{
    key: string;
    value: string;
  }>;
};

const firebaseConfig = JSON.parse(
  readFileSync('firebase.json', 'utf8'),
) as {
  hosting?: {
    headers?: HostingHeader[];
  };
};

const hostingHeaders = firebaseConfig.hosting?.headers ?? [];

const cacheControlFor = (source: string) => {
  const rule = hostingHeaders.find(entry => entry.source === source);
  return rule?.headers.find(
    header => header.key.toLowerCase() === 'cache-control',
  )?.value;
};

test('Firebase Hosting forces the SPA app shell to revalidate', () => {
  assert.equal(
    cacheControlFor('/index.html'),
    'no-cache,max-age=0,must-revalidate',
  );
});

test('Firebase Hosting keeps hashed JavaScript and CSS immutable', () => {
  assert.equal(
    cacheControlFor('**/*.@(js|css)'),
    'public,max-age=31536000,immutable',
  );
});
