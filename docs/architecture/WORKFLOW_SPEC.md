# Smart Guard workflow specification

## VehicleVisit

`Waiting → OCR Pending → Room Selection → Inside → Inspection → Exit Pending → Completed → Archived`.

Guard may create Waiting/Room Selection/Inside records; Shift Leader may inspect; Manager/Admin may archive. Room Selection requires `target_room`; a selected master record also requires `target_unit_id` and `unit_lookup_status=matched`. Camera/OCR are future services and must create Media/AuditLog events without replacing the current upload pipeline. Audit: `vehicle.waiting`, `vehicle.room_selected`, `vehicle.entered`, `vehicle.inspected`, `vehicle.exit_pending`, `vehicle.completed`, `vehicle.archived`.

## ContractorVisit

`Check-in → Working → Check-out`. Guard records check-in/out with contractor identity, target room, timestamps, and required evidence. Shift Leader/Manager may review; Admin may correct master-data errors. Audit: `contractor.checked_in`, `contractor.checked_out`.

## KeyLoan

`Borrowed → Outstanding → Returned`. Guard issues and returns; issuing requires room/area, borrower, signature, and timestamp. Shift Leader/Manager review; Admin manages key master data. Audit: `key.borrowed`, `key.outstanding`, `key.returned`.

## PatrolSession

`Scheduled → Checked → Issue → Incident`. Guard checks a valid PatrolPoint and supplies required photo/status. An Issue requires an abnormal detail; Shift Leader assigns follow-up; an Incident creates a linked incident record. Audit: `patrol.checked`, `patrol.issue_found`, `patrol.incident_created`.

## Incident

`Open → Assigned → Resolved → Closed`. Guard opens with location/description; Shift Leader assigns; Manager/Admin resolves and closes. Every transition requires actor, timestamp, and AuditLog; closing requires a management note.

## Unit import

`Preview → Validate → Diff → Commit`. Admin is the commit role; Manager may preview. Commit only creates/updates deterministic Unit IDs, never deletes or replaces active data. Audit: `units.import_previewed`, `units.import_committed`. Rollback is a hook requiring a separately approved snapshot/archive process.
