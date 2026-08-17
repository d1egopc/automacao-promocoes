"use strict";

const assert = require("assert");
const fs = require("fs");
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
  for (let i = 0; i < 55; i += 1) {
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
    ultimoEnvioEm: new Date(agora - 25 * 60 * 60 * 1000).toISOString()
  });

  const retidas = storage.aplicarRetencaoOfertas(ofertas, agora);
  assert.strictEqual(retidas.length, storage.VITRINE_MAX_OFERTAS, "Retencao deve limitar a 50 ofertas");
  assert.ok(!retidas.some((oferta) => oferta.id === "velha"), "Retencao deve remover ofertas acima de 24h");
  assert.ok(!retidas.some((oferta) => oferta.clienteId || oferta.engineJobId || oferta.token), "Payload publico deve ser sanitizado");
  assert.strictEqual(retidas[0].linksComerciais.length, 1, "CTA comercial publico deve usar apenas redirect Optimus");
  assert.strictEqual(retidas[0].linksComerciais[0].url, "https://go.optimuspromo.com.br/r/abc123");

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

  const appPublico = express();
  appPublico.use(criarRotasVitrine({ publico: true, ...deps }));
  const publicoOk = await request(appPublico, "GET", "/v/loja-a");
  assert.strictEqual(publicoOk.status, 200);
  assert.strictEqual(publicoOk.body.vitrine.slug, "loja-a");

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
  assert.ok(routes.includes('router.put("/vitrine/config"'), "PUT autenticado /vitrine/config deve existir");
  assert.ok(routes.includes('usuarioTemRecurso(req, "vitrine")'), "Rotas autenticadas devem exigir recurso de plano vitrine");
  assert.ok(!routes.includes("Distributor") && !routes.includes("FANOUT") && !routes.includes("Executor"), "Vitrine nao deve tocar fluxo operacional");

  console.log("vitrine-v1-backend.test.js OK");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
