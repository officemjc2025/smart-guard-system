import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { UnitRecord } from '../types';

const cache = new Map<string, UnitRecord[]>();
const pendingRequests = new Map<string, Promise<UnitRecord[]>>();

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function unitFromFirestore(id: string, value: unknown): UnitRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const roomNumber = text(data.room_number);
  if (!roomNumber) return null;
  const ownerName = text(data.owner_name);
  const residentName = text(data.resident_name);
  const phone = text(data.phone);
  const roomCode = text(data.room_code);
  const status = text(data.status) === 'Inactive' || data.is_active === false ? 'Inactive' : 'Active';
  return {
    firestore_document_id: id,
    unit_id: text(data.unit_id) || id,
    site_id: text(data.site_id),
    building: text(data.building),
    room_code: roomCode || undefined,
    room_number: roomNumber,
    floor: text(data.floor),
    area: text(data.area) || undefined,
    ratio: text(data.ratio) || undefined,
    owner_name: ownerName,
    resident_name: residentName,
    phone: phone || undefined,
    email: text(data.email) || undefined,
    occupancy_status: text(data.occupancy_status) || status,
    status,
    searchable_text: [roomNumber, roomCode, text(data.building), text(data.floor), ownerName, residentName, phone].join(' ').toLowerCase(),
    search_key: text(data.search_key),
    is_active: data.is_active !== false,
    created_at: text(data.created_at),
    updated_at: text(data.updated_at),
    source_file_name: text(data.source_file_name) || undefined,
    import_batch_id: text(data.import_batch_id) || undefined,
  };
}

function currentSiteId() {
  return sessionStorage.getItem('selected_site_id') || 'site-01';
}

async function loadUnits(includeInactive: boolean): Promise<UnitRecord[]> {
  const siteId = currentSiteId();
  const cacheKey = `${siteId}:${includeInactive ? 'all' : 'active'}`;
  const cachedUnits = cache.get(cacheKey);
  if (cachedUnits) return cachedUnits;
  const pendingRequest = pendingRequests.get(cacheKey);
  if (pendingRequest) return pendingRequest;
  const unitQuery = includeInactive
    ? query(collection(db, 'units'), where('site_id', '==', siteId))
    : query(collection(db, 'units'), where('site_id', '==', siteId), where('status', '==', 'Active'));
  const request = getDocs(unitQuery)
    .then(snapshot => snapshot.docs
      .map(docSnap => unitFromFirestore(docSnap.id, docSnap.data()))
      .filter((unit): unit is UnitRecord => unit !== null)
      .sort((a, b) => naturalCompare(a.building, b.building)
        || naturalCompare(a.floor, b.floor)
        || naturalCompare(a.room_number, b.room_number)))
    .then(units => {
      cache.set(cacheKey, units);
      return units;
    })
    .finally(() => { pendingRequests.delete(cacheKey); });
  pendingRequests.set(cacheKey, request);
  return request;
}

export function clearUnitCache() {
  cache.clear();
}

/** Reads existing Units without mutating Firestore. */
export function useUnits(options: { includeInactive?: boolean } = {}) {
  const visibleUnits = (units: UnitRecord[]) => units.filter(unit =>
    (options.includeInactive || (unit.is_active && unit.status === 'Active')) && unit.site_id === currentSiteId());
  const initial = cache.get(`${currentSiteId()}:${options.includeInactive ? 'all' : 'active'}`) || [];
  const [units, setUnits] = useState<UnitRecord[]>(visibleUnits(initial));
  const [loading, setLoading] = useState(initial.length === 0);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadUnits(Boolean(options.includeInactive));
      setUnits(visibleUnits(loaded));
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
    } finally {
      setLoading(false);
    }
  }, [options.includeInactive]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { units, loading, error, refresh };
}
