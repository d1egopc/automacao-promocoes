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

 const linksUnicos = [...new Set(links)].slice(0, 10);

for (const link of linksUnicos) {
  const trechoIndex = html.indexOf(link);

  const proximoLinkIndex = linksUnicos
    .map(l => html.indexOf(l))
    .filter(i => i > trechoIndex)
    .sort((a, b) => a - b)[0];

  const trecho = trechoIndex >= 0
    ? html.slice(
        trechoIndex,
        proximoLinkIndex || trechoIndex + 3500
      )
    : "";


const titulo =
  limparTextoML(
    trecho.match(/"poly_component_title":"([^"]+)"/)?.[1] ||
    trecho.match(/"label":"([^"]{10,300})"/)?.[1] ||
    trecho.match(/aria-label="([^"]{10,300})"/)?.[1] ||
    trecho.match(/"name":"([^"]{10,300})"/)?.[1] ||
    ""
  );

const tituloUrl = limparTextoML(
  link
    .replace(/^https?:\/\/(www\.|produto\.)?mercadolivre\.com\.br\//, "")
    .split("#")[0]
    .split("?")[0]
    .split("/p/MLB")[0]
    .replace(/^MLB-\d+-/, "")
    .replace(/_JM$/i, "")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
);

 const tituloLixo =
  !titulo ||
  titulo.toLowerCase().includes("ordenar por") ||
  titulo.toLowerCase().includes("mais relevantes") ||
  titulo.toLowerCase().includes("menor preço") ||
  titulo.toLowerCase().includes("maior preço") ||
  titulo.toLowerCase().includes("outras pessoas pesquisaram") ||
  titulo.toLowerCase().includes("pesquisaram também") ||
  titulo.toLowerCase().includes("produtos relacionados") ||
  titulo.toLowerCase().includes("formato de venda") ||
  titulo.toLowerCase().includes("lojas oficiais") ||
  titulo.toLowerCase().includes("mercadolíderes") ||
  titulo.toLowerCase().includes("mercado lideres") ||
  titulo.toLowerCase().includes("filtro") ||
  titulo.toLowerCase() === "p";

const tituloFinal = tituloLixo ? tituloUrl : titulo;

if (!tituloFinal) {
  continue;
}

const precoMatch =
  trecho.match(/"current_price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/)?.[1] ||
  trecho.match(/"price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/)?.[1] ||
  trecho.match(/R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,\d{2})/)?.[1] ||
  "";

  const precoAtual = precoMatch
  ? `R$ ${String(precoMatch)
      .replace(/\.(?=\d{3}(,|$))/g, "")
      .replace(".", ",")}`
  : "";

  const imagem =
    trecho.match(/"image":"([^"]+)"/)?.[1] ||
    trecho.match(/src="([^"]*mlstatic[^"]+)"/)?.[1] ||
    "";

console.log("🚨🚨🚨 PARSER ML ITEM PREÇO:", {
  titulo: tituloFinal,
  precoMatch,
  precoAtual,
  link
});

  produtos.push({
    titulo: tituloFinal,
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