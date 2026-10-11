"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

function mockModule(relativePath, exports) {
  const id = require.resolve(relativePath);
  delete require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

test("fanout preserves admitted workspaces and reports only denied admission for retry", async () => {
  const jobs = new Set();
  let allowSecondWorkspace = false;
  let simulateConcurrentConflict = false;
  const jobMetadata = [];
  mockModule("../modules/engine/database", {
    getEnginePool: () => null,
    queryEngine: async (sql, params = []) => {
      if (/WITH jobs_admin/i.test(sql)) {
        return { ok: true, resultado: { rows: [{ jobs_ignorados: 0, ofertas_retidas: 0 }] } };
      }
      if (/SELECT id FROM engine_jobs_cliente/i.test(sql)) {
        return { ok: true, resultado: { rows: jobs.has(params[1]) ? [{ id: 999 }] : [] } };
      }
      if (!/INSERT INTO engine_jobs_cliente/i.test(sql)) throw new Error("unexpected_sql");
      const workspace = params[2];
      jobMetadata.push(JSON.parse(params[4]));
      if (workspace === "workspace_b" && !allowSecondWorkspace) {
        return { ok: false, motivo: "query_falhou", erro: "UF_HOT_ADMISSION_DENIED" };
      }
      if (workspace === "workspace_c" && simulateConcurrentConflict) {
        return { ok: false, motivo: "query_falhou", erroCodigo: "23505",
          erroConstraint: "engine_jobs_event_workspace_unique_candidate" };
      }
      if (jobs.has(workspace)) return { ok: true, resultado: { rows: [] } };
      jobs.add(workspace);
      return { ok: true, resultado: { rows: [{ id: jobs.size }] } };
    }
  });
  mockModule("../modules/workspace", {
    avaliarWorkspaceParaEngine: () => ({ elegivelEngine: true })
  });
  mockModule("../modules/imagens/cache-canonico-evento", {
    resolverImagemCanonicaEvento: async () => ({ imagemStatus: "nao_resolvida", imagemEnviavel: false }),
    aplicarImagemCanonicaMetadata: metadata => metadata
  });
  mockModule("../modules/radar/cobertura-v1", {
    registrar: () => {}, flagAtiva: () => false
  });
  mockModule("../modules/engine/logger", {
    logEngineJobClienteCriado: () => {}, logEngineJobClienteErro: () => {}
  });
  delete require.cache[require.resolve("../modules/engine/jobs.service")];
  const { criarJobsParaClientes } = require("../modules/engine/jobs.service");
  const entrada = {
    eventoId: 123,
    clientes: ["workspace_a", "workspace_b"],
    marketplaceDetectado: "mercadolivre",
    linksExtraidos: ["https://produto.example/item"],
    metadataEvento: { origemFluxo: "optimus" }
  };

  const primeira = await criarJobsParaClientes(entrada);
  assert.equal(primeira.ok, false);
  assert.equal(primeira.motivo, "hot_admission_denied");
  assert.equal(primeira.criados, 1);
  assert.equal(primeira.existentes, 0);
  assert.deepEqual(primeira.clientesAdmissaoPendente, ["workspace_b"]);
  assert.deepEqual([...jobs], ["workspace_a"]);

  allowSecondWorkspace = true;
  const retomada = await criarJobsParaClientes(entrada);
  assert.equal(retomada.ok, true);
  assert.equal(retomada.criados, 1);
  assert.equal(retomada.existentes, 1);
  assert.deepEqual([...jobs], ["workspace_a", "workspace_b"]);

  jobs.add("workspace_c"); // another worker committed before the conflict is handled
  simulateConcurrentConflict = true;
  const concorrente = await criarJobsParaClientes({ ...entrada,
    eventoId: 124, clientes: ["workspace_c"] });
  assert.equal(concorrente.ok, true);
  assert.equal(concorrente.criados, 0);
  assert.equal(concorrente.existentes, 1);

  const clonador = await criarJobsParaClientes({ ...entrada, eventoId: 125,
    clientes: ["workspace_d"], metadataEvento: {
      origemFluxo: "clonador_grupos", cupomTurbo: true, tipoFluxo: "cupom_turbo"
    } });
  assert.equal(clonador.criados, 1);
  assert.equal(jobMetadata.at(-1).metadataEvento.cupomTurbo, true);
  assert.equal(jobMetadata.at(-1).metadataEvento.tipoFluxo, "cupom_turbo");
});
