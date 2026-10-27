"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { criarEvidenciaCategoriaMarketplace, avaliarEvidenciaCategoria, classificarCategoriaOferta } = require("../marketplaces/inteligencia/classificador-categorias");
const { classificarCategoriaUniversal } = require("../modules/inteligencia-universal/categoria.service");
const { normalizarOfertaUniversal } = require("../modules/inteligencia-universal/normalizacao.service");
const fontes = { mercadolivre: "mercadolivre_api_items", shopee: "shopee_affiliate_graphql", amazon: "amazon_product_api",
  aliexpress: "aliexpress.affiliate.productdetail.get", magalu: "magalu_product_jsonld", kabum: "kabum_product_jsonld", awin: "awin_feed" };
function ofertaOficial(extras = {}) {
  const marketplace = extras.marketplace || "aliexpress";
  return { titulo: "Acessório modelo QX", produtoId: "1005009876543210", marketplace, categoria: "Diversos",
    categoriaMarketplace: criarEvidenciaCategoriaMarketplace({ marketplace, fonte: fontes[marketplace], produtoId: "1005009876543210",
      categoriaId: "fixture-category-id", hierarquia: ["Sports & Entertainment", "Fishing Lures"] }), ...extras };
}
for (const marketplace of Object.keys(fontes)) test(`mapeamento puro simulado: ${marketplace} (não prova acesso à API)`, () => {
  const oferta = ofertaOficial({ marketplace });
  const result = classificarCategoriaUniversal(normalizarOfertaUniversal(oferta));
  assert.equal(result.categoria, "Pesca e Camping");
  assert.equal(result.origem, "marketplace_oficial");
  assert.equal(result.baixaConfianca, false);
});
test("proveniência e identidade não são aceitas de JSON, fonte desconhecida ou outro produto/marketplace", () => {
  const oficial = ofertaOficial();
  for (const oferta of [JSON.parse(JSON.stringify(oficial)), { ...oficial, produtoId: "999999" }, { ...oficial, marketplace: "amazon" }]) {
    assert.equal(avaliarEvidenciaCategoria(oferta), null);
    assert.equal(classificarCategoriaUniversal(oferta).categoria, "Diversos");
  }
  assert.equal(criarEvidenciaCategoriaMarketplace({ marketplace: "amazon", fonte: fontes.aliexpress, produtoId: "1" }), null);
  assert.equal(criarEvidenciaCategoriaMarketplace({ marketplace: "aliexpress", fonte: "cliente_diz_oficial", produtoId: "1" }), null);
});
test("categoria externa não vence tipo factual contraditório nem conteúdo adulto", () => {
  for (const [titulo, categoria] of [["Notebook Dell Inspiron", "Computadores e Notebook"], ["Calça de pesca masculina", "Roupas e Moda Masculina"],
    ["Brinquedo de pesca com molinete", "Brinquedos e Artigos Infantis"], ["Produto erótico infantil", "Diversos"]]) {
    const result = classificarCategoriaUniversal(ofertaOficial({ titulo }));
    assert.equal(result.categoria, categoria);
    assert.equal(result.divergencia, true);
  }
});
test("IDs opacos, ramos amplos e ausência de evidência conservam fallback", () => {
  const oferta = ofertaOficial();
  oferta.categoriaMarketplace = criarEvidenciaCategoriaMarketplace({ marketplace: oferta.marketplace, fonte: fontes.aliexpress,
    produtoId: oferta.produtoId, categoriaId: "12345", hierarquia: ["Sports & Entertainment"] });
  assert.equal(classificarCategoriaUniversal(oferta).categoria, "Diversos");
  assert.equal(classificarCategoriaUniversal({ titulo: "Acessório modelo QX", categoria: "Pesca e Camping" }).origem, "declarada");
});
test("diagnóstico limitado não inclui dados pessoais ou comerciais e preserva contrato string", () => {
  const evidencia = criarEvidenciaCategoriaMarketplace({ marketplace: "aliexpress", fonte: fontes.aliexpress, produtoId: "12345",
    hierarquia: Array.from({ length: 50 }, () => "Fishing Lures"), token: "fixture-secret", promoterId: "fixture-foreign", ownerId: "fixture-personal" });
  assert.equal(evidencia.hierarquia.length, 8);
  const result = classificarCategoriaUniversal(ofertaOficial({ categoriaMarketplace: evidencia, produtoId: "12345" }));
  assert.equal(typeof classificarCategoriaOferta(ofertaOficial()), "string");
  assert.ok(!/fixture-secret|fixture-foreign|fixture-personal|https:/.test(JSON.stringify(result)));
  assert.deepEqual(Object.keys(result.logs[0]).sort(), ["baixaConfianca", "categoria", "categoriaOriginal", "confianca", "divergencia", "etapa", "fonteEvidencia", "motivo", "origem", "status"].sort());
});
test("tipo oficial é utilizável como atributo; divergência com hierarquia fica em baixa confiança", () => {
  const oferta = ofertaOficial();
  oferta.categoriaMarketplace = criarEvidenciaCategoriaMarketplace({ marketplace: oferta.marketplace, fonte: fontes.aliexpress,
    produtoId: oferta.produtoId, tipoProduto: "Fishing Lure", hierarquia: ["Sports & Entertainment"] });
  assert.equal(classificarCategoriaUniversal(oferta).categoria, "Pesca e Camping");
  oferta.categoriaMarketplace = criarEvidenciaCategoriaMarketplace({ marketplace: oferta.marketplace, fonte: fontes.aliexpress,
    produtoId: oferta.produtoId, tipoProduto: "Perfume", hierarquia: ["Fishing Lures"] });
  const result = classificarCategoriaUniversal(oferta);
  assert.equal(result.categoria, "Diversos"); assert.equal(result.baixaConfianca, true);
  assert.equal(result.motivo, "tipo_hierarquia_divergentes");
  oferta.categoriaMarketplace = criarEvidenciaCategoriaMarketplace({ marketplace: oferta.marketplace, fonte: fontes.aliexpress,
    produtoId: oferta.produtoId, tipoProduto: "Sex Toy", hierarquia: ["Children's Clothing"] });
  assert.equal(classificarCategoriaUniversal(oferta).categoria,"Diversos","tipo adulto explícito jamais recebe categoria infantil");
});

