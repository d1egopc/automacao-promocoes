"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-ml-work-active-"));

const { writeGlobalJson } = require("../utils/storage");
writeGlobalJson("usuarios.json", [
  { id: "admin", nome: "Admin", ativo: true, papel: "admin_master" },
  { id: "workspace_ml", nome: "Workspace ML", ativo: true, plano: "pro" }
]);
writeGlobalJson("planos.json", {
  pro: { nome: "pro", ativo: true, marketplaces: ["mercadolivre"], recursos: { automacao: true } }
});

function mockModulo(relativo, exports) {
  const resolvido = require.resolve(relativo);
  delete require.cache[resolvido];
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
}

function identidadeMl() {
  const collectedAt = new Date(Date.now() - 1000).toISOString();
  return {
    capability: "ml_identity_v1",
    contractVersion: 1,
    marketplace: "mercadolivre",
    expectedMlb: "MLB123456",
    observedMlb: "MLB123456",
    identidadeValidada: true,
    tituloOficial: "Tênis Nike Air Max Excee Masculino",
    imagemOficial: "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB123456.jpg",
    origemTitulo: "jsonld.name",
    origemImagem: "jsonld.image",
    finalUrl: "https://produto.mercadolivre.com.br/MLB123456-tenis-nike",
    canonicalUrl: "https://produto.mercadolivre.com.br/MLB123456-tenis-nike",
    collectedAt,
    provaTecnica: {
      capability: "ml_identity_v1",
      contractVersion: 1,
      source: "local_first_party",
      provenance: "local_worker.ml_identity_v1",
      expectedMlb: "MLB123456",
      observedMlb: "MLB123456",
      sameProductObject: true,
      origemTitulo: "jsonld.name",
      origemImagem: "jsonld.image",
      finalUrl: "https://produto.mercadolivre.com.br/MLB123456-tenis-nike",
      canonicalUrl: "https://produto.mercadolivre.com.br/MLB123456-tenis-nike",
      collectedAt
    }
  };
}

function radarMirror() {
  const produto = "https://produto.mercadolivre.com.br/MLB123456-tenis-nike";
  return {
    versao: 1,
    origem: { clienteId: "workspace_ml", tipo: "whatsapp" },
    texto: { original: `Título Radar\nDe R$ 2.199 por R$ 1.379\nCupom RADAR100\n${produto}` },
    produto: { tituloCapturado: "Título Radar Comercial" },
    preco: {
      atualCapturado: 1379,
      anteriorCapturado: 2199,
      confianca: "alta",
      condicionado: false,
      condicaoTexto: null,
      tipoCapturado: "final",
      evidenciaCapturada: "Por R$ 1.379",
      marcadorComercial: "por"
    },
    cupom: { codigoCapturado: "RADAR100", textoCapturado: "Cupom RADAR100", condicaoCapturada: "Use RADAR100", confianca: "alta" },
    links: { encontrados: [produto], produtoOriginal: produto, resgateCupom: "", adicionais: [], quantidadeEncontrada: 1 },
    comercial: {
      precoAtual: { valor: 1379, confianca: "alta", evidencia: "Por R$ 1.379", tipo: "final" },
      precoAntigo: { valor: 2199, confianca: "alta", evidencia: "De R$ 2.199" },
      precoPix: { valor: null, confianca: "ausente", evidencia: null },
      precoBoleto: { valor: null, confianca: "ausente", evidencia: null },
      precoCartao: { valor: null, confianca: "ausente", evidencia: null },
      parcelamento: { quantidade: null, valorParcela: null, semJuros: false, confianca: "ausente" },
      descontoPercentual: { valor: null, confianca: "ausente", evidencia: null },
      cupom: { codigo: "RADAR100", texto: "Cupom RADAR100", instrucao: "Use RADAR100", confianca: "alta", provavel: false },
      cashback: { valor: null, confianca: "ausente", evidencia: null },
      freteGratis: { valor: false, confianca: "ausente", evidencia: null },
      moedasShopee: { valor: null, confianca: "ausente", evidencia: null },
      brindes: [],
      condicoesEspeciais: [],
      links: { produto, resgate: "", classificados: [{ link: produto, tipo: "produto" }] },
      marketplace: { valor: "mercadolivre", confianca: "alta", evidencia: "mercadolivre" },
      categoria: { valor: "Diversos", confianca: "baixa", evidencia: "" }
    },
    comparacaoImportador: {}
  };
}

