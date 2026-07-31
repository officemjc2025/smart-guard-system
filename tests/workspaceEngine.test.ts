import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateWorkspace,
  beginWorkspaceRelease,
  createIdleWorkspace,
  failWorkspaceRelease,
  openWorkspace,
} from '../src/services/workspaceEngine';

test('workspace lifecycle is independent from the persisted resource lifecycle', () => {
  const opening = openWorkspace<{ stage: string }>('R026');
  const active = activateWorkspace({
    resourceId: 'session-r026',
    resourceIdentity: 'R026',
    context: { stage: 'Pending' },
  });

  assert.equal(opening.lifecycle, 'opening');
  assert.equal(active.lifecycle, 'active');
  assert.equal(active.context?.stage, 'Pending');
});

test('release failure preserves resource identity and context for a safe retry', () => {
  const active = activateWorkspace({
    resourceId: 'session-r026',
    resourceIdentity: 'R026',
    context: { stage: 'Ready' },
  });
  const releasing = beginWorkspaceRelease(active);
  const failed = failWorkspaceRelease(releasing, new Error('network unavailable'));

  assert.equal(failed.lifecycle, 'release-failed');
  assert.equal(failed.resourceId, 'session-r026');
  assert.equal(failed.resourceIdentity, 'R026');
  assert.deepEqual(failed.context, { stage: 'Ready' });
  assert.equal(failed.releaseError, 'network unavailable');
});

test('inactive workspace cannot enter the release lifecycle', () => {
  assert.throws(
    () => beginWorkspaceRelease(createIdleWorkspace()),
    /Cannot release an inactive workspace/,
  );
});
