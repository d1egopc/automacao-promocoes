const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { logSocial } = require("./logs");

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function detectarMime(buffer = Buffer.alloc(0)) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return "";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) return "image/png";
  if (
    buffer.slice(0, 4).toString("ascii") === "RIFF" &&
    buffer.slice(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  return "";
}

function assertStorageConfigurado() {
  const raiz = texto(process.env.SOCIAL_MEDIA_STORAGE_DIR);
  const base = texto(process.env.SOCIAL_MEDIA_PUBLIC_BASE_URL);
  if (!raiz || !base) throw new Error("social_media_storage_nao_configurado");

  let baseUrl;
  try {
    baseUrl = new URL(base);
  } catch {
    throw new Error("social_media_storage_nao_configurado");
  }
  if (baseUrl.protocol !== "https:") throw new Error("social_media_storage_nao_configurado");

  return { raiz, baseUrl };
}

function salvar({ clienteId = "admin", buffer = Buffer.alloc(0), mimeType = "", nomeLogico = "social" } = {}) {
  const { raiz, baseUrl } = assertStorageConfigurado();
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("social_media_arquivo_obrigatorio");
  const limiteBytes = Number(process.env.SOCIAL_MEDIA_MAX_BYTES || 8 * 1024 * 1024);
  if (buffer.length > limiteBytes) throw new Error("social_media_arquivo_muito_grande");

  const mimeReal = detectarMime(buffer);
  const mimeDeclarado = texto(mimeType).toLowerCase();
  if (!mimeReal || !MIME_EXT[mimeReal]) throw new Error("social_media_tipo_invalido");
  if (mimeDeclarado && mimeDeclarado !== mimeReal) throw new Error("social_media_tipo_invalido");

  const clienteSeguro = texto(clienteId || "admin").replace(/[^a-zA-Z0-9_-]/g, "_");
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const ext = MIME_EXT[mimeReal];
  const nome = `${texto(nomeLogico || "social").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "social"}_${hash.slice(0, 24)}.${ext}`;
  const dir = path.resolve(raiz, clienteSeguro);
  const destino = path.resolve(dir, nome);
  const raizResolvida = path.resolve(raiz);

  if (!destino.startsWith(raizResolvida + path.sep)) throw new Error("social_media_caminho_invalido");
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(destino)) fs.writeFileSync(destino, buffer);

  const url = new URL(`${clienteSeguro}/${nome}`, baseUrl);
  logSocial("[SOCIAL-MIDIA-SALVA]", {
    clienteId,
    mimeType: mimeReal,
    bytes: buffer.length,
    hash: hash.slice(0, 12)
  });

  return {
    ok: true,
    url: url.toString(),
    mimeType: mimeReal,
    bytes: buffer.length,
    hash
  };
}

module.exports = {
  salvar,
  detectarMime
};
