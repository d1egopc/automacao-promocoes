"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const { readFileSync, mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "optimus-safety-p0-"));

const activity = require.resolve("../utils/usuarios-atividade");
require(activity);
require.cache[activity].exports = { ...require(activity), usuarioAtivo: () => true };
const { validarOfertaParaDistribuicao } = require("../modules/engine/distributor/distributor.service");
const { classificarCategoriaOferta } = require("../marketplaces/inteligencia/classificador-categorias");
const { avaliarSegurancaPublicacao } = require("../modules/inteligencia-universal/foundation-v1.service");
const { criarPreflightFilaUniversal } = require("../modules/engine/universal-queue-preflight");
const { criarExecutorFilaUniversal } = require("../modules/engine/universal-queue-executor.adapter");
const { enqueue } = require("../modules/engine/universal-queue.repository");
const { criarOfertaManualV2, atualizarOfertaManualV2 } = require("../modules/manual-v2/manual-offers.storage");
const { enviarOfertaManualV2 } = require("../modules/manual-v2/manual-dispatcher");
const { registrarAchado, registrarAchadoCapacidadeClonador, listarAchados, ARQUIVO_ACHADOS } = require("../modules/manual-v2/ofertas-v2-achados");
const { publicarOfertaConfirmadaVitrine } = require("../modules/vitrine/hook");
const { paginarOfertasPublicas } = require("../modules/vitrine/storage");
const { processVitrineProjectionBatch } = require("../modules/engine/universal-vitrine-projector");
const { validarOportunidadeSocialManual, listarOportunidadesSocial } = require("../modules/social/storage");
const { carregarOfertaCliente, publicarImagemInstagram, publicarReelInstagram } = require("../modules/social/instagram");
const { writeClienteJson } = require("../utils/storage");

const ws = "ws_fixture_18";
const adult = "seguranca_conteudo_adulto";
const uncertain = "seguranca_conteudo_incerto";
const tituloAdulto = "Vibrador Modelo Fixture";
const casos = [
  [{ marketplace: "shopee", categoria: "Diversos", titulo: tituloAdulto }, adult],
  [{ marketplace: "amazon", categoria: "Eletrônicos", titulo: tituloAdulto }, adult],
  [{ marketplace: "shopee", categoria: "Sex Shop +18", titulo: "Modelo Fixture" }, adult],
  [{ marketplace: "shopee", categoria: "Diversos", titulo: "Oferta da semana",
    metadata: { provaTituloTecnicoValidada: { titulo: { valor: tituloAdulto } } } }, adult],
  [{ marketplace: "shopee", categoria: "Diversos", titulo: "Título substituído",
    metadata: { produto: { categoriaMarketplace: { tipoProduto: "sex toy" } } } }, adult],
  [{ marketplace: "amazon", categoria: "Diversos", titulo: "Modelo Fixture",
    metadata: { safetyEvidence: { uncertain: true } } }, uncertain],
  [{ marketplace: "amazon", categoria: "Diversos", titulo: "Modelo Fixture",
    metadata: { classificacao: "uncertain", identidade: { status: "uncertain" } } }, ""],
  [{ marketplace: "shopee", categoria: "Pesca e Camping", titulo: "Isca Artificial Rapala" }, ""],
  [{ marketplace: "amazon", categoria: "Perfumaria, Farmácia e Beleza", titulo: "Perfume Blue Melody 100ml" }, ""],
  [{ marketplace: "amazon", categoria: "Diversos", titulo: "Camiseta infantil algodão" }, ""],
  [{ marketplace: "shopee", categoria: "Roupas e Moda Feminina", titulo: "Camiseta feminina algodão" }, ""],
  ...["Vibrador de concreto portátil 1500 W", "Vibrador para concreto com mangote 2 m",
    "Vibrador industrial para construção civil"].map(titulo => {
    const o = { marketplace: "kabum", titulo };
    const categoria = classificarCategoriaOferta(o);
    assert.equal(categoria, "Ferramentas", titulo);
    assert.equal(avaliarSegurancaPublicacao(o).class, "general");
    return [{ ...o, categoria }, ""];
  }),
  [{ marketplace: "shopee", categoria: "Ferramentas", titulo: "Vibrador íntimo adulto" }, adult],
  [{ marketplace: "amazon", categoria: "Ferramentas",
    titulo: "Produto erótico anunciado como vibrador industrial para construção civil" }, adult],
  [{ marketplace: "kabum", categoria: "Ferramentas", titulo: "Vibrador de concreto com mangote 2 m",
    metadata: { produto: { titulo: "Vibrador íntimo" } } }, adult],
  [{ marketplace: "kabum", categoria: "Ferramentas", titulo: "Vibrador de concreto portátil 1500 W",
    metadata: { safetyEvidence: { uncertain: true } } }, uncertain],
  [{ marketplace: "shopee", categoria: "Ferramentas", titulo: "Vibrador",
    descricao: "Para concreto" }, adult]
];

