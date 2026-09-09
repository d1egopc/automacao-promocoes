"use strict";

const assert = require("assert");
const {
  criarRecoveryCheckpointEntrega,
  sincronizarAlvosEnviadosPorCheckpoint
} = require("../modules/fila/fila-checkpoint-recovery.service");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function checkpoint(estado, extra = {}) {
  return {
    clienteId: "workspace_a",
    filaItemId: "fila_1",
    destinoChave: "whatsapp:destino_1",
    alvoChave: "grupo:a",
    attemptId: A,
    estado,
    creditoDebitado: null,
    ...extra
  };
}

function item(extra = {}) {
  return { id: "fila_1", clienteId: "workspace_a", status: "processando", origemFluxo: "clonador_grupos", ...extra };
}

function criarRepo(linhas = [], opcoes = {}) {
  const chamadas = [];
  return {
    chamadas,
    async listarCheckpointsEntregaPorItens({ filaItemIds = [], limite }) {
      chamadas.push({ tipo: "listar_lote", filaItemIds: [...filaItemIds], limite });
      if (opcoes.erroListar) throw new Error("pg indisponivel");
      const ids = new Set(filaItemIds);
      return linhas.filter(atual => ids.has(atual.filaItemId)).map(atual => ({ ...atual }));
    },
    async listarCheckpointsEntregaPorItem({ filaItemId }) {
      chamadas.push({ tipo: "listar_item", filaItemId });
      return linhas.filter(atual => atual.filaItemId === filaItemId).map(atual => ({ ...atual }));
    },
    async transicionarCheckpointEntrega(entrada) {
      chamadas.push({ tipo: "transicionar", entrada });
      return { transicionado: false };
    }
  };
}

function criarAdvisory({ ocupado = false } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async adquirir() {
      chamadas.push("adquirir");
      return ocupado ? { resultado: "ocupado" } : { resultado: "adquirido", handle: { client: { query() {} } } };
    },
    async finalizar() { chamadas.push("finalizar"); }
  };
}

async function executar(linhas, extra = {}) {
  const repository = criarRepo(linhas, extra.repo);
  const advisory = criarAdvisory(extra.advisory);
  const service = criarRecoveryCheckpointEntrega({ repository, advisory, logger: { log() {} }, limite: extra.limite || 8 });
  const itens = extra.itens || [item()];
  const recuperaveis = [];
  const sincronizados = [];
  const resultado = await service.recuperarCliente({
    clienteId: "workspace_a",
    itens,
    relocalizarItem: extra.relocalizarItem || (({ filaItemId }) => itens.find(atual => atual.id === filaItemId) || null),
    onRecuperavel: ({ item: atual }) => recuperaveis.push(atual.id),
    onSincronizarEnviado: ({ item: atual, checkpoints }) => {
      sincronizados.push({ id: atual.id, checkpoints });
      return extra.sincronizar === false ? false : true;
    }
  });
  return { repository, advisory, recuperaveis, sincronizados, resultado };
}

async function testarPreparadoRecuperavel() {
  const r = await executar([checkpoint("preparado")]);
  assert.deepStrictEqual(r.recuperaveis, ["fila_1"]);
  assert.strictEqual(r.resultado.resultados[0].decisao, "recuperavel");
}

async function testarPreparadoComEnviadoNaoReabreItem() {
  const r = await executar([checkpoint("preparado", { alvoChave: "grupo:a" }), checkpoint("enviado", { alvoChave: "grupo:b" })]);
  assert.deepStrictEqual(r.recuperaveis, []);
  assert.strictEqual(r.sincronizados.length, 1, "somente a evidencia enviada pode ser sincronizada");
  assert.strictEqual(r.resultado.resultados[0].decisao, "sincronizado");

  const semSnapshot = await executar([
    checkpoint("preparado", { alvoChave: "grupo:a" }),
    checkpoint("enviado", { alvoChave: "grupo:b" })
  ], { sincronizar: false });
  assert.deepStrictEqual(semSnapshot.recuperaveis, []);
  assert.strictEqual(semSnapshot.resultado.resultados[0].decisao, "sem_acao", "sem alvo confiavel nao reabre nem conclui o item");
}

