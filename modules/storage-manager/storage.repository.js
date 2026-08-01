"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  CATEGORIAS_STORAGE,
  STATUS_FILA
} = require("./storage.types");

const DEFAULT_DATA_DIR = process.env.DATA_DIR || "/data";
const EXT_MIDIA = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov", ".mp3", ".ogg"]);
const EXT_LOG = new Set([".log", ".out", ".err"]);
const EXT_TEMPORARIO = new Set([".tmp", ".temp", ".old", ".swp"]);
const EXT_BACKUP = new Set([".bak", ".backup"]);
const SENSIVEL_RE = /(token|secret|senha|password|cookie|cred|session|sessao|auth|jwt|key|private|client_secret)/i;

const SET_HISTORICO = new Set(STATUS_FILA.HISTORICO);
const SET_FINAL = new Set(STATUS_FILA.FINAL);
const SET_ATIVO = new Set(STATUS_FILA.ATIVO);
const SET_PROCESSANDO = new Set(STATUS_FILA.PROCESSANDO);

function bytesLegiveis(bytes = 0) {
  const unidades = ["B", "KB", "MB", "GB"];
  let valor = Number(bytes) || 0;
  let idx = 0;
  while (valor >= 1024 && idx < unidades.length - 1) {
    valor /= 1024;
    idx += 1;
  }
  return `${valor.toFixed(idx === 0 ? 0 : 2)} ${unidades[idx]}`;
}

function incrementar(mapa, chave, bytes = 0, quantidade = 1) {
  const id = chave || "[ausente]";
  if (!mapa[id]) mapa[id] = { tamanhoBytes: 0, quantidade: 0 };
  mapa[id].tamanhoBytes += bytes;
  mapa[id].quantidade += quantidade;
}

function finalizarMapaTamanho(mapa) {
  return Object.fromEntries(
    Object.entries(mapa)
      .sort((a, b) => b[1].tamanhoBytes - a[1].tamanhoBytes)
      .map(([chave, valor]) => [chave, { ...valor, tamanho: bytesLegiveis(valor.tamanhoBytes) }])
  );
}

function caminhoRelativo(dataDir, caminho) {
  const rel = path.relative(dataDir, caminho).replace(/\\/g, "/");
  return rel && rel !== "." ? rel : "";
}

function sanitizarSegmento(segmento = "") {
  if (!segmento) return segmento;
  if (SENSIVEL_RE.test(segmento)) return segmento.replace(/[^.]+(?=\.[^.]+$|$)/, "[sensivel]");
  if (/^[A-Za-z0-9_-]{48,}$/.test(segmento)) return `${segmento.slice(0, 8)}...[redigido]`;
  return segmento;
}

function sanitizarCaminho(dataDir, caminho) {
  const rel = caminhoRelativo(dataDir, caminho);
  if (!rel) return "/data";
  return `/data/${rel.split("/").map(sanitizarSegmento).join("/")}`;
}

function categoriaArquivo(dataDir, caminho, stats) {
  const rel = caminhoRelativo(dataDir, caminho).toLowerCase();
  const ext = path.extname(rel);

  if (rel.startsWith("clientes/") && rel.endsWith("/fila.json")) return CATEGORIAS_STORAGE.FILAS;
  if (/session|sessao|auth|baileys|whatsapp|wpp/.test(rel)) return CATEGORIAS_STORAGE.SESSOES;
  if (rel.startsWith("reset-esteiras/") || rel.startsWith("reset-operacional/") || rel.includes("snapshot")) return CATEGORIAS_STORAGE.SNAPSHOTS;
  if (EXT_BACKUP.has(ext) || /backup|bak/.test(rel)) return CATEGORIAS_STORAGE.BACKUPS;
  if (EXT_LOG.has(ext) || /log/.test(rel)) return CATEGORIAS_STORAGE.LOGS;
  if (EXT_TEMPORARIO.has(ext) || /tmp|temp/.test(rel)) return CATEGORIAS_STORAGE.TEMPORARIOS;
  if (/cache/.test(rel)) return CATEGORIAS_STORAGE.CACHES;
  if (EXT_MIDIA.has(ext) || /image|imagem|media|midia|upload/.test(rel)) return CATEGORIAS_STORAGE.MIDIAS;
  if (rel.startsWith("clientes/")) return CATEGORIAS_STORAGE.CLIENTES;
  if (stats.isFile()) return CATEGORIAS_STORAGE.ORFAOS;
  return CATEGORIAS_STORAGE.OUTROS;
}

