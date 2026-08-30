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
  const cliente = "cliente_proof_legado";
  const controlador = filaOperacionalV2.criarControladorFilaOperacionalV2({
    env: {},
    ...deps,
    agora: AGORA
  });
  assert.strictEqual(typeof controlador, "object");
  assert.strictEqual(typeof controlador.publicarProofFilaLegada, "function");
  assert.strictEqual(typeof controlador.prepararSeHabilitado, "function");

  deps.writeClienteJson(cliente, "fila.json", [oferta("proof_1", { clienteId: cliente })]);
  const resultado = controlador.publicarProofFilaLegada(cliente, {
    targetGeneration: 42,
    fileRevision: "checkpoint_revision_teste"
  }, {
    agora: AGORA + 1234
  });
  const proof = deps.readClienteJson(cliente, filaOperacionalV2.FILA_LEGADA_PROOF_ARQUIVO, null);

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(proof.clienteId, cliente);
  assert.strictEqual(proof.arquivo, "fila.json");
  assert.strictEqual(proof.generation, 42);
  assert.strictEqual(proof.targetGeneration, 42);
  assert.strictEqual(proof.fileRevision, "checkpoint_revision_teste");
  assert.strictEqual(proof.publishedAt, new Date(AGORA + 1234).toISOString());
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
      FILA_V2_OPERACIONAL_ROLLOUT: "auto",
      FILA_V2_OPERACIONAL_BLOCKLIST_CLIENTES: "cliente_bloqueado"
    },
    workspaceAtivoOperacional: clienteId => clienteId === "cliente_auto",
    ...deps
  });
  const filaLegada = [
    oferta("auto_vivo", { clienteId: "cliente_auto", status: "pendente" }),
    oferta("inativo_vivo", { clienteId: "cliente_inativo", status: "pendente" }),
    oferta("bloqueado_vivo", { clienteId: "cliente_bloqueado", status: "pendente" })
  ];

  assert.strictEqual(controlador.deveUsarFilaV2Operacional("cliente_auto"), true);
  assert.strictEqual(controlador.deveUsarFilaV2Operacional("cliente_inativo"), false);
  assert.strictEqual(controlador.deveUsarFilaV2Operacional("cliente_bloqueado"), false);

  const auto = controlador.sincronizarCanaryEscrita({
    clienteId: "cliente_auto",
    fila: filaLegada,
    agora: AGORA,
    motivo: "auto_rollout"
  });
  const inativo = controlador.sincronizarCanaryEscrita({
    clienteId: "cliente_inativo",
    fila: filaLegada,
    agora: AGORA,
    motivo: "auto_inativo"
  });
  const bloqueado = controlador.sincronizarCanaryEscrita({
    clienteId: "cliente_bloqueado",
    fila: filaLegada,
    agora: AGORA,
    motivo: "auto_blocklist"
  });

  assert.strictEqual(auto.ok, true);
  assert.strictEqual(auto.pulou, false, "workspace ativo em auto deve entrar sem lista manual");
  assert.deepStrictEqual(
    deps.readClienteJson("cliente_auto", "fila-viva.json", []).map(item => item.id),
    ["auto_vivo"],
    "auto deve fazer bootstrap lazy somente quando ha operacao real de fila"
  );
  assert.strictEqual(inativo.pulou, true, "workspace inativo deve permanecer legado em auto");
  assert.strictEqual(bloqueado.pulou, true, "blocklist deve forcar rollback individual");
  assert.deepStrictEqual(deps.readClienteJson("cliente_inativo", "fila-viva.json", []), []);
  assert.deepStrictEqual(deps.readClienteJson("cliente_bloqueado", "fila-viva.json", []), []);
}

{
  const { deps } = criarDepsFilaOperacionalTeste();
  const controlador = filaOperacionalV2.criarControladorFilaOperacionalV2({
    env: {
      FILA_V2_OPERACIONAL_ROLLOUT: "auto"
    },
    workspaceAtivoOperacional: () => Promise.resolve(true),
    ...deps
  });
  const cliente = "cliente_auto_async";

  assert.strictEqual(
    controlador.deveUsarFilaV2Operacional(cliente),
    false,
    "gate auto deve falhar fechado quando a elegibilidade exigir Promise"
  );
  const resultado = controlador.sincronizarCanaryEscrita({
    clienteId: cliente,
    fila: [oferta("async_vivo", { clienteId: cliente })],
    agora: AGORA,
    motivo: "auto_async_invalido"
  });

  assert.strictEqual(resultado.pulou, true);
  assert.deepStrictEqual(deps.readClienteJson(cliente, "fila-viva.json", []), []);
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
  const clienteId = "cliente_amostra_divergencia";
  const filaLegada = [
    oferta("legado_presente", { clienteId, status: "pendente" }),
    oferta("legado_ausente", { clienteId, status: "pendente" })
  ];
  const viva = filaOperacionalV2.normalizarEntradasViva([
    oferta("legado_presente", { clienteId, status: "pendente" }),
    ...Array.from({ length: 7 }, (_, indice) => oferta(`extra_${indice + 1}`, {
      clienteId,
      status: indice % 2 === 0 ? "pendente" : "processando",
      titulo: `Titulo sensivel extra ${indice + 1}`,
      linkAfiliado: `https://sensivel.local/${indice + 1}`
    }))
  ], AGORA);

  const comparacao = filaOperacionalV2.compararVivaComLegado(clienteId, viva, filaLegada, { agora: AGORA });
  const payloadAmostras = JSON.stringify({
    extras: comparacao.amostraExtrasNaViva,
    ausentes: comparacao.amostraAusentesNaViva,
    duplicados: comparacao.amostraDuplicadosNaViva
  });

  assert.strictEqual(comparacao.ok, false);
  assert.strictEqual(comparacao.idsExtras[0], "extra_1", "idsExtras continuam representando viva - legado");
  assert.strictEqual(comparacao.idsAusentes[0], "legado_ausente", "idsAusentes continuam representando legado - viva");
  assert.strictEqual(comparacao.amostraExtrasNaViva.length, 5, "amostra de extras deve ser limitada");
  assert.strictEqual(comparacao.amostraExtrasNaViva[0].id, "extra_1");
  assert.strictEqual(comparacao.amostraExtrasNaViva[0].status, "pendente");
  assert.strictEqual(comparacao.amostraExtrasNaViva[0].posicaoLegada, 1);
  assert(!payloadAmostras.includes("Titulo sensivel"), "amostra nao deve incluir titulo/payload");
  assert(!payloadAmostras.includes("https://sensivel.local"), "amostra nao deve incluir link");
}

