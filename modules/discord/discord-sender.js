const { obterConfigDiscordAsync, DISCORD_API_BASE } = require("./discord-oauth");

const DISCORD_MESSAGE_LIMIT = 2000;
const DISCORD_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const DISCORD_IMAGE_MAX_REDIRECTS = 2;
const DISCORD_IMAGE_HOSTS_COMPROVADOS = new Set([
  "m.media-amazon.com",
  "images-na.ssl-images-amazon.com",
  "http2.mlstatic.com",
  "cf.shopee.com.br",
  "ae01.alicdn.com",
  "images.kabum.com.br",
  "a-static.mlcdn.com.br"
]);
const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function listaHosts(valor = "") {
  return texto(valor)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => DISCORD_IMAGE_HOSTS_COMPROVADOS.has(item))
    .filter(Boolean);
}

function statusHttp(erro = {}) {
  return Number(erro?.response?.status || erro?.status || 0) || null;
}

function erroDiscordPorStatus(status) {
  if (status === 403) return "discord_sem_permissao";
  if (status === 404) return "discord_canal_nao_encontrado";
  if (status === 429) return "discord_rate_limit";
  if (status && status >= 500) return "discord_api_indisponivel";
  return "discord_envio_falhou";
}

function retryAfterMs(data = {}, headers = {}) {
  const retryAfter = Number(data?.retry_after);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter > 1000 ? Math.round(retryAfter) : Math.round(retryAfter * 1000);
  }

  const header = Number(headers?.["retry-after"] || headers?.["Retry-After"]);
  if (Number.isFinite(header) && header > 0) return Math.round(header * 1000);
  return null;
}

function classificacaoCheckpointHttp(status = null) {
  const codigo = Number(status || 0) || 0;
  if (codigo >= 400 && codigo < 500) {
    return {
      checkpointClassificacao: "falha_confirmada",
      checkpointMotivo: "discord_http_rejeitado"
    };
  }
  return {
    checkpointClassificacao: "ambigua",
    checkpointMotivo: codigo >= 500 ? "discord_http_servidor_ambiguo" : "discord_resposta_invalida"
  };
}

function respostaErro({
  channelId = "",
  erro = "",
  status = null,
  retryAfter = null,
  checkpointClassificacao = "ambigua",
  checkpointMotivo = "discord_resultado_desconhecido"
} = {}) {
  return {
    ok: false,
    channelId: texto(channelId),
    messageId: "",
    enviadoEm: "",
    imagemEnviada: false,
    erro: texto(erro) || "discord_envio_falhou",
    statusHttp: status,
    retryAfterMs: retryAfter,
    checkpointClassificacao,
    checkpointMotivo
  };
}

function validarUrlImagem(imagemUrl = "", hostsPermitidos = []) {
  const url = texto(imagemUrl);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!["https:"].includes(parsed.protocol)) return null;
    const host = parsed.hostname.toLowerCase();
    if (!hostsPermitidos.includes(host)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function headerLocation(headers = {}) {
  return texto(headers.location || headers.Location);
}

function statusRedirect(status) {
  return status >= 300 && status < 400;
}

async function baixarUrlImagemValidada({ url = "", hostsPermitidos = [], httpClient } = {}) {
  let atual = url;
  for (let tentativa = 0; tentativa <= DISCORD_IMAGE_MAX_REDIRECTS; tentativa += 1) {
    const resposta = await httpClient.get(atual, {
      responseType: "arraybuffer",
      maxContentLength: DISCORD_IMAGE_MAX_BYTES,
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: () => true
    });
    const status = Number(resposta?.status || 0) || 0;
    if (!statusRedirect(status)) return resposta;

    const location = headerLocation(resposta?.headers || {});
    if (!location) {
      return { ok: false, erro: "discord_imagem_redirect_invalido", statusHttp: status };
    }

    let proxima = "";
    try {
      proxima = validarUrlImagem(new URL(location, atual).toString(), hostsPermitidos);
    } catch {
      proxima = "";
    }
    if (!proxima) {
      return { ok: false, erro: "discord_imagem_redirect_nao_permitido", statusHttp: status };
    }
    atual = proxima;
  }

  return { ok: false, erro: "discord_imagem_redirect_excessivo", statusHttp: 310 };
}

function contentType(headers = {}) {
  return texto(headers["content-type"] || headers["Content-Type"]).split(";")[0].toLowerCase();
}

function contentLength(headers = {}) {
  const valor = Number(headers["content-length"] || headers["Content-Length"]);
  return Number.isFinite(valor) && valor >= 0 ? valor : null;
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === "string") return Buffer.from(data);
  return Buffer.alloc(0);
}

