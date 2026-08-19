const assert = require("assert");

const {
  calcularCotasFrescorPreImporter,
  avaliarFrescorPreImporter,
  classificarLaneVazaoPreImporter,
  selecionarJobsVazaoPreImporterMemoria,
  expirarJobPreImporterSeNecessario,
  MOTIVO_FRESCOR_PRE_IMPORTER,
  STATUS_FINAL_FRESCOR_PRE_IMPORTER
} = require("../modules/engine/frescor-pre-importer.service");

const AGORA = Date.parse("2026-08-17T15:00:00.000Z");

function job(id, minutosAtras, extras = {}) {
  const capturado = new Date(AGORA - minutosAtras * 60 * 1000).toISOString();
  return {
    id,
    evento_id: 1000 + id,
    cliente_id: extras.cliente_id || "workspace_generico",
    marketplace: extras.marketplace || "mercadolivre",
    status: extras.status || "pendente",
    prioridade: extras.prioridade ?? 0,
    criado_em: extras.criado_em || capturado,
    atualizado_em: extras.atualizado_em || capturado,
    evento_capturado_em: extras.evento_capturado_em || capturado,
    evento_origem: extras.evento_origem || "radar",
    evento_origem_tipo: extras.evento_origem_tipo || "whatsapp",
    metadata: extras.metadata || {},
    evento_metadata: extras.evento_metadata || {}
  };
}

function ordenarComoPreImporter(jobs, limite) {
  return selecionarJobsVazaoPreImporterMemoria(jobs, limite, { agoraMs: AGORA });
}

async function testarBacklogNaoMonopolizaAguaNova() {
  const antigosAindaValidos = Array.from({ length: 100 }, (_, indice) => job(indice + 1, 25 + (indice % 5)));
  const expirados = Array.from({ length: 300 }, (_, indice) => job(500 + indice, 120 + indice));
  const novos = Array.from({ length: 20 }, (_, indice) => job(1000 + indice, 1, {
    prioridade: indice === 0 ? 10 : 0
  }));
  const selecionados = ordenarComoPreImporter([...antigosAindaValidos, ...expirados, ...novos], 30);

  assert.strictEqual(selecionados.length, 32);
  assert.strictEqual(selecionados.filter(item => item.id >= 1000).length, 20, "todos os novos devem entrar no batch antes do backlog morto");
  assert.strictEqual(selecionados.filter(item => item.id < 500).length, 6, "fresca_em_risco deve ter cota propria sem monopolizar");
  assert.strictEqual(selecionados.filter(item => item.id >= 500 && item.id < 1000).length, 6, "limpeza deve ser extra e barata");
  assert.strictEqual(selecionados[0].id, 1000, "prioridade/turbo deve vencer dentro dos frescos");
}

function testarLanesDeIdade() {
  assert.strictEqual(classificarLaneVazaoPreImporter(job(901, 1), { agoraMs: AGORA }), "agua_nova");
  assert.strictEqual(classificarLaneVazaoPreImporter(job(902, 12), { agoraMs: AGORA }), "fresca_circulavel");
  assert.strictEqual(classificarLaneVazaoPreImporter(job(903, 25), { agoraMs: AGORA }), "fresca_em_risco");
  assert.strictEqual(classificarLaneVazaoPreImporter(job(904, 31), { agoraMs: AGORA }), "expirada");
}

function testarFairnessMultiworkspace() {
  const volumoso = Array.from({ length: 50 }, (_, indice) => job(2000 + indice, 1, { cliente_id: "workspace_a" }));
  const pequenos = ["workspace_b", "workspace_c", "workspace_d", "workspace_e"]
    .flatMap((clienteId, indiceCliente) =>
      Array.from({ length: 2 }, (_, indice) => job(3000 + indiceCliente * 10 + indice, 1, { cliente_id: clienteId }))
    );
  const selecionados = ordenarComoPreImporter([...volumoso, ...pequenos], 30);
  const porWorkspace = selecionados.reduce((acc, item) => {
    acc[item.cliente_id] = (acc[item.cliente_id] || 0) + 1;
    return acc;
  }, {});

  for (const clienteId of ["workspace_b", "workspace_c", "workspace_d", "workspace_e"]) {
    assert(porWorkspace[clienteId] > 0, `${clienteId} nao pode sofrer starvation`);
  }
  assert(porWorkspace.workspace_a > 0, "workspace volumoso continua escoando sem monopolizar");
}

