"use strict";

const assert = require("assert");
const repo = require("../modules/fila/fila-claims.repository");

function criarPoolMemoria() {
  const locks = new Map();
  const clients = [];
  let proximoId = 1;

  const chave = (params = []) => `${params[0]}|${params[1]}`;
  return {
    locks,
    clients,
    async connect() {
      const client = {
        id: proximoId++,
        liberado: false,
        operacoes: [],
        falharProximaQuery: false,
        async query(sql, params = []) {
          const texto = String(sql).replace(/\s+/g, " ").trim();
          client.operacoes.push(texto);
          if (client.falharProximaQuery) {
            client.falharProximaQuery = false;
            throw new Error("postgres_indisponivel");
          }
          const id = chave(params);
          if (/pg_try_advisory_lock/i.test(texto)) {
            if (locks.has(id)) return { rows: [{ adquirido: false }], rowCount: 1 };
            locks.set(id, client);
            return { rows: [{ adquirido: true }], rowCount: 1 };
          }
          if (/pg_advisory_unlock/i.test(texto)) {
            const liberado = locks.get(id) === client;
            if (liberado) locks.delete(id);
            return { rows: [{ liberado }], rowCount: 1 };
          }
          throw new Error(`sql_nao_suportado: ${texto}`);
        },
        release(erro) {
          client.liberado = true;
          client.erroRelease = erro || null;
          for (const [id, dono] of locks.entries()) {
            if (dono === client) locks.delete(id);
          }
          client.operacoes.push("RELEASE");
        }
      };
      clients.push(client);
      return client;
    }
  };
}

async function adquirir(pool, clienteId = "workspace_a", filaItemId = "item_1") {
  return repo.adquirirAdvisoryLockFila({ clienteId, filaItemId }, { pool });
}

(async () => {
  const pool = criarPoolMemoria();

  const a = await adquirir(pool);
  assert.strictEqual(a.adquirido, true);
  assert.ok(a.handle?.client, "claim adquirido preserva o client dedicado");
  assert.strictEqual(a.handle.client.liberado, false, "client permanece reservado durante o lock");

  const b = await adquirir(pool);
  assert.strictEqual(b.adquirido, false, "mesma chave nao e adquirida duas vezes");
  assert.strictEqual(b.handle, null);
  assert.strictEqual(pool.clients[1].liberado, true, "client sem lock volta imediatamente ao pool");

  const outroItem = await adquirir(pool, "workspace_a", "item_2");
  const outroWorkspace = await adquirir(pool, "workspace_b", "item_1");
  assert.strictEqual(outroItem.adquirido, true);
  assert.strictEqual(outroWorkspace.adquirido, true);

  const clientEstranho = await pool.connect();
  await assert.rejects(
    () => repo.liberarAdvisoryLockFila(a.handle, { client: clientEstranho }),
    /client_divergente/
  );
  assert.strictEqual(pool.locks.size, 3, "outra conexao nao libera lock alheio");
  clientEstranho.release();

  const liberacaoA = await repo.liberarAdvisoryLockFila(a.handle);
  assert.strictEqual(liberacaoA.liberado, true);
  assert.strictEqual(a.handle.client.liberado, true);
  assert(
    a.handle.client.operacoes.indexOf("SELECT pg_advisory_unlock(hashtext($1), hashtext($2)) AS liberado") < a.handle.client.operacoes.indexOf("RELEASE"),
    "unlock ocorre antes de devolver client ao pool"
  );
  assert.strictEqual((await adquirir(pool)).adquirido, true, "apos unlock uma nova conexao adquire a chave");

  const crash = await adquirir(pool, "workspace_crash", "item_crash");
  crash.handle.client.release();
  assert.strictEqual((await adquirir(pool, "workspace_crash", "item_crash")).adquirido, true, "fechamento do client libera lock sem unlock explicito");

  const poolErro = criarPoolMemoria();
  const clientErro = await poolErro.connect();
  clientErro.falharProximaQuery = true;
  const poolComClientErro = { connect: async () => clientErro };
  await assert.rejects(() => adquirir(poolComClientErro), /postgres_indisponivel/);
  assert.strictEqual(clientErro.liberado, true, "erro de aquisicao devolve client sem lock");

  const fonte = require("fs").readFileSync(require("path").join(__dirname, "..", "modules", "fila", "fila-claims.repository.js"), "utf8");
  assert.match(fonte, /pg_try_advisory_lock\(hashtext\(\$1\), hashtext\(\$2\)\)/);
  assert.match(fonte, /pg_advisory_unlock\(hashtext\(\$1\), hashtext\(\$2\)\)/);
  assert.doesNotMatch(fonte, /lease_expires_at[^\n]{0,100}pg_try_advisory_lock/i, "advisory nao depende de TTL");

  console.log("fila-advisory-lock.repository.test.js OK");
})().catch(erro => {
  console.error(erro.stack || erro.message || erro);
  process.exitCode = 1;
});
