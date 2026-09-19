"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  criarLocalWorkerRepository
} = require("../modules/local-worker/local-worker.repository");

const REPO_FILE = path.join(__dirname, "..", "modules", "local-worker", "local-worker.repository.js");
const PRECHECK_FILE = path.join(__dirname, "..", "modules", "local-worker", "migrations", "000-local-worker-idempotency-precheck.sql");
const MIGRATION_FILE = path.join(__dirname, "..", "modules", "local-worker", "migrations", "001-local-worker-idempotency-active.sql");

function tarefa({ id, status = "failed", idempotencyKey = "magalu:afh3e1g80j:imagem_oficial" } = {}) {
  return {
    id,
    type: "imagem_oficial",
    marketplace: "magalu",
    product_id: "afh3e1g80j",
    source_url: "",
    technical_slug: "d1egopc",
    status,
    capability: "magalu_image_v1",
    idempotency_key: idempotencyKey,
    attempts: status === "failed" ? 3 : 0,
    max_attempts: 3,
    created_at: new Date(Date.now() - id * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: status === "expired" ? new Date(Date.now() - 1000).toISOString() : new Date(Date.now() + 900000).toISOString(),
    completed_at: status === "completed" ? new Date().toISOString() : null
  };
}

class FakePool {
  constructor(rows = []) {
    this.rows = rows;
    this.nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
    this.schemaSql = [];
    this.insertCount = 0;
    this.insertGate = null;
  }

  prepararBarreiraInsercao(partes = 2) {
    let liberar;
    const espera = new Promise(resolve => { liberar = resolve; });
    this.insertGate = { partes, chegadas: 0, espera, liberar };
  }

  async query(sql, params = []) {
    const normalizado = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (normalizado.startsWith("create table") || normalizado.includes("create unique index") || normalizado.includes("create index") || normalizado.includes("alter table")) {
      this.schemaSql.push(String(sql));
      return { rows: [] };
    }
    if (normalizado.startsWith("update local_worker_workers")) return { rows: [] };
    if (normalizado.startsWith("select * from local_worker_tasks where marketplace")) {
      const [marketplace, productId, type] = params;
      const candidatos = this.rows
        .filter(row => row.marketplace === marketplace && row.product_id === productId && row.type === type)
        .filter(row => !normalizado.includes("status in") || ["pending", "leased"].includes(row.status))
        .sort((a, b) => Number(b.id) - Number(a.id));
      return { rows: candidatos.slice(0, 1) };
    }
    if (normalizado.startsWith("insert into local_worker_tasks")) {
      if (this.insertGate) {
        this.insertGate.chegadas += 1;
        if (this.insertGate.chegadas >= this.insertGate.partes) this.insertGate.liberar();
        await this.insertGate.espera;
      }
      this.insertCount += 1;
      const [type, marketplace, productId, sourceUrl, technicalSlug, capability, idempotencyKey, maxAttempts] = params;
      const activeConflict = this.rows.some(row =>
        ["pending", "leased"].includes(row.status) &&
        ((row.marketplace === marketplace && row.product_id === productId && row.type === type) || row.idempotency_key === idempotencyKey)
      );
      if (activeConflict) return { rows: [] };
      const row = {
        id: this.nextId++,
        type,
        marketplace,
        product_id: productId,
        source_url: sourceUrl,
        technical_slug: technicalSlug,
        status: "pending",
        capability,
        idempotency_key: idempotencyKey,
        attempts: 0,
        max_attempts: maxAttempts,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + Number(params[8] || 900000)).toISOString(),
        completed_at: null
      };
      this.rows.push(row);
      return { rows: [row] };
    }
    throw new Error(`fake_pool_query_nao_mapeada: ${normalizado.slice(0, 120)}`);
  }
}

function opcoesTask() {
  return {
    type: "imagem_oficial",
    marketplace: "magalu",
    productId: "afh3e1g80j",
    technicalSlug: "d1egopc",
    capability: "magalu_image_v1",
    idempotencyKey: "magalu:afh3e1g80j:imagem_oficial"
  };
}

