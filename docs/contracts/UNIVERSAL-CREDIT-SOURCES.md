# Universal Credit Sources

## Authority

`financial_credit_ledger` remains the only transaction ledger. Source rows are
a locked projection used to bind a transport hold to the grant that funded it.
They are not a second balance and must always conserve:

`granted = available + reserved + consumed + expired`.

The aggregate `engine_universal_credit_balances` remains a compatibility read
model and must equal the sum of `available + reserved` from all sources for the
workspace. A divergence blocks activation and financial writes.

## Sources

- `cycle`: Pix/payment or courtesy cycle, with the plan's real window;
- `admin_topup`: additive administrative credit, without automatic cycle
  expiry, but never an entitlement by itself;
- `opening`: a classified opening grant;
- `legacy_escrow`: indeterminate historical funding that backs old holds only;
- `legacy_unclassified`: historical available credit awaiting an explicit
  product/accounting decision.

New reservations select only an active, non-expired source. Cycle sources have
priority over non-expiring administrative sources. Every hold records the exact
source. No new target can consume a legacy escrow source.

An active cycle/opening window is an independent prerequisite for every new
reservation. An administrative source can fund a reservation only while that
entitlement exists; its balance alone never creates a right to send. Future
cycle sources cannot be consumed before `cycle_start`.

## Cycle replacement

An approved Pix cycle and an administrative courtesy cycle use the same
projection contract. Applying `replace_cycle` expires only the unreserved
remainder of earlier cycle/opening sources, preserves their reserved escrow,
preserves classified administrative top-ups and creates exactly one new source
for the idempotent ledger row.

A workspace without a current entitlement remains blocked even if an
administrative source has available credit. Login and `/me` remain independent
and read-only.

## Late resolution

- factual ACK: consumes the original source and inserts one idempotent target
  debit;
- factual no-effect while the source is active: returns the reservation to the
  same source;
- factual no-effect after source expiry: moves the reserved unit to `expired`
  and records the expiration adjustment; it never becomes current availability;
- no factual result: remains held in escrow without replay or age-based release.

Commercial TTL may remove an offer from scheduling, but it does not rewrite the
financial result. Old `AMBIGUOUS` targets are already excluded from claiming and
do not own a destination slot. Reconciliation may inspect them in bounded
batches; age only makes an item diagnosable.

## Shadow and cutover

Additive DDL does not activate this model. Absence of a workspace source-state
row means legacy authority. The stages are deliberately separate:

1. `inspectShadowWorkspace()` runs in a repeatable-read, read-only transaction.
   It captures balance, reserved, revision, ordered hold identities and their
   bindings, hashes that snapshot and reports ledger provenance.
2. `prepareShadowWorkspace()` requires that preflight hash, locks the same
   snapshot and aborts if it changed. It writes only inert source projection
   rows, SHADOW state and a separate shadow hold map. It never changes live
   `source_id`, aggregate balance, ledger or legacy authority.
3. `classifyLegacyAvailable()` requires explicit ledger row identities and
   proves their origin and exact relationship with the current balance. It
   changes only the inert projection. Unknown, mixed or incomplete provenance
   remains `legacy_unclassified` and blocks activation.
4. `activateWorkspaceSources()` locks and hashes the live snapshot again. Any
   intervening ledger, hold, Pix or courtesy movement blocks cutover. Only in
   this transaction are live holds bound, an evidenced expiration adjustment
   recorded when necessary, the aggregate changed and mode switched to ACTIVE.
5. after activation, all source and aggregate mutations use the lock order:
   workspace source state, aggregate balance, hold and source.

Preparation and classification are writes, but are not authority changes. They
must still be separately authorized and must never be invoked by startup,
login, `/me`, Executor preflight, payment handling or the courtesy scheduler.

Historical provenance is per ledger movement. Courtesy and Pix cycles require
their explicit origin and window. Administrative top-up provenance is accepted
only when a zero opening plus the complete movement chain proves the entire
available value. Current balance, age, plan name and operator convenience are
never provenance.

## Rollback

Before any future cutover, preserve the exact source-state baseline. Rollback
from `SHADOW` may discard only inert shadow maps, sources and state, including
after the live snapshot diverges; it cannot touch live holds, aggregate balance
or ledger. The legacy authority therefore remains unchanged.

Rollback after `ACTIVE` is not a flag flip. It requires reconstructing the
aggregate from the authoritative ledger, proving zero open source-scoped holds
or reconciling them factually, and comparing every movement revision. Any
divergence blocks rollback. No ACTIVE source or ledger row is deleted.

## Performance

Spend selection uses the partial source index and locks one source. Shadow is
workspace-scoped, indexed and bounded. A future diagnostic reconciler must use
an age/index cursor and a fixed batch; it may not scan all history, query a
provider without a durable correlation or run in the commercial hot path.