function criarFormData({ mensagem = "", imagem = {} } = {}) {
  if (typeof FormData === "undefined" || typeof Blob === "undefined") {
    throw new Error("discord_formdata_indisponivel");
  }

  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content: mensagem }));
  const extensao = IMAGE_TYPES.get(imagem.contentType) || "bin";
  const blob = new Blob([imagem.buffer], { type: imagem.contentType });
  form.append("files[0]", blob, `imagem.${extensao}`);
  return form;
}

async function baixarImagemDiscord({ imagemUrl = "", env = process.env, httpClient, getPlatformVariableImpl, config = null } = {}) {
  const configDiscord = config || await obterConfigDiscordAsync({ env, getPlatformVariableImpl });
  const hostsPermitidos = listaHosts(configDiscord.imageAllowedHosts);
  if (!hostsPermitidos.length) return { ok: false, erro: "discord_imagem_host_nao_permitido" };

  const url = validarUrlImagem(imagemUrl, hostsPermitidos);
  if (!url) return { ok: false, erro: "discord_imagem_url_invalida" };
  if (!httpClient || typeof httpClient.get !== "function") {
    return { ok: false, erro: "discord_http_indisponivel" };
  }

  try {
    const resposta = await baixarUrlImagemValidada({ url, hostsPermitidos, httpClient });
    if (resposta?.ok === false) return resposta;
    const status = Number(resposta?.status || 0) || 0;
    if (status < 200 || status >= 300) {
      return { ok: false, erro: erroDiscordPorStatus(status), statusHttp: status };
    }
    const tipo = contentType(resposta?.headers || {});
    if (!IMAGE_TYPES.has(tipo)) return { ok: false, erro: "discord_imagem_tipo_invalido" };

    const tamanhoDeclarado = contentLength(resposta?.headers || {});
    if (tamanhoDeclarado !== null && tamanhoDeclarado > DISCORD_IMAGE_MAX_BYTES) {
      return { ok: false, erro: "discord_imagem_muito_grande" };
    }

    const buffer = toBuffer(resposta?.data);
    if (!buffer.length) return { ok: false, erro: "discord_imagem_vazia" };
    if (buffer.length > DISCORD_IMAGE_MAX_BYTES) return { ok: false, erro: "discord_imagem_muito_grande" };

    return { ok: true, buffer, contentType: tipo };
  } catch (erro) {
    return {
      ok: false,
      erro: erroDiscordPorStatus(statusHttp(erro)),
      statusHttp: statusHttp(erro)
    };
  }
}

function dataEnvio(now) {
  if (typeof now === "function") {
    const valor = now();
    const data = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(data.getTime()) ? new Date().toISOString() : data.toISOString();
  }
  return new Date().toISOString();
}

function validarRespostaMensagemDiscord(resposta = {}, channelId = "") {
  const status = Number(resposta?.status || 0) || 0;
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      erro: "discord_status_http_invalido",
      statusHttp: status || null,
      ...classificacaoCheckpointHttp(status)
    };
  }

  const data = resposta?.data || {};
  const messageId = texto(data.id);
  if (!messageId) {
    return {
      ok: false,
      erro: "discord_resposta_sem_message_id",
      statusHttp: status,
      checkpointClassificacao: "ambigua",
      checkpointMotivo: "discord_resposta_invalida"
    };
  }

  const channelIdResposta = texto(data.channel_id || data.channelId);
  if (channelIdResposta && channelIdResposta !== texto(channelId)) {
    return {
      ok: false,
      erro: "discord_channel_resposta_divergente",
      statusHttp: status,
      checkpointClassificacao: "ambigua",
      checkpointMotivo: "discord_resposta_invalida"
    };
  }

  return {
    ok: true,
    data,
    messageId,
    statusHttp: status,
    checkpointClassificacao: "enviado",
    checkpointMotivo: "discord_sucesso"
  };
}

