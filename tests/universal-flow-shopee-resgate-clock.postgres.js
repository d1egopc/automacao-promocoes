"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const root = path.join(__dirname, "..");
const schema = `uf_shopee_clock_${crypto.randomBytes(6).toString("hex")}`;
const port = Number(process.env.UF_TEST_PG_PORT || 55433);
const config = { host: "127.0.0.1", port, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
process.env.DATA_DIR = path.join(root, ".local-test-tmp", schema);
process.env.PGSSLMODE = "disable";
process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${port}/optimus_universal_fixture?options=${encodeURIComponent(`-c search_path=${schema},public`)}`;

async function run() {
  const admin = new Client(config);
  const nativeLog = console.log;
  let pool;
  let installed = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() db,
      host(inet_server_addr()) host, inet_server_port() port,
      current_setting('data_directory') data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root, ".local-postgres", "data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`);
    installed = true;
    await admin.query(`SET search_path TO ${schema},public`);
    for (const file of ["schema.sql", "admission-gate.candidate.sql"]) {
      await admin.query(fs.readFileSync(path.join(root, "modules", "engine", file), "utf8"));
    }
    const { projectionDdl, runSteadyLifecycle } =
      require("../modules/engine/lifecycle-steady.candidate");
    await admin.query(projectionDdl());
    await admin.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_last_success,lifecycle_max_staleness)
      VALUES (1,16,0,'UNKNOWN',NULL,interval '5 minutes')`);
    fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
    require("../utils/storage").writeGlobalJson("usuarios.json",
      [{ id: "ws_shopee", ativo: true, plano: "pro" }]);
    require("../modules/workspace").avaliarWorkspaceParaEngine = id =>
      ({ elegivelEngine: id === "ws_shopee" });
    const { getEnginePool } = require("../modules/engine/database");
    pool = getEnginePool();
    console.log = () => {};
    assert.equal((await runSteadyLifecycle({ pool, limit: 4 })).ok, true);
    await admin.query(`UPDATE engine_hot_admission_control
      SET health='HEALTHY',lifecycle_last_success=now() WHERE id=1`);
    const { registrarEventoBruto } = require("../modules/engine/inbox.service");
    const captures = [];
    const resgateUrl = "https://www.shopee.com.br/m/cupom-de-desconto";
    for (const [age, item] of [[5,456],[15,457]]) {
      const url = `https://www.shopee.com.br/product/123/${item}`;
      const t0 = new Date(Math.floor((Date.now()-age*60000)/1000)*1000).toISOString();
      const result = await registrarEventoBruto({
        origem: "radar", fonte: "radar", origemTipo: "whatsapp",
        grupoId: `shopee_clock_${item}`,
        textoOriginal: `Resgate cupom: ${resgateUrl}\nProduto: ${url}`,
        linksExtraidos: [resgateUrl, url], marketplaceDetectado: "shopee",
        capturadoEm: t0, metadata: { origemFluxo: "optimus" }
      }, { clientes: ["ws_shopee"] });
      assert.equal(result.ok, true, JSON.stringify(result));
      captures.push({ id: String(result.id), age, t0, url });
    }
    const { processarJobsPendentesEngine } = require("../modules/engine/processor.runner");
    const { validarJobsDiagnosticadosEngine } = require("../modules/engine/validator.runner");
    const { importarJobsProntosEngine } = require("../modules/engine/importer/importer.runner");
    const validWorkspace = () => ({ elegivelEngine: true });
    const integration = { ativo: true,
      credenciais: { appId: "12345", secret: "fixture-secret" } };
    assert.equal((await processarJobsPendentesEngine({ limite: 2,
      clientesValidos: ["ws_shopee"], avaliarWorkspaceParaEngine: validWorkspace })).diagnosticados, 2);
    const validated = await validarJobsDiagnosticadosEngine({ limite: 2,
      clientesValidos: ["ws_shopee"], avaliarWorkspaceParaEngine: validWorkspace,
      integracoesPorCliente: { ws_shopee: { shopee: integration } } });
    assert.equal(validated.pronto_para_importar, 2, JSON.stringify(validated));
    const imported = await importarJobsProntosEngine({ limite: 2, marketplace: "shopee",
      deps: { getIntegracaoCliente: () => integration,
        gerarShortLinkShopee: async () => ({ ok: true,
          shortLink: "https://s.shopee.com.br/resgate-fixture" }),
        expandirShortlinkShopee: async url =>
          url.includes("resgate-fixture")
            ? `${resgateUrl}?mmp_pid=an_12345`
            : url,
        importarShopee: async url => ({
          titulo: "Produto Shopee com Resgate Válido",
          precoAtual: 199.9, precoOriginal: 249.9,
          imagem: "https://example.invalid/fixture-shopee.jpg",
          shopId: "123", itemId: url.endsWith("456") ? "456" : "457",
          linkOriginal: url,
          linkAfiliado: `${url}?mmp_pid=an_12345`,
          categoria: "Eletronicos"
        }) } });
    assert.equal(imported.ofertaCriada, 2, JSON.stringify(imported));
    const offers = (await admin.query(`SELECT o.*,e.capturado_em AS evento_capturado_em
      FROM engine_ofertas o JOIN engine_eventos_brutos e ON e.id=o.evento_id
      ORDER BY e.capturado_em DESC`)).rows;
    assert.equal(offers.length, 2);
    const { avaliarFrescorPosClassificacaoCandidato } =
      require("../modules/engine/post-classification-freshness.candidate");
    for (let i = 0; i < offers.length; i += 1) {
      const offer = offers[i];
      assert.equal(offer.evento_capturado_em.toISOString(), captures[i].t0);
      assert.equal(offer.capturada_em.toISOString(), captures[i].t0);
      assert.equal(offer.metadata?.classificacaoTurboCandidata?.ancora,
        "resgate_shopee_valido");
      const freshness = avaliarFrescorPosClassificacaoCandidato(offer);
      assert.equal(freshness.tipoFluxo, "cupom_turbo");
      assert.equal(freshness.ok, captures[i].age === 5);
    }
    const { distribuirOfertasEngine } =
      require("../modules/engine/distributor/distributor.runner");
    const queued = [];
    const destination = { id: "dest_shopee", nome: "Shopee Fixture", ativo: true,
      tipo: "telegram", botToken: "fixture", chatId: "fixture",
      marketplaces: ["shopee"], categorias: [offers[0].categoria] };
    const distribution = await distribuirOfertasEngine({ limite: 2,
      clienteId: "ws_shopee",
      contexto: { clientesValidos: ["ws_shopee"],
        avaliarWorkspaceParaEngine: validWorkspace,
        destinosPorCliente: { ws_shopee: [destination] },
        validarCreditos: async () => ({ ok: true }) },
      deps: { universalFlowFreshnessCandidate: true,
        decidirAbsorcaoWorkspace: async () => ({ ativo: false, permitir: true }),
        adicionarOfertaNaFilaGlobal: async (_clienteId, itemFila) => {
          queued.push(itemFila);
          return { ok: true, itemFila };
        } } });
    assert.equal(distribution.adicionadasFila, 1, JSON.stringify(distribution));
    assert.equal(distribution.motivos.captura_expirada_pos_classificacao, 1);
    assert.equal(queued.length, 1);
    assert.equal(String(queued[0].engineOfertaId), String(offers[0].id));
    nativeLog(JSON.stringify({ candidate: "shopee_resgate_clock",
      source: "radar_capture", captures: 2, imported: 2,
      anchor: "resgate_shopee_valido", originalT0Preserved: true,
      at5: "queued", at15: "blocked_before_queue" }));
  } finally {
    console.log = nativeLog;
    if (pool) await pool.end().catch(() => {});
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
