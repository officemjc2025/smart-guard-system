import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Clock,
  Plus,
  ClipboardList,
  AlertTriangle,
  User,
  Key,
  Car,
  Briefcase,
  Calendar,
  History,
  Database,
  Filter,
  ChevronRight,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  getDocs,
  orderBy,
  limit,
  updateDoc,
  doc
} from 'firebase/firestore';
import { db, buildSiteScopedQuery, createTransactionDoc, runLegacyMigration } from './services/firebase';
import {
  AuthenticatedSession,
  VehicleLog,
  ContractorLog,
  KeyLog,
  PatrolLog,
  IncidentReport,
  AuditLog,
  DailyReport
} from './types';

export default function App() {
  // Current session simulation/state
  const [session, setSession] = useState<AuthenticatedSession>({
    uid: 'qctgasVxGbWboRJfS9J8DVgR6B32', // Default to Guard
    email: 'guard-site01@smartguard.com',
    role: 'guard',
    siteId: 'site-01',
    operatorId: 'OP-SITE01-01',
    operatorName: 'Sgt. Somchai (Guard)',
    recorded_by: 'Sgt. Somchai (Guard)'
  });

  const [time, setTime] = useState<string>(new Date().toLocaleTimeString('th-TH'));
  const [activeTab, setActiveTab] = useState<string>('vehicleLogs');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [siteFilter, setSiteFilter] = useState<string>('all');

  // Transaction Lists state
  const [vehicleLogs, setVehicleLogs] = useState<VehicleLog[]>([]);
  const [contractorLogs, setContractorLogs] = useState<ContractorLog[]>([]);
  const [keyLogs, setKeyLogs] = useState<KeyLog[]>([]);
  const [patrolLogs, setPatrolLogs] = useState<PatrolLog[]>([]);
  const [incidentReports, setIncidentReports] = useState<IncidentReport[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [dailyReports, setDailyReports] = useState<DailyReport[]>([]);

  // Forms inputs state
  // 1. Vehicle Logs Form
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleType, setVehicleType] = useState('รถยนต์สี่ล้อ');
  const [driverName, setDriverName] = useState('');
  const [vehiclePurpose, setVehiclePurpose] = useState('');

  // 2. Contractor Logs Form
  const [contractorName, setContractorName] = useState('');
  const [contractorCompany, setContractorCompany] = useState('');
  const [contractorPurpose, setContractorPurpose] = useState('');

  // 3. Key Logs Form
  const [keyName, setKeyName] = useState('');
  const [keyBorrower, setKeyBorrower] = useState('');
  const [keyPurpose, setKeyPurpose] = useState('');

  // 4. Patrol Logs Form
  const [patrolCheckpoint, setPatrolCheckpoint] = useState('');
  const [patrolStatus, setPatrolStatus] = useState<'Pass' | 'Fail' | 'Issue Found'>('Pass');
  const [patrolNotes, setPatrolNotes] = useState('');

  // 5. Incident Reports Form
  const [incidentTitle, setIncidentTitle] = useState('');
  const [incidentDesc, setIncidentDesc] = useState('');
  const [incidentSeverity, setIncidentSeverity] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [incidentImgUrl, setIncidentImgUrl] = useState('');

  // 6. Daily Reports Form
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [reportSummary, setReportSummary] = useState('');

  // Migration States
  const [migrationDryRun, setMigrationDryRun] = useState(true);
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationConsole, setMigrationConsole] = useState<string[]>([]);
  const [migrationStats, setMigrationStats] = useState<Record<string, { scanned: number; updated: number; skipped: number; failed: number }> | null>(null);

  // Time updater
  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date().toLocaleTimeString('th-TH'));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch all transactions with site isolation check
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorText(null);

    try {
      const constraints = [orderBy('created_at', 'desc'), limit(50)];
      
      // Load based on active tab or reload everything
      if (activeTab === 'vehicleLogs') {
        const q = buildSiteScopedQuery('vehicleLogs', session, [orderBy('entry_time', 'desc'), limit(50)]);
        const snap = await getDocs(q);
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as VehicleLog));
        setVehicleLogs(data);
      } else if (activeTab === 'contractorLogs') {
        const q = buildSiteScopedQuery('contractorLogs', session, [orderBy('entry_time', 'desc'), limit(50)]);
        const snap = await getDocs(q);
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ContractorLog));
        setContractorLogs(data);
      } else if (activeTab === 'keyLogs') {
        const q = buildSiteScopedQuery('keyLogs', session, constraints);
        const snap = await getDocs(q);
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as KeyLog));
        setKeyLogs(data);
      } else if (activeTab === 'patrolLogs') {
        const q = buildSiteScopedQuery('patrolLogs', session, constraints);
        const snap = await getDocs(q);
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PatrolLog));
        setPatrolLogs(data);
      } else if (activeTab === 'incidentReports') {
        const q = buildSiteScopedQuery('incidentReports', session, constraints);
        const snap = await getDocs(q);
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as IncidentReport));
        setIncidentReports(data);
      } else if (activeTab === 'dailyReports') {
        const q = buildSiteScopedQuery('dailyReports', session, constraints);
        const snap = await getDocs(q);
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as DailyReport));
        setDailyReports(data);
      } else if (activeTab === 'auditLogs' && session.role === 'admin') {
        const q = buildSiteScopedQuery('auditLogs', session, constraints);
        const snap = await getDocs(q);
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditLog));
        setAuditLogs(data);
      }
    } catch (err: unknown) {
      // 11. Adjust Error screen - do not show Firebase authInfo, UID, email or raw JSON
      setErrorText("ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ");
      
      // Technical details only logged in development
      if (process.env.NODE_ENV !== 'production') {
        console.error("Technical Error during Firestore load:", err);
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, session]);

  // Load data when activeTab or session changes
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Submit functions
  const handleAddVehicleLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehiclePlate || !driverName) return;

    try {
      const now = new Date().toISOString();
      await createTransactionDoc('vehicleLogs', session, {
        vehicle_plate: vehiclePlate,
        vehicle_type: vehicleType,
        driver_name: driverName,
        purpose: vehiclePurpose,
        entry_time: now,
        exit_time: null,
        status: 'Entered'
      });
      
      setVehiclePlate('');
      setDriverName('');
      setVehiclePurpose('');
      loadData();
    } catch (err) {
      setErrorText("ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ");
      if (process.env.NODE_ENV !== 'production') {
        console.error("Create vehicle log failed:", err);
      }
    }
  };

  const handleCheckoutVehicle = async (id: string) => {
    try {
      const now = new Date().toISOString();
      const docRef = doc(db, 'vehicleLogs', id);
      await updateDoc(docRef, {
        status: 'Exited',
        exit_time: now
      });
      loadData();
    } catch (err) {
      setErrorText("ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ");
      if (process.env.NODE_ENV !== 'production') {
        console.error("Checkout vehicle failed:", err);
      }
    }
  };

  const handleAddContractorLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contractorName || !contractorCompany) return;

    try {
      const now = new Date().toISOString();
      await createTransactionDoc('contractorLogs', session, {
        contractor_name: contractorName,
        company: contractorCompany,
        purpose: contractorPurpose,
        entry_time: now,
        exit_time: null,
        status: 'Active'
      });
      
      setContractorName('');
      setContractorCompany('');
      setContractorPurpose('');
      loadData();
    } catch (err) {
      setErrorText("ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ");
      if (process.env.NODE_ENV !== 'production') {
        console.error("Create contractor log failed:", err);
      }
    }
  };

  const handleCheckoutContractor = async (id: string) => {
    try {
      const now = new Date().toISOString();
      const docRef = doc(db, 'contractorLogs', id);
      await updateDoc(docRef, {
        status: 'Exited',
        exit_time: now
      });
      loadData();
    } catch (err) {
      setErrorText("ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ");
      if (process.env.NODE_ENV !== 'production') {
        console.error("Checkout contractor failed:", err);
      }
    }
  };

  const handleAddKeyLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName || !keyBorrower) return;

    try {
      const now = new Date().toISOString();
      await createTransactionDoc('keyLogs', session, {
        key_name: keyName,
        borrower: keyBorrower,
        purpose: keyPurpose,
        status: 'Borrowed',
        borrow_time: now,
        return_time: null
      });

      setKeyName('');
      setKeyBorrower('');
      setKeyPurpose('');
      loadData();
    } catch (err) {
      setErrorText("ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ");
      if (process.env.NODE_ENV !== 'production') {
        console.error("Create key log failed:", err);
      }
    }
  };

  const handleReturnKey = async (id: string) => {
    try {
      const now = new Date().toISOString();
      const docRef = doc(db, 'keyLogs', id);
      await updateDoc(docRef, {
        status: 'Returned',
        return_time: now
      });
      loadData();
    } catch (err) {
      setErrorText("ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ");
      if (process.env.NODE_ENV !== 'production') {
        console.error("Return key failed:", err);
      }
    }
  };

  const handleAddPatrolLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patrolCheckpoint) return;

    try {
      await createTransactionDoc('patrolLogs', session, {
        checkpoint: patrolCheckpoint,
        status: patrolStatus,
        notes: patrolNotes
      });

      setPatrolCheckpoint('');
      setPatrolNotes('');
      loadData();
    } catch (err) {
      setErrorText("ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ");
      if (process.env.NODE_ENV !== 'production') {
        console.error("Create patrol log failed:", err);
      }
    }
  };

  const handleAddIncidentReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incidentTitle || !incidentDesc) return;

    try {
      await createTransactionDoc('incidentReports', session, {
        title: incidentTitle,
        description: incidentDesc,
        severity: incidentSeverity,
        status: 'Reported',
        imageUrl: incidentImgUrl || null
      });

      setIncidentTitle('');
      setIncidentDesc('');
      setIncidentImgUrl('');
      loadData();
    } catch (err) {
      setErrorText("ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ");
      if (process.env.NODE_ENV !== 'production') {
        console.error("Create incident report failed:", err);
      }
    }
  };

  const handleAddDailyReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportSummary) return;

    try {
      // Calculate active metrics from loaded logs to prefill
      const patrolCount = patrolLogs.length;
      const incidentCount = incidentReports.length;

      await createTransactionDoc('dailyReports', session, {
        report_date: reportDate,
        summary: reportSummary,
        patrol_count: patrolCount,
        incident_count: incidentCount,
        status: 'Submitted'
      });

      setReportSummary('');
      loadData();
    } catch (err) {
      setErrorText("ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ");
      if (process.env.NODE_ENV !== 'production') {
        console.error("Create daily report failed:", err);
      }
    }
  };

  // Run the batch migration on the frontend
  const handleRunMigration = async () => {
    if (session.role !== 'admin') return;
    setMigrationRunning(true);
    setMigrationConsole(['Initiating migration interface...']);
    setMigrationStats(null);

    try {
      const res = await runLegacyMigration(session, migrationDryRun);
      setMigrationConsole(res.logs);
      setMigrationStats(res.stats);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setMigrationConsole(prev => [...prev, `CRITICAL ERROR: ${errorMsg}`]);
    } finally {
      setMigrationRunning(false);
    }
  };

  // Role Swapper helper
  const handleAssumeSession = (type: 'guard_site01' | 'admin' | 'guard_site02') => {
    if (type === 'guard_site01') {
      setSession({
        uid: 'qctgasVxGbWboRJfS9J8DVgR6B32', // The exact Guard UID qctgasVxGbWboRJfS9J8DVgR6B32
        email: 'guard-site01@smartguard.com',
        role: 'guard',
        siteId: 'site-01',
        operatorId: 'OP-SITE01-01',
        operatorName: 'Sgt. Somchai (Guard)',
        recorded_by: 'Sgt. Somchai (Guard)'
      });
      setSiteFilter('site-01');
    } else if (type === 'guard_site02') {
      setSession({
        uid: 'guard-site02-uid-789',
        email: 'guard-site02@smartguard.com',
        role: 'guard',
        siteId: 'site-02',
        operatorId: 'OP-SITE02-02',
        operatorName: 'Cpl. Somrak (Guard)',
        recorded_by: 'Cpl. Somrak (Guard)'
      });
      setSiteFilter('site-02');
    } else {
      setSession({
        uid: 'admin-uid-123',
        email: 'admin@smartguard.com',
        role: 'admin',
        siteId: 'all',
        operatorId: 'OP-ADMIN-99',
        operatorName: 'Somchai (Admin)',
        recorded_by: 'Somchai (Admin)'
      });
      setSiteFilter('all');
    }
  };

  // Helper to filter documents visually by Site ID (for Admins)
  const filterBySite = <T extends { site_id?: string }>(items: T[]) => {
    if (session.role !== 'admin' || siteFilter === 'all') return items;
    return items.filter(item => item.site_id === siteFilter);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-blue-600 selection:text-white">
      {/* 1. Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/25">
              <Shield className="h-5.5 w-5.5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">Smart Guard System</h1>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest hidden sm:block">Operations Command Center</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-500">
              <Clock className="h-4 w-4 text-blue-500 animate-pulse" />
              <span>{time}</span>
            </div>

            {/* Simulated Session Pill */}
            <div className={`flex items-center gap-2 rounded-lg border px-3 py-1 text-xs font-medium ${
              session.role === 'admin' 
                ? 'border-red-100 bg-red-50 text-red-700' 
                : 'border-blue-100 bg-blue-50 text-blue-700'
            }`}>
              <span className={`h-2 w-2 rounded-full ${session.role === 'admin' ? 'bg-red-500' : 'bg-blue-500'}`} />
              <span className="max-w-[120px] truncate sm:max-w-none">{session.operatorName}</span>
              <span className="text-[10px] font-semibold uppercase opacity-60">({session.siteId})</span>
            </div>
          </div>
        </div>
      </header>

      {/* 2. Error Display Panel (Constraint 11: Thai message, clear, no authInfo / raw JSON details) */}
      <AnimatePresence>
        {errorText && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-red-50 border-b border-red-200 text-red-800 py-3.5 px-4 shadow-sm"
          >
            <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                <p className="text-sm font-semibold">{errorText}</p>
              </div>
              <button
                onClick={() => setErrorText(null)}
                className="text-xs font-semibold bg-red-100 hover:bg-red-200 text-red-900 px-3 py-1 rounded-md transition"
              >
                รับทราบ
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        
        {/* 3. Auth Sandbox Simulator Bar */}
        <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Database className="h-4 w-4 text-blue-500" />
                จำลองสถานะสิทธิ์ผู้ใช้สำหรับการทดสอบ (Testing Auth Sandbox Mode)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                คลิกสลับบัญชีเพื่อทดสอบ Site Isolation และ Firestore Security Rules บนรถยนต์ / ผู้รับเหมา / กุญแจ / ลาดตระเวน
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleAssumeSession('guard_site01')}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold border transition ${
                  session.uid === 'qctgasVxGbWboRJfS9J8DVgR6B32'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <User className="h-3.5 w-3.5" />
                Guard UID: qctgas... (site-01)
              </button>

              <button
                onClick={() => handleAssumeSession('guard_site02')}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold border transition ${
                  session.uid === 'guard-site02-uid-789'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <User className="h-3.5 w-3.5" />
                Guard Site-02
              </button>

              <button
                onClick={() => handleAssumeSession('admin')}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold border transition ${
                  session.role === 'admin'
                    ? 'bg-red-600 text-white border-red-600 shadow-sm'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <User className="h-3.5 w-3.5" />
                Admin (All Sites)
              </button>
            </div>
          </div>

          <div className="mt-3.5 pt-3.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 font-mono bg-slate-50 p-3 rounded-lg border border-slate-200/50">
            <div>
              <span className="font-semibold text-slate-700">Authenticated UID:</span> {session.uid}
            </div>
            <div>
              <span className="font-semibold text-slate-700">Email:</span> {session.email}
            </div>
            <div>
              <span className="font-semibold text-slate-700">Site ID constraint:</span> {session.siteId}
            </div>
            <div>
              <span className="font-semibold text-slate-700">Role:</span> <span className={session.role === 'admin' ? 'text-red-600 font-bold' : 'text-blue-600 font-bold'}>{session.role.toUpperCase()}</span>
            </div>
          </div>
        </section>

        {/* 4. Filter Control for Admins */}
        {session.role === 'admin' && (
          <div className="mb-6 flex items-center justify-between gap-3 bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
            <div className="flex items-center gap-2">
              <Filter className="h-4.5 w-4.5 text-slate-400" />
              <span className="text-sm font-semibold text-slate-700">ตัวกรองสิทธิ์แอดมิน (Admin Site Filter)</span>
            </div>
            <div className="flex gap-2">
              {['all', 'site-01', 'site-02'].map((site) => (
                <button
                  key={site}
                  onClick={() => setSiteFilter(site)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold border transition ${
                    siteFilter === site
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {site === 'all' ? 'ทุกไซต์ (ALL)' : site.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 5. Main Content Layout (Grid + Tabs) */}
        <div className="flex flex-col lg:flex-row gap-8">
          
          {/* Navigation Sidebar */}
          <aside className="w-full lg:w-64 shrink-0">
            <div className="sticky top-24 bg-white border border-slate-200 p-4 rounded-2xl shadow-sm space-y-1">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 mb-2">เมนูการทำธุรกรรม</p>
              
              <button
                onClick={() => setActiveTab('vehicleLogs')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                  activeTab === 'vehicleLogs'
                    ? 'bg-blue-50 text-blue-700 shadow-sm shadow-blue-100'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Car className={`h-4.5 w-4.5 ${activeTab === 'vehicleLogs' ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span>ทะเบียนพาหนะ</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 opacity-50" />
              </button>

              <button
                onClick={() => setActiveTab('contractorLogs')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                  activeTab === 'contractorLogs'
                    ? 'bg-blue-50 text-blue-700 shadow-sm shadow-blue-100'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Briefcase className={`h-4.5 w-4.5 ${activeTab === 'contractorLogs' ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span>บันทึกผู้รับเหมา</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 opacity-50" />
              </button>

              <button
                onClick={() => setActiveTab('keyLogs')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                  activeTab === 'keyLogs'
                    ? 'bg-blue-50 text-blue-700 shadow-sm shadow-blue-100'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Key className={`h-4.5 w-4.5 ${activeTab === 'keyLogs' ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span>เบิก-คืนกุญแจ</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 opacity-50" />
              </button>

              <button
                onClick={() => setActiveTab('patrolLogs')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                  activeTab === 'patrolLogs'
                    ? 'bg-blue-50 text-blue-700 shadow-sm shadow-blue-100'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <ClipboardList className={`h-4.5 w-4.5 ${activeTab === 'patrolLogs' ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span>ตรวจลาดตระเวน</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 opacity-50" />
              </button>

              <button
                onClick={() => setActiveTab('incidentReports')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                  activeTab === 'incidentReports'
                    ? 'bg-blue-50 text-blue-700 shadow-sm shadow-blue-100'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className={`h-4.5 w-4.5 ${activeTab === 'incidentReports' ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span>รายงานเหตุการณ์</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 opacity-50" />
              </button>

              <button
                onClick={() => setActiveTab('dailyReports')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                  activeTab === 'dailyReports'
                    ? 'bg-blue-50 text-blue-700 shadow-sm shadow-blue-100'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Calendar className={`h-4.5 w-4.5 ${activeTab === 'dailyReports' ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span>สรุปรายงานประจำวัน</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 opacity-50" />
              </button>

              {session.role === 'admin' && (
                <>
                  <div className="my-2 border-t border-slate-100" />
                  <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider px-3 mb-2">เฉพาะแอดมิน (Admin Only)</p>

                  <button
                    onClick={() => setActiveTab('auditLogs')}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                      activeTab === 'auditLogs'
                        ? 'bg-red-50 text-red-700 shadow-sm shadow-red-100'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <History className={`h-4.5 w-4.5 ${activeTab === 'auditLogs' ? 'text-red-600' : 'text-slate-400'}`} />
                      <span>บันทึก Audit Logs</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 opacity-50" />
                  </button>

                  <button
                    onClick={() => setActiveTab('migrationTool')}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition ${
                      activeTab === 'migrationTool'
                        ? 'bg-red-50 text-red-700 shadow-sm shadow-red-100'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Database className={`h-4.5 w-4.5 ${activeTab === 'migrationTool' ? 'text-red-600' : 'text-slate-400'}`} />
                      <span>เครื่องมือกู้คืนข้อมูล</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 opacity-50" />
                  </button>
                </>
              )}

              <div className="mt-4 pt-3 border-t border-slate-100">
                <button
                  onClick={() => loadData()}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 border border-slate-200 rounded-xl transition"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>รีเฟรชข้อมูล</span>
                </button>
              </div>
            </div>
          </aside>

          {/* Tab Workspaces */}
          <div className="flex-1 min-w-0">
            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold mb-4 bg-slate-100/50 border border-slate-200 p-3 rounded-xl animate-pulse">
                <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
                <span>กำลังโหลดข้อมูลในไซต์งาน...</span>
              </div>
            )}

            {/* TAB 1: VEHICLE LOGS */}
            {activeTab === 'vehicleLogs' && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <Car className="h-5 w-5 text-blue-500" />
                    เพิ่มข้อมูลบันทึกพาหนะเข้าออก (Submit Vehicle Log Entry)
                  </h3>
                  <form onSubmit={handleAddVehicleLog} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">ทะเบียนรถ</label>
                      <input
                        type="text"
                        required
                        value={vehiclePlate}
                        onChange={(e) => setVehiclePlate(e.target.value)}
                        placeholder="กข 1234 กรุงเทพฯ"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">ประเภทรถ</label>
                      <select
                        value={vehicleType}
                        onChange={(e) => setVehicleType(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white transition"
                      >
                        <option value="รถยนต์สี่ล้อ">รถยนต์ 4 ล้อ</option>
                        <option value="รถจักรยานยนต์">รถจักรยานยนต์</option>
                        <option value="รถบรรทุกสิบล้อขึ้นไป">รถบรรทุกขนาดใหญ่</option>
                        <option value="รถตู้">รถตู้</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">ชื่อผู้ขับขี่</label>
                      <input
                        type="text"
                        required
                        value={driverName}
                        onChange={(e) => setDriverName(e.target.value)}
                        placeholder="นายสมยศ ใจเย็น"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">วัตถุประสงค์ในการเข้า</label>
                      <input
                        type="text"
                        value={vehiclePurpose}
                        onChange={(e) => setVehiclePurpose(e.target.value)}
                        placeholder="ติดต่อฝ่ายจัดซื้อ"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div className="md:col-span-2 pt-2">
                      <button
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2.5 rounded-xl transition flex items-center justify-center gap-2 shadow-sm"
                      >
                        <Plus className="h-4 w-4" />
                        บันทึกรถเข้างาน
                      </button>
                    </div>
                  </form>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-slate-900">ประวัติรถยนต์เข้า-ออกไซต์งาน ({session.siteId})</h3>
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full uppercase">Realtime Database</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs text-slate-500">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/55 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          <th className="p-3">ทะเบียนรถ</th>
                          <th className="p-3">ผู้ขับขี่ / ประเภท</th>
                          <th className="p-3">ไซต์งาน</th>
                          <th className="p-3">เวลาเข้า</th>
                          <th className="p-3">เวลาออก</th>
                          <th className="p-3">สถานะ</th>
                          <th className="p-3">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filterBySite(vehicleLogs).length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-slate-400 font-medium">ไม่พบประวัติข้อมูลรถยนต์สำหรับไซต์งานนี้</td>
                          </tr>
                        ) : (
                          filterBySite(vehicleLogs).map((log) => (
                            <tr key={log.id} className="hover:bg-slate-50/40 transition">
                              <td className="p-3 font-bold text-slate-900">{log.vehicle_plate}</td>
                              <td className="p-3">
                                <div className="font-semibold">{log.driver_name}</div>
                                <div className="text-[10px] text-slate-400">{log.vehicle_type}</div>
                              </td>
                              <td className="p-3 font-mono font-semibold">{log.site_id || 'ไม่มี (Legacy)'}</td>
                              <td className="p-3 font-mono">{new Date(log.entry_time).toLocaleString('th-TH')}</td>
                              <td className="p-3 font-mono">{log.exit_time ? new Date(log.exit_time).toLocaleString('th-TH') : '-'}</td>
                              <td className="p-3">
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  log.status === 'Entered'
                                    ? 'bg-blue-50 text-blue-700'
                                    : 'bg-emerald-50 text-emerald-700'
                                }`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${log.status === 'Entered' ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                                  {log.status === 'Entered' ? 'อยู่ในพื้นที่' : 'ออกแล้ว'}
                                </span>
                              </td>
                              <td className="p-3">
                                {log.status === 'Entered' && (
                                  <button
                                    onClick={() => handleCheckoutVehicle(log.id)}
                                    className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-[10px] px-2.5 py-1 rounded-lg transition"
                                  >
                                    ออกรถ
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: CONTRACTOR LOGS */}
            {activeTab === 'contractorLogs' && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <Briefcase className="h-5 w-5 text-blue-500" />
                    เพิ่มข้อมูลบันทึกผู้รับเหมาปฏิบัติงาน (Submit Contractor Log Entry)
                  </h3>
                  <form onSubmit={handleAddContractorLog} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">ชื่อผู้รับเหมา</label>
                      <input
                        type="text"
                        required
                        value={contractorName}
                        onChange={(e) => setContractorName(e.target.value)}
                        placeholder="นายกานต์ โพธิ์ทอง"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">บริษัท / สังกัด</label>
                      <input
                        type="text"
                        required
                        value={contractorCompany}
                        onChange={(e) => setContractorCompany(e.target.value)}
                        placeholder="บริษัท ปลอดภัยวิศวกรรม จำกัด"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">ประเภทงาน / รายละเอียดภารกิจ</label>
                      <input
                        type="text"
                        value={contractorPurpose}
                        onChange={(e) => setContractorPurpose(e.target.value)}
                        placeholder="ติดตั้งอุปกรณ์ไฟฟ้าชั้น 4 โซน B"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div className="md:col-span-2 pt-2">
                      <button
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2.5 rounded-xl transition flex items-center justify-center gap-2 shadow-sm"
                      >
                        <Plus className="h-4 w-4" />
                        ลงทะเบียนเข้าทำงาน
                      </button>
                    </div>
                  </form>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-slate-900">รายชื่อผู้รับเหมาลงเวลาปฏิบัติงาน ({session.siteId})</h3>
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full uppercase">Realtime Database</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs text-slate-500">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/55 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          <th className="p-3">ผู้รับเหมา</th>
                          <th className="p-3">สังกัดบริษัท / หน้าที่</th>
                          <th className="p-3">ไซต์งาน</th>
                          <th className="p-3">เวลาเริ่มปฏิบัติงาน</th>
                          <th className="p-3">เวลาออก</th>
                          <th className="p-3">สถานะ</th>
                          <th className="p-3">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filterBySite(contractorLogs).length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-slate-400 font-medium">ไม่พบข้อมูลรายชื่อผู้รับเหมาสำหรับไซต์งานนี้</td>
                          </tr>
                        ) : (
                          filterBySite(contractorLogs).map((log) => (
                            <tr key={log.id} className="hover:bg-slate-50/40 transition">
                              <td className="p-3 font-bold text-slate-900">{log.contractor_name}</td>
                              <td className="p-3">
                                <div className="font-semibold">{log.company}</div>
                                <div className="text-[10px] text-slate-400">{log.purpose}</div>
                              </td>
                              <td className="p-3 font-mono font-semibold">{log.site_id || 'ไม่มี (Legacy)'}</td>
                              <td className="p-3 font-mono">{new Date(log.entry_time).toLocaleString('th-TH')}</td>
                              <td className="p-3 font-mono">{log.exit_time ? new Date(log.exit_time).toLocaleString('th-TH') : '-'}</td>
                              <td className="p-3">
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  log.status === 'Active'
                                    ? 'bg-blue-50 text-blue-700'
                                    : 'bg-emerald-50 text-emerald-700'
                                }`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${log.status === 'Active' ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                                  {log.status === 'Active' ? 'กำลังปฏิบัติงาน' : 'ออกงานแล้ว'}
                                </span>
                              </td>
                              <td className="p-3">
                                {log.status === 'Active' && (
                                  <button
                                    onClick={() => handleCheckoutContractor(log.id)}
                                    className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-[10px] px-2.5 py-1 rounded-lg transition"
                                  >
                                    ลงเวลากลับ
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: KEY LOGS */}
            {activeTab === 'keyLogs' && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <Key className="h-5 w-5 text-blue-500" />
                    บันทึกการเบิก-คืนกุญแจควบคุม (Submit Key Log Entry)
                  </h3>
                  <form onSubmit={handleAddKeyLog} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">หมายเลข / รหัสกุญแจ</label>
                      <input
                        type="text"
                        required
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                        placeholder="KEY-ROOM-A04 (กุญแจห้องควบคุมอาคาร A)"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">ผู้รับเบิกกุญแจ</label>
                      <input
                        type="text"
                        required
                        value={keyBorrower}
                        onChange={(e) => setKeyBorrower(e.target.value)}
                        placeholder="นส. ณัฐกานต์ พลอยงาม"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">วัตถุประสงค์ในการเบิก</label>
                      <input
                        type="text"
                        value={keyPurpose}
                        onChange={(e) => setKeyPurpose(e.target.value)}
                        placeholder="ตรวจเช็คระบบหม้อแปลงไฟฟ้าอาคาร"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div className="md:col-span-2 pt-2">
                      <button
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2.5 rounded-xl transition flex items-center justify-center gap-2 shadow-sm"
                      >
                        <Plus className="h-4 w-4" />
                        ลงบันทึกการเบิกกุญแจ
                      </button>
                    </div>
                  </form>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-slate-900">ประวัติเบิก-คืนกุญแจรักษาความปลอดภัย ({session.siteId})</h3>
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full uppercase">Realtime Database</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs text-slate-500">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/55 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          <th className="p-3">รหัสกุญแจ</th>
                          <th className="p-3">ผู้เบิกกุญแจ / วัตถุประสงค์</th>
                          <th className="p-3">ไซต์งาน</th>
                          <th className="p-3">เวลาเบิก</th>
                          <th className="p-3">เวลาคืน</th>
                          <th className="p-3">สถานะ</th>
                          <th className="p-3">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filterBySite(keyLogs).length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-slate-400 font-medium">ไม่พบประวัติข้อมูลการเบิกกุญแจสำหรับไซต์งานนี้</td>
                          </tr>
                        ) : (
                          filterBySite(keyLogs).map((log) => (
                            <tr key={log.id} className="hover:bg-slate-50/40 transition">
                              <td className="p-3 font-bold text-slate-900">{log.key_name}</td>
                              <td className="p-3">
                                <div className="font-semibold">{log.borrower}</div>
                                <div className="text-[10px] text-slate-400">{log.purpose}</div>
                              </td>
                              <td className="p-3 font-mono font-semibold">{log.site_id || 'ไม่มี (Legacy)'}</td>
                              <td className="p-3 font-mono">{new Date(log.borrow_time).toLocaleString('th-TH')}</td>
                              <td className="p-3 font-mono">{log.return_time ? new Date(log.return_time).toLocaleString('th-TH') : '-'}</td>
                              <td className="p-3">
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  log.status === 'Borrowed'
                                    ? 'bg-amber-50 text-amber-700'
                                    : 'bg-emerald-50 text-emerald-700'
                                }`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${log.status === 'Borrowed' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                                  {log.status === 'Borrowed' ? 'ถูกเบิกไป' : 'คืนแล้ว'}
                                </span>
                              </td>
                              <td className="p-3">
                                {log.status === 'Borrowed' && (
                                  <button
                                    onClick={() => handleReturnKey(log.id)}
                                    className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-[10px] px-2.5 py-1 rounded-lg transition"
                                  >
                                    ลงบันทึกการคืน
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: PATROL LOGS */}
            {activeTab === 'patrolLogs' && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <ClipboardList className="h-5 w-5 text-blue-500" />
                    ลงบันทึกการตรวจความเรียบร้อยลาดตระเวน (Submit Patrol Log Entry)
                  </h3>
                  <form onSubmit={handleAddPatrolLog} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">จุดตรวจสอบ</label>
                      <input
                        type="text"
                        required
                        value={patrolCheckpoint}
                        onChange={(e) => setPatrolCheckpoint(e.target.value)}
                        placeholder="จุดตรวจ 03 อาคารคลังสินค้าหลังที่ 2"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">ผลการตรวจ</label>
                      <select
                        value={patrolStatus}
                        onChange={(e) => setPatrolStatus(e.target.value as 'Pass' | 'Fail' | 'Issue Found')}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white transition"
                      >
                        <option value="Pass">ปกติ (Pass)</option>
                        <option value="Issue Found">พบความไม่เรียบร้อย (Issue Found)</option>
                        <option value="Fail">ล้มเหลว / มีร่องรอยงัดแงะ (Fail)</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">หมายเหตุ / ข้อมูลเพิ่มเติม</label>
                      <textarea
                        rows={3}
                        value={patrolNotes}
                        onChange={(e) => setPatrolNotes(e.target.value)}
                        placeholder="ตรวจเช็คประตูล็อคเรียบร้อยดี ระบบไฟฟ้าแสงสว่างรอบนอกทำงานปกติ..."
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div className="md:col-span-2 pt-2">
                      <button
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2.5 rounded-xl transition flex items-center justify-center gap-2 shadow-sm"
                      >
                        <Plus className="h-4 w-4" />
                        บันทึกการตรวจ
                      </button>
                    </div>
                  </form>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-slate-900">ประวัติการเดินตรวจรอบเขตพื้นที่รับผิดชอบ ({session.siteId})</h3>
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full uppercase">Realtime Database</span>
                  </div>

                  <div className="space-y-4">
                    {filterBySite(patrolLogs).length === 0 ? (
                      <div className="text-center py-8 text-slate-400 font-medium">ไม่พบประวัติความปลอดภัยรอบลาดตระเวนสำหรับไซต์งานนี้</div>
                    ) : (
                      filterBySite(patrolLogs).map((log) => (
                        <div key={log.id} className="p-4 border border-slate-100 bg-slate-50/30 rounded-xl hover:border-slate-200 hover:bg-slate-50/80 transition flex items-start gap-3.5">
                          <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-white ${
                            log.status === 'Pass' ? 'bg-emerald-500' : log.status === 'Issue Found' ? 'bg-amber-500' : 'bg-red-500'
                          }`}>
                            <Shield className="h-4.5 w-4.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-4">
                              <h4 className="text-xs font-bold text-slate-900">{log.checkpoint}</h4>
                              <time className="text-[10px] text-slate-400 font-mono">{new Date(log.created_at).toLocaleString('th-TH')}</time>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-bold ring-1 ring-inset ${
                                log.status === 'Pass' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/10' :
                                log.status === 'Issue Found' ? 'bg-amber-50 text-amber-700 ring-amber-600/10' : 'bg-red-50 text-red-700 ring-red-600/10'
                              }`}>
                                {log.status}
                              </span>
                              <span className="text-[9px] text-slate-400 font-mono">ไซต์: {log.site_id} | ผู้ตรวจ: {log.recorded_by}</span>
                            </div>
                            {log.notes && (
                              <p className="mt-2 text-xs text-slate-500 leading-relaxed font-normal whitespace-pre-line bg-white/70 p-2 rounded-lg border border-slate-100">{log.notes}</p>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: INCIDENT REPORTS */}
            {activeTab === 'incidentReports' && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-blue-500" />
                    ส่งรายงานเหตุด่วน / เหตุการณ์ไม่ปกติ (Submit Incident Report)
                  </h3>
                  <form onSubmit={handleAddIncidentReport} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">หัวข้อเหตุการณ์</label>
                      <input
                        type="text"
                        required
                        value={incidentTitle}
                        onChange={(e) => setIncidentTitle(e.target.value)}
                        placeholder="ระบบกระแสไฟฟ้าลัดวงจร"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">ระดับความรุนแรง</label>
                      <select
                        value={incidentSeverity}
                        onChange={(e) => setIncidentSeverity(e.target.value as 'Low' | 'Medium' | 'High')}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white transition"
                      >
                        <option value="Low">ต่ำ (Low)</option>
                        <option value="Medium">ปานกลาง (Medium)</option>
                        <option value="High">สูงมาก (High)</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">ลิงก์ภาพถ่ายหลักฐาน (URL)</label>
                      <input
                        type="url"
                        value={incidentImgUrl}
                        onChange={(e) => setIncidentImgUrl(e.target.value)}
                        placeholder="https://images.unsplash.com/photo-..."
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">รายละเอียดและเหตุการณ์โดยสังเขป</label>
                      <textarea
                        rows={3}
                        required
                        value={incidentDesc}
                        onChange={(e) => setIncidentDesc(e.target.value)}
                        placeholder="เวลาประมาณ 01:20 น. เกิดเหตุประกายไฟจากแผงควบคุมหลัก อาคารสำนักงานชั้น 1 พนักงานกะดึกได้นำถังดับเพลิงควบคุมเรียบร้อย..."
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div className="md:col-span-2 pt-2">
                      <button
                        type="submit"
                        className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-2.5 rounded-xl transition flex items-center justify-center gap-2 shadow-sm"
                      >
                        <AlertTriangle className="h-4 w-4" />
                        รายงานเหตุด่วนทันที
                      </button>
                    </div>
                  </form>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-slate-900">กระดานติดตามรายงานสถานการณ์ความมั่นคง ({session.siteId})</h3>
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full uppercase">Realtime Database</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {filterBySite(incidentReports).length === 0 ? (
                      <div className="col-span-2 text-center py-8 text-slate-400 font-medium">ไม่พบประวัติการรายงานอุบัติภัยหรือเหตุการณ์ไม่ปกติสำหรับไซต์งานนี้</div>
                    ) : (
                      filterBySite(incidentReports).map((log) => (
                        <div key={log.id} className="border border-slate-150 bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition">
                          {log.imageUrl && (
                            <div className="h-40 w-full bg-slate-100 overflow-hidden">
                              <img src={log.imageUrl} alt="Incident attachment proof" className="w-full h-full object-cover" />
                            </div>
                          )}
                          <div className="p-4">
                            <div className="flex items-start justify-between gap-2">
                              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[9px] font-bold ${
                                log.severity === 'High' ? 'bg-red-50 text-red-700 ring-1 ring-red-600/20' :
                                log.severity === 'Medium' ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/20' :
                                'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20'
                              }`}>
                                {log.severity.toUpperCase()} SEVERITY
                              </span>
                              <time className="text-[10px] text-slate-400 font-mono">{new Date(log.created_at).toLocaleString('th-TH')}</time>
                            </div>
                            <h4 className="text-sm font-bold text-slate-900 mt-2">{log.title}</h4>
                            <p className="text-xs text-slate-500 mt-1 line-clamp-3">{log.description}</p>
                            
                            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-semibold uppercase">
                              <span>ไซต์: {log.site_id}</span>
                              <span>บันทึกโดย: {log.recorded_by}</span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 6: DAILY REPORTS */}
            {activeTab === 'dailyReports' && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-blue-500" />
                    ส่งรายงานประจำวัน (Submit Daily Executive Summary Report)
                  </h3>
                  <form onSubmit={handleAddDailyReport} className="grid grid-cols-1 gap-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">วันที่จัดทำรายงาน</label>
                        <input
                          type="date"
                          required
                          value={reportDate}
                          onChange={(e) => setReportDate(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                        />
                      </div>
                      <div className="flex items-end">
                        <div className="text-xs text-slate-400 font-semibold mb-2">
                          * ระบบจะคำนวณสถิติและแนบข้อมูลตรวจลาดตระเวนและรายงานเหตุการณ์จากระบบโดยอัตโนมัติ
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">บทสรุปผู้บริหารและการปฏิบัติงานประจำวัน</label>
                      <textarea
                        rows={4}
                        required
                        value={reportSummary}
                        onChange={(e) => setReportSummary(e.target.value)}
                        placeholder="สรุปสถานการณ์โดยรวมรอบ 24 ชั่วโมง: ผลการปฏิบัติงานรักษาความมั่นคงเป็นไปด้วยความเรียบร้อย ไม่มีเหตุอาชญากรรม..."
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 transition"
                      />
                    </div>
                    <div className="pt-2">
                      <button
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2.5 rounded-xl transition flex items-center justify-center gap-2 shadow-sm"
                      >
                        <Plus className="h-4 w-4" />
                        อนุมัติและนำส่งรายงานสรุปประจำวัน
                      </button>
                    </div>
                  </form>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-slate-900">คลังสารสนเทศรายงานสรุปประจำวัน ({session.siteId})</h3>
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full uppercase">Realtime Database</span>
                  </div>

                  <div className="space-y-4">
                    {filterBySite(dailyReports).length === 0 ? (
                      <div className="text-center py-8 text-slate-400 font-medium">ไม่พบเอกสารรายงานสรุปประจำวันในไซต์งานนี้</div>
                    ) : (
                      filterBySite(dailyReports).map((log) => (
                        <div key={log.id} className="p-5 border border-slate-150 bg-white rounded-2xl hover:border-slate-300 shadow-sm hover:shadow-md transition">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                            <div className="flex items-center gap-2.5">
                              <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                                <Calendar className="h-4.5 w-4.5" />
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-slate-900">สรุปการปฏิบัติการประจำวันที่: {log.report_date}</h4>
                                <p className="text-[10px] text-slate-400 font-semibold uppercase mt-0.5">ไซต์งาน: {log.site_id} | ผู้รับรายงาน: สำนักงานใหญ่</p>
                              </div>
                            </div>
                            <span className="self-start sm:self-auto text-[10px] font-bold bg-green-50 text-green-700 border border-green-200/50 px-2 py-0.5 rounded-full">
                              {log.status.toUpperCase()}
                            </span>
                          </div>

                          <p className="mt-4 text-xs text-slate-600 leading-relaxed font-normal whitespace-pre-line bg-slate-50/50 border border-slate-100 p-3.5 rounded-xl">
                            {log.summary}
                          </p>

                          <div className="grid grid-cols-2 gap-4 mt-4 bg-slate-50/30 p-3 rounded-xl border border-slate-100 text-xs font-semibold text-slate-500">
                            <div>
                              การเดินตรวจลาดตระเวนทั้งหมด: <span className="font-bold text-slate-900">{log.patrol_count || 0} รอบ</span>
                            </div>
                            <div>
                              อุบัติภัยที่ได้รับรายงานในวัน: <span className="font-bold text-slate-900">{log.incident_count || 0} รายการ</span>
                            </div>
                          </div>

                          <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-semibold font-mono">
                            <span>UID: {log.account_uid}</span>
                            <span>Recorded by: {log.recorded_by}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 7: AUDIT LOGS (Admin Only) */}
            {activeTab === 'auditLogs' && session.role === 'admin' && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-slate-900">ระบบประวัติการตรวจสอบกิจกรรม (Administrative Audit Logs)</h3>
                    <span className="text-[10px] font-bold text-slate-400 bg-red-50 text-red-600 px-2.5 py-1 rounded-full uppercase font-mono">Secured Logs</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs text-slate-500">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/55 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          <th className="p-3">หัวข้อการทำงาน / กิจกรรม</th>
                          <th className="p-3">รายละเอียดเชิงเทคนิค</th>
                          <th className="p-3">ไซต์งาน</th>
                          <th className="p-3">เวลาที่เกิดเหตุการณ์</th>
                          <th className="p-3">ผู้บันทึกระบบ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filterBySite(auditLogs).length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-6 text-center text-slate-400 font-medium">ไม่พบประวัติการทำงานของระบบแอดมินสำหรับไซต์งานนี้</td>
                          </tr>
                        ) : (
                          filterBySite(auditLogs).map((log) => (
                            <tr key={log.id} className="hover:bg-slate-50/40 transition">
                              <td className="p-3 font-bold text-red-600">{log.action}</td>
                              <td className="p-3 font-mono text-[10px] break-all max-w-xs">{log.details}</td>
                              <td className="p-3 font-mono font-semibold">{log.site_id || 'ไม่มี (Legacy)'}</td>
                              <td className="p-3 font-mono">{new Date(log.created_at).toLocaleString('th-TH')}</td>
                              <td className="p-3">
                                <div className="font-semibold text-slate-800">{log.operator_name}</div>
                                <div className="text-[10px] text-slate-400 uppercase">บทบาท: {log.role}</div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 8: MIGRATION PANEL (Admin Only) */}
            {activeTab === 'migrationTool' && session.role === 'admin' && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-base font-bold text-slate-900 mb-2 flex items-center gap-2">
                    <Database className="h-5 w-5 text-red-600" />
                    เครื่องมือจัดการเติมข้อมูลเก่าย้อนหลังสำหรับแอดมิน (Admin-Only Legacy Migration Utility)
                  </h3>
                  <p className="text-xs text-slate-400 mb-6 leading-relaxed">
                    ค้นหาและอัปเดตเอกสารประวัติการทำงานในอดีต (Legacy Documents) ที่ยังไม่มีฟิลด์ <code className="bg-slate-100 font-mono text-slate-800 px-1 py-0.5 rounded text-[10px]">site_id</code> 
                    โดยระบบจะดำเนินการอัปเดตค่าเริ่มต้นเป็น <code className="bg-slate-100 font-mono text-slate-800 px-1 py-0.5 rounded text-[10px]">"site-01"</code> ให้กับเอกสารใน 7 คอลเลกชันหลัก 
                    อย่างปลอดภัยสูงสุดด้วย Batch-write (ไม่เกิน 400 รายการต่อการบันทึก)
                  </p>

                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
                    <h4 className="text-xs font-bold text-amber-800 uppercase flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      นโยบายและมาตรการความปลอดภัยในการโยกย้าย (Safety Rules)
                    </h4>
                    <ul className="list-disc list-inside text-[11px] text-amber-700 mt-2 space-y-1 font-semibold">
                      <li>ดำเนินการเฉพาะฟิลด์ที่ว่างเปล่า (ไม่มี site_id) เท่านั้น</li>
                      <li>ห้ามเขียนทับหรือแก้ไขเอกสารที่มี site_id อยู่แล้วเด็ดขาด</li>
                      <li>ไม่ลบเอกสารออกจากฐานข้อมูล, ไม่แก้ไข Document ID และไม่ยุ่งเกี่ยวฟิลด์ created_at</li>
                      <li>รองรับการสแกนทดลองจำลองผลการทำงาน (Dry-run) ก่อนที่จะตัดสินใจเขียนลงฐานข้อมูลจริง</li>
                      <li>จัดเก็บ Audit log ลงในฐานข้อมูลกลางทุกครั้งที่มีการประมวลผลการย้ายข้อมูลจริง</li>
                    </ul>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 p-4 border border-slate-200 bg-slate-50/50 rounded-xl mb-6">
                    <div className="flex items-center gap-5">
                      <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-slate-700">
                        <input
                          type="checkbox"
                          checked={migrationDryRun}
                          onChange={(e) => setMigrationDryRun(e.target.checked)}
                          className="h-4.5 w-4.5 rounded text-blue-600 border-slate-300 focus:ring-blue-500"
                        />
                        <span>โหมดจำลองประเมินผลเท่านั้น (Dry-run Mode)</span>
                      </label>
                    </div>

                    <button
                      onClick={handleRunMigration}
                      disabled={migrationRunning}
                      className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold text-white shadow-md transition ${
                        migrationDryRun
                          ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20'
                          : 'bg-red-600 hover:bg-red-700 shadow-red-500/20'
                      } disabled:opacity-50`}
                    >
                      {migrationRunning ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          <span>กำลังรันการกู้คืนระบบ...</span>
                        </>
                      ) : (
                        <>
                          <Database className="h-4 w-4" />
                          <span>{migrationDryRun ? 'ตรวจสอบจำลองผล (Dry-Run)' : 'ดำเนินการอัปเดตจริงย้อนหลัง (Commit Real)'}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Migration Stats Dashboard */}
                  {migrationStats && (
                    <div className="mb-6">
                      <h4 className="text-xs font-bold text-slate-700 mb-3 uppercase tracking-wider">สรุปปริมาณข้อมูลที่วิเคราะห์ได้ (Migration Stats Summary)</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {Object.entries(migrationStats).map(([colName, data]: [string, { scanned: number; updated: number; skipped: number; failed: number }]) => (
                          <div key={colName} className="border border-slate-200 rounded-xl p-3 bg-white shadow-sm">
                            <div className="text-[10px] font-bold text-slate-400 uppercase truncate">{colName}</div>
                            <div className="mt-1 text-base font-bold text-slate-800">Scanned: {data.scanned}</div>
                            <div className="text-[10px] font-bold mt-1 text-slate-500 flex flex-col gap-0.5">
                              <span className="text-emerald-600">Updated: {data.updated}</span>
                              <span className="text-slate-400">Skipped: {data.skipped}</span>
                              <span className="text-red-500">Failed: {data.failed}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Migration Terminal Logs console */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">เทอร์มินัลรายงานผลตามเวลาจริง (Real-time Audit logs console)</h4>
                      <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    </div>
                    <div className="font-mono text-xs bg-slate-900 text-slate-200 p-4 rounded-xl min-h-[180px] max-h-[300px] overflow-y-auto space-y-1 shadow-inner border border-slate-950">
                      {migrationConsole.length === 0 ? (
                        <p className="text-slate-500 italic">พร้อมรอรับคำสั่งรันระบบประมวลผลกู้คืนย้อนหลัง...</p>
                      ) : (
                        migrationConsole.map((logLine, idx) => (
                          <div key={idx} className="flex gap-2">
                            <span className="text-blue-400 shrink-0 select-none">&gt;&gt;</span>
                            <span>{logLine}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
