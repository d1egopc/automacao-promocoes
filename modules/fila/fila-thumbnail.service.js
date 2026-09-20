"use strict";

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");
const sharp = require("sharp");
const {
  avaliarPublicabilidadeImagemUniversal
} = require("../imagens/resolver-imagem-universal");
const filaHistoricoPolicy = require("../../utils/fila-historico-policy");

const THUMBNAIL_VERSION = "v1";
const THUMBNAIL_WIDTH = 240;
const THUMBNAIL_QUALITY = 75;
const THUMBNAIL_TIMEOUT_MS = 6_500;
const THUMBNAIL_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const THUMBNAIL_RETENTION_MS = filaHistoricoPolicy.HISTORICO_COMPACTO_MS;
const HISTORICO_LEVE_INCREMENTAL_DIR = "fila-historico-leve-incremental";
const tarefasEmAndamento = new Map();
const tarefasAgendadas = new Set();

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function segmentoSeguro(valor = "", fallback = "item") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || fallback;
}

function sha256(valor) {
  return crypto.createHash("sha256").update(valor).digest("hex");
}

function numeroPositivo(valor, fallback) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : fallback;
}

function configuracaoStorage(deps = {}) {
  const env = deps.env || process.env;
  const dataDir = texto(deps.dataDir || env.DATA_DIR || "/data");
  const raiz = path.resolve(texto(
    deps.storageDir || env.FILA_THUMBNAIL_STORAGE_DIR || path.join(dataDir, "fila-thumbnails")
  ));
  const origemBase = texto(
    deps.publicBaseUrl ||
    env.FILA_THUMBNAIL_PUBLIC_BASE_URL ||
    `${texto(env.PUBLIC_BASE_URL || "https://go.optimuspromo.com.br").replace(/\/+$/, "")}/fila/thumbnails/public/`
  );
  let baseUrl;
  try {
    baseUrl = new URL(origemBase.endsWith("/") ? origemBase : `${origemBase}/`);
  } catch {
    throw new Error("fila_thumbnail_public_base_invalida");
  }
  if (baseUrl.protocol !== "https:") throw new Error("fila_thumbnail_public_base_invalida");
  return { raiz, baseUrl, dataDir: path.resolve(dataDir) };
}

function hostPrivadoOuLocal(hostname = "") {
  const host = texto(hostname).replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const tipoIp = net.isIP(host);
  if (!tipoIp) return false;
  if (tipoIp === 4) {
    const partes = host.split(".").map(Number);
    return (
      partes[0] === 10 ||
      partes[0] === 127 ||
      (partes[0] === 169 && partes[1] === 254) ||
      (partes[0] === 172 && partes[1] >= 16 && partes[1] <= 31) ||
      (partes[0] === 192 && partes[1] === 168)
    );
  }
  return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
}

