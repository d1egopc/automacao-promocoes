#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_DATA_DIR = process.env.DATA_DIR || "/data";
const DEFAULT_TOP_LIMIT = 50;
const DEFAULT_RECENT_MS = 30 * 60 * 1000;
const MIN_FREE_TO_WRITE_REPORT_BYTES = 25 * 1024 * 1024;

const STATUS_HISTORICO = new Set(["enviado", "historico", "publicado", "sucesso"]);
const STATUS_FINAL = new Set([
  "retida",
  "retido",
  "cancelada",
  "cancelado",
  "erro_final",
  "erro_permanente",
  "falha_final",
  "expirada",
  "expirado",
  "expirada_operacional",
  "expirado_operacional"
]);
const STATUS_ATIVO = new Set([
  "pendente",
  "aguardando",
  "pronta",
  "pronto",
  "processando",
  "enviando",
  "em_tentativa",
  "tentando",
  "erro_temporario",
  "erro_retry",
  "retry"
]);
const STATUS_PROCESSANDO = new Set(["processando", "enviando", "em_tentativa", "tentando"]);

const NOMES_SENSIVEIS = /(token|secret|senha|password|cookie|cred|session|sessao|auth|jwt|key|private|client_secret)/i;
const EXT_IMAGEM_MIDIA = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov", ".mp3", ".ogg"]);
const EXT_LOG = new Set([".log", ".out", ".err"]);
const EXT_TMP = new Set([".tmp", ".temp", ".bak", ".backup", ".old"]);

function parseArgs(argv = []) {
  const opcoes = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [chave, ...partes] = arg.slice(2).split("=");
    const valor = partes.length ? partes.join("=") : "true";
    opcoes[chave.replace(/-([a-z])/g, (_, letra) => letra.toUpperCase())] = valor;
  }
  return {
    dataDir: opcoes.dataDir || DEFAULT_DATA_DIR,
    top: limitarInteiro(opcoes.top, DEFAULT_TOP_LIMIT, 1, 200),
    writeReport: String(opcoes.writeReport || "false").toLowerCase() === "true",
    recentMinutes: limitarInteiro(opcoes.recentMinutes, 30, 1, 1440)
  };
}

function limitarInteiro(valor, padrao, min, max) {
  const numero = Number.parseInt(valor, 10);
  if (!Number.isFinite(numero)) return padrao;
  return Math.max(min, Math.min(max, numero));
}

function agoraIso() {
  return new Date().toISOString();
}

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

function caminhoRelativo(dataDir, caminho) {
  const rel = path.relative(dataDir, caminho).replace(/\\/g, "/");
  return rel && rel !== "." ? `/data/${rel}` : "/data";
}

function sanitizarSegmento(segmento) {
  if (!segmento) return segmento;
  if (NOMES_SENSIVEIS.test(segmento)) return segmento.replace(/[^.]+(?=\.[^.]+$|$)/, "[sensivel]");
  if (/^[A-Za-z0-9_-]{48,}$/.test(segmento)) return `${segmento.slice(0, 8)}...[redigido]`;
  return segmento;
}

function sanitizarCaminho(dataDir, caminho) {
  const rel = caminhoRelativo(dataDir, caminho);
  return rel.split("/").map((parte, idx) => (idx <= 1 ? parte : sanitizarSegmento(parte))).join("/");
}

function criarResumoArquivo(dataDir, arquivo) {
  return {
    caminho: sanitizarCaminho(dataDir, arquivo.path),
    tamanhoBytes: arquivo.size,
    tamanho: bytesLegiveis(arquivo.size),
    modificadoEm: arquivo.mtime ? new Date(arquivo.mtime).toISOString() : null,
    categoria: arquivo.category,
    extensao: arquivo.ext || "[sem_extensao]"
  };
}

