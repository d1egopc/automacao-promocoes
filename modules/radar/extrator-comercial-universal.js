const { normalizarNumeroMoeda } = require("../../utils/moeda");
const {
  resolverPrecoSemantico,
  campoDeCandidato
} = require("./preco-semantico");
const {
  extrairCodigosCupomSemanticos,
  normalizarCodigoCupomSemantico
} = require("./cupom-semantico");

const VERSAO_EXTRATOR_COMERCIAL = "radar_comercial_universal_v1";
const CONFIANCA = {
  ALTA: "alta",
  MEDIA: "media",
  BAIXA: "baixa",
  AUSENTE: "ausente"
};

const LIMITES = {
  TEXTO_MAX: 8000,
  LINKS_MAX: 30,
  PRECOS_MAX: 40,
  EVIDENCIA_MAX: 120,
  REGEX_MAX: 40
};

const PADRAO_VALOR = "\\d{1,3}(?:\\.\\d{3})*(?:,\\d{2})?|\\d+(?:[,.]\\d{2})?";
const REGEX_LINK = /https?:\/\/[^\s<>()\]"']+|www\.[^\s<>()\]"']+/gi;

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function textoNormalizado(valor = "") {
  return String(valor ?? "")
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "\n");
}

function semAcentos(valor = "") {
  return textoNormalizado(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function evidencia(valor = "") {
  const limpo = texto(valor).replace(/\s+/g, " ");
  return limpo ? limpo.slice(0, LIMITES.EVIDENCIA_MAX) : null;
}

function campo(valor = null, confianca = CONFIANCA.AUSENTE, evidenciaCampo = null, extras = {}) {
  return {
    valor,
    confianca,
    evidencia: evidencia(evidenciaCampo),
    ...extras
  };
}

function valorMoeda(valor) {
  const numero = normalizarNumeroMoeda(valor);
  return numero === null ? null : numero;
}

function adicionarUnico(lista, item) {
  if (!item) return;
  if (!lista.includes(item)) lista.push(item);
}

function contextoLinha(textoFonte = "", indice = 0) {
  const inicio = textoFonte.lastIndexOf("\n", indice) + 1;
  const proxima = textoFonte.indexOf("\n", indice);
  const fim = proxima === -1 ? textoFonte.length : proxima;
  return textoFonte.slice(inicio, fim).trim();
}

function criarCampoAusente(extras = {}) {
  return campo(null, CONFIANCA.AUSENTE, null, extras);
}

function detectarMarketplacePorTexto(textoFonte = "", links = []) {
  const fonte = semAcentos(`${textoFonte}\n${links.join("\n")}`);
  const regras = [
    ["mercadolivre", /mercado\s*livre|mercadolivre|meli\.la|mlb\d+/],
    ["shopee", /shopee|s\.shopee\.com|moedas\s+shopee|mall/],
    ["amazon", /amazon|amzn\.to|prime/],
    ["aliexpress", /ali\s*express|aliexpress|a\.aliexpress\.com|s\.click\.aliexpress/],
    ["kabum", /kabum|ka\s*bum|awin1\.com/],
    ["magalu", /magalu|magazine\s+luiza|magazineluiza/]
  ];
  for (const [valor, regex] of regras) {
    if (regex.test(fonte)) return campo(valor, CONFIANCA.MEDIA, valor);
  }
  return criarCampoAusente();
}

function categoriaPorTexto(textoFonte = "") {
  const fonte = semAcentos(textoFonte);
  const regras = [
    ["Gamer e Hardware", /\b(rtx|placa de video|ssd|nvme|monitor gamer|memoria ram|processador|teclado gamer|mouse gamer|gabinete)\b/],
    ["Casa", /\b(air fryer|panela|cozinha|aspirador|liquidificador|geladeira|microondas|cafeteira)\b/],
    ["Moda", /\b(tenis|camiseta|calca|vestido|jaqueta|moletom|sapato)\b/],
    ["Beleza", /\b(shampoo|perfume|mascara|creme|maquiagem|skincare|protetor solar)\b/],
    ["Eletronicos", /\b(smart tv|tv|celular|iphone|notebook|tablet|fone|headphone|caixa de som|smartwatch)\b/],
    ["Mercado", /\b(cafe|arroz|feijao|leite|fralda|sabao|detergente|mercado)\b/]
  ];
  for (const [valor, regex] of regras) {
    if (regex.test(fonte)) return campo(valor, CONFIANCA.MEDIA, valor);
  }
  return criarCampoAusente();
}

function coletarLinks(textoFonte = "", linksEntrada = []) {
  const encontrados = [];
  const fonte = textoNormalizado(textoFonte);
  const linksBody = [];
  let match;
  while ((match = REGEX_LINK.exec(fonte))) {
    linksBody.push(match[0].replace(/[.,;!?)\]]+$/g, ""));
  }
  for (const link of [...(Array.isArray(linksEntrada) ? linksEntrada : []), ...linksBody]) {
    const valor = texto(link);
    if (!valor || encontrados.includes(valor) || encontrados.length >= LIMITES.LINKS_MAX) continue;
    encontrados.push(valor);
  }
  return encontrados;
}

