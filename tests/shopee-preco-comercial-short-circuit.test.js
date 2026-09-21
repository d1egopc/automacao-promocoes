"use strict";

const assert = require("assert");
const { importarShopeeEngine } = require("../modules/engine/importer/adapters/shopee.adapter");
const { criarImportarShopee } = require("../marketplaces/shopee/importar");

const WORKSPACE = "workspace_shopee_preco";
const PRODUTO = "https://www.shopee.com.br/product/111111111/222222222";
const RESGATE = "https://www.shopee.com.br/m/cupom-de-desconto";
const PRODUTO_AFILIADO = "https://s.shopee.com.br/produtoWorkspace";
const RESGATE_AFILIADO = "https://s.shopee.com.br/resgateWorkspace";

function textoOferta(formato = "unico", comPreco = true) {
  const linhasPreco = !comPreco
    ? []
    : (formato === "de_por"
      ? ["De: R$ 2.199,00", "Por: R$ 1.277,88"]
      : ["💰 R$ 1.379"]);
  return [
    "Produto Shopee controlado",
    ...linhasPreco,
    "Resgatem o cupom de R$ 100 OFF",
    RESGATE,
    "➡️ Produto:",
    PRODUTO
  ].join("\n");
}

function contratoClonador(formato = "unico", valido = true) {
  if (!valido) {
    return { origem: "clonador_grupos", precoAtual: null };
  }
  return {
    versao: "clonador_comercial_capturado_v1",
    origem: "clonador_grupos",
    precoAtual: formato === "de_por" ? 1277.88 : 1379,
    ...(formato === "de_por" ? { precoAnterior: 2199 } : {}),
    beneficioTexto: "Resgatem o cupom de R$ 100 OFF"
  };
}

function criarImportadorReal() {
  return criarImportarShopee({
    limparPreco: valor => valor,
    htmlDecode: valor => String(valor || ""),
    extrairMeta: () => "",
    corrigirImagemUrl: valor => String(valor || ""),
    registrarSucessoIntegracao: () => {},
    registrarAlertaIntegracao: () => {}
  });
}

function respostaJson(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => "",
    url: "https://open-api.affiliate.shopee.com.br/graphql"
  };
}

function respostaHtml(url) {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "<html><head></head><body>Produto Shopee controlado</body></html>",
    url
  };
}

async function executarCaso({ origem, formato = "unico", precoTecnico = "", comercialValido = true } = {}) {
  const fetchOriginal = global.fetch;
  const contextosImportador = [];
  const importarShopeeReal = criarImportadorReal();

  global.fetch = async (url) => {
    if (String(url).includes("open-api.affiliate.shopee.com.br/graphql")) {
      return respostaJson({
        data: {
          productOfferV2: {
            nodes: [{
              itemId: "222222222",
              productName: "Produto Shopee controlado",
              productLink: PRODUTO,
              offerLink: PRODUTO_AFILIADO,
              imageUrl: "https://cf.shopee.com.br/file/produto-controlado.jpg",
              priceMin: precoTecnico,
              priceMax: precoTecnico,
              shopId: "111111111",
              shopName: "Loja controlada"
            }]
          }
        }
      });
    }
    return respostaHtml(String(url));
  };

  try {
    const contrato = origem === "clonador_grupos"
      ? contratoClonador(formato, comercialValido)
      : null;
    const resultado = await importarShopeeEngine({
      job: { id: 501, evento_id: 601, cliente_id: WORKSPACE },
      evento: {
        id: 601,
        origem,
        marketplace: "shopee",
        texto_original: textoOferta(formato, comercialValido),
        metadata: contrato ? {
          origemFluxo: "clonador_grupos",
          comercialCapturado: contrato
        } : {}
      },
      links: [
        { url_original: RESGATE, url_expandida: RESGATE, ordemCaptura: 1, papelLink: "cupom" },
        { url_original: PRODUTO, url_expandida: PRODUTO, ordemCaptura: 2, papelLink: "produto" }
      ],
      deps: {
        getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
        importarShopee: async (url, config) => {
          contextosImportador.push(config?.contextoEngine || {});
          return importarShopeeReal(url, config);
        },
        gerarShortLinkShopee: async (originUrl, integracao, subIds) => {
          assert.strictEqual(originUrl, RESGATE);
          assert.ok(subIds.includes(`ws${WORKSPACE.replace(/[^a-zA-Z0-9]/g, "")}`));
          return { ok: true, shortLink: RESGATE_AFILIADO, origemConversao: "workspace_api" };
        },
        expandirShortlinkShopee: async (url) => {
          if (url === PRODUTO_AFILIADO) return `${PRODUTO}?mmp_pid=an_app&utm_source=an_app`;
          if (url === RESGATE_AFILIADO) return `${RESGATE}?mmp_pid=an_app&utm_source=an_app`;
          return url;
        }
      }
    });
    return { resultado, contextosImportador };
  } finally {
    global.fetch = fetchOriginal;
  }
}