function categoriaArquivo(dataDir, caminho, stats) {
  const rel = path.relative(dataDir, caminho).replace(/\\/g, "/");
  const lower = rel.toLowerCase();
  const ext = path.extname(lower);
  if (lower.startsWith("clientes/") && lower.endsWith("/fila.json")) return "filas";
  if (lower.startsWith("clientes/")) return "clientes";
  if (lower.startsWith("reset-esteiras/") || lower.startsWith("reset-operacional/")) return "snapshots_reset";
  if (lower.includes("session") || lower.includes("sessao") || lower.includes("auth") || lower.includes("baileys") || lower.includes("whatsapp") || lower.includes("wpp")) return "sessoes_auth_whatsapp";
  if (EXT_LOG.has(ext) || lower.includes("log")) return "logs_persistidos";
  if (EXT_TMP.has(ext) || lower.includes("tmp") || lower.includes("temp")) return "temporarios_backups";
  if (lower.includes("backup") || lower.includes("bak")) return "temporarios_backups";
  if (EXT_IMAGEM_MIDIA.has(ext) || lower.includes("image") || lower.includes("imagem") || lower.includes("media") || lower.includes("midia")) return "imagens_midias";
  if (lower.includes("cache")) return "caches";
  if (stats.isDirectory()) return "diretorio";
  return "outros_orfaos_auditar";
}

function adicionarMapa(mapa, chave, bytes, extra = {}) {
  if (!mapa[chave]) mapa[chave] = { tamanhoBytes: 0, quantidade: 0, ...extra };
  mapa[chave].tamanhoBytes += bytes;
  mapa[chave].quantidade += 1;
}

function registrarSessao(mapa, chave, arquivo) {
  if (!chave) return;
  if (!mapa[chave]) mapa[chave] = { tamanhoBytes: 0, quantidadeArquivos: 0, modificadoMaisRecenteMs: 0, modificadoMaisAntigoMs: null };
  mapa[chave].tamanhoBytes += arquivo.size;
  mapa[chave].quantidadeArquivos += 1;
  mapa[chave].modificadoMaisRecenteMs = Math.max(mapa[chave].modificadoMaisRecenteMs || 0, arquivo.mtime || 0);
  mapa[chave].modificadoMaisAntigoMs = mapa[chave].modificadoMaisAntigoMs == null ? arquivo.mtime : Math.min(mapa[chave].modificadoMaisAntigoMs, arquivo.mtime || arquivo.mtime);
}

function chaveSessaoSanitizada(rel) {
  const partes = rel.split("/").filter(Boolean);
  const idx = partes.findIndex(parte => /(session|sessao|auth|baileys|whatsapp|wpp)/i.test(parte));
  if (idx < 0) return null;
  const raiz = partes.slice(0, Math.min(partes.length, idx + 2)).map(sanitizarSegmento).join("/");
  return `/data/${raiz}`;
}
function finalizarMapa(mapa) {
  return Object.fromEntries(Object.entries(mapa).sort((a, b) => b[1].tamanhoBytes - a[1].tamanhoBytes).map(([chave, valor]) => [chave, {
    ...valor,
    tamanho: bytesLegiveis(valor.tamanhoBytes)
  }]));
}

