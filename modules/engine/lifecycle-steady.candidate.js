"use strict";

// Local-only projection and selector. The due calculation embeds the shared
// SQL freshness/retry expressions; it does not rank commercial candidates.
const {
  MOTIVO_FRESCOR_PRE_IMPORTER,
  STATUS_FINAL_FRESCOR_PRE_IMPORTER,
  sqlFrescorComercialPreImporter,
  sqlRetryPreImporter
} = require("./frescor-pre-importer.service");

const TERMINALIZABLE = "'pendente','diagnosticado','pronto_para_importar','pronto_sem_utilidade'";
const freshness = sqlFrescorComercialPreImporter("j", "e", {
  agoraSql: "instante.agora"
});
const retry = sqlRetryPreImporter("j", { agoraSql: "instante.agora" });

function projectionDdl() {
  return `ALTER TABLE engine_jobs_cliente
    ADD COLUMN terminal_due_at timestamptz;
  CREATE FUNCTION engine_terminal_due_candidate(
    p_evento_id bigint,p_metadata jsonb,p_criado_em timestamptz,p_status text)
  RETURNS timestamptz LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p_status IN (${TERMINALIZABLE}) AND NOT ${freshness.manual}
      THEN GREATEST(${freshness.expiraEm},
        to_timestamp((${retry.proximoEmMs})::double precision / 1000.0))
      ELSE NULL END
    FROM (SELECT p_metadata AS metadata,p_criado_em AS criado_em) j
    LEFT JOIN engine_eventos_brutos e ON e.id=p_evento_id
  $$;
  CREATE FUNCTION engine_terminal_due_maintain_candidate()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    NEW.terminal_due_at := engine_terminal_due_candidate(
      NEW.evento_id,NEW.metadata,NEW.criado_em,NEW.status);
    RETURN NEW;
  END $$;
  CREATE TRIGGER engine_terminal_due_maintain_candidate_trigger
    BEFORE INSERT OR UPDATE OF metadata,status,evento_id,criado_em
    ON engine_jobs_cliente FOR EACH ROW
    EXECUTE FUNCTION engine_terminal_due_maintain_candidate();
  CREATE INDEX engine_terminal_due_candidate_idx
    ON engine_jobs_cliente (terminal_due_at,id)
    WHERE terminal_due_at IS NOT NULL AND status IN (${TERMINALIZABLE});
  CREATE FUNCTION engine_event_capture_clock_immutable_candidate()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF NEW.capturado_em IS DISTINCT FROM OLD.capturado_em THEN
      RAISE EXCEPTION 'UF_CAPTURE_CLOCK_IMMUTABLE' USING ERRCODE='P0001';
    END IF;
    RETURN NEW;
  END $$;
  CREATE TRIGGER engine_event_capture_clock_immutable_candidate_trigger
    BEFORE UPDATE OF capturado_em ON engine_eventos_brutos
    FOR EACH ROW EXECUTE FUNCTION engine_event_capture_clock_immutable_candidate();
  CREATE FUNCTION engine_event_due_refresh_candidate()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF NEW.metadata IS DISTINCT FROM OLD.metadata
       OR NEW.origem IS DISTINCT FROM OLD.origem
       OR NEW.origem_tipo IS DISTINCT FROM OLD.origem_tipo THEN
      UPDATE engine_jobs_cliente SET metadata=metadata WHERE evento_id=NEW.id;
    END IF;
    RETURN NEW;
  END $$;
  CREATE TRIGGER engine_event_due_refresh_candidate_trigger
    AFTER UPDATE OF metadata,origem,origem_tipo ON engine_eventos_brutos
    FOR EACH ROW EXECUTE FUNCTION engine_event_due_refresh_candidate();`;
}

function selectorSql({ explain = false } = {}) {
  return `${explain ? "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)" : ""}
    SELECT j.id,j.terminal_due_at
      FROM engine_jobs_cliente j
     WHERE j.status IN (${TERMINALIZABLE})
       AND j.terminal_due_at IS NOT NULL
       AND j.terminal_due_at <= now()
     ORDER BY j.terminal_due_at ASC,j.id ASC
     LIMIT $1 FOR UPDATE SKIP LOCKED`;
}

