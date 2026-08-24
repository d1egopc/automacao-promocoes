const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-radar-cobertura-v1-"));

const { writeGlobalJson } = require("../utils/storage");
writeGlobalJson("usuarios.json", [
  { id: "cliente_1", ativo: true, plano: "pro" },
  { id: "d1egopc_teste", ativo: true, plano: "pro" },
  { id: "roger_teste", ativo: true, plano: "pro" },
  { id: "wolf_teste", ativo: true, plano: "pro" },
  { id: "quarto_workspace_teste", ativo: true, plano: "pro" },
  { id: "cliente_existente", ativo: true, plano: "pro" },
  { id: "cliente_ausente", ativo: true, plano: "pro" }
]);
writeGlobalJson("planos.json", {
  pro: {
    nome: "pro",
    ativo: true,
    marketplaces: ["mercadolivre", "shopee", "amazon"],
    recursos: { automacao: true }
  }
});

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function capturarLogs(fn) {
  const original = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.map(item => typeof item === "string" ? item : JSON.stringify(item)).join(" "));
  return Promise.resolve()
    .then(fn)
    .then(retorno => ({ logs, retorno }))
    .finally(() => {
      console.log = original;
    });
}

function payloadsCobertura(logs = []) {
  return logs
    .filter(linha => linha.includes("[RADAR-COBERTURA-V1]"))
    .map(linha => JSON.parse(linha.slice(linha.indexOf("{"))));
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
  return resolvido;
}