function finalizarSessoes(mapa) {
  const agoraMs = Date.now();
  return Object.fromEntries(Object.entries(mapa).sort((a, b) => b[1].tamanhoBytes - a[1].tamanhoBytes).map(([chave, valor]) => {
    const idadeUltimaModMs = valor.modificadoMaisRecenteMs ? agoraMs - valor.modificadoMaisRecenteMs : null;
    return [chave, {
      tamanhoBytes: valor.tamanhoBytes,
      tamanho: bytesLegiveis(valor.tamanhoBytes),
      quantidadeArquivos: valor.quantidadeArquivos,
      modificadoMaisRecenteEm: valor.modificadoMaisRecenteMs ? new Date(valor.modificadoMaisRecenteMs).toISOString() : null,
      modificadoMaisAntigoEm: valor.modificadoMaisAntigoMs ? new Date(valor.modificadoMaisAntigoMs).toISOString() : null,
      atividadeAparente: idadeUltimaModMs == null ? "desconhecida" : (idadeUltimaModMs <= 24 * 60 * 60 * 1000 ? "ativa_ultimas_24h" : "sem_modificacao_recente")
    }];
  }));
}
function inventariarArquivos(dataDir, top) {
  const pilha = [dataDir];
  const porPrimeiroNivel = {};
  const porTipo = {};
  const porCategoria = {};
  const porWorkspaceDir = {};
  const sessoes = {};
  const arquivos = [];
  const dirs = [];
  let totalArquivos = 0;
  let totalDiretorios = 0;
  let totalBytes = 0;

  while (pilha.length) {
    const atual = pilha.pop();
    let stats;
    try {
      stats = fs.lstatSync(atual);
    } catch (erro) {
      continue;
    }

    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      totalDiretorios += 1;
      dirs.push({ path: atual, size: 0, mtime: stats.mtimeMs, category: categoriaArquivo(dataDir, atual, stats), ext: "[diretorio]" });
      let filhos = [];
      try {
        filhos = fs.readdirSync(atual).map(nome => path.join(atual, nome));
      } catch (erro) {
        continue;
      }
      for (const filho of filhos) pilha.push(filho);
      continue;
    }

    if (!stats.isFile()) continue;
    const rel = path.relative(dataDir, atual).replace(/\\/g, "/");
    const primeiroNivel = rel.split("/")[0] || "[raiz]";
    const ext = path.extname(atual).toLowerCase() || "[sem_extensao]";
    const category = categoriaArquivo(dataDir, atual, stats);
    const size = stats.size;
    totalArquivos += 1;
    totalBytes += size;
    adicionarMapa(porPrimeiroNivel, primeiroNivel, size);
    adicionarMapa(porTipo, ext, size);
    adicionarMapa(porCategoria, category, size);
    if (rel.startsWith("clientes/")) {
      const workspace = rel.split("/")[1] || "[workspace_desconhecido]";
      adicionarMapa(porWorkspaceDir, workspace, size);
    }
    const chaveSessao = chaveSessaoSanitizada(rel);
    if (chaveSessao) registrarSessao(sessoes, chaveSessao, { size, mtime: stats.mtimeMs });
    arquivos.push({ path: atual, size, mtime: stats.mtimeMs, category, ext });
  }

  arquivos.sort((a, b) => b.size - a.size);
  const maioresArquivos = arquivos.slice(0, top).map(arquivo => criarResumoArquivo(dataDir, arquivo));
  const arquivosMaisAntigos = [...arquivos].sort((a, b) => a.mtime - b.mtime).slice(0, top).map(arquivo => criarResumoArquivo(dataDir, arquivo));
  return {
    totalArquivos,
    totalDiretorios,
    tamanhoTotalArquivosBytes: totalBytes,
    tamanhoTotalArquivos: bytesLegiveis(totalBytes),
    porPrimeiroNivel: finalizarMapa(porPrimeiroNivel),
    porWorkspace: finalizarMapa(porWorkspaceDir),
    sessoesAuthWhatsApp: finalizarSessoes(sessoes),
    porTipoArquivo: finalizarMapa(porTipo),
    porCategoria: finalizarMapa(porCategoria),
    maioresArquivos,
    arquivosMaisAntigos
  };
}

function obterEspacoData(dataDir) {
  try {
    const stats = fs.statfsSync(dataDir);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const livreBytes = Number(stats.bavail) * Number(stats.bsize);
    const usadoBytes = totalBytes - livreBytes;
    return {
      totalBytes,
      usadoBytes,
      livreBytes,
      total: bytesLegiveis(totalBytes),
      usado: bytesLegiveis(usadoBytes),
      livre: bytesLegiveis(livreBytes),
      percentualUsado: totalBytes ? Number(((usadoBytes / totalBytes) * 100).toFixed(2)) : null
    };
  } catch (erro) {
    return { erro: erro.message };
  }
}

function lerJsonSeguro(caminho) {
  try {
    return JSON.parse(fs.readFileSync(caminho, "utf8"));
  } catch (erro) {
    return null;
  }
}

