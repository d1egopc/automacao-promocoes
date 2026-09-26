"use strict";

const { consultarEntregasConfirmadas } = require("./drainage-metrics.repository");

function criarContadorFinalizacoes({ clienteId, agoraMs = Date.now(), janelaMinutos = 15 } = {}) {
  const vistos = new Set();
  let total = 0;
  let semIdentidadeOuHorario = 0;
  return {
    observar(item) {
      // Estado + horario ja gravados pelo finalizador homologado. Nao conta
      // destinosEnviados nem tenta finalizar/reconstruir uma oferta parcial.
      if (item?.status !== "enviado") return;
      const id = String(item.id || item.filaItemId || "").trim();
      const horario = item.enviadoEm;
      const ms = horario ? new Date(horario).getTime() : NaN;
      if (!id || !Number.isFinite(ms)) { semIdentidadeOuHorario += 1; return; }
      if (ms > agoraMs || ms < agoraMs - janelaMinutos * 60000) return;
      const chave = JSON.stringify([clienteId, id]);
      if (vistos.has(chave)) return;
      vistos.add(chave);
      total += 1;
    },
    resumo() { return { total, semIdentidadeOuHorario, observadoEmMs: agoraMs }; }
  };
}

function observacao({ valor = null, total = null, unidade, janelaMinutos, qualidadeFonte, fonte,
  observadoEmMs = null, agoraMs, motivo = "", ...extra }) {
  return { valor, total, unidade, janelaMinutos, qualidadeFonte, fonte,
    observadoEm: Number.isFinite(observadoEmMs) ? new Date(observadoEmMs).toISOString() : null,
    idadeObservacaoMs: Number.isFinite(observadoEmMs) ? Math.max(0, agoraMs - observadoEmMs) : null,
    motivo, ...extra };
}

async function criarMetricasDrenagemShadow({ fluxoComercial = {}, gateAbsorcao = {}, janelaMinutos = 15,
  agoraMs, clock = Date.now, consultarConfirmacoes = consultarEntregasConfirmadas } = {}) {
  janelaMinutos = Math.max(1, Math.min(120, Math.floor(Number(janelaMinutos) || 15)));
  let entregas;
  try { entregas = await consultarConfirmacoes({ janelaMinutos }); }
  catch { entregas = { ok: false, motivo: "confirmacoes_indisponiveis" }; }
  const comum = { janelaMinutos, agoraMs: agoraMs ?? clock() };
  const finalizacoes = gateAbsorcao.finalizacoesComerciaisObservadas;
  const finalDisponivel = gateAbsorcao.ok === true && finalizacoes?.disponivel === true;
  return {
    modo: "shadow", aplicouMudancas: false, usoDecisorio: false,
    outputRate: observacao({ ...comum, valor: fluxoComercial.ok === true ? fluxoComercial.enviosConfirmadosPorMinuto ?? null : null,
      unidade: "eventos_executor_enviado_por_minuto", fonte: "engine_eventos_comerciais",
      qualidadeFonte: fluxoComercial.ok === true ? "LEGADA_FINALIZACAO_DEPENDENTE_FANOUT" : "INDISPONIVEL",
      observadoEmMs: fluxoComercial.observadoEmMs ?? null }),
    throughputEntregasConfirmadasPorDestino: observacao({ ...comum,
      valor: entregas?.ok === true ? entregas.total / janelaMinutos : null,
      total: entregas?.ok === true ? entregas.total : null,
      unidade: "confirmacoes_persistidas_por_destino_alvo_por_minuto", fonte: "fila_checkpoints_entrega.confirmado_em",
      qualidadeFonte: entregas?.ok === true ? (entregas.historicoSemTimestamp ? "PARCIAL_LEGADO_SEM_TIMESTAMP" : "CONFIRMACAO_DURAVEL") : "INDISPONIVEL",
      observadoEmMs: entregas?.observadoEmMs ?? null, motivo: entregas?.motivo || "",
      disponibilidade: entregas?.disponibilidade?.estado || "DESCONHECIDO",
      porDestino: entregas?.ok === true ? entregas.porDestino.map(d => ({ clienteId: d.cliente_id, destinoChave: d.destino_chave,
        total: d.total, porMinuto: d.total / janelaMinutos })) : [],
      detalheLimitado: entregas?.detalheLimitado === true }),
    finalizacoesComerciaisPorOferta: observacao({ ...comum,
      valor: finalDisponivel ? finalizacoes.total / janelaMinutos : null,
      total: finalDisponivel ? finalizacoes.total : null, unidade: "ofertas_finalizadas_enviadas_por_minuto",
      fonte: "fila_persistida.status_enviado.enviadoEm",
      qualidadeFonte: !finalDisponivel ? "INDISPONIVEL" : finalizacoes.completo ? "FILAS_OBSERVADAS_COMPLETAS" : "PARCIAL_FILAS_OBSERVADAS",
      observadoEmMs: finalizacoes?.observadoEmMs ?? null,
      motivo: finalizacoes?.motivo || "", escopo: "workspaces_cadastrais_observados_sem_varrer_arquivo_historico",
      fontesInvalidas: finalizacoes?.fontesInvalidas ?? null,
      semIdentidadeOuHorario: finalizacoes?.semIdentidadeOuHorario ?? null })
  };
}

module.exports = { criarContadorFinalizacoes, criarMetricasDrenagemShadow };
