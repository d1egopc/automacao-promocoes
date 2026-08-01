const { consultarFluxoComercialOfc } = require("./commercial-flow.repository");
const { calcularCapacidadeComercialTeorica } = require("./commercial-capacity.service");
const { TIPOS_EVENTO_COMERCIAL } = require("./commercial-events.service");

function numero(valor) {
  const n = Number(valor || 0);
  return Number.isFinite(n) ? n : 0;
}

function arredondar(valor, casas = 2) {
  const n = Number(valor || 0);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

function porMinuto(total, janelaMinutos) {
  return arredondar(numero(total) / Math.max(1, numero(janelaMinutos) || 1), 2);
}

function totalEvento(eventos = [], tipo = "") {
  const item = (Array.isArray(eventos) ? eventos : []).find(linha => String(linha.tipo_evento || "") === tipo);
  return numero(item?.total);
}

function calcularFluxoComercialShadow({ dados = {}, capacidade = {}, duracaoMs = 0 } = {}) {
  const janelaMinutos = numero(dados.janelaMinutos) || 15;
  const eventos = Array.isArray(dados.eventos) ? dados.eventos : [];
  const ofertasCriadas = totalEvento(eventos, TIPOS_EVENTO_COMERCIAL.OFERTA_UNIVERSAL_CRIADA);
  const distribuidas = totalEvento(eventos, TIPOS_EVENTO_COMERCIAL.DISTRIBUICAO_FINAL);
  const filaAdicionada = totalEvento(eventos, TIPOS_EVENTO_COMERCIAL.FILA_CLIENTE_ADICIONADA);
  const enviados = totalEvento(eventos, TIPOS_EVENTO_COMERCIAL.EXECUTOR_ENVIADO);
  const erros = totalEvento(eventos, TIPOS_EVENTO_COMERCIAL.EXECUTOR_ERRO_FINAL);
  const radarOferta = dados.radarOferta || {};
  const radarOfertaAmostraTotal = numero(radarOferta.total);

  return {
    ok: dados.ok !== false,
    modo: "shadow",
    aplicouMudancas: false,
    janelaMinutos,
    ofertasCriadasPorMinuto: porMinuto(ofertasCriadas, janelaMinutos),
    ofertasDistribuidasPorMinuto: porMinuto(distribuidas, janelaMinutos),
    itensAdicionadosFilaPorMinuto: porMinuto(filaAdicionada, janelaMinutos),
    enviosConfirmadosPorMinuto: porMinuto(enviados, janelaMinutos),
    enviosErroFinalPorMinuto: porMinuto(erros, janelaMinutos),
    consumoComercialPorMinuto: porMinuto(enviados, janelaMinutos),
    demandaDistribuidaPorMinuto: porMinuto(filaAdicionada, janelaMinutos),
    totais: {
      ofertasCriadas,
      ofertasDistribuidas: distribuidas,
      itensAdicionadosFila: filaAdicionada,
      enviosConfirmados: enviados,
      enviosErroFinal: erros
    },
    segmentacao: {
      porMarketplace: Array.isArray(dados.porMarketplace) ? dados.porMarketplace : [],
      porCliente: Array.isArray(dados.porCliente) ? dados.porCliente : [],
      porCanal: Array.isArray(dados.porCanal) ? dados.porCanal : []
    },
    workspacesAptosAgora: capacidade.ok ? capacidade.workspacesAptosAgora : null,
    destinosAptosAgora: capacidade.ok ? capacidade.destinosAptosAgora : null,
    capacidadeComercialTeoricaPorMinuto: capacidade.ok ? capacidade.capacidadeComercialTeoricaPorMinuto : null,
    capacidadeComercialDisponivel: capacidade.ok === true,
    capacidadeComercialMotivoIndisponibilidade: capacidade.ok ? "" : (capacidade.motivo || "capacidade_indisponivel"),
    radarOfertaAmostraTotal,
    radarOfertaSemVinculoTotal: numero(radarOferta.total_sem_vinculo),
    tempoMedioRadarOfertaMs: radarOfertaAmostraTotal > 0 ? numero(radarOferta.media_ms) : null,
    medianaRadarOfertaMs: radarOfertaAmostraTotal > 0 ? numero(radarOferta.mediana_ms) : null,
    p95RadarOfertaMs: radarOfertaAmostraTotal > 0 ? numero(radarOferta.p95_ms) : null,
    radarOfertaDisponivel: radarOfertaAmostraTotal > 0,
    radarOfertaMotivoIndisponibilidade: radarOfertaAmostraTotal > 0 ? "" : "sem_amostra_radar_oferta",
    fontes: {
      eventosComerciais: dados.ok !== false,
      capacidadeComercial: capacidade.ok === true,
      radarOferta: radarOfertaAmostraTotal > 0
    },
    duracaoMs
  };
}

async function criarFluxoComercialShadowOfc(opcoes = {}) {
  const inicio = Date.now();
  try {
    const consultar = opcoes.consultarFluxoComercial || consultarFluxoComercialOfc;
    const calcularCapacidade = opcoes.calcularCapacidade || calcularCapacidadeComercialTeorica;
    const dados = await consultar({ janelaMinutos: opcoes.janelaMinutos || 15 });
    const capacidade = calcularCapacidade(opcoes.capacidade || {});
    const fluxo = calcularFluxoComercialShadow({
      dados,
      capacidade,
      duracaoMs: Date.now() - inicio
    });

    if (!dados.ok) {
      return {
        ...fluxo,
        ok: false,
        failSafe: true,
        motivo: dados.motivo || "fluxo_comercial_indisponivel",
        erro: dados.erro || ""
      };
    }

    return fluxo;
  } catch (e) {
    return {
      ok: false,
      modo: "shadow",
      aplicouMudancas: false,
      failSafe: true,
      motivo: "fluxo_comercial_exception",
      erro: e?.message || "",
      duracaoMs: Date.now() - inicio
    };
  }
}

module.exports = {
  calcularFluxoComercialShadow,
  criarFluxoComercialShadowOfc,
  totalEvento
};
