"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-ml-work-active-"));

const { writeGlobalJson } = require("../utils/storage");
writeGlobalJson("usuarios.json", [
  { id: "admin", nome: "Admin", ativo: true, papel: "admin_master" },
  { id: "user_pss60lus", nome: "Workspace canário", ativo: true, plano: "pro" },
  { id: "workspace_controle", nome: "Workspace controle", ativo: true, plano: "pro" }
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

function radarMirror(workspaceId) {
  const produto = "https://produto.mercadolivre.com.br/MLB123456-tenis-nike";
  return {
    versao: 1,
    origem: { clienteId: workspaceId, tipo: "whatsapp" },
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

async function executarImportacao(workspaceId, backendComProva = false) {
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
  let consultasIdentidade = 0;
  try {
    resultado = await importer.gravarOfertaEngine(
      {
        id: 9301,
        evento_id: 9201,
        cliente_id: workspaceId,
        marketplace: "mercadolivre",
        metadata: { origemFluxo: "optimus", metadataEvento: { origemFluxo: "optimus" } }
      },
      {
        id: 9201,
        origem: "radar",
        origem_tipo: "whatsapp",
        grupo_id: "grupo@g.us",
        texto_original: "Título Radar Comercial De R$ 2.199 por R$ 1.379 Cupom RADAR100",
        metadata: { origemFluxo: "optimus", radarMirror: radarMirror(workspaceId) },
        links_extraidos: ["https://meli.la/produto"]
      },
      {
        id: 9401,
        url_original: "https://meli.la/produto",
        url_expandida: "https://produto.mercadolivre.com.br/MLB123456-tenis-nike",
        marketplace_detectado: "mercadolivre",
        papel_link: "produto",
        ordem_captura: 1
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
        metadata: {
          adapter: "mercadolivre",
          clienteId: workspaceId,
          jobId: "9301",
          eventoId: "9201",
          linkOriginalEngine: "https://meli.la/produto",
          linkExpandidoEngine: "https://produto.mercadolivre.com.br/MLB123456-tenis-nike",
          urlFinalImportador: "https://produto.mercadolivre.com.br/MLB123456-tenis-nike",
          identidadeCanonicaMl: {
            status: "consistente",
            mlbForteConfirmado: true,
            mlbProduto: "MLB123456",
            mlbRevalidado: "MLB123456",
            urlOriginal: "https://meli.la/produto",
            urlCanonicaRevalidada: "https://produto.mercadolivre.com.br/MLB123456-tenis-nike"
          },
          linksComerciais: [{
            id: 9401,
            urlOriginal: "https://meli.la/produto",
            url_original: "https://meli.la/produto",
            papelLink: "produto",
            papel: "produto",
            tipo: "produto",
            ordemCaptura: 1,
            urlAfiliadaWorkspace: "https://meli.la/workspace-final"
          }],
          ...(backendComProva ? { provaTituloTecnico: {
            versao: 1, marketplace: "mercadolivre", jobId: "9301", eventoId: "9201", workspaceId,
            ocorrenciaLink: { id: "9401", ordem: 1, urlOriginal: "https://meli.la/produto" },
            produto: { produtoIdCanonico: "MLB123456", urlCanonica: "https://produto.mercadolivre.com.br/MLB123456-tenis-nike" },
            titulo: { valor: "Tênis Nike Air Max Excee Masculino", fonte: "jsonld.name" }
          } } : {}),
          produto: backendComProva
            ? { produtoId: "MLB123456", titulo: "Tênis Nike Air Max Excee Masculino", tituloFonteOficial: "jsonld.name" }
            : { produtoId: "MLB123456", titulo: "Título promocional recebido" }
        }
      },
      {
        obterIdentidadeMercadoLivreLocalWorker: async () => {
          consultasIdentidade++;
          return identidadeMl();
        },
        garantirIdentidadeMercadoLivreLocalWorker: async () => { throw new Error("nao_deveria_criar_task_em_cache_hit"); }
      }
    );
  } finally {
    console.log = logOriginal;
  }

  return { resultado, metadataInserida, metadataPersistida, consultasIdentidade, logs };
}

(async () => {
  const canario = "user_pss60lus";
  const controle = "workspace_controle";
  process.env.ML_WORK_ENRICHMENT_ACTIVE = "0";
  process.env.ML_WORK_ENRICHMENT_CANARY_CLIENTES = canario;
  const legadoCanario = await executarImportacao(canario);
  const legadoControle = await executarImportacao(controle);

  function ofertaSemTimestamps(oferta) {
    if (!oferta) return oferta;
    const { criadoEm, atualizadoEm, ...restante } = oferta;
    return restante;
  }

  function compararComLegado(atual, legado, cenario) {
    assert.strictEqual(atual.consultasIdentidade, 0, cenario);
    for (const campo of ["ok", "status", "motivo", "motivoDetalhe", "retriavel"]) {
      assert.strictEqual(atual.resultado[campo], legado.resultado[campo], cenario);
    }
    for (const campo of ["metadataInserida", "metadataPersistida"]) {
      assert.strictEqual(Boolean(atual[campo]), Boolean(legado[campo]), cenario);
      assert.deepStrictEqual(ofertaSemTimestamps(atual[campo]?.ofertaUniversal),
        ofertaSemTimestamps(legado[campo]?.ofertaUniversal), cenario);
      assert.deepStrictEqual(atual[campo]?.provaTituloTecnicoValidada, legado[campo]?.provaTituloTecnicoValidada, cenario);
    }
    assert(!atual.logs.some(args => args[0] === "[ML_WORK_ENRICHMENT_ACTIVE]"), cenario);
  }

  process.env.ML_WORK_ENRICHMENT_ACTIVE = "1";
  delete process.env.ML_WORK_ENRICHMENT_CANARY_CLIENTES;
  compararComLegado(await executarImportacao(canario), legadoCanario, "ON sem allowlist");
  process.env.ML_WORK_ENRICHMENT_CANARY_CLIENTES = "";
  compararComLegado(await executarImportacao(canario), legadoCanario, "ON com allowlist vazia");
  process.env.ML_WORK_ENRICHMENT_CANARY_CLIENTES = canario;
  compararComLegado(await executarImportacao(controle), legadoControle, "ON fora da allowlist");

  const { resultado, metadataInserida, metadataPersistida, consultasIdentidade, logs } = await executarImportacao(canario);
  assert.strictEqual(consultasIdentidade, 1);
  assert.strictEqual(resultado.ok, true);
  assert(metadataInserida && metadataPersistida);
  const universal = metadataPersistida.ofertaUniversal;
  assert.strictEqual(universal.produto.titulo, "Tênis Nike Air Max Excee Masculino");
  assert.strictEqual(universal.midia.imagemPrincipal, "https://http2.mlstatic.com/D_NQ_NP_ATUAL-MLB123456.jpg");
  assert.strictEqual(universal.comercial.precoAtual, 1379);
  assert.strictEqual(universal.comercial.precoAnterior, 2199);
  assert.strictEqual(universal.comercial.cupom, "RADAR100");
  assert.strictEqual(universal.afiliacao.urlAfiliada, "https://meli.la/workspace-final");
  assert.strictEqual(metadataPersistida.mlWorkEnrichmentActive.tituloWorkAplicado, true);
  assert.strictEqual(metadataPersistida.provaTituloTecnicoValidada?.titulo.valor, "Tênis Nike Air Max Excee Masculino");
  assert.strictEqual(metadataPersistida.provaTituloTecnicoValidada?.produto.produtoIdCanonico, "MLB123456");
  assert.strictEqual(metadataPersistida.provaTituloTecnicoValidada?.workspaceId, canario);
  assert.strictEqual(metadataPersistida.mlWorkEnrichmentActive.imagemWorkAplicada, false);
  assert.strictEqual(metadataPersistida.mlWorkEnrichmentActive.comercialAlterado, false);
  assert.strictEqual(metadataPersistida.mlWorkEnrichmentActive.linksAlterados, false);
  assert.strictEqual(universal.produto.categoriaNormalizada, "Tênis e Chinelos");
  const logAtivo = logs.find(args => args[0] === "[ML_WORK_ENRICHMENT_ACTIVE]");
  assert(logAtivo);
  assert.strictEqual(String(logAtivo[1]).includes("Tênis Nike"), false);
  assert.strictEqual(String(logAtivo[1]).includes("mlstatic.com"), false);

  const backend = await executarImportacao(canario, true);
  assert.strictEqual(backend.resultado.ok, true);
  assert.strictEqual(backend.consultasIdentidade, 0, "título provado e imagem pronta não consultam worker");
  assert.strictEqual(backend.metadataPersistida.provaTituloTecnicoValidada?.titulo.fonte, "jsonld.name");
  assert.strictEqual(backend.metadataPersistida.ofertaUniversal.produto.titulo, "Tênis Nike Air Max Excee Masculino");
  console.log("ml-work-enrichment-active-integration.test.js: ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
