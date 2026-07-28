const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-radar-cobertura-v1-"));

const { writeGlobalJson } = require("../utils/storage");
writeGlobalJson("usuarios.json", [{ id: "cliente_1", ativo: true }]);

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
      criarJobsParaClientes: async () => {
        jobChamado = true;
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
    assert.strictEqual(jobChamado, false);
    assert(eventos.some(evento =>
      evento.etapa === "engine_evento_duplicado" &&
      evento.coberturaTraceId === trace &&
      evento.motivo === "duplicidade" &&
      evento.jobNovoCriado === false
    ));
  }

  {
    limparModulo("../modules/engine/jobs.service");
    mockModulo("../modules/engine/database", {
      queryEngine: async (sql) => {
        if (/WITH jobs_admin/i.test(sql)) return { ok: true, resultado: { rows: [{ jobs_ignorados: 0, ofertas_retidas: 0 }] } };
        if (/INSERT INTO engine_jobs_cliente/i.test(sql)) return { ok: true, resultado: { rows: [{ id: 88 }] } };
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
    assert(eventos.some(evento => evento.etapa === "engine_job_criado" && evento.coberturaTraceId === trace && evento.jobId === 88));
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

  delete process.env.RADAR_COBERTURA_AUDITORIA_ENABLED;
  console.log("radar-cobertura-v1.test.js OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
