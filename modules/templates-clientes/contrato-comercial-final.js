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

function extrairPrecoRadarComercial(textoOriginal = "") {
  const fonte = texto(textoOriginal);
  if (!fonte) return {};
  const padraoValor = "((?:R\\$\\s*)?\\d{1,3}(?:\\.\\d{3})*(?:,\\d{1,2})?|(?:R\\$\\s*)?\\d+(?:[,.]\\d{1,2})?)";
  const dePor = fonte.match(new RegExp(`\\bde\\s*:?\\s*${padraoValor}\\s*(?:\\||-|\\/|,|\\s)+por\\s*:?\\s*${padraoValor}([^\\n]*)`, "i"));
  if (dePor) {
    return {
      precoDe: numeroMonetarioEmTexto(dePor[1]),
      precoPor: numeroMonetarioEmTexto(dePor[2]),
      condicaoPrecoPor: /\bpix\b/i.test(dePor[3] || "") ? "pix" : ""
    };
  }
  const por = fonte.match(new RegExp(`\\bpor\\s*:?\\s*${padraoValor}([^\\n]*)`, "i"));
  if (por) {
    return {
      precoDe: null,
      precoPor: numeroMonetarioEmTexto(por[1]),
      condicaoPrecoPor: /\bpix\b/i.test(por[2] || "") ? "pix" : ""
    };
  }
  const primeiroValor = fonte.match(new RegExp(`(?:^|\\n|\\s)${padraoValor}(?:\\s|$)`, "i"));
  if (primeiroValor) {
    return {
      precoDe: null,
      precoPor: numeroMonetarioEmTexto(primeiroValor[1]),
      condicaoPrecoPor: /\bpix\b/i.test(fonte) ? "pix" : ""
    };
  }
  return {};
}

function mesmoNumero(a, b) {
  const na = normalizarNumero(a);
  const nb = normalizarNumero(b);
  return na != null && nb != null && Math.abs(na - nb) < 0.005;
}

function textoPrecoPixConfiavel(valor = "") {
  const fonte = texto(valor);
  if (!textoPixValido(fonte) || !/\bpix\b/i.test(fonte)) return "";
  const padraoValor = "(?:(?:R\\$\\s*)?\\d{1,3}(?:\\.\\d{3})*(?:,\\d{1,2})?|(?:R\\$\\s*)?\\d+(?:[,.]\\d{1,2})?)";
  const valorAntesPix = new RegExp(`${padraoValor}\\s*(?:no|na|via|por)?\\s*pix\\b`, "i");
  const pixAntesValor = new RegExp(`\\bpix\\b\\s*:?(?:\\s*(?:no|na|via|por))?\\s*${padraoValor}`, "i");
  if (!valorAntesPix.test(fonte) && !pixAntesValor.test(fonte)) return "";
  return textoPixValido(fonte);
}

function pixExplicitamenteNoRadar(oferta = {}, textoOriginal = "") {
  if (/\bpix\b/i.test(textoOriginal)) return true;
  if (normalizarComparacao(oferta.precoPixOrigem) === "radar") return true;
  const metadata = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  if (metadata.precedenciaComercial?.camposProtegidos?.precoPix === true) return true;
  const origemComercial = normalizarComparacao([
    oferta.origem,
    oferta.fonteComercial,
    metadata.fonteComercial,
    metadata.radarEspelhoComercial?.origem
  ].filter(Boolean).join(" "));
  const confiancaPix = normalizarComparacao(oferta.confiancaComercial?.precoPix || "");
  return /\bradar\b/.test(origemComercial) && ["alta", "media"].includes(confiancaPix);
}

