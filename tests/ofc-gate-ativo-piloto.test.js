"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

function destino(extra = {}) {
  return {
    id: extra.id || "destino_1",
    nome: extra.nome || "Destino",
    ativo: extra.ativo !== false,
    tipo: extra.tipo || "telegram",
    botToken: extra.botToken === undefined ? "bot" : extra.botToken,
    chatId: extra.chatId === undefined ? "chat" : extra.chatId,
    horarioInicio: extra.horarioInicio || "00:00",
    horarioFim: extra.horarioFim || "23:59",
    intervaloMinutos: extra.intervaloMinutos || 5,
    intervaloTurboMinutos: extra.intervaloTurboMinutos || 2.5,
    ...extra
  };
}

function item(id, extra = {}) {
  return {
    id,
    status: extra.status || "pendente",
    dataEntradaFila: extra.dataEntradaFila || new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    marketplace: extra.marketplace || "mercadolivre",
    ...extra
  };
}

const {
  decidirAbsorcaoWorkspace
} = require("../modules/engine/ofc/active-gate.service");

const WORKSPACE_ROGER = "user_9hqs434h";
const WORKSPACE_D1 = "user_40qdblgt";
const WORKSPACE_WOLF = "user_n0o5p99m";

async function decisao(entrada = {}, opcoes = {}) {
  return decidirAbsorcaoWorkspace({
    workspaceId: WORKSPACE_ROGER,
    ofertaId: "oferta_1",
    marketplace: "mercadolivre",
    tipoOperacional: "comum",
    destinosCompativeis: [destino()],
    quantidadeSolicitada: 1,
    ...entrada
  }, {
    workspacesAtivos: new Set([WORKSPACE_ROGER]),
    usuarios: [
      { id: WORKSPACE_ROGER, papel: "cliente" },
      { id: WORKSPACE_D1, papel: "cliente" },
      { id: WORKSPACE_WOLF, papel: "cliente" },
      { id: "admin", papel: "admin_master" }
    ],
    readClienteJson: () => [],
    ...opcoes
  });
}

