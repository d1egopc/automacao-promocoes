function textoLimpo(valor) {
  return String(valor || "").trim();
}

function temValor(valor) {
  return valor !== null && valor !== undefined && textoLimpo(valor) !== "";
}

function normalizarNumero(valor) {
  if (!temValor(valor)) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  let texto = textoLimpo(valor)
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/[^\d.,-]/g, "");

  if (!texto) return null;

  const negativo = texto.startsWith("-");
  texto = texto.replace(/-/g, "");

  const temVirgula = texto.includes(",");
  const temPonto = texto.includes(".");

  if (temVirgula && temPonto) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (temVirgula) {
    texto = texto.replace(",", ".");
  } else if (temPonto) {
    const partes = texto.split(".");
    const ultimo = partes[partes.length - 1] || "";
    const milhares = /^\d{1,3}(?:\.\d{3})+$/.test(texto);
    texto = milhares && ultimo.length === 3 ? texto.replace(/\./g, "") : texto;
  }

  const numero = Number(`${negativo ? "-" : ""}${texto}`);
  return Number.isFinite(numero) ? numero : null;
}

function formatarMoeda(valor) {
  const numero = normalizarNumero(valor);
  if (numero === null) return "";

  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function formatarPercentual(valor) {
  if (!temValor(valor)) return "";
  const numero = normalizarNumero(valor);
  if (numero === null) return textoLimpo(valor);
  return `${Math.round(numero)}%`;
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const texto = textoLimpo(valor);
    if (texto) return texto;
  }
  return "";
}

function listaTexto(...valores) {
  const resultado = [];
  const vistos = new Set();
  for (const valor of valores.flat()) {
    const texto = textoLimpo(valor);
    if (!texto || vistos.has(texto)) continue;
    vistos.add(texto);
    resultado.push(texto);
  }
  return resultado;
}

function listaObjetosLinks(links = []) {
  const resultado = [];
  const vistos = new Set();

  for (const item of Array.isArray(links) ? links : []) {
    if (!item || typeof item !== "object") continue;
    const url = primeiroTexto(item.afiliado, item.resolvido, item.original, item.link, item.url);
    if (!url || vistos.has(url)) continue;
    vistos.add(url);
    resultado.push({
      tipo: textoLimpo(item.tipo || "produto"),
      url
    });
  }

  return resultado;
}

function cupomOfertaFallback(oferta = {}) {
  const cupons = listaTexto(
    Array.isArray(oferta.cupons) ? oferta.cupons : [],
    Array.isArray(oferta.codigosCupom) ? oferta.codigosCupom : []
  );
  if (cupons.length) return cupons.join(" ou ");
  return primeiroTexto(oferta.cupom, oferta.codigoCupom, oferta.cupomCodigo);
}

