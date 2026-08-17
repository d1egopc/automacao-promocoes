function texto(valor = "") {
  return String(valor ?? "").trim();
}

function semAcentosUpper(valor = "") {
  return texto(valor)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function limparMarcadorCupom(valor = "") {
  return semAcentosUpper(valor)
    .replace(/^\s*(?:USE|UTILIZE|APLIQUE|APLICAR)\s+(?:O\s+)?(?:CUPOM|CUPONS|CODIGO|CODIGOS|CODE|COUPON|PROMOCODE|VOUCHER)?\s*:?\s*/i, "")
    .replace(/^\s*(?:CUPOM|CUPONS|CODIGO|CODIGOS|CODE|COUPON|PROMOCODE|VOUCHER|USE|UTILIZE|APLIQUE|APLICAR|RESGATE)(?:\s*:|\s+)\s*/i, "")
    .replace(/[.,;:!?)\]}]+$/g, "")
    .trim();
}

const PALAVRAS_BLOQUEADAS = new Set([
  "AQUI",
  "PARA",
  "OBTER",
  "HTTPS",
  "HTTP",
  "WWW",
  "SHOPEE",
  "SSHOPEECOMBR",
  "AMAZON",
  "AMAZONCOMBR",
  "MELILA",
  "COMBR",
  "MERCADOLIVRE",
  "MERCADOLIVRECOMBR",
  "MENSAGEM",
  "DETECTADO",
  "PAGINA",
  "DAPAGINA",
  "DESTAPAGINA",
  "TODOS",
  "TODAS",
  "DESTA",
  "DESSE",
  "DESSA",
  "DISPONIVEL",
  "ANUNCIO",
  "OCUPOM",
  "OCUPOMAQUI",
  "TODOSOSCUPONSDESTAP",
  "RESGATE",
  "RESGATAR",
  "APLIQUE",
  "APLICAR",
  "CUPOM",
  "CUPONS",
  "CODIGO",
  "CODIGOS",
  "CODE",
  "DESCONTO",
  "OFERTA",
  "PROMOCAO",
  "PROMO",
  "GRATIS",
  "FRETE",
  "CARRINHO",
  "LINK",
  "LINKS",
  "LOJA",
  "OFICIAL",
  "APP",
  "SITE",
  "OU",
  "E",
  "OR"
]);

