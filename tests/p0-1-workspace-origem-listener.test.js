const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-p0-1-"));

const { writeGlobalJson } = require("../utils/storage");

const usuarios = [
  { id: "admin", papel: "admin_master", ativo: true, plano: "master" },
  { id: "user_a", ativo: true, plano: "clone_only" },
  { id: "user_b", ativo: true, plano: "clone_only" },
  { id: "user_inativo", ativo: false, plano: "clone_only" },
  { id: "user_plano_inativo", ativo: true, plano: "clone_inativo" },
  { id: "user_nao_operacional", ativo: true, operacional: false, plano: "clone_only" },
  { id: "user_engine", ativo: true, plano: "engine_only" }
];

writeGlobalJson("usuarios.json", usuarios);
writeGlobalJson("planos.json", {
  master: { nome: "master", ativo: true, recursos: { engine: true, clonador_grupos: true } },
  clone_only: {
    nome: "clone_only",
    ativo: true,
    recursos: {
      clonador_grupos: true,
      engine: false,
      engineV2: false,
      automacao: false,
      ofertasAutomaticas: false,
      radarAutomatico: false
    }
  },
  clone_inativo: { nome: "clone_inativo", ativo: false, recursos: { clonador_grupos: true } },
  engine_only: {
    nome: "engine_only",
    ativo: true,
    recursos: { engine: true, clonador_grupos: false }
  }
});
writeGlobalJson("integracoes.json", {});
writeGlobalJson("configs_clientes.json", {});
writeGlobalJson("destinos_clientes.json", {});

function limparModulo(relativo) {
  const resolvido = require.resolve(relativo);
  delete require.cache[resolvido];
  return resolvido;
}

function mockModulo(relativo, exports) {
  const resolvido = limparModulo(relativo);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
}

async function testarSessaoWorkspaceFailClosed() {
  const { resolverCanalWorkspaceEstrito } = require("../modules/workspace/channel-registry");

  const valida = resolverCanalWorkspaceEstrito({
    id: "user_a_sessao1",
    workspaceId: "user_a",
    clienteId: "user_a",
    ativo: true,
    status: "open"
  }, { usuarios });
  assert.strictEqual(valida.valido, true);
  assert.strictEqual(valida.workspaceId, "user_a");

  const desconhecida = resolverCanalWorkspaceEstrito({ id: "sessao_sem_dono", status: "open" }, { usuarios });
  assert.strictEqual(desconhecida.valido, false);
  assert.strictEqual(desconhecida.workspaceId, "");
  assert.strictEqual(desconhecida.motivo, "sessao_sem_workspace");

  const admin = resolverCanalWorkspaceEstrito({ id: "admin_sessao1", status: "open" }, { usuarios });
  assert.strictEqual(admin.valido, false);
  assert.strictEqual(admin.workspaceId, "");
  assert.strictEqual(admin.motivo, "workspace_admin");

  const inconsistente = resolverCanalWorkspaceEstrito({
    id: "user_b_sessao1",
    workspaceId: "user_a",
    status: "open"
  }, { usuarios });
  assert.strictEqual(inconsistente.valido, false);
  assert.strictEqual(inconsistente.motivo, "sessao_workspace_inconsistente");

  const metadataInconsistente = resolverCanalWorkspaceEstrito({
    id: "sessao_customizada",
    workspaceId: "user_a",
    clienteId: "user_b",
    status: "open"
  }, { usuarios });
  assert.strictEqual(metadataInconsistente.valido, false);
  assert.strictEqual(metadataInconsistente.motivo, "sessao_workspace_inconsistente");

  const inativa = resolverCanalWorkspaceEstrito({
    id: "user_inativo_sessao1",
    workspaceId: "user_inativo",
    status: "open"
  }, { usuarios });
  assert.strictEqual(inativa.valido, false);
  assert.strictEqual(inativa.motivo, "workspace_inativo");

  const desativada = resolverCanalWorkspaceEstrito({
    id: "user_a_sessao2",
    workspaceId: "user_a",
    ativo: false,
    status: "desativado"
  }, { usuarios });
  assert.strictEqual(desativada.valido, false);
  assert.strictEqual(desativada.motivo, "sessao_desativada");

  const desconectada = resolverCanalWorkspaceEstrito({
    id: "user_a_sessao3",
    workspaceId: "user_a",
    status: "offline"
  }, { usuarios });
  assert.strictEqual(desconectada.valido, false);
  assert.strictEqual(desconectada.motivo, "sessao_desativada");

  const prefixoSeguro = resolverCanalWorkspaceEstrito({ id: "user_a_legada", status: "open" }, { usuarios });
  assert.strictEqual(prefixoSeguro.valido, true);
  assert.strictEqual(prefixoSeguro.workspaceId, "user_a");

  const prefixoInexistente = resolverCanalWorkspaceEstrito({ id: "user_fantasma_sessao1", status: "open" }, { usuarios });
  assert.strictEqual(prefixoInexistente.valido, false);
  assert.strictEqual(prefixoInexistente.motivo, "workspace_inexistente");

  const { criarServicoClonadorGrupos } = require("../modules/clonador-grupos/service");
  const service = criarServicoClonadorGrupos({ repository: {}, historico: {} });
  const defesaAdmin = await service.capturarMensagemWhatsapp({
    clienteId: "admin",
    sessaoId: "admin_sessao1",
    grupoJid: "grupo@g.us",
    mensagemId: "msg_admin"
  });
  assert.strictEqual(defesaAdmin.capturada, false);
  assert.strictEqual(defesaAdmin.motivo, "workspace_admin");
}