function resolverPrecoPixFinal(oferta = {}, precoPor = null, textoOriginal = "", precoDe = null) {
  const dePorPix = extrairDePorPix(textoOriginal);
  const candidatos = [
    oferta.precoPixDistinto,
    oferta.precoPix,
    oferta.condicaoPix
  ].map(texto).filter(Boolean);
  const condicaoPixSemValor = texto(oferta.condicaoPix || oferta.condicaoPrecoPor);
  const candidato = candidatos.find(valor => textoPrecoPixConfiavel(valor)) || "";
  const valorPix = numeroMonetarioEmTexto(candidato);

  if (dePorPix?.condicaoPrecoPor === "pix") {
    return { condicaoPrecoPor: "pix", precoPixDistinto: null, precoPixTexto: "", origem: "radar_de_por_pix" };
  }

  if (!pixExplicitamenteNoRadar(oferta, textoOriginal)) {
    return { condicaoPrecoPor: "", precoPixDistinto: null, precoPixTexto: "", origem: "pix_rejeitado_sem_radar" };
  }

  if ((!candidato || valorPix == null) && /\bpix\b/i.test(condicaoPixSemValor) && numeroMonetarioEmTexto(condicaoPixSemValor) == null && !/desconto/i.test(condicaoPixSemValor)) {
    return { condicaoPrecoPor: "pix", precoPixDistinto: null, precoPixTexto: "", origem: "condicao_pix_preco_por" };
  }

  if (!candidato || valorPix == null) {
    return { condicaoPrecoPor: "", precoPixDistinto: null, precoPixTexto: "", origem: "sem_pix_comprovado" };
  }

  if (/desconto\s+no\s+pix/i.test(candidato) && !/\bpix\b/i.test(textoOriginal)) {
    return { condicaoPrecoPor: "", precoPixDistinto: null, precoPixTexto: "", origem: "pix_rejeitado_sem_radar" };
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
  const fontesConfiaveis = [
    textoOriginal,
    oferta.textoComercialCanonico,
    oferta.documentoComercialCanonico,
    oferta.instrucaoCupom,
    oferta.condicaoCupom,
    oferta.condicaoComercial
  ];
  if (texto(textoOriginal)) {
    return fontesConfiaveis.some(fonte => cupomEmFonteExplicita(cupom, fonte));
  }

  const camposCodigo = [
    ...(Array.isArray(oferta.codigosCupom) ? oferta.codigosCupom : []),
    oferta.cupomCodigo,
    oferta.codigoCupom
  ];
  if (normalizarCuponsSemanticos(camposCodigo).some(item => normalizarComparacao(item) === normalizarComparacao(cupom))) {
    return true;
  }

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
  if (metadadoTecnicoCru(item)) return "";
  const normalizado = normalizarComparacao(item);
  if (!/\b(?:off|desconto|frete|cashback|brinde|moeda|moedas|app|pix|prime|garantia|resgate|voucher)\b|\b\d+\s*%/.test(normalizado)) return "";
  const chave = assinaturaFato(item);
  if (!chave) return "";
  if (cupom && chave === assinaturaFato(cupom)) return "";
  if (instrucao && chave === assinaturaFato(instrucao)) return "";
  return item;
}

function beneficioFinal(oferta = {}, cupom = "", instrucao = "") {
  const textoOriginal = textoOriginalComercial(oferta);
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
    if (!fatoComercialEvidenteNoRadar(beneficio, textoOriginal)) continue;
    if (chave && chave === assinaturaFato(oferta.frete || oferta.freteTexto || (oferta.freteGratis === true ? "Frete gratis" : ""))) continue;
    vistos.add(chave);
    return beneficio;
  }
  return "";
}

function valoresMonetariosAssinatura(valor = "") {
  return (texto(valor).match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|(?:R\$\s*)?\d+(?:[,.]\d{1,2})?/g) || [])
    .map(numeroMonetarioEmTexto)
    .filter(item => item != null)
    .map(item => item.toFixed(2));
}

function fatoComercialEvidenteNoRadar(valor = "", textoOriginal = "") {
  const item = texto(valor);
  const fonte = texto(textoOriginal);
  if (!item) return false;
  if (!fonte) return true;
  const itemNormalizado = normalizarComparacao(item);
  const fonteNormalizada = normalizarComparacao(fonte);
  if (itemNormalizado && fonteNormalizada.includes(itemNormalizado)) return true;
  const assinatura = assinaturaFato(item);
  if (assinatura && fonteNormalizada.includes(normalizarComparacao(item.replace(/[:*]/g, "")))) return true;
  if (/frete\s+gr[aá]tis/i.test(item) && /frete\s+gr[aá]tis/i.test(fonte)) return true;
  if (/\b(?:parcel|sem\s+juros|\d+\s*x|em\s+\d+\s*x)\b/i.test(item) && /\b(?:parcel|sem\s+juros|\d+\s*x|em\s+\d+\s*x)\b/i.test(fonte)) {
    const valoresItem = valoresMonetariosAssinatura(item);
    const valoresFonte = new Set(valoresMonetariosAssinatura(fonte));
    return !valoresItem.length || valoresItem.some(valorMonetario => valoresFonte.has(valorMonetario));
  }
  if (/\b(?:off|desconto|cashback|brinde|moeda|moedas|app|voucher)\b|\b\d+\s*%/.test(itemNormalizado)) {
    const valoresItem = valoresMonetariosAssinatura(item);
    const valoresFonte = new Set(valoresMonetariosAssinatura(fonte));
    if (valoresItem.length && valoresItem.some(valorMonetario => valoresFonte.has(valorMonetario))) return true;
  }
  return false;
}

function extrairParcelamentoRadar(textoOriginal = "") {
  const fonte = texto(textoOriginal);
  if (!fonte) return "";
  const linhas = fonte.split(/\r?\n/).map(texto).filter(Boolean);
  const linha = linhas.find(item => /\b(?:parcel|sem\s+juros|\d+\s*x|em\s+\d+\s*x)\b/i.test(item));
  if (linha) return linha;
  const match = fonte.match(/(?:ou\s*)?(?:R\$\s*)?\d{1,5}(?:[,.]\d{1,2})?\s+em\s+\d{1,2}x(?:\s+sem\s+juros)?|(?:ou\s*)?\d{1,2}x\s+de\s+(?:R\$\s*)?\d{1,5}(?:[,.]\d{1,2})?(?:\s+sem\s+juros)?/i);
  return match ? texto(match[0]) : "";
}

