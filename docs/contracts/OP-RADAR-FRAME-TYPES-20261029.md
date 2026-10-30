# OP Test Radar — bounded public frame observation

Task: distinguish decoded frame categories before CB:message using the existing
observer. Area: WhatsApp observation only. Risk: moderate, read-only metadata on
public dispatch. No persistence, protocol or consumer change. Rollback: previous
backend image. Initial mode OFF. No deployment or activation authorized here.
Base: 5bfbb53f1c2c91b3989215c960b5297388bd7a77 (published buffer correction).

Only runtime change: modules/whatsapp/ingress-boundary-observation.js.
All existing scope, 5-minute/10-message limits, stop, generation and retention
semantics remain. No new listener, connection, timer, retry or commercial event.
The published balanced buffer installer/recipe remains byte-identical.

Per generation counters classify decoded `frame` by fixed tag: message;
control (iq/ack/receipt/notification/presence/chatstate/call); sync signal
(ib/success); other; or binary (ArrayBuffer/view). These are transport labels,
not proof of the actual semantic purpose of a notification or synchronization.
Raw WebSocket binary messages and decoded binary frames are separate counts.

Only plain own tag metadata and equality of attrs.from to the already authorized
group are read. No content, participant, IDs, unknown tag values, error payload,
phone, URL or credential is retained. Foreign groups contribute session totals
only. targetMessageFrames/targetMessageNodes prove the approved group matched;
unattributed messages have a dedicated count and are never presumed foreign.
No getters are invoked. Frame metadata failure cannot change native dispatch.

Public listenerCount(CB:message) proves registered receivers, not invocation.
The wrapper preserves this/arguments/native return/error. Counters separately
report generic socket error events, stream errors, public dispatch exceptions,
exceptions from frame dispatch and exceptions from CB:message dispatch.
They are NOT reported as decoding/decryption failures. Those remain null with
explicit unavailable coverage: no dedicated public failure event exists here.

Synchronization: last public authenticated/offline-completion signal and the
existing application flag receivedPendingNotifications are observed. Internal
Baileys SyncState is unavailable and is never inferred from buffering alone.

## Evidence to next action

* Only control/sync/binary frames, zero target message frames: delivery to the
  linked Baileys device is unproved. Verify the live socket account/device is
  the same Claro account, using official connection/device interfaces; do not
  change Radar filters, flush or reconnect. Server-side delivery is outside the
  public interfaces. Classifier cannot fabricate that missing evidence.
* targetMessageFrames > 0 but targetMessageNodes = 0: inspect frameDispatchThrows.
  A reproduced frame-handler exception requires repairing that existing handler;
  zero exceptions requires comparing the exact installed public routing code.
* targetMessageNodes > 0 and receiver ABSENT: repair missing registration in the
  existing Baileys construction lifecycle, after isolated reproduction.
* targetMessageNodes > 0 and receiver PRESENT but no upsert: the next boundary is
  existing processNode/decrypt/queue. Consult contextual sanitized Signal/retry
  logs already implemented. Do not label it buffer retention without emit proof.
* emitAttempts > 0: use existing buffer/wrapper/callback/Radar counters and
  reason codes to locate the demonstrated loss. Preserve the buffer correction.

## Controlled publication and one natural test (separate approval)

Promote only the candidate after CI/Guardian. Official overlay from published
5bfbb53f, active image 09308f44..., copies only the observer; no dependency install.
Verify rollback to that image before replacement, health and eight sessions.
Use GET /admin/whatsapp/ingress-boundary then the existing authorized start with
OP_TEST_RADAR_BOUNDARY_5M; require target verified and current generation.
Owner sends one common message via Vivo. Read during the window and immediately
on stop; save the sanitized report externally before its existing 15-minute
RAM retention expires. Queries do not extend the observation. No automatic test.
This candidate does not itself recover delivery or prove a new production cause.