async function testarPreparadoComAmbiguoBloqueia() {
  const r = await executar([checkpoint("preparado"), checkpoint("resultado_ambiguo", { alvoChave: "grupo:b", attemptId: B })]);
  assert.deepStrictEqual(r.recuperaveis, []);
  assert.deepStrictEqual(r.sincronizados, []);
  assert.strictEqual(r.resultado.resultados[0].decisao, "bloqueado_ambiguo");
}

async function testarFalhaEAmbiguidadePermanecemConservadoras() {
  const falha = await executar([checkpoint("falha_confirmada")]);
  assert.strictEqual(falha.resultado.resultados[0].decisao, "sem_acao");
  assert.strictEqual(falha.repository.chamadas.filter(chamada => chamada.tipo === "transicionar").length, 0);
  const iniciado = await executar([checkpoint("envio_iniciado")]);
  assert.strictEqual(iniciado.resultado.resultados[0].decisao, "bloqueado_ambiguo");
  const ambiguo = await executar([checkpoint("resultado_ambiguo")]);
  assert.strictEqual(ambiguo.resultado.resultados[0].decisao, "bloqueado_ambiguo");
}

function estadoMultiAlvo() {
  return {
    destinosEstado: [{
      chave: "whatsapp:destino_1",
      estado: "aguardando",
      snapshotAlvos: [{ alvoId: "a" }, { alvoId: "b" }],
      alvosEstado: [{ alvoId: "a", estado: "pendente" }, { alvoId: "b", estado: "falha" }]
    }]
  };
}

function testarSincronizacaoEstritaPorAlvo() {
  const oferta = estadoMultiAlvo();
  const alterou = sincronizarAlvosEnviadosPorCheckpoint(oferta, [checkpoint("enviado", { alvoChave: "grupo:a", creditoDebitado: false })]);
  assert.strictEqual(alterou, true);
  assert.strictEqual(oferta.destinosEstado[0].alvosEstado[0].estado, "enviado");
  assert.strictEqual(oferta.destinosEstado[0].alvosEstado[1].estado, "falha", "alvo B permanece intacto");
  assert.notStrictEqual(oferta.destinosEstado[0].estado, "enviado", "um alvo nao conclui o destino inteiro");

  const semDestino = { destinosEstado: [] };
  assert.strictEqual(sincronizarAlvosEnviadosPorCheckpoint(semDestino, [checkpoint("enviado")]), false);
  assert.deepStrictEqual(semDestino.destinosEstado, [], "destino ausente nao e inventado");

  const semAlvos = { destinosEstado: [{ chave: "whatsapp:destino_1", estado: "aguardando", snapshotAlvos: [{ alvoId: "a" }] }] };
  assert.strictEqual(sincronizarAlvosEnviadosPorCheckpoint(semAlvos, [checkpoint("enviado")]), false);
  assert.strictEqual(semAlvos.destinosEstado[0].estado, "aguardando", "snapshot sem estado por alvo nao vira enviado globalmente");
}

async function testarCandidatosAtuaisBoundedPorItem() {
  const itens = [item({ id: "fila_1" }), item({ id: "fila_2" }), item({ id: "fila_3", status: "pendente" })];
  const linhas = [
    checkpoint("preparado", { filaItemId: "fila_1" }),
    checkpoint("preparado", { filaItemId: "fila_1", alvoChave: "grupo:b" }),
    checkpoint("preparado", { filaItemId: "fila_2" }),
    checkpoint("envio_iniciado", { filaItemId: "historico_fora_fila" })
  ];
  const r = await executar(linhas, { itens, limite: 2 });
  const lote = r.repository.chamadas.find(chamada => chamada.tipo === "listar_lote");
  assert.deepStrictEqual(lote.filaItemIds, ["fila_1", "fila_2"]);
  assert.strictEqual(lote.limite, 2);
  assert.deepStrictEqual(r.recuperaveis.sort(), ["fila_1", "fila_2"]);
  assert(!r.resultado.resultados.some(resultado => resultado.filaItemId === "historico_fora_fila"), "historico bloqueado fora da fila nao monopoliza o lote");
}

