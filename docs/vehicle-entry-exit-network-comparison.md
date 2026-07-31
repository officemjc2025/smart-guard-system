# Vehicle Entry/Exit Network Comparison

## Scope

This comparison covers listeners mounted by the Vehicle Entry/Exit route. It
does not count authentication listeners or listeners mounted by another route.

## Before and after

| Query registration | Before | After on Vehicle Entry/Exit |
| --- | ---: | ---: |
| Pending vehicle sessions | 1 | 1 |
| Assigned vehicle sessions | 1 | 0 |
| Active/current vehicle sessions | 1 | 1 |
| Operational queue | 1 | 0 |
| Completed today | 1 | 0 |
| Realtime analytics queue | 1 | 0 |
| **Total active Firestore listeners** | **6** | **2** |

The Queue, Completed Today and Realtime Analytics listeners were moved to the
separate `Vehicle Operations` route. They are now inactive while a guard uses
Vehicle Entry/Exit and mount only when that route is opened.

This is a reduction of four listener registrations, or 66.7%, on the guard
Vehicle Entry/Exit route.

## Read model

Firestore does not poll every listener once per interval. Billed document reads
for an `onSnapshot()` query are driven by:

```text
initial matching documents
+ added/updated matching documents during the interval
+ reconnect/resume behavior
```

Consequently, a five-minute read comparison must record both the matching
document counts and changes during the window. HTTP `channel/?VER=8` request
count is also not equal to listener count because the WebChannel transport may
multiplex multiple listen targets over one channel.

For an unchanged dataset, the removed initial-read upper bounds were:

| Removed query | Query limit |
| --- | ---: |
| Assigned sessions | 50 |
| Operational queue | 100 |
| Completed today | 100 |
| Realtime analytics queue | 100 |

The exact saving is the number of documents those queries would have returned,
not automatically the sum of their limits.

## Five-minute runtime capture status

A browser Network capture could not be produced in the current execution
environment because no controllable browser session was available. No
production read or `channel/?VER=8` number has been fabricated.

The structural listener counts above are verified directly from component
mount/unmount paths:

- Vehicle Entry/Exit registers two subscriptions and unsubscribes both in its
  effect cleanup.
- Vehicle Operations owns the Queue and Analytics dashboards.
- Route switching unmounts the previous lazy component, invoking every
  subscription cleanup.

## Reproducible five-minute capture procedure

Use the same account, site, dataset and network conditions for both builds.

1. Open Chrome DevTools, Network.
2. Enable **Preserve log** and **Disable cache**.
3. Filter once with `channel/?VER=8`, and separately with
   `firestore.googleapis.com`.
4. Open Vehicle Entry/Exit and wait until all initial snapshots finish.
5. Clear the Network log and Firebase usage/read metrics baseline.
6. Leave the page untouched for exactly five minutes.
7. Record:
   - active Firestore listen targets;
   - `channel/?VER=8` request count;
   - transferred bytes;
   - Firestore document reads;
   - reconnects or visibility changes;
   - number of matching documents changed during the window.
8. Repeat three times for the before build and three times for the after build.
9. Report the median, keeping the raw HAR files.
10. Repeat after navigating Vehicle Entry/Exit -> Vehicle Operations ->
    Vehicle Entry/Exit and confirm that old targets are removed rather than
    accumulated.

Expected invariant after refactor:

```text
Vehicle Entry/Exit active targets = 2
Vehicle Operations targets do not remain active after leaving that route
Repeated route navigation does not increase the target count
```

