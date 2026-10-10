"use strict";

// Real index.js process against the disposable PostgreSQL 17 lab only.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { Client, Pool } = require("pg");
const jwt = require("jsonwebtoken");
const queue = require("../modules/engine/universal-queue.repository");
const { prepararModoOperacionalReal } =
  require("../modules/engine/universal-runtime-bootstrap");
const { SQL_SCHEMA_FINANCEIRO_V1 } =
  require("../modules/financeiro/financeiro.schema");
const { openBalance } =
  require("../modules/engine/universal-credits.repository");
const { projectionDdl } =
  require("../modules/engine/lifecycle-steady.candidate");

const root = path.join(__dirname, "..");
const schema = `uf_runtime_${crypto.randomBytes(6).toString("hex")}`;
const dataDir = path.join(root, ".local-test-tmp", schema);
const port = Number(process.env.UF_TEST_HTTP_PORT || 33084);
const pgPort = Number(process.env.UF_TEST_PG_PORT || 55433);
const config = { host: "127.0.0.1", port: pgPort, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const databaseUrl = `postgres://postgres@127.0.0.1:${pgPort}/optimus_universal_fixture?options=${encodeURIComponent(`-c search_path=${schema},public`)}`;

function fixtureFiles() {
  fs.mkdirSync(path.join(dataDir, "clientes", "admin"), { recursive: true });
  const write = (name, value) => fs.writeFileSync(path.join(dataDir, name),
    JSON.stringify(value), "utf8");
  write("usuarios.json", [
    { id: "admin", papel: "admin_master", ativo: true, plano: "master",
      creditos: 100 },
    { id: "ws_alpha", ativo: true, plano: "pro", creditos: 100 },
    { id: "ws_beta", ativo: true, plano: "pro", creditos: 100 }
  ]);
  write("planos.json", { pro: { id: "pro", ativo: true,
    recursos: { engine: true, clonador_grupos: true },
    marketplaces: ["amazon"] },
    pago: { id: "pago", nome: "Pago", ativo: true,
      creditosModelo: "ciclo", renovacaoCreditos: "pagamento",
      limites: { creditosPorCiclo: 6, cicloDias: 30 },
      recursos: { engine: true }, marketplaces: ["amazon"] } });
  write("configs_clientes.json", {
    ws_alpha: { automacaoAtiva: false,
      marketplaces: { amazon: { ativo: true } } },
    ws_beta: { automacaoAtiva: false,
      marketplaces: { amazon: { ativo: true } } }
  });
  write("destinos_clientes.json", { ws_alpha: [{
    id: "uf_dest_inactive_session", nome: "Universal fixture",
    ativo: true, tipo: "whatsapp", conexaoId: "uf_no_live_session",
    gruposWhatsapp: ["uf_group_a", "uf_group_b"], marketplaces: ["amazon"],
    categorias: ["Eletronicos"], intervaloMinutos: 2.5
  }] });
  write("integracoes.json", { ws_alpha: { amazon: { ativo: true,
    credenciais: { tag: "fixture-tag" } } },
    ws_beta: { amazon: { ativo: true,
      credenciais: { tag: "fixture-tag" } } } });
  write("config.json", { pausarMadrugada: false, automacaoAtiva: false });
  write(path.join("clientes", "admin", "radar-config.json"), {
    monitoramentoAtivo: true, telegramMonitorados: [
      { id: "-100123", chatId: "-100123", ativo: true }
    ], monitoramento: { horaInicial: "00:00", horaFinal: "23:59",
      intervaloMinutos: 1, maxPorDia: 0 }
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise(resolve =>
    setTimeout(resolve, 3000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function probe(child, type) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      child.off("message", receive);
      reject(new Error("universal_probe_timeout"));
    }, 3000);
    const receive = message => {
      if (message?.type !== "uf-probe" || message.requestId !== requestId)
        return;
      clearTimeout(timer);
      child.off("message", receive);
      resolve(message);
    };
    child.on("message", receive);
    child.send({ type, requestId });
  });
}

function teleradarAccept(child, envelope) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      child.off("message", receive);
      reject(new Error("teleradar_fixture_timeout"));
    }, 5000);
    const receive = message => {
      if (message?.type !== "uf-fixture" || message.requestId !== requestId)
        return;
      clearTimeout(timer);
      child.off("message", receive);
      if (message.error) reject(new Error(message.error));
      else resolve(message.result);
    };
    child.on("message", receive);
    child.send({ type: "uf-teleradar-accept", requestId, envelope });
  });
}