function obterEspacoVolume(dataDir = DEFAULT_DATA_DIR) {
  try {
    const stats = fs.statfsSync(dataDir);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const livreBytes = Number(stats.bavail) * Number(stats.bsize);
    const usadoBytes = Math.max(0, totalBytes - livreBytes);
    return {
      ok: true,
      totalBytes,
      usadoBytes,
      livreBytes,
      total: bytesLegiveis(totalBytes),
      usado: bytesLegiveis(usadoBytes),
      livre: bytesLegiveis(livreBytes),
      percentualUsado: totalBytes ? Number(((usadoBytes / totalBytes) * 100).toFixed(2)) : null
    };
  } catch (erro) {
    return { ok: false, erro: erro.message };
  }
}

function criarResumoArquivo(dataDir, arquivo) {
  return {
    caminho: sanitizarCaminho(dataDir, arquivo.caminho),
    tamanhoBytes: arquivo.tamanhoBytes,
    tamanho: bytesLegiveis(arquivo.tamanhoBytes),
    modificadoEm: arquivo.modificadoEm ? new Date(arquivo.modificadoEm).toISOString() : null,
    categoria: arquivo.categoria,
    extensao: arquivo.extensao || "[sem_extensao]"
  };
}

function registrarDiretorios(dataDir, arquivo, tamanhoBytes, diretorios) {
  const rel = caminhoRelativo(dataDir, arquivo);
  const partes = rel.split("/").filter(Boolean);
  for (let i = 1; i < partes.length; i += 1) {
    const dirRel = partes.slice(0, i).join("/");
    incrementar(diretorios, `/data/${dirRel.split("/").map(sanitizarSegmento).join("/")}`, tamanhoBytes);
  }
}

function verificarDeadline(opcoes = {}) {
  if (opcoes.deadlineMs && Date.now() > opcoes.deadlineMs) {
    const erro = new Error("auditoria_storage_timeout");
    erro.codigo = "auditoria_storage_timeout";
    erro.statusCode = 503;
    throw erro;
  }
}

