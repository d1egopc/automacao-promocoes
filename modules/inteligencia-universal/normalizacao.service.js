const { normalizarNumeroMoeda } = require("../../utils/moeda");
function texto(valor = "") {
  return String(valor || "").trim();
}

function numero(valor = null) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  const limpo = String(valor)
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .trim();

  if (!limpo) return null;

  const direto = Number(limpo);
  if (Number.isFinite(direto)) return direto;

  const brasileiro = Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(brasileiro) ? brasileiro : null;
}

function normalizarMarketplace(valor = "") {
  const m = texto(valor).toLowerCase().replace(/[\s_-]+/g, "");
  if (m.includes("mercadolivre") || m === "ml") return "mercadolivre";
  if (m.includes("amazon")) return "amazon";
  if (m.includes("shopee")) return "shopee";
  if (m.includes("aliexpress")) return "aliexpress";
  if (m.includes("awin") || m.includes("kabum")) return m.includes("kabum") ? "kabum" : "awin";
  return texto(valor).toLowerCase();
}

function primeiroValor(...valores) {
  for (const valor of valores) {
    if (valor !== null && valor !== undefined && texto(valor) !== "") return valor;
  }
  return "";
}

function normalizarOfertaUniversal(oferta = {}, contexto = {}) {
  const produtoMetadata = oferta?.metadata?.produto && typeof oferta.metadata.produto === "object"
    ? oferta.metadata.produto
    : {};
  const marketplace = normalizarMarketplace(primeiroValor(oferta.marketplace, oferta.mercado, contexto.marketplace));
  const precoAtual = numero(primeiroValor(oferta.precoAtual, oferta.preco, oferta.valor));
  const precoOriginal = numero(primeiroValor(oferta.precoOriginal, oferta.precoAntigo, oferta.precoDe));
  const linkAfiliado = texto(primeiroValor(oferta.linkAfiliado, oferta.linkFinal, oferta.link));
  const linkOriginal = texto(primeiroValor(oferta.linkOriginal, oferta.linkOriginalRadar, oferta.urlOriginal, oferta.url));
  const linkExpandido = texto(primeiroValor(oferta.linkExpandido, oferta.urlExpandida, oferta.urlFinal));
  const cashbackValorEfetivo = texto(primeiroValor(oferta.cashback, produtoMetadata.cashback));
  const cashbackValorExplicito = primeiroValor(oferta.cashbackValor, produtoMetadata.cashbackValor);
  const cashbackPercentualExplicito = primeiroValor(oferta.cashbackPercentual, produtoMetadata.cashbackPercentual);

  return {
    id: primeiroValor(oferta.id, oferta.engineOfertaId, oferta.uuid),
    clienteId: texto(primeiroValor(oferta.clienteId, oferta.cliente_id, contexto.clienteId)),
    titulo: texto(primeiroValor(oferta.titulo, oferta.nome, oferta.title)),
    marketplace,
    precoAtual,
    precoOriginal,
    precoTexto: texto(primeiroValor(oferta.precoAtual, oferta.preco, oferta.valor)),
    precoOriginalTexto: texto(primeiroValor(oferta.precoOriginal, oferta.precoAntigo, oferta.precoDe)),
    imagem: texto(primeiroValor(oferta.imagem, oferta.image, oferta.foto, oferta.thumbnail)),
    linkOriginal,
    linkExpandido,
    linkAfiliado,
    link: linkAfiliado || linkOriginal,
    categoria: texto(primeiroValor(oferta.categoria, oferta.categoriaProduto)),
    score: numero(oferta.score),
    cupom: texto(oferta.cupom).toUpperCase(),
    cupomTipo: texto(primeiroValor(oferta.cupomTipo, oferta.tipoCupom)),
    beneficioTexto: texto(primeiroValor(oferta.beneficioTexto, oferta.beneficioExtra, oferta.avisoCupom)),
    freteGratis: oferta.freteGratis === true,
    cashback: texto(oferta.cashback),
    parcelamento: texto(oferta.parcelamento),
    origem: texto(primeiroValor(oferta.origem, contexto.origem)),
    valorEfetivoEntrada: {
      preco: precoAtual,
      precoOriginal,
      cupom: texto(oferta.cupom).toUpperCase(),
      valorCupom: primeiroValor(oferta.valorCupom, oferta.cupomValor, produtoMetadata.valorCupom, produtoMetadata.cupomValor),
      percentualCupom: primeiroValor(oferta.percentualCupom, oferta.cupomPercentual, produtoMetadata.percentualCupom, produtoMetadata.cupomPercentual),
      precoPix: primeiroValor(oferta.precoPix, produtoMetadata.precoPix),
      descontoPix: primeiroValor(oferta.descontoPix, produtoMetadata.descontoPix),
      cashbackValor: cashbackValorExplicito || (!cashbackValorEfetivo.includes("%") ? cashbackValorEfetivo : ""),
      cashbackPercentual: cashbackPercentualExplicito || (cashbackValorEfetivo.includes("%") ? cashbackValorEfetivo : ""),
      freteValor: primeiroValor(oferta.freteValor, oferta.valorFrete, produtoMetadata.freteValor, produtoMetadata.valorFrete),
      freteGratis: oferta.freteGratis === true,
      beneficios: Array.isArray(oferta.beneficios)
        ? oferta.beneficios
        : (Array.isArray(produtoMetadata.beneficios) ? produtoMetadata.beneficios : [])
    },
    raw: oferta
  };
}

module.exports = {
  texto,
  numero,
  normalizarMarketplace,
  normalizarOfertaUniversal
};
