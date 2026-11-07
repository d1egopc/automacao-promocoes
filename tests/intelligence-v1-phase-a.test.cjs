const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CLASSIFICATION_STATUS,
  RESERVED_COMMERCIAL_CATEGORY,
  construirMetadataIntelligenceV1,
  avaliarIntelligenceV1Global,
  limparTituloFactual
} = require("../modules/inteligencia-universal/foundation-v1.service");
const { avaliarOfertaUniversal } = require("../modules/inteligencia-universal/oferta-universal.service");
const { categoriaExiste } = require("../marketplaces/inteligencia/categorias-globais");

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures", "intelligence-v1-phase-a.sanitized.json"),
  "utf8"
));

function comEnvIntelligence(env, callback) {
  const anteriorModo = process.env.OPTIMUS_INTELLIGENCE_V1_MODE;
  const anteriorDisabled = process.env.OPTIMUS_INTELLIGENCE_V1_DISABLED;
  try {
    if (env.mode === undefined) delete process.env.OPTIMUS_INTELLIGENCE_V1_MODE;
    else process.env.OPTIMUS_INTELLIGENCE_V1_MODE = env.mode;
    if (env.disabled === undefined) delete process.env.OPTIMUS_INTELLIGENCE_V1_DISABLED;
    else process.env.OPTIMUS_INTELLIGENCE_V1_DISABLED = env.disabled;
    return callback();
  } finally {
    if (anteriorModo === undefined) delete process.env.OPTIMUS_INTELLIGENCE_V1_MODE;
    else process.env.OPTIMUS_INTELLIGENCE_V1_MODE = anteriorModo;
    if (anteriorDisabled === undefined) delete process.env.OPTIMUS_INTELLIGENCE_V1_DISABLED;
    else process.env.OPTIMUS_INTELLIGENCE_V1_DISABLED = anteriorDisabled;
  }
}

test("fixtures obrigatorias produzem somente metadata aditiva e conservadora", () => {
  for (const item of fixture.cases) {
    const metadata = construirMetadataIntelligenceV1(item.offer);
    assert.equal(metadata.schemaVersion, "optimus-intelligence-v1-phase-a", item.id);
    assert.equal(metadata.classificationStatus, item.expected.classificationStatus, item.id);
    assert.equal(metadata.category.principal, item.expected.principal, item.id);
    assert.deepEqual(metadata.category.affinities, item.expected.affinities, item.id);
    assert.equal(metadata.safety.class, item.expected.safetyClass, item.id);
    assert.equal(metadata.eligibilityAuthoritative, false, item.id);
    assert.equal(metadata.commercialFieldsAuthoritative, false, item.id);
    if (item.expected.title) assert.equal(metadata.factualTitle.title, item.expected.title, item.id);
    if (item.expected.reservedCommercialCategory) {
      assert.equal(metadata.safety.reservedCommercialCategory, item.expected.reservedCommercialCategory, item.id);
    }
  }
});

test("slogan promocional nunca vira titulo factual e detalhes oficiais sao preservados", () => {
  assert.equal(limparTituloFactual("O Cara do Perfume trouxe pra você"), "");
  assert.equal(
    limparTituloFactual("O Cara do Perfume trouxe pra você - Perfume Dior Sauvage EDT 100ml"),
    "Perfume Dior Sauvage EDT 100ml"
  );
  const perfume = construirMetadataIntelligenceV1(fixture.cases.find(item => item.id === "perfume_slogan").offer);
  assert.equal(perfume.factualTitle.title, "Perfume Dior Sauvage Eau de Toilette 100ml");
  assert.match(perfume.factualTitle.title, /Dior Sauvage/);
  assert.match(perfume.factualTitle.title, /100ml/);
});

test("classificationStatus e safetyClass permanecem ortogonais", () => {
  const incerto = construirMetadataIntelligenceV1(fixture.cases.find(item => item.id === "common_uncertain").offer);
  assert.equal(incerto.classificationStatus, CLASSIFICATION_STATUS.UNCERTAIN);
  assert.equal(incerto.safety.class, "general");

  const adulto = construirMetadataIntelligenceV1(fixture.cases.find(item => item.id === "adult_product").offer);
  assert.equal(adulto.classificationStatus, CLASSIFICATION_STATUS.RESOLVED);
  assert.equal(adulto.safety.class, "adult");
  assert.equal(adulto.safety.adultDistributionAllowed, false);
  assert.equal(adulto.safety.reservedCommercialCategory, RESERVED_COMMERCIAL_CATEGORY);
  assert.equal(categoriaExiste(RESERVED_COMMERCIAL_CATEGORY), false, "categoria +18 continua reservada fora do catalogo");
  assert.equal(adulto.category.affinities.includes(RESERVED_COMMERCIAL_CATEGORY), false);
});

test("identidade ou SKU divergentes falham fechados sem inventar titulo", () => {
  const metadata = construirMetadataIntelligenceV1(fixture.cases.find(item => item.id === "identity_divergent").offer);
  assert.equal(metadata.identity.divergent, true);
  assert.equal(metadata.identity.confirmed, false);
  assert.equal(metadata.identity.identityKey, null);
  assert.equal(metadata.factualTitle.title, null);
  assert.equal(metadata.classificationStatus, "rejected");
});

