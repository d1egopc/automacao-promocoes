const crypto = require("crypto");

const VERSAO_TEMPLATE_VISUAL = 1;
const MAX_PAYLOAD_BYTES = Number(process.env.RENDERER_MAX_PAYLOAD_BYTES || 64 * 1024);
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

function cor(valor = "", fallback = "#000000") {
  const v = texto(valor);
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

function normalizarTemplateVisual(valor = {}) {
  const entrada = valor && typeof valor === "object" ? valor : {};
  const posicao = texto(entrada.posicaoCard || CONFIG_PADRAO.posicaoCard);
  return {
    ...CONFIG_PADRAO,
    versao: VERSAO_TEMPLATE_VISUAL,
    faixaSuperiorAtiva: entrada.faixaSuperiorAtiva === true,
    faixaSuperiorTexto: texto(entrada.faixaSuperiorTexto || CONFIG_PADRAO.faixaSuperiorTexto).slice(0, 80),
    faixaSuperiorCor: cor(entrada.faixaSuperiorCor, CONFIG_PADRAO.faixaSuperiorCor),
    mostrarPrecoAntigo: entrada.mostrarPrecoAntigo !== false,
    mostrarCupom: entrada.mostrarCupom !== false,
    mostrarMarketplace: entrada.mostrarMarketplace !== false,
    faixaInferiorAtiva: entrada.faixaInferiorAtiva === true,
    gatilho: texto(entrada.gatilho || CONFIG_PADRAO.gatilho).slice(0, 40),
    ctaTemplate: texto(entrada.ctaTemplate || CONFIG_PADRAO.ctaTemplate).slice(0, 120),
    posicaoCard: POSICOES_VALIDAS.has(posicao) ? posicao : CONFIG_PADRAO.posicaoCard,
    corMoldura: cor(entrada.corMoldura, CONFIG_PADRAO.corMoldura),
    corCard: cor(entrada.corCard, CONFIG_PADRAO.corCard),
    corDestaquePreco: cor(entrada.corDestaquePreco, CONFIG_PADRAO.corDestaquePreco)
  };
}

function normalizarDados(valor = {}) {
  const dados = valor && typeof valor === "object" ? valor : {};
  return {
    titulo: texto(dados.titulo).slice(0, 180),
    precoAntigo: texto(dados.precoAntigo).slice(0, 40),
    preco: texto(dados.preco).slice(0, 40),
    cupom: texto(dados.cupom).slice(0, 40),
    marketplace: texto(dados.marketplace).slice(0, 40),
    imagem: texto(dados.imagem).slice(0, 2048)
  };
}

function hashPayload(payload = {}) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function normalizarPayloadRenderer(payload = {}) {
  const bruto = JSON.stringify(payload || {});
  if (Buffer.byteLength(bruto) > MAX_PAYLOAD_BYTES) throw new Error("payload_muito_grande");

  const base = {
    clienteIdInterno: texto(payload.clienteIdInterno).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80),
    ofertaId: texto(payload.ofertaId).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120),
    template: normalizarTemplateVisual(payload.template),
    dados: normalizarDados(payload.dados),
    cta: texto(payload.cta).slice(0, 120),
    versao: VERSAO_TEMPLATE_VISUAL
  };
  if (!base.clienteIdInterno) throw new Error("cliente_id_obrigatorio");
  if (!base.ofertaId) throw new Error("oferta_id_obrigatorio");
  if (!base.dados.imagem) throw new Error("imagem_obrigatoria");

  const hash = texto(payload.hash || hashPayload(base));
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error("hash_invalido");
  return { ...base, hash: hash.toLowerCase() };
}

function formatarPrecoBRL(valor = "") {
  const textoValor = texto(valor);
  if (!textoValor) return "";
  const limpo = textoValor.replace(/[^\d,.-]/g, "");
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  if (!Number.isFinite(n)) return textoValor;
  return `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

module.exports = {
  VERSAO_TEMPLATE_VISUAL,
  CONFIG_PADRAO,
  MAX_PAYLOAD_BYTES,
  normalizarTemplateVisual,
  normalizarPayloadRenderer,
  formatarPrecoBRL,
  hashPayload
};
