# Smart Guard AI Work Rules

Project: Smart Guard System V4  
Repository: officemjc2025/smart-guard-system  
Branch: migration/securityprojectv1  
Firebase Project: securityprojectv1  
Primary UI Language: Thai

## Source of Truth
- ใช้ Source Code ปัจจุบันใน Repository เป็นหลัก
- หากข้อมูลในแชทขัดกับ Repository ให้ยึด Repository
- ห้ามสร้างโปรเจกต์ใหม่หรือระบบคู่ขนาน
- ห้ามแทนที่โค้ดเดิมทั้งโปรเจกต์

## Architecture
- ใช้ Firebase Authentication, Cloud Firestore และ Firebase Storage
- ใช้ Firestore default database
- ห้ามใช้ Google Sheets หรือ Apps Script เป็น Backend
- เตรียม Google Drive สำหรับ Media Archive/Backup ผ่าน Backend เท่านั้น
- ห้ามให้ Client เข้าถึง Google Drive โดยตรง

## Authentication and Security
- Google Sign-In เท่านั้น
- สิทธิ์ผู้ใช้มาจาก Firestore users/operators
- ห้ามสร้าง Demo User, Fast-Pass Login, Mock Login หรือ Auth Bypass
- ห้าม Auto Seed ข้อมูลใน Production
- ห้าม Deploy หรือแก้ Production Data หากไม่ได้รับคำสั่งชัดเจน
- ห้ามแสดง UID, Email หรือ raw Firebase error ต่อผู้ใช้ปลายทาง

## Thai UI
- UI สำหรับผู้ใช้งานต้องเป็นภาษาไทยเป็นหลัก
- English ใช้เฉพาะคำเทคนิคในวงเล็บ ชื่อ Field, Document ID และ Developer Diagnostics
- ห้ามสร้างชื่อ รปภ. ผู้ดูแล สถานที่ หรือข้อมูลทดสอบภาษาอังกฤษขึ้นเอง
- รักษา Mobile-first UX สำหรับ รปภ. ไทย

## Change Scope
- แก้เฉพาะงานและไฟล์ที่ระบุ
- ห้ามเปลี่ยน UI, Schema, Rules, Storage Path หรือ Authentication Flow โดยไม่ได้รับอนุมัติ
- ห้ามเพิ่ม Dependency โดยไม่จำเป็น
- ห้ามใช้ npm audit fix --force
- ทำงานแบบ Incremental หนึ่งเป้าหมายต่อหนึ่งรอบ

## Quality Gate
- รักษา TypeScript ให้ Build ผ่าน
- หลีกเลี่ยง any ในโค้ดใหม่
- ห้าม duplicate Firebase initialization
- ห้าม hard-code Firebase config หรือ Secret
- ต้องรัน npm run build หลังแก้
- ถ้ามี lint script ให้รันเฉพาะเมื่อเกี่ยวข้องกับงาน

## Response Format
ตอบสั้นและเฉพาะ:
1. ไฟล์ที่แก้
2. สิ่งที่เปลี่ยน ไม่เกิน 5 บรรทัด
3. ผล npm run build
4. สิ่งที่ยังไม่ได้ทำ
5. ยืนยันว่าไม่ได้ Deploy และไม่ได้แก้ Production Data
