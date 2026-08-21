"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const jwt = require("jsonwebtoken");

const { criarAdminMasterEstrito } = require("../utils/admin-auth-estrito");

const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

const rotasAdminLegadas = [
  { metodo: "get", rota: "/admin/usuarios", url: "/admin/usuarios" },
  { metodo: "get", rota: "/admin/planos", url: "/admin/planos" },
  { metodo: "post", rota: "/admin/planos", url: "/admin/planos", body: { nome: "Plano Teste" } },
  { metodo: "delete", rota: "/admin/planos/:nome", url: "/admin/planos/Plano%20Teste" },
  { metodo: "delete", rota: "/admin/usuarios/:id", url: "/admin/usuarios/user_teste" },
  { metodo: "post", rota: "/admin/assinaturas/:usuarioId/pagamento-simulado", url: "/admin/assinaturas/user_teste/pagamento-simulado", body: { estado: "aprovado", pagamentoId: "pay_teste" } },
  { metodo: "post", rota: "/admin/usuarios", url: "/admin/usuarios", body: { id: "user_teste" } },
  { metodo: "put", rota: "/admin/usuarios/:id", url: "/admin/usuarios/user_teste", body: { creditos: 123 } }
];

function escaparRegex(texto = "") {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function encontrarDeclaracaoRota({ metodo, rota }) {
  const regex = new RegExp(`app\\.${metodo}\\("${escaparRegex(rota)}",\\s*exigirAdminMasterEstrito\\s*,`);
  const match = fonteIndex.match(regex);
  assert(match, `${metodo.toUpperCase()} ${rota} deve declarar exigirAdminMasterEstrito explicitamente`);
  return match.index;
}

function trechoEntre(inicio, fim) {
  const ini = fonteIndex.indexOf(inicio);
  assert.ok(ini >= 0, `trecho inicial nao encontrado: ${inicio}`);
  const end = fonteIndex.indexOf(fim, ini + inicio.length);
  assert.ok(end > ini, `trecho final nao encontrado: ${fim}`);
  return fonteIndex.slice(ini, end);
}

function criarAppAdminProtegida() {
  const app = express();
  app.use(express.json());

  const secret = "segredo_teste_admin_estrito";
  const usuarios = [
    { id: "admin", papel: "admin_master", ativo: true, email: "admin@teste.local" },
    { id: "cliente", papel: "cliente", ativo: true, email: "cliente@teste.local" },
    { id: "inativo", papel: "admin_master", ativo: false, email: "inativo@teste.local" }
  ];
  const planos = { atual: { nome: "Atual" } };
  const authAdmin = criarAdminMasterEstrito({
    jwt,
    getJwtSecret: () => secret,
    getUsuarios: () => usuarios,
    usuarioEhAdminMaster: usuario => usuario?.papel === "admin_master"
  });

  app.get("/admin/usuarios", authAdmin, (_req, res) => res.json({ ok: true, usuarios }));
  app.get("/admin/planos", authAdmin, (_req, res) => res.json({ ok: true, planos, lista: Object.values(planos) }));
  app.post("/admin/planos", authAdmin, (req, res) => {
    planos[req.body.nome] = { nome: req.body.nome };
    res.json({ ok: true, plano: planos[req.body.nome] });
  });
  app.delete("/admin/planos/:nome", authAdmin, (req, res) => {
    delete planos[req.params.nome];
    res.json({ ok: true });
  });
  app.post("/admin/usuarios", authAdmin, (req, res) => {
    usuarios.push({ id: req.body.id, papel: "cliente", ativo: true });
    res.json({ ok: true });
  });
  app.put("/admin/usuarios/:id", authAdmin, (req, res) => {
    const usuario = usuarios.find(u => u.id === req.params.id);
    if (usuario) usuario.creditos = req.body.creditos;
    res.json({ ok: true, usuario });
  });
  app.delete("/admin/usuarios/:id", authAdmin, (req, res) => {
    const idx = usuarios.findIndex(u => u.id === req.params.id);
    if (idx >= 0) usuarios.splice(idx, 1);
    res.json({ ok: true });
  });
  app.post("/admin/assinaturas/:usuarioId/pagamento-simulado", authAdmin, (_req, res) => {
    res.json({ ok: true });
  });

  return {
    app,
    tokenAdmin: jwt.sign({ clienteId: "admin", papel: "admin_master" }, secret, { expiresIn: "5m" }),
    tokenCliente: jwt.sign({ clienteId: "cliente", papel: "cliente" }, secret, { expiresIn: "5m" }),
    tokenInativo: jwt.sign({ clienteId: "inativo", papel: "admin_master" }, secret, { expiresIn: "5m" })
  };
}

async function request(app, metodo, url, { token = "", body } = {}) {
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const dados = body ? Buffer.from(JSON.stringify(body)) : null;
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        path: url,
        method: metodo,
        headers: {
          ...(token ? { Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}` } : {}),
          ...(dados ? { "Content-Type": "application/json", "Content-Length": dados.length } : {})
        }
      }, res => {
        let texto = "";
        res.on("data", chunk => { texto += chunk; });
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode, body: texto ? JSON.parse(texto) : null });
        });
      });
      if (dados) req.write(dados);
      req.end();
    });
  });
}

(async () => {
  const indiceAuthGlobal = fonteIndex.indexOf("app.use(auth);");
  assert(indiceAuthGlobal > 0, "middleware global auth deve continuar existindo");

  for (const rota of rotasAdminLegadas) {
    const indiceRota = encontrarDeclaracaoRota(rota);
    assert(
      indiceRota < indiceAuthGlobal,
      `${rota.metodo.toUpperCase()} ${rota.rota} permanece antes do auth global, mas protegido pelo middleware estrito`
    );
  }

  const blocoIsAdmin = trechoEntre("function isAdminMaster(req)", "// ===================== FUNCAO USUARIO ATUAL");
  assert.ok(!blocoIsAdmin.includes("getClienteId(req)"), "isAdminMaster nao pode usar getClienteId com fallback admin");
  assert.ok(blocoIsAdmin.includes("jwt.verify(token, JWT_SECRET)"), "isAdminMaster deve validar JWT diretamente quando nao houver req.usuario");
  assert.ok(blocoIsAdmin.includes("if (!token) return false;"), "isAdminMaster anonimo deve retornar false");

  const { app, tokenAdmin, tokenCliente, tokenInativo } = criarAppAdminProtegida();

  for (const rota of rotasAdminLegadas) {
    const metodo = rota.metodo.toUpperCase();
    const semToken = await request(app, metodo, rota.url, { body: rota.body });
    assert.strictEqual(semToken.status, 401, `${metodo} ${rota.rota} sem token deve retornar 401`);

    const invalido = await request(app, metodo, rota.url, { token: "Bearer token-invalido", body: rota.body });
    assert.strictEqual(invalido.status, 401, `${metodo} ${rota.rota} token invalido deve retornar 401`);

    const inativo = await request(app, metodo, rota.url, { token: tokenInativo, body: rota.body });
    assert.strictEqual(inativo.status, 401, `${metodo} ${rota.rota} usuario inativo deve retornar 401`);

    const cliente = await request(app, metodo, rota.url, { token: tokenCliente, body: rota.body });
    assert.strictEqual(cliente.status, 403, `${metodo} ${rota.rota} cliente comum deve retornar 403`);

    const admin = await request(app, metodo, rota.url, { token: tokenAdmin, body: rota.body });
    assert.notStrictEqual(admin.status, 401, `${metodo} ${rota.rota} admin valido nao deve receber 401`);
    assert.notStrictEqual(admin.status, 403, `${metodo} ${rota.rota} admin valido nao deve receber 403`);
    assert.strictEqual(admin.body.ok, true, `${metodo} ${rota.rota} admin valido deve preservar fluxo atual`);
  }

  const getUsuarios = await request(app, "GET", "/admin/usuarios", { token: tokenAdmin });
  assert.strictEqual(getUsuarios.status, 200);
  assert.ok(Array.isArray(getUsuarios.body.usuarios), "GET usuarios deve retornar payload esperado ao Admin");

  const getPlanos = await request(app, "GET", "/admin/planos", { token: tokenAdmin });
  assert.strictEqual(getPlanos.status, 200);
  assert.ok(getPlanos.body.planos && Array.isArray(getPlanos.body.lista), "GET planos deve retornar payload esperado ao Admin");

  console.log("admin-auth-estrito.test.js OK");
})().catch(e => {
  console.error(e);
  process.exit(1);
});