(async () => {
  const source = fs.readFileSync(REPO_FILE, "utf8");
  assert.match(source, /local_worker_tasks_active_unique[\s\S]*?WHERE status IN \('pending', 'leased'\)/);
  assert.match(source, /local_worker_tasks_active_idempotency_unique[\s\S]*?WHERE status IN \('pending', 'leased'\)/);
  assert.doesNotMatch(source, /CREATE UNIQUE INDEX IF NOT EXISTS local_worker_tasks_idempotency_unique/);

  const migration = fs.readFileSync(MIGRATION_FILE, "utf8");
  const criacao = migration.indexOf("CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS");
  const remocao = migration.indexOf("DROP INDEX CONCURRENTLY IF EXISTS");
  assert.ok(criacao >= 0 && remocao > criacao, "migration deve criar a proteção parcial antes de remover a global");
  assert.match(migration, /local_worker_tasks_active_idempotency_unique/);
  assert.match(migration, /local_worker_tasks_idempotency_unique/);
  assert.doesNotMatch(migration, /^\s*(BEGIN|COMMIT)\b/im, "CONCURRENTLY não pode estar dentro de transaction wrapper");
  assert.match(migration, /SELECT idempotency_key, COUNT\(\*\)/);
  assert.match(migration, /SELECT marketplace, product_id, type, COUNT\(\*\)/);

  const precheck = fs.readFileSync(PRECHECK_FILE, "utf8");
  assert.match(precheck, /SELECT idempotency_key, COUNT\(\*\)/);
  assert.match(precheck, /SELECT marketplace, product_id, type, COUNT\(\*\)/);
  assert.match(precheck, /status IN \('pending', 'leased'\)/);
  assert.doesNotMatch(precheck, /\b(INSERT|UPDATE|DELETE|DROP|CREATE)\b/i, "precheck deve ser somente leitura");

  const pool = new FakePool();
  const repository = criarLocalWorkerRepository({ pool });
  const primeiro = await repository.garantirTask(opcoesTask());
  assert.strictEqual(primeiro.ok, true);
  assert.strictEqual(primeiro.criada, true);
  const primeiroId = primeiro.task.id;

  const pending = await repository.garantirTask(opcoesTask());
  assert.strictEqual(pending.criada, false);
  assert.strictEqual(pending.task.id, primeiroId);

  pool.rows.find(row => String(row.id) === primeiroId).status = "leased";
  const leased = await repository.garantirTask(opcoesTask());
  assert.strictEqual(leased.criada, false);
  assert.strictEqual(leased.task.id, primeiroId);

  pool.rows.find(row => String(row.id) === primeiroId).status = "failed";
  const retryFailed = await repository.garantirTask(opcoesTask());
  assert.strictEqual(retryFailed.criada, true);
  assert.notStrictEqual(retryFailed.task.id, primeiroId);
  assert.strictEqual(pool.rows.find(row => String(row.id) === primeiroId).status, "failed");

  pool.rows.find(row => String(row.id) === retryFailed.task.id).status = "expired";
  const retryExpired = await repository.garantirTask(opcoesTask());
  assert.strictEqual(retryExpired.criada, true);
  assert.notStrictEqual(retryExpired.task.id, retryFailed.task.id);
  assert.strictEqual(pool.rows.filter(row => ["failed", "expired"].includes(row.status)).length, 2);
  pool.rows.find(row => String(row.id) === retryExpired.task.id).status = "expired";

  pool.rows.push(tarefa({ id: 99 }), tarefa({ id: 100, status: "expired" }));
  pool.nextId = 101;
  const retryAfterHistory = await repository.garantirTask(opcoesTask());
  assert.strictEqual(retryAfterHistory.criada, true);
  assert.ok(Number(retryAfterHistory.task.id) > 100);

  pool.rows.find(row => String(row.id) === retryAfterHistory.task.id).status = "completed";
  const antesCompleted = pool.insertCount;
  const completed = await repository.garantirTask(opcoesTask());
  assert.strictEqual(completed.criada, false);
  assert.strictEqual(completed.task.id, retryAfterHistory.task.id);
  assert.strictEqual(pool.insertCount, antesCompleted, "completed não deve inserir nova task");

  const concorrentePool = new FakePool();
  const concorrenteRepo = criarLocalWorkerRepository({ pool: concorrentePool });
  concorrentePool.prepararBarreiraInsercao(2);
  const concorrentes = await Promise.all([
    concorrenteRepo.garantirTask(opcoesTask()),
    concorrenteRepo.garantirTask(opcoesTask())
  ]);
  assert.strictEqual(concorrentePool.rows.filter(row => row.status === "pending").length, 1);
  assert.strictEqual(concorrentes.filter(resultado => resultado.criada).length, 1);
  assert.strictEqual(concorrentes[0].task.id, concorrentes[1].task.id);

  const taskAtiva = concorrentePool.rows.find(row => row.status === "pending");
  assert.ok(taskAtiva, "a task ativa deve continuar bloqueando nova criação");
  const bloqueada = await concorrenteRepo.garantirTask(opcoesTask());
  assert.strictEqual(bloqueada.criada, false);
  assert.strictEqual(bloqueada.task.id, String(taskAtiva.id));

  console.log("local-worker-idempotency.test.js: ok");
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
