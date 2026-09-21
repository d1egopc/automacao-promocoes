"use strict";

const crypto = require("crypto");

const ENVELOPE_VERSION = 1;
const KEY_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const MASTER_KEY_ENV = "TELEGRAM_ACCOUNT_MASTER_KEY";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAX_CIPHERTEXT_BYTES = 1024 * 1024;
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;

function envelopeError() {
  return new Error("telegram_session_envelope_invalido");
}

function decodeBase64Strict(value) {
  if (typeof value !== "string" || !value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw envelopeError();
  }
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.toString("base64") !== value) throw envelopeError();
  return decoded;
}

function masterKeyBuffer() {
  const raw = String(process.env[MASTER_KEY_ENV] || "").trim();
  if (!raw) throw new Error("telegram_account_master_key_ausente");
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  if (raw.startsWith("base64:")) {
    const encoded = raw.slice("base64:".length);
    let decoded;
    try {
      decoded = decodeBase64Strict(encoded);
    } catch {
      throw new Error("telegram_account_master_key_invalida");
    }
    if (decoded.length === 32) return decoded;
    throw new Error("telegram_account_master_key_invalida");
  }
  if (Buffer.byteLength(raw, "utf8") < 32) throw new Error("telegram_account_master_key_invalida");
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

function validarEnvelope(envelope = {}) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw envelopeError();
  let envelopeBytes;
  try {
    envelopeBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  } catch {
    throw envelopeError();
  }
  if (envelopeBytes < 1 || envelopeBytes > MAX_ENVELOPE_BYTES) throw envelopeError();
  if (envelope.version !== ENVELOPE_VERSION || envelope.algorithm !== ALGORITHM || envelope.keyVersion !== KEY_VERSION) {
    throw envelopeError();
  }
  const iv = decodeBase64Strict(envelope.iv);
  const authTag = decodeBase64Strict(envelope.authTag);
  const ciphertext = decodeBase64Strict(envelope.ciphertext);
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES || ciphertext.length > MAX_CIPHERTEXT_BYTES) {
    throw envelopeError();
  }
  return envelope;
}

function encryptSession(sessionString) {
  if (typeof sessionString !== "string" || !sessionString) throw new Error("telegram_session_ausente");
  if (Buffer.byteLength(sessionString, "utf8") > MAX_CIPHERTEXT_BYTES) throw new Error("telegram_session_excede_limite");
  const key = masterKeyBuffer();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(sessionString, "utf8"), cipher.final()]);
  return Object.freeze({
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    keyVersion: KEY_VERSION,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  });
}

function decryptSession(envelope) {
  const valid = validarEnvelope(envelope);
  const key = masterKeyBuffer();
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(valid.iv, "base64"));
    decipher.setAuthTag(Buffer.from(valid.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(valid.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch (error) {
    const falha = new Error("telegram_session_decryption_failed");
    falha.cause = error;
    throw falha;
  }
}

function createTelegramSessionVault() {
  return Object.freeze({
    encrypt: encryptSession,
    decrypt: decryptSession,
    assertMasterKey: () => { masterKeyBuffer(); return true; }
  });
}

module.exports = {
  ALGORITHM,
  ENVELOPE_VERSION,
  KEY_VERSION,
  MASTER_KEY_ENV,
  IV_BYTES,
  AUTH_TAG_BYTES,
  MAX_CIPHERTEXT_BYTES,
  masterKeyBuffer,
  validarEnvelope,
  encryptSession,
  decryptSession,
  createTelegramSessionVault
};
