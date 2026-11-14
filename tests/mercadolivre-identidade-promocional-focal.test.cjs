const assert = require("assert");

const { tituloComercialUniversalValido } = require("../modules/radar/comercial-precedencia");
const {
  normalizarOfertaImportada,
  tituloFactualConfiavelEngine,
  avaliarGateIdentidadeMercadoLivre
} = require("../modules/engine/importer/importer.service");
const { construirMetadataIntelligenceV1 } = require("../modules/inteligencia-universal/foundation-v1.service");

const CASOS = [
  "Para meli+",
  "Lançamento, muito agradável, aquático com frutado da carambola.",
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

const mlJob = { id: "fixture-job-ml-promo-01", evento_id: "fixture-event-ml-promo-01", cliente_id: "fixture-workspace-ml", marketplace: "mercadolivre" };
const mlAnchor = "https://produto.mercadolivre.com.br/MLB-1234567890-perfume-_JM";
const mlCanonical = "https://produto.mercadolivre.com.br/MLB-1234567890-perfume-oficial-_JM";
const mlTitle = "Perfume Jean Paul Gaultier Le Beau Le Parfum 125 ml";
const enriquecida = normalizarOfertaImportada({
  ok: true,
  marketplace: "mercadolivre",
  titulo: "TODO MUNDO VAI PERGUNTAR QUAL É O SEU PERFUME",
  categoria: "Mercado Livre",
  preco: "168,64",
  linkOriginal: mlAnchor,
  linkExpandido: mlCanonical,
  metadata: {
    adapter: "mercadolivre", jobId: String(mlJob.id), eventoId: String(mlJob.evento_id),
    clienteId: mlJob.cliente_id, linkOriginalEngine: mlAnchor, urlFinalImportador: mlCanonical,
    identidadeCanonicaMl: { status: "consistente", mlbForteConfirmado: true,
      mlbProduto: "MLB1234567890", mlbRevalidado: "MLB1234567890",
      urlOriginal: mlAnchor, urlCanonicaRevalidada: mlCanonical },
    provaTituloTecnico: { versao: 1, marketplace: "mercadolivre", jobId: String(mlJob.id),
      eventoId: String(mlJob.evento_id), workspaceId: mlJob.cliente_id,
      ocorrenciaLink: { id: "ml-link-1", ordem: 1, campo: "url_original", urlOriginal: mlAnchor },
      produto: { produtoIdCanonico: "MLB1234567890", urlCanonica: mlCanonical },
      titulo: { valor: mlTitle, fonte: "og:title" } },
      produto: { titulo: mlTitle, tituloFonteOficial: "og:title", urlFinal: mlCanonical },
      linksComerciais: [{ papelLink: "produto", urlOriginal: mlAnchor,
      ocorrenciaId: "ml-link-1", ordemCaptura: 1 }]
  }
}, mlJob);
assert.strictEqual(enriquecida.titulo, mlTitle);
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