test("importador AliExpress real mantém hierarquia e cache técnico sem misturar afiliação", async () => {
  const { importarAliExpress } = require("../marketplaces/aliexpress/importar");
  const anterior = global.fetch, log = console.log;
  const produtoId = "1005009876543210", cache = new Map(), calls = [];
  const produto = { product_id: produtoId, product_title: "Acessório modelo QX", target_sale_price: "59.90", target_original_price: "99.90",
    product_main_image_url: "https://ae01.alicdn.com/kf/fixture.jpg", product_detail_url: `https://www.aliexpress.com/item/${produtoId}.html`,
    promotion_link: "https://s.click.aliexpress.com/e/_original", first_level_category_name: "Sports & Entertainment", second_level_category_name: "Fishing Lures" };
  global.fetch = async (url, options) => {
    const body = new URLSearchParams(options.body); calls.push(body.get("method"));
    assert.equal(url, "https://api-sg.aliexpress.com/sync");
    assert.equal(body.get("method"), fontes.aliexpress);
    return { ok: true, json: async () => ({ aliexpress_affiliate_productdetail_get_response: {
      resp_result: { resp_code: "200", result: { products: { product: produto } } } } }) };
  };
  console.log = () => {};
  try {
    for (const clienteId of ["workspace-a", "workspace-b"]) {
      const result = await importarAliExpress(produto.product_detail_url, { clienteId, cacheProdutoAliExpress: cache,
        credenciais: { appKey: "fixture", secret: "fixture", trackingId: clienteId },
        gerarLinkCurtoAliExpress: async (_, credenciais) => `https://s.click.aliexpress.com/e/_${credenciais.trackingId}` });
      assert.equal(classificarCategoriaUniversal(normalizarOfertaUniversal(result)).categoria, "Pesca e Camping");
      assert.equal(result.categoriaMarketplace.fonte, fontes.aliexpress);
      assert.equal(result.linkAfiliado, `https://s.click.aliexpress.com/e/_${clienteId}`);
      assert.equal(result.precoAtual, "59,90");
      assert.equal(result.precoAntigo, "99,90");
    }
    assert.deepEqual(calls, [fontes.aliexpress], "cache existente evita consulta adicional; conversão continua por workspace");
  } finally { global.fetch = anterior; console.log = log; }
});
