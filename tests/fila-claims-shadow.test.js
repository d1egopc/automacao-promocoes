"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  LEASE_SHADOW_DIAGNOSTICO_MS,
  resolverFilaItemId,
  criarObservadorClaimShadowFila
} = require("../modules/fila/fila-claims-shadow.service");

function criarLogger() {
  const eventos = [];
  return {
    eventos,
    log(evento, corpo) {
      eventos.push({ evento, dados: JSON.parse(corpo) });
    }
  };
}

function criarRepository({ adquirir, liberar } = {}) {
  return {
    adquirirClaimFila: adquirir || (async () => ({
      ok: true,
      adquirido: true,
      claim: { claimToken: "11111111-1111-4111-8111-111111111111" }
    })),
    liberarClaimFila: liberar || (async () => ({ ok: true, liberado: true }))
  };
}

async function observar(repository, oferta = { id: "fila_1", marketplace: "amazon", origemFluxo: "optimus" }) {
  const logger = criarLogger();
  const observador = criarObservadorClaimShadowFila({ repository, logger });
  const estado = await observador.iniciar({ clienteId: "cliente_1", oferta });
  const final = await observador.finalizar(estado, { oferta: { ...oferta, status: "pendente" } });
  return { logger, estado, final };
}

(async () => {
  assert.strictEqual(LEASE_SHADOW_DIAGNOSTICO_MS, 15 * 60 * 1000);
  assert.strictEqual(resolverFilaItemId({ id: "id" }), "id");
  assert.strictEqual(resolverFilaItemId({ ofertaId: "oferta" }), "oferta");
  assert.strictEqual(resolverFilaItemId({ engineOfertaId: "engine" }), "engine");
  assert.strictEqual(resolverFilaItemId({ id: "indice:0", ofertaId: "oferta" }), "oferta");
  assert.strictEqual(resolverFilaItemId({ id: "indice:0" }), "");

  {
    let liberacoes = 0;
    const resultado = await observar(criarRepository({
      liberar: async () => {
        liberacoes += 1;
        return { ok: true, liberado: true };
      }
    }));
    assert.strictEqual(resultado.estado.resultadoClaim, "adquirido");
    assert.strictEqual(liberacoes, 1, "claim adquirido deve ser liberado sem alterar baseline");
    assert.strictEqual(resultado.final.liberacao, "liberado");
    assert.strictEqual(resultado.final.statusFinal, "pendente");
    assert.strictEqual(resultado.final.voltouPendente, true);
    assert(Number.isFinite(resultado.final.duracaoMs));
  }

  {
    let executouBaseline = false;
    const resultado = await observar(criarRepository({
      adquirir: async () => ({ ok: true, adquirido: false, claim: null })
    }));
    executouBaseline = true;
    assert.strictEqual(resultado.estado.resultadoClaim, "perdido");
    assert.strictEqual(resultado.final.liberacao, "nao_aplicavel");
    assert.strictEqual(executouBaseline, true, "claim perdido nao pode bloquear baseline");
  }

  {
    let executouBaseline = false;
    const resultado = await observar(criarRepository({
      adquirir: async () => { throw new Error("postgres indisponivel"); }
    }));
    executouBaseline = true;
    assert.strictEqual(resultado.estado.resultadoClaim, "erro");
    assert.strictEqual(executouBaseline, true, "erro PostgreSQL nao pode bloquear baseline");
  }

  {
    const resultado = await observar(criarRepository(), { marketplace: "amazon" });
    assert.strictEqual(resultado.estado.resultadoClaim, "identidade_ausente");
    assert.strictEqual(resultado.final.liberacao, "nao_aplicavel");
  }

  {
    const resultado = await observar(criarRepository({
      liberar: async () => { throw new Error("release falhou"); }
    }));
    assert.strictEqual(resultado.final.liberacao, "erro");
    assert.strictEqual(resultado.final.statusFinal, "pendente", "falha de liberacao nao muda resultado");
  }

  {
    const resultado = await observar(criarRepository());
    const serializado = JSON.stringify(resultado.logger.eventos);
    assert.strictEqual(resultado.logger.eventos.length, 2);
    assert(!serializado.includes("11111111-1111-4111-8111-111111111111"), "telemetria nao pode expor token");
    assert(!serializado.includes("titulo"), "telemetria nao deve receber dados comerciais");
    assert.strictEqual(resultado.logger.eventos[1].evento, "[FILA-CLAIM-SHADOW-FIM]");
  }

  {
    const observador = criarObservadorClaimShadowFila({
      repository: criarRepository(),
      logger: { log() { throw new Error("logger indisponivel"); } }
    });
    const estado = await observador.iniciar({ clienteId: "cliente_1", oferta: { id: "fila_1" } });
    const final = await observador.finalizar(estado, { oferta: { status: "enviado" } });
    assert.strictEqual(final.statusFinal, "enviado", "falha de telemetria nao pode afetar o fluxo baseline");
  }

  {
    const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    const inicio = fonteIndex.indexOf("async function processarFila");
    const fim = fonteIndex.indexOf("const {", inicio);
    const processarFila = fonteIndex.slice(inicio, fim);
    assert(processarFila.includes("oferta = await selecionarProximaOfertaFila(clienteFila"));
    assert(processarFila.includes("reservarOfertaProcessandoFila(colecaoReservaProcessamento, oferta"));
    assert(processarFila.includes("claimShadowFila = await observadorClaimShadowFila.iniciar"));
    assert(processarFila.indexOf("reservarOfertaProcessandoFila") < processarFila.indexOf("claimShadowFila = await observadorClaimShadowFila.iniciar"));
    assert(!processarFila.includes("candidatePool"), "candidatePool segue sem decidir o vencedor operacional");
    assert(!processarFila.includes("engine_fairness_origem_fluxo"), "fairness continua desligada na fila");
  }

  console.log("fila-claims-shadow.test.js OK");
})().catch((erro) => {
  console.error(erro.stack || erro.message || erro);
  process.exitCode = 1;
});
