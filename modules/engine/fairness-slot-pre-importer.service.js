"use strict";

const { getEnginePool } = require("./database");
const {
  bloquearEstadoFairness,
  registrarAtendimentoWorkspaceFairness
} = require("./origem-fairness.repository");
const { sqlFrescorComercialPreImporter, sqlRetryPreImporter } = require("./frescor-pre-importer.service");

async function jobClaimadoAindaVivo(client, id, opcoes = {}) {
  const frescorClaim = sqlFrescorComercialPreImporter("j", "e", { agoraSql: "instante.agora" });
  const retry = sqlRetryPreImporter("j", { agoraSql: "instante.agora" });
  const resultado = await client.query(
    `WITH instante AS (SELECT clock_timestamp() AS agora)
     SELECT (${frescorClaim.vivo} AND ${opcoes.verificarRetry === true ? retry.vencido : "TRUE"}) AS vivo
       FROM engine_jobs_cliente j
       LEFT JOIN engine_eventos_brutos e ON e.id = j.evento_id
       CROSS JOIN instante
      WHERE j.id = $1`, [id]
  );
  return resultado.rows[0]?.vivo === true;
}

async function buscarReposicaoGrupoPreImporter(client, grupo, status, idsExcluidos = [], opcoes = {}) {
  if (!["pendente", "diagnosticado", "pronto_para_importar"].includes(status)) return [];
  const frescor = sqlFrescorComercialPreImporter("j", "e", { agoraSql: "instante.agora" });
  const retry = sqlRetryPreImporter("j", { agoraSql: "instante.agora" });
  const resposta = await client.query(
    `WITH instante AS (SELECT clock_timestamp() AS agora)
     SELECT j.*, e.capturado_em AS evento_capturado_em, e.criado_em AS evento_criado_em,
            e.origem AS evento_origem, e.origem_tipo AS evento_origem_tipo,
            e.metadata AS evento_metadata, ${frescor.lane} AS lane_vazao_pre_importer,
            COALESCE(NULLIF(j.metadata->>'origemFluxo', ''),
                     NULLIF(j.metadata->>'origem_fluxo', ''),
                     NULLIF(j.metadata #>> '{metadataEvento,origemFluxo}', ''),
                     NULLIF(j.metadata #>> '{metadataEvento,origem_fluxo}', ''),
                     NULLIF(e.metadata->>'origemFluxo', ''),
                     NULLIF(e.metadata->>'origem_fluxo', ''), '') AS "origemFluxo"
       FROM engine_jobs_cliente j
       LEFT JOIN engine_eventos_brutos e ON e.id=j.evento_id
       CROSS JOIN instante
      WHERE COALESCE(NULLIF(BTRIM(j.cliente_id), ''), 'workspace_desconhecido')=$1
        AND j.status=$2 AND ${frescor.lane}=$3
        AND ${frescor.vivo} AND j.id <> ALL($4::bigint[])
        AND ($5::text IS NULL OR LOWER(COALESCE(NULLIF(BTRIM(j.marketplace), ''),
            NULLIF(BTRIM(j.marketplace_detectado), ''), ''))=$5)
        AND ${opcoes.verificarRetry === true ? retry.vencido : "TRUE"}
      ORDER BY COALESCE(j.prioridade, 0) DESC,
               CASE WHEN $3='fresca_em_risco' THEN COALESCE(e.capturado_em,j.criado_em) END ASC NULLS FIRST,
               CASE WHEN $3<>'fresca_em_risco' THEN COALESCE(e.capturado_em,j.criado_em) END DESC NULLS LAST,
               j.id ASC
      LIMIT 4`,
    [grupo.clienteId, status, grupo.lane, idsExcluidos,
      grupo.marketplace ? String(grupo.marketplace).toLowerCase() : null]
  );
  return resposta.rows || [];
}

