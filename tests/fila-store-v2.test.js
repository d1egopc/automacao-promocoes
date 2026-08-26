"use strict";

const assert = require("assert");

const filaOfertas = require("../utils/fila-ofertas");
const {
  criarFilaStore,
  chavesFingerprint,
  itemVivoOperacional,
  JANELA_EXECUTOR_MS
} = require("../modules/fila/fila-store");
const {
  FILA_VIVA_ARQUIVO,
  FILA_HISTORICO_ARQUIVO,
  classificarItemFilaV2,
  projetarFilaV2,
  projetarFilaV2Shadow,
  obterFilaLegadaUnificada,
  criarControladorFilaV2Shadow
} = require("../modules/fila/fila-v2-shadow");

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

{
  assert.deepStrictEqual(
    classificarItemFilaV2(oferta("pendente", { status: "pendente" }), { agora: AGORA }),
    { bucket: "viva", motivo: "status_operacional" },
    "pendente deve ficar na fila viva"
  );
  assert.deepStrictEqual(
    classificarItemFilaV2(oferta("processando", { status: "processando" }), { agora: AGORA }),
    { bucket: "viva", motivo: "status_operacional" },
    "processando deve ficar na fila viva"
  );
  assert.deepStrictEqual(
    classificarItemFilaV2(oferta("enviando", { status: "enviando" }), { agora: AGORA }),
    { bucket: "viva", motivo: "status_operacional" },
    "enviando deve ficar na fila viva"
  );
  assert.deepStrictEqual(
    classificarItemFilaV2(oferta("erro_rec", { status: "erro", proximaTentativaEnvioEm: new Date(AGORA + 60000).toISOString() }), { agora: AGORA }),
    { bucket: "viva", motivo: "status_operacional" },
    "erro recuperavel deve ficar na fila viva"
  );
  assert.deepStrictEqual(
    classificarItemFilaV2(oferta("retida_operacional", { status: "retida", motivoRetencao: "aguardando intervalo" }), { agora: AGORA }),
    { bucket: "viva", motivo: "status_operacional" },
    "retida operacional deve ficar na fila viva"
  );
  assert.deepStrictEqual(
    classificarItemFilaV2(oferta("enviada_recente", { status: "enviado", enviadoEm: new Date(AGORA - 30 * 60 * 1000).toISOString() }), { agora: AGORA }),
    { bucket: "viva", motivo: "enviado_recente_executor_2h" },
    "enviado recente precisa permanecer vivo para anti-repeticao 2h"
  );
  assert.deepStrictEqual(
    classificarItemFilaV2(oferta("enviada_antiga", { status: "enviado", enviadoEm: new Date(AGORA - 4 * 60 * 60 * 1000).toISOString() }), { agora: AGORA }),
    { bucket: "historico", motivo: "status_terminal" },
    "enviado antigo deve ir para historico terminal"
  );
  assert.deepStrictEqual(
    classificarItemFilaV2(oferta("expirada", { status: "expirada_operacional" }), { agora: AGORA }),
    { bucket: "historico", motivo: "status_terminal" },
    "expirada operacional deve ir para historico"
  );
  assert.deepStrictEqual(
    classificarItemFilaV2(oferta("erro_final", { status: "erro_final" }), { agora: AGORA }),
    { bucket: "historico", motivo: "status_terminal" },
    "erro final deve ir para historico"
  );
  assert.deepStrictEqual(
    classificarItemFilaV2(oferta("retida_terminal", { status: "retida", motivoRetencao: "retida_sem_destino_compativel", retidaTerminal: true }), { agora: AGORA }),
    { bucket: "historico", motivo: "retida_terminal" },
    "retida terminal deve ir para historico"
  );
  assert.deepStrictEqual(
    classificarItemFilaV2(oferta("desconhecido", { status: "novo_status_operacional" }), { agora: AGORA }),
    { bucket: "viva", motivo: "fallback_conservador" },
    "status desconhecido deve permanecer vivo por seguranca"
  );
}

{
  const filaLegada = [
    oferta("p0", { status: "pendente" }),
    oferta("h0", { status: "enviado", enviadoEm: new Date(AGORA - 5 * 60 * 60 * 1000).toISOString() }),
    oferta("p1", { status: "processando" }),
    oferta("r0", { status: "retida", motivoRetencao: "retida_sem_destino_compativel", retidaTerminal: true }),
    oferta("e0", { status: "erro", proximaTentativaEnvioEm: new Date(AGORA + 10 * 60 * 1000).toISOString() }),
    oferta("h1", { status: "expirada_operacional" }),
    oferta("recent", { status: "enviado", enviadoEm: new Date(AGORA - 15 * 60 * 1000).toISOString() })
  ];
  const projecao = projetarFilaV2(filaLegada, { agora: AGORA });

  assert.strictEqual(projecao.ok, true, "projecao deve recompor a fila legada sem divergencias");
  assert.strictEqual(projecao.totalLegado, 7);
  assert.strictEqual(projecao.totalViva, 4);
  assert.strictEqual(projecao.totalHistorico, 3);
  assert.deepStrictEqual(
    projecao.unificada.map(item => item.id),
    filaLegada.map(item => item.id),
    "visao unificada deve preservar ordem e indices legados"
  );
  assert.deepStrictEqual(
    projecao.unificada.map(item => item.status),
    filaLegada.map(item => item.status),
    "visao unificada deve preservar status legados"
  );
}