{
  const { deps, logs } = criarDepsFilaOperacionalTeste();
  const clienteId = "cliente_log_divergencia";
  const filaLegada = [
    oferta("legado_log", { clienteId, status: "pendente" })
  ];
  const viva = filaOperacionalV2.normalizarEntradasViva([
    oferta("legado_log", { clienteId, status: "pendente" }),
    oferta("extra_log", {
      clienteId,
      status: "pendente",
      titulo: "Titulo sigiloso do extra",
      linkAfiliado: "https://nao-logar.local/produto"
    })
  ], AGORA);

  deps.writeClienteJson(clienteId, FILA_VIVA_ARQUIVO, viva);

  const leitura = filaOperacionalV2.lerFilaVivaReadOnly(clienteId, {
    ...deps,
    filaLegada,
    agora: AGORA
  });
  const logDivergencia = logs.find(linha => linha.includes("divergencia_viva_legado")) || "";

  assert.strictEqual(leitura.sideEffectBlocked, true);
  assert(logDivergencia.includes("extrasNaViva"), "log deve separar extras na viva");
  assert(logDivergencia.includes("amostraExtrasNaViva"), "log deve carregar amostra limitada");
  assert(logDivergencia.includes("extra_log"), "amostra deve identificar o item divergente");
  assert(!logDivergencia.includes("Titulo sigiloso"), "log nao deve carregar titulo/payload");
  assert(!logDivergencia.includes("https://nao-logar.local"), "log nao deve carregar link");
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
  const controlador = filaDualRead.criarControladorFilaDualRead({
    env: { FILA_V2_DUAL_READ_ATIVA: "true" },
    intervaloMs: 0,
    logger: { log: () => {} }
  });
  const semCandidato = {
    ok: true,
    motivo: "sem_candidato",
    selecionada: null,
    totalPendentes: 3,
    totalElegiveis: 0,
    contadores: { avaliadas: 3 }
  };

  const comparacaoSemCandidato = controlador.compararSelecao({
    clienteId: "cliente_sem_candidato",
    legado: semCandidato,
    sombra: semCandidato,
    contexto: { componente: "executor_selecao" },
    forcar: true
  });

  assert.strictEqual(comparacaoSemCandidato.equivalente, true);
  assert.strictEqual(comparacaoSemCandidato.legado.motivo, "sem_candidato");
  assert.strictEqual(comparacaoSemCandidato.legado.selecionadaId, "");
  assert.strictEqual(comparacaoSemCandidato.legado.totalPendentes, 3);
  assert.strictEqual(comparacaoSemCandidato.legado.avaliadas, 3);

  const ofertaComIds = {
    id: "id_primario",
    eventoId: "evento_nao_usado",
    ofertaId: "oferta_secundaria",
    engineOfertaId: "engine_terciario"
  };
  const selecionadaComIds = {
    ok: true,
    motivo: "selecionada",
    selecionada: {
      oferta: ofertaComIds,
      ranking: { lane: "agua_nova", scoreFinal: 88 },
      destinosCompativeis: 1,
      destinosLiberados: [{}]
    },
    totalPendentes: 1,
    totalElegiveis: 1,
    contadores: { avaliadas: 1 }
  };
  const comparacaoComIds = controlador.compararSelecao({
    clienteId: "cliente_com_ids",
    legado: selecionadaComIds,
    sombra: selecionadaComIds,
    contexto: { componente: "executor_selecao" },
    forcar: true
  });

  assert.strictEqual(comparacaoComIds.legado.selecionadaId, "id_primario");
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

function criarManifestStateRepositoryFake(opcoes = {}) {
  const states = new Map();
  const locks = new Map();
  const chamadas = [];

  function estadoInicial(clienteId) {
    return {
      clienteId,
      revision: 0,
      vivaGeneration: 0,
      durableCheckpointGeneration: 0,
      dirtyGeneration: null,
      authorityReady: false,
      authorityReadyGeneration: null,
      authorityReadyRevision: null,
      authorityReadyAt: null,
      vivaFileProof: null,
      legacyFileProof: null,
      pendingCheckpointRevision: "",
      pendingCheckpointTargetGeneration: null,
      pendingCheckpointStartedAt: null
    };
  }

  function normalizar(clienteId, state) {
    return {
      ...estadoInicial(clienteId),
      ...(state || {}),
      clienteId
    };
  }

  async function serializar(clienteId, callback) {
    const anterior = locks.get(clienteId) || Promise.resolve();
    let liberar = () => {};
    const bloqueio = new Promise(resolve => {
      liberar = resolve;
    });
    const cadeia = anterior.catch(() => {}).then(() => bloqueio);
    locks.set(clienteId, cadeia);
    await anterior.catch(() => {});
    try {
      return await callback();
    } finally {
      liberar();
      if (locks.get(clienteId) === cadeia) locks.delete(clienteId);
    }
  }

  return {
    chamadas,
    states,
    compararDbJson: () => ({ resultado: "db_json_equivalente", equivalente: true }),
    async registrarMutacaoDuravel(clienteId, dados = {}) {
      chamadas.push({ tipo: dados.checkpointSincronizado ? "legacy_sync" : "mutacao", clienteId });
      if (opcoes.falharMutacao) return { ok: false, motivo: "db_indisponivel" };
      return serializar(clienteId, async () => {
        const atual = normalizar(clienteId, states.get(clienteId));
        const nextGeneration = atual.vivaGeneration + 1;
        const fileRevision = dados.fileRevision || `rev_${nextGeneration}`;
        let escrita = null;
        if (typeof dados.escreverArquivo === "function") {
          escrita = await dados.escreverArquivo({ clienteId, state: atual, nextGeneration, fileRevision });
          if (escrita === false || escrita?.ok === false) {
            return { ok: false, motivo: escrita?.motivo || "arquivo_falhou" };
          }
        }
        const legacyFileProofNovo = escrita?.legacyFileProof &&
          escrita.legacyFileProof.clienteId === clienteId &&
          escrita.legacyFileProof.arquivo === "fila.json" &&
          Number(escrita.legacyFileProof.generation) === nextGeneration
            ? escrita.legacyFileProof
            : null;
        const checkpointSincronizado = dados.checkpointSincronizado === true && Boolean(legacyFileProofNovo);
        const durableCheckpointGeneration = checkpointSincronizado
          ? nextGeneration
          : atual.durableCheckpointGeneration;
        const dirtyGeneration = nextGeneration > durableCheckpointGeneration
          ? (atual.dirtyGeneration || durableCheckpointGeneration + 1)
          : null;
        const state = {
          clienteId,
          revision: atual.revision + 1,
          vivaGeneration: nextGeneration,
          durableCheckpointGeneration,
          dirtyGeneration,
          authorityReady: false,
          authorityReadyGeneration: null,
          authorityReadyRevision: null,
          authorityReadyAt: null,
          vivaFileProof: escrita?.vivaFileProof || atual.vivaFileProof,
          legacyFileProof: checkpointSincronizado ? legacyFileProofNovo : atual.legacyFileProof,
          pendingCheckpointRevision: atual.pendingCheckpointRevision || "",
          pendingCheckpointTargetGeneration: atual.pendingCheckpointTargetGeneration ?? null,
          pendingCheckpointStartedAt: atual.pendingCheckpointStartedAt || null
        };
        states.set(clienteId, state);
        return { ok: true, motivo: dados.motivo || "ok", state };
      });
    },
    async capturarTargetCheckpoint(clienteId, dados = {}) {
      chamadas.push({ tipo: "capturar_checkpoint", clienteId });
      const state = normalizar(clienteId, states.get(clienteId));
      const checkpointRevision = dados.checkpointRevision || `checkpoint_${state.vivaGeneration + 1}`;
      const atualizado = {
        ...state,
        revision: state.revision + 1,
        pendingCheckpointRevision: checkpointRevision,
        pendingCheckpointTargetGeneration: state.vivaGeneration,
        pendingCheckpointStartedAt: "2026-08-28T00:00:00.000Z"
      };
      states.set(clienteId, atualizado);
      return { ok: true, clienteId, targetGeneration: state.vivaGeneration, checkpointRevision, state: atualizado };
    },
    async confirmarCheckpointDuravel(clienteId, dados = {}) {
      chamadas.push({ tipo: "confirmar_checkpoint", clienteId });
      return serializar(clienteId, async () => {
        const atual = normalizar(clienteId, states.get(clienteId));
        const target = Number(dados.targetGeneration || 0);
        if (dados.checkpointRevision &&
            (atual.pendingCheckpointRevision !== dados.checkpointRevision ||
              atual.pendingCheckpointTargetGeneration !== target)) {
          return { ok: false, motivo: "checkpoint_revision_nao_pertence", state: atual };
        }
        let legacyFileProof = atual.legacyFileProof;
        if (typeof dados.publicarCheckpoint === "function") {
          const publicacao = await dados.publicarCheckpoint({
            clienteId,
            state: atual,
            targetGeneration: target,
            checkpointRevision: dados.checkpointRevision
          });
          if (publicacao === false || publicacao?.ok === false) {
            return { ok: false, motivo: publicacao?.motivo || "checkpoint_publicacao_falhou", state: atual };
          }
          legacyFileProof = publicacao.legacyFileProof || publicacao.proof || legacyFileProof;
        }
        const legacyFileProofConfirmado = legacyFileProof &&
          legacyFileProof.clienteId === clienteId &&
          legacyFileProof.arquivo === "fila.json" &&
          Number(legacyFileProof.generation) === target
            ? legacyFileProof
            : null;
        const targetDuravel = legacyFileProofConfirmado ? target : atual.durableCheckpointGeneration;
        const durableCheckpointGeneration = Math.min(
          atual.vivaGeneration,
          Math.max(atual.durableCheckpointGeneration, targetDuravel)
        );
        const dirtyGeneration = atual.vivaGeneration > durableCheckpointGeneration
          ? Math.max(durableCheckpointGeneration + 1, atual.dirtyGeneration || durableCheckpointGeneration + 1)
          : null;
        const state = {
          ...atual,
          revision: atual.revision + 1,
          durableCheckpointGeneration,
          dirtyGeneration,
          authorityReady: false,
          authorityReadyGeneration: null,
          authorityReadyRevision: null,
          authorityReadyAt: null,
          legacyFileProof: legacyFileProofConfirmado || atual.legacyFileProof,
          pendingCheckpointRevision: "",
          pendingCheckpointTargetGeneration: null,
          pendingCheckpointStartedAt: null
        };
        states.set(clienteId, state);
        return { ok: true, motivo: "checkpoint_confirmado", state };
      });
    },
    async prepararReadinessAutoridade(clienteId, dados = {}) {
      chamadas.push({ tipo: "authority_bootstrap", clienteId });
      return serializar(clienteId, async () => {
        const atual = normalizar(clienteId, states.get(clienteId));
        const leitura = typeof dados.lerManifesto === "function"
          ? await dados.lerManifesto({ clienteId, state: atual })
          : { ok: false };
        if (leitura.ok !== true) return { ok: true, ready: false, motivo: leitura.motivo || "manifest_indisponivel", state: atual };
        const manifest = leitura.manifesto || {};
        const vivaGeneration = Math.max(atual.vivaGeneration, Number(manifest.vivaGeneration || 0));
        const durableCheckpointGeneration = Math.min(
          vivaGeneration,
          Math.max(atual.durableCheckpointGeneration, Number(manifest.durableCheckpointGeneration || 0))
        );
        const dirtyGeneration = vivaGeneration > durableCheckpointGeneration
          ? Math.max(durableCheckpointGeneration + 1, atual.dirtyGeneration || Number(manifest.dirtyGeneration || durableCheckpointGeneration + 1))
          : null;
        const state = {
          ...atual,
          revision: atual.revision + 1,
          vivaGeneration,
          durableCheckpointGeneration,
          dirtyGeneration,
          authorityReady: true,
          authorityReadyGeneration: vivaGeneration,
          authorityReadyRevision: atual.revision + 1
        };
        states.set(clienteId, state);
        return { ok: true, ready: true, motivo: "authority_readiness_ready", state, jsonManifest: manifest };
      });
    },
    async avaliarAutoridadeRecovery(clienteId, dados = {}) {
      chamadas.push({ tipo: "authority_recovery", clienteId });
      return serializar(clienteId, async () => {
        if (opcoes.falharRecoveryAuthority) return { ok: false, motivo: "db_indisponivel" };
        const state = normalizar(clienteId, states.get(clienteId));
        if (!states.has(clienteId)) {
          return { ok: true, conclusiva: false, fallbackMtime: true, motivo: "state_ausente", state };
        }
        if (state.authorityReady !== true) {
          return { ok: true, conclusiva: false, fallbackMtime: true, motivo: "authority_not_ready", state };
        }
        if (state.pendingCheckpointRevision || state.pendingCheckpointTargetGeneration !== null) {
          return { ok: true, conclusiva: false, fallbackMtime: true, motivo: "pending_ambiguo", state };
        }
        if (typeof dados.validarEstadoFisico === "function") {
          const validacao = await dados.validarEstadoFisico({ clienteId, state });
          if (validacao?.ok !== true) {
            return { ok: true, conclusiva: false, fallbackMtime: true, motivo: validacao?.motivo || "proof_invalida", state, validacao };
          }
        }
        return {
          ok: true,
          conclusiva: true,
          fallbackMtime: false,
          motivo: state.vivaGeneration > state.durableCheckpointGeneration
            ? "generation_viva_mais_nova"
            : "generation_legado_cobre_viva",
          maisNova: state.vivaGeneration > state.durableCheckpointGeneration,
          state
        };
      });
    },
    async invalidarAuthorityReady(clienteId, dados = {}) {
      chamadas.push({ tipo: "invalidar_authority_ready", clienteId });
      return serializar(clienteId, async () => {
        const atual = normalizar(clienteId, states.get(clienteId));
        const state = {
          ...atual,
          revision: atual.revision + 1,
          authorityReady: false,
          authorityReadyGeneration: null,
          authorityReadyRevision: null,
          authorityReadyAt: null
        };
        states.set(clienteId, state);
        return { ok: true, motivo: dados.motivo || "authority_ready_invalidada", state };
      });
    }
  };
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
  const cliente = "cliente_manifesto";
  const logs = [];
  const item = oferta("manifesto_insert", { clienteId: cliente, status: "pendente" });
  const viva = filaOperacionalV2.inserirItemFilaVivaIncremental(cliente, item, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA,
    posicaoLegada: 4
  });
  const manifesto = filaOperacionalV2.registrarManifestoMutacaoObservacional(cliente, {
    generation: 1,
    dirtyGeneration: 1,
    itemCount: viva.totalViva,
    motivo: "insert_viva"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: (...args) => logs.push(args.join(" ")) },
    agora: AGORA
  });
  const lido = filaOperacionalV2.lerManifestoFilaV2(cliente, {
    getClienteJsonPath: storage.getClienteJsonPath,
    logger: { log: () => {} },
    agora: AGORA
  });

  assert.strictEqual(viva.ok, true);
  assert.strictEqual(manifesto.ok, true);
  assert.strictEqual(lido.manifesto.manifestVersion, 2);
  assert.strictEqual(lido.manifesto.vivaGeneration, 1, "vivaGeneration deve refletir generation persistida da viva");
  assert.strictEqual(lido.manifesto.checkpointGeneration, 0);
  assert.strictEqual(lido.manifesto.durableCheckpointGeneration, 0);
  assert.strictEqual(lido.manifesto.dirtyGeneration, 1);
  assert.strictEqual(lido.manifesto.itemCount, 1);
  assert(logs.some(linha => linha.includes("[FILA-V2-MANIFEST]") && linha.includes("manifest_write")));
}

