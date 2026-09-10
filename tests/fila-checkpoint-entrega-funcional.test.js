"use strict";

const assert = require("assert");
const {
  criarCheckpointEntregaFuncional,
  chaveDestinoEntrega,
  chaveAlvoEntrega
} = require("../modules/fila/fila-checkpoint-entrega.service");

const ATTEMPT_A = "55555555-5555-4555-8555-555555555555";

function criarRepository({ criar = true, iniciar = true, concluir = true, falhar = true, existente = null } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async criarCheckpointEntrega(entrada) {
      chamadas.push({ tipo: "criar", entrada });
      return { criado: criar };
    },
    async obterCheckpointEntrega() {
      return existente;
    },
    async transicionarCheckpointEntrega(entrada) {
      chamadas.push({ tipo: "transicionar", entrada });
      if (entrada.paraEstado === "envio_iniciado") return { transicionado: iniciar };
      if (entrada.paraEstado === "enviado") return { transicionado: concluir };
      if (entrada.paraEstado === "falha_confirmada") return { transicionado: falhar };
      if (entrada.paraEstado === "resultado_ambiguo") return { transicionado: true };
      return { transicionado: false };
    },
    async registrarCreditoDebitadoCheckpointEntrega(entrada) {
      chamadas.push({ tipo: "credito", entrada });
      return { registrado: true };
    }
  };
}

function entrada(extra = {}) {
  return {
    clienteId: "workspace_a",
    oferta: { id: "fila_101", origemFluxo: "optimus" },
    destinoChave: "whatsapp:destino_1",
    alvoChave: "grupo:alvo_1",
    canal: "whatsapp",
    advisoryHandle: { client: { query() {} } },
    ...extra
  };
}