{
  const memoria = {};
  const logs = [];
  const clienteId = "cliente_shadow";
  const filaLegada = [];
  for (let i = 0; i < 8300; i += 1) {
    filaLegada.push(oferta(`hist_shadow_${i}`, {
      clienteId,
      status: i % 3 === 0 ? "enviado" : "expirada_operacional",
      enviadoEm: new Date(AGORA - 24 * 60 * 60 * 1000).toISOString()
    }));
  }
  for (let i = 0; i < 200; i += 1) {
    filaLegada.push(oferta(`vivo_shadow_${i}`, { clienteId, status: i % 2 === 0 ? "pendente" : "processando" }));
  }
  filaLegada.push(oferta("recente_shadow", {
    clienteId,
    status: "enviado",
    enviadoEm: new Date(AGORA - 20 * 60 * 1000).toISOString(),
    produtoId: "MLB_RECENTE_SHADOW"
  }));

  function chave(cliente, arquivo) {
    return `${cliente}/${arquivo}`;
  }

  const writeClienteJson = (cliente, arquivo, dados) => {
    memoria[chave(cliente, arquivo)] = JSON.parse(JSON.stringify(dados));
    return true;
  };
  const readClienteJson = (cliente, arquivo, fallback) => {
    const valor = memoria[chave(cliente, arquivo)];
    return valor === undefined ? JSON.parse(JSON.stringify(fallback)) : JSON.parse(JSON.stringify(valor));
  };
  const getClienteJsonPath = (cliente, arquivo) => `${cliente}/${arquivo}`;
  const logger = {
    log: (...args) => logs.push(args.join(" "))
  };

  const resultado = projetarFilaV2Shadow({
    fila: filaLegada,
    clienteId,
    agora: AGORA,
    motivo: "teste_fixture_producao",
    writeClienteJson,
    getClienteJsonPath,
    logger
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.totalLegado, 8501);
  assert.strictEqual(resultado.totalViva, 201, "200 vivos + 1 enviado recente devem ficar na fila viva");
  assert.strictEqual(resultado.totalHistorico, 8300);
  assert.strictEqual(resultado.divergencias, 0);
  assert(Array.isArray(memoria[chave(clienteId, FILA_VIVA_ARQUIVO)]), "shadow deve escrever fila-viva.json");
  assert(Array.isArray(memoria[chave(clienteId, FILA_HISTORICO_ARQUIVO)]), "shadow deve escrever fila-historico.json");
  assert(logs.some(linha => linha.includes("[FILA-V2-SHADOW]")), "telemetria shadow deve ser registrada");
  assert(!logs.join("\n").includes("Produto vivo_shadow_1"), "telemetria nao deve registrar titulo/payload");
  assert(!logs.join("\n").includes("https://produto.mercadolivre.com.br"), "telemetria nao deve registrar links");

  const unificada = obterFilaLegadaUnificada(clienteId, { readClienteJson });
  assert.strictEqual(unificada.fonte, "fila_v2_shadow");
  assert.deepStrictEqual(
    unificada.fila.map(item => item.id),
    filaLegada.map(item => item.id),
    "helper legado deve recompor ordem exata da fila original"
  );

  const store = criarFilaStore(unificada.fila);
  const resolucaoGlobal = store.resolverIndiceGlobalLegado(unificada.fila, clienteId, 8300);
  assert.strictEqual(resolucaoGlobal.ok, true);
  assert.strictEqual(resolucaoGlobal.item.id, "vivo_shadow_0", "indice global legado deve apontar para o item correto");

  const enviadaRecente = oferta("atual_shadow", {
    clienteId,
    produtoId: "MLB_RECENTE_SHADOW",
    linkOriginal: "https://produto.mercadolivre.com.br/MLB_RECENTE_SHADOW"
  });
  const legado = filaOfertas.consultarEnvioRecenteExecutor2h(filaLegada, enviadaRecente, { agora: AGORA });
  const recomposto = filaOfertas.consultarEnvioRecenteExecutor2h(unificada.fila, enviadaRecente, { agora: AGORA });
  assert.strictEqual(recomposto.bloqueada, legado.bloqueada, "anti-duplicidade 2h deve sobreviver a viva+historico");
  assert.strictEqual(recomposto.ofertaAnterior.id, "recente_shadow");
}

{
  const chamadas = [];
  const controlador = criarControladorFilaV2Shadow({
    intervaloMs: 1000,
    writeClienteJson: () => true,
    getClienteJsonPath: () => "",
    logger: { log: () => chamadas.push("log") }
  });
  const primeira = controlador.projetarSeNecessario({
    fila: [oferta("primeira")],
    clienteId: "cliente_throttle",
    agora: AGORA,
    motivo: "primeira"
  });
  const segunda = controlador.projetarSeNecessario({
    fila: [oferta("segunda")],
    clienteId: "cliente_throttle",
    agora: AGORA + 500,
    motivo: "segunda"
  });
  const terceira = controlador.projetarSeNecessario({
    fila: [oferta("terceira")],
    clienteId: "cliente_throttle",
    agora: AGORA + 500,
    motivo: "terceira",
    forcar: true
  });

  assert.strictEqual(primeira.ok, true);
  assert.strictEqual(segunda.pulou, true, "controlador deve evitar shadow write excessivo");
  assert.strictEqual(terceira.ok, true, "forcar deve permitir projecao imediata");
  assert.strictEqual(chamadas.length, 2, "somente projecoes reais devem logar");
}
