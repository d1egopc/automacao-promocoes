"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  ESTADOS_WHATSAPP,
  authDirSessao,
  auditarAuthSessao,
  classificarDisconnect,
  deveExibirQr,
  calcularBackoffMs
} = require("../modules/whatsapp/session-reconnect.service");

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-whatsapp-auth-"));

function criarAuth(sessaoId, creds) {
  const dir = authDirSessao(raiz, sessaoId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "creds.json"), JSON.stringify(creds), "utf8");
  return dir;
}

function decidirQr(sessaoId, extras = {}) {
  const auth = auditarAuthSessao({
    dataDir: raiz,
    sessaoId,
    statusAtual: extras.statusAtual || "",
    meta: extras.meta || {}
  });
  return {
    auth,
    decisao: deveExibirQr({
      auth,
      statusAtual: extras.statusAtual || "",
      meta: extras.meta || {},
      ultimoMotivo: extras.ultimoMotivo || ""
    })
  };
}

try {
  criarAuth("sessao_open_restart", { me: { id: "551199999999@s.whatsapp.net" } });
  const restart = decidirQr("sessao_open_restart", {
    statusAtual: ESTADOS_WHATSAPP.OPEN,
    meta: { status: "open", conectadoEm: "2026-08-04T10:00:00.000Z" }
  });
  assert.strictEqual(restart.auth.authValidaParaReconectar, true, "auth valida deve permitir reconexao");
  assert.strictEqual(restart.decisao.exibir, false, "restart com auth valida nao pode exigir QR");

  assert.strictEqual(
    classificarDisconnect({ statusCode: 515, disconnectReason: "restartRequired" }),
    "restart_required",
    "515 deve ser reinicio de socket"
  );
  assert.strictEqual(
    classificarDisconnect({ statusCode: 408, errorMessage: "QR refs attempts ended", disconnectReason: "connectionLost" }),
    "qr_timeout_nao_prova_logout",
    "408 de QR timeout nao prova logout"
  );
  assert.strictEqual(
    classificarDisconnect({ statusCode: 408, errorMessage: "Timed out", disconnectReason: "connectionLost" }),
    "timeout",
    "408 sem QR refs deve ser timeout"
  );

  criarAuth("sessao_connection_lost", { me: { id: "551188888888@s.whatsapp.net" } });
  const lost = decidirQr("sessao_connection_lost", {
    meta: { status: "open", conectadoEm: "2026-08-04T10:00:00.000Z" },
    ultimoMotivo: "connection_lost"
  });
  assert.strictEqual(lost.decisao.exibir, false, "connectionLost com auth valida volta sem QR");

  criarAuth("sessao_timeout", { me: { id: "551177777777@s.whatsapp.net" } });
  const timeout = decidirQr("sessao_timeout", {
    meta: { status: "open", conectadoEm: "2026-08-04T10:00:00.000Z" },
    ultimoMotivo: "qr_timeout_nao_prova_logout"
  });
  assert.strictEqual(timeout.decisao.exibir, false, "QR timeout com auth valida nao deve exibir novo QR");

  criarAuth("sessao_logged_out", { me: { id: "551166666666@s.whatsapp.net" } });
  const loggedOut = decidirQr("sessao_logged_out", {
    statusAtual: ESTADOS_WHATSAPP.LOGGED_OUT,
    meta: { status: ESTADOS_WHATSAPP.LOGGED_OUT }
  });
  assert.strictEqual(loggedOut.decisao.exibir, true, "loggedOut deve pedir QR");

  const ausente = decidirQr("sessao_sem_auth");
  assert.strictEqual(ausente.decisao.exibir, true, "auth ausente deve pedir QR");
  assert.strictEqual(ausente.decisao.motivo, "credencial_ausente");

  criarAuth("sessao_apagada", { me: { id: "551155555555@s.whatsapp.net" } });
  const apagada = decidirQr("sessao_apagada", {
    statusAtual: ESTADOS_WHATSAPP.APAGADA,
    meta: { status: ESTADOS_WHATSAPP.APAGADA }
  });
  assert.strictEqual(apagada.decisao.exibir, true, "sessao apagada nao deve ressuscitar");

  const corrompidaDir = authDirSessao(raiz, "sessao_corrompida");
  fs.mkdirSync(corrompidaDir, { recursive: true });
  fs.writeFileSync(path.join(corrompidaDir, "creds.json"), "{", "utf8");
  const corrompida = decidirQr("sessao_corrompida");
  assert.strictEqual(corrompida.auth.credsJsonValido, false);
  assert.strictEqual(corrompida.decisao.exibir, true, "credencial corrompida deve pedir QR");

  assert.ok(calcularBackoffMs(0) >= 5000, "backoff inicial deve existir");
  assert.ok(calcularBackoffMs(5) <= 60000, "backoff deve ter teto");

  const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(indexFonte.includes("inicializandoWhatsApp[id]"), "deve haver trava de inicializacao por sessao");
  assert.ok(indexFonte.includes("Inicializacao ja em andamento"), "segunda inicializacao simultanea nao deve criar outro socket");
  assert.ok(indexFonte.includes("deveExibirQr"), "QR deve passar por decisao de auth");
  assert.ok(indexFonte.includes("calcularBackoffMs"), "reconexao deve aplicar backoff");
  assert.ok(indexFonte.includes("WHATSAPP-QR-DECISAO"), "decisao de QR deve ser observavel");
  assert.ok(!indexFonte.includes("authDir: authNoQr.authDir"), "logs nao devem expor caminho completo de auth");

  console.log("whatsapp-reconnect-seguro.test.js OK");
} finally {
  fs.rmSync(raiz, { recursive: true, force: true });
}