function cloneSeed(child, capture) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      child.off("message", receive);
      reject(new Error("clone_fixture_timeout"));
    }, 5000);
    const receive = message => {
      if (message?.type !== "uf-fixture" || message.requestId !== requestId)
        return;
      clearTimeout(timer);
      child.off("message", receive);
      if (message.error) reject(new Error(message.error));
      else resolve(message.result);
    };
    child.on("message", receive);
    child.send({ type: "uf-clone-seed", requestId, capture });
  });
}

async function run() {
  const admin = new Client(config);
  let pool, child, created = false;
  const logs = [];
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() db,
      host(inet_server_addr()) host,inet_server_port() port,
      current_setting('data_directory') data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(root, ".local-postgres", "data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await admin.query(`SET search_path TO ${schema},public`);
    await admin.query(fs.readFileSync(path.join(root, "modules", "engine",
      "schema.sql"), "utf8"));
    for (const statement of SQL_SCHEMA_FINANCEIRO_V1) await admin.query(statement);
    const providerCheckpointSchema = (await admin.query(`SELECT 1 FROM
      information_schema.columns WHERE table_schema=$1
      AND table_name='fila_checkpoints_entrega'
      AND column_name='confirmado_em'`, [schema])).rowCount;
    assert.equal(providerCheckpointSchema, 1);
    for (const name of ["admission-gate.candidate.sql",
      "radar-replay.candidate.sql"]) {
      await admin.query(fs.readFileSync(path.join(root, "modules", "engine",
        name), "utf8"));
    }
    await admin.query(projectionDdl());
    await admin.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_last_success,
       lifecycle_max_staleness)
      VALUES (1,10,0,'HEALTHY',now(),interval '5 minutes')`);
    await prepararModoOperacionalReal({ pool: admin });
    const epoch = new Date(Date.now() - 5 * 60000).toISOString();
    await admin.query(`UPDATE engine_operation_state
      SET mode='CUTOVER_PREPARED' WHERE id=1`);
    pool = new Pool({ ...config, options: `-c search_path=${schema},public` });
    await openBalance({ pool, workspaceId: "ws_alpha",
      operationEpochStartedAt: epoch, openingBalance: 7,
      sourceHash: crypto.createHash("sha256").update("ws_alpha:7")
        .digest("hex") });
    await admin.query(`UPDATE engine_operation_state
      SET mode='UNIVERSAL',operation_epoch_started_at=$1 WHERE id=1`, [epoch]);
    const eventId = (await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,capturado_em,metadata) VALUES
      ('radar','radar',now(),'{}'::jsonb) RETURNING id`)).rows[0].id;
    const offerId = (await admin.query(`INSERT INTO engine_ofertas
      (evento_id,origem,status) VALUES ($1,'radar','oferta_criada')
      RETURNING id`, [eventId])).rows[0].id;
    const jobId = (await admin.query(`INSERT INTO engine_jobs_cliente
      (evento_id,oferta_id,cliente_id,status,metadata)
      VALUES ($1,$2,'ws_alpha','oferta_criada','{}'::jsonb) RETURNING id`,
    [eventId, offerId])).rows[0].id;
    const queued = await queue.enqueue({ pool, workspaceId: "ws_alpha",
      jobId, ofertaId: offerId,
      itemPayload: { clienteId: "ws_alpha", engineOfertaId: offerId,
        engineJobId: jobId, titulo: "post-epoch fixture" },
      destinations: [] });
    fixtureFiles();
    const startRuntime = async () => {
      let online = false;
      const current = spawn(process.execPath, ["--require", path.join(__dirname,
      "helpers", "universal-viva-read-probe.js"), "index.js"], {
      cwd: root, windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
        TEMP: path.join(root, ".local-test-tmp"),
        TMP: path.join(root, ".local-test-tmp"),
        NODE_PATH: process.env.NODE_PATH || "", NODE_ENV: "test",
        PGSSLMODE: "disable", DATA_DIR: dataDir, DATABASE_URL: databaseUrl,
        PORT: String(port), JWT_SECRET: "uf_runtime_epoch_fixture",
        UF_FIXTURE_AMAZON: "1",
        CAMPANHAS_AGENDAMENTOS_SCHEDULER: "false",
        PERF_DIAGNOSTICO: "0" },
      stdio: ["ignore", "pipe", "pipe", "ipc"]
      });
      child = current;
      for (const stream of [current.stdout, current.stderr]) stream.on("data", chunk => {
      const lines = String(chunk).split(/\r?\n/).filter(Boolean);
      if (lines.some(line => line.includes("API ONLINE NA PORTA"))) online = true;
      logs.push(...lines);
      if (logs.length > 100) logs.splice(0, logs.length - 100);
      });
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && current.exitCode === null && !online) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(online,
        `runtime_not_ready ${JSON.stringify(logs.slice(-15))}`);
      return current;
    };
    child = await startRuntime();
    await probe(child, "uf-probe-reset");
    const token = jwt.sign({ clienteId: "ws_alpha" },
      "uf_runtime_epoch_fixture");
    const headers = { authorization: `Bearer ${token}` };
    const meResponse = await fetch(`http://127.0.0.1:${port}/me`, { headers });
    const me = await meResponse.json();
    assert.equal(meResponse.status, 200, JSON.stringify(me));
    assert.equal(me.usuario.creditos, 7);
    const subscriptionResponse = await fetch(
      `http://127.0.0.1:${port}/financeiro/assinatura`, { headers });
    const subscription = await subscriptionResponse.json();
    assert.equal(subscriptionResponse.status, 200, JSON.stringify(subscription));
    assert.equal(subscription.creditos, 7);
    const listResponse = await fetch(`http://127.0.0.1:${port}/fila?visao=nao_elegiveis`,
      { headers });
    const list = await listResponse.json();
    assert.equal(listResponse.status, 200, JSON.stringify(list));
    assert.equal(list.itens.length, 1);
    assert.equal(String(list.itens[0].queueItemId), String(queued.itemId));
    const detailRef = encodeURIComponent(JSON.stringify({
      arquivo: "universal_queue", id: String(queued.itemId) }));
    const detailResponse = await fetch(`http://127.0.0.1:${port}/fila/detalhe?detalheRef=${detailRef}`,
      { headers });
    const detail = await detailResponse.json();
    assert.equal(detailResponse.status, 200, JSON.stringify(detail));
    const legacyWrite = await fetch(`http://127.0.0.1:${port}/fila`, {
      method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ titulo: "must not reach VIVA" })
    });
    assert.equal(legacyWrite.status, 409);
    const adminToken = jwt.sign({ clienteId: "admin" },
      "uf_runtime_epoch_fixture");
    const adminHeaders = { authorization: `Bearer ${adminToken}`,
      "content-type": "application/json" };
    const signupResponse = await fetch(
      `http://127.0.0.1:${port}/admin/cadastro-interno`, {
        method: "POST", headers: adminHeaders,
        body: JSON.stringify({ nome: "Epoch Signup", email: "epoch@example.com",
          senha: "12345678", plano: "Pago" })
      });
    const signup = await signupResponse.json();
    assert.equal(signupResponse.status, 201, JSON.stringify(signup));
    const signupId = signup.usuario.id;
    assert.equal(signup.usuario.creditos, 0);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM
      engine_universal_credit_opening_intents WHERE workspace_id=$1
      AND state='completed'`, [signupId])).rows[0].n, 1);
    const paymentResponse = await fetch(
      `http://127.0.0.1:${port}/admin/assinaturas/${signupId}/pagamento-simulado`, {
        method: "POST", headers: adminHeaders,
        body: JSON.stringify({ estado: "aprovado", pagamentoId: "epoch_pay_1",
          plano: "Pago" })
      });
    const payment = await paymentResponse.json();
    assert.equal(paymentResponse.status, 200, JSON.stringify(payment));
    assert.equal(payment.usuario.creditos, 6);
    const duplicatePayment = await fetch(
      `http://127.0.0.1:${port}/admin/assinaturas/${signupId}/pagamento-simulado`, {
        method: "POST", headers: adminHeaders,
        body: JSON.stringify({ estado: "aprovado", pagamentoId: "epoch_pay_1",
          plano: "Pago" })
      });
    assert.equal(duplicatePayment.status, 200,
      JSON.stringify(await duplicatePayment.json()));
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM
      financial_credit_ledger WHERE cliente_id=$1 AND
      universal_movement_type='FINANCIAL_MOVEMENT'`, [signupId])).rows[0].n, 1);
    assert.equal((await pool.query(`SELECT balance FROM
      engine_universal_credit_balances WHERE workspace_id=$1`,
    [signupId])).rows[0].balance, 6);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(dataDir,
      "usuarios.json"), "utf8")).find(user => user.id === signupId),
    "creditos"), false);
    const capturedAt = Math.floor(Date.now() / 1000) - 60;
    const ingress = await fetch(`http://127.0.0.1:${port}/radar/telegram/inbound`, {
      method: "POST", headers: { authorization: `Bearer ${adminToken}`,
        "content-type": "application/json" },
      body: JSON.stringify({ message: { chat: { id: "-100123",
        title: "Fixture" }, date: capturedAt,
        text: "Oferta https://www.amazon.com.br/dp/B012345678" } })
    });
    const ingressBody = await ingress.json();
    assert.equal(ingress.status, 200, JSON.stringify(ingressBody));
    let radarFact;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      radarFact = (await admin.query(`SELECT e.id,e.capturado_em,
        (SELECT count(*)::int FROM engine_jobs_cliente j
         WHERE j.evento_id=e.id) jobs
        FROM engine_eventos_brutos e WHERE e.origem='radar'
        ORDER BY e.id DESC LIMIT 1`)).rows[0];
      if (radarFact?.jobs > 0) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(radarFact?.jobs > 0,
      `radar_postepoch_job_missing ${JSON.stringify(ingressBody)} ${JSON.stringify(logs.slice(-12))}`);
    assert.equal(radarFact.capturado_em.toISOString(),
      new Date(capturedAt * 1000).toISOString());
    const teleT0 = new Date(Date.now() - 90_000).toISOString();
    const teleUrl = "https://www.amazon.com.br/dp/B012345679";
    const teleEnvelope = { origem: "radar", origemFluxo: "optimus",
      origemTipo: "telegram", fonte: "teleradar", fonteCaptura: "teleradar",
      eventId: crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex"),
      accountId: "123", chatId: "-100123", messageId: "456",
      senderId: "789", capturedAt: teleT0, text: `Oferta ${teleUrl}`,
      textSource: "text", hasMedia: false, mediaType: null,
      entities: [{ type: "url", url: teleUrl }] };
    const teleResult = await teleradarAccept(child, teleEnvelope);
    assert.equal(teleResult?.accepted, true, JSON.stringify(teleResult));
    const teleFact = (await admin.query(`SELECT e.id,e.capturado_em,
      (SELECT count(*)::int FROM engine_jobs_cliente j
       WHERE j.evento_id=e.id) jobs
      FROM engine_eventos_brutos e WHERE e.hash_evento=$1`,
    [teleEnvelope.eventId])).rows[0];
    assert.equal(teleFact?.jobs > 0, true, JSON.stringify(teleFact));
    assert.equal(teleFact.capturado_em.toISOString(), teleT0);
    const telePreEpoch = { ...teleEnvelope,
      eventId: crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex"),
      capturedAt: new Date(new Date(epoch).getTime() - 60_000).toISOString() };
    const telePreResult = await teleradarAccept(child, telePreEpoch);
    assert.equal(telePreResult?.accepted, false, JSON.stringify(telePreResult));
    assert.equal((await admin.query(`SELECT count(*)::int AS n
      FROM engine_eventos_brutos WHERE hash_evento=$1`,
    [telePreEpoch.eventId])).rows[0].n, 0);
    const cloneCapture = { clienteId: "ws_alpha",
      sessaoId: "clone_session", grupoJid: "clone_group@g.us",
      grupoNome: "Clone fixture", mensagemId: crypto.randomUUID(),
      textoOriginal: "Produto https://www.amazon.com.br/dp/B012345680",
      links: ["https://www.amazon.com.br/dp/B012345680"],
      capturadoEm: new Date().toISOString() };
    const cloneSeeded = await cloneSeed(child, cloneCapture);
    assert(cloneSeeded.bufferId, JSON.stringify(cloneSeeded));
    let cloneFact;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      cloneFact = (await admin.query(`SELECT b.status,e.id AS evento_id,
        (SELECT count(*)::int FROM engine_jobs_cliente j
         WHERE j.evento_id=e.id AND j.cliente_id='ws_alpha') jobs
        FROM clonador_grupos_buffer b
        LEFT JOIN engine_eventos_brutos e
          ON e.hash_evento='clonador_grupos:' || b.id::text
        WHERE b.id=$1`, [cloneSeeded.bufferId])).rows[0];
      if (cloneFact?.status === "pronta") break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(cloneFact?.status, "pronta",
      `clone_runtime_not_ready ${JSON.stringify(cloneFact)} ${JSON.stringify(logs.filter(line =>
        line.includes("CLONADOR-BRIDGE") || line.includes("CLONADOR-GRUPOS-ENTRADA")).slice(-8))}`);
    assert.equal(cloneFact.jobs, 1);
    const cloneOld = await cloneSeed(child, { ...cloneCapture,
      mensagemId: crypto.randomUUID(),
      capturadoEm: new Date(new Date(epoch).getTime() - 60_000).toISOString() });
    assert(cloneOld.bufferId, JSON.stringify(cloneOld));
    let cloneOldFact;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      cloneOldFact = (await admin.query(`SELECT b.status,
        (SELECT count(*)::int FROM engine_eventos_brutos e
         WHERE e.hash_evento='clonador_grupos:' || b.id::text) events
        FROM clonador_grupos_buffer b WHERE b.id=$1`,
      [cloneOld.bufferId])).rows[0];
      if (cloneOldFact?.status !== "capturada" &&
          cloneOldFact?.status !== "processando") break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(cloneOldFact.events, 0);
    const engineStage = async (route, body = { limite: 20 }) => {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        method: "POST", headers: adminHeaders,
        body: JSON.stringify(body)
      });
      const result = await response.json();
      assert.equal(response.status, 200,
        `${route} ${JSON.stringify(result)}`);
      return result;
    };
    const processed = await engineStage("/engine/processar-pendentes");
    const validated = await engineStage("/engine/validar-jobs");
    const imported = await engineStage("/engine/importar-prontos");
    const distributed = await engineStage("/engine/distribuir-ofertas",
      { limite: 20, clienteId: "ws_alpha" });
    const sourceTargets = (await admin.query(`SELECT e.id AS event_id,e.fonte,
      count(DISTINCT o.id)::int AS offers,
      count(DISTINCT o.id) FILTER (WHERE o.metadata ? 'ofcV24')::int
        AS commercially_normalized_offers,
      count(DISTINCT q.id)::int AS queue_items,
      count(DISTINCT d.id)::int AS targets
      FROM engine_eventos_brutos e
      LEFT JOIN engine_jobs_cliente j ON j.evento_id=e.id
        AND j.cliente_id='ws_alpha'
      LEFT JOIN engine_ofertas o ON o.id=j.oferta_id
      LEFT JOIN engine_universal_queue_items q ON q.job_id=j.id
      LEFT JOIN engine_universal_queue_destinations d ON d.queue_item_id=q.id
      WHERE e.id=ANY($1::bigint[])
      GROUP BY e.id,e.fonte`,
    [[radarFact.id, teleFact.id, cloneFact.evento_id]])).rows;
    assert.equal(sourceTargets.length, 3);
    assert(sourceTargets.every(row => row.offers > 0 &&
      row.commercially_normalized_offers === row.offers &&
      row.queue_items > 0 && row.targets > 0),
    `source_pipeline_incomplete ${JSON.stringify({ processed, validated,
      imported, distributed, sourceTargets })}`);
    const distributorEventId = (await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,capturado_em,metadata) VALUES
      ('radar','radar',now(),'{}'::jsonb) RETURNING id`)).rows[0].id;
    const distributorOfferId = (await admin.query(`INSERT INTO engine_ofertas
      (evento_id,origem,status,marketplace,titulo,categoria,preco,
       imagem,link_original,link_afiliado,capturada_em)
      VALUES ($1,'radar','importada','amazon','Universal runtime fixture',
        'Eletronicos',99.90,'https://example.invalid/fixture.jpg',
        'https://www.amazon.com.br/dp/B012345678',
        'https://www.amazon.com.br/dp/B012345678?tag=fixture',now())
      RETURNING id`, [distributorEventId])).rows[0].id;
    const distributorJobId = (await admin.query(`INSERT INTO engine_jobs_cliente
      (evento_id,oferta_id,cliente_id,status,marketplace,categoria,metadata)
      VALUES ($1,$2,'ws_alpha','oferta_criada','amazon','Eletronicos',
        '{}'::jsonb) RETURNING id`,
    [distributorEventId, distributorOfferId])).rows[0].id;
    const distributionResponse = await fetch(
      `http://127.0.0.1:${port}/engine/distribuir-ofertas`, {
        method: "POST", headers: { authorization: `Bearer ${adminToken}`,
          "content-type": "application/json" },
        body: JSON.stringify({ limite: 3, clienteId: "ws_alpha" })
      });
    const distribution = await distributionResponse.json();
    assert.equal(distributionResponse.status, 200, JSON.stringify(distribution));
    assert.equal(distribution.adicionadasFila, 1, JSON.stringify(distribution));
    const operational = (await admin.query(`SELECT q.id AS queue_item_id,d.id AS target_id,
      d.fanout_owner_id,d.target_key,d.status
      FROM engine_universal_queue_items q
      JOIN engine_universal_queue_destinations d ON d.queue_item_id=q.id
      WHERE q.workspace_id='ws_alpha' AND q.oferta_id=$1 AND q.job_id=$2`,
    [distributorOfferId, distributorJobId])).rows;
    assert.equal(operational.length, 2);
    assert(operational[0].fanout_owner_id);
    assert.equal(new Set(operational.map(target =>
      target.fanout_owner_id)).size, 1);
    assert.deepEqual(operational.map(target => target.target_key).sort(),
      ["uf_group_a", "uf_group_b"]);
    assert(operational.every(target => target.status !== "sent_confirmed"));
    let executorObserved = false;
    const executorDeadline = Date.now() + 15000;
    while (Date.now() < executorDeadline) {
      const states = (await admin.query(`SELECT d.status,d.revision,d.send_started_at
        FROM engine_universal_queue_destinations d
        JOIN engine_universal_queue_items q ON q.id=d.queue_item_id
        WHERE q.workspace_id='ws_alpha' ORDER BY d.id`)).rows;
      assert(states.length >= 2);
      assert(states.every(target => target.status !== "sent" &&
        target.send_started_at === null));
      if (states.some(target => Number(target.revision) > 0)) {
        executorObserved = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert(executorObserved,
      `real_executor_did_not_claim_target ${JSON.stringify(logs.slice(-15))}`);
    const hotPath = await probe(child, "uf-probe-snapshot");
    assert.equal(hotPath.reads, 0, JSON.stringify(hotPath));
    assert.equal(hotPath.filaJsonReads, 0, JSON.stringify(hotPath));
    assert.equal(hotPath.filaVivaReads, 0, JSON.stringify(hotPath));
    assert.equal(hotPath.vivaWrites, 0, JSON.stringify(hotPath));
    assert.equal(hotPath.legacyCheckpoints, 0, JSON.stringify(hotPath));
    const legacyUsers = JSON.parse(fs.readFileSync(path.join(dataDir,
      "usuarios.json"), "utf8"));
    assert.equal(legacyUsers.find(user => user.id === "ws_alpha").creditos, 100);
    await stop(child);
    child = null;
    await admin.query(`UPDATE engine_universal_queue_destinations
      SET lease_until=clock_timestamp()-interval '1 second'
      WHERE queue_item_id=$1 AND status='claimed'`, [operational[0].queue_item_id]);
    assert.equal((await queue.preflightWorkspace({ pool,
      workspaceId: "ws_alpha" })).ok, true);
    await admin.query(`UPDATE engine_universal_queue_destinations
      SET available_at=clock_timestamp()
      WHERE queue_item_id=$1 AND status='pending'`, [operational[0].queue_item_id]);
    const restartClaim = await queue.claimDestination({ pool,
      workspaceId: "ws_alpha", leaseMs: 5000 });
    assert.equal(restartClaim.ok, true);
    assert.equal(restartClaim.empty, false);
    assert.equal((await queue.markSendStarted({ pool,
      destinationId: restartClaim.id,
      leaseToken: restartClaim.leaseToken })).ok, true);
    const confirmationKey = crypto.randomUUID();
    const providerMessageId = `fixture_ack_${restartClaim.id}`;
    await admin.query(`INSERT INTO fila_checkpoints_entrega
      (cliente_id,fila_item_id,destino_chave,alvo_chave,attempt_id,
       estado,provider_message_id,confirmado_em)
      VALUES ($1,$2,$3,$4,$5,'enviado',$6,clock_timestamp())`,
    [restartClaim.workspace_id, `universal_${restartClaim.queue_item_id}`,
      `${restartClaim.channel}:${restartClaim.destination_id}`,
      `grupo:${restartClaim.target_key}`, confirmationKey, providerMessageId]);
    await admin.query(`UPDATE engine_universal_queue_destinations
      SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`,
    [restartClaim.id]);
    const preEpochCapture = new Date(new Date(epoch).getTime() - 60_000);
    const preEpochEventId = (await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,hash_evento,texto_original,links_extraidos,capturado_em)
      VALUES ('radar','radar',$1,'pre-epoch fixture','[]'::jsonb,$2)
      RETURNING id`, [crypto.randomUUID(), preEpochCapture])).rows[0].id;
    await admin.query(`INSERT INTO engine_radar_replay_intents_candidate
      (evento_id,cliente_id,capturado_em) VALUES ($1,'ws_alpha',$2)`,
    [preEpochEventId, preEpochCapture]);
    const ambiguousCapture = new Date();
    const ambiguousEventId = (await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,hash_evento,texto_original,links_extraidos,
       marketplace_detectado,capturado_em)
      VALUES ('radar','radar',$1,'ambiguous workspace fixture',
        '[]'::jsonb,'amazon',$2) RETURNING id`,
    [crypto.randomUUID(), ambiguousCapture])).rows[0].id;
    await admin.query(`INSERT INTO engine_radar_replay_intents_candidate
      (evento_id,cliente_id,capturado_em) VALUES ($1,'ws_unverified',$2)`,
    [ambiguousEventId, ambiguousCapture]);
    const validReplayEvents = [];
    for (const workspaceId of ["ws_alpha", "ws_beta"]) {
      const captured = new Date();
      const eventId = (await admin.query(`INSERT INTO engine_eventos_brutos
        (origem,fonte,hash_evento,texto_original,links_extraidos,
         marketplace_detectado,capturado_em)
        VALUES ('radar','radar',$1,$2,'[]'::jsonb,'amazon',$3)
        RETURNING id`, [crypto.randomUUID(), `replay ${workspaceId}`,
        captured])).rows[0].id;
      await admin.query(`INSERT INTO engine_radar_replay_intents_candidate
        (evento_id,cliente_id,capturado_em) VALUES ($1,$2,$3)`,
      [eventId, workspaceId, captured]);
      validReplayEvents.push({ eventId, workspaceId, captured });
    }
    child = await startRuntime();
    let recoveredTarget;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      recoveredTarget = (await admin.query(`SELECT status,provider_message_id,
        credit_debited FROM engine_universal_queue_destinations WHERE id=$1`,
      [restartClaim.id])).rows[0];
      if (recoveredTarget?.status === "sent") break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(recoveredTarget?.status, "sent");
    assert.equal(recoveredTarget.provider_message_id, providerMessageId);
    assert.equal(recoveredTarget.credit_debited, true);
    const debitCount = async () => (await admin.query(`SELECT count(*)::int AS n
      FROM financial_credit_ledger WHERE cliente_id='ws_alpha'
        AND universal_movement_type='TARGET_DEBIT'`)).rows[0].n;
    assert.equal(await debitCount(), 1);
    assert.equal((await admin.query(`SELECT balance FROM
      engine_universal_credit_balances WHERE workspace_id='ws_alpha'`)).rows[0].balance, 6);
    await stop(child);
    child = await startRuntime();
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(await debitCount(), 1);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM
      engine_universal_queue_destinations WHERE queue_item_id=$1`,
    [operational[0].queue_item_id])).rows[0].n, 2);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM
      fila_checkpoints_entrega WHERE provider_message_id=$1`,
    [providerMessageId])).rows[0].n, 1);
    const preEpochFact = (await admin.query(`SELECT i.status,
      (SELECT count(*)::int FROM engine_jobs_cliente j
       WHERE j.evento_id=i.evento_id) AS jobs
      FROM engine_radar_replay_intents_candidate i
      WHERE i.evento_id=$1`, [preEpochEventId])).rows[0];
    assert.equal(preEpochFact.jobs, 0);
    assert.equal(preEpochFact.status, "rejected_pre_epoch");
    for (const valid of validReplayEvents) {
      let fact;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        fact = (await admin.query(`SELECT i.status,i.capturado_em,
          (SELECT count(*)::int FROM engine_jobs_cliente j
           WHERE j.evento_id=i.evento_id AND j.cliente_id=i.cliente_id) jobs
          FROM engine_radar_replay_intents_candidate i
          WHERE i.evento_id=$1 AND i.cliente_id=$2`,
        [valid.eventId, valid.workspaceId])).rows[0];
        if (fact?.status === "concluida") break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(fact?.status, "concluida",
        `replay_workspace_blocked ${valid.workspaceId} ${JSON.stringify(logs.filter(line =>
          line.includes("RADAR-REPLAY") || line.includes("ENGINE-JOB") ||
          line.includes("ENGINE JOB")).slice(-12))}`);
      assert.equal(fact.jobs, 1);
      assert.equal(fact.capturado_em.toISOString(), valid.captured.toISOString());
    }
    const ambiguousFact = (await admin.query(`SELECT i.status,
      (SELECT count(*)::int FROM engine_jobs_cliente j
       WHERE j.evento_id=i.evento_id) jobs
      FROM engine_radar_replay_intents_candidate i
      WHERE i.evento_id=$1`, [ambiguousEventId])).rows[0];
    assert.deepEqual(ambiguousFact, { status: "pendente", jobs: 0 });
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM
      engine_universal_queue_items WHERE evento_id=$1`,
    [preEpochEventId])).rows[0].n, 0);
    console.log(JSON.stringify({ test: "universal_real_runtime_epoch",
      actualIndexProcess: true, historyListFromPg: true,
      historyDetailFromPg: true, legacyWriteBlocked: true,
      radarPostEpochJob: radarFact.jobs, t0Preserved: true,
      teleRadarPostEpochJobs: teleFact.jobs,
      teleRadarPreEpochRejected: true,
      cloneRuntimePostEpochJob: cloneFact.jobs,
      clonePreEpochUniversalEvents: cloneOldFact.events,
      sourceTargets,
      realDistributorEnqueuedTargets: operational.length,
      realExecutorClaimedTarget: executorObserved,
      displayedCreditFromPg: true, legacyJsonCreditUnchanged: true,
      registrationOpeningAndSimulatedPaymentFromPg: true,
      hotPathVivaReads: hotPath.reads,
      hotPathFilaJsonReads: hotPath.filaJsonReads,
      hotPathFilaVivaReads: hotPath.filaVivaReads,
      hotPathVivaWrites: hotPath.vivaWrites,
      hotPathLegacyCheckpoints: hotPath.legacyCheckpoints,
      realRuntimeRestarts: 2, ackRecoveredWithoutResend: true,
      targetDebitsAfterRestarts: await debitCount(),
      preEpochReplayJobs: preEpochFact.jobs,
      preEpochIntentStatus: preEpochFact.status,
      postEpochReplayWorkspaces: validReplayEvents.map(event => event.workspaceId),
      ambiguousWorkspaceFailClosedWithoutBlockingOther: true,
      queueItemId: queued.itemId }));
  } finally {
    await stop(child);
    if (pool) await pool.end().catch(() => {});
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
