"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { importarProdutoMagaluEngine } = require("../modules/engine/importer/adapters/magalu.adapter");
const {
  PROOF_TYPE_PAGE_VALIDATED,
  PROOF_TYPE_DETERMINISTIC_WORKSPACE,
  criarProvaAfiliacaoWorkspaceMagalu,
  validarProvaAfiliacaoWorkspaceMagalu,
  validarOfertaAfiliacaoWorkspaceMagalu
} = require("../modules/marketplaces/magalu/afiliacao-workspace");
const {
  construirUrlDeterministicaWorkspaceMagalu
} = require("../modules/marketplaces/magalu/magalu-affiliate-link");
const { resolverFatosMagalu } = require("../modules/marketplaces/magalu/magalu-factual-resolver");
const { parseMagaluProdutoHtml } = require("../modules/marketplaces/magalu/magalu-parser");

process.env.JWT_SECRET = process.env.JWT_SECRET || "magalu-v2-test-secret";

const loja = "magazined1egopc";
const casos = [
  { id: "240466000", categoria: "te/ga07", seller: "magazineluiza" },
  { id: "ke8kag6fce", categoria: "mo/guro", seller: "modernamobilia2" },
  { id: "235613900", categoria: "ed/mond", seller: "magazineluiza", divulgador: true },
  { id: "240429300", categoria: "in/nota", seller: "magazineluiza" }
];

function urlOriginal(caso) {
  const caminho = caso.divulgador ? "divulgador/oferta" : "p";
  return `https://www.magazineluiza.com.br/produto-${caso.id}/${caminho}/${caso.id}/${caso.categoria}/?seller_id=${caso.seller}`;
}

function urlWorkspace(caso) {
  return `https://www.magazinevoce.com.br/${loja}/produto-${caso.id}/p/${caso.id}/${caso.categoria}/?seller_id=${caso.seller}`;
}

function fatosWorkspace(caso) {
  return {
    ok: true,
    produtoId: caso.id,
    sellerIdOriginal: caso.seller,
    fonteUsada: "magazinevoce_magazine_promoter",
    fatos: {
      produtoId: caso.id,
      codigo: caso.id,
      seller: caso.seller,
      titulo: `Titulo tecnico ${caso.id}`,
      precoAtual: "999.99",
      precoAnterior: "1299.99",
      cupom: "PAGINA20",
      urlOriginal: urlOriginal(caso),
      urlCanonica: urlWorkspace(caso),
      urlAfiliavelComprovada: urlWorkspace(caso),
      magaluWorkspaceValidado: true,
      imagem: `https://a-static.mlcdn.com.br/800x560/produto-${caso.id}.jpg`,
      categoria: "Categoria tecnica",
      metadata: {
        fontes: { urlCanonica: "canonical" },
        imagemOficial: { dimensoes: { largura: 800, altura: 560 } }
      },
      avisos: []
    },
    avisos: []
  };
}

async function importar(caso, extras = {}) {
  const original = extras.urlOriginal || urlOriginal(caso);
  return importarProdutoMagaluEngine({
    job: { id: `job-${caso.id}`, evento_id: `evento-${caso.id}`, cliente_id: "workspace-magalu", marketplace: "magalu" },
    evento: {
      titulo: `Oferta Radar ${caso.id}`,
      precoAtual: "1999.90",
      precoAnterior: "2499.90",
      cupom: "RADAR10",
      texto_original: `Oferta Radar ${caso.id}\nPor R$ 1.999,90\n${original}`,
      links_extraidos: [original],
      ...extras.evento
    },
    links: extras.links || [{ url_original: original, url_normalizada: original, marketplace_detectado: "magalu" }],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { promoterId: "d1egopc" } }),
      resolverFatosMagalu: async () => extras.resolucao || fatosWorkspace(caso)
    }
  });
}

