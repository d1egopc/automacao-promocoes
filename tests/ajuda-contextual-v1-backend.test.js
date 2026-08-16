"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const raiz = path.resolve(__dirname, "..");
const ler = (relativo) => fs.readFileSync(path.join(raiz, relativo), "utf8");
const storage = require("../modules/ajuda-contextual/storage");

const youtubeIds = [
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://youtu.be/dQw4w9WgXcQ",
  "https://www.youtube.com/embed/dQw4w9WgXcQ",
  "https://www.youtube.com/shorts/dQw4w9WgXcQ",
];

for (const url of youtubeIds) {
  const normalizado = storage.normalizarYoutubeUrl(url);
  assert.strictEqual(normalizado.youtubeVideoId, "dQw4w9WgXcQ");
  assert.strictEqual(normalizado.youtubeEmbedUrl, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
}

assert.throws(
  () => storage.normalizarYoutubeUrl("https://example.com/embed/dQw4w9WgXcQ"),
  /youtube_url_invalida/,
  "Dominio arbitrario nao pode ser aceito no iframe",
);

assert.strictEqual(
  storage.normalizarLinkUrl("https://optimuspromo.com.br/ajuda"),
  "https://optimuspromo.com.br/ajuda",
  "Link util https deve ser aceito",
);

assert.throws(
  () => storage.normalizarLinkUrl("javascript:alert(1)"),
  /link_url_invalida/,
  "Protocolo perigoso deve ser rejeitado",
);

assert.throws(
  () => storage.normalizarLinkUrl("http://optimuspromo.com.br/ajuda"),
  /link_url_invalida/,
  "Link util deve aceitar somente https",
);

assert.throws(
  () => storage.normalizarPayloadAdmin("dashboard", { titulo: "<b>Ajuda</b>", texto: "Texto", ativo: true }),
  /titulo_nao_aceita_html/,
  "Titulo com HTML deve ser rejeitado",
);

assert.throws(
  () => storage.normalizarPayloadAdmin("dashboard", { titulo: "Ajuda", texto: "<iframe src='x'></iframe>", ativo: true }),
  /texto_nao_aceita_html/,
  "Texto com iframe/HTML deve ser rejeitado",
);

assert.throws(
  () => storage.normalizarPayloadAdmin("dashboard", { titulo: "Ajuda", texto: "Texto", linkLabel: "<b>Link</b>", ativo: true }),
  /linkLabel_nao_aceita_html/,
  "Rotulo do link deve ser texto puro",
);

const envelope = storage.normalizarEnvelope({
  ajudas: {
    dashboard: { titulo: "Dashboard", texto: "Texto", ativo: true },
    "integracoes.mercadolivre": { titulo: "Mercado Livre", texto: "Texto", ativo: false },
  },
});
const ativas = storage.ajudasAtivas(envelope);
assert.ok(ativas.dashboard, "Ajuda ativa deve aparecer na leitura publica");
assert.ok(!ativas["integracoes.mercadolivre"], "Ajuda inativa nao deve aparecer na leitura publica");

const routes = ler("modules/ajuda-contextual/routes.js");
assert.ok(routes.includes('router.get("/ajuda-contextual"'), "GET publico autenticado deve existir");
assert.ok(routes.includes('router.get("/admin/ajuda-contextual"'), "GET admin deve existir");
assert.ok(routes.includes('router.put("/admin/ajuda-contextual/:helpId"'), "PUT admin por helpId deve existir");
assert.ok(routes.includes("exigirAdminMaster(req, res)"), "Edicao deve exigir admin_master");

const index = ler("index.js");
assert.ok(index.includes('require("./modules/ajuda-contextual/routes")'), "index deve montar modulo de ajuda contextual");
assert.ok(index.includes("app.use(criarRotasAjudaContextual"), "rotas de ajuda contextual devem estar registradas");

console.log("ajuda-contextual-v1-backend.test.js OK");
