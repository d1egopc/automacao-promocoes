"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

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
const filaOperacionalV2 = require("../modules/fila/fila-operacional-v2");
const filaDualRead = require("../modules/fila/fila-dual-read");
const { ordenarOfertasFilaViva } = require("../modules/executor/fila-viva.service");

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

{
  const escritas = [];
  const logs = [];
  const controlador = criarControladorFilaV2Shadow({
    intervaloMs: 1000,
    devePularShadowCompleto: ({ clienteId }) => clienteId === "cliente_canario",
    writeClienteJson: (cliente, arquivo) => {
      escritas.push({ cliente, arquivo });
      return true;
    },
    getClienteJsonPath: (cliente, arquivo) => `${cliente}/${arquivo}`,
    logger: { log: (...args) => logs.push(args.join(" ")) }
  });

  const canario = controlador.projetarSeNecessario({
    fila: [oferta("canario_vivo", { clienteId: "cliente_canario" })],
    clienteId: "cliente_canario",
    agora: AGORA,
    motivo: "salvarFila"
  });
  const canarioThrottled = controlador.projetarSeNecessario({
    fila: [oferta("canario_vivo_2", { clienteId: "cliente_canario" })],
    clienteId: "cliente_canario",
    agora: AGORA + 500,
    motivo: "carregarFila"
  });
  const legado = controlador.projetarSeNecessario({
    fila: [oferta("legado_vivo", { clienteId: "cliente_legado" })],
    clienteId: "cliente_legado",
    agora: AGORA,
    motivo: "salvarFila"
  });

  assert.strictEqual(canario.ok, true);
  assert.strictEqual(canario.shadowCompletoEvitado, true, "canario V2 deve evitar projecao shadow completa");
  assert.strictEqual(canarioThrottled.pulou, true, "skip de shadow completo tambem deve respeitar throttle");
  assert.strictEqual(legado.ok, true);
  assert.deepStrictEqual(
    escritas.map(item => `${item.cliente}/${item.arquivo}`),
    ["cliente_legado/fila-viva.json", "cliente_legado/fila-historico.json"],
    "workspace fora do canario deve manter shadow completo legado"
  );
  assert(logs.some(linha => linha.includes("shadowCompletoEvitado")), "telemetria deve registrar shadow completo evitado");
  assert(!logs.join("\n").includes("Oferta canario_vivo"), "telemetria de skip nao deve registrar payload");
}

function criarDepsFilaOperacionalTeste() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-fila-operacional-v2-"));
  const logs = [];

  function dirCliente(clienteId) {
    const dir = path.join(dataDir, "clientes", clienteId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function jsonPath(clienteId, arquivo) {
    return path.join(dirCliente(clienteId), arquivo);
  }

  function readJson(clienteId, arquivo, fallback) {
    const file = jsonPath(clienteId, arquivo);
    if (!fs.existsSync(file)) return JSON.parse(JSON.stringify(fallback));
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return JSON.parse(JSON.stringify(fallback));
    }
  }

  function writeJson(clienteId, arquivo, dados) {
    fs.writeFileSync(jsonPath(clienteId, arquivo), JSON.stringify(dados, null, 2));
    return true;
  }

  return {
    dataDir,
    logs,
    deps: {
      getClientePath: dirCliente,
      getClienteJsonPath: jsonPath,
      readClienteJson: readJson,
      writeClienteJson: writeJson,
      logger: { log: (...args) => logs.push(args.join(" ")) }
    }
  };
}

