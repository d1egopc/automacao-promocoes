"use strict";

// Candidato local, deliberadamente nao conectado ao orquestrador.
// A transicao, o fato e o cursor de fairness compartilham uma transacao.
const { getEnginePool } = require("./database");
const {
  MOTIVO_FRESCOR_PRE_IMPORTER,
  STATUS_FINAL_FRESCOR_PRE_IMPORTER,
  sqlFrescorComercialPreImporter,
  sqlRetryPreImporter
} = require("./frescor-pre-importer.service");
const { registrarAtendimentoWorkspaceFairness } = require("./origem-fairness.repository");

const STATUS_TERMINALIZAVEIS = Object.freeze([
  "pendente", "diagnosticado", "pronto_para_importar", "pronto_sem_utilidade"
]);
const CHAVE_FAIRNESS_TERMINALIZER = Object.freeze({
  etapa: "diagnostico_final", lane: "expirada"
});

function limitarLoteTerminalizer(valor = 10) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.max(1, Math.min(50, Math.floor(numero))) : 10;
}

function sqlElegibilidadeTerminalizer(opcoes = {}) {
  const frescor = sqlFrescorComercialPreImporter("j", "e", { agoraSql: opcoes.agoraSql });
  const retry = sqlRetryPreImporter("j", { agoraSql: opcoes.agoraSql });
  return `j.status = ANY($1::text[]) AND ${frescor.morto} AND NOT COALESCE(${retry.futuro}, FALSE)`;
}