(async () => {
  let metadataInserida = null;
  let metadataPersistida = null;
  mockModulo("../modules/engine/database", {
    queryEngine: async (sql, params = []) => {
      if (/information_schema\.columns/i.test(sql)) return { ok: true, resultado: { rows: [{ existe: true }] } };
      if (/FROM engine_ofertas o\s+JOIN engine_jobs_cliente/i.test(sql)) return { ok: true, resultado: { rows: [] } };
      if (/INSERT INTO engine_ofertas/i.test(sql)) {
        metadataInserida = JSON.parse(params[20]);
        return { ok: true, resultado: { rows: [{ id: 9701, uuid: "uuid-9701" }] } };
      }
      if (/UPDATE engine_ofertas\s+SET metadata/i.test(sql)) {
        metadataPersistida = JSON.parse(params[1]);
        return { ok: true, resultado: { rows: [{ id: 9701 }] } };
      }
      return { ok: true, resultado: { rows: [] } };
    }
  });
  delete require.cache[require.resolve("../modules/engine/importer/importer.service")];
  const importer = require("../modules/engine/importer/importer.service");
  const logs = [];
  const logOriginal = console.log;
  console.log = (...args) => logs.push(args);
  let resultado;
  try {
    resultado = await importer.gravarOfertaEngine(
      {
        id: 9301,
        evento_id: 9201,
        cliente_id: "workspace_ml",
        marketplace: "mercadolivre",
        metadata: { origemFluxo: "optimus", metadataEvento: { origemFluxo: "optimus" } }
      },
      {
        id: 9201,
        origem: "radar",
        origem_tipo: "whatsapp",
        grupo_id: "grupo@g.us",
        texto_original: "Título Radar Comercial De R$ 2.199 por R$ 1.379 Cupom RADAR100",
        metadata: { origemFluxo: "optimus", radarMirror: radarMirror() },
        links_extraidos: []
      },
      {
        id: 9401,
        url_original: "https://meli.la/produto",
        url_expandida: "https://produto.mercadolivre.com.br/MLB123456-tenis-nike",
        marketplace_detectado: "mercadolivre"
      },
      {
        ok: true,
        marketplace: "mercadolivre",
        titulo: "Tênis Mercado Livre Atual",
        preco: 999,
        precoOriginal: 1299,
        imagem: "https://http2.mlstatic.com/D_NQ_NP_ATUAL-MLB123456.jpg",
        imagemOrigem: "produto.imagem",
        linkOriginal: "https://meli.la/produto",
        linkExpandido: "https://produto.mercadolivre.com.br/MLB123456-tenis-nike",
        linkAfiliado: "https://meli.la/workspace-final",
        categoria: "Diversos",
        cupom: "IMPORTADOR",
        metadata: { produto: { produtoId: "MLB123456" } }
      },
      {
        mlWorkEnrichmentAtivo: true,
        obterIdentidadeMercadoLivreLocalWorker: async () => identidadeMl(),
        garantirIdentidadeMercadoLivreLocalWorker: async () => { throw new Error("nao_deveria_criar_task_em_cache_hit"); }
      }
    );
  } finally {
    console.log = logOriginal;
  }

  assert.strictEqual(resultado.ok, true);
  assert(metadataInserida && metadataPersistida);
  const universal = metadataPersistida.ofertaUniversal;
  assert.strictEqual(universal.produto.titulo, "Tênis Nike Air Max Excee Masculino");
  assert.strictEqual(universal.midia.imagemPrincipal, "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB123456.jpg");
  assert.strictEqual(universal.comercial.precoAtual, 1379);
  assert.strictEqual(universal.comercial.precoAnterior, 2199);
  assert.strictEqual(universal.comercial.cupom, "RADAR100");
  assert.strictEqual(universal.afiliacao.urlAfiliada, "https://meli.la/workspace-final");
  assert.strictEqual(metadataPersistida.mlWorkEnrichmentActive.tituloWorkAplicado, true);
  assert.strictEqual(metadataPersistida.mlWorkEnrichmentActive.imagemWorkAplicada, true);
  assert.strictEqual(metadataPersistida.mlWorkEnrichmentActive.comercialAlterado, false);
  assert.strictEqual(metadataPersistida.mlWorkEnrichmentActive.linksAlterados, false);
  assert.strictEqual(universal.produto.categoriaNormalizada, "Tênis e Chinelos");
  const logAtivo = logs.find(args => args[0] === "[ML_WORK_ENRICHMENT_ACTIVE]");
  assert(logAtivo);
  assert.strictEqual(String(logAtivo[1]).includes("Tênis Nike"), false);
  assert.strictEqual(String(logAtivo[1]).includes("mlstatic.com"), false);

  console.log("ml-work-enrichment-active-integration.test.js: ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
