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

function arquivoCredsSessao(authDir = "") {
  return path.join(authDir, "creds.json");
}

function arquivoBackupCredsSessao(authDir = "") {
  return path.join(authDir, "creds.json.bak");
}

function validarEstruturaCreds(creds) {
  const ok = Boolean(
    creds &&
    typeof creds === "object" &&
    creds.noiseKey &&
    creds.signedIdentityKey &&
    creds.signedPreKey &&
    creds.registrationId !== undefined &&
    creds.advSecretKey
  );
  const meId = creds?.me?.id || creds?.me?.jid || "";

  return {
    ok,
    meIdExiste: Boolean(meId)
  };
}

function lerCredsArquivo(arquivoCreds = "", fsImpl = fs) {
  try {
    if (!fsImpl.existsSync(arquivoCreds)) {
      return { existe: false, jsonValido: false, estruturaValida: false, meIdExiste: false };
    }

    const raw = fsImpl.readFileSync(arquivoCreds, "utf8");
    const creds = JSON.parse(raw);
    const estrutura = validarEstruturaCreds(creds);

    return {
      existe: true,
      jsonValido: true,
      estruturaValida: estrutura.ok,
      meIdExiste: estrutura.meIdExiste,
      creds,
      raw
    };
  } catch (e) {
    return {
      existe: fsImpl.existsSync?.(arquivoCreds) === true,
      jsonValido: false,
      estruturaValida: false,
      meIdExiste: false,
      erro: e.message || "credencial_invalida"
    };
  }
}

