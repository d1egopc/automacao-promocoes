"use strict";

function texto(valor) {
  return String(valor ?? "").trim();
}

function normalizar(valor) {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function numero(valor) {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  const bruto = texto(valor)
    .replace(/R\$/gi, "")
    .replace(/%/g, "")
    .replace(/\s/g, "");
  if (!bruto) return null;

  const temVirgula = bruto.includes(",");
  const temPonto = bruto.includes(".");
  const normalizado = temVirgula && temPonto
    ? bruto.replace(/\./g, "").replace(",", ".")
    : temVirgula
      ? bruto.replace(",", ".")
      : bruto;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function descontoOferta(fatos = {}) {
  const informado = numero(fatos.descontoPercentual ?? fatos.desconto);
  if (informado != null && informado > 0) return informado;

  const de = numero(fatos.precoOriginal ?? fatos.precoDe ?? fatos.precoAntigo);
  const por = numero(fatos.precoAtual ?? fatos.precoPor ?? fatos.preco);
  if (de != null && por != null && de > por) return ((de - por) / de) * 100;
  return 0;
}

function linksPorPapel(fatos = {}, papeis = []) {
  const alvo = new Set(papeis);
  const candidatos = [
    ...(Array.isArray(fatos.linksComerciais) ? fatos.linksComerciais : []),
    ...(Array.isArray(fatos.linksProduto) ? fatos.linksProduto : []),
    ...(Array.isArray(fatos.linksResgate) ? fatos.linksResgate : [])
  ];
  return candidatos.some(item => {
    if (!item || typeof item !== "object") return false;
    const papel = normalizar(item.tipo || item.papel).replace(/^link_/, "");
    return alvo.has(papel);
  });
}

function possuiCupomReal(fatos = {}) {
  return Boolean(texto(fatos.cupom || fatos.codigoCupom || fatos.cupomCodigo));
}

function contarBeneficiosCanonicos(fatos = {}) {
  let total = 0;
  if (texto(fatos.precoPix || fatos.condicaoPix)) total += 1;
  if (texto(fatos.parcelamento)) total += 1;
  if (texto(fatos.cashback)) total += 1;
  if (texto(fatos.frete || fatos.freteTexto) || fatos.freteGratis === true) total += 1;
  if (Array.isArray(fatos.beneficios)) total += fatos.beneficios.filter(texto).length;
  if (texto(fatos.beneficioTexto || fatos.beneficioExtra || fatos.avisoCupom)) total += 1;
  if (linksPorPapel(fatos, ["app", "moedas"])) total += 1;
  return total;
}

function ofertaRenderizavel(fatos = {}) {
  return Boolean(
    texto(fatos.titulo || fatos.nome) ||
    texto(fatos.linkAfiliado || fatos.linkProduto || fatos.linkFinal || fatos.link || fatos.url)
  );
}

function calcularEstrelasVisuaisOferta(fatos = {}) {
  if (!ofertaRenderizavel(fatos)) return 0;

  let pontos = 0;
  const desconto = descontoOferta(fatos);
  const beneficios = contarBeneficiosCanonicos(fatos);

  if (desconto >= 50) pontos += 2;
  else if (desconto >= 20) pontos += 1;

  if (possuiCupomReal(fatos)) pontos += 1;
  if (beneficios >= 1) pontos += 1;
  if (beneficios >= 3) pontos += 1;

  return Math.max(2, Math.min(5, 2 + pontos));
}

function classificacaoVisualOferta(fatos = {}) {
  const estrelas = calcularEstrelasVisuaisOferta(fatos);
  return estrelas ? "\u2B50".repeat(estrelas) : "";
}

module.exports = {
  calcularEstrelasVisuaisOferta,
  classificacaoVisualOferta
};
