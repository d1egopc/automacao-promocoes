"use strict";

const assert = require("node:assert/strict");
const resolver = require("../optimus-capture/local-worker/magalu-identity.js");
const {
  chaveIdentidadeMagalu,
  validarResultadoMagaluIdentity
} = require("../modules/local-worker/magalu-identity.contract");

const casos = [
  {
    sourceUrl: "https://magazineluiza.onelink.me/589508454/cykrl2vm",
    finalUrl: "https://www.magazineluiza.com.br/oleo-capilar-sebastian-dark-oil-sebastian-professional/p/fk7e7jhh8d/pf/olcp/?promoter_id=origem",
    productId: "fk7e7jhh8d",
    title: "Óleo Capilar Sebastian Dark Oil",
    image: "https://a-static.mlcdn.com.br/470x352/oleo-capilar-sebastian-dark-oil/produto/imagem.jpeg"
  },
  {
    sourceUrl: "https://magazineluiza.onelink.me/589508454/t6kx59sf",
    finalUrl: "https://www.magazineluiza.com.br/rum-busca-brisa-psico-spirit-1l/p/bg38djf818/me/ctua/?partner_id=origem",
    productId: "bg38djf818",
    title: "Rum Busca Brisa Psico Spirit 1L",
    image: "https://a-static.mlcdn.com.br/470x352/rum-busca-brisa/produto/imagem.jpeg"
  },
  {
    sourceUrl: "https://magazineluiza.onelink.me/589508454/galaxyfixture",
    finalUrl: "https://www.magazineluiza.com.br/celular-samsung-galaxy-a07/p/240466500/te/ga07/?seller_id=magazineluiza&promoter_id=origem",
    productId: "240466500",
    title: "Celular Samsung Galaxy A07 128GB Preto",
    image: "https://a-static.mlcdn.com.br/470x352/celular-samsung-a07/produto/imagem.jpeg"
  }
];

async function testarNavegacao(caso, alterarProduto = produto => produto) {
  const removidas = [];
  const chamadas = [];
  const final = caso.finalUrl;
  const tabId = 731;
  const tabs = {
    create: async opcoes => {
      chamadas.push(["create", opcoes]);
      return { id: tabId, status: "complete", url: final };
    },
    get: async id => {
      assert.equal(id, tabId);
      return { id, status: "complete", url: final };
    },
    sendMessage: async (id, message, opcoes) => {
      chamadas.push(["message", message, opcoes]);
      assert.equal(id, tabId);
      return {
        ok: false, // A captura comercial pode estar incompleta sem impedir prova factual de identidade.
        produto: alterarProduto({
          produtoId: caso.productId,
          sku: caso.productId,
          titulo: caso.title,
          imagem: caso.image,
          urlOriginal: final
        })
      };
    },
    remove: async id => { removidas.push(id); },
    onUpdated: {
      addListener: () => undefined,
      removeListener: () => undefined
    }
  };
  global.chrome = { tabs };
  global.fetch = async (_url, opcoes) => {
    assert.equal(opcoes.credentials, "omit");
    return {
      ok: false,
      status: 403,
      redirected: true,
      url: final,
      body: { cancel: async () => undefined }
    };
  };
  const identityKey = chaveIdentidadeMagalu(caso.sourceUrl);
  return {
    resultado: () => resolver.resolver({ sourceUrl: caso.sourceUrl, identityKey }),
    chamadas,
    removidas,
    identityKey
  };
}

(async () => {
  const fetchOriginal = global.fetch;
  const chromeOriginal = global.chrome;
  try {
    for (const caso of casos) {
      const teste = await testarNavegacao(caso);
      const resultado = await teste.resultado();
      assert.equal(resultado.observedProductId, caso.productId);
      const esperado = new URL(caso.finalUrl);
      esperado.search = esperado.searchParams.has("seller_id")
        ? "?seller_id=" + encodeURIComponent(esperado.searchParams.get("seller_id")) : "";
      assert.equal(resultado.finalUrl, esperado.toString());
      assert.equal(resultado.provaTecnica.statusHttp, 0, "tabs não fornece status HTTP");
      assert.equal(teste.chamadas[0][1].active, false);
      assert.equal(teste.chamadas[1][1].type, "OPTIMUS_CAPTURE_PAGE");
      assert.equal(teste.chamadas[1][2].frameId, 0);
      assert.deepEqual(teste.removidas, [731]);
      assert.equal(JSON.stringify(resultado).includes("promoter_id"), false);
      assert.equal(JSON.stringify(resultado).includes("partner_id"), false);
      assert.equal(validarResultadoMagaluIdentity(resultado, {
        sourceUrl: caso.sourceUrl,
        identityKey: teste.identityKey
      }).identidadeValidada, true);
    }
    for (const alteracao of [
      produto => ({ ...produto, sku: "produto-alheio" }),
      produto => ({ ...produto, imagem: "https://evil.example/imagem.jpg" }),
      produto => ({ ...produto, titulo: "Produto" }),
      produto => ({ ...produto, urlOriginal: "https://evil.example/p/" + produto.produtoId })
    ]) {
      const teste = await testarNavegacao(casos[0], alteracao);
      await assert.rejects(teste.resultado(), /magalu_identity_produto_nao_confirmado/);
      assert.deepEqual(teste.removidas, [731], "aba técnica deve fechar também na falha");
    }
    const teste = await testarNavegacao(casos[0]);
    global.chrome = undefined;
    await assert.rejects(teste.resultado(), /magalu_identity_browser_indisponivel/);
  } finally {
    global.fetch = fetchOriginal;
    global.chrome = chromeOriginal;
  }
  console.log("magalu-firstparty-identity-fallback.test.cjs OK");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
