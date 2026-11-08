const assert = require("assert");

const { tituloComercialUniversalValido } = require("../modules/radar/comercial-precedencia");
const {
  normalizarOfertaImportada,
  tituloFactualConfiavelEngine,
  avaliarGateIdentidadeMercadoLivre
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
  produtoIdDetectado: "MLB1234567890",
  metadata: {
    identidadeCanonicaMl: { status: "consistente", mlbForteConfirmado: true, mlbProduto: "MLB1234567890" },
    produto: { titulo: "Perfume Jean Paul Gaultier Le Beau Le Parfum 125 ml" }
  }
}, { marketplace: "mercadolivre" });
assert.strictEqual(enriquecida.titulo, "Perfume Jean Paul Gaultier Le Beau Le Parfum 125 ml");
assert.strictEqual(enriquecida.categoria, "Perfumaria, Farmácia e Beleza");

const semProva = normalizarOfertaImportada({
  marketplace: "mercadolivre",
  titulo: "Aproveita e convida os amigos pro grupo enviando o link abaixo:",
  produtoIdDetectado: "MLB1234567890",
  metadata: { produto: { titulo: "Perfume Jean Paul Gaultier Le Beau Le Parfum 125 ml" } }
}, { marketplace: "mercadolivre" });
assert.strictEqual(semProva.titulo, "");
assert.strictEqual(semProva.categoria, "Diversos");
assert.strictEqual(avaliarGateIdentidadeMercadoLivre(semProva, semProva.metadata).motivo,
  "mercadolivre_titulo_tecnico_nao_confirmado");
assert.strictEqual(avaliarGateIdentidadeMercadoLivre(enriquecida, enriquecida.metadata).retida, false);

for (const identidadeCanonicaMl of [
  { status: "consistente", mlbForteConfirmado: true, mlbProduto: "MLB9999999999" },
  { status: "nao_confirmada", mlbForteConfirmado: false, mlbProduto: "MLB1234567890" }
]) {
  const divergente = normalizarOfertaImportada({
    marketplace: "mercadolivre",
    titulo: "TODO MUNDO VAI PERGUNTAR QUAL É O SEU PERFUME",
    produtoIdDetectado: "MLB1234567890",
    metadata: {
      identidadeCanonicaMl,
      produto: { titulo: "Perfume Jean Paul Gaultier Le Beau Le Parfum 125 ml" }
    }
  }, { marketplace: "mercadolivre" });
  assert.strictEqual(divergente.titulo, "");
  assert.strictEqual(divergente.categoria, "Diversos");
}

console.log("mercadolivre-identidade-promocional-focal.test.cjs OK");
