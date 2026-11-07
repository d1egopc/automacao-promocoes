"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CLASSIFIER_VERSION,
  CANONICAL_CATEGORY_IDS,
  canonicalCategoryId,
  classifyMulticategoryShadow
} = require("../modules/inteligencia-universal/classification-v1.service");
const {
  construirMetadataIntelligenceV1,
  avaliarIntelligenceV1Global
} = require("../modules/inteligencia-universal/foundation-v1.service");
const { avaliarOfertaUniversal } = require("../modules/inteligencia-universal/oferta-universal.service");
const { buildMemoryRecord, memoryScope } = require("../modules/inteligencia-universal/memory-v1.service");
const { CATEGORIAS_OPTIMUS } = require("../marketplaces/inteligencia/categorias-globais");

const fixture = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  "fixtures/intelligence-v1-phase-c.sanitized.json"
), "utf8"));

function shadow(offer) {
  return avaliarIntelligenceV1Global(offer, {
    env: { OPTIMUS_INTELLIGENCE_V1_MODE: "shadow" }
  });
}

test("catalogo existente e a unica autoridade de IDs canonicos", () => {
  assert.deepEqual(CANONICAL_CATEGORY_IDS, CATEGORIAS_OPTIMUS);
  assert.equal(canonicalCategoryId("Pesca e Camping"), "Pesca e Camping");
  assert.equal(canonicalCategoryId("Sex Shop +18"), null);
  assert.equal(CANONICAL_CATEGORY_IDS.includes("Sex Shop +18"), false);
  assert.equal(new Set(CANONICAL_CATEGORY_IDS).size, CANONICAL_CATEGORY_IDS.length);
});

test("seis marketplaces produzem principal e afinidades canonicas com evidencia", () => {
  for (const item of fixture.cases) {
    const result = shadow(item.offer);
    assert.equal(result.mode, "shadow", item.id);
    assert.equal(result.applied, true, item.id);
    assert.equal(result.metadata.category.classifierVersion, CLASSIFIER_VERSION, item.id);
    assert.equal(result.metadata.category.principal, item.principal, item.id);
    assert.deepEqual(result.metadata.category.affinities, item.affinities, item.id);
    assert.deepEqual(result.metadata.category.categoriasAfinidade, item.affinities, item.id);
    assert.equal(new Set(result.metadata.category.affinities).size,
      result.metadata.category.affinities.length, item.id);
    assert.equal(result.metadata.category.evidence.length, 1 + item.affinities.length, item.id);
    for (const evidence of result.metadata.category.evidence) {
      assert.ok(CATEGORIAS_OPTIMUS.includes(evidence.categoryId), item.id);
      assert.match(evidence.evidenceHash, /^[a-f0-9]{64}$/, item.id);
      assert.ok(["principal", "affinity"].includes(evidence.role), item.id);
    }
    assert.equal(result.metadata.eligibilityAuthoritative, false, item.id);
  }
});

test("origem ou grupo de pesca nao inventa afinidade sem finalidade factual", () => {
  const offer = {
    marketplace: "shopee",
    tituloOficial: "Calça esportiva masculina dry fit para corrida",
    productId: "sport-pants-1",
    identityConfirmed: true,
    identitySource: "api_oficial",
    categoria: "Roupas e Moda Masculina",
    origem: "radar",
    grupoNome: "Ofertas Pesca e Camping"
  };
  const metadata = construirMetadataIntelligenceV1(offer);
  assert.equal(metadata.category.principal, "Roupas e Moda Masculina");
  assert.deepEqual(metadata.category.affinities, []);
  assert.equal(metadata.classificationStatus, "uncertain");
  assert.equal(metadata.category.reason, "legacy_category_preserved_without_multicategory_evidence");

  const captureOnly = construirMetadataIntelligenceV1({
    marketplace: "shopee",
    titulo: "Calça masculina para pesca em poliamida",
    productId: "capture-only-1",
    identityConfirmed: true,
    identitySource: "api_oficial",
    categoria: "Roupas e Moda Masculina",
    origem: "radar"
  });
  assert.equal(captureOnly.factualTitle.source, "captura_origem");
  assert.equal(captureOnly.category.principal, "Roupas e Moda Masculina");
  assert.deepEqual(captureOnly.category.affinities, []);
  assert.equal(captureOnly.classificationStatus, "uncertain");
});

test("placa-mae so recebe afinidade gamer com evidencia adequada", () => {
  const common = construirMetadataIntelligenceV1({
    marketplace: "kabum", tituloOficial: "Placa-mãe ASUS Prime B650M AM5",
    productId: "board-common", identityConfirmed: true, identitySource: "pagina_oficial",
    categoria: "Computadores e Notebook"
  });
  const gaming = construirMetadataIntelligenceV1({
    marketplace: "kabum", tituloOficial: "Placa-mãe ASUS ROG Gaming B650E AM5",
    productId: "board-gaming", identityConfirmed: true, identitySource: "pagina_oficial",
    categoria: "Computadores e Notebook"
  });
  assert.deepEqual(common.category.affinities, []);
  assert.deepEqual(gaming.category.affinities, ["Gamer e Hardware"]);
});

