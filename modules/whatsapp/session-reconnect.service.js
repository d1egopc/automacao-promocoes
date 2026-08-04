"use strict";

const fs = require("fs");
const path = require("path");

const ESTADOS_WHATSAPP = Object.freeze({
  OPEN: "open",
  CONNECTING: "connecting",
  RECONNECTING: "reconnecting",
  BACKOFF: "backoff",
  PRECISA_QR: "precisa_qr",
  QR: "qr",
  LOGGED_OUT: "logged_out",
  APAGADA: "apagada",
  ERRO_AUTH: "erro_auth",
  OFFLINE: "offline"
});

const ESTADOS_TERMINAIS_SEM_RESSUSCITAR = new Set([
  ESTADOS_WHATSAPP.LOGGED_OUT,
  ESTADOS_WHATSAPP.APAGADA,
  "loggedOut",
  "resetada",
  "excluida",
  "excluída"
]);

function authDirSessao(dataDir = "/data", sessaoId = "") {
  return path.join(dataDir || "/data", `auth_${String(sessaoId || "").trim()}`);
}

function lerCreds(authDir = "", fsImpl = fs) {
  const arquivoCreds = path.join(authDir, "creds.json");

  try {
    if (!fsImpl.existsSync(authDir)) {
      return { authDirExiste: false, credsExiste: false, credsJsonValido: false, meIdExiste: false };
    }

    if (!fsImpl.existsSync(arquivoCreds)) {
      return { authDirExiste: true, credsExiste: false, credsJsonValido: false, meIdExiste: false };
    }

    const raw = fsImpl.readFileSync(arquivoCreds, "utf8");
    const creds = JSON.parse(raw);
    const meId = creds?.me?.id || creds?.me?.jid || "";

    return {
      authDirExiste: true,
      credsExiste: true,
      credsJsonValido: true,
      meIdExiste: Boolean(meId),
      creds
    };
  } catch (e) {
    return {
      authDirExiste: fsImpl.existsSync?.(authDir) === true,
      credsExiste: fsImpl.existsSync?.(arquivoCreds) === true,
      credsJsonValido: false,
      meIdExiste: false,
      erro: e.message || "credencial_invalida"
    };
  }
}

function auditarAuthSessao({ dataDir = "/data", sessaoId = "", statusAtual = "", meta = {}, fsImpl = fs } = {}) {
  const authDir = authDirSessao(dataDir, sessaoId);
  const leitura = lerCreds(authDir, fsImpl);
  const jaEsteveOpen = Boolean(
    meta?.status === "open" ||
    meta?.conectadoEm ||
    meta?.ultimoOpenEm ||
    statusAtual === "open" ||
    statusAtual === "aberto"
  );
  const estadoTerminal = ESTADOS_TERMINAIS_SEM_RESSUSCITAR.has(String(statusAtual || "")) ||
    ESTADOS_TERMINAIS_SEM_RESSUSCITAR.has(String(meta?.status || ""));
  const authValidaParaReconectar =
    leitura.authDirExiste &&
    leitura.credsExiste &&
    leitura.credsJsonValido &&
    !estadoTerminal &&
    (leitura.meIdExiste || jaEsteveOpen);

  return {
    authDir,
    authDirExiste: leitura.authDirExiste,
    credsExiste: leitura.credsExiste,
    credsJsonValido: leitura.credsJsonValido,
    meIdExiste: leitura.meIdExiste,
    jaEsteveOpen,
    estadoTerminal,
    authValidaParaReconectar,
    erro: leitura.erro || ""
  };
}

function classificarDisconnect({ statusCode, errorMessage = "", disconnectReason = "" } = {}) {
  const codigo = Number(statusCode || 0);
  const mensagem = String(errorMessage || "").toLowerCase();
  const reason = String(disconnectReason || "");

  if (reason === "loggedOut" || codigo === 401) return "logged_out";
  if (reason === "restartRequired" || codigo === 515) return "restart_required";
  if (codigo === 408 && mensagem.includes("qr refs attempts ended")) return "qr_timeout_nao_prova_logout";
  if (codigo === 408) return "timeout";
  if (reason === "connectionLost") return "connection_lost";
  if (reason) return reason;
  return codigo ? `status_${codigo}` : "desconexao_sem_codigo";
}

function deveExibirQr({ auth = {}, statusAtual = "", meta = {}, ultimoMotivo = "" } = {}) {
  const estadoTerminal = ESTADOS_TERMINAIS_SEM_RESSUSCITAR.has(String(statusAtual || "")) ||
    ESTADOS_TERMINAIS_SEM_RESSUSCITAR.has(String(meta?.status || ""));

  if (estadoTerminal) {
    return { exibir: true, motivo: "estado_terminal_exige_qr" };
  }

  if (auth.authValidaParaReconectar) {
    return { exibir: false, motivo: "auth_valida_reconectar_sem_qr" };
  }

  if (auth.authDirExiste && auth.credsExiste && !auth.credsJsonValido) {
    return { exibir: true, motivo: "credencial_corrompida" };
  }

  if (!auth.authDirExiste || !auth.credsExiste) {
    return { exibir: true, motivo: "credencial_ausente" };
  }

  if (ultimoMotivo === "qr_timeout_nao_prova_logout") {
    return { exibir: false, motivo: "qr_timeout_nao_prova_logout" };
  }

  return { exibir: true, motivo: "auth_indeterminada" };
}

function calcularBackoffMs(tentativas = 0) {
  const n = Math.max(0, Number(tentativas || 0));
  return Math.min(60_000, 5_000 * Math.max(1, 2 ** Math.min(n, 4)));
}

module.exports = {
  ESTADOS_WHATSAPP,
  authDirSessao,
  auditarAuthSessao,
  classificarDisconnect,
  deveExibirQr,
  calcularBackoffMs
};