async function terminalizarJobsPreImporter({ limite = 10, pool = getEnginePool(), timeoutMs = 5000 } = {}) {
  if (!pool || typeof pool.connect !== "function") {
    return { ok: false, motivo: "pool_indisponivel", terminalizados: [] };
  }
  const client = await pool.connect();
  let transacao = false;
  try {
    await client.query("BEGIN");
    transacao = true;
    const timeoutFinal = Math.max(100, Math.min(30000, Math.floor(Number(timeoutMs) || 5000)));
    const deadline = Date.now() + timeoutFinal;
    await client.query(`SET LOCAL statement_timeout = '${timeoutFinal}ms'`);
    await client.query("SET LOCAL lock_timeout = '500ms'");
    const lease = await client.query(`SELECT pg_try_advisory_xact_lock(
      hashtext('engine'), hashtext('terminalizer_pre_importer')) AS adquirido`);
    if (lease.rows[0]?.adquirido !== true) {
      await client.query("COMMIT");
      transacao = false;
      return { ok: true, pulado: true, motivo: "lifecycle_lease_ocupada", terminalizados: [] };
    }
    const inicioBootstrap = performance.now();
    const elegivel = sqlElegibilidadeTerminalizer();
    const params = [STATUS_TERMINALIZAVEIS, limitarLoteTerminalizer(limite)];

    // Nenhum job e trazido ao Node para construir o universo de workspaces.
    await client.query(
      `INSERT INTO engine_fairness_origem_fluxo (cliente_id, etapa, lane)
       SELECT DISTINCT COALESCE(NULLIF(BTRIM(j.cliente_id), ''), 'workspace_desconhecido'),
              'diagnostico_final', 'expirada'
         FROM engine_jobs_cliente j
         LEFT JOIN engine_eventos_brutos e ON e.id = j.evento_id
        WHERE ${elegivel}
       ON CONFLICT (cliente_id, etapa, lane) DO NOTHING`, [params[0]]
    );
    const bootstrapMs = Math.round(performance.now() - inicioBootstrap);

    const inicioSelecao = performance.now();
    const selecionados = await client.query(
      `WITH heads AS MATERIALIZED (
         SELECT DISTINCT ON (COALESCE(NULLIF(BTRIM(j.cliente_id), ''), 'workspace_desconhecido'))
                COALESCE(NULLIF(BTRIM(j.cliente_id), ''), 'workspace_desconhecido') AS cliente_id,
                j.id
           FROM engine_jobs_cliente j
           LEFT JOIN engine_eventos_brutos e ON e.id = j.evento_id
          WHERE ${elegivel}
          ORDER BY COALESCE(NULLIF(BTRIM(j.cliente_id), ''), 'workspace_desconhecido'),
                   j.criado_em ASC, j.id ASC
       )
       SELECT h.cliente_id, h.id
         FROM heads h
         JOIN engine_fairness_origem_fluxo f
           ON f.cliente_id = h.cliente_id
          AND f.etapa = 'diagnostico_final' AND f.lane = 'expirada'
        ORDER BY f.ultimo_atendimento_em ASC NULLS FIRST, f.cliente_id ASC
        LIMIT $2
        FOR UPDATE OF f SKIP LOCKED`, params
    );
    const selecaoMs = Math.round(performance.now() - inicioSelecao);

    const terminalizados = [];
    for (const candidato of selecionados.rows) {
      if (Date.now() >= deadline) throw new Error("lifecycle_batch_deadline_exceeded");
      const bloqueado = await client.query(
        "SELECT id FROM engine_jobs_cliente WHERE id=$1 FOR UPDATE SKIP LOCKED", [candidato.id]
      );
      if (!bloqueado.rows.length) continue;
      const aindaElegivel = await client.query(
        `WITH instante AS (SELECT clock_timestamp() AS agora)
         SELECT j.id FROM engine_jobs_cliente j
         LEFT JOIN engine_eventos_brutos e ON e.id=j.evento_id
         CROSS JOIN instante
         WHERE j.id=$2 AND ${sqlElegibilidadeTerminalizer({ agoraSql: "instante.agora" })}`,
        [params[0], candidato.id]
      );
      if (!aindaElegivel.rows.length) continue;
      const transicao = await client.query(
        `UPDATE engine_jobs_cliente j
            SET status = $2,
                motivo_final = $3,
                metadata = jsonb_set(
                  COALESCE(j.metadata, '{}'::jsonb), '{terminalOcorridoEm}',
                  COALESCE(NULLIF(j.metadata->'terminalOcorridoEm', 'null'::jsonb), to_jsonb(clock_timestamp())),
                  true
                ),
                atualizado_em = NOW()
          WHERE j.id = $1 AND j.status = ANY($4::text[])
          RETURNING j.id, j.cliente_id, j.evento_id, j.status,
                    j.metadata->>'terminalOcorridoEm' AS terminal_ocorrido_em`,
        [candidato.id, STATUS_FINAL_FRESCOR_PRE_IMPORTER, MOTIVO_FRESCOR_PRE_IMPORTER, params[0]]
      );
      const job = transicao.rows[0];
      if (!job) continue;
      await client.query(
        `INSERT INTO engine_processamentos (job_id, etapa, status, motivo, detalhes)
         VALUES ($1, 'frescor_pre_importer', 'expirada', $2,
                 jsonb_build_object('terminalOcorridoEm', $3::text))`,
        [job.id, MOTIVO_FRESCOR_PRE_IMPORTER, job.terminal_ocorrido_em]
      );
      await client.query(
        `INSERT INTO engine_eventos_comerciais
           (tipo_evento, cliente_id, workspace_id, job_id, ocorrido_em, origem_pipeline,
            chave_idempotencia, metadata)
         VALUES ('job_expirada_operacional', $2, $2, $1, $3::timestamptz,
                 'engine_v2', $4, jsonb_build_object('motivo', $5::text))
         ON CONFLICT (chave_idempotencia) DO NOTHING`,
        [job.id, job.cliente_id, job.terminal_ocorrido_em,
          `frescor_pre_importer:job:${job.id}`, MOTIVO_FRESCOR_PRE_IMPORTER]
      );
      await registrarAtendimentoWorkspaceFairness(client, {
        clienteId: candidato.cliente_id,
        ...CHAVE_FAIRNESS_TERMINALIZER
      });
      terminalizados.push(job);
    }
    await client.query("COMMIT");
    transacao = false;
    return { ok: true, terminalizados, limite: params[1], bootstrapMs, selecaoMs };
  } catch (erro) {
    if (transacao) await client.query("ROLLBACK").catch(() => {});
    return { ok: false, motivo: "terminalizer_falhou", erro: erro.message || String(erro), terminalizados: [] };
  } finally {
    client.release();
  }
}

module.exports = {
  STATUS_TERMINALIZAVEIS,
  CHAVE_FAIRNESS_TERMINALIZER,
  limitarLoteTerminalizer,
  sqlElegibilidadeTerminalizer,
  terminalizarJobsPreImporter
};
