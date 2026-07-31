# SPR-017 Risk Report

| Risk | Severity | Status | Treatment |
|---|---|---|---|
| Staging project is on Spark plan | Critical operational | BLOCKED | Upgrade staging to Blaze before Functions/Secret Manager |
| Firestore and Functions APIs disabled | High | BLOCKED | Enable APIs only in staging |
| Missing OAuth secrets | High | BLOCKED | Create staging-only OAuth credentials and store in Secret Manager |
| Missing Measurement ID | Medium | BLOCKED | Enable staging Analytics or document approved omission |
| Java unavailable | Medium | BLOCKED | Install supported JDK and rerun rules tests |
| gcloud unavailable | Medium | BLOCKED | Install Google Cloud SDK for API/IAM automation |
| Hosting returns 404 | Medium | BLOCKED | Deploy only after predeploy gate passes |
| Runtime moderate dependencies | Medium | ACCEPTED TEMPORARILY | Major-upgrade branch plus staging E2E |
| Large Firebase bundle | Low | WARNING | Route-level SDK splitting |