function pareceUrlOuParametro(valor = "") {
  const original = texto(valor);
  return /https?:\/\//i.test(original) ||
    /^www\./i.test(original) ||
    /[/?#=&]/.test(original) ||
    /(utm_|awinaffid|linkcode|creative|camp|ref=|tag=)/i.test(original);
}

function pareceFrasePercentualSemCodigo(valor = "") {
  const original = texto(valor);
  return (
    /\b\d{1,2}\s*%/.test(original) ||
    /(?:R\$\s*)?\d{1,4}(?:[,.]\d{2})?/.test(original)
  ) && /\b(?:cupom|desconto)\s+de\b/i.test(original);
}

function pareceBeneficioSemCodigo(valor = "") {
  const original = texto(valor);
  if (!original) return false;
  if (/^\s*(?:\+?\s*)?\d*\s*(?:moeda|moedas|coin|coins)\s*(?:no\s+)?(?:app|aplicativo)?\s*$/i.test(original)) return true;
  const temValorDesconto = /\b\d{1,3}\s*%\s*(?:off|desconto)?\b/i.test(original) ||
    /(?:R\$\s*)?\d{1,5}(?:[,.]\d{1,2})?\s*OFF\b/i.test(original);
  if (!temValorDesconto) return false;
  return /\b(?:cupom|desconto|off|an[uú]ncio|pagina|p[aá]gina|resgate)\b/i.test(original);
}

function pareceCodigoDerivadoDeDesconto(codigo = "") {
  const chave = semAcentosUpper(codigo).replace(/[^A-Z0-9]/g, "");
  return /^\d{1,3}OFF$/.test(chave) || /^R?\d{1,5}OFF$/.test(chave);
}

function pareceSlugCurtoDeUrl(valor = "") {
  const original = texto(valor);
  if (!/(?:https?:\/\/|www\.|[/?#=&.])/.test(original)) return false;
  const limpo = semAcentosUpper(original).replace(/[^A-Z0-9]/g, "");
  if (!limpo) return false;
  if (!/^[0-9][A-Z0-9]{7,13}$/.test(limpo)) return false;
  return /[A-Z]/.test(limpo) && /\d/.test(limpo);
}

function removerUrls(valor = "") {
  return texto(valor).replace(/https?:\/\/\S+|www\.\S+/gi, " ");
}

function pareceTrechoConcatenadoDeFrase(codigo = "") {
  return /(?:^|_)O?CUPOM(?:DE|AQUI|$)/i.test(codigo) ||
    /(?:TODOS.*CUPONS?.*(?:PAGINA|ANUNCIO)|CUPONS?DESTA|DAPAGINA|DESTAPAGINA|DISPONIVEL|ANUNCIO|MENSAGEM|DETECTADO|HTTPS?)/i.test(codigo) ||
    /^(?:ABRA|ABRIR|ACESSE|CLIQUE|TOQUE|CONFIRA|VEJA|VAI)(?:O|A|OS|AS)?[A-Z0-9]*(?:PRODUTO|APARECER|PAGINA|ANUNCIO|APP|APLICATIVO|LINK|LOJA|SITE)/i.test(codigo);
}

function pareceInstrucaoImperativaSemMarcador(valor = "") {
  const original = texto(valor);
  if (!original) return false;
  if (/\b(?:cupom|cupons|codigo|c[oó]digo|codigos|voucher|coupon|promocode)\b/i.test(original)) return false;
  return /^\s*(?:abra|abrir|acesse|clique|toque|confira|veja|vai\s+aparecer|aparecer[aá]?)\b/i.test(original);
}

function normalizarCodigoCupomSemantico(candidato = "") {
  const original = texto(candidato);
  if (!original) return "";
  if (pareceUrlOuParametro(original)) return "";
  if (pareceFrasePercentualSemCodigo(original)) return "";
  if (pareceBeneficioSemCodigo(original)) return "";
  if (pareceInstrucaoImperativaSemMarcador(original)) return "";
  if (pareceSlugCurtoDeUrl(original)) return "";

  const limpo = limparMarcadorCupom(original)
    .replace(/[^A-Z0-9_-]/g, "")
    .trim();

  if (!limpo || limpo.length < 4 || limpo.length > 30) return "";
  if (!/^[A-Z0-9][A-Z0-9_-]{3,29}$/.test(limpo)) return "";
  if (pareceCodigoDerivadoDeDesconto(limpo)) return "";
  if (pareceSlugCurtoDeUrl(limpo)) return "";
  if (/^CUPOM[_-]?$/i.test(limpo)) return "";
  if (PALAVRAS_BLOQUEADAS.has(limpo)) return "";
  if (pareceTrechoConcatenadoDeFrase(limpo)) return "";

  return limpo;
}

function separarPossiveisCodigos(trecho = "") {
  return texto(trecho)
    .split(/\s+ou\s+|\s+e\s+|[+,;/|]/i)
    .map(item => item.split(/\s+(?:no|na|em|para|por|pelo|pela|link|site|app)\b/i)[0])
    .map(texto)
    .filter(Boolean);
}

function adicionarCodigo(resultado, vistos, candidato = "") {
  const codigo = normalizarCodigoCupomSemantico(candidato);
  if (!codigo || vistos.has(codigo)) return;
  vistos.add(codigo);
  resultado.push(codigo);
}

function extrairCodigosCupomSemanticos(textoFonte = "") {
  const fonte = String(textoFonte || "");
  const resultado = [];
  const vistos = new Set();
  const linhas = fonte.split(/\r?\n/);
  const padroes = [
    /\b(?:cupom|cupons|codigo|codigos|c[o\u00f3]digo|c[o\u00f3]digos|coupon|promocode|voucher)\s*[:\-]?\s*([^\n]+)/gi,
    /\b(?:use|utilize|aplique|aplicar|com)\s+(?:o\s+)?(?:cupom|codigo|c[o\u00f3]digo)\s*[:\-]?\s*([^\n]+)/gi,
    /\b(?:use|utilize)\s+([A-Z0-9][A-Z0-9_-]{3,29})(?=$|\s+(?:e\s+ganhe|com\s+desconto|no\s+app|na\s+loja))/gi
  ];

  for (let indice = 0; indice < linhas.length; indice++) {
    const linhaOriginal = linhas[indice];
    const linha = removerUrls(linhaOriginal);
    if (/^\s*(?:cupom|cupons|codigo|codigos|c[o\u00f3]digo|c[o\u00f3]digos|coupon|promocode|voucher)\s*:?\s*$/i.test(linha)) {
      for (const parte of separarPossiveisCodigos(linhas[indice + 1] || "")) {
        adicionarCodigo(resultado, vistos, parte);
      }
      continue;
    }

    for (const padrao of padroes) {
      let match;
      while ((match = padrao.exec(linha))) {
        const trecho = texto(match[1] || "");
        if (!trecho || pareceFrasePercentualSemCodigo(trecho) || pareceFrasePercentualSemCodigo(linha) || pareceBeneficioSemCodigo(trecho) || pareceBeneficioSemCodigo(linhaOriginal)) continue;
        for (const parte of separarPossiveisCodigos(trecho)) {
          adicionarCodigo(resultado, vistos, parte);
        }
      }
    }
  }

  return resultado;
}

function normalizarCuponsSemanticos(valores = []) {
  const entradas = Array.isArray(valores) ? valores : [valores];
  const resultado = [];
  const vistos = new Set();

  for (const entrada of entradas) {
    if (Array.isArray(entrada)) {
      for (const item of normalizarCuponsSemanticos(entrada)) adicionarCodigo(resultado, vistos, item);
      continue;
    }

    const original = texto(entrada);
    if (!original) continue;

    const extraidos = extrairCodigosCupomSemanticos(original);
    if (extraidos.length) {
      for (const codigo of extraidos) adicionarCodigo(resultado, vistos, codigo);
      continue;
    }

    if (
      pareceFrasePercentualSemCodigo(original) ||
      pareceBeneficioSemCodigo(original) ||
      pareceInstrucaoImperativaSemMarcador(original) ||
      pareceSlugCurtoDeUrl(original) ||
      /\r?\n/.test(original) ||
      /https?:\/\/|www\./i.test(original) ||
      /\b(?:resgate|aplique|aplicar|use|utilize).*\bcupons?.*(?:pagina|anuncio|disponivel|%)/i.test(original)
    ) {
      continue;
    }

    for (const parte of separarPossiveisCodigos(original)) {
      adicionarCodigo(resultado, vistos, parte);
    }
  }

  return resultado;
}

module.exports = {
  extrairCodigosCupomSemanticos,
  normalizarCodigoCupomSemantico,
  normalizarCuponsSemanticos,
  pareceBeneficioSemCodigo
};
