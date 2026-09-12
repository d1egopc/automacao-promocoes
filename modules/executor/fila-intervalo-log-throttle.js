function inteiroSeguro(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.max(minimo, Math.min(maximo, Math.floor(numero)));
}

function criarThrottleLogIntervalo({ janelaMs = 15000, maxEntradas = 5000, agora = () => Date.now(), log = console.log } = {}) {
  const janelaSeguraMs = inteiroSeguro(janelaMs, 15000, 1000, 60000);
  const maxEntradasSeguro = inteiroSeguro(maxEntradas, 5000, 1, 50000);
  const estados = new Map();
  const metricas = { expiradasRemovidas: 0, removidasPorTeto: 0 };

  function chave(payload = {}) {
    return [
      String(payload.clienteId || ""),
      String(payload.destinoId || payload.destino || ""),
      String(payload.motivo || "sem_motivo")
    ].join("|");
  }

  function limparExpirados(agoraMs) {
    let removidas = 0;
    for (const [id, estado] of estados) {
      if (estado.expiraEmMs <= agoraMs) {
        estados.delete(id);
        removidas += 1;
      }
    }
    metricas.expiradasRemovidas += removidas;
    return removidas;
  }

  function aplicarTeto() {
    while (estados.size >= maxEntradasSeguro) {
      const maisAntiga = estados.keys().next().value;
      if (maisAntiga === undefined) break;
      estados.delete(maisAntiga);
      metricas.removidasPorTeto += 1;
    }
  }

  const timerLimpeza = setInterval(() => limparExpirados(agora()), Math.max(1000, Math.floor(janelaSeguraMs / 2)));
  timerLimpeza.unref?.();

  function registrarNaRodada(contexto, emitido) {
    if (!contexto || contexto.encerrada) return;
    contexto.avaliacoes += 1;
    if (emitido) contexto.emitidos += 1;
    else contexto.suprimidos += 1;
  }

  function registrar(tag, payload = {}, contexto = null) {
    if (tag !== "[FILA-INTERVALO-AVALIADO]") {
      log(tag, JSON.stringify(payload));
      return { emitido: true, agregado: false };
    }

    const agoraMs = agora();
    limparExpirados(agoraMs);
    const id = chave(payload);
    const estado = estados.get(id);
    if (!estado) {
      aplicarTeto();
      estados.set(id, { expiraEmMs: agoraMs + janelaSeguraMs });
      log(tag, JSON.stringify(payload));
      registrarNaRodada(contexto, true);
      return { emitido: true, agregado: false };
    }

    registrarNaRodada(contexto, false);
    return { emitido: false, agregado: true };
  }

  function iniciarRodada(contexto = {}) {
    return {
      rodadaId: String(contexto.rodadaId || ""),
      clienteId: String(contexto.clienteId || ""),
      origem: String(contexto.origem || "processar_fila"),
      avaliacoes: 0,
      emitidos: 0,
      suprimidos: 0,
      encerrada: false
    };
  }

  function finalizarRodada(rodada) {
    if (!rodada || rodada.encerrada) return null;
    rodada.encerrada = true;
    if (rodada.avaliacoes < 1) return null;
    const resumo = {
      rodadaId: rodada.rodadaId,
      clienteId: rodada.clienteId,
      origem: rodada.origem,
      janelaThrottleMs: janelaSeguraMs,
      avaliacoesIntervalo: rodada.avaliacoes,
      logsEmitidos: rodada.emitidos,
      logsSuprimidos: rodada.suprimidos,
      ...obterMetricas()
    };
    log("[FILA-INTERVALO-RESUMO]", JSON.stringify(resumo));
    return resumo;
  }

  function obterMetricas() {
    return {
      tamanhoAtual: estados.size,
      entradasExpiradasRemovidas: metricas.expiradasRemovidas,
      entradasRemovidasPorTeto: metricas.removidasPorTeto
    };
  }

  function encerrar() {
    clearInterval(timerLimpeza);
  }

  return { registrar, iniciarRodada, finalizarRodada, obterMetricas, encerrar };
}

module.exports = { criarThrottleLogIntervalo };
