#!/usr/bin/env python3
from pathlib import Path
import re
import sys

path = Path("src/App.tsx")
if not path.exists():
    sys.exit("ไม่พบไฟล์ src/App.tsx — กรุณารันคำสั่งนี้จากโฟลเดอร์โปรเจกต์ smart-guard-system")

text = path.read_text(encoding="utf-8")
original = text

def replace_once(pattern: str, replacement: str, label: str, flags: int = 0) -> None:
    global text
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        sys.exit(f"หยุดเพื่อความปลอดภัย: หาโค้ดส่วน '{label}' ไม่พบหรือพบมากกว่า 1 จุด")
    text = updated

# 1) Remove unused imports that can fail strict builds.
text = text.replace(
    "  Smartphone, User, RefreshCw\n",
    "  Smartphone, RefreshCw\n",
)
text = text.replace(
    "import { readSheet, appendSheetRow, writeAuditLog } from './googleApi';",
    "import { readSheet, writeAuditLog } from './googleApi';",
)

# 2) Never initialize identity from stale browser session and never default to Admin.
replace_once(
    r"""  // Identity States
  const \[guardName, setGuardName\] = useState\(\(\) => sessionStorage\.getItem\('selected_operator_name'\) \|\| 'แอดมิน สูงสุด'\);
  const \[userRole, setUserRole\] = useState<'Guard' \| 'Shift Leader' \| 'Manager' \| 'Admin'>\(\(\) => \{
    return \(sessionStorage\.getItem\('selected_user_role'\) as any\) \|\| 'Admin';
  \}\);""",
    """  // Identity States: fail closed until an active operator is selected.
  const [guardName, setGuardName] = useState('');
  const [userRole, setUserRole] = useState<'Guard' | 'Shift Leader' | 'Manager' | 'Admin'>('Guard');""",
    "Identity States",
)

# 3) Remove unused usersList state.
text = re.sub(
    r"\n  const \[usersList, setUsersList\] = useState<any\[\]>\(\[\]\);",
    "",
    text,
    count=1,
)

# 4) When Firebase reports a valid Google user, clear any operator inherited
#    from the previous Google account before loading the new roster.
replace_once(
    r"""            // Clear just_logged_out flag since we have a valid logged in user now
            sessionStorage\.removeItem\('just_logged_out'\);

            setUser\(firebaseUser\);""",
    """            // Clear previous browser identity before loading this Google account.
            sessionStorage.removeItem('just_logged_out');
            setSelectedOperator(null);
            setGuardName('');
            setUserRole('Guard');
            setActiveTab('dashboard');
            setOperatorsForEmail([]);
            sessionStorage.removeItem('selected_operator_name');
            sessionStorage.removeItem('selected_user_role');
            sessionStorage.removeItem('selected_login_email');

            setUser(firebaseUser);""",
    "clear stale operator on Google login",
)

# 5) Replace highest-role-per-email logic. The effective role must come only
#    from the operator button that the person selects.
replace_once(
    r"""        if \(matches\.length > 0\) \{
          // Determine the effective role from the highest role assigned to the current login_email
          const ROLE_PRIORITY: Record<string, number> = \{
            'Admin': 4,
            'Manager': 3,
            'Shift Leader': 2,
            'Guard': 1
          \};
          let highestRole: 'Guard' \| 'Shift Leader' \| 'Manager' \| 'Admin' = 'Guard';
          let maxPriority = 0;
          matches\.forEach\(\(m: any\) => \{
            const role = m\.role \|\| 'Guard';
            const priority = ROLE_PRIORITY\[role\] \|\| 1;
            if \(priority > maxPriority\) \{
              maxPriority = priority;
              highestRole = role;
            \}
          \}\);

          setUserRole\(highestRole\);
          sessionStorage\.setItem\('selected_user_role', highestRole\);

          // ทุกครั้งที่เข้าสู่ระบบ ให้ผู้ใช้งานเลือกชื่อผู้ปฏิบัติงานด้วยตนเอง
// ห้ามเลือกอัตโนมัติ แม้บัญชีอีเมลนั้นจะมี Operator เพียงคนเดียว
setSelectedOperator\(null\);
setGuardName\(''\);
sessionStorage\.removeItem\('selected_operator_name'\);
        \} else \{
          setSelectedOperator\(null\);
        \}""",
    """        // Every Google login must select an operator manually.
        // Do not grant the highest role shared by the email.
        setSelectedOperator(null);
        setGuardName('');
        setUserRole('Guard');
        setActiveTab('dashboard');
        sessionStorage.removeItem('selected_operator_name');
        sessionStorage.removeItem('selected_user_role');""",
    "remove highest role and auto identity",
    flags=re.MULTILINE,
)

# 6) Normalize selected_login_email.
text = text.replace(
    "sessionStorage.setItem('selected_login_email', userEmail);",
    "sessionStorage.setItem('selected_login_email', normalizedEmail);",
)

