"use strict";

const assert = require("assert");

const {
  TTL_NORMAL_MS,
  TTL_TURBO_MS,
  calcularExpiracaoOperacionalFila,
  carimbarExpiracaoOperacionalFila,
  sanearExpiracaoOperacionalFilaItem
} = require("../modules/engine/flow-manager/flow-manager.service");

const WORKSPACE_A = "workspace_a";
const WORKSPACE_B = "workspace_b";

function itemFila(extra = {}) {
  return {
    id: extra.id || "item",
    clienteId: extra.clienteId || WORKSPACE_A,
    status: extra.status || "pendente",
    dataEntradaFila: extra.dataEntradaFila || "2026-08-05T12:00:00.000Z",
    marketplace: "mercadolivre",
    titulo: extra.titulo || "Oferta teste",
    ...extra
  };
}

function sanearCliente(fila = [], clienteId = WORKSPACE_A, agoraMs = Date.parse("2026-08-05T12:31:00.000Z")) {
  for (const item of fila) {
    if (String(item.clienteId || "admin") !== String(clienteId)) continue;
    if (item.status !== "pendente") continue;
    sanearExpiracaoOperacionalFilaItem(item, { agoraMs });
  }
  return fila;
}

function limparModulo(relativo) {
  const resolvido = require.resolve(relativo);
  delete require.cache[resolvido];
  return resolvido;
}

function mockModulo(relativo, exports) {
  const resolvido = limparModulo(relativo);
  require.cache[resolvido] = {
    id: resolvido,
    filename: resolvido,
    loaded: true,
    exports
  };
}

