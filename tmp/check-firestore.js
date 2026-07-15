const admin = require('firebase-admin');

async function main() {
  admin.initializeApp({
    projectId: 'ai-studio-smartguardsystem-e2a4586d-b4ef-4694-9036-1c64c9967e71'
  });

  const db = admin.firestore();

  console.log("Fetching collections...");
  const collections = await db.listCollections();
  console.log(`Found ${collections.length} collections:`);
  for (const col of collections) {
    console.log(`- Collection ID: ${col.id}`);
    const snapshot = await col.limit(5).get();
    console.log(`  Documents count: ${snapshot.size}`);
    snapshot.forEach(doc => {
      console.log(`  - Document ID: ${doc.id}`);
      console.log(`    Data:`, JSON.stringify(doc.data()).substring(0, 500));
    });
  }
}

main().catch(console.error);
