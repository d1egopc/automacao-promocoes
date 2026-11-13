"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
process.env.ML_WORK_ENRICHMENT_CANARY_CLIENTES = "workspace-a,workspace-b";
const { randomUUID } = require("node:crypto");
const { avaliarFrescorPreImporter } = require("../modules/engine/frescor-pre-importer.service");
const { instalarEstadoIngressReal } = require("../modules/engine/universal-ingress-fence");
const database = require("../modules/engine/database");
let pool;
let persistida;
let falharProximoReagendamento = false;
const queryOriginal = database.queryEngine;
database.queryEngine = async (sql, params) => {
  if (!pool) {
    let rows = [];
    if (/information_schema\.columns/i.test(sql)) rows = [{ existe: true }];
    if (/INSERT INTO engine_ofertas/i.test(sql)) rows = [{ id: 9701, uuid: "fixture-9701" }];
    if (/UPDATE engine_ofertas\s+SET metadata/i.test(sql)) {
      persistida = JSON.parse(params[1]);
      rows = [{ id: 9701 }];
    }
    return { ok: true, resultado: { rows, rowCount: rows.length } };
  }
  if (falharProximoReagendamento && sql.includes("motivo_final = 'aguardando_enriquecimento_local'")) {
    falharProximoReagendamento = false;
    return { ok: false, motivo: "falha_transitoria_fixture" };
  }
  return { ok: true, resultado: await pool.query(sql, params) };
};
const { enriquecerTituloMlPorOcorrencia, normalizarOfertaImportada, agendarRetryImagemMercadoLivreLocal,
  tentarMarcarImportando, buscarJobsProntos, gravarOfertaEngine, avaliarGateIdentidadeMercadoLivre, buscarImagemOficialMercadoLivrePorMlb } = require("../modules/engine/importer/importer.service");
database.queryEngine = queryOriginal;
const { criarLocalWorkerService } = require("../modules/local-worker/local-worker.service");
const { criarLocalWorkerRepository } = require("../modules/local-worker/local-worker.repository");
const { montarOfertaUniversalEngine, validarContratoOfertaUniversal } = require("../modules/engine/oferta-universal.contract");
const { avaliarMemoriaUniversal, detectarIdentidadeProdutoUniversal } = require("../modules/inteligencia-universal/memoria.service");
const workerMl = require("../optimus-capture/local-worker/mercadolivre-identity");

const listingId = "MLB9876500001";
const catalogId = "MLB12345001";
const sourceUrl = "https://www.mercadolivre.com.br/fixture/p/" + catalogId + "?pdp_filters=item_id%3A" + listingId;
const original = "https://meli.la/fixture";
const titulo = "Carretilha de Pesca Maruri Modelo X";
const imagem = "https://http2.mlstatic.com/fixture.jpg";
const now = Date.now();
const iso = ms => new Date(ms).toISOString();
const epoch = iso(now - 5 * 60_000);

function fixture({ id = 101, eventoId = 201, linkId = 301, workspace = "workspace-a",
  capturadoEm = iso(now - 5_000), technicalUrl = sourceUrl, anchor = original } = {}) {
  const evento = { id: eventoId, capturado_em: capturadoEm, links_extraidos: [anchor, "https://example.test/resgate", "https://example.test/app"] };
  const job = { id, evento_id: eventoId, cliente_id: workspace, marketplace: "mercadolivre", criado_em: capturadoEm };
  const links = evento.links_extraidos.map((url, i) => ({ id: linkId + i, evento_id: evento.id, url_original: url }));
  const link = links[0];
  const metadata = { adapter: "mercadolivre", jobId: id, eventoId, clienteId: workspace, linkOriginalEngine: anchor,
    identidadeCanonicaMl: { status: "consistente", urlOriginal: anchor, urlCanonicaRevalidada: technicalUrl,
      mlbProduto: workerMl.urlCatalogo(technicalUrl).catalogId, mlbRevalidado: workerMl.urlCatalogo(technicalUrl).catalogId,
      transporteShowProductConfirmado: true },
    resolucaoRadar: { provaTransporteShowProduct: { ok: true, linkResolvidoTecnico: technicalUrl } },
    transporteTecnicoMl: { linkOriginalRadar: anchor },
    linksClassificados: links.map((item, i) => ({ ocorrenciaId: item.id, urlOriginal: item.url_original, papel: ["produto", "cupom", "app"][i] })),
    linksComerciais: [], produto: { variationId: "4567" } };
  return { job, evento, link, oferta: { marketplace: "mercadolivre", titulo: "Confira agora",
    categoria: "Diversos", imagem, linkOriginal: anchor, linkExpandido: technicalUrl,
    linkAfiliado: "https://meli.la/fixture-aff", preco: 90, precoOriginal: 120, cupom: "FIX10",
    instrucaoCupom: "Aplique FIX10 no carrinho", metadata },
    deps: { mlWorkEnrichmentAtivo: true, linksEventoPersistidos: links } };
}

