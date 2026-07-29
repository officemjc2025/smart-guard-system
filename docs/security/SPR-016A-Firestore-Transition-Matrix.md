# SPR-016A Firestore Transition Matrix

All cases require an Active account and matching `site_id` unless explicitly
testing denial. ShiftHead maps to the stored role `Shift Leader`.

| Test ID | Role | Initial → target | Operation | Ownership | Expected |
|---|---|---|---|---|---|
| RULE-01 | Guard | Waiting → Assigned | Take Job | Unassigned | Allow |
| RULE-02 | Guard | Assigned → Waiting | Release | Current owner | Allow |
| RULE-03 | Guard | Assigned → Assigned | Take owned by other Guard | Other owner | Deny |
| RULE-04 | ShiftHead | Assigned → Assigned | Transfer | Same site | Allow |
| RULE-05 | Manager/Admin | Assigned → Assigned | Supervisor reassign | Same site | Allow |
| RULE-06 | Guard | Assigned → InProgress | Workflow update | Current owner | Allow |
| RULE-07 | Guard | InProgress → WaitingInformation | Missing information | Current owner | Allow |
| RULE-08 | Guard | WaitingInformation → InProgress | Resume | Current owner | Allow |
| RULE-09 | Guard | InProgress → Ready | Ready | Current owner | Allow |
| RULE-10 | Guard | Ready → InProgress | Entry completion | Current owner | Allow |
| RULE-11 | Guard | InProgress → Completed | Exit completion | Current owner | Allow |
| RULE-12 | Any | Completed → non-completed | Reopen | Any | Deny |
| RULE-13 | Any | Current version → stale | Save | Same site | Deny |
| RULE-14 | ShiftHead+ | Any → same | Priority change | Same site | Allow |
| RULE-15 | Guard | Any → same | Priority change | Any | Deny |
| RULE-16 | Active role | Session activity create | Append | Same site | Allow |
| RULE-17 | Any client | Activity existing → changed/deleted | Mutation | Any | Deny |
| RULE-18 | ShiftHead+ | Analytics read | Read | Same site | Allow |
| RULE-19 | Any client | Analytics write | Create/update/delete | Any | Deny |
| RULE-20 | Active role | Audit create | Append | Own identity | Allow |
| RULE-21 | Any client | Audit existing → changed/deleted | Mutation | Any | Deny |
| RULE-22 | Any role | Site A → Site B | Read/write | Cross-site | Deny |
| RULE-23 | Any client | Metrics existing → changed | Metric mutation | Any | Deny |

Automated tests currently exercise RULE-03, RULE-13, RULE-18/19, RULE-21/22,
RULE-23 and a positive exact-version update. The remaining transition rows are
release-gate requirements and remain blocked from deployed verification until
an approved staging project exists.
