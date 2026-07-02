const { texto } = require("./normalizacao.service");

function validarUrl(url = "") {
  try {
    const parsed = new URL(String(url || "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validarOfertaUniversal(ofertaUniversal = {}, contexto = {}) {
  const erros = [];
  const alertas = [];

  if (!texto(ofertaUniversal.titulo)) erros.push("titulo_ausente");
  if (!ofertaUniversal.precoAtual || ofertaUniversal.precoAtual <= 0) erros.push("preco_invalido");
  if (!validarUrl(ofertaUniversal.linkAfiliado || ofertaUniversal.linkOriginal)) erros.push("link_invalido");
  if (!texto(ofertaUniversal.marketplace)) erros.push("marketplace_ausente");
  if (!texto(ofertaUniversal.imagem)) alertas.push("imagem_ausente");
  if (contexto.exigirLinkAfiliado === true && !validarUrl(ofertaUniversal.linkAfiliado)) erros.push("link_afiliado_ausente");

  return {
    ok: erros.length === 0,
    erros,
    alertas,
    logs: [{ etapa: "validacao", status: erros.length ? "erro" : "ok", erros, alertas }]
  };
}

module.exports = {
  validarOfertaUniversal,
  validarUrl
};