function obterTimestampItem(item = {}) {
  const campos = ["dataEntradaFila", "criadoEm", "createdAt", "adicionadoEm", "updatedAt", "enviadoEm", "dataEnvio"];
  for (const campo of campos) {
    if (!item[campo]) continue;
    const ms = new Date(item[campo]).getTime();
    if (Number.isFinite(ms)) return { campo, ms };
  }
  return { campo: null, ms: null };
}

function statusItem(item = {}) {
  return String(item.status || item.estado || "pendente").toLowerCase().trim();
}

function classificarStatusFila(item, agoraMs, recentMs) {
  const status = statusItem(item);
  const ts = obterTimestampItem(item);
  if (!ts.ms) return { grupo: "semTimestamp", status, timestampCampo: null };
  if (STATUS_HISTORICO.has(status)) return { grupo: "enviadosHistorico", status, timestampCampo: ts.campo };
  if (STATUS_FINAL.has(status)) return { grupo: "retidosCanceladosErrosFinaisExpirados", status, timestampCampo: ts.campo };
  if (STATUS_PROCESSANDO.has(status)) return { grupo: "processandoEmTentativa", status, timestampCampo: ts.campo };
  if (STATUS_ATIVO.has(status)) {
    const idadeMs = Math.max(0, agoraMs - ts.ms);
    return { grupo: idadeMs <= recentMs ? "pendentesRecentes" : "pendentesVencidos", status, timestampCampo: ts.campo, idadeMs };
  }
  return { grupo: "statusDesconhecido", status, timestampCampo: ts.campo };
}

function percentil(valores, p) {
  if (!valores.length) return null;
  const ordenado = [...valores].sort((a, b) => a - b);
  const idx = Math.min(ordenado.length - 1, Math.max(0, Math.ceil((p / 100) * ordenado.length) - 1));
  return ordenado[idx];
}

function resumoIdades(idades = []) {
  if (!idades.length) return { minimoMs: null, mediaMs: null, medianaMs: null, p95Ms: null, maximoMs: null };
  const soma = idades.reduce((acc, valor) => acc + valor, 0);
  return {
    minimoMs: Math.min(...idades),
    mediaMs: Math.round(soma / idades.length),
    medianaMs: percentil(idades, 50),
    p95Ms: percentil(idades, 95),
    maximoMs: Math.max(...idades)
  };
}

function incrementarContador(obj, chave, inc = 1) {
  const segura = chave || "[ausente]";
  obj[segura] = (obj[segura] || 0) + inc;
}

function hashArquivo(caminho) {
  try {
    const hash = crypto.createHash("sha256");
    const conteudo = fs.readFileSync(caminho);
    hash.update(conteudo);
    return hash.digest("hex");
  } catch (erro) {
    return null;
  }
}

