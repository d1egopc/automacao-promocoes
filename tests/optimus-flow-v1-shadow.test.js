"use strict";

const assert = require("assert");
const {
  TTL_NORMAL_MS,
  TTL_TURBO_MS,
  avaliarFluxoWorkspaceShadow
} = require("../modules/engine/flow-manager/flow-manager.service");

const D1 = "user_40qdblgt";
const ROGER = "user_9hqs434h";

function destino(extra = {}) {
  return {
    id: extra.id || "op_geral",
    nome: extra.nome || "OP GERAL",
    tipo: "whatsapp",
    ativo: true,
    intervaloMinutos: 5,
    horarioInicio: "00:00",
    horarioFim: "23:59",
    limiteDiarioRestante: 10,
    ...extra
  };
}

function destinoRapido(extra = {}) {
  return destino({
    intervaloMinutos: 3,
    ...extra
  });
}

function itemFila(extra = {}) {
  return {
    id: extra.id || `fila_${Math.random()}`,
    clienteId: extra.clienteId || D1,
    status: extra.status || "pendente",
    dataEntradaFila: extra.dataEntradaFila || "2026-08-03T10:00:00.000Z",
    marketplace: "mercadolivre",
    ...extra
  };
}

function opcoes(filas = {}, extra = {}) {
  return {
    agoraMs: Date.parse("2026-08-03T10:05:00.000Z"),
    readClienteJson: (clienteId, arquivo, fallback) => {
      if (arquivo !== "fila.json") return fallback;
      return filas[clienteId] || [];
    },
    ...extra
  };
}

function entrada(workspaceId = D1, extra = {}) {
  return {
    workspaceId,
    ofertaId: extra.ofertaId || 123,
    marketplace: extra.marketplace || "mercadolivre",
    tipoOperacional: extra.tipoOperacional || "",
    cupomTurbo: extra.cupomTurbo === true,
    prioridade: extra.prioridade ?? 0,
    oferta: {
      id: extra.ofertaId || 123,
      cliente_id: workspaceId,
      marketplace: extra.marketplace || "mercadolivre",
      criada_em: "2026-08-03T10:04:00.000Z",
      score: extra.score ?? 0,
      prioridade: extra.prioridade ?? 0
    },
    destinosCompativeis: extra.destinosCompativeis || [destino()]
  };
}

async function testarWorkspaceFechadaRecusa() {
  const decisao = await avaliarFluxoWorkspaceShadow(
    entrada(D1, { destinosCompativeis: [destino({ horarioInicio: "25:00", horarioFim: "25:01" })] }),
    opcoes()
  );
  assert.strictEqual(decisao.aceitarAgora, false);
  assert.strictEqual(decisao.motivo, "janela_fechada");
  assert.strictEqual(decisao.nivelAlvo, 0);
  assert.strictEqual(decisao.aplicouMudancas, false);
}

async function testarWorkspaceSemSessaoRecusa() {
  const decisao = await avaliarFluxoWorkspaceShadow(
    entrada(D1, { destinosCompativeis: [destino({ statusSessao: "desconectado" })] }),
    opcoes()
  );
  assert.strictEqual(decisao.aceitarAgora, false);
  assert.strictEqual(decisao.motivo, "sessao_ou_integracao_inapta");
  assert.strictEqual(decisao.nivelAlvo, 0);
}

async function testarWorkspaceSemCreditoRecusa() {
  const decisao = await avaliarFluxoWorkspaceShadow(
    entrada(D1),
    opcoes({}, {
      validarCreditos: async () => ({ ok: false, motivo: "sem_credito" })
    })
  );
  assert.strictEqual(decisao.aceitarAgora, false);
  assert.strictEqual(decisao.motivo, "sem_credito");
  assert.strictEqual(decisao.quantidadeAceita, 0);
}

async function testarWorkspaceSaturadaRecusa() {
  const filas = {
    [D1]: [
      itemFila({ id: "a" }),
      itemFila({ id: "b" })
    ]
  };
  const decisao = await avaliarFluxoWorkspaceShadow(entrada(D1), opcoes(filas));
  assert.strictEqual(decisao.nivelAlvo, 2);
  assert.strictEqual(decisao.bufferAtual, 2);
  assert.strictEqual(decisao.vagasDisponiveis, 0);
  assert.strictEqual(decisao.aceitarAgora, false);
  assert.strictEqual(decisao.motivo, "esteira_saturada");
}