{
  const controlador = filaOperacionalV2.criarControladorFilaOperacionalV2({
    env: {},
    writeClienteJson: () => {
      throw new Error("nao_deveria_escrever_com_flag_desligada");
    }
  });
  const resultado = controlador.prepararSeHabilitado({
    clienteId: "cliente_flag",
    fila: [oferta("flag_1")]
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.pulou, true);
  assert.strictEqual(resultado.motivo, "flag_desativada", "2B.1 deve nascer inerte por padrao");
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const controlador = filaOperacionalV2.criarControladorFilaOperacionalV2({
    env: {
      FILA_V2_OPERACIONAL_ROLLOUT: "canary",
      FILA_V2_OPERACIONAL_CANARY_CLIENTES: "cliente_a,cliente_c"
    },
    ...deps
  });
  const clienteA = "cliente_a";
  const clienteB = "cliente_b";
  const clienteC = "cliente_c";
  const filaLegada = [
    oferta("a_vivo", { clienteId: clienteA, status: "pendente" }),
    oferta("a_recent", {
      clienteId: clienteA,
      status: "enviado",
      enviadoEm: new Date(AGORA - 30 * 60 * 1000).toISOString()
    }),
    oferta("a_hist", {
      clienteId: clienteA,
      status: "enviado",
      enviadoEm: new Date(AGORA - 5 * 60 * 60 * 1000).toISOString()
    }),
    oferta("b_vivo", { clienteId: clienteB, status: "pendente" }),
    oferta("b_hist", {
      clienteId: clienteB,
      status: "enviado",
      enviadoEm: new Date(AGORA - 5 * 60 * 60 * 1000).toISOString()
    })
  ];

  deps.writeClienteJson(clienteA, "fila.json", filaLegada.filter(item => item.clienteId === clienteA));
  deps.writeClienteJson(clienteB, "fila.json", filaLegada.filter(item => item.clienteId === clienteB));

  assert.strictEqual(controlador.deveUsarFilaV2Operacional(clienteA), true);
  assert.strictEqual(controlador.deveUsarFilaV2Operacional(clienteB), false);
  assert.strictEqual(controlador.deveUsarFilaV2Operacional(clienteC), true);

  const canaryA = controlador.sincronizarCanaryEscrita({
    clienteId: clienteA,
    fila: filaLegada,
    agora: AGORA,
    motivo: "teste_canario"
  });
  const skipB = controlador.sincronizarCanaryEscrita({
    clienteId: clienteB,
    fila: filaLegada,
    agora: AGORA,
    motivo: "teste_legado"
  });

  assert.strictEqual(canaryA.ok, true);
  assert.strictEqual(canaryA.pulou, false);
  assert.deepStrictEqual(
    deps.readClienteJson(clienteA, "fila-viva.json", []).map(item => item.id),
    ["a_vivo", "a_recent"],
    "workspace canario deve escrever fila viva sem misturar cliente"
  );
  assert.deepStrictEqual(
    deps.readClienteJson(clienteB, "fila-viva.json", []),
    [],
    "workspace legado nao deve receber escrita canaria"
  );
  assert.strictEqual(skipB.pulou, true);
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const controlador = filaOperacionalV2.criarControladorFilaOperacionalV2({
    env: {
      FILA_V2_OPERACIONAL_ROLLOUT: "global"
    },
    ...deps
  });
  const workspaceNovo = "workspace_novo";
  const filaLegada = [
    oferta("novo_vivo", { clienteId: workspaceNovo, status: "pendente" }),
    oferta("novo_hist", {
      clienteId: workspaceNovo,
      status: "enviado",
      enviadoEm: new Date(AGORA - 5 * 60 * 60 * 1000).toISOString()
    })
  ];

  deps.writeClienteJson(workspaceNovo, "fila.json", filaLegada);

  assert.strictEqual(controlador.deveUsarFilaV2Operacional(workspaceNovo), true);
  const global = controlador.sincronizarCanaryEscrita({
    clienteId: workspaceNovo,
    fila: filaLegada,
    agora: AGORA,
    motivo: "global_rollout"
  });

  assert.strictEqual(global.ok, true);
  assert.deepStrictEqual(
    deps.readClienteJson(workspaceNovo, "fila-viva.json", []).map(item => item.id),
    ["novo_vivo"],
    "workspace novo em rollout global deve participar automaticamente"
  );
}

{
  const { deps, logs } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_recovery";
  const filaLegada = [
    oferta("vivo_recovery", { clienteId, status: "pendente" }),
    oferta("recent_recovery", {
      clienteId,
      status: "enviado",
      enviadoEm: new Date(AGORA - 10 * 60 * 1000).toISOString()
    }),
    oferta("hist_recovery", {
      clienteId,
      status: "enviado",
      enviadoEm: new Date(AGORA - 4 * 60 * 60 * 1000).toISOString()
    })
  ];
  deps.writeClienteJson(clienteId, "fila.json", filaLegada);

  const leitura = filaOperacionalV2.lerFilaViva(clienteId, { ...deps, agora: AGORA });

  assert.strictEqual(leitura.ok, true);
  assert.strictEqual(leitura.recovery, true, "fila-viva ausente deve recuperar do legado");
  assert.deepStrictEqual(
    leitura.itens.map(item => item.id),
    ["vivo_recovery", "recent_recovery"],
    "recovery deve preservar pendente e enviado recente <2h na viva"
  );
  assert.strictEqual(
    deps.readClienteJson(clienteId, "fila-viva.json", []).length,
    2,
    "recovery deve escrever facade viva sem tocar na autoridade legado"
  );
  assert(!logs.join("\n").includes("Oferta vivo_recovery"), "telemetria operacional nao deve carregar titulo");
  assert(!logs.join("\n").includes("mercadolivre.com.br"), "telemetria operacional nao deve carregar link");
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_coerente";
  const filaLegada = [
    oferta("vivo_1", { clienteId, status: "pendente" }),
    oferta("recente_2", {
      clienteId,
      status: "enviado",
      enviadoEm: new Date(AGORA - 15 * 60 * 1000).toISOString()
    }),
    oferta("hist_3", {
      clienteId,
      status: "enviado",
      enviadoEm: new Date(AGORA - 5 * 60 * 60 * 1000).toISOString()
    })
  ];
  const projetada = projetarFilaV2(filaLegada, { agora: AGORA });
  deps.writeClienteJson(clienteId, "fila.json", filaLegada);
  deps.writeClienteJson(clienteId, "fila-viva.json", projetada.viva.map(entrada => entrada.item));

  const leitura = filaOperacionalV2.lerFilaViva(clienteId, { ...deps, agora: AGORA });

  assert.strictEqual(leitura.ok, true);
  assert.strictEqual(leitura.recovery, false);
  assert.strictEqual(leitura.fonte, "fila_viva");
  assert.strictEqual(leitura.comparacao.ok, true);
  assert.deepStrictEqual(leitura.itens.map(item => item.id), ["vivo_1", "recente_2"]);
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_divergente";
  const filaLegada = [
    oferta("vivo_1", { clienteId, status: "pendente" }),
    oferta("recente_2", {
      clienteId,
      status: "enviado",
      enviadoEm: new Date(AGORA - 15 * 60 * 1000).toISOString()
    }),
    oferta("hist_3", {
      clienteId,
      status: "enviado",
      enviadoEm: new Date(AGORA - 5 * 60 * 60 * 1000).toISOString()
    })
  ];
  deps.writeClienteJson(clienteId, "fila.json", filaLegada);
  deps.writeClienteJson(clienteId, "fila-viva.json", [
    oferta("vivo_1", { clienteId, status: "processando" }),
    oferta("extra_9", { clienteId, status: "pendente" })
  ]);

  const leitura = filaOperacionalV2.lerFilaViva(clienteId, { ...deps, agora: AGORA });

  assert.strictEqual(leitura.ok, true);
  assert.strictEqual(leitura.recovery, true, "fila viva divergente deve cair para recovery conservador");
  assert.strictEqual(leitura.motivoFallback, "viva_divergente_legado");
  assert(leitura.comparacao.divergencias > 0);
  assert(leitura.comparacao.idsAusentes.includes("recente_2"));
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_corrupto";
  deps.writeClienteJson(clienteId, "fila.json", [oferta("ok_corrupto", { clienteId })]);
  fs.writeFileSync(deps.getClienteJsonPath(clienteId, "fila-viva.json"), "{ json parcial");

  const leitura = filaOperacionalV2.lerFilaViva(clienteId, { ...deps, agora: AGORA });

  assert.strictEqual(leitura.ok, true);
  assert.strictEqual(leitura.fallbackLegado, true);
  assert.strictEqual(leitura.motivoFallback, "json_corrompido");
  assert.deepStrictEqual(leitura.itens.map(item => item.id), ["ok_corrupto"]);
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_vazio";
  deps.writeClienteJson(clienteId, "fila.json", [oferta("ok_vazio", { clienteId })]);
  fs.writeFileSync(deps.getClienteJsonPath(clienteId, "fila-viva.json"), "");

  const leitura = filaOperacionalV2.lerFilaViva(clienteId, { ...deps, agora: AGORA });

  assert.strictEqual(leitura.ok, true);
  assert.strictEqual(leitura.fallbackLegado, true);
  assert.strictEqual(leitura.motivoFallback, "arquivo_vazio");
  assert.deepStrictEqual(leitura.itens.map(item => item.id), ["ok_vazio"]);
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_parcial";
  deps.writeClienteJson(clienteId, "fila.json", [oferta("ok_parcial", { clienteId })]);
  fs.writeFileSync(deps.getClienteJsonPath(clienteId, "fila-viva.json.tmp"), "[");

  const leitura = filaOperacionalV2.lerFilaViva(clienteId, { ...deps, agora: AGORA });

  assert.strictEqual(leitura.ok, true);
  assert.strictEqual(leitura.fallbackLegado, true);
  assert.strictEqual(leitura.motivoFallback, "arquivo_principal_ausente_tmp_presente");
  assert.deepStrictEqual(leitura.itens.map(item => item.id), ["ok_parcial"]);
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_sem_legado";
  fs.writeFileSync(deps.getClienteJsonPath(clienteId, "fila-viva.json"), JSON.stringify([
    oferta("somente_viva", { clienteId, status: "pendente" })
  ]));

  const leitura = filaOperacionalV2.lerFilaViva(clienteId, { ...deps, agora: AGORA });

  assert.strictEqual(leitura.ok, true);
  assert.strictEqual(leitura.fallbackLegado, true, "sem fila.json autoridade deve cair para recovery do legado");
  assert.strictEqual(leitura.recovery, true);
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_coerente";
  const filaLegada = [
    oferta("vivo_1", { clienteId, status: "pendente" }),
    oferta("recente_2", {
      clienteId,
      status: "enviado",
      enviadoEm: new Date(AGORA - 15 * 60 * 1000).toISOString()
    }),
    oferta("hist_3", {
      clienteId,
      status: "enviado",
      enviadoEm: new Date(AGORA - 5 * 60 * 60 * 1000).toISOString()
    })
  ];
  const projetada = projetarFilaV2(filaLegada, { agora: AGORA });
  deps.writeClienteJson(clienteId, "fila.json", filaLegada);
  deps.writeClienteJson(clienteId, "fila-viva.json", projetada.viva.map(entrada => entrada.item));

  const leitura = filaOperacionalV2.lerFilaViva(clienteId, { ...deps, agora: AGORA });

  assert.strictEqual(leitura.ok, true);
  assert.strictEqual(leitura.recovery, false);
  assert.strictEqual(leitura.fonte, "fila_viva");
  assert.strictEqual(leitura.comparacao.ok, true);
  assert.deepStrictEqual(leitura.itens.map(item => item.id), ["vivo_1", "recente_2"]);
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_divergente";
  const filaLegada = [
    oferta("vivo_1", { clienteId, status: "pendente" }),
    oferta("recente_2", {
      clienteId,
      status: "enviado",
      enviadoEm: new Date(AGORA - 15 * 60 * 1000).toISOString()
    }),
    oferta("hist_3", {
      clienteId,
      status: "enviado",
      enviadoEm: new Date(AGORA - 5 * 60 * 60 * 1000).toISOString()
    })
  ];
  deps.writeClienteJson(clienteId, "fila.json", filaLegada);
  deps.writeClienteJson(clienteId, "fila-viva.json", [
    oferta("vivo_1", { clienteId, status: "processando" }),
    oferta("extra_9", { clienteId, status: "pendente" })
  ]);

  const leitura = filaOperacionalV2.lerFilaViva(clienteId, { ...deps, agora: AGORA });

  assert.strictEqual(leitura.ok, true);
  assert.strictEqual(leitura.recovery, true, "fila viva divergente deve cair para recovery conservador");
  assert.strictEqual(leitura.motivoFallback, "viva_divergente_legado");
  assert(leitura.comparacao.divergencias > 0);
  assert(leitura.comparacao.idsAusentes.includes("recente_2"));
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_posicao";
  const base = oferta("terminal_pos", {
    clienteId,
    status: "enviado",
    enviadoEm: new Date(AGORA - 4 * 60 * 60 * 1000).toISOString()
  });
  const entradaPrimeira = {
    posicaoLegada: 1,
    bucket: "historico",
    motivoBucket: "status_terminal",
    status: "enviado",
    id: "terminal_pos",
    item: base
  };
  const entradaReordenada = {
    ...entradaPrimeira,
    posicaoLegada: 99
  };

  const primeiro = filaOperacionalV2.appendHistoricoIncremental(clienteId, entradaPrimeira, { ...deps, agora: AGORA });
  const segundo = filaOperacionalV2.appendHistoricoIncremental(clienteId, entradaReordenada, { ...deps, agora: AGORA });
  const linhas = fs.readFileSync(primeiro.file, "utf8").trim().split(/\r?\n/);

  assert.strictEqual(primeiro.ok, true);
  assert.strictEqual(segundo.ok, true);
  assert.strictEqual(segundo.idempotente, true, "reordem nao deve duplicar historico");
  assert.strictEqual(linhas.length, 1);
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_cache";
  const base = oferta("cache_1", {
    clienteId,
    status: "enviado",
    enviadoEm: new Date(AGORA - 4 * 60 * 60 * 1000).toISOString()
  });
  const entrada = {
    posicaoLegada: 1,
    bucket: "historico",
    motivoBucket: "status_terminal",
    status: "enviado",
    id: "cache_1",
    item: base
  };
  const file = filaOperacionalV2.appendHistoricoIncremental(clienteId, entrada, { ...deps, agora: AGORA }).file;
  for (let i = 0; i < 9999; i += 1) {
    fs.appendFileSync(file, `${JSON.stringify({
      versao: 1,
      chave: `fake_${i}`,
      chaveLegada: `fake_legada_${i}`,
      clienteId,
      id: `fake_${i}`,
      status: "enviado",
      posicaoLegada: i + 2,
      motivoBucket: "status_terminal",
      registradoEm: new Date(AGORA).toISOString(),
      item: { id: `fake_${i}`, status: "enviado", clienteId }
    })}\n`);
  }
  filaOperacionalV2.limparCacheHistorico();

  const contador = { reads: 0 };
  const fsContado = {
    ...fs,
    readFileSync(...args) {
      contador.reads += 1;
      return fs.readFileSync(...args);
    }
  };

  const primeiro = filaOperacionalV2.appendHistoricoIncremental(clienteId, entrada, {
    ...deps,
    fs: fsContado,
    agora: AGORA
  });
  const segundo = filaOperacionalV2.appendHistoricoIncremental(clienteId, entrada, {
    ...deps,
    fs: fsContado,
    agora: AGORA
  });

  assert.strictEqual(primeiro.ok, true);
  assert.strictEqual(segundo.idempotente, true);
  assert.strictEqual(contador.reads, 1, "cache quente nao deve reler segmento inteiro no segundo append");

  filaOperacionalV2.limparCacheHistorico();
  const terceiro = filaOperacionalV2.appendHistoricoIncremental(clienteId, entrada, {
    ...deps,
    fs: fsContado,
    agora: AGORA
  });
  assert.strictEqual(terceiro.idempotente, true);
  assert.strictEqual(contador.reads, 2, "cache vazio deve reconstruir o indice do segmento");
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_historico";
  const enviadaAntiga = oferta("terminal_hist", {
    clienteId,
    status: "enviado",
    enviadoEm: new Date(AGORA - 4 * 60 * 60 * 1000).toISOString()
  });
  const entrada = filaOperacionalV2.normalizarEntradasViva([enviadaAntiga], AGORA)[0];

  const primeiro = filaOperacionalV2.appendHistoricoIncremental(clienteId, entrada, { ...deps, agora: AGORA });
  const segundo = filaOperacionalV2.appendHistoricoIncremental(clienteId, entrada, { ...deps, agora: AGORA });
  const arquivo = primeiro.file;
  const linhas = fs.readFileSync(arquivo, "utf8").trim().split(/\r?\n/);

  assert.strictEqual(primeiro.ok, true);
  assert.strictEqual(segundo.ok, true);
  assert.strictEqual(segundo.idempotente, true, "append historico deve ser idempotente");
  assert.strictEqual(linhas.length, 1, "historico incremental nao pode duplicar registro");
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_transicao";
  const enviadaAntiga = oferta("terminal_move", {
    clienteId,
    status: "enviado",
    enviadoEm: new Date(AGORA - 4 * 60 * 60 * 1000).toISOString()
  });
  const pendente = oferta("pendente_move", { clienteId, status: "pendente" });
  const filaViva = filaOperacionalV2.normalizarEntradasViva([pendente, enviadaAntiga], AGORA);

  const resultado = filaOperacionalV2.moverTerminalParaHistorico(clienteId, filaViva, enviadaAntiga, {
    ...deps,
    agora: AGORA
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.removeuDaViva, true);
  assert.deepStrictEqual(
    deps.readClienteJson(clienteId, "fila-viva.json", []).map(entrada => entrada.id),
    ["pendente_move"],
    "terminal so deve sair da viva depois do historico persistido"
  );
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_viva_falha";
  const enviadaAntiga = oferta("terminal_viva_falha", {
    clienteId,
    status: "enviado",
    enviadoEm: new Date(AGORA - 4 * 60 * 60 * 1000).toISOString()
  });
  const pendente = oferta("pendente_viva_falha", { clienteId, status: "pendente" });
  const filaViva = filaOperacionalV2.normalizarEntradasViva([pendente, enviadaAntiga], AGORA);
  const snapshot = JSON.parse(JSON.stringify(filaViva));

  const resultado = filaOperacionalV2.moverTerminalParaHistorico(clienteId, filaViva, enviadaAntiga, {
    ...deps,
    writeClienteJson: () => {
      throw new Error("viva_indisponivel");
    },
    agora: AGORA
  });
  const segundo = filaOperacionalV2.moverTerminalParaHistorico(clienteId, filaViva, enviadaAntiga, {
    ...deps,
    writeClienteJson: () => {
      throw new Error("viva_indisponivel");
    },
    agora: AGORA
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.removeuDaViva, false);
  assert.strictEqual(resultado.historico.ok, true);
  assert.strictEqual(segundo.ok, false);
  assert.strictEqual(segundo.historico.idempotente, true);
  assert.deepStrictEqual(filaViva, snapshot, "falha na viva nao pode mutar o array de entrada");
}

{
  const clienteId = "cliente_falha_historico";
  const enviadaAntiga = oferta("terminal_falha", {
    clienteId,
    status: "enviado",
    enviadoEm: new Date(AGORA - 4 * 60 * 60 * 1000).toISOString()
  });
  const filaViva = filaOperacionalV2.normalizarEntradasViva([enviadaAntiga], AGORA);
  const fsFalho = {
    existsSync: () => false,
    mkdirSync: () => {},
    readFileSync: () => "",
    appendFileSync: () => {
      throw new Error("disco_indisponivel");
    }
  };

  const resultado = filaOperacionalV2.moverTerminalParaHistorico(clienteId, filaViva, enviadaAntiga, {
    fs: fsFalho,
    getClientePath: () => path.join(os.tmpdir(), "nao_importa"),
    writeClienteJson: () => {
      throw new Error("nao_deve_escrever_viva_se_historico_falhar");
    },
    logger: { log() {} },
    agora: AGORA
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.removeuDaViva, false, "falha no historico mantem terminal na viva");
}

{
  const recente = oferta("recent_nao_terminal", {
    status: "enviado",
    enviadoEm: new Date(AGORA - 30 * 60 * 1000).toISOString()
  });
  const antigo = oferta("old_terminal", {
    status: "enviado",
    enviadoEm: new Date(AGORA - 4 * 60 * 60 * 1000).toISOString()
  });

  assert.strictEqual(
    filaOperacionalV2.itemTerminalParaHistorico(recente, AGORA),
    false,
    "enviado recente <2h deve permanecer vivo para anti-repeticao"
  );
  assert.strictEqual(
    filaOperacionalV2.itemTerminalParaHistorico(antigo, AGORA),
    true,
    "enviado antigo pode sair da viva apos persistir historico"
  );
}

{
  const clienteId = "cliente_reorder_compare";
  const filaLegada = [
    oferta("a", { clienteId, status: "pendente" }),
    oferta("b", {
      clienteId,
      status: "enviado",
      enviadoEm: new Date(AGORA - 3 * 60 * 60 * 1000).toISOString()
    })
  ];
  const vivaReordenada = [];
  const comparacao = filaOperacionalV2.compararVivaComLegado(clienteId, vivaReordenada, filaLegada, { agora: AGORA });

  assert.strictEqual(comparacao.ok, false, "ordem e contagem divergentes devem ser detectadas");
  assert(comparacao.idsAusentes.includes("a") || comparacao.idsExtras.includes("a"));
}

{
  const clienteId = "cliente_comparacao";
  const filaLegada = [
    oferta("p_comp", { clienteId, status: "pendente" }),
    oferta("h_comp", {
      clienteId,
      status: "enviado",
      enviadoEm: new Date(AGORA - 5 * 60 * 60 * 1000).toISOString()
    })
  ];
  const projecao = projetarFilaV2(filaLegada, { agora: AGORA });
  const comparacaoOk = filaOperacionalV2.compararVivaComLegado(clienteId, projecao.viva, filaLegada, { agora: AGORA });
  const comparacaoDivergente = filaOperacionalV2.compararVivaComLegado(clienteId, [], filaLegada, { agora: AGORA });

  assert.strictEqual(comparacaoOk.ok, true);
  assert.strictEqual(comparacaoOk.divergencias, 0);
  assert.strictEqual(comparacaoDivergente.ok, false);
  assert.strictEqual(comparacaoDivergente.idsAusentes[0], "p_comp");
}

{
  const filaOriginal = [
    oferta("selecionada", { prioridadeEnvio: 20, score: 70 }),
    oferta("expirada", {
      prioridadeEnvio: 100,
      score: 95,
      expiraEm: new Date(AGORA - 1000).toISOString()
    }),
    oferta("bloqueada", { prioridadeEnvio: 80, score: 88 })
  ];
  const snapshot = JSON.parse(JSON.stringify(filaOriginal));

  const resultado = filaDualRead.selecionarFilaReadOnly({
    fila: filaOriginal,
    clienteIdAlvo: "cliente_a",
    agora: AGORA,
    configPadrao: { automacaoAtiva: true },
    configsPorCliente: { cliente_a: { automacaoAtiva: true } },
    ordenarPendentesPorPrioridade: pendentes => [...pendentes].sort((a, b) =>
      Number(b.prioridadeEnvio || 0) - Number(a.prioridadeEnvio || 0)
    ),
    ofertaExpiradaParaEnvio: ofertaAtual => Boolean(ofertaAtual.expiraEm),
    avaliarOfertaParaSelecaoFilaViva: (ofertaAtual, clienteAtual, configAtual) => ({
      elegivel: ofertaAtual.id !== "bloqueada" && configAtual.automacaoAtiva === true,
      motivo: ofertaAtual.id === "bloqueada" ? "sem_destino_liberado_agora" : "destino_liberado",
      oferta: ofertaAtual,
      destinosCompativeis: 1,
      destinosLiberados: [{ id: "destino_1" }],
      ranking: {
        lane: ofertaAtual.id === "selecionada" ? "agua_nova" : "fresca_em_risco",
        scoreFinal: ofertaAtual.id === "selecionada" ? 99 : 80,
        idadeMs: 1
      }
    }),
    ordenarOfertasFilaViva
  });

  assert.strictEqual(resultado.selecionada.oferta.id, "selecionada");
  assert.deepStrictEqual(filaOriginal, snapshot, "core read-only nao pode mutar a fila de entrada");
}

{
  const logs = [];
  const controlador = filaDualRead.criarControladorFilaDualRead({
    env: { FILA_V2_DUAL_READ_ATIVA: "true" },
    intervaloMs: 0,
    logger: { log: (...args) => logs.push(args.join(" ")) }
  });
  const legado = {
    ok: true,
    motivo: "selecionada",
    selecionada: {
      oferta: {
        id: "oferta_1",
        titulo: "titulo sensivel",
        linkOriginal: "https://sensivel"
      },
      ranking: {
        lane: "agua_nova",
        scoreFinal: 98
      },
      destinosCompativeis: 1,
      destinosLiberados: [{}]
    },
    totalPendentes: 2,
    totalElegiveis: 1,
    contadores: { avaliadas: 1 }
  };
  const sombra = {
    ...legado,
    selecionada: {
      oferta: {
        id: "oferta_1",
        titulo: "titulo sombra",
        linkOriginal: "https://sombra"
      },
      ranking: {
        lane: "agua_nova",
        scoreFinal: 99
      },
      destinosCompativeis: 1,
      destinosLiberados: [{}]
    }
  };

  const equivalencia = controlador.compararSelecao({
    clienteId: "cliente_dual",
    legado,
    sombra,
    contexto: { shadowFallback: false },
    forcar: true
  });
  const divergencia = controlador.compararSelecao({
    clienteId: "cliente_dual",
    legado,
    sombra: {
      ...sombra,
      selecionada: {
        oferta: { id: "oferta_2" },
        ranking: { lane: "fresca_em_risco", scoreFinal: 1 },
        destinosCompativeis: 1,
        destinosLiberados: [{}]
      }
    },
    contexto: { shadowFallback: false },
    forcar: true
  });

  assert.strictEqual(equivalencia.equivalente, true);
  assert.strictEqual(equivalencia.divergente, false);
  assert.strictEqual(divergencia.divergente, true);
  assert(logs.some(linha => linha.includes("[FILA-V2-DUAL-READ]")));
  assert(!logs.join("\n").includes("titulo sensivel"), "telemetria dual-read nao deve carregar titulo");
  assert(!logs.join("\n").includes("https://sensivel"), "telemetria dual-read nao deve carregar links");
}

{
  const logs = [];
  const controlador = filaDualRead.criarControladorFilaDualRead({
    env: { FILA_V2_DUAL_READ_ATIVA: "true" },
    intervaloMs: 0,
    logger: { log: (...args) => logs.push(args.join(" ")) }
  });
  const legado = {
    ok: true,
    bloqueada: true,
    motivo: "repetida_no_executor_2h",
    statusAnterior: "enviado",
    ofertaAnterior: {
      id: "antiga_1",
      titulo: "nunca logar",
      linkOriginal: "https://antiga"
    },
    identidade: "cliente_a|produto_1",
    enviadaEmAnterior: "2026-08-26T10:00:00.000Z"
  };
  const sombra = {
    ...legado
  };

  const equivalencia = controlador.compararAntidup({
    clienteId: "cliente_dual",
    legado,
    sombra,
    contexto: { shadowFallback: false },
    forcar: true
  });
  const divergencia = controlador.compararAntidup({
    clienteId: "cliente_dual",
    legado,
    sombra: {
      ...legado,
      bloqueada: false,
      motivo: "sem_envio_equivalente_recente"
    },
    contexto: { shadowFallback: false },
    forcar: true
  });

  assert.strictEqual(equivalencia.equivalente, true);
  assert.strictEqual(divergencia.divergente, true);
  assert(logs.some(linha => linha.includes("[FILA-V2-DUAL-READ]")));
  assert(!logs.join("\n").includes("nunca logar"), "telemetria dual-read nao deve carregar payload sensivel");
  assert(!logs.join("\n").includes("https://antiga"), "telemetria dual-read nao deve carregar links");
}

{
  let chamadas = 0;
  const controlador = filaDualRead.criarControladorFilaDualRead({
    env: { FILA_V2_DUAL_READ_ATIVA: "true" },
    cooldownRecuperacaoMs: 1000,
    intervaloMs: 0,
    logger: { log: () => {} }
  });

  const leitura1 = controlador.lerFilaVivaComCooldown(
    "cliente_cooldown",
    { agora: 1000 },
    () => {
      chamadas += 1;
      return {
        ok: false,
        fallbackLegado: true,
        motivoFallback: "viva_divergente_legado"
      };
    }
  );
  const leitura2 = controlador.lerFilaVivaComCooldown(
    "cliente_cooldown",
    { agora: 1300 },
    () => {
      chamadas += 1;
      return {
        ok: false,
        fallbackLegado: true,
        motivoFallback: "viva_divergente_legado"
      };
    }
  );
  const leitura3 = controlador.lerFilaVivaComCooldown(
    "cliente_cooldown",
    { agora: 2201 },
    () => {
      chamadas += 1;
      return {
        ok: true,
        fallbackLegado: false,
        itens: [],
        entradas: []
      };
    }
  );

  assert.strictEqual(chamadas, 2, "recovery invalido nao deve repetir dentro do cooldown");
  assert.strictEqual(leitura1.fallbackLegado, true);
  assert.strictEqual(leitura2.recuperacaoBloqueada, true);
  assert.strictEqual(leitura3.ok, true);
}

function criarStorageTemporarioFilaV2() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fila-v2-2c-"));
  const getClientePath = clienteId => path.join(dir, clienteId);
  const getClienteJsonPath = (clienteId, arquivo) => path.join(dir, clienteId, arquivo);
  const writeClienteJson = (clienteId, arquivo, dados) => {
    const destino = getClienteJsonPath(clienteId, arquivo);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, JSON.stringify(dados), "utf8");
    return true;
  };
  return { dir, getClientePath, getClienteJsonPath, writeClienteJson };
}

{
  const storage = criarStorageTemporarioFilaV2();
  const item = oferta("v2c_insert", { clienteId: "cliente_2c", status: "pendente" });
  const resultado = filaOperacionalV2.inserirItemFilaVivaIncremental("cliente_2c", item, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA,
    posicaoLegada: 17
  });

  const vivaPath = storage.getClienteJsonPath("cliente_2c", FILA_VIVA_ARQUIVO);
  const legadoPath = storage.getClienteJsonPath("cliente_2c", "fila.json");
  const viva = JSON.parse(fs.readFileSync(vivaPath, "utf8"));

  assert.strictEqual(resultado.ok, true, "insert 2C deve persistir na fila viva");
  assert.strictEqual(viva.length, 1);
  assert.strictEqual(viva[0].id, "v2c_insert");
  assert.strictEqual(viva[0].posicaoLegada, 17, "posicao legada deve ser preservada para rotas por indice");
  assert.strictEqual(fs.existsSync(legadoPath), false, "insert 2C nao deve escrever fila.json no hot path");
}

{
  const storage = criarStorageTemporarioFilaV2();
  const vivaPath = storage.getClienteJsonPath("cliente_corrupto", FILA_VIVA_ARQUIVO);
  fs.mkdirSync(path.dirname(vivaPath), { recursive: true });
  fs.writeFileSync(vivaPath, "{json quebrado", "utf8");

  const resultado = filaOperacionalV2.inserirItemFilaVivaIncremental(
    "cliente_corrupto",
    oferta("nao_persistir", { clienteId: "cliente_corrupto" }),
    {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: storage.writeClienteJson,
      logger: { log: () => {} },
      agora: AGORA
    }
  );

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.fallbackLegado, true, "viva corrompida deve cair para legado seguro");
  assert.strictEqual(resultado.motivo, "json_corrompido");
}