{
  const storage = criarStorageTemporarioFilaV2();
  const cliente = "cliente_manifesto_falha";
  const item = oferta("manifesto_falha", { clienteId: cliente, status: "pendente" });
  const viva = filaOperacionalV2.inserirItemFilaVivaIncremental(cliente, item, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA,
    posicaoLegada: 1
  });
  const manifesto = filaOperacionalV2.registrarManifestoMutacaoObservacional(cliente, {
    generation: 1,
    dirtyGeneration: 1,
    itemCount: viva.totalViva,
    motivo: "insert_viva"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: (clienteId, arquivo, dados) => {
      if (arquivo === filaOperacionalV2.FILA_V2_MANIFEST_ARQUIVO) throw new Error("falha_manifesto");
      return storage.writeClienteJson(clienteId, arquivo, dados);
    },
    logger: { log: () => {} },
    agora: AGORA
  });

  assert.strictEqual(viva.ok, true, "fila-viva deve continuar duravel");
  assert.strictEqual(manifesto.ok, false, "falha no manifesto deve ser observacional");
  assert.strictEqual(JSON.parse(fs.readFileSync(storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO), "utf8")).length, 1);
}

{
  const storage = criarStorageTemporarioFilaV2();
  const cliente = "cliente_manifesto_sem_viva";
  const vivaPath = storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO);
  fs.mkdirSync(path.dirname(vivaPath), { recursive: true });
  fs.writeFileSync(vivaPath, "{viva quebrada", "utf8");

  const viva = filaOperacionalV2.inserirItemFilaVivaIncremental(cliente, oferta("viva_falha_manifesto_neutro", {
    clienteId: cliente,
    status: "pendente"
  }), {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA
  });
  const lido = filaOperacionalV2.lerManifestoFilaV2(cliente, {
    getClienteJsonPath: storage.getClienteJsonPath,
    logger: { log: () => {} },
    agora: AGORA
  });

  assert.strictEqual(viva.ok, false, "falha antes de salvar viva nao deve ser tratada como mutacao duravel");
  assert.strictEqual(lido.manifesto.vivaGeneration, 0, "manifesto nao deve avancar quando fila-viva nao foi salva");
  assert.strictEqual(lido.manifesto.durableCheckpointGeneration, 0);
}

{
  const storage = criarStorageTemporarioFilaV2();
  const cliente = "cliente_manifesto_checkpoint";
  const logs = [];
  const mutacao = filaOperacionalV2.registrarManifestoMutacaoObservacional(cliente, {
    generation: 2,
    dirtyGeneration: 2,
    itemCount: 3,
    motivo: "insert_viva"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA
  });
  const mutacao2 = filaOperacionalV2.registrarManifestoMutacaoObservacional(cliente, {
    generation: 2,
    dirtyGeneration: 2,
    itemCount: 3,
    motivo: "insert_viva_2"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA + 500
  });
  const checkpoint = filaOperacionalV2.registrarManifestoCheckpointObservacional(cliente, {
    targetGeneration: 2,
    itemCount: 3,
    motivo: "mutacoes"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: (...args) => logs.push(args.join(" ")) },
    agora: AGORA + 1000
  });

  assert.strictEqual(mutacao.ok, true);
  assert.strictEqual(mutacao2.ok, true);
  assert.strictEqual(checkpoint.ok, true);
  assert.strictEqual(checkpoint.manifesto.vivaGeneration, 2);
  assert.strictEqual(checkpoint.manifesto.checkpointGeneration, 2);
  assert.strictEqual(checkpoint.manifesto.durableCheckpointGeneration, 2);
  assert.strictEqual(checkpoint.manifesto.dirtyGeneration, null);
  assert(logs.some(linha => linha.includes("manifest_checkpoint")));
}

{
  const storage = criarStorageTemporarioFilaV2();
  const cliente = "cliente_checkpoint_falha_manifesto";
  filaOperacionalV2.registrarManifestoMutacaoObservacional(cliente, {
    itemCount: 2,
    motivo: "insert_viva"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA
  });
  const checkpointFalho = filaOperacionalV2.registrarManifestoCheckpointObservacional(cliente, {
    targetGeneration: 1,
    itemCount: 2,
    motivo: "checkpoint_falho"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: (clienteId, arquivo, dados) => {
      if (arquivo === filaOperacionalV2.FILA_V2_MANIFEST_ARQUIVO) throw new Error("falha_checkpoint_manifesto");
      return storage.writeClienteJson(clienteId, arquivo, dados);
    },
    logger: { log: () => {} },
    agora: AGORA + 1
  });
  const lido = filaOperacionalV2.lerManifestoFilaV2(cliente, {
    getClienteJsonPath: storage.getClienteJsonPath,
    logger: { log: () => {} },
    agora: AGORA + 2
  });

  assert.strictEqual(checkpointFalho.ok, false, "falha ao gravar manifesto de checkpoint permanece observacional");
  assert.strictEqual(lido.manifesto.vivaGeneration, 1);
  assert.strictEqual(lido.manifesto.durableCheckpointGeneration, 0, "durable nao deve avancar se o manifesto nao persistiu");
  assert.strictEqual(lido.manifesto.dirtyGeneration, 1);
}

{
  const storage = criarStorageTemporarioFilaV2();
  const cliente = "cliente_manifesto_monotonico";
  storage.writeClienteJson(cliente, filaOperacionalV2.FILA_V2_MANIFEST_ARQUIVO, {
    version: 2,
    manifestVersion: 2,
    clienteId: cliente,
    vivaGeneration: 5,
    checkpointGeneration: 2,
    durableCheckpointGeneration: 2,
    dirtyGeneration: 3,
    itemCount: 5
  });
  filaOperacionalV2.registrarManifestoMutacaoObservacional(cliente, {
    generation: 1,
    dirtyGeneration: 1,
    itemCount: 5,
    motivo: "controller_generation_antiga"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA
  });
  const checkpointParcial = filaOperacionalV2.registrarManifestoCheckpointObservacional(cliente, {
    targetGeneration: 4,
    itemCount: 4,
    motivo: "checkpoint_parcial"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA + 1
  });
  filaOperacionalV2.registrarManifestoMutacaoObservacional(cliente, {
    generation: 3,
    dirtyGeneration: 3,
    itemCount: 3,
    motivo: "write_antigo_apos_checkpoint"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA + 1
  });
  const checkpoint = filaOperacionalV2.registrarManifestoCheckpointObservacional(cliente, {
    targetGeneration: 99,
    itemCount: 9,
    motivo: "checkpoint_recuperado"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA + 2
  });

  assert.strictEqual(checkpointParcial.manifesto.vivaGeneration, 6);
  assert.strictEqual(checkpointParcial.manifesto.checkpointGeneration, 4);
  assert.strictEqual(checkpointParcial.manifesto.durableCheckpointGeneration, 4);
  assert.strictEqual(checkpointParcial.manifesto.dirtyGeneration, 5, "dirty nao deve regressar para antes do checkpoint");
  assert.strictEqual(checkpoint.manifesto.vivaGeneration, 7, "checkpoint nao deve inflar vivaGeneration acima das mutacoes persistidas");
  assert.strictEqual(checkpoint.manifesto.checkpointGeneration, 7);
  assert.strictEqual(checkpoint.manifesto.durableCheckpointGeneration, 7);
  assert.strictEqual(checkpoint.manifesto.dirtyGeneration, null);
}

{
  const storage = criarStorageTemporarioFilaV2();
  const cliente = "cliente_manifesto_v1_legado";
  storage.writeClienteJson(cliente, filaOperacionalV2.FILA_V2_MANIFEST_ARQUIVO, {
    version: 1,
    clienteId: cliente,
    vivaGeneration: 10,
    checkpointGeneration: 10,
    dirtyGeneration: null,
    itemCount: 10
  });
  const decisaoAntes = filaOperacionalV2.avaliarRecoveryPeloManifesto(cliente, {
    getClienteJsonPath: storage.getClienteJsonPath
  });
  assert.strictEqual(decisaoAntes.available, false, "manifesto v1 nao deve virar autoridade de checkpoint duravel");
  assert.strictEqual(decisaoAntes.motivo, "manifesto_v1_sem_durable");

  const mutacaoSincronizada = filaOperacionalV2.registrarManifestoMutacaoObservacional(cliente, {
    checkpointSincronizado: true,
    itemCount: 11,
    motivo: "sync_legado_seguro"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA
  });

  assert.strictEqual(mutacaoSincronizada.ok, true);
  assert.strictEqual(mutacaoSincronizada.manifesto.manifestVersion, 2);
  assert.strictEqual(mutacaoSincronizada.manifesto.vivaGeneration, 11);
  assert.strictEqual(mutacaoSincronizada.manifesto.durableCheckpointGeneration, 0);
  assert.strictEqual(mutacaoSincronizada.manifesto.dirtyGeneration, 1, "manifest sem proof legado fica fail-closed");
}

