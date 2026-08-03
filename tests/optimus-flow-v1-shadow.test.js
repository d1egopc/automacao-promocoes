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
  await testarWorkspaceAptaComVagaAceita();
  await testarDestinoConsumiuUmaVagaAindaAceitaOfertaFresca();
  await testarTurboPrioridadeETtl();
  await testarRogerBloqueadoNaoInterfereNoD1();
  await testarFlowShadowNaoAlteraDistributorAtual();
  console.log("optimus-flow-v1-shadow.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
