const { consultarFluxoVivoOfc } = require("./live-flow.repository");
const {
  avaliarOportunidadeOperacional,
  ESTADO_OPERACIONAL,
  JANELA_AGUA_NOVA_MS
} = require("./policy.service");

function paraNumero(valor) {
  const numero = Number(valor || 0);
  return Number.isFinite(numero) ? numero : 0;
}

function arredondar(valor, casas = 2) {
  const numero = Number(valor || 0);
  if (!Number.isFinite(numero)) return 0;
  const fator = 10 ** casas;
  return Math.round(numero * fator) / fator;
}

function idadeMs(data, agoraMs = Date.now()) {
  const tempo = data ? new Date(data).getTime() : 0;
  if (!Number.isFinite(tempo) || tempo <= 0) return null;
  return Math.max(0, agoraMs - tempo);
}

function porMinuto(total, janelaMinutos) {
  const janela = Math.max(1, paraNumero(janelaMinutos));
  return arredondar(paraNumero(total) / janela, 2);
}

function percentual(parte, total) {
  const totalNumero = paraNumero(total);
  if (totalNumero <= 0) return 0;
  return arredondar((paraNumero(parte) / totalNumero) * 100, 2);
}

function calcularTamanhoIdealActiveQueue({ consumoPorMinuto = 0, janelaAlvoMinutos = 5, piso = 10, teto = 500, circulaveis = 0 } = {}) {
  const demanda = Math.ceil(paraNumero(consumoPorMinuto) * Math.max(1, paraNumero(janelaAlvoMinutos)));
  const alvo = Math.max(paraNumero(piso), demanda);
  return Math.min(paraNumero(teto), alvo, Math.max(0, paraNumero(circulaveis)));
}

function resumirAmostraOperacional(jobs = [], { agoraMs = Date.now(), activeQueueSugerida = 0 } = {}) {
  const idsAtivos = new Set(jobs.slice(0, Math.max(0, activeQueueSugerida)).map(job => String(job.id)));
  const analises = jobs.map(job => avaliarOportunidadeOperacional(job, {
    agoraMs,
    selecionada: idsAtivos.has(String(job.id))
  }));

  const aguaNova = analises.filter(item => item.aguaNova).length;
  const acimaTtl = analises.filter(item => item.candidataExpiracao).length;
  const expiradas = analises.filter(item => item.estado === ESTADO_OPERACIONAL.EXPIRADA).length;

  return {
    totalAvaliado: analises.length,
    aguaNova,
    aguaNovaPercentual: percentual(aguaNova, analises.length),
    acimaTtl,
    acimaTtlPercentualAmostra: percentual(acimaTtl, analises.length),
    expiradasShadow: expiradas,
    idsAguaNovaAmostra: analises.filter(item => item.aguaNova).slice(0, 20).map(item => item.id),
    idsAcimaTtlAmostra: analises.filter(item => item.candidataExpiracao).slice(0, 20).map(item => item.id)
  };
}

