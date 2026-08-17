"use strict";

const assert = require("assert");
const {
  TTL_NORMAL_MS,
  TTL_TURBO_MS,
  avaliarFluxoWorkspaceShadow,
  flowManagerAtivoWorkspace
} = require("../modules/engine/flow-manager/flow-manager.service");

const D1 = "user_40qdblgt";
const ROGER = "user_9hqs434h";
const WOLF = "user_n0o5p99m";
const GENERICO = "workspace_generico_flow_v11";
const NOVO = "workspace_novo_flow_v12";

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
        aceitarAgora: true,
        motivo: "capacidade_disponivel",
        nivelAlvo: 2,
        bufferAtual: 0,
        vagasDisponiveis: 2,
        tipoFluxo: "oferta_comum",
        ttlMs: TTL_NORMAL_MS,
        aplicouMudancas: false
      })
    }
  });

  assert.strictEqual(adicionouFila, true);
  assert.strictEqual(resultado.adicionadasFila, 1);
}

async function testarFlowAtivoTemporarioReentraSemAdicionarFila() {
  limparModulo("../modules/engine/distributor/distributor.runner");
  let adicionouFila = false;
  const statusMarcados = [];
  const etapas = [];

  mockModulo("../modules/engine/distributor/distributor.service", {
    limitarDistribuicao: valor => Number(valor || 1),
    buscarOfertasDistribuiveis: async () => ({
      ok: true,
      ofertas: [{
        id: 10,
        job_id: 20,
        cliente_id: D1,
        marketplace: "mercadolivre",
        categoria: "Gamer e Hardware",
        status: "importada",
        metadata: {}
      }]
    }),
    tentarMarcarDistribuindo: async () => ({ ok: true }),
    marcarOfertaStatus: async (id, status, motivo) => {
      statusMarcados.push({ id, status, motivo });
      return { ok: true };
    },
    restaurarOfertaStatusSeDistribuindo: async () => ({ ok: true }),
    restaurarOfertaParaReentradaFlow: async (id, status, motivo, detalhes) => {
      statusMarcados.push({ id, status, motivo, detalhes, reentradaFlow: true });
      return { ok: true };
    },
    registrarEtapaDistribuicao: async (jobId, etapa, status, motivo, detalhes) => {
      etapas.push({ jobId, etapa, status, motivo, detalhes });
      return { ok: true };
    },
    validarOfertaParaDistribuicao: async () => {
      const retorno = {
        ok: true,
        destinosCompativeis: 1,
        destinosCompativeisDetalhes: [{ destino: "OP GERAL", tipoMidia: "imagem" }]
      };
      Object.defineProperty(retorno, "__destinosCompativeisRaw", {
        value: [destinoRapido()],
        enumerable: false
      });
      return retorno;
    },
    adicionarOfertaNaFilaCliente: async () => {
      adicionouFila = true;
      return { ok: true, itemFila: { id: "fila_10", status: "pendente" } };
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
      flowManager: { ativo: true },
      avaliarFluxoWorkspaceShadow: async () => ({
        workspaceId: D1,
        ofertaId: 10,
        marketplace: "mercadolivre",
        aceitarAgora: false,
        motivo: "esteira_saturada",
        nivelAlvo: 3,
        bufferAtual: 3,
        vagasDisponiveis: 0,
        tipoFluxo: "oferta_comum",
        ttlMs: TTL_NORMAL_MS,
        aplicouMudancas: false
      })
    }
  });

  assert.strictEqual(adicionouFila, false);
  assert.strictEqual(resultado.adicionadasFila, 0);
  assert.strictEqual(resultado.distributorVivo.candidatosPulados, 1);
  assert(statusMarcados.some(item => item.status === "importada" && item.motivo === "flow_aguardando_esteira_saturada"));
  assert(statusMarcados.some(item => item.reentradaFlow === true && Date.parse(item.detalhes?.proximaTentativaEm)));
  assert(etapas.some(item => item.etapa === "flow_manager" && item.status === "aguardando"));
  assert(etapas.some(item => item.etapa === "distribuicao_final" && item.detalhes?.resultadoDistribuicao === "flow_reentrada_temporaria"));
}

