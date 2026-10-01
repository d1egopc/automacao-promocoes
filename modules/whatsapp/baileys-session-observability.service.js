"use strict";

const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");

const contextoSignal = new AsyncLocalStorage();
const NIVEIS_LOG = ["trace", "debug", "info", "warn", "error"];

function texto(value, limite = 160) {
  return String(value ?? "").trim().slice(0, limite);
}

function hashIdentificador(value) {
  const entrada = texto(value, 500);
  if (!entrada) return "";
  return crypto.createHash("sha256").update(entrada).digest("hex").slice(0, 16);
}

function criarContextoSocketBaileys({
  clienteId = "",
  workspaceId = "",
  sessaoId = "",
  sessaoIdNormalizado = "",
  socketGeracao = ""
} = {}) {
  return Object.freeze({
    clienteId: texto(clienteId),
    workspaceId: texto(workspaceId || clienteId),
    sessaoId: texto(sessaoId),
    sessaoIdNormalizado: texto(sessaoIdNormalizado || sessaoId),
    socketGeracao: Number(socketGeracao) || 0
  });
}

function classificarErroSignal(value) {
  const erro = Array.isArray(value) ? value : [value];
  const linha = erro.map(item => {
    if (item instanceof Error) return `${item.name || "Error"} ${item.message || ""}`;
    return String(item ?? "");
  }).join(" ");

  if (/invalid prekey id/i.test(linha)) return "invalid_prekey_id";
  if (/no matching sessions found/i.test(linha)) return "no_matching_sessions";
  if (/key used already or never filled/i.test(linha)) return "key_used_already_or_never_filled";
  if (/bad mac/i.test(linha)) return "bad_mac";
  if (/sessionerror/i.test(linha)) return "session_error";
  if (/failed to decrypt|decrypt failure/i.test(linha)) return "decrypt_failure";
  return "";
}

function mensagemLog(args = []) {
  for (let indice = args.length - 1; indice >= 0; indice -= 1) {
    if (typeof args[indice] === "string") return args[indice];
  }
  return "";
}

function objetoLog(args = []) {
  return args.find(item => item && typeof item === "object" && !(item instanceof Error)) || {};
}

function eventoBaileysSanitizado(args = []) {
  const mensagem = mensagemLog(args);
  const dados = objetoLog(args);

  if (/sent retry receipt/i.test(mensagem)) {
    const attrs = dados.msgAttrs && typeof dados.msgAttrs === "object" ? dados.msgAttrs : {};
    const remoteJid = attrs.from || attrs.to || attrs.recipient || "";
    return [{
      evento: "baileys_retry_receipt",
      messageId: texto(attrs.id),
      remoteJidHash: hashIdentificador(remoteJid),
      participantJidHash: hashIdentificador(attrs.participant),
      retryCount: Number(dados.retryCount) || 0
    }, "sent retry receipt"];
  }

  if (!/failed to decrypt message/i.test(mensagem) && !dados.err && !dados.error) {
    return null;
  }

  const erroTipo = classificarErroSignal([mensagem, dados.err, dados.error]);
  if (/failed to decrypt message/i.test(mensagem) || erroTipo) {
    const key = dados.key && typeof dados.key === "object" ? dados.key : {};
    return [{
      evento: "baileys_decrypt_failure",
      erroTipo: erroTipo || "decrypt_failure",
      erroNome: texto(dados.err?.name || dados.error?.name || "Error", 80),
      messageId: texto(key.id),
      remoteJidHash: hashIdentificador(key.remoteJid),
      participantJidHash: hashIdentificador(key.participant)
    }, "failed to decrypt message"];
  }

  return null;
}

function envolverLogger(logger) {
  const contextual = {};

  for (const nivel of NIVEIS_LOG) {
    contextual[nivel] = (...args) => {
      const sanitizado = eventoBaileysSanitizado(args);
      if (sanitizado) return logger?.[nivel]?.(...sanitizado);
      return logger?.[nivel]?.(...args);
    };
  }

  contextual.child = bindings => envolverLogger(
    typeof logger?.child === "function" ? logger.child(bindings || {}) : logger
  );

  Object.defineProperty(contextual, "level", {
    enumerable: true,
    configurable: true,
    get: () => logger?.level || "info",
    set: value => {
      if (logger && "level" in logger) logger.level = value;
    }
  });

  return contextual;
}

function criarLoggerBaileysContextual({ loggerBase, contexto } = {}) {
  if (!loggerBase) throw new Error("logger_base_obrigatorio");
  const loggerFilho = typeof loggerBase.child === "function"
    ? loggerBase.child(contexto || {})
    : loggerBase;
  return envolverLogger(loggerFilho);
}

function obterContextoSignalAtual() {
  return contextoSignal.getStore()?.contexto;
}

function observarErroSignal(erro, logger) {
  const erroTipo = classificarErroSignal(erro);
  if (!erroTipo) return false;

  logger?.error?.({
    evento: "baileys_signal_error",
    erroTipo,
    erroNome: texto(erro?.name || "Error", 80)
  }, "baileys signal error");
  return true;
}

function criarFabricaRepositorioSignalContextual({ criarRepositorio, contexto, logger } = {}) {
  if (typeof criarRepositorio !== "function") {
    throw new Error("fabrica_repositorio_signal_obrigatoria");
  }

  const contextoExecucao = Object.freeze({ contexto, logger });

  return auth => {
    const repositorio = criarRepositorio(auth);
    const contextualizar = nome => {
      if (typeof repositorio?.[nome] !== "function") return undefined;
      return (...args) => contextoSignal.run(contextoExecucao, async () => {
        try {
          return await repositorio[nome](...args);
        } catch (erro) {
          try {
            observarErroSignal(erro, logger);
          } catch (_) {
            // Falha de telemetria nao pode substituir a excecao Signal original.
          }
          throw erro;
        }
      });
    };

    const repositorioContextual = { ...repositorio };
    for (const nome of ["decryptGroupMessage", "decryptMessage"]) {
      const funcaoContextual = contextualizar(nome);
      if (funcaoContextual) repositorioContextual[nome] = funcaoContextual;
    }
    return repositorioContextual;
  };
}

function registrarTelemetriaCredsUpdate({
  contexto = {},
  socketAtual = false,
  logger = console,
  timestamp = new Date().toISOString()
} = {}) {
  logger?.log?.("[WHATSAPP-CREDS-UPDATE]", JSON.stringify({
    clienteId: texto(contexto.clienteId),
    workspaceId: texto(contexto.workspaceId),
    sessaoId: texto(contexto.sessaoId),
    sessaoIdNormalizado: texto(contexto.sessaoIdNormalizado),
    socketGeracao: Number(contexto.socketGeracao) || 0,
    socketAtual: socketAtual === true,
    timestamp: texto(timestamp, 40)
  }));
}

module.exports = {
  classificarErroSignal,
  criarContextoSocketBaileys,
  criarFabricaRepositorioSignalContextual,
  criarLoggerBaileysContextual,
  hashIdentificador,
  obterContextoSignalAtual,
  registrarTelemetriaCredsUpdate,
  observarErroSignal
};
