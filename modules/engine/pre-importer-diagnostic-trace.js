"use strict";

const MAX_TARGETS = 32;
const MAX_WINDOW_MS = 15 * 60 * 1000;
const TRACE_TAG = "[ENGINE-PREIMPORTER-DIAGNOSTICO]";
const MAX_PG_BIGINT = 9223372036854775807n;

function parseTargetIds(raw) {
  const values = String(raw || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  if (values.length > MAX_TARGETS || values.some(value =>
    !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > MAX_PG_BIGINT)) return [];
  return [...new Set(values)];
}

function carregarConfiguracao(env = process.env, agoraMs = Date.now()) {
  if (String(env.ENGINE_PRE_IMPORTER_TRACE_ENABLED || "").trim() !== "1") {
    return { enabled: false, ids: [] };
  }
  const ids = parseTargetIds(env.ENGINE_PRE_IMPORTER_TRACE_JOB_IDS);
  const ateMs = Date.parse(String(env.ENGINE_PRE_IMPORTER_TRACE_UNTIL || ""));
  if (!ids.length || !Number.isFinite(ateMs) || ateMs <= agoraMs || ateMs - agoraMs > MAX_WINDOW_MS) {
    return { enabled: false, ids: [] };
  }
  return { enabled: true, ids, ateMs };
}

function codigoSeguro(valor, padrao = "indeterminado") {
  const codigo = String(valor || "");
  return /^[a-z][a-z0-9_]{0,47}$/.test(codigo) ? codigo : padrao;
}

function criarColetor({ config = carregarConfiguracao(), quotas = {}, log = console.log } = {}) {
  if (!config.enabled) return null;
  const targets = new Map(config.ids.map(id => [id, {
    jobId: id,
    lane: "desconhecida",
    posicaoWorkspaceLane: null,
    candidatosLane: null,
    cotaLane: null,
    elegivelSql: null,
    selecionadoSql: false,
    visivelCandidatePool: false,
    selecionadoPlanoFairness: null,
    decisoesFairness: [],
    selecionadoEfetivo: false,
    tentativasClaim: [],
    transacoes: []
  }]));
  const inicio = process.hrtime.bigint();
  let encerrado = false;
  function obter(id) {
    return targets.get(String(id)) || null;
  }
  return {
    config,
    ids: config.ids,
    aplicarDiagnostico(rows = [], baseline = [], candidatePool = []) {
      const baselineIds = new Set(baseline.map(job => String(job.id)));
      const poolIds = new Set(candidatePool.map(job => String(job.id)));
      for (const job of [...baseline, ...candidatePool]) {
        const target = obter(job.id);
        if (!target) continue;
        target.lane = codigoSeguro(job.lane_vazao_pre_importer, "desconhecida");
        target.posicaoWorkspaceLane = job.workspace_rank_pre_importer != null && Number.isSafeInteger(Number(job.workspace_rank_pre_importer))
          ? Number(job.workspace_rank_pre_importer) : null;
        target.cotaLane = Number(quotas[target.lane] || 0);
        target.elegivelSql = true;
        target.selecionadoSql = baselineIds.has(target.jobId);
        target.visivelCandidatePool = poolIds.has(target.jobId);
        target.motivoSelecao = target.selecionadoSql ? "selecionado_baseline_sql" : "visivel_so_no_candidate_pool";
      }
      for (const row of rows) {
        const target = obter(row.job_id);
        if (!target) continue;
        target.lane = codigoSeguro(row.lane, "desconhecida");
        target.posicaoWorkspaceLane = row.posicao_workspace_lane != null && Number.isSafeInteger(Number(row.posicao_workspace_lane))
          ? Number(row.posicao_workspace_lane) : null;
        target.candidatosLane = row.candidatos_lane != null && Number.isSafeInteger(Number(row.candidatos_lane))
          ? Number(row.candidatos_lane) : null;
        target.cotaLane = Number(quotas[target.lane] || 0);
        target.elegivelSql = row.elegivel_sql === true;
        target.selecionadoSql = baselineIds.has(target.jobId);
        target.visivelCandidatePool = poolIds.has(target.jobId);
        target.motivoSelecao = codigoSeguro(row.motivo_selecao);
        if (target.motivoSelecao === "elegivel") {
          if (target.selecionadoSql) target.motivoSelecao = "selecionado_baseline_sql";
          else if (target.visivelCandidatePool) target.motivoSelecao = "visivel_so_no_candidate_pool";
          else target.motivoSelecao = "elegivel_fora_baseline_e_pool";
        }
      }
    },
    selecaoPlano(id, selecionado, motivo = "", posicao = null) {
      const target = obter(id);
      if (!target) return;
      target.selecionadoPlanoFairness = selecionado === true;
      if (target.decisoesFairness.length < 8) target.decisoesFairness.push({
        incluido: selecionado === true,
        posicao: Number.isSafeInteger(Number(posicao)) && Number(posicao) >= 0 ? Number(posicao) : null,
        motivo: motivo ? codigoSeguro(motivo, "outro") : ""
      });
    },
    claimAttempt(id, resultado = {}) {
      const target = obter(id);
      if (!target || target.tentativasClaim.length >= 8) return;
      target.tentativasClaim.push({
        etapa: codigoSeguro(resultado.etapa, "claim"),
        resultado: codigoSeguro(resultado.resultado, "tentado"),
        motivo: resultado.motivo ? codigoSeguro(resultado.motivo, "outro") : ""
      });
    },
    transaction(id, resultado = {}) {
      const target = obter(id);
      if (!target || target.transacoes.length >= 8) return;
      target.transacoes.push({
        resultado: codigoSeguro(resultado.resultado),
        motivo: resultado.motivo ? codigoSeguro(resultado.motivo, "outro") : "",
        duracaoMs: Math.max(0, Math.min(300000, Number(resultado.duracaoMs) || 0))
      });
      if (resultado.resultado === "commit_confirmado" || resultado.resultado === "autocommit_confirmado") {
        target.selecionadoEfetivo = true;
      }
    },
    flush(extra = {}) {
      if (encerrado) return;
      encerrado = true;
      if (config.ateMs && Date.now() >= config.ateMs) return;
      const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
      const entries = [...targets.values()].map(item => ({
        ...item,
        tentativasClaim: item.tentativasClaim.slice(0, 8),
        transacoes: item.transacoes.slice(0, 8)
      }));
      try {
        log(TRACE_TAG, JSON.stringify({
          schema: 1,
          emittedAt: new Date().toISOString(),
          durationMs: Math.round(duracaoMs),
          targetCount: entries.length,
          entries,
          ...extra
        }));
      } catch (_) {}
    }
  };
}

module.exports = { MAX_TARGETS, MAX_WINDOW_MS, TRACE_TAG, parseTargetIds, carregarConfiguracao, codigoSeguro, criarColetor };
