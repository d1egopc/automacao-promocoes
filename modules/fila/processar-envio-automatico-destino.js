"use strict";

// Boundary de um par produto/destino. Os callbacks mantem as regras comerciais,
// de renderizacao e de persistencia no executor que ja as possui.
async function processarEnvioAutomaticoDestino({
  clienteId,
  oferta,
  destinoId,
  coordenador,
  revalidar,
  liberarAdvisoryFila,
  prepararMensagem,
  enviar,
  processarResultado,
  aoBloqueio
}) {
  const claim = await coordenador.adquirir({ clienteId, oferta, destinoId });
  if (["ocupado", "ocupado_recente"].includes(claim?.resultado)) {
    aoBloqueio("ocupado", claim);
    return { resultado: "ocupado" };
  }
  if (claim?.resultado && claim.resultado !== "adquirido") {
    aoBloqueio("coordenacao_indisponivel", claim);
    return { resultado: "coordenacao_indisponivel" };
  }

  let transporteIniciado = false;
  try {
    if (claim.resultado === "adquirido") {
      const repeticao = await revalidar();
      if (!repeticao.ok || repeticao.bloqueada) {
        aoBloqueio("repeticao", repeticao);
        return { resultado: "repeticao" };
      }
    }

    if (await coordenador.prepararTransporte(claim) !== true) {
      aoBloqueio("reserva_indisponivel", claim);
      return { resultado: "reserva_indisponivel" };
    }
    if (await liberarAdvisoryFila() !== true) {
      aoBloqueio("advisory_fila_nao_liberado", claim);
      return { resultado: "advisory_fila_nao_liberado" };
    }

    const preparado = await prepararMensagem();
    transporteIniciado = true;
    const resposta = await enviar(preparado);
    const resultadoEnvio = typeof resposta === "object" && resposta !== null
      ? resposta
      : { enviado: resposta === true, tentouEnvio: resposta === true,
        motivo: resposta === false ? "nao_enviado" : "" };
    await processarResultado(resultadoEnvio, preparado, claim);
    return { resultado: resultadoEnvio.enviado === true ? "enviado" : "nao_enviado", resultadoEnvio };
  } finally {
    if (claim.resultado === "adquirido") {
      if (!transporteIniciado && claim.reservaToken) {
        try { await coordenador.descartarSemTransporte(claim); } catch {}
      }
      await coordenador.finalizar(claim, { statusFinal: oferta.status || "" });
    }
  }
}

module.exports = { processarEnvioAutomaticoDestino };
