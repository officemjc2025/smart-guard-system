/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { UnitRecord } from '../types';

let cachedUnits: UnitRecord[] | null = null;
let cachedError: Error | null = null;
let isFetching = false;
const listeners = new Set<(units: UnitRecord[], error: Error | null, loading: boolean) => void>();

export function clearUnitCache() {
  cachedUnits = null;
  cachedError = null;
  isFetching = false;
  if (listeners.size > 0) {
    fetchUnits();
  }
}

async function fetchUnits() {
  if (isFetching) return;
  isFetching = true;
  console.log('[Smart Guard Units] Loading units...');
  listeners.forEach(li => li(cachedUnits || [], null, true));
  
  try {
    const currentSiteId = sessionStorage.getItem('selected_site_id') || 'site-01';
    const querySnapshot = await getDocs(collection(db, 'units'));
    const allUnits: UnitRecord[] = [];
    querySnapshot.forEach(docSnap => {
      const data = docSnap.data();
      // Safeguard in case unit_id is missing on document level
      allUnits.push({
        ...data,
        unit_id: data.unit_id || docSnap.id,
      } as UnitRecord);
    });

    // Filtering logic:
    // - Filter active records only: is_active == true (or missing/undefined -> treated as active)
    // - site_id == current site (or missing/undefined -> treated as current site)
    const filtered = allUnits.filter(u => {
      // is_active == true: if legacy records do not contain is_active, treat them as active
      if (u.is_active === false) return false;
      
      // site_id == current site: if site_id is missing, include them only for the current single-site deployment
      const currentSiteId = sessionStorage.getItem('selected_site_id') || 'site-01';
      if (u.site_id && u.site_id !== currentSiteId) return false;
      
      return true;
    });

    cachedUnits = filtered;
    console.log(`[Smart Guard Units] Loaded ${filtered.length} units`);
    cachedError = null;
  } catch (err) {
    console.error('[useUnits] Error fetching units:', err);
    cachedError = err instanceof Error ? err : new Error(String(err));
  } finally {
    isFetching = false;
    listeners.forEach(li => li(cachedUnits || [], cachedError, false));
  }
}

export function useUnits() {
  const [units, setUnits] = useState<UnitRecord[]>(cachedUnits || []);
  const [loading, setLoading] = useState<boolean>(!cachedUnits && isFetching);
  const [error, setError] = useState<Error | null>(cachedError);

  useEffect(() => {
    const handleChange = (newUnits: UnitRecord[], newError: Error | null, newLoading: boolean) => {
      setUnits(newUnits);
      setError(newError);
      setLoading(newLoading);
    };

    listeners.add(handleChange);

    if (cachedUnits === null && !isFetching) {
      fetchUnits();
    } else if (cachedUnits !== null) {
      setUnits(cachedUnits);
      setLoading(false);
      setError(cachedError);
    } else {
      setLoading(true);
    }

    return () => {
      listeners.delete(handleChange);
    };
  }, []);

  const refresh = async () => {
    cachedUnits = null;
    cachedError = null;
    await fetchUnits();
  };

  return { units, loading, error, refresh };
}
