# Smart Guard v3.3.0 — Username + PIN (Free Tier)

## สิ่งที่เปลี่ยน
- ยกเลิก Google Sign-In สำหรับการใช้งานปกติ
- ยกเลิกการแชร์รหัสผ่าน Gmail
- ผู้ใช้กรอก `Username` + `PIN` ที่ Admin กำหนด
- ใช้ Firebase Anonymous Authentication เป็น session transport แบบไม่มีค่าใช้จ่าย
- PIN เดิม 4–6 หลักยังใช้ต่อได้

## Username เริ่มต้นสำหรับข้อมูลเดิม
- บัญชี Role = Admin ใช้ `admin`
- พนักงานเดิมใช้ `user_id` ตัวพิมพ์เล็ก เช่น `U1234` ใช้ `u1234`
- หลังเข้า Admin Panel ให้กด `กำหนด Username` เพื่อเปลี่ยนเป็นชื่อจำง่าย เช่น `guard01`

## เปิด Anonymous Authentication ก่อน Deploy
Firebase Console → Authentication → Sign-in method → Anonymous → Enable

## วางไฟล์
- `src/App.tsx`
- `src/firebase.ts`
- `src/components/AdminPanel.tsx`
- `firestore.rules`

## Deploy
```bash
npm run build
npx firebase-tools deploy --only firestore:rules
npx firebase-tools deploy --only hosting
```

## ข้อจำกัดที่ยอมรับในโหมดฟรี
สิทธิ์ Admin/Manager ถูกควบคุมโดยตัวแอปเป็นหลัก ไม่ใช่ Custom Claims จาก backend ดังนั้นโหมดนี้เหมาะกับระบบภายในขนาดเล็กและผู้ใช้ที่ได้รับความไว้วางใจ ไม่เหมาะกับระบบสาธารณะหรือข้อมูลความลับสูง
