const { CANAIS_PERMITIDOS, getBlocoCatalogo } = require("./catalogo-blocos");

function textoUtil(valor) {
  if (valor === undefined || valor === null) return "";
  const texto = String(valor).trim();
  if (!texto) return "";
  if (["undefined", "null", "nan"].includes(texto.toLowerCase())) return "";
  return texto;
}

function numeroUtil(valor) {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor === "string" && ["undefined", "null", "nan"].includes(valor.trim().toLowerCase())) return null;
  const normalizado = typeof valor === "string" ? valor.replace(/\./g, "").replace(",", ".") : valor;
  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function formatarMoeda(valor) {
  const numero = numeroUtil(valor);
  if (!numero) return "";
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function valorEconomia(oferta = {}) {
  const direto = numeroUtil(oferta.economia ?? oferta.valorEconomia);
  if (direto) return direto;
  const de = numeroUtil(oferta.precoOriginal ?? oferta.precoDe ?? oferta.precoAntigo);
  const por = numeroUtil(oferta.precoAtual ?? oferta.precoPor ?? oferta.preco);
  if (de && por && de > por) return de - por;
  return null;
}

function resolverLinha(bloco, oferta = {}) {
  if (bloco.tipo === "titulo") {
    const titulo = textoUtil(oferta.titulo || oferta.nome);
    return titulo ? `ðŸ”¥ ${titulo}` : "";
  }
  if (bloco.tipo === "marketplace") {
    const marketplace = textoUtil(oferta.marketplace || oferta.loja);
    return marketplace ? `ðŸ›ï¸ ${marketplace}` : "";
  }
  if (bloco.tipo === "categoria") {
    const categoria = textoUtil(oferta.categoria);
    return categoria ? `ðŸ“ ${categoria}` : "";
  }
  if (bloco.tipo === "preco_de") {
    const preco = formatarMoeda(oferta.precoOriginal ?? oferta.precoDe ?? oferta.precoAntigo);
    return preco ? `âŒ De: ${preco}` : "";
  }
  if (bloco.tipo === "preco_por") {
    const preco = formatarMoeda(oferta.precoAtual ?? oferta.precoPor ?? oferta.preco);
    return preco ? `âœ… Por: ${preco}` : "";
  }
  if (bloco.tipo === "economia") {
    const economia = formatarMoeda(valorEconomia(oferta));
    return economia ? `ðŸ’¸ Economia: ${economia}` : "";
  }
  if (bloco.tipo === "cupom") {
    const cupom = textoUtil(oferta.cupom || oferta.codigoCupom);
    return cupom ? `ðŸŽŸï¸ Cupom: ${cupom}` : "";
  }
  if (bloco.tipo === "cta") {
    const cta = textoUtil(oferta.ctaPublico || oferta.cta || "Confira aqui:");
    return cta ? `ðŸ”— ${cta}` : "";
  }
  if (bloco.tipo === "link") {
    return textoUtil(oferta.linkAfiliado || oferta.link || oferta.url);
  }
  return "";
}

function limparLinhas(linhas = []) {
  return linhas
    .map(linha => String(linha || "").trimEnd())
    .filter(linha => textoUtil(linha))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    linhas.push(linha);
    blocosRenderizados.push(bloco.tipo);
  }

  if (template.rodape?.ativo) {
    const rodape = String(template.rodape.texto ?? "").trim();
    if (textoUtil(rodape)) {
      linhas.push(rodape);
      blocosRenderizados.push("rodape");
    } else {
      blocosIgnorados.push({ tipo: "rodape", motivo: "sem_dados" });
    }
  }

  return {
    ok: true,
    mensagem: limparLinhas(linhas),
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
