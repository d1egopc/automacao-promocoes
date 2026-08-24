const crypto = require("crypto");
const { normalizarSinaisCopy, texto } = require("./resolver-intencao");

const VERSAO_CONTEXTO_COPY_V2 = "copy-v2-context-v1";
const ESTILOS_COPY_V2 = new Set(["direta", "divertida", "elegante", "descontraida"]);

function hashCopyV2(valor = "") {
  return crypto.createHash("sha256").update(String(valor || "")).digest("hex").slice(0, 24);
}

function normalizarEstiloCopyV2(estilo = "direta") {
  const valor = texto(estilo).toLowerCase();
  return ESTILOS_COPY_V2.has(valor) ? valor : "direta";
}

function sanitizarTextoPublico(valor = "", limite = 120) {
  return texto(valor)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b(?:token|cookie|secret|segredo|senha|password|authorization|bearer)\b\s*[:=]?\s*\S+/gi, "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "")
    .replace(/\b[\w.+-]+@(?:s\.whatsapp\.net|g\.us)\b/gi, "")
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{8,11}\b/g, "")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "")
    .replace(/\s+/g, " ")
    .slice(0, limite)
    .trim();
}

function valorComercialSanitizado(valor = "") {
  const bruto = texto(valor);
  if (!bruto) return "";
  try {
    const url = new URL(bruto);
    return `${url.hostname}${url.pathname}`.slice(0, 240);
  } catch (_) {
    return bruto.replace(/[?#].*$/, "").replace(/\s+/g, " ").slice(0, 120);
  }
}

function primeiroValor(oferta = {}, campos = []) {
  for (const campo of campos) {
    const direto = texto(oferta[campo]);
    if (direto) return direto;
  }
  return "";
}

function criarOfertaKeyHash(oferta = {}, sinais = normalizarSinaisCopy(oferta)) {
  const idConfiavel = texto(oferta.engineOfertaId || oferta.ofertaId || oferta.id || oferta.jobId);
  if (idConfiavel) return hashCopyV2(`id:${idConfiavel}`);

  const fingerprint = {
    marketplace: sinais.marketplace,
    titulo: sinais.tituloOriginal,
    categoria: sinais.categoria,
    preco: texto(oferta.precoAtual ?? oferta.preco ?? oferta.precoPor ?? ""),
    linkProduto: valorComercialSanitizado(primeiroValor(oferta, ["linkAfiliado", "linkFinal", "link", "url"])),
    identificadorComercial: primeiroValor(oferta, ["produtoId", "productId", "itemId", "sku", "asin", "mlb"])
  };

  if (!fingerprint.titulo || (!fingerprint.linkProduto && !fingerprint.identificadorComercial)) {
    return "";
  }

  return hashCopyV2(`fp:${JSON.stringify(fingerprint)}`);
}

function criarContextoCopyV2(oferta = {}, resultadoV1 = {}, opcoes = {}) {
  const sinais = resultadoV1.sinais || normalizarSinaisCopy(oferta);
  const workspaceId = texto(opcoes.workspaceId || opcoes.clienteId || oferta.clienteId || "admin") || "admin";
  const ofertaKeyHash = criarOfertaKeyHash(oferta, sinais);

  return {
    versaoContexto: VERSAO_CONTEXTO_COPY_V2,
    workspaceHash: hashCopyV2(`workspace:${workspaceId}`),
    ofertaKeyHash,
    tituloOriginalSanitizado: sanitizarTextoPublico(sinais.tituloOriginal, 120),
    intencao: texto(resultadoV1.intencao || "oportunidade") || "oportunidade",
    categoriaNormalizada: sanitizarTextoPublico(sinais.categoria, 80),
    marketplace: sanitizarTextoPublico(sinais.marketplace, 40),
    estilo: normalizarEstiloCopyV2(opcoes.estilo),
    fatosPermitidos: {
      cupom: sinais.cupom === true,
      resgate: sinais.resgate === true,
      freteGratis: sinais.freteGratis === true,
      descontoOficial: sinais.desconto === true,
      beneficioSeguro: sinais.beneficio === true,
      parcelamento: sinais.parcelamento === true,
      sazonal: sinais.sazonal === true
    }
  };
}

module.exports = {
  VERSAO_CONTEXTO_COPY_V2,
  ESTILOS_COPY_V2: Array.from(ESTILOS_COPY_V2),
  hashCopyV2,
  normalizarEstiloCopyV2,
  sanitizarTextoPublico,
  criarOfertaKeyHash,
  criarContextoCopyV2
};
