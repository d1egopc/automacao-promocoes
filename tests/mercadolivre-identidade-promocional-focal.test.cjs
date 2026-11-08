const assert = require("assert");

const { tituloComercialUniversalValido } = require("../modules/radar/comercial-precedencia");
const {
  normalizarOfertaImportada,
  tituloFactualConfiavelEngine
} = require("../modules/engine/importer/importer.service");
const { construirMetadataIntelligenceV1 } = require("../modules/inteligencia-universal/foundation-v1.service");

const CASOS = [
  "Aproveita e convida os amigos pro grupo enviando o link abaixo:",
  "TODO MUNDO VAI PERGUNTAR QUAL É O SEU PERFUME",
  "Cupons costumam esgotar rápido, garanta o seu enquanto está ativo"
];

for (const titulo of CASOS) {
  assert.strictEqual(
    tituloComercialUniversalValido(titulo, { marketplace: "mercadolivre" }),
    false,
    `linha promocional aceita como título: ${titulo}`
  );

  const oferta = normalizarOfertaImportada({
    marketplace: "mercadolivre",
    titulo,
    nome: titulo,
    categoria: "Mercado Livre",
    preco: "168,64"
  }, { marketplace: "mercadolivre" });

  assert.strictEqual(oferta.titulo, "", `título contaminado persistido: ${titulo}`);
  assert.strictEqual(oferta.tituloFactual, "", `identidade factual inventada: ${titulo}`);
  assert.strictEqual(oferta.categoria, "Diversos", `categoria herdada do slogan: ${titulo}`);

  const metadata = construirMetadataIntelligenceV1({
    marketplace: "mercadolivre",
    titulo,
    productId: "MLB1234567890",
    identityConfirmed: true,
    identitySource: "api_oficial",
    categoria: "Diversos"
  });
  assert.strictEqual(metadata.factualTitle.title, null, `Intelligence aceitou slogan como título factual: ${titulo}`);
  assert.notStrictEqual(metadata.classificationStatus, "resolved", `Intelligence resolveu slogan: ${titulo}`);
}

const produtoOficial = "Óleo Náutico TCW3 2T Yamalube Kit 4L Grátis Boné Yamaha";
assert.strictEqual(
  tituloComercialUniversalValido(produtoOficial, { marketplace: "mercadolivre" }),
  true
);
assert.strictEqual(tituloFactualConfiavelEngine(produtoOficial, "mercadolivre"), true);

const enriquecida = normalizarOfertaImportada({
  marketplace: "mercadolivre",
  titulo: "TODO MUNDO VAI PERGUNTAR QUAL É O SEU PERFUME",
  categoria: "Mercado Livre",
  preco: "168,64",
  metadata: {
    produto: { titulo: "Perfume Jean Paul Gaultier Le Beau Le Parfum 125 ml" }
  }
}, { marketplace: "mercadolivre" });
assert.strictEqual(enriquecida.titulo, "Perfume Jean Paul Gaultier Le Beau Le Parfum 125 ml");
assert.strictEqual(enriquecida.categoria, "Perfumaria, Farmácia e Beleza");

console.log("mercadolivre-identidade-promocional-focal.test.cjs OK");
