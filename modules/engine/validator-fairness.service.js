const { getEnginePool } = require("./database");
const {
  bloquearEstadoFairness,
  registrarOrigemAtendidaFairness
} = require("./origem-fairness.repository");
const { reivindicarJobsValidandoComExecutor } = require("./validator.service");

const ETAPA_VALIDATOR_FAIRNESS = "validacao_final";
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
    const chave = { clienteId: grupo.clienteId, etapa: ETAPA_VALIDATOR_FAIRNESS, lane: grupo.lane };
    const estado = await bloquearEstadoFairness(client, chave);
    const plano = montarSelecaoGrupo(grupo, estado.ultimaOrigemAtendida);
    const claimInicial = await reivindicarJobsValidandoComExecutor(client, plano.selecionados.map(item => item.id));
    if (!claimInicial.ok) throw new Error(claimInicial.erro || claimInicial.motivo || "claim_falhou");

    const idsConfirmados = new Set(claimInicial.jobs.map(item => Number(item.id)));
    const slotsConfirmados = plano.slots.filter(item => idsConfirmados.has(Number(item.job.id)));
    const posicoesConfirmadas = new Set(slotsConfirmados.map(item => Number(item.posicao)));
    const vagas = plano.slots.filter(item => !posicoesConfirmadas.has(Number(item.posicao)));

    if (vagas.length) {
      const idsTentados = new Set(plano.selecionados.map(item => Number(item.id)));
      const reposicoes = (grupo.candidates || []).filter(item => !idsTentados.has(Number(item.id))).slice(0, vagas.length);
      const claimReposicao = await reivindicarJobsValidandoComExecutor(client, reposicoes.map(item => item.id));
      if (!claimReposicao.ok) throw new Error(claimReposicao.erro || claimReposicao.motivo || "claim_reposicao_falhou");
      const porId = new Map(reposicoes.map(item => [Number(item.id), item]));
      const confirmadosReposicao = claimReposicao.jobs.map(item => porId.get(Number(item.id))).filter(Boolean);
      for (const [indice, job] of confirmadosReposicao.entries()) {
        const vaga = vagas[indice];
        if (vaga) slotsConfirmados.push({ job, posicao: vaga.posicao });
      }
    }

    const idsConfirmadosFinal = new Set(slotsConfirmados.map(item => Number(item.job.id)));
    const protegidosConfirmados = plano.protegidos.filter(item => idsConfirmadosFinal.has(Number(item.id)));
    const ultimoProtegido = protegidosConfirmados
      .map(item => origemProtegida(item))
      .filter(Boolean)
      .at(-1);
    if (ultimoProtegido) await registrarOrigemAtendidaFairness(client, chave, ultimoProtegido);

    await client.query("COMMIT");
    emTransacao = false;
    return {
      ok: true,
      confirmados: slotsConfirmados.sort((a, b) => a.posicao - b.posicao),
      protegida: plano.protegida,
      estado,
      ultimoProtegido
    };
  } catch (erro) {
    if (emTransacao) {
      try { await client.query("ROLLBACK"); } catch (_) {}
    }
    return { ok: false, motivo: "fairness_claim_falhou", erro: erro.message || String(erro), confirmados: [] };
  } finally {
    if (client && typeof client.release === "function") client.release();
  }
}

module.exports = {
  ETAPA_VALIDATOR_FAIRNESS,
  origemProtegida,
  chaveGrupo,
  montarGruposFairness,
  headsProtegidas,
  montarSelecaoGrupo,
  reivindicarGrupoFairness
};
