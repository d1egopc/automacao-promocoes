"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const filaOperacionalV2 = require("../modules/fila/fila-operacional-v2");
const {
  VISAO_ENVIADAS,
  VISAO_NAO_ENVIADAS,
  VISAO_COM_ERRO,
  construirReadModelPublicoPorMarcos
} = require("../modules/fila/fila-read-model-publico");

const CLIENTE = "cliente_historico_monotonico";
const DIA_02 = Date.parse("2026-10-02T15:00:00.000Z");
const DIA_03 = Date.parse("2026-10-03T15:00:00.000Z");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-historico-monotonico-"));
  return {
    root,
    deps: {
      agora: DIA_03,
      bootstrapHistoricoLeve: false,
      getClientePath: cliente => path.join(root, cliente),
      getClienteJsonPath: (cliente, arquivo) => path.join(root, cliente, arquivo),
      logger: { log() {} }
    }
  };
}

function oferta(id, extra = {}) {
  return {
    id,
    ofertaId: id,
    engineOfertaId: id,
    clienteId: CLIENTE,
    titulo: `Oferta ${id}`,
    marketplace: "amazon",
    preco: "99.90",
    criadoEm: "2026-10-02T12:00:00.000Z",
    ...extra
  };
}

function registros(root) {
  const dir = path.join(root, CLIENTE, filaOperacionalV2.HISTORICO_LEVE_INCREMENTAL_DIR);
  return fs.readdirSync(dir).sort().flatMap(nome => fs.readFileSync(path.join(dir, nome), "utf8")
    .split(/\r?\n/).filter(Boolean).map(JSON.parse));
}

function modelo(historicoLeve, agoraMs, visao) {
  return construirReadModelPublicoPorMarcos({
    clienteId: CLIENTE,
    hot: [],
    historicoLeve,
    projectionReady: true,
    agoraMs,
    periodo: "hoje",
    visao
  });
}

{
  const f = fixture();
  filaOperacionalV2.limparCacheHistoricoLeve();
  const enviado = oferta("replay_terminal", {
    status: "enviado",
    enviadoEm: "2026-10-02T14:00:00.000Z",
    destinosEstado: [
      { destinoId: "a", destinoNome: "A", canal: "whatsapp", estado: "enviado", enviadoEm: "2026-10-02T14:00:00.000Z" },
      { destinoId: "b", destinoNome: "B", canal: "telegram", estado: "aguardando" }
    ]
  });
  assert.strictEqual(filaOperacionalV2.appendHistoricoLeveIncremental(CLIENTE, enviado, { ...f.deps, agora: DIA_02 }).ok, true);

  const replayExpirado = oferta("replay_terminal", {
    status: "expirada_operacional",
    enviadoEm: "2026-10-02T14:00:00.000Z",
    expiradaEm: "2026-10-03T13:00:00.000Z",
    destinosEstado: [
      { destinoId: "b", destinoNome: "B", canal: "telegram", estado: "expirada_operacional" },
      { destinoId: "c", destinoNome: "C", canal: "discord", estado: "aguardando" }
    ]
  });
  assert.strictEqual(filaOperacionalV2.appendHistoricoLeveIncremental(CLIENTE, replayExpirado, f.deps).ok, true);

  const linhas = registros(f.root);
  const ultimo = linhas[linhas.length - 1].item;
  assert.strictEqual(ultimo.terminalOcorridoEm, "2026-10-02T14:00:00.000Z", "replay preserva o primeiro marco terminal");
  assert.deepStrictEqual(ultimo.destinos.map(destino => [destino.destinoId, destino.estado]), [
    ["a", "enviado"],
    ["b", "expirada_operacional"],
    ["c", "aguardando"]
  ]);
  assert.strictEqual(ultimo.statusPublico, "parcial", "envio confirmado nunca regride para expirado sem envio");

  const hoje03 = modelo(linhas, DIA_03, VISAO_ENVIADAS);
  assert.strictEqual(hoje03.metricas.processadas, 0, "terminal de 02/10 reprojetado em 03/10 nao pertence a Hoje");
  const hoje02 = modelo(linhas, DIA_02, VISAO_ENVIADAS);
  assert.strictEqual(hoje02.metricas.enviadas, 1);
  assert.strictEqual(hoje02.metricas.parciais, 1);
  assert.strictEqual(hoje02.itens[0].resultadoPublico, "enviada");
}

{
  const expirado = oferta("expirado_real", {
    status: "expirada_operacional",
    expiradaEm: "2026-10-03T14:00:00.000Z",
    statusDetalhe: "Expirada pelo TTL operacional do Flow antes do envio"
  });
  const registroExpirado = { chave: "expirado_real", clienteId: CLIENTE, item: expirado };
  const naoEnviadas = modelo([registroExpirado], DIA_03, VISAO_NAO_ENVIADAS);
  const comErro = modelo([registroExpirado], DIA_03, VISAO_COM_ERRO);
  assert.strictEqual(naoEnviadas.metricas.naoEnviadas, 1);
  assert.strictEqual(comErro.metricas.comErro, 0, "expiracao operacional nao e falha tecnica");
  assert.strictEqual(naoEnviadas.metricas.fechaMatematicamente, true, "processadas fecham com enviadas + nao enviadas");

  const falha = oferta("falha_real", {
    status: "erro_final",
    erroEm: "2026-10-03T14:10:00.000Z",
    erro: "falha de transporte no envio",
    destinosEstado: [{ destinoId: "a", canal: "whatsapp", estado: "erro_final", tentativas: 1 }]
  });
  const erroTecnico = modelo([{ chave: "falha_real", clienteId: CLIENTE, item: falha }], DIA_03, VISAO_COM_ERRO);
  assert.strictEqual(erroTecnico.metricas.comErro, 1, "falha tecnica persistida continua no card Erro");
}

console.log("fila-historico-projecao-monotonica.test.js: ok");
