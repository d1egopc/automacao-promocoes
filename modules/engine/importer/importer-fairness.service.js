const { getEnginePool } = require("../database");
const {
  bloquearEstadoFairness,
  registrarOrigemAtendidaFairness
} = require("../origem-fairness.repository");
const { tentarMarcarImportando } = require("./importer.service");

const ETAPA_IMPORTER_FAIRNESS = "importacao_final";
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

function chaveMarketplace(job = {}) {
  return texto(job.marketplace || job.marketplace_detectado).toLowerCase();
}

function chaveGrupo(job = {}) {
  return `${chaveWorkspace(job)}|${chaveMarketplace(job)}|${texto(job.lane_vazao_pre_importer)}`;
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
        marketplace: chaveMarketplace(job),
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
  return { protegida: true, selecionados, slots: montarSlots(grupo, selecionados), protegidos };
}

function candidatosReposicao(grupo = {}, plano = {}, idsReservados = new Set()) {
  const idsPlano = new Set((plano.selecionados || []).map(item => Number(item.id)));
  return (grupo.candidates || []).filter(item => {
    const id = Number(item.id);
    return !idsPlano.has(id) && !idsReservados.has(id);
  });
}

async function reivindicarSlotFairness(grupo = {}, posicao, opcoes = {}) {
  const pool = opcoes.pool || getEnginePool();
  if (!pool || typeof pool.connect !== "function") return { ok: false, motivo: "pool_indisponivel" };

  let client = null;
  let emTransacao = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    emTransacao = true;
    const chave = {
      clienteId: grupo.clienteId,
      etapa: ETAPA_IMPORTER_FAIRNESS,
      lane: `${grupo.marketplace}:${grupo.lane}`
    };
    const estado = await bloquearEstadoFairness(client, chave);
    const plano = opcoes.plano || montarSelecaoGrupo(grupo, estado.ultimaOrigemAtendida);
    const slot = (plano.slots || []).find(item => Number(item.posicao) === Number(posicao));
    const idsReservados = opcoes.idsReservados instanceof Set ? opcoes.idsReservados : new Set();
    const tentativas = [slot?.job, ...candidatosReposicao(grupo, plano, idsReservados)].filter(Boolean);

    for (const candidato of tentativas) {
      if (idsReservados.has(Number(candidato.id))) continue;
      const claim = await tentarMarcarImportando(candidato.id, client);
      if (!claim.ok) {
        if (claim.ignorado) continue;
        throw new Error(claim.erro || claim.motivo || "claim_falhou");
      }

      const protegido = (plano.protegidos || []).some(item => Number(item.id) === Number(candidato.id));
      const origem = protegido ? origemProtegida(candidato) : "";
      if (origem) await registrarOrigemAtendidaFairness(client, chave, origem);
      await client.query("COMMIT");
      emTransacao = false;
      return { ok: true, job: candidato, plano, protegido, ultimoProtegido: origem };
    }

    await client.query("COMMIT");
    emTransacao = false;
    return { ok: true, ignorado: true, plano, motivo: "nenhum_candidato_claimado" };
  } catch (erro) {
    if (emTransacao) {
      try { await client.query("ROLLBACK"); } catch (_) {}
    }
    return { ok: false, motivo: "fairness_claim_falhou", erro: erro.message || String(erro) };
  } finally {
    if (client && typeof client.release === "function") client.release();
  }
}

module.exports = {
  ETAPA_IMPORTER_FAIRNESS,
  origemProtegida,
  chaveGrupo,
  montarGruposFairness,
  headsProtegidas,
  montarSelecaoGrupo,
  reivindicarSlotFairness
};