async function reivindicarSlotPreImporter(grupo = {}, posicao, opcoes = {}) {
  const pool = opcoes.pool || getEnginePool();
  if (!pool || typeof pool.connect !== "function") return { ok: false, motivo: "pool_indisponivel" };
  if (typeof opcoes.claim !== "function" || typeof opcoes.montarPlano !== "function" ||
      typeof opcoes.origemProtegida !== "function") {
    return { ok: false, motivo: "deps_fairness_slot_indisponiveis" };
  }

  let client = null;
  let transacao = false;
  let etapaFinalizacao = "execucao";
  const diagnostico = opcoes.diagnostico || null;
  const inicioTransacao = diagnostico ? process.hrtime.bigint() : null;
  const idsAlvoTentados = diagnostico ? new Set() : null;
  const idsAlvoClaimados = diagnostico ? new Set() : null;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transacao = true;
    const chave = { clienteId: grupo.clienteId, etapa: opcoes.etapa, lane: grupo.lane };
    const estado = await bloquearEstadoFairness(client, chave);
    const plano = opcoes.plano || opcoes.montarPlano(grupo, estado.ultimaOrigemAtendida);
    const slot = (plano.slots || []).find(item => Number(item.posicao) === Number(posicao));
    if (diagnostico) {
      const idsGrupo = new Set([...(grupo.baseline || []), ...(grupo.candidates || [])].map(item => String(item.id)));
      for (const id of diagnostico.ids) {
        if (!idsGrupo.has(id)) continue;
        const selecionado = (plano.selecionados || []).some(item => String(item.id) === id);
        diagnostico.selecaoPlano(id, selecionado, selecionado ? "plano_fairness" : "substituido_no_plano", posicao);
      }
    }
    const reservados = opcoes.idsReservados instanceof Set ? opcoes.idsReservados : new Set();
    const idsPlano = new Set((plano.selecionados || []).map(item => Number(item.id)));
    const tentativas = [slot?.job, ...(grupo.candidates || []).filter(item =>
      !idsPlano.has(Number(item.id)) && !reservados.has(Number(item.id)))].filter(Boolean);
    const experimentados = new Set(reservados);
    let recarregou = false;
    for (let indice = 0; ; indice += 1) {
      if (indice >= tentativas.length) {
        if (recarregou || !opcoes.statusEsperado) break;
        recarregou = true;
        const extras = await buscarReposicaoGrupoPreImporter(client, grupo, opcoes.statusEsperado,
          [...experimentados, ...tentativas.map(item => Number(item.id))], opcoes);
        tentativas.push(...extras);
        if (indice >= tentativas.length) break;
      }
      const candidato = tentativas[indice];
      experimentados.add(Number(candidato.id));
      if (reservados.has(Number(candidato.id))) continue;
      const alvoDiagnostico = diagnostico?.ids.includes(String(candidato.id)) === true;
      if (alvoDiagnostico) {
        idsAlvoTentados.add(String(candidato.id));
        diagnostico.claimAttempt(candidato.id, { etapa: "fairness_slot", resultado: "tentativa" });
      }
      await client.query("SAVEPOINT candidato_frescor");
      const claim = await opcoes.claim(client, [candidato.id]);
      if (!claim.ok) throw new Error(claim.erro || claim.motivo || "claim_falhou");
      if (!claim.jobs?.length) {
        if (alvoDiagnostico) diagnostico.claimAttempt(candidato.id, { etapa: "fairness_slot", resultado: "nao_claimado", motivo: "status_origem_alterado" });
        await client.query("ROLLBACK TO SAVEPOINT candidato_frescor");
        await client.query("RELEASE SAVEPOINT candidato_frescor");
        continue;
      }
      if (!(await jobClaimadoAindaVivo(client, candidato.id, { verificarRetry: opcoes.verificarRetry === true }))) {
        if (alvoDiagnostico) diagnostico.claimAttempt(candidato.id, { etapa: "fairness_slot", resultado: "rollback_savepoint", motivo: "frescor_revalidado" });
        await client.query("ROLLBACK TO SAVEPOINT candidato_frescor");
        await client.query("RELEASE SAVEPOINT candidato_frescor");
        continue;
      }
      await client.query("RELEASE SAVEPOINT candidato_frescor");
      if (alvoDiagnostico) idsAlvoClaimados.add(String(candidato.id));
      const origem = opcoes.origemProtegida(candidato);
      await registrarAtendimentoWorkspaceFairness(client, chave, origem);
      etapaFinalizacao = "commit";
      await client.query("COMMIT");
      transacao = false;
      for (const id of idsAlvoTentados || []) diagnostico.transaction(id, {
        resultado: idsAlvoClaimados.has(id) ? "commit_confirmado" : "commit_sem_claim",
        motivo: idsAlvoClaimados.has(id) ? "" : "claim_nao_confirmado",
        duracaoMs: Number(process.hrtime.bigint() - inicioTransacao) / 1e6
      });
      return { ok: true, job: { ...candidato, status: claim.jobs[0].status }, plano, origem };
    }
    etapaFinalizacao = "commit";
    await client.query("COMMIT");
    transacao = false;
    for (const id of idsAlvoTentados || []) diagnostico.transaction(id, {
      resultado: idsAlvoClaimados.has(id) ? "commit_confirmado" : "commit_sem_claim",
      motivo: idsAlvoClaimados.has(id) ? "" : "nenhum_candidato_claimado",
      duracaoMs: Number(process.hrtime.bigint() - inicioTransacao) / 1e6
    });
    return { ok: true, ignorado: true, motivo: "nenhum_candidato_claimado", plano };
  } catch (erro) {
    let rollbackConfirmado = false;
    if (transacao) {
      try {
        await client.query("ROLLBACK");
        rollbackConfirmado = true;
      } catch (_) {}
    }
    for (const id of idsAlvoTentados || []) diagnostico.transaction(id, {
      resultado: etapaFinalizacao === "commit"
        ? "commit_resultado_desconhecido"
        : (rollbackConfirmado ? "rollback_confirmado" : "rollback_sem_confirmacao"),
      motivo: etapaFinalizacao === "commit" ? "commit_falhou" : "fairness_claim_falhou",
      duracaoMs: Number(process.hrtime.bigint() - inicioTransacao) / 1e6
    });
    return { ok: false, motivo: "fairness_slot_claim_falhou", erro: erro.message || String(erro) };
  } finally {
    if (client && typeof client.release === "function") client.release();
  }
}

module.exports = { jobClaimadoAindaVivo, buscarReposicaoGrupoPreImporter, reivindicarSlotPreImporter };
