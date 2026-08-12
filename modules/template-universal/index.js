const {
  normalizarApresentacaoComercial
} = require("../templates-clientes/normalizador-apresentacao-comercial");
const {
  textoPixValido
} = require("../radar/preco-pix-precedencia");
const {
  classificacaoVisualOferta
} = require("../templates-clientes/classificacao-visual-oferta");
const {
  resolverContratoComercialFinal
} = require("../templates-clientes/contrato-comercial-final");

function normalizarTexto(valor) {
  if (valor == null) return "";
  return String(valor).trim();
}

function normalizarNumero(valor) {
  if (valor == null || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  const texto = String(valor)
    .replace(/R\$/gi, "")
    .replace(/%/g, "")
    .replace(/\s/g, "")
    .trim();

  if (!texto) return null;

  const temVirgula = texto.includes(",");
  const temPonto = texto.includes(".");

  let normalizado = texto;

  if (temVirgula && temPonto) {
    normalizado = texto.replace(/\./g, "").replace(",", ".");
  } else if (temVirgula) {
    normalizado = texto.replace(",", ".");
  }

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function formatarMoeda(valor) {
  const numero = normalizarNumero(valor);
  if (numero == null) return "";

  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).replace(/\u00A0/g, " ");
}

function numeroMonetarioEmTexto(valor) {
  const direto = normalizarNumero(valor);
  if (direto != null) return direto;
  const match = normalizarTexto(valor).match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|(?:R\$\s*)?\d+(?:[,.]\d{1,2})?/);
  return match ? normalizarNumero(match[0]) : null;
}

