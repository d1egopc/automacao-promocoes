const {
  publicarImagemInstagram,
  publicarImagemLivreInstagram,
  publicarReelInstagram
} = require("./instagram");
const { logSocial } = require("./logs");
const { renderizarArtePublicacaoSocial } = require("./social-art-renderer.client");
const {
  resolverTemplateSocial,
  payloadTemplatePersonalizadoSocial
} = require("./templates/resolver");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarOrigem(origem = "") {
  const valor = texto(origem || "manual").toLowerCase();
  return ["manual", "personalizada", "automatica", "agendada"].includes(valor) ? valor : "manual";
}

function normalizarTipo(tipo = "") {
  const valor = texto(tipo || "oferta").toLowerCase();
  return ["oferta", "livre"].includes(valor) ? valor : "oferta";
}

function normalizarFormato(formato = "", { falharInvalido = false } = {}) {
  const informado = texto(formato);
  const valor = texto(informado || "feed").toLowerCase();
  if (falharInvalido && informado && !["feed", "reels"].includes(valor)) throw new Error("formato_publicacao_invalido");
  return ["feed", "reels"].includes(valor) ? valor : "feed";
}

function chaveIdempotencia({ clienteId = "", origem = "", tipoPublicacao = "", formato = "", ofertaId = "", imagemUrl = "", videoUrl = "", agendamentoId = "" } = {}) {
  return [
    "instagram",
    texto(clienteId || "admin"),
    normalizarOrigem(origem),
    normalizarTipo(tipoPublicacao),
    normalizarFormato(formato),
    texto(agendamentoId),
    texto(ofertaId) || texto(imagemUrl) || texto(videoUrl)
  ].join(":");
}

async function publicarNoInstagram({
  clienteId = "admin",
  origem = "manual",
  tipoPublicacao = "oferta",
  formato = "feed",
  ofertaId = "",
  imagemUrl = "",
  videoUrl = "",
  mediaUrl = "",
  midiaUrl = "",
  mimeType = "",
  mediaMimeType = "",
  midiaMimeType = "",
  videoMimeType = "",
  legenda = "",
  templateId = "padrao-instagram",
  gatilho = undefined,
  respostaPublica = "",
  mensagemPrivada = "",
  direct = undefined,
  redirect = undefined,
  urlDestino = "",
  cta = undefined,
  linkAfiliado = "",
  agendamentoId = "",
  idempotencyKey = "",
  renderizadorArte = renderizarArtePublicacaoSocial,
  httpClient,
  polling
} = {}) {
  const clienteSeguro = texto(clienteId || "admin") || "admin";
  const origemSegura = normalizarOrigem(origem);
  const tipoSeguro = normalizarTipo(tipoPublicacao);
  const formatoSeguro = normalizarFormato(formato, { falharInvalido: true });
  const templateSolicitado = texto(templateId || (tipoSeguro === "livre" ? "livre-instagram" : "padrao-instagram"));
  const templateResolvido = tipoSeguro === "livre"
    ? { templateId: templateSolicitado, template: null }
    : resolverTemplateSocial(clienteSeguro, templateSolicitado);
  const templatePersonalizado = payloadTemplatePersonalizadoSocial(templateResolvido);
  const templateSeguro = texto(templateResolvido.templateId || templateSolicitado || "padrao-instagram");
  const chave = texto(idempotencyKey) || chaveIdempotencia({
    clienteId: clienteSeguro,
    origem: origemSegura,
    tipoPublicacao: tipoSeguro,
    formato: formatoSeguro,
    ofertaId,
    imagemUrl,
    videoUrl,
    agendamentoId
  });

  logSocial("[SOCIAL-PUBLICADOR-INICIO]", {
    clienteId: clienteSeguro,
    origem: origemSegura,
    tipoPublicacao: tipoSeguro,
    formato: formatoSeguro,
    ofertaId: texto(ofertaId),
    templateId: templateSeguro,
    agendamentoId: texto(agendamentoId),
    idempotencyKey: chave ? "presente" : "ausente"
  });

  const parametros = {
    clienteId: clienteSeguro,
    templateId: templateSeguro,
    gatilho: templatePersonalizado ? templatePersonalizado.gatilho : gatilho,
    legenda: texto(templatePersonalizado?.legenda || legenda),
    respostaPublica: texto(templatePersonalizado ? templatePersonalizado.respostaPublica : respostaPublica),
    mensagemPrivada: texto(templatePersonalizado ? templatePersonalizado.mensagemPrivada : mensagemPrivada),
    direct,
    redirect,
    videoUrl: texto(videoUrl),
    mediaUrl: texto(mediaUrl),
    midiaUrl: texto(midiaUrl),
    mimeType: texto(mimeType),
    mediaMimeType: texto(mediaMimeType),
    midiaMimeType: texto(midiaMimeType),
    videoMimeType: texto(videoMimeType),
    urlDestino: texto(urlDestino),
    cta: templatePersonalizado ? templatePersonalizado.cta : cta,
    linkAfiliado: texto(linkAfiliado),
    origem: origemSegura,
    tipoPublicacao: tipoSeguro,
    formato: formatoSeguro,
    agendamentoId: texto(agendamentoId),
    idempotencyKey: chave,
    renderizadorArte,
    httpClient,
    polling
  };

  logSocial("[SOCIAL-INSTAGRAM-LEGENDA]", {
    clienteId: clienteSeguro,
    origem: origemSegura,
    legendaPresente: Boolean(parametros.legenda),
    tamanhoLegenda: parametros.legenda.length
  });

  if (formatoSeguro === "reels") {
    const resultado = await publicarReelInstagram({
      ...parametros,
      ofertaId: texto(ofertaId),
      imagemUrl,
      videoUrl,
      mediaUrl,
      midiaUrl,
      mimeType,
      mediaMimeType,
      midiaMimeType,
      videoMimeType
    });
    logSocial("[SOCIAL-PUBLICADOR-FIM]", {
      clienteId: clienteSeguro,
      origem: origemSegura,
      tipoPublicacao: tipoSeguro,
      formato: formatoSeguro,
      ofertaId: texto(ofertaId),
      status: resultado.publicacao?.status || "",
      duplicada: resultado.duplicada === true
    });
    return resultado;
  }

  if (tipoSeguro === "livre") {
    const resultado = await publicarImagemLivreInstagram({
      ...parametros,
      imagemUrl
    });
    logSocial("[SOCIAL-PUBLICADOR-FIM]", {
      clienteId: clienteSeguro,
      origem: origemSegura,
      tipoPublicacao: tipoSeguro,
      formato: formatoSeguro,
      status: resultado.publicacao?.status || "",
      duplicada: resultado.duplicada === true
    });
    return resultado;
  }

  const ofertaIdSeguro = texto(ofertaId);
  if (!ofertaIdSeguro) throw new Error("oferta_id_obrigatorio");

  const resultado = await publicarImagemInstagram({
    ...parametros,
    ofertaId: ofertaIdSeguro
  });
  logSocial("[SOCIAL-PUBLICADOR-FIM]", {
    clienteId: clienteSeguro,
    origem: origemSegura,
    tipoPublicacao: tipoSeguro,
    formato: formatoSeguro,
    ofertaId: ofertaIdSeguro,
    status: resultado.publicacao?.status || "",
    duplicada: resultado.duplicada === true
  });
  return resultado;
}

module.exports = {
  publicarNoInstagram,
  chaveIdempotencia,
  normalizarOrigem,
  normalizarTipo,
  normalizarFormato
};