{
  const controlador = filaOperacionalV2.criarControladorCheckpointLegadoV2({
    politica: { mutacoes: 2, intervaloMs: 1000, maxDirtyMs: 3000 }
  });

  controlador.marcarDirty("cliente_checkpoint", "insert", 1000);
  assert.strictEqual(controlador.deveCheckpoint("cliente_checkpoint", { agora: 1200 }).deve, false);
  controlador.marcarDirty("cliente_checkpoint", "insert", 1300);
  assert.strictEqual(controlador.deveCheckpoint("cliente_checkpoint", { agora: 1300 }).motivo, "mutacoes");
  controlador.confirmarCheckpoint("cliente_checkpoint", { agora: 1400 });
  assert.strictEqual(controlador.snapshot("cliente_checkpoint", 1500).dirty, false);

  controlador.marcarDirty("cliente_checkpoint", "insert", 2000);
  assert.strictEqual(controlador.deveCheckpoint("cliente_checkpoint", { agora: 2600 }).deve, true);
  assert.strictEqual(controlador.deveCheckpoint("cliente_checkpoint", { agora: 2600 }).motivo, "intervalo");
  controlador.confirmarCheckpoint("cliente_checkpoint", { agora: 2600 });

  const controladorMaxDirty = filaOperacionalV2.criarControladorCheckpointLegadoV2({
    politica: { mutacoes: 50, intervaloMs: 10000, maxDirtyMs: 3000 }
  });
  controladorMaxDirty.marcarDirty("cliente_checkpoint", "insert", 3000);
  assert.strictEqual(controladorMaxDirty.deveCheckpoint("cliente_checkpoint", { agora: 6101 }).motivo, "max_dirty");
}

