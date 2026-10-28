# Shopee contextual recovery / Magalu Telegram evidence — 2026-10-28

## Base and boundaries

Base runtime/source: `12589a07843954fb6ea858f34da4c56861e64f8a`.
Image read-only confirmed: `sha256:ba5cbe934e2bff9ad1bbd4faa1e522739bd1c7a600025dc0f549ab4f0291b729`.
Branch: `validation/shopee-magalu-recovery-20261028`. No production changes, replay, tasks, messages, capture, conversion mutation or deploy.

## Proven Shopee failure and recovery

Prior tenant-scoped read-only audit: 20 unique jobs (19 contextual coupon / 1 coins), rejected as `sem_link_produto_entre_links_auxiliares` before importer. The contextual label on an opaque URL was treated as destination proof.

Read-only original-URL HTTP resolution proved product routes for 18 events, representing **16 distinct shop/item pairs**, not 20 valid offers. Official `productOfferV2` read-only queries then matched all 16 pairs, with factual title, positive price and image present. Two URLs did not establish product identity and remain blocked. This is not production affiliation, RIO admission or ACK proof.

Fixtures contain only technical event/job IDs and validated product pairs. Network replay mocks API values; price/title in these fixtures are synthetic, explicitly not evidence of the original commercial conditions. Separate real HTTP/API sanitized records are retained in the local evidence directory. One malformed local serialization attempt produced invalid query inputs; those results are excluded from the validated 16-product denominator.

Patch only in existing adapter/importer: resolve contextual `s.shopee.com.br` ambiguity through the existing SSRF/DNS-pinned HTTP helper, then require exact shop + item from the existing official API. No keyword/first-node substitution on this path. Original source URL and source commercial price remain authoritative. Final affiliate destination must retain the same product; existing workspace affiliation proof remains required. No integration means no redirect or fabricated affiliate.

Budget: max two distinct new redirect reads per job; four redirects and 4.5 s total per read; repeated URLs cached within job. Already expanded destinations and ordinary product links add zero HTTP requests. Official API recovery read has an 8 s timeout. These bounded async importer requests are additional work on previously rejected jobs; no callback, RIO loop or synchronous file I/O is added. No claim of zero latency for newly recovered cases.

Separate event 199281/job 1015073 (`shopee_titulo_indisponivel`): current read returned a blocked HTML page without route identity. This does not establish what the historical importer received. Not recovered by this patch.

## Magalu / Garimpei: exact evidentiary limit

Current persisted central Telegram configuration was read without changes: workspace `admin`, `admin_master`, one account opaque ref `1d933aa7c67a93c9`, monitoring active, configured window 07:00–02:30; 11 selected enabled source records. No selected title is Garimpei; legacy `telegramMonitorados` is empty. These are persisted facts, **not live listener/socket proof**, and cannot reconstruct membership at 14:08/14:18. The exact Garimpei chat ID/account association is not established by the available records; a renamed source cannot be excluded without that binding. No complete group catalog or account session is extracted.

Prior bounded Engine/link/task searches did not correlate `itfgrdhg` / `b1agb5jp`; current bounded handoff inspection also found no match. Absence is not proof of Telegram non-delivery. First missing evidence: source identity/selection and listener ingress before Engine. There is no correlated evidence of resolver, identity, image, affiliate, RIO or destination failure for these two messages.

Existing normalizer recognizes `magazineluiza.onelink.me`; fixtures traverse the existing Telegram handoff for both actual public OneLinks and legacy Magalu/Magazine Você URLs. Existing multiworkspace affiliate tests are retained. No Magalu/TeleRadar runtime patch is justified. Next minimal action is read-only confirmation of the exact source chat binding through the existing authenticated Telegram catalog/control, followed, only if needed and separately authorized, by bounded counters on the existing callback (received/source-selected/decision/handoff), without content, raw chat IDs or a second listener. Do not reselect sources or replay messages in this mission.

## Validation and limitations

Integrated baseline adapter × real importer replay: 0/20 -> 18/20 accepted under mocked official responses and per-workspace affiliate verification. Five integrated negative controls plus six redirect/identity/budget controls fail closed. Four original APP/SITE/repeated occurrences remain ordered and immutable in contextual preparation; existing occurrence/template regressions run unchanged.

Two pre-existing tests failed even on the baseline because fake affiliate results pointed to a voucher or omitted the official ownership proof. Only fixture data/proof setup were corrected; assertions and runtime affiliation protections were preserved.

Isolated known-destination microbenchmark: 1,000 preparations, zero HTTP/DB/file writes; local p50 0.0037 ms, p95 0.0071 ms, heap delta +452,136 B (GC-sensitive), CPU below Windows timer resolution. This is not a production load or memory-leak proof. Safe HTTP loopback test required local network permission; initial EACCES was environmental and the permitted rerun passed 12/12.

Guardião, exact CI SHA/run and final test counts are recorded in the delivery report. CI branch only; manual production deploy workflow is not invoked.
