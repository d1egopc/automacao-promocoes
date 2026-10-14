"use strict";

const assert = require("assert");
const { importarProdutoMagaluEngine } = require("../modules/engine/importer/adapters/magalu.adapter");

const oneLink = "https://magazineluiza.onelink.me/589508454/c3qooxsv";
const urlIdentificada = "https://www.magazineluiza.com.br/potes-hermeticos-com-tampa-10un-bumper/p/123456789/ud/poud/";
const urlCanonicaWorkspace = "https://www.magazinevoce.com.br/magazined1egopc/potes-hermeticos/p/123456789/ud/poud/";

function linkRow(id, url) {
  return {
    id,
    url_original: url,
    url_normalizada: url,
    url_expandida: "",
    marketplace_detectado: "magalu",
    metadata: {}
  };
}

function baseDeps() {
  return {
    magaluParserOptions: { html: "<html></html>" },
    getIntegracaoCliente(clienteId, marketplace) {
      assert.strictEqual(clienteId, "workspace_magalu");
      assert.strictEqual(marketplace, "magalu");
      return { credenciais: { promoterId: "d1egopc" } };
    },
    resolverFatosMagalu: async () => ({
      ok: true,
      produtoId: "abc123",
      fonteUsada: "magazinevoce_magazine_promoter",
      fatos: {
        urlOriginal: "https://www.magazineluiza.com.br/smart-tv-50/p/abc123/et/elit/",
        urlCanonica: "https://www.magazinevoce.com.br/magazined1egopc/smart-tv-50/p/abc123/et/elit/",
        urlAfiliavelComprovada: "https://www.magazinevoce.com.br/magazined1egopc/smart-tv-50/p/abc123/et/elit/",
        magaluWorkspaceValidado: true,
        produtoId: "abc123",
        codigo: "abc123",
        titulo: "Smart TV Magalu 50",
        precoAtual: "R$ 1.999,90",
        imagem: "https://a-static.mlcdn.com.br/tv.jpg",
        categoria: "TV e Video",
        seller: "Magalu",
        avisos: [],
        metadata: { fontes: { urlCanonica: "canonical" } }
      },
      avisos: []
    })
  };
}

async function testarOneLinkAguardaEReutilizaIdentidadeLocal() {
  const evento = {
    cupom: "GARIMPEI1000",
    texto_original: `Bumper Potes Herméticos 10 Peças\nPor R$ 85,41\nCupom: GARIMPEI1000\n${oneLink}`,
    links_extraidos: [oneLink]
  };
  const links = [linkRow(92, oneLink)];
  const base = baseDeps();
  const pendente = await importarProdutoMagaluEngine({
    job: { id: 592, evento_id: 692, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento,
    links,
    deps: {
      ...base,
      obterIdentidadeMagaluLocalWorker: async () => null,
      garantirIdentidadeMagaluLocalWorker: async ({ sourceUrl }) => {
        assert.strictEqual(sourceUrl, oneLink);
        return { ok: true, task: { id: "identity-92", status: "pending", capability: "magalu_identity_v1" } };
      }
    }
  });
  assert.strictEqual(pendente.ok, false);
  assert.strictEqual(pendente.motivo, "sem_link_produto_confirmado");
  assert.strictEqual(pendente.motivoDetalhe, "aguardando_identidade_local");
  assert.strictEqual(pendente.retriavel, true);

  let taskDuplicada = false;
  const recuperada = await importarProdutoMagaluEngine({
    job: { id: 593, evento_id: 693, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento,
    links,
    deps: {
      ...base,
      obterIdentidadeMagaluLocalWorker: async ({ sourceUrl }) => ({
        capability: "magalu_identity_v1",
        identityKey: "url_0123456789abcdef0123456789abcdef",
        sourceUrl,
        observedProductId: "123456789",
        identidadeValidada: true,
        finalUrl: urlIdentificada,
        canonicalUrl: urlIdentificada,
        collectedAt: new Date().toISOString()
      }),
      garantirIdentidadeMagaluLocalWorker: async () => { taskDuplicada = true; },
      resolverFatosMagalu: async ({ urlOriginal }) => {
        assert.strictEqual(urlOriginal, urlIdentificada);
        return {
          ok: true,
          produtoId: "123456789",
          fonteUsada: "magazinevoce_magazine_promoter",
          fatos: {
            urlOriginal,
            urlCanonica: urlCanonicaWorkspace,
            urlAfiliavelComprovada: urlCanonicaWorkspace,
            magaluWorkspaceValidado: true,
            produtoId: "123456789",
            codigo: "123456789",
            titulo: "Título da página não autoritativo",
            precoAtual: "199,90",
            imagem: "https://a-static.mlcdn.com.br/320x320/123456789-worktask.jpg",
            categoria: "Utilidades Domésticas",
            seller: "Magalu",
            avisos: [],
            metadata: { fontes: { urlCanonica: "canonical" } }
          },
          avisos: []
        };
      }
    }
  });
  assert.strictEqual(recuperada.ok, true);
  assert.strictEqual(taskDuplicada, false);
  assert.strictEqual(recuperada.produtoId, "123456789");
  assert.strictEqual(recuperada.titulo, "Bumper Potes Herméticos 10 Peças");
  assert.strictEqual(recuperada.preco, 85.41);
  assert.strictEqual(recuperada.cupom, "GARIMPEI1000");
  assert.strictEqual(recuperada.metadata.campoLinkEscolhido, "local_worker_identity");
  assert.strictEqual(recuperada.metadata.identidadeLocalWorker.observedProductId, "123456789");
}

testarOneLinkAguardaEReutilizaIdentidadeLocal()
  .then(() => console.log("magalu-identity-engine-importer.test.js ok"))
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