function proof(t, url = sourceUrl, options = {}) {
  const ids = workerMl.urlCatalogo(url);
  const data = { "@type": "Product", itemId: ids.listingId, catalogProductId: ids.catalogId,
    variationId: "4567", name: titulo, ...options };
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, url, redirected: false,
    text: async () => '<link rel="canonical" href="' + url + '"><script type="application/ld+json">' + JSON.stringify(data) + "</script>" }));
  return workerMl.resolver({ productId: ids.listingId, sourceUrl: url, variationId: "4567" });
}

test("worker real do checkout, com fetch stub, enriquece somente a ocorrência e preserva o envelope comercial", async t => {
  const f = fixture();
  const antes = normalizarOfertaImportada(f.oferta, f.job);
  const start = Date.now();
  f.deps.garantirIdentidadeMercadoLivreLocalWorker = async args => {
    assert.equal(args.sourceUrl, sourceUrl);
    assert.equal(args.productId, listingId);
    assert.equal(args.vinculo.variationId, "4567");
    return { ok: true, task: { id: "17", status: "pending" } };
  };
  const pendente = await gravarOfertaEngine(f.job, f.evento, f.link, f.oferta, f.deps);
  assert.equal(pendente.localWorker.vinculo.taskId, "17");
  f.job.metadata = { localWorkerImageRetry: { vinculo: pendente.localWorker.vinculo } };
  const data = await proof(t);
  f.deps.garantirIdentidadeMercadoLivreLocalWorker = async args => {
    assert.equal(args.taskId, "17");
    return { ok: true, task: { id: "17", status: "completed", createdAt: iso(start - 1),
      completedAt: iso(Date.now()), expiresAt: iso(Date.now() + 60_000), resultMetadata: data } };
  };
  const r = await enriquecerTituloMlPorOcorrencia(f);
  assert.ok(r);
  const oferta = normalizarOfertaImportada(r.oferta, f.job, r.provaValidada, true);
  const provaCategoria = { categoria: "Ferramentas", produtoIdCanonico: listingId,
    fonte: "api_mercadolibre.items.category", urlApi: "https://api.mercadolibre.com/items/" + listingId };
  const produto = r.oferta.metadata.produto;
  const comCategoria = prova => ({ ...r.oferta, metadata: { ...r.oferta.metadata, produto: { ...produto, provaCategoriaOficial: prova } } });
  assert.equal(normalizarOfertaImportada(comCategoria(provaCategoria), f.job, r.provaValidada, true).categoria, "Ferramentas");
  assert.equal(normalizarOfertaImportada(comCategoria({ ...provaCategoria, produtoIdCanonico: catalogId }), f.job, r.provaValidada, true).categoria, "Pesca e Camping");
  assert.equal(oferta.titulo, titulo);
  assert.equal(oferta.categoria, "Pesca e Camping");
  assert.equal(r.provaValidada.ocorrenciaLink.id, String(f.link.id));
  assert.equal(avaliarGateIdentidadeMercadoLivre(oferta, oferta.metadata).retida, false);
  for (const key of ["preco", "precoOriginal", "cupom", "linkOriginal", "linkExpandido", "linkAfiliado", "imagem"]) {
    assert.deepEqual(oferta[key], antes[key], key);
  }
  assert.deepEqual(r.oferta.metadata.linksClassificados, f.oferta.metadata.linksClassificados);
  assert.deepEqual(r.oferta.metadata.linksComerciais, []);
  assert.equal(r.oferta.instrucaoCupom, f.oferta.instrucaoCupom);
  const universal = montarOfertaUniversalEngine({ oferta, ofertaEntrada: r.oferta, job: f.job, evento: f.evento,
    link: f.link, metadata: oferta.metadata });
  assert.equal(validarContratoOfertaUniversal(universal).ok, true);
  assert.equal(universal.produto.idExterno, listingId);
  assert.equal(universal.produto.urlOriginal, original);
  assert.equal(universal.afiliacao.urlAfiliada, f.oferta.linkAfiliado);
  assert.equal(universal.comercial.precoAtual, f.oferta.preco);
  assert.equal(universal.comercial.precoAnterior, f.oferta.precoOriginal);
  assert.equal(universal.comercial.cupom, f.oferta.cupom);
  assert.equal(universal.midia.imagemPrincipal, imagem);
  f.evento.texto_original = "De R$ 120,00 por R$ 90,00. Use o cupom FIX10 no carrinho. " + original;
  f.evento.origem = "radar";
  f.evento.origem_tipo = "whatsapp";
  const cupomRadar = { codigo: "FIX10", instrucao: "Use o cupom FIX10 no carrinho", confianca: "alta", provavel: false };
  f.evento.metadata = { origemFluxo: "optimus", radarMirror: { versao: 1,
    origem: { clienteId: f.job.cliente_id, tipo: "whatsapp" }, texto: { original: f.evento.texto_original },
    preco: { atualCapturado: 90, anteriorCapturado: 120, confianca: "alta", tipoCapturado: "final" },
    cupom: { codigoCapturado: "FIX10", condicaoCapturada: cupomRadar.instrucao, confianca: "alta" },
    links: { encontrados: f.evento.links_extraidos, produtoOriginal: original },
    comercial: { precoAtual: { valor: 90, confianca: "alta", tipo: "final" },
      precoAntigo: { valor: 120, confianca: "alta" }, cupom: cupomRadar } } };
  f.oferta.metadata.produto.provaCategoriaOficial = provaCategoria;
  await gravarOfertaEngine(f.job, f.evento, f.link, f.oferta, f.deps);
  assert.equal(persistida?.ofertaUniversalValidacao.ok, true);
  assert.equal(persistida.ofertaUniversal.produto.categoriaNormalizada, "Ferramentas");
  assert.equal(persistida.ofertaUniversal.produto.titulo, titulo);
  assert.equal(persistida.ofertaUniversal.produto.idExterno, listingId);
  assert.equal(persistida.ofertaUniversal.produto.catalogId, catalogId);
  assert.equal(persistida.ofertaUniversal.produto.variationId, "4567");
  assert.equal(persistida.inteligenciaUniversalV2.produtoIdDetectado, listingId);
  const anterior = { ...oferta, produtoIdDetectado: undefined, clienteId: f.job.cliente_id, criadaEm: iso(Date.now() - 60_000), metadata: persistida };
  assert.equal(detectarIdentidadeProdutoUniversal(anterior).produtoIdDetectado, listingId);
  assert.equal(detectarIdentidadeProdutoUniversal({ ...anterior, metadata: {} }).produtoIdDetectado, catalogId);
  const avaliar = item => avaliarMemoriaUniversal(anterior, { memoriaAnteriores: [item] });
  assert.equal(avaliar(anterior).bloquear, true);
  const outroId = "MLB9876500002";
  const outraUrl = sourceUrl.replace(listingId, outroId);
  const outroAnuncio = { ...anterior, linkExpandido: outraUrl, metadata: { ...persistida,
    identidadeCanonicaMl: { ...persistida.identidadeCanonicaMl, mlbRevalidado: outroId, mlbProduto: outroId, urlCanonicaRevalidada: outraUrl },
    provaTituloTecnicoValidada: { ...persistida.provaTituloTecnicoValidada,
      produto: { produtoIdCanonico: outroId, urlCanonica: outraUrl } } } };
  assert.equal(detectarIdentidadeProdutoUniversal(outroAnuncio).produtoIdDetectado, outroId);
  for (const distinto of [outroAnuncio, { ...anterior, metadata: { ...persistida,
    identidadeCanonicaMl: { ...persistida.identidadeCanonicaMl, variationId: "4568" } } },
    { ...anterior, clienteId: "workspace-b", metadata: { ...persistida, clienteId: "workspace-b",
      provaTituloTecnicoValidada: { ...persistida.provaTituloTecnicoValidada, workspaceId: "workspace-b" } } }]) {
    const decisao = avaliar(distinto);
    assert.equal(decisao.bloquear, false);
    assert.equal(decisao.totalMemoriaCompativeis, 0);
    assert.equal(decisao.memoriaLegada.repetida, false);
  }
  assert.equal(persistida.ofertaUniversal.comercial.precoAnterior, f.oferta.precoOriginal);
  assert.equal(persistida.ofertaUniversal.comercial.cupom, f.oferta.cupom);
  assert.equal(persistida.ofertaUniversal.afiliacao.urlAfiliada, f.oferta.linkAfiliado);
  assert.deepEqual(persistida.linksClassificados, f.oferta.metadata.linksClassificados);
  const outro = { ...f, job: { ...f.job, cliente_id: "workspace-b" } };
  assert.equal(await enriquecerTituloMlPorOcorrencia(outro), null);
  assert.equal(await enriquecerTituloMlPorOcorrencia({ ...f, link: f.deps.linksEventoPersistidos[1] }), null);
  f.deps.garantirIdentidadeMercadoLivreLocalWorker = async () => ({ ok: true, task: { id: "99", status: "completed" } });
  assert.equal(await enriquecerTituloMlPorOcorrencia(f), null);
  console.log("TEMPO_FIXTURE_MS=" + (Date.now() - start));
});

