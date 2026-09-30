"use strict";

const fs = require("fs");
const { StringDecoder } = require("string_decoder");

const DEFAULT_CHUNK_BYTES = 1024 * 1024;
const MAX_STRING_LENGTH = require("buffer").constants.MAX_STRING_LENGTH;

function ehEspacoJson(caractere) {
  return caractere === " " || caractere === "\n" || caractere === "\r" || caractere === "\t";
}

function erroJson(motivo, mensagem = motivo) {
  const erro = new SyntaxError(mensagem);
  erro.code = motivo;
  return erro;
}

function criarLeitorArray(maxItemChars = MAX_STRING_LENGTH - 1) {
  let fase = "antes_raiz";
  let fechado = false;
  let esperandoValor = true;
  let emString = false;
  let escapado = false;
  let profundidade = 0;
  let partesItem = [];
  let caracteresItem = 0;
  let itens = 0;
  let valorAtual = "";

  function anexarCaractere(caractere) {
    caracteresItem += caractere.length;
    if (caracteresItem > maxItemChars) {
      throw erroJson("JSON_ITEM_TOO_LARGE", "json_array_item_too_large");
    }
    partesItem.push(caractere);
  }

  function iniciarItem(caractere) {
    partesItem = [];
    caracteresItem = 0;
    emString = false;
    escapado = false;
    profundidade = 0;
    anexarCaractere(caractere);
    if (caractere === "\"") emString = true;
    if (caractere === "{" || caractere === "[") profundidade = 1;
  }

  function finalizarItem(parseItem) {
    const texto = partesItem.join("");
    const iniciado = process.hrtime.bigint();
    let valor;
    try {
      valor = JSON.parse(texto);
    } catch (erro) {
      erro.code = erro.code || "JSON_ITEM_INVALID";
      throw erro;
    } finally {
      parseItem(Number(process.hrtime.bigint() - iniciado) / 1e6);
    }
    partesItem = [];
    caracteresItem = 0;
    itens += 1;
    valorAtual = valor;
    return valor;
  }

  function processar(texto, onItem, metricas) {
    for (let indice = 0; indice < texto.length; indice += 1) {
      const caractere = texto[indice];

      if (fase === "antes_raiz") {
        if (ehEspacoJson(caractere)) continue;
        if (caractere !== "[") throw erroJson("JSON_ROOT_NOT_ARRAY", "json_array_root_not_array");
        fase = "dentro_raiz";
        esperandoValor = true;
        continue;
      }

      if (fechado) {
        if (ehEspacoJson(caractere)) continue;
        throw erroJson("JSON_TRAILING_DATA", "json_array_trailing_data");
      }

      if (!partesItem.length) {
        if (ehEspacoJson(caractere)) continue;
        if (caractere === "]") {
          if (!esperandoValor || itens > 0) {
            throw erroJson("JSON_TRAILING_COMMA", "json_array_trailing_comma");
          }
          fechado = true;
          continue;
        }
        if (caractere === ",") throw erroJson("JSON_UNEXPECTED_COMMA", "json_array_unexpected_comma");
        iniciarItem(caractere);
        esperandoValor = false;
        continue;
      }

      if (emString) {
        anexarCaractere(caractere);
        if (escapado) {
          escapado = false;
        } else if (caractere === "\\") {
          escapado = true;
        } else if (caractere === "\"") {
          emString = false;
        }
        continue;
      }

      if (caractere === "\"") {
        emString = true;
        anexarCaractere(caractere);
        continue;
      }
      if (caractere === "{" || caractere === "[") {
        profundidade += 1;
        anexarCaractere(caractere);
        continue;
      }
      if (caractere === "}" || caractere === "]") {
        if (profundidade > 0) {
          profundidade -= 1;
          anexarCaractere(caractere);
          continue;
        }
        if (caractere === "}") {
          anexarCaractere(caractere);
          continue;
        }
        const valor = finalizarItem(ms => { metricas.parseMs += ms; });
        onItem(valor, itens - 1);
        esperandoValor = false;
        fechado = true;
        continue;
      }
      if (caractere === "," && profundidade === 0) {
        const valor = finalizarItem(ms => { metricas.parseMs += ms; });
        onItem(valor, itens - 1);
        esperandoValor = true;
        continue;
      }
      anexarCaractere(caractere);
    }
  }

  function finalizar(onItem, metricas) {
    if (fase === "antes_raiz") throw erroJson("JSON_TRUNCATED", "json_array_truncated");
    if (emString || profundidade !== 0 || partesItem.length) {
      throw erroJson("JSON_TRUNCATED", "json_array_truncated");
    }
    if (!fechado) throw erroJson("JSON_TRUNCATED", "json_array_truncated");
    void onItem;
    void metricas;
    return { itens, valorAtual };
  }

  return { processar, finalizar };
}

