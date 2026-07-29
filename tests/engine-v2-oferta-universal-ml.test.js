const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-engine-v2-oferta-universal-ml-"));

const { writeGlobalJson } = require("../utils/storage");

writeGlobalJson("usuarios.json", [
  { id: "admin", nome: "Admin", ativo: true, papel: "admin_master" },
  { id: "workspace_ml", nome: "Workspace ML", ativo: true, plano: "pro" },
  { id: "workspace_sem_permissao", nome: "Sem permissao", ativo: true, plano: "basico" }
]);
writeGlobalJson("planos.json", {
  pro: {
    nome: "pro",
    ativo: true,
    marketplaces: ["mercadolivre"],
    recursos: { automacao: true }
  },
  basico: {
    nome: "basico",
    ativo: true,
    marketplaces: [],
    recursos: { automacao: false }
  }
});

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

async function capturarLogs(fn) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args);
  try {
    const retorno = await fn();
    return { logs, retorno };
  } finally {
    console.log = original;
  }
}

function possuiLog(logs, tag) {
  return logs.some(args => String(args[0] || "") === tag);
}

function ofertaMlAdapter(extras = {}) {
  return {
    ok: true,
    marketplace: "mercadolivre",
    titulo: "Jaqueta Puffer Hering",
    preco: 155,
    precoOriginal: 299,
    imagem: "https://http2.mlstatic.com/D_NQ_NP_123-MLB.jpg",
    imagemOrigem: "produto.imagem",
    linkOriginal: "https://meli.la/2Ud5obn",
    linkExpandido: "https://produto.mercadolivre.com.br/MLB-123456-jaqueta-puffer",
    linkAfiliado: "https://meli.la/afiliado123",
    categoria: "Moda",
    cupom: "MODAPRAVC",
    cupomTipo: "codigo_confirmado",
    parcelamento: "R$ 25,83 em ate 6x",
    metadata: {
      adapter: "mercadolivre",
      camposProduto: ["titulo", "precoAtual", "precoOriginal", "imagem", "linkAfiliado"],
      produto: {
        produtoId: "MLB123456",
        imagemCandidatos: ["https://http2.mlstatic.com/D_NQ_NP_123-MLB.jpg"]
      }
    },
    ...extras
  };
}

