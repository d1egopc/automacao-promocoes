"use strict";

const { analisarValorMonetario, formatarMoedaBR } = require("../../utils/moeda");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function objeto(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function normalizarComparacao(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function chaveCupom(valor = "") {
  return normalizarComparacao(valor).replace(/[^a-z0-9_-]+/g, "").toUpperCase();
}

function numeroMonetario(valor) {
  const analise = analisarValorMonetario(valor);
  return analise.ok ? analise.numero : null;
}

function textoMoeda(valor) {
  const original = texto(valor).replace(/\s+/g, " ");
  if (/(?:US\$|USD|U\$|\u20ac|EUR)/i.test(original) || (/\$/.test(original) && !/R\$/i.test(original))) return original;
  const formatado = formatarMoedaBR(valor);
  return formatado || original;
}

function textoLimitado(valor = "", limite = 1200) {
  const fonte = texto(valor).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (fonte.length <= limite) return fonte;
  return `${fonte.slice(0, limite)}...`;
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const t = texto(valor);
    if (t) return t;
  }
  return "";
}

function primeiroValor(...valores) {
  for (const valor of valores) {
    const n = numeroMonetario(valor);
    if (n !== null) return n;
  }
  return null;
}

function linhasTexto(fonte = "") {
  return texto(fonte)
    .split(/\n+/)
    .map(linha => linha.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean);
}

function extrairTextoOriginal({ oferta = {}, ofertaEntrada = {}, evento = {}, metadata = {} } = {}) {
  const radar = objeto(metadata.radarMirror || metadata.radarEspelhoComercial || ofertaEntrada.radarMirror || ofertaEntrada.radarEspelhoComercial);
  const textoRadar = objeto(radar.texto || {}).original || radar.textoOriginal || radar.textoComercialOriginal || radar.documentoComercialCanonico;
  return primeiroTexto(
    evento.texto_original,
    evento.textoOriginal,
    ofertaEntrada.textoComercialOriginal,
    ofertaEntrada.textoOriginal,
    ofertaEntrada.documentoComercialCanonico,
    oferta.textoComercialOriginal,
    oferta.documentoComercialCanonico,
    oferta.textoOriginal,
    textoRadar,
    metadata.textoComercialOriginal,
    metadata.documentoComercialCanonico
  );
}

function limparTitulo(linha = "") {
  return texto(linha)
    .replace(/^[\s\-*>#.:;!]+/, "")
    .replace(/^(?:an[uú]ncio|#\s*an[uú]ncio)\b\s*:?\s*/i, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function linhaPareceComercial(linha = "") {
  const n = normalizarComparacao(linha);
  return /\b(de|por|cupom|resgate|confira|link|pix|parcel|frete|cashback|voucher|moeda|moedas)\b/.test(n) || /https?:\/\//i.test(linha);
}

function extrairTituloOriginal(textoOriginal = "", oferta = {}, ofertaEntrada = {}) {
  const tituloEstruturado = primeiroTexto(ofertaEntrada.tituloOriginal, ofertaEntrada.titulo, oferta.titulo, oferta.nome);
  const linhas = linhasTexto(textoOriginal);
  const linhaTitulo = linhas.find(linha => !linhaPareceComercial(linha) && limparTitulo(linha).length >= 4);
  const linhaTituloPreservada = linhas.find(linha => {
    if (/https?:\/\//i.test(linha)) return false;
    const n = normalizarComparacao(linha);
    if (/^(de|por|valor|cupom|use|utilize|aplique|resgate|frete)\b/.test(n)) return false;
    return limparTitulo(linha).length >= 4;
  });
  return primeiroTexto(limparTitulo(linhaTitulo), limparTitulo(linhaTituloPreservada), tituloEstruturado);
}

function extrairPrecosTexto(textoOriginal = "") {
  const fonte = textoOriginal.replace(/\r\n/g, "\n");
  const padraoMoeda = "((?:R\\$|US\\$|USD|U\\$|\\$)?\\s*[\\d.]+(?:[,.][\\d]{1,2})?)";
  const dePor = fonte.match(new RegExp(`\\bde\\s*:?\\s*${padraoMoeda}\\s*(?:\\||-|\\/|,|\\s)+por\\s*:?\\s*${padraoMoeda}([^\\n]*)`, "i"));
  const linhaDe = fonte.match(new RegExp(`(?:^|\\n)\\s*(?:[^\\n\\w]{0,4}\\s*)?de\\s*:?\\s*${padraoMoeda}`, "i"));
  const linhaPor = fonte.match(new RegExp(`(?:^|\\n)\\s*(?:[^\\n\\w]{0,4}\\s*)?por\\s*:?\\s*${padraoMoeda}([^\\n]*)`, "i"));
  const linhaValor = fonte.match(new RegExp(`(?:^|\\n)\\s*(?:[^\\n\\w]{0,4}\\s*)?valor\\s*:?\\s*${padraoMoeda}([^\\n]*)`, "i"));
  const linhaPrecoDireta = fonte.match(new RegExp(`(?:^|\\n)\\s*${padraoMoeda}([^\\n]*(?:cupom|pix|moeda|moedas|voucher|app|carrinho)[^\\n]*)`, "i"));
  const final = fonte.match(new RegExp(`(?:pre(?:co|c\\u00e7o)\\s*final|valor\\s*final|pague|fica\\s*por)\\D{0,24}${padraoMoeda}([^\\n]*)`, "i"));

  const precoDeTexto = dePor?.[1] || linhaDe?.[1] || "";
  const precoPorTexto = dePor?.[2] || linhaPor?.[1] || linhaValor?.[1] || linhaPrecoDireta?.[1] || "";
  const sufixoPor = recortarSufixoPreco(dePor?.[3] || linhaPor?.[2] || linhaValor?.[2] || linhaPrecoDireta?.[2] || "");
  const precoFinalTexto = final?.[1] || "";
  const sufixoFinal = recortarSufixoPreco(final?.[2] || "");

  return {
    precoDeTexto: textoMoeda(precoDeTexto),
    precoPorTexto: [textoMoeda(precoPorTexto), sufixoPor].map(texto).filter(Boolean).join(" "),
    precoFinalTexto: [textoMoeda(precoFinalTexto), sufixoFinal].map(texto).filter(Boolean).join(" "),
    precoDeValor: numeroMonetario(precoDeTexto),
    precoPorValor: numeroMonetario(precoPorTexto),
    precoFinalValor: numeroMonetario(precoFinalTexto),
    sufixoPor,
    sufixoFinal
  };
}

function removerUrls(textoEntrada = "") {
  return texto(textoEntrada).replace(/https?:\/\/\S+/gi, "").trim();
}

function recortarAntesDeDelimitadorComercial(valor = "") {
  const fonte = removerUrls(valor).replace(/\s+/g, " ").trim();
  if (!fonte) return "";
  const padroes = [
    /\b(?:cupom|c[oó]digo|cod\.?|use|utilize|aplique|resgate|link|confira|frete|cashback|voucher|moeda|moedas|benef[ií]cio)\b/i,
    /\b(?:parcelamento|parcele|em\s+at[eé]\s+\d+\s*x|\d+\s*x\s+de\s+R\$)\b/i,
    /\b(?:app|pc)\s*:/i,
    /\b(?:https?)\b/i
  ];
  let corte = fonte.length;
  for (const padrao of padroes) {
    const match = fonte.match(padrao);
    if (match && match.index > 0) corte = Math.min(corte, match.index);
  }
  return fonte.slice(0, corte).replace(/[|,;:/\-\s]+$/g, "").trim();
}

function recortarSufixoPreco(valor = "") {
  const fonte = recortarAntesDeDelimitadorComercial(valor);
  if (!fonte) return "";
  const pix = fonte.match(/\b(?:no|na|via|por)\s+pix\b/i);
  if (pix) return texto(pix[0]).replace(/\bpix\b/i, "Pix");
  const outrosMeios = fonte.match(/\b(?:no|na|via|por)\s+(?:boleto|cart[aã]o)\b/i);
  if (outrosMeios) return texto(outrosMeios[0]);
  return "";
}

function contemPrecoMonetario(valor = "") {
  return /(?:R\$|US\$|USD|U\$|\$)\s*[\d.]+(?:[,.][\d]{1,2})?/i.test(texto(valor));
}

function parecePrecoPixProprio(valor = "") {
  const fonte = recortarAntesDeDelimitadorComercial(valor);
  if (!fonte || !contemPrecoMonetario(fonte) || !/\bpix\b/i.test(fonte)) return false;
  return /\b(?:pix|preco\s+pix|preco\s+no\s+pix|preco\s+via\s+pix|valor\s+pix|valor\s+no\s+pix)\b/i.test(normalizarComparacao(fonte))
    || /(?:R\$|US\$|USD|U\$|\$)\s*[\d.]+(?:[,.][\d]{1,2})?\s*(?:no|na|via|por)\s+pix\b/i.test(fonte);
}

function extrairPrecoPixProprio(valor = "") {
  if (!parecePrecoPixProprio(valor)) return "";
  const semPrefixo = removerPrefixoComercial(
    valor,
    /^\s*(?:[^\n\w]{0,4}\s*)?(?:pre(?:co|c\u00e7o)\s*(?:no|via)?\s*pix|valor\s*(?:no|via)?\s*pix|pix)\s*:?\s*/i
  );
  return extrairPrecoComercialLimpo(semPrefixo);
}

function extrairPrecoPixDocumento({ textoOriginal = "", linhaPor = "", linhaValor = "", precoPorTexto = "", oferta = {}, ofertaEntrada = {} } = {}) {
  const linhas = linhasTexto(textoOriginal);
  const linhaPixPropria = linhas.find(linha => {
    if (!parecePrecoPixProprio(linha)) return false;
    if (linha === linhaPor || linha === linhaValor) return false;
    const n = normalizarComparacao(linha);
    return /^(?:pix|preco\s+pix|preco\s+no\s+pix|preco\s+via\s+pix|valor\s+pix|valor\s+no\s+pix)\b/.test(n)
      || /\b(?:pix|preco\s+pix|preco\s+no\s+pix|preco\s+via\s+pix|valor\s+pix|valor\s+no\s+pix)\s*:/.test(n);
  });
  const candidatos = [
    linhaPixPropria,
    ofertaEntrada.precoPix,
    oferta.precoPix,
    ofertaEntrada.condicaoPix,
    oferta.condicaoPix
  ];
  for (const candidato of candidatos) {
    const precoPix = extrairPrecoPixProprio(candidato);
    if (precoPix && !textoComercialEquivalente(precoPix, precoPorTexto)) return precoPix;
  }
  return "";
}

const CUPONS_BLOQUEADOS = new Set([
  "CUPOM", "CUPONS", "CODIGO", "COD", "DESCONTO", "PROMO", "PROMOCAO",
  "TODOS", "DESTA", "PAGINA", "RESGATE", "ANUNCIO", "HTTP", "HTTPS",
  "WWW", "COM", "BR", "COMBR", "SHOPEE", "MERCADOLIVRE", "MERCADO", "LIVRE"
]);

function cupomPlausivel(valor = "") {
  const chave = chaveCupom(valor);
  if (!chave || chave.length < 3 || chave.length > 32) return false;
  if (CUPONS_BLOQUEADOS.has(chave)) return false;
  if (!/[A-Z]/.test(chave)) return false;
  if (/^\d+$/.test(chave)) return false;
  return true;
}

function separarCupons(valor = "") {
  return texto(valor)
    .split(/\s+(?:ou|e)\s+|[,;/|]+/i)
    .map(item => item.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9_-]+$/g, "").trim())
    .filter(cupomPlausivel);
}

function dedupCupons(cupons = []) {
  const vistos = new Set();
  const saida = [];
  for (const cupom of cupons) {
    const chave = chaveCupom(cupom);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(texto(cupom));
  }
  return saida;
}

function extrairCupomTexto(textoOriginal = "", oferta = {}, ofertaEntrada = {}) {
  const candidatos = [];
  const linhas = linhasTexto(textoOriginal);
  for (const linha of linhas) {
    const marcador = linha.match(/\b(?:cupom|c[oÃƒÂ³]digo|cod\.?|use\s+o\s+cupom|utilize\s+o\s+cupom)\b\s*:?\s*([A-Z0-9][A-Z0-9_-]*(?:\s*(?:ou|e|[,;/|])\s*[A-Z0-9][A-Z0-9_-]*)*)/i);
    if (!marcador) continue;
    candidatos.push(...separarCupons(marcador[1]));
  }
  candidatos.push(...separarCupons(ofertaEntrada.cupom || ofertaEntrada.cupomCodigo || ofertaEntrada.codigoCupom || ""));
  candidatos.push(...separarCupons(oferta.cupom || oferta.cupomCodigo || oferta.codigoCupom || ""));
  const cupons = dedupCupons(candidatos);
  const linhaCupom = linhas.find(linha => /\bcupom\b/i.test(linha) && cupons.some(cupom => normalizarComparacao(linha).includes(normalizarComparacao(cupom))));
  return {
    cupons,
    cupomCodigo: cupons.join(" ou "),
    cupomTexto: texto(linhaCupom) || cupons.join(" ou ")
  };
}

function instrucaoRedundante(instrucao = "", cupomCodigo = "") {
  const normalizada = normalizarComparacao(instrucao).replace(/[^a-z0-9]+/g, " ").trim();
  const cupom = normalizarComparacao(cupomCodigo).replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalizada) return true;
  if (!cupom) return false;
  return [
    `cupom ${cupom}`,
    `codigo ${cupom}`,
    `cod ${cupom}`,
    `use o cupom ${cupom}`,
    `utilize o cupom ${cupom}`
  ].includes(normalizada);
}

function extrairInstrucaoComercial(textoOriginal = "", cupomCodigo = "", oferta = {}, ofertaEntrada = {}) {
  const estruturada = primeiroTexto(ofertaEntrada.instrucaoCupom, ofertaEntrada.instrucaoComercial, oferta.instrucaoCupom, oferta.instrucaoComercial);
  const linhas = linhasTexto(textoOriginal);
  const linha = linhas.find(item => {
    if (/https?:\/\//i.test(item)) return false;
    const n = normalizarComparacao(item);
    if (!/(aplique|resgate|use|utilize|selecione|ative|pegue|copie|garanta)/.test(n)) return false;
    if (!/(cupom|cupons|voucher|moeda|moedas|pix|app|carrinho|desconto|valor|anuncio)/.test(n)) return false;
    return true;
  });
  const instrucao = primeiroTexto(estruturada, linha);
  return instrucaoRedundante(instrucao, cupomCodigo) ? "" : instrucao;
}

function extrairFormaPagamento(textoOriginal = "", oferta = {}, ofertaEntrada = {}) {
  const estruturada = primeiroTexto(ofertaEntrada.condicaoPix, ofertaEntrada.precoPix, oferta.condicaoPix, oferta.precoPix);
  const fonte = `${textoOriginal}\n${estruturada}`;
  if (/(?:R\$|US\$|USD|U\$|\$)\s*[\d.]+(?:[,.][\d]{1,2})?\s*(?:no|na|via|por)\s+pix\b/i.test(fonte)) return "Pix";
  if (/\b(?:pre(?:co|c\u00e7o)|valor)\s*(?:no|via)?\s*pix\b\s*:?\s*(?:R\$|US\$|USD|U\$|\$)\s*[\d.]+(?:[,.][\d]{1,2})?/i.test(fonte)) return "Pix";
  return "";
}

function removerPrefixoComercial(linha = "", padrao = /^$/) {
  return texto(linha).replace(padrao, "").replace(/^[\s:|\-]+/, "").trim();
}

function primeiraLinhaOriginal(textoOriginal = "", predicado = () => false) {
  return linhasTexto(textoOriginal).find(predicado) || "";
}

function primeiraLinhaPorNormalizacao(textoOriginal = "", padrao) {
  return primeiraLinhaOriginal(textoOriginal, linha => padrao.test(normalizarComparacao(linha)));
}

function extrairTextoLinhaPreco(linha = "", tipo = "") {
  const valor = texto(linha);
  if (!valor) return "";
  if (tipo === "de") {
    const semPrefixo = removerPrefixoComercial(valor, /^\s*(?:[^\n\w]{0,4}\s*)?de\s*:?\s*/i);
    const match = semPrefixo.match(/(?:R\$|US\$|USD|U\$|\$)?\s*[\d.]+(?:[,.][\d]{1,2})?/i);
    return match ? textoMoeda(match[0]) : semPrefixo;
  }
  if (tipo === "por") return extrairPrecoComercialLimpo(removerPrefixoComercial(valor, /^\s*(?:[^\n\w]{0,4}\s*)?por\s*:?\s*/i));
  if (tipo === "valor") return extrairPrecoComercialLimpo(removerPrefixoComercial(valor, /^\s*(?:[^\n\w]{0,4}\s*)?valor\s*:?\s*/i));
  return valor;
}

function extrairPrecoComercialLimpo(valor = "") {
  const fonte = recortarAntesDeDelimitadorComercial(valor);
  const match = fonte.match(/(?:R\$|US\$|USD|U\$|\$)?\s*[\d.]+(?:[,.][\d]{1,2})?/i);
  if (!match) return "";
  const sufixo = recortarSufixoPreco(fonte.slice((match.index || 0) + match[0].length));
  return [textoMoeda(match[0]), sufixo].map(texto).filter(Boolean).join(" ");
}

function extrairParcelamentoTextoLinha(linha = "") {
  const valor = texto(linha);
  if (!valor) return "";
  const comValor = valor.match(/(?:R\$|US\$|USD|U\$|\$)?\s*[\d.]+(?:[,.][\d]{1,2})?\s*(?:em\s*)?(?:ate\s*)?\d+\s*x[^\n]*/i);
  if (comValor) return recortarAntesDeDelimitadorComercial(comValor[0]);
  const semValor = valor.match(/(?:em\s*)?(?:ate\s*)?\d+\s*x[^\n]*/i);
  return semValor ? recortarAntesDeDelimitadorComercial(semValor[0]) : recortarAntesDeDelimitadorComercial(valor);
}

function extrairBeneficioTexto(textoOriginal = "", oferta = {}, ofertaEntrada = {}) {
  const linhas = linhasTexto(textoOriginal);
  const linhaOff = linhas.find(linha => /\boff\b/i.test(linha) && /\b(?:cupom|pagina|p[aá]gina|desconto|beneficio|benef[ií]cio)\b/i.test(linha));
  if (linhaOff) {
    const match = linhaOff.match(/(?:R\$|US\$|USD|U\$|\$)?\s*[\d.]+(?:[,.][\d]{1,2})?\s*off\b[^|\n]*(?:cupom|p[aá]gina|desconto|benef[ií]cio)?[^|\n]*/i);
    if (match) {
      return removerUrls(match[0])
        .replace(/\b(?:link|confira|resgate|frete|cashback|parcelamento)\b.*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
    }
  }
  return primeiroTexto(ofertaEntrada.beneficioExtra, ofertaEntrada.beneficioTexto, oferta.beneficioExtra, oferta.beneficioTexto);
}

const ORDEM_BLOCOS_COMERCIAIS_V26 = Object.freeze({
  titulo: 10,
  subtitulo_comercial: 15,
  marketplace: 20,
  categoria: 30,
  vendedor: 35,
  origem_brasil: 38,
  observacao_comercial: 40,
  especificacao_util: 45,
  preco_referencia: 50,
  preco_oferta: 60,
  preco_pix: 65,
  preco_final_condicionado: 70,
  parcelamento: 80,
  valor_parcela: 82,
  quantidade_parcelas: 84,
  economia: 90,
  desconto_percentual: 95,
  faixa_preco: 100,
  preco_variacao: 105,
  moeda: 110,
  requisito_preco: 115,
  cupom_codigo: 120,
  cupons_alternativos: 122,
  cupom_percentual: 124,
  cupom_valor: 126,
  cupom_teto: 128,
  cupom_minimo_compra: 130,
  cupom_sem_codigo: 132,
  instrucao_cupom: 135,
  cashback: 140,
  moedas: 145,
  frete: 150,
  prime_programa: 155,
  garantia: 160,
  pre_venda: 165,
  prazo_envio: 170,
  beneficio_app: 175,
  beneficio: 180,
  avaliacao_nota: 190,
  avaliacao_quantidade: 195,
  vendas: 200,
  selo_mais_vendido: 205,
  link_produto_original: 210,
  link_expandido: 212,
  link_afiliado: 215,
  link_resgate: 220,
  link_app: 225,
  link_pc: 230,
  link_moedas: 235,
  links_produto_alternativos: 240,
  link_auxiliar: 245,
  link_fonte_ignorado: 250,
  aviso: 260,
  rodape: 270,
  texto_personalizado: 280
});

const TIPOS_BLOCOS_COMERCIAIS_V26 = Object.freeze(Object.keys(ORDEM_BLOCOS_COMERCIAIS_V26));

function valorBlocoComparacao(valor) {
  if (valor == null) return "";
  if (typeof valor === "object") {
    try {
      return JSON.stringify(valor);
    } catch (_) {
      return "";
    }
  }
  return texto(valor);
}

function valorEstruturadoUtil(valor) {
  if (valor === null || valor === undefined || valor === "") return false;
  if (Array.isArray(valor)) return valor.length > 0;
  if (typeof valor === "object") {
    return Object.values(valor).some(item => valorEstruturadoUtil(item));
  }
  return true;
}

function dedupeKeyBloco(tipo = "", textoOriginal = "", valorEstruturado = null, origem = "") {
  return [
    texto(tipo),
    normalizarComparacao(textoOriginal || valorBlocoComparacao(valorEstruturado)).replace(/\s+/g, " ").trim(),
    normalizarComparacao(origem).replace(/\s+/g, "_")
  ].filter(Boolean).join(":").slice(0, 240);
}

function criarBlocoComercial({
  tipo = "",
  textoOriginal = null,
  valorEstruturado = null,
  moeda = null,
  origem = "",
  confianca = "media",
  essencial = false,
  requisitos = [],
  visibilidadePadrao = "opcional",
  avisos = [],
  metadata = {}
} = {}) {
  const tipoNormalizado = texto(tipo);
  if (!TIPOS_BLOCOS_COMERCIAIS_V26.includes(tipoNormalizado)) return null;
  const textoPreservado = texto(textoOriginal);
  const temValor = valorEstruturadoUtil(valorEstruturado);
  if (!textoPreservado && !temValor) return null;
  const ordemSugerida = ORDEM_BLOCOS_COMERCIAIS_V26[tipoNormalizado];
  const origemBloco = texto(origem) || "documento_comercial_canonico";
  const chave = dedupeKeyBloco(tipoNormalizado, textoPreservado, valorEstruturado, origemBloco);
  if (!chave) return null;
  return {
    id: "",
    tipo: tipoNormalizado,
    textoOriginal: textoPreservado || null,
    valorEstruturado: temValor ? valorEstruturado : null,
    moeda: moeda || null,
    origem: origemBloco,
    confianca: texto(confianca) || "media",
    essencial: essencial === true,
    requisitos: [...new Set(lista(requisitos).map(texto).filter(Boolean))],
    ordemSugerida,
    visibilidadePadrao: essencial === true ? "obrigatorio" : (texto(visibilidadePadrao) || "opcional"),
    dedupeKey: chave,
    avisos: [...new Set(lista(avisos).map(texto).filter(Boolean))],
    metadata: objeto(metadata)
  };
}

function adicionarBlocoComercial(blocos = [], entrada = {}) {
  const bloco = criarBlocoComercial(entrada);
  if (!bloco) return false;
  if (blocos.some(item => item.dedupeKey === bloco.dedupeKey)) return false;
  blocos.push(bloco);
  return true;
}

function finalizarBlocosComerciais(blocos = []) {
  return blocos
    .sort((a, b) => a.ordemSugerida - b.ordemSugerida || a.tipo.localeCompare(b.tipo) || a.dedupeKey.localeCompare(b.dedupeKey))
    .map((bloco, indice) => ({ ...bloco, id: `b${String(indice + 1).padStart(3, "0")}_${bloco.tipo}` }));
}

function cupomNecessarioParaPreco(doc = {}) {
  const fonte = normalizarComparacao([
    doc.precoPorTexto,
    doc.precoPixTexto,
    doc.instrucaoTexto,
    doc.beneficioTexto,
    ...(Array.isArray(doc.condicoesComerciais) ? doc.condicoesComerciais : [])
  ].filter(Boolean).join(" "));
  return /\b(?:cupom|codigo|cod|voucher)\b/.test(fonte);
}

function pixNecessarioParaPreco(doc = {}) {
  return /\bpix\b/i.test(texto(`${doc.precoPorTexto || ""} ${doc.precoPixTexto || ""}`));
}

function moedaDoTextoPreco(valor = "", fallback = "") {
  const fonte = texto(valor);
  if (/US\$|USD|U\$|\$/i.test(fonte) && !/R\$/i.test(fonte)) return "USD";
  if (/EUR|€/.test(fonte)) return "EUR";
  if (/R\$/i.test(fonte)) return "BRL";
  return texto(fallback) || null;
}

function extrairParcelamentoEstruturado(valor = "") {
  const fonte = texto(valor);
  const match = fonte.match(/(\d+)\s*x(?:\s*de)?\s*((?:R\$|US\$|USD|U\$|\$)?\s*[\d.]+(?:[,.]\d{1,2})?)/i);
  if (!match) return null;
  return {
    quantidade: Number(match[1]),
    valorParcela: numeroMonetario(match[2]),
    semJuros: /\bsem\s+juros\b/i.test(fonte)
  };
}

function textoPossuiNotaReal(valor = "") {
  const fonte = texto(valor);
  const numero = Number(fonte.replace(",", "."));
  return Number.isFinite(numero) && numero >= 1 && numero <= 5;
}

function primeiroNumeroTexto(valor = "") {
  const match = texto(valor).match(/\d+[\d.]*/);
  return match ? Number(match[0].replace(/\./g, "")) : null;
}

function contextoUrlNoTexto(textoOriginal = "", url = "") {
  const alvo = texto(url);
  if (!alvo) return "";
  return urlsDoTexto(textoOriginal).find(item => item.url === alvo)?.linha || "";
}

function classificarTipoLinkBloco(item = {}, textoOriginal = "", marketplace = "") {
  const url = texto(item.url);
  const tipo = texto(item.tipo);
  const contexto = normalizarComparacao(contextoUrlNoTexto(textoOriginal, url));
  const mp = normalizarComparacao(marketplace);
  if (/chat\.whatsapp|whatsapp\.com|t\.me|telegram|grupo|canal/i.test(url)) return "link_fonte_ignorado";
  if (/youtube\.com|youtu\.be|instagram\.com|facebook\.com|x\.com|twitter\.com/i.test(url)) return "link_auxiliar";
  if (mp === "amazon" && tipo === "resgate") return "link_produto_original";
  if (tipo === "resgate") return "link_resgate";
  if (tipo === "app") return "link_app";
  if (tipo === "pc") return "link_pc";
  if (tipo === "moedas" || /\bmoeda|moedas|coins?\b/.test(contexto)) return "link_moedas";
  if (tipo === "produto" && mp === "aliexpress" && /\bapp\b/.test(contexto)) return "link_app";
  if (tipo === "produto" && mp === "aliexpress" && /\bpc|site\b/.test(contexto)) return "link_pc";
  return "link_produto_original";
}

function adicionarBlocosDeLinks(blocos = [], doc = {}, contexto = {}) {
  const links = (Array.isArray(doc.linksComerciais) ? doc.linksComerciais : [])
    .filter(item => !textoComercialEquivalente(item?.url || "", doc.linkAfiliado || ""));
  const produtos = links.filter(item => classificarTipoLinkBloco(item, contexto.textoOriginal, doc.marketplace) === "link_produto_original");
  const produtosAmbiguos = produtos.length > 1;

  if (doc.linkAfiliado) {
    adicionarBlocoComercial(blocos, {
      tipo: "link_afiliado",
      textoOriginal: doc.linkAfiliado,
      valorEstruturado: { url: doc.linkAfiliado },
      origem: "documento.linkAfiliado",
      confianca: "alta",
      essencial: true,
      visibilidadePadrao: "obrigatorio"
    });
  }

  for (const item of links) {
    let tipoBloco = classificarTipoLinkBloco(item, contexto.textoOriginal, doc.marketplace);
    const avisos = [];
    if (tipoBloco === "link_produto_original" && produtosAmbiguos) {
      tipoBloco = "links_produto_alternativos";
      avisos.push("links_produto_ambiguos");
    }
    adicionarBlocoComercial(blocos, {
      tipo: tipoBloco,
      textoOriginal: item.url,
      valorEstruturado: { url: item.url, papelOriginal: item.tipo || "" },
      origem: "documento.linksComerciais",
      confianca: tipoBloco === "link_fonte_ignorado" ? "alta" : "media",
      essencial: ["link_resgate"].includes(tipoBloco) ? linkResgateEssencial(doc, {}) : false,
      visibilidadePadrao: tipoBloco === "link_fonte_ignorado" ? "oculto" : "padrao",
      avisos
    });
  }
}

function construirBlocosComerciaisCanonicosV26(doc = {}, contexto = {}) {
  const blocos = [];
  const moedaPadrao = texto(contexto.comercialNormalizado?.moeda || contexto.oferta?.moeda || contexto.ofertaEntrada?.moeda || "");
  const cupomEssencial = cupomNecessarioParaPreco(doc);
  const requisitosPreco = [];
  if (pixNecessarioParaPreco(doc)) requisitosPreco.push("pagamento_pix");
  if (cupomEssencial) requisitosPreco.push("cupom");

  adicionarBlocoComercial(blocos, { tipo: "titulo", textoOriginal: doc.tituloOriginal, origem: "documento.tituloOriginal", confianca: doc.tituloOriginal ? "alta" : "baixa", essencial: true, visibilidadePadrao: "obrigatorio" });
  adicionarBlocoComercial(blocos, { tipo: "marketplace", textoOriginal: doc.marketplace, origem: "documento.marketplace", confianca: "alta" });
  adicionarBlocoComercial(blocos, { tipo: "categoria", textoOriginal: primeiroTexto(contexto.ofertaEntrada?.categoria, contexto.oferta?.categoria, contexto.comercialNormalizado?.categoria), origem: "campos_estruturados.categoria", confianca: "media" });
  adicionarBlocoComercial(blocos, { tipo: "vendedor", textoOriginal: primeiroTexto(contexto.ofertaEntrada?.vendedor, contexto.ofertaEntrada?.seller, contexto.oferta?.vendedor, contexto.oferta?.seller), origem: "campos_estruturados.vendedor", confianca: "media" });

  if (/\b(?:direto\s+do\s+brasil|produto\s+no\s+brasil|estoque\s+no\s+brasil)\b/i.test(contexto.textoOriginal || "")) {
    adicionarBlocoComercial(blocos, { tipo: "origem_brasil", textoOriginal: "Direto do Brasil", origem: "texto_comercial_original", confianca: "media" });
  }

  adicionarBlocoComercial(blocos, { tipo: "preco_referencia", textoOriginal: doc.precoDeTexto, valorEstruturado: { valor: numeroMonetario(doc.precoDeTexto) }, moeda: moedaDoTextoPreco(doc.precoDeTexto, moedaPadrao), origem: "documento.precoDeTexto", confianca: "alta" });
  adicionarBlocoComercial(blocos, { tipo: "preco_oferta", textoOriginal: doc.precoPorTexto, valorEstruturado: { valor: numeroMonetario(doc.precoPorTexto) }, moeda: moedaDoTextoPreco(doc.precoPorTexto, moedaPadrao), origem: "documento.precoPorTexto", confianca: "alta", essencial: true, requisitos: requisitosPreco, visibilidadePadrao: "obrigatorio" });
  adicionarBlocoComercial(blocos, { tipo: "preco_pix", textoOriginal: doc.precoPixTexto, valorEstruturado: { valor: numeroMonetario(doc.precoPixTexto) }, moeda: moedaDoTextoPreco(doc.precoPixTexto, moedaPadrao), origem: "documento.precoPixTexto", confianca: "alta", essencial: true, requisitos: ["pagamento_pix"], visibilidadePadrao: "obrigatorio" });

  const precoFinal = primeiroTexto(contexto.precosTexto?.precoFinalTexto, contexto.espelhoComercial?.precoFinalTexto);
  if (precoFinal && !textoComercialEquivalente(precoFinal, doc.precoPorTexto)) {
    adicionarBlocoComercial(blocos, { tipo: "preco_final_condicionado", textoOriginal: precoFinal, valorEstruturado: { valor: numeroMonetario(precoFinal) }, moeda: moedaDoTextoPreco(precoFinal, moedaPadrao), origem: "precosTexto.precoFinalTexto", confianca: "alta", essencial: true, requisitos: requisitosPreco, visibilidadePadrao: "obrigatorio" });
  }

  const parcelamentoEstruturado = extrairParcelamentoEstruturado(doc.parcelamentoTexto);
  adicionarBlocoComercial(blocos, { tipo: "parcelamento", textoOriginal: doc.parcelamentoTexto, valorEstruturado: parcelamentoEstruturado, moeda: moedaDoTextoPreco(doc.parcelamentoTexto, moedaPadrao), origem: "documento.parcelamentoTexto", confianca: "media" });
  if (parcelamentoEstruturado?.valorParcela != null) adicionarBlocoComercial(blocos, { tipo: "valor_parcela", textoOriginal: doc.parcelamentoTexto, valorEstruturado: { valor: parcelamentoEstruturado.valorParcela }, moeda: moedaDoTextoPreco(doc.parcelamentoTexto, moedaPadrao), origem: "documento.parcelamentoTexto", confianca: "media" });
  if (parcelamentoEstruturado?.quantidade != null) adicionarBlocoComercial(blocos, { tipo: "quantidade_parcelas", textoOriginal: `${parcelamentoEstruturado.quantidade}x`, valorEstruturado: { quantidade: parcelamentoEstruturado.quantidade }, origem: "documento.parcelamentoTexto", confianca: "media" });

  adicionarBlocoComercial(blocos, { tipo: "economia", textoOriginal: primeiroTexto(contexto.ofertaEntrada?.economia, contexto.oferta?.economia, contexto.comercialNormalizado?.economia), origem: "campos_estruturados.economia", confianca: "media" });
  adicionarBlocoComercial(blocos, { tipo: "desconto_percentual", textoOriginal: primeiroTexto(contexto.ofertaEntrada?.descontoPercentual, contexto.ofertaEntrada?.desconto, contexto.oferta?.descontoPercentual, contexto.oferta?.desconto, contexto.comercialNormalizado?.descontoPercentual), origem: "campos_estruturados.desconto", confianca: "media" });
  adicionarBlocoComercial(blocos, { tipo: "moeda", textoOriginal: moedaDoTextoPreco(`${doc.precoPorTexto || ""} ${doc.precoPixTexto || ""}`, moedaPadrao), origem: "documento.precos", confianca: "media" });
  for (const requisito of requisitosPreco) adicionarBlocoComercial(blocos, { tipo: "requisito_preco", textoOriginal: requisito, origem: "documento.requisitos_preco", confianca: "alta", essencial: true, visibilidadePadrao: "obrigatorio" });

  const cupons = dedupCupons(separarCupons(doc.cupomTexto));
  cupons.forEach((cupom, indice) => {
    adicionarBlocoComercial(blocos, {
      tipo: indice === 0 ? "cupom_codigo" : "cupons_alternativos",
      textoOriginal: cupom,
      valorEstruturado: { codigo: cupom },
      origem: "documento.cupomTexto",
      confianca: lista(doc.confianca?.motivos).includes("cupom_explicito") ? "alta" : "media",
      essencial: cupomEssencial,
      requisitos: cupomEssencial ? ["preco_condicionado"] : [],
      visibilidadePadrao: cupomEssencial ? "obrigatorio" : "padrao"
    });
  });

  adicionarBlocoComercial(blocos, { tipo: "cupom_valor", textoOriginal: primeiroTexto(contexto.ofertaEntrada?.valorCupom, contexto.ofertaEntrada?.cupomValor, contexto.oferta?.valorCupom, contexto.oferta?.cupomValor), origem: "campos_estruturados.cupom_valor", confianca: "media" });
  adicionarBlocoComercial(blocos, { tipo: "cupom_percentual", textoOriginal: primeiroTexto(contexto.ofertaEntrada?.percentualCupom, contexto.ofertaEntrada?.cupomPercentual, contexto.oferta?.percentualCupom, contexto.oferta?.cupomPercentual), origem: "campos_estruturados.cupom_percentual", confianca: "media" });
  if (!cupons.length && /\b(?:resgate|ative|aplique|selecione).{0,40}\b(?:cupom|voucher)\b/i.test(`${doc.instrucaoTexto || ""} ${doc.beneficioTexto || ""} ${doc.resgateTexto || ""}`)) {
    adicionarBlocoComercial(blocos, { tipo: "cupom_sem_codigo", textoOriginal: primeiroTexto(doc.instrucaoTexto, doc.beneficioTexto, doc.resgateTexto), origem: "documento.instrucao_cupom", confianca: "media", essencial: cupomNecessarioParaPreco(doc), requisitos: ["resgate_no_anuncio"] });
  }
  adicionarBlocoComercial(blocos, { tipo: "instrucao_cupom", textoOriginal: doc.instrucaoTexto, origem: "documento.instrucaoTexto", confianca: "alta", essencial: cupomNecessarioParaPreco(doc), requisitos: cupomEssencial ? ["cupom"] : [] });

  adicionarBlocoComercial(blocos, { tipo: "cashback", textoOriginal: doc.cashbackTexto, origem: "documento.cashbackTexto", confianca: "media" });
  if (/\bmoeda|moedas|coins?\b/i.test(`${contexto.textoOriginal || ""} ${doc.beneficioTexto || ""}`)) adicionarBlocoComercial(blocos, { tipo: "moedas", textoOriginal: primeiroTexto(doc.beneficioTexto, "Moedas"), origem: "texto_comercial_original", confianca: "media" });
  adicionarBlocoComercial(blocos, { tipo: "frete", textoOriginal: doc.freteTexto, origem: "documento.freteTexto", confianca: "media" });
  if (/\bprime\b/i.test(`${contexto.textoOriginal || ""} ${doc.beneficioTexto || ""}`)) adicionarBlocoComercial(blocos, { tipo: "prime_programa", textoOriginal: primeiroTexto(doc.beneficioTexto, "Prime"), origem: "texto_comercial_original", confianca: "media" });
  if (/\bgarantia\b/i.test(`${contexto.textoOriginal || ""} ${doc.beneficioTexto || ""}`)) adicionarBlocoComercial(blocos, { tipo: "garantia", textoOriginal: primeiraLinhaPorNormalizacao(contexto.textoOriginal, /\bgarantia\b/) || doc.beneficioTexto, origem: "texto_comercial_original", confianca: "media" });
  if (/\bpre\s*venda|pré\s*venda\b/i.test(contexto.textoOriginal || "")) adicionarBlocoComercial(blocos, { tipo: "pre_venda", textoOriginal: primeiraLinhaPorNormalizacao(contexto.textoOriginal, /\bpre\s*venda|pre venda\b/) || "Pré-venda", origem: "texto_comercial_original", confianca: "media" });
  if (/\bprazo|envio\b/i.test(contexto.textoOriginal || "")) adicionarBlocoComercial(blocos, { tipo: "prazo_envio", textoOriginal: primeiraLinhaPorNormalizacao(contexto.textoOriginal, /\bprazo|envio\b/), origem: "texto_comercial_original", confianca: "media" });
  if (/\bapp\b/i.test(`${contexto.textoOriginal || ""} ${doc.beneficioTexto || ""}`)) adicionarBlocoComercial(blocos, { tipo: "beneficio_app", textoOriginal: doc.beneficioTexto || primeiraLinhaPorNormalizacao(contexto.textoOriginal, /\bapp\b/), origem: "texto_comercial_original", confianca: "media" });
  adicionarBlocoComercial(blocos, { tipo: "beneficio", textoOriginal: doc.beneficioTexto, origem: "documento.beneficioTexto", confianca: "media" });

  const avaliacao = primeiroTexto(contexto.ofertaEntrada?.avaliacao, contexto.ofertaEntrada?.rating, contexto.ofertaEntrada?.nota, contexto.oferta?.avaliacao, contexto.oferta?.rating, contexto.oferta?.nota, contexto.comercialNormalizado?.avaliacao?.texto);
  if (textoPossuiNotaReal(avaliacao)) adicionarBlocoComercial(blocos, { tipo: "avaliacao_nota", textoOriginal: avaliacao, valorEstruturado: { nota: Number(avaliacao.replace(",", ".")) }, origem: "campos_estruturados.avaliacao", confianca: "media" });
  const avaliacoesQtd = primeiroTexto(contexto.ofertaEntrada?.quantidadeAvaliacoes, contexto.ofertaEntrada?.avaliacoes, contexto.oferta?.quantidadeAvaliacoes, contexto.oferta?.avaliacoes);
  adicionarBlocoComercial(blocos, { tipo: "avaliacao_quantidade", textoOriginal: avaliacoesQtd, valorEstruturado: { quantidade: primeiroNumeroTexto(avaliacoesQtd) }, origem: "campos_estruturados.avaliacoes", confianca: "media" });
  const vendas = primeiroTexto(contexto.ofertaEntrada?.vendas, contexto.ofertaEntrada?.quantidadeVendida, contexto.oferta?.vendas, contexto.oferta?.quantidadeVendida);
  adicionarBlocoComercial(blocos, { tipo: "vendas", textoOriginal: vendas, valorEstruturado: { quantidade: primeiroNumeroTexto(vendas) }, origem: "campos_estruturados.vendas", confianca: "media" });
  if (/\bmais\s+vendido|best\s*seller\b/i.test(contexto.textoOriginal || "")) adicionarBlocoComercial(blocos, { tipo: "selo_mais_vendido", textoOriginal: primeiraLinhaPorNormalizacao(contexto.textoOriginal, /\bmais\s+vendido|best seller\b/) || "Mais vendido", origem: "texto_comercial_original", confianca: "media" });

  adicionarBlocosDeLinks(blocos, doc, contexto);
  for (const aviso of lista(doc.avisos)) adicionarBlocoComercial(blocos, { tipo: "aviso", textoOriginal: aviso, origem: "documento.avisos", confianca: "media" });

  return finalizarBlocosComerciais(blocos);
}

function resumoBlocosComerciaisV26(documento = {}) {
  const blocos = Array.isArray(documento.blocos) ? documento.blocos : [];
  const tiposPresentes = [...new Set(blocos.map(bloco => bloco.tipo).filter(Boolean))];
  return {
    totalBlocos: blocos.length,
    tiposPresentes,
    totalEssenciais: blocos.filter(bloco => bloco.essencial === true).length,
    totalOpcionais: blocos.filter(bloco => bloco.essencial !== true).length,
    totalLinks: blocos.filter(bloco => /^link/.test(bloco.tipo)).length,
    avisos: [...new Set([
      ...lista(documento.avisos),
      ...blocos.flatMap(bloco => lista(bloco.avisos))
    ].map(texto).filter(Boolean))].slice(0, 12)
  };
}

function logBlocosComerciaisV26(tag = "", documento = {}, contexto = {}) {
  try {
    const resumo = resumoBlocosComerciaisV26(documento);
    console.log(tag, JSON.stringify({
      workspaceId: contexto.workspaceId || "",
      jobId: contexto.jobId || null,
      ofertaId: contexto.ofertaId || null,
      marketplace: contexto.marketplace || documento.marketplace || "",
      ...resumo,
      aplicouMudancasOperacionais: false
    }));
  } catch (_) {
    // Observabilidade Shadow nunca pode interferir no pipeline.
  }
}

function extrairDocumentoComercialCanonico({
  textoOriginal = "",
  tituloOriginal = "",
  precosTexto = {},
  cupom = {},
  instrucaoComercial = "",
  formaPagamentoTexto = "",
  condicoesComerciais = [],
  links = {},
  linkAfiliado = "",
  marketplace = "",
  imagemComercial = {},
  oferta = {},
  ofertaEntrada = {},
  comercialNormalizado = {},
  avisos = [],
  motivosConfianca = []
} = {}) {
  const linhaDe = primeiraLinhaPorNormalizacao(textoOriginal, /^\s*(?:de)\b/);
  const linhaPor = primeiraLinhaPorNormalizacao(textoOriginal, /^\s*(?:por)\b/);
  const linhaValor = primeiraLinhaPorNormalizacao(textoOriginal, /^\s*(?:valor)\b/);
  const linhaParcelamento = primeiraLinhaPorNormalizacao(textoOriginal, /\b(?:parcel|\d+\s*x\s*de|ate\s+\d+x|em\s+\d+x|vezes)\b/);
  const linhaCashback = primeiraLinhaOriginal(textoOriginal, linha => /\bcashback\b/i.test(linha) && (/(?:R\$|US\$|USD|U\$|\$|\d)/i.test(linha) || /^\s*cashback\b/i.test(linha)));
  const linhaFrete = primeiraLinhaPorNormalizacao(textoOriginal, /\bfrete\b/);
  const linhaResgate = primeiraLinhaPorNormalizacao(textoOriginal, /\bresgate\b/);
  const linhaBeneficio = primeiraLinhaPorNormalizacao(textoOriginal, /\b(?:beneficio|app|prime|voucher|moeda|moedas|direto do brasil|pre venda|pré venda)\b/);

  const precoDeTexto = extrairTextoLinhaPreco(linhaDe, "de") || precosTexto.precoDeTexto || "";
  const precoPorTexto = extrairTextoLinhaPreco(linhaPor, "por") || extrairTextoLinhaPreco(linhaValor, "valor") || precosTexto.precoPorTexto || "";
  const precoPixTexto = extrairPrecoPixDocumento({ textoOriginal, linhaPor, linhaValor, precoPorTexto, oferta, ofertaEntrada });
  const parcelamentoTexto = primeiroTexto(
    ofertaEntrada.parcelamento,
    oferta.parcelamento,
    comercialNormalizado.parcelamento?.texto,
    extrairParcelamentoTextoLinha(linhaParcelamento)
  );
  const cashbackTexto = texto(linhaCashback) || primeiroTexto(ofertaEntrada.cashback, oferta.cashback);
  const freteTexto = texto(linhaFrete) || primeiroTexto(ofertaEntrada.frete, oferta.frete, oferta.freteGratis === true ? "Frete gratis" : "");
  const beneficioTexto = extrairBeneficioTexto(textoOriginal, oferta, ofertaEntrada) || texto(linhaBeneficio);
  const instrucaoTexto = texto(instrucaoComercial);
  const cupomTexto = texto(cupom.cupomCodigo || cupom.cupomTexto || ofertaEntrada.cupom || oferta.cupom);

  const documento = {
    tituloOriginal: tituloOriginal || null,
    descricaoOriginal: textoOriginal || null,
    precoDeTexto: precoDeTexto || null,
    precoPorTexto: precoPorTexto || null,
    precoPixTexto: precoPixTexto || null,
    parcelamentoTexto: parcelamentoTexto || null,
    cupomTexto: cupomTexto || null,
    beneficioTexto: beneficioTexto || null,
    instrucaoTexto: instrucaoTexto || null,
    cashbackTexto: cashbackTexto || null,
    freteTexto: freteTexto || null,
    resgateTexto: texto(linhaResgate) || null,
    linkProdutoOriginal: links.linkProdutoOriginal || null,
    linkResgateOriginal: links.linkResgateOriginal || null,
    linkAfiliado: linkAfiliado || null,
    linksComerciais: Array.isArray(links.links) ? links.links.map(item => ({ tipo: item.tipo, url: item.url })).filter(item => item.url) : [],
    imagemComercial: imagemComercial && Object.keys(imagemComercial).length ? { ...imagemComercial } : null,
    marketplace: marketplace || null,
    origemDocumento: textoOriginal ? "texto_comercial_original" : "campos_estruturados_parciais",
    confianca: {
      confiavel: motivosConfianca.includes("preco_explicito_na_captura") || Boolean(cupomTexto && (precoPorTexto || precoPixTexto)),
      motivos: [...new Set(motivosConfianca.filter(Boolean))]
    },
    avisos: [...new Set((avisos || []).filter(Boolean))],
    condicoesComerciais: [...new Set((condicoesComerciais || []).map(texto).filter(Boolean))]
  };

  try {
    documento.blocos = construirBlocosComerciaisCanonicosV26(documento, {
      textoOriginal,
      oferta,
      ofertaEntrada,
      comercialNormalizado,
      precosTexto
    });
  } catch (erro) {
    documento.blocos = [];
    documento.erroBlocosComerciais = {
      motivo: "biblioteca_blocos_exception",
      erro: String(erro?.message || "erro_desconhecido").slice(0, 180),
      aplicouMudancasOperacionais: false
    };
  }

  return documento;
}

function adicionarUnico(listaSaida, valor) {
  const item = texto(valor);
  if (!item) return;
  const chave = normalizarComparacao(item);
  if (listaSaida.some(existente => normalizarComparacao(existente) === chave)) return;
  listaSaida.push(item);
}

function extrairCondicoes({ textoOriginal = "", oferta = {}, ofertaEntrada = {}, comercialNormalizado = {} } = {}) {
  const condicoes = [];
  const fonte = textoOriginal;
  if (/\bpix\b/i.test(fonte) || oferta.precoPix || oferta.condicaoPix || ofertaEntrada.precoPix || ofertaEntrada.condicaoPix) adicionarUnico(condicoes, "pagamento_pix");
  if (/\b(?:voucher|moeda|moedas)\b/i.test(fonte)) adicionarUnico(condicoes, "voucher_ou_moedas");
  if (/\bcashback\b/i.test(fonte) || oferta.cashback || ofertaEntrada.cashback) adicionarUnico(condicoes, primeiroTexto(oferta.cashback, ofertaEntrada.cashback, "cashback"));
  if (/\bfrete\b/i.test(fonte) || oferta.frete || ofertaEntrada.frete) adicionarUnico(condicoes, primeiroTexto(oferta.frete, ofertaEntrada.frete, "frete"));
  const parcelamento = primeiroTexto(oferta.parcelamento, ofertaEntrada.parcelamento, comercialNormalizado.parcelamento?.texto);
  if (parcelamento) adicionarUnico(condicoes, parcelamento);
  const beneficios = [...lista(oferta.beneficios), ...lista(ofertaEntrada.beneficios)];
  for (const beneficio of beneficios) adicionarUnico(condicoes, beneficio);
  return condicoes.slice(0, 12);
}

function urlsDoTexto(textoOriginal = "") {
  const urls = [];
  const linhas = linhasTexto(textoOriginal);
  for (let indice = 0; indice < linhas.length; indice += 1) {
    const linha = linhas[indice];
    const linhaSemUrl = linha.replace(/https?:\/\/[^\s)]+/gi, "").trim();
    const contextoAnterior = indice > 0 && !linhaSemUrl && !/https?:\/\//i.test(linhas[indice - 1]) ? linhas[indice - 1] : "";
    const contexto = `${contextoAnterior} ${linha}`.trim();
    const matches = linha.match(/https?:\/\/[^\s)]+/gi) || [];
    for (const url of matches) urls.push({ url: texto(url), linha: contexto || linha });
  }
  return urls;
}

function valorUrl(item = {}) {
  if (typeof item === "string") return texto(item);
  if (!item || typeof item !== "object") return "";
  return primeiroTexto(item.afiliado, item.linkAfiliado, item.resolvido, item.url_expandida, item.urlNormalizada, item.original, item.url_original, item.link, item.url);
}

function adicionarLinkUnico(saida, url, tipo = "produto") {
  const valor = texto(url);
  if (!valor) return;
  const chave = valor.replace(/#.*$/, "");
  if (saida.some(item => item.url.replace(/#.*$/, "") === chave)) return;
  saida.push({ url: valor, tipo });
}

function extrairLinksComerciais({ textoOriginal = "", oferta = {}, ofertaEntrada = {}, link = {} } = {}) {
  const links = [];
  for (const item of urlsDoTexto(textoOriginal)) {
    const n = normalizarComparacao(item.linha);
    const tipo = /\bapp\b/.test(n)
      ? "app"
      : (/\bpc\b|\bsite\b/.test(n)
        ? "pc"
        : (/\b(?:link|confira|produto)\b/.test(n)
          ? "produto"
          : (/(resgate|cupom|voucher)/.test(n) ? "resgate" : "produto")));
    adicionarLinkUnico(links, item.url, tipo);
  }
  for (const item of lista(ofertaEntrada.linksProduto)) adicionarLinkUnico(links, valorUrl(item), "produto");
  for (const item of lista(ofertaEntrada.linksResgate)) adicionarLinkUnico(links, valorUrl(item), "resgate");
  for (const item of lista(oferta.linksProduto)) adicionarLinkUnico(links, valorUrl(item), "produto");
  for (const item of lista(oferta.linksResgate)) adicionarLinkUnico(links, valorUrl(item), "resgate");
  adicionarLinkUnico(links, oferta.linkOriginal || link.url_original || ofertaEntrada.linkOriginal, "produto");
  if (!links.some(item => item.tipo === "produto")) adicionarLinkUnico(links, oferta.linkAfiliado || ofertaEntrada.linkAfiliado, "produto");
  const produtos = links.filter(item => item.tipo === "produto");
  return {
    linkProdutoOriginal: produtos.length === 1 ? produtos[0].url : "",
    linkResgateOriginal: links.find(item => item.tipo === "resgate")?.url || "",
    produtosAmbiguos: produtos.length > 1,
    links
  };
}

function imagemPossuiMarcaFonte(url = "", origem = "") {
  const fonte = normalizarComparacao(`${url} ${origem}`);
  return /(whatsapp|telegram|grupo|canal|radar|fonte|print|screenshot|thumb|avatar|logo)/.test(fonte);
}

function classificarImagem(candidato = {}) {
  const origem = normalizarComparacao(candidato.origem);
  const url = normalizarComparacao(candidato.url);
  const possuiMarcaFonte = imagemPossuiMarcaFonte(url, origem);
  let prioridade = 90;
  let origemSelecionada = candidato.origem || "desconhecida";
  let imagemOficial = false;
  let imagemLimpa = !possuiMarcaFonte;

  if (/(canonical|produto|product|importer|oficial|marketplace|engine_ofertas\.imagem)/.test(origem)) {
    prioridade = 10;
    imagemOficial = true;
  } else if (/(mercadolivre|meli|shopee|amazon|aliexpress|kabum|awin)/.test(url)) {
    prioridade = 20;
    imagemOficial = true;
    origemSelecionada = origemSelecionada || "dominio_marketplace";
  } else if (/(manufacturer|fabricante|marca)/.test(origem)) {
    prioridade = 30;
    imagemOficial = true;
  } else if (/(og|open_graph|meta)/.test(origem)) {
    prioridade = 40;
  } else if (/(thumb|thumbnail)/.test(origem)) {
    prioridade = 80;
  }

  if (possuiMarcaFonte && prioridade < 80) prioridade += 45;
  if (possuiMarcaFonte) imagemLimpa = false;

  return { ...candidato, prioridade, origemSelecionada, imagemOficial, imagemLimpa, possuiMarcaFonte };
}

function selecionarImagemComercial({ oferta = {}, ofertaEntrada = {}, metadata = {}, link = {} } = {}) {
  const candidatos = [];
  const adicionar = (url, origem) => {
    const valor = texto(url);
    if (valor) candidatos.push({ url: valor, origem: texto(origem) || "desconhecida" });
  };
  const imagemAuditoria = objeto(metadata.imagemAuditoria);
  adicionar(oferta.imagem, oferta.imagemOrigem || metadata.imagemOrigem || "oferta.imagem");
  adicionar(imagemAuditoria.imagemFinal, imagemAuditoria.origemImagem || "metadata.imagemAuditoria");
  adicionar(ofertaEntrada.imagem, "ofertaEntrada.imagem");
  adicionar(ofertaEntrada.imagemUrl, "ofertaEntrada.imagemUrl");
  adicionar(ofertaEntrada.thumbnail, "ofertaEntrada.thumbnail");
  adicionar(objeto(link.metadata).imagem, "link.metadata.imagem");
  adicionar(objeto(link.metadata).thumbnail, "link.metadata.thumbnail");

  const classificados = candidatos.map(classificarImagem).sort((a, b) => a.prioridade - b.prioridade);
  const selecionada = classificados[0];
  if (!selecionada) {
    return {
      urlOriginalCapturada: primeiroTexto(ofertaEntrada.imagemOriginal, ofertaEntrada.thumbnail),
      urlSelecionada: null,
      origemSelecionada: null,
      imagemOficial: false,
      imagemLimpa: false,
      possuiMarcaFonte: false,
      motivoSelecao: "imagem_indisponivel"
    };
  }
  return {
    urlOriginalCapturada: primeiroTexto(ofertaEntrada.imagemOriginal, ofertaEntrada.thumbnail),
    urlSelecionada: selecionada.url,
    origemSelecionada: selecionada.origemSelecionada,
    imagemOficial: selecionada.imagemOficial,
    imagemLimpa: selecionada.imagemLimpa,
    possuiMarcaFonte: selecionada.possuiMarcaFonte,
    motivoSelecao: selecionada.imagemOficial && selecionada.imagemLimpa
      ? "imagem_oficial_limpa_priorizada"
      : (selecionada.possuiMarcaFonte ? "imagem_com_marca_fonte_mantida_como_fallback" : "melhor_imagem_disponivel")
  };
}

const BLOCOS_TEMPLATE_ESPELHO_PADRAO = Object.freeze([
  { tipo: "titulo", ordem: 10, ativo: true },
  { tipo: "marketplace", ordem: 20, ativo: true },
  { tipo: "categoria", ordem: 30, ativo: true },
  { tipo: "preco_de", ordem: 40, ativo: true },
  { tipo: "preco_por", ordem: 50, ativo: true },
  { tipo: "preco_pix", ordem: 55, ativo: true },
  { tipo: "parcelamento", ordem: 60, ativo: true },
  { tipo: "economia", ordem: 70, ativo: false },
  { tipo: "cupom", ordem: 80, ativo: true },
  { tipo: "beneficio", ordem: 90, ativo: true },
  { tipo: "cashback", ordem: 95, ativo: true },
  { tipo: "frete", ordem: 100, ativo: true },
  { tipo: "avaliacao", ordem: 110, ativo: true },
  { tipo: "frase_cupom", ordem: 120, ativo: true },
  { tipo: "link_resgate", ordem: 130, ativo: true },
  { tipo: "link", ordem: 140, ativo: true }
]);

function cupomCanonicoConfiavel(doc = {}, espelho = {}) {
  const cupom = primeiroTexto(doc.cupomTexto, espelho.cupomCodigo);
  if (!cupom) return false;
  const motivos = [
    ...lista(doc.confianca?.motivos),
    ...lista(espelho.motivosConfianca)
  ].map(texto);
  return motivos.includes("cupom_explicito") || doc.confianca?.cupomConfiavel === true || espelho.cupomConfiavel === true;
}

function linkResgateEssencial(doc = {}, espelho = {}) {
  const link = primeiroTexto(doc.linkResgateOriginal, espelho.linkResgateOriginal);
  if (!link) return false;
  const contexto = normalizarComparacao([
    doc.resgateTexto,
    doc.instrucaoTexto,
    doc.beneficioTexto,
    espelho.instrucaoComercial,
    ...lista(doc.condicoesComerciais),
    ...lista(espelho.condicoesComerciais)
  ].filter(Boolean).join(" "));
  return /\b(?:resgate|cupom|cupons|voucher|beneficio|beneficio|moeda|moedas)\b/.test(contexto);
}

function normalizarBlocosTemplateEspelho(template = {}, doc = {}, espelho = {}) {
  const blocosOriginais = Array.isArray(template.blocos) && template.blocos.length
    ? template.blocos
    : BLOCOS_TEMPLATE_ESPELHO_PADRAO;
  const blocos = blocosOriginais
    .filter(bloco => bloco && bloco.ativo !== false)
    .map((bloco, indice) => ({
      tipo: texto(bloco.tipo),
      ordem: Number.isFinite(Number(bloco.ordem)) ? Number(bloco.ordem) : indice + 1,
      compatibilidadePassiva: bloco.compatibilidadePassiva === true
    }))
    .filter(bloco => Boolean(bloco.tipo));

  const possuiCupom = blocos.some(bloco => bloco.tipo === "cupom");
  const cupomObrigatorio = cupomCanonicoConfiavel(doc, espelho);
  if (cupomObrigatorio && !possuiCupom) {
    const blocoCupomOriginal = blocosOriginais.find(bloco => bloco?.tipo === "cupom");
    blocos.push({
      tipo: "cupom",
      ordem: Number.isFinite(Number(blocoCupomOriginal?.ordem)) ? Number(blocoCupomOriginal.ordem) : 80,
      obrigatorio: true
    });
  }

  const possuiResgateObrigatorio = blocos.some(bloco => bloco.tipo === "link_resgate");
  const resgateObrigatorio = linkResgateEssencial(doc, espelho);
  if (resgateObrigatorio && !possuiResgateObrigatorio) {
    const blocoResgateOriginal = blocosOriginais.find(bloco => bloco?.tipo === "link_resgate");
    const blocoLink = blocosOriginais.find(bloco => bloco?.tipo === "link");
    blocos.push({
      tipo: "link_resgate",
      ordem: Number.isFinite(Number(blocoResgateOriginal?.ordem))
        ? Number(blocoResgateOriginal.ordem)
        : ((Number.isFinite(Number(blocoLink?.ordem)) ? Number(blocoLink.ordem) : 140) - 0.1),
      obrigatorio: true
    });
  }

  const possuiLink = blocos.some(bloco => bloco.tipo === "link");
  const possuiResgate = blocos.some(bloco => bloco.tipo === "link_resgate");
  if (possuiLink && !possuiResgate && Array.isArray(template.blocos) && template.blocos.length) {
    const ordemLink = blocos.find(bloco => bloco.tipo === "link")?.ordem || 140;
    blocos.push({
      tipo: "link_resgate",
      ordem: ordemLink - 0.1,
      compatibilidadePassiva: true
    });
  }

  return blocos.sort((a, b) => a.ordem - b.ordem || a.tipo.localeCompare(b.tipo));
}

function normalizarLinhaTemplate(valor = "") {
  return texto(valor).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function adicionarBlocoUnico(saida = [], tipo = "", linha = "") {
  const textoLinha = normalizarLinhaTemplate(linha);
  if (!textoLinha) return false;
  const chave = normalizarComparacao(textoLinha);
  if (saida.some(item => normalizarComparacao(item.linha) === chave)) return false;
  saida.push({ tipo, linha: textoLinha });
  return true;
}

function valorDocumentoOuEspelho(doc = {}, espelho = {}, campoDoc = "", ...camposEspelho) {
  const valorDoc = primeiroTexto(doc[campoDoc]);
  if (valorDoc) return valorDoc;
  return primeiroTexto(...camposEspelho.map(campo => espelho[campo]));
}

function marketplaceVisual(valor = "") {
  const normalizado = normalizarComparacao(valor).replace(/[^a-z0-9]+/g, "");
  if (normalizado === "mercadolivre" || normalizado === "ml") return "Mercado Livre";
  if (normalizado === "shopee") return "Shopee";
  if (normalizado === "aliexpress") return "AliExpress";
  if (normalizado === "amazon") return "Amazon";
  if (normalizado === "kabum") return "KaBuM";
  if (normalizado === "awin") return "KaBuM / AWIN";
  return texto(valor);
}

function linhasLinksAliExpress(doc = {}) {
  const links = Array.isArray(doc.linksComerciais) ? doc.linksComerciais : [];
  const app = links.find(item => item.tipo === "app")?.url || "";
  const pc = links.find(item => item.tipo === "pc")?.url || "";
  return [
    app ? `📱 APP:\n${app}` : "",
    pc ? `🖥️ PC:\n${pc}` : ""
  ].filter(Boolean).join("\n\n");
}

function avaliacaoVisual(valor = "") {
  const bruto = texto(valor);
  if (!bruto) return "";
  const numero = Number(String(bruto).replace(",", "."));
  if (Number.isFinite(numero)) {
    if (numero >= 1 && numero <= 5) return `⭐ ${bruto}`;
    return "";
  }
  if (/\b\d+[\d.,]*\s+avalia/i.test(bruto)) return `⭐ ${bruto}`;
  if (/\bnota\s*:?\s*[1-5](?:[,.]\d)?\b/i.test(bruto)) return `⭐ ${bruto}`;
  return "";
}

function textoComercialEquivalente(a = "", b = "") {
  const ca = normalizarComparacao(a).replace(/[^a-z0-9]+/g, "");
  const cb = normalizarComparacao(b).replace(/[^a-z0-9]+/g, "");
  return Boolean(ca && cb && ca === cb);
}

function resolverBlocoTemplateEspelho(tipo = "", doc = {}, espelho = {}, contexto = {}) {
  const marketplace = valorDocumentoOuEspelho(doc, espelho, "marketplace", "marketplace");
  const linkResgate = valorDocumentoOuEspelho(doc, espelho, "linkResgateOriginal", "linkResgateOriginal");
  const linkProduto = primeiroTexto(doc.linkAfiliado, espelho.linkAfiliado, doc.linkProdutoOriginal, espelho.linkProdutoOriginal);
  const precoDe = valorDocumentoOuEspelho(doc, espelho, "precoDeTexto", "precoDeTexto");
  const precoPor = primeiroTexto(doc.precoPorTexto, doc.precoPixTexto, espelho.precoFinalTexto, espelho.precoPorTexto);
  const precoPix = doc.precoPixTexto && doc.precoPixTexto !== doc.precoPorTexto ? doc.precoPixTexto : "";
  const parcelamento = valorDocumentoOuEspelho(doc, espelho, "parcelamentoTexto");
  const cupom = valorDocumentoOuEspelho(doc, espelho, "cupomTexto", "cupomCodigo");
  const beneficio = valorDocumentoOuEspelho(doc, espelho, "beneficioTexto");
  const cashback = valorDocumentoOuEspelho(doc, espelho, "cashbackTexto");
  const frete = valorDocumentoOuEspelho(doc, espelho, "freteTexto");
  const instrucao = valorDocumentoOuEspelho(doc, espelho, "instrucaoTexto", "instrucaoComercial");
  const avaliacao = primeiroTexto(contexto.avaliacao, contexto.score);
  const categoria = primeiroTexto(contexto.categoria);
  const economia = primeiroTexto(contexto.economia);

  if (tipo === "titulo") return primeiroTexto(doc.tituloOriginal, espelho.tituloNormalizado, espelho.tituloOriginal);
  if (tipo === "marketplace") return marketplace ? `🛍️ ${marketplaceVisual(marketplace)}` : "";
  if (tipo === "categoria") return categoria ? `📂 ${categoria}` : "";
  if (tipo === "preco_de") return precoDe ? `❌ De: ${precoDe}` : "";
  if (tipo === "preco_por") return precoPor ? `✅ Por: ${precoPor}` : "";
  if (tipo === "preco_pix") return precoPix ? `⚡ Pix: ${precoPix}` : "";
  if (tipo === "parcelamento") return parcelamento || "";
  if (tipo === "economia") return economia ? `Economia: ${economia}` : "";
  if (tipo === "cupom") return cupom ? `🎟️ Cupom: ${cupom}` : "";
  if (tipo === "beneficio") {
    if (textoComercialEquivalente(beneficio, frete) || textoComercialEquivalente(beneficio, cashback)) return "";
    if (!contexto.temBlocoCashback && /\bcashback\b/i.test(beneficio)) return "";
    if (!contexto.temBlocoFrete && /\bfrete\b/i.test(beneficio)) return "";
    return beneficio ? `🎁 Benefício: ${beneficio}` : "";
  }
  if (tipo === "cashback") return cashback ? `💰 Cashback: ${cashback}` : "";
  if (tipo === "frete") return frete ? `🚚 Frete: ${frete}` : "";
  if (tipo === "avaliacao") return avaliacaoVisual(avaliacao);
  if (tipo === "frase_cupom") return instrucao ? `⚡ ${instrucao}` : "";
  if (tipo === "link_resgate") return linkResgate ? `🎟️ Resgate:\n${linkResgate}` : "";
  if (tipo === "link") {
    const linksAli = normalizarComparacao(marketplace) === "aliexpress" ? linhasLinksAliExpress(doc) : "";
    if (linksAli) return linksAli;
    return linkProduto ? `🔗 Confira aqui:\n${linkProduto}` : "";
  }
  if (tipo === "aviso_preco") return primeiroTexto(contexto.avisoPreco);
  if (tipo === "aviso_alteracao") return primeiroTexto(contexto.avisoAlteracao, contexto.aviso);
  return "";
}

const TIPOS_BLOCOS_RENDERIZAVEIS_V26 = Object.freeze(new Set([
  "titulo",
  "marketplace",
  "categoria",
  "origem_brasil",
  "vendedor",
  "preco_referencia",
  "preco_oferta",
  "preco_pix",
  "preco_final_condicionado",
  "parcelamento",
  "cupom_codigo",
  "cupons_alternativos",
  "cupom_sem_codigo",
  "instrucao_cupom",
  "cashback",
  "moedas",
  "frete",
  "prime_programa",
  "garantia",
  "pre_venda",
  "prazo_envio",
  "beneficio_app",
  "beneficio",
  "avaliacao_nota",
  "avaliacao_quantidade",
  "vendas",
  "selo_mais_vendido",
  "link_afiliado",
  "link_resgate",
  "link_app",
  "link_pc",
  "link_moedas",
  "link_auxiliar",
  "aviso",
  "rodape",
  "texto_personalizado"
]));

const TOGGLES_EQUIVALENTES_BLOCOS_V26 = Object.freeze({
  titulo: "titulo",
  marketplace: "marketplace",
  categoria: "categoria",
  vendedor: "vendedor",
  preco_referencia: "preco_de",
  preco_oferta: "preco_por",
  preco_pix: "preco_pix",
  preco_final_condicionado: "preco_por",
  parcelamento: "parcelamento",
  cupom_codigo: "cupom",
  cupons_alternativos: "cupom",
  cupom_sem_codigo: "cupom",
  instrucao_cupom: "frase_cupom",
  cashback: "cashback",
  frete: "frete",
  beneficio: "beneficio",
  beneficio_app: "beneficio",
  avaliacao_nota: "avaliacao",
  avaliacao_quantidade: "quantidade_avaliacoes",
  vendas: "vendas",
  link_afiliado: "link",
  link_resgate: "link_resgate",
  aviso: "aviso",
  rodape: "rodape",
  texto_personalizado: "texto_personalizado"
});

const TIPOS_LINKS_ESSENCIAIS_V26 = Object.freeze(new Set([
  "link_afiliado",
  "link_resgate",
  "link_app",
  "link_pc",
  "link_moedas"
]));

function normalizarBlocosCanonicosV26(documento = {}) {
  return lista(documento.blocos)
    .filter(bloco => bloco && typeof bloco === "object")
    .map((bloco, indice) => ({
      ...bloco,
      tipo: texto(bloco.tipo),
      textoOriginal: texto(bloco.textoOriginal),
      dedupeKey: texto(bloco.dedupeKey),
      ordemSugerida: Number.isFinite(Number(bloco.ordemSugerida)) ? Number(bloco.ordemSugerida) : indice + 1000,
      essencial: bloco.essencial === true,
      visibilidadePadrao: texto(bloco.visibilidadePadrao) || "opcional"
    }))
    .filter(bloco => Boolean(bloco.tipo && (bloco.textoOriginal || valorEstruturadoUtil(bloco.valorEstruturado))));
}

function blocosCanonicosSuficientesV26(blocos = [], documento = {}) {
  if (!blocos.length) return { ok: false, motivo: "blocos_ausentes" };
  const avisos = lista(documento.avisos).map(texto);
  if (avisos.includes("links_produto_ambiguos")) return { ok: false, motivo: "links_produto_ambiguos" };
  if (!blocos.some(bloco => bloco.tipo === "link_afiliado")) return { ok: false, motivo: "link_afiliado_ausente" };
  if (!blocos.some(bloco => bloco.tipo === "titulo")) return { ok: false, motivo: "titulo_ausente" };
  return { ok: true, motivo: "blocos_suficientes" };
}

function toggleAtivoParaBlocoV26(bloco = {}, template = {}) {
  if (bloco.essencial || bloco.visibilidadePadrao === "obrigatorio" || TIPOS_LINKS_ESSENCIAIS_V26.has(bloco.tipo)) return true;
  if (bloco.tipo === "link_auxiliar") {
    return lista(template.blocos).some(item => item?.tipo === "link_auxiliar" && item.ativo !== false);
  }
  const toggle = TOGGLES_EQUIVALENTES_BLOCOS_V26[bloco.tipo];
  if (!toggle) return bloco.visibilidadePadrao !== "oculto";
  const blocoTemplate = lista(template.blocos).find(item => item?.tipo === toggle);
  if (!blocoTemplate) return bloco.visibilidadePadrao !== "oculto";
  return blocoTemplate.ativo !== false;
}

function textoBlocoCanonicoV26(bloco = {}) {
  const direto = texto(bloco.textoOriginal);
  if (direto) return direto;
  const valor = objeto(bloco.valorEstruturado);
  return primeiroTexto(valor.texto, valor.url, valor.codigo, valor.valor);
}

function avaliacaoQuantidadeVisualV26(valor = "") {
  const bruto = texto(valor);
  if (!bruto) return "";
  if (/\b\d+[\d.,]*\s+avalia/i.test(bruto)) return `⭐ ${bruto}`;
  const numero = primeiroNumeroTexto(bruto);
  if (numero !== null && /\b(?:avaliacao|avaliações|avaliacoes|review|reviews)\b/i.test(normalizarComparacao(bruto))) {
    return `⭐ ${bruto}`;
  }
  return "";
}

function renderizarBlocoCanonicoV26(bloco = {}, contexto = {}) {
  const valor = textoBlocoCanonicoV26(bloco);
  if (!valor) return "";
  if (bloco.tipo === "titulo") return `🔥 ${valor}`;
  if (bloco.tipo === "marketplace") return `🛍️ ${marketplaceVisual(valor)}`;
  if (bloco.tipo === "categoria") return `📂 ${valor}`;
  if (bloco.tipo === "origem_brasil") return `🇧🇷 ${valor}`;
  if (bloco.tipo === "vendedor") return `🔐 Vendido por: ${valor}`;
  if (bloco.tipo === "preco_referencia") return `❌ De: ${valor}`;
  if (bloco.tipo === "preco_oferta") return `✅ Por: ${valor}`;
  if (bloco.tipo === "preco_pix") {
    if (textoComercialEquivalente(valor, contexto.precoOfertaTexto)) return "";
    return `⚡ Pix: ${valor}`;
  }
  if (bloco.tipo === "preco_final_condicionado") {
    if (textoComercialEquivalente(valor, contexto.precoOfertaTexto)) return "";
    return `✅ Por: ${valor}`;
  }
  if (bloco.tipo === "parcelamento") return `💳 ${valor}`;
  if (bloco.tipo === "cupom_codigo") return `🎟️ Cupom: ${valor}`;
  if (bloco.tipo === "cupons_alternativos") return `🎟️ Cupons: ${valor}`;
  if (bloco.tipo === "cupom_sem_codigo") return `🎟️ ${valor}`;
  if (bloco.tipo === "instrucao_cupom") return `⚡ ${valor}`;
  if (bloco.tipo === "cashback") return `💰 Cashback: ${valor}`;
  if (bloco.tipo === "moedas") return `🪙 ${valor}`;
  if (bloco.tipo === "frete") return `🚚 ${valor}`;
  if (bloco.tipo === "prime_programa") return `⭐ ${valor}`;
  if (bloco.tipo === "garantia") return `🛡️ ${valor}`;
  if (bloco.tipo === "pre_venda") return `⚠️ Pré-venda: ${valor}`;
  if (bloco.tipo === "prazo_envio") return `📦 ${valor}`;
  if (bloco.tipo === "beneficio_app") return `📱 ${valor}`;
  if (bloco.tipo === "beneficio") {
    if (textoComercialEquivalente(valor, contexto.freteTexto) || textoComercialEquivalente(valor, contexto.cashbackTexto)) return "";
    if (/\bcashback\b/i.test(valor) && contexto.temCashback) return "";
    if (/\bfrete\b/i.test(valor) && contexto.temFrete) return "";
    return `🎁 ${valor}`;
  }
  if (bloco.tipo === "avaliacao_nota") return avaliacaoVisual(valor);
  if (bloco.tipo === "avaliacao_quantidade") return avaliacaoQuantidadeVisualV26(valor);
  if (bloco.tipo === "vendas") return `📈 ${valor}`;
  if (bloco.tipo === "selo_mais_vendido") return `🏆 ${valor}`;
  if (bloco.tipo === "link_resgate") return `🎟️ Resgate:\n${valor}`;
  if (bloco.tipo === "link_app") return `📱 APP:\n${valor}`;
  if (bloco.tipo === "link_pc") return `🖥️ PC:\n${valor}`;
  if (bloco.tipo === "link_moedas") return `🥇 Link com moedas:\n${valor}`;
  if (bloco.tipo === "link_auxiliar") return `🔎 Link auxiliar:\n${valor}`;
  if (bloco.tipo === "link_afiliado") return `🔗 Confira aqui:\n${valor}`;
  if (bloco.tipo === "aviso") return valor;
  if (bloco.tipo === "rodape") return valor;
  if (bloco.tipo === "texto_personalizado") return valor;
  return "";
}

function montarTemplateEspelhoPorBlocosV26(espelho = {}, documento = null, opcoes = {}) {
  const doc = objeto(documento || espelho.documentoComercialCanonico);
  const blocos = normalizarBlocosCanonicosV26(doc);
  const suficiencia = blocosCanonicosSuficientesV26(blocos, doc);
  if (!suficiencia.ok) {
    return {
      ok: false,
      modo: "shadow",
      renderer: "ofc_v26_blocos",
      aplicouMudancas: false,
      mensagem: "",
      linhas: 0,
      blocosOriginais: blocos.map(bloco => bloco.tipo),
      totalEssenciais: blocos.filter(bloco => bloco.essencial === true).length,
      blocosRenderizados: [],
      blocosIgnorados: blocos.map(bloco => bloco.tipo),
      avisos: [suficiencia.motivo],
      motivo: suficiencia.motivo
    };
  }

  const template = objeto(opcoes.template);
  const blocosOrdenados = [...blocos].sort((a, b) => a.ordemSugerida - b.ordemSugerida || a.tipo.localeCompare(b.tipo) || a.dedupeKey.localeCompare(b.dedupeKey));
  const linhas = [];
  const vistos = new Set();
  const contexto = {
    precoOfertaTexto: blocosOrdenados.find(bloco => bloco.tipo === "preco_oferta")?.textoOriginal || "",
    freteTexto: blocosOrdenados.find(bloco => bloco.tipo === "frete")?.textoOriginal || "",
    cashbackTexto: blocosOrdenados.find(bloco => bloco.tipo === "cashback")?.textoOriginal || "",
    temFrete: blocosOrdenados.some(bloco => bloco.tipo === "frete"),
    temCashback: blocosOrdenados.some(bloco => bloco.tipo === "cashback")
  };

  for (const bloco of blocosOrdenados) {
    if (!TIPOS_BLOCOS_RENDERIZAVEIS_V26.has(bloco.tipo)) continue;
    const chaveDedupe = bloco.dedupeKey || dedupeKeyBloco(bloco.tipo, bloco.textoOriginal, bloco.valorEstruturado, bloco.origem);
    if (chaveDedupe && vistos.has(chaveDedupe)) continue;
    if (!toggleAtivoParaBlocoV26(bloco, template)) continue;
    const linha = renderizarBlocoCanonicoV26(bloco, contexto);
    const adicionado = adicionarBlocoUnico(linhas, bloco.tipo, linha);
    if (adicionado && chaveDedupe) vistos.add(chaveDedupe);
  }

  const mensagem = linhas.map(item => item.linha).join("\n\n");
  return {
    ok: Boolean(mensagem),
    modo: "shadow",
    renderer: "ofc_v26_blocos",
    aplicouMudancas: false,
    mensagem,
    linhas: linhas.length,
    blocosOriginais: blocosOrdenados.map(bloco => bloco.tipo),
    totalEssenciais: blocosOrdenados.filter(bloco => bloco.essencial === true).length,
    blocosRenderizados: linhas.map(item => item.tipo),
    blocosIgnorados: blocosOrdenados
      .map(bloco => bloco.tipo)
      .filter(tipo => !linhas.some(item => item.tipo === tipo)),
    avisos: mensagem ? [] : ["compositor_blocos_sem_conteudo"],
    motivo: mensagem ? "documento_canonico_blocos_v26_valido" : "compositor_blocos_sem_conteudo"
  };
}

function montarTemplateEspelhoShadow(espelho = {}, documento = null, opcoes = {}) {
  const doc = objeto(documento || espelho.documentoComercialCanonico);
  const blocos = normalizarBlocosTemplateEspelho(objeto(opcoes.template), doc, espelho);
  const linhas = [];
  const contextoBlocos = {
    ...objeto(opcoes.contexto),
    temBlocoCashback: blocos.some(bloco => bloco.tipo === "cashback"),
    temBlocoFrete: blocos.some(bloco => bloco.tipo === "frete")
  };
  for (const bloco of blocos) {
    const linha = resolverBlocoTemplateEspelho(bloco.tipo, doc, espelho, contextoBlocos);
    adicionarBlocoUnico(linhas, bloco.tipo, linha);
  }

  const rodape = objeto(opcoes.template).rodape;
  if (rodape?.ativo === true) adicionarBlocoUnico(linhas, "rodape", rodape.texto);

  const mensagem = linhas.map(item => item.linha).join("\n\n");
  return {
    ok: Boolean(mensagem),
    modo: "shadow",
    aplicouMudancas: false,
    mensagem,
    linhas: linhas.length,
    blocosRenderizados: linhas.map(item => item.tipo),
    blocosIgnorados: blocos
      .map(bloco => bloco.tipo)
      .filter(tipo => !linhas.some(item => item.tipo === tipo)),
    avisos: mensagem ? [] : ["template_espelho_sem_conteudo"]
  };
}

function construirEspelhoComercialV24(entrada = {}) {
  const oferta = objeto(entrada.oferta);
  const ofertaEntrada = objeto(entrada.ofertaEntrada);
  const job = objeto(entrada.job);
  const evento = objeto(entrada.evento);
  const link = objeto(entrada.link);
  const metadata = objeto(entrada.metadata);
  const comercialNormalizado = objeto(entrada.comercialNormalizado);
  const textoOriginalCompleto = extrairTextoOriginal({ oferta, ofertaEntrada, evento, metadata });
  const textoOriginal = textoLimitado(textoOriginalCompleto, 3000);
  const tituloOriginal = extrairTituloOriginal(textoOriginal, oferta, ofertaEntrada);
  const precosTexto = extrairPrecosTexto(textoOriginal);
  const cupom = extrairCupomTexto(textoOriginal, oferta, ofertaEntrada);
  const instrucaoComercial = extrairInstrucaoComercial(textoOriginal, cupom.cupomCodigo, oferta, ofertaEntrada);
  const formaPagamentoTexto = extrairFormaPagamento(textoOriginal, oferta, ofertaEntrada);
  const condicoesComerciais = extrairCondicoes({ textoOriginal, oferta, ofertaEntrada, comercialNormalizado });
  const links = extrairLinksComerciais({ textoOriginal, oferta, ofertaEntrada, link });

  const podeComplementarPrecoDe = !textoOriginal || precosTexto.precoDeValor !== null;
  const precoDeValor = precosTexto.precoDeValor ?? (podeComplementarPrecoDe
    ? primeiroValor(ofertaEntrada.precoOriginal, ofertaEntrada.precoAntigo, oferta.precoOriginal, comercialNormalizado.precoAnterior)
    : null);
  const precoPorValor = precosTexto.precoPorValor ?? primeiroValor(ofertaEntrada.precoAtual, ofertaEntrada.preco, oferta.preco, comercialNormalizado.precoAtual);
  let precoFinalValor = precosTexto.precoFinalValor ?? primeiroValor(ofertaEntrada.precoComCupom, ofertaEntrada.precoCupom, comercialNormalizado.precoComCupom);
  let precoFinalTexto = precosTexto.precoFinalTexto || (precoFinalValor !== null ? textoMoeda(precoFinalValor) : "");
  if (precoFinalValor === null && precoPorValor !== null && (formaPagamentoTexto || cupom.cupomCodigo || instrucaoComercial)) {
    precoFinalValor = precoPorValor;
    precoFinalTexto = precosTexto.precoPorTexto || textoMoeda(precoPorValor);
  }

  const precoDeTexto = precosTexto.precoDeTexto || (precoDeValor !== null ? textoMoeda(precoDeValor) : "");
  const precoPorTexto = precosTexto.precoPorTexto || (precoPorValor !== null ? textoMoeda(precoPorValor) : "");
  const linkAfiliado = primeiroTexto(oferta.linkAfiliado, ofertaEntrada.linkAfiliado, oferta.linkFinal, link.link_afiliado);
  const marketplace = primeiroTexto(oferta.marketplace, ofertaEntrada.marketplace, job.marketplace, job.marketplace_detectado, comercialNormalizado.marketplace);

  const motivosConfianca = [];
  if (textoOriginal) motivosConfianca.push("texto_comercial_capturado");
  if (precosTexto.precoPorValor !== null || precosTexto.precoFinalValor !== null) motivosConfianca.push("preco_explicito_na_captura");
  if (cupom.cupomCodigo) motivosConfianca.push("cupom_explicito");
  if (formaPagamentoTexto) motivosConfianca.push("forma_pagamento_explicita");
  if (links.linkProdutoOriginal || linkAfiliado) motivosConfianca.push("link_produto_presente");
  if (comercialNormalizado.precoConfiavel === true && !motivosConfianca.includes("preco_explicito_na_captura")) motivosConfianca.push("preco_estruturado_complementar");

  const avisos = [];
  if (!textoOriginal) avisos.push("texto_original_indisponivel");
  if (!precoPorTexto && !precoFinalTexto) avisos.push("preco_comercial_indisponivel");
  if (!links.linkProdutoOriginal && !linkAfiliado) avisos.push("link_produto_indisponivel");
  if (links.produtosAmbiguos) avisos.push("links_produto_ambiguos");
  if (comercialNormalizado.avisoPreco) avisos.push(comercialNormalizado.avisoPreco);

  const espelhoComercial = {
    tituloOriginal: tituloOriginal || null,
    tituloNormalizado: tituloOriginal ? limparTitulo(tituloOriginal) : null,
    textoOriginal: textoOriginal || null,
    textoComercialPreservado: textoOriginal || null,
    precoDeTexto: precoDeTexto || null,
    precoPorTexto: precoPorTexto || null,
    precoFinalTexto: precoFinalTexto || null,
    precoDeValor,
    precoPorValor,
    precoFinalValor,
    formaPagamentoTexto: formaPagamentoTexto || null,
    condicoesComerciais,
    cupomCodigo: cupom.cupomCodigo || null,
    cupomTexto: cupom.cupomTexto || null,
    instrucaoComercial: instrucaoComercial || null,
    linkProdutoOriginal: links.linkProdutoOriginal || null,
    linkResgateOriginal: links.linkResgateOriginal || null,
    linkAfiliado: linkAfiliado || null,
    marketplace: marketplace || null,
    origemComercial: textoOriginal ? "captura_comercial" : "campos_estruturados",
    confiavel: motivosConfianca.includes("preco_explicito_na_captura") || Boolean(cupom.cupomCodigo && (precoPorTexto || precoFinalTexto)),
    motivosConfianca,
    avisos: Array.from(new Set(avisos.filter(Boolean)))
  };

  const imagemComercial = selecionarImagemComercial({ oferta, ofertaEntrada, metadata, link });
  const documentoComercialCanonico = extrairDocumentoComercialCanonico({
    textoOriginal,
    tituloOriginal,
    precosTexto,
    cupom,
    instrucaoComercial,
    formaPagamentoTexto,
    condicoesComerciais,
    links,
    linkAfiliado,
    marketplace,
    imagemComercial,
    oferta,
    ofertaEntrada,
    comercialNormalizado,
    avisos: espelhoComercial.avisos,
    motivosConfianca
  });
  const contextoLogBlocos = {
    workspaceId: job.cliente_id || job.workspaceId || oferta.workspaceId || ofertaEntrada.workspaceId || "",
    jobId: job.id || job.jobId || null,
    ofertaId: oferta.id || oferta.ofertaId || ofertaEntrada.ofertaId || null,
    marketplace
  };
  if (documentoComercialCanonico.erroBlocosComerciais) {
    logBlocosComerciaisV26("[OFC-V2.6-BLOCOS-ERRO]", documentoComercialCanonico, contextoLogBlocos);
  } else if (lista(documentoComercialCanonico.avisos).length || !lista(documentoComercialCanonico.blocos).length) {
    logBlocosComerciaisV26("[OFC-V2.6-BLOCOS-INCOMPLETOS]", documentoComercialCanonico, contextoLogBlocos);
  } else {
    logBlocosComerciaisV26("[OFC-V2.6-BLOCOS-CRIADOS]", documentoComercialCanonico, contextoLogBlocos);
  }
  espelhoComercial.documentoComercialCanonico = documentoComercialCanonico;
  const templateEspelhoShadow = montarTemplateEspelhoShadow(espelhoComercial, documentoComercialCanonico);

  return {
    ok: true,
    modo: "shadow",
    aplicouMudancas: false,
    espelhoComercial,
    documentoComercialCanonico,
    imagemComercial,
    templateEspelhoShadow
  };
}

function construirEspelhoComercialV24FailOpen(entrada = {}) {
  try {
    return construirEspelhoComercialV24(entrada);
  } catch (erro) {
    return {
      ok: false,
      modo: "shadow",
      aplicouMudancas: false,
      espelhoComercial: null,
      documentoComercialCanonico: null,
      imagemComercial: null,
      templateEspelhoShadow: null,
      motivo: "espelho_comercial_exception",
      erro: String(erro?.message || "erro_desconhecido").slice(0, 180)
    };
  }
}

function resumoEspelhoComercialLog(resultado = {}, contexto = {}) {
  const espelho = objeto(resultado.espelhoComercial);
  const imagem = objeto(resultado.imagemComercial);
  return {
    workspaceId: contexto.workspaceId || "",
    marketplace: espelho.marketplace || contexto.marketplace || "",
    ofertaId: contexto.ofertaId || null,
    jobId: contexto.jobId || null,
    temPrecoDe: Boolean(espelho.precoDeValor || espelho.precoDeTexto),
    temPrecoPor: Boolean(espelho.precoPorValor || espelho.precoPorTexto),
    temPrecoFinal: Boolean(espelho.precoFinalValor || espelho.precoFinalTexto),
    temPix: normalizarComparacao(`${espelho.formaPagamentoTexto || ""} ${lista(espelho.condicoesComerciais).join(" ")}`).includes("pix"),
    temCupom: Boolean(espelho.cupomCodigo),
    temInstrucao: Boolean(espelho.instrucaoComercial),
    temLinkResgate: Boolean(espelho.linkResgateOriginal),
    imagemOrigem: imagem.origemSelecionada || "",
    imagemLimpa: imagem.imagemLimpa === true,
    confiavel: espelho.confiavel === true,
    avisos: lista(espelho.avisos).slice(0, 8),
    aplicouMudancasOperacionais: false
  };
}

module.exports = {
  construirEspelhoComercialV24,
  construirEspelhoComercialV24FailOpen,
  montarTemplateEspelhoPorBlocosV26,
  montarTemplateEspelhoShadow,
  resumoEspelhoComercialLog,
  selecionarImagemComercial
};