function auditarFilas(dataDir, recentMinutes) {
  const clientesDir = path.join(dataDir, "clientes");
  const agoraMs = Date.now();
  const recentMs = recentMinutes * 60 * 1000;
  const workspaces = {};
  const totais = {
    totalFilas: 0,
    totalItens: 0,
    enviadosHistorico: 0,
    retidosCanceladosErrosFinaisExpirados: 0,
    pendentesRecentes: 0,
    pendentesVencidos: 0,
    processandoEmTentativa: 0,
    semTimestamp: 0,
    statusDesconhecido: 0,
    tamanhoFilasBytes: 0,
    liberavelPorPendentesVencidosBytesAprox: 0,
    liberavelPorHistoricoLeveBytesAprox: 0
  };

  if (!fs.existsSync(clientesDir)) return { clientesDirExiste: false, totais, workspaces };
  for (const workspaceId of fs.readdirSync(clientesDir).sort()) {
    const filaPath = path.join(clientesDir, workspaceId, "fila.json");
    if (!fs.existsSync(filaPath)) continue;
    let txt = "";
    try {
      txt = fs.readFileSync(filaPath, "utf8");
    } catch (erro) {
      workspaces[workspaceId] = { erroLeitura: erro.message };
      continue;
    }
    const fila = lerJsonSeguro(filaPath);
    if (!Array.isArray(fila)) {
      workspaces[workspaceId] = { erroParse: "fila_json_nao_array", tamanhoBytes: Buffer.byteLength(txt) };
      continue;
    }

    const ws = {
      totalFilaJson: fila.length,
      tamanhoFilaJsonBytes: Buffer.byteLength(txt),
      tamanhoFilaJson: bytesLegiveis(Buffer.byteLength(txt)),
      hashFilaJson: hashArquivo(filaPath),
      enviadosHistorico: 0,
      retidosCanceladosErrosFinaisExpirados: 0,
      pendentesRecentes: 0,
      pendentesVencidos: 0,
      processandoEmTentativa: 0,
      semTimestamp: 0,
      statusDesconhecido: 0,
      tamanhoAproximadoPorGrupoBytes: {},
      statusReais: {},
      marketplace: {},
      destino: {},
      timestampCampos: {},
      idadePendentesVencidos: resumoIdades([])
    };
    const idadesVencidos = [];
    for (const item of fila) {
      const status = statusItem(item);
      const classificacao = classificarStatusFila(item, agoraMs, recentMs);
      const bytesItem = Buffer.byteLength(JSON.stringify(item || {}));
      ws[classificacao.grupo] = (ws[classificacao.grupo] || 0) + 1;
      ws.tamanhoAproximadoPorGrupoBytes[classificacao.grupo] = (ws.tamanhoAproximadoPorGrupoBytes[classificacao.grupo] || 0) + bytesItem;
      incrementarContador(ws.statusReais, status);
      incrementarContador(ws.marketplace, item.marketplace || item.origemMarketplace || item.metadata?.produto?.marketplace);
      incrementarContador(ws.destino, item.destino || item.canal || item.tipoDestino || item.metadata?.destino);
      incrementarContador(ws.timestampCampos, classificacao.timestampCampo || "[sem_timestamp]");
      if (classificacao.grupo === "pendentesVencidos" && Number.isFinite(classificacao.idadeMs)) idadesVencidos.push(classificacao.idadeMs);
    }
    ws.tamanhoAproximadoPorGrupo = Object.fromEntries(Object.entries(ws.tamanhoAproximadoPorGrupoBytes).map(([grupo, bytes]) => [grupo, {
      tamanhoBytes: bytes,
      tamanho: bytesLegiveis(bytes)
    }]));
    ws.liberavelPorPendentesVencidosBytesAprox = ws.tamanhoAproximadoPorGrupoBytes.pendentesVencidos || 0;
    ws.liberavelPorPendentesVencidos = bytesLegiveis(ws.liberavelPorPendentesVencidosBytesAprox);
    ws.liberavelFuturoPorHistoricoLeveBytesAprox = ws.tamanhoAproximadoPorGrupoBytes.enviadosHistorico || 0;
    ws.liberavelFuturoPorHistoricoLeve = bytesLegiveis(ws.liberavelFuturoPorHistoricoLeveBytesAprox);
    ws.idadePendentesVencidos = resumoIdades(idadesVencidos);

    workspaces[workspaceId] = ws;
    totais.totalFilas += 1;
    totais.totalItens += fila.length;
    totais.tamanhoFilasBytes += ws.tamanhoFilaJsonBytes;
    totais.liberavelPorPendentesVencidosBytesAprox += ws.liberavelPorPendentesVencidosBytesAprox;
    totais.liberavelPorHistoricoLeveBytesAprox += ws.liberavelFuturoPorHistoricoLeveBytesAprox;
    for (const grupo of ["enviadosHistorico", "retidosCanceladosErrosFinaisExpirados", "pendentesRecentes", "pendentesVencidos", "processandoEmTentativa", "semTimestamp", "statusDesconhecido"]) {
      totais[grupo] += ws[grupo] || 0;
    }
  }
  totais.tamanhoFilas = bytesLegiveis(totais.tamanhoFilasBytes);
  totais.liberavelPorPendentesVencidos = bytesLegiveis(totais.liberavelPorPendentesVencidosBytesAprox);
  totais.liberavelPorHistoricoLeve = bytesLegiveis(totais.liberavelPorHistoricoLeveBytesAprox);
  return { clientesDirExiste: true, recentMinutes, totais, workspaces };
}

