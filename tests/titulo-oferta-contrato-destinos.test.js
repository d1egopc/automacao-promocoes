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
  indexSource.includes('tituloIa: booleanPlano("tituloIa", recursosAnteriores.tituloIa)'),
  "edicao de plano preserva/cria recurso tituloIa"
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
