"use strict";

const {
  normalizarCuponsSemanticos
} = require("../radar/cupom-semantico");
const {
  textoPixValido
} = require("../radar/preco-pix-precedencia");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarComparacao(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizarNumero(valor) {
  if (valor == null || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const fonte = texto(valor).replace(/R\$/gi, "").replace(/%/g, "").replace(/\s/g, "");
  if (!fonte) return null;
  const normalizado = fonte.includes(",") && fonte.includes(".")
    ? fonte.replace(/\./g, "").replace(",", ".")
    : fonte.includes(",")
      ? fonte.replace(",", ".")
      : fonte;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function numeroMonetarioEmTexto(valor = "") {
  const direto = normalizarNumero(valor);
  if (direto != null) return direto;
  const match = texto(valor).match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|(?:R\$\s*)?\d+(?:[,.]\d{1,2})?/);
  return match ? normalizarNumero(match[0]) : null;
}

function formatarMoeda(valor) {
  const numero = normalizarNumero(valor);
  if (numero == null) return "";
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00A0/g, " ");
}

function textoOriginalComercial(oferta = {}) {
  const metadata = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const radarMirror = metadata.radarMirror && typeof metadata.radarMirror === "object" ? metadata.radarMirror : {};
  return texto(
    oferta.textoComercialOriginal ||
    oferta.textoComercialCanonico ||
    oferta.documentoComercialCanonico ||
    oferta.textoOriginal ||
    metadata.textoComercialOriginal ||
    metadata.documentoComercialCanonico ||
    radarMirror.texto?.original ||
    radarMirror.textoOriginal ||
    ""
  );
}

function extrairDePorPix(textoOriginal = "") {
  const fonte = texto(textoOriginal);
  if (!fonte || !/\bpix\b/i.test(fonte)) return null;
  const padraoValor = "((?:R\\$\\s*)?\\d{1,3}(?:\\.\\d{3})*(?:,\\d{1,2})?|(?:R\\$\\s*)?\\d+(?:[,.]\\d{1,2})?)";
  const dePor = fonte.match(new RegExp(`\\bde\\s*:?\\s*${padraoValor}\\s*(?:\\||-|\\/|,|\\s)+por\\s*:?\\s*${padraoValor}([^\\n]*)`, "i"));
  if (dePor && /\bpix\b/i.test(dePor[3] || "")) {
    return {
      precoDe: numeroMonetarioEmTexto(dePor[1]),
      precoPor: numeroMonetarioEmTexto(dePor[2]),
      condicaoPrecoPor: "pix"
    };
  }
  const porPix = fonte.match(new RegExp(`\\bpor\\s*:?\\s*${padraoValor}([^\\n]*\\bpix\\b[^\\n]*)`, "i"));
  if (porPix) {
    return {
      precoDe: null,
      precoPor: numeroMonetarioEmTexto(porPix[1]),
      condicaoPrecoPor: "pix"
    };
  }
  return null;
}

function mesmoNumero(a, b) {
  const na = normalizarNumero(a);
  const nb = normalizarNumero(b);
  return na != null && nb != null && Math.abs(na - nb) < 0.005;
}

function resolverPrecoPixFinal(oferta = {}, precoPor = null, textoOriginal = "", precoDe = null) {
  const dePorPix = extrairDePorPix(textoOriginal);
  const candidatos = [
    oferta.precoPixDistinto,
    oferta.precoPix,
    oferta.condicaoPix
  ].map(texto).filter(Boolean);
  const candidato = candidatos.find(valor => textoPixValido(valor) && /\bpix\b/i.test(valor)) || "";
  const valorPix = numeroMonetarioEmTexto(candidato);

  if (dePorPix?.condicaoPrecoPor === "pix") {
    return { condicaoPrecoPor: "pix", precoPixDistinto: null, precoPixTexto: "", origem: "radar_de_por_pix" };
  }

  if (!candidato || valorPix == null) {
    return { condicaoPrecoPor: "", precoPixDistinto: null, precoPixTexto: "", origem: "sem_pix_comprovado" };
  }

  if (precoDe != null && mesmoNumero(valorPix, precoDe)) {
    return { condicaoPrecoPor: "", precoPixDistinto: null, precoPixTexto: "", origem: "pix_rejeitado_igual_preco_de" };
  }

  if (precoPor != null && mesmoNumero(valorPix, precoPor)) {
    return { condicaoPrecoPor: "pix", precoPixDistinto: null, precoPixTexto: "", origem: "pix_mesmo_preco_por" };
  }

  return {
    condicaoPrecoPor: "",
    precoPixDistinto: valorPix,
    precoPixTexto: textoPixValido(candidato),
    origem: "pix_distinto_comprovado"
  };
}

function assinaturaFato(valor = "") {
  const semUrl = texto(valor).replace(/https?:\/\/\S+|www\.\S+/gi, " ");
  const n = normalizarComparacao(semUrl)
    .replace(/\b(?:cupom|codigo|cod|voucher|use|utilize|aplique|resgate|ative|no|na|em|anuncio|pagina|link|abaixo|antes|finalizar|compra)\b/g, " ")
    .replace(/[^a-z0-9%$]+/g, " ")
    .trim();
  const percentual = n.match(/\b(\d{1,3})\s*%\s*(?:off|desconto)?\b/);
  if (percentual) return `percentual:${percentual[1]}`;
  const monetarioOff = semUrl.match(/R\$\s*(\d{1,5}(?:[,.]\d{1,2})?)\s*OFF\b/i);
  if (monetarioOff) return `valor_off:${monetarioOff[1].replace(",", ".")}`;
  return n.replace(/\s+/g, "");
}

function cupomFracoBloqueado(cupom = "") {
  const chave = normalizarComparacao(cupom).replace(/[^a-z0-9]/g, "");
  return !chave || [
    "novo",
    "exclusivo",
    "ruim",
    "daloja",
    "novoliberadoprausar",
    "ruimvemescritoexclusivo"
  ].includes(chave);
}

function cupomEmFonteExplicita(cupom = "", fonte = "") {
  const codigo = texto(cupom);
  const valor = texto(fonte);
  if (!codigo || !valor) return false;
  if (!/\b(?:cupom|codigo|c[oó]digo|voucher|use|utilize|aplique)\b/i.test(valor)) return false;
  return normalizarCuponsSemanticos(valor).some(item => normalizarComparacao(item) === normalizarComparacao(codigo));
}

function cupomTemProvenienciaExplicita(cupom = "", oferta = {}, textoOriginal = "") {
  const camposCodigo = [
    ...(Array.isArray(oferta.codigosCupom) ? oferta.codigosCupom : []),
    oferta.cupomCodigo,
    oferta.codigoCupom
  ];
  if (normalizarCuponsSemanticos(camposCodigo).some(item => normalizarComparacao(item) === normalizarComparacao(cupom))) {
    return true;
  }

  const fontesConfiaveis = [
    textoOriginal,
    oferta.textoComercialCanonico,
    oferta.documentoComercialCanonico,
    oferta.instrucaoCupom,
    oferta.condicaoCupom,
    oferta.condicaoComercial
  ];
  return fontesConfiaveis.some(fonte => cupomEmFonteExplicita(cupom, fonte));
}

function cupomFinal(oferta = {}, textoOriginal = "") {
  const fontes = [
    ...(Array.isArray(oferta.codigosCupom) ? oferta.codigosCupom : []),
    ...(Array.isArray(oferta.cupons) ? oferta.cupons : []),
    oferta.cupomCodigo,
    oferta.codigoCupom,
    oferta.cupom
  ];
  const candidatos = normalizarCuponsSemanticos(fontes);
  return candidatos.find(cupom =>
    !cupomFracoBloqueado(cupom) ||
    cupomTemProvenienciaExplicita(cupom, oferta, textoOriginal)
  ) || "";
}

function beneficioSeguro(valor = "", cupom = "", instrucao = "") {
  const item = texto(valor);
  if (!item) return "";
  const normalizado = normalizarComparacao(item);
  if (!/\b(?:off|desconto|frete|cashback|brinde|moeda|moedas|app|pix|prime|garantia|resgate|voucher)\b|\b\d+\s*%/.test(normalizado)) return "";
  const chave = assinaturaFato(item);
  if (!chave) return "";
  if (cupom && chave === assinaturaFato(cupom)) return "";
  if (instrucao && chave === assinaturaFato(instrucao)) return "";
  return item;
}

function beneficioFinal(oferta = {}, cupom = "", instrucao = "") {
  const candidatos = [
    ...(Array.isArray(oferta.beneficios) ? oferta.beneficios : []),
    oferta.beneficio,
    oferta.beneficioTexto,
    oferta.beneficioExtra,
    oferta.beneficioDetectado
  ];
  const vistos = new Set();
  for (const candidato of candidatos) {
    const beneficio = beneficioSeguro(candidato, cupom, instrucao);
    const chave = assinaturaFato(beneficio);
    if (!beneficio || vistos.has(chave)) continue;
    vistos.add(chave);
    return beneficio;
  }
  return "";
}

function instrucaoExplicitaConfiavel(instrucao = "", cupom = "") {
  const valor = texto(instrucao);
  if (!valor || /https?:\/\//i.test(valor)) return "";
  const n = normalizarComparacao(valor);
  if (/\bcaes\s+e\s+gatos\b/.test(n)) return "";
  if (!/\b(?:cupom|voucher|resgate|aplique|use|utilize|ative|moeda|moedas|app|loja|carrinho|pix|desconto)\b/.test(n)) return "";
  if (!cupom && /\b(?:aplique|use|utilize)\b/.test(n) && !/\b(?:cupom|voucher|moeda|moedas|app|pix)\b/.test(n)) return "";
  return valor;
}

function instrucaoFinal(oferta = {}, cupom = "") {
  const explicita = instrucaoExplicitaConfiavel(
    oferta.instrucaoComercial || oferta.instrucaoCupom || oferta.condicaoCupom || oferta.condicaoComercial || "",
    cupom
  );
  if (explicita) return explicita;
  return "";
}

function papelLinkFinal(item = {}) {
  const bruto = normalizarComparacao(item.papel || item.tipo || "").replace(/^link_/, "");
  if (["cupom", "resgate"].includes(bruto)) return "resgate";
  if (["afiliado", "linkproduto"].includes(bruto)) return "produto";
  if (["moeda", "moedas", "coins"].includes(bruto)) return "moedas";
  return bruto;
}

function linksPorPapel(links = [], papel = "") {
  const resultado = [];
  const alvo = normalizarComparacao(papel).replace(/^link_/, "");
  for (const [indice, item] of (Array.isArray(links) ? links : []).entries()) {
    if (!item || typeof item !== "object") continue;
    const tipo = papelLinkFinal(item);
    if (tipo !== alvo) continue;
    const url = texto(item.urlOptimus || item.urlAfiliada || item.afiliado || item.linkAfiliado || item.resolvido || item.original || item.url || item.link);
    const ordem = Number(item.ordemCaptura || item.ordem || indice + 1) || (indice + 1);
    if (!url) continue;
    resultado.push({
      ...item,
      tipo: alvo,
      papel: item.papel || `link_${alvo}`,
      ordemCaptura: ordem,
      ocorrenciaId: texto(item.ocorrenciaId || item.idOcorrencia || `link:${tipo}:${ordem}:${indice + 1}`),
      urlOptimus: item.urlOptimus || url
    });
  }
  return resultado.sort((a, b) => Number(a.ordemCaptura || 0) - Number(b.ordemCaptura || 0));
}

function todosLinks(oferta = {}) {
  const linksComerciais = Array.isArray(oferta.linksComerciais) ? oferta.linksComerciais : [];
  if (linksComerciais.length) return linksComerciais;
  return [
    ...(Array.isArray(oferta.linksProduto) ? oferta.linksProduto : []),
    ...(Array.isArray(oferta.linksResgate) ? oferta.linksResgate : []),
    ...(Array.isArray(oferta.linksApp) ? oferta.linksApp : []),
    ...(Array.isArray(oferta.linksPc) ? oferta.linksPc : []),
    ...(Array.isArray(oferta.linksMoedas) ? oferta.linksMoedas : [])
  ];
}

function primeiroUrl(links = []) {
  const item = links.find(Boolean);
  return texto(item?.urlOptimus || item?.urlAfiliada || item?.afiliado || item?.linkAfiliado || item?.resolvido || item?.original || item?.url || item?.link);
}

function resolverContratoComercialFinal(oferta = {}) {
  const textoOriginal = textoOriginalComercial(oferta);
  const dePorPix = extrairDePorPix(textoOriginal);
  const precoPor = dePorPix?.precoPor ?? normalizarNumero(oferta.precoPor ?? oferta.precoAtual ?? oferta.preco);
  const precoDe = dePorPix?.precoDe ?? normalizarNumero(oferta.precoDe ?? oferta.precoOriginal ?? oferta.precoAntigo);
  const pix = resolverPrecoPixFinal(oferta, precoPor, textoOriginal, precoDe);
  const cupom = cupomFinal(oferta, textoOriginal);
  const instrucao = instrucaoFinal(oferta, cupom);
  const beneficio = beneficioFinal(oferta, cupom, instrucao);
  const links = todosLinks(oferta);
  const linksProduto = linksPorPapel(links, "produto");
  const linksResgate = linksPorPapel(links, "resgate");
  const linksApp = linksPorPapel(links, "app");
  const linksPc = linksPorPapel(links, "pc");
  const linksMoedas = linksPorPapel(links, "moedas");
  const contrato = {
    versao: "contrato_comercial_final_v1",
    resolvido: true,
    precoDe,
    precoPor,
    condicaoPrecoPor: pix.condicaoPrecoPor,
    precoPixDistinto: pix.precoPixDistinto,
    precoPixTexto: pix.precoPixTexto,
    cupomCodigo: cupom,
    beneficio,
    instrucaoComercial: instrucao,
    linksProduto,
    linksResgate,
    linksApp,
    linksPc,
    linksMoedas,
    origemPix: pix.origem
  };

  return {
    ...oferta,
    contratoComercialFinal: contrato,
    contratoComercialFinalResolvido: true,
    contratoFinalAplicado: true,
    precoDe: precoDe ?? oferta.precoDe,
    precoOriginal: precoDe ?? oferta.precoOriginal,
    precoAntigo: precoDe ?? oferta.precoAntigo,
    precoPor: precoPor ?? oferta.precoPor,
    precoAtual: precoPor ?? oferta.precoAtual,
    preco: precoPor ?? oferta.preco,
    condicaoPrecoPor: contrato.condicaoPrecoPor,
    precoPixDistinto: contrato.precoPixDistinto,
    precoPix: contrato.precoPixTexto,
    condicaoPix: "",
    cupom: contrato.cupomCodigo,
    cupomCodigo: contrato.cupomCodigo,
    codigoCupom: contrato.cupomCodigo,
    cupomTexto: contrato.cupomCodigo,
    instrucaoComercial: contrato.instrucaoComercial,
    instrucaoCupom: contrato.instrucaoComercial,
    beneficio,
    beneficioTexto: beneficio,
    beneficioExtra: beneficio,
    beneficios: beneficio ? [beneficio] : [],
    linksProduto: contrato.linksProduto.length ? contrato.linksProduto : oferta.linksProduto,
    linksResgate: contrato.linksResgate.length ? contrato.linksResgate : oferta.linksResgate,
    linksComerciais: links.length ? links : oferta.linksComerciais,
    linkProduto: primeiroUrl(contrato.linksProduto) || oferta.linkProduto,
    linkResgate: primeiroUrl(contrato.linksResgate) || oferta.linkResgate,
    linkApp: primeiroUrl(contrato.linksApp) || oferta.linkApp,
    linkPc: primeiroUrl(contrato.linksPc) || oferta.linkPc,
    linkMoedas: primeiroUrl(contrato.linksMoedas) || oferta.linkMoedas
  };
}

module.exports = {
  formatarMoeda,
  resolverContratoComercialFinal
};
