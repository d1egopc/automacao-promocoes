"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const { test } = require("node:test");
const { Client, Pool } = require("pg");
const { normalizarOfertaImportada } = require("../modules/engine/importer/importer.service");
const { montarOfertaUniversalEngine } = require("../modules/engine/oferta-universal.contract");
const { prepararModoOperacionalReal } = require("../modules/engine/universal-runtime-bootstrap");
const { enqueue } = require("../modules/engine/universal-queue.repository");
const { analisarDestinoOferta } = require("../utils/destinos");

test("KaBuM: oferta ancorada entra uma vez na fila PG17, no destino e workspace certos", async () => {
  const dir = process.env.KABUM_PG_FIXTURE_DIR;
  assert.ok(dir, "KABUM_PG_FIXTURE_DIR must identify the disposable cluster");
  const config = { host: "127.0.0.1", port: 55433, user: "postgres",
    database: "optimus_kabum_ci_fixture", connectionTimeoutMillis: 5000 };
  const schema = "kabum_ci_" + randomUUID().replaceAll("-", "");
  const admin = new Client(config);
  let pool;
  let created = false;
  try {
    await admin.connect();
    const { rows: [db] } = await admin.query(`SELECT current_database() db,
      current_setting('server_version_num')::int version, current_setting('data_directory') dir`);
    assert.equal(db.db, config.database);
    assert.equal(Math.floor(db.version / 10000), 17);
    assert.equal(db.dir.replaceAll("\\", "/"), dir.replaceAll("\\", "/"));
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await admin.query(`SET search_path TO ${schema},public`);
    await admin.query(fs.readFileSync(require.resolve("../modules/engine/schema.sql"), "utf8"));
    await prepararModoOperacionalReal({ pool: admin });
    await admin.query("UPDATE engine_operation_state SET mode='CUTOVER_PREPARED' WHERE id=1");
    await admin.query(`UPDATE engine_operation_state SET mode='UNIVERSAL',
      operation_epoch_started_at=clock_timestamp()-interval '1 minute' WHERE id=1`);
    pool = new Pool({ ...config, options: "-c search_path=" + schema, max: 3 });

    const workspaceId = "workspace_kabum_a";
    const titulo = "Barraca Camping Nautika 4 Pessoas";
    const url = "https://www.kabum.com.br/produto/123456/barraca";
    const original = "https://www.awin1.com/cread.php?awinaffid=11&ued=" + encodeURIComponent(url);
    const afiliado = original.replace("awinaffid=11&", "awinaffid=22&");
    const { rows: [evento] } = await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,marketplace_detectado) VALUES ('radar','radar','kabum') RETURNING id`);
    const { rows: [link] } = await admin.query(`INSERT INTO engine_links
      (evento_id,url_original,url_expandida) VALUES ($1,$2,$3) RETURNING id,url_original`, [evento.id, original, url]);
    const metadata = { adapter: "awin_kabum", produto: { titulo, produtoId: "123456", categoriaOrigem: "padrao_importador_kabum" },
      linksComerciais: [{ id: link.id, urlOriginal: original, urlAfiliadaWorkspace: afiliado }] };
    const oferta = normalizarOfertaImportada({ marketplace: "kabum", titulo, categoria: "Gamer e Hardware",
      linkOriginal: original, linkExpandido: url, linkAfiliado: afiliado,
      imagem: "https://images.kabum.com.br/produtos/fotos/123456/oficial.jpg",
      preco: 89.9, precoOriginal: 109.9, cupom: "FIXTURE", metadata });
    const { rows: [saved] } = await admin.query(`INSERT INTO engine_ofertas
      (evento_id,link_id,marketplace,titulo,categoria) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [evento.id, link.id, oferta.marketplace, oferta.titulo, oferta.categoria]);
    const { rows: [job] } = await admin.query(`INSERT INTO engine_jobs_cliente
      (evento_id,oferta_id,cliente_id) VALUES ($1,$2,$3) RETURNING id,evento_id,cliente_id,oferta_id`,
    [evento.id, saved.id, workspaceId]);
    const universal = montarOfertaUniversalEngine({ oferta, job, evento, link, metadata });
    const destinos = [
      { id: "pesca", categorias: ["Pesca e Camping"] },
      { id: "hardware", categorias: ["Gamer e Hardware"] }
    ];
    const destinations = destinos.filter(destino => analisarDestinoOferta({
      ...destino, ativo: true, marketplaces: ["AWIN / KaBuM"]
    }, oferta).aceita).map(destino => ({ destinationId: destino.id, targetKey: "grupo:fixture", channel: "whatsapp" }));
    assert.deepEqual(destinations.map(d => d.destinationId), ["pesca"]);
    const input = { pool, workspaceId, jobId: job.id, ofertaId: saved.id, destinations,
      itemPayload: { ...universal, linksComerciais: metadata.linksComerciais } };
    await assert.rejects(enqueue({ ...input, workspaceId: "workspace_kabum_b" }), /queue_offer_workspace_identity_unproven/);
    const outcomes = await Promise.all([enqueue(input), enqueue(input)]);
    assert.equal(outcomes.filter(r => r.created).length, 1);
    assert.equal(outcomes[0].itemId, outcomes[1].itemId);
    const { rows } = await pool.query(`SELECT q.workspace_id,q.item_payload,d.destination_id,d.status
      FROM engine_universal_queue_items q JOIN engine_universal_queue_destinations d ON d.queue_item_id=q.id`);
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.workspace_id, workspaceId);
    assert.equal(row.destination_id, "pesca");
    assert.equal(row.status, "pending");
    assert.equal(row.item_payload.produto.idExterno, "123456");
    assert.equal(row.item_payload.produto.categoriaNormalizada, "Pesca e Camping");
    assert.equal(row.item_payload.produto.urlOriginal, original);
    assert.equal(row.item_payload.afiliacao.urlAfiliada, afiliado);
    assert.deepEqual(row.item_payload.linksComerciais, metadata.linksComerciais);
    assert.equal(row.item_payload.comercial.precoAtual, 89.9);
    assert.equal(row.item_payload.comercial.precoAnterior, 109.9);
    assert.equal(row.item_payload.comercial.cupom, "FIXTURE");
  } finally {
    try {
      if (pool) await pool.end();
      if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  }
});