{
  const fila = [];
  const store = criarFilaStore(fila);
  const item = oferta("ponte_memoria", { clienteId: "cliente_ponte" });
  fila.push(item);
  const update = store.atualizarItem(item, { motivo: "fila_v2_2c_insert", agora: AGORA });

  assert.strictEqual(update, true);
  assert.strictEqual(store.itensPorCliente("cliente_ponte").length, 1, "FilaStore deve aceitar update incremental");
  assert.strictEqual(store.snapshotMetricas({}).atualizacoes, 1, "update incremental nao deve exigir rebuild completo");
}

{
  const legado = [
    oferta("merge_a", { clienteId: "cliente_merge", status: "pendente" }),
    oferta("merge_b", { clienteId: "cliente_merge", status: "processando" })
  ];
  const vivaEntries = [
    { id: "merge_a", bucket: "viva", item: oferta("merge_a", { clienteId: "cliente_merge", status: "enviado", enviadoEm: new Date(AGORA).toISOString() }) },
    { id: "merge_c", bucket: "viva", posicaoLegada: 2, item: oferta("merge_c", { clienteId: "cliente_merge", status: "pendente" }) },
    { id: "merge_c_duplicado", bucket: "viva", posicaoLegada: 2, item: oferta("merge_c", { clienteId: "cliente_merge", status: "pendente" }) }
  ];

  const merge = filaOperacionalV2.mesclarFilaLegadaComViva("cliente_merge", legado, vivaEntries, { agora: AGORA });
  const ids = merge.filaCliente.map(item => item.id);

  assert.deepStrictEqual(ids, ["merge_a", "merge_b", "merge_c"], "merge deve preservar ordem legada e anexar vivo ausente uma vez");
  assert.strictEqual(merge.itensInseridos, 1);
  assert.strictEqual(merge.itensAtualizados, 1);
  assert.strictEqual(merge.duplicatasEvitadas, 2);
  assert.strictEqual(merge.filaCliente[0].status, "enviado", "status mais avancado da viva deve proteger memoria antes do checkpoint");
  assert.strictEqual(merge.filaCliente[2].posicaoLegada, 2, "item vivo anexado deve ganhar posicao legada compativel");
}

