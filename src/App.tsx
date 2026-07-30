import { lazy, Suspense, useState, useEffect, useRef, type ReactNode } from 'react';
import type { FormEvent } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  Shield, LogOut, Loader2, Home, Car, Users, Key,
  MapPin, AlertTriangle, Search, Settings, RefreshCw
} from 'lucide-react';
import {
  auth,
  AuthStageError,
  bootstrapFirstAdmin,
  db,
  isFirstAdminSetupAvailable,
  normalizeUsername,
  onAuthStateChange,
  prepareAuthPersistence,
  runtimeConfiguration,
  signInWithUsernamePin,
  signOutSmartGuard,
  validateOperatorSessionProfile,
  validatePin,
  type AuthSessionState,
} from './firebase';
import {
  firebaseErrorCode,
  firebaseErrorMessage,
  recordAuthStage,
  stagingAuthMessage,
} from './services/authDiagnostics';
import { shouldHydrateAuthProfile } from './services/authFlowPolicy';
import { writeAuditLog } from './services/auditService';
import { listSystemSettings } from './services/systemSettingsService';
import ConfirmModal from './components/ConfirmModal';

console.log('[Smart Guard Build] v4.0.1 bootstrap-permission fix loaded');

const Dashboard = lazy(() => import('./components/Dashboard'));
const VehicleEntryExit = lazy(() => import('./components/VehicleEntryExit'));
const VehicleOperations = lazy(() => import('./components/VehicleOperations'));
const ContractorLogs = lazy(() => import('./components/ContractorLogs'));
const KeyLogs = lazy(() => import('./components/KeyLogs'));
const PatrolLogs = lazy(() => import('./components/PatrolLogs'));
const IncidentReports = lazy(() => import('./components/IncidentReports'));
const SearchHistory = lazy(() => import('./components/SearchHistory'));
const MasterData = lazy(() => import('./components/MasterData'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));

export type TabType = 'dashboard' | 'vehicles' | 'vehicleOperations' | 'contractors' | 'keys' | 'patrol' | 'incidents' | 'history' | 'settings' | 'admin';
type Role = 'Guard' | 'ShiftHead' | 'Manager' | 'Admin';

function DebugPage({ name, children }: { name: string; children: ReactNode }) {
  useEffect(() => {
    console.log(`[Smart Guard Debug] ${name} mounted`);
    return () => console.log(`[Smart Guard Debug] ${name} unmounted`);
  }, [name]);

  return <>{children}</>;
}

function PageFallback() {
  return <div className="flex min-h-64 items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />กำลังโหลดโมดูล...</div>;
}

