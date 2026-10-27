"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const url = process.env.TELEMETRY_FIXTURE_PG_URL;
test(
  "PostgreSQL fixture: scoped SQL, trace identifiers, OneLink worker and read-only transactions",
  {
    skip: !url
      ? "BLOCKED: disposable PostgreSQL fixture not configured"
      : false,
  },
  async () => {
    const target = new URL(url);
    assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
    assert.equal(target.pathname, "/optimus_telemetry_fixture");
    assert.ok(
      !process.env.DATABASE_URL,
      "never inherit production DATABASE_URL",
    );
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: url, max: 3 });
    try {
      await pool.query(
        fs.readFileSync(
          path.join(__dirname, "../modules/engine/schema.sql"),
          "utf8",
        ),
      );
      await pool.query(
        "CREATE TABLE local_worker_tasks (id bigint primary key, marketplace text, capability text, source_url text, status text, attempts int, updated_at timestamptz, result_metadata jsonb default '{}')",
      );
      await pool.query(`INSERT INTO engine_eventos_brutos(id,origem,origem_tipo,marketplace_detectado) VALUES(1,'radar','whatsapp','magalu'),(2,'radar','telegram','magalu');
      INSERT INTO engine_links(id,evento_id,url_original,dominio_original,redirect_ok,motivo_redirect) VALUES(1,1,'https://magazineluiza.onelink.me/589508454/xbk2bz6q','magazineluiza.onelink.me',false,'sem_link_produto_confirmado');
      INSERT INTO engine_ofertas(id,evento_id,marketplace,status) VALUES(1,1,'magalu','retida'),(2,2,'magalu','retida');
      INSERT INTO engine_jobs_cliente(id,evento_id,oferta_id,cliente_id,marketplace,status,motivo_final) VALUES(1,1,1,'user_a','magalu','rejeitado','sem_link_produto_confirmado'),(2,2,2,'user_b','magalu','pendente',null);
      INSERT INTO engine_processamentos(job_id,etapa,status,motivo) VALUES(1,'magalu_identity','rejeitado','sem_link_produto_confirmado');
      INSERT INTO engine_eventos_comerciais(tipo_evento,cliente_id,workspace_id,job_id,oferta_id,marketplace,chave_idempotencia,metadata) VALUES('destino_rejeitado','user_a','user_a',1,1,'magalu','fixture-a','{"motivoCodigo":"sem_link_produto_confirmado","token":"NEVER_OUTPUT"}'),('executor_enviado','user_b','user_b',2,2,'magalu','fixture-b','{}');
      INSERT INTO local_worker_tasks VALUES(1,'magalu','magalu_identity_v1','https://magazineluiza.onelink.me/589508454/xbk2bz6q','failed',1,now(),'{}');`);
      let queryCount = 0;
      const query = async (sql, params) => {
        const c = await pool.connect();
        try {
          queryCount++;
          await c.query("BEGIN READ ONLY");
          await c.query("SET LOCAL statement_timeout='2000ms'");
          return { ok: true, resultado: await c.query(sql, params) };
        } finally {
          await c.query("ROLLBACK");
          c.release();
        }
      };
      const {
        createOperationalView,
      } = require("../modules/telemetria/operational-view");
      const view = createOperationalView({
        query,
        getUsers: () => [{ id: "user_a" }, { id: "user_b" }],
      });
      const scope = { tipo: "workspace", clienteId: "user_a" };
      const snapshot = await view.snapshot({ clienteId: "user_b" }, scope);
      assert.ok(snapshot.events.items.length > 0);
      assert.ok(snapshot.events.items.every((e) => e.clienteId === "user_a"));
      assert.equal(
        snapshot.motors.find((m) => m.motor === "radar").state,
        "COMPROVADO",
      );
      const filtered = await view.snapshot({ motor: "teleradar" }, scope);
      assert.equal(
        filtered.events.items.length,
        0,
        "motor filter cannot show a Radar event as TeleRadar",
      );
      assert.ok(
        (await view.snapshot({ motor: "radar" }, scope)).events.items.length >
          0,
      );
      const trace = await view.trace("job", "1", {}, scope);
      assert.equal(trace.eventoId, "1");
      assert.equal(trace.magalu.oneLink.state, "COMPROVADO");
      assert.equal(trace.magalu.tasks[0].status, "failed");
      assert.equal(trace.magalu.affiliation.state, "DESCONHECIDO");
      assert.ok(!JSON.stringify(trace).includes("NEVER_OUTPUT"));
      assert.ok(!JSON.stringify(trace).includes("user_b"));
      await pool.query(`UPDATE engine_jobs_cliente SET metadata='{"adapter":"magalu","provaAfiliado":{"conversaoStatus":"convertida","proofType":"deterministic_workspace"}}' WHERE id=1;
      UPDATE local_worker_tasks SET status='completed',result_metadata='{}' WHERE id=1;`);
      const completedOnly = await view.trace("job", "1", {}, scope);
      assert.equal(completedOnly.magalu.identity.confirmed, null);
      assert.equal(completedOnly.magalu.affiliation.confirmed, true);
      await pool.query(
        `UPDATE local_worker_tasks SET result_metadata='{"identidadeValidada":true}' WHERE id=1`,
      );
      assert.equal(
        (await view.trace("job", "1", {}, scope)).magalu.identity.confirmed,
        true,
      );
      const other = await view.trace("evento", "2", {}, scope);
      assert.notEqual(other.statusTelemetria, "disponivel");
      assert.equal(
        (await view.trace("oferta", "2", {}, scope)).state,
        "NAO_OBSERVADO",
      );
      assert.equal((await view.workspaces({}, scope)).workspaces.length, 1);
      assert.equal(
        (await view.problems({}, scope)).problems[0].motivo,
        "sem_link_produto_confirmado",
      );
      await assert.rejects(
        query("DELETE FROM engine_jobs_cliente", []),
        /read-only/,
      );
      assert.equal(
        (await pool.query("SELECT count(*)::int n FROM engine_jobs_cliente"))
          .rows[0].n,
        2,
      );
      console.log(
        JSON.stringify({
          FIXTURE_SQL: "PASS",
          queries: queryCount,
          workspaceIsolation: "PASS",
          writesBlocked: "PASS",
        }),
      );
    } finally {
      await pool.end();
    }
  },
);
