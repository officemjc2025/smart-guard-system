export type FirestoreWriteData = Record<string, unknown>;

const isPlainObject = (value: unknown): value is FirestoreWriteData => {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const sanitizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.filter(item => item !== undefined).map(sanitizeValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .map(([key, child]) => [key, sanitizeValue(child)]));
};

/** Removes only undefined values. Firestore sentinels, Timestamp, Date, null, false, 0 and empty strings are preserved. */
export function sanitizeFirestoreData(data: FirestoreWriteData): FirestoreWriteData {
  return sanitizeValue(data) as FirestoreWriteData;
}

function unsupportedValuePath(value: unknown, path: string): string | null {
  if (value === undefined) return path;
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return path;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = unsupportedValuePath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
  } else if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const found = unsupportedValuePath(child, path ? `${path}.${key}` : key);
      if (found) return found;
    }
  }
  return null;
}

export function sanitizeAndValidateFirestoreData(data: FirestoreWriteData, rowNumber?: number): FirestoreWriteData {
  const sanitized = sanitizeFirestoreData(data);
  const unsupportedPath = unsupportedValuePath(sanitized, '');
  if (unsupportedPath) {
    throw new Error(`${rowNumber ? `Row ${rowNumber} ` : ''}field ${unsupportedPath}: unsupported Firestore value.`);
  }
  return sanitized;
}
