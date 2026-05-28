// ================= PARSER MERCADO LIVRE =================

function limparTextoML(texto = "") {
  return String(texto)
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairProdutosBuscaML(html = "") {
  const produtos = [];

  const links = [
    ...html.matchAll(/href="([^"]*\/MLB-[^"]*)"/g),
    ...html.matchAll(/href="([^"]*\/p\/MLB[^"]*)"/g),
    ...html.matchAll(/"permalink":"([^"]*MLB[^"]*)"/g),
    ...html.matchAll(/"url":"([^"]*MLB[^"]*)"/g)
  ]
    .map(m => limparTextoML(m[1] || ""))
    .map(link => {
      if (link.startsWith("/")) {
        return "https://www.mercadolivre.com.br" + link;
      }

      if (link.startsWith("www.")) {
        return "https://" + link;
      }

      return link;
    })
    .filter(link =>
      link.includes("mercadolivre.com.br") &&
      link.includes("MLB") &&
      !link.includes("lista.mercadolivre") &&
      !link.includes("registration") &&
      !link.includes("security.js") &&
      !link.includes("account-verification")
    );

  for (const link of [...new Set(links)].slice(0, 10)) {
    produtos.push({
      titulo: "",
      precoAtual: "",
      precoAntigo: "",
      imagem: "",
      link
    });
  }

  return produtos;
}

module.exports = {
  limparTextoML,
  extrairProdutosBuscaML
};