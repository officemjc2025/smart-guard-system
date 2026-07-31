import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createUuid,
  UuidCompatibilityError,
  type BrowserCryptoProvider,
} from '../src/utils/uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('createUuid uses the desktop native randomUUID path when available', () => {
  let nativeCalls = 0;
  let fallbackCalls = 0;
  const expected = '12345678-1234-4abc-8def-1234567890ab' as const;
  const provider: BrowserCryptoProvider = {
    randomUUID: () => {
      nativeCalls += 1;
      return expected;
    },
    getRandomValues: array => {
      fallbackCalls += 1;
      return array;
    },
  };
  assert.equal(createUuid(provider), expected);
  assert.equal(nativeCalls, 1);
  assert.equal(fallbackCalls, 0);
});

test('createUuid uses getRandomValues on a mobile-like provider without randomUUID', () => {
  const provider: BrowserCryptoProvider = {
    getRandomValues: array => {
      const bytes = array as unknown as Uint8Array;
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
      return array;
    },
  };
  const uuid = createUuid(provider);
  assert.match(uuid, UUID_V4);
  assert.equal(uuid[14], '4');
  assert.match(uuid[19], /[89ab]/);
});

test('fallback generates distinct UUID v4 values across a representative sample', () => {
  let seed = 0;
  const provider: BrowserCryptoProvider = {
    getRandomValues: array => {
      const bytes = array as unknown as Uint8Array;
      seed += 1;
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = (seed + index * 17) & 0xff;
      }
      return array;
    },
  };
  const values = new Set(Array.from({ length: 256 }, () => createUuid(provider)));
  assert.equal(values.size, 256);
  for (const value of values) assert.match(value, UUID_V4);
});

test('createUuid fails closed with a typed error when no secure random API exists', () => {
  assert.throws(
    () => createUuid({}),
    error => error instanceof UuidCompatibilityError
      && error.code === 'CRYPTO_RANDOM_UNAVAILABLE',
  );
});

test('UUID utility never falls back to Math.random', async () => {
  const utility = await readFile(new URL('../src/utils/uuid.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(utility, /Math[.]random/);
});
