# Balanced buffer candidate — laboratory only

Task: repair settled asynchronous Baileys operation holds after initial synchronization.
Area: shared WhatsApp event buffer. Risk: high (concurrency, all socket consumers).
Reversibility: previous backend image; no production state changes authorized.
Persistence: no schema, commercial data or session changes. One deferred timer per emitter.
Allowed: pinned installer, packaging integration and tests. Commercial consumers frozen.
Initial mode: isolated implementation. Deployment requires separate approval and all gates.

Base: cecd2e6acdf5df274d19ee87f029389078f141dc.
Production dependency: Baileys 6.7.22, event-buffer.js SHA-256
d2d9a7b26868de3086bf444576f41beb296c0867767cb5782fcd34ab6281a37c.

Official reference consulted: https://github.com/WhiskeySockets/Baileys/blob/master/src/Utils/event-buffer.ts
The reference uses counted work and deferred release. It is not copied wholesale:
the candidate separates explicit synchronization holds from asynchronous operation holds.

Explicit buffer() holds remain owned by the existing synchronization state machine.
Settled concurrent/nested operations release only their own holds in finally.
After all operations finish, one 100ms timer releases only if no explicit hold exists.
An explicit flush during pending work requests release but waits for work completion.
New explicit holds cancel deferred release. Exceptions preserve their original identity.
No new listener, session, retry, commercial reprocessing or initial-sync timeout is added.
Never force-release unresolved work or explicit initial synchronization on a wall-clock deadline.

The installer fails closed on version, symlink or content mismatch and is idempotent.
The npm postinstall chain and Docker pre-install COPY are prepared locally.
Existing historical protection, dedupe, timestamps and consumer gates are not modified.
This does not prove the two real OP Test messages were retained in the buffer.

Publication blocker: Guardian v1 only supports a different, closed three-file
baileys_buffer_patch profile against f50e8a29. This candidate changes event-buffer.js
and build packaging; ordinary overlay must not be presented as applying the repair.
A separately hash-pinned profile and matching official deploy validation are required.
No Guardian allowlist has been relaxed and no deploy has been run.
