import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  writeBatch,
  QueryConstraint,
  DocumentReference,
  DocumentData
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { AuthenticatedSession, MigrationStats, MigrationResult } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const projectId = (import.meta as any).env.VITE_FIRESTORE_DATABASE_ID || 'ai-studio-smartguardsystem-e2a4586d-b4ef-4694-9036-1c64c9967e71';

const firebaseConfig = {
  apiKey: 'AIzaSyBW-9nbaMw6pbzjXjJ6szzj66XXQl0iaAM', // fallback from GEMINI_API_KEY
  authDomain: `${projectId}.firebaseapp.com`,
  projectId: projectId,
  storageBucket: `${projectId}.appspot.com`,
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);


// 5. Helper function for site-scoped queries
export function buildSiteScopedQuery(
  collectionName: string,
  session: AuthenticatedSession,
  constraints: QueryConstraint[] = []
) {
  const colRef = collection(db, collectionName);
  
  if (session.role === 'admin') {
    // Admin can read all data from all sites, and can filter by custom constraints
    return query(colRef, ...constraints);
  } else {
    // Non-Admin must be strictly isolated to their own siteId
    return query(colRef, where('site_id', '==', session.siteId), ...constraints);
  }
}

// Helper to inject all audit fields when creating a transaction
export async function createTransactionDoc<T extends object>(
  collectionName: string,
  session: AuthenticatedSession,
  data: T
) {
  const colRef = collection(db, collectionName);
  const now = new Date().toISOString();
  
  const record = {
    ...data,
    site_id: session.siteId,
    account_uid: session.uid,
    login_email: session.email,
    operator_id: session.operatorId,
    operator_name: session.operatorName,
    role: session.role,
    recorded_by: session.recorded_by || session.operatorName,
    created_at: now,
  };

  const docRef = await addDoc(colRef, record);
  return { id: docRef.id, ...record };
}

// 8 & 9. Admin-only Legacy Migration Tool function
export async function runLegacyMigration(
  session: AuthenticatedSession,
  dryRun: boolean = true
): Promise<MigrationResult> {
  if (session.role !== 'admin') {
    throw new Error('Unauthorized: Only administrators can run migrations.');
  }

  const collectionsToMigrate = [
    'vehicleLogs',
    'contractorLogs',
    'keyLogs',
    'patrolLogs',
    'incidentReports',
    'auditLogs',
    'dailyReports'
  ];

  const stats: Record<string, MigrationStats> = {};
  const logs: string[] = [];
  logs.push(`Starting legacy migration. Mode: ${dryRun ? 'DRY-RUN' : 'COMMIT (REAL WRITE)'}`);
  
  for (const colName of collectionsToMigrate) {
    stats[colName] = { scanned: 0, updated: 0, skipped: 0, failed: 0 };
    
    try {
      logs.push(`Scanning collection: ${colName}...`);
      const colRef = collection(db, colName);
      const snapshot = await getDocs(colRef);
      
      stats[colName].scanned = snapshot.size;
      
      const docsToUpdate: Array<{ id: string; ref: DocumentReference<DocumentData>; data: DocumentData }> = [];
      
      snapshot.forEach((document) => {
        const data = document.data();
        if (!data.site_id) {
          docsToUpdate.push({
            id: document.id,
            ref: document.ref as DocumentReference<DocumentData>,
            data: data
          });
        } else {
          stats[colName].skipped++;
        }
      });
      
      logs.push(`Found ${docsToUpdate.length} documents in ${colName} without site_id.`);
      
      if (docsToUpdate.length === 0) {
        continue;
      }

      if (dryRun) {
        stats[colName].updated = docsToUpdate.length;
        logs.push(`[Dry-run] Would update ${docsToUpdate.length} documents in ${colName} with site_id = 'site-01'`);
      } else {
        // Run updates in batches of 400
        const batchSize = 400;
        let batch = writeBatch(db);
        let countInBatch = 0;
        
        for (let i = 0; i < docsToUpdate.length; i++) {
          const docItem = docsToUpdate[i];
          
          batch.update(docItem.ref, { site_id: 'site-01' });
          countInBatch++;
          
          if (countInBatch === batchSize || i === docsToUpdate.length - 1) {
            logs.push(`Committing batch of ${countInBatch} updates for ${colName}...`);
            await batch.commit();
            stats[colName].updated += countInBatch;
            
            // reset batch
            if (i < docsToUpdate.length - 1) {
              batch = writeBatch(db);
              countInBatch = 0;
            }
          }
        }
        logs.push(`Successfully updated ${stats[colName].updated} documents in ${colName}.`);
      }
    } catch (error: unknown) {
      stats[colName].failed = stats[colName].scanned - stats[colName].skipped - stats[colName].updated;
      const errorMsg = error instanceof Error ? error.message : String(error);
      logs.push(`Error migrating collection ${colName}: ${errorMsg}`);
      if (process.env.NODE_ENV !== 'production') {
        console.error(`Migration error on ${colName}:`, error);
      }
    }
  }

  logs.push('Migration scan/operation complete.');

  let auditLogId = undefined;
  if (!dryRun) {
    // Save audit log of migration
    try {
      const summaryLog = await createTransactionDoc('auditLogs', session, {
        action: 'Migration',
        details: JSON.stringify({
          message: 'Completed legacy site_id migration to site-01',
          stats: stats,
          timestamp: new Date().toISOString()
        })
      });
      auditLogId = summaryLog.id;
      logs.push(`Audit log recorded. ID: ${auditLogId}`);
    } catch (auditErr: unknown) {
      const auditErrMsg = auditErr instanceof Error ? auditErr.message : String(auditErr);
      logs.push(`Warning: Failed to write audit log document: ${auditErrMsg}`);
    }
  }

  return {
    stats,
    auditLogId,
    logs
  };
}
