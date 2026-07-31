const { consultarCandidatosFilaAtivaOfc } = require("./active-queue.repository");

const MODO_FILA_ATIVA_OFC = "shadow";
const LIMITE_PERCENTUAL_MARKETPLACE_PADRAO = 0.4;
const LIMITE_PERCENTUAL_CLIENTE_PADRAO = 0.25;
const LIMITE_AMOSTRA_IDS_PADRAO = 20;
const MULTIPLICADOR_CONSULTA_PADRAO = 20;
const LIMITE_CONSULTA_PADRAO = 2000;

function limitarInteiro(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.max(minimo, Math.min(maximo, Math.floor(numero)));
}

function limitarPercentual(valor, padrao) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0 || numero > 1) return padrao;
  return numero;
}

function normalizarChave(valor, padrao = "desconhecido") {
  const texto = String(valor || "").trim().toLowerCase();
  return texto || padrao;
}

function statusRank(status = "") {
  if (status === "pronto_para_importar") return 0;
  if (status === "pendente") return 1;
  return 2;
}

function ordenarJobsFilaAtiva(jobs = []) {
  return [...jobs].sort((a, b) => {
    const rank = statusRank(a.status) - statusRank(b.status);
    if (rank !== 0) return rank;

    const dataA = new Date(a.criado_em || a.criadoEm || 0).getTime() || 0;
    const dataB = new Date(b.criado_em || b.criadoEm || 0).getTime() || 0;
    if (dataA !== dataB) return dataA - dataB;

    return Number(a.id || 0) - Number(b.id || 0);
  });
}

function incrementarContador(contadores, chave) {
  contadores[chave] = Number(contadores[chave] || 0) + 1;
}

function criarResumoVazio({ tamanhoAlvo = 0, motivoSelecaoIncompleta = "" } = {}) {
  return {
    ok: true,
    modo: MODO_FILA_ATIVA_OFC,
    aplicouMudancas: false,
    tamanhoAlvo,
    totalSelecionado: 0,
    selecionadosPorStatus: {},
    selecionadosPorMarketplace: {},
    selecionadosPorCliente: {},
    quantidadeDisponivelAvaliada: 0,
    idsAmostra: [],
    motivoSelecaoIncompleta,
    duracaoMs: 0
  };
}

function selecionarFilaAtivaShadow(jobs = [], opcoes = {}) {
  const inicio = Date.now();
  const tamanhoAlvo = limitarInteiro(opcoes.tamanhoAlvo, 0, 0, 500);
  if (tamanhoAlvo <= 0) {
    return criarResumoVazio({ tamanhoAlvo, motivoSelecaoIncompleta: "sem_reserva_desejada" });
  }

  const limiteMarketplacePercentual = limitarPercentual(
    opcoes.limiteMarketplacePercentual,
    LIMITE_PERCENTUAL_MARKETPLACE_PADRAO
  );
  const limiteClientePercentual = limitarPercentual(
    opcoes.limiteClientePercentual,
    LIMITE_PERCENTUAL_CLIENTE_PADRAO
  );
  const limiteMarketplace = Math.max(1, Math.ceil(tamanhoAlvo * limiteMarketplacePercentual));
  const limiteCliente = Math.max(1, Math.ceil(tamanhoAlvo * limiteClientePercentual));
  const limiteAmostraIds = limitarInteiro(opcoes.limiteAmostraIds, LIMITE_AMOSTRA_IDS_PADRAO, 1, 50);

  const selecionados = [];
  const selecionadosPorStatus = {};
  const selecionadosPorMarketplace = {};
  const selecionadosPorCliente = {};
  let bloqueadosPorLimite = 0;

  for (const job of ordenarJobsFilaAtiva(jobs)) {
    if (selecionados.length >= tamanhoAlvo) break;

    const status = normalizarChave(job.status);
    if (status !== "pronto_para_importar" && status !== "pendente") continue;

    const marketplace = normalizarChave(job.marketplace);
    const clienteId = normalizarChave(job.cliente_id || job.clienteId, "sem_cliente");

    if (Number(selecionadosPorMarketplace[marketplace] || 0) >= limiteMarketplace) {
      bloqueadosPorLimite += 1;
      continue;
    }

    if (Number(selecionadosPorCliente[clienteId] || 0) >= limiteCliente) {
      bloqueadosPorLimite += 1;
      continue;
    }

    selecionados.push(job);
    incrementarContador(selecionadosPorStatus, status);
    incrementarContador(selecionadosPorMarketplace, marketplace);
    incrementarContador(selecionadosPorCliente, clienteId);
  }

  let motivoSelecaoIncompleta = "";
  if (selecionados.length < tamanhoAlvo) {
    if (!jobs.length) {
      motivoSelecaoIncompleta = "sem_candidatos_elegiveis";
    } else if (bloqueadosPorLimite > 0) {
      motivoSelecaoIncompleta = "limites_operacionais_shadow";
    } else {
      motivoSelecaoIncompleta = "candidatos_insuficientes";
    }
  }

  return {
    ok: true,
    modo: MODO_FILA_ATIVA_OFC,
    aplicouMudancas: false,
    tamanhoAlvo,
    totalSelecionado: selecionados.length,
    selecionadosPorStatus,
    selecionadosPorMarketplace,
    selecionadosPorCliente,
    quantidadeDisponivelAvaliada: jobs.length,
    idsAmostra: selecionados.slice(0, limiteAmostraIds).map(job => job.id),
    motivoSelecaoIncompleta,
    duracaoMs: Date.now() - inicio
  };
}

