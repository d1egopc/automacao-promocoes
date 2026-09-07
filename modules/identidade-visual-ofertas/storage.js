"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { normalizarClienteId } = require("../../utils/storage");

const DATA_DIR = process.env.DATA_DIR || "/data";
const STORAGE_DIR = process.env.IDENTIDADE_VISUAL_STORAGE_DIR || path.join(DATA_DIR, "identidade-visual-ofertas");
const ASSETS_DIR = path.join(__dirname, "..", "..", "assets", "identidade-visual");
const LOGO_OFICIAL_PATH = path.join(ASSETS_DIR, "optimus-oficial.png");

function garantirDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function hashTexto(valor = "") {
  return crypto.createHash("sha256").update(String(valor || "")).digest("hex");
}

function resolverBasePublica() {
  const base = texto(
    process.env.IDENTIDADE_VISUAL_PUBLIC_BASE_URL ||
      process.env.API_PUBLIC_URL ||
      process.env.BACKEND_PUBLIC_URL ||
      process.env.PUBLIC_BASE_URL ||
      "https://go.optimuspromo.com.br"
  ).replace(/\/+$/, "");
  return /^https?:\/\//i.test(base) ? base : "";
}

function normalizarRelativo(relativo = "") {
  const rel = texto(relativo).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.includes("..") || rel.split("/").some((parte) => !parte || !/^[a-zA-Z0-9_.:-]+$/.test(parte))) {
    throw new Error("identidade_visual_caminho_inseguro");
  }
  return rel;
}

function urlPublica(relativo = "") {
  const rel = normalizarRelativo(relativo);
  const base = resolverBasePublica();
  return `${base}/identidade-visual-ofertas/public/${rel}`;
}

function caminhoPublico(relativo = "") {
  const rel = normalizarRelativo(relativo);
  const destino = path.resolve(STORAGE_DIR, rel);
  const raiz = path.resolve(STORAGE_DIR);
  if (destino !== raiz && !destino.startsWith(raiz + path.sep)) {
    throw new Error("identidade_visual_caminho_inseguro");
  }
  return destino;
}

function caminhoRenderizado(clienteId = "admin", cacheKey = "") {
  const cliente = normalizarClienteId(clienteId || "admin");
  const hash = texto(cacheKey).replace(/[^a-f0-9]/gi, "").toLowerCase();
  if (!/^[a-f0-9]{32,64}$/.test(hash)) throw new Error("identidade_visual_cache_key_invalido");
  const relativo = `clientes/${cliente}/renderizados/${hash}.png`;
  return {
    relativo,
    path: caminhoPublico(relativo),
    url: urlPublica(relativo)
  };
}

function caminhoLogoCliente(clienteId = "admin", hash = "") {
  const cliente = normalizarClienteId(clienteId || "admin");
  const id = texto(hash).replace(/[^a-f0-9]/gi, "").toLowerCase();
  if (!/^[a-f0-9]{32,64}$/.test(id)) throw new Error("identidade_visual_logo_id_invalido");
  const relativo = `clientes/${cliente}/logos/${id}.png`;
  return {
    relativo,
    path: caminhoPublico(relativo),
    url: urlPublica(relativo),
    ref: `cliente:${id}`
  };
}

function salvarBufferPublico(destino, buffer) {
  garantirDir(path.dirname(destino.path));
  fs.writeFileSync(destino.path, buffer);
  return {
    path: destino.path,
    url: destino.url,
    relativo: destino.relativo
  };
}

function lerLogoBuffer(clienteId = "admin", logo = "optimus_oficial") {
  const ref = texto(logo || "optimus_oficial");
  if (!ref || ref === "optimus_oficial") {
    return fs.readFileSync(LOGO_OFICIAL_PATH);
  }

  const match = ref.match(/^cliente:([a-f0-9]{32,64})$/i);
  if (!match) throw new Error("identidade_visual_logo_ref_invalido");
  return fs.readFileSync(caminhoLogoCliente(clienteId, match[1]).path);
}

function resolverLogoUrl(clienteId = "admin", logo = "optimus_oficial") {
  const ref = texto(logo || "optimus_oficial");
  if (!ref || ref === "optimus_oficial") {
    return "/assets/identidade-visual/optimus-oficial.png";
  }
  const match = ref.match(/^cliente:([a-f0-9]{32,64})$/i);
  return match ? caminhoLogoCliente(clienteId, match[1]).url : "";
}

function salvarLogoCliente(clienteId = "admin", bufferPng) {
  const hash = hashBuffer(bufferPng);
  const destino = caminhoLogoCliente(clienteId, hash);
  if (!fs.existsSync(destino.path)) {
    salvarBufferPublico(destino, bufferPng);
  }
  return {
    ref: destino.ref,
    url: destino.url,
    hash
  };
}

function existeArquivo(caminho) {
  try {
    return fs.existsSync(caminho);
  } catch {
    return false;
  }
}

function raizPublica() {
  garantirDir(STORAGE_DIR);
  return STORAGE_DIR;
}

module.exports = {
  STORAGE_DIR,
  LOGO_OFICIAL_PATH,
  raizPublica,
  urlPublica,
  caminhoRenderizado,
  caminhoLogoCliente,
  salvarBufferPublico,
  salvarLogoCliente,
  lerLogoBuffer,
  resolverLogoUrl,
  existeArquivo,
  hashTexto,
  hashBuffer
};
