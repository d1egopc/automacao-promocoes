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
    /https:\/\/pt\.aliexpress\.com\/item\/\d+\.html[^"'\s<]*/g,
    /https:\/\/www\.aliexpress\.com\/item\/\d+\.html[^"'\s<]*/g,
    /\/\/pt\.aliexpress\.com\/item\/\d+\.html[^"'\s<]*/g,
    /\/\/www\.aliexpress\.com\/item\/\d+\.html[^"'\s<]*/g
  ];

  for (const regex of regexes) {
    const encontrados = html.match(regex) || [];

    for (let link of encontrados) {
      if (link.startsWith("//")) link = "https:" + link;
      links.push(link.split("?")[0]);
    }
  }

  return [...new Set(links)];
}

module.exports = {
  limparTexto,
  extrairLinksProdutosAliExpress
};