test("redirect técnico ancorado aguarda worker e só aceita título oficial da mesma ocorrência", async t => {
  const f = fixture();
  f.oferta.titulo = "";
  f.oferta.nome = "";
  f.oferta.metadata.aguardaTituloMl = true;
  f.oferta.metadata.identidadeCanonicaMl.status = "transporte_confirmado";
  f.oferta.metadata.identidadeCanonicaMl.transporteShowProductConfirmado = false;
  f.oferta.metadata.identidadeCanonicaMl.transporteRedirectConfirmado = true;
  f.oferta.metadata.resolucaoRadar = { ok: true, urlCapturada: original, linkOriginalRadar: original,
    urlResolvida: sourceUrl, tipoLinkRadar: "shortlink_meli", statusHttp: 200 };
  f.deps.garantirIdentidadeMercadoLivreLocalWorker = async () => ({ ok: true,
    task: { id: "redirect-17", status: "pending" } });
  const pending = await enriquecerTituloMlPorOcorrencia(f);
  assert.equal(pending.pendente, true);
  assert.equal(pending.vinculo.listingId, listingId);
  const rejected = await gravarOfertaEngine(f.job, f.evento, f.link, f.oferta,
    { ...f.deps, garantirIdentidadeMercadoLivreLocalWorker: null });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.motivo, "mercadolivre_titulo_tecnico_nao_confirmado");
  f.job.metadata = { localWorkerImageRetry: { vinculo: { ...pending.vinculo, taskId: "redirect-17" } } };
  const data = await proof(t);
  const start = Date.now();
  f.deps.garantirIdentidadeMercadoLivreLocalWorker = async () => ({ ok: true,
    task: { id: "redirect-17", status: "completed", createdAt: iso(start - 1000),
      completedAt: iso(Date.now()), expiresAt: iso(Date.now() + 60_000), resultMetadata: data } });
  const enriched = await enriquecerTituloMlPorOcorrencia(f);
  assert.equal(enriched.oferta.titulo, titulo);
  assert.equal(enriched.oferta.metadata.identidadeCanonicaMl.status, "consistente");
  assert.equal(enriched.oferta.metadata.identidadeCanonicaMl.mlbProduto, listingId);
  assert.equal(enriched.oferta.produtoId, listingId);
  assert.equal(enriched.oferta.metadata.produto.produtoId, listingId);
  assert.equal(enriched.oferta.cupom, "FIX10");
  const persisted = await gravarOfertaEngine(f.job, f.evento, f.link, f.oferta, f.deps);
  assert.equal(persisted.ok, true);
  assert.equal(persisted.oferta.titulo, titulo);
  assert.equal(persisted.oferta.categoria, "Pesca e Camping");
  assert.equal(persisted.oferta.preco, 90);
  const other = fixture({ workspace: "workspace-b" });
  other.oferta = f.oferta;
  other.deps.garantirIdentidadeMercadoLivreLocalWorker = f.deps.garantirIdentidadeMercadoLivreLocalWorker;
  assert.equal((await enriquecerTituloMlPorOcorrencia(other)).provaValidada.workspaceId, "workspace-b",
    "a prova técnica compartilhada gera vínculo individual por workspace");
  const wrongAnchor = fixture({ anchor: "https://meli.la/outra-ocorrencia" });
  wrongAnchor.oferta = f.oferta;
  wrongAnchor.deps.garantirIdentidadeMercadoLivreLocalWorker = f.deps.garantirIdentidadeMercadoLivreLocalWorker;
  assert.equal(await enriquecerTituloMlPorOcorrencia(wrongAnchor), null);
});

