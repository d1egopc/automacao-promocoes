const assert = require("assert");

const {
  montarItemFilaEngine,
  resolverImagemFilaEngine
} = require("../modules/engine/distributor/distributor.service");

function ofertaBase(extras = {}) {
  return {
    id: extras.id || 101,
    uuid: extras.uuid || "oferta-101",
    job_id: extras.job_id || 201,
    cliente_id: extras.cliente_id || "cliente_a",
    marketplace: "amazon",
    titulo: extras.titulo || "Oferta teste",
    preco: 99.9,
    link_original: "https://loja.test/produto",
    link_afiliado: "https://go.test/produto",
    categoria: "geral",
    score: 80,
    ...extras
  };
}

function testarImagemPrincipal() {
  const item = montarItemFilaEngine(ofertaBase({
    imagem: "https://cdn.test/principal.jpg"
  }));

  assert.strictEqual(item.imagem, "https://cdn.test/principal.jpg");
  assert.strictEqual(item.imagemOrigem, "engine_ofertas.imagem");
  assert.strictEqual(item.imagemFallbackUsado, false);
  assert.strictEqual(item.imagemAusenteMotivo, "");
}

function testarFallbackAlternativo() {
  const item = montarItemFilaEngine(ofertaBase({
    imagem: "",
    metadata: {
      produto: {
        images: [
          "",
          { url: "https://cdn.test/alternativa.jpg" }
        ]
      }
    }
  }));

  assert.strictEqual(item.imagem, "https://cdn.test/alternativa.jpg");
  assert.strictEqual(item.imagemOrigem, "metadata.produto.images");
  assert.strictEqual(item.imagemFallbackUsado, true);
}

function testarFallbackRadar() {
  const resolucao = resolverImagemFilaEngine(ofertaBase({
    imagem: "",
    metadata: {},
    evento_metadata: {
      imagemRadar: "https://radar.test/original.jpg"
    }
  }));

  assert.strictEqual(resolucao.imagem, "https://radar.test/original.jpg");
  assert.strictEqual(resolucao.origem, "evento.metadata.imagemRadar");
  assert.strictEqual(resolucao.fallbackUsado, true);
}

function testarAusenciaReal() {
  const item = montarItemFilaEngine(ofertaBase({
    imagem: "",
    metadata: {},
    evento_metadata: {},
    job_metadata: {}
  }));

  assert.strictEqual(item.imagem, "");
  assert.strictEqual(item.imagemOrigem, "nenhuma");
  assert.strictEqual(item.imagemFallbackUsado, false);
  assert.strictEqual(item.imagemAusenteMotivo, "nenhuma_fonte_de_imagem");
}

function testarIsolamentoPorCliente() {
  const ofertaClienteA = ofertaBase({
    id: 301,
    cliente_id: "cliente_a",
    imagem: "",
    job_metadata: {
      imagemRadar: "https://cliente-a.test/imagem.jpg"
    }
  });
  const ofertaClienteB = ofertaBase({
    id: 302,
    cliente_id: "cliente_b",
    imagem: "",
    job_metadata: {
      imagemRadar: "https://cliente-b.test/imagem.jpg"
    }
  });

  const itemA = montarItemFilaEngine(ofertaClienteA);
  const itemB = montarItemFilaEngine(ofertaClienteB);

  assert.strictEqual(itemA.clienteId, "cliente_a");
  assert.strictEqual(itemB.clienteId, "cliente_b");
  assert.strictEqual(itemA.imagem, "https://cliente-a.test/imagem.jpg");
  assert.strictEqual(itemB.imagem, "https://cliente-b.test/imagem.jpg");
}

function testarFallbackMercadoLivrePictures() {
  const item = montarItemFilaEngine(ofertaBase({
    id: "ml-pictures",
    marketplace: "mercadolivre",
    imagem: "",
    metadata: {
      produto: {
        pictures: [{ secure_url: "https://cdn.test/ml-picture-secure.jpg" }]
      }
    }
  }));

  assert.strictEqual(item.imagem, "https://cdn.test/ml-picture-secure.jpg");
  assert.strictEqual(item.imagemOrigem, "metadata.produto.pictures[0].secure_url");
  assert.strictEqual(item.imagemFallbackUsado, true);
}

function testarImagemPrincipalPreservadaComThumbnailMl() {
  const item = montarItemFilaEngine(ofertaBase({
    id: "ml-principal",
    marketplace: "mercadolivre",
    imagem: "https://cdn.test/ml-principal.jpg",
    metadata: { produto: { thumbnail: "https://cdn.test/ml-thumb.jpg" } }
  }));

  assert.strictEqual(item.imagem, "https://cdn.test/ml-principal.jpg");
  assert.strictEqual(item.imagemOrigem, "engine_ofertas.imagem");
  assert.strictEqual(item.imagemFallbackUsado, false);
}

testarImagemPrincipal();
testarFallbackAlternativo();
testarFallbackMercadoLivrePictures();
testarImagemPrincipalPreservadaComThumbnailMl();
testarFallbackRadar();
testarAusenciaReal();
testarIsolamentoPorCliente();

console.log("engine-imagem-fallback.test.js ok");
