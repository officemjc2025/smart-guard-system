# Smart Guard data dictionary

| Collection | Required fields | Optional / references | Immutable fields |
|---|---|---|---|
| `units` | `unit_id`, `site_id`, `room_number`, `floor`, `owner_name`, `occupancy_status`, `searchable_text`, `search_key`, `is_active`, timestamps | `room_code`, area, ratio, phone, email, import source/batch | `unit_id`, `created_at` |
| `vehicleLogs` | log/card/plate/type, `target_room`, entry/status/actor/timestamps | `target_unit_id`, lookup status, photos, exit fields | `log_id`, `entry_time` |
| `contractorLogs` | contractor identity, `target_room`, work/entry/status/actor/timestamps | `target_unit_id`, photos, exit fields | `contractor_log_id`, `entry_time` |
| `keyLogs` | loan/key room, borrower, checkout/status/timestamps | `target_unit_id`, evidence, return fields | `key_log_id`, `checkout_time` |
| `patrolPoints` | point ID/name/location/QR/status | interval | point ID, created timestamp |
| `patrolLogs` | patrol/point/check-in/status/actor | photos, abnormal detail, incident reference | patrol log ID, check-in timestamp |
| `incidentReports` | incident/date/location/type/description/reporter/status/timestamps | `target_unit_id`, media, assignment/resolution | incident ID, created timestamp |
| `parkingCards` | card ID/number/QR/status/timestamps | current vehicle/note | card ID, created timestamp |
| `users` | auth/profile identity, role/status/timestamps | shift/contact | auth UID/user ID, created timestamp |
| `media` | storage identity/path/metadata, module/record/site/uploader | archive fields | media ID, created timestamp |
| `auditLogs` | audit ID/actor/action/module/record/timestamp | old/new values/result/session | audit ID, created timestamp |

`target_room` and `room_number` remain required historical display values. `target_unit_id` and `unit_lookup_status` are optional compatibility references for new records.
