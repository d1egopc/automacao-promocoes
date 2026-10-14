"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Pool } = require("pg");

const databaseUrl = String(process.env.ALIEXPRESS_TEST_DATABASE_URL || process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("ALIEXPRESS_TEST_DATABASE_URL_REQUIRED");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-aliexpress-sql-"));
const workspaceId = "ws_aliexpress_sql_fixture";
const appKey = "fixture-app-key";
const secret = "fixture-secret-only";
const trackingId = "fixture-tracking";
const urls = {
  app: "https://a.aliexpress.com/_fixture_app",
  pc: "https://www.aliexpress.com/item/1005009900000001.html",
  moda: "https://www.aliexpress.com/item/1005009900000001.html?source=moda",
  moedas: "https://a.aliexpress.com/_fixture_moedas"
};

process.env.DATA_DIR = dataDir;
process.env.DATABASE_URL = databaseUrl;
process.env.PGSSLMODE = "disable";
process.env.ENGINE_DB_POOL_MAX = "4";
process.env.ENGINE_DB_CONNECTION_TIMEOUT_MS = "5000";
fs.writeFileSync(path.join(dataDir, "usuarios.json"), JSON.stringify([{ id: workspaceId, ativo: true }]));

const database = require("../modules/engine/database");
const processor = require("../modules/engine/processor.service");
const importerRunner = require("../modules/engine/importer/importer.runner");
const { criarProvaAfiliacaoWorkspaceAliExpress } = require("../modules/marketplaces/aliexpress/afiliacao-workspace");

function fakeAliExpressImporter(url, options = {}) {
  const papel = String(options.contextoEngine?.papelLink || "produto");
  const linkAfiliado = `https://s.click.aliexpress.com/e/fixture-${papel}-${crypto.createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
  return Promise.resolve({
    ok: true,
    produtoId: "1005009900000001",
    titulo: "Controle 8BitDo Ultimate 2C",
    precoAtual: 88.8,
    imagem: "https://cdn.fixture.invalid/aliexpress-8bitdo.jpg",
    categoria: "games",
    linkOriginal: url,
    linkFinal: linkAfiliado,
    linkAfiliado,
    metadata: {
      sourceValuesUsado: url,
      produtoId: "1005009900000001",
      afiliacaoWorkspace: criarProvaAfiliacaoWorkspaceAliExpress({
        clienteId: workspaceId,
        credenciais: { appKey, secret, trackingId },
        urlOriginal: url,
        urlAfiliadaWorkspace: linkAfiliado,
        papel,
        conversaoStatus: "convertida",
        motivoConversao: "fixture_workspace_api"
      })
    }
  });
}

async function claimConcurrently(pool, jobId) {
  const clients = await Promise.all([pool.connect(), pool.connect()]);
  try {
    return await Promise.all(clients.map(client => processor.reivindicarJobsProcessandoComExecutor(client, [jobId])));
  } finally {
    clients.forEach(client => client.release());
  }
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
  try {
    const runtime = (await pool.query("SELECT current_database() AS database, current_setting('server_version_num') AS version_num")).rows[0];
    assert.equal(runtime.database, "optimus_aliexpress_fixture", "o teste deve usar exclusivamente o banco descartável");
    assert.match(String(runtime.version_num), /^17/, "o teste exige PostgreSQL 17");
    const schema = await database.initEngineDatabase();
    assert.equal(schema.ok, true, "schema do engine deve estar aplicado no banco descartável");

    const evento = (await pool.query(
      `INSERT INTO engine_eventos_brutos
        (origem, fonte, origem_tipo, grupo_id, grupo_nome, texto_original, links_extraidos, marketplace_detectado, metadata, capturado_em)
       VALUES ('radar', 'radar', 'aliexpress', 'fixture-grupo', 'Fixture AliExpress', $1, $2::jsonb, 'aliexpress', $3::jsonb, NOW())
       RETURNING id`,
      [
        "Controle 8BitDo Ultimate 2C\nR$ 129,00\nCupom BRCD1\n+25 moedas\nLink App:\nhttps://a.aliexpress.com/_fixture_app\nLink PC:\nhttps://www.aliexpress.com/item/1005009900000001.html\nLink Moda:\nhttps://www.aliexpress.com/item/1005009900000002.html\nLink Moedas:\nhttps://a.aliexpress.com/_fixture_moedas",
        JSON.stringify(Object.values(urls)),
        JSON.stringify({ origemFluxo: "optimus", fixture: "aliexpress-sql-claim-v1" })
      ]
    )).rows[0];

    const linkRows = [
      [urls.app, "link_app", 1],
      [urls.pc, "link_pc", 2],
      [urls.moda, "produto", 3],
      [urls.moedas, "link_moedas", 4]
    ];
    for (const [url, papelLink, ordem] of linkRows) {
      await pool.query(
        `INSERT INTO engine_links
          (evento_id, url_original, url_normalizada, marketplace_detectado, metadata)
         VALUES ($1, $2, $2, 'aliexpress', $3::jsonb)`,
        [evento.id, url, JSON.stringify({ papelLink, ordemCaptura: ordem, fixture: true })]
      );
    }

    const job = (await pool.query(
      `INSERT INTO engine_jobs_cliente
        (evento_id, cliente_id, marketplace_detectado, marketplace, status, prioridade, metadata)
       VALUES ($1, $2, 'aliexpress', 'aliexpress', 'pendente', 10, $3::jsonb)
       RETURNING id`,
      [evento.id, workspaceId, JSON.stringify({ origemFluxo: "optimus", fixture: "aliexpress-sql-claim-v1" })]
    )).rows[0];

    const selecionados = await processor.buscarJobsPendentes(1);
    assert.equal(selecionados.ok, true);
    assert.ok(selecionados.jobs.some(item => Number(item.id) === Number(job.id)), "job fresco deve entrar na seleção SQL");

    const claims = await claimConcurrently(pool, job.id);
    assert.equal(claims.filter(item => item.jobs.length === 1).length, 1, "somente um worker pode vencer o claim SQL");
    assert.equal(claims.filter(item => item.ignorado === true).length, 1, "o segundo claim deve ser ignorado");

    const pronto = await processor.marcarJobStatus(job.id, "pronto_para_importar", "", { statusEsperado: "processando" });
    assert.equal(pronto.ok, true);

    const importacao = await importerRunner.importarJobPronto(
      { id: job.id, evento_id: evento.id, cliente_id: workspaceId, marketplace: "aliexpress", marketplace_detectado: "aliexpress", status: "pronto_para_importar" },
      {
        deps: {
          getIntegracaoCliente: () => ({ credenciais: { appKey, secret, trackingId } }),
          importarAliExpress: fakeAliExpressImporter
        }
      }
    );
    assert.equal(importacao.ok, true, `importer deve persistir a oferta: ${JSON.stringify(importacao)}`);

    const persisted = (await pool.query(
      `SELECT j.status, j.oferta_id, o.marketplace, o.titulo, o.preco, o.cupom, o.imagem, o.link_afiliado,
              o.metadata->'linksClassificados' AS links_classificados
         FROM engine_jobs_cliente j
         JOIN engine_ofertas o ON o.id = j.oferta_id
        WHERE j.id = $1`,
      [job.id]
    )).rows[0];
    assert.equal(persisted.status, "oferta_criada");
    assert.ok(persisted.oferta_id);
    assert.equal(persisted.marketplace, "aliexpress");
    assert.equal(persisted.titulo, "Controle 8BitDo Ultimate 2C");
    assert.equal(Number(persisted.preco), 129, "preço Radar deve permanecer autoridade");
    assert.equal(persisted.cupom, "BRCD1", "cupom Radar deve ser preservado");
    assert.ok(persisted.imagem);
    assert.ok(persisted.link_afiliado.includes("s.click.aliexpress.com"));
    const linksPersistidos = Array.isArray(persisted.links_classificados) ? persisted.links_classificados : [];
    const urlsAfiliadas = new Set();
    for (const url of Object.values(urls)) {
      const item = linksPersistidos.find(link => link.urlOriginal === url);
      assert.ok(item, `link ${url} deve permanecer por ocorrência`);
      assert.equal(item.renderizavel, true, `link ${url} deve ser afiliado`);
      assert.ok(item.urlAfiliadaWorkspace, "link convertido deve ter URL afiliada do workspace");
      assert.equal(item.conversaoWorkspace?.workspaceId, workspaceId);
      urlsAfiliadas.add(item.urlAfiliadaWorkspace);
    }
    assert.equal(urlsAfiliadas.size, Object.values(urls).length, "links distintos devem manter conversões independentes");

    const retry = await importerRunner.importarJobPronto(
      { id: job.id, evento_id: evento.id, cliente_id: workspaceId, marketplace: "aliexpress", marketplace_detectado: "aliexpress", status: "oferta_criada" },
      { deps: { getIntegracaoCliente: () => ({ credenciais: { appKey, secret, trackingId } }), importarAliExpress: fakeAliExpressImporter } }
    );
    assert.equal(retry.ignorado, true, "retry após terminalização não pode criar segunda oferta");
    const totalOfertas = (await pool.query("SELECT count(*)::int AS total FROM engine_ofertas WHERE evento_id = $1", [evento.id])).rows[0].total;
    assert.equal(totalOfertas, 1, "persistência deve ser idempotente para o mesmo job");

    console.log(JSON.stringify({
      ok: true,
      sqlClaim: true,
      selectedFreshJob: true,
      singleWinner: true,
      offerPersistence: true,
      idempotentRetry: true,
      priceOrigin: "texto_radar",
      couponPreserved: true,
      linksPreserved: Object.values(urls).length,
      dispatch: false,
      credits: false
    }));
  } finally {
    const enginePool = database.getEnginePool();
    if (enginePool) await enginePool.end();
    await pool.end();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