{
  const legado = [
    oferta("merge_status", { clienteId: "cliente_merge_status", status: "enviado", enviadoEm: new Date(AGORA).toISOString() })
  ];
  const vivaEntries = [
    { id: "merge_status", bucket: "viva", item: oferta("merge_status", { clienteId: "cliente_merge_status", status: "pendente" }) }
  ];

  const merge = filaOperacionalV2.mesclarFilaLegadaComViva("cliente_merge_status", legado, vivaEntries, { agora: AGORA });

  assert.strictEqual(merge.filaCliente.length, 1);
  assert.strictEqual(merge.filaCliente[0].status, "enviado", "viva antiga nao deve regredir status legado mais avancado");
  assert.strictEqual(merge.statusPreservados, 1);
}

{
  const storage = criarStorageTemporarioFilaV2();
  const vivaPath = storage.getClienteJsonPath("cliente_merge_corrupto", FILA_VIVA_ARQUIVO);
  fs.mkdirSync(path.dirname(vivaPath), { recursive: true });
  fs.writeFileSync(vivaPath, "{viva quebrada", "utf8");

  const leitura = filaOperacionalV2.lerFilaVivaParaMerge("cliente_merge_corrupto", {
    getClienteJsonPath: storage.getClienteJsonPath,
    logger: { log: () => {} },
    agora: AGORA
  });

  assert.strictEqual(leitura.ok, false);
  assert.strictEqual(leitura.motivo, "json_corrompido");
  assert.deepStrictEqual(leitura.entradas, [], "viva invalida nao deve participar do merge");
}