function EnvironmentMarker() {
  if (runtimeConfiguration.environmentName === 'PRODUCTION') return null;
  return <div className="fixed right-3 top-3 z-[100] rounded-md bg-amber-400 px-3 py-1 text-xs font-black text-slate-950 shadow">
    {runtimeConfiguration.environmentName}
  </div>;
}

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authSessionState, setAuthSessionState] = useState<AuthSessionState>('idle');
  const [apiInitializing, setApiInitializing] = useState(false);
  const [apiReady, setApiReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  const [guardName, setGuardName] = useState('');
  const [userRole, setUserRole] = useState<Role>('Guard');
  const [currentProfile, setCurrentProfile] = useState<any | null>(null);
  const [username, setUsername] = useState('');
  const [operatorPin, setOperatorPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isSetupRoute, setIsSetupRoute] = useState(() => window.location.pathname === '/setup');
  const [setupStatus, setSetupStatus] = useState<'checking' | 'available' | 'error'>('checking');
  const [bootstrapPin, setBootstrapPin] = useState('');
  const [bootstrapConfirmPin, setBootstrapConfirmPin] = useState('');
  const bootstrapInProgressRef = useRef(false);
  const pinLoginInProgressRef = useRef(false);

  useEffect(() => {
    console.log('[Smart Guard Debug] activeTab changed:', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (!currentProfile || !firebaseUser) return;
    recordAuthStage({
      stage: 'AUTH-12',
      status: authSessionState === 'authenticated' ? 'PASS' : 'FAIL',
      code: authSessionState === 'authenticated' ? 'ok' : 'auth/session-not-ready',
      message: authSessionState === 'authenticated'
        ? 'Protected application route accepted the hydrated session.'
        : 'Protected application route is waiting for session readiness.',
      source: 'src/App.tsx protected render guard',
      path: `users/${firebaseUser.uid}`,
    });
  }, [authSessionState, currentProfile, firebaseUser]);

  const initFirestoreDatabase = async () => {
    setApiInitializing(true);
    setInitError(null);
    try {
      setApiReady(true);
    } catch (err: any) {
      setInitError(err.message || 'ไม่สามารถเข้าถึง Cloud Firestore');
    } finally {
      setApiInitializing(false);
    }
  };

  const applyProfile = async (user: any, profile: any) => {
    const canonicalProfile = validateOperatorSessionProfile(user.uid, profile);
    sessionStorage.setItem('selected_site_id', canonicalProfile.site_id);
    setFirebaseUser(user);
    setCurrentProfile(canonicalProfile);
    setGuardName(canonicalProfile.operator_name || canonicalProfile.username || 'ผู้ใช้งาน');
    setUserRole(canonicalProfile.role);
    setActiveTab('dashboard');
    await initFirestoreDatabase();
    setAuthSessionState('authenticated');
    recordAuthStage({
      stage: 'AUTH-11',
      status: 'PASS',
      code: 'ok',
      message: 'Authenticated session committed to application state.',
      source: 'src/App.tsx applyProfile',
      path: `users/${user.uid}`,
    });
  };

  useEffect(() => {
    let mounted = true;
    prepareAuthPersistence().catch(console.error);
    const unsubscribe = onAuthStateChange(async user => {
      if (!mounted) return;
      try {
        if (!user) {
          if (pinLoginInProgressRef.current) return;
          setFirebaseUser(null);
          setCurrentProfile(null);
          setGuardName('');
          setUserRole('Guard');
          setAuthSessionState('idle');
          setAuthLoading(false);
          return;
        }
        if (!shouldHydrateAuthProfile(pinLoginInProgressRef.current)) return;
        setAuthSessionState('profile-loading');
        const profileSnap = await getDoc(doc(db, 'users', user.uid));
        if (!profileSnap.exists() || profileSnap.data().status !== 'Active') {
          if (bootstrapInProgressRef.current) return;
          await signOutSmartGuard();
          setLoginError('บัญชีนี้ไม่มีสิทธิ์ใช้งานหรือถูกปิดใช้งาน');
          setAuthLoading(false);
          return;
        }
        await applyProfile(user, { ...profileSnap.data(), user_id: user.uid });
        setAuthLoading(false);
      } catch (err: any) {
        setAuthSessionState('failed');
        recordAuthStage({
          stage: 'AUTH-07',
          status: 'FAIL',
          code: firebaseErrorCode(err),
          message: firebaseErrorMessage(err),
          source: 'src/App.tsx onAuthStateChange',
          path: user ? `users/${user.uid}` : undefined,
        });
        setInitError(
          runtimeConfiguration.environmentName === 'STAGING'
            ? stagingAuthMessage('AUTH-07', err)
            : err.message || 'ตรวจสอบสถานะผู้ใช้ไม่สำเร็จ',
        );
        setAuthLoading(false);
      }
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    const updateRoute = () => setIsSetupRoute(window.location.pathname === '/setup');
    window.addEventListener('popstate', updateRoute);
    return () => window.removeEventListener('popstate', updateRoute);
  }, []);

  useEffect(() => {
    if (currentProfile || !isSetupRoute) return;
    let active = true;
    setSetupStatus('checking');
    isFirstAdminSetupAvailable()
      .then(available => {
        if (!active) return;
        if (!available) {
          window.history.replaceState({}, '', '/');
          setIsSetupRoute(false);
          return;
        }
        setSetupStatus('available');
      })
      .catch(() => {
        if (active) setSetupStatus('error');
      });
    return () => { active = false; };
  }, [currentProfile, isSetupRoute]);

  const handleUsernamePinLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginError(null);
    const normalized = normalizeUsername(username);
    if (!normalized) return setLoginError('กรุณากรอก Username');
    if (!validatePin(operatorPin)) return setLoginError('PIN ต้องเป็นตัวเลข 6 หลัก');
    setLoginBusy(true);
    pinLoginInProgressRef.current = true;
    try {
      const result = await signInWithUsernamePin(normalized, operatorPin, setAuthSessionState);
      await applyProfile(result.firebaseUser, result.profile);
      setOperatorPin('');
      try {
        await writeAuditLog(
          result.profile.operator_name,
          'เข้าสู่ระบบด้วย Username + PIN',
          'Users', result.profile.user_id, '',
          `Username login verified for ${result.profile.operator_name}`,
          result.profile.auth_email || '',
          result.profile.operator_name
        );
      } catch (auditError) {
        console.warn('[Smart Guard Auth] Audit write skipped:', auditError);
      }
    } catch (err: any) {
      setAuthSessionState('failed');
      const code = String(err?.code || '');
      if (code.includes('invalid-credential') || code.includes('wrong-password')) {
        setLoginError('Username หรือ PIN ไม่ถูกต้อง');
      } else if (code.includes('too-many-requests')) {
        setLoginError('กรอกผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่');
      } else if (err instanceof AuthStageError) {
        setLoginError(err.message);
      } else {
        setLoginError(
          runtimeConfiguration.environmentName === 'STAGING'
            ? stagingAuthMessage('AUTH-11', err)
            : err.message || 'เข้าสู่ระบบไม่สำเร็จ',
        );
      }
    } finally {
      pinLoginInProgressRef.current = false;
      setLoginBusy(false);
    }
  };

  const handleBootstrap = async (event: FormEvent) => {
    event.preventDefault();
    setLoginError(null);
    if (setupStatus !== 'available') return;
    if (!validatePin(bootstrapPin)) return setLoginError('PIN Admin ต้องเป็นตัวเลข 6 หลัก');
    if (bootstrapPin !== bootstrapConfirmPin) return setLoginError('ยืนยัน PIN ไม่ตรงกัน');
    setLoginBusy(true);
    bootstrapInProgressRef.current = true;
    try {
      const result = await bootstrapFirstAdmin(bootstrapPin);
      await applyProfile(result.firebaseUser, result.profile);
      setBootstrapPin('');
      setBootstrapConfirmPin('');
    } catch (err: any) {
      if (String(err?.code || '').includes('email-already-in-use')) {
        setLoginError('บัญชี Admin ถูกสร้างแล้ว กรุณาเข้าสู่ระบบด้วย Username admin');
      } else {
        setLoginError(err.message || 'ตั้งค่า Admin ครั้งแรกไม่สำเร็จ');
      }
    } finally {
      bootstrapInProgressRef.current = false;
      setLoginBusy(false);
    }
  };

  const handleSignOut = () => setIsLogoutModalOpen(true);
  const handleConfirmSignOut = async () => {
    setIsLogoutModalOpen(false);
    try { await signOutSmartGuard(); } catch (err) { console.error(err); }
    setFirebaseUser(null);
    setCurrentProfile(null);
    setGuardName('');
    setUserRole('Guard');
    setAuthSessionState('idle');
    sessionStorage.removeItem('selected_site_id');
    setUsername('');
    setOperatorPin('');
    setLoginError(null);
    setActiveTab('dashboard');
  };

  const [apiTestingStatus, setApiTestingStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [apiTestDetails, setApiTestDetails] = useState<string | null>(null);

  useEffect(() => {
    if (!apiReady) return;
    listSystemSettings(sessionStorage.getItem('selected_site_id') || 'site-01')
      .then(() => {
        setApiTestingStatus('success');
        setApiTestDetails('เชื่อมต่อฐานข้อมูล Firestore สำเร็จ');
      })
      .catch((err: any) => {
        setApiTestingStatus('failed');
        setApiTestDetails(err.message || 'ไม่สามารถติดต่อ Firestore');
      });
  }, [apiReady]);

  const handleTestApi = async () => {
    setApiTestingStatus('testing');
    try {
      await listSystemSettings(sessionStorage.getItem('selected_site_id') || 'site-01');
      setApiTestingStatus('success');
      setApiTestDetails('ฐานข้อมูล Firestore ตอบสนองปกติ');
    } catch (err: any) {
      setApiTestingStatus('failed');
      setApiTestDetails(err.message || 'ไม่สามารถติดต่อ Firestore');
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white">
        <EnvironmentMarker />
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <span className="text-sm font-bold text-slate-300">กำลังตรวจสอบระบบเข้าสู่ระบบ...</span>
      </div>
    );
  }

  if (!currentProfile) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans">
        <EnvironmentMarker />
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(#2563eb_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />
          <div className="relative z-10 flex flex-col gap-6">
            <div className="flex flex-col items-center text-center gap-2">
              <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-[10px] font-black tracking-wider uppercase">USERNAME + PIN / FREE TIER</div>
              <div className="p-4 bg-blue-600/10 text-blue-500 rounded-2xl border border-blue-500/20 mt-2"><Shield className="w-12 h-12" /></div>
              <h1 className="text-xl font-black text-white mt-2">Smart Guard System</h1>
              <p className="text-xs text-slate-400">เข้าสู่ระบบด้วย Username และ PIN 6 หลักที่ Admin ออกให้</p>
            </div>

            {initError && <div className="p-3 bg-red-500/15 border border-red-500/30 text-red-300 rounded-xl text-xs font-bold">{initError}</div>}
            {loginError && <div className="p-3 bg-red-500/15 border border-red-500/30 text-red-300 rounded-xl text-xs font-bold">{loginError}</div>}

            {!isSetupRoute ? (
              <form onSubmit={handleUsernamePinLogin} className="flex flex-col gap-4">
                <div>
                  <label htmlFor="smartguard-username" className="text-xs text-slate-300 font-bold block mb-2">Username</label>
                  <input id="smartguard-username" name="username" autoComplete="username" autoCapitalize="none" value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500"
                    placeholder="เช่น guard01 หรือ admin" />
                </div>
                <div>
                  <label htmlFor="smartguard-pin" className="text-xs text-slate-300 font-bold block mb-2">PIN 6 หลัก</label>
                  <input id="smartguard-pin" name="pin" type="password" inputMode="numeric" autoComplete="current-password"
                    value={operatorPin} onChange={e => setOperatorPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-center tracking-[0.6em] text-xl text-white outline-none focus:border-blue-500"
                    placeholder="••••••" />
                </div>
                <button type="submit" disabled={loginBusy}
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 text-white font-black rounded-xl cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {loginBusy && <Loader2 className="w-4 h-4 animate-spin" />} เข้าสู่ระบบ
                </button>
              </form>
            ) : setupStatus === 'checking' ? (
              <div className="flex flex-col items-center gap-3 py-6 text-slate-300" aria-live="polite">
                <Loader2 className="w-7 h-7 text-blue-500 animate-spin" />
                <span className="text-xs font-bold">กำลังตรวจสอบสถานะการตั้งค่าระบบ...</span>
              </div>
            ) : setupStatus === 'error' ? (
              <div className="p-3 bg-red-500/15 border border-red-500/30 text-red-300 rounded-xl text-xs font-bold">
                ไม่สามารถตรวจสอบสถานะการตั้งค่าระบบได้ กรุณาลองใหม่อีกครั้ง
              </div>
            ) : (
              <form onSubmit={handleBootstrap} className="flex flex-col gap-4">
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 font-bold">
                  ตั้งค่าผู้ดูแลระบบครั้งแรก
                </div>
                <div>
                  <label htmlFor="bootstrap-pin" className="text-xs text-slate-300 font-bold block mb-2">กำหนด PIN Admin 6 หลัก</label>
                  <input id="bootstrap-pin" type="password" inputMode="numeric" value={bootstrapPin}
                    onChange={e => setBootstrapPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-center tracking-[0.6em] text-xl text-white outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label htmlFor="bootstrap-confirm-pin" className="text-xs text-slate-300 font-bold block mb-2">ยืนยัน PIN</label>
                  <input id="bootstrap-confirm-pin" type="password" inputMode="numeric" value={bootstrapConfirmPin}
                    onChange={e => setBootstrapConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-center tracking-[0.6em] text-xl text-white outline-none focus:border-blue-500" />
                </div>
                <button type="submit" disabled={loginBusy}
                  className="w-full py-3.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-700 text-white font-black rounded-xl cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {loginBusy && <Loader2 className="w-4 h-4 animate-spin" />} สร้าง Admin และเริ่มใช้งาน
                </button>
              </form>
            )}
            {!isSetupRoute && <div className="text-[10px] text-slate-500 text-center">ไม่ใช้ Google Login และไม่ต้องแจกบัญชีอีเมลให้พนักงาน</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-800 pb-20 sm:pb-0">
      <EnvironmentMarker />
      
      {/* Top Application Header */}
      <header className="sticky top-0 bg-slate-900 text-white z-40 border-b border-slate-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          
          {/* Logo Brand */}
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-600 rounded-xl">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-sm font-black tracking-tight block">SMART GUARD SYSTEM</span>
              <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                ● ระบบคลาวด์เชื่อมต่อสมบูรณ์
              </span>
            </div>
          </div>

          {/* Quick Roster Profile */}
          <div className="flex items-center gap-4">
            
            {/* Display Active Operator Name & Role */}
            <div className="flex flex-col text-right">
              <span className="text-[10px] text-slate-400 font-bold">ผู้ปฏิบัติหน้าที่ในกะ</span>
              <span className="text-xs font-black text-blue-400">{guardName}</span>
            </div>

            <div className="flex flex-col text-left">
              <span className="text-[10px] text-slate-400 font-bold">บทบาทของคุณ</span>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                  userRole === 'Admin' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                  userRole === 'Manager' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                  userRole === 'ShiftHead' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                  'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                }`}>
                  {userRole}
                </span>
                <button
                  onClick={() => {
                    handleSignOut();
                  }}
                  className="text-[10px] font-black text-amber-400 hover:text-amber-300 underline bg-transparent border-0 cursor-pointer"
                  title="ออกจากผู้ใช้งานปัจจุบัน"
                >
                  ออกจากระบบ
                </button>
              </div>
            </div>

            <button
              onClick={handleSignOut}
              className="p-2 bg-slate-800 hover:bg-red-600/20 text-slate-400 hover:text-red-400 rounded-xl transition-colors cursor-pointer"
              title="ออกจากระบบ"
            >
              <LogOut className="w-4.5 h-4.5" />
            </button>
          </div>

        </div>
      </header>

      {/* Database Status Alert bar */}
      {!apiReady && !apiInitializing && initError && (
        <div className="bg-amber-50 border-b border-amber-200 p-3 text-xs text-amber-800 font-bold flex justify-between items-center px-6">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>⚠️ ไม่สามารถติดต่อ Cloud Firestore ได้เนื่องจากข้อผิดพลาด: {initError}</span>
          </div>
          <button 
            onClick={initFirestoreDatabase}
            className="flex items-center gap-1 px-3 py-1 bg-amber-600 text-white rounded-lg hover:bg-amber-700 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> ลองติดต่อฐานข้อมูลใหม่
          </button>
        </div>
      )}

      {apiInitializing && (
        <div className="bg-blue-50 border-b border-blue-100 p-2 text-xs text-blue-800 font-bold text-center animate-pulse">
          ⏳ ระบบกำลังดึงตารางข้อมูลและเตรียมโครงสร้าง Cloud Firestore อาคารวิจิตรบรรจง โปรดรอสักครู่...
        </div>
      )}

      {/* Main Container Grid */}
      <div className="flex-1 max-w-7xl w-full mx-auto flex">
        
        {/* Desktop Sidebar Navigation */}
        <aside className="hidden lg:flex flex-col w-64 bg-slate-900 border-r border-slate-800 p-5 gap-1 shrink-0">
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 block px-2">เมนูปฏิบัติงาน</span>
          
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full p-3.5 rounded-xl font-bold text-xs flex items-center gap-3 transition-all cursor-pointer ${
              activeTab === 'dashboard' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
            }`}
          >
            <Home className="w-4.5 h-4.5" />
            แดชบอร์ดหลักอาคาร (Dashboard)
          </button>

          <button
            onClick={() => setActiveTab('vehicles')}
            className={`w-full p-3.5 rounded-xl font-bold text-xs flex items-center gap-3 transition-all cursor-pointer ${
              activeTab === 'vehicles' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
            }`}
          >
            <Car className="w-4.5 h-4.5" />
            ลงทะเบียนรถเข้า-ออก (Vehicles)
          </button>

          <button
            onClick={() => setActiveTab('vehicleOperations')}
            className={`w-full p-3.5 rounded-xl font-bold text-xs flex items-center gap-3 transition-all cursor-pointer ${
              activeTab === 'vehicleOperations' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
            }`}
          >
            <RefreshCw className="w-4.5 h-4.5" />
            คิวและวิเคราะห์รถ (Operations)
          </button>

          <button
            onClick={() => setActiveTab('contractors')}
            className={`w-full p-3.5 rounded-xl font-bold text-xs flex items-center gap-3 transition-all cursor-pointer ${
              activeTab === 'contractors' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
            }`}
          >
            <Users className="w-4.5 h-4.5" />
            ลงทะเบียนช่างผู้รับเหมา (Contractor)
          </button>

          <button
            onClick={() => setActiveTab('keys')}
            className={`w-full p-3.5 rounded-xl font-bold text-xs flex items-center gap-3 transition-all cursor-pointer ${
              activeTab === 'keys' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
            }`}
          >
            <Key className="w-4.5 h-4.5" />
            ระบบเบิกคืนกุญแจห้อง (Key Control)
          </button>

          <button
            onClick={() => setActiveTab('patrol')}
            className={`w-full p-3.5 rounded-xl font-bold text-xs flex items-center gap-3 transition-all cursor-pointer ${
              activeTab === 'patrol' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
            }`}
          >
            <MapPin className="w-4.5 h-4.5" />
            บันทึกตรวจตราพิกัดจุด (Patrol Check)
          </button>

          <button
            onClick={() => setActiveTab('incidents')}
            className={`w-full p-3.5 rounded-xl font-bold text-xs flex items-center gap-3 transition-all cursor-pointer ${
              activeTab === 'incidents' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
            }`}
          >
            <AlertTriangle className="w-4.5 h-4.5" />
            แจ้งเหตุการณ์ผิดปกติ (Incident Report)
          </button>

          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-5 mb-2 block px-2">ตรวจสอบย้อนหลัง & ตั้งค่า</span>

          <button
            onClick={() => setActiveTab('history')}
            className={`w-full p-3.5 rounded-xl font-bold text-xs flex items-center gap-3 transition-all cursor-pointer ${
              activeTab === 'history' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
            }`}
          >
            <Search className="w-4.5 h-4.5" />
            สืบค้นบันทึกย้อนหลัง (History)
          </button>

          {['Admin', 'Manager'].includes(userRole) && (
            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full p-3.5 rounded-xl font-bold text-xs flex items-center gap-3 transition-all cursor-pointer ${
                activeTab === 'settings' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
              }`}
            >
              <Settings className="w-4.5 h-4.5" />
              จัดการตั้งค่าข้อมูลระบบ (Master Config)
            </button>
          )}

          {['Admin', 'Manager'].includes(userRole) && (
            <button
              onClick={() => setActiveTab('admin')}
              className={`w-full p-3.5 rounded-xl font-bold text-xs flex items-center gap-3 transition-all cursor-pointer ${
                activeTab === 'admin' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
              }`}
            >
              <Shield className="w-4.5 h-4.5 text-blue-400" />
              แผงควบคุมแอดมิน (Admin Panel)
            </button>
          )}

          {/* Quick Roster name sidebar display */}
          <div className="mt-auto border border-slate-800 bg-slate-950 p-4 rounded-xl flex flex-col gap-1">
            <span className="text-[10px] text-slate-500 font-bold">ชื่อเวร รปภ. ในกะปฏิบัติการ:</span>
            <span className="text-xs font-black text-blue-400">{guardName}</span>
          </div>
        </aside>

        {/* Content View Area */}
        <main className="flex-1 p-4 sm:p-6 overflow-x-hidden">
          <Suspense fallback={<PageFallback />}>
          {activeTab === 'dashboard' && <DebugPage name="Dashboard"><Dashboard onNavigate={setActiveTab} activeRole={userRole} siteId={currentProfile.site_id} /></DebugPage>}
          {activeTab === 'vehicles' && <DebugPage name="VehicleEntryExit"><VehicleEntryExit guardName={guardName} userRole={userRole} /></DebugPage>}
          {activeTab === 'vehicleOperations' && <DebugPage name="VehicleOperations"><VehicleOperations siteId={currentProfile.site_id} operatorName={guardName} role={userRole} onOpenVehicleSession={() => setActiveTab('vehicles')} /></DebugPage>}
          {activeTab === 'contractors' && <DebugPage name="ContractorLogs"><ContractorLogs guardName={guardName} /></DebugPage>}
          {activeTab === 'keys' && <DebugPage name="KeyLogs"><KeyLogs guardName={guardName} /></DebugPage>}
          {activeTab === 'patrol' && <DebugPage name="PatrolLogs"><PatrolLogs guardName={guardName} /></DebugPage>}
          {activeTab === 'incidents' && <DebugPage name="IncidentReports"><IncidentReports guardName={guardName} /></DebugPage>}
          {activeTab === 'history' && <DebugPage name="SearchHistory"><SearchHistory /></DebugPage>}
          {activeTab === 'settings' && ['Admin', 'Manager'].includes(userRole) && <DebugPage name="MasterData"><MasterData /></DebugPage>}
          {activeTab === 'admin' && ['Admin', 'Manager'].includes(userRole) && (
            <DebugPage name="AdminPanel"><AdminPanel 
              currentUser={{ name: guardName, role: userRole }} 
              loginEmail={currentProfile?.auth_email || auth.currentUser?.email || ''}
              authorizationResult={currentProfile ? 'Authorized - Active' : 'Unauthorized'}
            /></DebugPage>
          )}
          </Suspense>
        </main>

      </div>

      {/* Mobile Bottom Navigation Bar (Thumb ergonomic) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 flex justify-around text-white z-40 lg:hidden py-2 px-1">
        
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center gap-1 p-1 text-[10px] font-bold ${
            activeTab === 'dashboard' ? 'text-blue-400' : 'text-slate-400'
          }`}
        >
          <Home className="w-5 h-5" />
          <span>แดชบอร์ด</span>
        </button>

        <button
          onClick={() => setActiveTab('vehicles')}
          className={`flex flex-col items-center gap-1 p-1 text-[10px] font-bold ${
            activeTab === 'vehicles' ? 'text-blue-400' : 'text-slate-400'
          }`}
        >
          <Car className="w-5 h-5" />
          <span>รถยนต์</span>
        </button>

        <button
          onClick={() => setActiveTab('contractors')}
          className={`flex flex-col items-center gap-1 p-1 text-[10px] font-bold ${
            activeTab === 'contractors' ? 'text-blue-400' : 'text-slate-400'
          }`}
        >
          <Users className="w-5 h-5" />
          <span>ช่างรับเหมา</span>
        </button>

        <button
          onClick={() => setActiveTab('keys')}
          className={`flex flex-col items-center gap-1 p-1 text-[10px] font-bold ${
            activeTab === 'keys' ? 'text-blue-400' : 'text-slate-400'
          }`}
        >
          <Key className="w-5 h-5" />
          <span>กุญแจ</span>
        </button>

        <button
          onClick={() => setActiveTab('patrol')}
          className={`flex flex-col items-center gap-1 p-1 text-[10px] font-bold ${
            activeTab === 'patrol' ? 'text-blue-400' : 'text-slate-400'
          }`}
        >
          <MapPin className="w-5 h-5" />
          <span>เดินตรวจ</span>
        </button>

        <button
          onClick={() => setActiveTab('incidents')}
          className={`flex flex-col items-center gap-1 p-1 text-[10px] font-bold ${
            activeTab === 'incidents' ? 'text-blue-400' : 'text-slate-400'
          }`}
        >
          <AlertTriangle className="w-5 h-5" />
          <span>แจ้งเหตุ</span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`flex flex-col items-center gap-1 p-1 text-[10px] font-bold ${
            activeTab === 'history' ? 'text-blue-400' : 'text-slate-400'
          }`}
        >
          <Search className="w-5 h-5" />
          <span>สืบค้น</span>
        </button>

        {['Admin', 'Manager'].includes(userRole) && (
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center gap-1 p-1 text-[10px] font-bold ${
              activeTab === 'settings' ? 'text-blue-400 font-extrabold' : 'text-slate-400'
            }`}
          >
            <Settings className="w-5 h-5" />
            <span>ตั้งค่า</span>
          </button>
        )}

        {['Admin', 'Manager'].includes(userRole) && (
          <button
            onClick={() => setActiveTab('admin')}
            className={`flex flex-col items-center gap-1 p-1 text-[10px] font-bold ${
              activeTab === 'admin' ? 'text-blue-400 font-extrabold' : 'text-slate-400'
            }`}
          >
            <Shield className="w-5 h-5 text-blue-500" />
            <span>แผงแอดมิน</span>
          </button>
        )}

      </nav>

      <ConfirmModal
        isOpen={isLogoutModalOpen}
        title="ยืนยันการออกจากระบบ"
        message="คุณต้องการออกจากระบบบริหารและระวังภัยอัจฉริยะ (Smart Guard System) หรือไม่?"
        confirmText="ออกจากระบบ"
        cancelText="ยกเลิก"
        onConfirm={handleConfirmSignOut}
        onCancel={() => setIsLogoutModalOpen(false)}
      />
    </div>
  );
}
