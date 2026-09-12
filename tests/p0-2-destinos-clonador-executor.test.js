"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  normalizarDestinosAutorizadosIds,
  resolverRestricaoDestinosClonador,
  filtrarDestinosAutorizadosClonador
} = require("../modules/clonador-grupos/destinos-restricao.contract");
const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");
const { normalizarEntradasViva } = require("../modules/fila/fila-operacional-v2");

function clone(extras = {}) {
  return {
    id: "fila_clone_1",
    clienteId: "workspace_a",
    origemFluxo: "clonador_grupos",
    metadata: {
      clonadorGrupos: { destinoIds: ["vip"] }
    },
    ...extras
  };
}

function destino(id, tipo = "whatsapp", extras = {}) {
  return { id, tipo, ativo: true, ...extras };
}

function ids(resultado = {}) {
  return resultado.destinos.map(item => item.id);
}

function testarContratoRestricao() {
  assert.deepStrictEqual(
    normalizarDestinosAutorizadosIds([" vip ", "", "vip", "tg", " tg "]),
    ["vip", "tg"],
    "normaliza trim e dedupe estavel"
  );

  const origemClone = clone({ destinosAutorizadosIds: ["vip", "vip", "tg"] });
  assert.deepStrictEqual(
    resolverRestricaoDestinosClonador(origemClone),
    {
      aplica: true,
      destinosAutorizadosIds: ["vip", "tg"],
      motivo: "snapshot_operacional",
      fonte: "campo_operacional"
    }
  );

  const legado = clone();
  const restricaoLegada = resolverRestricaoDestinosClonador(legado);
  assert.strictEqual(restricaoLegada.fonte, "metadata_legada");
  assert.deepStrictEqual(restricaoLegada.destinosAutorizadosIds, ["vip"]);

  const vazio = resolverRestricaoDestinosClonador(clone({ destinosAutorizadosIds: [] }));
  assert.strictEqual(vazio.aplica, true);
  assert.strictEqual(vazio.motivo, "clonador_destinos_snapshot_vazio");
  assert.deepStrictEqual(vazio.destinosAutorizadosIds, []);

  const ausente = resolverRestricaoDestinosClonador({ origemFluxo: "clonador_grupos", metadata: {} });
  assert.strictEqual(ausente.aplica, true);
  assert.strictEqual(ausente.motivo, "clonador_destinos_snapshot_ausente");
  assert.deepStrictEqual(ausente.destinosAutorizadosIds, []);

  const optimus = resolverRestricaoDestinosClonador({
    origemFluxo: "optimus",
    destinosAutorizadosIds: ["vip"]
  });
  assert.strictEqual(optimus.aplica, false, "Optimus nao recebe restricao funcional Clone");
}

function testarIntersecaoCanais() {
  const workspace = [
    destino("vip", "whatsapp"),
    destino("geral", "whatsapp"),
    destino("tg", "telegram"),
    destino("discord", "discord")
  ];

  assert.deepStrictEqual(ids(filtrarDestinosAutorizadosClonador(workspace, clone({ destinosAutorizadosIds: ["vip"] }))), ["vip"]);
  assert.deepStrictEqual(ids(filtrarDestinosAutorizadosClonador(workspace, clone({ destinosAutorizadosIds: ["vip", "tg"] }))), ["vip", "tg"]);
  assert.deepStrictEqual(ids(filtrarDestinosAutorizadosClonador(workspace, clone({ destinosAutorizadosIds: ["discord"] }))), ["discord"]);
  assert.deepStrictEqual(ids(filtrarDestinosAutorizadosClonador(workspace, clone({ destinosAutorizadosIds: ["vip"] }), item => item.id)), ["vip"]);

  const removido = filtrarDestinosAutorizadosClonador(workspace, clone({ destinosAutorizadosIds: ["removido"] }));
  assert.deepStrictEqual(ids(removido), []);
  assert.deepStrictEqual(removido.rejeitadosForaSnapshot, ["vip", "geral", "tg", "discord"]);

  const desativado = filtrarDestinosAutorizadosClonador(
    [destino("vip", "whatsapp", { ativo: false }), destino("geral")],
    clone({ destinosAutorizadosIds: ["vip"] })
  );
  assert.deepStrictEqual(ids(desativado), ["vip"], "estado operacional ainda sera avaliado sem substituir por Geral");

  assert.deepStrictEqual(
    ids(filtrarDestinosAutorizadosClonador(workspace, { origemFluxo: "optimus" })),
    ["vip", "geral", "tg", "discord"],
    "Optimus conserva todos os destinos do workspace"
  );
}

function testarCriacaoItemFila() {
  const itemClone = montarItemFilaEngine({
    id: 100,
    cliente_id: "workspace_a",
    origemFluxo: "clonador_grupos",
    marketplace: "amazon",
    titulo: "Produto Clone",
    metadata: { clonadorGrupos: { destinoIds: ["vip", "vip", "tg"] } }
  });
  assert.deepStrictEqual(itemClone.destinosAutorizadosIds, ["vip", "tg"]);
  assert.deepStrictEqual(itemClone.metadata.clonadorGrupos.destinoIds, ["vip", "vip", "tg"], "metadata original permanece intacta");

  const itemCloneAusente = montarItemFilaEngine({
    id: 101,
    cliente_id: "workspace_a",
    origemFluxo: "clonador_grupos",
    marketplace: "amazon",
    titulo: "Produto Clone sem snapshot",
    metadata: {}
  });
  assert.deepStrictEqual(itemCloneAusente.destinosAutorizadosIds, [], "Clone sem snapshot nasce fail-closed");

  const itemOptimus = montarItemFilaEngine({
    id: 102,
    cliente_id: "workspace_a",
    origemFluxo: "optimus",
    marketplace: "amazon",
    titulo: "Produto Optimus",
    metadata: {}
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(itemOptimus, "destinosAutorizadosIds"), false);
}

function testarSerializacaoRestart() {
  const item = montarItemFilaEngine({
    id: 200,
    cliente_id: "workspace_a",
    origemFluxo: "clonador_grupos",
    marketplace: "amazon",
    titulo: "Persistencia Clone",
    metadata: { clonadorGrupos: { destinoIds: ["vip", "tg"] } }
  });
  const restauradoLegacy = JSON.parse(JSON.stringify([item]));
  assert.deepStrictEqual(restauradoLegacy[0].destinosAutorizadosIds, ["vip", "tg"]);

  const entradasV2 = normalizarEntradasViva(JSON.parse(JSON.stringify([item])));
  assert.deepStrictEqual(entradasV2[0].item.destinosAutorizadosIds, ["vip", "tg"]);

  const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const inicioAnalise = fonteIndex.indexOf("function analisarDestinosCompativeisFila");
  const fimAnalise = fonteIndex.indexOf("// ========== FUNCAO DESTINO DENTRO HORARIO", inicioAnalise);
  const analise = fonteIndex.slice(inicioAnalise, fimAnalise);
  assert(analise.includes("filtrarDestinosAutorizadosClonador"), "a selecao central deve filtrar antes de diagnostico e envio");
  assert(fonteIndex.includes("[CLONADOR-DESTINOS-RESTRICAO]"), "telemetria minima deve existir no Executor");
}

testarContratoRestricao();
testarIntersecaoCanais();
testarCriacaoItemFila();
testarSerializacaoRestart();
console.log("p0-2-destinos-clonador-executor.test.js OK");
