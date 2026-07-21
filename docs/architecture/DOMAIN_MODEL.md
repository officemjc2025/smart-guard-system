# Smart Guard domain model

## Unit and Resident

`Unit` is master data for an occupiable room. It is owned by the property administration and is referenced, never copied as an authority, by visits, loans, and incidents. `Resident` is the person associated with a unit; the current Sprint 0 schema keeps resident contact fields denormalized on `Unit` until a separate resident collection is approved.

## Operations

- `VehicleVisit` records a visitor vehicle from waiting/room selection through exit and archive. It retains `target_room` and adds an optional `target_unit_id`.
- `ContractorVisit` records contractor check-in, working, and checkout with the same optional Unit reference.
- `KeyLoan` records a key checkout and return; `room_number` remains its historical display field.
- `PatrolSession` is a guard's patrol check-in sequence. `PatrolPoint` is the admin-owned master point it references.
- `Incident` is an operational case that may be linked to a Unit, patrol, or visit.
- `ParkingCard` is an admin-owned physical-card master record referenced by VehicleVisit.

## Security and evidence

- `Operator` is the authenticated Username + PIN user/profile. It owns actions, not master data.
- `Media` is the storage-backed evidence record created through `mediaQueueService`; business records keep only media URLs/references.
- `AuditLog` is append-only operational evidence for state transitions and administrative changes.

Unit, ParkingCard, PatrolPoint, and Operator are master data. Visits, loans, sessions, incidents, media, and audit records are transactional. Transactions retain their room text for backward-compatible historical display even if Unit master data later changes.
