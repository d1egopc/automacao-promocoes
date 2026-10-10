"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.join(__dirname, "..", ".local-test-tmp", `achados-capacidade-${process.pid}`);
process.env.DATA_DIR = dataDir;

const { Client, Pool } = require("pg");
const { criarRepositorioClonadorGrupos } = require("../modules/clonador-grupos/repository");
const { criarServicoClonadorGrupos } = require("../modules/clonador-grupos/service");
const { listarAchados, buscarAchado } = require("../modules/manual-v2/ofertas-v2-achados");
const { criarLista, adicionarItem } = require("../modules/manual-v2/ofertas-v2-listas");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_clone_commercial_${crypto.randomBytes(6).toString("hex")}`;
const source = { sessaoId: "session_a", grupoJid: "group_a@g.us", grupoNome: "Grupo A", ativo: true };

function amazonText(id, coupon = "") {
  return [`Fone Bluetooth Modelo ${id}`, "Por R$ 99,90",
    coupon ? `Cupom ${coupon}` : "", `https://www.amazon.com.br/dp/B0${String(id).padStart(8, "0")}`]
    .filter(Boolean).join("\n");
}

function shopeeText(id) {
  return [`Tenis Esportivo Modelo ${id}`, "Por R$ 89,90",
    `Produto: https://shopee.com.br/product/123/${1000 + Number(id)}`,
    `Resgate: https://s.shopee.com.br/9A${String(id).padStart(6, "0")}`].join("\n");
}

function shopeeCommercialMetadata(id) {
  const url = `https://s.shopee.com.br/9A${String(id).padStart(6, "0")}`;
  return { comercialCapturado: { linksComerciais: [{
    papel: "resgate", papelLink: "link_resgate", tipo: "resgate",
    renderizavel: true, conversaoStatus: "convertida",
    urlOriginal: url, urlAfiliadaWorkspace: url
  }] } };
}

function message(id, text, ageMinutes) {
  return {
    key: { id: String(id), remoteJid: source.grupoJid, fromMe: false },
    messageTimestamp: Math.floor((Date.now() - ageMinutes * 60000) / 1000),
    message: { conversation: text }
  };
}

async function configure(repo, workspace) {
  await repo.salvarConfig(workspace, { ativo: true });
  await repo.substituirFontes(workspace, [source]);
}

function service(repo) {
  return criarServicoClonadorGrupos({
    repository: repo,
    clienteTemRecurso: () => true,
    exigirCapturaFactualCandidata: true,
    solicitarProcessamentoBridge: () => {},
    logger: { log() {}, warn() {} }
  });
}

async function capture(svc, workspace, id, text, ageMinutes, marketplace = "", metadata = {}) {
  return svc.capturarMensagemWhatsapp({
    clienteId: workspace,
    sessaoId: source.sessaoId,
    grupoJid: source.grupoJid,
    grupoNome: source.grupoNome,
    mensagemId: String(id),
    marketplace,
    metadata,
    mensagem: message(id, text, ageMinutes)
  });
}

async function microBurst(pool, limit) {
  const repo = criarRepositorioClonadorGrupos({
    pool,
    queryEngine: async (sql, params = []) => {
      try { return { ok: true, resultado: await pool.query(sql, params) }; }
      catch (error) { return { ok: false, motivo: "fixture_query_failed", erro: error.message }; }
    },
    pushWaitLimitPerWorkspace: limit
  });
  await repo.prepararSchema();
  const workspace = `ws_h${limit}`;
  const start = process.hrtime.bigint();
  let enviadosAchados = 0;
  let maxWaiting = 0;
  for (let index = 0; index < limit + 4; index += 1) {
    const turbo = index % 3 === 0;
    const result = await repo.inserirBufferCaptura({
      clienteId: workspace,
      sessaoId: source.sessaoId,
      grupoJid: source.grupoJid,
      grupoNome: source.grupoNome,
      mensagemId: `h${limit}-${index}`,
      textoOriginal: amazonText(500 + limit * 20 + index, turbo ? "APP20" : ""),
      links: [`https://www.amazon.com.br/dp/B0${String(500 + limit * 20 + index).padStart(8, "0")}`],
      capturadoEm: new Date(Date.now() - Math.max(1, 9 - index) * 60000),
      metadata: {
        comercialCapturado: {
          marketplaceDetectado: "amazon",
          tituloCapturado: `Fone Bluetooth Modelo H${limit}-${index}`,
          precoAtual: 99.9,
          ...(turbo ? { cupom: "APP20" } : {})
        }
      }
    });
    enviadosAchados += result.itensParaAchados?.length || 0;
    const waiting = (await pool.query(`SELECT count(*)::int AS n FROM clonador_grupos_buffer
      WHERE cliente_id=$1 AND status='capturada'`, [workspace])).rows[0].n;
    maxWaiting = Math.max(maxWaiting, waiting);
  }
  const automaticos = (await pool.query(`SELECT count(*)::int AS n FROM clonador_grupos_buffer
    WHERE cliente_id=$1 AND status='capturada'`, [workspace])).rows[0].n;
  let drenados = 0;
  while (true) {
    const claimed = await repo.reivindicarProximaCaptura({ clienteId: workspace });
    if (!claimed) break;
    await repo.atualizarBufferStatus(claimed.id, "encaminhada", {}, "processando");
    drenados += 1;
  }
  const drainMs = Number(process.hrtime.bigint() - start) / 1e6;
  return { H: limit, automaticos, achados: enviadosAchados, maxHot: maxWaiting,
    maxWaiting, drenados, drainMs: Number(drainMs.toFixed(3)) };
}

