# AUTO Gate — Phase 1 Shadow

The module observes one existing Engine cycle and emits `[AUTO_GATE_SHADOW]`.
It has no operational write API, listener, timer, or source-control dependency.
No recommendation is applied to Radar, TeleRadar, Engine, queue, or executor.

Inputs are durable Radar ingress counts by source (one indexed, time-bounded
aggregate query), the commercial-send and absorption snapshots already
computed by OFC in the same cycle, and read-only operational status providers.
The five-minute living-queue bucket is only a freshness proxy, **not** proof
that an offer is commercially eligible. Captured events and confirmed sends
also have different units; the state machine never subtracts their rates.

`AUTO_GATE_SHADOW_WORKSPACES` may contain a comma-separated list of workspace
IDs for calibration. Empty means all workspaces. A subset is observational
only: source ingress is global, so it yields `NAO_INTERVIR` rather than a
source-global recommendation based on incomparable scopes. No workspace ID is
hardcoded or written to the structured log.

Recommendations use only unambiguous conditions: empty living queue with
ongoing output and available slots, sustained queue/age growth, or zero slots.
The two-cycle evidence, dwell and cooldown settings are **provisional Shadow
settings** (configurable with `AUTO_GATE_SHADOW_EVIDENCE_CYCLES`,
`AUTO_GATE_SHADOW_DWELL_CYCLES`, `AUTO_GATE_SHADOW_COOLDOWN_CYCLES`), not
validated production thresholds. BOOST is disabled by default; setting
`AUTO_GATE_SHADOW_BOOST_EXPERIMENTAL=true` permits only its counterfactual log.
Missing, stale, partial-scope or inconsistent signals yield `NAO_INTERVIR`.

## Operational pressure metrics

The Shadow snapshot keeps the legacy `queueDepthObservado`,
`oldestAgeObservada`, and `availableCapacityObservada` for comparison. The
state machine now reads `queueDepthActionable`, `oldestActionableAge`, and
`capacityEffectiveKnown` with an explicit completeness flag. The first two use the existing OFC live-status,
TTL, definitive-ineligibility, and retry-before-TTL classification; expired
`processando` and `pendente` records remain in `queueDepthRaw` and the
`expired*Count`/`oldestHistoricalAge` diagnostics, never in actionable age.
The existing TTL boundary is inclusive for expiration: age equal to TTL is
already expired.
Explicit queue destination references must also match a destination apt now.
An empty actionable set has age zero. No queue item is changed or removed.

`capacityTheoretical` is the existing 15-minute destination slot estimate.
Credits have three states: `SUFICIENTE`, `INSUFICIENTE`, and `DESCONHECIDO`.
`capacityEffectiveKnown` is the nonnegative residual after actionable queue
demand only where capacity is evidenced; `capacityEffective` is its legacy alias.
Automation off and known insufficient credits mean known zero capacity. Unknown
credits never add known slots and never prove saturation: their theoretical
slots appear in `capacityUnknownSlots`, and `capacityEffectiveComplete` becomes
false only when the workspace could otherwise use slots. An automation-off
workspace has known zero capacity even if its credit balance is absent. In the
inconclusive case the state machine reports `CAPACIDADE_INCONCLUSIVA`/`MANTER`
for capacity-dependent paths; independently sustained actionable queue/age
growth may still yield the existing `PRESSAO_ALTA` recommendation. Destination
enablement, integration, schedule, and daily-limit checks remain unchanged.
Known credit balance also caps the slot estimate.
The config read is read-only; malformed per-client
config fails closed. Credits that the Executor might renew later are not
predicted. Product-specific marketplace/category/media compatibility and
future windows are not inferred here, so this is a current-time capacity
estimate, not a promise that every queued offer can be sent. The offer's
links, images, render, media type, commercial terms, and Executor payload are
untouched.

Recommendations now separate `elegivelParaRecomendacao` (need can target the
source), `prontoParaExecucao` (technical readiness), and
`autorizadoParaExecucao`/`executavelAgora` (both remain false in Shadow).
An inactive TeleRadar listener is therefore reported as a pending
`listener_inativo` prerequisite, not as commercial ineligibility. Outside the
configured window, need may remain `NECESSIDADE`, but the decision is
`NAO_INTERVIR` with `fora_da_janela` pending.

The current OFF/MANUAL/AUTO authority contract does not exist. An `ABRIR_*`
log is therefore counterfactual, not permission to override manual OFF.
Phase 2/3 requires explicit source opt-in, a temporary lease with fencing,
a single writer, manual OFF precedence, schedule fallback, and a new activation
timestamp to prevent backlog. None of that is implemented here.
