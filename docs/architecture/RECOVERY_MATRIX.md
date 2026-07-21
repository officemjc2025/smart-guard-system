# Recovery matrix

| Area | Decision | Rationale |
|---|---|---|
| Units search | Recover concept, refactor implementation | New `useUnits` and `UnitSearchSelect` use current Firebase auth/rules and never use ZIP mock persistence. |
| Units import | Recover concept, refactor implementation | `unitImportService` provides Excel/CSV preview, validation, duplicate detection, diff, non-destructive create/update commit, and commit hooks. No replace/delete mode exists. |
| Vehicle / Contractor / Keys / Incident | Refactor | Existing room text is preserved; optional Unit references are added without changing current media upload or audit patterns. |
| Patrol | Keep current | ZIP workflow would alter incident/patrol semantics and is outside the recovery foundation. |
| Dashboard / routing | Keep current | Current TabType navigation is retained. |
| Authentication | Keep current | Username + PIN remains authoritative; ZIP Google login is retired. |
| Media | Keep current | Current Storage + mediaQueueService remains authoritative; ZIP localStorage media service is retired. |
| Firestore rules | Keep current | Current active-user/Admin controls remain; ZIP all-authenticated read/write rule is retired. |
| Mock API / legacy API client | Retire | No localStorage/mock persistence is introduced. |
