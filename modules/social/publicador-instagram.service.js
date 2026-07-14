const {
  publicarImagemInstagram,
  publicarImagemLivreInstagram
} = require("./instagram");
const { logSocial } = require("./logs");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarOrigem(origem = "") {
  const valor = texto(origem || "manual").toLowerCase();
  return ["manual", "automatica", "agendada"].includes(valor) ? valor : "manual";
}

function normalizarTipo(tipo = "") {
  const valor = texto(tipo || "oferta").toLowerCase();
  return ["oferta", "livre"].includes(valor) ? valor : "oferta";
}

function chaveIdempotencia({ clienteId = "", origem = "", tipoPublicacao = "", ofertaId = "", imagemUrl = "", agendamentoId = "" } = {}) {
  return [
    "instagram",
    texto(clienteId || "admin"),
    normalizarOrigem(origem),
    normalizarTipo(tipoPublicacao),
    texto(agendamentoId),
    texto(ofertaId) || texto(imagemUrl)
  ].join(":");
}

async function publicarNoInstagram({
  clienteId = "admin",
  origem = "manual",
  tipoPublicacao = "oferta",
  ofertaId = "",
  imagemUrl = "",
  legenda = "",
  templateId = "padrao-instagram",
  gatilho = undefined,
  respostaPublica = "",
  agendamentoId = "",
  idempotencyKey = "",
  httpClient,
  polling
} = {}) {
  const clienteSeguro = texto(clienteId || "admin") || "admin";
  const origemSegura = normalizarOrigem(origem);
  const tipoSeguro = normalizarTipo(tipoPublicacao);
  const templateSeguro = texto(templateId || (tipoSeguro === "livre" ? "livre-instagram" : "padrao-instagram"));
  const chave = texto(idempotencyKey) || chaveIdempotencia({
    clienteId: clienteSeguro,
    origem: origemSegura,
    tipoPublicacao: tipoSeguro,
    ofertaId,
    imagemUrl,
    agendamentoId
  });

  logSocial("[SOCIAL-PUBLICADOR-INICIO]", {
    clienteId: clienteSeguro,
    origem: origemSegura,
    tipoPublicacao: tipoSeguro,
    ofertaId: texto(ofertaId),
    templateId: templateSeguro,
    agendamentoId: texto(agendamentoId),
    idempotencyKey: chave ? "presente" : "ausente"
  });

  const parametros = {
    clienteId: clienteSeguro,
    templateId: templateSeguro,
    gatilho,
    legenda: texto(legenda),
    respostaPublica: texto(respostaPublica),
    origem: origemSegura,
    tipoPublicacao: tipoSeguro,
    agendamentoId: texto(agendamentoId),
    idempotencyKey: chave,
    httpClient,
    polling
  };

  if (tipoSeguro === "livre") {
    const resultado = await publicarImagemLivreInstagram({
      ...parametros,
      imagemUrl
    });
    logSocial("[SOCIAL-PUBLICADOR-FIM]", {
      clienteId: clienteSeguro,
      origem: origemSegura,
      tipoPublicacao: tipoSeguro,
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
  normalizarTipo
};
