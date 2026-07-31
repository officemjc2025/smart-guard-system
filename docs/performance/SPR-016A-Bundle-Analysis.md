# SPR-016A Bundle Analysis

## Baselines

| Asset | SPR-015 | SPR-016 |
|---|---:|---:|
| Initial entry | 2,432.78 kB | 1,241.61 kB |
| Vehicle | bundled | 70.81 kB |
| Admin | bundled | 124.81 kB |
| Dashboard | bundled | 16.69 kB |
| Unit Management | bundled | 458.23 kB |

SPR-016A adds intentional React, Firebase, scanner and XLSX vendor chunks and
removes the mixed static/dynamic Firestore import from `App.tsx`. Final values
from the validation build:

| Asset | SPR-016A |
|---|---:|
| Initial entry | 186.21 kB / 59.30 kB gzip |
| Firebase vendor | 737.96 kB / 183.35 kB gzip |
| React vendor | 193.80 kB / 60.53 kB gzip |
| XLSX vendor | 424.73 kB / 141.75 kB gzip |
| Scanner vendor | 334.59 kB / 99.91 kB gzip |
| Vehicle | 70.93 kB / 17.55 kB gzip |
| Admin | 124.92 kB / 25.96 kB gzip |
| Dashboard | 16.77 kB / 4.25 kB gzip |
| Unit Management | 33.35 kB / 10.28 kB gzip |

Initial entry decreased 85.0% from the SPR-016 baseline. Unit Management
decreased 92.7%. The mixed Firestore import warning is resolved. The remaining
over-500 kB warning is isolated to the Firebase vendor chunk.

Large Firebase and XLSX chunks are expected shared/runtime dependencies, not a
reason to suppress warnings. XLSX remains lazy and is also a security release
blocker pending replacement or an approved patched distribution.