function parcelamentoFinal(oferta = {}, textoOriginal = "") {
  const candidato = texto(oferta.parcelamento);
  if (candidato && fatoComercialEvidenteNoRadar(candidato, textoOriginal)) return candidato;
  return extrairParcelamentoRadar(textoOriginal);
}

function extrairFreteRadar(textoOriginal = "") {
  const fonte = texto(textoOriginal);
  if (!fonte) return "";
  if (/frete\s+gr[aá]tis/i.test(fonte)) return "Frete gratis";
  const linha = fonte.split(/\r?\n/).map(texto).find(item => /\bfrete\b/i.test(item));
  return linha || "";
}

function freteFinal(oferta = {}, textoOriginal = "") {
  const candidato = texto(oferta.frete || oferta.freteTexto || (oferta.freteGratis === true ? "Frete gratis" : ""));
  const freteRadar = extrairFreteRadar(textoOriginal);
  if (freteRadar && (!candidato || metadadoTecnicoCru(candidato))) return freteRadar;
  if (candidato && fatoComercialEvidenteNoRadar(candidato, textoOriginal)) return candidato;
  return freteRadar;
}

function listaComercialEvidenteNoRadar(valores = [], textoOriginal = "") {
  const resultado = [];
  const vistos = new Set();
  for (const valor of Array.isArray(valores) ? valores : []) {
    const item = texto(valor);
    if (!item || metadadoTecnicoCru(item) || !fatoComercialEvidenteNoRadar(item, textoOriginal)) continue;
    const chave = normalizarComparacao(item);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push(item);
  }
  return resultado;
}

function metadadoTecnicoCru(valor = "") {
  const chave = normalizarComparacao(valor).replace(/[^a-z0-9]+/g, " ").trim();
  return new Set([
    "pix",
    "pagamento pix",
    "desconto pix",
    "beneficio pix",
    "beneficiopix",
    "pagamentopix",
    "frete",
    "voucher ou moedas",
    "voucher moedas",
    "voucheroumoedas"
  ]).has(chave);
}

function instrucaoExplicitaConfiavel(instrucao = "", cupom = "") {
  const valor = texto(instrucao);
  if (!valor || /https?:\/\//i.test(valor)) return "";
  if (metadadoTecnicoCru(valor)) return "";
  const n = normalizarComparacao(valor);
  if (/\bcaes\s+e\s+gatos\b/.test(n)) return "";
  if (/\b(?:programe|poupe|recorrencia|recorrente|assinatura)\b/.test(n)) return valor;
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
    const url = urlRenderizavelLinkFinal(item);
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
  return urlRenderizavelLinkFinal(item);
}

function urlTecnicaNaoRenderizavelFinal(item = {}) {
  const origem = normalizarComparacao([
    item?.origem,
    item?.proveniencia,
    item?.fonte,
    item?.campo,
    item?.tipoOrigem
  ].filter(Boolean).join(" "));
  return /\b(?:imagem|canonical|permalink|url\s+rica|url\s+tecnica|link\s+resolvido\s+imagem|importer|adapter|metadata|api|html)\b/.test(origem);
}

function urlRenderizavelLinkFinal(item = {}) {
  if (typeof item === "string") return texto(item);
  if (!item || typeof item !== "object") return "";
  const convertido = texto(
    item.urlOptimus ||
    item.urlAfiliadaWorkspace ||
    item.urlAfiliada ||
    item.afiliado ||
    item.linkAfiliado ||
    ""
  );
  if (convertido) return convertido;
  if (urlTecnicaNaoRenderizavelFinal(item)) return "";
  return "";
}

function resolverContratoComercialFinal(oferta = {}) {
  const textoOriginal = textoOriginalComercial(oferta);
  const precoRadar = extrairPrecoRadarComercial(textoOriginal);
  const precoPor = precoRadar.precoPor ?? normalizarNumero(oferta.precoPor ?? oferta.precoAtual ?? oferta.preco);
  const precoDe = precoRadar.precoDe ?? normalizarNumero(oferta.precoDe ?? oferta.precoOriginal ?? oferta.precoAntigo);
  const pix = resolverPrecoPixFinal(oferta, precoPor, textoOriginal, precoDe);
  const cupom = cupomFinal(oferta, textoOriginal);
  const instrucao = instrucaoFinal(oferta, cupom);
  const beneficio = beneficioFinal(oferta, cupom, instrucao);
  const parcelamento = parcelamentoFinal(oferta, textoOriginal);
  const frete = freteFinal(oferta, textoOriginal);
  const freteGratis = /frete\s+gr[aá]tis/i.test(frete);
  const condicoes = listaComercialEvidenteNoRadar(oferta.condicoes, textoOriginal);
  const observacoes = listaComercialEvidenteNoRadar(oferta.observacoes, textoOriginal);
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
    parcelamento,
    frete,
    freteGratis,
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
    condicaoPix: contrato.condicaoPrecoPor === "pix" ? "no Pix" : "",
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
    parcelamento,
    frete,
    freteTexto: frete,
    freteGratis,
    condicoes,
    observacoes,
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
