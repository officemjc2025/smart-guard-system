import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAllowedParkingCardTransition,
  normalizeParkingCardIdentifier,
  parkingCardHistoryEvent,
} from '../src/services/parkingCardDomain';

test('parking-card identifiers are trimmed, uppercased, and have all spaces removed', () => {
  assert.equal(normalizeParkingCardIdentifier('  r 0 2 6  '), 'R026');
  assert.equal(normalizeParkingCardIdentifier(' v001 '), 'V001');
});

test('parking-card lifecycle blocks direct release from IN_USE outside exit workflow', () => {
  assert.equal(isAllowedParkingCardTransition('Available', 'InUse'), true);
  assert.equal(isAllowedParkingCardTransition('InUse', 'Available'), true);
  assert.equal(isAllowedParkingCardTransition('InUse', 'Lost'), false);
  assert.equal(isAllowedParkingCardTransition('Lost', 'Available'), false);
});

test('audit actions map to immutable history event names', () => {
  assert.equal(parkingCardHistoryEvent('CreateCard'), 'CARD_CREATED');
  assert.equal(parkingCardHistoryEvent('LockCard'), 'ENTRY');
  assert.equal(parkingCardHistoryEvent('VehicleExitCompleted'), 'EXIT');
  assert.equal(parkingCardHistoryEvent('ReturnedCardScan'), 'CARD_SCANNED');
});
