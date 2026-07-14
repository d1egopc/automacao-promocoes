const {
  CONFIG_PADRAO,
  VERSAO_TEMPLATE_VISUAL,
  aplicarGatilhoTemplateVisual,
  criarPayloadRenderer,
  montarDadosTemplateVisual,
  normalizarTemplateVisual
} = require("./post-visual-template.contract");
const storage = require("./storage");
const { logSocial } = require("./logs");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function hostSeguro(url = "") {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function validarUrlHttps(valor = "") {
  const url = texto(valor);
  if (!url) throw new Error("social_art_url_publica_ausente");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("social_art_url_publica_invalida");
  }
  if (parsed.protocol !== "https:") throw new Error("social_art_url_publica_invalida");
  return parsed.toString();
}

function templateVisualCliente(clienteId = "admin", templateId = "padrao-instagram") {
  const id = texto(templateId || "padrao-instagram");
  const templates = storage.listarTemplatesSocial(clienteId);
  const template = templates.find(item => texto(item.id) === id);
  const visual = template?.visual || template?.visualConfig || template?.templateVisual || {};
  return normalizarTemplateVisual(visual && typeof visual === "object" ? visual : CONFIG_PADRAO);
}

function montarPayloadArteSocial({ clienteId = "admin", ofertaId = "", oferta = {}, templateId = "padrao-instagram", gatilho = null } = {}) {
  const templateBase = templateVisualCliente(clienteId, templateId);
  const { cfg, cta } = aplicarGatilhoTemplateVisual(templateBase, gatilho);
  return criarPayloadRenderer({
    clienteIdInterno: clienteId,
    ofertaId,
    template: cfg,
    dados: montarDadosTemplateVisual(oferta),
    cta
  });
}

async function renderizarArtePublicacaoSocial({
  clienteId = "admin",
  ofertaId = "",
  oferta = {},
  templateId = "padrao-instagram",
  gatilho = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.SOCIAL_ART_RENDERER_TIMEOUT_MS || 20000)
} = {}) {
  const base = texto(process.env.SOCIAL_ART_RENDERER_URL).replace(/\/+$/, "");
  const token = texto(process.env.SOCIAL_ART_RENDERER_TOKEN);
  if (!base || !token) throw new Error("social_art_renderer_nao_configurado");
  if (typeof fetchImpl !== "function") throw new Error("social_art_fetch_indisponivel");

  const payload = montarPayloadArteSocial({ clienteId, ofertaId, oferta, templateId, gatilho });
  const endpoint = `${base}/render/social/post-art`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs || 20000));

  logSocial("[SOCIAL-ARTE-PUBLICACAO]", {
    clienteId,
    ofertaId: texto(ofertaId),
    templateId: texto(templateId || "padrao-instagram"),
    templateVersao: VERSAO_TEMPLATE_VISUAL,
    renderHash: payload.hash.slice(0, 16),
    rendererHost: hostSeguro(base),
    status: "solicitada"
  });

  try {
    const resposta = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await resposta.json().catch(() => ({}));
    if (!resposta.ok || data?.ok === false) {
      const erro = new Error(texto(data?.erro || data?.error || `renderer_http_${resposta.status}`));
      erro.response = {
        status: resposta.status,
        data
      };
      throw erro;
    }
    const imagemUrlPublica = validarUrlHttps(data.imagemUrlPublica || data.url || data.imagemUrl);
    return {
      ok: true,
      imagemUrlPublica,
      hash: texto(data.hash || payload.hash),
      templateVersao: Number(data.templateVersao || data.versao || VERSAO_TEMPLATE_VISUAL),
      cache: data.cache === true
    };
  } catch (erro) {
    if (erro?.name === "AbortError") throw new Error("social_art_renderer_timeout");
    throw erro;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  validarUrlHttps,
  templateVisualCliente,
  montarPayloadArteSocial,
  renderizarArtePublicacaoSocial
};
