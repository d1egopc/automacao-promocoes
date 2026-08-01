const { coletarMetricasOfc } = require("./metrics.service");
const { criarPlanoShadowOfc } = require("./planner.service");
const { criarFilaAtivaShadowOfc } = require("./active-queue.service");
const { criarFluxoVivoShadowOfc } = require("./live-flow.service");
const { criarFluxoComercialShadowOfc } = require("./commercial-flow.service");
const { criarGateAbsorcaoShadowOfc } = require("./absorption-gate.service");

function logOfc(tag, payload = {}) {
  try {
    console.log(tag, JSON.stringify(payload || {}));
  } catch {
    console.log(tag, payload);
  }
}

function logarFluxoVivoShadow(rodadaId, fluxoVivo = {}) {
  if (fluxoVivo.ok) {
    logOfc("[OFC-FLUXO-VIVO-V2-SEMANTICO-SHADOW]", {
      rodadaId,
      modo: fluxoVivo.modo,
      aplicouMudancas: fluxoVivo.aplicouMudancas,
      janelaMinutos: fluxoVivo.janelaMinutos,
      fluxoVivoPercentual: fluxoVivo.fluxoVivoPercentual,
      fluxoVivoCirculavelPercentual: fluxoVivo.fluxoVivoCirculavelPercentual,
      fluxoVivoNumerador: fluxoVivo.fluxoVivoNumerador,
      fluxoVivoDenominador: fluxoVivo.fluxoVivoDenominador,
      fluxoVivoDisponivel: fluxoVivo.fluxoVivoDisponivel,
      fluxoVivoMotivoIndisponibilidade: fluxoVivo.fluxoVivoMotivoIndisponibilidade,
      idadeJobMaisNovoParadoMs: fluxoVivo.idadeJobMaisNovoParadoMs,
      idadeJobMaisAntigoCirculavelMs: fluxoVivo.idadeJobMaisAntigoCirculavelMs,
      jobsCirculaveis: fluxoVivo.jobsCirculaveis,
      jobsEmCursoProtegidos: fluxoVivo.jobsEmCursoProtegidos,
      saudeJobsEmCurso: fluxoVivo.saudeJobsEmCurso,
      idadeMediaCirculaveisMs: fluxoVivo.idadeMediaCirculaveisMs,
      idadeMaximaCirculaveisMs: fluxoVivo.idadeMaximaCirculaveisMs,
      idadeMediaEmCursoMs: fluxoVivo.idadeMediaEmCursoMs,
      idadeMaximaEmCursoMs: fluxoVivo.idadeMaximaEmCursoMs,
      idadeMediaJobsVivosMs: fluxoVivo.idadeMediaJobsVivosMs,
      idadeMaximaJobsVivosMs: fluxoVivo.idadeMaximaJobsVivosMs,
      tempoMedioPermanenciaMs: fluxoVivo.tempoMedioPermanenciaMs,
      tempoMedioRadarOfertaMs: fluxoVivo.tempoMedioRadarOfertaMs,
      radarOfertaAmostraTotal: fluxoVivo.radarOfertaAmostraTotal,
      radarOfertaDisponivel: fluxoVivo.radarOfertaDisponivel,
      radarOfertaMotivoIndisponibilidade: fluxoVivo.radarOfertaMotivoIndisponibilidade,
      tempoMedioAtePrimeiraTentativaMs: fluxoVivo.tempoMedioAtePrimeiraTentativaMs,
      primeiraTentativa: fluxoVivo.primeiraTentativa,
      entradaPorMinuto: fluxoVivo.entradaPorMinuto,
      throughputTecnicoPorMinuto: fluxoVivo.throughputTecnicoPorMinuto,
      consumoComercialPorMinuto: fluxoVivo.consumoComercialPorMinuto,
      consumoComercialDisponivel: fluxoVivo.consumoComercialDisponivel,
      consumoComercial: fluxoVivo.consumoComercial,
      expiracaoPorMinuto: fluxoVivo.expiracaoPorMinuto,
      expiracaoPorHora: fluxoVivo.expiracaoPorHora,
      pressaoOperacional: fluxoVivo.pressaoOperacional,
      activeQueueTecnicaSugerida: fluxoVivo.activeQueueTecnicaSugerida,
      reservaTecnicaSugerida: fluxoVivo.reservaTecnicaSugerida,
      activeQueueSugeridaComercial: fluxoVivo.activeQueueSugeridaComercial,
      reservaSugeridaComercial: fluxoVivo.reservaSugeridaComercial,
      motivoFilaComercialIndisponivel: fluxoVivo.motivoFilaComercialIndisponivel,
      metricasTecnicasProvisorias: fluxoVivo.metricasTecnicasProvisorias,
      totalJobsVivos: fluxoVivo.totalJobsVivos,
      totalJobsCirculaveis: fluxoVivo.totalJobsCirculaveis,
      totalEmCursoProtegidos: fluxoVivo.totalEmCursoProtegidos,
      percentualAguaNova: fluxoVivo.percentualAguaNova,
      percentualAguaNovaAmostra: fluxoVivo.percentualAguaNovaAmostra,
      aguaNova: fluxoVivo.aguaNova,
      ttl: fluxoVivo.ttl,
      amostra: fluxoVivo.amostra,
      filaAtivaShadowAtual: fluxoVivo.filaAtivaShadowAtual,
      duracaoMs: fluxoVivo.duracaoMs
    });
    return;
  }

  logOfc("[OFC-FLUXO-VIVO-ERRO]", {
    rodadaId,
    modo: fluxoVivo.modo,
    aplicouMudancas: false,
    failSafe: true,
    motivo: fluxoVivo.motivo || "erro_fluxo_vivo_shadow",
    erro: String(fluxoVivo.erro || "erro_desconhecido").slice(0, 180),
    duracaoMs: fluxoVivo.duracaoMs
  });
}

