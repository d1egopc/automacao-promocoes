const { gerarBuscasAliExpress } = require("./buscas");

const { importarAliExpress } = require("./importar");

const {
  extrairLinksProdutosAliExpress,
  extrairProdutosDaBuscaAliExpress
} = require("./parser");

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
];

function userAgentAleatorio() {
  return USER_AGENTS[
    Math.floor(Math.random() * USER_AGENTS.length)
  ];
}

// ================= FAREJADOR ALIEXPRESS MODULAR =================

async function farejarAliExpress(clienteId = "admin", deps = {}) {
  const {
    config,
    integracoesPorCliente,
    fila,
    salvarFila,
    prepararOfertaGlobal,
    ofertaJaExiste,
    classificarCategoriaOferta,
    aplicarFiltrosUniversais,
    gerarBuscasGlobais,
    distribuirOfertaParaClientes,
    encurtarUrl
  } = deps;

  try {
    console.log("🛒 Farejando ofertas AliExpress modular...", { clienteId });

    const cfg = config.marketplaces?.aliexpress || {};

    if (!cfg.ativo) {
      console.log("⏸ AliExpress desativado. Farejador ignorado.");
      return [];
    }

    const integracao =
      integracoesPorCliente?.[clienteId]?.aliexpress ||
      integracoesPorCliente?.admin?.aliexpress;

    if (!integracao?.credenciais) {
      console.log("❌ AliExpress sem integração configurada:", clienteId);
      return [];
    }

    const limitePorRodada = cfg.limitePorRodada || 5;

   const buscas = gerarBuscasAliExpress({ gerarBuscasGlobais });

    console.log("🔎 Buscas AliExpress:", buscas.slice(0, 10));

   const produtosEncontrados = [];

for (const termo of buscas.slice(0, 2)) {
  try {
    const slug = termo.trim().replace(/\s+/g, "-");

    const url = `https://pt.aliexpress.com/w/wholesale-${encodeURIComponent(slug)}.html`;

    console.log("🌐 ALIEXPRESS URL:", url);

const userAgent =
  USER_AGENTS[
    Math.floor(Math.random() * USER_AGENTS.length)
  ];

const response = await fetch(url, {
  headers: {
    "User-Agent": userAgent,
          "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language":
      "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Referer": "https://www.google.com/"
  }
});

    console.log("📡 ALIEXPRESS STATUS:", response.status);

    if (!response.ok) continue;

    const html = await response.text();

    console.log("🧪 HTML AliExpress tamanho:", html.length);
    console.log("🧪 HTML AliExpress trecho:", html.slice(0, 500));

console.log("🔎 CHECK ALIEXPRESS HTML:", {
  temItem: html.includes("/item/"),
  temProductId: html.includes("productId"),
  temSearchResult: html.includes("searchResult"),
  temProductTitle: html.includes("productTitle"),
  temPrice: html.includes("salePrice"),
  temImg: html.includes("imageUrl")
});

    if (
  html.includes("_____tmd_____") ||
  html.includes("/punish") ||
  html.includes("x5secdata")
  ) {
  console.log("🛡️ AliExpress bloqueou a busca. Pulando termo:", termo);
  continue;
  }

let produtos =
  extrairProdutosDaBuscaAliExpress(html).slice(0, 10);

if (!produtos.length) {
  const links = extrairLinksProdutosAliExpress(html).slice(0, 10);

  console.log("🔗 Links fallback AliExpress:", links.length);
  console.log("🔗 Primeiros links fallback:", links.slice(0, 5));

  produtos = links.map(link => ({
    titulo: "Produto AliExpress",
    link,
    precoAtual: "",
    imagem: ""
  }));
}

console.log(
  "🧪 Produtos extraídos da busca:",
  produtos.length
);

for (const produto of produtos) {

 console.log("🔥 PRODUTO BUSCA ALI:", produto);

  const produtoCompleto =
  await importarAliExpress(produto.link, {
    credenciais
  });

if (!produtoCompleto) {
  continue;
}

produtosEncontrados.push(produtoCompleto);

await new Promise(r =>
  setTimeout(
    r,
    2500 + Math.floor(Math.random() * 2500)
  )
);

}

  } catch (e) {
    console.log("❌ erro busca AliExpress:", e.message);
  }
}

console.log("🧪 Produtos AliExpress encontrados:", produtosEncontrados.length);

    // Por enquanto só estrutura inicial
    console.log("✅ AliExpress modular carregado com sucesso.");

   
return produtosEncontrados;

  } catch (e) {
    console.log("❌ erro farejador AliExpress modular:", e.message);
    return [];
  }
}

module.exports = {
  farejarAliExpress
};