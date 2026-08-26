"use strict";

const assert = require("assert");

const filaOfertas = require("../utils/fila-ofertas");
const {
  criarFilaStore,
  chavesFingerprint,
  itemVivoOperacional,
  JANELA_EXECUTOR_MS
} = require("../modules/fila/fila-store");

const AGORA = new Date("2026-08-26T14:00:00.000Z").getTime();

function oferta(id, overrides = {}) {
  return {
    id,
    ofertaId: id,
    engineOfertaId: id,
    clienteId: "cliente_a",
    marketplace: "mercadolivre",
    titulo: `Oferta ${id}`,
    preco: 100,
    precoAtual: 100,
    produtoId: `MLB${id}`,
    linkOriginal: `https://produto.mercadolivre.com.br/${id}?tracking=1`,
    linkAfiliado: `https://meli.la/${id}`,
    status: "pendente",
    dataEntradaFila: new Date(AGORA - 30 * 60 * 1000).toISOString(),
    ...overrides
  };
}

function duplicidadeEngineLegada(fila, itemFila, clienteId = "cliente_a") {
  const cliente = String(clienteId || "admin");
  const engineOfertaId = itemFila.engineOfertaId || itemFila.engine_oferta_id || "";
  const linkOriginal = String(itemFila.linkOriginal || itemFila.link_original || "").toLowerCase().trim();
  const linkAfiliado = String(itemFila.linkAfiliado || itemFila.link || itemFila.linkFinal || "").toLowerCase().trim();
  const titulo = String(itemFila.titulo || itemFila.nome || "").toLowerCase().trim();
  const preco = Number.isFinite(Number(itemFila.preco || itemFila.precoAtual))
    ? Number(itemFila.preco || itemFila.precoAtual).toFixed(2)
    : String(itemFila.preco || itemFila.precoAtual || "").trim();

  return fila.some(item => {
    if (String(item?.clienteId || "admin") !== cliente) return false;
    if (engineOfertaId && String(item.engineOfertaId || "") === String(engineOfertaId)) return true;
    const itemLinkOriginal = String(item.linkOriginal || item.link_original || "").toLowerCase().trim();
    const itemLinkAfiliado = String(item.linkAfiliado || item.link || item.linkFinal || "").toLowerCase().trim();
    const itemTitulo = String(item.titulo || item.nome || "").toLowerCase().trim();
    const itemPreco = Number.isFinite(Number(item.preco || item.precoAtual))
      ? Number(item.preco || item.precoAtual).toFixed(2)
      : String(item.preco || item.precoAtual || "").trim();
    if (linkOriginal && (linkOriginal === itemLinkOriginal || linkOriginal === itemLinkAfiliado)) return true;
    if (linkAfiliado && (linkAfiliado === itemLinkAfiliado || linkAfiliado === itemLinkOriginal)) return true;
    return Boolean(titulo && preco && titulo === itemTitulo && preco === itemPreco);
  });
}

{
  const fila = [
    oferta("a1"),
    oferta("a2", { status: "processando" }),
    oferta("a3", { status: "enviado", enviadoEm: new Date(AGORA - 20 * 60 * 1000).toISOString() }),
    oferta("a4", { status: "enviado", enviadoEm: new Date(AGORA - 5 * 60 * 60 * 1000).toISOString() }),
    oferta("b1", { clienteId: "cliente_b" })
  ];
  const store = criarFilaStore(fila);
  const metricas = store.rebuild(fila, { agora: AGORA });

  assert.strictEqual(metricas.totalIndexado, 5, "rebuild deve indexar todos os itens por referencia");
  assert.strictEqual(store.itensPorCliente("cliente_a").length, 4, "indice por cliente deve separar workspaces");
  assert.strictEqual(store.vivosPorCliente("cliente_a").map(item => item.id).sort().join(","), "a1,a2");
  assert.strictEqual(store.enviadosRecentesPorCliente("cliente_a", AGORA).map(item => item.id).join(","), "a3");
}

{
  const fila = [oferta("novo")];
  const store = criarFilaStore(fila);
  assert.strictEqual(store.vivosPorCliente("cliente_a").length, 1);

  fila[0].status = "enviado";
  fila[0].enviadoEm = new Date(AGORA - 10 * 60 * 1000).toISOString();
  store.atualizarItem(fila[0], { agora: AGORA });
  assert.strictEqual(store.vivosPorCliente("cliente_a").length, 0, "mudanca de status deve sair de vivos");
  assert.strictEqual(store.enviadosRecentesPorCliente("cliente_a", AGORA).length, 1, "enviado recente deve entrar na janela 2h");

  store.removerItem(fila[0]);
  assert.strictEqual(store.itensPorCliente("cliente_a").length, 0, "remocao deve limpar indices");
}

{
  assert.strictEqual(itemVivoOperacional(oferta("p", { status: "pendente" })), true);
  assert.strictEqual(itemVivoOperacional(oferta("e", { status: "enviado" })), false);
  assert.strictEqual(
    itemVivoOperacional(oferta("r", { status: "retida", motivoRetencao: "aguardando intervalo" })),
    true,
    "retida operacional deve ser considerada viva"
  );
}