function normalizarInstrucaoCupom(valor = "") {
  return textoLimpo(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^cupom\s*:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function instrucaoCupomRedundante(instrucao = "", cupom = "") {
  const textoInstrucao = normalizarInstrucaoCupom(instrucao);
  const textoCupom = normalizarInstrucaoCupom(cupom);
  return Boolean(textoInstrucao && textoCupom && textoInstrucao === textoCupom);
}

function temAvisoCupom(cupomTipo = "", beneficioTexto = "") {
  const texto = `${cupomTipo} ${beneficioTexto}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return /cupom/.test(texto) && /(possivel|disponivel|confira|pode|aviso)/.test(texto);
}

function formatarOfertaUniversal(oferta = {}) {
  const titulo = textoLimpo(oferta.titulo || oferta.nome || "Produto");
  const linhas = [`\u{1F525} ${titulo}`];

  const precoOriginal = formatarMoeda(oferta.precoOriginal);
  const precoAtual = formatarMoeda(oferta.precoAtual ?? oferta.preco);
  const condicaoPix = primeiroTexto(oferta.condicaoPix, oferta.precoPix);
  const condicaoPixTemValor = /(?:R\$|\d)/i.test(condicaoPix);
  const condicaoPixSufixo = condicaoPix && !condicaoPixTemValor ? condicaoPix : "";
  const precoUnitario = primeiroTexto(oferta.precoUnitario, oferta.unitarioCapturado);

  if (precoOriginal) linhas.push("", `\u274C De: ${precoOriginal}`);
  if (precoAtual) {
    if (!precoOriginal) linhas.push("");
    linhas.push(`\u2705 Por: ${precoAtual}${condicaoPixSufixo ? ` ${condicaoPixSufixo}` : ""}`);
  }
  if (condicaoPix && condicaoPixTemValor) linhas.push(`\u26A1 ${condicaoPix}`);

  const desconto = formatarPercentual(oferta.descontoPercentual);
  const economia = formatarMoeda(oferta.economia);
  const partesDesconto = [];
  if (desconto) partesDesconto.push(`${desconto} OFF`);
  if (economia) partesDesconto.push(`Economia de ${economia}`);
  if (partesDesconto.length) linhas.push("", `\u{1F525} ${partesDesconto.join(" | ")}`);

  const parcelamento = textoLimpo(oferta.parcelamento);
  if (parcelamento) linhas.push("", `\u{1F4B3} ${parcelamento}`);
  if (precoUnitario) linhas.push("", `\u2139\uFE0F Pre\u00E7o unit\u00E1rio: ${precoUnitario}`);
  for (const detalhe of listaTexto(
    oferta.ofertaRelampago === true ? "Oferta Relampago" : "",
    oferta.validade,
    oferta.cashback,
    Array.isArray(oferta.condicoes) ? oferta.condicoes : [],
    Array.isArray(oferta.observacoes) ? oferta.observacoes : [],
    Array.isArray(oferta.tamanhos) && oferta.tamanhos.length ? `Tamanhos: ${oferta.tamanhos.join(", ")}` : "",
    Array.isArray(oferta.cores) && oferta.cores.length ? `Cores: ${oferta.cores.join(", ")}` : "",
    Array.isArray(oferta.variantes) ? oferta.variantes : [],
    oferta.voltagem ? `Voltagem: ${oferta.voltagem}` : ""
  ).slice(0, 8)) {
    linhas.push(`\u26A1 ${detalhe}`);
  }

  const cupom = cupomOfertaFallback(oferta);
  const instrucaoCupom = primeiroTexto(oferta.instrucaoCupom, oferta.condicaoCupom, oferta.condicaoComercial, oferta.avisoCupom);
  const beneficioTexto = textoLimpo(oferta.beneficioTexto || oferta.beneficioExtra || oferta.avisoCupom);
  if (cupom) {
    linhas.push("", `\u{1F39F}\uFE0F Cupom: ${cupom}`);
    if (instrucaoCupom && !instrucaoCupomRedundante(instrucaoCupom, cupom)) linhas.push(`\u26A1 ${instrucaoCupom}`);
  } else if (instrucaoCupom) {
    linhas.push("", `\u26A1 ${instrucaoCupom}`);
  } else if (temAvisoCupom(oferta.cupomTipo || oferta.tipoCupom, beneficioTexto)) {
    linhas.push("", "💡 Pode haver benefícios disponíveis na página.");
  }

  if (oferta.freteGratis === true) linhas.push("", "\u{1F69A} Frete gratis");

  const linkAfiliado = textoLimpo(oferta.linkAfiliado || oferta.linkFinal || oferta.link);
  if (linkAfiliado) linhas.push("", "\u{1F517} Confira aqui:", linkAfiliado);
  const linksAdicionais = listaObjetosLinks(oferta.linksComerciais)
    .filter(item => item.url !== linkAfiliado)
    .filter(item => ["resgate", "cupom", "landing", "adicional"].includes(item.tipo))
    .slice(0, 3);
  for (const item of linksAdicionais) {
    linhas.push(`\u{1F517} ${item.tipo === "adicional" ? "Link adicional" : "Resgate/cupom"}: ${item.url}`);
  }

  return linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

module.exports = {
  formatarOfertaUniversal
};