test("identidade divergente rejeita classificacao e produto incerto preserva Diversos", () => {
  const divergent = construirMetadataIntelligenceV1({
    marketplace: "mercadolivre", tituloOficial: "Mouse Gamer Modelo X",
    produtoId: "MLB100", identityConfirmed: true, identitySource: "api_oficial",
    sku: "SKU-A", metadata: { produto: { produtoId: "MLB200", sku: "SKU-B" } },
    categoria: "Periféricos"
  });
  const uncertain = construirMetadataIntelligenceV1({
    marketplace: "magalu", tituloOficial: "Acessório modelo QX série 2026",
    productId: "qx-2026", identityConfirmed: true, identitySource: "pagina_oficial",
    categoria: "Diversos"
  });
  assert.equal(divergent.classificationStatus, "rejected");
  assert.deepEqual(divergent.category.affinities, []);
  assert.equal(uncertain.classificationStatus, "uncertain");
  assert.equal(uncertain.category.principal, "Diversos");
  assert.deepEqual(uncertain.category.evidence, []);
});

test("safety adulta permanece separada e categoria reservada nao entra no classificador", () => {
  const metadata = construirMetadataIntelligenceV1({
    marketplace: "amazon", tituloOficial: "Vibrador adulto recarregável em silicone",
    productId: "B0ADULTC01", identityConfirmed: true, identitySource: "pagina_oficial",
    categoria: "Diversos"
  });
  assert.equal(metadata.safety.class, "adult");
  assert.equal(metadata.safety.reservedCommercialCategory, "Sex Shop +18");
  assert.equal(metadata.category.principal, "Diversos");
  assert.deepEqual(metadata.category.affinities, []);
  assert.equal(CANONICAL_CATEGORY_IDS.includes("Sex Shop +18"), false);
});

test("memoria recebe classificacao shadow versionada sem promover escopo privado", () => {
  const offer = fixture.cases.find(item => item.id === "amazon_gamer_mouse").offer;
  const metadata = construirMetadataIntelligenceV1(offer);
  const globalRecord = buildMemoryRecord(offer, metadata, "workspace_a");
  assert.equal(globalRecord.ok, true);
  assert.equal(globalRecord.record.scopeType, "global");
  assert.equal(globalRecord.record.classifierVersion, CLASSIFIER_VERSION);
  assert.deepEqual(globalRecord.record.categoryAffinities, ["Gamer e Hardware"]);

  const privateMetadata = {
    ...metadata,
    identity: { ...metadata.identity, source: "extension_verified" }
  };
  assert.equal(memoryScope(privateMetadata, "workspace_a").scopeType, "workspace");
  assert.equal(memoryScope(privateMetadata, "workspace_b").workspaceId, "workspace_b");
});

test("OFF e shadow preservam categoria, destinos, targets e decisao produtiva", () => {
  const offer = {
    ...fixture.cases.find(item => item.id === "meli_split_air_conditioner").offer,
    titulo: "Ar-condicionado Split Inverter Samsung WindFree 12000 BTU 220V",
    precoAtual: 2499.9,
    linkAfiliado: "https://example.test/fixture",
    imagem: "https://example.test/image.jpg"
  };
  const context = {
    clienteId: "workspace_fixture",
    exigirLinkAfiliado: true,
    memoriaAnteriores: [],
    destinos: [
      { id: "dest-clima", ativo: true, marketplaces: ["mercadolivre"], categorias: ["Climatização e Ventilação"] },
      { id: "dest-eletro", ativo: true, marketplaces: ["mercadolivre"], categorias: ["Eletrodomésticos"] }
    ]
  };
  const off = avaliarOfertaUniversal(offer, context);
  const oldMode = process.env.OPTIMUS_INTELLIGENCE_V1_MODE;
  const oldDisabled = process.env.OPTIMUS_INTELLIGENCE_V1_DISABLED;
  let enabled;
  try {
    process.env.OPTIMUS_INTELLIGENCE_V1_MODE = "shadow";
    delete process.env.OPTIMUS_INTELLIGENCE_V1_DISABLED;
    enabled = avaliarOfertaUniversal(offer, context);
  } finally {
    if (oldMode === undefined) delete process.env.OPTIMUS_INTELLIGENCE_V1_MODE;
    else process.env.OPTIMUS_INTELLIGENCE_V1_MODE = oldMode;
    if (oldDisabled === undefined) delete process.env.OPTIMUS_INTELLIGENCE_V1_DISABLED;
    else process.env.OPTIMUS_INTELLIGENCE_V1_DISABLED = oldDisabled;
  }
  assert.equal(off.intelligenceV1Shadow, undefined);
  assert.equal(enabled.intelligenceV1Shadow.mode, "shadow");
  assert.deepEqual(enabled.ofertaUniversal, off.ofertaUniversal);
  assert.deepEqual(enabled.destino, off.destino);
  assert.equal(enabled.categoria, off.categoria);
  assert.equal(enabled.status, off.status);
  assert.equal(enabled.motivo, off.motivo);
  assert.equal(enabled.intelligenceV1Shadow.metadata.category.affinities.length, 1);
});

test("falha da classificacao shadow permanece fail-open", () => {
  const result = classifyMulticategoryShadow({
    offer: null,
    identity: { confirmed: false },
    factualTitle: {},
    safety: {}
  });
  assert.equal(result.status, "pending");
  assert.equal(result.eligibilityAuthoritative, false);
});