async function testarFlowAtivoFailOpenContinuaPipeline() {
  limparModulo("../modules/engine/distributor/distributor.runner");
  let adicionouFila = false;
  const logs = [];
  const logOriginal = console.log;

  mockModulo("../modules/engine/distributor/distributor.service", {
    limitarDistribuicao: valor => Number(valor || 1),
    buscarOfertasDistribuiveis: async () => ({
      ok: true,
      ofertas: [{
        id: 30,
        job_id: 40,
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
    validarOfertaParaDistribuicao: async () => ({
      ok: true,
      destinosCompativeis: 1,
      destinosCompativeisDetalhes: [{ destino: "OP GERAL", tipoMidia: "imagem" }]
    }),
    adicionarOfertaNaFilaCliente: async () => {
      adicionouFila = true;
      return { ok: true, itemFila: { id: "fila_30", status: "pendente" } };
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
  console.log = (...args) => {
    logs.push(args.map(arg => String(arg)).join(" "));
    logOriginal(...args);
  };
  let resultado;
  try {
    resultado = await runner.distribuirOfertasEngine({
      limite: 1,
      deps: {
        flowManager: { ativo: true },
        avaliarFluxoWorkspaceShadow: async () => {
          throw new Error("falha_flow_controlada");
        }
      }
    });
  } finally {
    console.log = logOriginal;
  }

  assert.strictEqual(adicionouFila, true);
  assert.strictEqual(resultado.adicionadasFila, 1);
  assert(logs.some(linha => linha.includes("[OPTIMUS-FLOW-V1-ERRO]")), "falha do Flow deve ser logada de forma sanitizada");
  assert(!logs.join("\n").includes("falha_flow_controlada"), "mensagem interna do erro nao deve vazar no log");
}

async function testarFlowAtivoUniversalIgnoraFlagsLegadas() {
  const envAtivoAnterior = process.env.OPTIMUS_FLOW_V1_ATIVO;
  const envWorkspacesAnterior = process.env.OPTIMUS_FLOW_V1_ATIVO_WORKSPACES;
  try {
    delete process.env.OPTIMUS_FLOW_V1_ATIVO;
    delete process.env.OPTIMUS_FLOW_V1_ATIVO_WORKSPACES;
    assert.strictEqual(flowManagerAtivoWorkspace(D1), true);
    assert.strictEqual(flowManagerAtivoWorkspace(WOLF), true);
    assert.strictEqual(flowManagerAtivoWorkspace(ROGER), true);
    assert.strictEqual(flowManagerAtivoWorkspace(GENERICO), true);
    assert.strictEqual(flowManagerAtivoWorkspace(NOVO), true);
    assert.strictEqual(flowManagerAtivoWorkspace(""), false);
    assert.strictEqual(flowManagerAtivoWorkspace(D1, { ativo: false, workspacesAtivos: "" }), true);
    process.env.OPTIMUS_FLOW_V1_ATIVO_WORKSPACES = ` ${D1},${WOLF} `;
    assert.strictEqual(flowManagerAtivoWorkspace(D1), true);
    assert.strictEqual(flowManagerAtivoWorkspace(WOLF), true);
    assert.strictEqual(flowManagerAtivoWorkspace(ROGER), true);
    process.env.OPTIMUS_FLOW_V1_ATIVO = "1";
    assert.strictEqual(flowManagerAtivoWorkspace(ROGER), true);
  } finally {
    if (envAtivoAnterior === undefined) delete process.env.OPTIMUS_FLOW_V1_ATIVO;
    else process.env.OPTIMUS_FLOW_V1_ATIVO = envAtivoAnterior;
    if (envWorkspacesAnterior === undefined) delete process.env.OPTIMUS_FLOW_V1_ATIVO_WORKSPACES;
    else process.env.OPTIMUS_FLOW_V1_ATIVO_WORKSPACES = envWorkspacesAnterior;
  }
}

function prepararRunnerComEstado(ofertasIniciais = [], opcoes = {}) {
  limparModulo("../modules/engine/distributor/distributor.runner");
  const ofertas = ofertasIniciais.map(item => ({ ...item }));
  const adicionados = [];
  const statusMarcados = [];
  const etapas = [];
  const consultas = [];

  mockModulo("../modules/engine/distributor/distributor.service", {
    limitarDistribuicao: valor => Number(valor || 1),
    buscarOfertasDistribuiveis: async ({ limite = 10, excluirOfertaIds = [] } = {}) => {
      consultas.push({ limite, excluirOfertaIds: [...(excluirOfertaIds || [])] });
      const excluidos = new Set((excluirOfertaIds || []).map(String));
      return {
        ok: true,
        ofertas: ofertas
          .filter(item => ["importada", "oferta_criada"].includes(item.status))
          .filter(item => !excluidos.has(String(item.id)))
          .slice(0, limite)
      };
    },
    tentarMarcarDistribuindo: async id => {
      const oferta = ofertas.find(item => item.id === id);
      if (!oferta || !["importada", "oferta_criada"].includes(oferta.status)) {
        return { ok: true, ignorado: true };
      }
      oferta.status = "distribuindo";
      return { ok: true };
    },
    marcarOfertaStatus: async (id, status, motivo) => {
      const oferta = ofertas.find(item => item.id === id);
      if (oferta) oferta.status = status;
      statusMarcados.push({ id, status, motivo });
      return { ok: true };
    },
    restaurarOfertaStatusSeDistribuindo: async (id, statusAnterior, motivo) => {
      const oferta = ofertas.find(item => item.id === id);
      if (oferta && oferta.status === "distribuindo") oferta.status = statusAnterior;
      statusMarcados.push({ id, status: statusAnterior, motivo });
      return { ok: true };
    },
    restaurarOfertaParaReentradaFlow: async (id, statusAnterior, motivo, detalhes) => {
      const oferta = ofertas.find(item => item.id === id);
      if (oferta && oferta.status === "distribuindo") oferta.status = statusAnterior;
      statusMarcados.push({ id, status: statusAnterior, motivo, detalhes, reentradaFlow: true });
      return { ok: true };
    },
    registrarEtapaDistribuicao: async (jobId, etapa, status, motivo, detalhes) => {
      etapas.push({ jobId, etapa, status, motivo, detalhes });
      return { ok: true };
    },
    validarOfertaParaDistribuicao: async () => {
      const retorno = {
        ok: true,
        destinosCompativeis: 1,
        destinosCompativeisDetalhes: [{ destino: "OP GERAL", tipoMidia: "imagem" }]
      };
      Object.defineProperty(retorno, "__destinosCompativeisRaw", {
        value: [destinoRapido()],
        enumerable: false
      });
      return retorno;
    },
    adicionarOfertaNaFilaCliente: async oferta => {
      adicionados.push(oferta.cliente_id);
      return { ok: true, itemFila: { id: `fila_${oferta.id}`, status: "pendente" } };
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
  return { runner, ofertas, adicionados, statusMarcados, etapas, consultas, opcoes };
}

function ofertaDistribuivel(id, workspaceId, extra = {}) {
  return {
    id,
    job_id: 1000 + id,
    cliente_id: workspaceId,
    marketplace: "mercadolivre",
    categoria: "Gamer e Hardware",
    status: "importada",
    metadata: {},
    ...extra
  };
}

async function testarFlowUniversalD1WolfRogerSemListaManual() {
  const ctx = prepararRunnerComEstado([
    ofertaDistribuivel(101, D1),
    ofertaDistribuivel(102, WOLF),
    ofertaDistribuivel(103, ROGER)
  ]);

  const resultado = await ctx.runner.distribuirOfertasEngine({
    limite: 3,
    deps: {
      avaliarFluxoWorkspaceShadow: async entradaFlow => ({
        workspaceId: entradaFlow.workspaceId,
        ofertaId: entradaFlow.ofertaId,
        marketplace: entradaFlow.marketplace,
        aceitarAgora: entradaFlow.workspaceId !== D1,
        motivo: entradaFlow.workspaceId === D1 ? "esteira_saturada" : "capacidade_disponivel",
        nivelAlvo: 3,
        bufferAtual: entradaFlow.workspaceId === D1 ? 3 : 0,
        vagasDisponiveis: entradaFlow.workspaceId === D1 ? 0 : 3,
        tipoFluxo: "oferta_comum",
        ttlMs: TTL_NORMAL_MS,
        aplicouMudancas: false
      })
    }
  });

  assert.strictEqual(resultado.adicionadasFila, 2);
  assert.deepStrictEqual(ctx.adicionados.sort(), [WOLF, ROGER].sort());
  assert(ctx.statusMarcados.some(item => item.id === 101 && item.status === "importada" && item.motivo === "flow_aguardando_esteira_saturada"));
  assert(ctx.statusMarcados.some(item => item.id === 102 && item.status === "fila"));
  assert(ctx.statusMarcados.some(item => item.id === 103 && item.status === "fila"));
  assert(!ctx.adicionados.includes(D1), "bloqueio temporario do D1 nao deve gerar fila");
}

async function testarFlowTemporarioReapareceEmRodadaFutura() {
  const ctx = prepararRunnerComEstado([
    ofertaDistribuivel(201, D1)
  ]);
  let chamadas = 0;
  const deps = {
    avaliarFluxoWorkspaceShadow: async entradaFlow => {
      chamadas += 1;
      return {
        workspaceId: entradaFlow.workspaceId,
        ofertaId: entradaFlow.ofertaId,
        marketplace: entradaFlow.marketplace,
        aceitarAgora: chamadas > 1,
        motivo: chamadas > 1 ? "capacidade_disponivel" : "esteira_saturada",
        nivelAlvo: 3,
        bufferAtual: chamadas > 1 ? 2 : 3,
        vagasDisponiveis: chamadas > 1 ? 1 : 0,
        tipoFluxo: "oferta_comum",
        ttlMs: TTL_NORMAL_MS,
        aplicouMudancas: false
      };
    }
  };

  const primeira = await ctx.runner.distribuirOfertasEngine({ limite: 1, deps });
  const segunda = await ctx.runner.distribuirOfertasEngine({ limite: 1, deps });

  assert.strictEqual(primeira.processadas, 1);
  assert.strictEqual(segunda.adicionadasFila, 1);
  assert.strictEqual(ctx.ofertas[0].status, "fila");
  assert.strictEqual(ctx.statusMarcados.filter(item => item.motivo === "flow_aguardando_esteira_saturada").length, 1);
}

async function testarWorkspaceNovoRecebeFlowAutomaticamente() {
  const ctx = prepararRunnerComEstado([
    ofertaDistribuivel(501, NOVO)
  ]);
  const resultado = await ctx.runner.distribuirOfertasEngine({
    limite: 1,
    deps: {
      avaliarFluxoWorkspaceShadow: async entradaFlow => ({
        workspaceId: entradaFlow.workspaceId,
        ofertaId: entradaFlow.ofertaId,
        marketplace: entradaFlow.marketplace,
        aceitarAgora: false,
        motivo: "janela_fechada",
        nivelAlvo: 0,
        bufferAtual: 0,
        vagasDisponiveis: 0,
        tipoFluxo: "oferta_comum",
        ttlMs: TTL_NORMAL_MS,
        aplicouMudancas: false
      })
    }
  });

  assert.strictEqual(resultado.adicionadasFila, 0);
  assert(ctx.statusMarcados.some(item => item.id === 501 && item.status === "importada" && item.motivo === "flow_aguardando_janela_fechada"));
  assert(!ctx.adicionados.includes(NOVO), "workspace novo aguardando nao deve criar fila");
}

async function testarMelhoriaComercialPosteriorPodeCriarNovoEvento() {
  const ctx = prepararRunnerComEstado([
    ofertaDistribuivel(301, D1),
    ofertaDistribuivel(302, D1, { titulo: "Oferta melhorada", preco: 90, cupom: "NOVO" })
  ]);
  let chamadas = 0;

  const resultado = await ctx.runner.distribuirOfertasEngine({
    limite: 2,
    deps: {
      flowManager: { ativo: true },
      avaliarFluxoWorkspaceShadow: async entradaFlow => {
        chamadas += 1;
        return {
          workspaceId: entradaFlow.workspaceId,
          ofertaId: entradaFlow.ofertaId,
          marketplace: entradaFlow.marketplace,
          aceitarAgora: entradaFlow.ofertaId === 302,
          motivo: entradaFlow.ofertaId === 302 ? "capacidade_disponivel" : "esteira_saturada",
          nivelAlvo: 3,
          bufferAtual: entradaFlow.ofertaId === 302 ? 2 : 3,
          vagasDisponiveis: entradaFlow.ofertaId === 302 ? 1 : 0,
          tipoFluxo: "oferta_comum",
          ttlMs: TTL_NORMAL_MS,
          aplicouMudancas: false
        };
      }
    }
  });

  assert.strictEqual(chamadas, 2);
  assert.strictEqual(resultado.adicionadasFila, 1);
  assert(ctx.statusMarcados.some(item => item.id === 301 && item.status === "importada" && item.motivo === "flow_aguardando_esteira_saturada"));
  assert(ctx.statusMarcados.some(item => item.id === 302 && item.status === "fila"));
}

async function testarWorkspaceGenericoCalculaCapacidadeSemIdD1() {
  const destinosCompativeis = [
    destino({ id: "wa_1", nome: "WA Geral", tipo: "whatsapp", intervaloMinutos: 10 }),
    destino({ id: "tg_1", nome: "Telegram Geral", tipo: "telegram", intervaloMinutos: 5 }),
    destino({ id: "dc_1", nome: "Discord Geral", tipo: "discord", intervaloMinutos: 5 })
  ];

  const pequeno = await avaliarFluxoWorkspaceShadow(
    entrada(GENERICO, { destinosCompativeis: [destino({ id: "wa_pequeno", tipo: "whatsapp", intervaloMinutos: 10 })] }),
    opcoes()
  );
  assert.strictEqual(pequeno.aceitarAgora, true);
  assert.strictEqual(pequeno.nivelAlvo, 1);

  const grande = await avaliarFluxoWorkspaceShadow(
    entrada(GENERICO, { destinosCompativeis }),
    opcoes()
  );
  assert.strictEqual(grande.aceitarAgora, true);
  assert(grande.nivelAlvo >= 3, "workspace generico grande deve somar capacidade WA/TG/Discord");
  assert.strictEqual(grande.tipoFluxo, "oferta_comum");

  const turbo = await avaliarFluxoWorkspaceShadow(
    entrada(GENERICO, { destinosCompativeis, cupomTurbo: true, tipoOperacional: "cupom_turbo" }),
    opcoes()
  );
  assert.strictEqual(turbo.tipoFluxo, "cupom_turbo");
  assert.strictEqual(turbo.ttlMs, TTL_TURBO_MS);
  assert(turbo.nivelAlvo >= 1, "turbo deve usar cobertura curta sem depender da D1");
}

async function testarWorkspaceGenericoJanelaEBufferReentram() {
  const fechado = await avaliarFluxoWorkspaceShadow(
    entrada(GENERICO, { destinosCompativeis: [destino({ horarioInicio: "25:00", horarioFim: "25:01" })] }),
    opcoes()
  );
  assert.strictEqual(fechado.aceitarAgora, false);
  assert.strictEqual(fechado.motivo, "janela_fechada");

  const reaberto = await avaliarFluxoWorkspaceShadow(
    entrada(GENERICO, { destinosCompativeis: [destinoRapido()] }),
    opcoes()
  );
  assert.strictEqual(reaberto.aceitarAgora, true);

  const filas = {
    [GENERICO]: [
      itemFila({ id: "slot_1", clienteId: GENERICO }),
      itemFila({ id: "slot_2", clienteId: GENERICO }),
      itemFila({ id: "slot_3", clienteId: GENERICO })
    ]
  };
  const cheio = await avaliarFluxoWorkspaceShadow(
    entrada(GENERICO, { destinosCompativeis: [destinoRapido()] }),
    opcoes(filas)
  );
  assert.strictEqual(cheio.aceitarAgora, false);
  assert.strictEqual(cheio.motivo, "esteira_saturada");

  const liberado = await avaliarFluxoWorkspaceShadow(
    entrada(GENERICO, { destinosCompativeis: [destinoRapido()] }),
    opcoes({ [GENERICO]: filas[GENERICO].slice(0, 2) })
  );
  assert.strictEqual(liberado.aceitarAgora, true);
}

async function testarAceiteGeraFilaUmaUnicaVez() {
  const ctx = prepararRunnerComEstado([
    ofertaDistribuivel(401, D1)
  ]);
  const deps = {
    flowManager: { ativo: true },
    avaliarFluxoWorkspaceShadow: async entradaFlow => ({
      workspaceId: entradaFlow.workspaceId,
      ofertaId: entradaFlow.ofertaId,
      marketplace: entradaFlow.marketplace,
      aceitarAgora: true,
      motivo: "capacidade_disponivel",
      nivelAlvo: 3,
      bufferAtual: 0,
      vagasDisponiveis: 3,
      tipoFluxo: "oferta_comum",
      ttlMs: TTL_NORMAL_MS,
      aplicouMudancas: false
    })
  };

  const primeira = await ctx.runner.distribuirOfertasEngine({ limite: 1, deps });
  const segunda = await ctx.runner.distribuirOfertasEngine({ limite: 1, deps });

  assert.strictEqual(primeira.adicionadasFila, 1);
  assert.strictEqual(segunda.adicionadasFila, 0);
  assert.strictEqual(ctx.adicionados.length, 1);
  assert.strictEqual(ctx.ofertas[0].status, "fila");
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
  await testarFlowAtivoTemporarioReentraSemAdicionarFila();
  await testarFlowAtivoFailOpenContinuaPipeline();
  await testarFlowAtivoUniversalIgnoraFlagsLegadas();
  await testarFlowUniversalD1WolfRogerSemListaManual();
  await testarFlowTemporarioReapareceEmRodadaFutura();
  await testarWorkspaceNovoRecebeFlowAutomaticamente();
  await testarMelhoriaComercialPosteriorPodeCriarNovoEvento();
  await testarWorkspaceGenericoCalculaCapacidadeSemIdD1();
  await testarWorkspaceGenericoJanelaEBufferReentram();
  await testarAceiteGeraFilaUmaUnicaVez();
  console.log("optimus-flow-v1-shadow.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
