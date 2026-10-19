"use strict";

const assert = require("node:assert/strict");

const servicePath = require.resolve("../modules/engine/processor.service");
const stepsPath = require.resolve("../modules/engine/processor.steps");
const originalService = require.cache[servicePath];
const originalSteps = require.cache[stepsPath];
const { projectPreUniversalTerminalError } = require("../modules/engine/universal-history.repository");
const { criarServicoClonadorGrupos } = require("../modules/clonador-grupos/service");

let event;
let links;
let terminal;
const inserts = [];
let nextJobId = 200;
const pool = {
  async query(sql, params) {
    assert.match(sql, /INSERT INTO engine_history_items/);
    inserts.push({ sql, params });
    return { rows: [{ history_id: inserts.length }] };
  }
};

require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: {
    carregarEventoBruto: async () => ({ ok: true, evento: event }),
    carregarLinksEvento: async () => ({ ok: true, links }),
    registrarProcessamento: async () => ({ ok: true }),
    marcarJobStatus: async (id, status, reason) => {
      terminal = { id, status, reason };
      return { ok: true };
    }
  }
};
delete require.cache[stepsPath];
const { processarJobEngine } = require("../modules/engine/processor.steps");

async function criarJobDaCaptura(item) {
  const originals = new Map();
  const mock = (relative, exports) => {
    const id = require.resolve(relative);
    originals.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  };
  const jobsPath = require.resolve("../modules/engine/jobs.service");
  originals.set(jobsPath, require.cache[jobsPath]);
  let job;
  try {
    mock("../modules/engine/database", {
      getEnginePool: () => null,
      queryEngine: async (sql, params = []) => {
        if (/WITH jobs_admin/i.test(sql)) return { ok: true, resultado: { rows: [{}] } };
        assert.match(sql, /INSERT INTO engine_jobs_cliente/);
        job = { id: 200, evento_id: 100, cliente_id: params[2],
          marketplace: params[3], metadata: JSON.parse(params[4]) };
        return { ok: true, resultado: { rows: [{ id: job.id }] } };
      }
    });
    mock("../modules/workspace", { avaliarWorkspaceParaEngine: () => ({ elegivelEngine: true }) });
    mock("../modules/imagens/cache-canonico-evento", {
      resolverImagemCanonicaEvento: async () => ({ imagemStatus: "nao_resolvida", imagemEnviavel: false }),
      aplicarImagemCanonicaMetadata: metadata => metadata
    });
    mock("../modules/radar/cobertura-v1", { registrar: () => {}, flagAtiva: () => false });
    mock("../modules/engine/logger", {
      logEngineJobClienteCriado: () => {}, logEngineJobClienteErro: () => {}
    });
    mock("../modules/engine/universal-ingress-fence", {
      modoIngressReal: () => "LEGACY", verificarCapturaIngressReal: () => ({ ok: true })
    });
    delete require.cache[jobsPath];
    const { criarJobsParaClientes } = require("../modules/engine/jobs.service");
    const result = await criarJobsParaClientes({ eventoId: 100,
      clientes: [item.clienteId], marketplaceDetectado: "",
      linksExtraidos: item.links, metadataEvento: { ...item.metadata, origemFluxo: "clonador_grupos" } });
    assert.equal(result.criados, 1, "job real é criado mesmo sem marketplace/link");
    assert.equal(job.marketplace, "");
    return job;
  } finally {
    for (const [id, original] of originals) {
      if (original) require.cache[id] = original;
      else delete require.cache[id];
    }
  }
}

async function processarCaso({ mensagem, urls = [], metadata = {}, job: preparedJob = null }) {
  event = { id: 100, texto_original: mensagem, marketplace_detectado: "", links_extraidos: urls };
  links = urls.map(url => ({ url_original: url }));
  terminal = null;
  const job = preparedJob || { id: nextJobId++, evento_id: 100, cliente_id: "workspace-teste",
    metadata: { origemFluxo: "clonador_grupos", ...metadata } };
  const result = await processarJobEngine(job, {
    clientesValidos: ["workspace-teste"],
    avaliarWorkspaceParaEngine: () => ({ elegivelEngine: true }),
    observarHistoricoClonadorTerminal: ({ job: terminalJob, motivo, etapa }) => {
      assert.equal(terminal?.status, "erro", "writer roda depois da transição terminal");
      return projectPreUniversalTerminalError({ pool, job: terminalJob, reason: motivo, stage: etapa,
        terminalAt: new Date().toISOString() });
    }
  });
  assert.equal(result.motivo, "marketplace_nao_detectado");
  assert.equal(terminal.reason, "marketplace_nao_detectado");
  return result;
}