async function run() {
  const admin = new Client(config);
  let pool;
  let installed = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host,inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`);
    installed = true;
    pool = new Pool({ ...config, max: 8, options: `-c search_path=${schema},public` });
    const repo = criarRepositorioClonadorGrupos({
      pool,
      queryEngine: async (sql, params = []) => {
        try { return { ok: true, resultado: await pool.query(sql, params) }; }
        catch (error) { return { ok: false, motivo: "fixture_query_failed", erro: error.message }; }
      },
      pushWaitLimitPerWorkspace: 4
    });
    await repo.prepararSchema();
    const svc = service(repo);
    const workspace = "ws_capacity_commercial";
    await configure(repo, workspace);

    for (const [id, age] of [[1, 9], [2, 8], [3, 7], [4, 6]]) {
      assert.equal((await capture(svc, workspace, id, amazonText(id), age, "amazon")).capturada, true);
    }
    const app20 = await capture(svc, workspace, 5, amazonText(5, "APP20"), 5, "amazon");
    assert.equal(app20.capturada, true);
    assert(app20.achados.some(item => item.ok === true));
    const shopee = await capture(svc, workspace, 6, shopeeText(6), 5, "shopee",
      shopeeCommercialMetadata(6));
    assert.equal(shopee.capturada, true);
    assert(shopee.achados.some(item => item.ok === true));
    const oldNormal = await capture(svc, workspace, 7, amazonText(7), 20, "amazon");
    assert.equal(oldNormal.capturada, false);
    assert.equal(oldNormal.motivo, "CAPACITY_NEW_ITEM_TO_ACHADOS");
    assert(oldNormal.achados.some(item => item.ok === true));
    const newNormal = await capture(svc, workspace, 8, amazonText(8), 1, "amazon");
    assert.equal(newNormal.capturada, true);
    assert(newNormal.achados.some(item => item.ok === true));

    const rows = (await pool.query(`SELECT mensagem_id,status,texto_original,links,metadata
      FROM clonador_grupos_buffer WHERE cliente_id=$1 ORDER BY id`, [workspace])).rows;
    const hot = rows.filter(row => row.status === "capturada");
    assert.equal(hot.length, 4);
    assert.deepEqual(hot.filter(row => row.metadata.classificacaoTurboComercial?.turbo)
      .map(row => row.mensagem_id).sort(), ["5", "6"]);
    assert(hot.some(row => row.mensagem_id === "5" &&
      row.metadata.classificacaoTurboComercial.ancora === "codigo_alfanumerico_valido"));
    assert(hot.some(row => row.mensagem_id === "6" &&
      row.metadata.classificacaoTurboComercial.ancora === "resgate_shopee_valido"));
    const coldCapacity = rows.filter(row => row.metadata.capacityDisposition?.code);
    assert(coldCapacity.length >= 4);
    assert(coldCapacity.every(row => row.texto_original.length > 0 && row.links.length > 0));
    assert(coldCapacity.every(row => row.status === "ignorada"));
    assert(!hot.some(row => ["1", "2", "3", "7"].includes(row.mensagem_id)));
    const achados = listarAchados(workspace);
    assert(achados.length >= 4);
    assert(achados.some(item => item.motivoCapacidade === "CAPACITY_DISPLACED_TO_ACHADOS"));
    assert(achados.some(item => item.motivoCapacidade === "CAPACITY_NEW_ITEM_TO_ACHADOS"));
    assert(buscarAchado(workspace, achados[0].id));
    const listaManual = criarLista(workspace, "Capacidade Clonador");
    const achadoAmazon = achados.find(item => item.marketplace === "amazon");
    const listaComAchado = await adicionarItem(workspace, listaManual.id,
      { origem: "achados", ofertaId: achadoAmazon.id });
    assert.equal(listaComAchado.itens.length, 1);
    const achadosAntesInvalida = listarAchados(workspace).length;
    const invalida = await capture(svc, workspace, 9,
      "Mensagem sem produto\nhttps://example.invalid/sem-produto", 20, "");
    assert.equal(invalida.capturada, false);
    assert(invalida.achados.some(item => item.ok === false && item.motivo === "INVALID_TECHNICAL"));
    assert.equal(listarAchados(workspace).length, achadosAntesInvalida);
    const invalidaPersistida = (await pool.query(`SELECT status,metadata
      FROM clonador_grupos_buffer WHERE cliente_id=$1 AND mensagem_id='9'`, [workspace])).rows[0];
    assert.equal(invalidaPersistida.status, "ignorada");
    assert.equal(invalidaPersistida.metadata.admissionDisposition.code, "INVALID_TECHNICAL");

    const temporal = "ws_capacity_temporal";
    await configure(repo, temporal);
    const app5 = await capture(svc, temporal, 101, amazonText(101, "APP20"), 5, "amazon");
    const app11 = await capture(svc, temporal, 102, amazonText(102, "APP20"), 11, "amazon");
    const shop5 = await capture(svc, temporal, 103, shopeeText(103), 5, "shopee",
      shopeeCommercialMetadata(103));
    const shop15 = await capture(svc, temporal, 104, shopeeText(104), 15, "shopee",
      shopeeCommercialMetadata(104));
    const normal20 = await capture(svc, temporal, 105, amazonText(105), 20, "amazon");
    const normal31 = await capture(svc, temporal, 106, amazonText(106), 31, "amazon");
    assert.equal(app5.capturada, true);
    assert.equal(app11.motivo, "EXPIRED_BEFORE_ADMISSION");
    assert.equal(shop5.capturada, true);
    assert.equal(shop15.motivo, "EXPIRED_BEFORE_ADMISSION");
    assert.equal(normal20.capturada, true);
    assert.equal(normal31.motivo, "EXPIRED_BEFORE_ADMISSION");
    const temporalRows = (await pool.query(`SELECT mensagem_id,status,metadata
      FROM clonador_grupos_buffer WHERE cliente_id=$1 ORDER BY id`, [temporal])).rows;
    assert.equal(temporalRows.filter(row => row.status === "capturada").length, 3);
    assert(temporalRows.filter(row => row.metadata.admissionDisposition?.code ===
      "EXPIRED_BEFORE_ADMISSION").every(row => row.status === "ignorada"));

    const h4 = await microBurst(pool, 4);
    const h6 = await microBurst(pool, 6);
    const h8 = await microBurst(pool, 8);
    for (const metric of [h4, h6, h8]) {
      assert.equal(metric.automaticos, metric.H);
      assert.equal(metric.maxHot, metric.H);
      assert.equal(metric.maxWaiting, metric.H);
      assert.equal(metric.drenados, metric.H);
      assert.equal(metric.achados, 4);
    }

    console.log(JSON.stringify({
      candidate: "clonador_commercial_capacity",
      preAdmissionTurbo: true,
      alphanumericTurbo: true,
      shopeeRescueTurbo: true,
      expiredBeforeAdmissionBlocked: true,
      capacityCommercialPriority: true,
      expiredDoesNotOccupyWait: true,
      capacityValidOfferPreservedInAchados: true,
      capacityValidOfferRemovedFromHot: true,
      capacityValidOfferAvailableToManualList: true,
      commercialPayloadPreserved: true,
      invalidTechnicalSeparatedFromAchados: true,
      secondAutomaticQueueCreated: false,
      hotMessages: hot.map(row => row.mensagem_id),
      achadosCount: achados.length,
      H4: h4, H6: h6, H8: h8
    }));
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
