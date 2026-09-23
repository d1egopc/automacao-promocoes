const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-achados-memoria-"));

const achados = require("../modules/manual-v2/ofertas-v2-achados");
const listas = require("../modules/manual-v2/ofertas-v2-listas");
const manual = require("../modules/manual-v2/manual-offers.storage");
const recentes = require("../modules/manual-v2/ofertas-v2-envios-recentes");
const { criarFilaStore } = require("../modules/fila/fila-store");
const { identidadeCanonica } = require("../modules/manual-v2/ofertas-v2-identidade");
const { criarCoordenadorEnvioProdutoDestino } = require("../modules/manual-v2/ofertas-v2-envio-claim");

const agora = Date.now();
const workspace = "user_achados_memoria";

function universal({ id, asin, titulo = id, preco = 100, cupom = "", clienteId = workspace,
  marketplace = "amazon", url = `https://www.amazon.com.br/dp/${asin}?tag=fonte` }) {
  return {
    ofertaId: id,
    workspaceId: clienteId,
    marketplace,
    produto: { titulo, idExterno: asin, categoriaNormalizada: "Eletrônicos", urlCanonica: url },
    comercial: { precoAtual: preco, precoAnterior: preco + 20, cupom, beneficios: [`beneficio-${id}`] },
    midia: { imagemPrincipal: `https://img.test/${id}.jpg` },
    afiliacao: { urlAfiliada: `https://amzn.to/${id}` },
    criadoEm: new Date(agora).toISOString()
  };
}

function registrar(entrada) {
  const ofertaUniversal = universal(entrada);
  return achados.registrarAchado({
    clienteId: entrada.clienteId || workspace,
    ofertaId: entrada.id,
    ofertaUniversal,
    metadata: { ofertaUniversalValidacao: { ok: true } },
    capturedAt: entrada.capturedAt || ofertaUniversal.criadoEm
  });
}

function criarManual({ produtoId, titulo = produtoId, clienteId = workspace }) {
  return manual.criarOfertaManualV2(clienteId, {
    marketplace: "amazon",
    produtoId,
    titulo,
    precoAtual: "99,90",
    urlOriginal: `https://www.amazon.com.br/dp/${produtoId}`,
    urlAfiliada: `https://amzn.to/${produtoId}`
  });
}

function confirmarEnvio(oferta, destinoId, enviadoEm, extras = {}) {
  return manual.atualizarMetadadosEnvioManualV2(oferta.clienteId, oferta.id, {
    status: "enviada",
    enviadoEm,
    envioManual: {
      concluidoEm: enviadoEm,
      resultados: [{ destinoId, nome: `Destino ${destinoId}`, tipo: "telegram",
        status: extras.status || "enviado", enviadoEm }]
    }
  });
}

function depsDestinos(ids) {
  return {
    now: () => agora,
    listarDestinosManuaisV2Async: async () => ids.map((id) => ({
      id, nome: `Destino ${id}`, tipo: "telegram", utilizavel: true
    }))
  };
}