function testarFanoutMultiworkspaceVariosMarketplaces() {
  const workspaces = ["workspace_a", "workspace_b", "workspace_c", "workspace_d", "workspace_e"];
  const marketplaces = ["mercadolivre", "amazon", "shopee", "aliexpress"];
  const jobs = [];
  let id = 4000;
  for (const marketplace of marketplaces) {
    for (const cliente_id of workspaces) {
      jobs.push(job(id++, 1, { cliente_id, marketplace }));
    }
  }

  const selecionados = ordenarComoPreImporter(jobs, 30);
  assert.strictEqual(selecionados.filter(item => item.id >= 4000).length, 20, "fanout recente multiworkspace deve entrar inteiro na rodada");
  assert.strictEqual(new Set(selecionados.map(item => item.cliente_id)).size, 5, "rodada deve preservar os 5 workspaces");
  assert.strictEqual(new Set(selecionados.map(item => item.marketplace)).size, 4, "rodada deve preservar varios marketplaces");
}

function testarCotasNaoCobramLimpezaDaLanePrincipal() {
  const cotas = calcularCotasFrescorPreImporter(30);
  assert.strictEqual(cotas.frescos, 30);
  assert.strictEqual(cotas.aguaNova, 21);
  assert.strictEqual(cotas.limpeza, 6);
  assert.strictEqual(cotas.totalSelecao, 36);
}

async function testarExpiracaoAntesDoProcessorValidatorImporter() {
  const chamadas = {
    processamentos: [],
    status: []
  };
  const expirado = job(501, 60, { status: "pendente" });

  const resultado = await expirarJobPreImporterSeNecessario(expirado, {
    agoraMs: AGORA,
    statusEsperado: "pendente",
    registrarProcessamento: async (...args) => {
      chamadas.processamentos.push(args);
      return { ok: true };
    },
    marcarJobStatus: async (...args) => {
      chamadas.status.push(args);
      return { ok: true };
    }
  });

  assert.strictEqual(resultado.expirou, true);
  assert.strictEqual(chamadas.processamentos.length, 1);
  assert.strictEqual(chamadas.processamentos[0][1], "frescor_pre_importer");
  assert.strictEqual(chamadas.processamentos[0][3], MOTIVO_FRESCOR_PRE_IMPORTER);
  assert.strictEqual(chamadas.status.length, 1);
  assert.strictEqual(chamadas.status[0][1], STATUS_FINAL_FRESCOR_PRE_IMPORTER);
  assert.strictEqual(chamadas.status[0][2], MOTIVO_FRESCOR_PRE_IMPORTER);
  assert.deepStrictEqual(chamadas.status[0][3], { statusEsperado: "pendente" });
}

function testarTtlsComumTurboDentroEFora() {
  const comumVelho = avaliarFrescorPreImporter(job(601, 31), { agoraMs: AGORA });
  const comumFresco = avaliarFrescorPreImporter(job(602, 29), { agoraMs: AGORA });
  const turboVelho = avaliarFrescorPreImporter(job(603, 11, {
    metadata: { cupomTurbo: true, tipoFluxo: "cupom_turbo" }
  }), { agoraMs: AGORA });
  const turboFresco = avaliarFrescorPreImporter(job(604, 9, {
    metadata: { cupomTurbo: true, tipoFluxo: "cupom_turbo" }
  }), { agoraMs: AGORA });

  assert.strictEqual(comumVelho.expirada, true);
  assert.strictEqual(comumFresco.expirada, false);
  assert.strictEqual(turboVelho.expirada, true);
  assert.strictEqual(turboVelho.ttlMs, 10 * 60 * 1000);
  assert.strictEqual(turboFresco.expirada, false);
}