function urlHttpsPublica(valor = "") {
  try {
    const url = new URL(texto(valor));
    if (url.protocol !== "https:" || hostPrivadoOuLocal(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function imagemFontePublicavel(item = {}, imagemRef = "", deps = {}) {
  const url = urlHttpsPublica(imagemRef);
  if (!url) return { ok: false, motivo: "imagem_fonte_url_invalida" };
  if (item.imagemEnviavel !== true) return { ok: false, motivo: "imagem_fonte_nao_marcada_enviavel" };

  const origem = texto(
    item.imagemOrigem ||
    item.origemImagemFinal ||
    item.origemImagem ||
    item.metadata?.imagemOrigem ||
    item.metadata?.origemImagemFinal ||
    ""
  );
  const linhagem = texto([
    origem,
    item.imagemStatus,
    item.imagemBaseOrigem,
    item.metadata?.imagemStatus,
    item.metadata?.imagemBaseOrigem
  ].filter(Boolean).join(" ")).toLowerCase();
  if (/radar|mirror|mensagem|grupo|whatsapp|telegram|clonador/.test(linhagem)) {
    return { ok: false, motivo: "imagem_fonte_nao_oficial" };
  }

  const avaliar = deps.avaliarPublicabilidade || avaliarPublicabilidadeImagemUniversal;
  const publicabilidadeBase = avaliar({ ...item, imagem: url.toString(), imagemUrl: url.toString() });
  if (!publicabilidadeBase?.ok) {
    return { ok: false, motivo: publicabilidadeBase?.motivo || "imagem_fonte_nao_publicavel" };
  }
  const publicabilidade = avaliar({ ...item, imagem: url.toString(), imagemUrl: url.toString() }, {
    valor: url.toString(),
    origem,
    camada: texto(item.imagemStatus || item.metadata?.imagemStatus || "")
  });
  if (!publicabilidade?.ok) {
    return { ok: false, motivo: publicabilidade?.motivo || "imagem_fonte_nao_publicavel" };
  }
  return { ok: true, url: url.toString(), origem };
}

async function lerBodyLimitado(response, limiteBytes, controller) {
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > limiteBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw new Error("fila_thumbnail_fonte_muito_grande");
  }

  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > limiteBytes) {
          controller.abort();
          throw new Error("fila_thumbnail_fonte_muito_grande");
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, total);
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > limiteBytes) throw new Error("fila_thumbnail_fonte_muito_grande");
  return buffer;
}

async function baixarFonte(imagemRef = "", deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const timeoutMs = numeroPositivo(deps.timeoutMs, THUMBNAIL_TIMEOUT_MS);
  const limiteBytes = numeroPositivo(deps.maxSourceBytes, THUMBNAIL_MAX_SOURCE_BYTES);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(imagemRef, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "OptimusPromo/1.0 (+https://go.optimuspromo.com.br)",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      }
    });
    const statusHttp = Number(response?.status || 0);
    if (!response?.ok || statusHttp < 200 || statusHttp >= 300) {
      try { await response?.body?.cancel?.(); } catch {}
      throw new Error(`fila_thumbnail_http_${statusHttp || "erro"}`);
    }
    const finalUrl = urlHttpsPublica(response.url || imagemRef);
    if (!finalUrl) {
      try { await response?.body?.cancel?.(); } catch {}
      throw new Error("fila_thumbnail_redirect_inseguro");
    }
    const contentType = texto(response.headers?.get?.("content-type") || "").toLowerCase().split(";")[0];
    if (!contentType.startsWith("image/")) {
      try { await response?.body?.cancel?.(); } catch {}
      throw new Error("fila_thumbnail_content_type_invalido");
    }
    const buffer = await lerBodyLimitado(response, limiteBytes, controller);
    if (!buffer.length) throw new Error("fila_thumbnail_fonte_vazia");
    return { buffer, contentType, finalUrl: finalUrl.toString(), statusHttp };
  } catch (erro) {
    if (erro?.name === "AbortError") throw new Error("fila_thumbnail_timeout");
    throw erro;
  } finally {
    clearTimeout(timer);
  }
}

function caminhoRelativoSeguro(clienteId, marketplace, nome) {
  return path.join(
    segmentoSeguro(clienteId, "admin"),
    segmentoSeguro(marketplace, "marketplace"),
    segmentoSeguro(nome, "thumb")
  );
}

function caminhoDentroDaRaiz(raiz, relativo) {
  const destino = path.resolve(raiz, relativo);
  if (destino !== raiz && !destino.startsWith(`${raiz}${path.sep}`)) {
    throw new Error("fila_thumbnail_caminho_invalido");
  }
  return destino;
}

function urlPublica(baseUrl, relativo) {
  return new URL(relativo.split(path.sep).map(encodeURIComponent).join("/"), baseUrl).toString();
}

