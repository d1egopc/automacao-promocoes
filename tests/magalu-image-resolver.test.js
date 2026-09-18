"use strict";

const assert = require("assert");
const {
  resolverImagemMagazineVoce,
  encontrarProdutoExato,
  normalizarImagemMlcdn
} = require("../modules/marketplaces/magalu/magalu-image-resolver");
const { importarProdutoMagaluEngine } = require("../modules/engine/importer/adapters/magalu.adapter");

const produtoNumerico = "241382400";
const produtoAlfanumerico = "jf4hfkkde1";
const slug = "magazined1egopc";

function urlProduto(id, categoria = "in/note") {
  return `https://www.magazinevoce.com.br/${slug}/produto-${id}/p/${id}/${categoria}/`;
}

function urlBusca(id) {
  return `https://www.magazinevoce.com.br/${slug}/busca/${id}/`;
}

function respostaHtml(html, status = 200, url = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: url || urlBusca(produtoNumerico),
    headers: { get: nome => nome.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : "" },
    body: { async cancel() {} },
    async text() { return html; }
  };
}

function respostaImagem({ status = 200, contentType = "image/jpeg", url = "https://a-static.mlcdn.com.br/imagem.jpg", cancelar = async () => {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: contentType === null ? { get: () => "" } : { get: nome => nome.toLowerCase() === "content-type" ? contentType : "" },
    body: { cancel: cancelar },
    async text() { return ""; }
  };
}

function htmlBusca({
  id = produtoNumerico,
  hrefId = id,
  sku = id,
  imagem = `https://a-static.mlcdn.com.br/280x210/produto/magazineluiza/${id}/imagem.jpg`,
  imagemJsonLd = `https://a-static.mlcdn.com.br/186x140/produto/magazineluiza/${id}/imagem.jpg`,
  segundoCard = ""
} = {}) {
  const href = `/magazined1egopc/produto-${hrefId}/p/${hrefId}/in/note/`;
  const card = `<a data-testid="product-card-container" href="${href}"><img data-testid="image" src="${imagem}"></a>`;
  const json = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    sku,
    image: imagemJsonLd,
    offers: { url: `https://www.magazinevoce.com.br${href}` }
  })}</script>`;
  return `${segundoCard}${card}${json}`;
}

async function consultarCom(html, status = 200, url = "") {
  let chamadas = 0;
  return resolverImagemMagazineVoce({
    productId: produtoNumerico,
    promoterId: "d1egopc",
    fetchFn: async (endereco) => {
      chamadas += 1;
      return endereco.includes("/busca/")
        ? respostaHtml(html, status, url || urlBusca(produtoNumerico))
        : respostaImagem();
    }
  });
}

async function testarIdNumericoExato() {
  const resultado = await consultarCom(htmlBusca());
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.productId, produtoNumerico);
  assert.strictEqual(resultado.skuConfirmado, true);
  assert.strictEqual(resultado.hrefConfirmado, true);
  assert.strictEqual(resultado.imagem, "https://a-static.mlcdn.com.br/280x210/produto/magazineluiza/241382400/imagem.jpg");
}

async function testarIdAlfanumericoExato() {
  const html = htmlBusca({
    id: produtoAlfanumerico,
    imagem: `https://a-static.mlcdn.com.br/280x210/produto/whirlpool/326199072/imagem.jpg`,
    imagemJsonLd: `https://a-static.mlcdn.com.br/186x140/produto/whirlpool/326199072/imagem.jpg`
  });
  const resultado = await resolverImagemMagazineVoce({
    productId: produtoAlfanumerico,
    promoterId: "d1egopc",
    fetchFn: async endereco => endereco.includes("/busca/")
      ? respostaHtml(html, 200, urlBusca(produtoAlfanumerico))
      : respostaImagem()
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.productId, produtoAlfanumerico);
  assert.ok(resultado.imagem.includes("326199072"), "o caminho interno da imagem nao substitui o SKU confirmado");
}

async function testarSkuDivergente() {
  const resultado = await consultarCom(htmlBusca({ sku: "outro-sku" }));
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.skuConfirmado, false);
  assert.strictEqual(resultado.motivoFinal, "magalu_imagem_busca_sku_divergente");
}

async function testarHrefDivergente() {
  const resultado = await consultarCom(htmlBusca({ hrefId: "outro-produto" }));
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.hrefConfirmado, false);
  assert.ok(/sem_produto_exato|sku_divergente/.test(resultado.motivoFinal));
}

async function testarImagemDeOutroCardNaoVaza() {
  const outroCard = `<a data-testid="product-card-container" href="/magazined1egopc/outro/p/outro-produto/in/note/"><img src="https://a-static.mlcdn.com.br/1200x900/outro.jpg"></a>`;
  const html = htmlBusca({ imagem: "https://cdn.exemplo.com/nao-oficial.jpg", imagemJsonLd: "https://cdn.exemplo.com/nao-oficial.jpg", segundoCard: outroCard });
  const resultado = await consultarCom(html);
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.imagem, "");
}

