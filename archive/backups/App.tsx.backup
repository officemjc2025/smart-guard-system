import { useState, useEffect } from 'react';
import { 
  Shield, LogOut, Loader2, Home, Car, Users, Key, 
  MapPin, AlertTriangle, Search, Settings, ShieldCheck,
  Smartphone, User, RefreshCw
} from 'lucide-react';
import { 
  signInWithGoogle,
  handleRedirectResult,
  logout, 
  onAuthStateChange, 
  db
} from './firebase';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { readSheet, appendSheetRow, writeAuditLog } from './googleApi';
import ConfirmModal from './components/ConfirmModal';

console.log('[Smart Guard Build] v3.1.1 Firebase-only build loaded');

// Component Imports
import Dashboard from './components/Dashboard';
import VehicleEntryExit from './components/VehicleEntryExit';
import ContractorLogs from './components/ContractorLogs';
import KeyLogs from './components/KeyLogs';
import PatrolLogs from './components/PatrolLogs';
import IncidentReports from './components/IncidentReports';
import SearchHistory from './components/SearchHistory';
import MasterData from './components/MasterData';
import AdminPanel from './components/AdminPanel';

type TabType = 'dashboard' | 'vehicles' | 'contractors' | 'keys' | 'patrol' | 'incidents' | 'history' | 'settings' | 'admin';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authLoadingMessage, setAuthLoadingMessage] = useState<string>('กำลังตรวจสอบบัญชี Google...');
  const [apiInitializing, setApiInitializing] = useState(false);
  const [apiReady, setApiReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Active view state
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  // Identity States
  const [guardName, setGuardName] = useState('');
  const [userRole, setUserRole] = useState<'Guard' | 'Shift Leader' | 'Manager' | 'Admin'>('Guard');

  // Operators List and selectedOperator state
  const [usersList, setUsersList] = useState<any[]>([]);
  const [operatorsForEmail, setOperatorsForEmail] = useState<any[]>([]);
  const [selectedOperator, setSelectedOperator] = useState<any | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  // Connection Testing States
  const [apiTestingStatus, setApiTestingStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [apiTestDetails, setApiTestDetails] = useState<string | null>(null);

  // Initial diagnostics log when API is ready and authenticated
  useEffect(() => {
    if (!apiReady) return;
    console.log('[Smart Guard Firestore] Initializing App. Checking Firestore database status...');
    
    // Automated ping test to check connection on load
    const runInitialPing = async () => {
      setApiTestingStatus('testing');
      try {
        console.log('[Smart Guard Firestore] Checking connection to cloud database...');
        await readSheet('SystemSettings');
        setApiTestingStatus('success');
        setApiTestDetails('เชื่อมต่อฐานข้อมูล Firestore สำเร็จ! ระบบฐานข้อมูลและ Firebase Storage ของคุณพร้อมใช้งานแล้ว 100%');
      } catch (err: any) {
        console.warn('[Smart Guard Firestore] Health check failed:', err);
        setApiTestingStatus('failed');
        setApiTestDetails(err.message || 'ไม่สามารถติดต่อฐานข้อมูล Cloud Firestore ได้ในกะนี้');
      }
    };
    runInitialPing();
  }, [apiReady]);

  const handleTestApi = async () => {
    setApiTestingStatus('testing');
    setApiTestDetails(null);
    try {
      console.log('[Smart Guard Firestore] Initiating manual Firestore database test...');
      await readSheet('SystemSettings');
      setApiTestingStatus('success');
      setApiTestDetails('ฐานข้อมูล Firestore ตอบสนองปกติ! สามารถบันทึกประวัติ อัปโหลดรูปภาพ และใช้งานระบบได้ทันที');
    } catch (err: any) {
      console.error('[Smart Guard Firestore] Manual check failed:', err);
      setApiTestingStatus('failed');
      setApiTestDetails(err.message || 'ไม่สามารถตอบรับจาก Firebase Firestore ได้สำเร็จ');
    }
  };

  // Track Firebase Authentication State and Redirect
  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | null = null;

    async function runAuthInit() {
      setAuthLoading(true);
      setAuthLoadingMessage('กำลังตรวจสอบบัญชี Google...');

      if (!isMounted) return;

      // Complete a pending redirect first so OAuth errors are surfaced.
      try {
        await handleRedirectResult();
      } catch (error: any) {
        console.error('[Smart Guard Auth] Redirect completion failed:', error);
        if (isMounted) {
          setInitError(`การลงชื่อเข้าใช้ด้วย Google ล้มเหลว: ${error?.message || error}`);
          setAuthLoading(false);
        }
      }

      // Subscribe to Auth State changes
      unsubscribe = onAuthStateChange(async (firebaseUser) => {
        console.log('[Smart Guard API] Auth state changed:', firebaseUser?.email || 'No user');
        if (isMounted) {
          if (firebaseUser) {
            if (firebaseUser.email?.trim().toLowerCase() === 'sandbox@example.com') {
              console.warn('[Smart Guard API] Blocking sandbox user in all environments.');
              setUser(null);
              setAuthLoading(false);
              setInitError('บัญชีจำลอง (Sandbox) ไม่ได้รับอนุญาตในระบบ Smart Guard กรุณาลงชื่อเข้าใช้ด้วยบัญชี Google ที่ได้รับอนุญาต');
              await logout();
              return;
            }
            
            // Clear just_logged_out flag since we have a valid logged in user now
            sessionStorage.removeItem('just_logged_out');
            
            setUser(firebaseUser);
            setAuthLoadingMessage('กำลังตรวจสอบสิทธิ์จาก Users Collection...');
            // Initialize Firestore Database and Storage media store
            await initFirestoreDatabase();
          } else {
            setUser(null);
            setApiReady(false);
            setSelectedOperator(null);
            sessionStorage.removeItem('selected_operator_name');
            sessionStorage.removeItem('selected_login_email');
            sessionStorage.removeItem('selected_user_role');
            setAuthLoading(false);
          }
        }
      });
    }

    runAuthInit();

    return () => {
      isMounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  // Load and check roster against current user email once DB is ready
  useEffect(() => {
    async function checkUserRoster() {
      if (!user || !apiReady) {
        setOperatorsForEmail([]);
        return;
      }

      setUsersLoading(true);
      setAuthLoadingMessage('กำลังตรวจสอบสิทธิ์ด้วย Firestore...');
      try {
        const userEmail = user.email || '';
        console.log('[Smart Guard Auth] Fetching active operator profiles for email:', userEmail);

        // One Google account may map to several operators. Query by normalized login_email
        // instead of assuming the Firestore document id always equals the Firebase Auth UID.
        const normalizedEmail = userEmail.trim().toLowerCase();
        const rosterQuery = query(
          collection(db, 'users'),
          where('login_email', '==', normalizedEmail),
          where('status', '==', 'Active')
        );
        const rosterSnapshot = await getDocs(rosterQuery);
        let matches: any[] = rosterSnapshot.docs.map((snapshot) => ({
          ...snapshot.data(),
          user_id: snapshot.data().user_id || snapshot.id,
          __document_id: snapshot.id
        }));

        if (matches.length === 0) {
          // Auto-bootstrap only the explicitly configured administrator.
          const bootstrapAdminEmail = ((import.meta as any).env?.VITE_BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
          const isBootstrapEmail = Boolean(bootstrapAdminEmail && normalizedEmail === bootstrapAdminEmail);

          if (isBootstrapEmail) {
            console.log('[Smart Guard Auth] No profile found. Auto-bootstrapping Master Admin profile...');
            const userDocRef = doc(db, 'users', user.uid);
            const adminOp = {
              user_id: user.uid,
              login_email: normalizedEmail,
              operator_name: 'แอดมิน สูงสุด (MJC)',
              role: 'Admin' as const,
              shift: 'ทั่วไป',
              phone: '0899999999',
              status: 'Active',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            await setDoc(userDocRef, adminOp);
            matches = [{ ...adminOp, __document_id: user.uid }];

            await writeAuditLog(
              adminOp.operator_name,
              'บูตสแตรปแอดมินระบบเริ่มต้น (System Admin Bootstrap)',
              'Users',
              user.uid,
              '',
              `สร้างสิทธิ์ผู้ดูแลระบบหลักโดยอัตโนมัติสำหรับอีเมล: ${normalizedEmail}`,
              normalizedEmail,
              adminOp.operator_name
            );
          }
        }

        console.log('[Smart Guard Auth] Operator profiles loaded:', matches);
        setOperatorsForEmail(matches);
        sessionStorage.setItem('selected_login_email', userEmail);

        if (matches.length > 0) {
          // Always require explicit operator selection.
          setSelectedOperator(null);
          setGuardName('');
          setUserRole('Guard');
          sessionStorage.removeItem('selected_operator_name');
          sessionStorage.removeItem('selected_user_role');
        }
      } catch (err: any) {
        console.error('[Smart Guard Auth] Verification error:', err);
        setInitError(`สิทธิ์ของบัญชีของคุณล้มเหลว: ${err.message || err}`);
      } finally {
        setUsersLoading(false);
        setAuthLoading(false);
      }
    }

    checkUserRoster();
  }, [user, apiReady]);

  const initFirestoreDatabase = async () => {
    setApiInitializing(true);
    setInitError(null);
    try {
      setApiReady(true);
    } catch (err: any) {
      console.error('Firestore initialization failed:', err);
      setInitError(err.message || 'เกิดความผิดพลาดในการเข้าถึงฐานข้อมูล Cloud Firestore');
    } finally {
      setApiInitializing(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    setAuthLoadingMessage('กำลังนำคุณไปลงชื่อเข้าใช้ด้วย Google...');
    setInitError(null);

    try {
      console.log('[Smart Guard API] login mode: Google OAuth Redirect');
      await signInWithGoogle();
    } catch (err: any) {
      console.error('[Smart Guard API] Google OAuth failed:', err);
      setInitError(`การยืนยันตัวตน Google OAuth ล้มเหลว: ${err.message || err}`);
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    setIsLogoutModalOpen(true);
  };

  const handleConfirmSignOut = async () => {
    setIsLogoutModalOpen(false);
    setSelectedOperator(null);
    sessionStorage.removeItem('selected_operator_name');
    sessionStorage.removeItem('selected_login_email');
    sessionStorage.removeItem('selected_user_role');
    sessionStorage.setItem('just_logged_out', 'true');
    await logout();
  };

  // Loading Screen
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white font-sans">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <span className="text-sm font-bold tracking-wider text-slate-300">{authLoadingMessage}</span>
      </div>
    );
  }

  // Login Screen with Emblem
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 flex flex-col gap-6 shadow-2xl relative overflow-hidden">
          
          {/* Subtle grid light decor */}
          <div className="absolute inset-0 bg-[radial-gradient(#2563eb_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none"></div>

          {/* Shield Emblem & Environment Badge */}
          <div className="flex flex-col items-center text-center gap-2 relative z-10">
            <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-[10px] font-black tracking-wider uppercase mb-1">
              🌐 Google Authentication
            </div>
            
            <div className="p-4 bg-blue-600/10 text-blue-500 rounded-2xl border border-blue-500/20">
              <Shield className="w-12 h-12" />
            </div>
            <h1 className="text-xl font-black text-white tracking-tight mt-3">ระบบ รปภ. อัจฉริยะ Smart Guard</h1>
            <p className="text-xs text-slate-400 font-medium max-w-xs mt-1">
              แอปพลิเคชันบริหารความปลอดภัยและบันทึกผู้ติดต่อ เชื่อมต่อฐานข้อมูล Cloud Firestore & Storage ตรวจสอบย้อนหลังได้ 100%
            </p>
          </div>

          <div className="flex flex-col gap-3 relative z-10 mt-2">
            
            {initError && (
              <div className="p-4 bg-red-500/15 border border-red-500/35 text-red-300 rounded-2xl text-xs font-bold leading-relaxed flex flex-col gap-1.5 whitespace-pre-wrap">
                <span className="flex items-center gap-1.5 text-red-400">⚠️ ข้อผิดพลาดสิทธิ์การเข้าถึง / ข้อแนะนำ:</span>
                <span className="font-medium text-slate-200">{initError}</span>
              </div>
            )}

            <button
              onClick={handleGoogleSignIn}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-500/10 active:scale-98 flex justify-center items-center gap-3 cursor-pointer text-sm font-sans"
            >
              <Smartphone className="w-5 h-5 shrink-0" />
              เชื่อมต่อและลงชื่อเข้าใช้งานด้วย Google
            </button>

            {/* Test API connection panel */}
            <div className="mt-2 p-4 bg-slate-800/30 border border-slate-800/80 rounded-2xl flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-bold">สัญญาณเชื่อมต่อ Cloud Database:</span>
                {apiTestingStatus === 'testing' && <span className="text-amber-400 animate-pulse font-black">กำลังตรวจสอบ...</span>}
                {apiTestingStatus === 'success' && <span className="text-emerald-400 font-black flex items-center gap-1">✓ เชื่อมต่อแล้ว</span>}
                {apiTestingStatus === 'failed' && <span className="text-red-400 font-black flex items-center gap-1">✗ ไม่พบการเชื่อมต่อ</span>}
                {apiTestingStatus === 'idle' && <span className="text-slate-500">ไม่ได้ตรวจสอบ</span>}
              </div>
              
              {apiTestDetails && (
                <p className="text-[10px] text-slate-300 font-mono bg-slate-950/70 border border-slate-800/40 p-2.5 rounded-xl break-all leading-relaxed max-h-24 overflow-y-auto">
                  {apiTestDetails}
                </p>
              )}

              <button
                type="button"
                onClick={handleTestApi}
                disabled={apiTestingStatus === 'testing'}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-200 font-bold rounded-xl text-[10px] transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 font-sans"
              >
                <RefreshCw className={`w-3 h-3 ${apiTestingStatus === 'testing' ? 'animate-spin' : ''}`} />
                กดเพื่อทดสอบ API (Test API Connection)
              </button>
            </div>

          </div>

          <div className="text-center mt-2">
            <span className="text-[10px] text-slate-500 font-mono">
              เวอร์ชันการทำงาน v3.1.1 • ระบบคลาวด์มัลติแพลตฟอร์ม Cloud Firestore
            </span>
          </div>

        </div>
      </div>
    );
  }

  // Operator Selection / Self-Registration Overlay Screen
  if (user && !selectedOperator) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans text-white relative">
        <div className="absolute inset-0 bg-[radial-gradient(#3b82f6_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none"></div>
        
        <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-8 flex flex-col gap-6 shadow-2xl relative z-10">
          <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
            <div className="p-2 bg-blue-500/10 text-blue-400 rounded-xl">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">ยืนยันตัวตนผู้ปฏิบัติการ (Operator Selection)</h2>
              <p className="text-xs text-slate-400 mt-0.5">บัญชีอีเมล: <span className="text-blue-400 font-bold font-mono">{user.email}</span></p>
            </div>
          </div>

          {initError ? (
            <div className="flex flex-col gap-4 text-left">
              <div className="p-5 bg-red-500/15 border border-red-500/35 rounded-2xl text-xs flex flex-col gap-3 leading-relaxed text-red-200">
                <span className="font-bold flex items-center gap-1.5 text-sm text-red-400">
                  ⚠️ การเชื่อมต่อ Cloud Database ล้มเหลว (Database Connection Failed)
                </span>
                <p className="text-slate-300 font-medium">
                  ไม่สามารถเรียกข้อมูลหรือเริ่มต้นฐานข้อมูล Firestore ได้เนื่องจากข้อผิดพลาดด้านล่าง:
                </p>
                <p className="p-3 bg-slate-950/70 border border-slate-800 text-red-400 font-mono rounded-xl break-all whitespace-pre-wrap">
                  {initError}
                </p>
                <div className="text-slate-400 text-[11px] leading-relaxed mt-2 bg-slate-950/30 p-3.5 border border-slate-800 rounded-xl flex flex-col gap-2">
                  <span className="font-black text-slate-300">💡 คำแนะนำสำหรับการแก้ปัญหา:</span>
                  <span>1. ตรวจสอบการเชื่อมต่อเครือข่ายอินเทอร์เน็ตของอุปกรณ์คุณ</span>
                  <span>2. ตรวจสอบสิทธิ์การเข้าถึงข้อมูลของบัญชีของคุณใน Firestore Security Rules</span>
                  <span>3. ตรวจสอบความถูกต้องของคีย์และการตั้งค่า Cloud Project ใน firebase-applet-config.json</span>
                </div>
              </div>
              <button
                onClick={() => {
                  setInitError(null);
                  handleSignOut();
                }}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-500/20 text-sm font-sans cursor-pointer text-center"
              >
                👈 กลับไปยังหน้าเข้าสู่ระบบ Google
              </button>
            </div>
          ) : usersLoading || apiInitializing ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
              <span className="text-xs text-slate-400">กำลังตรวจสอบรายชื่อผู้ใช้งานและโหลดตาราง...</span>
            </div>
          ) : operatorsForEmail.length > 0 ? (
            <div className="flex flex-col gap-4 text-left">
              <p className="text-xs text-slate-300 font-bold">
                พบบัญชีผู้ใช้งาน {operatorsForEmail.length} ท่านที่แชร์บัญชีอีเมลนี้ กรุณาเลือกชื่อของคุณเพื่อเข้ากะเริ่มปฏิบัติงาน:
              </p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                {operatorsForEmail.map((op) => (
                  <button
                    key={op.user_id}
                    onClick={() => {
                      setSelectedOperator(op);
                      setGuardName(op.operator_name);
                      setUserRole(op.role);
                      sessionStorage.setItem('selected_operator_name', op.operator_name);
                      sessionStorage.setItem('selected_user_role', op.role);
                      
                      writeAuditLog(
                        op.operator_name,
                        'ลงชื่อปฏิบัติการกะ (Operator Shift Check-in)',
                        'Authentication',
                        op.user_id,
                        '',
                        `Selected Operator: ${op.operator_name} with role ${op.role}`
                      );
                    }}
                    className="flex flex-col text-left p-4 bg-slate-800/40 hover:bg-slate-800 border border-slate-700/60 hover:border-blue-500 rounded-2xl transition-all cursor-pointer group"
                  >
                    <span className="text-sm font-black text-white group-hover:text-blue-400 transition-colors">{op.operator_name}</span>
                    <span className="text-[10px] text-slate-400 mt-1">เบอร์โทร: {op.phone || '-'}</span>
                    
                    <div className="flex items-center justify-between gap-2 mt-3">
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-black ${
                        op.role === 'Admin' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
                        op.role === 'Manager' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                        op.role === 'Shift Leader' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' :
                        'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}>
                        {op.role}
                      </span>
                      <span className="text-[10px] text-slate-500 font-bold">{op.shift}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            // Access Denied / Unauthorized Screen for unregistered or inactive emails
            <div className="flex flex-col gap-4 text-left">
              <div className="p-5 bg-red-500/15 border border-red-500/35 rounded-2xl text-xs flex flex-col gap-3 leading-relaxed text-red-200 font-sans">
                <span className="font-bold flex items-center gap-1.5 text-sm text-red-400">
                  ⚠️ เข้าสู่ระบบ Google สำเร็จ แต่ไม่พบสิทธิ์ในระบบ (Firestore Users Collection)
                </span>
                <p className="text-slate-300 font-medium leading-relaxed">
                  บัญชีอีเมลของคุณ: <strong className="underline font-mono text-white bg-slate-950 px-2 py-0.5 rounded break-all">{user.email}</strong><br/>
                  UID บัญชีของคุณ: <strong className="underline font-mono text-white bg-slate-950 px-2 py-0.5 rounded break-all">{user.uid}</strong>
                </p>
                <div className="text-slate-400 text-xs mt-2 flex flex-col gap-2">
                  <span className="font-black text-slate-200">📢 คำแนะนำสำหรับแอดมินระบบ (Admin Guide):</span>
                  <p className="bg-slate-950/60 p-3 border border-slate-800 rounded-xl text-slate-300 font-mono text-[11px] leading-relaxed">
                    กรุณาเพิ่ม UID <span className="text-blue-400 font-bold">{user.uid}</span> หรืออีเมลนี้ในคอลเลกชัน <span className="text-emerald-400 font-bold">users</span> และกำหนดสถานะ (status) เป็น <span className="text-emerald-400 font-bold">Active</span> ในฐานข้อมูล เพื่อให้สามารถลงชื่อปฏิบัติงานได้
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-800 pt-4 text-xs">
            <span className="text-slate-500">ไม่ใช่บัญชีอีเมลของคุณ?</span>
            <button
              onClick={handleSignOut}
              className="text-red-400 hover:text-red-300 font-bold flex items-center gap-1 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" /> ออกจากระบบ Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-800 pb-20 sm:pb-0">
      
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
                  userRole === 'Shift Leader' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                  'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                }`}>
                  {userRole}
                </span>
                <button
                  onClick={() => {
                    setSelectedOperator(null);
                    setGuardName('');
                    setUserRole('Guard');
                    setActiveTab('dashboard');
                    sessionStorage.removeItem('selected_operator_name');
                    sessionStorage.removeItem('selected_user_role');
                  }}
                  className="text-[10px] font-black text-amber-400 hover:text-amber-300 underline bg-transparent border-0 cursor-pointer"
                  title="คลิกเพื่อสลับผู้ปฏิบัติงานหรือสิทธิ์ในการเข้าเวร"
                >
                  สลับผู้ใช้
                </button>
              </div>
            </div>

            {user.photoURL && (
              <img 
                src={user.photoURL} 
                alt="Profile" 
                className="w-8 h-8 rounded-full border-2 border-blue-500" 
                referrerPolicy="no-referrer"
              />
            )}

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
          {activeTab === 'dashboard' && <Dashboard onNavigate={(tab) => setActiveTab(tab as any)} activeRole={userRole} />}
          {activeTab === 'vehicles' && <VehicleEntryExit guardName={guardName} />}
          {activeTab === 'contractors' && <ContractorLogs guardName={guardName} />}
          {activeTab === 'keys' && <KeyLogs guardName={guardName} />}
          {activeTab === 'patrol' && <PatrolLogs guardName={guardName} />}
          {activeTab === 'incidents' && <IncidentReports guardName={guardName} />}
          {activeTab === 'history' && <SearchHistory />}
          {activeTab === 'settings' && ['Admin', 'Manager'].includes(userRole) && <MasterData />}
          {activeTab === 'admin' && ['Admin', 'Manager'].includes(userRole) && (
            <AdminPanel 
              currentUser={{ name: guardName, role: userRole }} 
              loginEmail={user?.email || ''}
              authorizationResult={selectedOperator ? 'Authorized - Active' : 'Unauthorized'}
            />
          )}
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
