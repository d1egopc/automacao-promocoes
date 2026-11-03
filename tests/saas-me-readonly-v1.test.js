"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { SQL_SCHEMA_FINANCEIRO_V1 } =
  require("../modules/financeiro/financeiro.schema");
const { prepararModoOperacionalReal } =
  require("../modules/engine/universal-runtime-bootstrap");
const universalCredits = require("../modules/engine/universal-credits.repository");

const raiz = path.resolve(__dirname, "..");
const fonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function request({ port, method = "GET", route = "/", token, body }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = {};
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(payload.length);
    }
    if (token) headers.authorization = `Bearer ${token}`;
    const req = http.request({ hostname: "127.0.0.1", port, path: route,
      method, headers }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch {}
        resolve({ status: res.statusCode, body: parsed, text });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitServer(port, proc, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error("me_fixture_backend_exited");
    try {
      const response = await request({ port });
      if (response.status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("me_fixture_startup_timeout");
}

async function stopProcess(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => proc.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 3000))
  ]);
  if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
}

function googleToken({ privateKey, kid, clientId, sub, email }) {
  return jwt.sign({ sub, email, email_verified: true }, privateKey, {
    algorithm: "RS256",
    keyid: kid,
    issuer: "https://accounts.google.com",
    audience: clientId,
    expiresIn: "5m"
  });
}

function databaseUrlFor(base, database) {
  const url = new URL(base);
  url.pathname = `/${database}`;
  url.searchParams.delete("sslmode");
  return url.toString();
}

function assertNoSecret(text, secrets) {
  for (const secret of secrets) {
    assert.ok(!String(text).includes(secret), "logs nao podem conter token ou segredo da fixture");
  }
}