function inventariarVolume(opcoes = {}) {
  const dataDir = path.resolve(opcoes.dataDir || DEFAULT_DATA_DIR);
  const limite = Math.max(1, Math.min(500, Number(opcoes.top || 50) || 50));
  const pilha = [dataDir];
  const erros = [];
  const arquivos = [];
  const porPrimeiroNivel = {};
  const porTipoArquivo = {};
  const porCategoria = {};
  const porWorkspace = {};
  const sessoes = {};
  const diretorios = {};
  let totalArquivos = 0;
  let totalDiretorios = 0;
  let tamanhoTotalArquivosBytes = 0;

  while (pilha.length) {
    verificarDeadline(opcoes);
    const atual = pilha.pop();
    let stats;
    try {
      stats = fs.lstatSync(atual);
    } catch (erro) {
      erros.push({ caminho: sanitizarCaminho(dataDir, atual), erro: erro.code || erro.message });
      continue;
    }

    if (stats.isSymbolicLink()) continue;

    if (stats.isDirectory()) {
      verificarDeadline(opcoes);
      totalDiretorios += 1;
      let filhos = [];
      try {
        filhos = fs.readdirSync(atual).map(nome => path.join(atual, nome));
      } catch (erro) {
        erros.push({ caminho: sanitizarCaminho(dataDir, atual), erro: erro.code || erro.message });
        continue;
      }
      for (const filho of filhos) pilha.push(filho);
      continue;
    }

    if (!stats.isFile()) continue;
    verificarDeadline(opcoes);

    const rel = caminhoRelativo(dataDir, atual);
    const primeiroNivel = rel.split("/")[0] || "[raiz]";
    const extensao = path.extname(rel).toLowerCase() || "[sem_extensao]";
    const categoria = categoriaArquivo(dataDir, atual, stats);
    const tamanhoBytes = stats.size;

    totalArquivos += 1;
    tamanhoTotalArquivosBytes += tamanhoBytes;
    incrementar(porPrimeiroNivel, primeiroNivel, tamanhoBytes);
    incrementar(porTipoArquivo, extensao, tamanhoBytes);
    incrementar(porCategoria, categoria, tamanhoBytes);
    registrarDiretorios(dataDir, atual, tamanhoBytes, diretorios);

    if (rel.startsWith("clientes/")) {
      const workspaceId = rel.split("/")[1] || "[workspace_desconhecido]";
      incrementar(porWorkspace, workspaceId, tamanhoBytes);
    }

    if (categoria === CATEGORIAS_STORAGE.SESSOES) {
      const partes = rel.split("/").filter(Boolean);
      const chaveSessao = `/data/${partes.slice(0, Math.min(partes.length, 3)).map(sanitizarSegmento).join("/")}`;
      if (!sessoes[chaveSessao]) sessoes[chaveSessao] = { tamanhoBytes: 0, quantidade: 0, ultimaModificacaoMs: 0 };
      sessoes[chaveSessao].tamanhoBytes += tamanhoBytes;
      sessoes[chaveSessao].quantidade += 1;
      sessoes[chaveSessao].ultimaModificacaoMs = Math.max(sessoes[chaveSessao].ultimaModificacaoMs, stats.mtimeMs || 0);
    }

    arquivos.push({ caminho: atual, tamanhoBytes, modificadoEm: stats.mtimeMs, categoria, extensao });
  }

  const maioresArquivos = [...arquivos]
    .sort((a, b) => b.tamanhoBytes - a.tamanhoBytes)
    .slice(0, limite)
    .map(arquivo => criarResumoArquivo(dataDir, arquivo));
  const arquivosMaisAntigos = [...arquivos]
    .sort((a, b) => a.modificadoEm - b.modificadoEm)
    .slice(0, limite)
    .map(arquivo => criarResumoArquivo(dataDir, arquivo));
  const diretoriosOrdenados = finalizarMapaTamanho(diretorios);

  return {
    dataDir: "/data",
    totalArquivos,
    totalDiretorios,
    tamanhoTotalArquivosBytes,
    tamanhoTotalArquivos: bytesLegiveis(tamanhoTotalArquivosBytes),
    porPrimeiroNivel: finalizarMapaTamanho(porPrimeiroNivel),
    porTipoArquivo: finalizarMapaTamanho(porTipoArquivo),
    porCategoria: finalizarMapaTamanho(porCategoria),
    porWorkspace: finalizarMapaTamanho(porWorkspace),
    sessoes: Object.fromEntries(Object.entries(finalizarMapaTamanho(sessoes)).map(([chave, valor]) => [chave, {
      ...valor,
      ultimaModificacaoEm: sessoes[chave]?.ultimaModificacaoMs ? new Date(sessoes[chave].ultimaModificacaoMs).toISOString() : null
    }])),
    maioresArquivos,
    arquivosMaisAntigos,
    maioresDiretorios: Object.fromEntries(Object.entries(diretoriosOrdenados).slice(0, limite)),
    maiorArquivo: maioresArquivos[0] || null,
    maiorDiretorio: Object.entries(diretoriosOrdenados)[0]
      ? { caminho: Object.entries(diretoriosOrdenados)[0][0], ...Object.entries(diretoriosOrdenados)[0][1] }
      : null,
    maiorWorkspace: Object.entries(finalizarMapaTamanho(porWorkspace))[0]
      ? { workspaceId: Object.entries(finalizarMapaTamanho(porWorkspace))[0][0], ...Object.entries(finalizarMapaTamanho(porWorkspace))[0][1] }
      : null,
    erros
  };
}

function lerJsonSeguro(caminho) {
  try {
    return JSON.parse(fs.readFileSync(caminho, "utf8"));
  } catch (erro) {
    return null;
  }
}

function hashArquivoSeguro(caminho) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(caminho)).digest("hex");
  } catch {
    return null;
  }
}

function statusItem(item = {}) {
  return String(item.status || item.estado || "pendente").toLowerCase().trim();
}

function timestampItem(item = {}) {
  const campos = ["dataEntradaFila", "criadoEm", "createdAt", "adicionadoEm", "updatedAt", "enviadoEm", "dataEnvio"];
  for (const campo of campos) {
    if (!item[campo]) continue;
    const ms = new Date(item[campo]).getTime();
    if (Number.isFinite(ms)) return { campo, ms };
  }
  return { campo: null, ms: null };
}

function classificarItemFila(item = {}, agoraMs = Date.now(), recenteMs = 30 * 60 * 1000) {
  const status = statusItem(item);
  const ts = timestampItem(item);
  if (!ts.ms) return { grupo: "semTimestamp", status, timestampCampo: null };
  if (SET_HISTORICO.has(status)) return { grupo: "enviadosHistorico", status, timestampCampo: ts.campo };
  if (SET_FINAL.has(status)) return { grupo: "finais", status, timestampCampo: ts.campo };
  if (SET_PROCESSANDO.has(status)) return { grupo: "processando", status, timestampCampo: ts.campo };
  if (SET_ATIVO.has(status)) {
    const idadeMs = Math.max(0, agoraMs - ts.ms);
    return { grupo: idadeMs <= recenteMs ? "pendentesRecentes" : "pendentesVencidos", status, timestampCampo: ts.campo, idadeMs };
  }
  return { grupo: "statusDesconhecido", status, timestampCampo: ts.campo };
}

