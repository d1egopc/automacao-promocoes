"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  getClienteJsonPath,
  getClientePath,
  readClienteJson,
  writeClienteJson
} = require("../../utils/storage");
const {
  FILA_VIVA_ARQUIVO,
  FILA_LEGADA_ARQUIVO,
  classificarItemFilaV2,
  projetarFilaV2
} = require("./fila-v2-shadow");

const FLAG_OPERACIONAL_ATIVA = "FILA_V2_OPERACIONAL_ATIVA";
const FLAG_2B1_SHADOW_ATIVA = "FILA_V2_2B1_SHADOW_ATIVA";
const HISTORICO_INCREMENTAL_DIR = "fila-historico-incremental";
const TAG_TELEMETRIA = "[FILA-V2-OPERACIONAL]";
const cacheChavesHistorico = new Map();

function texto(valor = "") {
  return String(valor || "").trim();
}

function clienteSeguro(clienteId = "admin") {
  return texto(clienteId || "admin") || "admin";
}

function agoraIso(agora = Date.now()) {
  const ms = Number(agora || Date.now());
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
}

function statusItem(item = {}) {
  return texto(item.status || item.estado || "pendente").toLowerCase();
}

function idItem(item = {}, indice = -1) {
  return texto(
    item.id ||
    item.ofertaId ||
    item.oferta_id ||
    item.engineOfertaId ||
    item.engine_oferta_id ||
    item.idOferta
  ) || `indice:${indice}`;
}

