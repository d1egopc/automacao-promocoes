const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const indexSource = fs.readFileSync(path.join(root, "index.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(root, "utils", "mensagens-ofertas.js"), "utf8");

assert.ok(
  indexSource.includes("tituloOferta: normalizarTituloOfertaDestino(destino.tituloOferta)"),
  "contrato do destino normaliza tituloOferta"
);
assert.ok(
  indexSource.includes('destinoUsaTituloIa(destino) && !usuarioTemRecurso(req, "tituloIa")'),
  "backend bloqueia titulo IA sem recurso oficial tituloIa"
);
assert.ok(
  indexSource.includes('if (isAdminMaster(req)) return;') &&
    indexSource.includes('!usuarioTemRecurso(req, "tituloIa")'),
  "backend aceita titulo IA quando a feature oficial permite"
);
assert.ok(
  indexSource.includes('tituloIa: booleanPlano("tituloIa", recursosAnteriores.tituloIa)'),
  "edicao de plano preserva/cria recurso tituloIa"
);
assert.ok(
  !/tituloIa[\s\S]{0,160}\b(free|gratis|grátis|pro|ultimate)\b|\b(free|gratis|grátis|pro|ultimate)\b[\s\S]{0,160}tituloIa/i.test(indexSource),
  "backend nao hardcoda nome de plano para tituloIa"
);
assert.ok(
  rendererSource.includes("const ofertaApresentacao = {") &&
    rendererSource.includes("titulo: tituloApresentacao.titulo") &&
    rendererSource.includes("aplicarFatosOfcV24ComoEntrada(ofertaApresentacao)"),
  "renderer usa copia local antes dos templates"
);
assert.ok(
  !rendererSource.includes("oferta.titulo ="),
  "renderer nao atribui titulo diretamente na oferta oficial"
);

console.log("titulo-oferta-contrato-destinos.test.js OK");