test("timeout ou colisão deixa a ocorrência pendente; flag OFF não consulta o worker", async () => {
  const f = fixture();
  let chamadas = 0;
  f.deps.garantirIdentidadeMercadoLivreLocalWorker = async () => { chamadas++; throw new Error("ml_identity_operacao_local_timeout"); };
  f.deps.mlWorkEnrichmentAtivo = false;
  assert.equal(await enriquecerTituloMlPorOcorrencia(f), null);
  assert.equal(chamadas, 0);
  f.deps.mlWorkEnrichmentAtivo = true;
  const espera = await enriquecerTituloMlPorOcorrencia(f);
  assert.equal(espera?.pendente, true);
  assert.equal(espera.vinculo.taskId, undefined);
  assert.ok(espera.vinculo.deadline > Date.now());
});

test("categoria vem apenas de resposta oficial do mesmo item e categoria vinculada", async () => {
  const buscar = (data, url = "https://api.mercadolibre.com/items/" + listingId) =>
    buscarImagemOficialMercadoLivrePorMlb(listingId, { accessToken: "fixture",
      fetchImpl: async () => ({ status: 200, url, json: async () => data }) });
  const dados = { id: listingId, category_id: "MLB123456", category: { id: "MLB123456", name: "Ferramentas" } };
  assert.equal((await buscar(dados)).provaCategoriaOficial?.categoria, "Ferramentas");
  assert.equal((await buscar({ ...dados, id: catalogId })).provaCategoriaOficial, undefined);
  assert.equal((await buscar({ ...dados, category_id: "MLB999999" })).provaCategoriaOficial, undefined);
  assert.equal((await buscar({ ...dados, category: undefined })).provaCategoriaOficial, undefined);
  assert.equal((await buscar(dados, "https://example.test")).provaCategoriaOficial, undefined);
});

