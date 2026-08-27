import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contractorService = readFileSync(
  new URL('../src/services/contractorService.ts', import.meta.url),
  'utf8',
);

const contractorLogs = readFileSync(
  new URL('../src/components/ContractorLogs.tsx', import.meta.url),
  'utf8',
);

test('Contractor create and Audit are committed in one transaction', () => {
  const start = contractorService.indexOf(
    'export async function createContractorWithAudit',
  );
  const end = contractorService.indexOf(
    '\nexport async function updateContractor',
    start,
  );

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = contractorService.slice(start, end);

  assert.match(block, /runTransaction\(/);
  assert.match(block, /transaction\.set\(contractorReference/);
  assert.match(block, /transaction\.set\(auditReference/);
  assert.match(block, /module_name:\s*'ContractorLogs'/);
  assert.match(block, /operator_id:\s*uid/);
  assert.match(block, /account_uid:\s*uid/);
});

test('Contractor workspace update and Audit are committed in one transaction', () => {
  const start = contractorService.indexOf(
    'export async function updateContractorWorkspaceWithAudit',
  );
  const end = contractorService.indexOf(
    '\nconst requireCurrentUid',
    start,
  );

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = contractorService.slice(start, end);

  assert.match(block, /runTransaction\(/);
  assert.match(block, /workspace_lock_uid/);
  assert.match(block, /transaction\.update\(contractorReference/);
  assert.match(block, /transaction\.set\(auditReference/);
});

test('Online Contractor create and update use atomic Audit services', () => {
  const submitStart = contractorLogs.indexOf(
    'const handleEntrySubmit',
  );
  const submitEnd = contractorLogs.indexOf(
    'const handleAddActivity',
    submitStart,
  );

  assert.notEqual(submitStart, -1);
  assert.notEqual(submitEnd, -1);

  const block = contractorLogs.slice(submitStart, submitEnd);

  assert.match(block, /updateContractorWorkspaceWithAudit\(/);
  assert.match(block, /createContractorWithAudit\(siteId/);
  assert.doesNotMatch(block, /await createAuditLog\(siteId/);
});

test('Offline Contractor replay uses atomic create and Audit before queue removal', () => {
  const syncStart = contractorLogs.indexOf(
    'const sync = async',
  );
  const syncEnd = contractorLogs.indexOf(
    'offlineSyncRunning.current = false;',
    syncStart,
  );

  assert.notEqual(syncStart, -1);
  assert.notEqual(syncEnd, -1);

  const block = contractorLogs.slice(syncStart, syncEnd);

  assert.match(block, /createContractorWithAudit\(item\.siteId/);
  assert.doesNotMatch(block, /await createAuditLog\(item\.siteId/);

  const atomicWrite = block.indexOf(
    'createContractorWithAudit(item.siteId',
  );
  const queueRemoval = block.indexOf(
    'removeOfflineContractor(item.localId)',
  );

  assert.ok(atomicWrite >= 0);
  assert.ok(queueRemoval > atomicWrite);
});
