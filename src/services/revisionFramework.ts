export type RevisionModule = 'IncidentReports' | 'PatrolLogs';
export type RevisionRole = 'Guard' | 'ShiftHead' | 'Manager' | 'Admin';
export type RevisionValue = unknown;
export type RevisionValues = Record<string, RevisionValue>;

export interface RevisionRecord {
  revision_id: string;
  revision_number: number;
  record_id: string;
  module_name: RevisionModule;
  site_id: string;
  changed_fields: string[];
  before: RevisionValues;
  after: RevisionValues;
  reason: string;
  edited_by_uid: string;
  edited_by_name: string;
  edited_by_role: RevisionRole;
  edited_at: unknown;
  audit_id: string;
}

export const INCIDENT_REVISION_FIELDS = [
  'incident_datetime', 'incident_type', 'location', 'description', 'priority',
  'photo_url', 'photo_file_id', 'remarks',
] as const;

export const PATROL_REVISION_FIELDS = [
  'patrol_point_name', 'custom_location', 'abnormal_reason', 'remarks',
  'evidence_photo_1_url', 'evidence_photo_1_file_id',
  'evidence_photo_2_url', 'evidence_photo_2_file_id',
] as const;

const value = (input: unknown): RevisionValue => {
  if (input === undefined || input === null) return null;
  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') return input;
  if (input instanceof Date) return input;
  if (typeof input === 'object' && 'toDate' in input && typeof input.toDate === 'function') {
    return input;
  }
  throw new Error('Revision values must be scalar or timestamp values.');
};

const instantMillis = (input: unknown): number | null => {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input.getTime();
  if (!input || typeof input !== 'object') return null;
  if ('toMillis' in input && typeof input.toMillis === 'function') {
    const millis = (input as { toMillis(): number }).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if ('toDate' in input && typeof input.toDate === 'function') {
    const date = (input as { toDate(): Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  return null;
};

export function revisionValuesEqual(left: unknown, right: unknown): boolean {
  const leftInstant = instantMillis(left);
  const rightInstant = instantMillis(right);
  if (leftInstant !== null || rightInstant !== null) {
    return leftInstant !== null && rightInstant !== null && leftInstant === rightInstant;
  }
  return Object.is(left, right);
}

export function normalizeCorrectionChanges(
  changes: Record<string, unknown>,
  options: { nullableFields?: readonly string[]; transforms?: Record<string, (value: unknown) => unknown> } = {},
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [field, original] of Object.entries(changes)) {
    if (original === undefined) continue;
    if (original === null && !options.nullableFields?.includes(field)) {
      throw new Error(`Correction field ${field} does not permit null.`);
    }
    normalized[field] = options.transforms?.[field] ? options.transforms[field](original) : original;
  }
  return normalized;
}

export function normalizeIncidentCorrectionChanges(
  changes: Record<string, unknown>,
  toTimestamp: (date: Date) => unknown,
): Record<string, unknown> {
  return normalizeCorrectionChanges(changes, {
    transforms: {
      incident_datetime: value => {
        const date = value instanceof Date ? value
          : value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function'
            ? (value as { toDate(): Date }).toDate() : new Date(String(value));
        if (Number.isNaN(date.getTime())) throw new Error('วันและเวลาที่เกิดเหตุไม่ถูกต้อง');
        return toTimestamp(date);
      },
    },
  });
}

export function validateEvidenceCorrectionPair(
  changes: Record<string, unknown>,
  urlField: string,
  fileIdField: string,
  extractFileId: (reference: string) => string,
): void {
  const hasUrl = urlField in changes;
  const hasFileId = fileIdField in changes;
  if (hasUrl !== hasFileId) throw new Error(`${urlField} and ${fileIdField} must be changed together.`);
  if (!hasUrl) return;
  const url = changes[urlField];
  const fileId = changes[fileIdField];
  if (typeof url !== 'string' || !url.trim() || typeof fileId !== 'string' || !fileId.trim()) {
    throw new Error(`${urlField} and ${fileIdField} must be non-empty strings.`);
  }
  if (extractFileId(url) !== fileId) throw new Error(`${fileIdField} does not match ${urlField}.`);
}

export function buildRevisionDiff(
  current: Record<string, unknown>,
  requested: Record<string, unknown>,
  allowedFields: readonly string[],
) {
  const unexpected = Object.keys(requested).filter(field => !allowedFields.includes(field));
  if (unexpected.length) throw new Error(`Forbidden correction fields: ${unexpected.join(', ')}`);
  const before: RevisionValues = {};
  const after: RevisionValues = {};
  for (const field of allowedFields) {
    if (!(field in requested)) continue;
    const oldValue = value(current[field]);
    const newValue = value(requested[field]);
    if (revisionValuesEqual(oldValue, newValue)) continue;
    before[field] = oldValue;
    after[field] = newValue;
  }
  return { changedFields: Object.keys(after), before, after };
}

export function buildRevision(input: Omit<RevisionRecord, 'changed_fields' | 'before' | 'after'> & {
  current: Record<string, unknown>;
  changes: Record<string, unknown>;
  allowedFields: readonly string[];
}): RevisionRecord {
  const reason = input.reason.trim();
  if (!reason) throw new Error('กรุณาระบุเหตุผลการแก้ไข');
  if (reason.length > 2000) throw new Error('เหตุผลการแก้ไขยาวเกิน 2,000 ตัวอักษร');
  const diff = buildRevisionDiff(input.current, input.changes, input.allowedFields);
  if (!diff.changedFields.length) throw new Error('ไม่มีข้อมูลที่เปลี่ยนแปลง');
  return {
    revision_id: input.revision_id,
    revision_number: input.revision_number,
    record_id: input.record_id,
    module_name: input.module_name,
    site_id: input.site_id,
    changed_fields: diff.changedFields,
    before: diff.before,
    after: diff.after,
    reason,
    edited_by_uid: input.edited_by_uid,
    edited_by_name: input.edited_by_name,
    edited_by_role: input.edited_by_role,
    edited_at: input.edited_at,
    audit_id: input.audit_id,
  };
}
