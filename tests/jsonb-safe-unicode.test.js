"use strict";

const assert = require("node:assert/strict");
const { sanitizarValorJsonb, serializarJsonbSeguro } =
  require("../utils/jsonb-safe");

const high = String.fromCharCode(0xD83D);
const low = String.fromCharCode(0xDC00);
const payload = {
  texto: `Caf\u00e9 R$ 19 \ud83d\ude80 ${high} ${low} \u4e2d\u6587 \u0000`,
  links: [{ url: "https://example.test/p?x=1", metadata: [true, 7, null] }],
  aninhado: { [low]: `${high}\u00e7` },
  data: new Date("2026-10-10T12:00:00.000Z")
};
const esperado = `Caf\u00e9 R$ 19 \ud83d\ude80 \uFFFD \uFFFD \u4e2d\u6587 `;
const saneado = sanitizarValorJsonb(payload);
assert.equal(saneado.texto, esperado);
assert.equal(saneado.aninhado["\uFFFD"], "\uFFFD\u00e7");
assert.equal(saneado.data, "2026-10-10T12:00:00.000Z");
assert.deepEqual(saneado.links, payload.links);
assert.deepEqual(JSON.parse(serializarJsonbSeguro(payload, {})), saneado);
assert.equal(serializarJsonbSeguro(payload, {}), serializarJsonbSeguro(payload, {}));
assert.equal(serializarJsonbSeguro(undefined, {}), "{}");
assert.equal(serializarJsonbSeguro([false, 0, null], []), "[false,0,null]");
console.log("jsonb-safe-unicode.test.js OK");
