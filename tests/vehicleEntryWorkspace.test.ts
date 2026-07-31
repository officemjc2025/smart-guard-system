import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertEntrySessionCardIdentity,
  activateVehicleEntryWorkspace,
  createEntryFormFromSession,
  createEntryWorkspaceResetState,
  createInitialEntryForm,
  entrySessionCardMatches,
} from '../src/services/vehicleEntryWorkspace';

test('resetEntryWorkspace state clears session identity, form, photos and transient UI', () => {
  assert.deepEqual(createEntryWorkspaceResetState(), {
    workspace: {
      lifecycle: 'idle',
      resourceId: '',
      resourceIdentity: '',
      context: null,
      releaseError: '',
    },
    entryForm: createInitialEntryForm(),
    entryPlatePhoto: '',
    entryVehiclePhoto: '',
    blacklistWarning: null,
    showQRScanner: false,
  });
});

test('entry card identity accepts formatting differences for the same canonical card', () => {
  assert.equal(entrySessionCardMatches(' r 002 ', 'R002'), true);
});

test('changing card number cannot reuse a mismatched active session', () => {
  assert.throws(
    () => assertEntrySessionCardIdentity({
      activeSessionId: 'session-r002',
      formCardNumber: 'R003',
      sessionCardNumber: 'R002',
    }),
    /เลขบัตรไม่ตรงกับ Vehicle Session/,
  );
});

test('a new workspace without an active session may create a different card', () => {
  assert.doesNotThrow(() => assertEntrySessionCardIdentity({
    activeSessionId: '',
    formCardNumber: 'R003',
    sessionCardNumber: '',
  }));
});

test('selecting a pending session explicitly restores only that session context', () => {
  assert.deepEqual(createEntryFormFromSession({
    card_number: 'R002',
    vehicle_plate: 'กข1234',
    target_room: 'A-101',
    purpose: 'ติดต่อ',
  }), {
    ...createInitialEntryForm(),
    card_number: 'R002',
    vehicle_plate: 'กข1234',
    target_room: 'A-101',
    purpose: 'ติดต่อ',
  });
});

test('reset after an offline save clears the OFFLINE session before the next card', () => {
  const reset = createEntryWorkspaceResetState();
  assert.equal(reset.workspace.resourceId, '');
  assert.equal(reset.entryForm.card_number, '');
  assert.equal(entrySessionCardMatches('R003', 'R002'), false);
});

test('an activated vehicle workspace owns session identity and snapshot together', () => {
  const session = {
    session_id: 'session-r002',
    card_number: ' r 002 ',
  } as Parameters<typeof activateVehicleEntryWorkspace>[0];
  const workspace = activateVehicleEntryWorkspace(session);

  assert.equal(workspace.lifecycle, 'active');
  assert.equal(workspace.resourceId, 'session-r002');
  assert.equal(workspace.resourceIdentity, 'R002');
  assert.equal(workspace.context, session);
});
