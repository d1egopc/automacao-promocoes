const { coletarMetricasOfc } = require("./metrics.service");
const { criarPlanoShadowOfc } = require("./planner.service");

function logOfc(tag, payload = {}) {
  try {
    console.log(tag, JSON.stringify(payload || {}));
  } catch {
    console.log(tag, payload);
  }
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

    return {
      ok: true,
      modo: "shadow",
      aplicouMudancas: false,
      duracaoMs: Date.now() - inicio,
      metricas,
      plano
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
