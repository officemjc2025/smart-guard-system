import test from 'node:test';
import assert from 'node:assert/strict';
import { runSingleFlight, type SingleFlightRef } from '../src/utils/singleFlight';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test('rapid callers share one in-flight creation and the same result', async () => {
  const flightRef: SingleFlightRef<string> = { current: null };
  const creation = deferred<string>();
  let calls = 0;
  const create = () => {
    calls += 1;
    return creation.promise;
  };

  const first = runSingleFlight(flightRef, create);
  const second = runSingleFlight(flightRef, create);
  assert.equal(calls, 1);

  creation.resolve('session-a');
  assert.deepEqual(await Promise.all([first, second]), ['session-a', 'session-a']);
  assert.equal(flightRef.current, null);
});

test('a rejected creation clears the flight and permits a deliberate retry', async () => {
  const flightRef: SingleFlightRef<string> = { current: null };
  let calls = 0;

  await assert.rejects(runSingleFlight(flightRef, async () => {
    calls += 1;
    throw new Error('permission-denied');
  }), /permission-denied/);
  assert.equal(flightRef.current, null);

  const sessionId = await runSingleFlight(flightRef, async () => {
    calls += 1;
    return 'session-retry';
  });
  assert.equal(sessionId, 'session-retry');
  assert.equal(calls, 2);
});

test('an older flight cannot clear a newer flight ref', async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  const flightRef: SingleFlightRef<string> = { current: null };
  const firstResult = runSingleFlight(flightRef, () => first.promise);

  flightRef.current = second.promise;
  first.resolve('old-session');
  assert.equal(await firstResult, 'old-session');
  assert.equal(flightRef.current, second.promise);
});
