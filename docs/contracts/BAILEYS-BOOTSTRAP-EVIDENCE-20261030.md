# Baileys bootstrap evidence — 2026-10-30

Task: reproduce the installed bootstrap before selecting a runtime repair.
Area: WhatsApp ingress. Risk: high (concurrency and commercial replay).
Mode: production read-only; isolated fixtures. Persistence: no customer data.
Rollback: no runtime delta or publication. Frozen: Auto-Clean, classifiers, commercial consumers.

## Baseline

Source: 000aad348eeac113cd75876db2f53a909894e14c.
Image: sha256:769c04791228b40142aac91933b37a9358d4bac5690c7aa477c4d39b3dfda02d.
Installed Baileys: 6.7.22. Recorded source blocks contain library code only.

- Utils/event-buffer.js: aaee6567218d513a254503b472a3497b0c39e9836e25893247e23db2a548aff4
- Socket/socket.js: b0b8d041b930c4f0264766e8de06ffce78398ecb4d27ef58482de75484f23443
- Socket/messages-recv.js: 2dd660356f4f469a6dfe1be895720acbf3f02794c5273bb83c1a867c409ab299
- Socket/chats.js: 30457f342ac27afa8a211cbfddd1bd428b00a41175acf187aaff7ab8d376d776

## Proven and unproven

The recorded production sample proves target messages reached emit_attempt/emit_completed and remained before wrapper/callback. The initial explicit hold remains until CB:ib,,offline (then receivedPendingNotifications and the chats sync state machine). Settled async operations cannot complete it.

The actual installed receiver uses !!node.attrs.offline and truthiness for append/notify when optimusInitialBufferRecovery is null. For admin/admin_Zoiao Claro the factory returns null: the existing recovery and semantic parser are restricted to user_k3phmbkf/ServCel. Thus string zero goes to the offline queue and append. The isolated test proves this branch selection, but the historical sample does NOT record the offline attribute values of the two target messages. Zero's live-message semantics cannot be established by JavaScript truthiness or another operator's report alone.

Correcting append/notify alone cannot release an explicit bootstrap hold. Conversely the normal processNodeWithBuffer calls ev.buffer()/ev.flush(), which could release a hold while the server batch remains incomplete. Treating zero as live without establishing protocol semantics is therefore not a safe bootstrap repair.

Issue https://github.com/WhiskeySockets/Baileys/issues/2810 describes Baileys 6.7.24 and reports the same mechanism; source reading confirms the truthiness pattern in installed 6.7.22. It does not prove the cause of the absent completion on this session.

## Smallest additional evidence

No new user message is required yet. The missing boundary is offline_preview -> offline_batch request completion -> offline serial processor -> CB:ib,,offline. Existing supplied counters do not distinguish an unsent/failed batch request, a pending/failed offline task, or missing server completion.

First reuse any existing sanitized contextual logs from the ORIGINAL generation for offline_batch send failure, offline processor error, offline completion, and the already-recorded target nodes' offline attribute if available. If those fields were not retained, a bounded observation of the CURRENT generation needs only: offline attribute counters absent/zero/one/other; batch send success/failure; queued/completed/failed/pending offline tasks; native offline-completion count. No payload, addresses, IDs, links, protocol changes or forced flush. If current generation is already online, it cannot reconstruct the original handshake; no reconnect is authorized here.

## Validation

Nine tests execute captured production source blocks with the exact balanced buffer transformation: incomplete bootstrap, legitimate completion, successful/failed app-state sync, concurrency/errors, socket generations, zero attribute behavior and two independent tenant emitters. Eight existing balanced-buffer tests preserved. This is emitter isolation, not proof of the full commercial multiworkspace pipeline or production ACK.

No runtime repair candidate is claimed. A deadline flush or extending the ServCel recovery would change bootstrap recovery policy and is excluded from this evidence-only candidate. Before publication, require demonstrated safe completion or a separately reviewed quarantine recovery policy with TTL/dedup and consumers covered. Production and main are not changed by this branch.