function calcularFluxoVivoShadow({ dados = {}, metricas = {}, plano = {}, filaAtiva = {}, agoraMs = Date.now(), opcoes = {} } = {}) {
  const janelaMinutos = paraNumero(dados.janelaMinutos || metricas.consumoReal?.janelaMinutos || 15) || 15;
  const vivos = dados.vivos || {};
  const circulaveis = dados.circulaveis || {};
  const totalVivos = paraNumero(vivos.total);
  const totalCirculaveis = paraNumero(circulaveis.total);
  const entradaPorMinuto = porMinuto(dados.chegada?.total, janelaMinutos);
  const consumoPorMinuto = paraNumero(metricas.consumoReal?.eventosPorMinuto) || porMinuto(dados.consumo?.total, janelaMinutos);
  const expiracaoPorMinuto = porMinuto(dados.expiracao?.total, janelaMinutos);
  const activeQueueSugerida = calcularTamanhoIdealActiveQueue({
    consumoPorMinuto,
    janelaAlvoMinutos: plano.reserva?.janelaAlvoMinutos || opcoes.janelaActiveQueueMinutos || 5,
    piso: plano.reserva?.pisoOperacional || 10,
    teto: opcoes.tetoActiveQueue || 500,
    circulaveis: totalCirculaveis
  });
  const reservaSugerida = Math.max(0, Math.min(
    totalCirculaveis,
    Math.ceil(consumoPorMinuto * Math.max(1, paraNumero(opcoes.coberturaReservaMinutos || 15))) - activeQueueSugerida
  ));
  const amostra = resumirAmostraOperacional(dados.amostraCirculavel || [], { agoraMs, activeQueueSugerida });
  const fluxoVivoPercentual = totalCirculaveis > 0
    ? percentual(totalCirculaveis - amostra.acimaTtl, totalCirculaveis)
    : 100;

  return {
    ok: true,
    modo: "shadow",
    aplicouMudancas: false,
    janelaMinutos,
    fluxoVivoPercentual,
    idadeJobMaisNovoParadoMs: idadeMs(circulaveis.mais_novo_em, agoraMs),
    idadeJobMaisAntigoCirculavelMs: idadeMs(circulaveis.mais_antigo_em, agoraMs),
    idadeMediaJobsVivosMs: paraNumero(vivos.idade_media_ms),
    idadeMaximaJobsVivosMs: idadeMs(vivos.mais_antigo_em, agoraMs),
    tempoMedioPermanenciaMs: paraNumero(vivos.idade_media_ms),
    tempoMedioRadarOfertaMs: paraNumero(dados.radarOferta?.media_ms),
    tempoMedioAtePrimeiraTentativaMs: paraNumero(dados.primeiraTentativa?.media_ms),
    entradaPorMinuto,
    consumoPorMinuto: arredondar(consumoPorMinuto, 2),
    expiracaoPorMinuto,
    expiracaoPorHora: arredondar(expiracaoPorMinuto * 60, 2),
    pressaoOperacional: {
      backlogOperacional: paraNumero(metricas.pressao?.backlogOperacional),
      pendentes: paraNumero(metricas.pressao?.pendentes),
      prontosParaImportar: paraNumero(metricas.pressao?.prontosParaImportar),
      emCurso: paraNumero(metricas.pressao?.emCurso),
      entradaMaiorQueConsumo: entradaPorMinuto > consumoPorMinuto,
      razaoEntradaConsumo: consumoPorMinuto > 0 ? arredondar(entradaPorMinuto / consumoPorMinuto, 2) : null
    },
    activeQueueSugerida,
    reservaSugerida,
    totalJobsVivos: totalVivos,
    totalJobsCirculaveis: totalCirculaveis,
    percentualAguaNova: amostra.aguaNovaPercentual,
    aguaNova: {
      janelaMs: JANELA_AGUA_NOVA_MS,
      totalAmostra: amostra.aguaNova,
      percentualAmostra: amostra.aguaNovaPercentual,
      idsAmostra: amostra.idsAguaNovaAmostra
    },
    ttl: {
      jobsAcimaTtlAmostra: amostra.acimaTtl,
      percentualAmostra: amostra.acimaTtlPercentualAmostra,
      idsAmostra: amostra.idsAcimaTtlAmostra
    },
    amostra: {
      totalAvaliado: amostra.totalAvaliado,
      limite: paraNumero(dados.limiteAmostra)
    },
    filaAtivaShadowAtual: {
      tamanhoAlvo: paraNumero(filaAtiva.tamanhoAlvo),
      totalSelecionado: paraNumero(filaAtiva.totalSelecionado),
      aplicouMudancas: false
    }
  };
}

async function criarFluxoVivoShadowOfc({ metricas = {}, plano = {}, filaAtiva = {} } = {}, opcoes = {}) {
  const inicio = Date.now();
  try {
    const consultarFluxoVivo = opcoes.consultarFluxoVivo || consultarFluxoVivoOfc;
    const dados = await consultarFluxoVivo({
      janelaMinutos: opcoes.janelaMinutos || metricas.consumoReal?.janelaMinutos || 15,
      limiteAmostra: opcoes.limiteAmostra || 2000
    });

    if (!dados.ok) {
      return {
        ok: false,
        modo: "shadow",
        aplicouMudancas: false,
        failSafe: true,
        motivo: dados.motivo || "consulta_fluxo_vivo_falhou",
        erro: String(dados.erro || "erro_desconhecido").slice(0, 180),
        duracaoMs: Date.now() - inicio
      };
    }

    return {
      ...calcularFluxoVivoShadow({
        dados,
        metricas,
        plano,
        filaAtiva,
        agoraMs: opcoes.agoraMs,
        opcoes
      }),
      duracaoMs: Date.now() - inicio
    };
  } catch (e) {
    return {
      ok: false,
      modo: "shadow",
      aplicouMudancas: false,
      failSafe: true,
      motivo: "erro_fluxo_vivo_shadow",
      erro: String(e?.message || "erro_desconhecido").slice(0, 180),
      duracaoMs: Date.now() - inicio
    };
  }
}

module.exports = {
  calcularFluxoVivoShadow,
  criarFluxoVivoShadowOfc,
  calcularTamanhoIdealActiveQueue,
  resumirAmostraOperacional
};