test("metadata nao guarda preco, cupom, links, afiliacao, tokens ou workspace", () => {
  const oferta = {
    ...fixture.cases[0].offer,
    clienteId: "workspace_a",
    preco: 199.9,
    cupom: "SEGREDO10",
    linkAfiliado: "https://afiliado.invalid/produto?token=secreto",
    metadata: {
      ...fixture.cases[0].offer.metadata,
      afiliacaoWorkspace: { trackingId: "privado", token: "secreto" }
    }
  };
  const metadata = construirMetadataIntelligenceV1(oferta);
  const serializado = JSON.stringify(metadata);
  for (const proibido of ["199.9", "SEGREDO10", "afiliado.invalid", "secreto", "privado", "workspace_a"]) {
    assert.equal(serializado.includes(proibido), false, proibido);
  }
});

test("modo global padrao OFF, shadow passivo e desligamento global prevalece", () => {
  const oferta = fixture.cases[0].offer;
  assert.deepEqual(
    avaliarIntelligenceV1Global(oferta, { env: {} }),
    { mode: "off", applied: false, metadata: null }
  );
  const shadow = avaliarIntelligenceV1Global(oferta, {
    env: { OPTIMUS_INTELLIGENCE_V1_MODE: "shadow" }
  });
  assert.equal(shadow.mode, "shadow");
  assert.equal(shadow.applied, true);
  assert.equal(shadow.metadata.eligibilityAuthoritative, false);
  assert.deepEqual(
    avaliarIntelligenceV1Global(oferta, {
      env: { OPTIMUS_INTELLIGENCE_V1_MODE: "shadow", OPTIMUS_INTELLIGENCE_V1_DISABLED: "1" }
    }),
    { mode: "off", applied: false, metadata: null }
  );
});

test("falha do shadow permanece fail-open", () => {
  const oferta = {};
  Object.defineProperty(oferta, "metadata", {
    get() { throw new Error("fixture_controlada"); }
  });
  const resultado = avaliarIntelligenceV1Global(oferta, {
    env: { OPTIMUS_INTELLIGENCE_V1_MODE: "shadow" }
  });
  assert.equal(resultado.mode, "shadow");
  assert.equal(resultado.applied, false);
  assert.equal(resultado.error, "intelligence_v1_shadow_unavailable");
});

test("shadow nao altera decisao, destino nem fatos comerciais dos seis marketplaces", () => {
  const marketplaces = ["mercadolivre", "shopee", "amazon", "aliexpress", "magalu", "kabum"];
  for (const [indice, marketplace] of marketplaces.entries()) {
    const oferta = {
      clienteId: "workspace_fixture",
      marketplace,
      titulo: "Mouse Gamer Modelo X 16000 DPI",
      tituloOficial: "Mouse Gamer Modelo X 16000 DPI",
      productId: `produto-${indice + 1}`,
      identityConfirmed: true,
      identitySource: "api_oficial",
      categoria: "Periféricos",
      precoAtual: 149.9,
      precoOriginal: 199.9,
      cupom: "MOUSE10",
      linkOriginal: `https://produto.invalid/${marketplace}/produto-${indice + 1}`,
      linkAfiliado: `https://afiliado.invalid/${marketplace}/produto-${indice + 1}`,
      imagem: `https://imagem.invalid/${marketplace}.jpg`,
      metadata: { produto: { produtoId: `produto-${indice + 1}`, tituloOficial: "Mouse Gamer Modelo X 16000 DPI" } }
    };
    const contexto = {
      clienteId: "workspace_fixture",
      origem: "engine_importer",
      exigirLinkAfiliado: true,
      memoriaAnteriores: [],
      destinos: [{ id: "destino_1", ativo: true, marketplaces: [marketplace], categorias: ["Periféricos"] }]
    };
    const desligado = comEnvIntelligence({ mode: undefined, disabled: undefined }, () => avaliarOfertaUniversal(oferta, contexto));
    const shadow = comEnvIntelligence({ mode: "shadow", disabled: undefined }, () => avaliarOfertaUniversal(oferta, contexto));

    assert.equal(desligado.intelligenceV1Shadow, undefined, marketplace);
    assert.equal(shadow.intelligenceV1Shadow.mode, "shadow", marketplace);
    assert.equal(shadow.intelligenceV1Shadow.metadata.eligibilityAuthoritative, false, marketplace);
    assert.deepEqual(shadow.ofertaUniversal, desligado.ofertaUniversal, marketplace);
    assert.deepEqual(shadow.templateInput, desligado.templateInput, marketplace);
    assert.deepEqual(shadow.destino, desligado.destino, marketplace);
    assert.equal(shadow.ok, desligado.ok, marketplace);
    assert.equal(shadow.status, desligado.status, marketplace);
    assert.equal(shadow.motivo, desligado.motivo, marketplace);
    assert.equal(shadow.categoria, desligado.categoria, marketplace);
  }
});

test("fundacao e stateless, sem canario por workspace e sem dependencia da extensao", () => {
  const base = fixture.cases.find(item => item.id === "split_air_conditioner").offer;
  const workspaceA = construirMetadataIntelligenceV1({ ...base, clienteId: "workspace_a" });
  const workspaceB = construirMetadataIntelligenceV1({ ...base, clienteId: "workspace_b" });
  assert.deepEqual(workspaceA, workspaceB);
  assert.equal(workspaceA.factualTitle.source, "api_feed_oficial");
  assert.equal(workspaceA.identity.confirmed, true);
});
