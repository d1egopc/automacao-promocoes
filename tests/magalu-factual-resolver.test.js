"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  resolverFatosMagalu,
  construirFontesMagalu,
  sellerIdPorUrl
} = require("../modules/marketplaces/magalu/magalu-factual-resolver");

const urlA07 = "https://www.magazineluiza.com.br/smartphone-samsung-a07-256gb-preto/p/240466000/te/ga07/?seller_id=magazineluiza&utm_source=x";
const urlA07M = "https://m.magazineluiza.com.br/smartphone-samsung-a07-256gb-preto/p/240466000/te/ga07/?seller_id=magazineluiza&utm_source=x";
const urlA07Voce = "https://www.magazinevoce.com.br/d1egopc/smartphone-samsung-a07-256gb-preto/p/240466000/te/ga07/?seller_id=magazineluiza&utm_source=x";
const urlA07VoceMagazine = "https://www.magazinevoce.com.br/magazined1egopc/smartphone-samsung-a07-256gb-preto/p/240466000/te/ga07/?seller_id=magazineluiza&utm_source=x";
const urlNight = "https://www.magazinevoce.com.br/d1egopc/night-caviar-100ml-paris-elysses/p/be172949ba/pf/ppfm/";
const urlGuarda = "https://www.magazineluiza.com.br/guarda-roupa-casal-hera/p/ke8kag6fce/mo/guro/?seller_id=modernamobilia2";
const urlProdutoAd = "https://www.magazineluiza.com.br/produto-teste/p/ad0j1hj63h/xx/test/";

function fatos({ url, produtoId, titulo = "Produto Magalu", precoAtual = "R$\u00a078,90", imagem = "https://a-static.mlcdn.com.br/produto.jpg", avisos = [], seller = "" } = {}) {
  return {
    urlOriginal: url,
    urlCanonica: url,
    produtoId,
    codigo: produtoId,
    titulo,
    precoAtual,
    precoAnterior: "",
    imagem,
    categoria: "",
    seller,
    parcelamento: "",
    cupom: "",
    avisos
  };
}

function consultarPorMapa(mapa = {}, chamadas = []) {
  return async (url) => {
    chamadas.push(url);
    const valor = mapa[url] || mapa.default;
    if (typeof valor === "function") return valor(url);
    if (valor instanceof Error) throw valor;
    return valor || fatos({ url, produtoId: "sem_id", titulo: "", precoAtual: "", imagem: "", avisos: ["magalu_produto_nao_comprovado"] });
  };
}

