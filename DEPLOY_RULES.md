# Smart Guard System - Rules Deployment Manual

This guide provides step-by-step instructions for deploying and verifying **Firestore Security Rules** and **Firebase Storage Security Rules** manually on macOS.

---

## 1. Firebase CLI Installation
If you do not have the Firebase CLI installed on your macOS system, install it using **npm** or **Homebrew**:

### Option A: Install via npm (Node.js required)
```bash
npm install -g firebase-tools
```

### Option B: Install via Homebrew
```bash
brew install firebase-cli
```

---

## 2. Authentication & Login
Log in to your Google Account that has permissions to manage the **Smart Guard System** Firebase project:
```bash
firebase login
```
*(This will open a browser window to complete the secure OAuth sign-in flow.)*

---

## 3. Project Configuration & Selection
Set your active Firebase project context to the project used by the application (`amped-impulse-cdw25`):
```bash
firebase use amped-impulse-cdw25
```

---

## 4. Deploying Security Rules

### Deploy Firestore Rules Only
To deploy the Firestore security rules specified in `firestore.rules`:
```bash
firebase deploy --only firestore:rules
```

### Deploy Storage Rules Only
To deploy the Cloud Storage security rules specified in `storage.rules`:
```bash
firebase deploy --only storage
```

### Deploy Both Simultaneously
To deploy both rule sets in a single command:
```bash
firebase deploy --only firestore:rules,storage
```

---

## 5. Deployment Verification

After deployment, verify that rules are enforced correctly.

### Admin/Manager Roles
* Users logged in as `office.mjc2025@gmail.com` (Admin/Manager) can perform all read/write/delete operations.

### Guard Role (e.g., `mjc.security01@gmail.com`)
* **Create Vehicle Entry Log**: Guards can write to `/vehicleLogs/{logId}` if `status` is set to `'กำลังจอด'`.
* **Update Vehicle Exit Log**: Guards can update only specific fields (e.g., `status` to `'ออกแล้ว'`, exit plate and vehicle images, exit time, etc.). Deletions are forbidden.
* **Storage Uploads**: Guards can write files to storage folders (e.g. `vehicle-logs/`, `contractor-logs/`, etc.) provided they are images under 2MB.

---

## 6. Configured Project Details
* **Firebase Project ID**: `amped-impulse-cdw25`
* **Firestore Database ID**: `ai-studio-smartguardsystem-e2a4586d-b4ef-4694-9036-1c64c9967e71`
* **Firebase Storage Bucket**: `amped-impulse-cdw25.firebasestorage.app`
