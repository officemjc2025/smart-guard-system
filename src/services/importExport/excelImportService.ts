import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase';
import type { UserRecord } from '../../types';
import { writeAuditLog } from '../auditService';
import {
  createBlacklistEntry,
  updateBlacklistEntry,
  type CreateBlacklistInput,
} from '../blacklistService';
import {
  createIncident,
  updateIncident,
  type CreateIncidentInput,
} from '../incidentService';
import { createKey, updateKey, type CreateKeyInput } from '../keyService';
import { createSystemUser } from '../systemInitializationService';
import {
  headerKeys,
  normalizedHeader,
  validateImportRows,
  type ImportExportModule,
  type ImportExportRecord,
  type ImportValidationResult,
} from './validationService';
import { parseCsvFile } from './csvSafe';
import { resolveImportAdapter } from './importAdapterRegistry';

export interface ImportPreview extends ImportValidationResult {
  fileName: string;
  totalRows: number;
  detectedHeaders: string[];
  headerMappings: Array<{ source: string; canonical: string }>;
}

export async function previewImportFile(
  file: File,
  module: ImportExportModule,
  existingRecords: readonly ImportExportRecord[] = [],
): Promise<ImportPreview> {
  const grid = await parseCsvFile(file);
  const aliases = headerKeys(module);
  const sourceHeaders = (grid[0] || []).map(value => String(value ?? '').trim());
  const mappedHeaders = sourceHeaders.map(header => aliases.get(normalizedHeader(header)) || '');
  const records = grid.slice(1).map(row => {
    const record: ImportExportRecord = {};
    mappedHeaders.forEach((key, index) => { if (key) record[key] = row[index]; });
    return record;
  });
  const headerMappings = sourceHeaders.map((source, index) => ({
    source,
    canonical: module.columns.find(column => column.key === mappedHeaders[index])?.label || 'Ignored',
  }));
  return { fileName: file.name, totalRows: records.length, detectedHeaders: sourceHeaders, headerMappings, ...validateImportRows(records, module, existingRecords) };
}

const text = (value: unknown) => String(value ?? '').trim();
const selectedSiteId = () => text(sessionStorage.getItem('selected_site_id')) || 'site-01';

async function requireActiveAdmin(): Promise<{ name: string; siteId: string }> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Authenticated Admin account is required for import.');
  const snapshot = await getDoc(doc(db, 'users', uid));
  const profile = snapshot.data();
  if (!snapshot.exists() || profile?.status !== 'Active' || profile.role !== 'Admin') {
    throw new Error('Only an active Admin may commit imports.');
  }
  const siteId = selectedSiteId();
  if (profile.site_id && profile.site_id !== siteId) {
    throw new Error('Import site does not match the authenticated Admin site.');
  }
  return { name: text(profile.operator_name || profile.username || uid), siteId };
}

function operatorRecord(row: ImportPreview['validRows'][number]): UserRecord {
  const now = new Date().toISOString();
  return {
    user_id: row.id,
    login_email: text(row.data.login_email),
    operator_name: text(row.data.operator_name),
    role: text(row.data.role) as UserRecord['role'],
    shift: text(row.data.shift),
    phone: text(row.data.phone),
    status: text(row.data.status) as UserRecord['status'],
    created_at: text(row.data.created_at) || now,
    updated_at: now,
  };
}

function keyInput(row: ImportPreview['validRows'][number]): CreateKeyInput {
  return {
    key_id: row.id,
    room_number: text(row.data.room_number),
    key_type: text(row.data.key_type),
    key_label: text(row.data.key_label),
    status: text(row.data.status),
    note: text(row.data.note),
  };
}

function blacklistInput(row: ImportPreview['validRows'][number]): CreateBlacklistInput {
  return {
    blacklist_id: row.id,
    type: text(row.data.type) as CreateBlacklistInput['type'],
    vehicle_plate: text(row.data.vehicle_plate),
    id_card_number: text(row.data.id_card_number),
    name: text(row.data.name),
    reason: text(row.data.reason),
    severity: text(row.data.severity) as CreateBlacklistInput['severity'],
    status: text(row.data.status) as CreateBlacklistInput['status'],
  };
}

function incidentInput(row: ImportPreview['validRows'][number]): CreateIncidentInput {
  return {
    incident_id: row.id,
    incident_datetime: text(row.data.incident_datetime),
    location: text(row.data.location),
    incident_type: text(row.data.incident_type) as CreateIncidentInput['incident_type'],
    description: text(row.data.description),
    reported_by: text(row.data.reported_by) || 'Imported by Admin',
    shift_leader: text(row.data.shift_leader),
    management_note: text(row.data.management_note),
    status: text(row.data.status) as CreateIncidentInput['status'],
    severity: text(row.data.severity),
  };
}

export async function commitImportPreview(preview: ImportPreview, module: ImportExportModule) {
  const adapter = resolveImportAdapter(module.key);
  if (adapter === 'parkingCards') throw new Error('Parking Card imports must use parkingCardService.importParkingCards().');
  if (adapter === 'units') throw new Error('Unit imports must use unitImportService.commitUnitFrameworkImport().');
  if (adapter === 'workflowDenied') {
    throw new Error(`${module.label} is workflow-controlled and cannot be imported directly.`);
  }

  const actor = await requireActiveAdmin();
  let committed = 0;
  for (const row of preview.validRows) {
    if (adapter === 'operators') {
      await createSystemUser(operatorRecord(row));
    } else if (adapter === 'keys') {
      const input = keyInput(row);
      if (row.action === 'create') await createKey(actor.siteId, input);
      else await updateKey(actor.siteId, row.id, input);
    } else if (adapter === 'blacklist') {
      const input = blacklistInput(row);
      if (row.action === 'create') await createBlacklistEntry(actor.siteId, input);
      else await updateBlacklistEntry(actor.siteId, row.id, input);
    } else if (adapter === 'incidents') {
      const input = incidentInput(row);
      if (row.action === 'create') await createIncident(actor.siteId, input);
      else await updateIncident(actor.siteId, row.id, input);
    }
    committed += 1;
  }
  await writeAuditLog(
    actor.name,
    'Import',
    module.label,
    `IMPORT_${module.key}`,
    '',
    `${preview.fileName}: ${committed} records`,
  );
  return committed;
}