(async function main() {
{
  const fontes = construirFontesMagalu({ urlOriginal: urlA07, promoterId: "d1egopc" });
  assert.deepStrictEqual(fontes.map(item => item.fonte), [
    "pdp_www",
    "pdp_m",
    "magazinevoce_promoter",
    "magazinevoce_magazine_promoter"
  ]);
  assert.strictEqual(fontes[0].url, urlA07);
  assert.strictEqual(fontes[1].url, urlA07M);
  assert.strictEqual(fontes[2].url, urlA07Voce);
  assert.strictEqual(fontes[3].url, urlA07VoceMagazine);
  assert.strictEqual(sellerIdPorUrl(urlGuarda), "modernamobilia2");
}

{
  const chamadas = [];
  const resultado = await resolverFatosMagalu({ urlOriginal: urlA07, promoterId: "d1egopc" }, {
    consultarProdutoMagalu: consultarPorMapa({
      [urlA07]: fatos({ url: urlA07, produtoId: "240466000", titulo: "Smartphone Samsung A07" })
    }, chamadas)
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.produtoId, "240466000");
  assert.strictEqual(resultado.fonteUsada, "pdp_www");
  assert.strictEqual(resultado.fatos.titulo, "Smartphone Samsung A07");
  assert.strictEqual(chamadas.length, 1, "primeira fonte factual suficiente nao chama seguintes");
}

{
  const chamadas = [];
  const resultado = await resolverFatosMagalu({ urlOriginal: urlA07, promoterId: "d1egopc" }, {
    consultarProdutoMagalu: consultarPorMapa({
      [urlA07]: fatos({ url: urlA07, produtoId: "240466000", titulo: "", precoAtual: "", imagem: "", avisos: ["magalu_http_403", "magalu_produto_nao_comprovado"] }),
      [urlA07M]: fatos({ url: urlA07M, produtoId: "240466000", titulo: "A07 Mobile" })
    }, chamadas)
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.fonteUsada, "pdp_m");
  assert.strictEqual(resultado.fatos.titulo, "A07 Mobile");
  assert.strictEqual(chamadas.length, 2);
}

{
  const chamadas = [];
  const resultado = await resolverFatosMagalu({ urlOriginal: urlA07, promoterId: "d1egopc" }, {
    consultarProdutoMagalu: consultarPorMapa({
      [urlA07]: fatos({ url: urlA07, produtoId: "240466000", titulo: "", precoAtual: "", imagem: "", avisos: ["magalu_http_403"] }),
      [urlA07M]: fatos({ url: urlA07M, produtoId: "240466000", titulo: "", precoAtual: "", imagem: "", avisos: ["magalu_captcha_detectado"] }),
      [urlA07Voce]: fatos({ url: urlA07Voce, produtoId: "240466000", titulo: "A07 Magazine Voce" })
    }, chamadas)
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.fonteUsada, "magazinevoce_promoter");
  assert.strictEqual(resultado.fatos.titulo, "A07 Magazine Voce");
  assert.strictEqual(chamadas.length, 3);
}

{
  const chamadas = [];
  const resultado = await resolverFatosMagalu({ urlOriginal: urlA07, promoterId: "d1egopc" }, {
    consultarProdutoMagalu: consultarPorMapa({
      [urlA07]: fatos({ url: urlA07, produtoId: "240466000", titulo: "", precoAtual: "", imagem: "", avisos: ["magalu_captcha_detectado"] }),
      [urlA07M]: fatos({ url: urlA07M, produtoId: "240466000", titulo: "", precoAtual: "", imagem: "", avisos: ["magalu_pagina_indisponivel"] }),
      [urlA07Voce]: fatos({ url: urlA07Voce, produtoId: "240466000", titulo: "", precoAtual: "", imagem: "", avisos: ["magalu_produto_nao_comprovado"] }),
      [urlA07VoceMagazine]: fatos({ url: urlA07VoceMagazine, produtoId: "240466000", titulo: "", precoAtual: "", imagem: "", avisos: ["magalu_produto_nao_comprovado"] })
    }, chamadas)
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.fatos.titulo, "");
  assert.ok(resultado.avisos.includes("magalu_factual_resolver_sem_fonte_segura"));
  assert.strictEqual(chamadas.length, 4);
}

{
  const chamadas = [];
  const resultado = await resolverFatosMagalu({ urlOriginal: urlA07, promoterId: "d1egopc" }, {
    consultarProdutoMagalu: consultarPorMapa({
      [urlA07]: fatos({ url: urlA07, produtoId: "240575800", titulo: "Galaxy A17" }),
      [urlA07M]: fatos({ url: urlA07M, produtoId: "240466000", titulo: "Galaxy A07" })
    }, chamadas)
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.fonteUsada, "pdp_m");
  assert.strictEqual(resultado.fatos.titulo, "Galaxy A07");
  assert.ok(resultado.avisos.includes("magalu_produto_divergente_ignorado"));
}

{
  for (const [url, id] of [
    [urlA07, "240466000"],
    [urlNight, "be172949ba"],
    [urlGuarda, "ke8kag6fce"],
    [urlProdutoAd, "ad0j1hj63h"]
  ]) {
    const resultado = await resolverFatosMagalu({ urlOriginal: url, promoterId: "d1egopc" }, {
      consultarProdutoMagalu: async (fonteUrl) => fatos({ url: fonteUrl, produtoId: id, titulo: `Produto ${id}` })
    });
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.produtoId, id);
    assert.strictEqual(resultado.fatos.produtoId, id);
  }
}

{
  const chamadas = [];
  const resultado = await resolverFatosMagalu({ urlOriginal: urlGuarda, promoterId: "d1egopc" }, {
    consultarProdutoMagalu: consultarPorMapa({
      default: fatos({ url: urlGuarda, produtoId: "ke8kag6fce", titulo: "Guarda Roupa", precoAtual: "R$\u00a01.279,90", seller: "Outro Seller" })
    }, chamadas)
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.sellerIdOriginal, "modernamobilia2");
  assert.ok(resultado.avisos.includes("magalu_seller_divergente"));
  assert.strictEqual(resultado.fatos.precoAtual, "", "seller divergente nao deve manter preco como verdade factual");
  assert.strictEqual(resultado.fatos.imagem, "https://a-static.mlcdn.com.br/produto.jpg", "imagem vinda da fonte pode ser preservada");
}

{
  const resultado = await resolverFatosMagalu({ urlOriginal: urlA07, promoterId: "d1egopc" }, {
    consultarProdutoMagalu: async (fonteUrl) => fatos({ url: fonteUrl, produtoId: "240466000", titulo: "Sem Imagem", imagem: "" })
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.fatos.imagem, "", "resolver nao constroi imagem por padrao de URL");
  assert.ok(!JSON.stringify(resultado).includes("html"));
}

{
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "modules", "marketplaces", "magalu", "magalu-factual-resolver.js"),
    "utf8"
  );
  for (const proibido of [
    "importarMagalu",
    "/importar-magalu-manual",
    "farejarMagalu",
    "adicionarOfertaNaFila",
    "salvarFila",
    "processarFila",
    "prepararOfertaGlobal",
    "manual-offers",
    "manual-v2",
    "Radar",
    "Engine",
    "Distributor",
    "Oferta Universal",
    "OneLink",
    "utils/fila-ofertas",
    "Dispara"
  ]) {
    assert.ok(!fonte.includes(proibido), `resolver factual Magalu nao deve referenciar ${proibido}`);
  }
}

console.log("magalu-factual-resolver.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
