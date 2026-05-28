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
    (
      link.includes("produto.mercadolivre.com.br") ||
      link.includes("www.mercadolivre.com.br")
    ) &&
    !link.includes("click1.mercadolivre") &&
    !link.includes("brand_ads") &&
    !link.includes("lista.mercadolivre") &&
    !link.includes("registration") &&
    !link.includes("security.js") &&
    !link.includes("account-verification")
  );

  for (const link of [...new Set(links)].slice(0, 10)) {
  const trechoIndex = html.indexOf(link);
  const trecho = trechoIndex >= 0
    ? html.slice(Math.max(0, trechoIndex - 3000), trechoIndex + 3000)
    : html;

const titulo =
  limparTextoML(
    trecho.match(/"poly_component_title":"([^"]+)"/)?.[1] ||
    trecho.match(/"label":"([^"]{10,300})"/)?.[1] ||
    trecho.match(/aria-label="([^"]{10,300})"/)?.[1] ||
    trecho.match(/"name":"([^"]{10,300})"/)?.[1] ||
    ""
  );

if (
  !titulo ||
  titulo.toLowerCase().includes("ordenar por") ||
  titulo.toLowerCase().includes("mais relevantes") ||
  titulo.toLowerCase().includes("menor preço") ||
  titulo.toLowerCase().includes("maior preço")
) {
  continue;
}

const precoMatch =
  trecho.match(/"current_price":([0-9.]+)/)?.[1] ||
  trecho.match(/"price":([0-9]{2,6}(?:\.[0-9]{2})?)/)?.[1] ||
  trecho.match(/R\$\s*([0-9]{2,6}(?:\.[0-9]{3})*,\d{2})/)?.[1];

  const precoAtual = precoMatch
  ? `R$ ${String(precoMatch).replace(".", ",")}`
  : "";

  const imagem =
    trecho.match(/"image":"([^"]+)"/)?.[1] ||
    trecho.match(/src="([^"]*mlstatic[^"]+)"/)?.[1] ||
    "";

  produtos.push({
    titulo,
    precoAtual,
    precoAntigo: "",
    imagem: limparTextoML(imagem),
    link
  });
}


  return produtos;
}

module.exports = {
  limparTextoML,
  extrairProdutosBuscaML
};