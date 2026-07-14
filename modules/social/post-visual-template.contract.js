const crypto = require("crypto");

const VERSAO_TEMPLATE_VISUAL = 1;
const STORAGE_KEY = "social:post-visual-template:v1";

const POSICOES_VALIDAS = new Set(["bottom-left", "bottom-right", "top-left", "top-right"]);

const CONFIG_PADRAO = Object.freeze({
  versao: VERSAO_TEMPLATE_VISUAL,
  faixaSuperiorAtiva: true,
  faixaSuperiorTexto: "\uD83D\uDE80 OFERTA RELAMPAGO",
  faixaSuperiorCor: "#f97316",
  mostrarPrecoAntigo: true,
  mostrarCupom: true,
  mostrarMarketplace: true,
  faixaInferiorAtiva: true,
  gatilho: "PROMO",
  ctaTemplate: 'COMENTE "{gatilho}"',
  posicaoCard: "bottom-left",
  corMoldura: "#0f172a",
  corCard: "#ffffff",
  corDestaquePreco: "#16a34a"
});

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function booleano(valor, fallback = false) {
  return typeof valor === "boolean" ? valor : fallback;
}

function cor(valor = "", fallback = "#000000") {
  const v = texto(valor);
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const limpo = texto(valor).replace(/R\$/gi, "").replace(/\s/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function normalizarTemplateVisual(valor = {}) {
  const entrada = valor && typeof valor === "object" ? valor : {};
  const posicao = texto(entrada.posicaoCard || CONFIG_PADRAO.posicaoCard);

  return {
    ...CONFIG_PADRAO,
    versao: VERSAO_TEMPLATE_VISUAL,
    faixaSuperiorAtiva: booleano(entrada.faixaSuperiorAtiva, CONFIG_PADRAO.faixaSuperiorAtiva),
    faixaSuperiorTexto: texto(entrada.faixaSuperiorTexto || CONFIG_PADRAO.faixaSuperiorTexto).slice(0, 80),
    faixaSuperiorCor: cor(entrada.faixaSuperiorCor, CONFIG_PADRAO.faixaSuperiorCor),
    mostrarPrecoAntigo: booleano(entrada.mostrarPrecoAntigo, CONFIG_PADRAO.mostrarPrecoAntigo),
    mostrarCupom: booleano(entrada.mostrarCupom, CONFIG_PADRAO.mostrarCupom),
    mostrarMarketplace: booleano(entrada.mostrarMarketplace, CONFIG_PADRAO.mostrarMarketplace),
    faixaInferiorAtiva: booleano(entrada.faixaInferiorAtiva, CONFIG_PADRAO.faixaInferiorAtiva),
    gatilho: texto(entrada.gatilho || CONFIG_PADRAO.gatilho).slice(0, 40),
    ctaTemplate: texto(entrada.ctaTemplate || CONFIG_PADRAO.ctaTemplate).slice(0, 120),
    posicaoCard: POSICOES_VALIDAS.has(posicao) ? posicao : CONFIG_PADRAO.posicaoCard,
    corMoldura: cor(entrada.corMoldura, CONFIG_PADRAO.corMoldura),
    corCard: cor(entrada.corCard, CONFIG_PADRAO.corCard),
    corDestaquePreco: cor(entrada.corDestaquePreco, CONFIG_PADRAO.corDestaquePreco)
  };
}

function resolverCta(template = "", gatilho = "") {
  const palavra = texto(gatilho || CONFIG_PADRAO.gatilho).toUpperCase();
  return texto(template || CONFIG_PADRAO.ctaTemplate).replaceAll("{gatilho}", palavra);
}

function formatarPrecoBRL(valor) {
  const n = numero(valor);
  if (n === null) return "";
  return `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

function montarDadosTemplateVisual(oferta = {}) {
  return {
    titulo: texto(oferta.titulo || oferta.nome),
    imagem: texto(oferta.imagem || oferta.image || oferta.thumbnail),
    preco: texto(oferta.precoAtual ?? oferta.preco ?? oferta.valorEfetivo),
    precoAntigo: texto(oferta.precoOriginal ?? oferta.precoAntigo ?? oferta.precoDe),
    cupom: texto(oferta.cupom || oferta.cupomCodigo || oferta.cupomInfo?.cupom),
    marketplace: texto(oferta.marketplace)
  };
}

function aplicarGatilhoTemplateVisual(template = {}, gatilho = null) {
  const cfg = normalizarTemplateVisual(template);
  const gatilhoAtivo = gatilho && typeof gatilho === "object" && gatilho.ativo === true;
  const palavra = texto(gatilho?.palavra || gatilho?.keyword);
  const mostrarFaixaInferior = gatilhoAtivo && Boolean(palavra);
  return {
    cfg: {
      ...cfg,
      faixaInferiorAtiva: mostrarFaixaInferior
    },
    cta: mostrarFaixaInferior ? resolverCta(cfg.ctaTemplate, palavra) : ""
  };
}

function ordenarParaHash(valor) {
  if (Array.isArray(valor)) return valor.map(ordenarParaHash);
  if (valor && typeof valor === "object") {
    return Object.keys(valor).sort().reduce((acc, chave) => {
      acc[chave] = ordenarParaHash(valor[chave]);
      return acc;
    }, {});
  }
  return valor;
}

function hashPayloadArte(payload = {}) {
  const serializado = JSON.stringify(ordenarParaHash(payload));
  return crypto.createHash("sha256").update(serializado).digest("hex");
}

function criarPayloadRenderer({
  clienteIdInterno = "",
  ofertaId = "",
  template = CONFIG_PADRAO,
  dados = {},
  cta = ""
} = {}) {
  const payloadBase = {
    clienteIdInterno: texto(clienteIdInterno),
    ofertaId: texto(ofertaId),
    template: normalizarTemplateVisual(template),
    dados: {
      titulo: texto(dados.titulo),
      precoAntigo: texto(dados.precoAntigo),
      preco: texto(dados.preco),
      cupom: texto(dados.cupom),
      marketplace: texto(dados.marketplace),
      imagem: texto(dados.imagem)
    },
    cta: texto(cta),
    versao: VERSAO_TEMPLATE_VISUAL
  };
  return {
    ...payloadBase,
    hash: hashPayloadArte(payloadBase)
  };
}

module.exports = {
  VERSAO_TEMPLATE_VISUAL,
  STORAGE_KEY,
  CONFIG_PADRAO,
  normalizarTemplateVisual,
  resolverCta,
  formatarPrecoBRL,
  montarDadosTemplateVisual,
  aplicarGatilhoTemplateVisual,
  criarPayloadRenderer,
  hashPayloadArte
};
