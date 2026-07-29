import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type {
  ContractorLogRecord,
  IncidentReportRecord,
  KeyLogRecord,
  PatrolLogRecord,
  VehicleLogRecord,
} from '../types';
import { normalizeParkingCardData } from './parkingCardService';

export interface DashboardSummary {
  vehiclesIn: number;
  vehiclesOut: number;
  vehiclesCurrent: number;
  contractorsCurrent: number;
  keysCheckedOut: number;
  patrolDone: number;
  patrolPending: number;
  patrolOverdue: number;
  incidentsToday: number;
  blacklistAlerts: number;
  availableCards: number;
  cardsInUse: number;
  suspendedCards: number;
  lostCards: number;
  vipEntriesToday: number;
  recentIncidents: IncidentReportRecord[];
}

const requireSiteId = (siteId: string) => {
  const value = siteId.trim();
  if (!value) throw new Error('siteId is required.');
  return value;
};

export async function getDashboardSummary(siteId: string, date = new Date()): Promise<DashboardSummary> {
  const scopedSite = requireSiteId(siteId);
  const today = date.toISOString().split('T')[0];
  const [vehicleSnapshot, contractorSnapshot, keySnapshot, patrolSnapshot, incidentSnapshot, cardSnapshot] =
    await Promise.all([
      getDocs(query(collection(db, 'vehicleLogs'), where('site_id', '==', scopedSite))),
      getDocs(query(collection(db, 'contractorLogs'), where('site_id', '==', scopedSite))),
      getDocs(query(collection(db, 'keyLogs'), where('site_id', '==', scopedSite))),
      getDocs(query(collection(db, 'patrolLogs'), where('site_id', '==', scopedSite))),
      getDocs(query(collection(db, 'incidentReports'), where('site_id', '==', scopedSite))),
      getDocs(query(collection(db, 'parkingCards'), where('site_id', '==', scopedSite))),
    ]);

  const vehicles = vehicleSnapshot.docs.map(item => item.data() as VehicleLogRecord);
  const contractors = contractorSnapshot.docs.map(item => item.data() as ContractorLogRecord);
  const keys = keySnapshot.docs.map(item => item.data() as KeyLogRecord);
  const patrols = patrolSnapshot.docs.map(item => item.data() as PatrolLogRecord);
  const incidents = incidentSnapshot.docs.map(item => item.data() as IncidentReportRecord);
  const cards = cardSnapshot.docs.map(item => normalizeParkingCardData(item.id, item.data()));
  const vehiclesToday = vehicles.filter(item => item.entry_time.startsWith(today));
  const patrolToday = patrols.filter(item => item.checkin_time.startsWith(today));
  const incidentsToday = incidents.filter(item => item.incident_datetime.startsWith(today));
  const totalPatrolPoints = 4;

  return {
    vehiclesIn: vehiclesToday.length,
    vehiclesOut: vehiclesToday.filter(item => item.status === 'ออกแล้ว').length,
    vehiclesCurrent: vehicles.filter(item => item.status === 'กำลังจอด').length,
    contractorsCurrent: contractors.filter(item => item.status === 'กำลังปฏิบัติงาน').length,
    keysCheckedOut: keys.filter(item => item.status === 'ถูกเบิก').length,
    patrolDone: new Set(patrolToday.map(item => item.patrol_point_id)).size,
    patrolPending: Math.max(0, totalPatrolPoints - new Set(patrolToday.map(item => item.patrol_point_id)).size),
    patrolOverdue: patrolToday.filter(item => item.status === 'ผิดปกติ').length,
    incidentsToday: incidentsToday.length,
    blacklistAlerts: 0,
    availableCards: cards.filter(item => item.status === 'Available').length,
    cardsInUse: cards.filter(item => item.status === 'InUse').length,
    suspendedCards: cards.filter(item => item.status === 'Suspended').length,
    lostCards: cards.filter(item => item.status === 'Lost').length,
    vipEntriesToday: vehiclesToday.filter(item => item.note?.includes('VIP entry event')).length,
    recentIncidents: incidents
      .sort((left, right) => right.incident_datetime.localeCompare(left.incident_datetime))
      .slice(0, 3),
  };
}
