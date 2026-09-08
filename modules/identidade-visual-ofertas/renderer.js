"use strict";

const crypto = require("crypto");
const sharp = require("sharp");
const {
  corHexIdentidade,
  contrasteTextoAutomatico
} = require("./paleta");

const RENDERER_VERSION_IDENTIDADE_VISUAL = "identidade-visual-ofertas-v2.2";
const CANVAS = 1080;
const FAIXA_ALTURA = 208;
const FILETE_ALTURA = 10;
const AREA_PRODUTO_ALTURA = CANVAS - FAIXA_ALTURA - FILETE_ALTURA;
const BASE_Y = AREA_PRODUTO_ALTURA + FILETE_ALTURA;
const AREA_COMPOSICAO_IMAGEM_ALTURA = 976;
const IMAGEM_PRODUTO_MAX_WIDTH = 1000;
const IMAGEM_PRODUTO_MAX_HEIGHT = 960;
const LOGO_SLOT = Object.freeze({ width: 248, height: 147, left: 56, top: BASE_Y + 30 });
const FRASE_SAFE_AREA = Object.freeze({
  left: 350,
  top: BASE_Y + 28,
  width: 700,
  height: FAIXA_ALTURA - 56,
  maxLines: 2,
  minFontSize: 40,
  maxFontSize: 56
});
const FONTE_RENDERER_IDENTIDADE_VISUAL = "'OptimusOferta', 'DejaVu Sans', Arial, Helvetica, sans-serif";
const CSS_FONTE_RENDERER_IDENTIDADE_VISUAL = `
  @font-face {
    font-family: 'OptimusOferta';
    src: url('file:///usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') format('truetype');
    font-weight: 900;
    font-style: normal;
  }
`;
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

function clamp(numero, min, max) {
  return Math.max(min, Math.min(max, numero));
}

