import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import type { UnitRecord } from '../types';

let cachedUnits: UnitRecord[] | null = null;
let pendingRequest: Promise<UnitRecord[]> | null = null;

function currentSiteId() {
  return sessionStorage.getItem('selected_site_id') || 'site-01';
}

async function loadUnits(): Promise<UnitRecord[]> {
  if (pendingRequest) return pendingRequest;
  pendingRequest = getDocs(collection(db, 'units'))
    .then(snapshot => snapshot.docs.map(docSnap => ({
      ...docSnap.data(),
      unit_id: docSnap.data().unit_id || docSnap.id,
    }) as UnitRecord))
    .then(units => units.filter(unit =>
      unit.is_active !== false && (!unit.site_id || unit.site_id === currentSiteId()),
    ))
    .finally(() => { pendingRequest = null; });
  return pendingRequest;
}

export function clearUnitCache() {
  cachedUnits = null;
}

/** Reads existing Units without mutating Firestore. */
export function useUnits() {
  const [units, setUnits] = useState<UnitRecord[]>(cachedUnits || []);
  const [loading, setLoading] = useState(cachedUnits === null);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      cachedUnits = await loadUnits();
      setUnits(cachedUnits);
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { units, loading, error, refresh };
}
