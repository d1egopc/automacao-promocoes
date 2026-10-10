"use strict";

// Local cutover candidate. Phase A is additive and accepts duplicate legacy
// keys. Phase B advances an ID keyset in bounded transactions; phase C is an
// explicit final verification. No production bootstrap imports this module.
const { projectionDdl } = require("./lifecycle-steady.candidate");
const fs = require("node:fs");
const path = require("node:path");

const HOT = ["pendente", "diagnosticado", "validando", "pronto",
  "pronto_para_importar", "processando", "importando", "distribuindo",
  "executando", "retry", "agendado", "claimed", "bloqueado",
  "pronto_sem_utilidade"];

async function instalarFaseA(client) {
  await client.query(projectionDdl());
  await client.query(`CREATE INDEX engine_legacy_keyset_candidate_idx
    ON engine_jobs_cliente (evento_id,cliente_id,id)`);
  await client.query(`CREATE TABLE engine_legacy_job_alias_candidate (
    old_job_id bigint PRIMARY KEY,canonical_job_id bigint NOT NULL)`);
  await client.query(`CREATE TABLE engine_legacy_duplicate_keys_candidate (
    evento_id bigint NOT NULL,cliente_id text NOT NULL,
    PRIMARY KEY(evento_id,cliente_id))`);
  // One discovery pass at Phase A, not one global GROUP BY per drain batch.
  await client.query(`INSERT INTO engine_legacy_duplicate_keys_candidate
    (evento_id,cliente_id)
    SELECT evento_id,cliente_id FROM engine_jobs_cliente
    GROUP BY evento_id,cliente_id HAVING count(*)>1`);
}

function criarLegacyDrainEngineCandidato({ pool, inspectExternalReferences,
  limitMax = 100 } = {}) {
  if (!pool || typeof pool.connect !== "function" ||
      typeof inspectExternalReferences !== "function") {
    throw new Error("legacy_engine_drain_inventory_required");
  }
  let cursor = 0;
  let ceiling = null;
  let duplicateCheck = null;
  const unsafe = new Map();
  const max = Math.max(1, Math.min(100, Number(limitMax) || 100));
  async function tick({ limit = max } = {}) {
    const client = await pool.connect();
    let tx = false;
    try {
      await client.query("BEGIN"); tx = true;
      await client.query("SET LOCAL lock_timeout='500ms'");
      await client.query("SET LOCAL statement_timeout='10000ms'");
      if (ceiling === null) ceiling = Number((await client.query(
        "SELECT COALESCE(max(id),0) AS id FROM engine_jobs_cliente"
      )).rows[0].id);
      const bounded = Math.max(1, Math.min(max, Number(limit) || max));
      const rows = (await client.query(`SELECT id,evento_id,cliente_id
        FROM engine_jobs_cliente WHERE id>$1 AND id<=$2
        ORDER BY id LIMIT $3 FOR UPDATE`,
      [cursor,ceiling,bounded])).rows;
      const keys = (await client.query(`SELECT DISTINCT d.evento_id,d.cliente_id
        FROM engine_legacy_duplicate_keys_candidate d
        JOIN engine_jobs_cliente j USING (evento_id,cliente_id)
        WHERE j.id=ANY($1::bigint[])`, [rows.map(row => row.id)])).rows;
      let reconciled = 0;
      for (const row of keys) {
        const key = `${row.evento_id}:${row.cliente_id}`;
        const group = (await client.query(`SELECT j.id,j.status,j.tentativas,
          j.oferta_id,j.metadata,
          EXISTS(SELECT 1 FROM engine_processamentos p WHERE p.job_id=j.id) AS processed,
          EXISTS(SELECT 1 FROM engine_eventos_comerciais c WHERE c.job_id=j.id) AS commercial
          FROM engine_jobs_cliente j
          WHERE j.evento_id=$1 AND j.cliente_id=$2
          ORDER BY j.id FOR UPDATE OF j`,
        [row.evento_id,row.cliente_id])).rows;
        if (group.length < 2) continue;
        const external = new Map();
        for (const member of group) {
          const references = await inspectExternalReferences(client, member.id);
          if (!Number.isInteger(references) || references < 0) {
            throw new Error("legacy_external_inventory_unknown");
          }
          external.set(String(member.id), references);
        }
        const pristine = member => member.status === "pendente" &&
          Number(member.tentativas || 0) === 0 && member.oferta_id === null &&
          Object.keys(member.metadata || {}).length === 0 &&
          !member.processed && !member.commercial &&
          external.get(String(member.id)) === 0;
        const owners = group.filter(member => !pristine(member));
        if (owners.length > 1) {
          unsafe.set(key, group.map(member => Number(member.id)));
          continue;
        }
        const canonical = owners[0] || group[0];
        for (const member of group) {
          if (member.id === canonical.id) continue;
          if (!pristine(member)) throw new Error("legacy_classification_changed");
          const deleted = await client.query(`DELETE FROM engine_jobs_cliente j
            WHERE j.id=$1 AND j.status='pendente' AND j.tentativas=0
              AND j.oferta_id IS NULL AND j.metadata='{}'::jsonb
              AND NOT EXISTS (SELECT 1 FROM engine_processamentos p WHERE p.job_id=j.id)
              AND NOT EXISTS (SELECT 1 FROM engine_eventos_comerciais c WHERE c.job_id=j.id)
            RETURNING id`, [member.id]);
          if (deleted.rowCount !== 1) throw new Error("legacy_reference_changed");
          await client.query(`INSERT INTO engine_legacy_job_alias_candidate
            (old_job_id,canonical_job_id) VALUES ($1,$2)`,
          [member.id,canonical.id]);
          reconciled++;
        }
      }
      const ids = rows.map(row => row.id);
      if (ids.length) await client.query(`UPDATE engine_jobs_cliente
        SET metadata=metadata WHERE id=ANY($1::bigint[])`, [ids]);
      const nextCursor = rows.length ? Number(rows[rows.length - 1].id) : cursor;
      await client.query("COMMIT"); tx = false;
      cursor = nextCursor;
      if (rows.length) return { ok: true, processed: rows.length,
        reconciled, completed: false, cursor, ceiling,
        unsafeGroups: unsafe.size };
      // Global duplicate verification runs once after the keyset pass, never
      // once per batch. Phase D must reverify under its own cutover lock.
      if (duplicateCheck === null) duplicateCheck = (await client.query(`
        SELECT evento_id,cliente_id FROM engine_jobs_cliente
        GROUP BY evento_id,cliente_id HAVING count(*)>1 LIMIT 1`)).rowCount;
      const legacyHot = (await client.query(`SELECT 1 FROM engine_jobs_cliente
        WHERE id<=$1 AND status=ANY($2::text[]) LIMIT 1`,
      [ceiling,HOT])).rowCount;
      return { ok: true, processed: 0, reconciled: 0,
        completed: duplicateCheck === 0 && legacyHot === 0 && unsafe.size === 0,
        cursor, ceiling, unsafeGroups: unsafe.size,
        duplicatesRemain: duplicateCheck > 0, legacyHotRemain: legacyHot > 0 };
    } catch (error) {
      if (tx) await client.query("ROLLBACK").catch(() => {});
      return { ok: false, processed: 0, completed: false,
        error: String(error.message || error) };
    } finally { client.release(); }
  }
  return { tick, state: () => ({ cursor, ceiling, unsafeGroups: unsafe.size }) };
}