{
  const storage = criarStorageTemporarioFilaV2();
  const cliente = "cliente_recovery_mtime";
  const legadoPath = storage.getClienteJsonPath(cliente, "fila.json");
  const vivaPath = storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO);
  fs.mkdirSync(path.dirname(legadoPath), { recursive: true });
  fs.writeFileSync(legadoPath, JSON.stringify([oferta("legado_mtime", { clienteId: cliente })]), "utf8");
  fs.writeFileSync(vivaPath, JSON.stringify([{ item: oferta("viva_mtime", { clienteId: cliente }), bucket: "viva", posicaoLegada: 1 }]), "utf8");
  fs.utimesSync(legadoPath, new Date(AGORA - 10_000), new Date(AGORA - 10_000));
  fs.utimesSync(vivaPath, new Date(AGORA), new Date(AGORA));

  const vivaMaisNova = filaOperacionalV2.filaVivaMaisNovaQueLegado(cliente, {
    getClienteJsonPath: storage.getClienteJsonPath
  });
  assert.strictEqual(vivaMaisNova.maisNova, true, "recovery so deve ser elegivel quando viva for mais nova que legado");

  fs.utimesSync(legadoPath, new Date(AGORA + 10_000), new Date(AGORA + 10_000));
  const legadoMaisNovo = filaOperacionalV2.filaVivaMaisNovaQueLegado(cliente, {
    getClienteJsonPath: storage.getClienteJsonPath
  });
  assert.strictEqual(legadoMaisNovo.maisNova, false, "viva antiga nao deve sobrepor legado mais recente");
}