{
  const enviadaRecente = oferta("produto_igual", {
    id: "enviada_recente",
    engineOfertaId: "engine_antigo",
    status: "enviado",
    enviadoEm: new Date(AGORA - 15 * 60 * 1000).toISOString(),
    produtoId: "MLB777",
    linkOriginal: "https://produto.mercadolivre.com.br/MLB777"
  });
  const enviadaAntiga = oferta("antiga", {
    status: "enviado",
    enviadoEm: new Date(AGORA - JANELA_EXECUTOR_MS - 1000).toISOString(),
    produtoId: "MLB777"
  });
  const atual = oferta("atual", {
    produtoId: "MLB777",
    linkOriginal: "https://produto.mercadolivre.com.br/MLB777?utm=abc"
  });
  const fila = [enviadaRecente, enviadaAntiga, atual];
  const store = criarFilaStore(fila);
  store.rebuild(fila, { agora: AGORA });

  const legado = filaOfertas.consultarEnvioRecenteExecutor2h(fila, atual, { agora: AGORA });
  const candidatos = store.candidatosEnvioRecente2h(atual, { clienteId: "cliente_a", agora: AGORA });
  const indexado = filaOfertas.consultarEnvioRecenteExecutor2h(fila, atual, {
    agora: AGORA,
    obterItens: () => candidatos.ok ? candidatos.itens : fila
  });

  assert.strictEqual(candidatos.ok, true);
  assert.deepStrictEqual(
    indexado.bloqueada,
    legado.bloqueada,
    "consulta indexada de enviado recente deve preservar resultado legado"
  );
  assert.strictEqual(indexado.ofertaAnterior.id, legado.ofertaAnterior.id);
}

{
  const semFingerprint = { clienteId: "cliente_a", status: "pendente" };
  assert.strictEqual(chavesFingerprint(semFingerprint).length, 0, "sem chave segura deve permitir fallback legado");
  const store = criarFilaStore([semFingerprint]);
  const candidatos = store.candidatosPorFingerprint(semFingerprint);
  assert.strictEqual(candidatos.ok, false);
  assert.strictEqual(candidatos.motivo, "sem_fingerprint_seguro");
}

{
  const fila = [
    oferta("outro", { clienteId: "cliente_b" }),
    oferta("a_enviado", { status: "enviado" }),
    oferta("a_pendente_1"),
    oferta("a_pendente_2")
  ];
  const store = criarFilaStore(fila);
  const deleteGlobal = store.resolverIndiceGlobalLegado(fila, "cliente_b", 0);
  assert.strictEqual(deleteGlobal.ok, true);
  assert.strictEqual(deleteGlobal.indexReal, 0);

  const semPermissao = store.resolverIndiceGlobalLegado(fila, "cliente_a", 0);
  assert.strictEqual(semPermissao.ok, false);
  assert.strictEqual(semPermissao.motivo, "sem_permissao");

  const enviarAgora = store.resolverIndiceClienteLegado(fila, "cliente_a", 0, { preferirPendente: true });
  assert.strictEqual(enviarAgora.ok, true);
  assert.strictEqual(enviarAgora.item.id, "a_pendente_1", "fallback pendente por indice deve preservar rota enviar-agora");
  assert.strictEqual(enviarAgora.indexReal, 2);
}

{
  const filaGrande = [];
  for (let i = 0; i < 8000; i += 1) {
    filaGrande.push(oferta(`hist_${i}`, {
      status: i % 2 === 0 ? "enviado" : "expirada_operacional",
      enviadoEm: new Date(AGORA - 24 * 60 * 60 * 1000).toISOString(),
      dataEntradaFila: new Date(AGORA - 24 * 60 * 60 * 1000).toISOString()
    }));
  }
  for (let i = 0; i < 190; i += 1) {
    filaGrande.push(oferta(`pendente_${i}`, { status: "pendente" }));
  }

  const heapAntes = process.memoryUsage().heapUsed;
  const inicioLegado = process.hrtime.bigint();
  const pendentesLegado = filaGrande.filter(item => item.clienteId === "cliente_a" && item.status === "pendente");
  const duracaoLegadoMs = Number(process.hrtime.bigint() - inicioLegado) / 1e6;

  const store = criarFilaStore();
  const inicioStore = process.hrtime.bigint();
  const metricas = store.rebuild(filaGrande, { agora: AGORA });
  const pendentesStore = store.vivosPorCliente("cliente_a").filter(item => item.status === "pendente");
  const duracaoStoreMs = Number(process.hrtime.bigint() - inicioStore) / 1e6;
  const heapDepois = process.memoryUsage().heapUsed;

  assert.strictEqual(metricas.totalIndexado, 8190);
  assert.deepStrictEqual(
    pendentesStore.map(item => item.id),
    pendentesLegado.map(item => item.id),
    "fixture grande deve preservar candidatos pendentes"
  );
  assert(heapDepois >= heapAntes, "medicao de heap deve ser coletada sem depender de GC");
  assert(Number.isFinite(duracaoLegadoMs));
  assert(Number.isFinite(duracaoStoreMs));
}

{
  const fila = [
    oferta("x1", { engineOfertaId: "engine_x" }),
    oferta("x2", { engineOfertaId: "engine_y", titulo: "Produto X", preco: 77, precoAtual: 77 })
  ];
  const store = criarFilaStore(fila);
  const nova = oferta("x3", {
    engineOfertaId: "engine_z",
    titulo: "Produto X",
    preco: 77,
    precoAtual: 77,
    produtoId: ""
  });
  const candidatos = store.candidatosPorFingerprint(nova);
  const indexado = candidatos.ok
    ? duplicidadeEngineLegada(candidatos.itens, nova, "cliente_a")
    : duplicidadeEngineLegada(fila, nova, "cliente_a");
  const legado = duplicidadeEngineLegada(fila, nova, "cliente_a");
  assert.strictEqual(indexado, legado, "duplicidade engine por titulo+preco deve ser equivalente");
}