(async () => {
  const cobertura = require("../modules/radar/cobertura-v1");

  {
    delete process.env.RADAR_COBERTURA_AUDITORIA_ENABLED;
    const objeto = { metadata: { intacto: true } };
    const antes = clonar(objeto);
    const { logs, retorno } = await capturarLogs(() => cobertura.registrar("teste_flag_off", objeto));
    assert.strictEqual(retorno, false);
    assert.deepStrictEqual(logs, []);
    assert.deepStrictEqual(objeto, antes, "flag desligada nao deve mutar objeto");
  }

  process.env.RADAR_COBERTURA_AUDITORIA_ENABLED = "1";

  {
    const msgA = {
      key: { remoteJid: "grupo@g.us", participant: "551199999@s.whatsapp.net" },
      messageTimestamp: 100,
      message: { conversation: "Oferta igual https://meli.la/abc" }
    };
    const msgB = {
      key: { remoteJid: "grupo@g.us", participant: "551199999@s.whatsapp.net" },
      messageTimestamp: 101,
      message: { conversation: "Oferta igual https://meli.la/abc" }
    };
    assert.notStrictEqual(
      cobertura.criarCoberturaTraceId(msgA, { loteTraceId: "lote_a", indiceLote: 0 }),
      cobertura.criarCoberturaTraceId(msgB, { loteTraceId: "lote_a", indiceLote: 1 }),
      "mensagens sem id, com texto/link iguais, nao devem colidir quando assinatura tecnica difere"
    );
  }

  {
    limparModulo("../modules/engine/inbox.service");
    mockModulo("../modules/engine/database", {
      queryEngine: async (sql) => {
        if (/SELECT id\s+FROM engine_eventos_brutos/i.test(sql)) {
          return { ok: true, resultado: { rows: [{ id: 77 }] }, metricas: {} };
        }
        throw new Error("query_nao_esperada");
      }
    });
    let jobChamado = false;
    mockModulo("../modules/engine/jobs.service", {
      criarJobsParaClientes: async (entrada) => {
        jobChamado = true;
        assert.strictEqual(entrada.eventoId, 77);
        assert.deepStrictEqual(entrada.clientes, ["cliente_1"]);
        return { ok: true, criados: 1 };
      }
    });
    const inbox = require("../modules/engine/inbox.service");
    const trace = "cov_meli_unico";
    const { logs, retorno } = await capturarLogs(() => inbox.registrarEventoBruto({
      origem: "radar",
      origemTipo: "whatsapp",
      grupoId: "grupo@g.us",
      textoOriginal: "Produto ML",
      linksExtraidos: ["https://meli.la/2HRuzPf"],
      metadata: { coberturaTraceId: trace }
    }, { clientes: ["cliente_1"] }));
    const eventos = payloadsCobertura(logs);
    assert.strictEqual(retorno.duplicado, true);
    assert.strictEqual(jobChamado, true);
    assert.strictEqual(retorno.jobsCriados, 1);
    assert(eventos.some(evento =>
      evento.etapa === "engine_evento_duplicado" &&
      evento.coberturaTraceId === trace &&
      evento.motivo === "duplicidade" &&
      evento.jobNovoCriado === true
    ));
  }

  {
    limparModulo("../modules/engine/inbox.service");
    const jsonbRecebidos = [];
    mockModulo("../modules/engine/database", {
      queryEngine: async (sql, params = []) => {
        if (/SELECT id\s+FROM engine_eventos_brutos/i.test(sql)) {
          jsonbRecebidos.push(params[2]);
          JSON.parse(params[2]);
          return { ok: true, resultado: { rows: [] }, metricas: {} };
        }
        if (/INSERT INTO engine_eventos_brutos/i.test(sql)) {
          jsonbRecebidos.push(params[7], params[10]);
          JSON.parse(params[7]);
          JSON.parse(params[10]);
          return { ok: true, resultado: { rows: [{ id: 177 }] }, metricas: {} };
        }
        if (/INSERT INTO engine_links/i.test(sql)) {
          jsonbRecebidos.push(params[9]);
          JSON.parse(params[9]);
          return { ok: true, resultado: { rows: [] }, metricas: {} };
        }
        return { ok: true, resultado: { rows: [] }, metricas: {} };
      }
    });
    mockModulo("../modules/engine/jobs.service", {
      criarJobsParaClientes: async () => ({ ok: true, criados: 1, existentes: 0 })
    });
    const inbox = require("../modules/engine/inbox.service");
    const textoComercial = [
      "Oferta Poco \uD83D\uDD25 com acento: promoção",
      "Resgate: https://s.shopee.com.br/4LEepvkqdN",
      "Link produto: https://s.shopee.com.br/2qPrA9vtrB?lp=aff"
    ].join("\n");
    const retorno = await inbox.registrarEventoBruto({
      origem: "radar",
      origemTipo: "whatsapp",
      sessaoId: "admin_Zoio Claro",
      grupoId: "120363420033826376@g.us",
      grupoNome: "Lobao das Promocoes #92",
      textoOriginal: `${textoComercial}\u0000`,
      linksExtraidos: [
        "https://s.shopee.com.br/4LEepvkqdN",
        "https://s.shopee.com.br/2qPrA9vtrB?lp=aff"
      ],
      metadata: {
        coberturaTraceId: "cov_payload_real",
        observacao: `${textoComercial}\u0000`,
        linksOriginaisCapturados: [
          "https://s.shopee.com.br/4LEepvkqdN",
          "https://s.shopee.com.br/2qPrA9vtrB?lp=aff"
        ],
        redirectsRadar: [],
        identidadesCanonicas: []
      }
    }, { clientes: ["cliente_1"] });

    assert.strictEqual(retorno.ok, true);
    assert(jsonbRecebidos.length >= 3);
    assert(!jsonbRecebidos.some(item => String(item).includes("\\u0000")), "jsonb nao deve carregar NUL escapado rejeitado pelo Postgres");
    const serializado = jsonbRecebidos.join("\n");
    assert(serializado.includes("🔥"), "sanitize nao deve remover emoji");
    assert(serializado.includes("promoção"), "sanitize nao deve remover acentos");
    assert(serializado.includes("?lp=aff"), "sanitize nao deve remover parametros de URL");
    assert(serializado.includes("\\n"), "sanitize nao deve remover quebras de linha serializadas");
    assert(serializado.includes("https://s.shopee.com.br/4LEepvkqdN"), "sanitize nao deve remover link de resgate");
    assert(serializado.includes("https://s.shopee.com.br/2qPrA9vtrB?lp=aff"), "sanitize nao deve remover link de produto");
  }

  {
    limparModulo("../modules/engine/inbox.service");
    const hashesInseridos = [];
    mockModulo("../modules/engine/database", {
      queryEngine: async (sql, params = []) => {
        if (/SELECT id\s+FROM engine_eventos_brutos/i.test(sql)) {
          return { ok: true, resultado: { rows: [] }, metricas: {} };
        }
        if (/INSERT INTO engine_eventos_brutos/i.test(sql)) {
          hashesInseridos.push(params[9]);
          return { ok: true, resultado: { rows: [{ id: 500 + hashesInseridos.length }] }, metricas: {} };
        }
        if (/INSERT INTO engine_links/i.test(sql)) {
          return { ok: true, resultado: { rows: [] }, metricas: {} };
        }
        return { ok: true, resultado: { rows: [] }, metricas: {} };
      }
    });
    mockModulo("../modules/engine/jobs.service", {
      criarJobsParaClientes: async () => ({ ok: true, criados: 1, existentes: 0 })
    });
    const inbox = require("../modules/engine/inbox.service");
    const payload = {
      origem: "radar",
      origemTipo: "whatsapp",
      grupoId: "grupo@g.us",
      textoOriginal: "Oferta republicada https://www.awin1.com/cread.php?ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F536014",
      linksExtraidos: ["https://www.awin1.com/cread.php?ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F536014"],
      metadata: { coberturaTraceId: "cov_republicacao" }
    };

    const primeira = await inbox.registrarEventoBruto({
      ...payload,
      capturadoEm: new Date("2026-08-02T14:00:00.000Z")
    }, { clientes: ["cliente_1"] });
    const segunda = await inbox.registrarEventoBruto({
      ...payload,
      capturadoEm: new Date("2026-08-02T14:10:00.000Z")
    }, { clientes: ["cliente_1"] });

    assert.strictEqual(primeira.duplicado, false);
    assert.strictEqual(segunda.duplicado, false);
    assert.strictEqual(hashesInseridos.length, 2);
    assert.notStrictEqual(hashesInseridos[0], hashesInseridos[1], "republicacao fora da janela nao deve colidir para sempre no hash_evento");
  }

  {
    limparModulo("../modules/engine/inbox.service");
    const linkAmazonDivulgador = "https://amzn.divulgador.link/gUXR2tSr";
    let marketplaceEvento = "";
    let entradaJobs = null;
    mockModulo("../modules/engine/database", {
      queryEngine: async (sql, params = []) => {
        if (/SELECT id\s+FROM engine_eventos_brutos/i.test(sql)) {
          return { ok: true, resultado: { rows: [] }, metricas: {} };
        }
        if (/INSERT INTO engine_eventos_brutos/i.test(sql)) {
          marketplaceEvento = params[8];
          return { ok: true, resultado: { rows: [{ id: 178 }] }, metricas: {} };
        }
        if (/INSERT INTO engine_links/i.test(sql)) {
          return { ok: true, resultado: { rows: [] }, metricas: {} };
        }
        return { ok: true, resultado: { rows: [] }, metricas: {} };
      }
    });
    mockModulo("../modules/engine/jobs.service", {
      criarJobsParaClientes: async (entrada) => {
        entradaJobs = entrada;
        return { ok: true, criados: 1, existentes: 0 };
      }
    });

    const inbox = require("../modules/engine/inbox.service");
    const { logs, retorno } = await capturarLogs(() => inbox.registrarEventoBruto({
      origem: "radar",
      origemTipo: "whatsapp",
      grupoId: "grupo@g.us",
      textoOriginal: `Oferta Amazon ${linkAmazonDivulgador}`,
      linksExtraidos: [linkAmazonDivulgador],
      metadata: { coberturaTraceId: "cov_amzn_divulgador" }
    }, { clientes: ["cliente_1"] }));
    const eventos = payloadsCobertura(logs);

    assert.strictEqual(retorno.ok, true);
    assert.strictEqual(marketplaceEvento, "amazon");
    assert.strictEqual(entradaJobs.marketplaceDetectado, "amazon");
    assert.deepStrictEqual(entradaJobs.linksExtraidos, [linkAmazonDivulgador]);
    assert(eventos.some(evento =>
      evento.etapa === "engine_evento_criado" &&
      evento.marketplace === "amazon" &&
      evento.jobNovoCriado === true
    ));
  }

  {
    limparModulo("../modules/engine/inbox.service");
    mockModulo("../modules/engine/database", {
      queryEngine: async (sql) => {
        if (/SELECT id\s+FROM engine_eventos_brutos/i.test(sql)) {
          return { ok: true, resultado: { rows: [] }, metricas: {} };
        }
        if (/INSERT INTO engine_eventos_brutos/i.test(sql)) {
          return { ok: false, motivo: "query_falhou", erro: "invalid input syntax for type json", metricas: {} };
        }
        throw new Error("query_nao_esperada");
      }
    });
    mockModulo("../modules/engine/jobs.service", {
      criarJobsParaClientes: async () => {
        throw new Error("jobs_nao_deveriam_ser_criados");
      }
    });
    const inbox = require("../modules/engine/inbox.service");
    const { logs, retorno } = await capturarLogs(() => inbox.registrarEventoBruto({
      origem: "radar",
      origemTipo: "whatsapp",
      grupoId: "grupo@g.us",
      textoOriginal: "Produto com falha JSON",
      linksExtraidos: ["https://meli.la/falha"]
    }, { clientes: ["cliente_1"] }));
    const eventos = payloadsCobertura(logs);

    assert.strictEqual(retorno.ok, false);
    assert.strictEqual(retorno.motivo, "query_falhou");
    assert(eventos.some(evento => evento.etapa === "engine_evento_erro" && evento.motivo === "query_falhou"));
    assert(!eventos.some(evento => evento.etapa === "engine_evento_criado"), "falha de query nao pode virar evento criado");
  }

  {
    limparModulo("../modules/engine/jobs.service");
    const clientesInseridos = [];
    mockModulo("../modules/engine/database", {
      queryEngine: async (sql, params = []) => {
        if (/WITH jobs_admin/i.test(sql)) return { ok: true, resultado: { rows: [{ jobs_ignorados: 0, ofertas_retidas: 0 }] } };
        if (/INSERT INTO engine_jobs_cliente/i.test(sql)) {
          clientesInseridos.push(params[2]);
          return { ok: true, resultado: { rows: [{ id: 80 + clientesInseridos.length }] } };
        }
        return { ok: true, resultado: { rows: [] } };
      }
    });
    const jobs = require("../modules/engine/jobs.service");
    const trace = "cov_job_unico";
    const { logs, retorno } = await capturarLogs(() => jobs.criarJobsParaClientes({
      eventoId: 77,
      clientes: ["cliente_1"],
      marketplaceDetectado: "mercadolivre",
      linksExtraidos: ["https://meli.la/2HRuzPf"],
      metadataEvento: { coberturaTraceId: trace }
    }));
    const eventos = payloadsCobertura(logs);
    assert.strictEqual(retorno.criados, 1);
    assert.deepStrictEqual(clientesInseridos, ["cliente_1"]);
    assert(eventos.some(evento => evento.etapa === "engine_job_criado" && evento.coberturaTraceId === trace && evento.jobId === 81));
  }

  {
    limparModulo("../modules/engine/jobs.service");
    const clientesInseridos = [];
    mockModulo("../modules/engine/database", {
      queryEngine: async (sql, params = []) => {
        if (/WITH jobs_admin/i.test(sql)) return { ok: true, resultado: { rows: [{ jobs_ignorados: 0, ofertas_retidas: 0 }] } };
        if (/INSERT INTO engine_jobs_cliente/i.test(sql)) {
          clientesInseridos.push(params[2]);
          return { ok: true, resultado: { rows: [{ id: 200 + clientesInseridos.length }] } };
        }
        return { ok: true, resultado: { rows: [] } };
      }
    });
    const jobs = require("../modules/engine/jobs.service");
    const clientesAtivosDescobertos = [
      "d1egopc_teste",
      "roger_teste",
      "wolf_teste"
    ];
    clientesAtivosDescobertos.push("quarto_workspace_teste");

    const { retorno } = await capturarLogs(() => jobs.criarJobsParaClientes({
      eventoId: 78,
      clientes: clientesAtivosDescobertos,
      marketplaceDetectado: "shopee",
      linksExtraidos: ["https://s.shopee.com.br/903wBcqhYS"],
      metadataEvento: { coberturaTraceId: "cov_quarto_workspace" }
    }));

    assert.strictEqual(retorno.criados, 4);
    assert.deepStrictEqual(clientesInseridos, clientesAtivosDescobertos);
    assert(clientesInseridos.includes("quarto_workspace_teste"), "quarto workspace deve entrar automaticamente no fan-out dinamico");
  }

  {
    limparModulo("../modules/engine/jobs.service");
    const clientesInseridos = [];
    mockModulo("../modules/engine/database", {
      queryEngine: async (sql, params = []) => {
        if (/WITH jobs_admin/i.test(sql)) return { ok: true, resultado: { rows: [{ jobs_ignorados: 0, ofertas_retidas: 0 }] } };
        if (/INSERT INTO engine_jobs_cliente/i.test(sql)) {
          clientesInseridos.push(params[2]);
          return {
            ok: true,
            resultado: {
              rows: params[2] === "cliente_existente" ? [] : [{ id: 300 + clientesInseridos.length }]
            }
          };
        }
        return { ok: true, resultado: { rows: [] } };
      }
    });
    const jobs = require("../modules/engine/jobs.service");
    const { logs, retorno } = await capturarLogs(() => jobs.criarJobsParaClientes({
      eventoId: 79,
      clientes: ["cliente_existente", "cliente_ausente"],
      marketplaceDetectado: "amazon",
      linksExtraidos: ["https://amzn.to/produto"],
      metadataEvento: { coberturaTraceId: "cov_idempotente" }
    }));
    const eventos = payloadsCobertura(logs);
    assert.strictEqual(retorno.criados, 1);
    assert.strictEqual(retorno.existentes, 1);
    assert.deepStrictEqual(clientesInseridos, ["cliente_existente", "cliente_ausente"]);
    assert(eventos.some(evento => evento.etapa === "engine_job_existente" && evento.clienteId === "cliente_existente"));
  }

  {
    limparModulo("../modules/engine/importer/importer.runner");
    mockModulo("../modules/engine/importer/importer.service", {
      buscarJobsProntos: async () => ({ ok: true, jobs: [] }),
      tentarMarcarImportando: async () => ({ ok: true }),
      registrarEtapaImportacao: async () => ({ ok: true }),
      carregarEventoBruto: async () => ({ ok: true, evento: { id: 77, metadata: { coberturaTraceId: "cov_importer_unico" } } }),
      carregarLinksEvento: async () => ({ ok: true, links: [{ url_original: "https://meli.la/2HRuzPf", marketplace_detectado: "mercadolivre" }] }),
      gravarOfertaEngine: async () => ({ ok: true, ofertaId: 99 }),
      marcarJobOfertaCriada: async () => ({ ok: true }),
      marcarJobRetidaV2: async () => ({ ok: true }),
      marcarJobErroImportacao: async () => ({ ok: true })
    });
    mockModulo("../modules/engine/importer/adapters/mercadolivre.adapter", {
      importarMercadoLivreEngine: async () => ({ ok: true, titulo: "Produto ML", preco: 10, linkAfiliado: "https://afiliado.test/ml" })
    });
    mockModulo("../modules/engine/importer/adapters/amazon.adapter", { importarAmazonEngine: async () => ({ ok: false }) });
    mockModulo("../modules/engine/importer/adapters/shopee.adapter", { importarShopeeEngine: async () => ({ ok: false }) });
    mockModulo("../modules/engine/importer/adapters/aliexpress.adapter", { importarAliExpressEngine: async () => ({ ok: false }) });
    mockModulo("../modules/engine/importer/adapters/awin.adapter", { importarAwinEngine: async () => ({ ok: false }) });
    const importer = require("../modules/engine/importer/importer.runner");
    const trace = "cov_importer_unico";
    const { logs, retorno } = await capturarLogs(() => importer.importarJobPronto({
      id: 88,
      evento_id: 77,
      cliente_id: "cliente_1",
      marketplace: "mercadolivre",
      metadata: { coberturaTraceId: trace }
    }));
    const eventos = payloadsCobertura(logs);
    assert.strictEqual(retorno.ofertaId, 99);
    assert(eventos.some(evento => evento.etapa === "engine_importer_ok" && evento.coberturaTraceId === trace && evento.ofertaId === 99));
  }

  {
    limparModulo("../modules/engine/distributor/distributor.runner");
    limparModulo("../modules/engine/ofc/active-gate.service");
    limparModulo("../modules/engine/flow-manager/flow-manager.service");
    limparModulo("../modules/engine/ofc/commercial-events.service");
    mockModulo("../modules/engine/distributor/distributor.service", {
      limitarDistribuicao: valor => Number(valor || 10),
      buscarOfertasDistribuiveis: async () => ({
        ok: true,
        ofertas: [{
          id: 99,
          evento_id: 77,
          job_id: 88,
          cliente_id: "cliente_1",
          marketplace: "mercadolivre",
          link_original: "https://produto.mercadolivre.com.br/MLB-1",
          metadata: { coberturaTraceId: "cov_distributor_unico" }
        }]
      }),
      tentarMarcarDistribuindo: async () => ({ ok: true }),
      marcarOfertaStatus: async () => ({ ok: true }),
      registrarEtapaDistribuicao: async () => ({ ok: true }),
      validarOfertaParaDistribuicao: async () => ({
        ok: true,
        destinosCompativeis: 1,
        destinosCompativeisDetalhes: [{ destino: "OP Geral", tipoMidia: "imagem" }]
      }),
      adicionarOfertaNaFilaCliente: async () => ({ ok: true, itemFila: { id: "fila_1", imagem: "https://img.test/p.jpg" } })
    });
    mockModulo("../modules/engine/ofc/active-gate.service", {
      decidirAbsorcaoWorkspace: async () => ({ ativo: false, permitir: true })
    });
    mockModulo("../modules/engine/flow-manager/flow-manager.service", {
      avaliarFluxoWorkspaceShadow: async () => ({
        aceitarAgora: true,
        motivo: "flow_shadow_indisponivel",
        tipoFluxo: "oferta_comum",
        ttlMs: 30 * 60 * 1000
      }),
      avaliarFrescorComercialOferta: () => ({ expirada: false }),
      flowManagerAtivoWorkspace: () => false,
      TTL_NORMAL_MS: 30 * 60 * 1000,
      TTL_TURBO_MS: 10 * 60 * 1000
    });
    mockModulo("../modules/engine/ofc/commercial-events.service", {
      registrarFilaClienteAdicionada: async () => ({ ok: true }),
      registrarDistribuicaoFinal: async () => ({ ok: true })
    });
    const distributor = require("../modules/engine/distributor/distributor.runner");
    const trace = "cov_distributor_unico";
    const { logs, retorno } = await capturarLogs(() => distributor.distribuirOfertasEngine({ limite: 1, marketplace: "mercadolivre" }));
    const eventos = payloadsCobertura(logs);
    assert.strictEqual(retorno.adicionadasFila, 1);
    assert(eventos.some(evento =>
      evento.etapa === "engine_distributor_fila" &&
      evento.coberturaTraceId === trace &&
      evento.filaRecebeu === true &&
      evento.ofertaId === 99
    ));
  }

  {
    const { logs } = await capturarLogs(() => cobertura.registrar("legacy_importador_rejeitado", {
      coberturaTraceId: "cov_rejeicao",
      decisao: "rejeitado",
      motivo: "importacao_falhou",
      marketplace: "shopee",
      link: "https://s.shopee.com.br/903wBcqhYS?token=segredo"
    }));
    const [evento] = payloadsCobertura(logs);
    assert.strictEqual(evento.etapa, "legacy_importador_rejeitado");
    assert.strictEqual(evento.motivo, "importacao_falhou");
    assert(!JSON.stringify(evento).includes("token=segredo"), "logs de cobertura nao devem vazar query sensivel");
  }

  {
    const { logs } = await capturarLogs(() => {
      cobertura.registrar("destino_candidato", {
        coberturaTraceId: "cov_executor",
        ofertaId: "oferta_1",
        filaItemId: "fila_1",
        clienteId: "cliente_1",
        destinoId: "destino_1",
        destinoNome: "OP Geral",
        statusFilaAntes: "pendente",
        destinoEncontrado: true,
        filaRecebeu: true
      });
      cobertura.registrar("executor_bloqueado", {
        coberturaTraceId: "cov_executor",
        ofertaId: "oferta_1",
        filaItemId: "fila_1",
        clienteId: "cliente_1",
        destinoId: "destino_1",
        destinoNome: "OP Geral",
        motivo: "intervalo_nao_atingido",
        statusFilaAntes: "processando",
        statusFilaDepois: "pendente",
        tentativaEnvio: false,
        filaRecebeu: true
      });
      cobertura.registrar("executor_enviado", {
        coberturaTraceId: "cov_executor",
        ofertaId: "oferta_1",
        filaItemId: "fila_1",
        clienteId: "cliente_1",
        destinoId: "destino_1",
        destinoNome: "OP Geral",
        statusFilaAntes: "processando",
        statusFilaDepois: "enviado",
        tentativaEnvio: true,
        enviadoEm: "2026-07-28T22:00:00.000Z",
        filaRecebeu: true
      });
    });
    const eventos = payloadsCobertura(logs);
    assert(eventos.some(evento => evento.etapa === "destino_candidato" && evento.destinoNome === "OP Geral"));
    assert(eventos.some(evento => evento.etapa === "executor_bloqueado" && evento.motivo === "intervalo_nao_atingido"));
    assert(eventos.some(evento => evento.etapa === "executor_enviado" && evento.tentativaEnvio === true && evento.statusFilaDepois === "enviado"));
  }

  {
    limparModulo("../modules/engine/distributor/distributor.service");
    const distributorService = require("../modules/engine/distributor/distributor.service");
    const retorno = await distributorService.validarOfertaParaDistribuicao({
      id: 122,
      cliente_id: "cliente_1",
      marketplace: "mercadolivre",
      titulo: "Produto com automacao desligada",
      categoria: "casa"
    }, {
      clientesValidos: ["cliente_1"],
      configsPorCliente: { cliente_1: { automacaoAtiva: false } },
      marketplacesAtivosPorCliente: { cliente_1: { mercadolivre: true } },
      destinosPorCliente: {
        cliente_1: [{
          id: "destino_1",
          nome: "OP Geral",
          ativo: true,
          marketplace: "mercadolivre",
          marketplaces: ["mercadolivre"],
          categorias: ["casa"]
        }]
      }
    });

    assert.strictEqual(retorno.ok, true, "automacaoAtiva=false nao deve bloquear distribuicao/fila");
  }

  {
    limparModulo("../modules/engine/distributor/distributor.service");
    const distributorService = require("../modules/engine/distributor/distributor.service");
    const trace = "cov_fila_item_criado";
    const { logs, retorno } = await capturarLogs(() => distributorService.adicionarOfertaNaFilaCliente({
      id: 123,
      cliente_id: "cliente_1",
      marketplace: "mercadolivre",
      titulo: "Produto na fila",
      preco: 10,
      link_original: "https://produto.mercadolivre.com.br/MLB-123",
      link_afiliado: "https://afiliado.test/MLB-123",
      metadata: { coberturaTraceId: trace }
    }, {
      deps: {
        adicionarOfertaNaFilaGlobal: () => ({ ok: true, itemFila: { id: "fila_engine_1", status: "pendente" } })
      }
    }));
    const eventos = payloadsCobertura(logs);
    assert.strictEqual(retorno.ok, true);
    assert(eventos.some(evento =>
      evento.etapa === "fila_item_criado" &&
      evento.coberturaTraceId === trace &&
      evento.filaItemId === "fila_engine_1" &&
      evento.filaRecebeu === true
    ));
  }

  {
    const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    const fluxoLegacy = ["fluxo", "legacy", "selecionado"].join("_");
    assert(indexFonte.includes("[RADAR-EVENTO-REJEITADO]"), "Radar deve auditar descarte quando nao houver rota Engine V2");
    assert(indexFonte.includes("radar_evento_rejeitado"), "cobertura deve registrar descarte auditado");
    assert(!indexFonte.includes(fluxoLegacy), "Radar automatico nao pode selecionar fluxo legado");
  }

  {
    const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    const normalizers = require("../modules/engine/normalizers");
    const linkMercadoLivre = "https://meli.la/2HRuzPf";
    const linkShopee = "https://s.shopee.com.br/903wBcqhYS";
    const linkAmazonDivulgador = "https://amzn.divulgador.link/gUXR2tSr";
    const linkAwinKabum = "https://www.awin1.com/cread.php?awinmid=17729&awinaffid=1062989&clickref=sophie&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F516956";
    const linkKabumDireto = "https://www.kabum.com.br/produto/516956/stream-deck";
    const linkDesconhecido = "https://links.example.invalid/produto";
    const inicioLoop = indexFonte.indexOf("for (const link of links)");
    const inicioEngineV2 = indexFonte.indexOf("if (linkEngineV2Radar(link))", inicioLoop);
    const inicioRejeicao = indexFonte.indexOf("radar_evento_rejeitado", inicioLoop);
    const inicioContinueRejeicao = indexFonte.indexOf("continue;", inicioRejeicao);
    const chamadaImportadorLegacy = ["let importacao = await ", "importarOfertaRadarPorLink"].join("");
    const chamadaFanoutLegacy = ["adicionarRadarCapturadoNaFilaClientes", "(ofertaRadar"].join("");
    const inicioImportadorLegacy = indexFonte.indexOf(chamadaImportadorLegacy, inicioLoop);
    const inicioFanoutLegacy = indexFonte.indexOf(chamadaFanoutLegacy, inicioLoop);

    assert.strictEqual(normalizers.detectarMarketplaceLink(linkMercadoLivre), "mercadolivre");
    assert.strictEqual(normalizers.detectarMarketplaceLink(linkShopee), "shopee");
    assert.strictEqual(normalizers.detectarMarketplaceLink(linkAmazonDivulgador), "amazon");
    assert.strictEqual(normalizers.detectarMarketplaceLink(linkAwinKabum), "awin");
    assert.strictEqual(normalizers.detectarMarketplaceLink(linkKabumDireto), "kabum");
    assert.strictEqual(normalizers.detectarMarketplaceLink(linkDesconhecido), "");
    assert(indexFonte.includes("const marketplaceEngine = detectarMarketplaceEngineLink(url);"));
    assert(indexFonte.includes("if (marketplaceEngine === \"awin\" || marketplaceEngine === \"kabum\") return marketplaceEngine;"));
    assert(indexFonte.includes("function dominioAmazonDivulgadorRadar"));
    assert(indexFonte.includes("if (dominioAmazonDivulgadorRadar(urlLower))"));
    assert(indexFonte.includes("if (dominioAmazonDivulgadorRadar(host)) return \"amazon\";"));
    assert(indexFonte.includes("if (host === \"meli.la\" || host.endsWith(\".meli.la\")) return \"mercadolivre\";"));
    assert(indexFonte.includes("if (host === \"shopee.com.br\" || host.endsWith(\".shopee.com.br\")) return \"shopee\";"));
    assert(inicioEngineV2 > -1 && inicioRejeicao > -1 && inicioEngineV2 < inicioRejeicao, "Engine V2 precisa ser avaliada antes do descarte");
    assert(inicioContinueRejeicao > inicioRejeicao, "descarte auditado deve encerrar o processamento do link");
    assert(inicioImportadorLegacy === -1 || inicioContinueRejeicao < inicioImportadorLegacy, "importador legado nao pode ser alcancado pelo Radar automatico");
    assert(inicioFanoutLegacy === -1 || inicioContinueRejeicao < inicioFanoutLegacy, "fan-out legado nao pode ser alcancado pelo Radar automatico");
    assert(indexFonte.includes("motivoRejeicaoEngineV2"), "link desconhecido deve ter motivo padronizado de rejeicao");
  }

  delete process.env.RADAR_COBERTURA_AUDITORIA_ENABLED;
  console.log("radar-cobertura-v1.test.js OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
