"use strict";

const assert = require("assert");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const childScript = String.raw`
"use strict";
const fs = require("fs");
const repo = require(process.argv[1]);
const statePath = process.argv[2];
const lockPath = process.argv[3];
const cliente = process.argv[4];

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock() {
  const limite = Date.now() + 5000;
  while (Date.now() < limite) {
    try { return fs.openSync(lockPath, "wx"); }
    catch (erro) {
      if (erro.code !== "EEXIST") throw erro;
      sleep(5);
    }
  }
  throw new Error("lock_timeout");
}

function releaseLock(fd) {
  try { fs.closeSync(fd); } finally { fs.rmSync(lockPath, { force: true }); }
}

const pool = {
  async connect() {
    let lockFd = null;
    let snapshot = null;
    return {
      async query(sql, params = []) {
        const texto = String(sql).replace(/\s+/g, " ").trim();
        if (texto === "BEGIN") {
          lockFd = acquireLock();
          snapshot = JSON.parse(fs.readFileSync(statePath, "utf8"));
          return { rows: [], rowCount: 0 };
        }
        if (texto === "COMMIT") {
          fs.writeFileSync(statePath, JSON.stringify(snapshot));
          releaseLock(lockFd);
          lockFd = null;
          return { rows: [], rowCount: 0 };
        }
        if (texto === "ROLLBACK") {
          releaseLock(lockFd);
          lockFd = null;
          return { rows: [], rowCount: 0 };
        }
        if (/^(CREATE TABLE|CREATE INDEX|ALTER TABLE|DO \$\$)/i.test(texto)) {
          return { rows: [], rowCount: 0 };
        }
        if (/^INSERT INTO queue_manifest_state/i.test(texto)) {
          return { rows: [], rowCount: 0 };
        }
        if (/^SELECT .* FROM queue_manifest_state .* FOR UPDATE$/i.test(texto)) {
          return { rows: [{ ...snapshot }], rowCount: 1 };
        }
        if (/^UPDATE queue_manifest_state/i.test(texto)) {
          snapshot = {
            ...snapshot,
            revision: Number(snapshot.revision) + 1,
            viva_generation: params[1],
            durable_checkpoint_generation: params[2],
            dirty_generation: params[3],
            authority_ready: params[4],
            authority_ready_generation: params[5],
            authority_ready_revision: params[4] ? Number(snapshot.revision) + 1 : null,
            authority_ready_at: params[4] ? new Date().toISOString() : null,
            viva_file_proof: params[6],
            legacy_file_proof: params[7],
            pending_checkpoint_revision: params[8],
            pending_checkpoint_target_generation: params[9],
            pending_checkpoint_started_at: params[10],
            updated_at: new Date().toISOString()
          };
          return { rows: [{ ...snapshot }], rowCount: 1 };
        }
        throw new Error("sql_nao_suportado: " + texto);
      },
      release() {
        if (lockFd !== null) releaseLock(lockFd);
      }
    };
  }
};

repo.prepararReadinessAutoridade(cliente, {
  expectedRevision: 5,
  lerManifesto: async () => {
    await new Promise(resolve => setTimeout(resolve, 30));
    return {
      ok: true,
      manifesto: {
        manifestVersion: 2,
        vivaGeneration: 5,
        durableCheckpointGeneration: 3,
        dirtyGeneration: 4
      }
    };
  }
}, { pool }).then(resultado => {
  process.stdout.write(JSON.stringify({
    ok: resultado.ok,
    ready: resultado.ready,
    motivo: resultado.motivo,
    revision: resultado.state && resultado.state.revision
  }));
}).catch(erro => {
  process.stderr.write(erro.stack || erro.message);
  process.exitCode = 1;
});
`;

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-guard-multiprocess-"));
  const statePath = path.join(root, "queue-manifest-state.json");
  const lockPath = path.join(root, "queue-manifest-state.lock");
  const fencePath = path.join(root, "removal-fence.json");
  const cliente = "user_multiprocess_health_guard";
  const repoPath = path.resolve(__dirname, "../modules/fila/fila-manifest-state.repository.js");
  const stateInicial = {
    cliente_id: cliente,
    revision: 5,
    viva_generation: 5,
    durable_checkpoint_generation: 3,
    dirty_generation: 4,
    authority_ready: false,
    authority_ready_generation: null,
    authority_ready_revision: null,
    authority_ready_at: null,
    viva_file_proof: null,
    legacy_file_proof: null,
    pending_checkpoint_revision: null,
    pending_checkpoint_target_generation: null,
    pending_checkpoint_started_at: null,
    updated_at: null
  };
  fs.writeFileSync(statePath, JSON.stringify(stateInicial));
  fs.writeFileSync(fencePath, JSON.stringify({ jobId: "terminal-multiprocess", generation: 4 }));

  try {
    const args = ["-e", childScript, repoPath, statePath, lockPath, cliente];
    const [a, b] = await Promise.all([
      execFileAsync(process.execPath, args, { encoding: "utf8" }),
      execFileAsync(process.execPath, args, { encoding: "utf8" })
    ]);
    const resultados = [JSON.parse(a.stdout), JSON.parse(b.stdout)];
    assert.strictEqual(resultados.filter(item => item.ready === true).length, 1, JSON.stringify(resultados));
    assert.strictEqual(resultados.filter(item => item.motivo === "revision_stale").length, 1,
      JSON.stringify(resultados));

    const final = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.strictEqual(final.revision, 6, "somente uma escrita de readiness pode ocorrer");
    assert.strictEqual(final.authority_ready, true);
    assert.strictEqual(final.authority_ready_generation, 5);
    assert.strictEqual(final.durable_checkpoint_generation, 3, "readiness nao executa checkpoint");
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(fencePath, "utf8")), {
      jobId: "terminal-multiprocess",
      generation: 4
    }, "readiness concorrente nao remove fence");
    assert.strictEqual(fs.existsSync(lockPath), false, "lock de teste deve ser liberado");
    console.log("workspace-health-guard-readiness-multiprocess.test.js OK");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
