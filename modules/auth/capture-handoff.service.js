"use strict";

const crypto = require("crypto");

const TTL_PADRAO_MS = 5 * 60 * 1000;
const LIMPEZA_PADRAO_MS = 60 * 1000;

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function agoraMs(now = Date.now) {
  const valor = typeof now === "function" ? now() : Date.now();
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : Date.now();
}

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function hashCodeChallenge(codeVerifier = "") {
  return base64Url(crypto.createHash("sha256").update(texto(codeVerifier)).digest());
}

function tokenSeguro(bytes = 32) {
  return base64Url(crypto.randomBytes(bytes));
}

function tokenTecnicoValido(valor = "", { min = 16, max = 256 } = {}) {
  const entrada = texto(valor);
  return entrada.length >= min && entrada.length <= max && /^[A-Za-z0-9_-]+$/.test(entrada);
}

function erro(codigo, statusCode = 400) {
  const e = new Error(codigo);
  e.codigo = codigo;
  e.motivo = codigo;
  e.statusCode = statusCode;
  return e;
}

function criarCaptureHandoffService(opcoes = {}) {
  const ttlMs = Number(opcoes.ttlMs || TTL_PADRAO_MS);
  const now = typeof opcoes.now === "function" ? opcoes.now : Date.now;
  const store = opcoes.store instanceof Map ? opcoes.store : new Map();
  let timerLimpeza = null;

  function limparExpirados() {
    const agora = agoraMs(now);
    let removidos = 0;
    for (const [handoffId, registro] of store.entries()) {
      if (!registro || registro.expiresAtMs <= agora || registro.consumidoEmMs) {
        store.delete(handoffId);
        removidos += 1;
      }
    }
    return removidos;
  }

  function iniciarLimpezaPeriodica(intervaloMs = LIMPEZA_PADRAO_MS) {
    if (timerLimpeza || intervaloMs <= 0) return timerLimpeza;
    timerLimpeza = setInterval(limparExpirados, intervaloMs);
    if (typeof timerLimpeza.unref === "function") timerLimpeza.unref();
    return timerLimpeza;
  }

  function pararLimpezaPeriodica() {
    if (timerLimpeza) clearInterval(timerLimpeza);
    timerLimpeza = null;
  }

  function obterAtivo(handoffId = "") {
    limparExpirados();
    const id = texto(handoffId);
    const registro = store.get(id);
    if (!registro) throw erro("capture_handoff_nao_encontrado", 404);
    if (registro.consumidoEmMs) throw erro("capture_handoff_ja_consumido", 409);
    if (registro.expiresAtMs <= agoraMs(now)) {
      store.delete(id);
      throw erro("capture_handoff_expirado", 410);
    }
    return registro;
  }

  function iniciarHandoff({ state = "", codeChallenge = "" } = {}) {
    const stateTexto = texto(state);
    const challengeTexto = texto(codeChallenge);
    if (!tokenTecnicoValido(stateTexto)) throw erro("capture_handoff_state_invalido", 400);
    if (!tokenTecnicoValido(challengeTexto, { min: 32, max: 128 })) {
      throw erro("capture_handoff_challenge_invalido", 400);
    }

    const inicioMs = agoraMs(now);
    const handoffId = tokenSeguro(32);
    const registro = {
      handoffId,
      state: stateTexto,
      codeChallenge: challengeTexto,
      criadoEmMs: inicioMs,
      expiresAtMs: inicioMs + ttlMs,
      autorizadoEmMs: 0,
      clienteId: "",
      consumidoEmMs: 0
    };
    store.set(handoffId, registro);
    return {
      handoffId,
      state: stateTexto,
      expiresAt: new Date(registro.expiresAtMs).toISOString(),
      ttlMs
    };
  }

  function autorizarHandoff({ handoffId = "", state = "", clienteId = "" } = {}) {
    const registro = obterAtivo(handoffId);
    if (registro.state !== texto(state)) throw erro("capture_handoff_state_invalido", 400);
    const cliente = texto(clienteId);
    if (!cliente) throw erro("cliente_nao_autenticado", 401);
    registro.clienteId = cliente;
    registro.autorizadoEmMs = agoraMs(now);
    store.set(registro.handoffId, registro);
    return {
      handoffId: registro.handoffId,
      autorizado: true,
      expiresAt: new Date(registro.expiresAtMs).toISOString()
    };
  }

  function validarTrocaHandoff({ handoffId = "", state = "", codeVerifier = "" } = {}) {
    const registro = obterAtivo(handoffId);
    if (registro.state !== texto(state)) throw erro("capture_handoff_state_invalido", 400);
    if (!registro.autorizadoEmMs || !registro.clienteId) {
      throw erro("capture_handoff_nao_autorizado", 409);
    }
    const verifier = texto(codeVerifier);
    if (!tokenTecnicoValido(verifier, { min: 32, max: 256 })) {
      throw erro("capture_handoff_verifier_invalido", 401);
    }
    const challengeCalculado = hashCodeChallenge(verifier);
    if (challengeCalculado !== registro.codeChallenge) {
      throw erro("capture_handoff_verifier_invalido", 401);
    }
    return {
      handoffId: registro.handoffId,
      clienteId: registro.clienteId,
      expiresAt: new Date(registro.expiresAtMs).toISOString()
    };
  }

  function consumirHandoff(handoffId = "") {
    const registro = obterAtivo(handoffId);
    registro.consumidoEmMs = agoraMs(now);
    store.delete(registro.handoffId);
    return true;
  }

  if (opcoes.limpezaPeriodica !== false) {
    iniciarLimpezaPeriodica(Number(opcoes.limpezaIntervaloMs || LIMPEZA_PADRAO_MS));
  }

  return {
    iniciarHandoff,
    autorizarHandoff,
    validarTrocaHandoff,
    consumirHandoff,
    limparExpirados,
    iniciarLimpezaPeriodica,
    pararLimpezaPeriodica,
    _store: store
  };
}

module.exports = {
  TTL_PADRAO_MS,
  criarCaptureHandoffService,
  hashCodeChallenge,
  tokenSeguro
};