async function testarSkusAprovados() {
  for (const caso of casos) {
    const resultado = await importar(caso);
    assert.strictEqual(resultado.ok, true, caso.id);
    assert.strictEqual(resultado.produtoId, caso.id);
    assert.strictEqual(resultado.linkAfiliado, urlWorkspace(caso));
    assert.strictEqual(resultado.metadata.afiliacaoWorkspace.conversaoStatus, "convertida");
    assert.strictEqual(resultado.metadata.afiliacaoWorkspace.proofType, PROOF_TYPE_PAGE_VALIDATED);
    assert.strictEqual(resultado.metadata.afiliacaoWorkspace.paginaValidada, true);
    assert.strictEqual(resultado.metadata.afiliacaoWorkspace.papelLink, "produto");
    assert.strictEqual(resultado.imagemEnviavel, true);
    assert.strictEqual(resultado.imagemOriginalOficial, `https://a-static.mlcdn.com.br/800x560/produto-${caso.id}.jpg`);
    assert.deepStrictEqual(resultado.dimensoesImagem, { largura: 800, altura: 560 });
  }
}

async function testar404BloqueiaSemPromoverOriginal() {
  const caso = { id: "240144700", categoria: "et/elit", seller: "magazineluiza" };
  const resultado = await importar(caso, {
    resolucao: { ok: false, motivo: "magalu_pagina_indisponivel", fatos: {}, avisos: ["magalu_pagina_indisponivel"] }
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
  assert.strictEqual(resultado.linkAfiliado, undefined);
}

async function testar403SemImagemTerminaSemImagem() {
  const caso = casos[0];
  const resultado = await importar(caso, {
    resolucao: { ok: false, motivo: "magalu_http_403", fatos: {}, avisos: ["magalu_http_403"] }
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "sem_imagem");
  assert.strictEqual(resultado.linkAfiliado, undefined);
  assert.strictEqual(resultado.imagemEnviavel, false);
  assert.strictEqual(resultado.metadata.afiliacaoWorkspace.proofType, PROOF_TYPE_DETERMINISTIC_WORKSPACE);
  assert.strictEqual(resultado.metadata.afiliacaoWorkspace.paginaValidada, false);
  assert.ok(!resultado.metadata.afiliacaoWorkspace.urlAfiliadaWorkspace.includes("promoter_id="));
}

async function testarCaptchaPermiteProvaDeterministicaComImagemOficial() {
  const caso = casos[0];
  const imagem = `https://a-static.mlcdn.com.br/320x240/produto-${caso.id}.jpg`;
  const resultado = await importar(caso, {
    resolucao: {
      ok: false,
      motivo: "magalu_captcha_detectado",
      fatos: {
        produtoId: caso.id,
        codigo: caso.id,
        imagem,
        metadata: { imagemOficial: { dimensoes: { largura: 320, altura: 240 } } },
        avisos: ["magalu_captcha_detectado"]
      },
      avisos: ["magalu_captcha_detectado"]
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.imagem, imagem);
  assert.strictEqual(resultado.imagemEnviavel, true);
  assert.strictEqual(resultado.metadata.afiliacaoWorkspace.proofType, PROOF_TYPE_DETERMINISTIC_WORKSPACE);
  assert.strictEqual(resultado.metadata.afiliacaoWorkspace.paginaValidada, false);
  assert.strictEqual(resultado.metadata.afiliacaoWorkspace.origemConversao, "workspace_magazinevoce_deterministic");
  assert.ok(resultado.linkAfiliado.startsWith("https://www.magazinevoce.com.br/d1egopc/"));
  assert.ok(!resultado.linkAfiliado.includes("promoter_id="));
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceMagalu(resultado, {
    clienteId: "workspace-magalu",
    promoterId: "d1egopc"
  }).ok, true);
}

function criarProvaDeterministicaParaAlias(caso, aliasLoja) {
  const original = urlOriginal(caso);
  const construida = construirUrlDeterministicaWorkspaceMagalu(original, "d1egopc", aliasLoja);
  return criarProvaAfiliacaoWorkspaceMagalu({
    clienteId: "workspace-magalu",
    promoterId: "d1egopc",
    productId: caso.id,
    seller: caso.seller,
    urlOriginal: original,
    urlAfiliadaWorkspace: construida.url,
    paginaValidada: false,
    proofType: PROOF_TYPE_DETERMINISTIC_WORKSPACE,
    papelLink: "produto",
    urlConstruidaPor: "magalu_deterministic_builder_v1"
  });
}

function testarAliasesDeterministicosEIsolamentoDaProva() {
  const caso = casos[0];
  for (const alias of ["d1egopc", "magazined1egopc"]) {
    const prova = criarProvaDeterministicaParaAlias(caso, alias);
    assert.strictEqual(prova.conversaoStatus, "convertida", alias);
    assert.strictEqual(prova.aliasLoja, alias);
    assert.strictEqual(validarProvaAfiliacaoWorkspaceMagalu(prova, {
      clienteId: "workspace-magalu",
      promoterId: "d1egopc",
      papelLink: "produto"
    }).valida, true);
  }

  const prova = criarProvaDeterministicaParaAlias(caso, "d1egopc");
  const urlOutroAlias = prova.urlAfiliadaWorkspace.replace("/d1egopc/", "/magazined1egopc/");
  assert.strictEqual(validarProvaAfiliacaoWorkspaceMagalu({ ...prova, urlAfiliadaWorkspace: urlOutroAlias }, {
    clienteId: "workspace-magalu",
    promoterId: "d1egopc",
    papelLink: "produto"
  }).valida, false, "HMAC de uma URL nao pode validar outra");
  assert.strictEqual(validarProvaAfiliacaoWorkspaceMagalu({ ...prova, proofType: PROOF_TYPE_PAGE_VALIDATED }, {
    clienteId: "workspace-magalu",
    promoterId: "d1egopc",
    papelLink: "produto"
  }).valida, false, "proofType nao pode ser reinterpretado");
  assert.strictEqual(validarProvaAfiliacaoWorkspaceMagalu({ ...prova, productId: "outro-produto" }, {
    clienteId: "workspace-magalu",
    promoterId: "d1egopc",
    papelLink: "produto"
  }).valida, false);

  const estrangeira = prova.urlAfiliadaWorkspace.replace("/d1egopc/", "/outraloja/");
  const provaEstrangeira = criarProvaAfiliacaoWorkspaceMagalu({
    clienteId: "workspace-magalu",
    promoterId: "d1egopc",
    productId: caso.id,
    urlOriginal: urlOriginal(caso),
    urlAfiliadaWorkspace: estrangeira,
    paginaValidada: false,
    proofType: PROOF_TYPE_DETERMINISTIC_WORKSPACE,
    papelLink: "produto",
    urlConstruidaPor: "magalu_deterministic_builder_v1"
  });
  assert.strictEqual(provaEstrangeira.conversaoStatus, "falhou");
  assert.strictEqual(provaEstrangeira.urlAfiliadaWorkspace, "");

  const comTrackingEstrangeiro = criarProvaAfiliacaoWorkspaceMagalu({
    clienteId: "workspace-magalu",
    promoterId: "d1egopc",
    productId: caso.id,
    urlOriginal: urlOriginal(caso),
    urlAfiliadaWorkspace: `${prova.urlAfiliadaWorkspace}?promoter_id=5438968&partner_id=3440`,
    paginaValidada: false,
    proofType: PROOF_TYPE_DETERMINISTIC_WORKSPACE,
    papelLink: "produto",
    urlConstruidaPor: "magalu_deterministic_builder_v1"
  });
  assert.strictEqual(comTrackingEstrangeiro.conversaoStatus, "falhou");
}

async function testarOrigemEstrangeiraNuncaEhEnviada() {
  const caso = casos[0];
  const estrangeira = urlWorkspace(caso).replace(`/${loja}/`, "/outraloja/");
  const resultado = await importar(caso, {
    urlOriginal: estrangeira,
    evento: { links_extraidos: [estrangeira] },
    resolucao: {
      ok: false,
      motivo: "magalu_captcha_detectado",
      fatos: { avisos: ["magalu_link_loja_divergente", "magalu_captcha_detectado"] },
      avisos: ["magalu_link_loja_divergente", "magalu_captcha_detectado"]
    }
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "identidade_produto_insegura");
  assert.ok(!JSON.stringify(resultado).includes('"linkAfiliado":"' + estrangeira));

  const tentativaDireta = construirUrlDeterministicaWorkspaceMagalu(estrangeira, "d1egopc", "d1egopc");
  assert.strictEqual(tentativaDireta.url, "", "origem Magazine Voce estrangeira nao pode alimentar o builder deterministico");
}

async function testarMidiaNaoOficialNuncaPublica() {
  const caso = casos[0];
  for (const imagem of [
    "https://mmg.whatsapp.net/imagem.jpg",
    "https://api.telegram.org/file/imagem.jpg",
    "https://cdn.terceiro.example/imagem.jpg"
  ]) {
    const resultado = await importar(caso, {
      resolucao: {
        ...fatosWorkspace(caso),
        fatos: { ...fatosWorkspace(caso).fatos, imagem }
      }
    });
    assert.strictEqual(resultado.ok, false, imagem);
    assert.strictEqual(resultado.motivo, "sem_imagem", imagem);
    assert.strictEqual(resultado.imagemEnviavel, false, imagem);
  }
}

async function testarProvaAdulteradaBloqueia() {
  const resultado = await importar(casos[0]);
  const adulterada = { ...resultado.metadata.afiliacaoWorkspace, productId: "240144700" };
  const validacao = validarProvaAfiliacaoWorkspaceMagalu(adulterada, {
    clienteId: "workspace-magalu",
    promoterId: "d1egopc"
  });
  assert.strictEqual(validacao.valida, false);
}

async function testarRadarComercialPermaneceIntacto() {
  const resultado = await importar(casos[0]);
  assert.strictEqual(resultado.titulo, "Oferta Radar 240466000");
  assert.strictEqual(resultado.precoAtual, 1999.9);
  assert.strictEqual(resultado.precoOriginal, "2499.90");
  assert.strictEqual(resultado.cupom, "RADAR10");
  assert.strictEqual(resultado.precoOrigem, "texto_radar");
}

function testarMaiorImagemRealNoHtml() {
  const url = "https://www.magazinevoce.com.br/magazined1egopc/produto/p/240466000/te/ga07/";
  const html = `
    <link rel="canonical" href="${url}">
    <meta property="og:image" content="https://a-static.mlcdn.com.br/470x352/og.jpg">
    <script type="application/ld+json">{"@type":"Product","sku":"240466000","name":"Produto","image":"https://a-static.mlcdn.com.br/800x560/galeria.jpg"}</script>`;
  const produto = parseMagaluProdutoHtml({ urlOriginal: url, urlFinal: url, html });
  assert.strictEqual(produto.imagem, "https://a-static.mlcdn.com.br/800x560/galeria.jpg");
  assert.deepStrictEqual(produto.metadata.imagemOficial.dimensoes, { largura: 800, altura: 560 });

  const apenas320 = parseMagaluProdutoHtml({
    urlOriginal: url,
    urlFinal: url,
    html: `<link rel="canonical" href="${url}"><meta property="og:image" content="https://a-static.mlcdn.com.br/320x240/oficial.jpg">`
  });
  assert.strictEqual(apenas320.imagem, "https://a-static.mlcdn.com.br/320x240/oficial.jpg");
}

async function testarResolverExigePaginaWorkspaceCanonica() {
  const caso = casos[0];
  const original = urlOriginal(caso);
  const esperado = urlWorkspace(caso);
  const aprovado = await resolverFatosMagalu({ urlOriginal: original, promoterId: "d1egopc" }, {
    cacheFactual: false,
    consultarProdutoMagalu: async url => ({
      ...fatosWorkspace(caso).fatos,
      urlOriginal: url,
      urlCanonica: esperado,
      metadata: { fontes: { urlCanonica: "canonical" } }
    })
  });
  assert.strictEqual(aprovado.ok, true);
  assert.strictEqual(aprovado.fonteUsada, "magazinevoce_magazine_promoter");
  assert.strictEqual(aprovado.fatos.urlAfiliavelComprovada, esperado);

  const bloqueado = await resolverFatosMagalu({ urlOriginal: original, promoterId: "d1egopc" }, {
    cacheFactual: false,
    consultarProdutoMagalu: async url => ({
      ...fatosWorkspace(caso).fatos,
      urlOriginal: url,
      urlCanonica: url,
      metadata: { fontes: { urlCanonica: "url_original" } }
    })
  });
  assert.notStrictEqual(
    bloqueado.fatos?.magaluWorkspaceValidado,
    true,
    "pagina sem canonical/og:url nao pode provar afiliacao workspace"
  );
}

async function testarGateMagaluSemRefatoracaoGlobal() {
  const resultado = await importar(casos[0]);
  const opcoes = { clienteId: "workspace-magalu", promoterId: "d1egopc" };
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceMagalu(resultado, opcoes).ok, true);

  const semProva = {
    ...resultado,
    metadata: { ...resultado.metadata, afiliacaoWorkspace: null }
  };
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceMagalu(semProva, opcoes).motivo, "afiliacao_workspace_incompleta");

  const provaAdulterada = {
    ...resultado.metadata.afiliacaoWorkspace,
    productId: "produto-estrangeiro"
  };
  const adulterada = {
    ...resultado,
    metadata: { ...resultado.metadata, afiliacaoWorkspace: provaAdulterada }
  };
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceMagalu(adulterada, opcoes).motivo, "afiliacao_workspace_incompleta");

  const semImagem = { ...resultado, imagem: "", imagemEnviavel: false };
  assert.strictEqual(semImagem.imagemEnviavel, false);

  const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const inicioExecutor = fonte.indexOf("async function enviarParaDestinoInteligente");
  const fimExecutor = fonte.indexOf("async function processar", inicioExecutor);
  const executor = fonte.slice(inicioExecutor, fimExecutor > inicioExecutor ? fimExecutor : undefined);
  const indiceGateMagalu = executor.indexOf('=== "magalu"');
  const indiceRetornoAfiliacao = executor.indexOf('return { enviado: false, tentouEnvio: false, motivo: "afiliacao_workspace_incompleta"', indiceGateMagalu);
  const indiceGateImagem = executor.indexOf('const imagemPublicavelExecutor');
  const indiceRetornoImagem = executor.indexOf('motivo: "sem_imagem"', indiceGateImagem);
  const indicePrimeiroCredito = executor.indexOf("await registrarCreditoCheckpoint", indiceGateImagem);
  const indicePrimeiroSender = executor.indexOf("await executarAlvoComCheckpoint", indiceGateImagem);

  assert.ok(indiceGateMagalu >= 0, "executor deve conter gate Magalu");
  assert.ok(indiceRetornoAfiliacao > indiceGateMagalu, "afiliacao invalida deve retornar no gate Magalu");
  assert.ok(indiceGateImagem > indiceRetornoAfiliacao, "gate de imagem deve ocorrer depois da afiliacao valida");
  assert.ok(indiceRetornoImagem > indiceGateImagem, "imagem nao publicavel deve bloquear");
  assert.ok(indicePrimeiroCredito > indiceRetornoImagem, "bloqueio deve ocorrer antes de debitar credito");
  assert.ok(indicePrimeiroSender > indiceRetornoImagem, "bloqueio deve ocorrer antes de chamar sender/checkpoint");
}

(async () => {
  await testarSkusAprovados();
  await testar404BloqueiaSemPromoverOriginal();
  await testar403SemImagemTerminaSemImagem();
  await testarCaptchaPermiteProvaDeterministicaComImagemOficial();
  testarAliasesDeterministicosEIsolamentoDaProva();
  await testarOrigemEstrangeiraNuncaEhEnviada();
  await testarMidiaNaoOficialNuncaPublica();
  await testarProvaAdulteradaBloqueia();
  await testarRadarComercialPermaneceIntacto();
  testarMaiorImagemRealNoHtml();
  await testarResolverExigePaginaWorkspaceCanonica();
  await testarGateMagaluSemRefatoracaoGlobal();
  console.log("magalu-v2-golden-path.test.js ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
