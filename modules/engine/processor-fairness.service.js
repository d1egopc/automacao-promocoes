const { getEnginePool } = require("./database");
const {
  bloquearEstadoFairness,
  registrarOrigemAtendidaFairness
} = require("./origem-fairness.repository");
const { reivindicarJobsProcessandoComExecutor } = require("./processor.service");

const ETAPA_PROCESSOR_FAIRNESS = "diagnostico_final";
const ORIGENS_PROTEGIDAS = new Set(["optimus", "clonador_grupos"]);

function texto(valor = "") {
  return String(valor || "").trim();
}

function origemProtegida(job = {}) {
  const origem = texto(job.origemFluxo).toLowerCase();
  return ORIGENS_PROTEGIDAS.has(origem) ? origem : "";
}

function chaveWorkspace(job = {}) {
  return texto(job.cliente_id || job.clienteId) || "workspace_desconhecido";
}

function chaveGrupo(job = {}) {
  return `${chaveWorkspace(job)}|${texto(job.lane_vazao_pre_importer)}`;
}

function compararPosicaoSql(a = {}, b = {}) {
  const aPosicao = Number(a.workspace_rank_pre_importer || Number.MAX_SAFE_INTEGER);
  const bPosicao = Number(b.workspace_rank_pre_importer || Number.MAX_SAFE_INTEGER);
  if (aPosicao !== bPosicao) return aPosicao - bPosicao;
  return Number(a.id || 0) - Number(b.id || 0);
}

function montarGruposFairness(baseline = [], candidatePool = []) {
  const grupos = new Map();
  for (const job of Array.isArray(baseline) ? baseline : []) {
    const chave = chaveGrupo(job);
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        chave,
        clienteId: chaveWorkspace(job),
        lane: texto(job.lane_vazao_pre_importer),
        baseline: [],
        candidates: []
      });
    }
    grupos.get(chave).baseline.push(job);
  }
  for (const candidate of Array.isArray(candidatePool) ? candidatePool : []) {
    const grupo = grupos.get(chaveGrupo(candidate));
    if (grupo) grupo.candidates.push(candidate);
  }

  for (const grupo of grupos.values()) {
    grupo.baseline.sort(compararPosicaoSql);
    grupo.candidates.sort(compararPosicaoSql);
  }
  return [...grupos.values()];
}

function headsProtegidas(grupo = {}) {
  const heads = new Map();
  for (const candidate of grupo.candidates || []) {
    const origem = origemProtegida(candidate);
    if (!origem || candidate.origemFluxoHead !== true) continue;
    if (!heads.has(origem)) heads.set(origem, candidate);
  }
  return heads;
}

function montarSlots(grupo = {}, selecionados = []) {
  const idsSelecionados = new Set(selecionados.map(job => Number(job.id)));
  const extras = selecionados.filter(job => !(grupo.baseline || []).some(item => Number(item.id) === Number(job.id)));
  const slotsLivres = (grupo.baseline || []).filter(job => !idsSelecionados.has(Number(job.id)));
  const slots = [];

  for (const job of grupo.baseline || []) {
    if (idsSelecionados.has(Number(job.id))) slots.push({ job, posicao: Number(job.indiceBaseline || 0) });
  }
  for (const [indice, job] of extras.entries()) {
    const substituido = slotsLivres[slotsLivres.length - 1 - indice];
    if (substituido) slots.push({ job, posicao: Number(substituido.indiceBaseline || 0) });
  }
  return slots.sort((a, b) => a.posicao - b.posicao);
}

function montarSelecaoGrupo(grupo = {}, ultimaOrigemAtendida = "") {
  const baseline = grupo.baseline || [];
  const orcamento = baseline.length;
  const heads = headsProtegidas(grupo);
  const optimus = heads.get("optimus");
  const clonador = heads.get("clonador_grupos");

  if (!optimus || !clonador || orcamento <= 0) {
    return { protegida: false, selecionados: baseline, slots: montarSlots(grupo, baseline), protegidos: [] };
  }

  let protegidos;
  if (orcamento === 1) {
    const ultima = texto(ultimaOrigemAtendida).toLowerCase();
    if (ultima === "optimus") protegidos = [clonador];
    else if (ultima === "clonador_grupos") protegidos = [optimus];
    else protegidos = [optimus, clonador].sort(compararPosicaoSql).slice(0, 1);
  } else {
    protegidos = [optimus, clonador].sort(compararPosicaoSql);
  }

  const ids = new Set(protegidos.map(job => Number(job.id)));
  const selecionados = [...protegidos];
  for (const job of baseline) {
    if (selecionados.length >= orcamento) break;
    if (ids.has(Number(job.id))) continue;
    ids.add(Number(job.id));
    selecionados.push(job);
  }

  return {
    protegida: true,
    selecionados,
    slots: montarSlots(grupo, selecionados),
    protegidos
  };
}

async function reivindicarGrupoFairness(grupo = {}, opcoes = {}) {
  const pool = opcoes.pool || getEnginePool();
  if (!pool || typeof pool.connect !== "function") {
    return { ok: false, motivo: "pool_indisponivel", confirmados: [] };
  }

  let client = null;
  let emTransacao = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    emTransacao = true;
    const estado = await bloquearEstadoFairness(client, {
      clienteId: grupo.clienteId,
      etapa: ETAPA_PROCESSOR_FAIRNESS,
      lane: grupo.lane
    });
    const plano = montarSelecaoGrupo(grupo, estado.ultimaOrigemAtendida);
    const claim = await reivindicarJobsProcessandoComExecutor(client, plano.selecionados.map(item => item.id));
    if (!claim.ok) throw new Error(claim.erro || claim.motivo || "claim_falhou");

    const idsConfirmados = new Set(claim.jobs.map(item => Number(item.id)));
    const confirmados = plano.slots.filter(item => idsConfirmados.has(Number(item.job.id)));
    const protegidosConfirmados = plano.protegidos.filter(item => idsConfirmados.has(Number(item.id)));
    const ultimoProtegido = protegidosConfirmados
      .map(item => origemProtegida(item))
      .filter(Boolean)
      .at(-1);

    if (ultimoProtegido) {
      await registrarOrigemAtendidaFairness(client, {
        clienteId: grupo.clienteId,
        etapa: ETAPA_PROCESSOR_FAIRNESS,
        lane: grupo.lane
      }, ultimoProtegido);
    }

    await client.query("COMMIT");
    emTransacao = false;
    return { ok: true, confirmados, protegida: plano.protegida, estado, ultimoProtegido };
  } catch (erro) {
    if (emTransacao) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
    }
    return { ok: false, motivo: "fairness_claim_falhou", erro: erro.message || String(erro), confirmados: [] };
  } finally {
    if (client && typeof client.release === "function") client.release();
  }
}

module.exports = {
  ETAPA_PROCESSOR_FAIRNESS,
  origemProtegida,
  chaveGrupo,
  montarGruposFairness,
  headsProtegidas,
  montarSelecaoGrupo,
  reivindicarGrupoFairness
};