{
  const storage = criarStorageTemporarioFilaV2();
  const cliente = "cliente_dual_read_only";
  const legado = [oferta("legado_only", { clienteId: cliente })];
  const vivaDivergente = [{ item: oferta("viva_extra", { clienteId: cliente }), bucket: "viva", posicaoLegada: 0 }];
  storage.writeClienteJson(cliente, "fila.json", legado);
  storage.writeClienteJson(cliente, FILA_VIVA_ARQUIVO, vivaDivergente);
  const vivaPath = storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO);
  const conteudoAntes = fs.readFileSync(vivaPath, "utf8");
  let writes = 0;

  const leitura = filaOperacionalV2.lerFilaVivaReadOnly(cliente, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: () => {
      writes += 1;
      throw new Error("dual-read nao pode escrever");
    },
    filaLegada: legado,
    logger: { log: () => {} },
    agora: AGORA
  });

  assert.strictEqual(leitura.ok, false, "dual-read divergente deve cair para legado");
  assert.strictEqual(leitura.fallbackLegado, true);
  assert.strictEqual(leitura.recovery, false, "dual-read nao pode executar recovery");
  assert.strictEqual(leitura.sideEffectBlocked, true, "side effect deve ficar bloqueado no shadow");
  assert.strictEqual(writes, 0, "dual-read read-only nao pode escrever fila-viva");
  assert.strictEqual(fs.readFileSync(vivaPath, "utf8"), conteudoAntes, "fila-viva deve permanecer intacta");
}

{
  const storage = criarStorageTemporarioFilaV2();
  const cliente = "cliente_update_enviado_recente";
  const itemPendente = oferta("update_recente", { clienteId: cliente, status: "pendente" });
  filaOperacionalV2.inserirItemFilaVivaIncremental(cliente, itemPendente, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA,
    posicaoLegada: 4
  });

  const itemEnviado = {
    ...itemPendente,
    status: "enviado",
    enviadoEm: new Date(AGORA - 10 * 60 * 1000).toISOString(),
    statusDetalhe: "Enviado no teste"
  };
  const update = filaOperacionalV2.atualizarItemFilaVivaIncremental(cliente, itemEnviado, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA
  });
  const viva = JSON.parse(fs.readFileSync(storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO), "utf8"));
  const comparacao = filaOperacionalV2.compararVivaComLegado(cliente, viva, [itemEnviado], { agora: AGORA });

  assert.strictEqual(update.ok, true);
  assert.strictEqual(update.atualizouViva, true, "enviado recente <2h deve atualizar e permanecer vivo");
  assert.strictEqual(viva.length, 1);
  assert.strictEqual(viva[0].item.status, "enviado");
  assert.strictEqual(viva[0].posicaoLegada, 4, "update deve preservar posicao legada");
  assert.strictEqual(comparacao.ok, true, "enviado recente atualizado nao deve gerar idsExtras");
}

{
  const storage = criarStorageTemporarioFilaV2();
  const cliente = "cliente_update_terminal";
  const itemPendente = oferta("update_terminal", { clienteId: cliente, status: "pendente" });
  filaOperacionalV2.inserirItemFilaVivaIncremental(cliente, itemPendente, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA,
    posicaoLegada: 2
  });

  const itemRetidoTerminal = {
    ...itemPendente,
    status: "retida",
    motivoRetencao: "duplicata",
    retidaEm: new Date(AGORA).toISOString()
  };
  const update = filaOperacionalV2.atualizarItemFilaVivaIncremental(cliente, itemRetidoTerminal, {
    getClientePath: storage.getClientePath,
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA
  });
  const viva = JSON.parse(fs.readFileSync(storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO), "utf8"));
  const historicoDir = path.join(path.dirname(storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO)), "fila-historico-incremental");

  assert.strictEqual(update.ok, true);
  assert.strictEqual(update.removeuDaViva, true, "terminal deve sair da viva apos historico persistido");
  assert.strictEqual(viva.length, 0);
  assert.strictEqual(fs.existsSync(historicoDir), true, "terminal deve ser registrado no historico incremental");
}