async function testarElegibilidadePorOrigem() {
  const registry = require("../modules/workspace");
  const avaliar = (workspaceId, opcoes = {}) => registry.avaliarWorkspaceParaEngine(workspaceId, {
    ...opcoes,
    log: false
  });

  assert.strictEqual(avaliar("user_a").elegivelEngine, false, "Clone-only nao entra na elegibilidade geral");
  assert.strictEqual(avaliar("user_a", { origemFluxo: "optimus" }).elegivelEngine, false);
  assert.strictEqual(avaliar("user_a", { origemFluxo: "clonador_grupos" }).elegivelEngine, true);
  assert.strictEqual(avaliar("user_engine", { origemFluxo: "clonador_grupos" }).elegivelEngine, false);
  assert.strictEqual(avaliar("user_inativo", { origemFluxo: "clonador_grupos" }).elegivelEngine, false);
  assert.strictEqual(avaliar("user_plano_inativo", { origemFluxo: "clonador_grupos" }).elegivelEngine, false);
  assert.strictEqual(avaliar("user_nao_operacional", { origemFluxo: "clonador_grupos" }).elegivelEngine, false);
  assert.strictEqual(avaliar("user_inexistente", { origemFluxo: "clonador_grupos" }).elegivelEngine, false);
  assert.strictEqual(avaliar("admin", { origemFluxo: "clonador_grupos" }).elegivelEngine, false);

  const inseridos = [];
  mockModulo("../modules/engine/database", {
    getEnginePool: () => null,
    engineDbHabilitado: () => true,
    queryEngine: async (sql, params = []) => {
      if (/INSERT INTO engine_jobs_cliente/i.test(sql)) {
        inseridos.push({ eventoId: params[0], clienteId: params[2] });
        return { ok: true, resultado: { rows: [{ id: 900 + inseridos.length }] } };
      }
      return { ok: true, resultado: { rows: [] } };
    }
  });
  limparModulo("../modules/engine/jobs.service");
  const jobs = require("../modules/engine/jobs.service");

  const clone = await jobs.criarJobsParaClientes({
    eventoId: 101,
    clientes: ["user_a"],
    marketplaceDetectado: "amazon",
    linksExtraidos: ["https://amzn.to/produto"],
    metadataEvento: { origemFluxo: "clonador_grupos" }
  });
  assert.strictEqual(clone.criados, 1);

  const optimus = await jobs.criarJobsParaClientes({
    eventoId: 102,
    clientes: ["user_a"],
    marketplaceDetectado: "amazon",
    linksExtraidos: ["https://amzn.to/produto-2"],
    metadataEvento: { origemFluxo: "optimus" }
  });
  assert.strictEqual(optimus.criados, 0);

  const admin = await jobs.criarJobsParaClientes({
    eventoId: 103,
    clientes: ["admin"],
    marketplaceDetectado: "amazon",
    metadataEvento: { origemFluxo: "clonador_grupos" }
  });
  assert.strictEqual(admin.criados, 0);
  assert.deepStrictEqual(inseridos, [{ eventoId: 101, clienteId: "user_a" }], "workspace A nunca pode gerar job B/admin");

  limparModulo("../modules/engine/processor.steps");
  const processor = require("../modules/engine/processor.steps");
  const jobClone = { cliente_id: "user_a", metadata: { origemFluxo: "clonador_grupos" } };
  assert.strictEqual(processor.avaliarClienteEngine(jobClone, {
    clientesValidos: [],
    avaliarWorkspaceParaEngine: avaliar
  }).ok, true, "Processor aceita Clone-only pela origem");

  const validator = require("../modules/engine/validator.service");
  assert.strictEqual(validator.clienteValidoEngine("user_a", [], {
    origemFluxo: "clonador_grupos",
    avaliarWorkspaceParaEngine: avaliar
  }), true, "Validator aceita Clone-only pela origem");
  assert.strictEqual(validator.clienteValidoEngine("user_a", [], {
    origemFluxo: "optimus",
    avaliarWorkspaceParaEngine: avaliar
  }), false, "autorizacao Clone nao abre Optimus no Validator");

  const distributor = require("../modules/engine/distributor/distributor.service");
  const destino = {
    id: "destino_a",
    nome: "Destino A",
    ativo: true,
    tipo: "telegram",
    botToken: "bot",
    chatId: "chat",
    marketplaces: ["amazon"],
    categorias: ["Eletronicos"],
    origemOfertas: "ambos"
  };
  const ofertaClone = {
    id: 201,
    cliente_id: "user_a",
    marketplace: "amazon",
    categoria: "Eletronicos",
    titulo: "Produto Clone",
    origemFluxo: "clonador_grupos",
    metadata: { origemFluxo: "clonador_grupos", clonadorGrupos: { destinoIds: ["destino_a"] } }
  };
  const contexto = {
    clientesValidos: [],
    avaliarWorkspaceParaEngine: avaliar,
    marketplacesAtivosPorCliente: { user_a: ["amazon"] },
    destinosPorCliente: { user_a: [destino] }
  };
  const distribuicaoClone = await distributor.validarOfertaParaDistribuicao(ofertaClone, contexto);
  assert.strictEqual(distribuicaoClone.ok, true, "Distributor aceita Clone-only pela origem");

  const distribuicaoOptimus = await distributor.validarOfertaParaDistribuicao({
    ...ofertaClone,
    origemFluxo: "optimus",
    metadata: { origemFluxo: "optimus" }
  }, contexto);
  assert.strictEqual(distribuicaoOptimus.ok, false);
  assert.strictEqual(distribuicaoOptimus.motivo, "cliente_invalido", "Clone-only nao abre Optimus no Distributor");
}

