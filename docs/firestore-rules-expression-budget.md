# Firestore Rules: Expression Budget and Vehicle Workflow

## Incident summary

`completeVehicleExit()` commits six writes atomically:

1. `vehicleLogs/{logId}` update
2. `parkingCards/{cardId}` update
3. `auditLogs/{auditId}` create
4. `parkingCardHistory/{historyId}` create
5. `vehicleSessions/{sessionId}` update
6. `vehicleSessions/{sessionId}/activities/{eventId}` create

The original rules revalidated the complete parking-card and vehicle-log schemas
while also evaluating transition, identity, site and cross-document conditions.
The Firestore Emulator rejected the request after reaching the 1,000-expression
evaluation limit.

## Optimized rule: before and after

Before, every parking-card update entered the complete schema validator:

```rules
allow update: if validParkingCard(request.resource.data)
              && request.resource.data.card_id == resource.data.card_id
              && request.resource.data.site_id == resource.data.site_id
              && request.resource.data.site_id == activeSiteId()
              && allowedParkingCardTransition()
              && validReplacementUpdate(id)
              && (
                vehicleSessionCardTransition()
                || adminParkingCardTransition()
                || guardParkingCardTransition()
              );
```

After, only the operational `InUse -> Available/Lost` exit path uses a
delta-oriented schema validator. All other parking-card workflows continue to
use the complete validator:

```rules
allow update: if request.resource.data.card_id == resource.data.card_id
              && request.resource.data.site_id == resource.data.site_id
              && request.resource.data.site_id == activeSiteId()
              && allowedParkingCardTransition()
              && validReplacementUpdate(id)
              && (
                (
                  resource.data.status in ['InUse', 'In Use', 'ใช้งานอยู่']
                  && request.resource.data.status in ['Available', 'Lost']
                  && validParkingCardUpdateData()
                  && guardParkingCardTransition()
                )
                || (
                  validParkingCard(request.resource.data)
                  && (
                    vehicleSessionCardTransition()
                    || guardParkingCardTransition()
                    || adminParkingCardTransition()
                  )
                )
              );
```

Before, a vehicle-log update always evaluated the complete create schema before
the update-specific transition:

```rules
allow update: if validVehicleLog(request.resource.data)
              && (
                validActiveVehicleLogDetailUpdate(id)
                || validVehicleExitTransition()
              );
```

After, each update path validates its exact mutable field set and types:

```rules
allow update: if validActiveVehicleLogDetailUpdate(id)
              || (
                validVehicleExitTransition()
                && getAfter(...parkingCard...).data.status in ['Available', 'Lost']
                && getAfter(...parkingCard...).data.current_vehicle_log_id == ''
                && getAfter(...parkingCard...).data.related_vehicle_log_id == id
              );
```

`validVehicleExitTransition()` now validates the changed exit timestamps, text
limits and image URL limits itself.

## Why fewer expressions are evaluated

- The exit path no longer repeats every type and optional-field check intended
  for parking-card creation.
- The vehicle-log exit path does not execute both a complete-document validator
  and an update-specific validator.
- The inexpensive, exact operational branch is evaluated before broader admin
  workflow branches, allowing Rules short-circuit evaluation.
- Repeated `getAfter()` relationships were not removed; they still enforce the
  atomic card/log linkage.

The Emulator result changed from six new Vehicle Exit failures caused by the
expression ceiling to `80/80` passing tests.

## Security equivalence

The optimization does not broaden Vehicle Exit authorization:

- `request.auth` and active canonical user profile are still required.
- Roles remain `Guard`, `ShiftHead`, `Manager`, and `Admin`; `ShiftLeader`
  remains denied.
- Both source and destination documents must match `activeSiteId()`.
- `card_id`, site, log identity, entry identity and account identity remain
  immutable.
- `diff().affectedKeys().hasOnly(...)` restricts the exit field set.
- Only `InUse -> Available` or `InUse -> Lost` is accepted.
- `getAfter()` still requires the vehicle log to become `ออกแล้ว` and the card
  to clear its active-log reference in the same commit.
- Audit and parking-card history documents remain create-only and immutable.
- Other parking-card workflows still execute `validParkingCard()`.

## Rules authoring requirements

1. Test the largest real atomic transaction, not only individual writes.
2. Avoid calling the same expensive helper from nested branches.
3. Order OR branches from the narrowest/common path to broader privileged paths
   when the authorization result is equivalent.
4. Use full-document validation for creates.
5. Use delta validation for updates only when:
   - immutable identity fields are checked separately;
   - every permitted branch has a strict `affectedKeys().hasOnly(...)`;
   - every changed field has type and size validation;
   - transition and site constraints remain explicit.
6. Preserve `getAfter()` and `existsAfter()` where atomic relationships are a
   security invariant.
7. Add Emulator tests for canonical roles, inactive users, legacy roles,
   cross-site access, field tampering and the complete multi-document commit.
8. Treat `maximum of 1000 expressions` as a Rules design failure. Do not work
   around it by moving trusted history out of the transaction or weakening
   schema validation.
9. Preserve canonical profile strings exactly when Rules use exact equality.
   Validation may check `trim()` for emptiness, but payload construction must
   not normalize `operator_name`, `role`, or `site_id`.

