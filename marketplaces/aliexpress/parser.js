// ================= PARSER ALIEXPRESS =================

function limparTexto(texto = "") {
  return String(texto)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairLinksProdutosAliExpress(html = "") {
  const links = [];

  const regexes = [
    /https?:\\?\/\\?\/(?:pt|www)\.aliexpress\.com\\?\/item\\?\/\d+\.html[^"'\s<\\]*/gi,
    /\/\/(?:pt|www)\.aliexpress\.com\/item\/\d+\.html[^"'\s<]*/gi,
    /\/item\/\d+\.html[^"'\s<]*/gi,
    /"productDetailUrl"\s*:\s*"([^"]+)"/gi,
    /"productUrl"\s*:\s*"([^"]+)"/gi,
    /"itemUrl"\s*:\s*"([^"]+)"/gi
  ];

  for (const regex of regexes) {
    let match;

    while ((match = regex.exec(html)) !== null) {
      let link = match[1] || match[0];

      link = link
        .replace(/\\u002F/g, "/")
        .replace(/\\\//g, "/")
        .replace(/&amp;/g, "&")
        .trim();

      if (link.startsWith("//")) link = "https:" + link;
      if (link.startsWith("/item/")) link = "https://pt.aliexpress.com" + link;

      const limpo = link.split("?")[0];

      if (limpo.includes("/item/") && limpo.includes(".html")) {
        links.push(limpo);
      }
    }
  }

console.log("[INFO] LINKS ALIEXPRESS ENCONTRADOS:", links.length);

if (links.length) {
  console.log("[INFO] PRIMEIROS LINKS:", links.slice(0, 5));
}

  return [...new Set(links)];
}

function extrairProdutosDaBuscaAliExpress(html = "") {
  const produtos = [];

  const blocos = html.match(/"productId".{0,3000}?"productUrl".{0,1000}?/g) || [];

  for (const bloco of blocos.slice(0, 20)) {
    const titulo =
      bloco.match(/"title"\s*:\s*"([^"]+)"/)?.[1] ||
      bloco.match(/"productTitle"\s*:\s*"([^"]+)"/)?.[1] ||
      "";

    const precoAtual =
      bloco.match(/"formattedPrice"\s*:\s*"([^"]+)"/)?.[1] ||
      bloco.match(/"price"\s*:\s*"([^"]+)"/)?.[1] ||
      "";

    const imagem =
      bloco.match(/"imageUrl"\s*:\s*"([^"]+)"/)?.[1] ||
      "";

    const link =
      bloco.match(/"productUrl"\s*:\s*"([^"]+)"/)?.[1] ||
      "";

    if (titulo || link) {
      produtos.push({
        titulo,
        precoAtual,
        imagem: imagem.replace(/\\u002F/g, "/").replace(/\\\//g, "/"),
        link: link.replace(/\\u002F/g, "/").replace(/\\\//g, "/")
      });
    }
  }

  console.log("[INFO] BLOCOS ALIEXPRESS:", blocos.length);
  console.log("[INFO] PRODUTOS EXTRADOS:", produtos.length);

  return produtos;
}

module.exports = {
  limparTexto,
  extrairLinksProdutosAliExpress,
  extrairProdutosDaBuscaAliExpress
};