async function criarFilaAtivaShadowOfc({ plano = {} } = {}, opcoes = {}) {
  const inicio = Date.now();
  try {
    const tamanhoAlvo = limitarInteiro(plano.reserva?.reservaDesejada, 0, 0, 500);
    if (tamanhoAlvo <= 0) {
      return criarResumoVazio({ tamanhoAlvo, motivoSelecaoIncompleta: "sem_reserva_desejada" });
    }

    const multiplicadorConsulta = limitarInteiro(
      opcoes.multiplicadorConsulta,
      MULTIPLICADOR_CONSULTA_PADRAO,
      1,
      50
    );
    const limiteConsulta = limitarInteiro(
      opcoes.limiteConsulta,
      Math.min(LIMITE_CONSULTA_PADRAO, Math.max(tamanhoAlvo * multiplicadorConsulta, tamanhoAlvo)),
      tamanhoAlvo,
      5000
    );
    const consultarCandidatos = opcoes.consultarCandidatos || consultarCandidatosFilaAtivaOfc;
    const consulta = await consultarCandidatos({ limite: limiteConsulta });

    if (!consulta.ok) {
      return {
        ...criarResumoVazio({ tamanhoAlvo, motivoSelecaoIncompleta: consulta.motivo || "consulta_falhou" }),
        ok: false,
        failSafe: true,
        erro: String(consulta.erro || "consulta_fila_ativa_falhou").slice(0, 180),
        duracaoMs: Date.now() - inicio
      };
    }

    const resumo = selecionarFilaAtivaShadow(consulta.jobs || [], {
      tamanhoAlvo,
      limiteMarketplacePercentual: opcoes.limiteMarketplacePercentual,
      limiteClientePercentual: opcoes.limiteClientePercentual,
      limiteAmostraIds: opcoes.limiteAmostraIds
    });

    return {
      ...resumo,
      quantidadeDisponivelAvaliada: Number(consulta.totalAvaliado ?? resumo.quantidadeDisponivelAvaliada),
      duracaoMs: Date.now() - inicio
    };
  } catch (e) {
    return {
      ...criarResumoVazio({ tamanhoAlvo: limitarInteiro(plano.reserva?.reservaDesejada, 0, 0, 500), motivoSelecaoIncompleta: "erro_fila_ativa_shadow" }),
      ok: false,
      failSafe: true,
      erro: String(e?.message || "erro_desconhecido").slice(0, 180),
      duracaoMs: Date.now() - inicio
    };
  }
}

module.exports = {
  LIMITE_PERCENTUAL_MARKETPLACE_PADRAO,
  LIMITE_PERCENTUAL_CLIENTE_PADRAO,
  selecionarFilaAtivaShadow,
  criarFilaAtivaShadowOfc
};