{
  const storage = criarStorageTemporarioFilaV2();
  const cliente = "cliente_manifesto_sync_legado_com_proof";
  storage.writeClienteJson(cliente, filaOperacionalV2.FILA_V2_MANIFEST_ARQUIVO, {
    version: 2,
    manifestVersion: 2,
    clienteId: cliente,
    vivaGeneration: 10,
    checkpointGeneration: 10,
    durableCheckpointGeneration: 10,
    dirtyGeneration: null,
    itemCount: 10
  });
  const mutacaoSincronizada = filaOperacionalV2.registrarManifestoMutacaoObservacional(cliente, {
    checkpointSincronizado: true,
    itemCount: 11,
    motivo: "sync_legado_seguro",
    legacyFileProof: {
      proofVersion: 1,
      clienteId: cliente,
      arquivo: "fila.json",
      generation: 11,
      fileRevision: "legacy_manifest_11",
      size: 123,
      mtimeMs: 456,
      publishedAt: "2026-08-29T00:00:00.000Z"
    }
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA
  });

  assert.strictEqual(mutacaoSincronizada.ok, true);
  assert.strictEqual(mutacaoSincronizada.manifesto.vivaGeneration, 11);
  assert.strictEqual(mutacaoSincronizada.manifesto.durableCheckpointGeneration, 11);
  assert.strictEqual(mutacaoSincronizada.manifesto.dirtyGeneration, null);
  assert.strictEqual(mutacaoSincronizada.manifesto.legacyFileProof.fileRevision, "legacy_manifest_11");
}

{
  const storage = criarStorageTemporarioFilaV2();
  const cliente = "cliente_checkpoint_mutacao_concorrente";
  filaOperacionalV2.registrarManifestoMutacaoObservacional(cliente, {
    itemCount: 1,
    motivo: "insert_x"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA
  });
  const targetGeneration = filaOperacionalV2.lerManifestoFilaV2(cliente, {
    getClienteJsonPath: storage.getClienteJsonPath,
    logger: { log: () => {} },
    agora: AGORA
  }).manifesto.vivaGeneration;
  filaOperacionalV2.registrarManifestoMutacaoObservacional(cliente, {
    itemCount: 2,
    motivo: "insert_y_durante_checkpoint"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA + 1
  });
  const checkpoint = filaOperacionalV2.registrarManifestoCheckpointObservacional(cliente, {
    targetGeneration,
    itemCount: 2,
    motivo: "checkpoint_capturou_x"
  }, {
    getClienteJsonPath: storage.getClienteJsonPath,
    writeClienteJson: storage.writeClienteJson,
    logger: { log: () => {} },
    agora: AGORA + 2
  });

  assert.strictEqual(checkpoint.manifesto.vivaGeneration, 2);
  assert.strictEqual(checkpoint.manifesto.durableCheckpointGeneration, 1);
  assert.strictEqual(checkpoint.manifesto.dirtyGeneration, 2, "mutacao posterior ao target continua dirty");
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
  const manifestoPath = storage.getClienteJsonPath(cliente, filaOperacionalV2.FILA_V2_MANIFEST_ARQUIVO);
  fs.mkdirSync(path.dirname(legadoPath), { recursive: true });
  fs.writeFileSync(legadoPath, JSON.stringify([oferta("legado_mtime", { clienteId: cliente })]), "utf8");
  fs.writeFileSync(vivaPath, JSON.stringify([{ item: oferta("viva_mtime", { clienteId: cliente }), bucket: "viva", posicaoLegada: 1 }]), "utf8");
  fs.writeFileSync(manifestoPath, "{manifesto quebrado", "utf8");
  fs.utimesSync(legadoPath, new Date(AGORA - 10_000), new Date(AGORA - 10_000));
  fs.utimesSync(vivaPath, new Date(AGORA), new Date(AGORA));

  const vivaMaisNova = filaOperacionalV2.filaVivaMaisNovaQueLegado(cliente, {
    getClienteJsonPath: storage.getClienteJsonPath
  });
  assert.strictEqual(vivaMaisNova.maisNova, true, "2D.3a nao deve consultar manifesto para decidir recovery");

  fs.utimesSync(legadoPath, new Date(AGORA + 10_000), new Date(AGORA + 10_000));
  const legadoMaisNovo = filaOperacionalV2.filaVivaMaisNovaQueLegado(cliente, {
    getClienteJsonPath: storage.getClienteJsonPath
  });
  assert.strictEqual(legadoMaisNovo.maisNova, false, "viva antiga nao deve sobrepor legado mais recente");
}

function escreverArquivosRecoveryComparacao(storage, cliente, { vivaMtime, legadoMtime, manifesto }) {
  const legadoPath = storage.getClienteJsonPath(cliente, "fila.json");
  const vivaPath = storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO);
  const manifestoPath = storage.getClienteJsonPath(cliente, filaOperacionalV2.FILA_V2_MANIFEST_ARQUIVO);
  fs.mkdirSync(path.dirname(legadoPath), { recursive: true });
  fs.writeFileSync(legadoPath, JSON.stringify([oferta(`${cliente}_legado`, { clienteId: cliente })]), "utf8");
  fs.writeFileSync(vivaPath, JSON.stringify([{ item: oferta(`${cliente}_viva`, { clienteId: cliente }), bucket: "viva", posicaoLegada: 0 }]), "utf8");
  if (manifesto !== undefined) {
    fs.writeFileSync(
      manifestoPath,
      typeof manifesto === "string" ? manifesto : JSON.stringify(manifesto),
      "utf8"
    );
  }
  fs.utimesSync(legadoPath, new Date(legadoMtime), new Date(legadoMtime));
  fs.utimesSync(vivaPath, new Date(vivaMtime), new Date(vivaMtime));
  return { legadoPath, vivaPath, manifestoPath };
}

function manifestoRecoveryV2(vivaGeneration, durableCheckpointGeneration, itemCount = 1) {
  return {
    version: 2,
    manifestVersion: 2,
    vivaGeneration,
    checkpointGeneration: durableCheckpointGeneration,
    durableCheckpointGeneration,
    itemCount
  };
}

function escreverArquivoComProof(storage, cliente, arquivo, arquivoProof, dados, generation, fileRevision, mtime = AGORA) {
  storage.writeClienteJson(cliente, arquivo, dados);
  const arquivoPath = storage.getClienteJsonPath(cliente, arquivo);
  fs.utimesSync(arquivoPath, new Date(mtime), new Date(mtime));
  const stat = fs.statSync(arquivoPath);
  const proof = {
    proofVersion: filaOperacionalV2.FILA_V2_FILE_PROOF_VERSION,
    clienteId: cliente,
    arquivo,
    generation,
    targetGeneration: generation,
    fileRevision,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    publishedAt: new Date(mtime).toISOString()
  };
  storage.writeClienteJson(cliente, arquivoProof, proof);
  return proof;
}

function escreverEstadoGenerationAuthority(storage, repoFake, cliente, config = {}) {
  const vivaGeneration = config.vivaGeneration ?? 1;
  const durableCheckpointGeneration = config.durableCheckpointGeneration ?? vivaGeneration;
  const dirtyGeneration = Object.prototype.hasOwnProperty.call(config, "dirtyGeneration")
    ? config.dirtyGeneration
    : (vivaGeneration > durableCheckpointGeneration ? durableCheckpointGeneration + 1 : null);
  const vivaProof = config.vivaProof === false ? null : escreverArquivoComProof(
    storage,
    cliente,
    FILA_VIVA_ARQUIVO,
    filaOperacionalV2.FILA_VIVA_PROOF_ARQUIVO,
    [{ item: oferta(`${cliente}_viva`, { clienteId: cliente }), bucket: "viva", posicaoLegada: 0 }],
    config.vivaProofGeneration ?? vivaGeneration,
    config.vivaFileRevision || `viva_${vivaGeneration}`,
    config.vivaMtime ?? AGORA
  );
  const legacyProof = config.legacyProof === false ? null : escreverArquivoComProof(
    storage,
    cliente,
    "fila.json",
    filaOperacionalV2.FILA_LEGADA_PROOF_ARQUIVO,
    [oferta(`${cliente}_legado`, { clienteId: cliente })],
    config.legacyProofGeneration ?? durableCheckpointGeneration,
    config.legacyFileRevision || `legacy_${durableCheckpointGeneration}`,
    config.legacyMtime ?? (AGORA - 1000)
  );
  if (config.manifest !== false) {
    storage.writeClienteJson(cliente, filaOperacionalV2.FILA_V2_MANIFEST_ARQUIVO, config.manifest || {
      manifestVersion: 2,
      version: 2,
      vivaGeneration,
      checkpointGeneration: durableCheckpointGeneration,
      durableCheckpointGeneration,
      dirtyGeneration,
      vivaFileProof: vivaProof,
      legacyFileProof: legacyProof,
      itemCount: 1
    });
  }
  repoFake.states.set(cliente, {
    clienteId: cliente,
    revision: config.revision ?? 10,
    vivaGeneration,
    durableCheckpointGeneration,
    dirtyGeneration,
    authorityReady: config.authorityReady !== false,
    authorityReadyGeneration: config.authorityReadyGeneration ?? vivaGeneration,
    authorityReadyRevision: config.authorityReadyRevision ?? 10,
    authorityReadyAt: "2026-08-28T00:00:00.000Z",
    vivaFileProof: config.dbVivaProof === false ? null : vivaProof,
    legacyFileProof: config.dbLegacyProof === false ? null : legacyProof,
    pendingCheckpointRevision: config.pendingCheckpointRevision || "",
    pendingCheckpointTargetGeneration: Object.prototype.hasOwnProperty.call(config, "pendingCheckpointTargetGeneration")
      ? config.pendingCheckpointTargetGeneration
      : null,
    pendingCheckpointStartedAt: null
  });
  return { vivaProof, legacyProof };
}

