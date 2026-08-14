"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");

const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

const rotasLegadasFila = [
  { metodo: "post", rota: "/fila" },
  { metodo: "get", rota: "/fila" },
  { metodo: "delete", rota: "/fila/item/:id" },
  { metodo: "delete", rota: "/fila/limpar" },
  { metodo: "delete", rota: "/fila/:index" },
  { metodo: "post", rota: "/fila/:id/reprocessar" },
  { metodo: "post", rota: "/fila/item/:id/enviar-agora" },
  { metodo: "post", rota: "/fila/:index/enviar-agora" }
];

function escaparRegex(texto = "") {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function encontrarDeclaracaoRota({ metodo, rota }) {
  const regex = new RegExp(`app\\.${metodo}\\("${escaparRegex(rota)}",\\s*auth\\s*,`);
  const match = fonteIndex.match(regex);
  assert(match, `${metodo.toUpperCase()} ${rota} deve declarar auth explicitamente`);
  return match.index;
}

function trechoRota(indiceInicio) {
  const proximaRota = fonteIndex.slice(indiceInicio + 1).search(/\napp\.(get|post|delete|put|patch)\("/);
  if (proximaRota === -1) return fonteIndex.slice(indiceInicio);
  return fonteIndex.slice(indiceInicio, indiceInicio + 1 + proximaRota);
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
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

function criarAppFilaProtegida() {
  const app = express();
  app.use(express.json());

  function authFila(req, res, next) {
    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || token === "invalido" || token.startsWith("tel_")) {
      return res.status(401).json({ ok: false, erro: "nao_autorizado" });
    }
    req.clienteId = token;
    return next();
  }

  function getClienteId(req) {
    return req.clienteId;
  }

  for (const rota of rotasLegadasFila) {
    app[rota.metodo](rota.rota, authFila, (req, res) => {
      res.json({
        ok: true,
        clienteId: getClienteId(req)
      });
    });
  }

  return app;
}

(async () => {
  const indiceAuthGlobal = fonteIndex.indexOf("app.use(auth);");
  assert(indiceAuthGlobal > 0, "middleware global auth deve continuar existindo");

  for (const rota of rotasLegadasFila) {
    const indiceRota = encontrarDeclaracaoRota(rota);
    assert(
      indiceRota < indiceAuthGlobal,
      `${rota.metodo.toUpperCase()} ${rota.rota} segue legado antes do auth global, mas protegido por auth local`
    );

    const bloco = trechoRota(indiceRota);
    assert(
      !/req\.(query|body)\??\.clienteId|req\.(query|body)\[['"]clienteId['"]\]/.test(bloco),
      `${rota.metodo.toUpperCase()} ${rota.rota} nao pode aceitar clienteId de query/body`
    );
    assert(
      /getClienteId\(req\)/.test(bloco),
      `${rota.metodo.toUpperCase()} ${rota.rota} deve resolver workspace pela identidade autenticada`
    );
  }

  const { normalizarOfertaManual } = require("../marketplaces/manual/normalizar-oferta");
  const oferta = normalizarOfertaManual(
    {
      titulo: "Oferta teste",
      clienteId: "user_b",
      link: "https://example.com/produto"
    },
    {
      clienteId: "user_a"
    }
  );
  assert.strictEqual(oferta.clienteId, "user_a", "POST /fila nao pode usar clienteId vindo do body");

  const appProtegido = criarAppFilaProtegida();
  for (const rota of rotasLegadasFila) {
    const caminho = rota.rota
      .replace(":id", "item_a")
      .replace(":index", "0");
    const metodo = rota.metodo.toUpperCase();
    const semToken = await request(appProtegido, metodo, caminho);
    assert.strictEqual(semToken.status, 401, `${metodo} ${rota.rota} sem token deve retornar 401`);
    const invalido = await request(appProtegido, metodo, caminho, { token: "invalido" });
    assert.strictEqual(invalido.status, 401, `${metodo} ${rota.rota} token invalido deve retornar 401`);
    const tokenCodex = await request(appProtegido, metodo, caminho, { token: "tel_codigo_vazado" });
    assert.strictEqual(tokenCodex.status, 401, `${metodo} ${rota.rota} token de auditoria deve retornar 401`);
    const valido = await request(appProtegido, metodo, `${caminho}?clienteId=user_b`, {
      token: "user_a",
      body: rota.metodo === "get" ? undefined : { clienteId: "user_b", id: "item_b" }
    });
    assert.strictEqual(valido.status, 200, `${metodo} ${rota.rota} token valido deve seguir funcionando`);
    assert.strictEqual(valido.body.clienteId, "user_a", `${metodo} ${rota.rota} deve operar somente workspace autenticado`);
  }

  console.log("fila-rotas-auth-legado.test.js OK");
})().catch(e => {
  console.error(e);
  process.exit(1);
});