function resumirFilas(opcoes = {}) {
  const dataDir = path.resolve(opcoes.dataDir || DEFAULT_DATA_DIR);
  const clientesDir = path.join(dataDir, "clientes");
  const agoraMs = Date.now();
  const recenteMs = Math.max(1, Number(opcoes.recentMinutes || 30) || 30) * 60 * 1000;
  const totais = {
    totalWorkspaces: 0,
    totalItens: 0,
    tamanhoFilasBytes: 0,
    enviadosHistorico: 0,
    pendentesRecentes: 0,
    pendentesVencidos: 0,
    finais: 0,
    processando: 0,
    semTimestamp: 0,
    statusDesconhecido: 0
  };
  const workspaces = {};
  const erros = [];

  if (!fs.existsSync(clientesDir)) return { clientesDirExiste: false, totais, workspaces, erros };

  for (const workspaceId of fs.readdirSync(clientesDir).sort()) {
    verificarDeadline(opcoes);
    const filaPath = path.join(clientesDir, workspaceId, "fila.json");
    if (!fs.existsSync(filaPath)) continue;
    let stats;
    try {
      stats = fs.statSync(filaPath);
    } catch (erro) {
      erros.push({ workspaceId, caminho: `/data/clientes/${workspaceId}/fila.json`, erro: erro.code || erro.message });
      continue;
    }
    const fila = lerJsonSeguro(filaPath);
    if (!Array.isArray(fila)) {
      erros.push({ workspaceId, caminho: `/data/clientes/${workspaceId}/fila.json`, erro: "fila_json_invalido" });
      continue;
    }

    const ws = {
      workspaceId,
      totalItens: fila.length,
      tamanhoFilaBytes: stats.size,
      tamanhoFila: bytesLegiveis(stats.size),
      hashFila: hashArquivoSeguro(filaPath),
      enviadosHistorico: 0,
      pendentesRecentes: 0,
      pendentesVencidos: 0,
      finais: 0,
      processando: 0,
      semTimestamp: 0,
      statusDesconhecido: 0,
      tamanhoAproximadoPorGrupoBytes: {},
      tamanhoAproximadoPorGrupo: {},
      statusReais: {},
      marketplaces: {},
      destinos: {},
      timestampCampos: {}
    };

    for (const item of fila) {
      verificarDeadline(opcoes);
      const classificacao = classificarItemFila(item, agoraMs, recenteMs);
      const bytesItem = Buffer.byteLength(JSON.stringify(item || {}));
      ws[classificacao.grupo] += 1;
      ws.tamanhoAproximadoPorGrupoBytes[classificacao.grupo] = (ws.tamanhoAproximadoPorGrupoBytes[classificacao.grupo] || 0) + bytesItem;
      ws.statusReais[classificacao.status] = (ws.statusReais[classificacao.status] || 0) + 1;
      const marketplace = item.marketplace || item.origemMarketplace || item.metadata?.produto?.marketplace || "[ausente]";
      const destino = item.destino || item.canal || item.tipoDestino || item.metadata?.destino || "[ausente]";
      ws.marketplaces[marketplace] = (ws.marketplaces[marketplace] || 0) + 1;
      ws.destinos[destino] = (ws.destinos[destino] || 0) + 1;
      const campo = classificacao.timestampCampo || "[sem_timestamp]";
      ws.timestampCampos[campo] = (ws.timestampCampos[campo] || 0) + 1;
    }

    ws.tamanhoAproximadoPorGrupo = Object.fromEntries(
      Object.entries(ws.tamanhoAproximadoPorGrupoBytes).map(([grupo, bytes]) => [grupo, {
        tamanhoBytes: bytes,
        tamanho: bytesLegiveis(bytes)
      }])
    );

    workspaces[workspaceId] = ws;
    totais.totalWorkspaces += 1;
    totais.totalItens += ws.totalItens;
    totais.tamanhoFilasBytes += ws.tamanhoFilaBytes;
    for (const grupo of ["enviadosHistorico", "pendentesRecentes", "pendentesVencidos", "finais", "processando", "semTimestamp", "statusDesconhecido"]) {
      totais[grupo] += ws[grupo] || 0;
    }
  }

  totais.tamanhoFilas = bytesLegiveis(totais.tamanhoFilasBytes);
  return { clientesDirExiste: true, recentMinutes: recenteMs / 60000, totais, workspaces, erros };
}

module.exports = {
  DEFAULT_DATA_DIR,
  bytesLegiveis,
  sanitizarCaminho,
  obterEspacoVolume,
  inventariarVolume,
  resumirFilas
};