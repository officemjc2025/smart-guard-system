import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Admin Reports uses lazy same-site service loading without adding report reads to fetchData', async () => {
  const source = await readFile(new URL('../src/components/AdminPanel.tsx', import.meta.url), 'utf8');
  const fetchDataBody = source.slice(source.indexOf('const fetchData = async'), source.indexOf('useEffect(() => {\n    fetchData();'));
  assert.doesNotMatch(fetchDataBody, /listVehicleHistory|listContractors|listPatrolLogs|listKeyLogs/);
  assert.match(source, /if \(activeTab === 'reports'\) void loadReportData\(\)/);
  assert.match(source, /Promise\.all\(\[\s*listVehicleHistory\(siteId\),\s*listContractors\(siteId\),\s*listPatrolLogs\(siteId\),\s*listKeyLogs\(siteId\)/);
});

test('Reports cache is site-bound, manually refreshable, and rejects stale site responses', async () => {
  const source = await readFile(new URL('../src/components/AdminPanel.tsx', import.meta.url), 'utf8');
  assert.match(source, /reportLoaded && reportSiteId === siteId/);
  assert.match(source, /requestSequence !== reportRequestSequence\.current/);
  assert.match(source, /setReportLoaded\(false\)/);
  assert.match(source, /loadReportData\(true\)/);
  assert.match(source, /กำลังโหลดข้อมูลรายงาน\.\.\./);
});