async function testarIsolamentoConsumidores() {
  const { executarConsumidorMensagemIsolado } = require("../modules/whatsapp/message-consumer-isolation.service");
  const logs = [];
  const logger = { log: (...args) => logs.push(args) };
  const contadores = { radar: 0, mensageiro: 0, clone: 0 };

  for (const indice of [0, 1]) {
    await executarConsumidorMensagemIsolado({
      consumidor: "radar",
      logger,
      executar: async () => {
        contadores.radar += 1;
        if (indice === 0) throw new Error("falha_radar");
      }
    });
    await executarConsumidorMensagemIsolado({
      consumidor: "mensageiro_gerente",
      logger,
      executar: async () => {
        contadores.mensageiro += 1;
        if (indice === 0) throw new Error("falha_mensageiro");
      }
    });
    await executarConsumidorMensagemIsolado({
      consumidor: "clonador_grupos",
      logger,
      executar: async () => {
        contadores.clone += 1;
        if (indice === 0) throw new Error("falha_clone");
      }
    });
  }

  assert.deepStrictEqual(contadores, { radar: 2, mensageiro: 2, clone: 2 });
  assert.strictEqual(logs.length, 3);

  let cloneComRadarOff = 0;
  await executarConsumidorMensagemIsolado({
    consumidor: "radar",
    logger,
    executar: async () => ({ processada: false, motivo: "radar_desabilitado" })
  });
  await executarConsumidorMensagemIsolado({
    consumidor: "clonador_grupos",
    logger,
    executar: async () => { cloneComRadarOff += 1; }
  });
  assert.strictEqual(cloneComRadarOff, 1, "Radar OFF nao pode desligar o consumidor Clone");

  const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const listener = indexFonte.slice(
    indexFonte.indexOf("handler: async ({ messages = [] } = {}) =>"),
    indexFonte.indexOf("sock.ev.on(\"group-participants.update\"")
  );
  for (const consumidor of ["radar", "mensageiro_gerente", "mensageiro_comando", "mensageiro_atendimento", "clonador_grupos"]) {
    assert(listener.includes(`consumidor: "${consumidor}"`), `${consumidor} deve estar isolado`);
  }
  assert(listener.includes("resolverClienteClonePorSessao(id)"));
  assert(listener.includes("for (let indiceMensagem = 0; indiceMensagem < messages.length; indiceMensagem += 1)"));
  assert(listener.includes("posterioresNaoPercorridas: 0"), "falha por mensagem nao deve abortar o restante do lote");
}

(async () => {
  await testarSessaoWorkspaceFailClosed();
  await testarElegibilidadePorOrigem();
  await testarIsolamentoConsumidores();
  console.log("p0-1-workspace-origem-listener.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