{
  const storage = criarStorageTemporarioFilaV2();
  const cliente = "cliente_remocao_viva";
  const item = oferta("remover_viva", { clienteId: cliente });
  filaOperacionalV2.inserirItemFilaVivaIncremental(cliente, item, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA
  });

  const remocao = filaOperacionalV2.removerItemFilaVivaIncremental(cliente, item, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA
  });
  const viva = JSON.parse(fs.readFileSync(storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO), "utf8"));
  const comparacao = filaOperacionalV2.compararVivaComLegado(cliente, viva, [], { agora: AGORA });

  assert.strictEqual(remocao.ok, true);
  assert.strictEqual(remocao.removeuDaViva, true, "remocao oficial deve remover item stale da viva");
  assert.strictEqual(viva.length, 0);
  assert.strictEqual(comparacao.ok, true);
}

{
  const storage = criarStorageTemporarioFilaV2();
  const cliente = "cliente_reprocessar_viva";
  const itemEnviado = oferta("reprocessar_viva", {
    clienteId: cliente,
    status: "enviado",
    enviadoEm: new Date(AGORA - 5 * 60 * 1000).toISOString()
  });
  filaOperacionalV2.inserirItemFilaVivaIncremental(cliente, itemEnviado, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA
  });

  const itemReprocessado = {
    ...itemEnviado,
    status: "pendente",
    enviadoEm: "",
    dataEnvio: "",
    statusDetalhe: "Reprocessada manualmente"
  };
  const update = filaOperacionalV2.atualizarItemFilaVivaIncremental(cliente, itemReprocessado, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    permitirRegressaoStatus: true,
    agora: AGORA
  });
  const viva = JSON.parse(fs.readFileSync(storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO), "utf8"));

  assert.strictEqual(update.ok, true);
  assert.strictEqual(update.atualizouViva, true);
  assert.strictEqual(viva.length, 1, "reprocessar nao pode duplicar item");
  assert.strictEqual(viva[0].item.status, "pendente");
}

{
  const storage = criarStorageTemporarioFilaV2();
  const clienteA = "cliente_multi_a";
  const clienteB = "cliente_multi_b";
  const clienteC = "cliente_multi_c";
  const itemA = oferta("multi_a", { clienteId: clienteA });
  const itemB = oferta("multi_b", { clienteId: clienteB });
  const itemC = oferta("multi_c", { clienteId: clienteC });
  for (const [cliente, item] of [[clienteA, itemA], [clienteB, itemB], [clienteC, itemC]]) {
    filaOperacionalV2.inserirItemFilaVivaIncremental(cliente, item, {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: storage.writeClienteJson,
      logger: { log: () => {} },
      agora: AGORA
    });
  }

  filaOperacionalV2.removerItemFilaVivaIncremental(clienteA, itemA, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA
  });
  const leituraB = filaOperacionalV2.lerFilaVivaReadOnly(clienteB, {
    getClienteJsonPath: storage.getClienteJsonPath,
    filaLegada: [itemB],
    logger: { log: () => {} },
    agora: AGORA
  });
  const leituraC = filaOperacionalV2.lerFilaVivaReadOnly(clienteC, {
    getClienteJsonPath: storage.getClienteJsonPath,
    filaLegada: [itemC],
    logger: { log: () => {} },
    agora: AGORA
  });

  assert.strictEqual(JSON.parse(fs.readFileSync(storage.getClienteJsonPath(clienteA, FILA_VIVA_ARQUIVO), "utf8")).length, 0);
  assert.strictEqual(leituraB.ok, true, "mutacao em A nao pode tocar workspace B");
  assert.strictEqual(leituraC.ok, true, "workspace canario separado deve manter propria viva");
  assert.strictEqual(leituraB.itens[0].id, "multi_b");
  assert.strictEqual(leituraC.itens[0].id, "multi_c");
}

{
  const controlador = filaOperacionalV2.criarControladorCheckpointLegadoV2({
    politica: { mutacoes: 1, intervaloMs: 10000, maxDirtyMs: 20000 }
  });

  controlador.marcarDirty("cliente_generation", "insert_1", 1000);
  const inicio = controlador.iniciarCheckpoint("cliente_generation", { agora: 1001 });
  assert.strictEqual(inicio.deve, true);
  assert.strictEqual(inicio.generationInicial, 1);

  const concorrente = controlador.iniciarCheckpoint("cliente_generation", { agora: 1002 });
  assert.strictEqual(concorrente.deve, false);
  assert.strictEqual(concorrente.checkpointConcurrentSkip, true, "checkpoint simultaneo deve ser ignorado por cliente");

  controlador.marcarDirty("cliente_generation", "insert_durante_checkpoint", 1003);
  const conclusao = controlador.concluirCheckpoint("cliente_generation", {
    ok: true,
    generationInicial: inicio.generationInicial,
    mutacoesCapturadas: inicio.mutacoesCapturadas,
    agora: 1004
  });

  assert.strictEqual(conclusao.dirty, true, "mutacao durante checkpoint deve manter dirty");
  assert.strictEqual(conclusao.generation, 2);
  assert.strictEqual(conclusao.mutacoes, 1);
  assert.strictEqual(conclusao.checkpointConcurrentSkip, 1);
}

{
  const controlador = filaOperacionalV2.criarControladorCheckpointLegadoV2({
    politica: { mutacoes: 1, intervaloMs: 10000, maxDirtyMs: 20000 }
  });

  controlador.marcarDirty("cliente_falha_checkpoint", "insert", 2000);
  const inicio = controlador.iniciarCheckpoint("cliente_falha_checkpoint", { agora: 2001 });
  const conclusao = controlador.concluirCheckpoint("cliente_falha_checkpoint", {
    ok: false,
    generationInicial: inicio.generationInicial,
    mutacoesCapturadas: inicio.mutacoesCapturadas,
    agora: 2002,
    motivo: "falha_write"
  });

  assert.strictEqual(conclusao.dirty, true, "falha no checkpoint nunca deve limpar dirty");
  assert.strictEqual(conclusao.ultimoMotivo, "falha_write");
}

console.log("fila-store-v2.test.js OK");
