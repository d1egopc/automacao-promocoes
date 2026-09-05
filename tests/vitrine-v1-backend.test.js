"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const criarRotasVitrine = require("../modules/vitrine/routes");
const storage = require("../modules/vitrine/storage");

const raiz = path.resolve(__dirname, "..");
const ler = (relativo) => fs.readFileSync(path.join(raiz, relativo), "utf8");

function clone(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function criarDeps() {
  const globais = new Map();
  const clientes = new Map();

  function chaveCliente(clienteId, arquivo) {
    return `${clienteId}:${arquivo}`;
  }

  return {
    globais,
    clientes,
    readGlobalJson(arquivo, fallback) {
      return globais.has(arquivo) ? clone(globais.get(arquivo)) : clone(fallback);
    },
    writeGlobalJson(arquivo, dados) {
      globais.set(arquivo, clone(dados));
    },
    readClienteJson(clienteId, arquivo, fallback) {
      const chave = chaveCliente(clienteId, arquivo);
      return clientes.has(chave) ? clone(clientes.get(chave)) : clone(fallback);
    },
    writeClienteJson(clienteId, arquivo, dados) {
      clientes.set(chaveCliente(clienteId, arquivo), clone({ ...dados, clienteId }));
    }
  };
}

function request(app, metodo, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const endereco = server.address();
      const payload = body ? JSON.stringify(body) : "";
      const req = require("http").request({
        hostname: "127.0.0.1",
        port: endereco.port,
        path: url,
        method: metodo,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...headers
        }
      }, (res) => {
        let dados = "";
        res.on("data", (chunk) => { dados += chunk; });
        res.on("end", () => {
          server.close();
          resolve({
            status: res.statusCode,
            body: dados ? JSON.parse(dados) : null
          });
        });
      });
      req.on("error", (erro) => {
        server.close();
        reject(erro);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function requestRaw(app, metodo, url, body = Buffer.alloc(0), headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const endereco = server.address();
      const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ""));
      const req = require("http").request({
        hostname: "127.0.0.1",
        port: endereco.port,
        path: url,
        method: metodo,
        headers: {
          "content-length": payload.length,
          ...headers
        }
      }, (res) => {
        let dados = "";
        res.on("data", (chunk) => { dados += chunk; });
        res.on("end", () => {
          server.close();
          resolve({
            status: res.statusCode,
            body: dados ? JSON.parse(dados) : null
          });
        });
      });
      req.on("error", (erro) => {
        server.close();
        reject(erro);
      });
      if (payload.length) req.write(payload);
      req.end();
    });
  });
}

function png() {
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(16)]);
}

