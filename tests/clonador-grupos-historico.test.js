"use strict";

const assert = require("assert");
const express = require("express");
const http = require("http");
const { criarHistoricoClonador, itemPublico, statusPublico, lerCursor } = require("../modules/clonador-grupos/historico.service");
const { criarServicoClonadorGrupos } = require("../modules/clonador-grupos/service");
const criarRotasClonadorGrupos = require("../modules/clonador-grupos/routes");
const { criarRepositorioClonadorGrupos } = require("../modules/clonador-grupos/repository");

function buffer(id, extras = {}) {
  return {
    id: String(id), sessaoId: "sessao-a", grupoJid: "grupo-a@g.us", grupoNome: "Grupo A",
    capturadoEm: "2026-09-10T10:00:00.000Z", status: "pronta", metadata: { clonadorGrupos: { bufferId: String(id) } },
    ...extras
  };
}

function ouvir(app) {
  return new Promise(resolve => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function requisitar(server, caminho, clienteId) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1", port: server.address().port, path: caminho, method: "GET",
      headers: { "x-cliente-id": clienteId }
    }, resposta => {
      let corpo = "";
      resposta.on("data", parte => { corpo += parte; });
      resposta.on("end", () => resolve({ status: resposta.statusCode, body: corpo ? JSON.parse(corpo) : null }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function main() {
  const repetida = itemPublico(buffer(1, { metadata: { clonadorHistorico: { repeticao: { quantidade: 2, motivoCodigo: "mensagem_duplicada" } } } }));
  assert.equal(repetida.status, "repetida");
  assert.equal(repetida.motivoCodigo, "mensagem_duplicada");

  const erro = itemPublico(buffer(2, { status: "erro", metadata: { clonadorGruposBridge: { motivo: "query_falhou" } } }));
  assert.equal(erro.status, "erro");
  assert.equal(erro.motivoCodigo, "query_falhou");

  const enviado = itemPublico(buffer(3), { checkpoints: [{ estado: "enviado" }], ofertas: [{ id: 9, titulo: "Produto seguro", marketplace: "amazon", preco: 99, cupom: "X" }] });
  assert.equal(enviado.status, "enviada");
  assert.equal(enviado.produto.titulo, "Produto seguro");
  assert.equal(enviado.produto.cupomPresente, true);
  assert.equal(JSON.stringify(enviado).includes("textoOriginal"), false);
  assert.equal(JSON.stringify(enviado).includes("links"), false);

  const multialvo = (estados) => statusPublico({ buffer: buffer(30), checkpoints: estados.map(estado => ({ estado })) }).status;
  assert.equal(multialvo(["enviado", "enviado"]), "enviada");
  assert.equal(multialvo(["enviado", "falha_confirmada"]), "parcial");
  assert.equal(multialvo(["enviado", "resultado_ambiguo"]), "parcial");
  assert.equal(multialvo(["falha_confirmada", "falha_confirmada"]), "falhou");
  assert.equal(multialvo(["preparado", "envio_iniciado"]), "pendente");
  assert.equal(multialvo(["resultado_ambiguo"]), "pendente");
  assert.equal(multialvo(["resultado_ambiguo"]), "pendente", "Telegram 2xx sem message_id permanece pendente no historico");

  const terminais = [
    ["sem_destino", "sem_destino"], ["sem_destino_apto", "sem_destino"],
    ["sem_destino_compativel", "sem_destino"], ["sem_clientes_operacionais", "sem_destino"],
    ["nenhum_destino_compativel", "sem_destino"], ["categoria_incompativel", "incompativel"],
    ["origem_nao_permitida", "incompativel"], ["flow_expirada_frescor_comercial", "expirada"],
    ["duplicidade_fila", "repetida"], ["sem_melhoria_financeira_janela_2h", "repetida"],
    ["repetida_no_executor_2h", "repetida"], ["destino_ja_enviado", "repetida"]
  ];
  for (const [motivo, status] of terminais) {
    const item = itemPublico(buffer(`t-${motivo}`, { metadata: { historicoResumo: { statusCodigo: status, resultadoAgregado: status, motivoCodigo: motivo } } }));
    assert.equal(item.status, status, motivo);
  }
  const terminalErro = itemPublico(buffer("erro-terminal", { metadata: { historicoResumo: { statusCodigo: "erro", motivoCodigo: "falha_importacao_terminal" } } }));
  assert.equal(terminalErro.status, "erro");

  const sobrevivente = itemPublico(buffer("sobrevive", { metadata: { historicoResumo: {
    marketplace: "amazon", titulo: "Produto seguro", imagem: "https://imagem.test/a.jpg", preco: 10, precoAnterior: 20,
    cupomPresente: true, beneficioPresente: true, statusCodigo: "enviada", resultadoAgregado: "enviada",
    motivoCodigo: "", jobIds: ["701"], ofertaIds: ["801"], destinos: { total: 2, enviados: 2, pendentes: 0, falharam: 0 }
  } } }));
  assert.equal(sobrevivente.status, "enviada");
  assert.equal(sobrevivente.grupoFonte.grupoJid, "grupo-a@g.us");
  assert.equal(sobrevivente.produto.marketplace, "amazon");
  assert.equal(sobrevivente.produto.titulo, "Produto seguro");
  assert.equal(sobrevivente.destinosResumo.enviados, 2);
  assert.equal(sobrevivente.produto.imagem, "https://imagem.test/a.jpg");
  assert.equal(sobrevivente.produto.preco, 10);
  assert.equal(sobrevivente.produto.precoAnterior, 20);
  assert.equal(sobrevivente.produto.cupomPresente, true);
  assert.equal(sobrevivente.produto.beneficioPresente, true);
  assert.equal(sobrevivente.motivoCodigo, "");
  assert.equal(sobrevivente.resultadoAgregado, "enviada");
  assert.deepEqual(sobrevivente.jobIds, ["701"]);
  assert.deepEqual(sobrevivente.ofertaIds, ["801"]);
  assert.equal(JSON.stringify(sobrevivente).includes("metadata"), false);
  assert.throws(() => lerCursor("invalido"), /cursor_historico_invalido/);

  const chamadas = [];
  const repository = {
    async listarHistoricoBase(clienteId, filtros) { chamadas.push([clienteId, filtros]); return [buffer(4)]; },
    async buscarContextoHistorico() { return { eventos: [], jobs: [], ofertas: [], fila: [], checkpoints: [] }; },
    async obterHistoricoBasePorId(clienteId, id) { return clienteId === "workspace-a" && String(id) === "4" ? buffer(4) : null; }
  };
  const historico = criarHistoricoClonador({ repository });
  const pagina = await historico.listar("workspace-a", { limit: 25 });
  assert.equal(pagina.itens.length, 1);
  assert.equal(pagina.itens[0].origemFluxo, "clonador_grupos");
  assert.equal(chamadas[0][0], "workspace-a");
  assert.strictEqual(pagina.proximoCursor, null, "fim da pagina nao inventa cursor");
  const detalhe = await historico.detalhe("workspace-a", "4");
  assert.equal(detalhe.bufferId, "4");
  assert.equal(await historico.detalhe("workspace-b", "4"), null);

  const consultasFiltro = [];
  const repoFiltro = criarRepositorioClonadorGrupos({
    queryEngine: async (sql) => {
      consultasFiltro.push(sql);
      return { ok: true, resultado: { rows: [] } };
    }
  });
  await repoFiltro.listarHistoricoBase("workspace-a", { tipo: "repeticao", limit: 10 });
  const sqlRepeticao = consultasFiltro.at(-1);
  for (const motivo of [
    "evento_duplicado", "duplicidade_fila", "sem_melhoria_financeira_janela_2h",
    "repetida_no_executor_2h", "destino_ja_enviado", "fanout_destino_ja_enviado",
    "replay_buffer", "mesma_mensagem", "mensagem_duplicada", "mesma_condicao_comercial_janela_2h"
  ]) assert(sqlRepeticao.includes(`'${motivo}'`), `tipo=repeticao inclui ${motivo}`);

  let resolucoes = 0;
  const cem = Array.from({ length: 100 }, (_, indice) => buffer(indice + 100, {
    metadata: { historicoResumo: { filaItemIds: [`fila-${indice + 100}`], statusCodigo: indice === 99 ? "enviada" : "na_fila" } }
  }));
  const historicoPaginado = criarHistoricoClonador({
    repository: {
      async listarHistoricoBase() { return cem; },
      async buscarContextoHistorico() { return { eventos: [], jobs: [], ofertas: [], fila: [], checkpoints: [] }; }
    },
    async resolverFilaPorIds(_clienteId, ids) {
      resolucoes += 1;
      assert.equal(ids.length, 100);
      return ids.map(id => ({ id, status: id === "fila-199" ? "enviado" : "pendente", metadata: { clonadorGrupos: { bufferId: id.replace("fila-", "") } } }));
    },
    async listarCheckpoints({ filaItemIds }) {
      assert.equal(filaItemIds.length, 100);
      return [{ filaItemId: "fila-199", destinoChave: "d", alvoChave: "a", estado: "enviado" }];
    }
  });
  const paginaCem = await historicoPaginado.listar("workspace-a", { limit: 100 });
  assert.equal(paginaCem.itens.length, 100);
  assert.equal(paginaCem.itens.at(-1).status, "enviada");
  assert.equal(resolucoes, 1, "consulta fila bounded por IDs, sem N+1");

  // Exercita a mesma factory usada no bootstrap: o resolvedor por IDs precisa
  // atravessar service -> historico, sem injetar historico artificial no teste.
  let resolucoesFactory = 0;
  const repoFactory = {
    async listarHistoricoBase() { return cem; },
    async buscarContextoHistorico() { return { eventos: [], jobs: [], ofertas: [], fila: [], checkpoints: [] }; },
    async obterHistoricoBasePorId(clienteId, id) { return clienteId === "workspace-a" ? (cem.find(item => item.id === String(id)) || null) : null; }
  };
  const serviceFactory = criarServicoClonadorGrupos({
    repository: repoFactory,
    usuarioTemRecurso: () => true,
    getClienteId: request => request.clienteId,
    resolverFilaPorIds: async (_clienteId, ids) => {
      resolucoesFactory += 1;
      assert([1, 100].includes(ids.length), "listagem pagina 100 e detalhe usam somente os IDs correlacionados");
      return ids.map(id => ({ id, status: id === "fila-199" ? "enviado" : "pendente", metadata: { clonadorGrupos: { bufferId: id.replace("fila-", "") } } }));
    },
    listarCheckpoints: async ({ filaItemIds }) => [{ filaItemId: filaItemIds.at(-1), destinoChave: "destino-a", alvoChave: "alvo-a", estado: "enviado", providerMessageId: "provider-seguro" }]
  });
  const paginaFactory = await serviceFactory.listarHistorico({ clienteId: "workspace-a" }, { limit: 100 });
  assert.equal(paginaFactory.itens.length, 100);
  assert.equal(paginaFactory.itens.at(-1).status, "enviada");
  assert.equal(resolucoesFactory, 1, "factory real usa lookup bounded O(pageSize) pelo indice oficial");
  const detalheFactory = await serviceFactory.obterHistorico({ clienteId: "workspace-a" }, "199");
  assert.equal(detalheFactory.item.destinos[0].alvos[0].providerMessageId, "provider-seguro", "provider id aparece apenas no detalhe correlacionado");

  const checkpointsPorCliente = [
    { clienteId: "workspace-a", filaItemId: "fila-a", destinoChave: "destino", alvoChave: "alvo", estado: "enviado", providerMessageId: "provider-a" },
    { clienteId: "workspace-b", filaItemId: "fila-b", destinoChave: "destino", alvoChave: "alvo", estado: "enviado", providerMessageId: "provider-b" }
  ];
  const buffersPorCliente = {
    "workspace-a": buffer("a", { metadata: { historicoResumo: { filaItemIds: ["fila-a"] } } }),
    "workspace-b": buffer("b", { metadata: { historicoResumo: { filaItemIds: ["fila-b"] } } })
  };
  const historicoIsolado = criarHistoricoClonador({
    repository: {
      async obterHistoricoBasePorId(clienteId, id) { return buffersPorCliente[clienteId]?.id === String(id) ? buffersPorCliente[clienteId] : null; },
      async buscarContextoHistorico() { return { eventos: [], jobs: [], ofertas: [], fila: [], checkpoints: [] }; }
    },
    resolverFilaPorIds: async (clienteId, ids) => ids.map(id => ({ id, status: "pendente", metadata: { clonadorGrupos: { bufferId: clienteId === "workspace-a" ? "a" : "b" } } })),
    listarCheckpoints: async ({ clienteId, filaItemIds }) => checkpointsPorCliente.filter(item => item.clienteId === clienteId && filaItemIds.includes(item.filaItemId))
  });
  const detalheAIsolado = await historicoIsolado.detalhe("workspace-a", "a");
  assert.equal(detalheAIsolado.destinos[0].alvos[0].providerMessageId, "provider-a");
  assert.equal(JSON.stringify(detalheAIsolado).includes("provider-b"), false, "detalhe A nao recebe checkpoint de B");

  const appReal = express();
  appReal.use((request, _res, next) => { request.clienteId = request.header("x-cliente-id") || ""; next(); });
  appReal.use("/clonador-grupos", criarRotasClonadorGrupos({ service: serviceFactory }));
  const serverReal = await ouvir(appReal);
  try {
    const paginaReal = await requisitar(serverReal, "/clonador-grupos/historico?limit=100&clienteId=workspace-b", "workspace-a");
    assert.equal(paginaReal.status, 200);
    assert.equal(paginaReal.body.itens.length, 100, "rota real ignora clienteId injetado na query");
    const detalheAlheioReal = await requisitar(serverReal, "/clonador-grupos/historico/199", "workspace-b");
    assert.equal(detalheAlheioReal.status, 404, "rota real + service real nao expõem detalhe cross-workspace");
  } finally {
    await new Promise(resolve => serverReal.close(resolve));
  }

  const app = express();
  app.use((req, _res, next) => { req.clienteId = req.header("x-cliente-id") || ""; next(); });
  app.use("/clonador-grupos", criarRotasClonadorGrupos({
    service: {
      async listarHistorico(req, filtros) {
        assert.equal(req.clienteId, "workspace-a", "a rota usa somente o workspace autenticado");
        assert.equal(filtros.status, "enviada");
        assert.equal(filtros.limit, "1");
        return { ok: true, itens: [{ bufferId: "seguro", status: "enviada", produto: { titulo: "Seguro" } }], proximoCursor: null };
      },
      async obterHistorico(req, bufferId) {
        if (req.clienteId !== "workspace-a" || bufferId !== "seguro") {
          const erro = new Error("historico_nao_encontrado"); erro.codigo = "historico_nao_encontrado"; erro.statusCode = 404; throw erro;
        }
        return { ok: true, item: { bufferId: "seguro", status: "enviada", produto: { titulo: "Seguro" } } };
      }
    }
  }));
  const server = await ouvir(app);
  try {
    const listaHttp = await requisitar(server, "/clonador-grupos/historico?status=enviada&limit=1&clienteId=workspace-b", "workspace-a");
    assert.equal(listaHttp.status, 200);
    assert.equal(listaHttp.body.itens[0].bufferId, "seguro");
    assert.equal(JSON.stringify(listaHttp.body).includes("clienteId"), false, "lista publica nao vaza o escopo solicitado");
    const alheio = await requisitar(server, "/clonador-grupos/historico/seguro", "workspace-b");
    assert.equal(alheio.status, 404, "detalhe de outro workspace nao e exposto");
    assert.equal(alheio.body.codigo, "historico_nao_encontrado");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log("clonador-grupos-historico.test.js OK");
}

main().catch((erro) => { console.error(erro); process.exitCode = 1; });
