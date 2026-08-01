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

function percentualOuNull(parte, total) {
  const totalNumero = paraNumero(total);
  if (totalNumero <= 0) return null;
  return percentual(parte, totalNumero);
}

function calcularTamanhoIdealActiveQueue({ throughputTecnicoPorMinuto = 0, janelaAlvoMinutos = 5, piso = 10, teto = 500, circulaveis = 0 } = {}) {
  const demanda = Math.ceil(paraNumero(throughputTecnicoPorMinuto) * Math.max(1, paraNumero(janelaAlvoMinutos)));
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

function resumirSaudeJobsEmCurso(linhas = [], { limiteDiagnosticoMs = 30 * 60 * 1000 } = {}) {
  const resumo = {
    processandoTotal: 0,
    importandoTotal: 0,
    totalEmCursoProtegidos: 0,
    idadeMaximaMs: null,
    limiteDiagnosticoMs,
    suspeitosLock: 0,
    porStatus: {}
  };

  for (const linha of Array.isArray(linhas) ? linhas : []) {
    const status = String(linha.status || "desconhecido");
    const total = paraNumero(linha.total);
    const idadeMaxima = paraNumero(linha.idade_maxima_ms);
    const suspeitos = paraNumero(linha.suspeitos_lock);

    resumo.porStatus[status] = {
      total,
      idadeMaximaMs: idadeMaxima,
      suspeitosLock: suspeitos
    };
    resumo.totalEmCursoProtegidos += total;
    resumo.suspeitosLock += suspeitos;
    if (idadeMaxima > 0) {
      resumo.idadeMaximaMs = resumo.idadeMaximaMs === null
        ? idadeMaxima
        : Math.max(resumo.idadeMaximaMs, idadeMaxima);
    }
  }

  resumo.processandoTotal = resumo.porStatus.processando?.total || 0;
  resumo.importandoTotal = resumo.porStatus.importando?.total || 0;
  return resumo;
}

function criarConsumoComercialIndisponivel() {
  return {
    consumoComercialPorMinuto: null,
    consumoComercialDisponivel: false,
    motivoIndisponibilidade: "fonte_comercial_confiavel_indisponivel",
    fontesAvaliadas: [
      "envios_confirmados_executor",
      "itens_colocados_filas_clientes_aptos",
      "ofertas_distribuidas_destinos_janela_aberta"
    ],
    observacao: "engine_processamentos mede throughput tecnico e nao consumo comercial"
  };
}

function calcularFluxoVivoShadow({ dados = {}, metricas = {}, plano = {}, filaAtiva = {}, agoraMs = Date.now(), opcoes = {} } = {}) {
  const janelaMinutos = paraNumero(dados.janelaMinutos || metricas.consumoReal?.janelaMinutos || 15) || 15;
  const vivos = dados.vivos || {};
  const circulaveis = dados.circulaveis || {};
  const emCursoProtegidos = dados.emCursoProtegidos || {};
  const totalVivos = paraNumero(vivos.total);
  const totalCirculaveis = paraNumero(circulaveis.total);
  const totalEmCursoProtegidos = paraNumero(emCursoProtegidos.total);
  const entradaPorMinuto = porMinuto(dados.chegada?.total, janelaMinutos);
  const throughputTecnicoPorMinuto = paraNumero(metricas.consumoReal?.eventosPorMinuto) || porMinuto(dados.consumo?.total, janelaMinutos);
  const consumoComercial = criarConsumoComercialIndisponivel();
  const expiracaoPorMinuto = porMinuto(dados.expiracao?.total, janelaMinutos);
  const activeQueueTecnicaSugerida = calcularTamanhoIdealActiveQueue({
    throughputTecnicoPorMinuto,
    janelaAlvoMinutos: plano.reserva?.janelaAlvoMinutos || opcoes.janelaActiveQueueMinutos || 5,
    piso: plano.reserva?.pisoOperacional || 10,
    teto: opcoes.tetoActiveQueue || 500,
    circulaveis: totalCirculaveis
  });
  const reservaTecnicaSugerida = Math.max(0, Math.min(
    totalCirculaveis,
    Math.ceil(throughputTecnicoPorMinuto * Math.max(1, paraNumero(opcoes.coberturaReservaMinutos || 15))) - activeQueueTecnicaSugerida
  ));
  const amostra = resumirAmostraOperacional(dados.amostraCirculavel || [], { agoraMs, activeQueueSugerida: activeQueueTecnicaSugerida });
  const amostraEhCompleta = amostra.totalAvaliado >= totalCirculaveis;
  const fluxoVivoDenominador = totalCirculaveis;
  const fluxoVivoNumerador = totalCirculaveis > 0 && amostraEhCompleta ? Math.max(0, totalCirculaveis - amostra.acimaTtl) : null;
  const fluxoVivoCirculavelPercentual = fluxoVivoNumerador === null
    ? null
    : percentualOuNull(fluxoVivoNumerador, fluxoVivoDenominador);
  const motivoFluxoVivoIndisponivel = totalCirculaveis <= 0
    ? "sem_jobs_circulaveis"
    : amostraEhCompleta ? "" : "amostra_circulavel_parcial";
  const radarOfertaTotal = paraNumero(dados.radarOferta?.total);
  const radarOfertaDisponivel = radarOfertaTotal > 0;
  const primeiraTentativaTotal = paraNumero(dados.primeiraTentativa?.total);
  const saudeJobsEmCurso = resumirSaudeJobsEmCurso(dados.saudeEmCurso || [], {
    limiteDiagnosticoMs: opcoes.limiteDiagnosticoEmCursoMs || 30 * 60 * 1000
  });

  return {
    ok: true,
    modo: "shadow",
    aplicouMudancas: false,
    janelaMinutos,
    fluxoVivoPercentual: fluxoVivoCirculavelPercentual,
    fluxoVivoCirculavelPercentual,
    fluxoVivoNumerador,
    fluxoVivoDenominador,
    fluxoVivoDisponivel: fluxoVivoCirculavelPercentual !== null,
    fluxoVivoMotivoIndisponibilidade: motivoFluxoVivoIndisponivel,
    idadeJobMaisNovoParadoMs: idadeMs(circulaveis.mais_novo_em, agoraMs),
    idadeJobMaisAntigoCirculavelMs: idadeMs(circulaveis.mais_antigo_em, agoraMs),
    idadeMediaCirculaveisMs: paraNumero(circulaveis.idade_media_ms),
    idadeMaximaCirculaveisMs: idadeMs(circulaveis.mais_antigo_em, agoraMs),
    idadeMediaEmCursoMs: paraNumero(emCursoProtegidos.idade_media_ms),
    idadeMaximaEmCursoMs: idadeMs(emCursoProtegidos.mais_antigo_em, agoraMs),
    idadeMediaJobsVivosMs: paraNumero(vivos.idade_media_ms),
    idadeMaximaJobsVivosMs: idadeMs(vivos.mais_antigo_em, agoraMs),
    tempoMedioPermanenciaMs: paraNumero(circulaveis.idade_media_ms),
    tempoMedioRadarOfertaMs: radarOfertaDisponivel ? paraNumero(dados.radarOferta?.media_ms) : null,
    radarOfertaAmostraTotal: radarOfertaTotal,
    radarOfertaDisponivel,
    radarOfertaMotivoIndisponibilidade: radarOfertaDisponivel ? "" : "sem_amostra_radar_oferta",
    tempoMedioAtePrimeiraTentativaMs: primeiraTentativaTotal > 0 ? paraNumero(dados.primeiraTentativa?.media_ms) : null,
    primeiraTentativa: {
      totalAmostra: primeiraTentativaTotal,
      mediaMs: primeiraTentativaTotal > 0 ? paraNumero(dados.primeiraTentativa?.media_ms) : null,
      medianaMs: primeiraTentativaTotal > 0 ? paraNumero(dados.primeiraTentativa?.mediana_ms) : null,
      p95Ms: primeiraTentativaTotal > 0 ? paraNumero(dados.primeiraTentativa?.p95_ms) : null,
      populacao: "jobs_com_primeiro_engine_processamentos_na_janela",
      janelaMinutos,
      totalAntesReset: paraNumero(dados.primeiraTentativa?.total_antes_reset),
      totalDepoisReset: paraNumero(dados.primeiraTentativa?.total_depois_reset)
    },
    entradaPorMinuto,
    throughputTecnicoPorMinuto: arredondar(throughputTecnicoPorMinuto, 2),
    consumoPorMinuto: arredondar(throughputTecnicoPorMinuto, 2),
    consumoComercialPorMinuto: consumoComercial.consumoComercialPorMinuto,
    consumoComercialDisponivel: consumoComercial.consumoComercialDisponivel,
    consumoComercial: consumoComercial,
    expiracaoPorMinuto,
    expiracaoPorHora: arredondar(expiracaoPorMinuto * 60, 2),
    pressaoOperacional: {
      backlogOperacional: paraNumero(metricas.pressao?.backlogOperacional),
      pendentes: paraNumero(metricas.pressao?.pendentes),
      prontosParaImportar: paraNumero(metricas.pressao?.prontosParaImportar),
      emCurso: paraNumero(metricas.pressao?.emCurso),
      entradaMaiorQueThroughputTecnico: entradaPorMinuto > throughputTecnicoPorMinuto,
      razaoEntradaThroughputTecnico: throughputTecnicoPorMinuto > 0 ? arredondar(entradaPorMinuto / throughputTecnicoPorMinuto, 2) : null,
      entradaMaiorQueConsumoComercial: null,
      razaoEntradaConsumoComercial: null
    },
    activeQueueTecnicaSugerida,
    reservaTecnicaSugerida,
    activeQueueSugerida: activeQueueTecnicaSugerida,
    reservaSugerida: reservaTecnicaSugerida,
    activeQueueSugeridaComercial: null,
    reservaSugeridaComercial: null,
    motivoFilaComercialIndisponivel: "consumo_comercial_indisponivel",
    metricasTecnicasProvisorias: {
      throughputTecnicoUsado: true,
      utilizavelParaControleReal: false,
      motivo: "throughput_tecnico_nao_representa_consumo_comercial"
    },
    totalJobsVivos: totalVivos,
    totalJobsCirculaveis: totalCirculaveis,
    totalCirculaveis,
    totalEmCursoProtegidos,
    jobsCirculaveis: {
      total: totalCirculaveis,
      status: ["pendente", "pronto_para_importar"],
      idadeMediaMs: paraNumero(circulaveis.idade_media_ms),
      idadeMaximaMs: idadeMs(circulaveis.mais_antigo_em, agoraMs)
    },
    jobsEmCursoProtegidos: {
      total: totalEmCursoProtegidos,
      status: ["processando", "importando"],
      idadeMediaMs: paraNumero(emCursoProtegidos.idade_media_ms),
      idadeMaximaMs: idadeMs(emCursoProtegidos.mais_antigo_em, agoraMs)
    },
    saudeJobsEmCurso,
    percentualAguaNova: amostra.aguaNovaPercentual,
    percentualAguaNovaAmostra: amostra.aguaNovaPercentual,
    aguaNova: {
      janelaMs: JANELA_AGUA_NOVA_MS,
      aguaNovaTotalAmostra: amostra.aguaNova,
      totalAmostra: amostra.aguaNova,
      totalAmostraCirculavel: amostra.totalAvaliado,
      percentualAmostra: amostra.aguaNovaPercentual,
      percentualAguaNovaAmostra: amostra.aguaNovaPercentual,
      idsAmostra: amostra.idsAguaNovaAmostra
    },
    ttl: {
      jobsAcimaTtlAmostra: amostra.acimaTtl,
      jobsCirculaveisAcimaTtl: amostra.acimaTtl,
      percentualAmostra: amostra.acimaTtlPercentualAmostra,
      valorExato: amostraEhCompleta,
      idsAmostra: amostra.idsAcimaTtlAmostra
    },
    amostra: {
      totalAvaliado: amostra.totalAvaliado,
      tamanhoAmostra: amostra.totalAvaliado,
      totalAmostraCirculavel: amostra.totalAvaliado,
      limite: paraNumero(dados.limiteAmostra),
      amostral: !amostraEhCompleta,
      valorExato: amostraEhCompleta
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