function assertProdutoEResgateAfiliados(resultado) {
  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(resultado.linksComerciais.map(item => item.tipo), ["resgate", "produto"]);
  const produto = resultado.linksComerciais.find(item => item.tipo === "produto");
  const resgate = resultado.linksComerciais.find(item => item.tipo === "resgate");
  assert.strictEqual(produto.urlAfiliadaWorkspace, PRODUTO_AFILIADO);
  assert.strictEqual(resgate.urlAfiliadaWorkspace, RESGATE_AFILIADO);
  assert.strictEqual(produto.renderizavel, true);
  assert.strictEqual(resgate.renderizavel, true);
  assert.strictEqual(produto.conversaoStatus, "convertida");
  assert.strictEqual(resgate.conversaoStatus, "convertida");
  assert.notStrictEqual(produto.urlAfiliadaWorkspace, PRODUTO);
  assert.notStrictEqual(resgate.urlAfiliadaWorkspace, RESGATE);
  assert.strictEqual(produto.afiliacaoWorkspace.origemConversao, "workspace_api");
  assert.strictEqual(resgate.afiliacaoWorkspace.origemConversao, "workspace_api");
  assert.match(resultado.beneficioTexto, /R\$ 100 OFF/i);
}

async function testarOrigem(origem) {
  const unicoSemTecnico = await executarCaso({ origem, formato: "unico", precoTecnico: "" });
  assertProdutoEResgateAfiliados(unicoSemTecnico.resultado);
  assert.strictEqual(unicoSemTecnico.resultado.preco, 1379);
  assert.ok(unicoSemTecnico.contextosImportador.every(contexto => contexto.precoComercialSoberano?.precoAtual === 1379));
  if (origem === "clonador_grupos") {
    assert.ok(!unicoSemTecnico.resultado.precoOriginal, "precoAnterior ausente nao deve ser inventado nem bloquear");
  }

  const dePorSemTecnico = await executarCaso({ origem, formato: "de_por", precoTecnico: "" });
  assertProdutoEResgateAfiliados(dePorSemTecnico.resultado);
  assert.strictEqual(dePorSemTecnico.resultado.preco, 1277.88);
  assert.ok(dePorSemTecnico.contextosImportador.every(contexto => contexto.precoComercialSoberano?.precoAtual === 1277.88));
  if (origem === "clonador_grupos") {
    assert.strictEqual(dePorSemTecnico.resultado.precoOriginal, 2199);
  }

  const comTecnico = await executarCaso({ origem, formato: "unico", precoTecnico: "999.90" });
  assertProdutoEResgateAfiliados(comTecnico.resultado);
  assert.strictEqual(comTecnico.resultado.preco, 1379, "preco tecnico nao pode sobrescrever o comercial capturado");

  const semPreco = await executarCaso({ origem, formato: "unico", precoTecnico: "", comercialValido: false });
  assert.strictEqual(semPreco.resultado.ok, false);
  assert.strictEqual(semPreco.resultado.motivo, "shopee_preco_indisponivel");
  assert.ok(semPreco.contextosImportador.every(contexto => !contexto.precoComercialSoberano));
}

(async () => {
  await testarOrigem("radar");
  await testarOrigem("clonador_grupos");
  console.log("shopee-preco-comercial-short-circuit.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