function normalizarComparacao(valor = "") {
  return normalizarTexto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const METADADOS_TECNICOS_CRUS = new Set([
  "pix",
  "pagamento pix",
  "pagamentopix",
  "desconto pix",
  "descontopix",
  "beneficio pix",
  "beneficiopix",
  "frete",
  "voucher ou moedas",
  "voucheroumoedas",
  "voucher moedas"
]);

function chaveTecnicaCrua(valor = "") {
  return normalizarComparacao(valor).replace(/[^a-z0-9]+/g, " ").trim();
}

function metadadoTecnicoCru(valor = "") {
  const chave = chaveTecnicaCrua(valor);
  return Boolean(chave && METADADOS_TECNICOS_CRUS.has(chave));
}

function textoComercialRenderizavel(valor = "") {
  const item = normalizarTexto(valor);
  return item && !metadadoTecnicoCru(item) ? item : "";
}

function removerPrefixoVisual(valor = "", prefixo = "") {
  let item = normalizarTexto(valor);
  if (!item || !prefixo) return item;
  while (item.startsWith(prefixo)) {
    item = item.slice(prefixo.length).trimStart();
  }
  return item;
}

function linhaComPrefixo(prefixo = "", valor = "", opcoes = {}) {
  const item = textoComercialRenderizavel(removerPrefixoVisual(valor, prefixo));
  if (!item) return "";
  return `${prefixo} ${opcoes.negrito ? `*${item}*` : item}`;
}

function beneficioComercialSeguro(valor = "") {
  const texto = normalizarTexto(valor);
  if (!texto) return false;
  if (metadadoTecnicoCru(texto)) return false;

  const normalizado = normalizarComparacao(texto);

  if (["pix", "app", "cashback"].includes(normalizado)) return true;

  if (/^[a-z0-9_:-]+$/.test(normalizado)) return false;

  return [
    "cupom",
    "pix",
    "frete",
    "variacao",
    "cashback",
    "desconto",
    "parcel",
    "app",
    "relampago",
    "oferta",
    "pagina"
  ].some(termo => normalizado.includes(termo));
}

function normalizarBeneficios(beneficios) {
  if (!Array.isArray(beneficios)) return [];

  return beneficios
    .map(normalizarTexto)
    .filter(item => !metadadoTecnicoCru(item))
    .filter(beneficioComercialSeguro)
    .filter(Boolean)
    .slice(0, 3);
}

function listaTextoUnica(valores = []) {
  const resultado = [];
  const vistos = new Set();

  for (const valor of Array.isArray(valores) ? valores : []) {
    const item = normalizarTexto(valor);
    if (!item || metadadoTecnicoCru(item) || vistos.has(item)) continue;
    vistos.add(item);
    resultado.push(item);
  }

  return resultado;
}

function linksComerciaisUnicos(links = []) {
  const resultado = [];

  for (const [indice, link] of (Array.isArray(links) ? links : []).entries()) {
    if (!link || typeof link !== "object") continue;
    const tipo = normalizarTexto(link.tipo || link.papel || "produto");
    const ordemCaptura = Number(link.ordemCaptura || link.ordem || indice + 1) || (indice + 1);
    const afiliado = normalizarTexto(link.afiliado);
    const resolvido = normalizarTexto(link.resolvido);
    const original = normalizarTexto(link.original);
    const url = afiliado || resolvido || original;
    if (!url) continue;
    resultado.push({
      tipo,
      papel: normalizarTexto(link.papel || tipo),
      ordemCaptura,
      ocorrenciaId: normalizarTexto(link.ocorrenciaId || link.idOcorrencia || `link:${tipo}:${ordemCaptura}:${indice + 1}`),
      original,
      resolvido,
      afiliado,
      status: normalizarTexto(link.status || "")
    });
  }

  return resultado;
}

function marketplaceBonito(valor = "") {
  const texto = normalizarTexto(valor);
  if (!texto) return "";

  const chave = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const nomes = {
    mercadolivre: "Mercado Livre",
    shopee: "Shopee",
    amazon: "Amazon",
    aliexpress: "AliExpress",
    kabum: "KaBuM",
    awin: "AWIN"
  };

  if (nomes[chave]) return nomes[chave];

  return texto
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(parte => parte.length <= 4
      ? parte.toUpperCase()
      : parte.charAt(0).toUpperCase() + parte.slice(1).toLowerCase())
    .join(" ");
}

function categoriaConfiavel(campos = {}) {
  const categoria = normalizarTexto(campos.categoria);
  if (!categoria) return false;

  const categoriaNormalizada = normalizarComparacao(categoria);
  const marketplaceNormalizado = normalizarComparacao(campos.marketplace);
  const categoriasFracas = [
    "shopee",
    "mercado livre",
    "mercadolivre",
    "amazon"
  ];

  if (categoriasFracas.includes(categoriaNormalizada)) return false;
  if (marketplaceNormalizado && categoriaNormalizada === marketplaceNormalizado) return false;

  if (
    campos.categoriaGenerica === true ||
    campos.categoriaBaixaConfianca === true ||
    campos.baixaConfiancaCategoria === true
  ) {
    return false;
  }

  const confiancaCategoria = normalizarNumero(campos.categoriaConfianca ?? campos.confiancaCategoria);
  if (confiancaCategoria != null && confiancaCategoria < 0.5) return false;

  return true;
}

function apresentarScore(score) {
  const numero = normalizarNumero(score);
  if (numero == null) return "";

  const valor = Math.max(0, Math.min(100, Math.round(numero)));

  if (valor <= 24) return "⭐☆☆☆☆";
  if (valor <= 44) return "⭐⭐☆☆☆";
  if (valor <= 64) return "⭐⭐⭐☆☆";
  if (valor <= 84) return "⭐⭐⭐⭐☆";
  return "⭐⭐⭐⭐⭐";
}

function formatarAvaliacaoReal(valor = "", quantidade = "") {
  const avaliacao = normalizarTexto(valor);
  if (!avaliacao) return "";

  const match = avaliacao.replace(",", ".").match(/\b([0-5](?:\.\d+)?)\b(?:\s*\/\s*5)?/);
  if (!match) return "";

  const numero = Number(match[1]);
  if (!Number.isFinite(numero) || numero <= 0 || numero > 5) return "";

  const nota = numero.toLocaleString("pt-BR", {
    minimumFractionDigits: numero % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1
  });
  const quantidadeNumero = normalizarNumero(quantidade);
  const qtd = quantidadeNumero != null
    ? Math.round(quantidadeNumero).toLocaleString("pt-BR")
    : normalizarTexto(quantidade);
  return `⭐ ${nota}${qtd ? ` • ${qtd}` : ""}`;
}

function oportunidadeVisualTemplate(campos = {}) {
  return classificacaoVisualOferta(campos);
}

function avisoFinalTemplate(oferta = {}) {
  return normalizarTexto(
    oferta.avisoFinal ||
    oferta.avisoAlteracao ||
    oferta.avisoPreco ||
    oferta.avisoVariacaoPreco ||
    oferta.aviso ||
    "Oferta sujeita à alteração de preço."
  );
}

function selecionarCamposUniversais(oferta = {}) {
  const ofertaApresentacao = resolverContratoComercialFinal(normalizarApresentacaoComercial(oferta));
  const contratoFinal = ofertaApresentacao.contratoComercialFinal || {};
  const cupom = normalizarTexto(contratoFinal.cupomCodigo || ofertaApresentacao.cupom);

  return {
    titulo: normalizarTexto(ofertaApresentacao.titulo),
    marketplace: normalizarTexto(ofertaApresentacao.marketplace),
    precoAtual: contratoFinal.precoPor ?? ofertaApresentacao.precoAtual,
    precoOriginal: contratoFinal.precoDe ?? ofertaApresentacao.precoOriginal,
    condicaoPrecoPor: normalizarTexto(contratoFinal.condicaoPrecoPor || ofertaApresentacao.condicaoPrecoPor),
    precoPixDistinto: contratoFinal.precoPixDistinto ?? ofertaApresentacao.precoPixDistinto ?? null,
    valorEfetivo: ofertaApresentacao.valorEfetivo,
    valorEfetivoOrigem: normalizarTexto(ofertaApresentacao.valorEfetivoOrigem),
    valorEfetivoDetalhes: ofertaApresentacao.valorEfetivoDetalhes || {},
    economia: ofertaApresentacao.economia,
    descontoPercentual: ofertaApresentacao.descontoPercentual,
    categoria: normalizarTexto(ofertaApresentacao.categoria),
    categoriaConfianca: ofertaApresentacao.categoriaConfianca,
    confiancaCategoria: ofertaApresentacao.confiancaCategoria,
    categoriaGenerica: ofertaApresentacao.categoriaGenerica,
    categoriaBaixaConfianca: ofertaApresentacao.categoriaBaixaConfianca,
    baixaConfiancaCategoria: ofertaApresentacao.baixaConfiancaCategoria,
    cupom,
    cupomTexto: normalizarTexto(ofertaApresentacao.cupomTexto || cupom),
    instrucaoCupom: textoComercialRenderizavel(contratoFinal.instrucaoComercial !== undefined ? contratoFinal.instrucaoComercial : ofertaApresentacao.instrucaoCupom),
    instrucaoComercial: textoComercialRenderizavel(contratoFinal.instrucaoComercial !== undefined ? contratoFinal.instrucaoComercial : ofertaApresentacao.instrucaoComercial),
    precoPix: normalizarTexto(contratoFinal.precoPixTexto || ""),
    condicaoPix: normalizarTexto(ofertaApresentacao.condicaoPix),
    precoUnitario: normalizarTexto(ofertaApresentacao.precoUnitario || ofertaApresentacao.unitarioCapturado),
    parcelamento: normalizarTexto(ofertaApresentacao.parcelamento),
    quantidade: normalizarTexto(ofertaApresentacao.quantidade),
    quantidadeParcelas: normalizarTexto(ofertaApresentacao.quantidadeParcelas),
    valorParcela: ofertaApresentacao.valorParcela,
    cashback: normalizarTexto(ofertaApresentacao.cashback),
    frete: normalizarTexto(ofertaApresentacao.frete || ofertaApresentacao.freteTexto),
    freteGratis: ofertaApresentacao.freteGratis === true,
    condicoes: listaTextoUnica(ofertaApresentacao.condicoes),
    observacoes: listaTextoUnica(ofertaApresentacao.observacoes),
    variantes: listaTextoUnica(ofertaApresentacao.variantes),
    tamanhos: listaTextoUnica(ofertaApresentacao.tamanhos),
    cores: listaTextoUnica(ofertaApresentacao.cores),
    voltagem: normalizarTexto(ofertaApresentacao.voltagem),
    ofertaRelampago: ofertaApresentacao.ofertaRelampago === true,
    validade: normalizarTexto(ofertaApresentacao.validade),
    linksComerciais: linksComerciaisUnicos(ofertaApresentacao.linksComerciais),
    linksProduto: linksComerciaisUnicos(contratoFinal.linksProduto || ofertaApresentacao.linksProduto),
    linksResgate: linksComerciaisUnicos(contratoFinal.linksResgate || ofertaApresentacao.linksResgate),
    linksApp: linksComerciaisUnicos(contratoFinal.linksApp || []),
    linksPc: linksComerciaisUnicos(contratoFinal.linksPc || []),
    linksMoedas: linksComerciaisUnicos(contratoFinal.linksMoedas || []),
    linkProduto: normalizarTexto(ofertaApresentacao.linkProduto),
    linkResgate: normalizarTexto(ofertaApresentacao.linkResgate),
    linkApp: normalizarTexto(ofertaApresentacao.linkApp),
    linkPc: normalizarTexto(ofertaApresentacao.linkPc),
    linkMoedas: normalizarTexto(ofertaApresentacao.linkMoedas),
    avaliacao: normalizarTexto(ofertaApresentacao.avaliacao || ofertaApresentacao.rating || ofertaApresentacao.nota),
    quantidadeAvaliacoes: normalizarTexto(ofertaApresentacao.quantidadeAvaliacoes || ofertaApresentacao.totalAvaliacoes || ofertaApresentacao.avaliacoes || ofertaApresentacao.reviews),
    beneficio: textoComercialRenderizavel(contratoFinal.beneficio !== undefined ? contratoFinal.beneficio : ofertaApresentacao.beneficio),
    beneficios: normalizarBeneficios(contratoFinal.beneficio ? [contratoFinal.beneficio] : ofertaApresentacao.beneficios),
    score: ofertaApresentacao.score,
    prioridade: ofertaApresentacao.prioridade,
    avisoFinal: avisoFinalTemplate(ofertaApresentacao),
    linkAfiliado: normalizarTexto(ofertaApresentacao.linkProduto || ofertaApresentacao.linkAfiliado)
  };
}

function textoIndicaPix(valor = "") {
  return normalizarComparacao(valor).includes("pix");
}

function precoPixRenderizavel(valor = "", campos = {}, opcoes = {}) {
  const textoPix = normalizarTexto(valor);
  if (!textoPix) return "";
  return textoPixValido(textoPix);
}

function instrucaoCupomDeterministica(cupom = "") {
  const codigo = textoComercialRenderizavel(cupom);
  return codigo ? `Aplique o cupom ${codigo} para obter o valor.` : "";
}

function textoPrecoAtualComCondicao(precoAtual = "", campos = {}) {
  if (!precoAtual) return precoAtual;
  if (normalizarComparacao(campos.condicaoPrecoPor) === "pix" && !textoIndicaPix(precoAtual)) return `${precoAtual} no Pix`;
  const condicaoPix = precoPixRenderizavel(campos.condicaoPix || campos.precoPix || "", campos, { permitirMesmoPreco: true });
  if (campos.precoPix && normalizarComparacao(campos.precoPix) !== normalizarComparacao(precoAtual)) return precoAtual;
  if (textoIndicaPix(condicaoPix)) return `${precoAtual} no Pix`;
  return precoAtual;
}

function economiaReal(precoOriginal, precoAtual, economia) {
  const economiaInformada = normalizarNumero(economia);
  if (economiaInformada != null && economiaInformada > 0) return economiaInformada;

  const original = normalizarNumero(precoOriginal);
  const atual = normalizarNumero(precoAtual);

  if (original != null && atual != null && original > atual) {
    return original - atual;
  }

  return null;
}

function descontoReal(precoOriginal, precoAtual, descontoPercentual) {
  const descontoInformado = normalizarNumero(descontoPercentual);
  if (descontoInformado != null && descontoInformado > 0) return descontoInformado;

  const original = normalizarNumero(precoOriginal);
  const atual = normalizarNumero(precoAtual);

  if (original != null && atual != null && original > atual) {
    return ((original - atual) / original) * 100;
  }

  return null;
}

function beneficioDiferenteDoCupom(beneficio = "", cupom = "") {
  const texto = normalizarComparacao(beneficio);
  const codigo = normalizarComparacao(cupom);

  return !codigo || !texto.includes(codigo);
}

function assinaturaFatoComercial(valor = "") {
  const semUrl = normalizarTexto(valor).replace(/https?:\/\/\S+|www\.\S+/gi, " ");
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

function beneficioDuplicaOutroPapel(beneficio = "", campos = {}) {
  const chave = assinaturaFatoComercial(beneficio);
  if (!chave) return false;
  return [
    campos.cupom,
    campos.cupomTexto,
    campos.instrucaoCupom,
    campos.avaliacao
  ].some(valor => {
    const ref = assinaturaFatoComercial(valor);
    return Boolean(ref && ref === chave);
  });
}

function extrairValoresMonetarios(texto = "") {
  const matches = String(texto || "").match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?\d+(?:\.\d{2})|R\$\s*\d+/g) || [];
  return matches
    .map(valor => normalizarNumero(valor))
    .filter(valor => valor != null);
}

function beneficioComercialValidoParaTemplate(beneficio = "", campos = {}) {
  const texto = normalizarTexto(beneficio);
  if (!texto || !beneficioComercialSeguro(texto)) return false;
  if (metadadoTecnicoCru(texto)) return false;
  if (!beneficioDiferenteDoCupom(texto, campos.cupom)) return false;
  if (beneficioDuplicaOutroPapel(texto, campos)) return false;

  const normalizado = normalizarComparacao(texto);
  const precoAtual = normalizarNumero(campos.precoAtual);
  const valores = extrairValoresMonetarios(texto);

  if (normalizado.includes("pix")) {
    if (valorEfetivoConfirmado(campos) != null) return true;
    if (precoAtual == null || !valores.length) return false;
    return valores.some(valor => valor < precoAtual);
  }

  if (precoAtual != null && valores.some(valor => valor >= precoAtual)) return false;

  return true;
}

function origemValorEfetivoComercial(origem = "") {
  const normalizado = normalizarComparacao(origem);

  return [
    "cupom",
    "pix",
    "app",
    "cashback",
    "frete_gratis",
    "desconto"
  ].some(termo => normalizado.includes(termo));
}

function valorEfetivoConfirmado(campos = {}) {
  const valorEfetivo = normalizarNumero(campos.valorEfetivo);
  const precoAtual = normalizarNumero(campos.precoAtual);

  if (valorEfetivo == null || precoAtual == null || valorEfetivo >= precoAtual) return null;
  if (!origemValorEfetivoComercial(campos.valorEfetivoOrigem)) return null;

  return valorEfetivo;
}

function nomeBeneficioInstrucao(campos = {}, beneficioComercial = "") {
  const origem = normalizarComparacao(campos.valorEfetivoOrigem);
  const beneficio = normalizarComparacao(beneficioComercial);

  if (origem.includes("pix") || beneficio.includes("pix")) return "PIX";
  if (origem.includes("app") || beneficio.includes("app")) return "app";
  if (origem.includes("cashback") || beneficio.includes("cashback")) return "cashback";
  if (origem.includes("frete") || beneficio.includes("frete")) return "frete gratis";
  if (origem.includes("cupom") || beneficio.includes("cupom")) return "cupom";

  return "";
}

function montarInstrucaoPrecoFinal(campos = {}, beneficioComercial = "", precoFinal = "") {
  return "";
}

function beneficioSugereCupomGenerico(beneficio = "") {
  const texto = normalizarComparacao(beneficio);
  return texto.includes("cupom") || texto.includes("carrinho") || texto.includes("app");
}

function montarInstrucaoComercial(campos = {}, beneficioComercial = "", precoFinal = "") {
  return textoComercialRenderizavel(campos.instrucaoComercial || campos.instrucaoCupom);
}

function adicionarBloco(blocos, linhas = []) {
  const bloco = linhas.map(normalizarTexto).filter(Boolean);
  if (bloco.length) blocos.push(bloco);
}

function papelLinkTemplate(item = {}) {
  const papel = normalizarComparacao(item.papel || item.tipo || "produto").replace(/^link_/, "");
  if (["resgate", "cupom"].includes(papel)) return "resgate";
  if (["app", "aplicativo"].includes(papel)) return "app";
  if (["pc", "desktop"].includes(papel)) return "pc";
  if (["moeda", "moedas", "coins"].includes(papel)) return "moedas";
  if (["produto", "afiliado", "linkproduto"].includes(papel)) return "produto";
  return papel || "produto";
}

function urlLinkTemplate(item = {}) {
  if (typeof item === "string") return normalizarTexto(item);
  const convertido = normalizarTexto(
    item.urlOptimus ||
    item.urlAfiliadaWorkspace ||
    item.urlAfiliada ||
    item.afiliado ||
    item.linkAfiliado ||
    ""
  );
  if (convertido) return convertido;
  const origem = normalizarComparacao([
    item.origem,
    item.proveniencia,
    item.fonte,
    item.campo,
    item.tipoOrigem
  ].filter(Boolean).join(" "));
  if (/\b(?:imagem|canonical|permalink|url\s+rica|url\s+tecnica|link\s+resolvido\s+imagem|importer|adapter|metadata|api|html)\b/.test(origem)) return "";
  return normalizarTexto(item.resolvido || item.original || item.link || item.url);
}

function linksPorPapelTemplate(campos = {}, papel = "") {
  const linksComerciais = Array.isArray(campos.linksComerciais) ? campos.linksComerciais : [];
  const candidatos = linksComerciais.length
    ? linksComerciais
    : [
      ...(Array.isArray(campos.linksProduto) ? campos.linksProduto : []),
      ...(Array.isArray(campos.linksResgate) ? campos.linksResgate : [])
    ];
  const links = [];

  for (const [indice, item] of candidatos.entries()) {
    if (!item || typeof item !== "object") continue;
    if (papelLinkTemplate(item) !== papel) continue;
    const url = urlLinkTemplate(item);
    const ordem = Number(item.ordemCaptura || item.ordem || indice + 1) || (indice + 1);
    if (!url) continue;
    links.push({ url, ordem });
  }

  return links.sort((a, b) => a.ordem - b.ordem).map(item => item.url);
}

function linksComFallbackTemplate(campos = {}, papel = "", fallback = "") {
  const links = linksPorPapelTemplate(campos, papel);
  const valorFallback = normalizarTexto(fallback);
  return links.length ? links : (valorFallback ? [valorFallback] : []);
}

function adicionarBlocoLinks(blocos, titulo = "", links = []) {
  const urls = (Array.isArray(links) ? links : []).map(normalizarTexto).filter(Boolean);
  if (!urls.length) return;
  adicionarBloco(blocos, [titulo, ...urls]);
}

function listaComercialSemRepetir(valores = []) {
  const resultado = [];
  const vistos = new Set();
  for (const valor of valores) {
    const item = normalizarTexto(valor);
    const chave = normalizarComparacao(item);
    if (!item || vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push(item);
  }
  return resultado;
}

function mesmoFatoComercial(a = "", b = "") {
  const ca = normalizarComparacao(a);
  const cb = normalizarComparacao(b);
  return Boolean(ca && cb && ca === cb);
}

function detalhesNaoDuplicados(campos = {}, valores = []) {
  const protegidos = [
    campos.parcelamento,
    campos.frete,
    campos.freteGratis ? "Frete gratis" : "",
    campos.beneficio
  ].map(normalizarTexto).filter(Boolean);
  return (Array.isArray(valores) ? valores : []).filter(valor =>
    !protegidos.some(protegido => mesmoFatoComercial(valor, protegido))
  );
}

function montarTemplateUniversalOficial({
  campos,
  blocos,
  precoOriginal,
  precoAtualComCondicao,
  descontoCalculado,
  descontoPercentual,
  economia,
  avaliacao,
  oportunidadeVisual,
  detalhesComerciais,
  beneficioComercial,
  linksResgate,
  linksApp,
  linksMoedas,
  linksPc,
  linksProduto
}) {
  adicionarBloco(blocos, [linhaComPrefixo("🔥", campos.titulo, { negrito: true })]);
  adicionarBloco(blocos, [
    campos.marketplace ? `🛍️ ${marketplaceBonito(campos.marketplace)}` : "",
    categoriaConfiavel(campos) ? `📂 ${campos.categoria}` : "",
    oportunidadeVisual,
    avaliacao
  ]);
  adicionarBloco(blocos, [
    precoOriginal ? `❌ De: *${precoOriginal}*` : "",
    precoAtualComCondicao ? `✅ Por: *${precoAtualComCondicao}*` : "",
    descontoCalculado != null && descontoCalculado > 0 ? `📉 ${descontoCalculado.toFixed(0)}% OFF` : "",
    campos.parcelamento ? linhaComPrefixo("💳", campos.parcelamento) : "",
    economia ? `💸 Economia: *${economia}${descontoPercentual != null && descontoPercentual > 0 ? ` (${descontoPercentual.toFixed(0)}%)` : ""}*` : ""
  ]);
  adicionarBloco(blocos, [
    campos.cupom ? `🎟️ Cupom: *${campos.cupom}*` : "",
    campos.cupom ? linhaComPrefixo("⚡", instrucaoCupomDeterministica(campos.cupom)) : "",
    beneficioComercial ? linhaComPrefixo("🎁", beneficioComercial) : "",
    ...detalhesComerciais
  ]);
  adicionarBlocoLinks(blocos, "🎟️ *Resgate:*", linksResgate);
  adicionarBlocoLinks(blocos, "📱 *APP:*", linksApp);
  adicionarBlocoLinks(blocos, "🪙 *Moedas:*", linksMoedas);
  adicionarBlocoLinks(blocos, "🖥️ *PC:*", linksPc);
  adicionarBlocoLinks(blocos, "🔗 *Confira aqui:*", linksProduto);
  adicionarBloco(blocos, [campos.avisoFinal ? `⚠️ ${campos.avisoFinal}` : ""]);
  return blocos.map(bloco => bloco.join("\n")).join("\n\n");
}

function gerarTemplateUniversal(oferta = {}) {
  const campos = selecionarCamposUniversais(oferta);
  campos.precoPix = "";
  const blocos = [];
  const precoAtualExibido = campos.precoAtual;
  const precoAtualNumero = normalizarNumero(precoAtualExibido);
  const precoOriginalNumero = normalizarNumero(campos.precoOriginal);
  const precoAtual = formatarMoeda(precoAtualExibido) || normalizarTexto(precoAtualExibido);
  const precoAtualComCondicao = textoPrecoAtualComCondicao(precoAtual, campos);
  const precoOriginal = precoOriginalNumero != null &&
    precoAtualNumero != null &&
    precoOriginalNumero > precoAtualNumero
      ? formatarMoeda(campos.precoOriginal)
      : "";
  const economiaNumero = normalizarNumero(campos.economia);
  const descontoPercentual = normalizarNumero(campos.descontoPercentual);
  const descontoCalculado = descontoReal(campos.precoOriginal, campos.precoAtual, campos.descontoPercentual);
  const economia = economiaNumero != null && economiaNumero > 0
    ? formatarMoeda(economiaNumero)
    : "";
  const avaliacao = formatarAvaliacaoReal(campos.avaliacao, campos.quantidadeAvaliacoes);
  const oportunidadeVisual = oportunidadeVisualTemplate(campos);
  let beneficioComercial = campos.beneficio || campos.beneficios.find(beneficio =>
    beneficioComercialValidoParaTemplate(beneficio, campos)
  );
  const condicoesDetalhe = detalhesNaoDuplicados(campos, campos.condicoes);
  const observacoesDetalhe = detalhesNaoDuplicados(campos, campos.observacoes);
  const detalhesComerciais = listaComercialSemRepetir([
    campos.precoUnitario ? `ℹ️ Preço unitário: *${campos.precoUnitario}*` : "",
    campos.cashback ? linhaComPrefixo("💰", campos.cashback) : "",
    campos.freteGratis ? "🚚 Frete gratis" : (campos.frete ? linhaComPrefixo("🚚", campos.frete) : ""),
    campos.ofertaRelampago ? "⚡ Oferta Relampago" : "",
    campos.validade ? linhaComPrefixo("⏳", campos.validade) : "",
    ...condicoesDetalhe,
    ...observacoesDetalhe,
    ...(campos.tamanhos.length ? [`⚠️ Tamanhos: ${campos.tamanhos.join(", ")}`] : []),
    ...(campos.cores.length ? [`🎨 Cores: ${campos.cores.join(", ")}`] : []),
    ...(campos.variantes.length ? campos.variantes : []),
    campos.voltagem ? `🔌 ${campos.voltagem}` : ""
  ].map(normalizarTexto).filter(item => item && !metadadoTecnicoCru(item))).slice(0, 8);
  const linkPrincipal = normalizarTexto(campos.linkAfiliado);
  const linkResgate = normalizarTexto(campos.linkResgate);
  const linksAdicionais = campos.linksComerciais
    .filter(item => normalizarTexto(item.afiliado || item.resolvido || item.original) !== linkPrincipal)
    .filter(item => normalizarTexto(item.afiliado || item.resolvido || item.original) !== linkResgate)
    .filter(item => ["resgate", "cupom", "landing", "adicional"].includes(normalizarComparacao(item.tipo)))
    .map(item => {
      const url = normalizarTexto(item.afiliado || item.resolvido || item.original);
      const tipo = normalizarComparacao(item.tipo).includes("resgate") || normalizarComparacao(item.tipo).includes("cupom")
        ? "Resgate/cupom"
        : "Link adicional";
      return url ? `🔗 ${tipo}: ${url}` : "";
    })
    .filter(Boolean)
    .slice(0, 3);
  const linksResgate = linksComFallbackTemplate(campos, "resgate", campos.linkResgate);
  const linksApp = campos.linksApp.length
    ? linksPorPapelTemplate({ linksComerciais: campos.linksApp }, "app")
    : linksComFallbackTemplate(campos, "app", campos.linkApp);
  const linksMoedas = campos.linksMoedas.length
    ? linksPorPapelTemplate({ linksComerciais: campos.linksMoedas }, "moedas")
    : linksComFallbackTemplate(campos, "moedas", campos.linkMoedas);
  const linksPc = campos.linksPc.length
    ? linksPorPapelTemplate({ linksComerciais: campos.linksPc }, "pc")
    : linksComFallbackTemplate(campos, "pc", campos.linkPc);
  const linksProduto = linksComFallbackTemplate(campos, "produto", campos.linksComerciais.length ? "" : campos.linkAfiliado);

  return montarTemplateUniversalOficial({
    campos,
    blocos,
    precoOriginal,
    precoAtualComCondicao,
    descontoCalculado,
    descontoPercentual,
    economia,
    avaliacao,
    oportunidadeVisual,
    detalhesComerciais,
    beneficioComercial,
    linksResgate,
    linksApp,
    linksMoedas,
    linksPc,
    linksProduto
  });

}
module.exports = {
  gerarTemplateUniversal,
  apresentarScore
};
