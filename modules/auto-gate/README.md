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