test("distribuidor ativo: categoria e seleção de todos não liberam adulto/incerto", async () => {
  for (const [o, motivo] of casos) {
    const oferta = { ...o, cliente_id: ws, origem: "engine_importer", id: 1 };
    const result = await validarOfertaParaDistribuicao(oferta, {
      clientesValidos: [ws],
      marketplacesAtivosPorCliente: { [ws]: { [o.marketplace]: true } },
      destinosPorCliente: { [ws]: [
        { id: "todas", ativo: true, tipo: "telegram", botToken: "fixture", chatId: "fixture", todasCategorias: true },
        { id: "seletivo", ativo: true, tipo: "telegram", botToken: "fixture", chatId: "fixture", categorias: [o.categoria] }
      ] },
      validarCreditos: () => { assert.equal(motivo, ""); return { ok: true }; }
    });
    assert.equal(result.ok, !motivo, o.titulo);
    if (motivo) {
      assert.equal(result.motivo, motivo);
      assert.equal(result.detalhes.definitivoOperacional, true);
    } else assert.equal(result.destinosCompativeis, 2);
  }
  assert.equal(avaliarSegurancaPublicacao(casos.find(([o]) => o.titulo === "Camiseta infantil algodão")[0]).class, "child");
  assert.equal(avaliarSegurancaPublicacao(casos[6][0]).class, "general");
});

test("entrada na fila e seleção manual bloqueiam antes de escrever ou tocar no provider", async () => {
  const itemPayload = casos[0][0];
  await assert.rejects(enqueue({ workspaceId: ws, jobId: 1, ofertaId: 2, itemPayload,
    pool: { connect: () => assert.fail("iniciou transação") }, destinations: [] }), new RegExp(adult));
  const result = await enviarOfertaManualV2({ clienteId: ws, ofertaId: "2", destinosIds: ["todas"] }, {
    buscarOfertaManualV2: () => itemPayload,
    getIntegracaoCliente: () => assert.fail("resolveu integração")
  });
  assert.equal(result.motivoGlobal, adult);
  assert.equal(result.enviados, 0);
  assert.equal(result.creditosDebitados, 0);
});

test("edição manual não apaga o bloqueio já identificado", async () => {
  const salvo = criarOfertaManualV2(ws, { ...casos[1][0],
    urlOriginal: "https://example.invalid/item", precoAtual: "49.90" });
  const editado = atualizarOfertaManualV2(ws, salvo.id, {
    titulo: "Produto Modelo Fixture", categoria: "Diversos", segurancaPublicacao: null
  });
  assert.equal(editado.titulo, "Produto Modelo Fixture");
  assert.equal(editado.segurancaPublicacao.motivo, adult);
  const retorno = await enviarOfertaManualV2({ clienteId: ws, ofertaId: salvo.id, destinosIds: ["todas"] });
  assert.equal(retorno.motivoGlobal, adult);
});

test("executor de alvo antigo conclui sem transporte, ACK, dedup ou crédito", async () => {
  const naoChamar = () => assert.fail("barreira cruzada");
  const pool = { connect: naoChamar };
  const checks = Object.fromEntries(["resolveDestination", "checkWindow", "checkDailyLimit",
    "checkSession", "checkCredits", "checkMedia", "checkLinks", "checkDedup", "renderMessage"].map(k => [k, naoChamar]));
  const prepare = criarPreflightFilaUniversal({ pool, ...checks, readClock: naoChamar });
  for (const [oferta, reason] of [casos[0], casos[5]]) {
    const claim = { ok: true, id: "alvo-antigo", workspace_id: ws, destination_id: "todas", oferta_id: 2,
      leaseToken: "lease", capturado_em: "2026-01-02T00:00:00Z", operationEpochStartedAt: "2026-01-01T00:00:00Z",
      item_payload: { ...oferta, clienteId: ws, engineOfertaId: 2 } };
    const run = criarExecutorFilaUniversal({ pool, prepare, dispatch: naoChamar, repository: {
      preflightWorkspace: async () => ({ ok: true }), claimDestination: async () => claim,
      completeWithoutSend: async args => {
        assert.equal(args.reason, reason);
        assert.equal(args.destinationId, claim.id);
        assert.equal(args.leaseToken, claim.leaseToken);
        return { ok: true, reason };
      },
      confirmSend: naoChamar, markSendStarted: naoChamar, releaseUnstarted: naoChamar
    } });
    assert.deepEqual(await run(ws), { ok: true, reason });
  }
});