async function main() {
  assert.strictEqual(storage.normalizarSlug("Minha Vitrine Oficial"), "minha-vitrine-oficial");
  assert.throws(() => storage.normalizarSlug("admin"), /slug_reservado/);
  assert.throws(() => storage.normalizarUrlHttps("javascript:alert(1)", "whatsapp"), /whatsapp_invalida/);
  assert.throws(() => storage.normalizarUrlHttps("http://example.com", "logo"), /logo_invalida/);

  const deps = criarDeps();
  storage.salvarConfigVitrine("cliente-a", {
    ativa: true,
    slug: "loja-a",
    nomePublico: "Loja A",
    logo: "https://cdn.example.com/logo.png",
    descricao: "Ofertas oficiais",
    links: {
      whatsapp: "https://wa.me/5500000000000",
      telegram: "https://t.me/lojaa",
      instagram: "https://instagram.com/lojaa",
      discord: "https://discord.gg/lojaa"
    }
  }, deps);

  assert.throws(
    () => storage.salvarConfigVitrine("cliente-b", { ativa: true, slug: "loja-a", nomePublico: "Outra" }, deps),
    /slug_indisponivel/,
    "Slug deve ser unico globalmente"
  );

  assert.throws(
    () => storage.salvarConfigVitrine("cliente-sem-slug", { ativa: true, nomePublico: "Sem slug" }, deps),
    /slug_obrigatorio/,
    "Vitrine ativa deve exigir slug publico"
  );

  const edicaoParcial = storage.salvarConfigVitrine("cliente-a", { nomePublico: "Loja A Editada" }, deps);
  assert.strictEqual(edicaoParcial.config.ativa, true, "Edicao parcial nao deve desativar a vitrine");
  assert.strictEqual(edicaoParcial.config.slug, "loja-a", "Edicao parcial deve preservar slug");

  const publica = storage.buscarVitrinePublicaPorSlug("loja-a", deps);
  assert.strictEqual(publica.slug, "loja-a");
  assert.strictEqual(publica.nomePublico, "Loja A Editada");
  assert.ok(!Object.prototype.hasOwnProperty.call(publica, "clienteId"), "Payload publico nao expoe workspace");

  storage.salvarConfigVitrine("cliente-inativo", {
    ativa: false,
    slug: "loja-inativa",
    nomePublico: "Inativa"
  }, deps);
  assert.strictEqual(storage.buscarVitrinePublicaPorSlug("loja-inativa", deps), null);

  const agora = Date.now();
  const ofertas = [];
  for (let i = 0; i < 192; i += 1) {
    ofertas.push({
      id: `oferta-${i}`,
      titulo: `Oferta ${i}`,
      marketplace: "Shopee",
      categoria: "Eletronicos",
      imagem: "https://cdn.example.com/oferta.jpg",
      ultimoEnvioEm: new Date(agora - i * 1000).toISOString(),
      clienteId: "cliente-a",
      engineJobId: `job-${i}`,
      token: "segredo",
      destinosEnviados: [{ id: "destino" }],
      linksComerciais: [
        { papel: "produto", urlOptimus: "https://go.optimuspromo.com.br/r/abc123", renderizavel: true },
        { papel: "tecnico", url: "https://shopee.com.br/produto-direto", renderizavel: true }
      ]
    });
  }
  ofertas.push({
    id: "velha",
    titulo: "Oferta velha",
    ultimoEnvioEm: new Date(agora - 73 * 60 * 60 * 1000).toISOString()
  });

  const retidas = storage.aplicarRetencaoOfertas(ofertas, agora);
  assert.strictEqual(retidas.length, storage.VITRINE_MAX_OFERTAS, "Retencao deve limitar a 192 ofertas");
  assert.ok(!retidas.some((oferta) => oferta.id === "velha"), "Retencao deve remover ofertas acima de 72h");
  const comExcedente = storage.aplicarRetencaoOfertas([
    {
      id: "oferta-193",
      titulo: "Oferta 193",
      ultimoEnvioEm: new Date(agora + 1000).toISOString()
    },
    ...ofertas
  ], agora + 1000);
  assert.strictEqual(comExcedente.length, storage.VITRINE_MAX_OFERTAS, "Hard cap deve continuar limitando o estoque publico");
  assert.strictEqual(comExcedente[0].id, "oferta-193", "Oferta 193 deve entrar no topo");
  assert.ok(!comExcedente.some((oferta) => oferta.id === "oferta-191"), "Hard cap deve remover a mais antiga elegivel quando cheio");
  assert.ok(!retidas.some((oferta) => oferta.clienteId || oferta.engineJobId || oferta.token), "Payload publico deve ser sanitizado");
  assert.strictEqual(retidas[0].linksComerciais.length, 1, "CTA comercial publico deve usar apenas redirect Optimus");
  assert.strictEqual(retidas[0].linksComerciais[0].url, "https://go.optimuspromo.com.br/r/abc123");
  const pagina = storage.paginarOfertasPublicas(ofertas, { page: 2, limit: 24 });
  assert.strictEqual(pagina.ofertas.length, 24, "Paginacao publica deve respeitar limit");
  assert.strictEqual(pagina.pagination.page, 2);
  assert.strictEqual(pagina.pagination.total, storage.VITRINE_MAX_OFERTAS);
  assert.strictEqual(pagina.pagination.totalPages, 8, "192 ofertas com limit 24 devem resultar em 8 paginas");
  assert.strictEqual(pagina.ofertas[0].id, "oferta-24", "Pagina 2 deve continuar ordenada por ofertas mais novas");

  const upsertDeps = criarDeps();
  storage.salvarConfigVitrine("cliente-upsert", { ativa: true, slug: "upsert", nomePublico: "Upsert" }, upsertDeps);
  const upsert = storage.upsertOfertaVitrine("cliente-upsert", {
    id: "produto-1",
    titulo: "Produto 1",
    enviadoEm: new Date().toISOString()
  }, upsertDeps);
  assert.strictEqual(upsert.ok, true, "Storage deve estar preparado para upsert isolado pos-envio");

  const appAuth = express();
  appAuth.use(express.json());
  appAuth.use((req, _res, next) => {
    req.usuario = { id: req.headers["x-cliente"] || "cliente-a", papel: req.headers["x-papel"] || "usuario" };
    req.clienteId = req.usuario.id;
    next();
  });
  appAuth.use(criarRotasVitrine({
    ...deps,
    getClienteId: (req) => req.clienteId,
    usuarioTemRecurso: (req, recurso) => recurso === "vitrine" && req.headers["x-vitrine"] === "1"
  }));

  const semRecurso = await request(appAuth, "GET", "/vitrine", null, { "x-cliente": "cliente-a" });
  assert.strictEqual(semRecurso.status, 403);
  assert.strictEqual(semRecurso.body.codigo, "recurso_nao_disponivel_no_plano");

  const comRecurso = await request(appAuth, "GET", "/vitrine", null, { "x-cliente": "cliente-a", "x-vitrine": "1" });
  assert.strictEqual(comRecurso.status, 200);
  assert.strictEqual(comRecurso.body.config.slug, "loja-a");

  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-vitrine-logo-"));
  const envStorageDir = process.env.SOCIAL_MEDIA_STORAGE_DIR;
  const envStorageBase = process.env.SOCIAL_MEDIA_PUBLIC_BASE_URL;
  const envStorageMax = process.env.SOCIAL_MEDIA_MAX_BYTES;
  try {
    process.env.SOCIAL_MEDIA_STORAGE_DIR = storageDir;
    process.env.SOCIAL_MEDIA_PUBLIC_BASE_URL = "https://cdn-media.optimus.test/social/midia/publica/";
    process.env.SOCIAL_MEDIA_MAX_BYTES = String(7 * 1024 * 1024);

    const logoUpload = await requestRaw(appAuth, "POST", "/vitrine/logo/upload", png(), {
      "content-type": "image/png",
      "x-cliente": "cliente-a",
      "x-vitrine": "1"
    });
    assert.strictEqual(logoUpload.status, 200);
    assert.ok(logoUpload.body.logoUrl.includes("/cliente-a/vitrine_logo_"), "Upload deve retornar logoUrl publica por workspace");

    const logoSemRecurso = await requestRaw(appAuth, "POST", "/vitrine/logo/upload", png(), {
      "content-type": "image/png",
      "x-cliente": "cliente-a"
    });
    assert.strictEqual(logoSemRecurso.status, 403, "Upload de logo deve exigir recurso vitrine");

    const logoTipoInvalido = await requestRaw(appAuth, "POST", "/vitrine/logo/upload", Buffer.from("gif89"), {
      "content-type": "image/gif",
      "x-cliente": "cliente-a",
      "x-vitrine": "1"
    });
    assert.strictEqual(logoTipoInvalido.status, 400, "Upload deve aceitar somente JPEG/PNG/WebP");
  } finally {
    if (envStorageDir === undefined) delete process.env.SOCIAL_MEDIA_STORAGE_DIR;
    else process.env.SOCIAL_MEDIA_STORAGE_DIR = envStorageDir;
    if (envStorageBase === undefined) delete process.env.SOCIAL_MEDIA_PUBLIC_BASE_URL;
    else process.env.SOCIAL_MEDIA_PUBLIC_BASE_URL = envStorageBase;
    if (envStorageMax === undefined) delete process.env.SOCIAL_MEDIA_MAX_BYTES;
    else process.env.SOCIAL_MEDIA_MAX_BYTES = envStorageMax;
    fs.rmSync(storageDir, { recursive: true, force: true });
  }

  storage.salvarVitrineWorkspace("cliente-a", {
    ...storage.lerVitrineWorkspace("cliente-a", deps),
    ofertas
  }, deps);

  const appPublico = express();
  appPublico.use(criarRotasVitrine({ publico: true, ...deps }));
  const publicoOk = await request(appPublico, "GET", "/v/loja-a?page=2&limit=24");
  assert.strictEqual(publicoOk.status, 200);
  assert.strictEqual(publicoOk.body.vitrine.slug, "loja-a");
  assert.strictEqual(publicoOk.body.vitrine.ofertas.length, 24);
  assert.strictEqual(publicoOk.body.vitrine.pagination.page, 2);
  assert.strictEqual(publicoOk.body.vitrine.pagination.total, storage.VITRINE_MAX_OFERTAS);
  assert.strictEqual(publicoOk.body.vitrine.pagination.totalPages, 8);

  const publicoInativo = await request(appPublico, "GET", "/v/loja-inativa");
  assert.strictEqual(publicoInativo.status, 404);

  const index = ler("index.js");
  assert.ok(index.includes('require("./modules/vitrine/routes")'), "index deve montar modulo de vitrine");
  assert.ok(index.includes('vitrine: booleanPlano("vitrine"'), "Admin Master deve poder habilitar recurso vitrine por plano");
  assert.ok(index.includes("normalizarRecursosPlanosRuntime"), "Planos existentes devem expor recursos.vitrine=false no runtime");
  assert.ok(index.includes("app.use(criarRotasVitrine({"), "Rotas de vitrine devem estar registradas");
  assert.ok(
    index.indexOf("publico: true") > 0 && index.indexOf("publico: true") < index.indexOf("app.use(auth);"),
    "GET /v/:slug deve ficar antes do auth"
  );

  const routes = ler("modules/vitrine/routes.js");
  assert.ok(routes.includes('router.get("/v/:slug"'), "Endpoint publico GET /v/:slug deve existir");
  assert.ok(routes.includes('router.get("/vitrine"'), "GET autenticado /vitrine deve existir");
  assert.ok(routes.includes('"/vitrine/logo/upload"'), "Upload de logo da Vitrine deve existir");
  assert.ok(routes.includes('router.put("/vitrine/config"'), "PUT autenticado /vitrine/config deve existir");
  assert.ok(routes.includes('usuarioTemRecurso(req, "vitrine")'), "Rotas autenticadas devem exigir recurso de plano vitrine");
  assert.ok(!routes.includes("Distributor") && !routes.includes("FANOUT") && !routes.includes("Executor"), "Vitrine nao deve tocar fluxo operacional");

  console.log("vitrine-v1-backend.test.js OK");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
