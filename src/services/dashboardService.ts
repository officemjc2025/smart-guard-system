import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  calculateDashboardSummary,
  type DashboardSummary,
} from './dashboardLogic';

export type { DashboardSummary } from './dashboardLogic';

const SOURCES = {
  vehicles: 'vehicleLogs',
  contractors: 'contractorLogs',
  keys: 'keyLogs',
  patrols: 'patrolLogs',
  patrolPoints: 'patrolPoints',
  incidents: 'incidentReports',
  cards: 'parkingCards',
} as const;

type SourceName = keyof typeof SOURCES;
type SourceData = Record<SourceName, Array<Record<string, unknown>>>;

const requireSiteId = (siteId: string) => {
  const value = siteId.trim();
  if (!value) throw new Error('siteId is required.');
  return value;
};

const emptySources = (): SourceData => ({
  vehicles: [], contractors: [], keys: [], patrols: [],
  patrolPoints: [], incidents: [], cards: [],
});

const siteQuery = (collectionName: string, siteId: string) =>
  query(collection(db, collectionName), where('site_id', '==', siteId));

export async function getDashboardSummary(siteId: string, date = new Date()): Promise<DashboardSummary> {
  const scopedSite = requireSiteId(siteId);
  const sourceNames = Object.keys(SOURCES) as SourceName[];
  const snapshots = await Promise.all(sourceNames.map(name =>
    getDocs(siteQuery(SOURCES[name], scopedSite))));
  const data = emptySources();
  sourceNames.forEach((name, index) => {
    data[name] = snapshots[index].docs.map(item => item.data());
  });
  return calculateDashboardSummary(data, date);
}

export function subscribeDashboardSummary(
  siteId: string,
  onData: (summary: DashboardSummary) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const scopedSite = requireSiteId(siteId);
  const data = emptySources();
  const ready = new Set<SourceName>();
  let failed = false;
  const unsubscribes = (Object.keys(SOURCES) as SourceName[]).map(name =>
    onSnapshot(siteQuery(SOURCES[name], scopedSite), snapshot => {
      data[name] = snapshot.docs.map(item => item.data());
      ready.add(name);
      if (!failed && ready.size === Object.keys(SOURCES).length) {
        onData(calculateDashboardSummary(data));
      }
    }, reason => {
      if (failed) return;
      failed = true;
      onError(reason instanceof Error ? reason : new Error(String(reason)));
    }));
  return () => unsubscribes.forEach(unsubscribe => unsubscribe());
}