function boundBatch(value) {
  const n = Number(value);
  return Number.isInteger(n) ? Math.max(1,Math.min(100,n)) : 10;
}

async function runSteadyLifecycle({ pool, limit = 10, timeoutMs = 5000 } = {}) {
  if (!pool || typeof pool.connect !== "function") return {
    ok: false, reason: "lifecycle_pool_missing", terminalized: [] };
  const client = await pool.connect();
  let tx = false;
  try {
    await client.query("BEGIN");
    tx = true;
    const timeout = Math.max(100,Math.min(30000,Math.floor(timeoutMs)));
    await client.query(`SET LOCAL statement_timeout='${timeout}ms'`);
    await client.query("SET LOCAL lock_timeout='500ms'");
    const lease = await client.query(`SELECT pg_try_advisory_xact_lock(
      hashtext('engine'),hashtext('steady_lifecycle')) AS acquired`);
    if (!lease.rows[0]?.acquired) {
      await client.query("COMMIT"); tx = false;
      return { ok: true, skipped: true, terminalized: [] };
    }
    const selected = await client.query(selectorSql(), [boundBatch(limit)]);
    const terminalized = [];
    const repaired = [];
    for (const candidate of selected.rows) {
      const current = await client.query(`WITH instante AS
        (SELECT clock_timestamp() AS agora)
        SELECT j.id,j.cliente_id,j.evento_id,j.terminal_due_at,
               ${freshness.expiraEm} AS factual_expiry
          FROM engine_jobs_cliente j
          LEFT JOIN engine_eventos_brutos e ON e.id=j.evento_id
          CROSS JOIN instante
         WHERE j.id=$1 AND j.status IN (${TERMINALIZABLE})
           AND ${freshness.morto}
           AND NOT COALESCE(${retry.futuro},FALSE)`, [candidate.id]);
      if (!current.rows.length) {
        await client.query(`UPDATE engine_jobs_cliente
          SET metadata=metadata WHERE id=$1`, [candidate.id]);
        repaired.push(candidate.id);
        continue;
      }
      const changed = await client.query(`UPDATE engine_jobs_cliente j
        SET status=$2,motivo_final=$3,
            metadata=jsonb_set(COALESCE(j.metadata,'{}'::jsonb),
              '{terminalOcorridoEm}',to_jsonb(clock_timestamp()),true),
            atualizado_em=clock_timestamp()
        WHERE j.id=$1 AND j.status IN (${TERMINALIZABLE})
        RETURNING j.id,j.cliente_id,j.evento_id,
          j.metadata->>'terminalOcorridoEm' AS occurred_at`,
      [candidate.id,STATUS_FINAL_FRESCOR_PRE_IMPORTER,
        MOTIVO_FRESCOR_PRE_IMPORTER]);
      const job = changed.rows[0];
      if (!job) continue;
      await client.query(`INSERT INTO engine_processamentos
        (job_id,etapa,status,motivo,detalhes)
        VALUES ($1,'frescor_pre_importer','expirada',$2,
          jsonb_build_object('terminalOcorridoEm',$3::text))`,
      [job.id,MOTIVO_FRESCOR_PRE_IMPORTER,job.occurred_at]);
      await client.query(`INSERT INTO engine_eventos_comerciais
        (tipo_evento,cliente_id,workspace_id,job_id,ocorrido_em,
         origem_pipeline,chave_idempotencia,metadata)
        VALUES ('job_expirada_operacional',$2,$2,$1,$3::timestamptz,
          'engine_v2',$4,jsonb_build_object('motivo',$5::text))
        ON CONFLICT (chave_idempotencia) DO NOTHING`,
      [job.id,job.cliente_id,job.occurred_at,
        `frescor_pre_importer:job:${job.id}`,MOTIVO_FRESCOR_PRE_IMPORTER]);
      terminalized.push(job);
    }
    await client.query("COMMIT"); tx = false;
    return { ok: true, selected: selected.rowCount,
      terminalized, repaired, limit: boundBatch(limit) };
  } catch (error) {
    if (tx) await client.query("ROLLBACK").catch(() => {});
    return { ok: false, reason: "steady_lifecycle_failed",
      error: String(error.message || error), terminalized: [] };
  } finally { client.release(); }
}

module.exports = { projectionDdl, selectorSql, runSteadyLifecycle };
