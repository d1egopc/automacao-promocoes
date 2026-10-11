"use strict";

// The production incident was the ordinary (non opt-in wait) buffer INSERT.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");
const root = path.join(__dirname, "..");
const schema = `uf_clone_unicode_${crypto.randomBytes(6).toString("hex")}`;
process.env.DATA_DIR = path.join(root, ".local-test-tmp", schema);
const { montarComercialCapturado } =
  require("../modules/clonador-grupos/commercial-capture.candidate");
const { prepararModoOperacionalReal } =
  require("../modules/engine/universal-runtime-bootstrap");
const { instalarEstadoIngressReal } =
  require("../modules/engine/universal-ingress-fence");
const { runSteadyLifecycle, projectionDdl } =
  require("../modules/engine/lifecycle-steady.candidate");

const port = Number(process.env.UF_TEST_PG_PORT || 55433);
const config = { host: "127.0.0.1", port, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const workspaceId = "ws_clone_unicode";
const bad = String.fromCharCode(0xDC00);
const url = "https://www.amazon.com.br/dp/B000000001";
const raw = `Notebook Gamer ${bad} R$ 1999 \ud83d\ude80\n${url}`;

async function main() {
  const admin = new Client(config);
  let pool, enginePool, created = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() db,
      host(inet_server_addr()) host,inet_server_port() port,
      current_setting('data_directory') data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root, ".local-postgres", "data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await admin.query(`SET search_path TO ${schema},public`);
    for (const file of ["schema.sql", "admission-gate.candidate.sql"]) {
      await admin.query(fs.readFileSync(path.join(root, "modules", "engine", file), "utf8"));
    }
    await admin.query(projectionDdl());
    await admin.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_last_success,lifecycle_max_staleness)
      VALUES (1,16,0,'UNKNOWN',NULL,interval '5 minutes')`);
    assert.equal((await prepararModoOperacionalReal({ pool: admin })).mode, "LEGACY");
    await admin.query(`UPDATE engine_operation_state SET mode='CUTOVER_PREPARED' WHERE id=1`);
    instalarEstadoIngressReal({ mode: "CUTOVER_PREPARED" });
    assert.equal((await prepararModoOperacionalReal({ pool: admin })).mode,
      "CUTOVER_PREPARED");

    process.env.PGSSLMODE = "disable";
    process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${port}/optimus_universal_fixture?options=${encodeURIComponent(`-c search_path=${schema},public`)}`;
    fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
    require("../utils/storage").writeGlobalJson("usuarios.json", [
      { id: workspaceId, ativo: true, plano: "pro" }
    ]);
    const workspace = require("../modules/workspace");
    workspace.avaliarWorkspaceParaEngine = id => ({ elegivelEngine: id === workspaceId });
    require("../modules/imagens/cache-canonico-evento").resolverImagemCanonicaEvento =
      async () => ({ imagemStatus: "nao_resolvida", imagemEnviavel: false });
    const { getEnginePool } = require("../modules/engine/database");
    const { criarRepositorioClonadorGrupos } =
      require("../modules/clonador-grupos/repository");
    const { criarServicoClonadorGrupos } =
      require("../modules/clonador-grupos/service");
    const { criarBridgeClonadorGrupos } =
      require("../modules/clonador-grupos/bridge");
    const { registrarEventoBruto } = require("../modules/engine/inbox.service");
    enginePool = getEnginePool();
    pool = new Pool({ ...config, max: 4, options: `-c search_path=${schema},public` });
    assert.equal((await runSteadyLifecycle({ pool, limit: 4 })).ok, true);
    await admin.query(`UPDATE engine_hot_admission_control
      SET health='HEALTHY',lifecycle_last_success=NOW() WHERE id=1`);
    const repo = criarRepositorioClonadorGrupos({ pool,
      queryEngine: async (sql, params = []) => {
        try { return { ok: true, resultado: await pool.query(sql, params) }; }
        catch (error) { return { ok: false, motivo: error.code || "fixture_query_failed",
          erro: error.message, erroDetalhe: error.detail }; }
      } });
    await repo.prepararSchema();
    await repo.salvarConfig(workspaceId, { ativo: true });
    await repo.substituirFontes(workspaceId, [{ sessaoId: "s1",
      grupoJid: "g1@g.us", grupoNome: "Grupo", ativo: true }]);
    const service = criarServicoClonadorGrupos({ repository: repo,
      clienteTemRecurso: () => true, exigirCapturaFactualCandidata: true,
      logger: { log() {} } });
    const input = { clienteId: workspaceId, sessaoId: "s1",
      metadata: { aninhado: { [bad]: `Caf\u00e9 ${bad}` } },
      mensagem: { key: { remoteJid: "g1@g.us", id: "m1", fromMe: false },
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: raw } } };

    const commercial = montarComercialCapturado({ textoOriginal: raw,
      links: [url], marketplaceDetectado: "amazon" });
    assert(JSON.stringify(commercial).includes("\\udc00"));
    await assert.rejects(admin.query(`INSERT INTO clonador_grupos_buffer (
      cliente_id,sessao_id,grupo_jid,grupo_nome,mensagem_id,
      texto_original,links,capturado_em,status,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,
        COALESCE($8::timestamptz,NOW()),$9,$10::jsonb)`, [
      workspaceId, "s1", "g1@g.us", "Grupo", "raw_probe", raw,
      JSON.stringify([url]), new Date(), "capturada",
      JSON.stringify({ comercialCapturado: commercial })
    ]), error => error.code === "22P02" &&
      /surrogate/i.test(error.detail || ""));
    await admin.query("SELECT $1::jsonb", [JSON.stringify([url])]);

    assert.equal((await service.capturarMensagemWhatsapp(input)).capturada, true);
    assert.equal((await service.capturarMensagemWhatsapp(input)).capturada, false);
    const stored = (await admin.query(`SELECT id,links,metadata,capturado_em
      FROM clonador_grupos_buffer WHERE mensagem_id='m1'`)).rows;
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0].links, [url]);
    assert.equal(stored[0].metadata.aninhado["\uFFFD"], "Caf\u00e9 \uFFFD");
    assert.match(stored[0].metadata.comercialCapturado.tituloCapturado,
      /Notebook Gamer \uFFFD R\$ 1999 \ud83d\ude80/);
    const linkWithBadUnit = `${url}/${bad}`;
    assert.equal((await repo.inserirBufferCaptura({ clienteId: workspaceId,
      sessaoId: "s1", grupoJid: "g1@g.us", grupoNome: "Grupo",
      mensagemId: "m2", textoOriginal: "link probe", links: [linkWithBadUnit],
      status: "ignorada", metadata: { nested: [{ [bad]: bad }] }
    })).inserido, true);
    const linkProbe = (await admin.query(`SELECT links,metadata FROM
      clonador_grupos_buffer WHERE mensagem_id='m2'`)).rows[0];
    assert.deepEqual(linkProbe.links, [`${url}/\uFFFD`]);
    assert.equal(linkProbe.metadata.nested[0]["\uFFFD"], "\uFFFD");

    const bridge = criarBridgeClonadorGrupos({ repository: repo,
      registrarEventoBruto,
      resolverRedirectUniversal: async link => ({ ok: true,
        urlOriginal: link, urlFinal: link, urlExpandida: link,
        marketplaceDetectado: "amazon", status: "resolvido" }),
      logger: { log() {} } });
    const processed = await bridge.processarCapturasPendentes({ limite: 1 });
    assert.equal(processed.prontas, 1, JSON.stringify(processed));
    const facts = (await admin.query(`SELECT e.id evento_id,e.capturado_em,
      e.metadata,j.id job_id FROM engine_eventos_brutos e
      JOIN engine_jobs_cliente j ON j.evento_id=e.id
      WHERE e.hash_evento=$1`, [`clonador_grupos:${stored[0].id}`])).rows;
    assert.equal(facts.length, 1);
    assert.equal(facts[0].metadata.comercialCapturado.tituloCapturado.includes("\uFFFD"), true);
    assert.equal(facts[0].capturado_em.getTime(), stored[0].capturado_em.getTime());
    assert.equal((await service.capturarMensagemWhatsapp(input)).capturada, false);
    assert.equal((await admin.query(`SELECT count(*)::int n
      FROM engine_universal_queue_items`)).rows[0].n, 0);
    console.log(JSON.stringify({ test: "clonador_prepared_unicode", buffer: 1,
      event: 1, job: 1, queue: 0, rawMetadataFails22P02: true,
      validUnicodePreserved: true, duplicatePrevented: true }));
  } finally {
    if (enginePool) await enginePool.end().catch(() => {});
    if (pool) await pool.end().catch(() => {});
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