(async () => {
  {
    const {
      montarOfertaUniversalEngine,
      validarContratoOfertaUniversal
    } = require("../modules/engine/oferta-universal.contract");

    const ofertaUniversal = montarOfertaUniversalEngine({
      job: { id: 10, evento_id: 20, cliente_id: "workspace_ml", marketplace: "mercadolivre" },
      evento: { id: 20, origem: "radar", origem_tipo: "whatsapp", grupo_id: "grupo@g.us" },
      link: { url_original: "https://meli.la/2Ud5obn", url_expandida: "https://produto.mercadolivre.com.br/MLB-123456-jaqueta-puffer" },
      oferta: {
        marketplace: "mercadolivre",
        titulo: "Jaqueta Puffer Hering",
        preco: 155,
        precoOriginal: 299,
        imagem: "https://http2.mlstatic.com/D_NQ_NP_123-MLB.jpg",
        imagemOrigem: "produto.imagem",
        linkOriginal: "https://meli.la/2Ud5obn",
        linkExpandido: "https://produto.mercadolivre.com.br/MLB-123456-jaqueta-puffer",
        linkAfiliado: "https://meli.la/afiliado123",
        categoria: "Moda",
        cupom: ""
      },
      ofertaEntrada: { avisoCupom: "Pode haver cupom no app" },
      metadata: { adapter: "mercadolivre", produto: { produtoId: "MLB123456" } },
      status: "importada"
    });

    assert.strictEqual(ofertaUniversal.schemaVersion, "engine-v2-oferta-universal-3a");
    assert.strictEqual(ofertaUniversal.workspaceId, "workspace_ml");
    assert.strictEqual(ofertaUniversal.produto.idExterno, "MLB123456");
    assert.strictEqual(ofertaUniversal.comercial.precoAtual, 155);
    assert.strictEqual(ofertaUniversal.comercial.precoAnterior, 299);
    assert.strictEqual(ofertaUniversal.comercial.descontoPercentual, 48.16);
    assert.strictEqual(ofertaUniversal.comercial.cupom, null, "cupom provavel nao pode virar cupom confirmado");
    assert.strictEqual(ofertaUniversal.afiliacao.statusConversao, "convertida");
    assert.strictEqual(validarContratoOfertaUniversal(ofertaUniversal).ok, true);

    const semPreco = montarOfertaUniversalEngine({
      job: { id: 11, evento_id: 21, cliente_id: "workspace_ml", marketplace: "mercadolivre" },
      oferta: {
        marketplace: "mercadolivre",
        titulo: "Oferta sem preco",
        linkAfiliado: "https://meli.la/afiliado-sem-preco"
      }
    });
    assert.strictEqual(validarContratoOfertaUniversal(semPreco).ok, false);
    assert(validarContratoOfertaUniversal(semPreco).motivos.includes("preco_ausente"));
  }

  let metadataInserida = null;
  let metadataPersistida = null;

  limparModulo("../modules/engine/importer/importer.service");
  mockModulo("../modules/engine/database", {
    queryEngine: async (sql, params = []) => {
      if (/information_schema\.columns/i.test(sql)) {
        return { ok: true, resultado: { rows: [{ existe: true }] } };
      }
      if (/FROM engine_ofertas o\s+JOIN engine_jobs_cliente/i.test(sql)) {
        return { ok: true, resultado: { rows: [] } };
      }
      if (/INSERT INTO engine_ofertas/i.test(sql)) {
        metadataInserida = JSON.parse(params[20]);
        return { ok: true, resultado: { rows: [{ id: 701, uuid: "uuid-701" }] } };
      }
      if (/UPDATE engine_ofertas\s+SET metadata/i.test(sql)) {
        metadataPersistida = JSON.parse(params[1]);
        return { ok: true, resultado: { rows: [{ id: 701 }] } };
      }
      return { ok: true, resultado: { rows: [] } };
    }
  });

  const importerService = require("../modules/engine/importer/importer.service");
  const { logs: logsGravacao, retorno: gravacao } = await capturarLogs(() => importerService.gravarOfertaEngine(
    { id: 301, evento_id: 201, cliente_id: "workspace_ml", marketplace: "mercadolivre" },
    {
      id: 201,
      origem: "radar",
      origem_tipo: "whatsapp",
      grupo_id: "grupo@g.us",
      texto_original: "Jaqueta Puffer Hering De R$ 299 por R$ 155 Cupom MODAPRAVC https://meli.la/2Ud5obn"
    },
    {
      id: 401,
      url_original: "https://meli.la/2Ud5obn",
      url_expandida: "https://produto.mercadolivre.com.br/MLB-123456-jaqueta-puffer",
      marketplace_detectado: "mercadolivre"
    },
    ofertaMlAdapter()
  ));

  assert.strictEqual(gravacao.ok, true);
  assert.strictEqual(gravacao.ofertaId, 701);
  assert(metadataInserida.ofertaUniversal);
  assert(metadataPersistida.ofertaUniversal);
  assert.strictEqual(metadataPersistida.ofertaUniversal.ofertaId, 701);
  assert.strictEqual(metadataPersistida.ofertaUniversal.produto.titulo, "Jaqueta Puffer Hering");
  assert.strictEqual(metadataPersistida.ofertaUniversal.midia.imagemPrincipal, "https://http2.mlstatic.com/D_NQ_NP_123-MLB.jpg");
  assert.strictEqual(metadataPersistida.ofertaUniversal.afiliacao.urlAfiliada, "https://meli.la/afiliado123");
  assert.strictEqual(metadataPersistida.ofertaUniversalValidacao.ok, true);
  assert(possuiLog(logsGravacao, "[OFERTA-UNIVERSAL-CRIADA]"));
  assert(possuiLog(logsGravacao, "[OFERTA-UNIVERSAL-VALIDADA]"));
  assert(possuiLog(logsGravacao, "[ENGINE-V2-INTELIGENCIA-APLICADA]"));
  assert(possuiLog(logsGravacao, "[ENGINE-V2-AFILIACAO-CONCLUIDA]"));

  limparModulo("../modules/engine/importer/importer.runner");
  mockModulo("../modules/engine/importer/importer.service", {
    tentarMarcarImportando: async () => ({ ok: true }),
    registrarEtapaImportacao: async () => ({ ok: true }),
    carregarEventoBruto: async () => ({
      ok: true,
      evento: {
        id: 202,
        texto_original: "Jaqueta Puffer Hering De R$ 299 por R$ 155 Cupom MODAPRAVC https://meli.la/2Ud5obn"
      }
    }),
    carregarLinksEvento: async () => ({
      ok: true,
      links: [{
        id: 402,
        url_original: "https://meli.la/2Ud5obn",
        url_expandida: "https://produto.mercadolivre.com.br/MLB-123456-jaqueta-puffer",
        marketplace_detectado: "mercadolivre"
      }]
    }),
    gravarOfertaEngine: async () => ({ ok: true, ofertaId: 702 }),
    marcarJobOfertaCriada: async () => ({ ok: true }),
    marcarJobRetidaV2: async () => ({ ok: true }),
    marcarJobErroImportacao: async () => ({ ok: true })
  });
  mockModulo("../modules/engine/importer/adapters/mercadolivre.adapter", {
    importarMercadoLivreEngine: async () => ofertaMlAdapter({ cupom: "", avisoCupom: "Pode haver cupom no app" })
  });
  mockModulo("../modules/engine/importer/adapters/amazon.adapter", { importarAmazonEngine: async () => ({ ok: false }) });
  mockModulo("../modules/engine/importer/adapters/shopee.adapter", { importarShopeeEngine: async () => ({ ok: false }) });
  mockModulo("../modules/engine/importer/adapters/aliexpress.adapter", { importarAliExpressEngine: async () => ({ ok: false }) });
  mockModulo("../modules/engine/importer/adapters/awin.adapter", { importarAwinEngine: async () => ({ ok: false }) });

  const importerRunner = require("../modules/engine/importer/importer.runner");
  const { logs: logsImportacao, retorno: importacao } = await capturarLogs(() => importerRunner.importarJobPronto({
    id: 302,
    evento_id: 202,
    cliente_id: "workspace_ml",
    marketplace: "mercadolivre",
    metadata: {}
  }));
  assert.strictEqual(importacao.ok, true);
  assert.strictEqual(importacao.ofertaId, 702);
  assert(possuiLog(logsImportacao, "[ENGINE-V2-IMPORTACAO-CONCLUIDA]"));

  limparModulo("../modules/engine/distributor/distributor.runner");
  mockModulo("../modules/engine/distributor/distributor.service", {
    limitarDistribuicao: valor => Number(valor || 10),
    buscarOfertasDistribuiveis: async () => ({
      ok: true,
      ofertas: [{
        id: 701,
        evento_id: 201,
        job_id: 301,
        cliente_id: "workspace_ml",
        marketplace: "mercadolivre",
        titulo: "Jaqueta Puffer Hering",
        preco: 155,
        preco_original: 299,
        cupom: "MODAPRAVC",
        imagem: "https://http2.mlstatic.com/D_NQ_NP_123-MLB.jpg",
        link_original: "https://meli.la/2Ud5obn",
        link_expandido: "https://produto.mercadolivre.com.br/MLB-123456-jaqueta-puffer",
        link_afiliado: "https://meli.la/afiliado123",
        categoria: "Moda",
        metadata: metadataPersistida
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
    adicionarOfertaNaFilaCliente: async (oferta) => ({
      ok: true,
      itemFila: {
        id: "fila_701",
        engineOfertaId: oferta.id,
        clienteId: oferta.cliente_id,
        imagem: oferta.imagem,
        metadata: oferta.metadata,
        status: "pendente"
      }
    })
  });

  const distributor = require("../modules/engine/distributor/distributor.runner");
  const { logs: logsDistribuicao, retorno: distribuicao } = await capturarLogs(() =>
    distributor.distribuirOfertasEngine({ limite: 1, marketplace: "mercadolivre" })
  );

  assert.strictEqual(distribuicao.adicionadasFila, 1);
  assert(possuiLog(logsDistribuicao, "[ENGINE-V2-DISTRIBUICAO-CONCLUIDA]"));

  console.log("engine-v2-oferta-universal-ml.test.js OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