# 7) Harden operator selection. It must belong to the signed-in Google email,
#    remain Active, and contain a supported role.
replace_once(
    r"""                    onClick=\{\(\) => \{
                      setSelectedOperator\(op\);
                      setGuardName\(op\.operator_name\);
                      setUserRole\(op\.role\);
                      sessionStorage\.setItem\('selected_operator_name', op\.operator_name\);
                      sessionStorage\.setItem\('selected_user_role', op\.role\);

                      writeAuditLog\(
                        op\.operator_name,
                        'ลงชื่อปฏิบัติการกะ \(Operator Shift Check-in\)',
                        'Authentication',
                        op\.user_id,
                        '',
                        `Selected Operator: \$\{op\.operator_name\} with role \$\{op\.role\}`
                      \);
                    \}\}""",
    """                    onClick={() => {
                      const signedInEmail = (user?.email || '').trim().toLowerCase();
                      const operatorEmail = (op.login_email || '').trim().toLowerCase();
                      const allowedRoles = ['Guard', 'Shift Leader', 'Manager', 'Admin'];

                      if (
                        operatorEmail !== signedInEmail ||
                        op.status !== 'Active' ||
                        !allowedRoles.includes(op.role)
                      ) {
                        setInitError('ไม่สามารถเลือกผู้ใช้นี้ได้ เนื่องจากอีเมล สถานะ หรือบทบาทไม่ถูกต้อง');
                        return;
                      }

                      setSelectedOperator(op);
                      setGuardName(op.operator_name);
                      setUserRole(op.role);
                      setActiveTab('dashboard');
                      sessionStorage.setItem('selected_operator_name', op.operator_name);
                      sessionStorage.setItem('selected_user_role', op.role);

                      void writeAuditLog(
                        op.operator_name,
                        'ลงชื่อปฏิบัติการกะ (Operator Shift Check-in)',
                        'Authentication',
                        op.user_id,
                        '',
                        `Selected Operator: ${op.operator_name} with role ${op.role}`,
                        signedInEmail,
                        op.operator_name
                      ).catch((auditError: any) => {
                        console.warn('[Smart Guard Audit] Operator selection audit failed:', auditError);
                      });
                    }}""",
    "operator selection",
    flags=re.MULTILINE,
)

# 8) Reset all effective identity data when switching operator.
replace_once(
    r"""                  onClick=\{\(\) => \{
                    setSelectedOperator\(null\);
                    sessionStorage\.removeItem\('selected_operator_name'\);
                  \}\}""",
    """                  onClick={() => {
                    setSelectedOperator(null);
                    setGuardName('');
                    setUserRole('Guard');
                    setActiveTab('dashboard');
                    sessionStorage.removeItem('selected_operator_name');
                    sessionStorage.removeItem('selected_user_role');
                  }}""",
    "switch operator button",
)

# 9) Reset complete state before Firebase logout.
replace_once(
    r"""  const handleConfirmSignOut = async \(\) => \{
    setIsLogoutModalOpen\(false\);
    setSelectedOperator\(null\);
    sessionStorage\.removeItem\('selected_operator_name'\);
    sessionStorage\.removeItem\('selected_login_email'\);
    sessionStorage\.removeItem\('selected_user_role'\);
    sessionStorage\.setItem\('just_logged_out', 'true'\);
    await logout\(\);
  \};""",
    """  const handleConfirmSignOut = async () => {
    setIsLogoutModalOpen(false);
    setSelectedOperator(null);
    setOperatorsForEmail([]);
    setGuardName('');
    setUserRole('Guard');
    setActiveTab('dashboard');
    setApiReady(false);
    sessionStorage.removeItem('selected_operator_name');
    sessionStorage.removeItem('selected_login_email');
    sessionStorage.removeItem('selected_user_role');
    sessionStorage.setItem('just_logged_out', 'true');

    try {
      await logout();
    } catch (err: any) {
      console.error('[Smart Guard Auth] Logout failed:', err);
      setInitError(`ออกจากระบบไม่สำเร็จ: ${err?.message || err}`);
    }
  };""",
    "complete logout reset",
)

# 10) The operator-selection screen returns before the page-level ConfirmModal,
#     so its logout buttons must log out directly instead of opening an invisible modal.
#     Only replace occurrences before the main application return.
marker = "\n  return (\n    <div className=\"min-h-screen bg-slate-50"
before, sep, after = text.partition(marker)
if not sep:
    sys.exit("หยุดเพื่อความปลอดภัย: ไม่พบจุดเริ่มหน้าหลัก")
before = before.replace(
    "onClick={handleSignOut}",
    "onClick={() => void handleConfirmSignOut()}",
)
text = before + sep + after

# 11) Increment visible build identifier.
text = text.replace(
    "[Smart Guard Build] v3.1.1 Firebase-only build loaded",
    "[Smart Guard Build] v3.1.2 operator-selection fix loaded",
)
text = text.replace(
    "เวอร์ชันการทำงาน v3.1.1",
    "เวอร์ชันการทำงาน v3.1.2",
)

if text == original:
    sys.exit("ไม่มีการเปลี่ยนแปลงใด ๆ")

backup = path.with_suffix(".tsx.before-operator-fix")
backup.write_text(original, encoding="utf-8")
path.write_text(text, encoding="utf-8")

print("แก้ไข src/App.tsx สำเร็จ")
print(f"สำรองไฟล์เดิมไว้ที่: {backup}")
print("ขั้นต่อไปให้รัน: npm run build")