async function testarVelhoDiagnosticadoEProntoNaoImporta() {
  for (const status of ["diagnosticado", "pronto_para_importar"]) {
    let chamouTrabalhoPesado = false;
    const resultado = await expirarJobPreImporterSeNecessario(job(700, 90, { status }), {
      agoraMs: AGORA,
      statusEsperado: status,
      registrarProcessamento: async () => ({ ok: true }),
      marcarJobStatus: async () => ({ ok: true })
    });

    if (!resultado.expirou) chamouTrabalhoPesado = true;
    assert.strictEqual(chamouTrabalhoPesado, false, `${status} velho nao deve chegar ao trabalho pesado`);
    assert.strictEqual(resultado.motivo, MOTIVO_FRESCOR_PRE_IMPORTER);
  }
}

function testarManualV2Intacto() {
  const manual = avaliarFrescorPreImporter(job(801, 300, {
    evento_origem: "manual_v2",
    metadata: { manualV2: true }
  }), { agoraMs: AGORA });

  assert.strictEqual(manual.expirada, false);
  assert.strictEqual(manual.manualV2, true);
  assert.strictEqual(manual.motivo, "manual_v2_preservado");
}

function testarSqlsPriorizamFrescosComCota() {
  const fs = require("fs");
  const path = require("path");
  for (const arquivo of [
    path.join(__dirname, "..", "modules", "engine", "processor.service.js"),
    path.join(__dirname, "..", "modules", "engine", "validator.service.js"),
    path.join(__dirname, "..", "modules", "engine", "importer", "importer.service.js")
  ]) {
    const fonte = fs.readFileSync(arquivo, "utf8");
    assert(fonte.includes("bucket_frescor_pre_importer"), `${arquivo} deve separar fresco/backlog`);
    assert(fonte.includes("lane_vazao_pre_importer"), `${arquivo} deve possuir lane agua_nova/fresca/expirada`);
    assert(fonte.includes("ROW_NUMBER() OVER"), `${arquivo} deve usar ranking por workspace`);
    assert(fonte.includes("PARTITION BY COALESCE(NULLIF(TRIM(cliente_id), '')"), `${arquivo} deve aplicar fairness por workspace`);
    assert(fonte.includes("UNION ALL"), `${arquivo} deve unir cota fresca e cota de limpeza`);
    assert(fonte.includes("origem_comercial_pre_importer"), `${arquivo} deve ordenar por origem comercial`);
  }
}

function testarVazaoPreFilaNaoAlteraCadenciaDeEnvio() {
  const fs = require("fs");
  const path = require("path");
  const orchestratorPath = path.join(__dirname, "..", "modules", "engine", "orchestrator.runner.js");
  const fonte = fs.readFileSync(orchestratorPath, "utf8");
  const dimensionadorInicio = fonte.indexOf("function dimensionarLimitePreImporter");
  const dimensionadorFim = fonte.indexOf("let proximoIdRodadaPerf");
  const corpoDimensionador = fonte.slice(dimensionadorInicio, dimensionadorFim);

  assert(corpoDimensionador.includes("totalClientes"), "dimensionamento pre-fila pode considerar fanout/workspaces");
  assert(!/marketplace|categoria|destino|intervalo/i.test(corpoDimensionador), "dimensionamento pre-fila nao pode alterar cadencia por baixa diversidade");
  assert(fonte.includes("const intervaloMs = Number(opcoes.intervaloMs || 120000);"), "cadencia do orquestrador deve seguir configuracao explicita");
  assert(!fonte.includes("intervaloFinal = dimensionarLimitePreImporter"), "dimensionamento de batch nunca deve recalcular intervalo de envio");
}

(async () => {
  await testarBacklogNaoMonopolizaAguaNova();
  testarLanesDeIdade();
  testarFairnessMultiworkspace();
  testarFanoutMultiworkspaceVariosMarketplaces();
  testarCotasNaoCobramLimpezaDaLanePrincipal();
  await testarExpiracaoAntesDoProcessorValidatorImporter();
  testarTtlsComumTurboDentroEFora();
  await testarVelhoDiagnosticadoEProntoNaoImporta();
  testarManualV2Intacto();
  testarSqlsPriorizamFrescosComCota();
  testarVazaoPreFilaNaoAlteraCadenciaDeEnvio();
  console.log("engine-frescor-pre-importer-prioridade.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
