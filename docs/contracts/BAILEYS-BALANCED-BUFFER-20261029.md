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

Packaging: the closed baileys_balanced_buffer_patch profile requires this exact
base and ancestry of 426b7ea7; pins the two runtime files, Dockerfile, unchanged
package/lock/dockerignore and dependency before/after hashes. Other full builds,
installers, versions and runtime additions remain blocked. Ordinary overlay is
not used for this repair. Official deploy validates only event-buffer.js for this
profile; the previous three-file profile and its validations remain unchanged.

The npm postinstall applies the same pinned module. The normal Dockerfile copies
it before npm ci. The production derived recipe copies only the two runtime
files and invokes that module once, offline, as root, then returns to USER node.
The complete Dockerfile is validated as packaging input and is not deployed.
No npm, apt or network command is introduced into the production derived recipe.

CI: .github/workflows/baileys-balanced-buffer-ci.yml uses Linux/Node24, npm ci,
exact artifact SHA-256 verification, consumer tests, negative packaging fixtures,
Guardian, clean Docker build, and tests inside full and offline derived images.
Fixture source is Baileys 6.7.22 event-buffer.js encoded as JSON to preserve exact
tarball bytes; upstream project: https://github.com/WhiskeySockets/Baileys (MIT).

Publication procedure after explicit authorization:
1. Reconfirm source SHA, clean delta from cecd2e6a and active image below.
2. Promote only this candidate including the closed Guardian/deploy profile.
3. Use the official workflow_dispatch on main with source_sha=candidate,
   base_sha=cecd2e6acdf5df274d19ee87f029389078f141dc and
   base_image=sha256:7d35dfa921e9f8931315e04897ebd9d157110d094e3b5715c40e2959942d9412.
4. Runtime list is exactly modules/whatsapp/baileys-balanced-buffer-patch.js,
   scripts/apply-baileys-retry-hotfix.cjs (comma-separated in that order).
5. Existing workflow creates/verifies recovery reference before swapping only
   backend; preserves prior release overlay for rollback. No env/mount changes.
6. Confirm active image, HTTP, PostgreSQL, sessions and contracts. In objective
   regression use the workflow's existing rollback to the prior release image.
7. The owner authorizes real OP Test Radar observation separately; never force
   release the active production emitter or reprocess historical messages.

Read-only preflight reconfirmed the above active image, its versioned local tag,
backend running/restart=0, PostgreSQL healthy and HTTP200. This image exists and
can be selected by the official rollback; a new recovery tag is created only in
the separately authorized deployment, not during this preparation mission.
No merge, deployment, restart or production mutation was performed.