test("reprocessamento legado: rota real rejeita antes de resetar estado", async () => {
  const vm = require("node:vm");
  const fonte = readFileSync(require.resolve("../index.js"), "utf8");
  const inicio = fonte.indexOf('app.post("/fila/:id/reprocessar"');
  const fim = fonte.indexOf('\n});', inicio);
  const oferta = { ...casos[0][0], id: "legada", clienteId: ws, status: "retida", motivoRetencao: adult };
  let handler, status;
  vm.runInNewContext(fonte.slice(inicio, fim + 4), {
    app: { post: (_path, _auth, fn) => { handler = fn; } }, auth: () => {},
    getClienteId: () => ws, garantirFilaClienteInicializadaHttp: async () => true,
    fila: [oferta], avaliarSegurancaPublicacao,
    salvarFila: () => assert.fail("persistiu reset")
  });
  await handler({ params: { id: oferta.id } }, {
    status(n) { status = n; return this; }, json(value) { assert.equal(value.motivo, adult); }
  });
  assert.equal(status, 422);
  assert.equal(oferta.status, "retida");
  assert.equal(oferta.motivoRetencao, adult);
});

test("Achados, Vitrine e Social recusam publicação, inclusive leitura de registros antigos", async () => {
  const o = { ...casos[0][0], id: "legada", clienteId: ws, status: "enviado",
    imagem: "https://example.invalid/img.jpg", linkAfiliado: "https://example.invalid/p",
    capturadoEm: new Date().toISOString(), preco: 49.9 };
  const res = registrarAchado({ clienteId: ws, ofertaId: o.id,
    ofertaUniversal: { produto: { titulo: o.titulo, categoriaNormalizada: o.categoria } } });
  assert.equal(res.motivo, adult);
  assert.equal(registrarAchadoCapacidadeClonador({ clienteId: ws, bufferItem: { metadata: {
    achadosCapacidade: o } } }).motivo, adult);
  writeClienteJson(ws, ARQUIVO_ACHADOS, [o]);
  assert.deepEqual(listarAchados(ws), []);
  assert.equal(publicarOfertaConfirmadaVitrine({ clienteId: ws, oferta: o, destinosEnviados: 1,
    deps: { clienteTemRecurso: () => assert.fail("tentou publicar") } }).motivo, adult);
  assert.deepEqual(paginarOfertasPublicas([o]).ofertas, []);
  let claimed = false;
  const projecao = await processVitrineProjectionBatch({
    pool: {}, retentionMs: 60000,
    publish: () => assert.fail("publicou"),
    buildOffer: () => ({ titulo: "Título de apresentação substituído" }),
    repository: {
      claimVitrineProjection: async () => claimed ? { empty: true }
        : (claimed = true, { terminalAt: new Date().toISOString(), itemPayload: o }),
      finishVitrineProjection: async ({ result, reason }) => {
        assert.equal(result, "skipped"); assert.equal(reason, adult);
      },
      cleanupVitrineProjections: async () => {}
    }
  });
  assert.equal(projecao.skipped, 1);
  writeClienteJson(ws, "fila.json", [o]);
  assert.equal(validarOportunidadeSocialManual(ws, o.id).motivo, adult);
  assert.deepEqual(listarOportunidadesSocial(ws), []);
  assert.equal(carregarOfertaCliente(ws, o.id).segurancaPublicacao?.motivo, adult);
  writeClienteJson(ws, "social-instagram.json", {
    conectado: true, status: "conectado", instagramUserId: "ig_fixture",
    token: { accessToken: "fixture", expiresAt: "2099-01-01T00:00:00Z" },
    scopes: ["instagram_business_content_publish"]
  });
  const naoChamar = () => assert.fail("chamou provedor Social");
  for (const publicar of [publicarImagemInstagram, publicarReelInstagram]) {
    await assert.rejects(publicar({
      clienteId: ws, ofertaId: o.id, httpClient: { get: naoChamar, post: naoChamar }
    }), new RegExp(adult));
  }
});

// The CI-only job already runs this file. Run the real signed-webhook suite
// in a separate process so its env, Social source and storage stay isolated.
test("webhook assinado: posts antigos, Direct, retry e recuperação indisponível", () => {
  const resultado = spawnSync(process.execPath, [require.resolve("./social-instagram-gatilho.test.js")], {
    encoding: "utf8", timeout: 30_000, windowsHide: true
  });
  assert.ifError(resultado.error);
  assert.equal(resultado.status, 0, resultado.stderr || resultado.stdout);
  assert.match(resultado.stdout, /social-instagram-gatilho: ok/);
});
