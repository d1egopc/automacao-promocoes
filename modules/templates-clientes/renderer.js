const { CANAIS_PERMITIDOS, getBlocoCatalogo } = require("./catalogo-blocos");

function textoUtil(valor) {
  if (valor === undefined || valor === null) return "";
  const texto = String(valor).trim();
  if (!texto) return "";
  if (["undefined", "null", "nan"].includes(texto.toLowerCase())) return "";
  return texto;
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const texto = textoUtil(valor);
    if (texto) return texto;
  }
  return "";
}

function numeroUtil(valor) {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor === "string" && ["undefined", "null", "nan"].includes(valor.trim().toLowerCase())) return null;

  if (typeof valor === "number") return Number.isFinite(valor) && valor > 0 ? valor : null;

  const texto = String(valor)
    .replace(/R\$/gi, "")
    .replace(/%/g, "")
    .replace(/\s/g, "")
    .trim();

  if (!texto) return null;

  const temVirgula = texto.includes(",");
  const temPonto = texto.includes(".");
  const normalizado = temVirgula && temPonto
    ? texto.replace(/\./g, "").replace(",", ".")
    : temVirgula
      ? texto.replace(",", ".")
      : texto;
  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function formatarMoeda(valor) {
  const numero = numeroUtil(valor);
  if (!numero) return "";
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function numeroInteiro(valor) {
  const numero = numeroUtil(valor);
  if (!numero) return "";
  return String(Math.round(numero));
}

function formatarPercentual(valor) {
  const numero = numeroUtil(valor);
  if (!numero) return "";
  return `${Math.round(numero)}%`;
}

function formatarQuantidade(valor) {
  const numero = numeroUtil(valor);
  if (!numero) return "";
  return Math.round(numero).toLocaleString("pt-BR");
}

function valorEconomia(oferta = {}) {
  return numeroUtil(oferta.economia ?? oferta.valorEconomia ?? oferta.economiaValor);
}

function valorBeneficio(oferta = {}) {
  if (Array.isArray(oferta.beneficios)) {
    const primeiro = oferta.beneficios.map(textoUtil).find(Boolean);
    if (primeiro) return primeiro;
  }

  return primeiroTexto(
    oferta.beneficioTexto,
    oferta.beneficioExtra,
    oferta.avisoCupom,
    oferta.beneficioDetectado
  );
}

function valorFrete(oferta = {}) {
  const texto = primeiroTexto(oferta.frete, oferta.freteTexto, oferta.avisoFrete);
  if (texto) return texto;
  return oferta.freteGratis === true ? "Frete gratis" : "";
}

function valorAvaliacao(oferta = {}) {
  const texto = primeiroTexto(oferta.avaliacao, oferta.rating, oferta.nota);
  if (texto) return texto;
  const score = numeroUtil(oferta.score);
  return score ? `${Math.round(score)}/100` : "";
}

function valorQuantidadeAvaliacoes(oferta = {}) {
  return numeroInteiro(
    oferta.quantidadeAvaliacoes ??
    oferta.totalAvaliacoes ??
    oferta.avaliacoes ??
    oferta.reviews ??
    oferta.reviewCount
  );
}

function valorVendas(oferta = {}) {
  return numeroInteiro(oferta.vendas ?? oferta.sales ?? oferta.vendasShopee ?? oferta.totalVendas);
}

function valorEfetivoConfirmado(oferta = {}) {
  const valorEfetivo = numeroUtil(oferta.valorEfetivo);
  const precoAtual = numeroUtil(oferta.precoAtual ?? oferta.precoPor ?? oferta.preco);
  const origem = normalizarComparacao(oferta.valorEfetivoOrigem);

  if (valorEfetivo == null || precoAtual == null || valorEfetivo >= precoAtual) return null;
  if (!["cupom", "pix", "app", "cashback", "frete_gratis", "desconto"].some(termo => origem.includes(termo))) {
    return null;
  }

  return valorEfetivo;
}

function valorPrecoPor(oferta = {}) {
  const valorEfetivo = valorEfetivoConfirmado(oferta);
  return valorEfetivo ?? oferta.precoAtual ?? oferta.precoPor ?? oferta.preco;
}

function normalizarComparacao(valor = "") {
  return textoUtil(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function nomeBeneficioFraseCupom(oferta = {}) {
  const frete = valorFrete(oferta);
  const beneficio = valorBeneficio(oferta);
  const fonte = normalizarComparacao([frete, beneficio].filter(Boolean).join(" "));

  if (frete || oferta.freteGratis === true || fonte.includes("frete")) return "frete grátis";
  if (fonte.includes("pix")) return "PIX";
  if (fonte.includes("app") || fonte.includes("aplicativo")) return "app";
  if (fonte.includes("cashback")) return "cashback";

  return "";
}

function montarFraseCupom(oferta = {}) {
  const cupom = primeiroTexto(oferta.cupom, oferta.codigoCupom, oferta.cupomCodigo);
  if (!cupom) return "";

  const precoFinal = formatarMoeda(valorEfetivoConfirmado(oferta));
  const beneficio = nomeBeneficioFraseCupom(oferta);
  if (precoFinal && beneficio) {
    return `⚡ Aplique o cupom ${cupom} + ${beneficio} para pagar ${precoFinal}.`;
  }

  return `⚡ Aplique o cupom ${cupom} para obter o desconto.`;
}

function resolverLinha(bloco, oferta = {}) {
  const tipo = bloco.tipo;

  if (tipo === "titulo") {
    const titulo = primeiroTexto(oferta.titulo, oferta.nome);
    return titulo ? `🔥 ${titulo}` : "";
  }
  if (tipo === "marketplace") {
    const marketplace = primeiroTexto(oferta.marketplace, oferta.loja);
    return marketplace ? `🛍️ ${marketplace}` : "";
  }
  if (tipo === "categoria") {
    const categoria = textoUtil(oferta.categoria);
    return categoria ? `📂 ${categoria}` : "";
  }
  if (tipo === "preco_de") {
    const preco = formatarMoeda(oferta.precoOriginal ?? oferta.precoDe ?? oferta.precoAntigo);
    return preco ? `❌ De: ${preco}` : "";
  }
  if (tipo === "preco_por") {
    const preco = formatarMoeda(valorPrecoPor(oferta));
    return preco ? `✅ Por: ${preco}` : "";
  }
  if (tipo === "desconto_percentual") {
    const desconto = formatarPercentual(oferta.descontoPercentual ?? oferta.desconto);
    return desconto ? `📉 ${desconto} OFF` : "";
  }
  if (tipo === "economia") {
    const economia = formatarMoeda(valorEconomia(oferta));
    return economia ? `💸 Economia: ${economia}` : "";
  }
  if (tipo === "cupom") {
    const cupom = primeiroTexto(oferta.cupom, oferta.codigoCupom, oferta.cupomCodigo);
    return cupom ? `🎟️ Cupom: ${cupom}` : "";
  }
  if (tipo === "frase_cupom") {
    return montarFraseCupom(oferta);
  }
  if (tipo === "beneficio") {
    const beneficio = valorBeneficio(oferta);
    return beneficio ? `⚡ ${beneficio}` : "";
  }
  if (tipo === "descricao_adicional") {
    const descricao = primeiroTexto(oferta.descricaoAdicional, oferta.descricao, oferta.textoResumo, oferta.mensagemResumo);
    return descricao ? `📝 ${descricao}` : "";
  }
  if (tipo === "parcelamento") {
    const parcelamento = textoUtil(oferta.parcelamento);
    return parcelamento ? `💳 ${parcelamento}` : "";
  }
  if (tipo === "frete") {
    const frete = valorFrete(oferta);
    return frete ? `🚚 ${frete}` : "";
  }
  if (tipo === "avaliacao") {
    const avaliacao = valorAvaliacao(oferta);
    return avaliacao ? `⭐ Avaliacao: ${avaliacao}` : "";
  }
  if (tipo === "quantidade_avaliacoes") {
    const quantidade = valorQuantidadeAvaliacoes(oferta);
    return quantidade ? `👥 ${formatarQuantidade(quantidade)} avaliacoes` : "";
  }
  if (tipo === "vendas") {
    const vendas = valorVendas(oferta);
    return vendas ? `🛒 ${formatarQuantidade(vendas)} vendidos` : "";
  }
  if (tipo === "cta") {
    const cta = primeiroTexto(oferta.ctaPublico, oferta.cta, "Confira aqui:");
    return cta ? `🔗 ${cta}` : "";
  }
  if (tipo === "link") {
    return primeiroTexto(oferta.linkAfiliado, oferta.linkFinal, oferta.link, oferta.url);
  }
  if (tipo === "aviso_preco") {
    const aviso = primeiroTexto(oferta.avisoPreco, oferta.avisoPagamento, oferta.avisoVariacaoPreco);
    return aviso ? `⚠️ ${aviso}` : "";
  }
  if (tipo === "aviso_alteracao") {
    const aviso = primeiroTexto(oferta.avisoAlteracao, oferta.aviso);
    return aviso ? `⚠️ ${aviso}` : "";
  }

  return "";
}

function grupoBlocoTemplate(tipo = "") {
  if (tipo === "titulo") return "identificacao";
  if (["marketplace", "categoria"].includes(tipo)) return "origem";
  if (["preco_de", "preco_por", "desconto_percentual", "economia"].includes(tipo)) return "precos";
  if (["cupom", "beneficio", "descricao_adicional", "parcelamento"].includes(tipo)) return "beneficios";
  if (["avaliacao", "quantidade_avaliacoes", "vendas", "frete"].includes(tipo)) return "prova";
  if (["cta", "link"].includes(tipo)) return "link";
  if (tipo === "frase_cupom") return "frase_cupom";
  if (["aviso_preco", "aviso_alteracao"].includes(tipo)) return "avisos";
  if (tipo === "rodape") return "rodape";
  return "outros";
}

function limparLinhas(linhas = []) {
  return linhas
    .map(linha => String(linha || "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function montarMensagemAgrupada(entradas = []) {
  const linhas = [];
  let grupoAnterior = "";

  for (const entrada of entradas) {
    const linha = String(entrada?.linha || "").trim();
    if (!textoUtil(linha)) continue;

    const grupo = grupoBlocoTemplate(entrada.tipo);
    if (linhas.length && grupo && grupoAnterior && grupo !== grupoAnterior) {
      linhas.push("");
    }
    linhas.push(linha);
    grupoAnterior = grupo;
  }

  return limparLinhas(linhas);
}

function renderizarTemplatePersonalizado({ oferta = {}, template = {}, canal = "whatsapp" } = {}) {
  const canalNormalizado = textoUtil(canal).toLowerCase();
  if (!CANAIS_PERMITIDOS.includes(canalNormalizado)) {
    return { ok: false, erro: "canal_invalido", mensagem: "", templateIdUsado: template.id || "", blocosRenderizados: [], blocosIgnorados: [] };
  }

  const canaisTemplate = Array.isArray(template.canais) ? template.canais : [];
  if (canaisTemplate.length && !canaisTemplate.includes(canalNormalizado)) {
    return { ok: false, erro: "canal_incompativel", mensagem: "", templateIdUsado: template.id || "", blocosRenderizados: [], blocosIgnorados: [] };
  }

  const blocos = Array.isArray(template.blocos) ? [...template.blocos] : [];
  const ativosOrdenados = blocos
    .filter(bloco => bloco && bloco.ativo !== false)
    .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0) || String(a.tipo).localeCompare(String(b.tipo)));

  const linhas = [];
  const blocosRenderizados = [];
  const blocosIgnorados = [];

  for (const bloco of ativosOrdenados) {
    const catalogo = getBlocoCatalogo(bloco.tipo);
    if (!catalogo || !catalogo.canais.includes(canalNormalizado)) {
      blocosIgnorados.push({ tipo: bloco.tipo || "", motivo: "bloco_incompativel" });
      continue;
    }
    const linha = resolverLinha(bloco, oferta);
    if (!textoUtil(linha)) {
      blocosIgnorados.push({ tipo: bloco.tipo, motivo: "sem_dados" });
      continue;
    }
    linhas.push({ tipo: bloco.tipo, linha });
    blocosRenderizados.push(bloco.tipo);
  }

  if (template.rodape?.ativo) {
    const rodape = String(template.rodape.texto ?? "").trim();
    if (textoUtil(rodape)) {
      linhas.push({ tipo: "rodape", linha: rodape });
      blocosRenderizados.push("rodape");
    } else {
      blocosIgnorados.push({ tipo: "rodape", motivo: "sem_dados" });
    }
  }

  return {
    ok: true,
    mensagem: montarMensagemAgrupada(linhas),
    templateIdUsado: template.id || "",
    blocosRenderizados,
    blocosIgnorados
  };
}

module.exports = {
  renderizarTemplatePersonalizado,
  textoUtil,
  formatarMoeda
};