async function testarItemNovoRecebeExpiraEmNaEntradaOficial() {
  mockModulo("../utils/usuarios-atividade", {
    usuarioAtivo: () => true,
    listarClientesAtivos: () => [WORKSPACE_A],
    logUsuarioInativoIgnorado: () => false
  });
  limparModulo("../modules/engine/distributor/distributor.service");
  const { adicionarOfertaNaFilaCliente } = require("../modules/engine/distributor/distributor.service");

  let capturado = null;
  const expiraEm = "2026-08-05T12:30:00.000Z";
  const resultado = await adicionarOfertaNaFilaCliente({
    id: 10,
    job_id: 20,
    cliente_id: WORKSPACE_A,
    marketplace: "mercadolivre",
    categoria: "Gamer",
    titulo: "Oferta nova",
    preco: 99,
    link_afiliado: "https://example.com/oferta",
    metadata: {}
  }, {
    flowManagerDecisao: {
      aceitarAgora: true,
      tipoFluxo: "oferta_comum",
      ttlMs: TTL_NORMAL_MS,
      expiraEm
    },
    deps: {
      adicionarOfertaNaFilaGlobal: (_clienteId, itemFila) => {
        capturado = itemFila;
        return { ok: true, itemFila };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert(Date.parse(capturado.expiraEm) >= Date.parse(capturado.dataEntradaFila));
  assert.strictEqual(capturado.ttlMs, TTL_NORMAL_MS);
  assert.strictEqual(capturado.tipoFluxo, "oferta_comum");
  assert.strictEqual(capturado.metadata.flowOperacional.expiraEm, capturado.expiraEm);
}

function testarTurboVenceNoTtlTurbo() {
  const item = itemFila({ cupomTurbo: true });
  const resultado = sanearExpiracaoOperacionalFilaItem(item, {
    agoraMs: Date.parse("2026-08-05T12:10:01.000Z")
  });
  assert.strictEqual(resultado.expirou, true);
  assert.strictEqual(resultado.ttlMs, TTL_TURBO_MS);
  assert.strictEqual(item.status, "expirada_operacional");
}

function testarComumVenceNoTtlComum() {
  const item = itemFila();
  const resultado = sanearExpiracaoOperacionalFilaItem(item, {
    agoraMs: Date.parse("2026-08-05T12:30:01.000Z")
  });
  assert.strictEqual(resultado.expirou, true);
  assert.strictEqual(resultado.ttlMs, TTL_NORMAL_MS);
  assert.strictEqual(item.status, "expirada_operacional");
}

function testarLegadoSemExpiraEmSaneadoCorretamente() {
  const item = itemFila({ expiraEm: "" });
  const resultado = sanearExpiracaoOperacionalFilaItem(item, {
    agoraMs: Date.parse("2026-08-05T12:31:00.000Z")
  });
  assert.strictEqual(resultado.expirou, true);
  assert.strictEqual(item.expiraEm, "2026-08-05T12:30:00.000Z");
  assert.strictEqual(item.statusDetalhe, "Expirada pelo TTL operacional do Flow D1 antes do envio");
}

function testarVivoContinuaElegivelERecebeExpiraEmLegado() {
  const item = itemFila({
    expiraEm: "",
    dataEntradaFila: "2026-08-05T12:20:00.000Z"
  });
  const resultado = sanearExpiracaoOperacionalFilaItem(item, {
    agoraMs: Date.parse("2026-08-05T12:31:00.000Z")
  });
  assert.strictEqual(resultado.expirou, false);
  assert.strictEqual(item.status, "pendente");
  assert.strictEqual(item.expiraEm, "2026-08-05T12:50:00.000Z");
}

function testarWorkspaceNaoAfetaOutroEHistoricoPermanece() {
  const fila = [
    itemFila({ id: "a_expirado", clienteId: WORKSPACE_A }),
    itemFila({ id: "b_pendente", clienteId: WORKSPACE_B })
  ];
  sanearCliente(fila, WORKSPACE_A);
  assert.strictEqual(fila.length, 2);
  assert.strictEqual(fila[0].status, "expirada_operacional");
  assert.strictEqual(fila[1].status, "pendente");
  assert.strictEqual(fila[1].expiraEm, undefined);
}

function testarExecutorEscolheOfertaFrescaAposSaneamento() {
  const fila = [
    itemFila({ id: "antiga_prioritaria", prioridadeEnvio: 100, dataEntradaFila: "2026-08-05T11:00:00.000Z" }),
    itemFila({ id: "fresca", prioridadeEnvio: 10, dataEntradaFila: "2026-08-05T12:20:00.000Z" })
  ];
  sanearCliente(fila, WORKSPACE_A, Date.parse("2026-08-05T12:31:00.000Z"));
  const selecionavel = fila.filter(item => item.status === "pendente");
  assert.deepStrictEqual(selecionavel.map(item => item.id), ["fresca"]);
}

function testarWolffUsaDataEntradaFilaIsoAntesDeCriadoEmVisual() {
  const item = itemFila({
    id: "wolff_recente",
    criadoEm: "08/08/2026, 15:01:14",
    dataEntradaFila: "2026-08-08T18:01:14.537Z",
    expiraEm: ""
  });
  const resultado = sanearExpiracaoOperacionalFilaItem(item, {
    agoraMs: Date.parse("2026-08-08T18:01:21.010Z")
  });

  assert.strictEqual(resultado.expirou, false);
  assert.strictEqual(resultado.origemCampo, "dataEntradaFila");
  assert.strictEqual(item.status, "pendente");
  assert.strictEqual(item.expiraEm, "2026-08-08T18:31:14.537Z");
  assert(Date.parse(item.expiraEm) > Date.parse(item.dataEntradaFila));
}

function testarTimezoneBrtVisualNaoMudaMagnitudeTemporalDaEntradaIso() {
  const item = itemFila({
    criadoEm: "08/08/2026, 15:01:14",
    dataEntradaFila: "2026-08-08T18:01:14.000Z",
    expiraEm: ""
  });
  const politica = calcularExpiracaoOperacionalFila(item, {
    agoraMs: Date.parse("2026-08-08T18:10:00.000Z")
  });

  assert.strictEqual(politica.origemCampo, "dataEntradaFila");
  assert.strictEqual(politica.origemMs, Date.parse("2026-08-08T18:01:14.000Z"));
  assert.strictEqual(politica.expiraEm, "2026-08-08T18:31:14.000Z");
  assert.strictEqual(politica.vencido, false);
}

function testarExpiraEmAnteriorAEntradaEhRecalculado() {
  const item = itemFila({
    criadoEm: "08/08/2026, 15:01:14",
    dataEntradaFila: "2026-08-08T18:01:14.537Z",
    expiraEm: "2026-08-08T15:31:14.000Z"
  });
  const resultado = sanearExpiracaoOperacionalFilaItem(item, {
    agoraMs: Date.parse("2026-08-08T18:01:21.010Z")
  });

  assert.strictEqual(resultado.expirou, false);
  assert.strictEqual(resultado.expiraPersistidoCorrigido, true);
  assert.strictEqual(item.status, "pendente");
  assert.strictEqual(item.expiraEm, "2026-08-08T18:31:14.537Z");
}

function testarItemRealmenteAntigoContinuaExpirando() {
  const item = itemFila({
    criadoEm: "08/08/2026, 08:00:00",
    dataEntradaFila: "2026-08-08T11:00:00.000Z",
    expiraEm: ""
  });
  const resultado = sanearExpiracaoOperacionalFilaItem(item, {
    agoraMs: Date.parse("2026-08-08T11:31:00.000Z")
  });

  assert.strictEqual(resultado.expirou, true);
  assert.strictEqual(item.status, "expirada_operacional");
  assert.strictEqual(item.expiraEm, "2026-08-08T11:30:00.000Z");
}

function testarCarimboNaoAceitaExpiraEmAntesDaEntradaFila() {
  const item = itemFila({
    criadoEm: "08/08/2026, 15:01:14",
    dataEntradaFila: "2026-08-08T18:01:14.537Z"
  });
  carimbarExpiracaoOperacionalFila(item, {
    aceitarAgora: true,
    tipoFluxo: "oferta_comum",
    ttlMs: TTL_NORMAL_MS,
    expiraEm: "2026-08-08T15:31:14.000Z"
  });

  assert.strictEqual(item.expiraEm, "2026-08-08T18:31:14.537Z");
  assert(Date.parse(item.expiraEm) > Date.parse(item.dataEntradaFila));
}

function testarControleD1IsoCoerentePermaneceElegivel() {
  const item = itemFila({
    clienteId: "user_40qdblgt",
    criadoEm: "08/08/2026, 08:55:34",
    dataEntradaFila: "2026-08-08T11:55:34.755Z",
    expiraEm: "2026-08-08T12:25:34.755Z"
  });
  const resultado = sanearExpiracaoOperacionalFilaItem(item, {
    agoraMs: Date.parse("2026-08-08T12:00:00.000Z")
  });

  assert.strictEqual(resultado.expirou, false);
  assert.strictEqual(item.status, "pendente");
  assert.strictEqual(item.expiraEm, "2026-08-08T12:25:34.755Z");
}

function testarCarimboPreservaPoliticaDoFlow() {
  const item = itemFila({ dataEntradaFila: "2026-08-05T12:00:00.000Z" });
  carimbarExpiracaoOperacionalFila(item, {
    aceitarAgora: true,
    tipoFluxo: "cupom_turbo",
    ttlMs: TTL_TURBO_MS,
    expiraEm: "2026-08-05T12:10:00.000Z"
  });
  assert.strictEqual(item.expiraEm, "2026-08-05T12:10:00.000Z");
  assert.strictEqual(item.ttlMs, TTL_TURBO_MS);
  assert.strictEqual(item.tipoFluxo, "cupom_turbo");
  assert.strictEqual(item.metadata.flowOperacional.politica, "flow_manager_d1");
}

(async () => {
  await testarItemNovoRecebeExpiraEmNaEntradaOficial();
  testarTurboVenceNoTtlTurbo();
  testarComumVenceNoTtlComum();
  testarLegadoSemExpiraEmSaneadoCorretamente();
  testarVivoContinuaElegivelERecebeExpiraEmLegado();
  testarWorkspaceNaoAfetaOutroEHistoricoPermanece();
  testarExecutorEscolheOfertaFrescaAposSaneamento();
  testarWolffUsaDataEntradaFilaIsoAntesDeCriadoEmVisual();
  testarTimezoneBrtVisualNaoMudaMagnitudeTemporalDaEntradaIso();
  testarExpiraEmAnteriorAEntradaEhRecalculado();
  testarItemRealmenteAntigoContinuaExpirando();
  testarCarimboNaoAceitaExpiraEmAntesDaEntradaFila();
  testarControleD1IsoCoerentePermaneceElegivel();
  testarCarimboPreservaPoliticaDoFlow();
  console.log("optimus-flow-d1-expiracao-operacional.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