function logarFluxoComercialShadow(rodadaId, fluxoComercial = {}) {
  if (fluxoComercial.ok) {
    logOfc("[OFC-FLUXO-COMERCIAL-SHADOW]", {
      rodadaId,
      modo: fluxoComercial.modo,
      aplicouMudancas: fluxoComercial.aplicouMudancas,
      janelaMinutos: fluxoComercial.janelaMinutos,
      ofertasCriadasPorMinuto: fluxoComercial.ofertasCriadasPorMinuto,
      ofertasDistribuidasPorMinuto: fluxoComercial.ofertasDistribuidasPorMinuto,
      itensAdicionadosFilaPorMinuto: fluxoComercial.itensAdicionadosFilaPorMinuto,
      enviosConfirmadosPorMinuto: fluxoComercial.enviosConfirmadosPorMinuto,
      enviosErroFinalPorMinuto: fluxoComercial.enviosErroFinalPorMinuto,
      consumoComercialPorMinuto: fluxoComercial.consumoComercialPorMinuto,
      demandaDistribuidaPorMinuto: fluxoComercial.demandaDistribuidaPorMinuto,
      workspacesAptosAgora: fluxoComercial.workspacesAptosAgora,
      destinosAptosAgora: fluxoComercial.destinosAptosAgora,
      capacidadeComercialTeoricaPorMinuto: fluxoComercial.capacidadeComercialTeoricaPorMinuto,
      capacidadeComercialDisponivel: fluxoComercial.capacidadeComercialDisponivel,
      capacidadeComercialMotivoIndisponibilidade: fluxoComercial.capacidadeComercialMotivoIndisponibilidade,
      radarOfertaAmostraTotal: fluxoComercial.radarOfertaAmostraTotal,
      radarOfertaSemVinculoTotal: fluxoComercial.radarOfertaSemVinculoTotal,
      tempoMedioRadarOfertaMs: fluxoComercial.tempoMedioRadarOfertaMs,
      medianaRadarOfertaMs: fluxoComercial.medianaRadarOfertaMs,
      p95RadarOfertaMs: fluxoComercial.p95RadarOfertaMs,
      radarOfertaDisponivel: fluxoComercial.radarOfertaDisponivel,
      radarOfertaMotivoIndisponibilidade: fluxoComercial.radarOfertaMotivoIndisponibilidade,
      fontes: fluxoComercial.fontes,
      totais: fluxoComercial.totais,
      segmentacao: fluxoComercial.segmentacao,
      duracaoMs: fluxoComercial.duracaoMs
    });
    return;
  }

  logOfc("[OFC-FLUXO-COMERCIAL-ERRO]", {
    rodadaId,
    modo: fluxoComercial.modo || "shadow",
    aplicouMudancas: false,
    failSafe: true,
    motivo: fluxoComercial.motivo || "erro_fluxo_comercial_shadow",
    erro: String(fluxoComercial.erro || "erro_desconhecido").slice(0, 180),
    duracaoMs: fluxoComercial.duracaoMs
  });
}