function avaliarRecoveryComparacaoTeste(nome, config) {
  const storage = criarStorageTemporarioFilaV2();
  const cliente = `cliente_manifest_mtime_${nome}`;
  const logs = [];
  const paths = escreverArquivosRecoveryComparacao(storage, cliente, config);
  const leituras = [];
  const existsChecks = [];
  const fsObservado = {
    existsSync: (file) => {
      existsChecks.push(file);
      return fs.existsSync(file);
    },
    statSync: fs.statSync.bind(fs),
    readFileSync: (file, encoding) => {
      leituras.push(file);
      return fs.readFileSync(file, encoding);
    }
  };

  const resultado = filaOperacionalV2.filaVivaMaisNovaQueLegado(cliente, {
    getClienteJsonPath: storage.getClienteJsonPath,
    fs: fsObservado,
    env: config.env || {
      FILA_V2_OPERACIONAL_ROLLOUT: "canary",
      FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
    },
    agora: config.agora || AGORA,
    logger: { log: (...args) => logs.push(args.join(" ")) }
  });
  const comparacao = resultado.recoveryComparacaoManifesto;

  const manifestoConsultado = existsChecks.includes(paths.manifestoPath) || leituras.includes(paths.manifestoPath);
  const esperaComparacao = config.esperaComparacao !== false;
  if (esperaComparacao) {
    assert(manifestoConsultado, "cliente V2 deve consultar manifesto pequeno para comparacao observacional");
    assert(
      leituras.every(file => file === paths.manifestoPath),
      "2D.3b nao deve ler fila.json/fila-viva.json para telemetria, apenas stat e manifest pequeno"
    );
    if (config.esperaLog !== false) {
      assert(logs.some(linha => linha.includes("[FILA-V2-RECOVERY-COMPARACAO]")), "comparacao manifesto x mtime deve ser logada");
    }
  } else {
    assert.strictEqual(manifestoConsultado, false, "cliente legado/off-canary nao deve consultar manifesto 2D.3b");
    assert.strictEqual(logs.some(linha => linha.includes("[FILA-V2-RECOVERY-COMPARACAO]")), false, "cliente legado/off-canary nao deve gerar telemetria 2D.3b");
  }

  return { resultado, comparacao, logs, leituras, existsChecks, paths };
}

{
  filaOperacionalV2.resetarThrottleRecoveryComparacaoParaTeste();
  const { resultado, comparacao } = avaliarRecoveryComparacaoTeste("off_canary_sem_custo", {
    vivaMtime: AGORA + 10_000,
    legadoMtime: AGORA,
    manifesto: manifestoRecoveryV2(1, 0),
    env: {
      FILA_V2_OPERACIONAL_ROLLOUT: "canary",
      FILA_V2_OPERACIONAL_CANARY_CLIENTES: "outro_cliente"
    },
    esperaComparacao: false
  });
  assert.strictEqual(resultado.maisNova, true, "mtime continua autoridade para cliente legado/off-canary");
  assert.strictEqual(comparacao.resultadoComparacao, "telemetria_desativada");
  assert.strictEqual(filaOperacionalV2.tamanhoThrottleRecoveryComparacaoParaTeste(), 0, "cliente off-canary nao deve criar estado de throttle");
}

{
  filaOperacionalV2.resetarThrottleRecoveryComparacaoParaTeste();
  const { resultado, comparacao } = avaliarRecoveryComparacaoTeste("equivalente_limpo", {
    vivaMtime: AGORA,
    legadoMtime: AGORA + 10_000,
    manifesto: manifestoRecoveryV2(7, 7)
  });
  assert.strictEqual(resultado.maisNova, false);
  assert.strictEqual(comparacao.manifestDecisionAvailable, true);
  assert.strictEqual(comparacao.manifestRecoveryNeeded, false);
  assert.strictEqual(comparacao.resultadoComparacao, "equivalente");
}

{
  const { resultado, comparacao } = avaliarRecoveryComparacaoTeste("equivalente_recovery", {
    vivaMtime: AGORA + 10_000,
    legadoMtime: AGORA,
    manifesto: manifestoRecoveryV2(8, 7)
  });
  assert.strictEqual(resultado.maisNova, true);
  assert.strictEqual(comparacao.manifestDecisionAvailable, true);
  assert.strictEqual(comparacao.manifestRecoveryNeeded, true);
  assert.strictEqual(comparacao.resultadoComparacao, "equivalente");
}

{
  const { resultado, comparacao } = avaliarRecoveryComparacaoTeste("manifest_sim_mtime_nao", {
    vivaMtime: AGORA,
    legadoMtime: AGORA + 10_000,
    manifesto: manifestoRecoveryV2(9, 8)
  });
  assert.strictEqual(resultado.maisNova, false, "manifesto nao pode disparar recovery quando mtime nao recupera");
  assert.strictEqual(comparacao.manifestRecoveryNeeded, true);
  assert.strictEqual(comparacao.resultadoComparacao, "manifest_recuperaria_mtime_nao");
}

{
  const { resultado, comparacao } = avaliarRecoveryComparacaoTeste("mtime_sim_manifest_nao", {
    vivaMtime: AGORA + 10_000,
    legadoMtime: AGORA,
    manifesto: manifestoRecoveryV2(10, 10)
  });
  assert.strictEqual(resultado.maisNova, true, "mtime continua autoridade e recuperaria mesmo com manifesto sincronizado");
  assert.strictEqual(comparacao.manifestRecoveryNeeded, false);
  assert.strictEqual(comparacao.resultadoComparacao, "mtime_recuperaria_manifest_nao");
}

{
  const { resultado, comparacao } = avaliarRecoveryComparacaoTeste("manifest_ausente", {
    vivaMtime: AGORA + 10_000,
    legadoMtime: AGORA
  });
  assert.strictEqual(resultado.maisNova, true);
  assert.strictEqual(comparacao.manifestDecisionAvailable, false);
  assert.strictEqual(comparacao.resultadoComparacao, "manifest_indisponivel");
}

{
  const { resultado, comparacao } = avaliarRecoveryComparacaoTeste("manifest_corrompido", {
    vivaMtime: AGORA + 10_000,
    legadoMtime: AGORA,
    manifesto: "{manifesto quebrado"
  });
  assert.strictEqual(resultado.maisNova, true);
  assert.strictEqual(comparacao.manifestDecisionAvailable, false);
  assert.strictEqual(comparacao.resultadoComparacao, "manifest_indisponivel");
}

{
  const { resultado, comparacao } = avaliarRecoveryComparacaoTeste("checkpoint_maior_viva", {
    vivaMtime: AGORA,
    legadoMtime: AGORA + 10_000,
    manifesto: {
      version: 2,
      manifestVersion: 2,
      vivaGeneration: 3,
      checkpointGeneration: 4,
      durableCheckpointGeneration: 4,
      itemCount: 1
    }
  });
  assert.strictEqual(resultado.maisNova, false);
  assert.strictEqual(comparacao.manifestDecisionAvailable, false, "checkpoint > viva torna manifesto inconclusivo");
  assert.strictEqual(comparacao.resultadoComparacao, "manifest_indisponivel");
}

for (const [nome, manifesto] of [
  ["geracao_null", { version: 2, manifestVersion: 2, vivaGeneration: null, durableCheckpointGeneration: null, itemCount: 1 }],
  ["geracao_string_vazia", { version: 2, manifestVersion: 2, vivaGeneration: "", durableCheckpointGeneration: "", itemCount: 1 }],
  ["geracao_whitespace", { version: 2, manifestVersion: 2, vivaGeneration: "   ", durableCheckpointGeneration: 0, itemCount: 1 }],
  ["geracao_negativa", { version: 2, manifestVersion: 2, vivaGeneration: -1, durableCheckpointGeneration: 0, itemCount: 1 }],
  ["geracao_textual", { version: 2, manifestVersion: 2, vivaGeneration: "NaN", durableCheckpointGeneration: 0, itemCount: 1 }],
  ["geracao_array", { version: 2, manifestVersion: 2, vivaGeneration: [1], durableCheckpointGeneration: 0, itemCount: 1 }]
]) {
  const { resultado, comparacao } = avaliarRecoveryComparacaoTeste(nome, {
    vivaMtime: AGORA + 10_000,
    legadoMtime: AGORA,
    manifesto
  });
  assert.strictEqual(resultado.maisNova, true, `mtime deve seguir autoridade com manifesto invalido: ${nome}`);
  assert.strictEqual(comparacao.manifestDecisionAvailable, false, `manifesto invalido deve ficar indisponivel: ${nome}`);
  assert.strictEqual(comparacao.resultadoComparacao, "manifest_indisponivel", `manifesto invalido deve ser inconclusivo: ${nome}`);
}

{
  const { resultado, comparacao } = avaliarRecoveryComparacaoTeste("geracao_zero_valida", {
    vivaMtime: AGORA,
    legadoMtime: AGORA + 10_000,
    manifesto: manifestoRecoveryV2(0, 0, 0)
  });
  assert.strictEqual(resultado.maisNova, false);
  assert.strictEqual(comparacao.manifestDecisionAvailable, true, "geracao 0 numerica faz parte do estado inicial valido do manifesto");
  assert.strictEqual(comparacao.manifestRecoveryNeeded, false);
  assert.strictEqual(comparacao.resultadoComparacao, "equivalente");
}

{
  filaOperacionalV2.resetarThrottleRecoveryComparacaoParaTeste();
  avaliarRecoveryComparacaoTeste("throttle_mesma_chave", {
    vivaMtime: AGORA,
    legadoMtime: AGORA + 10_000,
    manifesto: manifestoRecoveryV2(0, 0, 0),
    agora: AGORA
  });
  avaliarRecoveryComparacaoTeste("throttle_mesma_chave", {
    vivaMtime: AGORA,
    legadoMtime: AGORA + 10_000,
    manifesto: manifestoRecoveryV2(0, 0, 0),
    agora: AGORA + 1_000,
    esperaLog: false
  });
  assert.strictEqual(filaOperacionalV2.tamanhoThrottleRecoveryComparacaoParaTeste(), 1, "logs equivalentes do mesmo cliente devem reutilizar a mesma chave");
}