async function testarFailClosedAntesDoProvedor() {
  const repository = criarRepository({ iniciar: false });
  const executor = criarCheckpointEntregaFuncional({ repository, gerarAttemptIdImpl: () => ATTEMPT_A, logger: { log() {} } });
  let externas = 0;
  const resultado = await executor.executar({
    ...entrada(),
    enviar: async () => { externas += 1; return { valor: {}, providerMessageId: "wa_1" }; }
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.resultado, "envio_iniciado_nao_persistido");
  assert.strictEqual(externas, 0, "falha de checkpoint antes da chamada e fail-closed");
}

async function testarCheckpointTerminalImpedeNovoEnvio() {
  const repository = criarRepository({ criar: false });
  const executor = criarCheckpointEntregaFuncional({ repository, gerarAttemptIdImpl: () => ATTEMPT_A, logger: { log() {} } });
  let externas = 0;
  const resultado = await executor.executar({
    ...entrada(),
    enviar: async () => { externas += 1; return { valor: {} }; }
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.resultado, "checkpoint_existente");
  assert.strictEqual(externas, 0, "checkpoint existente bloqueia qualquer novo provedor");
}

async function testarPreparadoRetomaMesmoAttemptSobAdvisory() {
  const repository = criarRepository({
    criar: false,
    existente: { estado: "preparado", attemptId: "66666666-6666-4666-8666-666666666666" }
  });
  const executor = criarCheckpointEntregaFuncional({ repository, gerarAttemptIdImpl: () => ATTEMPT_A, logger: { log() {} } });
  const resultado = await executor.executar({
    ...entrada(),
    enviar: async () => ({ valor: {}, providerMessageId: "wa_retomada" })
  });
  assert.strictEqual(resultado.ok, true);
  const inicio = repository.chamadas.find(item => item.tipo === "transicionar" && item.entrada.paraEstado === "envio_iniciado");
  assert.strictEqual(inicio.entrada.attemptId, "66666666-6666-4666-8666-666666666666", "preparado retoma somente o attempt duravel que ainda nao cruzou o provedor");
}

async function testarOrdemESucessoComProviderId() {
  const repository = criarRepository();
  const executor = criarCheckpointEntregaFuncional({ repository, gerarAttemptIdImpl: () => ATTEMPT_A, logger: { log() {} } });
  const ordem = [];
  const resultado = await executor.executar({
    ...entrada(),
    enviar: async () => {
      ordem.push("provedor");
      return { valor: { ok: true }, providerMessageId: "wa_message_1" };
    }
  });
  assert.strictEqual(resultado.ok, true);
  const inicio = repository.chamadas.findIndex(item => item.tipo === "transicionar" && item.entrada.paraEstado === "envio_iniciado");
  const fim = repository.chamadas.findIndex(item => item.tipo === "transicionar" && item.entrada.paraEstado === "enviado");
  assert(inicio >= 0 && fim > inicio, "checkpoint transiciona antes e depois da chamada");
  assert.strictEqual(ordem.length, 1);
  assert.strictEqual(repository.chamadas[fim].entrada.providerMessageId, "wa_message_1", "provider id WhatsApp chega ao checkpoint");
}

async function testarIdsTelegramEDiscord() {
  for (const [canal, providerMessageId] of [["telegram", "12345"], ["discord", "98765"]]) {
    const repository = criarRepository();
    const executor = criarCheckpointEntregaFuncional({ repository, gerarAttemptIdImpl: () => ATTEMPT_A, logger: { log() {} } });
    const resultado = await executor.executar({
      ...entrada({ canal, destinoChave: `${canal}:destino_1`, alvoChave: `${canal}:alvo_1` }),
      enviar: async () => ({ valor: {}, providerMessageId })
    });
    assert.strictEqual(resultado.ok, true);
    const enviado = repository.chamadas.find(item => item.tipo === "transicionar" && item.entrada.paraEstado === "enviado");
    assert.strictEqual(enviado.entrada.providerMessageId, providerMessageId, `provider id ${canal} chega ao checkpoint`);
  }
}

async function testarTelegramExigeEvidenciaMinima() {
  const confirmadoRepo = criarRepository();
  const confirmado = criarCheckpointEntregaFuncional({ repository: confirmadoRepo, gerarAttemptIdImpl: () => ATTEMPT_A, logger: { log() {} } });
  const enviado = await confirmado.executar({
    ...entrada({ canal: "telegram", destinoChave: "telegram:destino", alvoChave: "telegram:alvo", exigirProviderMessageId: true }),
    enviar: async () => ({ valor: { ok: true }, providerMessageId: "12345" })
  });
  assert.strictEqual(enviado.resultado, "enviado", "2xx Telegram com message_id confirma envio");

  const semIdRepo = criarRepository();
  const semId = criarCheckpointEntregaFuncional({ repository: semIdRepo, gerarAttemptIdImpl: () => ATTEMPT_A, logger: { log() {} } });
  const ambiguo = await semId.executar({
    ...entrada({ canal: "telegram", destinoChave: "telegram:destino", alvoChave: "telegram:alvo", exigirProviderMessageId: true }),
    enviar: async () => ({ valor: { ok: true }, providerMessageId: "" })
  });
  assert.strictEqual(ambiguo.ok, false);
  assert.strictEqual(ambiguo.resultado, "resposta_sem_evidencia_minima", "2xx sem message_id nao vira enviado");
  assert(semIdRepo.chamadas.some(item => item.entrada?.paraEstado === "resultado_ambiguo" && item.entrada?.motivoCodigo === "provider_message_id_ausente"));
  assert(!semIdRepo.chamadas.some(item => item.entrada?.paraEstado === "enviado"), "sem evidencia minima nao persiste enviado");
}

async function testarClassificacaoTelegramConservadora() {
  const executarFalha = async (erro, postIniciado) => {
    const repository = criarRepository();
    const executor = criarCheckpointEntregaFuncional({ repository, gerarAttemptIdImpl: () => ATTEMPT_A, logger: { log() {} } });
    const resultado = await executor.executar({
      ...entrada({ canal: "telegram", destinoChave: "telegram:destino", alvoChave: "telegram:alvo" }),
      falhaConfirmada: falha => Number(falha?.response?.status || 0) >= 400 && Number(falha?.response?.status || 0) < 500,
      classificarFalha: falha => {
        const statusHttp = Number(falha?.response?.status || 0) || undefined;
        return !postIniciado
          ? { confirmada: true, motivoCodigo: "telegram_falha_local_pre_post", classificacao: "local_pre_post" }
          : { confirmada: Boolean(statusHttp && statusHttp >= 400 && statusHttp < 500), motivoCodigo: statusHttp ? `telegram_http_${statusHttp}` : "telegram_resultado_ambiguo", classificacao: statusHttp && statusHttp < 500 ? "http_4xx" : "pos_efeito_ou_desconhecido", statusHttp };
      },
      enviar: async () => { throw erro; }
    });
    return { resultado, chamadas: repository.chamadas };
  };
  const quatroxx = await executarFalha(Object.assign(new Error("400"), { response: { status: 400 } }), true);
  assert.strictEqual(quatroxx.resultado.resultado, "falha_confirmada");
  const cincocc = await executarFalha(Object.assign(new Error("500"), { response: { status: 500 } }), true);
  assert.strictEqual(cincocc.resultado.resultado, "envio_iniciado_ambiguo");
  const timeout = await executarFalha(new Error("timeout"), true);
  assert.strictEqual(timeout.resultado.resultado, "envio_iniciado_ambiguo");
  const local = await executarFalha(new Error("falha local"), false);
  assert.strictEqual(local.resultado.resultado, "falha_confirmada");
}

async function testarFalhaAmbiguaEConfirmada() {
  const ambiguaRepo = criarRepository();
  const ambigua = criarCheckpointEntregaFuncional({ repository: ambiguaRepo, gerarAttemptIdImpl: () => ATTEMPT_A, logger: { log() {} } });
  const timeout = new Error("socket timeout");
  const resultadoAmbiguo = await ambigua.executar({
    ...entrada(),
    enviar: async () => { throw timeout; }
  });
  assert.strictEqual(resultadoAmbiguo.resultado, "envio_iniciado_ambiguo");
  assert(!ambiguaRepo.chamadas.some(item => item.entrada?.paraEstado === "falha_confirmada"), "timeout nao vira falha confirmada");
  const ambiguaPersistida = ambiguaRepo.chamadas.find(item => item.entrada?.paraEstado === "resultado_ambiguo");
  assert(ambiguaPersistida, "ambiguidade e' persistida sem texto externo");
  assert.strictEqual(ambiguaPersistida.entrada.classificacao, "pos_efeito_ou_desconhecido");

  const confirmadaRepo = criarRepository();
  const confirmada = criarCheckpointEntregaFuncional({ repository: confirmadaRepo, gerarAttemptIdImpl: () => ATTEMPT_A, logger: { log() {} } });
  const erroConfirmado = Object.assign(new Error("http 400"), { checkpointFalhaConfirmada: true });
  const resultadoConfirmado = await confirmada.executar({
    ...entrada(),
    enviar: async () => { throw erroConfirmado; },
    falhaConfirmada: erro => erro?.checkpointFalhaConfirmada === true
  });
  assert.strictEqual(resultadoConfirmado.resultado, "falha_confirmada");
  const falha = confirmadaRepo.chamadas.find(item => item.entrada?.paraEstado === "falha_confirmada");
  assert(falha);
  assert.strictEqual(falha.entrada.classificacao, "pre_efeito");
}

async function testarCreditoSomenteComoEvidencia() {
  const repository = criarRepository();
  const executor = criarCheckpointEntregaFuncional({ repository, gerarAttemptIdImpl: () => ATTEMPT_A, logger: { log() {} } });
  const resultado = await executor.executar({ ...entrada(), enviar: async () => ({ valor: {} }) });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(await executor.registrarCreditoDebitado(resultado.contexto).then(item => item.registrado), true);
  assert.strictEqual(repository.chamadas.filter(item => item.tipo === "credito").length, 1);
}

async function testarTelemetriaNaoVazaAlvo() {
  const logs = [];
  const executor = criarCheckpointEntregaFuncional({
    repository: criarRepository(),
    gerarAttemptIdImpl: () => ATTEMPT_A,
    logger: { log: (...args) => logs.push(args.join(" ")) }
  });
  const resultado = await executor.executar({
    ...entrada({ alvoChave: "grupo:120363012345678@g.us" }),
    enviar: async () => ({ valor: {} })
  });
  assert.strictEqual(resultado.ok, true);
  const telemetria = logs.join("\n");
  assert(!telemetria.includes("120363012345678@g.us"), "telemetria nao registra JID/alvo");
  assert(!telemetria.includes("destinoChave"), "telemetria nao registra chave de destino");
}

function testarIdentidadesEstaveis() {
  assert.strictEqual(chaveDestinoEntrega({ tipo: "whatsapp", id: "destino_1" }), "whatsapp:destino_1");
  assert.strictEqual(chaveDestinoEntrega({ tipo: "whatsapp", nome: "Nao usar" }), "", "nome nao vira identidade");
  assert.strictEqual(chaveAlvoEntrega("whatsapp", { grupoId: "120@g.us" }), "grupo:120@g.us");
  assert.strictEqual(chaveAlvoEntrega("discord", { channelId: "123" }), "canal:123");
  assert.strictEqual(chaveAlvoEntrega("telegram", { id: "bot_1", chatId: "-100" }), "integracao:bot_1");
  const telegramSemId = chaveAlvoEntrega("telegram", { botToken: "segredo", chatId: "-100" });
  assert.match(telegramSemId, /^credencial:[0-9a-f]{24}:-100$/);
  assert(!telegramSemId.includes("segredo"), "token jamais entra na chave persistida");
}

(async () => {
  await testarFailClosedAntesDoProvedor();
  await testarCheckpointTerminalImpedeNovoEnvio();
  await testarPreparadoRetomaMesmoAttemptSobAdvisory();
  await testarOrdemESucessoComProviderId();
  await testarIdsTelegramEDiscord();
  await testarTelegramExigeEvidenciaMinima();
  await testarClassificacaoTelegramConservadora();
  await testarFalhaAmbiguaEConfirmada();
  await testarCreditoSomenteComoEvidencia();
  await testarTelemetriaNaoVazaAlvo();
  testarIdentidadesEstaveis();
  console.log("fila-checkpoint-entrega-funcional.test.js OK");
})().catch(erro => {
  console.error(erro.stack || erro.message || erro);
  process.exit(1);
});