(async () => {
  try {
    const reels = "Deixa lá nos comentários do nosso Reels qual item de pesca não pode faltar nos próximos garimpos...";
    const capture = criarServicoClonadorGrupos({
      repository: {
        lerConfig: async () => ({ ativo: true }),
        listarFontes: async () => [{ ativo: true, sessaoId: "sessao-teste", grupoJid: "grupo-teste@g.us" }],
        inserirBufferCaptura: async item => ({ inserido: true, item })
      },
      clienteTemRecurso: () => true,
      logger: { log: () => {} }
    });
    const captured = await capture.capturarMensagemWhatsapp({
      clienteId: "workspace-teste", sessaoId: "sessao-teste",
      mensagem: { key: { remoteJid: "grupo-teste@g.us", id: "reels-1", fromMe: false },
        messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: reels } }
    });
    assert.equal(captured.capturada, true, "captura real aceita a mensagem social para auditoria técnica");
    assert.deepEqual(captured.item.links, []);
    const job = await criarJobDaCaptura(captured.item);
    await processarCaso({ mensagem: captured.item.textoOriginal, urls: captured.item.links, job });
    assert.equal(inserts.length, 0, "comentário sem oferta não deve entrar no Histórico");
    await processarCaso({ mensagem: "Bom dia, pessoal" });
    assert.equal(inserts.length, 0, "texto comum não deve entrar no Histórico");
    await processarCaso({ mensagem: "Veja nosso canal https://example.org/reels/123", urls: ["https://example.org/reels/123"] });
    assert.equal(inserts.length, 0, "URL não comercial não deve entrar no Histórico");
    await processarCaso({ mensagem: "Olha este item", metadata: { comercialCapturado: {
      tituloCapturado: "Olha este item", campos: { titulo: true }, evidencias: { titulo: "Olha este item" }
    } } });
    assert.equal(inserts.length, 0, "título extraído sozinho não confirma tentativa comercial");
    for (const marketplace of ["desconhecido", "rede_social"]) {
      const result = await projectPreUniversalTerminalError({ pool,
        job: { id: nextJobId++, cliente_id: "workspace-teste", marketplace },
        reason: "erro_parser", stage: "importacao_final" });
      assert.equal(result.projected, false, `valor ${marketplace} não é marketplace identificado`);
    }
    for (const original of ["https://example.org/reels/123", "https://www.amazon.com.br/dp/B0TEST1234"]) {
      const result = await projectPreUniversalTerminalError({ pool,
        job: { id: nextJobId++, cliente_id: "workspace-teste", metadata: { comercialCapturado: {
          linksComerciais: [{ tipo: "produto", original, marketplace: "magalu" }]
        } } }, reason: "erro_parser", stage: "importacao_final" });
      assert.equal(result.projected, false, "URL não comercial ou marketplace divergente não basta");
    }

    const casosComerciais = [
      { reason: "erro_parser", job: { marketplace: "amazon" } },
      { reason: "afiliacao_apos_retries", job: { marketplace: "aliexpress" } },
      { reason: "integracao_ausente", job: { marketplace: "magalu" } },
      { reason: "sem_imagem_apos_retries", job: { marketplace: "magalu" } },
      { reason: "sem_link_produto_confirmado", job: { marketplace: "magalu" } },
      { reason: "erro_parser", job: { metadata: { metadataEvento: { clonadorGrupos: { redirects: [{
        marketplaceCanonico: "amazon", produtoIdCanonico: "B0TEST1234"
      }] } } } } },
      { reason: "erro_parser", job: { metadata: { comercialCapturado: {
        linksComerciais: [{ tipo: "produto", original: "https://www.amazon.com.br/dp/B0TEST1234", marketplace: "amazon" }]
      } } } },
      { reason: "erro_parser", job: { metadata: { comercialCapturado: {
        tituloCapturado: "Produto Teste", precoAtual: 29.9,
        campos: { titulo: true, precoAtual: true },
        evidencias: { titulo: "Produto Teste", precoAtual: "Por R$ 29,90" }
      } } } }
    ];
    for (const caso of casosComerciais) {
      const before = inserts.length;
      const result = await projectPreUniversalTerminalError({ pool,
        job: { id: nextJobId++, cliente_id: "workspace-teste", ...caso.job },
        reason: caso.reason, stage: "importacao_final", terminalAt: new Date().toISOString() });
      assert.equal(result.projected, true, caso.reason);
      assert.equal(inserts.length, before + 1, `erro comercial preservado: ${caso.reason}`);
    }

    for (const reason of ["retry_intermediario", "expired", "skipped", "discarded_without_replay"]) {
      const before = inserts.length;
      const result = await projectPreUniversalTerminalError({ pool,
        job: { id: nextJobId++, cliente_id: "workspace-teste", marketplace: "amazon" },
        reason, stage: "operacional" });
      assert.equal(result.projected, false, reason);
      assert.equal(inserts.length, before, reason);
    }
    console.log("historico pre-universal elegibilidade comercial: ok");
  } finally {
    delete require.cache[stepsPath];
    if (originalSteps) require.cache[stepsPath] = originalSteps;
    if (originalService) require.cache[servicePath] = originalService;
    else delete require.cache[servicePath];
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
