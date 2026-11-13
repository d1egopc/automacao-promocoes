"use strict";

const assert = require("assert");
const { importarProdutoMagaluEngine } = require("../modules/engine/importer/adapters/magalu.adapter");
const { normalizarOfertaImportada } = require("../modules/engine/importer/importer.service");

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

async function testarTituloOneLinkAncoraNaOcorrenciaCapturada() {
  const titulo = "Smart TV Samsung 50 polegadas 4K UHD";
  const job = { id: 595, evento_id: 695, cliente_id: "workspace_magalu", marketplace: "magalu" };
  const resultado = await importarProdutoMagaluEngine({
    job,
    evento: { texto_original: "O clássico que combina com qualquer look\nPor R$ 85,41\n" + oneLink, links_extraidos: [oneLink] },
    links: [linkRow(95, oneLink)],
    deps: {
      ...baseDeps(),
      obterIdentidadeMagaluLocalWorker: async ({ sourceUrl }) => ({
        sourceUrl, capability: "magalu_identity_v1", observedProductId: "123456789",
        identidadeValidada: true, canonicalUrl: urlTituloFixture
      }),
      garantirIdentidadeMagaluLocalWorker: async () => assert.fail("identidade em cache"),
      resolverFatosMagalu: async () => resolucaoOficialTitulo({ titulo })
    }
  });
  assert.strictEqual(resultado.ok, true, resultado.motivo);
  const normalizada = normalizarOfertaImportada(resultado, job);
  const prova = normalizada.metadata.provaTituloTecnicoValidada;
  assert.strictEqual(prova?.titulo.valor, titulo);
  assert.strictEqual(prova?.ocorrenciaLink.urlOriginal, oneLink);
  assert.strictEqual(prova?.ocorrenciaLink.id, "95");
  assert.strictEqual(normalizada.linkAfiliado, urlTituloWorkspaceFixture);
}

