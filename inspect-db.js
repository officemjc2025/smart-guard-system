import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

async function main() {
  try {
    const app = initializeApp({
      projectId: "amped-impulse-cdw25"
    });
    
    const customDb = getFirestore(app, "ai-studio-smartguardsystem-e2a4586d-b4ef-4694-9036-1c64c9967e71");
    
    console.log("--- Inspecting User ---");
    const userDocRef = customDb.collection('users').doc('qctgasVxGbWboRJfS9J8DVgR6B32');
    const userSnap = await userDocRef.get();
    if (userSnap.exists) {
      console.log("User doc found:", JSON.stringify(userSnap.data(), null, 2));
    } else {
      console.log("User doc NOT found for qctgasVxGbWboRJfS9J8DVgR6B32");
    }
    
    console.log("--- Inspecting Units Collection ---");
    const unitsCol = customDb.collection('units');
    const unitsSnap = await unitsCol.limit(10).get();
    console.log(`Found ${unitsSnap.size} units in units collection.`);
    unitsSnap.forEach(doc => {
      console.log(`Document ID: ${doc.id} =>`, JSON.stringify(doc.data(), null, 2));
    });

  } catch (err) {
    console.error("Error in inspect-db:", err);
  }
}

main();