async function testarReposicaoVivaPorEnvio() {
  const destinosCompativeis = [destinoRapido()];
  const filaCheia = {
    [D1]: [
      itemFila({ id: "slot_1" }),
      itemFila({ id: "slot_2" }),
      itemFila({ id: "slot_3" })
    ]
  };
  const cheia = await avaliarFluxoWorkspaceShadow(entrada(D1, { destinosCompativeis }), opcoes(filaCheia));
  assert.strictEqual(cheia.nivelAlvo, 3);
  assert.strictEqual(cheia.bufferAtual, 3);
  assert.strictEqual(cheia.aceitarAgora, false);

  const filaComEnvio = {
    [D1]: [
      itemFila({ id: "slot_1", status: "enviado" }),
      itemFila({ id: "slot_2" }),
      itemFila({ id: "slot_3" })
    ]
  };
  const depoisEnvio = await avaliarFluxoWorkspaceShadow(entrada(D1, { destinosCompativeis }), opcoes(filaComEnvio));
  assert.strictEqual(depoisEnvio.bufferAtual, 2);
  assert.strictEqual(depoisEnvio.vagasDisponiveis, 1);
  assert.strictEqual(depoisEnvio.aceitarAgora, true);

  const filaCompletaNovamente = {
    [D1]: [
      itemFila({ id: "slot_1", status: "enviado" }),
      itemFila({ id: "slot_2" }),
      itemFila({ id: "slot_3" }),
      itemFila({ id: "slot_4" })
    ]
  };
  const completa = await avaliarFluxoWorkspaceShadow(entrada(D1, { destinosCompativeis }), opcoes(filaCompletaNovamente));
  assert.strictEqual(completa.bufferAtual, 3);
  assert.strictEqual(completa.aceitarAgora, false);
}

async function testarItemExpiradoLiberaVagaShadow() {
  const destinosCompativeis = [destinoRapido()];
  const filas = {
    [D1]: [
      itemFila({ id: "vivo", dataEntradaFila: "2026-08-03T10:00:00.000Z" }),
      itemFila({ id: "expirado_shadow", dataEntradaFila: "2026-08-03T09:00:00.000Z" })
    ]
  };
  const decisao = await avaliarFluxoWorkspaceShadow(entrada(D1, { destinosCompativeis }), opcoes(filas));
  assert.strictEqual(decisao.nivelAlvo, 3);
  assert.strictEqual(decisao.bufferAtual, 1);
  assert.deepStrictEqual(decisao.itensBufferShadow.map(item => item.id), ["vivo"]);
  assert.strictEqual(decisao.aceitarAgora, true);
}

async function testarBufferContaSomenteItensVivosCompativeis() {
  const destinosCompativeis = [destinoRapido({ id: "op_geral" })];
  const filas = {
    [D1]: [
      itemFila({ id: "vivo_compativel", destinoId: "op_geral" }),
      itemFila({ id: "enviado_fora", status: "enviado", destinoId: "op_geral" }),
      itemFila({ id: "erro_final_fora", status: "erro_final", destinoId: "op_geral" }),
      itemFila({ id: "retida_fora", status: "retida", destinoId: "op_geral" }),
      itemFila({ id: "expirada_fora", status: "expirada", destinoId: "op_geral" }),
      itemFila({ id: "destino_incompativel", destinoId: "outro_destino" }),
      itemFila({ id: "sem_timestamp_fora", destinoId: "op_geral", dataEntradaFila: null, criadoEm: null })
    ]
  };
  const decisao = await avaliarFluxoWorkspaceShadow(entrada(D1, { destinosCompativeis }), opcoes(filas));
  assert.strictEqual(decisao.bufferAtual, 1);
  assert.deepStrictEqual(decisao.itensBufferShadow.map(item => item.id), ["vivo_compativel"]);
}

async function testarDestinoFechadoEReabertoRecalculaNivel() {
  const fechado = await avaliarFluxoWorkspaceShadow(
    entrada(D1, { destinosCompativeis: [destinoRapido({ horarioInicio: "25:00", horarioFim: "25:01" })] }),
    opcoes()
  );
  assert.strictEqual(fechado.nivelAlvo, 0);
  assert.strictEqual(fechado.aceitarAgora, false);

  const reaberto = await avaliarFluxoWorkspaceShadow(
    entrada(D1, { destinosCompativeis: [destinoRapido()] }),
    opcoes()
  );
  assert.strictEqual(reaberto.nivelAlvo, 3);
  assert.strictEqual(reaberto.aceitarAgora, true);
}

