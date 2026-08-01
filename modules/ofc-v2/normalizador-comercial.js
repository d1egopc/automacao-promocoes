"use strict";

const { analisarValorMonetario } = require("../../utils/moeda");

const MOEDA_PADRAO = "BRL";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function objeto(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function arredondar(valor, casas = 2) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

function normalizarMarketplace(valor = "") {
  const m = texto(valor).toLowerCase().replace(/[\s_-]+/g, "");
  if (m.includes("mercadolivre") || m === "ml") return "mercadolivre";
  if (m.includes("amazon")) return "amazon";
  if (m.includes("shopee")) return "shopee";
  if (m.includes("aliexpress")) return "aliexpress";
  if (m.includes("kabum")) return "kabum";
  if (m.includes("awin")) return "awin";
  return texto(valor).toLowerCase() || "desconhecido";
}

function textoNormalizado(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function pareceParcelamento(valor = "") {
  const t = textoNormalizado(valor);
  return /\b\d{1,2}\s*x\s*(?:de|em)?\s*r?\$?\s*\d/i.test(t) ||
    /\bparcela(?:s|do)?\b/.test(t);
}

function pareceFrete(valor = "") {
  return /\bfrete\b/.test(textoNormalizado(valor));
}

function parecePercentualSemPreco(valor = "") {
  const t = textoNormalizado(valor);
  return /\d+(?:[.,]\d+)?\s*%/.test(t) && !/r\$/.test(t);
}

function pareceQuantidadeVendida(valor = "") {
  return /\b\d{1,7}\s*(?:vendidos?|unidades?|pecas?)\b/.test(textoNormalizado(valor));
}

function pareceFaixaPreco(valor = "") {
  const fonte = texto(valor);
  const ocorrencias = fonte.match(/R?\$?\s*\d{1,6}(?:[.,]\d{1,2})?/gi) || [];
  return /\b(?:entre|de)\b.+\b(?:a|ate|e)\b/i.test(textoNormalizado(fonte)) && ocorrencias.length >= 2;
}

function motivoTextoInvalido(valor = "", campo = "preco") {
  const fonte = texto(valor);
  if (!fonte) return "vazio";
  if (pareceFaixaPreco(fonte)) return "faixa_preco_ambigua";
  if (pareceParcelamento(fonte)) return `${campo}_parece_parcela`;
  if (pareceFrete(fonte)) return `${campo}_parece_frete`;
  if (parecePercentualSemPreco(fonte)) return `${campo}_parece_percentual`;
  if (pareceQuantidadeVendida(fonte)) return `${campo}_parece_quantidade`;
  return "";
}

function extrairDePorTexto(valor = "") {
  const fonte = texto(valor);
  const match = fonte.match(/\bde\s*(R?\$?\s*[\d.,]+)\s*(?:\||-|\/|,|\s)+por\s*(R?\$?\s*[\d.,]+)/i);
  if (!match) return null;
  const anterior = analisarValorMonetario(match[1]);
  const atual = analisarValorMonetario(match[2]);
  if (!anterior.ok || !atual.ok) return null;
  return {
    precoAnterior: anterior.numero,
    precoAtual: atual.numero,
    motivo: "texto_de_por"
  };
}

function analisarPrecoComercial(valor, { campo = "preco", permitirTextoComRisco = false } = {}) {
  const motivoInvalido = typeof valor === "string" ? motivoTextoInvalido(valor, campo) : "";
  if (motivoInvalido && !permitirTextoComRisco) {
    return {
      ok: false,
      numero: null,
      motivo: motivoInvalido,
      valorOriginal: valor,
      moedaExplicita: /R\$/i.test(texto(valor))
    };
  }

  const analise = analisarValorMonetario(valor);
  if (!analise.ok) {
    return {
      ...analise,
      ok: false,
      numero: null,
      motivo: analise.motivo || `${campo}_invalido`
    };
  }

  if (analise.numero <= 0) {
    return { ...analise, ok: false, numero: null, motivo: `${campo}_menor_ou_igual_zero` };
  }

  return analise;
}

function extrairValorCupom(valor) {
  const fonte = texto(valor);
  if (!fonte) return { valor: null, tipo: "", motivo: "vazio" };
  if (/\d+(?:[.,]\d+)?\s*%/.test(fonte)) {
    return { valor: null, tipo: "percentual", motivo: "cupom_percentual_sem_regra_completa" };
  }
  const analise = analisarValorMonetario(fonte);
  return analise.ok
    ? { valor: analise.numero, tipo: "fixo", motivo: "valor_cupom_fixo" }
    : { valor: null, tipo: "", motivo: analise.motivo || "valor_cupom_invalido" };
}

function normalizarParcelamento(parcelamento) {
  if (!parcelamento || typeof parcelamento === "object") {
    const p = objeto(parcelamento);
    const quantidadeParcelas = numero(p.quantidadeParcelas ?? p.parcelas);
    const valorParcela = analisarPrecoComercial(p.valorParcela ?? p.valor, {
      campo: "valor_parcela",
      permitirTextoComRisco: true
    });
    return {
      quantidadeParcelas: quantidadeParcelas && quantidadeParcelas > 0 ? Math.floor(quantidadeParcelas) : null,
      valorParcela: valorParcela.ok ? valorParcela.numero : null,
      semJuros: p.semJuros === true,
      texto: texto(p.texto || "")
    };
  }

  const fonte = texto(parcelamento);
  const match = fonte.match(/(\d{1,2})\s*x\s*(?:de|em)?\s*R?\$?\s*([\d.,]+)/i);
  if (!match) {
    return { quantidadeParcelas: null, valorParcela: null, semJuros: /sem\s+juros/i.test(fonte), texto: fonte };
  }
  const valorParcela = analisarValorMonetario(match[2]);
  return {
    quantidadeParcelas: Number(match[1]),
    valorParcela: valorParcela.ok ? valorParcela.numero : null,
    semJuros: /sem\s+juros/i.test(fonte),
    texto: fonte
  };
}

function normalizarDadosComerciais(entrada = {}) {
  const marketplace = normalizarMarketplace(entrada.marketplace);
  const origem = texto(entrada.origem || entrada.precoOrigem || "desconhecida");
  const moeda = texto(entrada.moeda || MOEDA_PADRAO).toUpperCase() || MOEDA_PADRAO;
  const avisos = [];
  const evidencias = {};

  const precoAtualBruto = entrada.precoAtual ?? entrada.preco ?? entrada.salePrice;
  const dePor = typeof precoAtualBruto === "string"
    ? extrairDePorTexto(precoAtualBruto)
    : extrairDePorTexto(entrada.textoOriginal || "");
  const atualAnalise = dePor
    ? { ok: true, numero: dePor.precoAtual, motivo: dePor.motivo }
    : analisarPrecoComercial(precoAtualBruto, { campo: "preco_atual" });
  const anteriorBruto = entrada.precoAnterior ?? entrada.precoOriginal ?? entrada.precoAntigo ?? entrada.oldPrice;
  const anteriorAnalise = dePor && anteriorBruto === undefined
    ? { ok: true, numero: dePor.precoAnterior, motivo: dePor.motivo }
    : analisarPrecoComercial(anteriorBruto, { campo: "preco_anterior" });

  const precoAtual = atualAnalise.ok ? atualAnalise.numero : null;
  let precoAnterior = anteriorAnalise.ok ? anteriorAnalise.numero : null;

  if (!atualAnalise.ok) avisos.push(atualAnalise.motivo || "preco_atual_invalido");
  if (anteriorBruto !== undefined && !anteriorAnalise.ok) avisos.push(anteriorAnalise.motivo || "preco_anterior_invalido");

  if (precoAtual !== null && precoAnterior !== null && precoAnterior <= precoAtual) {
    avisos.push("preco_anterior_menor_ou_igual_atual");
    precoAnterior = null;
  }

  let descontoPercentual = null;
  const descontoEntrada = numero(entrada.descontoPercentual ?? entrada.desconto ?? entrada.discount);
  if (descontoEntrada !== null) {
    if (descontoEntrada >= 0 && descontoEntrada <= 100) descontoPercentual = arredondar(descontoEntrada, 2);
    else avisos.push("desconto_percentual_invalido");
  }
  if (descontoPercentual === null && precoAtual !== null && precoAnterior !== null && precoAnterior > precoAtual) {
    descontoPercentual = arredondar(((precoAnterior - precoAtual) / precoAnterior) * 100, 2);
  }

  const cupomEntrada = entrada.valorCupom ?? entrada.cupomValor ?? entrada.beneficioCupomValor;
  const cupomAnalise = cupomEntrada !== undefined ? extrairValorCupom(cupomEntrada) : { valor: null, tipo: "", motivo: "" };
  const valorCupom = cupomAnalise.tipo === "fixo" ? cupomAnalise.valor : null;
  if (cupomAnalise.tipo === "percentual") avisos.push(cupomAnalise.motivo);

  const precoComCupomBruto = entrada.precoComCupom ?? entrada.precoCupom ?? entrada.precoFinalCupom;
  const precoComCupomAnalise = analisarPrecoComercial(precoComCupomBruto, { campo: "preco_com_cupom" });
  let precoComCupom = precoComCupomAnalise.ok ? precoComCupomAnalise.numero : null;
  if (precoComCupomBruto !== undefined && !precoComCupomAnalise.ok) avisos.push(precoComCupomAnalise.motivo || "preco_com_cupom_invalido");
  if (precoComCupom === null && precoAtual !== null && valorCupom !== null) {
    const calculado = arredondar(precoAtual - valorCupom, 2);
    if (calculado > 0) precoComCupom = calculado;
    else avisos.push("preco_com_cupom_menor_ou_igual_zero");
  }

  if (precoComCupom !== null && precoComCupom <= 0) {
    avisos.push("preco_com_cupom_menor_ou_igual_zero");
    precoComCupom = null;
  }

  if (moeda !== MOEDA_PADRAO) avisos.push("moeda_nao_convertida");

  evidencias.precoAtual = atualAnalise.motivo || "";
  evidencias.precoAnterior = anteriorAnalise.motivo || "";
  evidencias.valorCupom = cupomAnalise.motivo || "";
  evidencias.precoComCupom = precoComCupomAnalise.motivo || "";

  const avisosUnicos = Array.from(new Set(avisos.filter(Boolean)));
  const precoConfiavel = precoAtual !== null && moeda === MOEDA_PADRAO && !avisosUnicos.includes("faixa_preco_ambigua");

  return {
    marketplace,
    precoAtual,
    precoAnterior,
    descontoPercentual,
    valorCupom,
    precoComCupom,
    parcelamento: normalizarParcelamento(entrada.parcelamento),
    moeda,
    precoOrigem: origem,
    precoConfiavel,
    avisoPreco: avisosUnicos.length ? avisosUnicos.join("|") : null,
    evidencias,
    calculadoEm: new Date().toISOString()
  };
}

module.exports = {
  MOEDA_PADRAO,
  normalizarMarketplace,
  analisarPrecoComercial,
  normalizarParcelamento,
  normalizarDadosComerciais
};
