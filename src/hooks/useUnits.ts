import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import type { UnitRecord } from '../types';

let cachedUnits: UnitRecord[] | null = null;
let pendingRequest: Promise<UnitRecord[]> | null = null;

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
  const status = text(data.status) || text(data.occupancy_status) || 'Active';
  return {
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
    searchable_text: [roomNumber, roomCode, ownerName, residentName, phone].join(' ').toLowerCase(),
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

async function loadUnits(): Promise<UnitRecord[]> {
  if (cachedUnits) return cachedUnits;
  if (pendingRequest) return pendingRequest;
  pendingRequest = getDocs(collection(db, 'units'))
    .then(snapshot => snapshot.docs
      .map(docSnap => unitFromFirestore(docSnap.id, docSnap.data()))
      .filter((unit): unit is UnitRecord => unit !== null)
      .sort((a, b) => naturalCompare(a.building, b.building)
        || naturalCompare(a.floor, b.floor)
        || naturalCompare(a.room_number, b.room_number)))
    .then(units => {
      cachedUnits = units;
      return units;
    })
    .finally(() => { pendingRequest = null; });
  return pendingRequest;
}

export function clearUnitCache() {
  cachedUnits = null;
}

/** Reads existing Units without mutating Firestore. */
export function useUnits() {
  const visibleUnits = (units: UnitRecord[]) => units.filter(unit =>
    unit.is_active && (!unit.site_id || unit.site_id === currentSiteId()));
  const [units, setUnits] = useState<UnitRecord[]>(visibleUnits(cachedUnits || []));
  const [loading, setLoading] = useState(cachedUnits === null);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadUnits();
      setUnits(visibleUnits(loaded));
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { units, loading, error, refresh };
}
