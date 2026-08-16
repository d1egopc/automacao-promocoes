const { obterConfigDiscord, DISCORD_API_BASE } = require("./discord-oauth");

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

function respostaErro({ channelId = "", erro = "", status = null, retryAfter = null } = {}) {
  return {
    ok: false,
    channelId: texto(channelId),
    messageId: "",
    enviadoEm: "",
    imagemEnviada: false,
    erro: texto(erro) || "discord_envio_falhou",
    statusHttp: status,
    retryAfterMs: retryAfter
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

async function baixarImagemDiscord({ imagemUrl = "", env = process.env, httpClient } = {}) {
  const hostsPermitidos = listaHosts(env.DISCORD_IMAGE_ALLOWED_HOSTS);
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

async function enviarDiscord({ channelId = "", mensagem = "", imagemUrl = "", env = process.env, httpClient, now = () => new Date() } = {}) {
  const canal = texto(channelId);
  const conteudo = texto(mensagem);
  const config = obterConfigDiscord(env);

  if (!config.botToken) return respostaErro({ channelId: canal, erro: "discord_bot_token_ausente" });
  if (!canal) return respostaErro({ channelId: canal, erro: "discord_channel_id_ausente" });
  if (!conteudo && !texto(imagemUrl)) return respostaErro({ channelId: canal, erro: "discord_mensagem_vazia" });
  if (conteudo.length > DISCORD_MESSAGE_LIMIT) {
    return respostaErro({ channelId: canal, erro: "discord_mensagem_muito_longa" });
  }
  if (!httpClient || typeof httpClient.post !== "function") {
    return respostaErro({ channelId: canal, erro: "discord_http_indisponivel" });
  }

  let body = { content: conteudo };
  let headers = { Authorization: `Bot ${config.botToken}` };
  let imagemEnviada = false;

  if (texto(imagemUrl)) {
    const imagem = await baixarImagemDiscord({ imagemUrl, env, httpClient });
    if (!imagem.ok) {
      return respostaErro({
        channelId: canal,
        erro: imagem.erro,
        status: imagem.statusHttp || null
      });
    }

    try {
      body = criarFormData({ mensagem: conteudo, imagem });
      headers = { Authorization: `Bot ${config.botToken}` };
      imagemEnviada = true;
    } catch (erro) {
      return respostaErro({ channelId: canal, erro: erro.message || "discord_imagem_invalida" });
    }
  }

  try {
    const resposta = await httpClient.post(
      `${DISCORD_API_BASE}/channels/${encodeURIComponent(canal)}/messages`,
      body,
      { headers }
    );
    const data = resposta?.data || {};
    return {
      ok: true,
      channelId: canal,
      messageId: texto(data.id),
      enviadoEm: texto(data.timestamp) || dataEnvio(now),
      imagemEnviada,
      erro: "",
      statusHttp: Number(resposta?.status || 200) || 200
    };
  } catch (erro) {
    const status = statusHttp(erro);
    return respostaErro({
      channelId: canal,
      erro: erroDiscordPorStatus(status),
      status,
      retryAfter: status === 429 ? retryAfterMs(erro?.response?.data || {}, erro?.response?.headers || {}) : null
    });
  }
}

module.exports = {
  DISCORD_MESSAGE_LIMIT,
  DISCORD_IMAGE_MAX_BYTES,
  baixarImagemDiscord,
  enviarDiscord
};
