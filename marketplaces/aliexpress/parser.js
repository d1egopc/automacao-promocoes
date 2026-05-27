// ================= PARSER ALIEXPRESS =================

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

  return [...new Set(links)];
}