function lerCreds(authDir = "", fsImpl = fs) {
  const arquivoCreds = arquivoCredsSessao(authDir);
  const arquivoBackup = arquivoBackupCredsSessao(authDir);

  try {
    if (!fsImpl.existsSync(authDir)) {
      return {
        authDirExiste: false,
        credsExiste: false,
        credsJsonValido: false,
        credsEstruturaValida: false,
        meIdExiste: false,
        backupExiste: false,
        backupJsonValido: false,
        backupEstruturaValida: false,
        backupMeIdExiste: false
      };
    }

    const principal = lerCredsArquivo(arquivoCreds, fsImpl);
    const backup = lerCredsArquivo(arquivoBackup, fsImpl);

    return {
      authDirExiste: true,
      credsExiste: principal.existe,
      credsJsonValido: principal.jsonValido,
      credsEstruturaValida: principal.estruturaValida,
      meIdExiste: principal.meIdExiste,
      creds: principal.creds,
      raw: principal.raw,
      backupExiste: backup.existe,
      backupJsonValido: backup.jsonValido,
      backupEstruturaValida: backup.estruturaValida,
      backupMeIdExiste: backup.meIdExiste,
      backupCreds: backup.creds,
      backupRaw: backup.raw,
      erro: principal.erro || "",
      erroBackup: backup.erro || ""
    };
  } catch (e) {
    return {
      authDirExiste: fsImpl.existsSync?.(authDir) === true,
      credsExiste: fsImpl.existsSync?.(arquivoCreds) === true,
      credsJsonValido: false,
      credsEstruturaValida: false,
      meIdExiste: false,
      backupExiste: fsImpl.existsSync?.(arquivoBackup) === true,
      backupJsonValido: false,
      backupEstruturaValida: false,
      backupMeIdExiste: false,
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
  const principalValida = leitura.credsExiste && leitura.credsJsonValido && leitura.credsEstruturaValida;
  const backupValido = leitura.backupExiste && leitura.backupJsonValido && leitura.backupEstruturaValida;
  const meIdDisponivel = leitura.meIdExiste || leitura.backupMeIdExiste;
  const authValidaParaReconectar =
    leitura.authDirExiste &&
    (principalValida || backupValido) &&
    !estadoTerminal &&
    (meIdDisponivel || jaEsteveOpen);

  return {
    authDir,
    authDirExiste: leitura.authDirExiste,
    credsExiste: leitura.credsExiste,
    credsJsonValido: leitura.credsJsonValido,
    credsEstruturaValida: leitura.credsEstruturaValida,
    meIdExiste: leitura.meIdExiste,
    backupExiste: leitura.backupExiste,
    backupJsonValido: leitura.backupJsonValido,
    backupEstruturaValida: leitura.backupEstruturaValida,
    backupMeIdExiste: leitura.backupMeIdExiste,
    backupDisponivelParaRestaurar: Boolean(!principalValida && backupValido),
    jaEsteveOpen,
    estadoTerminal,
    authValidaParaReconectar,
    erro: leitura.erro || ""
  };
}

function escreverArquivoAtomicoSync(destino = "", conteudo = "", fsImpl = fs) {
  const dir = path.dirname(destino);
  const tmp = path.join(dir, `.${path.basename(destino)}.${process.pid}.${Date.now()}.tmp`);
  let fd = null;

  try {
    if (!fsImpl.existsSync(dir)) fsImpl.mkdirSync(dir, { recursive: true });
    fd = fsImpl.openSync(tmp, "w");
    fsImpl.writeFileSync(fd, conteudo, "utf8");
    if (typeof fsImpl.fsyncSync === "function") fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = null;
    fsImpl.renameSync(tmp, destino);
    return { ok: true };
  } catch (e) {
    if (fd !== null) {
      try { fsImpl.closeSync(fd); } catch (_) {}
    }
    try { if (fsImpl.existsSync(tmp)) fsImpl.unlinkSync(tmp); } catch (_) {}
    return { ok: false, motivo: "falha_escrita_atomica", erro: e.message || "erro" };
  }
}

function salvarBackupCredsValido({ dataDir = "/data", sessaoId = "", fsImpl = fs } = {}) {
  const authDir = authDirSessao(dataDir, sessaoId);
  const leitura = lerCreds(authDir, fsImpl);
  const principalValida = leitura.credsExiste && leitura.credsJsonValido && leitura.credsEstruturaValida;

  if (!principalValida) {
    return {
      ok: false,
      motivo: "creds_principal_invalida",
      credsPrincipalValida: false,
      backupExiste: leitura.backupExiste === true,
      backupValido: leitura.backupJsonValido === true && leitura.backupEstruturaValida === true
    };
  }

  const destino = arquivoBackupCredsSessao(authDir);
  const escrita = escreverArquivoAtomicoSync(destino, leitura.raw, fsImpl);
  return {
    ok: escrita.ok === true,
    motivo: escrita.ok ? "backup_atualizado" : escrita.motivo,
    credsPrincipalValida: true,
    backupExiste: true,
    backupValido: escrita.ok === true
  };
}

function recuperarCredsNoBoot({ dataDir = "/data", sessaoId = "", statusAtual = "", meta = {}, fsImpl = fs } = {}) {
  const auth = auditarAuthSessao({ dataDir, sessaoId, statusAtual, meta, fsImpl });
  const base = {
    sessaoId,
    credsPrincipalValida: auth.credsJsonValido === true && auth.credsEstruturaValida === true,
    backupExiste: auth.backupExiste === true,
    backupValido: auth.backupJsonValido === true && auth.backupEstruturaValida === true,
    backupRestaurado: false
  };

  if (auth.estadoTerminal) {
    return { ...base, ok: false, decisao: "precisa_qr", motivo: "estado_terminal_nao_restaurar", auth };
  }

  if (base.credsPrincipalValida) {
    return { ...base, ok: true, decisao: "iniciar", motivo: "creds_principal_valida", auth };
  }

  if ((!auth.credsExiste || !auth.credsJsonValido || !auth.credsEstruturaValida) && auth.backupDisponivelParaRestaurar) {
    const authDir = authDirSessao(dataDir, sessaoId);
    const backupRaw = lerCreds(authDir, fsImpl).backupRaw;
    const restauracao = escreverArquivoAtomicoSync(arquivoCredsSessao(authDir), backupRaw, fsImpl);
    if (!restauracao.ok) {
      return { ...base, ok: false, decisao: "erro_auth", motivo: "falha_restaurar_backup", auth };
    }

    const restaurado = auditarAuthSessao({ dataDir, sessaoId, statusAtual, meta, fsImpl });
    const restauradoValido = restaurado.credsJsonValido === true && restaurado.credsEstruturaValida === true;
    return {
      ...base,
      credsPrincipalValida: restauradoValido,
      backupRestaurado: restauradoValido,
      ok: restauradoValido,
      decisao: restauradoValido ? "iniciar" : "erro_auth",
      motivo: restauradoValido ? "backup_restaurado" : "backup_restaurado_invalido",
      auth: restaurado
    };
  }

  if (!auth.authDirExiste || !auth.credsExiste) {
    return { ...base, ok: false, decisao: "precisa_qr", motivo: "credencial_ausente", auth };
  }

  return { ...base, ok: false, decisao: "erro_auth", motivo: "sem_backup_valido", auth };
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
  lerCreds,
  auditarAuthSessao,
  classificarDisconnect,
  deveExibirQr,
  calcularBackoffMs,
  salvarBackupCredsValido,
  recuperarCredsNoBoot
};