function classificarLimpeza(categoria) {
  if (["sessoes_auth_whatsapp", "filas", "clientes"].includes(categoria)) return "NAO_TOCAR";
  if (["temporarios_backups", "logs_persistidos", "caches"].includes(categoria)) return "CANDIDATO_A_LIMPEZA";
  if (["snapshots_reset"].includes(categoria)) return "PRECISA_DE_AUDITORIA";
  if (["imagens_midias"].includes(categoria)) return "RECONSTRUIVEL_OU_AUDITAR";
  return "PRECISA_DE_AUDITORIA";
}

function classificarCategorias(porCategoria = {}) {
  return Object.fromEntries(Object.entries(porCategoria).map(([categoria, valor]) => [categoria, {
    ...valor,
    classificacaoLimpeza: classificarLimpeza(categoria)
  }]));
}

function montarRelatorio(opcoes) {
  const dataDir = path.resolve(opcoes.dataDir);
  const startedAt = agoraIso();
  const espaco = obterEspacoData(dataDir);
  const inventario = inventariarArquivos(dataDir, opcoes.top);
  const filas = auditarFilas(dataDir, opcoes.recentMinutes);
  const porCategoriaClassificada = classificarCategorias(inventario.porCategoria);
  return {
    ok: true,
    modo: "somente_leitura",
    aplicouMudancas: false,
    geradoEm: startedAt,
    dataDir: "/data",
    opcoes: {
      top: opcoes.top,
      recentMinutes: opcoes.recentMinutes,
      writeReport: opcoes.writeReport
    },
    espaco,
    inventario: {
      ...inventario,
      porCategoria: porCategoriaClassificada
    },
    filas,
    seguranca: {
      naoImprimeConteudoArquivos: true,
      naoLeTokensCookiesCredenciais: true,
      saidaSanitizada: true,
      somenteLeitura: true,
      nenhumResetExecutado: true,
      nenhumArquivoApagado: true,
      relatorioEmDiscoPadraoDesligado: true,
      margemMinimaRecomendadaAntesDryRunBytes: 100 * 1024 * 1024,
      margemMinimaRecomendadaAntesDryRun: "100 MB",
      justificativaMargem: "preserva espaco para lotes com payload, escrita atomica, crescimento normal, logs, snapshots e eventual rollback"
    }
  };
}

function caminhoRelatorio(dataDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(dataDir, `auditoria-volume-data-${stamp}.json`);
}

function escreverRelatorioSeSeguro(relatorio, dataDir) {
  const livre = relatorio.espaco && Number(relatorio.espaco.livreBytes);
  if (!Number.isFinite(livre) || livre < MIN_FREE_TO_WRITE_REPORT_BYTES) {
    return { gravado: false, motivo: "espaco_livre_insuficiente_para_relatorio_em_disco" };
  }
  const destino = caminhoRelatorio(dataDir);
  const texto = JSON.stringify(relatorio, null, 2);
  fs.writeFileSync(destino, texto);
  return {
    gravado: true,
    caminho: sanitizarCaminho(dataDir, destino),
    tamanhoBytes: Buffer.byteLength(texto),
    tamanho: bytesLegiveis(Buffer.byteLength(texto))
  };
}

function main() {
  const opcoes = parseArgs(process.argv.slice(2));
  const relatorio = montarRelatorio(opcoes);
  if (opcoes.writeReport) {
    relatorio.relatorioEmDisco = escreverRelatorioSeSeguro(relatorio, path.resolve(opcoes.dataDir));
  }
  console.log(JSON.stringify(relatorio, null, 2));
}

main();