async function testarHostExternoEUrlSocial() {
  for (const imagem of [
    "https://cdn.exemplo.com/imagem.jpg",
    "https://mmg.whatsapp.net/imagem.jpg",
    "https://api.telegram.org/file/imagem.jpg",
    "https://radar.example/imagem.jpg"
  ]) {
    const resultado = await consultarCom(htmlBusca({ imagem, imagemJsonLd: imagem }));
    assert.strictEqual(resultado.ok, false, imagem);
    assert.strictEqual(resultado.imagem, "", imagem);
  }
  assert.strictEqual(normalizarImagemMlcdn("data:image/jpeg;base64,abc"), "");
}

async function testarMaiorVarianteSemInventar() {
  const resultado = await consultarCom(htmlBusca({
    imagem: "https://a-static.mlcdn.com.br/280x210/produto.jpg",
    imagemJsonLd: "https://a-static.mlcdn.com.br/186x140/produto.jpg"
  }));
  assert.strictEqual(resultado.ok, true);
  assert.ok(resultado.imagem.includes("280x210"));

  const apenasMenor = await consultarCom(htmlBusca({
    imagem: "https://a-static.mlcdn.com.br/320x240/produto.jpg",
    imagemJsonLd: "https://a-static.mlcdn.com.br/320x240/produto.jpg"
  }));
  assert.strictEqual(apenasMenor.ok, true);
  assert.ok(apenasMenor.imagem.includes("320x240"));
  assert.ok(!apenasMenor.candidatos.some(item => /1200x/.test(item.imagem)));
}

async function testarCaptcha403EAusencia() {
  const captcha = await consultarCom("<title>Complete o captcha</title>");
  assert.strictEqual(captcha.ok, false);
  assert.strictEqual(captcha.motivoFinal, "magalu_imagem_busca_captcha");

  const bloqueado = await consultarCom("", 403);
  assert.strictEqual(bloqueado.ok, false);
  assert.strictEqual(bloqueado.motivoFinal, "magalu_imagem_busca_http_403");

  const ausente = await consultarCom(htmlBusca({ imagem: "", imagemJsonLd: "" }));
  assert.strictEqual(ausente.ok, false);
  assert.strictEqual(ausente.motivoFinal, "magalu_imagem_busca_sem_imagem");
}

async function resolverComRespostaImagem(imagemResposta, { html = htmlBusca(), timeoutMs = 100 } = {}) {
  return resolverImagemMagazineVoce({
    productId: produtoNumerico,
    promoterId: "d1egopc",
    timeoutMs,
    fetchFn: async endereco => endereco.includes("/busca/")
      ? respostaHtml(html, 200, urlBusca(produtoNumerico))
      : imagemResposta
  });
}

async function testarValidacaoHttpEContentType() {
  for (const contentType of ["image/jpeg", "image/webp"]) {
    const resultado = await resolverComRespostaImagem(respostaImagem({ contentType }));
    assert.strictEqual(resultado.ok, true, contentType);
    assert.strictEqual(resultado.validacaoHttp.contentType, contentType);
  }

  for (const status of [404, 403, 500]) {
    const resultado = await resolverComRespostaImagem(respostaImagem({ status }));
    assert.strictEqual(resultado.ok, false, String(status));
    assert.strictEqual(resultado.validacaoHttp?.ok, false, String(status));
    assert.strictEqual(resultado.motivoFinal, `magalu_imagem_http_${status}`);
  }

  for (const contentType of ["text/html", null]) {
    const resultado = await resolverComRespostaImagem(respostaImagem({ contentType }));
    assert.strictEqual(resultado.ok, false, String(contentType));
    assert.strictEqual(resultado.motivoFinal, "magalu_imagem_content_type_invalido", String(contentType));
  }
}

async function testarTimeoutImagemERedirectFinal() {
  const timeout = await resolverComRespostaImagem(new Promise((_, rejeitar) => {
    setTimeout(() => rejeitar(Object.assign(new Error("aborted"), { name: "AbortError" })), 1000);
  }), { timeoutMs: 10 });
  assert.strictEqual(timeout.ok, false);
  assert.strictEqual(timeout.motivoFinal, "magalu_imagem_timeout");

  const redirectMlcdn = await resolverComRespostaImagem(respostaImagem({
    url: "https://a-static.mlcdn.com.br/800x600/redirecionada.jpg"
  }));
  assert.strictEqual(redirectMlcdn.ok, true);

  const redirectExterno = await resolverComRespostaImagem(respostaImagem({
    url: "https://images.evil.example/redirecionada.jpg"
  }));
  assert.strictEqual(redirectExterno.ok, false);
  assert.strictEqual(redirectExterno.motivoFinal, "magalu_imagem_host_final_invalido");
}

async function testarHostsParecidosEvil() {
  for (const url of [
    "https://evilmlcdn.com.br/imagem.jpg",
    "https://mlcdn.com.br.evil.com/imagem.jpg"
  ]) {
    assert.strictEqual(normalizarImagemMlcdn(url), "", url);
  }
  for (const url of [
    "https://a-static.mlcdn.com.br/imagem.jpg",
    "https://mlcdn.com.br/imagem.jpg"
  ]) {
    assert.strictEqual(normalizarImagemMlcdn(url), url, url);
  }
}