async function main() {
  const oficialAmazon = { marketplace: "amazon", produtoId: "B012345678",
    urlOriginal: "https://amazon.com.br/dp/B012345678" };
  assert.ok(identidadeCanonica(oficialAmazon), "ASIN e URL oficial coerentes formam identidade");
  assert.strictEqual(identidadeCanonica({ marketplace: "amazon", asin: "MLB123456789" }), "");
  assert.strictEqual(identidadeCanonica({ marketplace: "mercadolivre", produtoId: "B012345678" }), "");
  assert.ok(identidadeCanonica({ marketplace: "mercadolivre",
    urlOriginal: "https://produto.mercadolivre.com.br/MLB123456789-item" }));
  assert.strictEqual(identidadeCanonica({ marketplace: "amazon", produtoId: "B012345678" }), "",
    "nome de campo e formato nao provam provenance");
  assert.strictEqual(identidadeCanonica({ marketplace: "amazon",
    urlOriginal: "https://site-aleatorio.com/campanha/B012345678" }), "");
  assert.strictEqual(identidadeCanonica({ marketplace: "amazon",
    urlOriginal: "https://amazon.com.br/campanha" }), "");
  assert.strictEqual(identidadeCanonica({ ...oficialAmazon, productId: "B099999999" }), "",
    "dois IDs conflitantes nunca fazem merge");
  assert.strictEqual(identidadeCanonica({ marketplace: "shopee",
    urlOriginal: "https://shopee.com.br/product/10/20",
    urlAfiliada: "https://mercadolivre.com.br/MLB123456789" }), "",
    "dominio comercial contraditorio invalida a identidade");
  assert.strictEqual(identidadeCanonica({ marketplace: "amazon", produtoId: "B012345678",
    urlOriginal: "https://amzn.to/short", identidadeProdutoVerificada: {
      origem: "engine_importer", marketplace: "amazon", id: "B012345678" } }),
    identidadeCanonica(oficialAmazon), "ID do importer validado converge com URL oficial");
  assert.strictEqual(identidadeCanonica({ marketplace: "mercadolivre", produtoId: "MLB123456789",
    urlOriginal: "https://meli.la/short", identidadeProdutoVerificada: {
      origem: "engine_importer", marketplace: "mercadolivre", id: "MLB123456789" } }),
  identidadeCanonica({ marketplace: "mercadolivre", urlOriginal: "https://www.mercadolivre.com.br/MLB123456789" }),
  "shortlink Mercado Livre e URL canônica convergem pelo MLB resolvido");
  assert.strictEqual(identidadeCanonica({ marketplace: "amazon", asin: "B012345678",
    urlOriginal: "https://amzn.to/short", identidadeProdutoVerificada: {
      origem: "engine_importer", marketplace: "amazon", id: "B012345678" } }),
  identidadeCanonica({ marketplace: "amazon", urlOriginal: "https://amazon.com.br/dp/B012345678" }),
  "shortlink Amazon e URL canônica convergem pelo ASIN resolvido");
  assert.strictEqual(identidadeCanonica({ marketplace: "amazon", urlOriginal: "https://loja.example/" }), "",
    "URL genérica de raiz sem ID não fornece identidade suficiente para unir produtos");
  assert.strictEqual(identidadeCanonica({ marketplace: "awin", urlOriginal: "https://loja.example/campanha" }), "",
    "rota genérica não vira identidade de produto");
  assert.strictEqual(identidadeCanonica({ marketplace: "awin", sku: "SKU-COMPARTILHADO" }), "",
    "SKU genérico sem provenance oficial não participa da identidade");

  const primeiro = registrar({ id: "oferta-1", asin: "B0AAAA0001", titulo: "Título antigo", preco: 100, cupom: "ANTIGO",
    capturedAt: new Date(agora - 2000).toISOString() });
  const atualizado = registrar({ id: "oferta-2", asin: "B0AAAA0001", titulo: "Título novo", preco: 80, cupom: "NOVO",
    url: "https://amazon.com.br/dp/B0AAAA0001?utm_source=grupo", capturedAt: new Date(agora - 1000).toISOString() });
  const estoque = achados.listarAchados(workspace, { nowMs: agora });
  assert.strictEqual(estoque.length, 1, "mesmo produto/marketplace produz um card");
  assert.strictEqual(estoque[0].id, primeiro.achado.id, "refresh preserva a identidade visual do card");
  assert.strictEqual(estoque[0].titulo, "Título novo", "título é substituído pela observação mais recente");
  assert.strictEqual(estoque[0].precoAtual, 80, "preço é substituído pela verdade recente");
  assert.strictEqual(estoque[0].cupom, "NOVO", "cupom é substituído sem misturar campos antigos");
  assert.strictEqual(atualizado.atualizado, true);

  registrar({ id: "oferta-3", asin: "B0AAAA0002", titulo: "Título novo" });
  assert.strictEqual(achados.listarAchados(workspace, { nowMs: agora }).length, 2,
    "mesmo título com identidade diferente não colide");
  registrar({ id: "oferta-shop", asin: "B0AAAA0001", titulo: "Título novo", marketplace: "shopee",
    url: "https://shopee.com.br/product/10/20" });
  assert.strictEqual(achados.listarAchados(workspace, { nowMs: agora }).length, 3,
    "marketplaces diferentes não colidem");
  registrar({ id: "outro-1", asin: "B0AAAA0001", clienteId: "user_isolado" });
  assert.strictEqual(achados.listarAchados("user_isolado", { nowMs: agora }).length, 1,
    "identidade e estoque são isolados por workspace");
  registrar({ id: "awin-1", asin: "PRODUTO-OFICIAL-123", titulo: "Mesmo item URL", marketplace: "awin",
    url: "https://loja.example/produto/123?utm_source=fonte" });
  registrar({ id: "awin-2", asin: "PRODUTO-OFICIAL-123", titulo: "Nome atualizado", marketplace: "awin",
    url: "https://loja.example/produto/123?affiliate=origem" });
  assert.strictEqual(achados.listarAchados(workspace, { marketplace: "awin", nowMs: agora }).length, 2,
    "AWIN sem contrato de identidade de produto nao sofre merge por campo generico");
  registrar({ id: "generico-1", asin: "", titulo: "Produto A", marketplace: "awin",
    url: "https://loja.example/campanha" });
  registrar({ id: "generico-2", asin: "", titulo: "Produto B", marketplace: "awin",
    url: "https://loja.example/campanha" });
  assert.strictEqual(achados.listarAchados(workspace, { marketplace: "awin", nowMs: agora }).length, 4,
    "duas observações sem identidade confiável permanecem isoladas mesmo com a mesma URL genérica");
  assert.notStrictEqual(
    achados.listarAchados(workspace, { marketplace: "awin", nowMs: agora })
      .find((item) => item.id === "generico-1")?.canonicalKey,
    achados.listarAchados(workspace, { marketplace: "awin", nowMs: agora })
      .find((item) => item.id === "generico-2")?.canonicalKey,
    "fallback isolado é por observação e nunca funde produtos"
  );
  assert.strictEqual(achados.consolidarCanonicos([
    { id: "legado-a", clienteId: workspace, marketplace: "awin", titulo: "A",
      urlOriginal: "https://loja.example/campanha", canonicalKey: "chave-permissiva-antiga" },
    { id: "legado-b", clienteId: workspace, marketplace: "awin", titulo: "B",
      urlOriginal: "https://loja.example/campanha", canonicalKey: "chave-permissiva-antiga" }
  ]).length, 2, "chave permissiva legada é recalculada e não mantém merge inseguro");
  assert.strictEqual(identidadeCanonica({ marketplace: "mercadolivre", produtoId: "MLB999888777",
    urlOriginal: "https://meli.la/a", identidadeProdutoVerificada: {
      origem: "engine_importer", marketplace: "mercadolivre", id: "MLB999888777" } }),
  identidadeCanonica({ marketplace: "mercadolivre", urlOriginal: "https://produto.mercadolivre.com.br/MLB999888777-item" }),
  "mesmo MLB converge apesar de URLs diferentes");

  for (let i = 3; i <= 42; i += 1) {
    const asin = `B0${String(i).padStart(8, "0")}`;
    registrar({ id: `unico-${i}`, asin });
    registrar({ id: `duplicado-${i}`, asin, titulo: `Refresh ${i}` });
  }
  const quarenta = achados.listarAchados(workspace, { marketplace: "amazon", nowMs: agora });
  assert.strictEqual(quarenta.length, 40, "duplicatas são consolidadas antes do limite por marketplace");
  assert.strictEqual(new Set(quarenta.map((item) => item.canonicalKey)).size, 40, "os 40 cards são produtos distintos");

  const recenteManual = criarManual({ produtoId: "B0MEMO0001" });
  confirmarEnvio(recenteManual, "A", new Date(agora - 30 * 60_000).toISOString());
  const antigoManual = criarManual({ produtoId: "B0MEMO0002" });
  confirmarEnvio(antigoManual, "A", new Date(agora - 2 * 60 * 60_000).toISOString());
  const erroManual = criarManual({ produtoId: "B0MEMO0003" });
  confirmarEnvio(erroManual, "A", new Date(agora - 10 * 60_000).toISOString(), { status: "erro" });
  const pendenteManual = criarManual({ produtoId: "B0MEMO0004" });
  const automatico = criarManual({ produtoId: "B0MEMO0005" });
  const registros = recentes.listarEnviosRecentes(workspace, {
    now: () => agora,
    listarEnviosRecentesAutomaticos: () => [{ ...automatico, enviadoEm: new Date(agora - 5 * 60_000).toISOString(),
      destinosEstado: [{ destinoId: "B", nome: "Destino B", tipo: "telegram", estado: "enviado",
        enviadoEm: new Date(agora - 5 * 60_000).toISOString() }] }]
  });
  assert.strictEqual(recentes.filtrarDestinosRecentes(recenteManual, [], registros).length, 1,
    "Manual confirmado alimenta memória visual");
  assert.strictEqual(recentes.filtrarDestinosRecentes(automatico, [], registros)[0]?.origem, "automatico",
    "automático confirmado alimenta a mesma memória");
  assert.strictEqual(recentes.filtrarDestinosRecentes(antigoManual, [], registros).length, 0, "2h exatas já expiraram");
  assert.strictEqual(recentes.filtrarDestinosRecentes(erroManual, [], registros).length, 0, "erro não vira memória");
  assert.strictEqual(recentes.filtrarDestinosRecentes(pendenteManual, [], registros).length, 0, "pendente não vira memória");
  const automaticEntry = {
    id: "auto-restart-1", clienteId: workspace, marketplace: "amazon", status: "enviado",
    productId: "B0RSTRT001", urlOriginal: "https://amzn.to/short-auto",
    identidadeProdutoVerificada: { origem: "engine_importer", marketplace: "amazon", id: "B0RSTRT001" },
    enviadoEm: new Date(agora - 12 * 60_000).toISOString(),
    destinosEnviados: [{ destinoId: "AUTO-DEST", nome: "Destino Automático", tipo: "telegram",
      dataEnvio: new Date(agora - 12 * 60_000).toISOString() }]
  };
  const storeAntesRestart = criarFilaStore([automaticEntry]);
  const estadoPersistidoFila = storeAntesRestart.itensPorCliente(workspace);
  const storeDepoisRestart = criarFilaStore(estadoPersistidoFila);
  const achadoAutoCrossPath = {
    marketplace: "amazon", produtoId: "B0RSTRT001", urlOriginal: "https://www.amazon.com.br/dp/B0RSTRT001"
  };
  const recentesDepoisRestart = recentes.destinosRecentesDaOferta(workspace, achadoAutoCrossPath, [], {
    now: () => agora,
    listarEnviosRecentesAutomaticos: (clienteId, nowMs) => storeDepoisRestart.enviadosRecentesPorCliente(clienteId, nowMs)
  });
  assert.strictEqual(recentesDepoisRestart[0]?.destinoId, "AUTO-DEST",
    "rebuild do store após restart mantém o envio automático recente");
  assert.strictEqual(recentesDepoisRestart[0]?.canonicalKey, undefined,
    "projeção pública não expõe chave interna de identidade");
  assert.strictEqual(recentesDepoisRestart[0]?.origem, "automatico",
    "shortlink automático e URL canônica de Achados convergem pelo ASIN persistido");
  assert.strictEqual(recentes.destinosRecentesDaOferta("workspace_b", achadoAutoCrossPath, [], {
    now: () => agora,
    listarEnviosRecentesAutomaticos: (clienteId, nowMs) => storeDepoisRestart.enviadosRecentesPorCliente(clienteId, nowMs)
  }).length, 0, "rebuild da memória automática não cruza workspace");
  const registroRenomeado = recentes.listarEnviosRecentes(workspace, {
    now: () => agora,
    listarEnviosRecentesAutomaticos: () => [
      { ...automaticEntry, enviadoEm: new Date(agora - 60_000).toISOString(),
        destinosEnviados: [{ destinoId: "RENAMED-ID", nome: "Nome antigo", tipo: "telegram",
          dataEnvio: new Date(agora - 60_000).toISOString() }] },
      { ...automaticEntry, enviadoEm: new Date(agora - 30_000).toISOString(),
        destinosEnviados: [{ destinoId: "RENAMED-ID", nome: "Nome atualizado", tipo: "telegram",
          dataEnvio: new Date(agora - 30_000).toISOString() }] }
    ]
  });
  const renomeado = recentes.filtrarDestinosRecentes(achadoAutoCrossPath, ["RENAMED-ID"], registroRenomeado);
  assert.strictEqual(renomeado.length, 1, "destino é deduplicado por ID estável, não pelo nome");
  assert.strictEqual(renomeado[0].nome, "Nome atualizado", "nome é apenas apresentação e pode ser atualizado");

  const fronteira = (idadeMs) => recentes.listarEnviosRecentes(workspace, {
    now: () => agora,
    listarEnviosRecentesAutomaticos: () => [{ ...automaticEntry, enviadoEm: new Date(agora - idadeMs).toISOString(),
      destinosEnviados: [{ destinoId: "BOUNDARY", nome: "Destino", tipo: "telegram",
        dataEnvio: new Date(agora - idadeMs).toISOString() }] }]
  });
  assert.strictEqual(recentes.filtrarDestinosRecentes(achadoAutoCrossPath, [], fronteira(2 * 60 * 60_000 - 1000)).length, 1,
    "1h59m59s permanece recente");
  assert.strictEqual(recentes.filtrarDestinosRecentes(achadoAutoCrossPath, [], fronteira(2 * 60 * 60_000 + 1000)).length, 0,
    "2h00m01s deixa de bloquear");
  const automaticoLegado = criarManual({ produtoId: "B0MEMO0007" });
  const dataBr = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short",
    timeStyle: "medium" }).format(new Date(agora - 6 * 60_000));
  const registroAutomaticoLegado = recentes.listarEnviosRecentes(workspace, {
    now: () => agora,
    listarEnviosRecentesAutomaticos: () => [{ ...automaticoLegado, status: "enviado", enviadoEm: dataBr,
      destinosEnviados: [{ destinoId: "C", nome: "Destino C", tipo: "whatsapp" }] }]
  });
  assert.strictEqual(recentes.filtrarDestinosRecentes(automaticoLegado, [], registroAutomaticoLegado)[0]?.destinoId,
    "C", "timestamp pt-BR oficial do automático também é reconhecido");

  const doisDestinos = criarManual({ produtoId: "B0MEMO0006" });
  manual.atualizarMetadadosEnvioManualV2(workspace, doisDestinos.id, {
    status: "enviada",
    enviadoEm: new Date(agora - 8 * 60_000).toISOString(),
    envioManual: { concluidoEm: new Date(agora - 8 * 60_000).toISOString(), resultados: ["A", "B"].map((destinoId) => ({
      destinoId, nome: `Destino ${destinoId}`, tipo: "telegram", status: "enviado",
      enviadoEm: new Date(agora - 8 * 60_000).toISOString()
    })) }
  });
  const doisRecentes = recentes.destinosRecentesDaOferta(workspace, doisDestinos, [], { now: () => agora });
  assert.deepStrictEqual(doisRecentes.map((item) => item.destinoId).sort(), ["A", "B"],
    "todos os destinos recentes ficam disponíveis para resumo e tooltip");
  assert.strictEqual(recentes.enriquecerOfertasComDestinosRecentes(workspace, [pendenteManual], { now: () => agora })[0]
    .destinosRecentes, undefined, "produto sem sucesso recente não recebe legenda");

  const locks = new Set();
  const advisoryTeste = {
    adquirir: async ({ clienteId, oferta }) => {
      const key = `${clienteId}:${oferta.id}`;
      if (locks.has(key)) return { resultado: "ocupado", handle: null };
      locks.add(key);
      return { resultado: "adquirido", handle: { key } };
    },
    finalizar: async (estado) => { locks.delete(estado.handle.key); return { liberado: true }; }
  };
  const coordenador = criarCoordenadorEnvioProdutoDestino({ advisory: advisoryTeste,
    reserva: { consultar: async () => false, preparar: async () => "token", descartar: async () => {} } });
  async function disputar(fluxos, { falharPrimeiro = false } = {}) {
    let sends = 0;
    let liberarPrimeiro;
    const espera = new Promise((resolve) => { liberarPrimeiro = resolve; });
    const tentar = async (fluxo, esperar = false) => {
      const claim = await coordenador.adquirir({
        clienteId: workspace,
        oferta: { marketplace: "amazon", produtoId: "B0RACE0001",
          urlOriginal: "https://amazon.com.br/dp/B0RACE0001" },
        destinoId: "DESTINO-RACE"
      });
      if (claim.resultado !== "adquirido") return { fluxo, status: "ignorado_enviado_recentemente" };
      try {
        if (esperar) await espera;
        sends += 1;
        if (falharPrimeiro && esperar) throw new Error("falha_controlada");
        return { fluxo, status: "enviado" };
      } finally { await coordenador.finalizar(claim, { statusFinal: "teste" }); }
    };
    const primeiro = tentar(fluxos[0], true);
    await new Promise((resolve) => setImmediate(resolve));
    const segundo = await tentar(fluxos[1]);
    liberarPrimeiro();
    let resultadoPrimeiro;
    try { resultadoPrimeiro = await primeiro; } catch { resultadoPrimeiro = { fluxo: fluxos[0], status: "erro" }; }
    return { sends, resultados: [resultadoPrimeiro, segundo] };
  }
  for (const fluxos of [["lista_1", "lista_2"], ["lista", "manual"], ["lista", "automatico"]]) {
    const corrida = await disputar(fluxos);
    assert.strictEqual(corrida.sends, 1, `${fluxos.join(" vs ")} produz somente um envio real`);
    assert.strictEqual(corrida.resultados.filter((item) => item.status === "ignorado_enviado_recentemente").length, 1,
      `${fluxos.join(" vs ")} perde o claim sem erro fatal`);
  }
  const falhaClaim = await disputar(["lista", "manual"], { falharPrimeiro: true });
  assert.strictEqual(falhaClaim.resultados[0].status, "erro", "falha real não é registrada como envio");
  const retryAposFalha = await coordenador.adquirir({ clienteId: workspace,
    oferta: { marketplace: "amazon", produtoId: "B0RACE0001",
      urlOriginal: "https://amazon.com.br/dp/B0RACE0001" }, destinoId: "DESTINO-RACE" });
  assert.strictEqual(retryAposFalha.resultado, "adquirido", "falha libera claim para tentativa posterior");
  await coordenador.finalizar(retryAposFalha, { statusFinal: "teste" });
  const chaveA = coordenador.chaveClaimProdutoDestino({ clienteId: workspace,
    oferta: { marketplace: "amazon", produtoId: "B0RACE0001",
      urlOriginal: "https://amazon.com.br/dp/B0RACE0001" }, destinoId: "A" });
  const chaveB = coordenador.chaveClaimProdutoDestino({ clienteId: workspace,
    oferta: { marketplace: "amazon", produtoId: "B0RACE0001",
      urlOriginal: "https://amazon.com.br/dp/B0RACE0001" }, destinoId: "B" });
  const chaveOutroWorkspace = coordenador.chaveClaimProdutoDestino({ clienteId: "workspace_b",
    oferta: { marketplace: "amazon", produtoId: "B0RACE0001",
      urlOriginal: "https://amazon.com.br/dp/B0RACE0001" }, destinoId: "A" });
  assert.notStrictEqual(chaveA, chaveB, "destinos diferentes não compartilham claim");
  assert.notStrictEqual(chaveA, chaveOutroWorkspace, "workspaces diferentes não compartilham claim");
  let relogioReserva = agora;
  const tabelaReserva = new Map();
  const sqlExecutado = [];
  const clientReserva = { query: async (sql, args = []) => {
    sqlExecutado.push(sql);
    const key = `${args[0]}:${args[1]}`;
    const item = tabelaReserva.get(key);
    if (sql.startsWith("SELECT lease_expires_at"))
      return { rows: item && item.expires > relogioReserva ? [{ lease_expires_at: item.expires }] : [] };
    if (sql.startsWith("INSERT INTO fila_claims_ativos")) {
      if (item && item.expires > relogioReserva) return { rows: [] };
      tabelaReserva.set(key, { token: args[2], expires: Date.parse(args[3]) });
      return { rows: [{ claim_token: args[2] }] };
    }
    return { rows: [] };
  } };
  const locksReserva = new Set();
  const advisoryReserva = {
    adquirir: async ({ clienteId, oferta }) => {
      const key = `${clienteId}:${oferta.id}`;
      if (locksReserva.has(key)) return { resultado: "ocupado" };
      locksReserva.add(key);
      return { resultado: "adquirido", handle: { key, client: clientReserva } };
    },
    finalizar: async (estado) => { locksReserva.delete(estado.handle.key); return { liberado: true }; }
  };
  const entradaReserva = { clienteId: workspace, oferta: { ...oficialAmazon, id: "op-reserva" }, destinoId: "A" };
  const coordenadorPg = criarCoordenadorEnvioProdutoDestino({ advisory: advisoryReserva, now: () => relogioReserva });
  const primeiraReserva = await coordenadorPg.adquirir(entradaReserva);
  assert.strictEqual(primeiraReserva.resultado, "adquirido");
  assert.strictEqual(await coordenadorPg.prepararTransporte(primeiraReserva), true);
  assert.ok(sqlExecutado.some((sql) => sql.includes("ON CONFLICT") && sql.includes("lease_expires_at <= NOW()")),
    "reserva PostgreSQL faz CAS de janela expirada antes do transporte");
  await coordenadorPg.finalizar(primeiraReserva);
  const aposRestart = criarCoordenadorEnvioProdutoDestino({ advisory: advisoryReserva, now: () => relogioReserva });
  assert.strictEqual((await aposRestart.adquirir(entradaReserva)).resultado, "ocupado_recente",
    "novo coordenador apos restart consulta reserva persistida");
  relogioReserva += 2 * 60 * 60 * 1000 + 1;
  const aposJanela = await aposRestart.adquirir(entradaReserva);
  assert.strictEqual(aposJanela.resultado, "adquirido", "apos 2h a reserva expirada pode ser retomada");
  await aposRestart.finalizar(aposJanela);
  const observacaoBase = { clienteId: workspace, marketplace: "awin", id: "observacao-sem-produto",
    urlOriginal: "https://loja.example/campanha" };
  assert.ok(coordenador.chaveClaimProdutoDestino({ clienteId: workspace,
    oferta: observacaoBase, destinoId: "A" }), "observacao sem identidade canonica ainda recebe claim");
  assert.notStrictEqual(
    coordenador.chaveClaimProdutoDestino({ clienteId: workspace, oferta: observacaoBase, destinoId: "A" }),
    coordenador.chaveClaimProdutoDestino({ clienteId: workspace,
      oferta: { ...observacaoBase, id: "outra-observacao" }, destinoId: "A" }),
    "observacoes diferentes nao fingem ser o mesmo produto");
  const fonteExecutor = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const fonteBoundary = fs.readFileSync(path.join(__dirname, "..", "modules/fila/processar-envio-automatico-destino.js"), "utf8");
  const inicioClaimAutomatico = fonteBoundary.indexOf("const claim = await coordenador.adquirir");
  const revalidacaoAutomatico = fonteBoundary.indexOf("const repeticao = await revalidar()", inicioClaimAutomatico);
  const reservaAutomatico = fonteBoundary.indexOf("await coordenador.prepararTransporte(claim)", inicioClaimAutomatico);
  const unlockFilaAutomatico = fonteBoundary.indexOf("await liberarAdvisoryFila()", reservaAutomatico);
  const renderAutomatico = fonteBoundary.indexOf("await prepararMensagem()", reservaAutomatico);
  const envioAutomatico = fonteBoundary.indexOf("const resposta = await enviar(preparado)", inicioClaimAutomatico);
  const memoriaAutomatico = fonteExecutor.indexOf("filaStore.atualizarItem(oferta)", fonteExecutor.indexOf("await processarEnvioAutomaticoDestino({"));
  const persistenciaAutomatico = fonteExecutor.indexOf("const persistiuEnvioPar = await salvarFilaSeAlterada(clienteId)", memoriaAutomatico);
  const fimClaimAutomatico = fonteBoundary.indexOf("await coordenador.finalizar(claim", envioAutomatico);
  assert.ok(inicioClaimAutomatico > 0 && revalidacaoAutomatico > inicioClaimAutomatico &&
    reservaAutomatico > revalidacaoAutomatico && unlockFilaAutomatico > reservaAutomatico &&
    renderAutomatico > unlockFilaAutomatico && envioAutomatico > renderAutomatico &&
    memoriaAutomatico > 0 && persistenciaAutomatico > memoriaAutomatico &&
    fimClaimAutomatico > envioAutomatico && fonteExecutor.includes("await processarEnvioAutomaticoDestino({"),
  "Automático reserva duravelmente antes do transporte e persiste fila com reserva ativa");

  const card = { ...recenteManual };
  const enriquecido = recentes.enriquecerOfertasComDestinosRecentes(workspace, [card], { now: () => agora });
  assert.strictEqual(enriquecido[0].destinosRecentes[0].destinoId, "A", "GET em lote anexa destinos ao card");
  assert.strictEqual(enriquecido[0].destinosRecentes[0].nome, "Destino A");

  const listaParcial = listas.criarLista(workspace, "Parcial");
  const itemParcial = criarManual({ produtoId: "B0PLAY0001" });
  await listas.adicionarItem(workspace, listaParcial.id, { origem: "ofertas", ofertaId: itemParcial.id });
  confirmarEnvio(itemParcial, "A", new Date(agora - 20 * 60_000).toISOString());
  const preflight = listas.preflightLista(workspace, listaParcial.id, ["A", "B"], { now: () => agora });
  assert.strictEqual(preflight.totalPares, 2);
  assert.strictEqual(preflight.paresPulados, 1, "preflight é produto x destino");
  assert.deepStrictEqual(preflight.itens[0].permitidos, ["B"], "destino livre continua elegível");
  await listas.reservarDestinos(workspace, listaParcial.id, ["A", "B"], 240000, depsDestinos(["A", "B"]));
  const chamadas = [];
  const resultadoParcial = await listas.processarLista(workspace, listaParcial.id, {
    now: () => agora,
    enviarOfertaManualV2: async ({ destinosIds }) => {
      chamadas.push(destinosIds);
      return { enviados: destinosIds.length, erros: 0, creditosDebitados: destinosIds.length,
        resultados: destinosIds.map((destinoId) => ({ destinoId, nome: `Destino ${destinoId}`,
          tipo: "telegram", status: "enviado", enviadoEm: new Date(agora).toISOString() })) };
    }
  });
  assert.deepStrictEqual(chamadas, [["B"]], "Play envia somente o par ainda livre");
  assert.strictEqual(resultadoParcial.paresPulados, 1);
  assert.strictEqual(recentes.destinosRecentesDaOferta(workspace, itemParcial, ["B"], { now: () => agora })[0]?.origem,
    "lista", "envio confirmado por Lista alimenta a memória oficial compartilhada");

  const listaExpirada = listas.criarLista(workspace, "Expirada");
  await listas.adicionarItem(workspace, listaExpirada.id, { origem: "ofertas", ofertaId: antigoManual.id });
  assert.strictEqual(listas.preflightLista(workspace, listaExpirada.id, ["A"], { now: () => agora }).paresPulados, 0,
    "par enviado há 2h volta a ser elegível");

  const listaRace = listas.criarLista(workspace, "Revalidação backend");
  const ofertaRace = criarManual({ produtoId: "B0PLAYRACE1" });
  await listas.adicionarItem(workspace, listaRace.id, { origem: "ofertas", ofertaId: ofertaRace.id });
  const preflightAntigo = listas.preflightLista(workspace, listaRace.id, ["A"], { now: () => agora });
  assert.strictEqual(preflightAntigo.paresPulados, 0, "preflight inicial vê o destino livre");
  confirmarEnvio(ofertaRace, "A", new Date(agora - 1000).toISOString());
  await listas.reservarDestinos(workspace, listaRace.id, ["A"], 240000, depsDestinos(["A"]));
  let envioRaceOcorreu = false;
  const resultadoRace = await listas.processarLista(workspace, listaRace.id, {
    now: () => agora,
    enviarOfertaManualV2: async () => {
      envioRaceOcorreu = true;
      return { enviados: 0, erros: 0, creditosDebitados: 0, resultados: [] };
    }
  });
  assert.strictEqual(resultadoRace.motivo, "repetido", "worker revalida a memória oficial após o preflight antigo");
  assert.strictEqual(envioRaceOcorreu, false, "mudança entre preflight e execução não dispara novo envio");

  const listaContinua = listas.criarLista(workspace, "Continua");
  const todoRepetido = criarManual({ produtoId: "B0PLAY0002" });
  const itemLivre = criarManual({ produtoId: "B0PLAY0003" });
  await listas.adicionarItem(workspace, listaContinua.id, { origem: "ofertas", ofertaId: todoRepetido.id });
  await listas.adicionarItem(workspace, listaContinua.id, { origem: "ofertas", ofertaId: itemLivre.id });
  confirmarEnvio(todoRepetido, "A", new Date(agora - 5 * 60_000).toISOString());
  await listas.reservarDestinos(workspace, listaContinua.id, ["A"], 240000, depsDestinos(["A"]));
  const primeiroCiclo = await listas.processarLista(workspace, listaContinua.id, { now: () => agora });
  assert.strictEqual(primeiroCiclo.motivo, "repetido", "item totalmente repetido é ignorado");
  assert.strictEqual(listas.listarListas(workspace).find((item) => item.id === listaContinua.id).status, "enviando",
    "ignorar um item não aborta a lista");
  let enviouSegundo = false;
  await listas.processarLista(workspace, listaContinua.id, {
    now: () => agora + 240000,
    enviarOfertaManualV2: async ({ destinosIds }) => {
      enviouSegundo = true;
      return { enviados: 1, erros: 0, creditosDebitados: 1,
        resultados: [{ destinoId: destinosIds[0], nome: "Destino A", tipo: "telegram", status: "enviado",
          enviadoEm: new Date(agora + 240000).toISOString() }] };
    }
  });
  assert.strictEqual(enviouSegundo, true, "lista segue para o próximo item elegível");

  console.log("ofertas-v2-achados-dedupe-memoria.test.js ok");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
