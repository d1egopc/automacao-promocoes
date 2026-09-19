"use strict";

const crypto = require("crypto");
const { getEnginePool } = require("../engine/database");

const STATUS = Object.freeze({
  PENDING: "pending",
  LEASED: "leased",
  COMPLETED: "completed",
  FAILED: "failed",
  EXPIRED: "expired"
});

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function jsonSeguro(valor, padrao = {}) {
  return valor && typeof valor === "object" ? valor : padrao;
}

function tokenSeguro(prefixo = "lw") {
  return `${prefixo}_${crypto.randomBytes(24).toString("base64url")}`;
}

function hashToken(token = "") {
  return crypto.createHash("sha256").update(texto(token)).digest("hex");
}

function poolDisponivel(provider) {
  const pool = typeof provider === "function" ? provider() : provider;
  return pool && typeof pool.query === "function" ? pool : null;
}

function payloadTask(row = {}) {
  return {
    id: String(row.id || ""),
    type: texto(row.type),
    marketplace: texto(row.marketplace),
    productId: texto(row.product_id || row.productId),
    sourceUrl: texto(row.source_url || row.sourceUrl),
    technicalSlug: texto(row.technical_slug || row.technicalSlug),
    status: texto(row.status),
    capability: texto(row.capability),
    leaseToken: texto(row.lease_token || row.leaseToken),
    leaseUntil: row.lease_until || row.leaseUntil || null,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || row.maxAttempts || 3),
    createdAt: row.created_at || row.createdAt || null,
    expiresAt: row.expires_at || row.expiresAt || null
  };
}