async function testarTimeoutDuranteResponseText() {
  const resposta = respostaHtml("", 200, urlBusca(produtoNumerico));
  resposta.text = () => new Promise(() => {});
  const resultado = await resolverImagemMagazineVoce({
    productId: produtoNumerico,
    promoterId: "d1egopc",
    timeoutMs: 10,
    fetchFn: async () => resposta
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivoFinal, "magalu_imagem_busca_timeout");
}

function depsAdapter({ imagemRadar = "", imagemBusca = null } = {}) {
  const original = "https://www.magazineluiza.com.br/produto-abc123/p/abc123/in/note/";
  return {
    original,
    deps: {
      consultarProdutoMagalu: async () => ({}),
      getIntegracaoCliente: () => ({ credenciais: { promoterId: "d1egopc" } }),
      resolverFatosMagalu: async () => ({
        ok: true,
        produtoId: "abc123",
        fonteUsada: "magazinevoce_magazine_promoter",
        fatos: {
          produtoId: "abc123",
          codigo: "abc123",
          titulo: "Titulo tecnico",
          precoAtual: "99,90",
          imagem: imagemRadar,
          urlOriginal: original,
          urlCanonica: "https://www.magazinevoce.com.br/magazined1egopc/produto-abc123/p/abc123/in/note/",
          urlAfiliavelComprovada: "https://www.magazinevoce.com.br/magazined1egopc/produto-abc123/p/abc123/in/note/",
          magaluWorkspaceValidado: true,
          avisos: [],
          metadata: { fontes: { urlCanonica: "canonical" } }
        },
        avisos: []
      }),
      ...(imagemBusca ? { resolverImagemMagazineVoce: async () => imagemBusca } : {})
    }
  };
}

async function importarComFallback(imagemBusca) {
  const pacote = depsAdapter({ imagemBusca });
  return importarProdutoMagaluEngine({
    job: { id: 700, evento_id: 701, cliente_id: "workspace-magalu" },
    evento: {
      titulo: "Titulo Radar",
      cupom: "RADAR10",
      texto_original: "Titulo Radar\nPor R$ 77,70\nCupom RADAR10\n" + pacote.original,
      links_extraidos: [pacote.original]
    },
    links: [{ url_original: pacote.original, url_normalizada: pacote.original, marketplace_detectado: "magalu" }],
    deps: pacote.deps
  });
}

async function testarAdapterPreservaRadarEProva() {
  const imagemBusca = {
    ok: true,
    imagem: "https://a-static.mlcdn.com.br/280x210/produto.jpg",
    productId: "abc123",
    skuConfirmado: true,
    hrefConfirmado: true,
    statusHttp: 200,
    candidatos: [{ imagem: "https://a-static.mlcdn.com.br/280x210/produto.jpg", largura: 280, altura: 210 }],
    validacaoHttp: { ok: true, statusHttp: 200, urlFinal: "https://a-static.mlcdn.com.br/280x210/produto.jpg", contentType: "image/jpeg" },
    motivoFinal: "imagem_mlcdn_confirmada"
  };
  const resultado = await importarComFallback(imagemBusca);
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.imagem, imagemBusca.imagem);
  assert.strictEqual(resultado.imagemEnviavel, true);
  assert.strictEqual(resultado.titulo, "Titulo Radar");
  assert.strictEqual(resultado.preco, 77.7);
  assert.strictEqual(resultado.cupom, "RADAR10");
  assert.strictEqual(resultado.origemImagemOficial, "magazinevoce_busca");
  assert.strictEqual(resultado.metadata.afiliacaoWorkspace.conversaoStatus, "convertida");
  assert.strictEqual(resultado.metadata.afiliacaoWorkspace.proofType, "page_validated");
}

async function testarFalhaContinuaSemImagem() {
  const resultado = await importarComFallback({
    ok: false,
    imagem: "",
    productId: "abc123",
    skuConfirmado: false,
    hrefConfirmado: false,
    candidatos: [],
    motivoFinal: "magalu_imagem_busca_http_403"
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "sem_imagem");
  assert.strictEqual(resultado.imagemEnviavel, false);
}

(async function main() {
  await testarIdNumericoExato();
  await testarIdAlfanumericoExato();
  await testarSkuDivergente();
  await testarHrefDivergente();
  await testarImagemDeOutroCardNaoVaza();
  await testarHostExternoEUrlSocial();
  await testarMaiorVarianteSemInventar();
  await testarCaptcha403EAusencia();
  await testarValidacaoHttpEContentType();
  await testarTimeoutImagemERedirectFinal();
  await testarHostsParecidosEvil();
  await testarTimeoutDuranteResponseText();
  await testarAdapterPreservaRadarEProva();
  await testarFalhaContinuaSemImagem();
  console.log("magalu-image-resolver.test.js ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