(async () => {
  const baseDatabaseUrl = String(process.env.DATABASE_URL || "").trim();
  assert.ok(baseDatabaseUrl, "DATABASE_URL descartavel e obrigatoria");
  const database = `optimus_me_hotfix_${process.pid}_${Date.now()}`;
  const adminPool = new Pool({
    connectionString: databaseUrlFor(baseDatabaseUrl, "postgres"),
    ssl: false,
    max: 1
  });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-me-readonly-v1-"));
  const port = 3281 + Math.floor(Math.random() * 200);
  const jwtSecret = "segredo_me_readonly_v1";
  const clientId = "google-client-me-readonly.apps.googleusercontent.com";
  const kid = "kid-me-readonly-v1";
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
  const jwk = publicKey.export({ format: "jwk" });
  Object.assign(jwk, { kid, alg: "RS256", use: "sig" });
  let pool = null;
  let proc = null;
  let stdout = "";
  let stderr = "";

  try {
    await adminPool.query(`CREATE DATABASE "${database}"`);
    const databaseUrl = databaseUrlFor(baseDatabaseUrl, database);
    pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 3 });
    await pool.query(fs.readFileSync(
      path.join(raiz, "modules", "engine", "schema.sql"), "utf8"));
    for (const sql of SQL_SCHEMA_FINANCEIRO_V1) await pool.query(sql);
    await prepararModoOperacionalReal({ pool });
    const epoch = new Date().toISOString();
    await pool.query("UPDATE engine_operation_state SET mode='CUTOVER_PREPARED' WHERE id=1");
    await pool.query(`UPDATE engine_operation_state
      SET mode='UNIVERSAL',operation_epoch_started_at=$1 WHERE id=1`, [epoch]);
    await universalCredits.openBalance({
      pool,
      workspaceId: "user_existente",
      operationEpochStartedAt: epoch,
      openingBalance: 432,
      sourceHash: crypto.createHash("sha256")
        .update("fixture-me-readonly-user-existente")
        .digest("hex")
    });
    await pool.query(`UPDATE engine_universal_credit_balances
      SET reserved=19 WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
    [epoch, "user_existente"]);

    writeJson(path.join(dataDir, "usuarios.json"), [
      {
        id: "admin",
        nome: "Admin",
        email: "admin@fixture.invalid",
        papel: "admin_master",
        plano: "master",
        ativo: true
      },
      {
        id: "user_existente",
        nome: "Existente",
        email: "existente@fixture.invalid",
        papel: "cliente",
        plano: "pro",
        planoAssinatura: "pro",
        creditos: 432,
        creditosModelo: "ciclo",
        creditosAdminManualAtivo: true,
        creditosAdminManualExpiraEm: "2026-10-01T00:00:00.000Z",
        cicloAtualInicio: "2026-09-01T00:00:00.000Z",
        cicloAtualFim: "2026-10-01T00:00:00.000Z",
        proximaRenovacao: "2026-10-01T00:00:00.000Z",
        assinaturaStatus: "ativa",
        ativo: true
      },
      {
        id: "user_ledger_indisponivel",
        nome: "Ledger Indisponivel",
        email: "ledger-indisponivel@fixture.invalid",
        papel: "cliente",
        plano: "pro",
        creditos: 777,
        ativo: true
      }
    ]);
    writeJson(path.join(dataDir, "planos.json"), {
      master: { nome: "Master", limites: {}, recursos: {}, marketplaces: [] },
      pro: { nome: "Pro", creditosModelo: "ciclo",
        limites: { creditosPorCiclo: 100, cicloDias: 30 },
        recursos: {}, marketplaces: [] }
    });
    writeJson(path.join(dataDir, "configs_clientes.json"), {
      user_existente: { automacaoAtiva: false },
      user_ledger_indisponivel: { automacaoAtiva: false }
    });

    const env = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PGSSLMODE: "disable",
      DATA_DIR: dataDir,
      PORT: String(port),
      JWT_SECRET: jwtSecret,
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_JWKS_JSON: JSON.stringify({ keys: [jwk] }),
      PERF_DIAGNOSTICO: "0",
      CAMPANHAS_AGENDAMENTOS_ATIVO: "false"
    };
    proc = spawn(process.execPath, ["index.js"], {
      cwd: raiz,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    proc.stdout.on("data", chunk => { stdout += chunk.toString(); });
    proc.stderr.on("data", chunk => { stderr += chunk.toString(); });
    await waitServer(port, proc);

    async function snapshotFinanceiro(workspaceId) {
      const saldo = (await pool.query(`SELECT opening_balance,balance,reserved,revision
        FROM engine_universal_credit_balances
        WHERE operation_epoch_started_at=$1 AND workspace_id=$2`,
      [epoch, workspaceId])).rows[0] || null;
      const movimentos = (await pool.query(`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE universal_movement_type='POLICY_BALANCE_SET')::int AS policy
        FROM financial_credit_ledger
        WHERE operation_epoch_started_at=$1 AND cliente_id=$2`,
      [epoch, workspaceId])).rows[0];
      return { saldo, movimentos };
    }

    const financeiroAntes = await snapshotFinanceiro("user_existente");
    const idToken = googleToken({ privateKey, kid, clientId,
      sub: "sub_me_readonly", email: "existente@fixture.invalid" });
    const google = await request({ port, method: "POST", route: "/auth/google",
      body: { credential: idToken } });
    assert.strictEqual(google.status, 200, JSON.stringify(google.body));
    assert.ok(google.body.token, "Google existente deve emitir JWT");

    const me = await request({ port, route: "/me", token: google.body.token });
    assert.strictEqual(me.status, 200, JSON.stringify(me.body));
    assert.strictEqual(me.body.usuario.id, "user_existente");
    assert.strictEqual(me.body.usuario.creditos, 432);
    assert.strictEqual(me.body.usuario.creditosEstado, "disponivel");
    assert.deepStrictEqual(await snapshotFinanceiro("user_existente"), financeiroAntes,
      "/me nao pode renovar, conceder, debitar ou liberar reserva");
    const usuarioAposMe = readJson(path.join(dataDir, "usuarios.json"), [])
      .find(user => user.id === "user_existente");
    assert.strictEqual(usuarioAposMe.cicloAtualFim, "2026-10-01T00:00:00.000Z");
    assert.strictEqual(usuarioAposMe.creditosAdminManualAtivo, true);
    assert.strictEqual(proc.exitCode, null, "/me nao pode encerrar Node 24");

    const ledgerAntes = Number((await pool.query(
      "SELECT count(*) AS total FROM financial_credit_ledger WHERE cliente_id=$1",
      ["user_ledger_indisponivel"]
    )).rows[0].total);
    const tokenSemLedger = jwt.sign({ clienteId: "user_ledger_indisponivel",
      papel: "cliente", plano: "pro" }, jwtSecret, { expiresIn: "5m" });
    const meSemLedger = await request({ port, route: "/me", token: tokenSemLedger });
    assert.strictEqual(meSemLedger.status, 200, JSON.stringify(meSemLedger.body));
    assert.strictEqual(meSemLedger.body.usuario.creditos, null);
    assert.strictEqual(meSemLedger.body.usuario.creditosEstado, "indisponivel");
    assert.strictEqual(Number((await pool.query(
      "SELECT count(*) AS total FROM financial_credit_ledger WHERE cliente_id=$1",
      ["user_ledger_indisponivel"]
    )).rows[0].total), ledgerAntes,
    "ledger indisponivel nao pode criar autorizacao ou movimento financeiro");
    assert.strictEqual((await request({ port })).status, 200,
      "backend deve permanecer ativo depois da falha local de ledger");
    assert.strictEqual(proc.exitCode, null);

    const inicioMe = fonte.indexOf('app.get("/me"');
    const fimMe = fonte.indexOf("// ================= INTEGRA", inicioMe);
    assert.ok(inicioMe >= 0 && fimMe > inicioMe);
    const blocoMe = fonte.slice(inicioMe, fimMe);
    assert.ok(blocoMe.includes("saldoCreditosSomenteLeitura"));
    assert.ok(!blocoMe.includes("saldoCreditosParaExibicao"));
    assert.ok(!blocoMe.includes("renovarCreditosSeNecessario"));
    assert.ok(blocoMe.includes('creditosEstado = "indisponivel"'));
    assert.ok(blocoMe.includes('etapa: "me.credit_balance_read"'));
    assert.ok(blocoMe.includes('etapa: "me.profile_build"'));
    assertNoSecret(stdout + stderr, [idToken, google.body.token, jwtSecret]);
    console.log("saas-me-readonly-v1.test.js OK");
  } finally {
    await stopProcess(proc);
    if (pool) await pool.end().catch(() => {});
    await adminPool.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
      .catch(() => {});
    await adminPool.end().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
