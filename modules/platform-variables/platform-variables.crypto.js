"use strict";

const crypto = require("crypto");

const TIPOS_VARIAVEL_PLATAFORMA = Object.freeze(["text", "secret", "url", "number", "boolean"]);
const VERSAO_CHAVE_ATUAL = 1;
const ALGORITMO = "aes-256-gcm";

function normalizarNomeVariavel(nome) {
  const normalizado = String(nome || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(normalizado)) {
    const erro = new Error("Nome de variavel invalido");
    erro.codigo = "nome_invalido";
    erro.statusCode = 400;
    throw erro;
  }
  return normalizado;
}

function normalizarTipoVariavel(tipo) {
  const normalizado = String(tipo || "text").trim().toLowerCase();
  if (!TIPOS_VARIAVEL_PLATAFORMA.includes(normalizado)) {
    const erro = new Error("Tipo de variavel invalido");
    erro.codigo = "tipo_invalido";
    erro.statusCode = 400;
    throw erro;
  }
  return normalizado;
}

function normalizarValorParaArmazenamento(valor, tipo) {
  const tipoNormalizado = normalizarTipoVariavel(tipo);

  if (tipoNormalizado === "boolean") {
    if (valor === true || valor === "true" || valor === "1" || valor === 1) return "true";
    if (valor === false || valor === "false" || valor === "0" || valor === 0) return "false";
    const erro = new Error("Valor booleano invalido");
    erro.codigo = "valor_boolean_invalido";
    erro.statusCode = 400;
    throw erro;
  }

  if (tipoNormalizado === "number") {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) {
      const erro = new Error("Valor numerico invalido");
      erro.codigo = "valor_number_invalido";
      erro.statusCode = 400;
      throw erro;
    }
    return String(numero);
  }

  const texto = String(valor ?? "").trim();
  if (!texto) {
    const erro = new Error("Valor obrigatorio");
    erro.codigo = "valor_obrigatorio";
    erro.statusCode = 400;
    throw erro;
  }

  if (tipoNormalizado === "url") {
    try {
      const url = new URL(texto);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocolo_invalido");
    } catch (_erro) {
      const erro = new Error("URL invalida");
      erro.codigo = "url_invalida";
      erro.statusCode = 400;
      throw erro;
    }
  }

  return texto;
}

function converterValorDescriptografado(valor, tipo) {
  if (tipo === "boolean") return valor === "true";
  if (tipo === "number") return Number(valor);
  return valor;
}

function obterChaveMestraBuffer(env = process.env) {
  const segredo = String(env.PLATFORM_CONFIG_MASTER_KEY || "").trim();
  if (segredo.length < 32) {
    const erro = new Error("PLATFORM_CONFIG_MASTER_KEY ausente ou invalida");
    erro.codigo = "platform_config_master_key_indisponivel";
    erro.statusCode = 503;
    throw erro;
  }

  if (/^[a-f0-9]{64}$/i.test(segredo)) {
    return Buffer.from(segredo, "hex");
  }

  if (segredo.startsWith("base64:")) {
    const decodificada = Buffer.from(segredo.slice("base64:".length), "base64");
    if (decodificada.length === 32) return decodificada;
  }

  return crypto.createHash("sha256").update(segredo, "utf8").digest();
}

function validarChaveMestraDisponivel(env = process.env) {
  obterChaveMestraBuffer(env);
  return true;
}

function criptografarValor(valor, { env = process.env, keyVersion = VERSAO_CHAVE_ATUAL, randomBytes = crypto.randomBytes } = {}) {
  const chave = obterChaveMestraBuffer(env);
  const iv = randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITMO, chave, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(valor), "utf8"),
    cipher.final()
  ]);

  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion
  };
}

function descriptografarValor(registro, { env = process.env } = {}) {
  const chave = obterChaveMestraBuffer(env);
  const decipher = crypto.createDecipheriv(
    ALGORITMO,
    chave,
    Buffer.from(registro.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(registro.auth_tag || registro.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(registro.encrypted_value || registro.encryptedValue, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function mascararValorDescriptografado(valor, tipo) {
  if (tipo !== "secret") return converterValorDescriptografado(valor, tipo);
  const texto = String(valor || "");
  const sufixo = texto.length >= 4 ? texto.slice(-4) : "";
  return sufixo ? `********${sufixo}` : "********";
}

module.exports = {
  TIPOS_VARIAVEL_PLATAFORMA,
  VERSAO_CHAVE_ATUAL,
  normalizarNomeVariavel,
  normalizarTipoVariavel,
  normalizarValorParaArmazenamento,
  converterValorDescriptografado,
  validarChaveMestraDisponivel,
  criptografarValor,
  descriptografarValor,
  mascararValorDescriptografado
};
