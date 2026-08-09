const {
  normalizarApresentacaoComercial
} = require("../templates-clientes/normalizador-apresentacao-comercial");

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

function normalizarComparacao(valor = "") {
  return normalizarTexto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function beneficioComercialSeguro(valor = "") {
  const texto = normalizarTexto(valor);
  if (!texto) return false;

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
    .filter(beneficioComercialSeguro)
    .filter(Boolean)
    .slice(0, 3);
}

function listaTextoUnica(valores = []) {
  const resultado = [];
  const vistos = new Set();

  for (const valor of Array.isArray(valores) ? valores : []) {
    const item = normalizarTexto(valor);
    if (!item || vistos.has(item)) continue;
    vistos.add(item);
    resultado.push(item);
  }

  return resultado;
}

function linksComerciaisUnicos(links = []) {
  const resultado = [];
  const vistos = new Set();

  for (const [indice, link] of (Array.isArray(links) ? links : []).entries()) {
    if (!link || typeof link !== "object") continue;
    const tipo = normalizarTexto(link.tipo || link.papel || "produto");
    const ordemCaptura = Number(link.ordemCaptura || link.ordem || indice + 1) || (indice + 1);
    const afiliado = normalizarTexto(link.afiliado);
    const resolvido = normalizarTexto(link.resolvido);
    const original = normalizarTexto(link.original);
    const url = afiliado || resolvido || original;
    const chave = `${tipo}:${ordemCaptura}:${url}`;
    if (!url || vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push({
      tipo,
      papel: normalizarTexto(link.papel || tipo),
      ordemCaptura,
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
    "diversos",
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

  const score = normalizarNumero(campos.score);
  const prioridade = normalizarNumero(campos.prioridade);
  if (score != null && score < 45) return false;
  if (prioridade != null && prioridade < 45) return false;

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

function selecionarCamposUniversais(oferta = {}) {
  const ofertaApresentacao = normalizarApresentacaoComercial(oferta);
  const cupom = normalizarTexto(ofertaApresentacao.cupom);

  return {
    titulo: normalizarTexto(ofertaApresentacao.titulo),
    marketplace: normalizarTexto(ofertaApresentacao.marketplace),
    precoAtual: ofertaApresentacao.precoAtual,
    precoOriginal: ofertaApresentacao.precoOriginal,
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
    instrucaoCupom: normalizarTexto(ofertaApresentacao.instrucaoCupom),
    precoPix: normalizarTexto(ofertaApresentacao.precoPix || ofertaApresentacao.condicaoPix),
    condicaoPix: normalizarTexto(ofertaApresentacao.condicaoPix || ofertaApresentacao.precoPix),
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
    linksProduto: linksComerciaisUnicos(ofertaApresentacao.linksProduto),
    linksResgate: linksComerciaisUnicos(ofertaApresentacao.linksResgate),
    linkProduto: normalizarTexto(ofertaApresentacao.linkProduto),
    linkResgate: normalizarTexto(ofertaApresentacao.linkResgate),
    avaliacao: normalizarTexto(ofertaApresentacao.avaliacao || ofertaApresentacao.rating || ofertaApresentacao.nota),
    beneficios: normalizarBeneficios(ofertaApresentacao.beneficios),
    score: ofertaApresentacao.score,
    prioridade: ofertaApresentacao.prioridade,
    linkAfiliado: normalizarTexto(ofertaApresentacao.linkProduto || ofertaApresentacao.linkAfiliado)
  };
}

function textoIndicaPix(valor = "") {
  return normalizarComparacao(valor).includes("pix");
}

function textoPrecoAtualComCondicao(precoAtual = "", campos = {}) {
  if (!precoAtual) return precoAtual;
  const condicaoPix = campos.condicaoPix || campos.precoPix || "";
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

function extrairValoresMonetarios(texto = "") {
  const matches = String(texto || "").match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?\d+(?:\.\d{2})|R\$\s*\d+/g) || [];
  return matches
    .map(valor => normalizarNumero(valor))
    .filter(valor => valor != null);
}

function beneficioComercialValidoParaTemplate(beneficio = "", campos = {}) {
  const texto = normalizarTexto(beneficio);
  if (!texto || !beneficioComercialSeguro(texto)) return false;
  if (!beneficioDiferenteDoCupom(texto, campos.cupom)) return false;

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
  const beneficio = nomeBeneficioInstrucao(campos, beneficioComercial);

  if (campos.cupom && precoFinal && beneficio && beneficio !== "cupom") {
    return `Aplique o cupom ${campos.cupom} + ${beneficio} para pagar ${precoFinal}.`;
  }

  if (!campos.cupom && precoFinal && beneficio && beneficio !== "cupom") {
    return `Use ${beneficio} para pagar ${precoFinal}.`;
  }

  return "";
}

function beneficioSugereCupomGenerico(beneficio = "") {
  const texto = normalizarComparacao(beneficio);
  return texto.includes("cupom") || texto.includes("carrinho") || texto.includes("app");
}

function montarInstrucaoComercial(campos = {}, beneficioComercial = "", precoFinal = "") {
  const instrucaoPrecoFinal = precoFinal
    ? montarInstrucaoPrecoFinal(campos, beneficioComercial, precoFinal)
    : "";

  if (instrucaoPrecoFinal) return instrucaoPrecoFinal;

  if (campos.cupom) {
    return `Aplique o cupom ${campos.cupom} para obter o desconto.`;
  }

  if (!precoFinal && beneficioSugereCupomGenerico(beneficioComercial)) {
    const marketplace = marketplaceBonito(campos.marketplace);
    return `Pode haver benefício disponível na página/app${marketplace ? ` do ${marketplace}` : ""}. Confira antes de finalizar.`;
  }

  return beneficioComercial;
}

function adicionarBloco(blocos, linhas = []) {
  const bloco = linhas.map(normalizarTexto).filter(Boolean);
  if (bloco.length) blocos.push(bloco);
}

function gerarTemplateUniversal(oferta = {}) {
  const campos = selecionarCamposUniversais(oferta);
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
  const economia = economiaNumero != null && economiaNumero > 0
    ? formatarMoeda(economiaNumero)
    : "";
  const avaliacao = normalizarTexto(campos.avaliacao);
  let beneficioComercial = campos.beneficios.find(beneficio =>
    beneficioComercialValidoParaTemplate(beneficio, campos)
  );
  const detalhesComerciais = [
    campos.precoUnitario ? `ℹ️ Preço unitário: *${campos.precoUnitario}*` : "",
    campos.cashback ? `💰 ${campos.cashback}` : "",
    campos.freteGratis ? "🚚 Frete gratis" : (campos.frete ? `🚚 ${campos.frete}` : ""),
    campos.ofertaRelampago ? "⚡ Oferta Relampago" : "",
    campos.validade ? `⏳ ${campos.validade}` : "",
    ...campos.condicoes,
    ...campos.observacoes,
    ...(campos.tamanhos.length ? [`⚠️ Tamanhos: ${campos.tamanhos.join(", ")}`] : []),
    ...(campos.cores.length ? [`🎨 Cores: ${campos.cores.join(", ")}`] : []),
    ...(campos.variantes.length ? campos.variantes : []),
    campos.voltagem ? `🔌 ${campos.voltagem}` : ""
  ].map(normalizarTexto).filter(Boolean).slice(0, 8);
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

  adicionarBloco(blocos, [campos.titulo ? `🔥 *${campos.titulo}*` : ""]);
  adicionarBloco(blocos, [
    campos.marketplace ? `🛍️ ${marketplaceBonito(campos.marketplace)}` : "",
    categoriaConfiavel(campos) ? `📂 ${campos.categoria}` : ""
  ]);
  adicionarBloco(blocos, [
    precoOriginal ? `❌ De: *${precoOriginal}*` : "",
    precoAtualComCondicao ? `✅ Por: *${precoAtualComCondicao}*` : "",
    campos.parcelamento ? `💳 ${campos.parcelamento}` : "",
    economia ? `💸 Economia: *${economia}${descontoPercentual != null && descontoPercentual > 0 ? ` (${descontoPercentual.toFixed(0)}%)` : ""}*` : ""
  ]);
  adicionarBloco(blocos, detalhesComerciais);
  adicionarBloco(blocos, [
    campos.cupom ? `🎟️ Cupom: *${campos.cupom}*` : "",
    campos.instrucaoCupom && campos.instrucaoCupom !== campos.cupomTexto
      ? `⚡ ${campos.instrucaoCupom}`
      : ""
  ]);
  adicionarBloco(blocos, [
    avaliacao ? "✰ Avaliação" : "",
    avaliacao
  ]);
  adicionarBloco(blocos, [
    linkResgate ? "\uD83C\uDF9F\uFE0F *Resgate os cupons:*" : "",
    linkResgate
  ]);
  adicionarBloco(blocos, [
    campos.linkAfiliado ? "\uD83D\uDD17 *Confira aqui:*" : "",
    campos.linkAfiliado
  ]);
  adicionarBloco(blocos, linksAdicionais);
  adicionarBloco(blocos, [
    beneficioComercial ? `⚡ ${beneficioComercial}` : "",
    "⚠️ Oferta sujeita à alteração de preço."
  ]);

  return blocos.map(bloco => bloco.join("\n")).join("\n\n");
}
module.exports = {
  gerarTemplateUniversal,
  apresentarScore
};
