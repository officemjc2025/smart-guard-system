# SPR-016A Dependency Audit

Audit date: 2026-07-25. Target: SPR-016B staging gate.

## Runtime closure

| Scope | High | Moderate | Low | Result |
|---|---:|---:|---:|---|
| Web runtime (`npm audit --omit=dev`) | 0 | 3 | 0 | PASS — no High runtime finding |
| Functions runtime (`npm --prefix functions audit --omit=dev`) | 0 | 11 | 0 | PASS — no High runtime finding |

## Findings and decisions

| Package/path | Classification |
|---|---|
| `xlsx@0.18.5` | **Resolved.** Dependency removed. XLSX import/export disabled and CSV-only mode retained with file-size, row, column, cell and MIME/extension limits plus formula-injection protection. |
| `fast-uri`, `postcss`, `fast-xml-parser` | **Resolved.** Non-breaking transitive patches applied; runtime audit now reports zero High findings. |
| `@google/genai` / MCP-Hono chain | **Temporarily accepted (Moderate).** No High finding; major downgrade offered by npm. Review usage before Production approval. |
| `firebase-admin`, `firebase-functions`, `googleapis` runtime chains | **Temporarily accepted (Moderate).** Fixes require coordinated major upgrades and staging Drive/Functions verification. |
| `firebase-tools`, Jest/ESLint/glob/minimatch chains | **Mitigated as development-only.** Full audits still report High toolchain findings; these packages are not shipped in the browser or deployed Functions runtime. Upgrade in a dedicated toolchain change. |

No `npm audit fix --force` was run.

## Release decision

The direct/runtime High vulnerability blocker is closed. Production remains
NO-GO for operational reasons: staging provisioning, secrets, deployment, E2E,
backup and rollback are incomplete.