function normalizarEntradaViva(valor = {}, indice = 0, agora = Date.now()) {
  if (valor && typeof valor === "object" && valor.item && typeof valor.item === "object") {
    return {
      posicaoLegada: Number.isInteger(Number(valor.posicaoLegada)) ? Number(valor.posicaoLegada) : indice,
      bucket: valor.bucket || "viva",
      motivoBucket: valor.motivoBucket || "",
      status: valor.status || statusItem(valor.item),
      id: valor.id || idItem(valor.item, indice),
      item: valor.item
    };
  }

  const item = valor && typeof valor === "object" ? valor : {};
  const classificacao = classificarItemFilaV2(item, { agora });
  return {
    posicaoLegada: indice,
    bucket: classificacao.bucket || "viva",
    motivoBucket: classificacao.motivo || "normalizado_operacional",
    status: statusItem(item),
    id: idItem(item, indice),
    item
  };
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function normalizarEntradasViva(valor = [], agora = Date.now()) {
  return lista(valor).map((item, indice) => normalizarEntradaViva(item, indice, agora));
}

function caminhoJsonCliente(clienteId = "admin", arquivo = "", deps = {}) {
  const resolver = deps.getClienteJsonPath || getClienteJsonPath;
  return typeof resolver === "function" ? resolver(clienteSeguro(clienteId), arquivo) : "";
}

function caminhoDirCliente(clienteId = "admin", deps = {}) {
  const resolver = deps.getClientePath || getClientePath;
  if (typeof resolver === "function") return resolver(clienteSeguro(clienteId));
  const filaPath = caminhoJsonCliente(clienteId, FILA_VIVA_ARQUIVO, deps);
  return filaPath ? path.dirname(filaPath) : "";
}

function tamanhoArquivo(file = "", fsImpl = fs) {
  try {
    return file && fsImpl.existsSync(file) ? fsImpl.statSync(file).size : 0;
  } catch {
    return 0;
  }
}

function tamanhoJsonBytes(valor) {
  try {
    return Buffer.byteLength(JSON.stringify(valor), "utf8");
  } catch {
    return 0;
  }
}

function logOperacional(logger = console, payload = {}) {
  try {
    const destino = logger && typeof logger.log === "function" ? logger : console;
    destino.log(TAG_TELEMETRIA, JSON.stringify(payload));
  } catch {}
}

function hashCurto(valor = "") {
  return crypto.createHash("sha1").update(String(valor || "")).digest("hex").slice(0, 12);
}

function lerJsonArquivoDireto(file = "", fallback = null, fsImpl = fs) {
  if (!file) return { ok: false, motivo: "caminho_indisponivel", valor: fallback, bytes: 0 };
  try {
    if (!fsImpl.existsSync(file)) {
      const tmpExiste = fsImpl.existsSync(`${file}.tmp`);
      return {
        ok: false,
        motivo: tmpExiste ? "arquivo_principal_ausente_tmp_presente" : "arquivo_ausente",
        valor: fallback,
        bytes: 0
      };
    }
    const textoArquivo = fsImpl.readFileSync(file, "utf8");
    const bytes = Buffer.byteLength(textoArquivo || "", "utf8");
    if (!textoArquivo.trim()) {
      return { ok: false, motivo: "arquivo_vazio", valor: fallback, bytes };
    }
    const valor = JSON.parse(textoArquivo);
    return { ok: true, motivo: "ok", valor, bytes };
  } catch (erro) {
    return {
      ok: false,
      motivo: "json_corrompido",
      erro: erro?.message || "erro_json",
      valor: fallback,
      bytes: tamanhoArquivo(file, fsImpl)
    };
  }
}

function lerFilaLegada(clienteId = "admin", deps = {}) {
  const leitor = deps.readClienteJson || readClienteJson;
  try {
    const valor = typeof leitor === "function"
      ? leitor(clienteSeguro(clienteId), FILA_LEGADA_ARQUIVO, [])
      : [];
    return Array.isArray(valor) ? valor : [];
  } catch {
    return [];
  }
}

function cloneSet(set = new Set()) {
  return new Set(Array.from(set || []));
}

function resumosEntradasHistorico(clienteId = "admin", entradas = [], agora = Date.now()) {
  const resumo = {
    total: 0,
    ids: new Set(),
    chaves: new Set(),
    status: {},
    vivosEssenciais: 0,
    enviadosRecentes: 0,
    terminais: 0
  };

  for (const entrada of lista(entradas)) {
    const normalizada = normalizarEntradaViva(entrada, entrada?.posicaoLegada || 0, agora);
    const item = normalizada.item || {};
    const classificacao = classificarItemFilaV2(item, { agora });
    const chave = chaveHistorico(clienteId, item, normalizada.posicaoLegada);
    const id = normalizada.id;
    resumo.total += 1;
    resumo.ids.add(id);
    resumo.chaves.add(chave);
    resumo.status[normalizada.status || "desconhecido"] = (resumo.status[normalizada.status || "desconhecido"] || 0) + 1;
    if (classificacao.bucket === "viva") resumo.vivosEssenciais += 1;
    if (classificacao.motivo === "enviado_recente_executor_2h") resumo.enviadosRecentes += 1;
    if (classificacao.bucket === "historico") resumo.terminais += 1;
  }

  return resumo;
}

function chaveHistoricoLegada(clienteId = "admin", item = {}, posicaoLegada = -1) {
  const base = [
    clienteSeguro(clienteId),
    idItem(item, posicaoLegada),
    statusItem(item),
    texto(item.enviadoEm || item.dataEnvio || item.finalizadoEm || item.retidaEm || item.erroEm || item.expiradaEm || ""),
    String(posicaoLegada)
  ].join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

function chaveHistoricoAtual(clienteId = "admin", item = {}, posicaoLegada = -1) {
  const base = [
    clienteSeguro(clienteId),
    idItem(item, posicaoLegada),
    statusItem(item),
    texto(item.enviadoEm || item.dataEnvio || item.finalizadoEm || item.retidaEm || item.erroEm || item.expiradaEm || "")
  ].join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

function escreverFilaViva(clienteId = "admin", entradas = [], deps = {}) {
  const escritor = deps.writeClienteJson || writeClienteJson;
  if (typeof escritor !== "function") {
    return { ok: false, motivo: "writeClienteJson_indisponivel" };
  }
  const normalizada = normalizarEntradasViva(entradas, deps.agora || Date.now())
    .filter(entrada => entrada.bucket === "viva");
  try {
    const ok = escritor(clienteSeguro(clienteId), FILA_VIVA_ARQUIVO, normalizada);
    return {
      ok: ok !== false,
      motivo: ok === false ? "write_retorno_false" : "fila_viva_escrita",
      totalViva: normalizada.length,
      bytesFilaViva: tamanhoJsonBytes(normalizada)
    };
  } catch (erro) {
    return {
      ok: false,
      motivo: "erro_escrita_fila_viva",
      erro: erro?.message || "erro_escrita"
    };
  }
}

function recuperarFilaVivaDoLegado(clienteId = "admin", deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const filaLegada = Array.isArray(deps.filaLegada)
    ? deps.filaLegada.filter(item => clienteSeguro(item?.clienteId || "admin") === cliente)
    : lerFilaLegada(cliente, deps);
  const projecao = projetarFilaV2(filaLegada, { agora: deps.agora || Date.now() });
  const escrita = escreverFilaViva(cliente, projecao.viva, deps);
  const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);

  logOperacional(deps.logger, {
    versao: 1,
    evento: "recovery_viva",
    clienteId: cliente,
    ok: escrita.ok === true,
    fonte: "fila_json_legado",
    motivo: escrita.motivo,
    totalLegado: projecao.totalLegado,
    totalViva: projecao.totalViva,
    totalHistorico: projecao.totalHistorico,
    divergencias: projecao.comparacao?.divergencias || 0,
    bytesFilaViva: escrita.bytesFilaViva || 0,
    duracaoMs
  });

  return {
    ok: escrita.ok === true,
    fonte: "fila_json_legado",
    motivo: escrita.motivo,
    recovery: true,
    entradas: projecao.viva,
    itens: projecao.viva.map(entrada => entrada.item),
    projecao,
    escrita
  };
}

function mapaPorId(entradas = []) {
  const mapa = new Map();
  for (const entrada of lista(entradas)) {
    const normalizada = normalizarEntradaViva(entrada, entrada?.posicaoLegada || 0, Date.now());
    const chave = normalizada.id;
    if (!mapa.has(chave)) {
      mapa.set(chave, normalizada);
    }
  }
  return mapa;
}

function compararVivaComLegadoInterno(clienteId = "admin", entradasViva = [], filaLegada = [], deps = {}) {
  const cliente = clienteSeguro(clienteId);
  const legadoCliente = lista(filaLegada).filter(item => clienteSeguro(item?.clienteId || "admin") === cliente);
  const projecao = projetarFilaV2(legadoCliente, { agora: deps.agora || Date.now() });
  const vivaNormalizada = normalizarEntradasViva(entradasViva, deps.agora || Date.now());
  const idsEsperados = projecao.viva.map(entrada => entrada.id);
  const idsViva = vivaNormalizada.map(entrada => entrada.id);
  const mapaEsperado = mapaPorId(projecao.viva);
  const mapaAtual = mapaPorId(vivaNormalizada);
  const idsAusentes = [];
  const idsExtras = [];
  const statusDivergentes = [];
  const idsDuplicados = [];
  const idsRecentesAusentes = [];

  const contagemViva = new Map();
  for (const id of idsViva) {
    contagemViva.set(id, (contagemViva.get(id) || 0) + 1);
  }
  for (const [id, quantidade] of contagemViva.entries()) {
    if (quantidade > 1) idsDuplicados.push(id);
  }

  for (const id of idsEsperados) {
    const esperado = mapaEsperado.get(id);
    const atual = mapaAtual.get(id);
    if (!atual) {
      idsAusentes.push(id);
      if (esperado && esperado.bucket === "viva" && esperado.motivoBucket === "enviado_recente_executor_2h") {
        idsRecentesAusentes.push(id);
      }
      continue;
    }
    if (statusItem(esperado.item) !== statusItem(atual.item) || esperado.bucket !== atual.bucket) {
      statusDivergentes.push(id);
    }
    if ((esperado.motivoBucket || "") !== (atual.motivoBucket || "")) {
      statusDivergentes.push(id);
    }
  }

  for (const id of idsViva) {
    if (!mapaEsperado.has(id)) idsExtras.push(id);
  }

  const divergencias =
    idsAusentes.length +
    idsExtras.length +
    statusDivergentes.length +
    idsDuplicados.length +
    idsRecentesAusentes.length;

  return {
    ok: divergencias === 0,
    totalLegado: legadoCliente.length,
    totalVivaEsperado: idsEsperados.length,
    totalVivaAtual: idsViva.length,
    idsAusentes: idsAusentes.slice(0, 20),
    idsExtras: idsExtras.slice(0, 20),
    statusDivergentes: Array.from(new Set(statusDivergentes)).slice(0, 20),
    idsDuplicados: idsDuplicados.slice(0, 20),
    idsRecentesAusentes: idsRecentesAusentes.slice(0, 20),
    divergencias
  };
}

function lerFilaViva(clienteId = "admin", deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const fsImpl = deps.fs || fs;
  const file = caminhoJsonCliente(cliente, FILA_VIVA_ARQUIVO, deps);
  const leitura = lerJsonArquivoDireto(file, null, fsImpl);

  if (leitura.ok && Array.isArray(leitura.valor)) {
    const entradas = normalizarEntradasViva(leitura.valor, deps.agora || Date.now())
      .filter(entrada => entrada.bucket === "viva");
    const legado = deps.filaLegada || lerFilaLegada(cliente, deps);
    const comparacao = compararVivaComLegado(cliente, entradas, legado, deps);
    if (!comparacao.ok) {
      const recovery = recuperarFilaVivaDoLegado(cliente, {
        ...deps,
        motivoRecovery: "viva_divergente_legado",
        logger: deps.logger
      });
      const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
      logOperacional(deps.logger, {
        versao: 1,
        evento: "divergencia_viva_legado",
        clienteId: cliente,
        ok: false,
        totalLegado: comparacao.totalLegado,
        totalViva: comparacao.totalVivaAtual,
        divergencias: comparacao.divergencias,
        idsRecentesAusentes: comparacao.idsRecentesAusentes.length,
        idsDuplicados: comparacao.idsDuplicados.length,
        idsExtras: comparacao.idsExtras.length,
        idsAusentes: comparacao.idsAusentes.length,
        duracaoMs
      });
      return {
        ...recovery,
        fallbackLegado: true,
        motivoFallback: "viva_divergente_legado",
        comparacao
      };
    }
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    logOperacional(deps.logger, {
      versao: 1,
      evento: "read_fila_viva",
      clienteId: cliente,
      ok: true,
      fonte: "fila_viva",
      totalViva: entradas.length,
      bytesFilaViva: leitura.bytes || 0,
      fallbackLegado: false,
      divergencias: 0,
      duracaoMs
    });
    return {
      ok: true,
      fonte: "fila_viva",
      recovery: false,
      entradas,
      itens: entradas.map(entrada => entrada.item),
      bytes: leitura.bytes || 0,
      comparacao
    };
  }

  const recovery = recuperarFilaVivaDoLegado(cliente, {
    ...deps,
    motivoRecovery: leitura.motivo,
    logger: deps.logger
  });
  return {
    ...recovery,
    fallbackLegado: true,
    motivoFallback: leitura.motivo,
    erroFallback: leitura.erro || ""
  };
}

function dataSegmentoHistorico(item = {}, agora = Date.now()) {
  const candidatos = [
    item.enviadoEm,
    item.dataEnvio,
    item.finalizadoEm,
    item.retidaEm,
    item.erroEm,
    item.expiradaEm,
    item.atualizadoEm,
    item.updatedAt
  ];
  for (const valor of candidatos) {
    const ms = Date.parse(valor);
    if (Number.isFinite(ms)) return new Date(ms).toISOString().slice(0, 10);
  }
  return agoraIso(agora).slice(0, 10);
}

function chaveHistorico(clienteId = "admin", item = {}, posicaoLegada = -1) {
  const base = [
    clienteSeguro(clienteId),
    idItem(item, posicaoLegada),
    statusItem(item),
    texto(item.enviadoEm || item.dataEnvio || item.finalizadoEm || item.retidaEm || item.erroEm || item.expiradaEm || "")
  ].join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

function caminhoSegmentoHistorico(clienteId = "admin", item = {}, deps = {}) {
  const dirCliente = caminhoDirCliente(clienteId, deps);
  if (!dirCliente) return "";
  const dir = path.join(dirCliente, HISTORICO_INCREMENTAL_DIR);
  const data = dataSegmentoHistorico(item, deps.agora || Date.now());
  return path.join(dir, `${data}.jsonl`);
}

function chaveCacheHistorico(file = "") {
  return texto(file);
}

function limparCacheHistorico() {
  cacheChavesHistorico.clear();
  return true;
}

function invalidaCacheHistorico(file = "") {
  const chave = chaveCacheHistorico(file);
  if (chave) cacheChavesHistorico.delete(chave);
}

function lerCacheHistorico(file = "", fsImpl = fs, logger = console, clienteId = "admin") {
  const chaveArquivo = chaveCacheHistorico(file);
  if (!chaveArquivo) {
    return {
      chaves: new Set(),
      bytes: 0,
      linhas: 0,
      cacheHit: false,
      motivo: "caminho_indisponivel"
    };
  }

  let stat = null;
  try {
    stat = fsImpl.existsSync(file) ? fsImpl.statSync(file) : null;
  } catch {
    stat = null;
  }

  const cached = cacheChavesHistorico.get(chaveArquivo);
  if (cached && stat && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    logOperacional(logger, {
      versao: 1,
      evento: "cache_hit_dedupe",
      clienteId: clienteSeguro(clienteId),
      fileHash: hashCurto(file),
      linhas: cached.linhas || 0,
      bytes: cached.bytes || 0
    });
    return {
      chaves: cloneSet(cached.chaves),
      bytes: cached.bytes || 0,
      linhas: cached.linhas || 0,
      cacheHit: true,
      motivo: "cache_hit"
    };
  }

  const chaves = new Set();
  let bytes = 0;
  let linhas = 0;
  try {
    if (file && fsImpl.existsSync(file)) {
      const conteudo = fsImpl.readFileSync(file, "utf8");
      bytes = Buffer.byteLength(conteudo || "", "utf8");
      const partes = (conteudo || "").split(/\r?\n/);
      for (const linha of partes) {
        if (!linha.trim()) continue;
        try {
          const registro = JSON.parse(linha);
          const clienteRegistro = texto(registro?.clienteId || clienteId);
          const itemRegistro = registro?.item && typeof registro.item === "object" ? registro.item : {};
          const posicaoRegistro = Number.isInteger(Number(registro?.posicaoLegada))
            ? Number(registro.posicaoLegada)
            : -1;
          const chaveAtual = texto(registro?.chave) || chaveHistoricoAtual(clienteRegistro, itemRegistro, posicaoRegistro);
          const chaveLegada = texto(registro?.chaveLegada) || chaveHistoricoLegada(clienteRegistro, itemRegistro, posicaoRegistro);
          if (chaveAtual) chaves.add(chaveAtual);
          if (chaveLegada) chaves.add(chaveLegada);
          linhas += 1;
        } catch {}
      }
    }
  } catch {}

  const snapshot = {
    chaves,
    bytes,
    linhas,
    mtimeMs: stat ? Number(stat.mtimeMs || 0) : 0,
    size: stat ? Number(stat.size || 0) : 0
  };
  cacheChavesHistorico.set(chaveArquivo, snapshot);
  logOperacional(logger, {
    versao: 1,
    evento: "cache_miss_dedupe",
    clienteId: clienteSeguro(clienteId),
    fileHash: hashCurto(file),
    linhas: snapshot.linhas,
    bytes: snapshot.bytes
  });
  return {
    chaves: cloneSet(snapshot.chaves),
    bytes: snapshot.bytes,
    linhas: snapshot.linhas,
    cacheHit: false,
    motivo: "cache_miss"
  };
}

function appendHistoricoIncremental(clienteId = "admin", entradaOuItem = {}, deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const fsImpl = deps.fs || fs;
  const entrada = normalizarEntradaViva(entradaOuItem, entradaOuItem?.posicaoLegada || 0, deps.agora || Date.now());
  const item = entrada.item || {};
  const file = caminhoSegmentoHistorico(cliente, item, deps);
  const chave = chaveHistorico(cliente, item, entrada.posicaoLegada);
  const chaveLegada = chaveHistoricoLegada(cliente, item, entrada.posicaoLegada);
  let leituraCache = {
    chaves: new Set(),
    bytes: 0,
    linhas: 0,
    cacheHit: false,
    motivo: "nao_carregado"
  };

  if (!file) {
    return { ok: false, motivo: "caminho_historico_indisponivel", chave };
  }

  try {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    leituraCache = lerCacheHistorico(file, fsImpl, deps.logger, cliente);
    const existentes = leituraCache.chaves;
    if (existentes.has(chave) || existentes.has(chaveLegada)) {
      const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
      logOperacional(deps.logger, {
        versao: 1,
        evento: "historico_append",
        clienteId: cliente,
        ok: true,
        idempotente: true,
        cacheHit: leituraCache.cacheHit === true,
        status: entrada.status || statusItem(item),
        bytesAppend: 0,
        duracaoMs
      });
      logOperacional(deps.logger, {
        versao: 1,
        evento: "append_idempotente_ignorado",
        clienteId: cliente,
        cacheHit: leituraCache.cacheHit === true,
        status: entrada.status || statusItem(item),
        fileHash: hashCurto(file),
        duracaoMs
      });
      return { ok: true, idempotente: true, motivo: "historico_ja_registrado", chave, chaveLegada, file };
    }

    const registro = {
      versao: 1,
      chave,
      chaveLegada,
      clienteId: cliente,
      id: entrada.id || idItem(item, entrada.posicaoLegada),
      status: entrada.status || statusItem(item),
      posicaoLegada: entrada.posicaoLegada,
      motivoBucket: entrada.motivoBucket || "",
      registradoEm: agoraIso(deps.agora || Date.now()),
      item
    };
    const linha = `${JSON.stringify(registro)}\n`;
    fsImpl.appendFileSync(file, linha, "utf8");
    try {
      const stat = fsImpl.existsSync(file) ? fsImpl.statSync(file) : null;
      cacheChavesHistorico.set(chaveCacheHistorico(file), {
        chaves: new Set([...existentes, chave, chaveLegada]),
        bytes: (stat ? stat.size : (leituraCache.bytes || 0)) + Buffer.byteLength(linha, "utf8"),
        linhas: (leituraCache.linhas || 0) + 1,
        mtimeMs: stat ? Number(stat.mtimeMs || 0) : 0,
        size: stat ? Number(stat.size || 0) : 0
      });
    } catch {}
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    logOperacional(deps.logger, {
      versao: 1,
      evento: "historico_append",
      clienteId: cliente,
      ok: true,
      idempotente: false,
      cacheHit: leituraCache.cacheHit === true,
      status: registro.status,
      bytesAppend: Buffer.byteLength(linha, "utf8"),
      duracaoMs
    });
    return {
      ok: true,
      idempotente: false,
      motivo: "historico_append_ok",
      chave,
      chaveLegada,
      file,
      bytesAppend: Buffer.byteLength(linha, "utf8")
    };
  } catch (erro) {
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    logOperacional(deps.logger, {
      versao: 1,
      evento: "historico_append",
      clienteId: cliente,
      ok: false,
      cacheHit: leituraCache.cacheHit === true,
      status: entrada.status || statusItem(item),
      erro: erro?.message || "erro_append_historico",
      duracaoMs
    });
    return {
      ok: false,
      motivo: "erro_append_historico",
      erro: erro?.message || "erro_append",
      chave,
      chaveLegada,
      file
    };
  }
}

function itemTerminalParaHistorico(item = {}, agora = Date.now()) {
  const classificacao = classificarItemFilaV2(item, { agora });
  return classificacao.bucket === "historico";
}

function moverTerminalParaHistorico(clienteId = "admin", filaViva = [], alvo = {}, deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const entradas = normalizarEntradasViva(filaViva, deps.agora || Date.now());
  const alvoId = idItem(alvo?.item || alvo, alvo?.posicaoLegada || -1);
  const entrada = entradas.find(item => item.id === alvoId) ||
    normalizarEntradaViva(alvo?.item ? alvo : { item: alvo, posicaoLegada: alvo?.posicaoLegada }, alvo?.posicaoLegada || -1, deps.agora || Date.now());

  if (!itemTerminalParaHistorico(entrada.item, deps.agora || Date.now())) {
    return { ok: false, motivo: "item_nao_terminal", removeuDaViva: false };
  }

  const historico = appendHistoricoIncremental(cliente, entrada, deps);
  if (!historico.ok) {
    logOperacional(deps.logger, {
      versao: 1,
      evento: "transicao_terminal",
      clienteId: cliente,
      ok: false,
      motivo: "historico_falhou_item_permanece_vivo",
      removeuDaViva: false
    });
    return {
      ok: false,
      motivo: "historico_falhou_item_permanece_vivo",
      removeuDaViva: false,
      historico
    };
  }

  const restante = entradas.filter(item => item.id !== entrada.id);
  const escrita = escreverFilaViva(cliente, restante, deps);
  const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
  if (!escrita.ok) {
    logOperacional(deps.logger, {
      versao: 1,
      evento: "conflito_viva_historico",
      clienteId: cliente,
      ok: false,
      historicoOk: true,
      vivaOk: false,
      cacheHit: true,
      removeuDaViva: false,
      totalVivaAntes: entradas.length,
      totalVivaDepois: entradas.length,
      fileHash: hashCurto(caminhoSegmentoHistorico(cliente, entrada.item || {}, deps))
    });
  }
  logOperacional(deps.logger, {
    versao: 1,
    evento: "transicao_terminal",
      clienteId: cliente,
      ok: escrita.ok === true,
      removeuDaViva: escrita.ok === true,
      totalVivaAntes: entradas.length,
      totalVivaDepois: escrita.ok === true ? restante.length : entradas.length,
      historicoOk: true,
      duracaoMs
    });

  return {
    ok: escrita.ok === true,
    motivo: escrita.ok ? "terminal_movido_para_historico" : "historico_ok_viva_nao_atualizada",
    removeuDaViva: escrita.ok === true,
    historico,
    escrita,
    filaViva: escrita.ok ? restante : entradas
  };
}

function compararVivaComLegado(clienteId = "admin", entradasViva = [], filaLegada = [], deps = {}) {
  return compararVivaComLegadoInterno(clienteId, entradasViva, filaLegada, deps);
}

function flagAtiva(nome, env = process.env) {
  return String(env?.[nome] || "").trim().toLowerCase() === "true";
}

function modoOperacional(env = process.env) {
  return {
    operacionalAtivo: flagAtiva(FLAG_OPERACIONAL_ATIVA, env),
    shadow2B1Ativo: flagAtiva(FLAG_2B1_SHADOW_ATIVA, env)
  };
}

function criarControladorFilaOperacionalV2(opcoes = {}) {
  function prepararSeHabilitado(params = {}) {
    const modo = modoOperacional(opcoes.env || process.env);
    if (!modo.shadow2B1Ativo && !modo.operacionalAtivo) {
      return { ok: true, pulou: true, motivo: "flag_desativada", ...modo };
    }

    const cliente = clienteSeguro(params.clienteId || "admin");
    const filaLegada = Array.isArray(params.fila)
      ? params.fila.filter(item => clienteSeguro(item?.clienteId || "admin") === cliente)
      : lerFilaLegada(cliente, { ...opcoes, ...params });
    const projecao = projetarFilaV2(filaLegada, { agora: params.agora || Date.now() });
    const escrita = escreverFilaViva(cliente, projecao.viva, { ...opcoes, ...params });
    const comparacao = compararVivaComLegado(cliente, projecao.viva, filaLegada, { ...opcoes, ...params });

    logOperacional(params.logger || opcoes.logger, {
      versao: 1,
      evento: "preparacao_2b1",
      clienteId: cliente,
      ok: escrita.ok === true && comparacao.ok === true,
      operacionalAtivo: modo.operacionalAtivo,
      shadow2B1Ativo: modo.shadow2B1Ativo,
      totalLegado: projecao.totalLegado,
      totalViva: projecao.totalViva,
      totalHistorico: projecao.totalHistorico,
      divergencias: comparacao.divergencias,
      idsAusentes: comparacao.idsAusentes.length,
      idsExtras: comparacao.idsExtras.length,
      idsDuplicados: comparacao.idsDuplicados.length,
      idsRecentesAusentes: comparacao.idsRecentesAusentes.length,
      fallbackLegado: false,
      bytesFilaViva: escrita.bytesFilaViva || 0
    });

    return {
      ok: escrita.ok === true && comparacao.ok === true,
      pulou: false,
      ...modo,
      projecao,
      escrita,
      comparacao
    };
  }

  return {
    prepararSeHabilitado,
    lerFilaViva: (clienteId, deps = {}) => lerFilaViva(clienteId, { ...opcoes, ...deps }),
    escreverFilaViva: (clienteId, entradas, deps = {}) => escreverFilaViva(clienteId, entradas, { ...opcoes, ...deps }),
    appendHistoricoIncremental: (clienteId, entrada, deps = {}) => appendHistoricoIncremental(clienteId, entrada, { ...opcoes, ...deps }),
    moverTerminalParaHistorico: (clienteId, filaViva, alvo, deps = {}) => moverTerminalParaHistorico(clienteId, filaViva, alvo, { ...opcoes, ...deps }),
    compararVivaComLegado: (clienteId, entradasViva, filaLegada, deps = {}) => compararVivaComLegado(clienteId, entradasViva, filaLegada, { ...opcoes, ...deps }),
    resetarCacheHistoricoParaTeste: limparCacheHistorico
  };
}

module.exports = {
  FLAG_OPERACIONAL_ATIVA,
  FLAG_2B1_SHADOW_ATIVA,
  HISTORICO_INCREMENTAL_DIR,
  TAG_TELEMETRIA,
  normalizarEntradasViva,
  lerFilaViva,
  escreverFilaViva,
  recuperarFilaVivaDoLegado,
  appendHistoricoIncremental,
  moverTerminalParaHistorico,
  compararVivaComLegado,
  itemTerminalParaHistorico,
  modoOperacional,
  criarControladorFilaOperacionalV2,
  limparCacheHistorico
};