async function testarTurboConsumidoLiberaVaga() {
  const destinosCompativeis = [destinoRapido({ cupomTurbo: true, intervaloTurboMinutos: 2.5 })];
  const filaTurboCheia = {
    [D1]: [
      itemFila({ id: "turbo_1", cupomTurbo: true }),
      itemFila({ id: "turbo_2", cupomTurbo: true })
    ]
  };
  const turboCheia = await avaliarFluxoWorkspaceShadow(
    entrada(D1, { destinosCompativeis, cupomTurbo: true, tipoOperacional: "cupom_turbo" }),
    opcoes(filaTurboCheia)
  );
  assert.strictEqual(turboCheia.tipoFluxo, "cupom_turbo");
  assert.strictEqual(turboCheia.nivelAlvo, 2);
  assert.strictEqual(turboCheia.bufferAtual, 2);
  assert.strictEqual(turboCheia.aceitarAgora, false);

  const filaTurboConsumida = {
    [D1]: [
      itemFila({ id: "turbo_1", cupomTurbo: true, status: "enviado" }),
      itemFila({ id: "turbo_2", cupomTurbo: true })
    ]
  };
  const depoisConsumo = await avaliarFluxoWorkspaceShadow(
    entrada(D1, { destinosCompativeis, cupomTurbo: true, tipoOperacional: "cupom_turbo" }),
    opcoes(filaTurboConsumida)
  );
  assert.strictEqual(depoisConsumo.bufferAtual, 1);
  assert.strictEqual(depoisConsumo.vagasDisponiveis, 1);
  assert.strictEqual(depoisConsumo.aceitarAgora, true);
}

async function testarOfertaRecusadaNaoViraDividaFutura() {
  const fechada = await avaliarFluxoWorkspaceShadow(
    entrada(D1, { ofertaId: "recusada", destinosCompativeis: [destinoRapido({ horarioInicio: "25:00", horarioFim: "25:01" })] }),
    opcoes()
  );
  assert.strictEqual(fechada.aceitarAgora, false);
  assert.strictEqual(fechada.bufferAtual, 0);

  const reavaliadaComDestinoAberto = await avaliarFluxoWorkspaceShadow(
    entrada(D1, { ofertaId: "nova", destinosCompativeis: [destinoRapido()] }),
    opcoes()
  );
  assert.strictEqual(reavaliadaComDestinoAberto.bufferAtual, 0);
  assert.strictEqual(reavaliadaComDestinoAberto.aceitarAgora, true);
}

async function testarWorkspaceAptaComVagaAceita() {
  const decisao = await avaliarFluxoWorkspaceShadow(entrada(D1, { score: 0, prioridade: 0 }), opcoes());
  assert.strictEqual(decisao.aceitarAgora, true);
  assert.strictEqual(decisao.quantidadeAceita, 1);
  assert.strictEqual(decisao.nivelAlvo, 2);
  assert.strictEqual(decisao.bufferAtual, 0);
  assert.strictEqual(decisao.vagasDisponiveis, 2);
  assert.strictEqual(decisao.motivo, "capacidade_disponivel");
}

async function testarDestinoConsumiuUmaVagaAindaAceitaOfertaFresca() {
  const filas = { [D1]: [itemFila({ id: "vaga_consumida" })] };
  const decisao = await avaliarFluxoWorkspaceShadow(entrada(D1), opcoes(filas));
  assert.strictEqual(decisao.nivelAlvo, 2);
  assert.strictEqual(decisao.bufferAtual, 1);
  assert.strictEqual(decisao.vagasDisponiveis, 1);
  assert.strictEqual(decisao.aceitarAgora, true);
}

async function testarTurboPrioridadeETtl() {
  const normal = await avaliarFluxoWorkspaceShadow(entrada(D1, { prioridade: 10 }), opcoes());
  const turbo = await avaliarFluxoWorkspaceShadow(
    entrada(D1, { prioridade: 10, cupomTurbo: true, tipoOperacional: "cupom_turbo" }),
    opcoes()
  );
  assert.strictEqual(normal.tipoFluxo, "oferta_comum");
  assert.strictEqual(turbo.tipoFluxo, "cupom_turbo");
  assert(turbo.prioridadeFluxo > normal.prioridadeFluxo);
  assert.strictEqual(normal.ttlMs, TTL_NORMAL_MS);
  assert.strictEqual(turbo.ttlMs, TTL_TURBO_MS);
}

