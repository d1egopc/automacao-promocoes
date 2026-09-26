"use strict";

const { performance, monitorEventLoopDelay } = require("node:perf_hooks");
const { AsyncLocalStorage } = require("node:async_hooks");
const contexto = new AsyncLocalStorage();

function criarMedidorCiclo({ clock = () => performance.now(), wallClock = Date.now,
  monitor = monitorEventLoopDelay, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const inicio = clock();
  const etapasMs = {};
  const leiturasFilas = { tentativas: 0, arquivos: 0, bytesArquivoObservados: 0,
    arquivosComBytesConhecidos: 0, caracteresLidos: 0, itens: 0, leituraMs: 0, parseMs: 0 };
  const serializacao = { chamadas: 0, ms: 0, caracteres: 0 };
  let encerrado = false;
  let resumo = null;
  let amostras = 0;
  let lagTimer = 0;
  let esperado = clock() + 20;
  const histograma = monitor({ resolution: 20 });
  histograma.enable();
  let timer;
  function amostrar() {
    if (encerrado) return;
    amostras += 1;
    lagTimer = Math.max(lagTimer, clock() - esperado);
    esperado = clock() + 20;
    timer = setTimer(amostrar, 20);
    timer?.unref?.();
  }
  timer = setTimer(amostrar, 20);
  timer?.unref?.();
  return {
    clock,
    registrarEtapa(etapa, ms) { etapasMs[etapa] = (etapasMs[etapa] || 0) + Math.max(0, ms); },
    async medir(etapa, fn) {
      const t = clock();
      try { return await fn(); }
      finally { etapasMs[etapa] = (etapasMs[etapa] || 0) + Math.max(0, clock() - t); }
    },
    registrarLeitura(dados) {
      leiturasFilas.tentativas += 1;
      for (const k of ["caracteresLidos", "itens", "leituraMs", "parseMs"]) leiturasFilas[k] += dados[k] || 0;
      if (dados.lido) leiturasFilas.arquivos += 1;
      if (Number.isFinite(dados.bytesArquivoObservados)) {
        leiturasFilas.bytesArquivoObservados += dados.bytesArquivoObservados;
        leiturasFilas.arquivosComBytesConhecidos += 1;
      }
    },
    registrarSerializacao(ms, caracteres) { serializacao.chamadas += 1; serializacao.ms += ms; serializacao.caracteres += caracteres; },
    finalizar() {
      if (resumo) return resumo;
      encerrado = true;
      clearTimer(timer);
      // O prazo vencido tambem cobre o ultimo bloco sincrono, antes que um
      // timer/histograma tenha oportunidade de rodar. Nao espera o event loop.
      const atrasoPendente = Math.max(0, clock() - esperado);
      histograma.disable();
      resumo = { duracaoTotalMs: Math.max(0, clock() - inicio), observadoEmMs: wallClock(),
        etapasMs: { ...etapasMs }, leiturasFilas: { ...leiturasFilas }, serializacao: { ...serializacao },
        eventLoopLagMaxMs: amostras > 0 || atrasoPendente > 0 ? Math.max(lagTimer, atrasoPendente) : null,
        eventLoopDelayMaxMs: histograma.max > 0 ? Number(histograma.max) / 1e6 : null,
        eventLoopAmostras: amostras,
        eventLoopQualidade: amostras > 0 || atrasoPendente > 0 ? "timer_20ms_com_atraso_pendente_limite_inferior" : "sem_amostra_ciclo_curto",
        bytesQualidade: "stat_do_arquivo_estimativa_sem_releitura_do_conteudo" };
      return resumo;
    }
  };
}

function medirSerializacaoExistente(payload) {
  const medidor = contexto.getStore();
  if (!medidor) return JSON.stringify(payload);
  const t = medidor.clock();
  const texto = JSON.stringify(payload);
  medidor.registrarSerializacao(Math.max(0, medidor.clock() - t), texto.length);
  return texto;
}

function comMedidorCiclo(medidor, fn) { return contexto.run(medidor, fn); }
module.exports = { criarMedidorCiclo, comMedidorCiclo, medirSerializacaoExistente };
