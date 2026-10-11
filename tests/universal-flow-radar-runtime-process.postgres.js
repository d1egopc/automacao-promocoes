"use strict";

// Full local index.js process, isolated PostgreSQL schema and DATA_DIR only.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { Client } = require("pg");
const jwt = require("jsonwebtoken");
const { projectionDdl } = require("../modules/engine/lifecycle-steady.candidate");

const root = path.join(__dirname, "..");
const schema = `uf_radar_runtime_${crypto.randomBytes(6).toString("hex")}`;
const pgPort = Number(process.env.UF_TEST_PG_PORT || 55433);
const httpPort = Number(process.env.UF_TEST_HTTP_PORT || 33082);
const dataDir = path.join(root, ".local-test-tmp", schema);
const config = { host: "127.0.0.1", port: pgPort, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const databaseUrl = `postgres://postgres@127.0.0.1:${pgPort}/optimus_universal_fixture?options=${encodeURIComponent(`-c search_path=${schema},public`)}`;
const token = jwt.sign({ clienteId: "admin" }, "uf_radar_runtime_fixture");

function fixtureFiles() {
  fs.mkdirSync(path.join(dataDir, "clientes", "admin"), { recursive: true });
  const write = (relative, value) => fs.writeFileSync(path.join(dataDir, relative),
    JSON.stringify(value), "utf8");
  write("usuarios.json", [
    { id: "admin", papel: "admin_master", ativo: true, plano: "master" },
    { id: "ws_alpha", ativo: true, plano: "pro", creditos: 100 }
  ]);
  write("planos.json", { pro: { id: "pro", nome: "Pro", ativo: true,
    recursos: { engine: true }, marketplaces: ["amazon"] } });
  write("configs_clientes.json", { ws_alpha: { automacaoAtiva: false,
    marketplaces: { amazon: { ativo: true } } } });
  write("config.json", { pausarMadrugada: false, automacaoAtiva: false });
  write(path.join("clientes", "admin", "radar-config.json"), {
    monitoramentoAtivo: true, telegramMonitorados: [
      { id: "-100123", chatId: "-100123", ativo: true }
    ], monitoramento: { horaInicial: "00:00", horaFinal: "23:59",
      intervaloMinutos: 1, maxPorDia: 0 }
  });
}

async function startServer() {
  const child = spawn(process.execPath, ["index.js"], {
    cwd: root,
    windowsHide: true,
    env: {
      SystemRoot: process.env.SystemRoot,
      PATH: process.env.PATH,
      TEMP: path.join(root, ".local-test-tmp"),
      TMP: path.join(root, ".local-test-tmp"),
      NODE_PATH: process.env.NODE_PATH || "",
      NODE_ENV: "test", PGSSLMODE: "disable",
      DATA_DIR: dataDir, DATABASE_URL: databaseUrl,
      PORT: String(httpPort), JWT_SECRET: "uf_radar_runtime_fixture",
      UF_RADAR_REPLAY_LOCAL_CANDIDATE: "1",
      CAMPANHAS_AGENDAMENTOS_SCHEDULER: "false",
      PERF_DIAGNOSTICO: "0"
    }, stdio: ["ignore", "pipe", "pipe"]
  });
  const lines = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", chunk => {
      lines.push(...String(chunk).split(/\r?\n/).filter(Boolean));
      if (lines.length > 120) lines.splice(0, lines.length - 120);
    });
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && child.exitCode === null) {
    if (lines.some(line => line.includes("API ONLINE NA PORTA"))) {
      return { child, lines };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await stopServer(child);
  throw new Error(`radar_runtime_server_not_ready ${JSON.stringify(lines.slice(-18))}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 3000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function run() {
  const admin = new Client(config);
  let installed = false, server = null;
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
    await admin.query(`CREATE SCHEMA ${schema}`); installed = true;
    await admin.query(`SET search_path TO ${schema},public`);
    for (const name of ["schema.sql", "admission-gate.candidate.sql",
      "radar-replay.candidate.sql"]) {
      await admin.query(fs.readFileSync(path.join(root, "modules", "engine", name), "utf8"));
    }
    await admin.query(projectionDdl());
    await admin.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_last_success,lifecycle_max_staleness)
      VALUES (1,1,0,'HEALTHY',now(),interval '5 minutes')`);
    const blockerEvent = (await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo,hash_evento,texto_original,links_extraidos,capturado_em)
      VALUES ('fixture','fixture','fixture','runtime_blocker','blocker','[]'::jsonb,now())
      RETURNING id`)).rows[0];
    const blocker = (await admin.query(`INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status,metadata) VALUES ($1,'ws_alpha','pendente','{}'::jsonb)
      RETURNING id`, [blockerEvent.id])).rows[0];
    assert.equal((await admin.query(`SELECT hot_used FROM engine_hot_admission_control
      WHERE id=1`)).rows[0].hot_used, 1);
    fixtureFiles();
    server = await startServer();
    const t0Seconds = Math.floor(Date.now() / 1000) - 120;
    const message = { message: { chat: { id: "-100123", title: "Fixture" },
      date: t0Seconds, text: "Oferta https://www.amazon.com.br/dp/B012345678" } };
    const response = await fetch(`http://127.0.0.1:${httpPort}/radar/telegram/inbound`, {
      method: "POST", headers: { authorization: `Bearer ${token}`,
        "content-type": "application/json" },
      body: JSON.stringify(message)
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const fact = (await admin.query(`SELECT e.id,e.capturado_em,
      i.status AS intent_status,
      (SELECT count(*)::int FROM engine_jobs_cliente j WHERE j.evento_id=e.id) jobs
      FROM engine_eventos_brutos e
      JOIN engine_radar_replay_intents_candidate i ON i.evento_id=e.id
      WHERE e.origem='radar' ORDER BY e.id DESC LIMIT 1`)).rows[0];
    assert(fact, `runtime_no_radar_intent ${JSON.stringify(body)} ${JSON.stringify(server.lines.slice(-18))}`);
    assert.equal(fact.capturado_em.toISOString(), new Date(t0Seconds * 1000).toISOString());
    assert.equal(fact.intent_status, "pendente");
    assert.equal(fact.jobs, 0);
    await stopServer(server.child); server = null;
    const expiredT0 = new Date(Date.now() - 35 * 60000);
    const expiredEvent = (await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo,grupo_id,hash_evento,texto_original,
       links_extraidos,marketplace_detectado,capturado_em)
      VALUES ('radar','radar','telegram','-100123','runtime_expired',
        'expired fixture','["https://www.amazon.com.br/dp/B012345679"]'::jsonb,
        'amazon',$1) RETURNING id`, [expiredT0])).rows[0];
    await admin.query(`INSERT INTO engine_radar_replay_intents_candidate
      (evento_id,cliente_id,capturado_em) VALUES ($1,'ws_alpha',$2)`,
    [expiredEvent.id,expiredT0]);
    await admin.query(`UPDATE engine_jobs_cliente SET status='oferta_criada'
      WHERE id=$1`, [blocker.id]);
    assert.equal((await admin.query(`SELECT hot_used FROM engine_hot_admission_control
      WHERE id=1`)).rows[0].hot_used, 0);
    server = await startServer();
    let recovered;
    for (let i = 0; i < 30; i += 1) {
      recovered = (await admin.query(`SELECT i.status,i.job_id,
        (SELECT count(*)::int FROM engine_jobs_cliente j WHERE j.evento_id=$1) jobs
        FROM engine_radar_replay_intents_candidate i WHERE i.evento_id=$1`,
      [fact.id])).rows[0];
      if (recovered?.status === "concluida") break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(recovered?.status, "concluida",
      `radar_replay_runtime_not_recovered ${JSON.stringify(recovered)} ${JSON.stringify(server.lines.slice(-18))}`);
    assert.equal(recovered.jobs, 1);
    const expired = (await admin.query(`SELECT i.status,
      (SELECT count(*)::int FROM engine_jobs_cliente j WHERE j.evento_id=i.evento_id) jobs
      FROM engine_radar_replay_intents_candidate i WHERE i.evento_id=$1`,
    [expiredEvent.id])).rows[0];
    assert.deepEqual(expired,{status:"expirada",jobs:0});
    const duplicate = await fetch(`http://127.0.0.1:${httpPort}/radar/telegram/inbound`, {
      method: "POST", headers: { authorization: `Bearer ${token}`,
        "content-type": "application/json" }, body: JSON.stringify(message)
    });
    assert.equal(duplicate.status,200);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM engine_jobs_cliente
      WHERE evento_id=$1`,[fact.id])).rows[0].n,1);
    const processor = await fetch(`http://127.0.0.1:${httpPort}/engine/processar-pendentes`, {
      method: "POST", headers: { authorization: `Bearer ${token}`,
        "content-type": "application/json" }, body: JSON.stringify({ limite: 1 })
    });
    const processorBody = await processor.json();
    assert.equal(processor.status, 200, JSON.stringify(processorBody));
    const final = (await admin.query(`SELECT j.status,e.capturado_em,
      (SELECT count(*)::int FROM engine_jobs_cliente x WHERE x.evento_id=e.id) jobs
      FROM engine_jobs_cliente j JOIN engine_eventos_brutos e ON e.id=j.evento_id
      WHERE e.id=$1`, [fact.id])).rows[0];
    assert.equal(final.jobs, 1);
    assert.equal(final.status, "diagnosticado");
    assert.equal(final.capturado_em.toISOString(), new Date(t0Seconds * 1000).toISOString());
    console.log(JSON.stringify({ candidate: "radar_full_runtime_process",
      actualIndexProcess: true, optInEnabled: true, serverRestarts: 1,
      admissionInitiallyDenied: true, intentRecovered: true,
      expiredOriginalT0WithoutJob: true, duplicateStillOneJob: true,
      uniqueJobs: final.jobs, processorStatus: final.status,
      t0: final.capturado_em.toISOString() }));
  } finally {
    if (server) await stopServer(server.child);
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
