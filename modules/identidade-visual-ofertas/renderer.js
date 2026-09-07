"use strict";

const crypto = require("crypto");
const sharp = require("sharp");
const {
  corHexIdentidade,
  contrasteTextoAutomatico
} = require("./paleta");

const RENDERER_VERSION_IDENTIDADE_VISUAL = "identidade-visual-ofertas-v1";
const CANVAS = 1080;
const FAIXA_ALTURA = 216;
const FILETE_ALTURA = 10;
const AREA_PRODUTO_ALTURA = CANVAS - FAIXA_ALTURA - FILETE_ALTURA;
const LIMITE_IMAGEM_ORIGINAL_BYTES = 8 * 1024 * 1024;
const LIMITE_UPLOAD_LOGO_BYTES = 2 * 1024 * 1024;
const MIMES_IMAGEM_PERMITIDOS = new Set(["image/png", "image/jpeg", "image/webp"]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function escapeXml(valor = "") {
  return texto(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function configHashIdentidadeVisual(config = {}) {
  const payload = {
    ativo: config.ativo !== false,
    logo: texto(config.logo || "optimus_oficial"),
    frase: texto(config.frase).slice(0, 80),
    corIdentidade: texto(config.corIdentidade || "azul")
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function cacheKeyIdentidadeVisual({ clienteId = "admin", imagemOriginal = "", configHash = "" } = {}) {
  return crypto
    .createHash("sha256")
    .update(`${RENDERER_VERSION_IDENTIDADE_VISUAL}|${clienteId}|${imagemOriginal}|${configHash}`)
    .digest("hex");
}

function wrapFrase(frase = "", fontSize = 44, maxWidth = 710, maxLines = 2) {
  const palavras = texto(frase).slice(0, 80).split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = "";
  const maxChars = Math.max(12, Math.floor(maxWidth / (fontSize * 0.72)));

  for (const palavra of palavras) {
    const candidata = atual ? `${atual} ${palavra}` : palavra;
    if (candidata.length <= maxChars) {
      atual = candidata;
      continue;
    }
    if (atual) linhas.push(atual);
    atual = palavra;
    if (linhas.length >= maxLines) break;
  }
  if (atual && linhas.length < maxLines) linhas.push(atual);

  if (palavras.length && linhas.join(" ").length < palavras.join(" ").length && linhas.length) {
    linhas[linhas.length - 1] = linhas[linhas.length - 1].replace(/[.,;:!?]*$/, "") + "...";
  }

  return linhas.length ? linhas : ["AS MELHORES OFERTAS, EM UM SÓ LUGAR"];
}

function svgOverlay(config = {}) {
  const corFaixa = corHexIdentidade(config.corIdentidade || "azul");
  const corTexto = contrasteTextoAutomatico(corFaixa);
  const frase = texto(config.frase).slice(0, 80) || "AS MELHORES OFERTAS, EM UM SÓ LUGAR";
  const linhas = wrapFrase(frase);
  const fontSize = linhas.length > 1 ? 42 : 48;
  const lineHeight = linhas.length > 1 ? 52 : 58;
  const blocoAltura = linhas.length * lineHeight;
  const yInicial = 864 + Math.round((FAIXA_ALTURA - blocoAltura) / 2) + fontSize - 4;
  const textoSvg = linhas
    .map((linha, idx) => `<text x="320" y="${yInicial + idx * lineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="800" letter-spacing="0" fill="${corTexto}">${escapeXml(linha.toUpperCase())}</text>`)
    .join("");

  return Buffer.from(`
    <svg width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="${AREA_PRODUTO_ALTURA}" width="${CANVAS}" height="${FILETE_ALTURA}" fill="${corFaixa}" opacity="0.92"/>
      <rect x="0" y="${AREA_PRODUTO_ALTURA + FILETE_ALTURA}" width="${CANVAS}" height="${FAIXA_ALTURA}" fill="${corFaixa}"/>
      <rect x="286" y="902" width="2" height="122" fill="${corTexto}" opacity="0.24"/>
      ${textoSvg}
    </svg>
  `);
}

async function normalizarLogoParaSlot(buffer) {
  return sharp(buffer, { limitInputPixels: 24_000_000 })
    .rotate()
    .resize({
      width: 198,
      height: 154,
      fit: "contain",
      withoutEnlargement: true,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
}

async function normalizarProdutoParaCanvas(buffer) {
  return sharp(buffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: 990,
      height: AREA_PRODUTO_ALTURA - 86,
      fit: "contain",
      withoutEnlargement: false,
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    })
    .png()
    .toBuffer();
}

async function validarImagemBuffer(buffer, { maxBytes = LIMITE_IMAGEM_ORIGINAL_BYTES, campo = "imagem" } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error(`${campo}_obrigatoria`);
  if (buffer.length > maxBytes) throw new Error(`${campo}_arquivo_muito_grande`);
  const meta = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
  if (!meta.width || !meta.height) throw new Error(`${campo}_invalida`);
  return meta;
}

async function baixarImagemComoBuffer(url = "", { httpClient, timeoutMs = 7000 } = {}) {
  const endereco = texto(url);
  if (!/^https?:\/\//i.test(endereco)) throw new Error("imagem_url_invalida");
  const client = httpClient || require("axios");
  const resposta = await client.get(endereco, {
    responseType: "arraybuffer",
    timeout: timeoutMs,
    maxContentLength: LIMITE_IMAGEM_ORIGINAL_BYTES,
    headers: {
      "user-agent": "OptimusPromo/1.0"
    }
  });

  const contentType = texto(resposta.headers?.["content-type"] || resposta.headers?.["Content-Type"]).toLowerCase().split(";")[0];
  if (contentType && !MIMES_IMAGEM_PERMITIDOS.has(contentType)) {
    throw new Error("imagem_tipo_invalido");
  }
  const buffer = Buffer.from(resposta.data || []);
  await validarImagemBuffer(buffer, { campo: "imagem" });
  return buffer;
}

async function normalizarLogoUpload(buffer, mimeType = "") {
  const mime = texto(mimeType).toLowerCase().split(";")[0];
  if (!MIMES_IMAGEM_PERMITIDOS.has(mime)) throw new Error("identidade_visual_logo_tipo_invalido");
  await validarImagemBuffer(buffer, { maxBytes: LIMITE_UPLOAD_LOGO_BYTES, campo: "identidade_visual_logo" });
  return sharp(buffer, { limitInputPixels: 24_000_000 })
    .rotate()
    .resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
}

async function renderizarIdentidadeVisualBuffer({ imagemBuffer, logoBuffer, config = {} } = {}) {
  const metaProduto = await validarImagemBuffer(imagemBuffer, { campo: "imagem" });
  const produto = await normalizarProdutoParaCanvas(imagemBuffer);
  const metaProdutoNormalizado = await sharp(produto).metadata();
  const logo = await normalizarLogoParaSlot(logoBuffer);

  const produtoX = Math.round((CANVAS - (metaProdutoNormalizado.width || 0)) / 2);
  const produtoY = Math.round((AREA_PRODUTO_ALTURA - (metaProdutoNormalizado.height || 0)) / 2);
  const corIdentidade = texto(config.corIdentidade || "azul");
  const corHex = corHexIdentidade(corIdentidade);
  const corTexto = contrasteTextoAutomatico(corHex);

  const output = await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
    .composite([
      { input: produto, left: Math.max(0, produtoX), top: Math.max(0, produtoY) },
      { input: svgOverlay(config), left: 0, top: 0 },
      { input: logo, left: 54, top: 895 }
    ])
    .png({ compressionLevel: 8, adaptiveFiltering: true })
    .toBuffer();

  return {
    buffer: output,
    metadata: {
      rendererVersion: RENDERER_VERSION_IDENTIDADE_VISUAL,
      width: CANVAS,
      height: CANVAS,
      productOriginalWidth: metaProduto.width,
      productOriginalHeight: metaProduto.height,
      corIdentidade,
      corHex,
      corTexto
    }
  };
}

module.exports = {
  RENDERER_VERSION_IDENTIDADE_VISUAL,
  CANVAS,
  FAIXA_ALTURA,
  AREA_PRODUTO_ALTURA,
  LIMITE_IMAGEM_ORIGINAL_BYTES,
  LIMITE_UPLOAD_LOGO_BYTES,
  MIMES_IMAGEM_PERMITIDOS,
  configHashIdentidadeVisual,
  cacheKeyIdentidadeVisual,
  baixarImagemComoBuffer,
  normalizarLogoUpload,
  renderizarIdentidadeVisualBuffer
};