async function instalarFaseD(client) {
  let tx = false;
  try {
    await client.query("BEGIN"); tx = true;
    // Cutover-only lock closes the write race between verification and index
    // creation. It is never held by Phase B's bounded drain transactions.
    await client.query("LOCK TABLE engine_jobs_cliente IN SHARE ROW EXCLUSIVE MODE");
    const duplicate = (await client.query(`SELECT evento_id,cliente_id
      FROM engine_jobs_cliente GROUP BY evento_id,cliente_id
      HAVING count(*)>1 LIMIT 1`)).rowCount > 0;
    const hot = (await client.query(`SELECT 1 FROM engine_jobs_cliente
      WHERE status=ANY($1::text[]) LIMIT 1`, [HOT])).rowCount > 0;
    const unprojected = (await client.query(`SELECT 1 FROM engine_jobs_cliente j
      JOIN engine_eventos_brutos e ON e.id=j.evento_id
      WHERE j.status='expirada_operacional' AND j.terminal_due_at IS NOT NULL
      LIMIT 1`)).rowCount > 0;
    if (duplicate || hot || unprojected) {
      throw new Error(`UF_PHASE_D_PREFLIGHT_DENIED:duplicate=${duplicate}:hot=${hot}:projection=${unprojected}`);
    }
    const source = fs.readFileSync(path.join(__dirname,
      "admission-gate.candidate.sql"), "utf8");
    const marker = "END $$;";
    const end = source.indexOf(marker);
    if (end < 0 || !source.slice(0, end).includes("UF_LEGACY_RECONCILIATION_REQUIRED")) {
      throw new Error("UF_PHASE_D_ADMISSION_SOURCE_UNRECOGNIZED");
    }
    await client.query(source.slice(end + marker.length));
    await client.query("COMMIT"); tx = false;
    return { ok: true, duplicate: false, hot: false };
  } catch (error) {
    if (tx) await client.query("ROLLBACK").catch(() => {});
    return { ok: false, error: String(error.message || error) };
  }
}

module.exports = { instalarFaseA, criarLegacyDrainEngineCandidato,
  instalarFaseD };
