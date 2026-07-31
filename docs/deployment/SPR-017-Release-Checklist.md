# SPR-017 Release Checklist

- [x] Active CLI target is staging
- [x] Production refusal guards implemented
- [x] Environment bootstrap implemented
- [x] Environment validator implemented
- [x] Health command implemented
- [x] Synthetic seed dry-run/apply/rollback implemented
- [x] Backup and rollback guards implemented
- [x] Local application and Functions builds pass
- [x] Unit tests pass
- [x] Runtime audits contain zero High findings
- [ ] Blaze billing enabled for staging
- [ ] Required Google Cloud APIs enabled
- [ ] Firestore Standard database created in `asia-southeast3`
- [ ] Email/Password Authentication enabled and verified
- [ ] Staging Measurement ID configured
- [ ] Drive OAuth secrets configured
- [ ] Java installed and Rules Emulator tests pass
- [ ] Functions, Rules, indexes and Hosting deployed to staging
- [ ] Indexes Ready
- [ ] Health check passes
- [ ] Smoke/E2E scenarios pass
- [ ] Drive upload/read/delete passes
- [ ] Backup and rollback drill passes
- [ ] Explicit Production deployment approval received

Decision: **NO-GO – unresolved release blockers remain.**
