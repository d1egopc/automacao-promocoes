const assert = require("assert");

const { criarImportarAmazon } = require("../marketplaces/amazon/importar");

const htmlProdutoAmazon = `
<html>
  <head>
    <meta property="og:title" content="Produto Amazon Teste">
    <meta property="og:image" content="https://images.test/produto.jpg">
    <meta property="product:price:amount" content="99.90">
  </head>
  <body>
    <span id="productTitle">Produto Amazon Teste</span>
  </body>
</html>`;

function extrairMeta(html = "", nome = "") {
  const padrao = new RegExp(`<meta[^>]+(?:property|name)=["']${nome}["'][^>]+content=["']([^"']+)["']`, "i");
  return html.match(padrao)?.[1] || "";
}

function limparLinkAmazonTeste(url = "") {
  try {
    const u = new URL(url);
    const asin =
      u.pathname.match(/\/dp\/([A-Z0-9]{10})/i)?.[1] ||
      u.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i)?.[1] ||
      u.pathname.match(/\/([A-Z0-9]{10})(?:\/|$)/i)?.[1];

    if (!asin) return url;

    const tag = u.searchParams.get("tag") || "d1egopcoff-20";
    return `https://www.amazon.com.br/dp/${asin}?tag=${tag}`;
  } catch {
    return url;
  }
}

function criarImportadorTeste({ redirects = {}, linksOptimus = false } = {}) {
  const chamadas = {
    fetch: [],
    redirect: [],
    linksOptimus: []
  };

  const importarAmazon = criarImportarAmazon({
    extrairJsonLd: () => null,
    extrairMeta,
    htmlDecode: valor => String(valor || ""),
    limparPreco: valor => String(valor || ""),
    corrigirImagemUrl: valor => String(valor || ""),
    limparLinkAmazon: limparLinkAmazonTeste,
    gerarLinkOptimus: (linkOriginal, marketplace) => {
      chamadas.linksOptimus.push({ linkOriginal, marketplace });
      return `https://go.optimus.test/r/${encodeURIComponent(linkOriginal)}`;
    },
    extrairCuponsAmazonDoHtml: () => [],
    detectarAvisoCupomAmazon: () => null,
    escolherCupomParaOfertaAmazon: () => null,
    resolverRedirectUniversal: async (url, opcoes) => {
      chamadas.redirect.push({ url, opcoes });
      return redirects[url] || { ok: false, urlOriginal: url, urlFinal: "", urlExpandida: "" };
    }
  });

  return {
    chamadas,
    importarAmazon: (url, config = {}) => importarAmazon(url, {
      credenciais: config.credenciais || {},
      linksOptimus: linksOptimus ? { ativo: true } : { ativo: false },
      contextoEngine: { clienteId: config.clienteId || "workspace_teste" }
    })
  };
}

async function comFetchFake(fn) {
  const originalFetch = global.fetch;
  const fetches = [];
  global.fetch = async (url) => {
    fetches.push(url);
    return {
      ok: true,
      status: 200,
      url,
      text: async () => htmlProdutoAmazon
    };
  };

  try {
    return await fn(fetches);
  } finally {
    global.fetch = originalFetch;
  }
}

