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
    evento: "recovery_fila_viva",
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

function lerFilaViva(clienteId = "admin", deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const fsImpl = deps.fs || fs;
  const file = caminhoJsonCliente(cliente, FILA_VIVA_ARQUIVO, deps);
  const leitura = lerJsonArquivoDireto(file, null, fsImpl);

  if (leitura.ok && Array.isArray(leitura.valor)) {
    const entradas = normalizarEntradasViva(leitura.valor, deps.agora || Date.now())
      .filter(entrada => entrada.bucket === "viva");
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
      duracaoMs
    });
    return {
      ok: true,
      fonte: "fila_viva",
      recovery: false,
      entradas,
      itens: entradas.map(entrada => entrada.item),
      bytes: leitura.bytes || 0
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
    texto(item.enviadoEm || item.dataEnvio || item.finalizadoEm || item.retidaEm || item.erroEm || item.expiradaEm || ""),
    String(posicaoLegada)
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

function chavesExistentesJsonl(file = "", fsImpl = fs) {
  const chaves = new Set();
  try {
    if (!file || !fsImpl.existsSync(file)) return chaves;
    const linhas = fsImpl.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
    for (const linha of linhas) {
      try {
        const registro = JSON.parse(linha);
        if (registro?.chave) chaves.add(String(registro.chave));
      } catch {}
    }
  } catch {}
  return chaves;
}

function appendHistoricoIncremental(clienteId = "admin", entradaOuItem = {}, deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const fsImpl = deps.fs || fs;
  const entrada = normalizarEntradaViva(entradaOuItem, entradaOuItem?.posicaoLegada || 0, deps.agora || Date.now());
  const item = entrada.item || {};
  const file = caminhoSegmentoHistorico(cliente, item, deps);
  const chave = chaveHistorico(cliente, item, entrada.posicaoLegada);

  if (!file) {
    return { ok: false, motivo: "caminho_historico_indisponivel", chave };
  }

  try {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    const existentes = chavesExistentesJsonl(file, fsImpl);
    if (existentes.has(chave)) {
      const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
      logOperacional(deps.logger, {
        versao: 1,
        evento: "historico_append",
        clienteId: cliente,
        ok: true,
        idempotente: true,
        status: entrada.status || statusItem(item),
        bytesAppend: 0,
        duracaoMs
      });
      return { ok: true, idempotente: true, motivo: "historico_ja_registrado", chave, file };
    }

    const registro = {
      versao: 1,
      chave,
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
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    logOperacional(deps.logger, {
      versao: 1,
      evento: "historico_append",
      clienteId: cliente,
      ok: true,
      idempotente: false,
      status: registro.status,
      bytesAppend: Buffer.byteLength(linha, "utf8"),
      duracaoMs
    });
    return {
      ok: true,
      idempotente: false,
      motivo: "historico_append_ok",
      chave,
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
      status: entrada.status || statusItem(item),
      erro: erro?.message || "erro_append_historico",
      duracaoMs
    });
    return {
      ok: false,
      motivo: "erro_append_historico",
      erro: erro?.message || "erro_append",
      chave,
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
  const cliente = clienteSeguro(clienteId);
  const legadoCliente = lista(filaLegada).filter(item => clienteSeguro(item?.clienteId || "admin") === cliente);
  const projecao = projetarFilaV2(legadoCliente, { agora: deps.agora || Date.now() });
  const idsEsperados = projecao.viva.map(entrada => entrada.id);
  const idsViva = normalizarEntradasViva(entradasViva, deps.agora || Date.now()).map(entrada => entrada.id);
  const setViva = new Set(idsViva);
  const idsAusentes = idsEsperados.filter(id => !setViva.has(id));
  const setEsperado = new Set(idsEsperados);
  const idsExtras = idsViva.filter(id => !setEsperado.has(id));
  return {
    ok: idsAusentes.length === 0 && idsExtras.length === 0,
    totalLegado: legadoCliente.length,
    totalVivaEsperado: idsEsperados.length,
    totalVivaAtual: idsViva.length,
    idsAusentes: idsAusentes.slice(0, 20),
    idsExtras: idsExtras.slice(0, 20),
    divergencias: idsAusentes.length + idsExtras.length
  };
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
    compararVivaComLegado: (clienteId, entradasViva, filaLegada, deps = {}) => compararVivaComLegado(clienteId, entradasViva, filaLegada, { ...opcoes, ...deps })
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
  criarControladorFilaOperacionalV2
};