async function testarIdentidadeSemImagemAindaBloqueiaPublicacao() {
  let identidadeConsultada = false;
  let tarefaIdentidadeCriada = false;
  let productIdTarefaImagem = "";
  let resolverChamado = false;
  const evento = {
    cupom: "GARIMPEI1000",
    texto_original: `Bumper Potes Herméticos 10 Peças\nPor R$ 85,41\nCupom: GARIMPEI1000\n${oneLink}`,
    links_extraidos: [oneLink]
  };
  const result = await importarProdutoMagaluEngine({
    job: { id: 594, evento_id: 694, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento,
    links: [linkRow(94, oneLink)],
    deps: {
      ...baseDeps(),
      obterIdentidadeMagaluLocalWorker: async ({ sourceUrl }) => {
        assert.strictEqual(sourceUrl, oneLink);
        identidadeConsultada = true;
        return {
          capability: "magalu_identity_v1",
          identityKey: "url_0123456789abcdef0123456789abcdef",
          sourceUrl,
          observedProductId: "123456789",
          identidadeValidada: true,
          finalUrl: urlIdentificada,
          canonicalUrl: urlIdentificada,
          collectedAt: new Date().toISOString()
        };
      },
      garantirIdentidadeMagaluLocalWorker: async () => { tarefaIdentidadeCriada = true; },
      obterImagemCacheLocalWorker: async () => null,
      obterTaskImagemMagaluLocalWorker: async ({ productId }) => {
        productIdTarefaImagem = productId;
        return { ok: true, task: { id: "image-94", status: "pending", capability: "magalu_image_v1" } };
      },
      resolverFatosMagalu: async () => { resolverChamado = true; throw new Error("must_wait_for_official_image"); }
    }
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(identidadeConsultada, true);
  assert.strictEqual(tarefaIdentidadeCriada, false);
  assert.strictEqual(productIdTarefaImagem, "123456789");
  assert.strictEqual(resolverChamado, false);
  assert.strictEqual(result.motivo, "sem_imagem", JSON.stringify(result));
  assert.strictEqual(result.retriavel, true);
}

const urlTituloFixture = "https://www.magazineluiza.com.br/smart-tv-samsung-50/p/123456789/et/elit/";
const urlTituloWorkspaceFixture = "https://www.magazinevoce.com.br/magazined1egopc/smart-tv-samsung-50/p/123456789/et/elit/";

function resolucaoOficialTitulo({
  productId = "123456789",
  canonicalProductId = productId,
  titulo = "Smart TV Samsung 50 polegadas",
  tituloFonte = "jsonld.name",
  identidadeAceita = true
} = {}) {
  const canonicalUrl = `https://www.magazinevoce.com.br/magazined1egopc/smart-tv-samsung-50/p/${canonicalProductId}/et/elit/`;
  return {
    ok: identidadeAceita,
    produtoId: productId,
    fonteUsada: "magazinevoce_magazine_promoter",
    tentativas: [{
      fonte: "magazinevoce_magazine_promoter",
      statusFactual: identidadeAceita ? "aceita" : "rejeitada",
      canonicalValida: identidadeAceita && canonicalProductId === productId,
      productIdObservado: productId,
      canonicalOrigem: "canonical"
    }],
    fatos: {
      urlOriginal: urlTituloFixture,
      urlCanonica: canonicalUrl,
      urlAfiliavelComprovada: canonicalUrl,
      magaluWorkspaceValidado: true,
      produtoId: productId,
      codigo: productId,
      titulo,
      precoAtual: "85,41",
      imagem: "https://a-static.mlcdn.com.br/320x320/123456789-worktask.jpg",
      categoria: "Utilidades Domésticas",
      seller: "Magalu",
      avisos: [],
      metadata: { fontes: { urlCanonica: "canonical", titulo: tituloFonte } }
    },
    avisos: []
  };
}

async function importarComTitulo({ tituloRadar = "", resolucao = resolucaoOficialTitulo() } = {}) {
  const textoRadar = [tituloRadar, "DE R$ 99,90 | POR R$ 85,41", "Cupom: GARIMPEI1000", urlTituloFixture]
    .filter(Boolean)
    .join("\n");
  return importarProdutoMagaluEngine({
    job: { id: 594, evento_id: 694, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: { titulo: tituloRadar, texto_original: textoRadar, precoAnterior: "99,90", precoAtual: "85,41", cupom: "GARIMPEI1000", links_extraidos: [urlTituloFixture] },
    links: [{ ...linkRow(93, urlTituloFixture), url_expandida: urlTituloFixture, url_normalizada: urlTituloFixture }],
    deps: {
      ...baseDeps(),
      resolverFatosMagalu: async ({ urlOriginal }) => ({
        ...resolucao,
        fatos: { ...(resolucao.fatos || {}), urlOriginal }
      })
    }
  });
}

async function testarPreservaTituloRadarSeguro() {
  const resultado = await importarComTitulo({ tituloRadar: "Smart TV Samsung 50 polegadas" });
  assert.strictEqual(resultado.ok, true, JSON.stringify(resultado));
  assert.strictEqual(resultado.titulo, "Smart TV Samsung 50 polegadas");
}

async function testarSloganRadarUsaTituloOficialDoMesmoProduto() {
  const tituloOficial = "Smart TV Samsung 50 polegadas 4K UHD";
  const resultado = await importarComTitulo({
    tituloRadar: "PRA QUEM NÃO NEGOCIA A EVOLUÇÃO DIÁRIA",
    resolucao: resolucaoOficialTitulo({ titulo: tituloOficial })
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.titulo, tituloOficial);
  assert.strictEqual(resultado.preco, 85.41);
  assert.strictEqual(resultado.precoOriginal, "99,90");
  assert.strictEqual(resultado.cupom, "GARIMPEI1000");
  assert.strictEqual(resultado.linkAfiliado, urlTituloWorkspaceFixture);
  assert.strictEqual(resultado.linkExpandido, urlTituloWorkspaceFixture);
  assert.strictEqual(resultado.linkOriginal, urlTituloFixture);
  assert.strictEqual(resultado.metadata.linksComerciais[0].urlOriginal, urlTituloFixture);
  const normalizada = normalizarOfertaImportada(resultado, { id: 594, evento_id: 694, cliente_id: "workspace_magalu" });
  assert.strictEqual(normalizada.metadata.provaTituloTecnicoValidada?.titulo.valor, tituloOficial);
  assert.strictEqual(normalizada.metadata.provaTituloTecnicoValidada?.ocorrenciaLink.id, "93");
}

async function testarSemTituloRadarUsaTituloOficialDoMesmoProduto() {
  const resultado = await importarComTitulo({
    resolucao: resolucaoOficialTitulo({ titulo: "Smart TV Samsung 50 polegadas 4K UHD" })
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.titulo, "Smart TV Samsung 50 polegadas 4K UHD");
}

async function testarRejeitaTituloOficialComProductIdDivergente() {
  const resultado = await importarComTitulo({
    tituloRadar: "Menor preço que já vimos nos últimos 60 dias",
    resolucao: resolucaoOficialTitulo({ productId: "999999999", canonicalProductId: "999999999" })
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "titulo_indisponivel");
}

async function testarIdentidadeNaoConfirmadaNaoLiberaTituloOficial() {
  const resultado = await importarComTitulo({
    tituloRadar: "Menor preço que já vimos nos últimos 60 dias",
    resolucao: resolucaoOficialTitulo({ identidadeAceita: false })
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "titulo_indisponivel");
}

async function testarSemTituloConfiavelRetemOferta() {
  const resultado = await importarComTitulo({
    tituloRadar: "Grupo de ofertas Gerais",
    resolucao: resolucaoOficialTitulo({ titulo: "Produto Magalu" })
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "titulo_indisponivel");
}

async function testarTituloOficialSemProvenienciaRetemOferta() {
  const resultado = await importarComTitulo({
    tituloRadar: "Aproveita e convida os amigos pro grupo enviando o link abaixo:",
    resolucao: resolucaoOficialTitulo({
      titulo: "Smart TV Samsung 50 polegadas 4K UHD",
      tituloFonte: "texto_nao_confiavel"
    })
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "titulo_indisponivel");
}

testarOneLinkAguardaEReutilizaIdentidadeLocal()
  .then(testarTituloOneLinkAncoraNaOcorrenciaCapturada)
  .then(testarIdentidadeSemImagemAindaBloqueiaPublicacao)
  .then(testarPreservaTituloRadarSeguro)
  .then(testarSloganRadarUsaTituloOficialDoMesmoProduto)
  .then(testarSemTituloRadarUsaTituloOficialDoMesmoProduto)
  .then(testarRejeitaTituloOficialComProductIdDivergente)
  .then(testarIdentidadeNaoConfirmadaNaoLiberaTituloOficial)
  .then(testarSemTituloConfiavelRetemOferta)
  .then(testarTituloOficialSemProvenienciaRetemOferta)
  .then(() => console.log("magalu-identity-engine-importer.test.js ok"))
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
