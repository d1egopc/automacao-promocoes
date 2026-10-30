# Baileys retained bootstrap — evidence, no runtime repair

Task: verify the owner and release contract of the demonstrated retained buffer.
Area: Baileys initial synchronization; high concurrency/commercial replay risk.
Mode: read-only production; isolated executable reproduction only.
Persistence: none. Performance: no runtime changes. Rollback: no deployment.
Allowed: this record, tests, isolated CI. All production/commercial surfaces frozen.
Human decision: required before any new recovery policy or publication.

Published source 97b7020491c89f119e9dc09538af03f8cae87f2a; main d5128298.
Read-only image verification: sha256:5a89177a42cdca3f1fb0343a58fa077eb69fbe5a0e983de2407c3f12a0e37ebf,
running, restartCount=0. Installed event-buffer.js matches aaee6567218d513a254503b472a3497b0c39e9836e25893247e23db2a548aff4.
socket.js, chats.js and messages-recv.js match the previously published pinned hashes.

## Demonstrated boundary

Owner supplied target frames=2, target CB nodes=2, fromMe=false for both.
References cb5e5d870f54d8a2 and 63af546ff0d874e4 each have emit_attempt then
emit_completed in generation 1, with no wrapper/callback/Radar stage.
Session totals: emitCompleted=431, bufferedAccepted=431, callbacks=0,
buffering=true, transitions=0. These totals are NOT 431 target-group messages.
lastPublicSignal=NOT_OBSERVED, pendingNotificationsObserved=null,
initialSyncState=UNAVAILABLE_PUBLIC_INTERFACE. These do not prove sync completion.

## Exact release owner

socket.js calls ev.buffer() on the logged-in nextTick bootstrap. Its matching
release is the existing CB:ib,,offline handler, after offline notifications.
That handler calls ev.flush(), then emits receivedPendingNotifications=true.
chats.js then enters AwaitingInitialSync and takes another explicit hold:
- disabled history: Online followed by scheduled flush(0);
- skipped history notification: Online then flush;
- processed initial history: await resyncAppState(..., true), Online then flush;
- existing awaiting-notification timeout: Online then flush.

The timeout only starts AFTER receivedPendingNotifications. It is not a timeout
for the earlier socket bootstrap. A settled async upsert or partial app-state
collection sync does not complete this bootstrap contract.

Read-only contextual logs, from container start 2026-10-30T01:21:58.070396516Z
through the query, contain 303 target-session JSON records. Generation 1:
- 22:22:35.982 BRT: offline_preview;
- 22:22:36.267 BRT: opened connection;
- 22:25:57.783 BRT: app-state collection resync request;
- 22:25:58.126 BRT: one collection synced;
- 22:25:58.187 BRT: another collection resync request.
No target-session offline-complete, AwaitingInitialSync, Online history-skip,
initial-sync timeout, or initial app-state completion log was found in coverage.
Other sessions had completion logs; they are not evidence for this socket.
Absence of a log is not physical proof that CB was never dispatched, but the
available evidence does not authorize declaring the initial sync complete.

## Reproduction and decision

The test runs the installed native socket bootstrap and chats sync handlers,
the exact published balanced transformation, and the actual application listener
wrapper with fictional messages. Missing offline completion reproduces retention.
Valid completion releases and delivers post-sync messages. Successful awaited
initial app-state completion releases; incomplete/failed sync remains protected.
Concurrent work, exceptions, exactly-once callback and separate generations are
covered. No test calls an invented completion API or alters a consumer filter.

There is no demonstrated post-COMPLETED-sync explicitHold failure. Therefore no
runtime patch or deployment candidate is claimed. Removing explicitHold or adding
a deadline flush would contradict the requested legitimate-completion condition.

Next repair boundary is socket.js offline_preview -> existing offline_batch
request -> offline processing -> server CB:ib,,offline, not the OneLink parser,
Radar filter, or deferRelease. Existing public data cannot distinguish whether
the batch request completed, the server omitted completion, or offline processing
remained pending. A code repair requires a demonstrated defect in that path.
If the legitimate completion is unavailable, restoring live service requires an
explicitly approved recovery policy that quarantines bootstrap/expired commercial
events before release, reusing the existing fenced recovery mechanism. This is
a different policy from completed-sync release and is NOT implemented/activated.

No production flush, new sensor, reconnect, restart, deployment, commercial
reprocessing, data access or configuration change occurred.