function lerArrayJsonIncremental(fd, opcoes = {}) {
  const chunkBytes = Math.max(1, Number(opcoes.chunkBytes || DEFAULT_CHUNK_BYTES));
  const maxItemChars = Math.max(1, Number(opcoes.maxItemChars || MAX_STRING_LENGTH - 1));
  const onItem = typeof opcoes.onItem === "function" ? opcoes.onItem : () => {};
  const decoder = new StringDecoder("utf8");
  const leitor = criarLeitorArray(maxItemChars);
  const buffer = Buffer.allocUnsafe(chunkBytes);
  const metricas = { bytes: 0, readMs: 0, parseMs: 0 };

  while (true) {
    const inicio = process.hrtime.bigint();
    const lidos = fs.readSync(fd, buffer, 0, buffer.length, null);
    metricas.readMs += Number(process.hrtime.bigint() - inicio) / 1e6;
    if (!lidos) break;
    metricas.bytes += lidos;
    leitor.processar(decoder.write(buffer.subarray(0, lidos)), onItem, metricas);
  }
  leitor.processar(decoder.end(), onItem, metricas);
  return { ...leitor.finalizar(onItem, metricas), ...metricas };
}

function escreverTudo(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const escritos = fs.writeSync(fd, buffer, offset, buffer.length - offset, null);
    if (!escritos) throw new Error("json_array_write_zero_bytes");
    offset += escritos;
  }
}

function escreverArrayJsonIncremental(file, valores, opcoes = {}) {
  if (!Array.isArray(valores)) throw new TypeError("json_array_values_not_array");
  const chunkBytes = Math.max(1024, Number(opcoes.chunkBytes || DEFAULT_CHUNK_BYTES));
  const fd = fs.openSync(file, "w");
  const partes = [];
  let pendenteBytes = 0;
  let bytes = 0;
  let stringifyMs = 0;
  let writeMs = 0;

  function adicionar(texto) {
    const tamanho = Buffer.byteLength(texto, "utf8");
    partes.push(texto);
    pendenteBytes += tamanho;
    if (pendenteBytes >= chunkBytes) descarregar();
  }

  function descarregar() {
    if (!partes.length) return;
    const inicio = process.hrtime.bigint();
    const buffer = Buffer.from(partes.join(""), "utf8");
    escreverTudo(fd, buffer);
    writeMs += Number(process.hrtime.bigint() - inicio) / 1e6;
    bytes += buffer.length;
    partes.length = 0;
    pendenteBytes = 0;
  }

  try {
    if (!valores.length) {
      adicionar("[]");
    } else {
      adicionar("[\n");
      for (let indice = 0; indice < valores.length; indice += 1) {
        const valor = valores[indice];
        const inicio = process.hrtime.bigint();
        let serializado = JSON.stringify(valor, null, 2);
        if (serializado === undefined) serializado = "null";
        const indentado = serializado.split("\n").map(linha => `  ${linha}`).join("\n");
        stringifyMs += Number(process.hrtime.bigint() - inicio) / 1e6;
        adicionar(`${indice ? ",\n" : ""}${indentado}`);
      }
      adicionar("\n]");
    }
    opcoes.onStringifyCompleted?.({ stringifyMs, writeMs });
    descarregar();
    fs.closeSync(fd);
    const stat = fs.statSync(file);
    if (Number(stat.size || 0) !== bytes) throw new Error("json_array_size_mismatch");
    return { bytes, itens: valores.length, stringifyMs, writeMs, identity: stat };
  } catch (erro) {
    try { fs.closeSync(fd); } catch {}
    throw erro;
  }
}

module.exports = {
  DEFAULT_CHUNK_BYTES,
  lerArrayJsonIncremental,
  escreverArrayJsonIncremental
};
