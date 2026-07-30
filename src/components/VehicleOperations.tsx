import OperationalAnalyticsDashboard from './OperationalAnalyticsDashboard';
import OperationalQueueDashboard from './OperationalQueueDashboard';
import type { VehicleSessionRecord } from '../types';

interface VehicleOperationsProps {
  siteId: string;
  operatorName: string;
  role: string;
  onOpenVehicleSession: () => void;
}

export default function VehicleOperations({
  siteId,
  operatorName,
  role,
  onOpenVehicleSession,
}: VehicleOperationsProps) {
  const continueSession = (session: VehicleSessionRecord) => {
    sessionStorage.setItem('vehicle_session_to_continue', session.session_id);
    onOpenVehicleSession();
  };

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Vehicle Operations</h1>
        <p className="mt-1 text-sm text-slate-500">Queue, assignment, analytics และ dashboard แยกจากหน้าบันทึกรถเข้า-ออก</p>
      </header>
      <OperationalAnalyticsDashboard siteId={siteId} role={role} operatorName={operatorName} />
      <OperationalQueueDashboard
        siteId={siteId}
        operatorName={operatorName}
        role={role}
        onContinue={continueSession}
      />
    </div>
  );
}