async function enviarDiscord({ channelId = "", mensagem = "", imagemUrl = "", suprimirEmbeds = false, env = process.env, httpClient, now = () => new Date(), getPlatformVariableImpl, config = null } = {}) {
  const canal = texto(channelId);
  const conteudo = texto(mensagem);
  let configDiscord;
  try {
    configDiscord = config || await obterConfigDiscordAsync({ env, getPlatformVariableImpl });
  } catch {
    return respostaErro({
      channelId: canal,
      erro: "discord_config_indisponivel",
      checkpointClassificacao: "falha_confirmada",
      checkpointMotivo: "discord_preflight_config"
    });
  }

  if (!configDiscord.botToken) return respostaErro({ channelId: canal, erro: "discord_bot_token_ausente", checkpointClassificacao: "falha_confirmada", checkpointMotivo: "discord_preflight_config" });
  if (!canal) return respostaErro({ channelId: canal, erro: "discord_channel_id_ausente", checkpointClassificacao: "falha_confirmada", checkpointMotivo: "discord_preflight_destino" });
  if (!conteudo && !texto(imagemUrl)) return respostaErro({ channelId: canal, erro: "discord_mensagem_vazia", checkpointClassificacao: "falha_confirmada", checkpointMotivo: "discord_preflight_payload" });
  if (conteudo.length > DISCORD_MESSAGE_LIMIT) {
    return respostaErro({ channelId: canal, erro: "discord_mensagem_muito_longa", checkpointClassificacao: "falha_confirmada", checkpointMotivo: "discord_preflight_payload" });
  }
  if (!httpClient || typeof httpClient.post !== "function") {
    return respostaErro({ channelId: canal, erro: "discord_http_indisponivel", checkpointClassificacao: "falha_confirmada", checkpointMotivo: "discord_preflight_http" });
  }

  let body = { content: conteudo, ...(suprimirEmbeds ? { flags: 4 } : {}) };
  let headers = { Authorization: `Bot ${configDiscord.botToken}` };
  let imagemEnviada = false;

  if (texto(imagemUrl)) {
    const imagem = await baixarImagemDiscord({ imagemUrl, env, httpClient, getPlatformVariableImpl, config: configDiscord });
    if (!imagem.ok) {
      return respostaErro({
        channelId: canal,
        erro: imagem.erro,
        status: imagem.statusHttp || null,
        checkpointClassificacao: "falha_confirmada",
        checkpointMotivo: "discord_preflight_imagem"
      });
    }

    try {
      body = criarFormData({ mensagem: conteudo, imagem });
      headers = { Authorization: `Bot ${configDiscord.botToken}` };
      imagemEnviada = true;
    } catch (erro) {
      return respostaErro({
        channelId: canal,
        erro: erro.message || "discord_imagem_invalida",
        checkpointClassificacao: "falha_confirmada",
        checkpointMotivo: "discord_preflight_payload"
      });
    }
  }

  try {
    const resposta = await httpClient.post(
      `${DISCORD_API_BASE}/channels/${encodeURIComponent(canal)}/messages`,
      body,
      { headers }
    );
    const validacao = validarRespostaMensagemDiscord(resposta, canal);
    if (!validacao.ok) {
      return respostaErro({
        channelId: canal,
        erro: validacao.erro,
        status: validacao.statusHttp || null,
        checkpointClassificacao: validacao.checkpointClassificacao,
        checkpointMotivo: validacao.checkpointMotivo
      });
    }
    const data = validacao.data || {};
    return {
      ok: true,
      channelId: canal,
      messageId: validacao.messageId,
      enviadoEm: texto(data.timestamp) || dataEnvio(now),
      imagemEnviada,
      erro: "",
      statusHttp: validacao.statusHttp,
      checkpointClassificacao: validacao.checkpointClassificacao,
      checkpointMotivo: validacao.checkpointMotivo
    };
  } catch (erro) {
    const status = statusHttp(erro);
    return respostaErro({
      channelId: canal,
      erro: erroDiscordPorStatus(status),
      status,
      retryAfter: status === 429 ? retryAfterMs(erro?.response?.data || {}, erro?.response?.headers || {}) : null,
      ...classificacaoCheckpointHttp(status),
      ...(status ? {} : { checkpointMotivo: "discord_transport_ambiguo" })
    });
  }
}

module.exports = {
  DISCORD_MESSAGE_LIMIT,
  DISCORD_IMAGE_MAX_BYTES,
  baixarImagemDiscord,
  enviarDiscord
};