function logarGateAbsorcaoShadow(rodadaId, gateAbsorcao = {}) {
  if (gateAbsorcao.ok) {
    logOfc("[OFC-GATE-ABSORCAO-DINAMICO-SHADOW]", {
      rodadaId,
      modo: gateAbsorcao.modo,
      aplicouMudancas: gateAbsorcao.aplicouMudancas,
      janelaMinutos: gateAbsorcao.janelaMinutos,
      totalWorkspaces: gateAbsorcao.totalWorkspaces,
      resumo: gateAbsorcao.resumo,
      workspaces: gateAbsorcao.workspaces,
      duracaoMs: gateAbsorcao.duracaoMs
    });
    return;
  }

  logOfc("[OFC-GATE-ABSORCAO-ERRO]", {
    rodadaId,
    modo: gateAbsorcao.modo || "shadow",
    aplicouMudancas: false,
    failSafe: true,
    motivo: gateAbsorcao.motivo || "erro_gate_absorcao_shadow",
    erro: String(gateAbsorcao.erro || "erro_desconhecido").slice(0, 180),
    duracaoMs: gateAbsorcao.duracaoMs
  });
}

async function executarObservabilidadeOfc(opcoes = {}) {
  const inicio = Date.now();
  const rodadaId = opcoes.rodadaId || "";
  try {
    const metricas = await coletarMetricasOfc({
      janelaConsumoMinutos: opcoes.janelaConsumoMinutos || 15
    });

    logOfc("[OFC-METRICAS]", {
      rodadaId,
      ok: metricas.ok,
      coletadoEm: metricas.coletadoEm,
      pressao: metricas.pressao,
      consumoReal: {
        janelaMinutos: metricas.consumoReal.janelaMinutos,
        eventos: metricas.consumoReal.eventos,
        eventosPorMinuto: metricas.consumoReal.eventosPorMinuto
      },
      reservatorio: {
        porStatus: metricas.reservatorio.porStatus,
        topMarketplaces: metricas.reservatorio.porMarketplace.slice(0, 8),
        topClientes: metricas.reservatorio.porCliente.slice(0, 8)
      },
      erro: metricas.erro || "",
      motivo: metricas.motivo || ""
    });

    const plano = criarPlanoShadowOfc(metricas, opcoes.planner || {});
    logOfc("[OFC-PLANO-SHADOW]", {
      rodadaId,
      ...plano
    });

    const filaAtiva = await criarFilaAtivaShadowOfc({
      plano
    }, {
      ...(opcoes.filaAtiva || {}),
      metricas
    });

    if (filaAtiva.ok) {
      logOfc("[OFC-FILA-ATIVA-SHADOW]", {
        rodadaId,
        modo: filaAtiva.modo,
        aplicouMudancas: filaAtiva.aplicouMudancas,
        tamanhoAlvo: filaAtiva.tamanhoAlvo,
        totalSelecionado: filaAtiva.totalSelecionado,
        selecionadosPorStatus: filaAtiva.selecionadosPorStatus,
        selecionadosPorMarketplace: filaAtiva.selecionadosPorMarketplace,
        selecionadosPorCliente: filaAtiva.selecionadosPorCliente,
        quantidadeDisponivelAvaliada: filaAtiva.quantidadeDisponivelAvaliada,
        idsAmostra: filaAtiva.idsAmostra,
        motivoSelecaoIncompleta: filaAtiva.motivoSelecaoIncompleta,
        duracaoMs: filaAtiva.duracaoMs
      });
      if (filaAtiva.operacionalV2) {
        logOfc("[OFC-OPERACIONAL-V2-SHADOW]", {
          rodadaId,
          modo: filaAtiva.operacionalV2.modo,
          aplicouMudancas: filaAtiva.operacionalV2.aplicouMudancas,
          totalAvaliado: filaAtiva.operacionalV2.totalAvaliado,
          pressaoOperacional: filaAtiva.operacionalV2.pressaoOperacional,
          saudeOperacional: filaAtiva.operacionalV2.saudeOperacional,
          temperaturas: filaAtiva.operacionalV2.temperaturas,
          estados: filaAtiva.operacionalV2.estados,
          ttlOperacional: filaAtiva.operacionalV2.ttlOperacional,
          aguaNova: filaAtiva.operacionalV2.aguaNova,
          activeQueueDefinitiva: filaAtiva.operacionalV2.activeQueueDefinitiva,
          reservaOperacional: filaAtiva.operacionalV2.reservaOperacional,
          expiracaoOperacional: filaAtiva.operacionalV2.expiracaoOperacional
        });
      }
    } else {
      logOfc("[OFC-FILA-ATIVA-ERRO]", {
        rodadaId,
        modo: filaAtiva.modo,
        aplicouMudancas: false,
        failSafe: true,
        motivo: filaAtiva.motivoSelecaoIncompleta || "erro_fila_ativa_shadow",
        erro: String(filaAtiva.erro || "erro_desconhecido").slice(0, 180),
        duracaoMs: filaAtiva.duracaoMs
      });
    }

    const fluxoVivo = await criarFluxoVivoShadowOfc({
      metricas,
      plano,
      filaAtiva
    }, opcoes.fluxoVivo || {});
    logarFluxoVivoShadow(rodadaId, fluxoVivo);

    const fluxoComercial = await criarFluxoComercialShadowOfc({
      janelaMinutos: opcoes.janelaConsumoMinutos || 15,
      ...(opcoes.fluxoComercial || {})
    });
    logarFluxoComercialShadow(rodadaId, fluxoComercial);

    const gateAbsorcao = await criarGateAbsorcaoShadowOfc({
      janelaMinutos: opcoes.janelaConsumoMinutos || 15,
      ...(opcoes.gateAbsorcao || {})
    });
    logarGateAbsorcaoShadow(rodadaId, gateAbsorcao);

    return {
      ok: true,
      modo: "shadow",
      aplicouMudancas: false,
      duracaoMs: Date.now() - inicio,
      metricas,
      plano,
      filaAtiva,
      fluxoVivo,
      fluxoComercial,
      gateAbsorcao
    };
  } catch (e) {
    logOfc("[OFC-ERRO]", {
      rodadaId,
      etapa: "observabilidade_shadow",
      erro: String(e?.message || "erro_desconhecido").slice(0, 180),
      duracaoMs: Date.now() - inicio,
      failSafe: true
    });
    return {
      ok: false,
      modo: "shadow",
      aplicouMudancas: false,
      failSafe: true,
      duracaoMs: Date.now() - inicio,
      erro: e.message
    };
  }
}

module.exports = {
  executarObservabilidadeOfc
};
