"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { instalarEstadoIngressReal, verificarCapturaIngressReal,
  exigirAutoridadeLegacyReal, sqlFiltroEpochReal } =
  require("../modules/engine/universal-ingress-fence");
const { registrarEventoBruto } =
  require("../modules/engine/inbox.service");
const { sqlBuscarJobsPendentes } =
  require("../modules/engine/processor.service");
const { sqlBuscarJobsDiagnosticados } =
  require("../modules/engine/validator.service");

const epoch = "2026-10-10T10:00:00.000Z";

test("real Engine ingress rejects pre-epoch Radar, TeleRadar and Clonador before insert", async () => {
  instalarEstadoIngressReal({ mode: "UNIVERSAL",
    operationEpochStartedAt: epoch });
  for (const fonte of ["radar", "teleradar", "clonador_grupos", "rio"]) {
    const result = await registrarEventoBruto({ fonte,
      capturadoEm: "2026-10-10T09:59:59.999Z" });
    assert.deepEqual(result, { ok: false, motivo: "pre_epoch_capture",
      jobsCriados: 0, jobsExistentes: 0 });
  }
  assert.equal(verificarCapturaIngressReal(epoch).ok, true);
  assert.equal(verificarCapturaIngressReal(null).reason, "capture_t0_required");
  assert.throws(() => instalarEstadoIngressReal({ mode: "LEGACY" }),
    /requires_restart/);
  for (const operation of ["legacy_viva_write", "legacy_distributor_writer",
    "legacy_queue_executor"]) {
    assert.throws(() => exigirAutoridadeLegacyReal(operation),
      new RegExp(`${operation}_disabled_in_universal_epoch`));
  }
  const predicate = sqlFiltroEpochReal("e");
  assert.match(predicate, /e\.capturado_em >=/);
  assert.match(sqlBuscarJobsPendentes(), /e\.capturado_em >=/);
  assert.match(sqlBuscarJobsDiagnosticados(), /e\.capturado_em >=/);
});
