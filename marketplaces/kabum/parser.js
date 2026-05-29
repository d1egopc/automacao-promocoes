// ================= PARSER KABUM =================

function limparTextoKabum(texto = "") {
  return String(texto)
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function formatarPrecoKabum(valor) {
  const numero = Number(String(valor).replace(",", "."));

  if (!Number.isFinite(numero) || numero <= 0) {
    return "";
  }

  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function tituloPeloLinkKabum(link = "") {
  return limparTextoKabum(
    link
      .split("/produto/")[1]
      ?.split("?")[0]
      ?.replace(/^\d+\//, "")
      ?.replace(/-/g, " ") || ""
  );
}

function extrairProdutosKabum(html = "") {
  const links = [
    ...html.matchAll(/href="(https:\/\/www\.kabum\.com\.br\/produto\/[^"]+)"/gi),
    ...html.matchAll(/"url":"(https:\/\/www\.kabum\.com\.br\/produto\/[^"]+)"/gi)
  ]
    .map(m => limparTextoKabum(m[1] || ""))
    .filter(Boolean);

  const produtos = [];

  for (const link of [...new Set(links)]) {
    const trechoIndex = html.indexOf(link);

    const trecho = trechoIndex >= 0
      ? html.slice(trechoIndex, trechoIndex + 1800)
      : "";

    const precoRaw =
      trecho.match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i)?.[1] ||
      trecho.match(/price["']?\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i)?.[1] ||
      "";

    const imagem =
      trecho.match(/https:\/\/images\.kabum\.com\.br[^"\\]+/i)?.[0] ||
      "";

    const titulo = tituloPeloLinkKabum(link);

    if (!titulo || !link) continue;

    produtos.push({
      titulo,
      precoAtual: formatarPrecoKabum(precoRaw),
      precoAntigo: "",
      imagem,
      link
    });
  }

  return produtos;
}

module.exports = {
  limparTextoKabum,
  extrairProdutosKabum
};