async function testarCupomSemSinalTurboPermaneceOfertaComum() {
  const casos = [
    entrada(D1, { marketplace: "mercadolivre" }),
    entrada(D1, { marketplace: "shopee" }),
    entrada(D1, { marketplace: "aliexpress" }),
    entrada(D1, { marketplace: "awin" })
  ];
  for (const caso of casos) {
    caso.oferta.cupom = "CUPOM_SANITIZADO";
    const decisao = await avaliarFluxoWorkspaceShadow(caso, opcoes());
    assert.strictEqual(decisao.tipoFluxo, "oferta_comum");
    assert.strictEqual(decisao.ttlMs, TTL_NORMAL_MS);
  }
}

async function testarRogerBloqueadoNaoInterfereNoD1() {
  const roger = await avaliarFluxoWorkspaceShadow(
    entrada(ROGER, { destinosCompativeis: [destino({ statusSessao: "desconectado" })] }),
    opcoes()
  );
  const d1 = await avaliarFluxoWorkspaceShadow(entrada(D1), opcoes());
  assert.strictEqual(roger.aceitarAgora, false);
  assert.strictEqual(d1.aceitarAgora, true);
}

function limparModulo(relativo) {
  const resolvido = require.resolve(relativo);
  delete require.cache[resolvido];
  return resolvido;
}

function mockModulo(relativo, exports) {
  const resolvido = limparModulo(relativo);
  require.cache[resolvido] = {
    id: resolvido,
    filename: resolvido,
    loaded: true,
    exports
  };
}

async function testarFlowShadowNaoAlteraDistributorAtual() {
  limparModulo("../modules/engine/distributor/distributor.runner");
  let adicionouFila = false;

  mockModulo("../modules/engine/distributor/distributor.service", {
    limitarDistribuicao: valor => Number(valor || 1),
    buscarOfertasDistribuiveis: async () => ({
      ok: true,
      ofertas: [{
        id: 1,
        job_id: 2,
        cliente_id: D1,
        marketplace: "mercadolivre",
        categoria: "Gamer e Hardware",
        status: "importada",
        metadata: {}
      }]
    }),
    tentarMarcarDistribuindo: async () => ({ ok: true }),
    marcarOfertaStatus: async () => ({ ok: true }),
    restaurarOfertaStatusSeDistribuindo: async () => ({ ok: true }),
    registrarEtapaDistribuicao: async () => ({ ok: true }),
    validarOfertaParaDistribuicao: async () => {
      const retorno = {
        ok: true,
        destinosCompativeis: 1,
        destinosCompativeisDetalhes: [{ destino: "OP GERAL", tipoMidia: "imagem" }]
      };
      Object.defineProperty(retorno, "__destinosCompativeisRaw", {
        value: [destino()],
        enumerable: false
      });
      return retorno;
    },
    adicionarOfertaNaFilaCliente: async () => {
      adicionouFila = true;
      return { ok: true, itemFila: { id: "fila_1", status: "pendente" } };
    }
  });
  mockModulo("../modules/engine/ofc/commercial-events.service", {
    registrarDistribuicaoFinal: async () => ({ ok: true }),
    registrarFilaClienteAdicionada: async () => ({ ok: true })
  });
  mockModulo("../modules/engine/ofc/active-gate.service", {
    decidirAbsorcaoWorkspace: async () => ({ ativo: false, permitir: true, quantidadeAceitaAgora: 1 })
  });

  const runner = require("../modules/engine/distributor/distributor.runner");
  const resultado = await runner.distribuirOfertasEngine({
    limite: 1,
    deps: {
      avaliarFluxoWorkspaceShadow: async () => ({
        aceitarAgora: false,
        motivo: "esteira_saturada",
        aplicouMudancas: false
      })
    }
  });

  assert.strictEqual(adicionouFila, true);
  assert.strictEqual(resultado.adicionadasFila, 1);
}

(async () => {
  await testarWorkspaceFechadaRecusa();
  await testarWorkspaceSemSessaoRecusa();
  await testarWorkspaceSemCreditoRecusa();
  await testarWorkspaceSaturadaRecusa();
  await testarReposicaoVivaPorEnvio();
  await testarItemExpiradoLiberaVagaShadow();
  await testarBufferContaSomenteItensVivosCompativeis();
  await testarDestinoFechadoEReabertoRecalculaNivel();
  await testarTurboConsumidoLiberaVaga();
  await testarOfertaRecusadaNaoViraDividaFutura();
  await testarWorkspaceAptaComVagaAceita();
  await testarDestinoConsumiuUmaVagaAindaAceitaOfertaFresca();
  await testarTurboPrioridadeETtl();
  await testarCupomSemSinalTurboPermaneceOfertaComum();
  await testarRogerBloqueadoNaoInterfereNoD1();
  await testarFlowShadowNaoAlteraDistributorAtual();
  console.log("optimus-flow-v1-shadow.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
