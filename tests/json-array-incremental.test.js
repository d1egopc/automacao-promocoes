"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  lerArrayJsonIncremental,
  escreverArrayJsonIncremental
} = require("../modules/fila/json-array-incremental");

function comArquivo(conteudo, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "json-array-incremental-"));
  const file = path.join(root, "fila.json");
  try {
    fs.writeFileSync(file, conteudo);
    return fn(file, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function ler(file, chunkBytes = 1) {
  const fd = fs.openSync(file, "r");
  try {
    const valores = [];
    const resultado = lerArrayJsonIncremental(fd, {
      chunkBytes,
      onItem: valor => valores.push(valor)
    });
    return { ...resultado, valores };
  } finally {
    fs.closeSync(fd);
  }
}

const esperado = [
  {
    texto: "brackets [] {}, comma, quote \\\" and slash \\\\",
    unicode: "ação 😀 漢字",
    nested: [{ ok: true }, [1, null, "x"]]
  },
  null,
  "string com [ ] { } , \\\" \\ e \\n",
  [1, { profundo: { valor: "\\u2028" } }]
];

comArquivo(JSON.stringify(esperado), file => {
  const resultado = ler(file, 1);
  assert.deepStrictEqual(resultado.valores, esperado);
  assert.strictEqual(resultado.itens, esperado.length);
  assert.strictEqual(resultado.bytes, fs.statSync(file).size);
});

comArquivo("[\"ação 😀\", {\"n\": 1}, null]", file => {
  const destino = path.join(path.dirname(file), "saida.json");
  const valores = ["ação 😀", { n: 1 }, null];
  const escrita = escreverArrayJsonIncremental(destino, valores, { chunkBytes: 7 });
  assert.strictEqual(fs.readFileSync(destino, "utf8"), JSON.stringify(valores, null, 2));
  assert.strictEqual(escrita.bytes, fs.statSync(destino).size);
});

comArquivo("[1, null, {\"ok\":true}]", file => {
  const destino = path.join(path.dirname(file), "saida.json");
  const valores = [];
  valores[0] = 1;
  valores[1] = undefined;
  valores[2] = { ok: true };
  escreverArrayJsonIncremental(destino, valores, { chunkBytes: 1 });
  assert.strictEqual(fs.readFileSync(destino, "utf8"), JSON.stringify(valores, null, 2));
});

comArquivo("[]", file => {
  assert.deepStrictEqual(ler(file).valores, []);
});

comArquivo("[\"1234567890\"]", file => {
  const fd = fs.openSync(file, "r");
  try {
    assert.throws(
      () => lerArrayJsonIncremental(fd, { maxItemChars: 4, onItem() {} }),
      erro => erro.code === "JSON_ITEM_TOO_LARGE"
    );
  } finally {
    fs.closeSync(fd);
  }
});

for (const caso of [
  ["{}", "JSON_ROOT_NOT_ARRAY"],
  ["[1,]", "JSON_TRAILING_COMMA"],
  ["[1] lixo", "JSON_TRAILING_DATA"],
  ["[", "JSON_TRUNCATED"],
  ["[1, {bad}]", "JSON_ITEM_INVALID"]
]) {
  comArquivo(caso[0], file => {
    assert.throws(() => ler(file), erro => erro.code === caso[1]);
  });
}

console.log("json-array-incremental: OK");
