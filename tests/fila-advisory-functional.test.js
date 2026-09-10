"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { criarCatracaAdvisoryFuncionalFila } = require("../modules/fila/fila-advisory-functional.service");

function criarLogger() {
  const eventos = [];
  return { eventos, log(evento, corpo) { eventos.push({ evento, dados: JSON.parse(corpo) }); } };
}

function criarRepository({ adquirir, liberar } = {}) {
  return {
    adquirirAdvisoryLockFila: adquirir || (async () => ({ ok: true, adquirido: true, handle: { id: "handle" } })),
    liberarAdvisoryLockFila: liberar || (async () => ({ ok: true, liberado: true }))
  };
}

(async () => {
  const logger = criarLogger();
  const catraca = criarCatracaAdvisoryFuncionalFila({ repository: criarRepository(), logger });
  const adquirido = await catraca.adquirir({ clienteId: "cliente_1", oferta: { id: "fila_1", origemFluxo: "optimus" } });
  assert.strictEqual(adquirido.resultado, "adquirido");
  assert.strictEqual(adquirido.filaItemId, "fila_1");
  const fim = await catraca.finalizar(adquirido, { statusFinal: "enviado" });
  assert.strictEqual(fim.liberacao, "liberado");
  assert.strictEqual(fim.statusFinal, "enviado");

  const ocupado = await criarCatracaAdvisoryFuncionalFila({
    repository: criarRepository({ adquirir: async () => ({ ok: true, adquirido: false }) }), logger: criarLogger()
  }).adquirir({ clienteId: "cliente_1", oferta: { ofertaId: "oferta_1" } });
  assert.strictEqual(ocupado.resultado, "ocupado");
  assert.strictEqual(await catraca.finalizar(ocupado), null, "ocupado nao possui unlock nem altera baseline");

  {
    let ocupadoMesmaChave = false;
    const repository = criarRepository({
      adquirir: async () => {
        if (ocupadoMesmaChave) return { ok: true, adquirido: false };
        ocupadoMesmaChave = true;
        return { ok: true, adquirido: true, handle: { id: "mesma_chave" } };
      },
      liberar: async () => {
        ocupadoMesmaChave = false;
        return { ok: true, liberado: true };
      }
    });
    const auto = criarCatracaAdvisoryFuncionalFila({ repository, logger: criarLogger() });
    const enviarAgora = criarCatracaAdvisoryFuncionalFila({ repository, logger: criarLogger() });
    const primeiro = await auto.adquirir({ clienteId: "cliente_1", oferta: { id: "mesma_chave" } });
    const segundo = await enviarAgora.adquirir({ clienteId: "cliente_1", oferta: { id: "mesma_chave" } });
    assert.strictEqual(primeiro.resultado, "adquirido", "primeiro fluxo possui a autoridade");
    assert.strictEqual(segundo.resultado, "ocupado", "segundo fluxo nao pode enviar a mesma chave");
    await auto.finalizar(primeiro);
    const aposLiberacao = await enviarAgora.adquirir({ clienteId: "cliente_1", oferta: { id: "mesma_chave" } });
    assert.strictEqual(aposLiberacao.resultado, "adquirido", "unlock permite nova tentativa posterior");
    await enviarAgora.finalizar(aposLiberacao);
  }

  const erro = await criarCatracaAdvisoryFuncionalFila({
    repository: criarRepository({ adquirir: async () => { throw new Error("postgres_indisponivel"); } }), logger: criarLogger()
  }).adquirir({ clienteId: "cliente_1", oferta: { engineOfertaId: "engine_1" } });
  assert.strictEqual(erro.resultado, "erro");

  const semIdentidade = await criarCatracaAdvisoryFuncionalFila({ repository: criarRepository(), logger: criarLogger() })
    .adquirir({ clienteId: "cliente_1", oferta: { id: "indice:0" } });
  assert.strictEqual(semIdentidade.resultado, "identidade_ausente");

  const porOferta = await catraca.adquirir({ clienteId: "cliente_1", oferta: { ofertaId: "oferta_estavel" } });
  assert.strictEqual(porOferta.filaItemId, "oferta_estavel");
  await catraca.finalizar(porOferta);
  const porEngine = await catraca.adquirir({ clienteId: "cliente_1", oferta: { engineOfertaId: "engine_estavel" } });
  assert.strictEqual(porEngine.filaItemId, "engine_estavel");
  await catraca.finalizar(porEngine);

  {
    const clientTransacional = { query() {} };
    let clientRecebido = null;
    const catracaMesmoClient = criarCatracaAdvisoryFuncionalFila({
      repository: criarRepository({
        adquirir: async (_entrada, opcoes) => {
          clientRecebido = opcoes?.client || null;
          return { ok: true, adquirido: true, handle: { id: "mesmo_client" } };
        }
      }),
      logger: criarLogger()
    });
    const estado = await catracaMesmoClient.adquirir({
      clienteId: "cliente_1",
      oferta: { id: "mesmo_client" },
      client: clientTransacional
    });
    assert.strictEqual(estado.resultado, "adquirido");
    assert.strictEqual(clientRecebido, clientTransacional, "catraca encaminha o client transacional ao repository advisory");
  }

  {
    let liberou = 0;
    const catracaComFinally = criarCatracaAdvisoryFuncionalFila({
      repository: criarRepository({ liberar: async () => { liberou += 1; return { ok: true, liberado: true }; } }),
      logger: criarLogger()
    });
    const estado = await catracaComFinally.adquirir({ clienteId: "cliente_1", oferta: { id: "finally_1" } });
    try {
      throw new Error("fanout_falhou");
    } catch {
      // simula o catch operacional: a liberacao continua obrigatoria no finally.
    } finally {
      await catracaComFinally.finalizar(estado, { statusFinal: "erro" });
    }
    assert.strictEqual(liberou, 1, "throw apos aquisicao continua liberando a sessao");
  }

  const serializado = JSON.stringify(logger.eventos);
  assert(!serializado.includes("titulo"));
  assert(!serializado.includes("cupom"));
  assert(logger.eventos.some(evento => evento.evento === "[FILA-ADVISORY-FUNCIONAL]"));
  assert(logger.eventos.some(evento => evento.evento === "[FILA-ADVISORY-FUNCIONAL-FIM]"));

  const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const inicioProcessar = fonte.indexOf("async function processarFila");
  const fimProcessar = fonte.indexOf("const {", inicioProcessar);
  const processar = fonte.slice(inicioProcessar, fimProcessar);
  assert(processar.indexOf("catracaAdvisoryFuncionalFila.adquirir") < processar.indexOf("reservarOfertaProcessandoFila"));
  assert(processar.indexOf("catracaAdvisoryFuncionalFila.adquirir") < processar.indexOf("const repeticaoExecutor"), "ocupado nao alcanca anti-repeat mutante");
  assert(!processar.includes("observadorClaimShadowFila"));
  assert(processar.includes("fairnessOrigemFila.selecionar"), "fairness final deve ocorrer antes da reserva");
  assert(processar.indexOf("fairnessOrigemFila.selecionar") < processar.indexOf("reservarOfertaProcessandoFila"));
  assert(
    processar.indexOf("fairnessOrigemFila.selecionar") < processar.indexOf("const enviado = await enviarParaDestinoInteligente"),
    "provider/fanout permanece depois da selecao transacional de fairness"
  );
  const posseImediata = processar.indexOf("advisoryFuncionalFila = resultadoFairnessFila.advisory");
  const processamentoSkips = processar.indexOf("for (const skip of resultadoFairnessFila?.skipped || [])");
  const persistenciaSkips = processar.indexOf("await salvarFilaSeAlterada(clienteFila)", processamentoSkips);
  assert(posseImediata >= 0 && posseImediata < processamentoSkips, "caller assume advisory antes de qualquer processamento posterior");
  assert(posseImediata < persistenciaSkips, "falha ao salvar skips continua coberta pelo finally do caller");
  assert(processar.includes('motivo: "anti_repeat_indisponivel"'), "indisponibilidade anti-repeat possui motivo tecnico proprio");
  assert(processar.includes('motivo: "duplicidade_indisponivel"'), "indisponibilidade de duplicidade possui motivo tecnico proprio");
  assert(processar.includes('skip?.motivo !== "anti_repeat" && skip?.motivo !== "duplicidade"'), "somente bloqueios comprovados entram em retencao");

  const inicioEnviarAgora = fonte.indexOf("async function enviarOfertaAgoraDireto");
  const enviarAgora = fonte.slice(inicioEnviarAgora, fonte.indexOf("\nasync function ", inicioEnviarAgora + 1));
  assert(enviarAgora.includes("catracaAdvisoryFuncionalFila.adquirir"));
  assert(enviarAgora.includes("fila_item_em_execucao"));
  assert(enviarAgora.includes("fila_exclusao_indisponivel"));
  assert(enviarAgora.includes("fila_item_processando"));
  assert(enviarAgora.indexOf("catracaAdvisoryFuncionalFila.adquirir") < enviarAgora.indexOf("oferta.status = \"pendente\""));
  assert(enviarAgora.includes("try {") && enviarAgora.includes("finally"), "Enviar Agora libera advisory em retorno ou falha");

  const inicioRotaIndice = fonte.indexOf('app.post("/fila/:index/enviar-agora"');
  const rotaIndice = fonte.slice(inicioRotaIndice, fonte.indexOf("app.get(\"/config\"", inicioRotaIndice));
  assert(!rotaIndice.includes("enviar_agora_reordenar"), "rota por indice nao pode mutar antes da catraca");

  console.log("fila-advisory-functional.test.js OK");
})().catch(erro => {
  console.error(erro.stack || erro.message || erro);
  process.exitCode = 1;
});
