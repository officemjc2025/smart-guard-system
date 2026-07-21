SMART GUARD AUTH v4.0.1 — USERNAME + PIN (FIREBASE EMAIL/PASSWORD)

สิ่งที่ต้องเปิดใน Firebase Console
1) Authentication > Sign-in method
2) Email/Password = Enabled
3) Google = Disabled
4) Anonymous = Disabled

แทนที่ไฟล์
- src/App.tsx
- src/firebase.ts
- src/components/AdminPanel.tsx
- firestore.rules

ตรวจเวอร์ชัน
  grep -n "Smart Guard Build" src/App.tsx
ต้องเห็น
  v4.0.1 email-password username-pin loaded

Build และ Deploy
  npm run build
  npx firebase-tools deploy --only firestore:rules
  npx firebase-tools deploy --only hosting

การเริ่มระบบครั้งแรก
1) เปิดเว็บใน Incognito
2) เปิดเส้นทาง `/setup` โดยตรง (เส้นทางนี้ใช้ได้เฉพาะก่อนระบบถูกตั้งค่า)
3) ตั้ง PIN Admin เป็นตัวเลข 6 หลัก
4) เมื่อเข้าได้ ให้ไป Admin Panel > พนักงาน
5) สร้าง Username และ PIN 6 หลักให้พนักงานแต่ละคน

หมายเหตุสำคัญ
- ผู้ใช้เห็นเฉพาะ Username + PIN ไม่เห็นอีเมลภายใน
- Admin เท่านั้นสร้างบัญชี รีเซ็ต PIN เปิด/ปิดบัญชีได้
- การรีเซ็ต PIN แบบ Free Tier จะสร้าง Firebase Auth UID ใหม่และปิด profile UID เดิม
  บัญชี Auth เดิมจะเหลือเป็น orphan ใน Firebase Authentication แต่ไม่มีสิทธิ์เข้าถึง Firestore
- Username ไม่ควรเปลี่ยนภายหลัง หากต้องการเปลี่ยนให้สร้างบัญชีใหม่


PATCH v4.0.1:
- หน้า Login ไม่อ่าน Firestore ก่อน Firebase Auth แล้ว
- แก้ Missing or insufficient permissions ที่แสดงทันทีเมื่อเปิดเว็บ
- หน้า Login แสดงเฉพาะ Username และ PIN; การตั้งค่า Admin ครั้งแรกอยู่ที่ `/setup` และจะถูกปิดหลังระบบเริ่มใช้งาน