(async function main() {
  await comFetchFake(async (fetches) => {
    const entrada = "https://amzlink.to/az0XhnBtt4pTQ";
    const amazonComTagEstrangeira = "https://www.amazon.com.br/dp/B07LFDHRBZ?tag=leuzxn-20&th=1";
    const redirectIntermediario = `https://r.amzlink.to/?btn_url=${encodeURIComponent(amazonComTagEstrangeira)}&tag=d1egopcoff-20`;
    const { importarAmazon, chamadas } = criarImportadorTeste({
      redirects: {
        [entrada]: {
          ok: true,
          urlOriginal: entrada,
          urlFinal: redirectIntermediario,
          urlExpandida: redirectIntermediario,
          marketplaceDetectado: "amazon"
        }
      }
    });

    const oferta = await importarAmazon(entrada, {
      credenciais: { trackingId: "d1egopcoff-20" },
      clienteId: "user_pss60lus"
    });

    assert.deepStrictEqual(chamadas.redirect.map(item => item.url), [entrada]);
    assert.deepStrictEqual(fetches, [amazonComTagEstrangeira]);
    assert.strictEqual(oferta.linkAfiliado, "https://www.amazon.com.br/dp/B07LFDHRBZ?tag=d1egopcoff-20");
    assert.strictEqual(oferta.linkOriginal, "https://www.amazon.com.br/dp/B07LFDHRBZ?tag=d1egopcoff-20");
    assert.strictEqual(oferta.linkAfiliado.includes("leuzxn-20"), false);
  });

  await comFetchFake(async () => {
    const entrada = "https://amzlink.to/az0XhnBtt4pTQ?tag=tag-externa-20";
    const finalAmazon = "https://www.amazon.com.br/dp/B07LFDHRBZ?tag=leuzxn-20&th=1";
    const { importarAmazon } = criarImportadorTeste({
      redirects: {
        [entrada]: {
          ok: true,
          urlOriginal: entrada,
          urlFinal: finalAmazon,
          urlExpandida: finalAmazon,
          marketplaceDetectado: "amazon"
        }
      }
    });

    const oferta = await importarAmazon(entrada, {
      credenciais: { trackingId: "d1egopcoff-20" }
    });

    assert.strictEqual(oferta.linkAfiliado, "https://www.amazon.com.br/dp/B07LFDHRBZ?tag=d1egopcoff-20");
    assert.strictEqual(oferta.linkAfiliado.includes("tag-externa-20"), false);
    assert.strictEqual(oferta.linkAfiliado.includes("leuzxn-20"), false);
  });

  await comFetchFake(async () => {
    const entrada = "https://www.amazon.com.br/Produto/dp/B0DIRECT12?tag=outra-20&ref=x";
    const { importarAmazon, chamadas } = criarImportadorTeste();
    const oferta = await importarAmazon(entrada, {
      credenciais: { trackingId: "workspace-a-20" }
    });

    assert.deepStrictEqual(chamadas.redirect, []);
    assert.strictEqual(oferta.linkAfiliado, "https://www.amazon.com.br/dp/B0DIRECT12?tag=workspace-a-20");
  });

  await comFetchFake(async () => {
    const entrada = "https://amzn.to/produto";
    const finalAmazon = "https://www.amazon.com.br/gp/product/B0AMZNTO12?tag=origem-20&ref=x";
    const { importarAmazon } = criarImportadorTeste({
      redirects: {
        [entrada]: {
          ok: true,
          urlOriginal: entrada,
          urlFinal: finalAmazon,
          urlExpandida: finalAmazon,
          marketplaceDetectado: "amazon"
        }
      }
    });

    const oferta = await importarAmazon(entrada, {
      credenciais: { trackingId: "workspace-b-20" }
    });

    assert.strictEqual(oferta.linkAfiliado, "https://www.amazon.com.br/dp/B0AMZNTO12?tag=workspace-b-20");
  });

  await comFetchFake(async () => {
    const entrada = "https://amzlink.to/sem-integracao";
    const finalAmazon = "https://www.amazon.com.br/dp/B07LFDHRBZ?tag=leuzxn-20";
    const { importarAmazon } = criarImportadorTeste({
      redirects: {
        [entrada]: {
          ok: true,
          urlOriginal: entrada,
          urlFinal: finalAmazon,
          urlExpandida: finalAmazon,
          marketplaceDetectado: "amazon"
        }
      }
    });

    const oferta = await importarAmazon(entrada, { credenciais: {} });

    assert.strictEqual(oferta.linkAfiliado, entrada);
    assert.strictEqual(oferta.linkAfiliado.includes("leuzxn-20"), false);
  });

  await comFetchFake(async () => {
    const entrada = "https://amzlink.to/nao-resolvido";
    const { importarAmazon } = criarImportadorTeste();
    const oferta = await importarAmazon(entrada, {
      credenciais: { trackingId: "d1egopcoff-20" }
    });

    assert.strictEqual(oferta.linkAfiliado, entrada);
    assert.strictEqual(oferta.linkAfiliado.includes("tag=d1egopcoff-20"), false);
  });

  await comFetchFake(async () => {
    const entrada = "https://amzlink.to/multiworkspace";
    const finalAmazon = "https://www.amazon.com.br/dp/B07LFDHRBZ?tag=origem-20";
    const redirects = {
      [entrada]: {
        ok: true,
        urlOriginal: entrada,
        urlFinal: finalAmazon,
        urlExpandida: finalAmazon,
        marketplaceDetectado: "amazon"
      }
    };
    const importadorA = criarImportadorTeste({ redirects }).importarAmazon;
    const importadorB = criarImportadorTeste({ redirects }).importarAmazon;

    const ofertaA = await importadorA(entrada, { credenciais: { trackingId: "workspace-a-20" } });
    const ofertaB = await importadorB(entrada, { credenciais: { trackingId: "workspace-b-20" } });

    assert.strictEqual(ofertaA.linkAfiliado, "https://www.amazon.com.br/dp/B07LFDHRBZ?tag=workspace-a-20");
    assert.strictEqual(ofertaB.linkAfiliado, "https://www.amazon.com.br/dp/B07LFDHRBZ?tag=workspace-b-20");
  });

  await comFetchFake(async () => {
    const entrada = "https://amzlink.to/az0XhnBtt4pTQ";
    const finalAmazon = "https://www.amazon.com.br/dp/B07LFDHRBZ?tag=leuzxn-20&th=1";
    const { importarAmazon, chamadas } = criarImportadorTeste({
      linksOptimus: true,
      redirects: {
        [entrada]: {
          ok: true,
          urlOriginal: entrada,
          urlFinal: finalAmazon,
          urlExpandida: finalAmazon,
          marketplaceDetectado: "amazon"
        }
      }
    });

    const oferta = await importarAmazon(entrada, {
      credenciais: { trackingId: "d1egopcoff-20" }
    });

    assert.deepStrictEqual(chamadas.linksOptimus, [{
      linkOriginal: "https://www.amazon.com.br/dp/B07LFDHRBZ?tag=d1egopcoff-20",
      marketplace: "amazon"
    }]);
    assert.ok(oferta.linkAfiliado.startsWith("https://go.optimus.test/r/"));
  });

  console.log("amazon-shortlink-afiliacao.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
