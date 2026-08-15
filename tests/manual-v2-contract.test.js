const assert = require("assert");
const fs = require("fs");
const path = require("path");

const contrato = require("../modules/manual-v2/manual-offers.contract");

const {
  MARKETPLACES_MANUAL_V2,
  STATUS_MANUAL_V2,
  STATUS_INICIAL_MANUAL_V2,
  normalizarMarketplaceManualV2,
  normalizarStatusManualV2,
  normalizarOfertaManualV2,
  temFaixaRealPreco
} = contrato;

const agora = "2026-08-14T12:00:00.000Z";
const idFactory = () => "manual_v2_teste";

{
  assert.deepStrictEqual(STATUS_MANUAL_V2, ["salva", "agendada", "enviando", "enviada", "erro"]);
  assert.strictEqual(STATUS_INICIAL_MANUAL_V2, "salva");
  assert.ok(MARKETPLACES_MANUAL_V2.includes("mercadolivre"));
  assert.ok(MARKETPLACES_MANUAL_V2.includes("kabum"));
}

{
  assert.strictEqual(normalizarStatusManualV2("agendada"), "agendada");
  assert.strictEqual(normalizarStatusManualV2("desconhecido"), "salva");
  assert.strictEqual(normalizarStatusManualV2(""), "salva");
}

{
  assert.strictEqual(normalizarMarketplaceManualV2("Mercado Livre"), "mercadolivre");
  assert.strictEqual(normalizarMarketplaceManualV2("AWIN / KaBuM"), "awin");
  assert.strictEqual(normalizarMarketplaceManualV2("KaBuM"), "kabum");
  assert.strictEqual(normalizarMarketplaceManualV2("algo novo"), "manual");
}

{
  const oferta = normalizarOfertaManualV2({
    marketplace: "Amazon",
    urlOriginal: "https://amazon.com.br/produto",
    titulo: "Produto Amazon",
    precoAtual: "129,90",
    precoAnterior: "199,90",
    imagem: "https://img.test/produto.jpg",
    fonteImportacao: {
      adapter: "amazon.manual.adapter",
      camposConfiaveis: ["titulo", "precoAtual", "precoAnterior"]
    }
  }, { clienteId: "cliente_a", now: agora, idFactory });

  assert.strictEqual(oferta.id, "manual_v2_teste");
  assert.strictEqual(oferta.clienteId, "cliente_a");
  assert.strictEqual(oferta.marketplace, "amazon");
  assert.strictEqual(oferta.urlAfiliada, oferta.urlOriginal, "url afiliada ausente cai para original sem inventar tracking");
  assert.strictEqual(oferta.status, "salva");
  assert.strictEqual(oferta.criadoEm, agora);
  assert.strictEqual(oferta.atualizadoEm, agora);
  assert.strictEqual(oferta.fonteImportacao.parseOnly, true);
  assert.strictEqual(oferta.fonteImportacao.adapter, "amazon.manual.adapter");
  assert.deepStrictEqual(oferta.fonteImportacao.camposConfiaveis, ["titulo", "precoAtual", "precoAnterior"]);
}

{
  const oferta = normalizarOfertaManualV2({
    marketplace: "Shopee",
    url: "https://shopee.com.br/produto-i.1.2",
    titulo: "Produto com variacao",
    precoMin: "89,90",
    precoMax: "149,90",
    imagem: "https://img.test/shopee.jpg"
  }, { clienteId: "cliente_b", now: agora, idFactory });

  assert.strictEqual(oferta.marketplace, "shopee");
  assert.strictEqual(oferta.temVariacaoPreco, true);
  assert.strictEqual(oferta.precoMin, "89,90");
  assert.strictEqual(oferta.precoMax, "149,90");
  assert.strictEqual(oferta.precoAtual, "", "faixa real nao pode virar precoAtual inventado");
}

{
  const oferta = normalizarOfertaManualV2({
    marketplace: "Mercado Livre",
    linkOriginal: "https://produto.mercadolivre.com.br/MLB-123",
    linkAfiliado: "https://meli.la/teste",
    nome: "Produto ML",
    precoPor: "55,50",
    precoDe: "99,90",
    codigoCupom: "PROMO10",
    parcelas: "10x sem juros"
  }, { now: agora, idFactory });

  assert.strictEqual(oferta.marketplace, "mercadolivre");
  assert.strictEqual(oferta.titulo, "Produto ML");
  assert.strictEqual(oferta.precoAtual, "55,50");
  assert.strictEqual(oferta.precoAnterior, "99,90");
  assert.strictEqual(oferta.cupom, "PROMO10");
  assert.strictEqual(oferta.parcelamento, "10x sem juros");
  assert.strictEqual(oferta.urlAfiliada, "https://meli.la/teste");
}

{
  const oferta = normalizarOfertaManualV2({
    marketplace: "AliExpress",
    urlOriginal: "https://pt.aliexpress.com/item/100500.html",
    titulo: "Produto Ali",
    status: "enviada",
    fonteImportacao: {
      camposAusentes: ["cupom", "parcelamento"],
      avisos: ["API retornou sem cupom"]
    }
  }, { now: agora, idFactory });

  assert.strictEqual(oferta.status, "enviada", "schema ja preve estados futuros");
  assert.deepStrictEqual(oferta.fonteImportacao.camposAusentes, ["cupom", "parcelamento"]);
  assert.deepStrictEqual(oferta.fonteImportacao.avisos, ["API retornou sem cupom"]);
}

{
  const oferta = normalizarOfertaManualV2({
    marketplace: "kabum",
    urlOriginal: "https://www.kabum.com.br/produto/123",
    titulo: "Produto Kabum"
  }, { now: agora, idFactory });

  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAtual"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("imagem"));
  assert.strictEqual(oferta.status, "salva");
}

{
  assert.strictEqual(temFaixaRealPreco("10,00", "20,00"), true);
  assert.strictEqual(temFaixaRealPreco("10,00", "10,00"), false);
  assert.strictEqual(temFaixaRealPreco("", "20,00"), false);
}

{
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "modules", "manual-v2", "manual-offers.contract.js"),
    "utf8"
  );
  const proibidos = [
    "processarFila",
    "adicionarOfertaInicioFila",
    "Distributor",
    "Oferta Universal",
    "oferta-universal",
    "inteligencia-universal",
    "memoria-ofertas",
    "radar-ofertas",
    "/fila",
    "/enviar-manual"
  ];

  for (const termo of proibidos) {
    assert.ok(!fonte.includes(termo), `Manual V2 contract nao pode referenciar ${termo}`);
  }
}

console.log("manual-v2-contract.test.js ok");