async function testarRelocalizacaoEAuditoriaFailClosed() {
  const stale = await executar([checkpoint("preparado")], { relocalizarItem: () => ({ ...item(), status: "pendente" }) });
  assert.deepStrictEqual(stale.recuperaveis, [], "item stale nao e persistido nem reaberto");
  assert.strictEqual(stale.resultado.resultados[0].decisao, "sem_acao");

  const ocupado = await executar([checkpoint("preparado")], { advisory: { ocupado: true } });
  assert.deepStrictEqual(ocupado.recuperaveis, []);
  assert.strictEqual(ocupado.resultado.resultados[0].decisao, "sem_acao");
  assert.strictEqual(ocupado.repository.chamadas.filter(chamada => chamada.tipo === "listar_item").length, 0);

  const erro = await executar([], { repo: { erroListar: true } });
  assert.strictEqual(erro.resultado.ok, false, "erro PostgreSQL e fail-closed");
}

async function testarHistoricoSemCheckpointCongelado() {
  const r = await executar([], { itens: [item()] });
  assert.deepStrictEqual(r.resultado.resultados, []);
  assert.deepStrictEqual(r.recuperaveis, []);
  assert.deepStrictEqual(r.sincronizados, []);
  assert.strictEqual(r.advisory.chamadas.length, 0, "historico sem checkpoint nao chega ao advisory");
}

async function testarHistoricosSemCheckpointNaoConsomemSlotsUteis() {
  const historicos = Array.from({ length: 20 }, (_, indice) => item({ id: `historico_${indice + 1}` }));
  const recuperavel = item({ id: "fila_com_checkpoint" });
  const r = await executar([
    checkpoint("preparado", { filaItemId: recuperavel.id })
  ], { itens: [...historicos, recuperavel] });

  const lote = r.repository.chamadas.find(chamada => chamada.tipo === "listar_lote");
  assert(lote.filaItemIds.includes(recuperavel.id), "item posterior com checkpoint entra na descoberta");
  assert.strictEqual(r.resultado.resultados.length, 1, "historicos sem checkpoint nao entram no lote util");
  assert.strictEqual(r.resultado.resultados[0].filaItemId, recuperavel.id);
  assert.deepStrictEqual(r.recuperaveis, [recuperavel.id]);
  assert.deepStrictEqual(r.advisory.chamadas, ["adquirir", "finalizar"]);
}

async function testarDiscoveryEBatchDeRecoveryContinuamBounded() {
  const historicos = Array.from({ length: 100 }, (_, indice) => item({ id: `historico_${indice + 1}` }));
  const comCheckpoint = Array.from({ length: 12 }, (_, indice) => item({ id: `checkpoint_${indice + 1}` }));
  const linhas = comCheckpoint.map(atual => checkpoint("preparado", { filaItemId: atual.id }));
  const r = await executar(linhas, { itens: [...historicos, ...comCheckpoint], limite: 8 });
  const lote = r.repository.chamadas.find(chamada => chamada.tipo === "listar_lote");

  assert.strictEqual(lote.filaItemIds.length, 32, "descoberta consulta no maximo 4x o lote util");
  assert(!lote.filaItemIds.includes("historico_1"), "nao volta a prender a descoberta nos primeiros historicos");
  assert.strictEqual(r.resultado.resultados.length, 8, "no maximo oito itens com checkpoint entram no recovery");
  assert.strictEqual(r.recuperaveis.length, 8);
  assert.strictEqual(r.advisory.chamadas.filter(chamada => chamada === "adquirir").length, 8);
}

(async () => {
  await testarPreparadoRecuperavel();
  await testarPreparadoComEnviadoNaoReabreItem();
  await testarPreparadoComAmbiguoBloqueia();
  await testarFalhaEAmbiguidadePermanecemConservadoras();
  testarSincronizacaoEstritaPorAlvo();
  await testarCandidatosAtuaisBoundedPorItem();
  await testarRelocalizacaoEAuditoriaFailClosed();
  await testarHistoricoSemCheckpointCongelado();
  await testarHistoricosSemCheckpointNaoConsomemSlotsUteis();
  await testarDiscoveryEBatchDeRecoveryContinuamBounded();
  console.log("fila-checkpoint-recovery.test.js OK");
})().catch(erro => {
  console.error(erro.stack || erro.message || erro);
  process.exit(1);
});
