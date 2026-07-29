# SPR-017 Performance Report

Production build completed in 3.32 seconds with 2,176 transformed modules.

| Chunk | Size | Gzip | Result |
|---|---:|---:|---|
| Application entry | 187.03 kB | 59.48 kB | PASS |
| React vendor | 193.80 kB | 60.53 kB | PASS |
| Scanner vendor | 334.59 kB | 99.91 kB | WARNING |
| Firebase vendor | 737.96 kB | 183.35 kB | WARNING |
| Vehicle workflow | 70.93 kB | 17.54 kB | PASS |
| Admin panel | 124.89 kB | 25.95 kB | PASS |

CSV processing is capped at 5 MB, 5,000 rows, 100 columns and 10,000
characters per cell. XLSX parsing is disabled.

Recommended follow-up:

1. Split Firebase Auth/Firestore/Storage imports by route.
2. Load scanner code only when a scan modal opens.
3. Measure cold starts after staging Functions deployment in `asia-southeast1`.
4. Add Lighthouse mobile measurements after Hosting is deployed.
