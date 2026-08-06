"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const filaHistoricoPolicy = require("../../utils/fila-historico-policy");
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
const DEFAULT_INCREMENTAL_TIMEOUT_MS = 8000;
const MAX_INCREMENTAL_TIMEOUT_MS = 30000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_TOP_FILES = 10;
const MAX_TOP_FILES = 20;
const DEFAULT_MAX_FILES = 2000;
const MAX_MAX_FILES = 10000;
const CATEGORIAS_INCREMENTAIS = new Set([
  "sessoes",
  "resets",
  "temporarios",
  "backups",
  "logs",
  "midias",
  "caches"
]);

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

function limitarNumero(valor, padrao, min, max) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.max(min, Math.min(max, Math.floor(numero)));
}

function yieldEventLoop() {
  return new Promise(resolve => setImmediate(resolve));
}

function criarOpcoesIncrementais(opcoes = {}) {
  const timeoutMs = limitarNumero(opcoes.timeoutMs, DEFAULT_INCREMENTAL_TIMEOUT_MS, 1000, MAX_INCREMENTAL_TIMEOUT_MS);
  return {
    dataDir: path.resolve(opcoes.dataDir || DEFAULT_DATA_DIR),
    limit: limitarNumero(opcoes.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    topFiles: limitarNumero(opcoes.topFiles, DEFAULT_TOP_FILES, 1, MAX_TOP_FILES),
    offset: limitarNumero(opcoes.offset, 0, 0, Number.MAX_SAFE_INTEGER),
    timeoutMs,
    deadlineMs: opcoes.deadlineMs || Date.now() + timeoutMs,
    maxFiles: limitarNumero(opcoes.maxFiles, DEFAULT_MAX_FILES, 1, MAX_MAX_FILES),
    recentMinutes: limitarNumero(opcoes.recentMinutes, 30, 1, 1440)
  };
}

function encodeCursor(offset) {
  if (!Number.isFinite(Number(offset))) return null;
  return Buffer.from(JSON.stringify({ offset: Number(offset) }), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return 0;
  try {
    const payload = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (!Number.isFinite(Number(payload.offset)) || Number(payload.offset) < 0) {
      throw new Error("offset_invalido");
    }
    return limitarNumero(payload.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  } catch {
    const erro = new Error("cursor_storage_invalido");
    erro.codigo = "cursor_storage_invalido";
    erro.statusCode = 400;
    throw erro;
  }
}

function erroSanitizado(dataDir, caminho, erro) {
  return {
    caminho: sanitizarCaminho(dataDir, caminho),
    erro: erro?.code || erro?.message || "erro_desconhecido"
  };
}

function criarRespostaIncremental(inicioMs, opcoes, dados) {
  return {
    ok: true,
    modo: "somente_leitura",
    aplicouMudancas: false,
    parcial: Boolean(dados.parcial || dados.timeoutAtingido || dados.limiteArquivosAtingido),
    totalConhecido: dados.totalConhecido ?? null,
    processados: dados.processados || 0,
    nextCursor: dados.nextCursor || null,
    duracaoMs: Date.now() - inicioMs,
    timeoutMs: opcoes.timeoutMs,
    timeoutAtingido: Boolean(dados.timeoutAtingido),
    limiteArquivosAtingido: Boolean(dados.limiteArquivosAtingido),
    errosSanitizados: dados.errosSanitizados || [],
    ...dados.payload
  };
}

function deadlineAtingido(opcoes) {
  return Boolean(opcoes.deadlineMs && Date.now() > opcoes.deadlineMs);
}

async function listarDiretorioSeguro(dataDir, dir) {
  try {
    const entradas = await fs.promises.readdir(dir, { withFileTypes: true });
    entradas.sort((a, b) => a.name.localeCompare(b.name));
    return { entradas, erro: null };
  } catch (erro) {
    return { entradas: [], erro: erroSanitizado(dataDir, dir, erro) };
  }
}

async function statSeguro(dataDir, caminho) {
  try {
    return { stats: await fs.promises.lstat(caminho), erro: null };
  } catch (erro) {
    return { stats: null, erro: erroSanitizado(dataDir, caminho, erro) };
  }
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

function criarErroStorage(codigo, statusCode = 400) {
  const erro = new Error(codigo);
  erro.codigo = codigo;
  erro.statusCode = statusCode;
  return erro;
}

function resolverArquivoFilaBak(dataDir, caminhoEntrada = "") {
  const base = path.resolve(dataDir || DEFAULT_DATA_DIR);
  const bruto = String(caminhoEntrada || "").trim();
  if (!bruto) throw criarErroStorage("arquivo_obrigatorio");

  const semData = bruto.replace(/^\/data[\\/]/i, "");
  const absoluto = path.resolve(base, semData);
  const rel = path.relative(base, absoluto).replace(/\\/g, "/");

  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw criarErroStorage("arquivo_fora_data");
  }
  if (!/^clientes\/[A-Za-z0-9_-]+\/fila\.json\.bak$/.test(rel)) {
    throw criarErroStorage("arquivo_nao_autorizado");
  }
  if (SENSIVEL_RE.test(rel.replace(/^clientes\/[^/]+\//, ""))) {
    throw criarErroStorage("arquivo_sensivel_bloqueado");
  }

  return {
    absoluto,
    principal: absoluto.replace(/\.bak$/i, ""),
    rel,
    caminho: `/data/${rel.split("/").map(sanitizarSegmento).join("/")}`
  };
}

function lerJsonArquivoValido(caminho) {
  try {
    JSON.parse(fs.readFileSync(caminho, "utf8"));
    return true;
  } catch {
    return false;
  }
}

async function arquivoEstavel(caminho, fsImpl = fs, delayMs = 50) {
  const antes = fsImpl.statSync(caminho);
  await new Promise(resolve => setTimeout(resolve, delayMs));
  const depois = fsImpl.statSync(caminho);
  return Number(antes.size || 0) === Number(depois.size || 0) &&
    Number(antes.mtimeMs || 0) === Number(depois.mtimeMs || 0);
}

async function validarFilaBakParaRemocao(dataDir, caminhoEntrada, opcoes = {}) {
  const fsImpl = opcoes.fs || fs;
  const arquivo = resolverArquivoFilaBak(dataDir, caminhoEntrada);
  const resultado = {
    arquivo: arquivo.caminho,
    caminho: arquivo.caminho,
    tipo: "fila_json_bak",
    elegivel: false,
    motivo: "",
    tamanhoBytes: 0,
    tamanho: bytesLegiveis(0),
    principal: sanitizarCaminho(path.resolve(dataDir || DEFAULT_DATA_DIR), arquivo.principal),
    principalExiste: false,
    principalValido: false,
    backupMaisAntigoOuIgual: false,
    arquivoEstavel: false
  };

  let backupStat;
  let principalStat;
  try {
    backupStat = fsImpl.lstatSync(arquivo.absoluto);
  } catch {
    return { ...resultado, motivo: "backup_ausente" };
  }

  if (!backupStat.isFile() || backupStat.isSymbolicLink()) {
    return { ...resultado, motivo: "backup_nao_e_arquivo_regular" };
  }

  resultado.tamanhoBytes = Number(backupStat.size || 0);
  resultado.tamanho = bytesLegiveis(resultado.tamanhoBytes);
  resultado.modificadoEm = backupStat.mtimeMs ? new Date(backupStat.mtimeMs).toISOString() : null;

  try {
    principalStat = fsImpl.lstatSync(arquivo.principal);
  } catch {
    return { ...resultado, motivo: "principal_ausente" };
  }

  resultado.principalExiste = true;
  if (!principalStat.isFile() || principalStat.isSymbolicLink()) {
    return { ...resultado, motivo: "principal_nao_e_arquivo_regular" };
  }

  resultado.principalValido = lerJsonArquivoValido(arquivo.principal);
  if (!resultado.principalValido) {
    return { ...resultado, motivo: "principal_json_invalido" };
  }

  resultado.backupMaisAntigoOuIgual = Number(backupStat.mtimeMs || 0) <= Number(principalStat.mtimeMs || 0);
  if (!resultado.backupMaisAntigoOuIgual) {
    return { ...resultado, motivo: "backup_mais_novo_que_principal" };
  }

  try {
    resultado.arquivoEstavel = await arquivoEstavel(arquivo.absoluto, fsImpl, opcoes.estabilidadeDelayMs || 50);
  } catch {
    return { ...resultado, motivo: "backup_indisponivel_na_revalidacao" };
  }

  if (!resultado.arquivoEstavel) {
    return { ...resultado, motivo: "backup_em_uso_ou_em_escrita" };
  }

  return { ...resultado, elegivel: true, motivo: "backup_validado_para_remocao", _absoluto: arquivo.absoluto, _principal: arquivo.principal };
}

async function executarLimpezaFilaBakControlada(opcoes = {}) {
  const dataDir = path.resolve(opcoes.dataDir || DEFAULT_DATA_DIR);
  const arquivosEntrada = Array.isArray(opcoes.arquivos) ? opcoes.arquivos : [];
  const fsImpl = opcoes.fs || fs;
  const limite = Math.max(1, Math.min(100, Number(opcoes.limite || arquivosEntrada.length || 1)));
  const arquivos = arquivosEntrada.slice(0, limite);
  const dryRun = Boolean(opcoes.dryRun);
  const logger = opcoes.logger || null;
  const inicio = Date.now();
  const removidos = [];
  const simulados = [];
  const protegidos = [];
  const erros = [];
  const logsOperacionais = [];
  let bytesLiberados = 0;
  let bytesLiberaveisDryRun = 0;
  let espacoAtual = obterEspacoVolume(dataDir);

  function registrarLog(evento) {
    const log = {
      ts: new Date().toISOString(),
      escopo: "limpeza_fila_json_bak",
      dryRun,
      ...evento
    };
    logsOperacionais.push(log);
    if (logger && typeof logger.info === "function") {
      logger.info("[storage-cleanup]", log);
    }
  }

  registrarLog({
    evento: "inicio",
    totalSolicitado: arquivosEntrada.length,
    totalProcessado: arquivos.length
  });

  for (let indice = 0; indice < arquivos.length; indice += 1) {
    const entrada = arquivos[indice];
    let validacao;
    try {
      validacao = await validarFilaBakParaRemocao(dataDir, entrada, { fs: fsImpl, estabilidadeDelayMs: opcoes.estabilidadeDelayMs });
      if (!validacao.elegivel) {
        const protegido = {
          arquivo: validacao.arquivo,
          tipo: "fila_json_bak",
          tamanhoBytes: validacao.tamanhoBytes,
          tamanho: validacao.tamanho,
          motivo: validacao.motivo,
          removido: false,
          espacoDepois: espacoAtual
        };
        protegidos.push(protegido);
        registrarLog({
          evento: "protegido",
          indice,
          arquivo: protegido.arquivo,
          tamanhoBytes: protegido.tamanhoBytes,
          motivo: protegido.motivo
        });
        continue;
      }

      if (dryRun) {
        const simulado = {
          arquivo: validacao.arquivo,
          tipo: "fila_json_bak",
          tamanhoBytes: validacao.tamanhoBytes,
          tamanho: validacao.tamanho,
          removido: false,
          dryRun: true,
          motivo: "dry_run_backup_validado",
          principalIntegroDepois: true,
          espacoDepois: espacoAtual
        };
        simulados.push(simulado);
        bytesLiberaveisDryRun += Number(validacao.tamanhoBytes || 0);
        registrarLog({
          evento: "dry_run_validado",
          indice,
          arquivo: simulado.arquivo,
          tamanhoBytes: simulado.tamanhoBytes,
          motivo: simulado.motivo
        });
        continue;
      }

      fsImpl.unlinkSync(validacao._absoluto);
      const principalIntegroDepois = lerJsonArquivoValido(validacao._principal);
      espacoAtual = obterEspacoVolume(dataDir);
      const item = {
        arquivo: validacao.arquivo,
        tipo: "fila_json_bak",
        tamanhoBytes: validacao.tamanhoBytes,
        tamanho: validacao.tamanho,
        removido: true,
        motivo: "removido_backup_validado",
        principalIntegroDepois,
        espacoDepois: espacoAtual
      };
      if (!principalIntegroDepois) {
        item.alerta = "principal_invalido_apos_remocao";
      }
      removidos.push(item);
      bytesLiberados += Number(validacao.tamanhoBytes || 0);
      registrarLog({
        evento: "removido",
        indice,
        arquivo: item.arquivo,
        tamanhoBytes: item.tamanhoBytes,
        principalIntegroDepois
      });
    } catch (erro) {
      const itemErro = {
        indice,
        arquivo: "[entrada_rejeitada]",
        tipo: "fila_json_bak",
        removido: false,
        motivo: erro.codigo || erro.message || "erro_remocao",
        espacoDepois: espacoAtual
      };
      erros.push(itemErro);
      registrarLog({
        evento: "erro",
        indice,
        arquivo: itemErro.arquivo,
        motivo: itemErro.motivo
      });
    }
  }

  registrarLog({
    evento: "fim",
    removidos: removidos.length,
    simulados: simulados.length,
    protegidos: protegidos.length,
    erros: erros.length,
    bytesLiberados,
    bytesLiberaveisDryRun
  });

  return {
    ok: true,
    modo: dryRun ? "dry_run_controlado" : "execute_controlado",
    dryRun,
    aplicouMudancas: !dryRun && removidos.length > 0,
    duracaoMs: Date.now() - inicio,
    totalSolicitado: arquivosEntrada.length,
    totalProcessado: arquivos.length,
    removidos,
    simulados,
    protegidos,
    erros,
    logsOperacionais,
    bytesLiberados,
    espacoLiberado: bytesLegiveis(bytesLiberados),
    bytesLiberaveisDryRun,
    espacoLiberavelDryRun: bytesLegiveis(bytesLiberaveisDryRun),
    espacoFinal: espacoAtual,
    seguranca: {
      somenteFilaJsonBak: true,
      naoRemoveFilaPrincipal: true,
      naoTocaAuthSessao: true,
      naoTocaConfigCredencialDestinoIntegracao: true,
      naoTocaSocialMidia: true,
      naoTocaResetEsteiras: true,
      revalidouAntesDeCadaRemocao: true,
      removeuUmArquivoPorVez: true
    }
  };
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

async function resumirDiretorioLimitado(dataDir, dir, opcoes) {
  const pilha = [dir];
  const resumo = {
    tamanhoBytes: 0,
    arquivos: 0,
    diretorios: 0,
    ultimaModificacaoMs: 0,
    maioresArquivos: [],
    errosSanitizados: [],
    processados: 0,
    timeoutAtingido: false,
    limiteArquivosAtingido: false
  };

  while (pilha.length) {
    if (deadlineAtingido(opcoes)) {
      resumo.timeoutAtingido = true;
      break;
    }
    if (resumo.processados >= opcoes.maxFiles) {
      resumo.limiteArquivosAtingido = true;
      break;
    }

    const atual = pilha.pop();
    const { stats, erro } = await statSeguro(dataDir, atual);
    if (erro) {
      resumo.errosSanitizados.push(erro);
      continue;
    }
    if (!stats || stats.isSymbolicLink()) continue;

    resumo.processados += 1;
    resumo.ultimaModificacaoMs = Math.max(resumo.ultimaModificacaoMs, stats.mtimeMs || 0);

    if (stats.isDirectory()) {
      resumo.diretorios += 1;
      const listado = await listarDiretorioSeguro(dataDir, atual);
      if (listado.erro) {
        resumo.errosSanitizados.push(listado.erro);
      } else {
        for (const entrada of listado.entradas) pilha.push(path.join(atual, entrada.name));
      }
    } else if (stats.isFile()) {
      resumo.arquivos += 1;
      resumo.tamanhoBytes += stats.size;
      resumo.maioresArquivos.push({
        caminho: atual,
        tamanhoBytes: stats.size,
        modificadoEm: stats.mtimeMs,
        categoria: categoriaArquivo(dataDir, atual, stats),
        extensao: path.extname(atual).toLowerCase() || "[sem_extensao]"
      });
      resumo.maioresArquivos.sort((a, b) => b.tamanhoBytes - a.tamanhoBytes);
      if (resumo.maioresArquivos.length > opcoes.topFiles) resumo.maioresArquivos.length = opcoes.topFiles;
    }

    if (resumo.processados % 100 === 0) await yieldEventLoop();
  }

  return {
    tamanhoBytes: resumo.tamanhoBytes,
    tamanho: bytesLegiveis(resumo.tamanhoBytes),
    arquivos: resumo.arquivos,
    diretorios: resumo.diretorios,
    ultimaModificacaoEm: resumo.ultimaModificacaoMs ? new Date(resumo.ultimaModificacaoMs).toISOString() : null,
    maioresArquivos: resumo.maioresArquivos.map(arquivo => criarResumoArquivo(dataDir, arquivo)),
    errosSanitizados: resumo.errosSanitizados,
    processados: resumo.processados,
    parcial: resumo.timeoutAtingido || resumo.limiteArquivosAtingido,
    timeoutAtingido: resumo.timeoutAtingido,
    limiteArquivosAtingido: resumo.limiteArquivosAtingido
  };
}

async function auditarDiretoriosPrimeiroNivel(opcoesEntrada = {}) {
  const inicioMs = Date.now();
  const opcoes = criarOpcoesIncrementais({ ...opcoesEntrada, offset: decodeCursor(opcoesEntrada.cursor) });
  const dataDir = opcoes.dataDir;
  const errosSanitizados = [];
  const { entradas, erro } = await listarDiretorioSeguro(dataDir, dataDir);
  if (erro) errosSanitizados.push(erro);

  const diretorios = entradas
    .filter(entrada => entrada.isDirectory())
    .map(entrada => entrada.name)
    .sort((a, b) => a.localeCompare(b));
  const selecionados = diretorios.slice(opcoes.offset, opcoes.offset + opcoes.limit);
  const itens = [];
  let processados = 0;
  let timeoutAtingido = false;
  let limiteArquivosAtingido = false;

  for (const nome of selecionados) {
    if (deadlineAtingido(opcoes)) {
      timeoutAtingido = true;
      break;
    }
    const dir = path.join(dataDir, nome);
    const resumo = await resumirDiretorioLimitado(dataDir, dir, opcoes);
    processados += 1;
    timeoutAtingido = timeoutAtingido || resumo.timeoutAtingido;
    limiteArquivosAtingido = limiteArquivosAtingido || resumo.limiteArquivosAtingido;
    errosSanitizados.push(...resumo.errosSanitizados);
    itens.push({
      nome: sanitizarSegmento(nome),
      caminho: sanitizarCaminho(dataDir, dir),
      tamanhoBytes: resumo.tamanhoBytes,
      tamanho: resumo.tamanho,
      arquivos: resumo.arquivos,
      diretorios: resumo.diretorios,
      ultimaModificacaoEm: resumo.ultimaModificacaoEm,
      parcial: resumo.parcial
    });
    await yieldEventLoop();
  }

  const proximoOffset = opcoes.offset + processados;
  return criarRespostaIncremental(inicioMs, opcoes, {
    totalConhecido: diretorios.length,
    processados,
    nextCursor: proximoOffset < diretorios.length ? encodeCursor(proximoOffset) : null,
    timeoutAtingido,
    limiteArquivosAtingido,
    errosSanitizados,
    payload: { diretorios: itens }
  });
}

async function listarWorkspaceIds(dataDir) {
  const clientesDir = path.join(dataDir, "clientes");
  const listado = await listarDiretorioSeguro(dataDir, clientesDir);
  return listado.entradas
    .filter(entrada => entrada.isDirectory())
    .map(entrada => entrada.name)
    .sort((a, b) => a.localeCompare(b));
}

function validarWorkspaceId(workspaceId) {
  const id = String(workspaceId || "").trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
    const erro = new Error("workspace_id_invalido");
    erro.codigo = "workspace_id_invalido";
    erro.statusCode = 400;
    throw erro;
  }
  return id;
}

async function auditarWorkspaces(opcoesEntrada = {}) {
  const inicioMs = Date.now();
  const opcoes = criarOpcoesIncrementais({ ...opcoesEntrada, offset: decodeCursor(opcoesEntrada.cursor) });
  const dataDir = opcoes.dataDir;
  const workspaceIds = await listarWorkspaceIds(dataDir);
  const selecionados = workspaceIds.slice(opcoes.offset, opcoes.offset + opcoes.limit);
  const itens = [];
  const errosSanitizados = [];
  let processados = 0;
  let timeoutAtingido = false;
  let limiteArquivosAtingido = false;

  for (const workspaceId of selecionados) {
    if (deadlineAtingido(opcoes)) {
      timeoutAtingido = true;
      break;
    }
    const workspaceDir = path.join(dataDir, "clientes", workspaceId);
    const filaPath = path.join(workspaceDir, "fila.json");
    const resumo = await resumirDiretorioLimitado(dataDir, workspaceDir, opcoes);
    const filaStat = await statSeguro(dataDir, filaPath);
    processados += 1;
    timeoutAtingido = timeoutAtingido || resumo.timeoutAtingido;
    limiteArquivosAtingido = limiteArquivosAtingido || resumo.limiteArquivosAtingido;
    errosSanitizados.push(...resumo.errosSanitizados);
    if (filaStat.erro && filaStat.erro.erro !== "ENOENT") errosSanitizados.push(filaStat.erro);
    itens.push({
      workspaceId,
      tamanhoBytes: resumo.tamanhoBytes,
      tamanho: resumo.tamanho,
      tamanhoFilaBytes: filaStat.stats?.isFile() ? filaStat.stats.size : 0,
      tamanhoFila: bytesLegiveis(filaStat.stats?.isFile() ? filaStat.stats.size : 0),
      arquivos: resumo.arquivos,
      diretorios: resumo.diretorios,
      ultimaModificacaoEm: resumo.ultimaModificacaoEm,
      parcial: resumo.parcial
    });
    await yieldEventLoop();
  }

  const proximoOffset = opcoes.offset + processados;
  return criarRespostaIncremental(inicioMs, opcoes, {
    totalConhecido: workspaceIds.length,
    processados,
    nextCursor: proximoOffset < workspaceIds.length ? encodeCursor(proximoOffset) : null,
    timeoutAtingido,
    limiteArquivosAtingido,
    errosSanitizados,
    payload: { workspaces: itens }
  });
}

function criarResumoFilaVazio(workspaceId, stats = null) {
  return {
    workspaceId,
    totalItens: 0,
    tamanhoFilaBytes: stats?.size || 0,
    tamanhoFila: bytesLegiveis(stats?.size || 0),
    enviadosHistorico: 0,
    pendentesRecentes: 0,
    pendentesVencidos: 0,
    finais: 0,
    processando: 0,
    semTimestamp: 0,
    statusDesconhecido: 0,
    statusReais: {},
    marketplaces: {},
    destinos: {},
    timestampCampos: {},
    idadesMs: []
  };
}

function finalizarResumoFila(ws) {
  const idades = [...ws.idadesMs].sort((a, b) => a - b);
  const percentil = (p) => {
    if (!idades.length) return null;
    const idx = Math.min(idades.length - 1, Math.max(0, Math.ceil((p / 100) * idades.length) - 1));
    return idades[idx];
  };
  const media = idades.length ? Math.round(idades.reduce((soma, valor) => soma + valor, 0) / idades.length) : null;
  delete ws.idadesMs;
  return {
    ...ws,
    idadeMinimaMs: idades[0] ?? null,
    idadeMediaMs: media,
    idadeMedianaMs: percentil(50),
    idadeP95Ms: percentil(95),
    idadeMaximaMs: idades[idades.length - 1] ?? null,
    espacoEstimadoResetEsteirasBytes: ws.pendentesVencidos ? Math.round((ws.tamanhoFilaBytes / Math.max(1, ws.totalItens)) * ws.pendentesVencidos) : 0,
    espacoEstimadoHistoricoLeveBytes: ws.enviadosHistorico ? Math.round((ws.tamanhoFilaBytes / Math.max(1, ws.totalItens)) * ws.enviadosHistorico * 0.7) : 0
  };
}

async function resumirFilaWorkspace(dataDir, workspaceId, opcoes) {
  const filaPath = path.join(dataDir, "clientes", workspaceId, "fila.json");
  const { stats, erro } = await statSeguro(dataDir, filaPath);
  if (erro || !stats?.isFile()) {
    return { erro: erro || { caminho: sanitizarCaminho(dataDir, filaPath), erro: "fila_json_ausente" }, resumo: null };
  }

  let fila;
  try {
    const texto = await fs.promises.readFile(filaPath, "utf8");
    fila = JSON.parse(texto);
  } catch (erroLeitura) {
    return { erro: erroSanitizado(dataDir, filaPath, erroLeitura), resumo: null };
  }
  if (!Array.isArray(fila)) {
    return { erro: { caminho: sanitizarCaminho(dataDir, filaPath), erro: "fila_json_invalido" }, resumo: null };
  }

  const agoraMs = Date.now();
  const recenteMs = opcoes.recentMinutes * 60 * 1000;
  const ws = criarResumoFilaVazio(workspaceId, stats);
  ws.totalItens = fila.length;

  let indiceItem = 0;
  for (const item of fila) {
    indiceItem += 1;
    if (deadlineAtingido(opcoes)) {
      ws.timeoutAtingido = true;
      break;
    }
    const classificacao = classificarItemFila(item, agoraMs, recenteMs);
    ws[classificacao.grupo] += 1;
    ws.statusReais[classificacao.status] = (ws.statusReais[classificacao.status] || 0) + 1;
    const marketplace = item?.marketplace || item?.origemMarketplace || item?.metadata?.produto?.marketplace || "[ausente]";
    const destino = item?.destino || item?.canal || item?.tipoDestino || item?.metadata?.destino || "[ausente]";
    ws.marketplaces[marketplace] = (ws.marketplaces[marketplace] || 0) + 1;
    ws.destinos[destino] = (ws.destinos[destino] || 0) + 1;
    const campo = classificacao.timestampCampo || "[sem_timestamp]";
    ws.timestampCampos[campo] = (ws.timestampCampos[campo] || 0) + 1;
    if (Number.isFinite(classificacao.idadeMs)) ws.idadesMs.push(classificacao.idadeMs);
    if (indiceItem % 500 === 0) await yieldEventLoop();
  }

  return { erro: null, resumo: finalizarResumoFila(ws) };
}

async function auditarWorkspaceIndividual(workspaceIdEntrada, opcoesEntrada = {}) {
  const inicioMs = Date.now();
  const opcoes = criarOpcoesIncrementais(opcoesEntrada);
  const dataDir = opcoes.dataDir;
  const workspaceId = validarWorkspaceId(workspaceIdEntrada);
  const ids = await listarWorkspaceIds(dataDir);
  if (!ids.includes(workspaceId)) {
    const erro = new Error("workspace_nao_encontrado");
    erro.codigo = "workspace_nao_encontrado";
    erro.statusCode = 404;
    throw erro;
  }

  const workspaceDir = path.join(dataDir, "clientes", workspaceId);
  const resumoDir = await resumirDiretorioLimitado(dataDir, workspaceDir, opcoes);
  const fila = await resumirFilaWorkspace(dataDir, workspaceId, opcoes);
  const errosSanitizados = [...resumoDir.errosSanitizados];
  if (fila.erro) errosSanitizados.push(fila.erro);

  return criarRespostaIncremental(inicioMs, opcoes, {
    totalConhecido: 1,
    processados: 1,
    timeoutAtingido: resumoDir.timeoutAtingido || Boolean(fila.resumo?.timeoutAtingido),
    limiteArquivosAtingido: resumoDir.limiteArquivosAtingido,
    errosSanitizados,
    payload: {
      workspace: {
        workspaceId,
        caminho: `/data/clientes/${workspaceId}`,
        tamanhoBytes: resumoDir.tamanhoBytes,
        tamanho: resumoDir.tamanho,
        arquivos: resumoDir.arquivos,
        diretorios: resumoDir.diretorios,
        ultimaModificacaoEm: resumoDir.ultimaModificacaoEm,
        maioresArquivos: resumoDir.maioresArquivos,
        fila: fila.resumo,
        potencialRecuperavel: fila.resumo ? {
          resetEsteirasBytes: fila.resumo.espacoEstimadoResetEsteirasBytes,
          resetEsteiras: bytesLegiveis(fila.resumo.espacoEstimadoResetEsteirasBytes),
          historicoLeveBytes: fila.resumo.espacoEstimadoHistoricoLeveBytes,
          historicoLeve: bytesLegiveis(fila.resumo.espacoEstimadoHistoricoLeveBytes)
        } : null
      }
    }
  });
}

async function auditarFilasIncremental(opcoesEntrada = {}) {
  const inicioMs = Date.now();
  const opcoes = criarOpcoesIncrementais({ ...opcoesEntrada, offset: decodeCursor(opcoesEntrada.cursor), maxFiles: 100 });
  const dataDir = opcoes.dataDir;
  const workspaceIds = await listarWorkspaceIds(dataDir);
  const selecionados = workspaceIds.slice(opcoes.offset, opcoes.offset + opcoes.limit);
  const filas = [];
  const errosSanitizados = [];
  let processados = 0;
  let timeoutAtingido = false;

  for (const workspaceId of selecionados) {
    if (deadlineAtingido(opcoes)) {
      timeoutAtingido = true;
      break;
    }
    const resultado = await resumirFilaWorkspace(dataDir, workspaceId, opcoes);
    processados += 1;
    if (resultado.erro) errosSanitizados.push(resultado.erro);
    if (resultado.resumo) {
      timeoutAtingido = timeoutAtingido || Boolean(resultado.resumo.timeoutAtingido);
      filas.push(resultado.resumo);
    }
    await yieldEventLoop();
  }

  const proximoOffset = opcoes.offset + processados;
  return criarRespostaIncremental(inicioMs, opcoes, {
    totalConhecido: workspaceIds.length,
    processados,
    nextCursor: proximoOffset < workspaceIds.length ? encodeCursor(proximoOffset) : null,
    timeoutAtingido,
    errosSanitizados,
    payload: { filas }
  });
}

async function auditarCompactacaoFilaWorkspace(dataDir, workspaceIdEntrada, opcoesEntrada = {}) {
  const workspaceId = validarWorkspaceId(workspaceIdEntrada);
  const filaPath = path.join(dataDir, "clientes", workspaceId, "fila.json");
  const { stats, erro } = await statSeguro(dataDir, filaPath);
  if (erro || !stats?.isFile()) {
    return {
      workspaceId,
      ok: false,
      erro: erro?.erro || "fila_json_ausente",
      aplicouMudancas: false
    };
  }

  let textoFila = "";
  let fila = null;
  try {
    textoFila = await fs.promises.readFile(filaPath, "utf8");
    fila = JSON.parse(textoFila);
  } catch (erroLeitura) {
    return {
      workspaceId,
      ok: false,
      erro: erroLeitura.code || "fila_json_invalido",
      aplicouMudancas: false
    };
  }

  if (!Array.isArray(fila)) {
    return { workspaceId, ok: false, erro: "fila_json_invalido", aplicouMudancas: false };
  }

  const agoraMs = Number(opcoesEntrada.agoraMs || Date.now());
  const analise = filaHistoricoPolicy.analisarFilaHistorico(fila, { agoraMs });
  const espaco = obterEspacoVolume(dataDir);
  const margemTemporarioBytes = Number(stats.size || 0) + Math.max(4096, Math.ceil(Number(stats.size || 0) * 0.05));
  const margemSuficienteParaExecucaoReal = espaco.ok === true && Number(espaco.livreBytes || 0) > margemTemporarioBytes;
  const amostras = analise.itens
    .filter(item => item.acao !== "preservar_integral")
    .slice(0, 10)
    .map((item, indice) => ({
      indice,
      acao: item.acao,
      status: item.status,
      motivo: item.motivo,
      idadeMs: item.idadeMs,
      tamanhoOriginalBytes: item.tamanhoOriginalBytes,
      tamanhoEstimadoBytes: item.tamanhoEstimadoBytes,
      bytesRecuperaveis: item.bytesRecuperaveis
    }));

  return {
    workspaceId,
    ok: true,
    modo: "dry_run",
    aplicouMudancas: false,
    politicaCentral: "fila_historico_policy_v1",
    caminho: `/data/clientes/${workspaceId}/fila.json`,
    hashFila: hashArquivoSeguro(filaPath),
    totalItens: fila.length,
    tamanhoFilaBytes: Number(stats.size || 0),
    tamanhoFila: bytesLegiveis(stats.size || 0),
    tamanhoJsonEstimadoAntesBytes: analise.resumo.tamanhoJsonEstimadoAntesBytes,
    tamanhoJsonEstimadoDepoisBytes: analise.resumo.tamanhoJsonEstimadoDepoisBytes,
    tamanhoJsonEstimadoDepois: bytesLegiveis(analise.resumo.tamanhoJsonEstimadoDepoisBytes),
    bytesRecuperaveis: analise.resumo.bytesRecuperaveisJson,
    espacoRecuperavel: bytesLegiveis(analise.resumo.bytesRecuperaveisJson),
    integrais: analise.resumo.integrais,
    compactaveis: analise.resumo.compactaveis,
    removiveis: analise.resumo.removiveis,
    protegidos: analise.resumo.protegidos,
    totalApos: analise.resumo.totalApos,
    motivos: analise.resumo.motivos,
    espacoAtual: espaco,
    margemTemporarioBytes,
    margemTemporario: bytesLegiveis(margemTemporarioBytes),
    margemSuficienteParaExecucaoReal,
    motivoExecucaoReal: margemSuficienteParaExecucaoReal ? "margem_temporario_ok" : "sem_margem_para_tmp_atomico",
    amostras,
    seguranca: {
      dryRun: true,
      naoGravou: true,
      naoRemoveu: true,
      naoCompactou: true,
      processouUmWorkspace: true,
      preservaFilaViva: true,
      usaPoliticaCentral: true,
      exigeEscritaAtomicaNaExecucaoReal: true
    }
  };
}

async function auditarCompactacaoFilas(opcoesEntrada = {}) {
  const inicioMs = Date.now();
  const opcoes = criarOpcoesIncrementais({ ...opcoesEntrada, offset: decodeCursor(opcoesEntrada.cursor), limit: 1 });
  const dataDir = opcoes.dataDir;
  const workspaceIdFiltro = String(opcoesEntrada.workspaceId || "").trim();
  const workspaceIds = workspaceIdFiltro ? [validarWorkspaceId(workspaceIdFiltro)] : await listarWorkspaceIds(dataDir);
  const selecionados = workspaceIds.slice(opcoes.offset, opcoes.offset + 1);
  const workspaces = [];
  const errosSanitizados = [];
  let processados = 0;

  for (const workspaceId of selecionados) {
    const resultado = await auditarCompactacaoFilaWorkspace(dataDir, workspaceId, opcoesEntrada);
    processados += 1;
    if (resultado.ok === false) errosSanitizados.push({ workspaceId, erro: resultado.erro || "erro_compactacao_dry_run" });
    workspaces.push(resultado);
    await yieldEventLoop();
  }

  const totais = workspaces.reduce((acc, item) => {
    if (item.ok === false) return acc;
    acc.totalItens += Number(item.totalItens || 0);
    acc.integrais += Number(item.integrais || 0);
    acc.compactaveis += Number(item.compactaveis || 0);
    acc.removiveis += Number(item.removiveis || 0);
    acc.protegidos += Number(item.protegidos || 0);
    acc.bytesRecuperaveis += Number(item.bytesRecuperaveis || 0);
    acc.tamanhoFilaBytes += Number(item.tamanhoFilaBytes || 0);
    return acc;
  }, { totalItens: 0, integrais: 0, compactaveis: 0, removiveis: 0, protegidos: 0, bytesRecuperaveis: 0, tamanhoFilaBytes: 0 });
  totais.espacoRecuperavel = bytesLegiveis(totais.bytesRecuperaveis);
  totais.tamanhoFilas = bytesLegiveis(totais.tamanhoFilaBytes);

  const proximoOffset = workspaceIdFiltro ? null : opcoes.offset + processados;
  return criarRespostaIncremental(inicioMs, opcoes, {
    totalConhecido: workspaceIds.length,
    processados,
    nextCursor: !workspaceIdFiltro && proximoOffset < workspaceIds.length ? encodeCursor(proximoOffset) : null,
    timeoutAtingido: false,
    errosSanitizados,
    payload: {
      modo: "dry_run",
      aplicouMudancas: false,
      politicaCentral: "fila_historico_policy_v1",
      totais,
      workspaces
    }
  });
}

function categoriaIncrementalParaInterna(categoria) {
  const valor = String(categoria || "").toLowerCase().trim();
  if (!CATEGORIAS_INCREMENTAIS.has(valor)) {
    const erro = new Error("categoria_storage_invalida");
    erro.codigo = "categoria_storage_invalida";
    erro.statusCode = 400;
    throw erro;
  }
  const mapa = {
    sessoes: CATEGORIAS_STORAGE.SESSOES,
    resets: CATEGORIAS_STORAGE.SNAPSHOTS,
    temporarios: CATEGORIAS_STORAGE.TEMPORARIOS,
    backups: CATEGORIAS_STORAGE.BACKUPS,
    logs: CATEGORIAS_STORAGE.LOGS,
    midias: CATEGORIAS_STORAGE.MIDIAS,
    caches: CATEGORIAS_STORAGE.CACHES
  };
  return mapa[valor];
}

async function auditarCategoriaIncremental(categoriaEntrada, opcoesEntrada = {}) {
  const inicioMs = Date.now();
  const categoriaInterna = categoriaIncrementalParaInterna(categoriaEntrada);
  const opcoes = criarOpcoesIncrementais({ ...opcoesEntrada, offset: decodeCursor(opcoesEntrada.cursor) });
  const dataDir = opcoes.dataDir;
  const pilha = [dataDir];
  const errosSanitizados = [];
  const encontrados = [];
  let visitados = 0;
  let timeoutAtingido = false;
  let limiteArquivosAtingido = false;

  while (pilha.length && encontrados.length < opcoes.offset + opcoes.limit) {
    if (deadlineAtingido(opcoes)) {
      timeoutAtingido = true;
      break;
    }
    if (visitados >= opcoes.maxFiles) {
      limiteArquivosAtingido = true;
      break;
    }
    const atual = pilha.pop();
    const { stats, erro } = await statSeguro(dataDir, atual);
    if (erro) {
      errosSanitizados.push(erro);
      continue;
    }
    if (!stats || stats.isSymbolicLink()) continue;
    visitados += 1;
    if (stats.isDirectory()) {
      const listado = await listarDiretorioSeguro(dataDir, atual);
      if (listado.erro) errosSanitizados.push(listado.erro);
      else for (const entrada of listado.entradas.reverse()) pilha.push(path.join(atual, entrada.name));
    } else if (stats.isFile() && categoriaArquivo(dataDir, atual, stats) === categoriaInterna) {
      encontrados.push(criarResumoArquivo(dataDir, {
        caminho: atual,
        tamanhoBytes: stats.size,
        modificadoEm: stats.mtimeMs,
        categoria: categoriaInterna,
        extensao: path.extname(atual).toLowerCase() || "[sem_extensao]"
      }));
    }
    if (visitados % 100 === 0) await yieldEventLoop();
  }

  const itens = encontrados.slice(opcoes.offset, opcoes.offset + opcoes.limit);
  const proximoOffset = encontrados.length > opcoes.offset + itens.length || pilha.length
    ? opcoes.offset + itens.length
    : null;
  const tamanhoBytes = itens.reduce((soma, item) => soma + item.tamanhoBytes, 0);
  return criarRespostaIncremental(inicioMs, opcoes, {
    totalConhecido: null,
    processados: visitados,
    nextCursor: proximoOffset === null ? null : encodeCursor(proximoOffset),
    timeoutAtingido,
    limiteArquivosAtingido,
    errosSanitizados,
    payload: {
      categoria: String(categoriaEntrada || "").toLowerCase().trim(),
      tamanhoPaginaBytes: tamanhoBytes,
      tamanhoPagina: bytesLegiveis(tamanhoBytes),
      arquivos: itens
    }
  });
}

module.exports = {
  DEFAULT_DATA_DIR,
  bytesLegiveis,
  sanitizarCaminho,
  obterEspacoVolume,
  validarFilaBakParaRemocao,
  executarLimpezaFilaBakControlada,
  inventariarVolume,
  resumirFilas,
  encodeCursor,
  decodeCursor,
  auditarDiretoriosPrimeiroNivel,
  auditarWorkspaces,
  auditarWorkspaceIndividual,
  auditarFilasIncremental,
  auditarCompactacaoFilas,
  auditarCompactacaoFilaWorkspace,
  auditarCategoriaIncremental
};