{
  filaOperacionalV2.resetarThrottleRecoveryComparacaoParaTeste();
  const limite = filaOperacionalV2.RECOVERY_COMPARACAO_THROTTLE_MAX_ENTRADAS;
  for (let i = 0; i < limite + 50; i += 1) {
    avaliarRecoveryComparacaoTeste(`throttle_cap_${i}`, {
      vivaMtime: AGORA,
      legadoMtime: AGORA + 10_000,
      manifesto: manifestoRecoveryV2(0, 0, 0),
      agora: AGORA
    });
  }
  assert(
    filaOperacionalV2.tamanhoThrottleRecoveryComparacaoParaTeste() <= limite,
    "throttle deve manter limite global de entradas"
  );
  avaliarRecoveryComparacaoTeste("throttle_prune_idade", {
    vivaMtime: AGORA,
    legadoMtime: AGORA + 10_000,
    manifesto: manifestoRecoveryV2(0, 0, 0),
    agora: AGORA + 10 * 60 * 1000
  });
  assert(
    filaOperacionalV2.tamanhoThrottleRecoveryComparacaoParaTeste() < limite,
    "entradas antigas devem ser removidas no prune condicional"
  );
}

{
  filaOperacionalV2.resetarThrottleRecoveryComparacaoParaTeste();
  const primeira = avaliarRecoveryComparacaoTeste("divergencia_imediata", {
    vivaMtime: AGORA,
    legadoMtime: AGORA + 10_000,
    manifesto: manifestoRecoveryV2(1, 0),
    agora: AGORA
  });
  const segunda = avaliarRecoveryComparacaoTeste("divergencia_imediata", {
    vivaMtime: AGORA,
    legadoMtime: AGORA + 10_000,
    manifesto: manifestoRecoveryV2(1, 0),
    agora: AGORA + 1_000
  });
  assert(primeira.logs.some(linha => linha.includes("manifest_recuperaria_mtime_nao")));
  assert(segunda.logs.some(linha => linha.includes("manifest_recuperaria_mtime_nao")), "divergencia deve continuar logando imediatamente");
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

async function testarPromocaoLockPostgresOperacional() {
  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_lock_duas_inserts";
    const env = {
      FILA_V2_OPERACIONAL_ROLLOUT: "canary",
      FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
    };

    const [a, b] = await Promise.all([
      filaOperacionalV2.inserirItemFilaVivaCoordenado(cliente, oferta("lock_a", { clienteId: cliente }), {
        getClienteJsonPath: storage.getClienteJsonPath,
        writeClienteJson: storage.writeClienteJson,
        manifestStateRepository: repoFake,
        env,
        logger: { log: () => {} },
        agora: AGORA
      }),
      filaOperacionalV2.inserirItemFilaVivaCoordenado(cliente, oferta("lock_b", { clienteId: cliente }), {
        getClienteJsonPath: storage.getClienteJsonPath,
        writeClienteJson: storage.writeClienteJson,
        manifestStateRepository: repoFake,
        env,
        logger: { log: () => {} },
        agora: AGORA + 1
      })
    ]);

    const viva = JSON.parse(fs.readFileSync(storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO), "utf8"));
    const manifest = filaOperacionalV2.lerManifestoFilaV2(cliente, {
      getClienteJsonPath: storage.getClienteJsonPath,
      logger: { log: () => {} },
      agora: AGORA
    }).manifesto;

    assert.strictEqual(a.ok, true);
    assert.strictEqual(b.ok, true);
    assert.deepStrictEqual([a.generation, b.generation].sort((x, y) => x - y), [1, 2], "geracoes coordenadas nao podem duplicar");
    assert.strictEqual(viva.length, 2, "duas inserts simultaneas devem persistir exatamente uma vez cada");
    assert.strictEqual(manifest.vivaGeneration, 2, "manifest JSON deve refletir generation fornecida pelo protocolo DB");
    assert.strictEqual(repoFake.states.get(cliente).vivaGeneration, 2);
    assert.strictEqual(repoFake.states.get(cliente).durableCheckpointGeneration, 0);
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const clienteA = "cliente_lock_a";
    const clienteB = "cliente_lock_b";
    const env = {
      FILA_V2_OPERACIONAL_ROLLOUT: "global"
    };
    const [a, b] = await Promise.all([
      filaOperacionalV2.inserirItemFilaVivaCoordenado(clienteA, oferta("a1", { clienteId: clienteA }), {
        getClienteJsonPath: storage.getClienteJsonPath,
        writeClienteJson: storage.writeClienteJson,
        manifestStateRepository: repoFake,
        env,
        logger: { log: () => {} },
        agora: AGORA
      }),
      filaOperacionalV2.inserirItemFilaVivaCoordenado(clienteB, oferta("b1", { clienteId: clienteB }), {
        getClienteJsonPath: storage.getClienteJsonPath,
        writeClienteJson: storage.writeClienteJson,
        manifestStateRepository: repoFake,
        env,
        logger: { log: () => {} },
        agora: AGORA
      })
    ]);

    assert.strictEqual(a.generation, 1);
    assert.strictEqual(b.generation, 1, "clientes diferentes mantem geracao independente e paralela");
    assert.strictEqual(repoFake.states.get(clienteA).vivaGeneration, 1);
    assert.strictEqual(repoFake.states.get(clienteB).vivaGeneration, 1);
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake({ falharMutacao: true });
    const cliente = "cliente_db_indisponivel_insert";
    const resultado = await filaOperacionalV2.inserirItemFilaVivaCoordenado(cliente, oferta("sem_db", { clienteId: cliente }), {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: storage.writeClienteJson,
      manifestStateRepository: repoFake,
      env: {
        FILA_V2_OPERACIONAL_ROLLOUT: "canary",
        FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
      },
      logger: { log: () => {} },
      agora: AGORA
    });

    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(fs.existsSync(storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO)), false, "DB indisponivel nao autoriza write de fila-viva");
    assert.strictEqual(fs.existsSync(storage.getClienteJsonPath(cliente, filaOperacionalV2.FILA_V2_MANIFEST_ARQUIVO)), false, "DB indisponivel nao inventa manifest generation");
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_off_canary_lock";
    const resultado = await filaOperacionalV2.inserirItemFilaVivaCoordenado(cliente, oferta("off_canary", { clienteId: cliente }), {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: storage.writeClienteJson,
      manifestStateRepository: repoFake,
      env: {
        FILA_V2_OPERACIONAL_ROLLOUT: "canary",
        FILA_V2_OPERACIONAL_CANARY_CLIENTES: "outro_cliente"
      },
      logger: { log: () => {} },
      agora: AGORA
    });

    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.motivo, "manifest_state_desabilitado");
    assert.strictEqual(repoFake.chamadas.length, 0, "off-canary nao pode abrir protocolo DB");
    assert.strictEqual(fs.existsSync(storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO)), false, "off-canary nao pode escrever viva pelo helper V2");
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_update_remove_lock";
    const env = {
      FILA_V2_OPERACIONAL_ROLLOUT: "canary",
      FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
    };
    const item = oferta("update_remove_lock", { clienteId: cliente });
    await filaOperacionalV2.inserirItemFilaVivaCoordenado(cliente, item, {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: storage.writeClienteJson,
      manifestStateRepository: repoFake,
      env,
      logger: { log: () => {} },
      agora: AGORA
    });
    const update = await filaOperacionalV2.atualizarItemFilaVivaCoordenado(cliente, {
      ...item,
      status: "processando"
    }, {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: storage.writeClienteJson,
      manifestStateRepository: repoFake,
      env,
      logger: { log: () => {} },
      agora: AGORA + 1
    });
    const remove = await filaOperacionalV2.removerItemFilaVivaCoordenado(cliente, item, {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: storage.writeClienteJson,
      manifestStateRepository: repoFake,
      env,
      logger: { log: () => {} },
      agora: AGORA + 2
    });
    const viva = JSON.parse(fs.readFileSync(storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO), "utf8"));
    const state = repoFake.states.get(cliente);

    assert.strictEqual(update.ok, true);
    assert.strictEqual(update.atualizouViva, true);
    assert.strictEqual(remove.ok, true);
    assert.strictEqual(remove.removeuDaViva, true);
    assert.strictEqual(viva.length, 0);
    assert.strictEqual(state.vivaGeneration, 3);
    assert.strictEqual(state.durableCheckpointGeneration, 0, "sync sem proof legado fresco nao pode avancar durable");
    assert.strictEqual(state.dirtyGeneration, 1);
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_update_legacy_proof_lock";
    const env = {
      FILA_V2_OPERACIONAL_ROLLOUT: "canary",
      FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
    };
    const item = oferta("update_legacy_proof_lock", { clienteId: cliente });
    await filaOperacionalV2.inserirItemFilaVivaCoordenado(cliente, item, {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: storage.writeClienteJson,
      manifestStateRepository: repoFake,
      env,
      logger: { log: () => {} },
      agora: AGORA
    });
    const itemAtualizado = { ...item, status: "processando" };
    storage.writeClienteJson(cliente, "fila.json", [itemAtualizado]);
    const update = await filaOperacionalV2.atualizarItemFilaVivaCoordenado(cliente, itemAtualizado, {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: storage.writeClienteJson,
      manifestStateRepository: repoFake,
      env,
      logger: { log: () => {} },
      agora: AGORA + 1,
      publicarLegacyProof: true
    });
    const state = repoFake.states.get(cliente);
    const proofPath = storage.getClienteJsonPath(cliente, filaOperacionalV2.FILA_LEGADA_PROOF_ARQUIVO);
    const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));

    assert.strictEqual(update.ok, true);
    assert.strictEqual(update.legacyFileProofOk, true);
    assert.strictEqual(proof.arquivo, "fila.json");
    assert.strictEqual(proof.generation, 2);
    assert.strictEqual(state.vivaGeneration, 2);
    assert.strictEqual(state.durableCheckpointGeneration, 2, "proof legado fresco permite fechar durable");
    assert.strictEqual(state.dirtyGeneration, null);
    assert.strictEqual(state.legacyFileProof.fileRevision, proof.fileRevision);
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_rewrite_sem_proof_fail_closed";
    const env = {
      FILA_V2_OPERACIONAL_ROLLOUT: "canary",
      FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente,
      FILA_V2_RECOVERY_AUTORIDADE: "generation"
    };
    escreverEstadoGenerationAuthority(storage, repoFake, cliente, {
      vivaGeneration: 5,
      durableCheckpointGeneration: 5,
      dirtyGeneration: null,
      vivaMtime: AGORA,
      legacyMtime: AGORA
    });
    const antes = repoFake.states.get(cliente);
    const invalidacao = await filaOperacionalV2.invalidarAuthorityReadyPorRewriteLegado(cliente, {
      motivo: "salvarFila_sem_proof"
    }, {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: storage.writeClienteJson,
      manifestStateRepository: repoFake,
      env,
      logger: { log: () => {} },
      agora: AGORA + 1
    });
    const depois = repoFake.states.get(cliente);

    assert.strictEqual(invalidacao.ok, true);
    assert.strictEqual(depois.vivaGeneration, antes.vivaGeneration, "invalidacao nao pode mexer na geracao viva");
    assert.strictEqual(depois.durableCheckpointGeneration, antes.durableCheckpointGeneration, "durable nao deve regredir nem avancar");
    assert.strictEqual(depois.authorityReady, false, "rewrite sem proof fica fail-closed");
    assert.strictEqual(repoFake.chamadas.some(chamada => chamada.tipo === "invalidar_authority_ready"), true);
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_rewrite_com_proof_renovado";
    const env = {
      FILA_V2_OPERACIONAL_ROLLOUT: "canary",
      FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente,
      FILA_V2_RECOVERY_AUTORIDADE: "generation"
    };
    const item = oferta("rewrite_proof", { clienteId: cliente });
    await filaOperacionalV2.inserirItemFilaVivaCoordenado(cliente, item, {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: storage.writeClienteJson,
      manifestStateRepository: repoFake,
      env,
      logger: { log: () => {} },
      agora: AGORA
    });
    const itemAtualizado = { ...item, status: "processando", statusDetalhe: "primeiro save" };
    storage.writeClienteJson(cliente, "fila.json", [itemAtualizado]);
    const primeira = await filaOperacionalV2.atualizarItemFilaVivaCoordenado(cliente, itemAtualizado, {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: storage.writeClienteJson,
      manifestStateRepository: repoFake,
      env,
      logger: { log: () => {} },
      agora: AGORA + 1,
      publicarLegacyProof: true
    });
    const proofPrimeiro = JSON.parse(fs.readFileSync(
      storage.getClienteJsonPath(cliente, filaOperacionalV2.FILA_LEGADA_PROOF_ARQUIVO),
      "utf8"
    ));
    const itemSegundo = { ...itemAtualizado, statusDetalhe: "segundo save muda tamanho fisico" };
    storage.writeClienteJson(cliente, "fila.json", [itemSegundo]);
    const segunda = await filaOperacionalV2.atualizarItemFilaVivaCoordenado(cliente, itemSegundo, {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: storage.writeClienteJson,
      manifestStateRepository: repoFake,
      env,
      logger: { log: () => {} },
      agora: AGORA + 2,
      publicarLegacyProof: true
    });
    const proofSegundo = JSON.parse(fs.readFileSync(
      storage.getClienteJsonPath(cliente, filaOperacionalV2.FILA_LEGADA_PROOF_ARQUIVO),
      "utf8"
    ));
    const statAtual = fs.statSync(storage.getClienteJsonPath(cliente, "fila.json"));
    const state = repoFake.states.get(cliente);

    assert.strictEqual(primeira.legacyFileProofOk, true);
    assert.strictEqual(segunda.legacyFileProofOk, true);
    assert.notStrictEqual(proofPrimeiro.fileRevision, proofSegundo.fileRevision, "cada publicacao deve ganhar revision propria");
    assert.strictEqual(proofSegundo.size, statAtual.size, "proof renovado deve provar o arquivo final atual");
    assert(Math.abs(proofSegundo.mtimeMs - statAtual.mtimeMs) <= 1, "proof renovado preserva validacao stat/mtime");
    assert.strictEqual(state.durableCheckpointGeneration, state.vivaGeneration, "sync com proof fresco pode fechar durable");
    assert.strictEqual(state.legacyFileProof.fileRevision, proofSegundo.fileRevision);
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_stat_mismatch_detalhado";
    const env = {
      FILA_V2_OPERACIONAL_ROLLOUT: "canary",
      FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente,
      FILA_V2_RECOVERY_AUTORIDADE: "generation"
    };
    escreverEstadoGenerationAuthority(storage, repoFake, cliente, {
      vivaGeneration: 7,
      durableCheckpointGeneration: 7,
      dirtyGeneration: null,
      vivaMtime: AGORA,
      legacyMtime: AGORA
    });
    fs.appendFileSync(storage.getClienteJsonPath(cliente, "fila.json"), "\n ");
    const resultado = await filaOperacionalV2.reconciliarFilaV2ParaLeitura(cliente, { contexto: "stat_mismatch" }, {
      getClienteJsonPath: storage.getClienteJsonPath,
      manifestStateRepository: repoFake,
      env,
      logger: { log: () => {} }
    });

    assert.strictEqual(resultado.autoridadeUsada, "mtime");
    assert.strictEqual(resultado.motivo, "stat_mismatch");
    assert.strictEqual(resultado.validacaoGeneration.arquivo, "fila.json");
    assert.notStrictEqual(resultado.validacaoGeneration.proofSize, resultado.validacaoGeneration.statSize, "telemetria barata deve mostrar tamanho proof/stat");
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_file_proof_viva";
    const env = {
      FILA_V2_OPERACIONAL_ROLLOUT: "canary",
      FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
    };
    const resultado = await filaOperacionalV2.inserirItemFilaVivaCoordenado(cliente, oferta("proof_viva", { clienteId: cliente }), {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: storage.writeClienteJson,
      manifestStateRepository: repoFake,
      env,
      logger: { log: () => {} },
      agora: AGORA
    });
    const proofPath = storage.getClienteJsonPath(cliente, filaOperacionalV2.FILA_VIVA_PROOF_ARQUIVO);
    const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
    const manifest = filaOperacionalV2.lerManifestoFilaV2(cliente, {
      getClienteJsonPath: storage.getClienteJsonPath,
      logger: { log: () => {} }
    }).manifesto;

    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(proof.arquivo, FILA_VIVA_ARQUIVO);
    assert.strictEqual(proof.generation, resultado.generation);
    assert.strictEqual(typeof proof.fileRevision, "string");
    assert(proof.fileRevision.length > 0, "proof precisa ligar generation a uma publicacao fisica");
    assert.strictEqual(repoFake.states.get(cliente).vivaFileProof.fileRevision, proof.fileRevision);
    assert.strictEqual(manifest.vivaFileProof.fileRevision, proof.fileRevision);
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_file_proof_falha";
    const env = {
      FILA_V2_OPERACIONAL_ROLLOUT: "canary",
      FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
    };
    const resultado = await filaOperacionalV2.inserirItemFilaVivaCoordenado(cliente, oferta("proof_falha", { clienteId: cliente }), {
      getClienteJsonPath: storage.getClienteJsonPath,
      writeClienteJson: (clienteId, arquivo, dados) => {
        if (arquivo === filaOperacionalV2.FILA_VIVA_PROOF_ARQUIVO) throw new Error("proof_falhou");
        return storage.writeClienteJson(clienteId, arquivo, dados);
      },
      manifestStateRepository: repoFake,
      env,
      logger: { log: () => {} },
      agora: AGORA
    });

    assert.strictEqual(resultado.ok, false, "falha entre viva e proof nao pode confirmar generation no DB");
    assert.strictEqual(repoFake.states.has(cliente), false, "DB fake faz rollback logico quando proof falha");
    assert.strictEqual(fs.existsSync(storage.getClienteJsonPath(cliente, FILA_VIVA_ARQUIVO)), true, "arquivo publicado sem proof fica para fallback conservador por mtime");
    assert.strictEqual(fs.existsSync(storage.getClienteJsonPath(cliente, filaOperacionalV2.FILA_VIVA_PROOF_ARQUIVO)), false);
  }

  {
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_checkpoint_file_proof";
    await repoFake.registrarMutacaoDuravel(cliente, {
      fileRevision: "viva_rev_1",
      escreverArquivo: async ({ nextGeneration, fileRevision }) => ({
        ok: true,
        vivaFileProof: {
          proofVersion: 1,
          clienteId: cliente,
          arquivo: FILA_VIVA_ARQUIVO,
          generation: nextGeneration,
          targetGeneration: nextGeneration,
          fileRevision,
          size: 50,
          mtimeMs: 60,
          publishedAt: "2026-08-28T00:00:00.000Z"
        }
      })
    });
    const alvoA = await repoFake.capturarTargetCheckpoint(cliente, { checkpointRevision: "checkpoint_a" });
    const alvoB = await repoFake.capturarTargetCheckpoint(cliente, { checkpointRevision: "checkpoint_b" });
    let publicouA = false;
    const antigo = await repoFake.confirmarCheckpointDuravel(cliente, {
      targetGeneration: alvoA.targetGeneration,
      checkpointRevision: alvoA.checkpointRevision,
      publicarCheckpoint: async () => {
        publicouA = true;
        return { ok: true };
      }
    });
    const novo = await repoFake.confirmarCheckpointDuravel(cliente, {
      targetGeneration: alvoB.targetGeneration,
      checkpointRevision: alvoB.checkpointRevision,
      publicarCheckpoint: async ({ checkpointRevision, targetGeneration }) => ({
        ok: true,
        legacyFileProof: {
          proofVersion: 1,
          clienteId: cliente,
          arquivo: "fila.json",
          generation: targetGeneration,
          targetGeneration,
          fileRevision: checkpointRevision,
          size: 70,
          mtimeMs: 80,
          publishedAt: "2026-08-28T00:00:01.000Z"
        }
      })
    });

    assert.strictEqual(antigo.ok, false);
    assert.strictEqual(publicouA, false, "checkpoint antigo nao executa publicacao fisica apos perder pending");
    assert.strictEqual(novo.ok, true);
    assert.strictEqual(repoFake.states.get(cliente).legacyFileProof.fileRevision, "checkpoint_b");
    assert.strictEqual(repoFake.states.get(cliente).durableCheckpointGeneration, 1);
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const controlador = filaOperacionalV2.criarControladorFilaOperacionalV2({
      env: {
        FILA_V2_OPERACIONAL_ROLLOUT: "canary",
        FILA_V2_OPERACIONAL_CANARY_CLIENTES: "cliente_preparar_lock"
      },
      ...storage
    });
    const resultado = controlador.prepararSeHabilitado({
      clienteId: "cliente_preparar_lock",
      fila: [oferta("preparar_lock", { clienteId: "cliente_preparar_lock" })],
      agora: AGORA
    });

    assert.strictEqual(resultado.pulou, true);
    assert.strictEqual(resultado.motivo, "operacional_requer_lock", "preparacao operacional nao pode escrever viva fora do lock");
    assert.strictEqual(fs.existsSync(storage.getClienteJsonPath("cliente_preparar_lock", FILA_VIVA_ARQUIVO)), false);
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_authority_mtime_default";
    escreverArquivosRecoveryComparacao(storage, cliente, {
      vivaMtime: AGORA,
      legadoMtime: AGORA - 1000
    });
    const resultado = await filaOperacionalV2.reconciliarFilaV2ParaLeitura(cliente, { contexto: "teste" }, {
      getClienteJsonPath: storage.getClienteJsonPath,
      manifestStateRepository: repoFake,
      env: {},
      logger: { log: () => {} }
    });
    assert.strictEqual(resultado.autoridadeUsada, "mtime");
    assert.strictEqual(resultado.maisNova, true);
    assert.strictEqual(repoFake.chamadas.some(chamada => chamada.tipo === "authority_recovery"), false, "flag ausente nao consulta authority PG");
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_authority_flag_invalida";
    escreverArquivosRecoveryComparacao(storage, cliente, {
      vivaMtime: AGORA,
      legadoMtime: AGORA - 1000
    });
    const resultado = await filaOperacionalV2.reconciliarFilaV2ParaLeitura(cliente, { contexto: "teste" }, {
      getClienteJsonPath: storage.getClienteJsonPath,
      manifestStateRepository: repoFake,
      env: { FILA_V2_RECOVERY_AUTORIDADE: "outra" },
      logger: { log: () => {} }
    });
    assert.strictEqual(resultado.autoridadeSolicitada, "mtime");
    assert.strictEqual(resultado.autoridadeUsada, "mtime");
    assert.strictEqual(repoFake.chamadas.some(chamada => chamada.tipo === "authority_recovery"), false, "flag invalida cai para mtime sem PG de authority");
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_generation_off_canary";
    escreverArquivosRecoveryComparacao(storage, cliente, {
      vivaMtime: AGORA,
      legadoMtime: AGORA - 1000
    });
    const resultado = await filaOperacionalV2.reconciliarFilaV2ParaLeitura(cliente, { contexto: "teste" }, {
      getClienteJsonPath: storage.getClienteJsonPath,
      manifestStateRepository: repoFake,
      env: {
        FILA_V2_RECOVERY_AUTORIDADE: "generation",
        FILA_V2_OPERACIONAL_ROLLOUT: "canary",
        FILA_V2_OPERACIONAL_CANARY_CLIENTES: "outro_cliente"
      },
      logger: { log: () => {} }
    });
    assert.strictEqual(resultado.autoridadeUsada, "mtime");
    assert.strictEqual(resultado.fallbackMtime, true);
    assert.strictEqual(repoFake.chamadas.length, 0, "off-canary nao pode consultar PG de authority");
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_generation_ready_false";
    escreverEstadoGenerationAuthority(storage, repoFake, cliente, { authorityReady: false, vivaMtime: AGORA, legacyMtime: AGORA - 1000 });
    const resultado = await filaOperacionalV2.reconciliarFilaV2ParaLeitura(cliente, { contexto: "teste" }, {
      getClienteJsonPath: storage.getClienteJsonPath,
      manifestStateRepository: repoFake,
      env: {
        FILA_V2_RECOVERY_AUTORIDADE: "generation",
        FILA_V2_OPERACIONAL_ROLLOUT: "canary",
        FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
      },
      logger: { log: () => {} }
    });
    assert.strictEqual(resultado.autoridadeUsada, "mtime");
    assert.strictEqual(resultado.motivo, "authority_not_ready");
    assert.strictEqual(resultado.maisNova, true);
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake({ falharRecoveryAuthority: true });
    const cliente = "cliente_generation_db_indisponivel";
    escreverEstadoGenerationAuthority(storage, repoFake, cliente, { vivaMtime: AGORA, legacyMtime: AGORA - 1000 });
    const resultado = await filaOperacionalV2.reconciliarFilaV2ParaLeitura(cliente, { contexto: "teste" }, {
      getClienteJsonPath: storage.getClienteJsonPath,
      manifestStateRepository: repoFake,
      env: {
        FILA_V2_RECOVERY_AUTORIDADE: "generation",
        FILA_V2_OPERACIONAL_ROLLOUT: "canary",
        FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
      },
      logger: { log: () => {} }
    });
    assert.strictEqual(resultado.autoridadeUsada, "mtime");
    assert.strictEqual(resultado.motivo, "db_indisponivel");
  }

  for (const [nome, config, motivo] of [
    ["manifest_ausente", { manifest: false }, "arquivo_ausente"],
    ["manifest_mismatch", { manifest: { manifestVersion: 2, vivaGeneration: 9, durableCheckpointGeneration: 9, dirtyGeneration: null } }, "manifest_mismatch"],
    ["viva_proof_ausente", { vivaProof: false, dbVivaProof: false }, "viva_proof_ausente"],
    ["viva_proof_mismatch", { vivaProofGeneration: 9 }, "viva_proof_mismatch"],
    ["pending", { pendingCheckpointRevision: "checkpoint_aberto", pendingCheckpointTargetGeneration: 1 }, "pending_ambiguo"],
    ["dirty_incoerente", { vivaGeneration: 2, durableCheckpointGeneration: 1, dirtyGeneration: null }, "generation_invalida"]
  ]) {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = `cliente_generation_fallback_${nome}`;
    escreverEstadoGenerationAuthority(storage, repoFake, cliente, {
      ...config,
      vivaMtime: AGORA,
      legacyMtime: AGORA - 1000
    });
    const resultado = await filaOperacionalV2.reconciliarFilaV2ParaLeitura(cliente, { contexto: "teste" }, {
      getClienteJsonPath: storage.getClienteJsonPath,
      manifestStateRepository: repoFake,
      env: {
        FILA_V2_RECOVERY_AUTORIDADE: "generation",
        FILA_V2_OPERACIONAL_ROLLOUT: "canary",
        FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
      },
      logger: { log: () => {} }
    });
    assert.strictEqual(resultado.autoridadeUsada, "mtime", `${nome} deve cair para mtime`);
    assert.strictEqual(resultado.generationConclusiva, false);
    assert.strictEqual(resultado.motivo, motivo);
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_generation_nao_suprime_sem_legacy_proof";
    escreverEstadoGenerationAuthority(storage, repoFake, cliente, {
      vivaGeneration: 2,
      durableCheckpointGeneration: 2,
      dirtyGeneration: null,
      legacyProof: false,
      dbLegacyProof: false,
      vivaMtime: AGORA,
      legacyMtime: AGORA - 1000
    });
    const resultado = await filaOperacionalV2.reconciliarFilaV2ParaLeitura(cliente, { contexto: "teste" }, {
      getClienteJsonPath: storage.getClienteJsonPath,
      manifestStateRepository: repoFake,
      env: {
        FILA_V2_RECOVERY_AUTORIDADE: "generation",
        FILA_V2_OPERACIONAL_ROLLOUT: "canary",
        FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
      },
      logger: { log: () => {} }
    });
    assert.strictEqual(resultado.autoridadeUsada, "mtime");
    assert.strictEqual(resultado.maisNova, true, "sem proof legado generation nao pode suprimir recovery que mtime faria");
    assert.strictEqual(resultado.motivo, "legacy_proof_ausente");
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_generation_viva_mais_nova";
    escreverEstadoGenerationAuthority(storage, repoFake, cliente, {
      vivaGeneration: 2,
      durableCheckpointGeneration: 1,
      dirtyGeneration: 2,
      vivaMtime: AGORA - 1000,
      legacyMtime: AGORA
    });
    const resultado = await filaOperacionalV2.reconciliarFilaV2ParaLeitura(cliente, { contexto: "teste" }, {
      getClienteJsonPath: storage.getClienteJsonPath,
      manifestStateRepository: repoFake,
      env: {
        FILA_V2_RECOVERY_AUTORIDADE: "generation",
        FILA_V2_OPERACIONAL_ROLLOUT: "canary",
        FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
      },
      logger: { log: () => {} }
    });
    assert.strictEqual(resultado.autoridadeUsada, "generation");
    assert.strictEqual(resultado.generationConclusiva, true);
    assert.strictEqual(resultado.maisNova, true, "generation pode recuperar viva mesmo quando mtime nao recuperaria");
  }

  {
    const storage = criarStorageTemporarioFilaV2();
    const repoFake = criarManifestStateRepositoryFake();
    const cliente = "cliente_generation_legado_cobre_viva";
    escreverEstadoGenerationAuthority(storage, repoFake, cliente, {
      vivaGeneration: 3,
      durableCheckpointGeneration: 3,
      dirtyGeneration: null,
      vivaMtime: AGORA,
      legacyMtime: AGORA - 1000
    });
    const resultado = await filaOperacionalV2.reconciliarFilaV2ParaLeitura(cliente, { contexto: "teste" }, {
      getClienteJsonPath: storage.getClienteJsonPath,
      manifestStateRepository: repoFake,
      env: {
        FILA_V2_RECOVERY_AUTORIDADE: "generation",
        FILA_V2_OPERACIONAL_ROLLOUT: "canary",
        FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
      },
      logger: { log: () => {} }
    });
    assert.strictEqual(resultado.autoridadeUsada, "generation");
    assert.strictEqual(resultado.maisNova, false, "generation so pode suprimir mtime com proof legado valido");
  }
}

testarPromocaoLockPostgresOperacional()
  .then(() => {
    console.log("fila-store-v2.test.js OK");
  })
  .catch(erro => {
    console.error(erro);
    process.exitCode = 1;
  });