function hostLink(link = "") {
  try {
    const url = new URL(link.startsWith("http") ? link : `https://${link}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function tipoLink(link = "") {
  const host = hostLink(link);
  const valor = link.toLowerCase();
  if (/awin1\.com|s\.click\.aliexpress|mercadolivre\.com\/jms/.test(host)) return "affiliate";
  if (["meli.la", "amzn.to", "s.shopee.com.br", "a.aliexpress.com", "bit.ly", "tinyurl.com"].includes(host)) return "encurtador";
  if (/cupom|coupon|resgate|promocode|voucher/.test(host) || /(?:cupom|coupon|resgate|voucher|promocode)/.test(valor)) return "resgate";
  if (/promo|campanha|landing|ofertas?|collection|search|lista|loja/.test(valor)) return "landing";
  if (/mercadolivre|amazon|shopee|aliexpress|kabum|magazineluiza|magalu/.test(host)) return "produto";
  return "desconhecido";
}

function classificarLinksComerciais(textoFonte = "", linksEntrada = []) {
  const encontrados = coletarLinks(textoFonte, linksEntrada);
  const classificados = encontrados.map(link => ({ link, tipo: tipoLink(link, textoFonte) }));
  const produto = classificados.find(item => item.tipo === "produto")?.link || null;
  const resgate = classificados.find(item => item.tipo === "resgate")?.link || null;
  return {
    encontrados,
    classificados,
    produto,
    resgate,
    cupom: classificados.find(item => item.tipo === "resgate")?.link || null,
    landing: classificados.filter(item => item.tipo === "landing").map(item => item.link),
    encurtadores: classificados.filter(item => item.tipo === "encurtador").map(item => item.link),
    redirecionadores: classificados.filter(item => item.tipo === "affiliate").map(item => item.link),
    afiliados: classificados.filter(item => item.tipo === "affiliate").map(item => item.link),
    adicionais: classificados.filter(item => !["produto", "resgate"].includes(item.tipo)).map(item => item.link)
  };
}

function coletarValores(textoFonte = "") {
  const fonte = textoNormalizado(textoFonte);
  const regex = new RegExp(`(?:R\\$\\s*)?(${PADRAO_VALOR})(?!\\s*%)`, "gi");
  const valores = [];
  let match;
  while ((match = regex.exec(fonte))) {
    if (valores.length >= LIMITES.PRECOS_MAX) break;
    const bruto = match[1];
    const valor = valorMoeda(bruto);
    if (valor === null) continue;
    const linha = contextoLinha(fonte, match.index);
    valores.push({
      valor,
      bruto,
      evidencia: evidencia(match[0]),
      linha,
      indice: match.index,
      contexto: fonte.slice(Math.max(0, match.index - 40), Math.min(fonte.length, match.index + match[0].length + 40))
    });
  }
  return valores;
}

function linhaTem(textoLinha = "", regex) {
  return regex.test(semAcentos(textoLinha));
}

function primeiroValorPorMarcador(valores = [], regex, confianca = CONFIANCA.ALTA) {
  const item = valores.find(valor => linhaTem(valor.linha, regex));
  return item ? campo(item.valor, confianca, item.linha) : criarCampoAusente();
}

function extrairPrecosComerciais(textoFonte = "") {
  const fonte = textoNormalizado(textoFonte);
  const semantico = resolverPrecoSemantico(fonte);
  const resultado = {
    precoAtual: campoDeCandidato(semantico.precoAtual, CONFIANCA.AUSENTE),
    precoAntigo: campoDeCandidato(semantico.precoAntigo, CONFIANCA.AUSENTE),
    precoPix: campoDeCandidato(semantico.precoPix, CONFIANCA.AUSENTE),
    precoBoleto: campoDeCandidato(semantico.precoBoleto, CONFIANCA.AUSENTE),
    precoCartao: campoDeCandidato(semantico.precoCartao, CONFIANCA.AUSENTE),
    precoParcelado: campoDeCandidato(semantico.parcela, CONFIANCA.AUSENTE),
    precoUnitario: campoDeCandidato(semantico.precoUnitario, CONFIANCA.AUSENTE),
    parcelamento: {
      quantidade: null,
      valorParcela: semantico.parcela?.valor ?? null,
      semJuros: /sem\s+juros/i.test(semantico.parcela?.trechoOrigem || ""),
      confianca: semantico.parcela?.nivelEvidencia || CONFIANCA.AUSENTE,
      evidencia: semantico.parcela?.trechoOrigem || null
    },
    descontoPercentual: criarCampoAusente(),
    valorEconomia: campoDeCandidato(semantico.economia, CONFIANCA.AUSENTE),
    valorCupom: campoDeCandidato(semantico.cupomValor, CONFIANCA.AUSENTE),
    frete: campoDeCandidato(semantico.frete, CONFIANCA.AUSENTE),
    cashbackValor: campoDeCandidato(semantico.cashback, CONFIANCA.AUSENTE),
    ambiguidades: semantico.ambiguidades || [],
    candidatosPreco: semantico.candidatos || [],
    resolucaoPreco: {
      versao: semantico.versao,
      quantidadeCandidatosPreco: semantico.quantidadeCandidatosPreco || 0,
      tipoCandidatoEscolhido: semantico.escolhido?.tipoCandidato || "ausente",
      marcadorPrecoEscolhido: semantico.escolhido?.marcadorAnterior || semantico.escolhido?.marcadorPosterior || "",
      possuiCifraoPrecoEscolhido: semantico.escolhido?.possuiCifrao === true,
      motivosConfiancaPreco: semantico.motivosConfiancaPreco || [],
      candidatosRejeitadosPorTipo: semantico.candidatosRejeitadosPorTipo || {}
    }
  };

  if (semantico.parcela) {
    const parcela = fonte.match(/\b(\d{1,2})\s*x\s*(?:de\s*)?(?:R\$\s*)?\d/i);
    if (parcela) resultado.parcelamento.quantidade = Number(parcela[1]);
  }

  const percentual = fonte.match(/\b(\d{1,2})\s*%\s*(?:off|OFF|de desconto|desconto)?|\b(?:off|desconto)\s*(?:de\s*)?(\d{1,2})\s*%/i);
  if (percentual) {
    const valor = Number(percentual[1] || percentual[2]);
    if (Number.isFinite(valor) && valor > 0) resultado.descontoPercentual = campo(valor, CONFIANCA.ALTA, percentual[0], { tipo: "percentual" });
  }

  return resultado;
}
function normalizarCupom(codigo = "") {
  return normalizarCodigoCupomSemantico(codigo);

  return texto(codigo)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9_-]/g, "")
    .trim();
}

function extrairCupomComercialSemantico(textoFonte = "") {
  const fonte = textoNormalizado(textoFonte);
  const codigos = extrairCodigosCupomSemanticos(fonte);
  const codigo = codigos[0] || null;
  const evidenciaCodigo = codigo
    ? ((fonte.match(/\b(?:cupom|cupons|codigo|codigos|c[o\u00f3]digo|c[o\u00f3]digos|coupon|promocode|voucher|use|utilize|aplique|aplicar)[^\n]{0,90}/i) || [])[0] || codigo)
    : null;
  const beneficioValor = fonte.match(new RegExp(`\\b(?:cupom|desconto)\\s*(?:de\\s*)?(?:R\\$\\s*)?(${PADRAO_VALOR})`, "i"));
  const percentual = fonte.match(/\b(?:cupom|desconto|ganhe)\s+(\d{1,2})\s*%|\b(\d{1,2})\s*%\s*(?:com\s+)?cupom/i);
  const instrucao = fonte.match(/\b(?:use|utilize|aplique|aplicar|resgate|resgate o cupom)[^\n]{0,90}/i);
  const textoCupom = fonte.match(/\b(?:cupom|codigo|c[o\u00f3]digo|coupon|promocode|voucher)[^\n]{0,90}/i);
  const provavel = /\b(?:tem cupom|cupom disponivel|cupom na pagina|desconto no carrinho|aplique o cupom da pagina)\b/i.test(fonte);

  return {
    codigo,
    codigos,
    texto: textoCupom ? evidencia(textoCupom[0]) : null,
    instrucao: instrucao ? evidencia(instrucao[0]) : null,
    valor: beneficioValor ? valorMoeda(beneficioValor[1]) : null,
    percentual: percentual ? Number(percentual[1] || percentual[2]) : null,
    confianca: codigo ? CONFIANCA.ALTA : (beneficioValor || percentual || provavel ? CONFIANCA.MEDIA : CONFIANCA.AUSENTE),
    evidencia: evidenciaCodigo || (textoCupom ? textoCupom[0] : null),
    provavel: Boolean(provavel && !codigo)
  };
}

function extrairCupomComercial(textoFonte = "") {
  return extrairCupomComercialSemantico(textoFonte);

  const fonte = textoNormalizado(textoFonte);
  const padroesCodigo = [
    /\b(?:cupom|codigo|c[oó]digo|coupon|promocode|voucher)\s*:?\s*([A-Z0-9][A-Z0-9_-]{3,39})\b/i,
    /\b(?:use|utilize|aplique|aplicar)\s+(?:o\s+)?(?:cupom\s+)?([A-Z0-9][A-Z0-9_-]{3,39})\b/i,
    /\b([A-Z]{2,}[A-Z0-9_-]{2,})\b\s*(?:\+|com)?\s*(?:cupom|off|desconto)/i
  ];
  const bloqueados = new Set(["CUPOM", "CODIGO", "APLICAR", "RESGATE", "DESCONTO", "OFERTA", "PROMOCAO", "GRATIS", "FRETE"]);
  let codigo = null;
  let evidenciaCodigo = null;
  for (const padrao of padroesCodigo) {
    const match = fonte.match(padrao);
    const candidato = normalizarCupom(match?.[1] || "");
    if (candidato && !bloqueados.has(candidato)) {
      codigo = candidato;
      evidenciaCodigo = match[0];
      break;
    }
  }

  const beneficioValor = fonte.match(new RegExp(`\\b(?:cupom|desconto)\\s*(?:de\\s*)?(?:R\\$\\s*)?(${PADRAO_VALOR})`, "i"));
  const percentual = fonte.match(/\b(?:cupom|desconto|ganhe)\s+(\d{1,2})\s*%|\b(\d{1,2})\s*%\s*(?:com\s+)?cupom/i);
  const instrucao = fonte.match(/\b(?:use|utilize|aplique|aplicar|resgate|resgate o cupom)[^\n]{0,90}/i);
  const textoCupom = fonte.match(/\b(?:cupom|codigo|c[oó]digo|coupon|promocode|voucher)[^\n]{0,90}/i);
  const provavel = /\b(?:tem cupom|cupom disponivel|cupom na pagina|desconto no carrinho|aplique o cupom da pagina)\b/i.test(fonte);

  return {
    codigo,
    texto: textoCupom ? evidencia(textoCupom[0]) : null,
    instrucao: instrucao ? evidencia(instrucao[0]) : null,
    valor: beneficioValor ? valorMoeda(beneficioValor[1]) : null,
    percentual: percentual ? Number(percentual[1] || percentual[2]) : null,
    confianca: codigo ? CONFIANCA.ALTA : (beneficioValor || percentual || provavel ? CONFIANCA.MEDIA : CONFIANCA.AUSENTE),
    evidencia: evidenciaCodigo || (textoCupom ? textoCupom[0] : null),
    provavel: Boolean(provavel && !codigo)
  };
}

function extrairAvaliacao(textoFonte = "") {
  const fonte = textoNormalizado(textoFonte);
  const estrelas = fonte.match(/(?:★|⭐){3,5}(?:☆|⭐|★)?|\b([1-5](?:[,.]\d)?)\s*(?:\/\s*5|estrelas?)/i);
  if (!estrelas) return criarCampoAusente();
  if (estrelas[1]) return campo(Number(String(estrelas[1]).replace(",", ".")), CONFIANCA.MEDIA, estrelas[0]);
  const cheias = (estrelas[0].match(/★|⭐/g) || []).length;
  return campo(cheias, CONFIANCA.BAIXA, estrelas[0]);
}

function extrairQuantidadeVendida(textoFonte = "") {
  const match = textoNormalizado(textoFonte).match(/\b(\d{1,6}(?:\.\d{3})*|\d{1,6})\s*(?:vendidos?|comprados?|vendas?)\b/i);
  if (!match) return criarCampoAusente();
  const valor = Number(String(match[1]).replace(/\./g, ""));
  return campo(Number.isFinite(valor) ? valor : null, CONFIANCA.MEDIA, match[0]);
}

function extrairEstoque(textoFonte = "") {
  const fonte = textoNormalizado(textoFonte);
  const normalizado = semAcentos(fonte);
  const limitado = normalizado.match(/\bultimas?\s+(\d{1,4})\s+(?:unidades?|pecas?)\b/i);
  if (limitado) return campo(Number(limitado[1]), CONFIANCA.MEDIA, limitado[0], { tipo: "limitado" });
  const textoEstoque = normalizado.match(/\b(?:enquanto durarem os estoques|estoque limitado|ultimas unidades)\b/i);
  if (textoEstoque) return campo(null, CONFIANCA.MEDIA, textoEstoque[0], { tipo: "texto" });
  return criarCampoAusente({ tipo: "ausente" });
}

function extrairCondicoes(textoFonte = "") {
  const fonte = textoNormalizado(textoFonte);
  const normalizado = semAcentos(fonte);
  const condicoes = {
    cashback: criarCampoAusente(),
    freteGratis: criarCampoAusente(),
    seloOficial: criarCampoAusente(),
    moedasShopee: criarCampoAusente(),
    brindes: [],
    especiais: []
  };

  const cashback = fonte.match(/\bcashback\s*(?:de\s*)?(\d{1,2}\s*%|R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}|R\$\s*\d+)/i);
  if (cashback) condicoes.cashback = campo(cashback[1].trim(), CONFIANCA.MEDIA, cashback[0]);
  else if (/\bcashback\b/i.test(fonte)) condicoes.cashback = campo(true, CONFIANCA.BAIXA, "cashback");

  const frete = fonte.match(/\b(?:frete gratis|frete grátis|entrega prime|prime)\b/i);
  if (frete) condicoes.freteGratis = campo(true, CONFIANCA.MEDIA, frete[0]);

  const oficial = fonte.match(/\b(?:loja oficial|oficial|mall|choice)\b/i);
  if (oficial) condicoes.seloOficial = campo(true, CONFIANCA.BAIXA, oficial[0]);

  const moedas = fonte.match(/\b(?:ganhe\s*)?(\d{1,5})?\s*moedas?\s*(?:shopee)?\b/i);
  if (moedas) condicoes.moedasShopee = campo(moedas[1] ? Number(moedas[1]) : true, CONFIANCA.MEDIA, moedas[0]);

  const brinde = fonte.match(/\b(?:brinde|ganhe junto|leva junto|gratis junto|grátis junto)[^\n]{0,80}/i);
  if (brinde) condicoes.brindes.push(evidencia(brinde[0]));

  for (const [tipo, regex] of [
    ["pix", /\bpix\b/],
    ["app", /\b(app|aplicativo)\b/],
    ["sem_juros", /\bsem juros\b/],
    ["relampago", /\b(relampago|relâmpago|flash|oferta do dia)\b/],
    ["resgate", /\bresgate\b/]
  ]) {
    if (regex.test(normalizado)) condicoes.especiais.push(tipo);
  }

  condicoes.especiais = [...new Set(condicoes.especiais)];
  return condicoes;
}

function camposEncontrados(resultado = {}) {
  const campos = [];
  const pares = [
    ["precoAtual", resultado.precoAtual?.valor],
    ["precoAntigo", resultado.precoAntigo?.valor],
    ["precoPix", resultado.precoPix?.valor],
    ["precoBoleto", resultado.precoBoleto?.valor],
    ["precoCartao", resultado.precoCartao?.valor],
    ["parcelamento", resultado.parcelamento?.quantidade],
    ["descontoPercentual", resultado.descontoPercentual?.valor],
    ["cupom", resultado.cupom?.codigo || resultado.cupom?.texto],
    ["cashback", resultado.cashback?.valor],
    ["freteGratis", resultado.freteGratis?.valor],
    ["marketplace", resultado.marketplace?.valor],
    ["categoria", resultado.categoria?.valor],
    ["avaliacao", resultado.avaliacao?.valor],
    ["quantidadeVendida", resultado.quantidadeVendida?.valor],
    ["estoque", resultado.estoque?.valor || resultado.estoque?.tipo === "texto"],
    ["seloOficial", resultado.seloOficial?.valor],
    ["moedasShopee", resultado.moedasShopee?.valor],
    ["brindes", resultado.brindes?.length],
    ["links", resultado.links?.encontrados?.length]
  ];
  for (const [nome, valor] of pares) {
    if (valor !== null && valor !== undefined && valor !== false && valor !== "" && valor !== 0) campos.push(nome);
  }
  return campos;
}

function extrairComercialUniversal(entrada = {}) {
  const textoFonte = textoNormalizado(entrada.textoOriginal || "").slice(0, LIMITES.TEXTO_MAX);
  const links = classificarLinksComerciais(textoFonte, entrada.links || []);
  const precos = extrairPrecosComerciais(textoFonte);
  const cupom = extrairCupomComercial(textoFonte);
  const condicoes = extrairCondicoes(textoFonte);

  const resultado = {
    versao: VERSAO_EXTRATOR_COMERCIAL,
    modo: "observacao",
    precoAtual: precos.precoAtual,
    precoAntigo: precos.precoAntigo,
    precoPix: precos.precoPix,
    precoBoleto: precos.precoBoleto,
    precoCartao: precos.precoCartao,
    precoParcelado: precos.precoParcelado,
    precoUnitario: precos.precoUnitario,
    parcelamento: precos.parcelamento,
    descontoPercentual: precos.descontoPercentual,
    valorEconomia: precos.valorEconomia,
    cupom,
    cashback: condicoes.cashback,
    freteGratis: condicoes.freteGratis,
    marketplace: entrada.marketplaceDetectado
      ? campo(entrada.marketplaceDetectado, CONFIANCA.ALTA, entrada.marketplaceDetectado)
      : detectarMarketplacePorTexto(textoFonte, links.encontrados),
    categoria: categoriaPorTexto(textoFonte),
    avaliacao: extrairAvaliacao(textoFonte),
    quantidadeVendida: extrairQuantidadeVendida(textoFonte),
    estoque: extrairEstoque(textoFonte),
    seloOficial: condicoes.seloOficial,
    moedasShopee: condicoes.moedasShopee,
    brindes: condicoes.brindes,
    condicoesEspeciais: condicoes.especiais,
    links,
    valorCupom: precos.valorCupom,
    frete: precos.frete,
    cashbackValor: precos.cashbackValor,
    candidatosPreco: precos.candidatosPreco,
    resolucaoPreco: precos.resolucaoPreco,
    ambiguidades: precos.ambiguidades,
    regexUtilizadas: [],
    camposEncontrados: [],
    camposAusentes: [],
    tiposReconhecidos: []
  };

  resultado.camposEncontrados = camposEncontrados(resultado);
  const todosCampos = ["precoAtual", "precoAntigo", "precoPix", "precoBoleto", "precoCartao", "precoUnitario", "parcelamento", "descontoPercentual", "valorCupom", "valorEconomia", "frete", "cashbackValor", "cupom", "cashback", "freteGratis", "marketplace", "categoria", "avaliacao", "quantidadeVendida", "estoque", "seloOficial", "moedasShopee", "brindes", "links"];
  resultado.camposAusentes = todosCampos.filter(campoNome => !resultado.camposEncontrados.includes(campoNome));
  resultado.tiposReconhecidos = [...new Set([
    ...resultado.camposEncontrados,
    ...resultado.condicoesEspeciais,
    ...resultado.links.classificados.map(item => `link_${item.tipo}`)
  ])];
  resultado.regexUtilizadas = resultado.tiposReconhecidos.slice(0, LIMITES.REGEX_MAX).map(tipo => `radar_comercial:${tipo}`);

  return resultado;
}

function resumirExtratorComercialParaLog(comercial = {}, duracaoMs = 0) {
  return {
    versao: comercial.versao || VERSAO_EXTRATOR_COMERCIAL,
    camposEncontrados: comercial.camposEncontrados || [],
    camposAusentes: comercial.camposAusentes || [],
    tiposReconhecidos: comercial.tiposReconhecidos || [],
    regexUtilizada: comercial.regexUtilizadas || [],
    confianca: {
      precoAtual: comercial.precoAtual?.confianca || CONFIANCA.AUSENTE,
      cupom: comercial.cupom?.confianca || CONFIANCA.AUSENTE,
      marketplace: comercial.marketplace?.confianca || CONFIANCA.AUSENTE,
      categoria: comercial.categoria?.confianca || CONFIANCA.AUSENTE
    },
    linksClassificados: (comercial.links?.classificados || []).map(item => ({ tipo: item.tipo, host: hostLink(item.link) })),
    duracaoMs
  };
}

module.exports = {
  VERSAO_EXTRATOR_COMERCIAL,
  CONFIANCA,
  extrairComercialUniversal,
  resumirExtratorComercialParaLog,
  classificarLinksComerciais,
  extrairPrecosComerciais,
  extrairCupomComercial
};