function hexParaRgb(hex = "#005BFF") {
  const normalizada = texto(hex).replace(/^#/, "");
  const valor = /^[a-f0-9]{6}$/i.test(normalizada) ? normalizada : "005BFF";
  return {
    r: parseInt(valor.slice(0, 2), 16),
    g: parseInt(valor.slice(2, 4), 16),
    b: parseInt(valor.slice(4, 6), 16)
  };
}

function rgbParaHex({ r, g, b }) {
  return `#${[r, g, b].map((canal) => clamp(Math.round(canal), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function misturarCores(hexA, hexB, peso = 0.5) {
  const a = hexParaRgb(hexA);
  const b = hexParaRgb(hexB);
  return rgbParaHex({
    r: a.r * (1 - peso) + b.r * peso,
    g: a.g * (1 - peso) + b.g * peso,
    b: a.b * (1 - peso) + b.b * peso
  });
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

function svgTextoMedicao(conteudo = "", fontSize = 48) {
  return Buffer.from(`
    <svg width="1400" height="160" viewBox="0 0 1400 160" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="transparent"/>
      <style>${CSS_FONTE_RENDERER_IDENTIDADE_VISUAL}</style>
      <text x="12" y="92" font-family="${FONTE_RENDERER_IDENTIDADE_VISUAL}" font-size="${fontSize}" font-weight="900" letter-spacing="0" fill="#111">${escapeXml(conteudo)}</text>
    </svg>
  `);
}

async function medirTexto(conteudo = "", fontSize = 48, cache = new Map()) {
  const chave = `${fontSize}:${conteudo}`;
  if (cache.has(chave)) return cache.get(chave);
  const { info } = await sharp(svgTextoMedicao(conteudo, fontSize), { limitInputPixels: 4_000_000 })
    .png()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer({ resolveWithObject: true });
  const medida = {
    width: info.width || 0,
    height: info.height || fontSize
  };
  cache.set(chave, medida);
  return medida;
}

async function quebrarFrasePorMedida(frase = "", fontSize = 48, maxWidth = FRASE_SAFE_AREA.width, maxLines = 2, cache = new Map()) {
  const palavras = texto(frase).slice(0, 80).toUpperCase().split(/\s+/).filter(Boolean);
  if (!palavras.length) return { linhas: ["AS MELHORES OFERTAS, EM UM SÓ LUGAR"], truncada: false };

  const linhas = [];
  let atual = "";
  for (const palavra of palavras) {
    const candidata = atual ? `${atual} ${palavra}` : palavra;
    const medida = await medirTexto(candidata, fontSize, cache);
    if (medida.width <= maxWidth || !atual) {
      atual = candidata;
      continue;
    }
    linhas.push(atual);
    atual = palavra;
    if (linhas.length >= maxLines) break;
  }
  if (atual && linhas.length < maxLines) linhas.push(atual);
  if (linhas.length > maxLines) return null;

  const textoOriginal = palavras.join(" ");
  const textoFinal = linhas.join(" ");
  let truncada = false;
  if (textoFinal.length < textoOriginal.length && linhas.length) {
    truncada = true;
    let ultima = linhas[linhas.length - 1].replace(/[.,;:!?]*$/, "");
    while (ultima.length > 1) {
      const candidata = `${ultima}...`;
      const medida = await medirTexto(candidata, fontSize, cache);
      if (medida.width <= maxWidth) {
        linhas[linhas.length - 1] = candidata;
        return { linhas, truncada };
      }
      ultima = ultima.slice(0, -1).trim();
    }
    linhas[linhas.length - 1] = "...";
  }

  for (const linha of linhas) {
    const medida = await medirTexto(linha, fontSize, cache);
    if (medida.width > maxWidth) return null;
  }

  return { linhas, truncada };
}

async function montarLayoutFrase(frase = "") {
  const cache = new Map();
  let melhorTruncada = null;
  for (let fontSize = FRASE_SAFE_AREA.maxFontSize; fontSize >= FRASE_SAFE_AREA.minFontSize; fontSize -= 2) {
    const resultado = await quebrarFrasePorMedida(frase, fontSize, FRASE_SAFE_AREA.width, FRASE_SAFE_AREA.maxLines, cache);
    if (!resultado) continue;
    const { linhas, truncada } = resultado;
    const lineHeight = Math.round(fontSize * 1.08);
    const blocoAltura = linhas.length * lineHeight;
    if (blocoAltura <= FRASE_SAFE_AREA.height) {
      const top = FRASE_SAFE_AREA.top + Math.round((FRASE_SAFE_AREA.height - blocoAltura) / 2);
      const layout = {
        linhas,
        fontSize,
        lineHeight,
        x: FRASE_SAFE_AREA.left,
        baselineY: top + fontSize,
        safeArea: { ...FRASE_SAFE_AREA }
      };
      if (!truncada) return layout;
      if (!melhorTruncada) melhorTruncada = layout;
    }
  }

  if (melhorTruncada) return melhorTruncada;

  const fontSize = FRASE_SAFE_AREA.minFontSize;
  const resultado = await quebrarFrasePorMedida(frase, fontSize, FRASE_SAFE_AREA.width, FRASE_SAFE_AREA.maxLines, cache);
  return {
    linhas: resultado?.linhas || ["AS MELHORES OFERTAS..."],
    fontSize,
    lineHeight: Math.round(fontSize * 1.08),
    x: FRASE_SAFE_AREA.left,
    baselineY: FRASE_SAFE_AREA.top + fontSize,
    safeArea: { ...FRASE_SAFE_AREA }
  };
}

async function svgOverlay(config = {}) {
  const corFaixa = corHexIdentidade(config.corIdentidade || "azul");
  const corTexto = contrasteTextoAutomatico(corFaixa);
  const corProfunda = misturarCores(corFaixa, "#000000", 0.42);
  const corSombra = misturarCores(corFaixa, "#000000", 0.22);
  const corMeio = misturarCores(corFaixa, "#ffffff", 0.05);
  const corLuz = misturarCores(corFaixa, "#ffffff", 0.18);
  const corFilete = misturarCores(corFaixa, "#ffffff", 0.28);
  const corStroke = corTexto === "#FFFFFF" ? "#0f172a" : "#ffffff";
  const strokeOpacity = corTexto === "#FFFFFF" ? "0.1" : "0.2";
  const frase = texto(config.frase).slice(0, 80) || "AS MELHORES OFERTAS, EM UM SÓ LUGAR";
  const layoutFrase = await montarLayoutFrase(frase);
  const textoSombraSvg = layoutFrase.linhas
    .map((linha, idx) => `<text x="${layoutFrase.x + 2}" y="${layoutFrase.baselineY + idx * layoutFrase.lineHeight + 3}" font-family="${FONTE_RENDERER_IDENTIDADE_VISUAL}" font-size="${layoutFrase.fontSize}" font-weight="900" letter-spacing="0" fill="#000000" opacity="0.11">${escapeXml(linha)}</text>`)
    .join("");
  const textoSvg = layoutFrase.linhas
    .map((linha, idx) => `<text x="${layoutFrase.x}" y="${layoutFrase.baselineY + idx * layoutFrase.lineHeight}" font-family="${FONTE_RENDERER_IDENTIDADE_VISUAL}" font-size="${layoutFrase.fontSize}" font-weight="900" letter-spacing="0" fill="${corTexto}" stroke="${corStroke}" stroke-opacity="${strokeOpacity}" stroke-width="1" paint-order="stroke">${escapeXml(linha)}</text>`)
    .join("");

  return {
    buffer: Buffer.from(`
    <svg width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>${CSS_FONTE_RENDERER_IDENTIDADE_VISUAL}</style>
        <linearGradient id="base" x1="0" y1="${BASE_Y}" x2="${CANVAS}" y2="${CANVAS}" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${corProfunda}"/>
          <stop offset="0.34" stop-color="${corSombra}"/>
          <stop offset="0.72" stop-color="${corMeio}"/>
          <stop offset="1" stop-color="${corLuz}"/>
        </linearGradient>
        <linearGradient id="filete" x1="0" y1="${AREA_PRODUTO_ALTURA}" x2="${CANVAS}" y2="${AREA_PRODUTO_ALTURA}" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${corProfunda}"/>
          <stop offset="0.5" stop-color="${corFilete}"/>
          <stop offset="1" stop-color="${corLuz}"/>
        </linearGradient>
        <linearGradient id="brilho" x1="0" y1="${BASE_Y}" x2="0" y2="${BASE_Y + 92}" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.11"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="profundidade" x1="0" y1="${BASE_Y}" x2="0" y2="${CANVAS}" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#000000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0.16"/>
        </linearGradient>
        <linearGradient id="divisor" x1="0" y1="${BASE_Y + 32}" x2="0" y2="${CANVAS - 32}" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${corTexto}" stop-opacity="0"/>
          <stop offset="0.22" stop-color="${corTexto}" stop-opacity="0.32"/>
          <stop offset="0.78" stop-color="${corTexto}" stop-opacity="0.24"/>
          <stop offset="1" stop-color="${corTexto}" stop-opacity="0"/>
        </linearGradient>
        <radialGradient id="luzTexto" cx="78%" cy="44%" r="68%">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.14"/>
          <stop offset="0.62" stop-color="#ffffff" stop-opacity="0.04"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect x="0" y="${AREA_PRODUTO_ALTURA}" width="${CANVAS}" height="${FILETE_ALTURA}" fill="url(#filete)" opacity="0.96"/>
      <rect x="0" y="${BASE_Y}" width="${CANVAS}" height="${FAIXA_ALTURA}" fill="url(#base)"/>
      <rect x="0" y="${BASE_Y}" width="${CANVAS}" height="92" fill="url(#brilho)"/>
      <rect x="0" y="${BASE_Y}" width="${CANVAS}" height="${FAIXA_ALTURA}" fill="url(#luzTexto)"/>
      <rect x="0" y="${BASE_Y}" width="${CANVAS}" height="${FAIXA_ALTURA}" fill="url(#profundidade)"/>
      <path d="M${FRASE_SAFE_AREA.left + 40} ${BASE_Y + 20} L${CANVAS} ${BASE_Y + 20}" stroke="${corTexto}" stroke-opacity="0.08" stroke-width="1"/>
      <path d="M${FRASE_SAFE_AREA.left + 12} ${CANVAS - 25} L${CANVAS - 54} ${CANVAS - 25}" stroke="#000000" stroke-opacity="0.1" stroke-width="1"/>
      <path d="M${CANVAS - 230} ${BASE_Y} L${CANVAS} ${BASE_Y + 118}" stroke="#ffffff" stroke-opacity="0.055" stroke-width="28"/>
      <path d="M${CANVAS - 135} ${BASE_Y} L${CANVAS} ${BASE_Y + 70}" stroke="#ffffff" stroke-opacity="0.045" stroke-width="12"/>
      <rect x="318" y="${BASE_Y + 34}" width="2" height="${FAIXA_ALTURA - 68}" fill="url(#divisor)"/>
      ${textoSombraSvg}
      ${textoSvg}
    </svg>
  `),
    fraseLayout: layoutFrase
  };
}

async function normalizarLogoParaSlot(buffer) {
  return sharp(buffer, { limitInputPixels: 24_000_000 })
    .rotate()
    .resize({
      width: LOGO_SLOT.width,
      height: LOGO_SLOT.height,
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
      width: IMAGEM_PRODUTO_MAX_WIDTH,
      height: IMAGEM_PRODUTO_MAX_HEIGHT,
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
  const overlay = await svgOverlay(config);

  const produtoX = Math.round((CANVAS - (metaProdutoNormalizado.width || 0)) / 2);
  const produtoY = Math.round((AREA_COMPOSICAO_IMAGEM_ALTURA - (metaProdutoNormalizado.height || 0)) / 2);
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
      { input: overlay.buffer, left: 0, top: 0 },
      { input: logo, left: LOGO_SLOT.left, top: LOGO_SLOT.top }
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
      productRenderedWidth: metaProdutoNormalizado.width || 0,
      productRenderedHeight: metaProdutoNormalizado.height || 0,
      productRenderedX: Math.max(0, produtoX),
      productRenderedY: Math.max(0, produtoY),
      productCompositionHeight: AREA_COMPOSICAO_IMAGEM_ALTURA,
      productContainBox: {
        width: IMAGEM_PRODUTO_MAX_WIDTH,
        height: IMAGEM_PRODUTO_MAX_HEIGHT
      },
      productBehindBannerHeight: Math.max(0, produtoY + (metaProdutoNormalizado.height || 0) - BASE_Y),
      corIdentidade,
      corHex,
      corTexto,
      logoSlot: { ...LOGO_SLOT },
      fraseLayout: overlay.fraseLayout
    }
  };
}

module.exports = {
  RENDERER_VERSION_IDENTIDADE_VISUAL,
  CANVAS,
  FAIXA_ALTURA,
  AREA_PRODUTO_ALTURA,
  AREA_COMPOSICAO_IMAGEM_ALTURA,
  FILETE_ALTURA,
  IMAGEM_PRODUTO_MAX_WIDTH,
  IMAGEM_PRODUTO_MAX_HEIGHT,
  LOGO_SLOT,
  FRASE_SAFE_AREA,
  FONTE_RENDERER_IDENTIDADE_VISUAL,
  LIMITE_IMAGEM_ORIGINAL_BYTES,
  LIMITE_UPLOAD_LOGO_BYTES,
  MIMES_IMAGEM_PERMITIDOS,
  configHashIdentidadeVisual,
  cacheKeyIdentidadeVisual,
  baixarImagemComoBuffer,
  normalizarLogoUpload,
  renderizarIdentidadeVisualBuffer
};