test("registro histórico 1136698 fica sem prova e não cria tarefa expirada", async () => {
  const url = "https://www.mercadolivre.com.br/carretilha-fixture/p/MLB22147432?pdp_filters=item_id%3AMLB4772233032";
  const f = fixture({ id: 1136698, eventoId: 231933, linkId: 262813, capturadoEm: "2000-01-01T00:00:00.000Z",
    technicalUrl: url, anchor: "https://meli.la/2wJZGNV" });
  f.deps.garantirIdentidadeMercadoLivreLocalWorker = async () => assert.fail("histórico não deve criar task");
  assert.equal(await enriquecerTituloMlPorOcorrencia(f), null);
  assert.equal(normalizarOfertaImportada(f.oferta, f.job).titulo, "");
  const metadata = { ...f.oferta.metadata, fallbackMercadoLivreRadar: true };
  assert.equal(avaliarGateIdentidadeMercadoLivre({ marketplace: "mercadolivre", titulo }, metadata, true).retida, true);
  assert.equal(avaliarGateIdentidadeMercadoLivre({ marketplace: "mercadolivre", titulo }, metadata, false).retida, false);
});

test("PG17, repositório real e UPDATE de retomada real, em esquema descartável", { skip: !process.env.OPTIMUS_TEST_PG17 }, async t => {
  const { Pool } = require("pg");
  const schema = "offer_anchor_" + randomUUID().replaceAll("-", "");
  const cfg = { host: "127.0.0.1", port: 55433, user: "postgres", database: "optimus_universal_fixture" };
  const admin = new Pool(cfg);
  try {
    const server = (await admin.query("SELECT version(), current_setting('data_directory') AS dir")).rows[0];
    assert.match(server.version, /^PostgreSQL 17\./);
    const dir = server.dir.replaceAll("\\", "/");
    if (process.env.CI === "true") assert.equal(dir, "/var/lib/postgresql/data");
    else assert.match(dir, /\/baseline\/\.local-postgres\/data$/);
    await admin.query("CREATE SCHEMA " + schema);
    pool = new Pool({ ...cfg, options: "-c search_path=" + schema, max: 4 });
    await pool.query(require("node:fs").readFileSync(require.resolve("../modules/engine/schema.sql"), "utf8"));
    await pool.query("CREATE TABLE engine_operation_state(id int PRIMARY KEY, mode text, operation_epoch_started_at timestamptz)");
    const flagAnterior = process.env.ML_WORK_ENRICHMENT_ACTIVE;
    process.env.ML_WORK_ENRICHMENT_ACTIVE = "true";
    t.after(() => {
      if (flagAnterior === undefined) delete process.env.ML_WORK_ENRICHMENT_ACTIVE;
      else process.env.ML_WORK_ENRICHMENT_ACTIVE = flagAnterior;
    });
    const inserir = async fixture => {
      const { job, evento, link } = fixture;
      await pool.query("INSERT INTO engine_eventos_brutos(id,capturado_em) VALUES ($1,$2)", [evento.id, evento.capturado_em]);
      await pool.query("INSERT INTO engine_links(id,evento_id,url_original) VALUES ($1,$2,$3)", [link.id, evento.id, link.url_original]);
      await pool.query("INSERT INTO engine_jobs_cliente(id,evento_id,cliente_id,marketplace,status) VALUES($1,$2,$3,'mercadolivre','importando')", [job.id, evento.id, job.cliente_id]);
    };
    instalarEstadoIngressReal({ mode: "UNIVERSAL", operationEpochStartedAt: epoch });
    await pool.query("INSERT INTO engine_operation_state VALUES (1,'UNIVERSAL',$1)", [epoch]);
    const f = fixture();
    await inserir(f);
    const repo = criarLocalWorkerRepository({ pool: () => pool });
    await repo.ensureSchema();
    const svc = criarLocalWorkerService({ repository: repo, dedicatedOwnerIds: "fixture-owner" });
    f.deps.garantirIdentidadeMercadoLivreLocalWorker = svc.garantirIdentidadeMercadoLivre;
    const [a, b] = await Promise.all([enriquecerTituloMlPorOcorrencia(f), enriquecerTituloMlPorOcorrencia(f)]);
    assert.ok(a?.pendente && b?.pendente);
    assert.equal(a.vinculo.taskId, b.vinculo.taskId);
    const competidor = fixture({ workspace: "workspace-b", id: 102, eventoId: 202, linkId: 302, anchor: "https://meli.la/fixture-b" });
    competidor.deps.garantirIdentidadeMercadoLivreLocalWorker = svc.garantirIdentidadeMercadoLivre;
    competidor.job.tipoFluxo = "cupom_turbo";
    competidor.oferta.cupom = "OUTRO10";
    competidor.oferta.instrucaoCupom = "Use OUTRO10";
    const compartilhada = await enriquecerTituloMlPorOcorrencia(competidor);
    assert.equal(compartilhada?.vinculo.taskId, a.vinculo.taskId);
    assert.notEqual(compartilhada.vinculo.chave, a.vinculo.chave);
    assert.equal(compartilhada.vinculo.deadline - Date.parse(competidor.evento.capturado_em), 10 * 60_000);
    assert.equal(a.vinculo.deadline - Date.parse(f.evento.capturado_em), 30 * 60_000);
    const variante = fixture({ id: 104, eventoId: 204, linkId: 304 });
    variante.oferta.metadata.produto.variationId = "4568";
    variante.deps.garantirIdentidadeMercadoLivreLocalWorker = svc.garantirIdentidadeMercadoLivre;
    const espera = await enriquecerTituloMlPorOcorrencia(variante);
    assert.ok(espera?.pendente);
    assert.equal(espera.vinculo.taskId, undefined);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM local_worker_tasks")).rows[0].n, 1);
    const outroAnuncio = fixture({ workspace: "workspace-b", id: 103, eventoId: 203, linkId: 303,
      technicalUrl: sourceUrl.replace(listingId, "MLB9876500002") });
    outroAnuncio.deps.garantirIdentidadeMercadoLivreLocalWorker = svc.garantirIdentidadeMercadoLivre;
    const outraTarefa = await enriquecerTituloMlPorOcorrencia(outroAnuncio);
    assert.ok(outraTarefa?.pendente);
    assert.notEqual(outraTarefa.vinculo.taskId, a.vinculo.taskId);
    const c = await repo.claim({ workerId: "fixture-worker", capabilities: ["ml_identity_v1"] });
    assert.equal(c.task.id, a.vinculo.taskId);
    const retry = () => agendarRetryImagemMercadoLivreLocal(f.job, { capability: "ml_identity_v1", vinculo: a.vinculo });
    await pool.query("UPDATE engine_operation_state SET operation_epoch_started_at = $1", [iso(Date.parse(epoch) + 60_000)]);
    assert.equal((await retry()).ok, false);
    await pool.query("UPDATE engine_operation_state SET operation_epoch_started_at = $1", [epoch]);
    assert.equal((await agendarRetryImagemMercadoLivreLocal(f.job, { vinculo: { ...a.vinculo, deadline: Date.now() - 1 } })).ok, false);
    const results = await Promise.all([retry(), retry()]);
    assert.equal(results.filter(item => item.ok).length, 1);
    assert.equal((await tentarMarcarImportando(f.job.id, pool)).ok, false);
    await pool.query("UPDATE engine_jobs_cliente SET metadata = jsonb_set(metadata, '{localWorkerImageRetry,proximaTentativaEmMs}', '0')");
    await pool.query("UPDATE engine_operation_state SET operation_epoch_started_at = $1", [iso(Date.parse(epoch) + 60_000)]);
    assert.equal((await tentarMarcarImportando(f.job.id, pool)).ok, false);
    await pool.query("UPDATE engine_operation_state SET operation_epoch_started_at = $1", [epoch]);
    const claims = await Promise.all([tentarMarcarImportando(f.job.id, pool), tentarMarcarImportando(f.job.id, pool)]);
    assert.equal(claims.filter(item => item.ok).length, 1);
    const row = (await pool.query("SELECT status, metadata, tentativas FROM engine_jobs_cliente")).rows[0];
    assert.equal(row.tentativas, 1);
    f.job.metadata = row.metadata;
    const primeiraVerificacao = await enriquecerTituloMlPorOcorrencia(f);
    assert.ok(primeiraVerificacao?.pendente);
    const reagendar = () => agendarRetryImagemMercadoLivreLocal(f.job, { capability: "ml_identity_v1", vinculo: primeiraVerificacao.vinculo });
    const segundas = await Promise.all([reagendar(), reagendar()]);
    assert.equal(segundas.filter(x => x.ok).length, 1);
    assert.equal((await tentarMarcarImportando(f.job.id, pool)).ok, false);
    const data = await proof(t);
    const outraLease = await repo.claim({ workerId: "fixture-worker", capabilities: ["ml_identity_v1"] });
    assert.equal(outraLease.task.id, outraTarefa.vinculo.taskId);
    await assert.rejects(svc.resultado({ ...data, worker: { ok: true, workerType: "dedicated",
      ownerId: "fixture-owner", workerId: "fixture-worker", capabilities: ["ml_identity_v1"] },
      taskId: outraLease.task.id, leaseToken: outraLease.task.leaseToken }), /product_id_divergente/);
    await pool.query("UPDATE engine_jobs_cliente SET metadata = jsonb_set(metadata, '{localWorkerImageRetry,proximaTentativaEmMs}', '0')");
    const segundaLeva = await Promise.all([tentarMarcarImportando(f.job.id, pool), tentarMarcarImportando(f.job.id, pool)]);
    assert.equal(segundaLeva.filter(x => x.ok).length, 1);
    f.job.metadata = (await pool.query("SELECT metadata FROM engine_jobs_cliente")).rows[0].metadata;
    const segundaVerificacao = await enriquecerTituloMlPorOcorrencia(f);
    assert.ok(segundaVerificacao?.pendente);
    falharProximoReagendamento = true;
    const final = await reagendar();
    assert.equal(final.ok, true);
    assert.equal(final.estadoRetry.aguardandoConclusao, true);
    assert.equal(final.estadoRetry.proximaTentativaEmMs, a.vinculo.deadline);
    await inserir(competidor);
    const pendenteB = { ...final.estadoRetry, vinculo: compartilhada.vinculo,
      proximaTentativaEmMs: compartilhada.vinculo.deadline };
    const prepararEspera = (id, espera, status = "pronto_para_importar") => pool.query(
      "UPDATE engine_jobs_cliente SET status=$2,metadata=$3 WHERE id=$1",
      [id, status, JSON.stringify({ localWorkerImageRetry: espera })]);
    await prepararEspera(competidor.job.id, pendenteB);
    const esperasRegulares = [1, 2].map((tentativa, i) => ({
      tentativa, fixture: fixture({ id: 110 + i, eventoId: 210 + i, linkId: 310 + i })
    }));
    for (const { tentativa, fixture: cedo } of esperasRegulares) {
      cedo.deps.garantirIdentidadeMercadoLivreLocalWorker = svc.garantirIdentidadeMercadoLivre;
      await inserir(cedo);
      const vinculo = (await enriquecerTituloMlPorOcorrencia(cedo)).vinculo;
      assert.equal(vinculo.taskId, a.vinculo.taskId);
      if (tentativa === 2) cedo.job.metadata = { localWorkerImageRetry: { vinculo, tentativas: 1 } };
      if (tentativa === 2) await prepararEspera(cedo.job.id, cedo.job.metadata.localWorkerImageRetry, "importando");
      const agendado = await agendarRetryImagemMercadoLivreLocal(cedo.job, { vinculo, capability: "ml_identity_v1" });
      assert.equal(agendado.tentativa, tentativa);
      cedo.job.metadata = { localWorkerImageRetry: agendado.estadoRetry };
    }
    assert.equal((await tentarMarcarImportando(f.job.id, pool)).ok, false);
    const concluir = () => svc.resultado({ ...data, worker: { ok: true, workerType: "dedicated",
      ownerId: "fixture-owner", workerId: "fixture-worker", capabilities: ["ml_identity_v1"] },
      taskId: c.task.id, leaseToken: c.task.leaseToken });
    const conclusoes = await Promise.all([concluir(), concluir()]);
    assert.equal(conclusoes.filter(x => x.ok && !x.idempotente).length, 1);
    for (const { fixture: cedo } of esperasRegulares) {
      const espera = cedo.job.metadata.localWorkerImageRetry;
      assert.equal((await tentarMarcarImportando(cedo.job.id, pool)).ok, false);
      await prepararEspera(cedo.job.id, { ...espera, proximaTentativaEmMs: 0 });
      assert.equal((await tentarMarcarImportando(cedo.job.id, pool)).ok, true);
      assert.equal((await enriquecerTituloMlPorOcorrencia(cedo))?.oferta.titulo, titulo);
    }
    process.env.ML_WORK_ENRICHMENT_ACTIVE = "false";
    assert.equal((await tentarMarcarImportando(f.job.id, pool)).ok, false);
    process.env.ML_WORK_ENRICHMENT_ACTIVE = "true";
    for (const alteracao of [{ variationId: "999" }, { listingId: "MLB9999999999" },
      { workspaceId: "workspace-a" }, { ocorrenciaId: "301" }, { catalogId: "MLB9999999" },
      { deadline: Date.now() - 1 }]) {
      await prepararEspera(competidor.job.id, { ...pendenteB, vinculo: { ...pendenteB.vinculo, ...alteracao } });
      assert.equal((await tentarMarcarImportando(competidor.job.id, pool)).ok, false);
    }
    await prepararEspera(competidor.job.id, pendenteB, "erro");
    assert.equal((await tentarMarcarImportando(competidor.job.id, pool)).ok, false);
    await prepararEspera(competidor.job.id, pendenteB);
    await pool.query("UPDATE engine_operation_state SET operation_epoch_started_at=$1", [iso(Date.parse(epoch) + 60_000)]);
    assert.equal((await tentarMarcarImportando(f.job.id, pool)).ok, false);
    await pool.query("UPDATE engine_operation_state SET operation_epoch_started_at=$1", [epoch]);
    process.env.ML_WORK_ENRICHMENT_CANARY_CLIENTES = "workspace-a";
    try {
      const soCanario = await buscarJobsProntos({ marketplace: "mercadolivre" });
      assert.equal(soCanario.ok, true);
      assert.deepEqual(soCanario.candidatePool.map(j => Number(j.id)), [101]);
      assert.equal((await tentarMarcarImportando(competidor.job.id, pool)).ok, false);
      assert.equal(await enriquecerTituloMlPorOcorrencia(competidor), null);
      // Jobs comuns da workspace de controle continuam pelo claim legado.
      await prepararEspera(competidor.job.id, {});
      assert.equal((await tentarMarcarImportando(competidor.job.id, pool)).ok, true);
      await prepararEspera(competidor.job.id, pendenteB);
    } finally {
      process.env.ML_WORK_ENRICHMENT_CANARY_CLIENTES = "workspace-a,workspace-b";
    }
    const selecao = await buscarJobsProntos({ marketplace: "mercadolivre" });
    assert.equal(selecao.ok, true);
    assert.deepEqual(selecao.candidatePool.map(j => Number(j.id)).sort(), [101, 102]);
    const concorrentes = await Promise.all([f, f, competidor, competidor].map(x => tentarMarcarImportando(x.job.id, pool)));
    assert.equal(concorrentes.slice(0, 2).filter(x => x.ok).length, 1);
    assert.equal(concorrentes.slice(2).filter(x => x.ok).length, 1);
    const leitura = async id => (await pool.query("SELECT metadata FROM engine_jobs_cliente WHERE id=$1", [id])).rows[0].metadata;
    f.job.metadata = await leitura(f.job.id);
    competidor.job.metadata = await leitura(competidor.job.id);
    assert.equal(f.job.metadata.localWorkerImageRetry.conclusaoConsumida, true);
    assert.equal(competidor.job.metadata.localWorkerImageRetry.conclusaoConsumida, true);
    await pool.query("UPDATE engine_jobs_cliente SET status='pronto_para_importar' WHERE id=$1", [f.job.id]);
    assert.equal((await tentarMarcarImportando(f.job.id, pool)).ok, false);
    assert.equal((await reagendar()).esgotado, true);
    const provaOutra = await enriquecerTituloMlPorOcorrencia(competidor);
    assert.equal(provaOutra?.provaValidada.workspaceId, "workspace-b");
    assert.equal(provaOutra.oferta.cupom, "OUTRO10");
    assert.equal(provaOutra.oferta.instrucaoCupom, "Use OUTRO10");
    assert.equal(provaOutra?.provaValidada.ocorrenciaLink.id, "302");
    assert.equal(await enriquecerTituloMlPorOcorrencia({ ...competidor, agoraMs: compartilhada.vinculo.deadline }), null);
    const enriched = await enriquecerTituloMlPorOcorrencia(f);
    assert.equal(enriched?.oferta.titulo, titulo);
    assert.equal(await enriquecerTituloMlPorOcorrencia({ ...f, agoraMs: a.vinculo.deadline }), null);
    const frescor = avaliarFrescorPreImporter({ ...f.job, evento_capturado_em: f.evento.capturado_em });
    assert.equal(a.vinculo.deadline, Date.parse(frescor.expiraEmComercial));
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM local_worker_identity_cache")).rows[0].n, 0);
    const provaExpirada = await proof(t, outroAnuncio.oferta.linkExpandido);
    await pool.query("UPDATE local_worker_tasks SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [outraLease.task.id]);
    const resultadoExpirado = await svc.resultado({ ...provaExpirada,
      worker: { ok: true, workerType: "dedicated", ownerId: "fixture-owner", workerId: "fixture-worker",
        capabilities: ["ml_identity_v1"] },
      taskId: outraLease.task.id, leaseToken: outraLease.task.leaseToken });
    assert.equal(resultadoExpirado.ok, false);
    assert.equal(resultadoExpirado.motivo, "lease_invalido");
  } finally {
    if (pool) await pool.end();
    if (pool) await admin.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
    await admin.end();
  }
});