function escreverArquivoAtomico(file, buffer, deps = {}) {
  const fsImpl = deps.fs || fs;
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  if (fsImpl.existsSync(file)) return false;
  const temporario = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  try {
    fsImpl.writeFileSync(temporario, buffer, { flag: "wx" });
    try {
      fsImpl.renameSync(temporario, file);
      return true;
    } catch (erro) {
      if (fsImpl.existsSync(file)) return false;
      throw erro;
    }
  } finally {
    try { if (fsImpl.existsSync(temporario)) fsImpl.unlinkSync(temporario); } catch {}
  }
}

function lerIndiceReuso(indiceFile, config, deps = {}) {
  const fsImpl = deps.fs || fs;
  try {
    if (!fsImpl.existsSync(indiceFile)) return null;
    const indice = JSON.parse(fsImpl.readFileSync(indiceFile, "utf8"));
    const relativo = texto(indice?.relativePath);
    if (!relativo || !texto(indice?.thumbRef) || !texto(indice?.sourceUrlHash)) return null;
    const file = caminhoDentroDaRaiz(config.raiz, relativo);
    if (!fsImpl.existsSync(file)) return null;
    return { ...indice, file };
  } catch {
    return null;
  }
}

function escreverIndiceAtomico(indiceFile, indice, deps = {}) {
  const fsImpl = deps.fs || fs;
  const payload = Buffer.from(JSON.stringify(indice), "utf8");
  const temporario = `${indiceFile}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  fsImpl.mkdirSync(path.dirname(indiceFile), { recursive: true });
  try {
    fsImpl.writeFileSync(temporario, payload, { flag: "wx" });
    fsImpl.renameSync(temporario, indiceFile);
  } finally {
    try { if (fsImpl.existsSync(temporario)) fsImpl.unlinkSync(temporario); } catch {}
  }
}

function identidadeThumbnail(entrada = {}) {
  return texto(
    entrada.identidade ||
    entrada.item?.id ||
    entrada.item?.ofertaId ||
    entrada.item?.engineOfertaId ||
    entrada.item?.produtoId ||
    entrada.item?.productId ||
    ""
  );
}

function hashFonteDeclarado(item = {}) {
  const valor = texto(
    item.imagemHash ||
    item.imageHash ||
    item.metadata?.imagemHash ||
    item.metadata?.imageHash ||
    item.metadata?.imagemCacheCanonico?.hash ||
    ""
  ).toLowerCase();
  return /^[a-f0-9]{16,128}$/.test(valor) ? valor : "";
}

async function gerarThumbnailInterno(entrada = {}, deps = {}) {
  const inicio = process.hrtime.bigint();
  const item = entrada.item && typeof entrada.item === "object" ? entrada.item : {};
  const clienteId = texto(entrada.clienteId || item.clienteId || item.workspaceId || "admin");
  const marketplace = texto(entrada.marketplace || item.marketplace || "").toLowerCase();
  const identidade = identidadeThumbnail(entrada);
  const fonte = imagemFontePublicavel(item, entrada.imagemRef, deps);
  if (!fonte.ok) return { ok: false, motivo: fonte.motivo, gerada: false };
  if (!clienteId || !marketplace || !identidade) {
    return { ok: false, motivo: "fila_thumbnail_identidade_incompleta", gerada: false };
  }

  const config = configuracaoStorage(deps);
  const sourceUrlHash = sha256(fonte.url);
  const sourceDeclaredHash = hashFonteDeclarado(item);
  const sourceIdentityHash = sourceDeclaredHash || sourceUrlHash;
  const nomeBase = `${segmentoSeguro(identidade, "oferta")}_${sourceIdentityHash.slice(0, 16)}_${THUMBNAIL_VERSION}`;
  const relativoIndice = caminhoRelativoSeguro(clienteId, marketplace, `${nomeBase}.json`);
  const indiceFile = caminhoDentroDaRaiz(config.raiz, relativoIndice);
  const indiceExistente = lerIndiceReuso(indiceFile, config, deps);
  if (
    indiceExistente?.sourceUrlHash === sourceUrlHash &&
    texto(indiceExistente?.sourceDeclaredHash) === sourceDeclaredHash
  ) {
    return {
      ok: true,
      gerada: false,
      reutilizada: true,
      thumbRef: indiceExistente.thumbRef,
      sourceUrlHash,
      sourceContentHash: indiceExistente.sourceContentHash,
      bytes: Number(indiceExistente.bytes || 0),
      width: Number(indiceExistente.width || 0),
      height: Number(indiceExistente.height || 0),
      duracaoMs: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6)
    };
  }

  const download = await baixarFonte(fonte.url, deps);
  const fonteFinal = imagemFontePublicavel(item, download.finalUrl, deps);
  if (!fonteFinal.ok) throw new Error(fonteFinal.motivo || "fila_thumbnail_redirect_nao_publicavel");
  const sourceContentHash = sha256(download.buffer);
  const sharpImpl = deps.sharpImpl || sharp;
  const transformador = sharpImpl(download.buffer, { limitInputPixels: 24_000_000 })
    .rotate()
    .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
    .webp({ quality: THUMBNAIL_QUALITY, effort: 4 });
  const saida = await transformador.toBuffer({ resolveWithObject: true });
  const buffer = Buffer.isBuffer(saida) ? saida : saida?.data;
  const info = Buffer.isBuffer(saida) ? {} : (saida?.info || {});
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("fila_thumbnail_saida_vazia");
  if (Number(info.width || 0) > THUMBNAIL_WIDTH) throw new Error("fila_thumbnail_largura_invalida");

  const nomeThumb = `${segmentoSeguro(identidade, "oferta")}_${sourceContentHash.slice(0, 24)}_${THUMBNAIL_VERSION}.webp`;
  const relativoThumb = caminhoRelativoSeguro(clienteId, marketplace, nomeThumb);
  const thumbFile = caminhoDentroDaRaiz(config.raiz, relativoThumb);
  const gravou = escreverArquivoAtomico(thumbFile, buffer, deps);
  const thumbRef = urlPublica(config.baseUrl, relativoThumb);
  const indice = {
    version: THUMBNAIL_VERSION,
    sourceUrlHash,
    sourceDeclaredHash,
    sourceContentHash,
    relativePath: relativoThumb.split(path.sep).join("/"),
    thumbRef,
    bytes: buffer.length,
    width: Number(info.width || 0),
    height: Number(info.height || 0),
    createdAt: new Date(deps.agora || Date.now()).toISOString()
  };
  escreverIndiceAtomico(indiceFile, indice, deps);

  return {
    ok: true,
    gerada: gravou,
    reutilizada: !gravou,
    thumbRef,
    sourceUrlHash,
    sourceContentHash,
    bytes: buffer.length,
    width: Number(info.width || 0),
    height: Number(info.height || 0),
    file: thumbFile,
    duracaoMs: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6)
  };
}

function chaveTrabalho(entrada = {}, deps = {}) {
  const item = entrada.item && typeof entrada.item === "object" ? entrada.item : {};
  const config = configuracaoStorage(deps);
  return sha256([
    texto(entrada.clienteId || item.clienteId || item.workspaceId || "admin"),
    texto(entrada.marketplace || item.marketplace || "").toLowerCase(),
    identidadeThumbnail(entrada),
    texto(entrada.imagemRef),
    hashFonteDeclarado(item),
    config.raiz,
    config.baseUrl.toString(),
    THUMBNAIL_VERSION
  ].join("\0"));
}

function gerarThumbnail(entrada = {}, deps = {}) {
  const chave = chaveTrabalho(entrada, deps);
  if (tarefasEmAndamento.has(chave)) return tarefasEmAndamento.get(chave);
  const tarefa = Promise.resolve()
    .then(() => gerarThumbnailInterno(entrada, deps))
    .finally(() => tarefasEmAndamento.delete(chave));
  tarefasEmAndamento.set(chave, tarefa);
  return tarefa;
}

function logSeguro(logger, evento, dados = {}) {
  try {
    (logger?.log || console.log).call(logger || console, "[FILA-THUMBNAIL]", JSON.stringify({ evento, ...dados }));
  } catch {}
}

function agendarThumbnail(entrada = {}, deps = {}) {
  const logger = deps.logger || console;
  const tarefa = Promise.resolve()
    .then(() => gerarThumbnail(entrada, deps))
    .then(async resultado => {
      if (resultado?.ok && typeof entrada.onSuccess === "function") {
        await entrada.onSuccess(resultado);
      }
      logSeguro(logger, "geracao_concluida", {
        ok: resultado?.ok === true,
        motivo: resultado?.motivo || "",
        gerada: resultado?.gerada === true,
        reutilizada: resultado?.reutilizada === true,
        bytes: Number(resultado?.bytes || 0),
        width: Number(resultado?.width || 0),
        height: Number(resultado?.height || 0),
        duracaoMs: Number(resultado?.duracaoMs || 0)
      });
      return resultado;
    })
    .catch(erro => {
      logSeguro(logger, "geracao_falhou", { erro: texto(erro?.message || "fila_thumbnail_erro").slice(0, 120) });
      return { ok: false, motivo: texto(erro?.message || "fila_thumbnail_erro"), gerada: false };
    })
    .finally(() => tarefasAgendadas.delete(tarefa));
  tarefasAgendadas.add(tarefa);
  return { ok: true, agendada: true, tarefa };
}

async function aguardarPendencias() {
  await Promise.allSettled([...tarefasAgendadas]);
}

function timestampRegistro(registro = {}) {
  const item = registro?.item || {};
  for (const valor of [item.finalizadoEm, item.enviadoEm, item.erroEm, item.expiradoEm, item.updatedAt, registro.registradoEm]) {
    const ms = Date.parse(valor);
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}

function segmentoHistoricoPodeConterReferenciaAtiva(nome = "", agora = Date.now(), retentionMs = THUMBNAIL_RETENTION_MS) {
  const match = texto(nome).match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/i);
  if (!match) return true;
  const inicioDia = Date.parse(`${match[1]}T00:00:00.000Z`);
  if (!Number.isFinite(inicioDia)) return true;
  return Number(agora) - inicioDia < Number(retentionMs) + 24 * 60 * 60 * 1000;
}

function coletarReferenciasAtivas(deps = {}) {
  const config = configuracaoStorage(deps);
  const fsImpl = deps.fs || fs;
  const agora = Number(deps.agora || Date.now());
  const retentionMs = numeroPositivo(deps.retentionMs, THUMBNAIL_RETENTION_MS);
  const clientesDir = path.join(config.dataDir, "clientes");
  const ultimos = new Map();
  try {
    for (const cliente of fsImpl.readdirSync(clientesDir)) {
      const dir = path.join(clientesDir, cliente, HISTORICO_LEVE_INCREMENTAL_DIR);
      if (!fsImpl.existsSync(dir)) continue;
      for (const nome of fsImpl.readdirSync(dir)
        .filter(item => item.endsWith(".jsonl"))
        .filter(item => segmentoHistoricoPodeConterReferenciaAtiva(item, agora, retentionMs))
        .sort()) {
        const file = path.join(dir, nome);
        for (const linha of fsImpl.readFileSync(file, "utf8").split(/\r?\n/)) {
          if (!linha.trim()) continue;
          try {
            const registro = JSON.parse(linha);
            if (registro?.chave && registro?.item) ultimos.set(`${cliente}:${registro.chave}`, registro);
          } catch {}
        }
      }
    }
  } catch {}
  const referencias = new Set();
  for (const registro of ultimos.values()) {
    const thumbRef = texto(registro?.item?.thumbRef);
    const timestamp = timestampRegistro(registro);
    if (thumbRef && timestamp > 0 && agora - timestamp < retentionMs) referencias.add(thumbRef);
  }
  return referencias;
}

function listarArquivosRecursivo(dir, fsImpl, saida = []) {
  if (!fsImpl.existsSync(dir)) return saida;
  for (const nome of fsImpl.readdirSync(dir)) {
    const file = path.join(dir, nome);
    let stat;
    try { stat = fsImpl.statSync(file); } catch { continue; }
    if (stat.isDirectory()) listarArquivosRecursivo(file, fsImpl, saida);
    else if (stat.isFile()) saida.push({ file, stat });
  }
  return saida;
}

function limparOrfas(deps = {}) {
  const config = configuracaoStorage(deps);
  const fsImpl = deps.fs || fs;
  const agora = Number(deps.agora || Date.now());
  const retentionMs = numeroPositivo(deps.retentionMs, THUMBNAIL_RETENTION_MS);
  const referencias = deps.referenciasAtivas instanceof Set ? deps.referenciasAtivas : coletarReferenciasAtivas(deps);
  const arquivos = listarArquivosRecursivo(config.raiz, fsImpl);
  let removidas = 0;
  let indicesRemovidos = 0;
  let temporariosRemovidos = 0;
  let preservadas = 0;
  let bytesLiberados = 0;
  let erros = 0;

  for (const { file, stat } of arquivos) {
    const relativo = path.relative(config.raiz, file);
    if (relativo.startsWith("..") || path.isAbsolute(relativo)) continue;
    const idadeMs = Math.max(0, agora - Number(stat.mtimeMs || stat.ctimeMs || agora));
    if (path.basename(file).includes(".tmp-") && idadeMs >= Math.min(retentionMs, 60 * 60 * 1000)) {
      try {
        fsImpl.unlinkSync(file);
        temporariosRemovidos += 1;
        bytesLiberados += Number(stat.size || 0);
      } catch { erros += 1; }
      continue;
    }
    if (file.endsWith(".webp")) {
      const ref = urlPublica(config.baseUrl, relativo);
      if (referencias.has(ref) || idadeMs < retentionMs) {
        preservadas += 1;
        continue;
      }
      try {
        fsImpl.unlinkSync(file);
        removidas += 1;
        bytesLiberados += Number(stat.size || 0);
      } catch { erros += 1; }
      continue;
    }
    if (file.endsWith(".json") && idadeMs >= retentionMs) {
      try {
        const indice = JSON.parse(fsImpl.readFileSync(file, "utf8"));
        const thumbRef = texto(indice?.thumbRef);
        if (thumbRef && referencias.has(thumbRef)) continue;
      } catch {}
      try {
        fsImpl.unlinkSync(file);
        indicesRemovidos += 1;
      } catch { erros += 1; }
    }
  }

  return {
    ok: erros === 0,
    origem: "fila_thumbnails",
    tipoRegistro: "fila_thumbnails",
    aplicouMudancas: removidas > 0 || indicesRemovidos > 0 || temporariosRemovidos > 0,
    removidas,
    indicesRemovidos,
    temporariosRemovidos,
    preservadas,
    bytesLiberados,
    erros,
    retentionMs
  };
}

module.exports = {
  THUMBNAIL_VERSION,
  THUMBNAIL_WIDTH,
  THUMBNAIL_QUALITY,
  THUMBNAIL_TIMEOUT_MS,
  THUMBNAIL_MAX_SOURCE_BYTES,
  THUMBNAIL_RETENTION_MS,
  configuracaoStorage,
  imagemFontePublicavel,
  baixarFonte,
  gerarThumbnail,
  agendarThumbnail,
  aguardarPendencias,
  coletarReferenciasAtivas,
  limparOrfas,
  _tarefasEmAndamento: tarefasEmAndamento
};