(async () => {
  const livre = await decisao();
  assert.strictEqual(livre.modo, "ativo_piloto");
  assert.strictEqual(livre.permitir, true);
  assert.strictEqual(livre.estadoDaEsteira, "LIVRE");
  assert.strictEqual(livre.motivo, "capacidade_disponivel");
  assert.strictEqual(livre.filaAlvo, 2);
  assert.strictEqual(livre.capacidadeAtual, 2);
  assert.strictEqual(livre.quantidadeAceitaAgora, 1);

  const historicoNaoPressiona = await decisao({}, {
    readClienteJson: () => Array.from({ length: 500 }, (_, i) => item(`h${i}`, { status: "enviado" }))
  });
  assert.strictEqual(historicoNaoPressiona.pressaoEsteiraViva, 0);
  assert.strictEqual(historicoNaoPressiona.permitir, true);

  const saturado = await decisao({}, {
    readClienteJson: () => [item("p1"), item("p2")]
  });
  assert.strictEqual(saturado.permitir, false);
  assert.strictEqual(saturado.estadoDaEsteira, "SATURADA");
  assert.strictEqual(saturado.motivo, "esteira_saturada");
  assert.strictEqual(saturado.quantidadeAceitaAgora, 0);

  const rogerVelhoNaoSatura = await decisao({}, {
    readClienteJson: () => [
      item("velho_1", { dataEntradaFila: new Date(Date.now() - 31 * 60 * 1000).toISOString() }),
      item("velho_2", { dataEntradaFila: new Date(Date.now() - 40 * 60 * 1000).toISOString() }),
      item("velho_3", { status: "erro_temporario", dataEntradaFila: new Date(Date.now() - 45 * 60 * 1000).toISOString() })
    ]
  });
  assert.strictEqual(rogerVelhoNaoSatura.pressaoEsteiraViva, 0);
  assert.strictEqual(rogerVelhoNaoSatura.capacidadeAtual, 2);
  assert.strictEqual(rogerVelhoNaoSatura.permitir, true);

  const rogerParcialUmaVaga = await decisao({
    destinosCompativeis: [destino({ intervaloMinutos: 3 })]
  }, {
    readClienteJson: () => [
      item("fresco_1"),
      item("fresco_2"),
      item("velho_1", { dataEntradaFila: new Date(Date.now() - 31 * 60 * 1000).toISOString() })
    ]
  });
  assert.strictEqual(rogerParcialUmaVaga.filaAlvo, 3);
  assert.strictEqual(rogerParcialUmaVaga.pressaoEsteiraViva, 2);
  assert.strictEqual(rogerParcialUmaVaga.capacidadeAtual, 1);
  assert.strictEqual(rogerParcialUmaVaga.permitir, true);

  const sessaoInaptaComPressaoAlta = await decisao({
    destinosCompativeis: [destino({ statusSessao: "desconectada" })]
  }, {
    readClienteJson: () => [item("p1"), item("p2"), item("p3")]
  });
  assert.strictEqual(sessaoInaptaComPressaoAlta.permitir, false);
  assert.strictEqual(sessaoInaptaComPressaoAlta.estadoDaEsteira, "FECHADA");
  assert.strictEqual(sessaoInaptaComPressaoAlta.motivo, "sessao_ou_integracao_inapta");
  assert.strictEqual(sessaoInaptaComPressaoAlta.quantidadeAceitaAgora, 0);

  const sessaoRuntimeInaptaComPressaoAlta = await decisao({}, {
    readClienteJson: () => [item("p1"), item("p2"), item("p3")],
    diagnosticarDisponibilidadeEnvioWorkspace: () => ({
      ok: false,
      motivo: "sessao_whatsapp_indisponivel",
      sessaoId: "user_9hqs434h_OP GERAL"
    })
  });
  assert.strictEqual(sessaoRuntimeInaptaComPressaoAlta.permitir, false);
  assert.strictEqual(sessaoRuntimeInaptaComPressaoAlta.estadoDaEsteira, "FECHADA");
  assert.strictEqual(sessaoRuntimeInaptaComPressaoAlta.motivo, "sessao_ou_integracao_inapta");
  assert.strictEqual(sessaoRuntimeInaptaComPressaoAlta.quantidadeAceitaAgora, 0);
  assert.strictEqual(sessaoRuntimeInaptaComPressaoAlta.pressaoEsteiraViva, 3);

  const limitado = await decisao({ quantidadeSolicitada: 2 }, {
    readClienteJson: () => [item("p1")]
  });
  assert.strictEqual(limitado.permitir, true);
  assert.strictEqual(limitado.estadoDaEsteira, "LIMITADA");
  assert.strictEqual(limitado.motivo, "capacidade_disponivel");
  assert.strictEqual(limitado.quantidadeAceitaAgora, 1);

  const fechado = await decisao({
    destinosCompativeis: [destino({ horarioInicio: "00:00", horarioFim: "00:01" })]
  }, {
    readClienteJson: () => [item("p1"), item("p2")]
  });
  assert.strictEqual(fechado.permitir, false);
  assert.strictEqual(fechado.estadoDaEsteira, "FECHADA");
  assert.strictEqual(fechado.motivo, "janela_fechada");
  assert.strictEqual(fechado.quantidadeAceitaAgora, 0);

  const integracaoInapta = await decisao({
    destinosCompativeis: [destino({ botToken: "", chatId: "" })]
  });
  assert.strictEqual(integracaoInapta.permitir, false);
  assert.strictEqual(integracaoInapta.estadoDaEsteira, "FECHADA");
  assert.strictEqual(integracaoInapta.motivo, "sessao_ou_integracao_inapta");

  const turbo = await decisao({
    cupomTurbo: true,
    tipoOperacional: "cupom_turbo",
    quantidadeSolicitada: 2,
    destinosCompativeis: [destino({ intervaloMinutos: 10, intervaloTurboMinutos: 2.5 })]
  });
  assert.strictEqual(turbo.cupomTurbo, true);
  assert.strictEqual(turbo.filaAlvo, 2);
  assert.strictEqual(turbo.quantidadeAceitaAgora, 2);

  const turboSemEstoqueArtificial = await decisao({
    cupomTurbo: true,
    tipoOperacional: "cupom_turbo",
    quantidadeSolicitada: 3,
    destinosCompativeis: [destino({ intervaloMinutos: 10, intervaloTurboMinutos: 2.5 })]
  }, {
    readClienteJson: () => [item("p1")]
  });
  assert.strictEqual(turboSemEstoqueArtificial.quantidadeAceitaAgora, 1);
  assert.strictEqual(turboSemEstoqueArtificial.estadoDaEsteira, "LIMITADA");

  const falhaRoger = await decisao({}, {
    readClienteJson: () => {
      throw new Error("falha_controlada");
    }
  });
  assert.strictEqual(falhaRoger.permitir, false);
  assert.strictEqual(falhaRoger.fallbackAplicado, true);
  assert.strictEqual(falhaRoger.motivo, "gate_indisponivel_piloto");

  const d1SemFlag = await decidirAbsorcaoWorkspace({
    workspaceId: WORKSPACE_D1,
    ofertaId: "oferta_d1",
    destinosCompativeis: [destino()]
  }, {
    workspacesAtivos: new Set([WORKSPACE_ROGER]),
    usuarios: [{ id: WORKSPACE_D1, papel: "cliente" }]
  });
  assert.strictEqual(d1SemFlag.ativo, false);
  assert.strictEqual(d1SemFlag.permitir, true);

  const wolfSemFlag = await decidirAbsorcaoWorkspace({
    workspaceId: WORKSPACE_WOLF,
    ofertaId: "oferta_wolf",
    destinosCompativeis: [destino()]
  }, {
    workspacesAtivos: new Set([WORKSPACE_ROGER]),
    usuarios: [{ id: WORKSPACE_WOLF, papel: "cliente" }]
  });
  assert.strictEqual(wolfSemFlag.ativo, false);
  assert.strictEqual(wolfSemFlag.permitir, true);

  const adminProtegido = await decidirAbsorcaoWorkspace({
    workspaceId: "admin",
    ofertaId: "oferta_admin",
    destinosCompativeis: [destino()]
  }, {
    workspacesAtivos: new Set(["admin"]),
    usuarios: [{ id: "admin", papel: "admin_master" }]
  });
  assert.strictEqual(adminProtegido.ativo, false);
  assert.strictEqual(adminProtegido.permitir, true);

  let adicionou = 0;
  const statusMarcados = [];
  const etapasRegistradas = [];
  const restauracoesSeguras = [];
  limparModulo("../modules/engine/distributor/distributor.runner");
  mockModulo("../modules/engine/distributor/distributor.service", {
    limitarDistribuicao: valor => Number(valor || 10),
    buscarOfertasDistribuiveis: async () => ({
      ok: true,
      ofertas: [{
        id: 101,
        evento_id: 201,
        job_id: 301,
        cliente_id: WORKSPACE_ROGER,
        marketplace: "mercadolivre",
        titulo: "Oferta Roger",
        categoria: "Moda",
        status: "importada",
        metadata: {}
      }]
    }),
    tentarMarcarDistribuindo: async () => ({ ok: true }),
    marcarOfertaStatus: async (id, status, motivo) => {
      statusMarcados.push({ id, status, motivo });
      return { ok: true };
    },
    restaurarOfertaStatusSeDistribuindo: async (id, statusAnterior, motivo) => {
      restauracoesSeguras.push({ id, statusAnterior, motivo });
      statusMarcados.push({ id, status: statusAnterior, motivo: "" });
      return { ok: true };
    },
    restaurarOfertaParaReentradaFlow: async (id, statusAnterior, motivo) => {
      restauracoesSeguras.push({ id, statusAnterior, motivo, reentradaFlow: true });
      statusMarcados.push({ id, status: statusAnterior, motivo });
      return { ok: true };
    },
    registrarEtapaDistribuicao: async (jobId, etapa, status, motivo, detalhes) => {
      etapasRegistradas.push({ jobId, etapa, status, motivo, detalhes });
      return { ok: true };
    },
    validarOfertaParaDistribuicao: async () => {
      const retorno = {
        ok: true,
        destinosCompativeis: 1,
        destinosCompativeisDetalhes: [{ destino: "Destino", tipoMidia: "imagem" }]
      };
      Object.defineProperty(retorno, "__destinosCompativeisRaw", {
        value: [destino()],
        enumerable: false
      });
      return retorno;
    },
    adicionarOfertaNaFilaCliente: async () => {
      adicionou += 1;
      return { ok: true, itemFila: { id: "fila_101", status: "pendente" } };
    }
  });
  mockModulo("../modules/engine/ofc/commercial-events.service", {
    registrarDistribuicaoFinal: async () => ({ ok: true }),
    registrarFilaClienteAdicionada: async () => ({ ok: true })
  });

  let distributor = require("../modules/engine/distributor/distributor.runner");
  const bloqueado = await distributor.distribuirOfertasEngine({
    limite: 1,
    deps: {
      decidirAbsorcaoWorkspace: async () => ({
        ativo: true,
        modo: "ativo_piloto",
        workspaceId: WORKSPACE_ROGER,
        permitir: false,
        quantidadeAceitaAgora: 0,
        estadoDaEsteira: "SATURADA",
        motivo: "esteira_saturada",
        capacidadeAtual: 0,
        pressaoEsteiraViva: 33,
        filaAlvo: 1,
        fallbackAplicado: false
      })
    }
  });
  assert.strictEqual(adicionou, 0);
  assert.deepStrictEqual(restauracoesSeguras.map(item => item.statusAnterior), ["importada"]);
  assert.deepStrictEqual(statusMarcados.map(item => item.status), ["importada"]);
  assert(!statusMarcados.some(item => item.status === "gate_bloqueado_piloto"));
  assert(etapasRegistradas.some(item =>
    item.etapa === "distribuicao_final" &&
    item.status === "aguardando" &&
    item.detalhes?.resultadoDistribuicao === "flow_reentrada_temporaria" &&
    item.detalhes?.origem === "gate" &&
    item.detalhes?.clienteId === WORKSPACE_ROGER
  ));
  assert.strictEqual(bloqueado.adicionadasFila, 0);
  assert.strictEqual(bloqueado.motivos.flow_aguardando_esteira_saturada, 1);

  adicionou = 0;
  statusMarcados.length = 0;
  etapasRegistradas.length = 0;
  limparModulo("../modules/engine/distributor/distributor.runner");
  distributor = require("../modules/engine/distributor/distributor.runner");
  const permitido = await distributor.distribuirOfertasEngine({
    limite: 1,
    deps: {
      decidirAbsorcaoWorkspace: async () => ({
        ativo: true,
        modo: "ativo_piloto",
        workspaceId: WORKSPACE_ROGER,
        permitir: true,
        quantidadeAceitaAgora: 1,
        estadoDaEsteira: "LIVRE",
        motivo: "capacidade_disponivel",
        capacidadeAtual: 2,
        pressaoEsteiraViva: 0,
        filaAlvo: 2,
        fallbackAplicado: false
      })
    }
  });
  assert.strictEqual(adicionou, 1);
  assert.strictEqual(permitido.adicionadasFila, 1);
  assert.strictEqual(statusMarcados.filter(item => item.status === "fila").length, 1);

  let adicionadosFanout = [];
  const statusesFanout = [];
  const etapasFanout = [];
  const restauracoesFanout = [];
  limparModulo("../modules/engine/distributor/distributor.runner");
  mockModulo("../modules/engine/distributor/distributor.service", {
    limitarDistribuicao: valor => Number(valor || 10),
    buscarOfertasDistribuiveis: async () => ({
      ok: true,
      ofertas: [
        { id: 201, evento_id: 401, job_id: 501, cliente_id: WORKSPACE_ROGER, marketplace: "mercadolivre", titulo: "Oferta Fanout", categoria: "Moda", status: "importada" },
        { id: 202, evento_id: 401, job_id: 502, cliente_id: WORKSPACE_D1, marketplace: "mercadolivre", titulo: "Oferta Fanout", categoria: "Moda", status: "importada" },
        { id: 203, evento_id: 401, job_id: 503, cliente_id: WORKSPACE_WOLF, marketplace: "mercadolivre", titulo: "Oferta Fanout", categoria: "Moda", status: "importada" }
      ]
    }),
    tentarMarcarDistribuindo: async () => ({ ok: true }),
    marcarOfertaStatus: async (id, status, motivo) => {
      statusesFanout.push({ id, status, motivo });
      return { ok: true };
    },
    restaurarOfertaStatusSeDistribuindo: async (id, statusAnterior, motivo) => {
      restauracoesFanout.push({ id, statusAnterior, motivo });
      statusesFanout.push({ id, status: statusAnterior, motivo: "" });
      return { ok: true };
    },
    restaurarOfertaParaReentradaFlow: async (id, statusAnterior, motivo) => {
      restauracoesFanout.push({ id, statusAnterior, motivo, reentradaFlow: true });
      statusesFanout.push({ id, status: statusAnterior, motivo });
      return { ok: true };
    },
    registrarEtapaDistribuicao: async (jobId, etapa, status, motivo, detalhes) => {
      etapasFanout.push({ jobId, etapa, status, motivo, detalhes });
      return { ok: true };
    },
    validarOfertaParaDistribuicao: async () => {
      const retorno = {
        ok: true,
        destinosCompativeis: 1,
        destinosCompativeisDetalhes: [{ destino: "Destino", tipoMidia: "imagem" }]
      };
      Object.defineProperty(retorno, "__destinosCompativeisRaw", {
        value: [destino()],
        enumerable: false
      });
      return retorno;
    },
    adicionarOfertaNaFilaCliente: async (oferta) => {
      adicionadosFanout.push(oferta.cliente_id);
      return { ok: true, itemFila: { id: `fila_${oferta.id}`, status: "pendente" } };
    }
  });
  distributor = require("../modules/engine/distributor/distributor.runner");
  const fanout = await distributor.distribuirOfertasEngine({
    limite: 3,
    deps: {
      decidirAbsorcaoWorkspace: async ({ workspaceId }) => {
        if (workspaceId === WORKSPACE_ROGER) {
          return {
            ativo: true,
            modo: "ativo_piloto",
            workspaceId,
            permitir: false,
            quantidadeAceitaAgora: 0,
            estadoDaEsteira: "SATURADA",
            motivo: "esteira_saturada",
            capacidadeAtual: 0,
            pressaoEsteiraViva: 33,
            filaAlvo: 1,
            fallbackAplicado: false
          };
        }
        return { ativo: false, permitir: true, quantidadeAceitaAgora: 1, motivo: "gate_ativo_desabilitado" };
      }
    }
  });
  assert.strictEqual(fanout.processadas, 3);
  assert.strictEqual(fanout.adicionadasFila, 2);
  assert.deepStrictEqual(adicionadosFanout.sort(), [WORKSPACE_D1, WORKSPACE_WOLF].sort());
  assert.deepStrictEqual(restauracoesFanout.map(item => item.id), [201]);
  assert(statusesFanout.some(item => item.id === 201 && item.status === "importada"), "Roger deve restaurar status comercial");
  assert(statusesFanout.some(item => item.id === 202 && item.status === "fila"), "D1 deve seguir para fila");
  assert(statusesFanout.some(item => item.id === 203 && item.status === "fila"), "Wolf deve seguir para fila");
  assert(!statusesFanout.some(item => item.status === "gate_bloqueado_piloto"), "status global desconhecido nao deve ser usado");
  assert(etapasFanout.some(item =>
    item.detalhes?.resultadoDistribuicao === "flow_reentrada_temporaria" &&
    item.detalhes?.origem === "gate" &&
    item.detalhes?.clienteId === WORKSPACE_ROGER
  ));

  adicionadosFanout = [];
  const statusesFalha = [];
  const restauracoesFalha = [];
  limparModulo("../modules/engine/distributor/distributor.runner");
  mockModulo("../modules/engine/distributor/distributor.service", {
    limitarDistribuicao: valor => Number(valor || 10),
    buscarOfertasDistribuiveis: async () => ({
      ok: true,
      ofertas: [
        { id: 301, evento_id: 601, job_id: 701, cliente_id: WORKSPACE_ROGER, marketplace: "mercadolivre", titulo: "Falha Gate", categoria: "Moda", status: "oferta_criada" },
        { id: 302, evento_id: 601, job_id: 702, cliente_id: WORKSPACE_D1, marketplace: "mercadolivre", titulo: "Falha Gate", categoria: "Moda", status: "oferta_criada" }
      ]
    }),
    tentarMarcarDistribuindo: async () => ({ ok: true }),
    marcarOfertaStatus: async (id, status, motivo) => {
      statusesFalha.push({ id, status, motivo });
      return { ok: true };
    },
    restaurarOfertaStatusSeDistribuindo: async (id, statusAnterior, motivo) => {
      restauracoesFalha.push({ id, statusAnterior, motivo });
      statusesFalha.push({ id, status: statusAnterior, motivo: "" });
      return { ok: true };
    },
    restaurarOfertaParaReentradaFlow: async (id, statusAnterior, motivo) => {
      restauracoesFalha.push({ id, statusAnterior, motivo, reentradaFlow: true });
      statusesFalha.push({ id, status: statusAnterior, motivo });
      return { ok: true };
    },
    registrarEtapaDistribuicao: async () => ({ ok: true }),
    validarOfertaParaDistribuicao: async () => {
      const retorno = {
        ok: true,
        destinosCompativeis: 1,
        destinosCompativeisDetalhes: [{ destino: "Destino", tipoMidia: "imagem" }]
      };
      Object.defineProperty(retorno, "__destinosCompativeisRaw", {
        value: [destino()],
        enumerable: false
      });
      return retorno;
    },
    adicionarOfertaNaFilaCliente: async (oferta) => {
      adicionadosFanout.push(oferta.cliente_id);
      return { ok: true, itemFila: { id: `fila_${oferta.id}`, status: "pendente" } };
    }
  });
  distributor = require("../modules/engine/distributor/distributor.runner");
  const falhaGateFanout = await distributor.distribuirOfertasEngine({
    limite: 2,
    deps: {
      decidirAbsorcaoWorkspace: async ({ workspaceId }) => {
        if (workspaceId === WORKSPACE_ROGER) {
          return {
            ativo: true,
            modo: "ativo_piloto",
            workspaceId,
            permitir: false,
            quantidadeAceitaAgora: 0,
            estadoDaEsteira: "FECHADA",
            motivo: "gate_indisponivel_piloto",
            capacidadeAtual: 0,
            pressaoEsteiraViva: 0,
            filaAlvo: 0,
            fallbackAplicado: true
          };
        }
        return { ativo: false, permitir: true, quantidadeAceitaAgora: 1, motivo: "gate_ativo_desabilitado" };
      }
    }
  });
  assert.strictEqual(falhaGateFanout.processadas, 2);
  assert.strictEqual(falhaGateFanout.adicionadasFila, 1);
  assert.deepStrictEqual(adicionadosFanout, [WORKSPACE_D1]);
  assert.deepStrictEqual(restauracoesFalha.map(item => item.id), [301]);
  assert(statusesFalha.some(item => item.id === 301 && item.status === "oferta_criada"));
  assert(statusesFalha.some(item => item.id === 302 && item.status === "fila"));
  assert(!statusesFalha.some(item => item.status === "gate_bloqueado_piloto"));

  const serviceSource = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "distributor", "distributor.service.js"), "utf8");
  assert(serviceSource.includes("WHERE id = $1 AND status = 'distribuindo'"), "restauracao deve ser condicionada ao lock distribuindo");
  assert(serviceSource.includes("[OFC-GATE-ATIVO-RESTAURACAO-CONFLITO]"), "conflito de concorrencia deve ser auditado");

  console.log("ofc-gate-ativo-piloto.test.js OK");
})().catch(e => {
  console.error(e);
  process.exit(1);
});