function criarLocalWorkerRepository(opcoes = {}) {
  const poolProvider = opcoes.pool || opcoes.getPool || getEnginePool;
  let schemaPromise = null;

  async function ensureSchema({ tokenTtlMs = 30 * 24 * 60 * 60 * 1000, dedicatedOwnerIds = [] } = {}) {
    if (schemaPromise) return schemaPromise;
    schemaPromise = (async () => {
      const pool = poolDisponivel(poolProvider);
      if (!pool) return { ok: false, motivo: "database_indisponivel" };
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS local_worker_workers (
            worker_id TEXT PRIMARY KEY,
            worker_type TEXT NOT NULL DEFAULT 'community',
            token_hash TEXT NOT NULL UNIQUE,
            owner_id TEXT,
            capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            expires_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ
          );
          CREATE TABLE IF NOT EXISTS local_worker_tasks (
            id BIGSERIAL PRIMARY KEY,
            type TEXT NOT NULL,
            marketplace TEXT NOT NULL,
            product_id TEXT NOT NULL,
            source_url TEXT NOT NULL DEFAULT '',
            technical_slug TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            capability TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            claimed_by TEXT,
            lease_token TEXT,
            lease_until TIMESTAMPTZ,
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            result_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
          );
          CREATE UNIQUE INDEX IF NOT EXISTS local_worker_tasks_active_unique
            ON local_worker_tasks (marketplace, product_id, type)
            WHERE status IN ('pending', 'leased');
          -- Terminal rows remain immutable history; only active rows dedupe.
          CREATE UNIQUE INDEX IF NOT EXISTS local_worker_tasks_active_idempotency_unique
            ON local_worker_tasks (idempotency_key)
            WHERE status IN ('pending', 'leased');
          CREATE INDEX IF NOT EXISTS local_worker_tasks_claim_idx
            ON local_worker_tasks (status, capability, lease_until, created_at);
          CREATE TABLE IF NOT EXISTS local_worker_image_cache (
            marketplace TEXT NOT NULL,
            product_id TEXT NOT NULL,
            image_url TEXT NOT NULL,
            source TEXT NOT NULL,
            proof JSONB NOT NULL DEFAULT '{}'::jsonb,
            validated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ,
            PRIMARY KEY (marketplace, product_id)
          );
          ALTER TABLE local_worker_workers ADD COLUMN IF NOT EXISTS worker_type TEXT NOT NULL DEFAULT 'community';
          ALTER TABLE local_worker_workers ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
          ALTER TABLE local_worker_workers ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
          ALTER TABLE local_worker_tasks ADD COLUMN IF NOT EXISTS technical_slug TEXT NOT NULL DEFAULT '';
          ALTER TABLE local_worker_workers ALTER COLUMN worker_type SET DEFAULT 'community';
        `);
        const owners = Array.isArray(dedicatedOwnerIds) ? dedicatedOwnerIds.map(texto).filter(Boolean) : [];
        if (owners.length) {
          await pool.query(
            `UPDATE local_worker_workers
                SET worker_type = 'community', updated_at = NOW()
              WHERE worker_type = 'dedicated'
                AND COALESCE(owner_id, '') <> ALL($1::text[])`,
            [owners]
          );
        }
        await pool.query(
          `UPDATE local_worker_workers
              SET expires_at = NOW() + ($1::bigint * INTERVAL '1 millisecond'), updated_at = NOW()
            WHERE expires_at IS NULL AND active = TRUE AND revoked_at IS NULL`,
          [Math.max(60_000, Number(tokenTtlMs) || 30 * 24 * 60 * 60 * 1000)]
        );
        return { ok: true };
      } catch (erro) {
        schemaPromise = null;
        return { ok: false, motivo: "schema_local_worker_falhou", erro: erro.message };
      }
    })();
    return schemaPromise;
  }

  async function registrarWorkerCommunity({ workerId = "", ownerId = "", capabilities = [], tokenTtlMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
    const pool = poolDisponivel(poolProvider);
    if (!pool) return { ok: false, motivo: "database_indisponivel" };
    const id = texto(workerId) || tokenSeguro("worker");
    const token = tokenSeguro("local");
    const ttl = Math.max(60_000, Number(tokenTtlMs) || 30 * 24 * 60 * 60 * 1000);
    const result = await pool.query(`
      INSERT INTO local_worker_workers (worker_id, worker_type, token_hash, owner_id, capabilities, active, expires_at, revoked_at, updated_at)
      VALUES ($1, 'community', $2, $3, $4::jsonb, TRUE, NOW() + ($5::bigint * INTERVAL '1 millisecond'), NULL, NOW())
      ON CONFLICT (worker_id) DO UPDATE SET
        token_hash = EXCLUDED.token_hash,
        owner_id = EXCLUDED.owner_id,
        worker_type = 'community',
        capabilities = EXCLUDED.capabilities,
        active = TRUE,
        expires_at = EXCLUDED.expires_at,
        revoked_at = NULL,
        updated_at = NOW()
        WHERE local_worker_workers.owner_id = EXCLUDED.owner_id OR local_worker_workers.owner_id IS NULL
      RETURNING worker_id, worker_type, capabilities, active, expires_at;
    `, [id, hashToken(token), texto(ownerId) || null, JSON.stringify(Array.isArray(capabilities) ? capabilities : []), ttl]);
    if (!result.rows[0]) return { ok: false, motivo: "worker_id_em_uso" };
    return { ok: true, workerId: id, token, workerType: "community", capabilities: result.rows[0]?.capabilities || [], expiresAt: result.rows[0]?.expires_at || null };
  }

  async function registrarWorkerDedicated({ workerId = "", ownerId = "", capabilities = [], tokenTtlMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
    const pool = poolDisponivel(poolProvider);
    if (!pool) return { ok: false, motivo: "database_indisponivel" };
    const id = texto(workerId) || tokenSeguro("worker");
    const token = tokenSeguro("local");
    const ttl = Math.max(60_000, Number(tokenTtlMs) || 30 * 24 * 60 * 60 * 1000);
    const result = await pool.query(`
      INSERT INTO local_worker_workers (worker_id, worker_type, token_hash, owner_id, capabilities, active, expires_at, revoked_at, updated_at)
      VALUES ($1, 'dedicated', $2, $3, $4::jsonb, TRUE, NOW() + ($5::bigint * INTERVAL '1 millisecond'), NULL, NOW())
      ON CONFLICT (worker_id) DO UPDATE SET
        token_hash = EXCLUDED.token_hash,
        owner_id = EXCLUDED.owner_id,
        worker_type = 'dedicated',
        capabilities = EXCLUDED.capabilities,
        active = TRUE,
        expires_at = EXCLUDED.expires_at,
        revoked_at = NULL,
        updated_at = NOW()
        WHERE local_worker_workers.owner_id = EXCLUDED.owner_id OR local_worker_workers.owner_id IS NULL
      RETURNING worker_id, capabilities, active, expires_at;
    `, [id, hashToken(token), texto(ownerId) || null, JSON.stringify(Array.isArray(capabilities) ? capabilities : []), ttl]);
    if (!result.rows[0]) return { ok: false, motivo: "worker_id_em_uso" };
    return { ok: true, workerId: id, token, workerType: "dedicated", capabilities: result.rows[0]?.capabilities || [], expiresAt: result.rows[0]?.expires_at || null };
  }

  async function autenticarWorker(token = "") {
    const pool = poolDisponivel(poolProvider);
    if (!pool || !texto(token)) return { ok: false, motivo: "worker_nao_autenticado" };
    const result = await pool.query(`
      SELECT worker_id, owner_id, worker_type, capabilities, active, expires_at
      FROM local_worker_workers
       WHERE token_hash = $1 AND active = TRUE AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
    `, [hashToken(token)]);
    const row = result.rows[0];
    if (!row) return { ok: false, motivo: "worker_nao_autenticado" };
    await pool.query("UPDATE local_worker_workers SET last_seen_at = NOW(), updated_at = NOW() WHERE worker_id = $1", [row.worker_id]);
    return { ok: true, workerId: row.worker_id, ownerId: row.owner_id || "", workerType: row.worker_type, capabilities: row.capabilities || [], expiresAt: row.expires_at || null };
  }

  async function revogarWorker({ workerId = "", ownerId = "" } = {}) {
    const pool = poolDisponivel(poolProvider);
    if (!pool || !texto(workerId)) return { ok: false, motivo: "worker_nao_encontrado" };
    const result = await pool.query(
      `UPDATE local_worker_workers
          SET active = FALSE, revoked_at = NOW(), updated_at = NOW()
        WHERE worker_id = $1 AND ($2 = '' OR owner_id = $2)
        RETURNING worker_id`,
      [texto(workerId), texto(ownerId)]
    );
    return result.rows[0] ? { ok: true, workerId: result.rows[0].worker_id } : { ok: false, motivo: "worker_nao_encontrado" };
  }

  async function terminalizarTasksComTtlExpirado(queryable) {
    return queryable.query(`
      UPDATE local_worker_tasks
         SET status = 'expired', claimed_by = NULL, lease_token = NULL,
             lease_until = NULL, updated_at = NOW()
       WHERE status IN ('pending', 'leased')
         AND expires_at IS NOT NULL
         AND expires_at <= NOW()
      RETURNING id, status, attempts, max_attempts
    `);
  }

  async function garantirTask({ type, marketplace, productId, sourceUrl = "", technicalSlug = "", capability, idempotencyKey = "", maxAttempts = 3, ttlMs = 15 * 60 * 1000 } = {}) {
    const pool = poolDisponivel(poolProvider);
    if (!pool) return { ok: false, motivo: "database_indisponivel" };
    await ensureSchema();
    await terminalizarTasksComTtlExpirado(pool);
    const tipo = texto(type), mp = texto(marketplace).toLowerCase(), pid = texto(productId), cap = texto(capability);
    if (!tipo || !mp || !pid || !cap) return { ok: false, motivo: "task_invalida" };
    const idem = texto(idempotencyKey) || `${mp}:${pid}:${tipo}`;
    const existente = await pool.query(`
      SELECT * FROM local_worker_tasks
      WHERE marketplace = $1 AND product_id = $2 AND type = $3
      ORDER BY id DESC LIMIT 1
    `, [mp, pid, tipo]);
    if (existente.rows[0] && [STATUS.PENDING, STATUS.LEASED, STATUS.COMPLETED].includes(existente.rows[0].status)) {
      return { ok: true, criada: false, task: payloadTask(existente.rows[0]) };
    }
    const result = await pool.query(`
      INSERT INTO local_worker_tasks
        (type, marketplace, product_id, source_url, technical_slug, status, capability, idempotency_key, max_attempts, expires_at)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, NOW() + ($9::bigint * INTERVAL '1 millisecond'))
      ON CONFLICT DO NOTHING RETURNING *
    `, [tipo, mp, pid, texto(sourceUrl), texto(technicalSlug), cap, idem, Math.max(1, Number(maxAttempts) || 3), Math.max(1000, Number(ttlMs) || 900000)]);
    if (result.rows[0]) return { ok: true, criada: true, task: payloadTask(result.rows[0]) };
    const repetida = await pool.query(`SELECT * FROM local_worker_tasks WHERE marketplace = $1 AND product_id = $2 AND type = $3 AND status IN ('pending', 'leased') ORDER BY id DESC LIMIT 1`, [mp, pid, tipo]);
    return repetida.rows[0] ? { ok: true, criada: false, task: payloadTask(repetida.rows[0]) } : { ok: false, motivo: "task_concorrente_nao_localizada" };
  }

  async function claim({ workerId, capabilities = [], leaseMs = 90000 } = {}) {
    const pool = poolDisponivel(poolProvider);
    if (!pool) return { ok: false, motivo: "database_indisponivel" };
    const client = await pool.connect();
    const leaseToken = tokenSeguro("lease");
    try {
      await client.query("BEGIN");
      await terminalizarTasksComTtlExpirado(client);
      await client.query(`UPDATE local_worker_tasks SET status = 'failed', claimed_by = NULL, lease_token = NULL, lease_until = NULL, updated_at = NOW() WHERE status = 'leased' AND lease_until <= NOW() AND attempts >= max_attempts`);
      const result = await client.query(`
        WITH candidato AS (
          SELECT id FROM local_worker_tasks
          WHERE capability = ANY($1::text[])
            AND attempts < max_attempts
            AND (status = 'pending' OR (status = 'leased' AND lease_until <= NOW()))
            AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE local_worker_tasks t
        SET status = 'leased', claimed_by = $2, lease_token = $3,
            lease_until = NOW() + ($4::bigint * INTERVAL '1 millisecond'),
            attempts = attempts + 1, updated_at = NOW()
        FROM candidato c WHERE t.id = c.id
        RETURNING t.*
      `, [Array.isArray(capabilities) ? capabilities : [], texto(workerId), leaseToken, Math.max(10000, Number(leaseMs) || 90000)]);
      await client.query("COMMIT");
      return result.rows[0] ? { ok: true, task: payloadTask(result.rows[0]) } : { ok: true, task: null };
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      return { ok: false, motivo: "claim_falhou", erro: erro.message };
    } finally { client.release(); }
  }

  async function heartbeat({ taskId, workerId, leaseToken, leaseMs = 90000 } = {}) {
    const pool = poolDisponivel(poolProvider);
    if (!pool) return { ok: false, motivo: "database_indisponivel" };
    const result = await pool.query(`
      UPDATE local_worker_tasks SET lease_until = NOW() + ($4::bigint * INTERVAL '1 millisecond'), updated_at = NOW()
      WHERE id = $1 AND status = 'leased' AND claimed_by = $2 AND lease_token = $3 AND lease_until > NOW()
      RETURNING id, lease_until
    `, [String(taskId), texto(workerId), texto(leaseToken), Math.max(10000, Number(leaseMs) || 90000)]);
    return result.rows[0] ? { ok: true, leaseUntil: result.rows[0].lease_until } : { ok: false, motivo: "lease_invalido" };
  }

  async function obterTask(taskId) {
    const pool = poolDisponivel(poolProvider);
    if (!pool) return null;
    const result = await pool.query("SELECT * FROM local_worker_tasks WHERE id = $1", [String(taskId)]);
    return result.rows[0] || null;
  }

  async function obterTaskAtiva({ marketplace, productId, type } = {}) {
    const pool = poolDisponivel(poolProvider);
    if (!pool) return null;
    const result = await pool.query(`SELECT * FROM local_worker_tasks WHERE marketplace = $1 AND product_id = $2 AND type = $3 AND status IN ('pending', 'leased') ORDER BY id DESC LIMIT 1`, [texto(marketplace).toLowerCase(), texto(productId), texto(type)]);
    return result.rows[0] ? payloadTask(result.rows[0]) : null;
  }

  async function completar({ taskId, workerId, leaseToken, metadata = {}, imageUrl = "", proof = {} } = {}) {
    const pool = poolDisponivel(poolProvider);
    if (!pool) return { ok: false, motivo: "database_indisponivel" };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const atual = await client.query("SELECT * FROM local_worker_tasks WHERE id = $1 FOR UPDATE", [String(taskId)]);
      const row = atual.rows[0];
      if (!row) { await client.query("ROLLBACK"); return { ok: false, motivo: "task_inexistente" }; }
      if (row.status === STATUS.COMPLETED) { await client.query("COMMIT"); return { ok: true, idempotente: true, task: payloadTask(row) }; }
      if (row.status !== STATUS.LEASED || row.claimed_by !== texto(workerId) || row.lease_token !== texto(leaseToken) || new Date(row.lease_until).getTime() <= Date.now()) {
        await client.query("ROLLBACK"); return { ok: false, motivo: "lease_invalido" };
      }
      const meta = { ...jsonSeguro(metadata), productId: row.product_id, imageUrl, source: "local_first_party", proof };
      const atualizado = await client.query(`UPDATE local_worker_tasks SET status = 'completed', completed_at = NOW(), lease_until = NULL, lease_token = NULL, updated_at = NOW(), result_metadata = $2::jsonb WHERE id = $1 RETURNING *`, [String(taskId), JSON.stringify(meta)]);
      await client.query(`INSERT INTO local_worker_image_cache (marketplace, product_id, image_url, source, proof, validated_at, expires_at) VALUES ($1, $2, $3, 'local_first_party', $4::jsonb, NOW(), NOW() + INTERVAL '24 hours') ON CONFLICT (marketplace, product_id) DO UPDATE SET image_url = EXCLUDED.image_url, source = EXCLUDED.source, proof = EXCLUDED.proof, validated_at = NOW(), expires_at = EXCLUDED.expires_at`, [row.marketplace, row.product_id, imageUrl, JSON.stringify(proof)]);
      await client.query("COMMIT");
      return { ok: true, idempotente: false, task: payloadTask(atualizado.rows[0]) };
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      return { ok: false, motivo: "resultado_falhou", erro: erro.message };
    } finally { client.release(); }
  }

  async function falhar({ taskId, workerId, leaseToken, metadata = {}, motivo = "resultado_invalido" } = {}) {
    const pool = poolDisponivel(poolProvider);
    if (!pool) return { ok: false, motivo: "database_indisponivel" };
    const result = await pool.query(`UPDATE local_worker_tasks SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END, claimed_by = NULL, lease_token = NULL, lease_until = NULL, updated_at = NOW(), result_metadata = $4::jsonb WHERE id = $1 AND status = 'leased' AND claimed_by = $2 AND lease_token = $3 AND lease_until > NOW() RETURNING *`, [String(taskId), texto(workerId), texto(leaseToken), JSON.stringify({ ...jsonSeguro(metadata), motivo })]);
    return result.rows[0] ? { ok: true, task: payloadTask(result.rows[0]) } : { ok: false, motivo: "lease_invalido" };
  }

  async function obterCache({ marketplace, productId } = {}) {
    const pool = poolDisponivel(poolProvider);
    if (!pool) return null;
    const result = await pool.query(`SELECT * FROM local_worker_image_cache WHERE marketplace = $1 AND product_id = $2 AND (expires_at IS NULL OR expires_at > NOW())`, [texto(marketplace).toLowerCase(), texto(productId)]);
    const row = result.rows[0];
    return row ? { marketplace: row.marketplace, productId: row.product_id, imageUrl: row.image_url, source: row.source, proof: row.proof || {}, validatedAt: row.validated_at, expiresAt: row.expires_at } : null;
  }

  async function status() {
    const pool = poolDisponivel(poolProvider);
    if (!pool) return { ok: false, motivo: "database_indisponivel" };
    const result = await pool.query("SELECT status, COUNT(*)::int AS total FROM local_worker_tasks GROUP BY status");
    return { ok: true, counts: Object.fromEntries(result.rows.map(row => [row.status, Number(row.total)])) };
  }

  async function revogarWorker({ workerId = "", ownerId = "" } = {}) {
    const pool = poolDisponivel(poolProvider);
    if (!pool || !texto(workerId)) return { ok: false, motivo: "worker_nao_encontrado" };
    const result = await pool.query(
      `UPDATE local_worker_workers
          SET active = FALSE, revoked_at = NOW(), updated_at = NOW()
        WHERE worker_id = $1 AND ($2 = '' OR owner_id = $2)
        RETURNING worker_id`,
      [texto(workerId), texto(ownerId)]
    );
    return result.rows[0] ? { ok: true, workerId: result.rows[0].worker_id } : { ok: false, motivo: "worker_nao_encontrado" };
  }

  return { ensureSchema, registrarWorkerCommunity, registrarWorkerDedicated, autenticarWorker, revogarWorker, garantirTask, claim, heartbeat, obterTask, obterTaskAtiva, completar, falhar, obterCache, status };
}

module.exports = { STATUS, criarLocalWorkerRepository, hashToken };
