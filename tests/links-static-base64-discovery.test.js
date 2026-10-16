"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const express = require("express");
const { criarRotasResolversDinamicos } = require("../modules/radar/redirect/dynamic-resolver-admin.routes");
const { extrairDestinoEstaticoHtml, resolverRedirectUniversal } =
  require("../modules/radar/redirect/redirect-resolver");

const original = "https://links-a.example/primeira";
const segundo = "https://links-b.example/segunda";
const destino = "https://meli.la/abc123";

function pagina(url = destino, modo = "replace") {
  const literal = Buffer.from(url, "utf8").toString("base64");
  const navegacao = modo === "href" ? `location.href=atob("${literal}")` :
    `window.location.replace(atob("${literal}"))`;
  return `<html><script>fetch("/tracking",{method:"POST"});` +
    `globalThis.__scriptExecutado=true;${navegacao};</script></html>`;
}

function transporte(paginas, chamadas) {
  return (url, opcoes, callback) => {
    chamadas.push({ host: url.hostname, metodo: opcoes.method });
    const req = new EventEmitter();
    req.end = () => process.nextTick(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = {};
      res.complete = true;
      res.destroyed = false;
      res.destroy = () => { res.destroyed = true; };
      callback(res);
      res.emit("data", Buffer.from(paginas.get(url.href) || "<html></html>"));
      res.emit("end");
    });
    req.destroy = error => { if (error) req.emit("error", error); };
    return req;
  };
}

async function executar() {
  const paginas = new Map([[original, pagina()], [segundo, pagina(destino, "href")]]);
  const chamadas = [];
  let destinoEndereco = "8.8.8.8";
  const deps = { lookup: async host => [{ address: host === "meli.la" ? destinoEndereco : "8.8.8.8", family: 4 }],
    requestImpl: transporte(paginas, chamadas) };
  const registro = { id: "rascunho", estado: "rascunho", ativo: false,
    host: "links-a.example", pathPrefix: "/", pathMode: "one_segment_suffix" };
  const app = express();
  app.use(express.json());
  app.use("/admin/links/resolvers", (req, res, next) =>
    req.get("x-admin") === "yes" ? next() : res.status(403).json({ erro: "FORBIDDEN" }),
  criarRotasResolversDinamicos({ registry: { buscar: id => id === registro.id ? registro : null },
    safeHttpDeps: deps, obterIdentidadeMercadoLivre: async () => {
      throw new Error("meli.la sem MLB nao consulta identidade oficial");
    } }));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}/admin/links/resolvers`;
  const post = async (route, body, admin = true) => {
    const response = await fetch(`${base}${route}`, { method: "POST",
      headers: { "content-type": "application/json", "x-admin": admin ? "yes" : "no" },
      body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.equal((await post("/discover", { urlExemplo: original }, false)).status, 403);
    assert.equal(chamadas.length, 0);
    for (const url of [original, segundo]) {
      const resposta = await post("/discover", { urlExemplo: url });
      assert.equal(resposta.status, 200);
      assert.equal(resposta.data.ok, true);
      assert.equal(resposta.data.metodo, "html_static_base64");
      assert.equal(resposta.data.marketplaceCandidato, "mercadolivre");
      assert.equal(resposta.data.produtoConfirmado, false);
      assert.equal(resposta.data.afiliacaoConfirmada, false);
    }
    assert.deepEqual(chamadas.map(item => item.metodo), ["GET", "GET"]);
    assert.equal(globalThis.__scriptExecutado, undefined);

    const previa = await post("/drafts/rascunho/engine-preview", { urlExemplo: original, papel: "pc" });
    assert.equal(previa.status, 200);
    assert.equal(previa.data.ocorrencias[0].statusDestino, "candidato_encontrado");
    assert.equal(previa.data.ocorrencias[0].metodo, "html_static_base64");
    assert.equal(previa.data.ocorrencias[0].evidenciaOficial, "nao_avaliada");
    assert.equal(previa.data.contrato.identidadesCanonicas, 0);
    assert.equal(previa.data.contrato.linksPreparados, 0);
    assert.equal(previa.data.prontoComercial, false);
    assert.equal(JSON.stringify(previa.data).includes(destino), false);

    const outro = Buffer.from("https://meli.la/outra", "utf8").toString("base64");
    const ambiguo = pagina() + `<script>location.assign(atob("${outro}"))</script>`;
    paginas.set(original, ambiguo);
    const dois = await post("/discover", { urlExemplo: original });
    assert.equal(dois.data.ok, false);
    assert.equal(dois.data.destinoCandidato, "");

    paginas.set(original, pagina() + '<main><a href="https://meli.la/outra">Outra oferta</a></main>');
    const concorrente = await post("/discover", { urlExemplo: original });
    assert.equal(concorrente.data.ok, false);
    assert.equal(concorrente.data.destinoCandidato, "");

    paginas.set(original, '<script>location.replace(atob("%%%"))</script>');
    assert.equal((await post("/discover", { urlExemplo: original })).data.ok, false);
    paginas.set(original, pagina("https://127.0.0.1/privado"));
    assert.equal((await post("/discover", { urlExemplo: original })).data.ok, false);
    paginas.set(original, pagina("http://meli.la/inseguro"));
    assert.equal((await post("/discover", { urlExemplo: original })).data.ok, false);

    paginas.set(original, pagina());
    destinoEndereco = "127.0.0.1";
    const antesDns = chamadas.length;
    const dnsPrivado = await post("/discover", { urlExemplo: original });
    assert.equal(dnsPrivado.data.ok, false);
    assert.equal(chamadas.length, antesDns + 1, "o GET da pagina de origem ocorre uma vez");
    assert.equal(chamadas.at(-1).host, "links-a.example", "destino com DNS privado nao recebe GET");
    destinoEndereco = "8.8.8.8";

    const comercial = await resolverRedirectUniversal(original, {
      dynamicRegistry: { localizar: () => ({ id: "comercial", host: "links-a.example", pathPrefix: "/" }) },
      descobertaContextual: true, safeHttpDeps: deps
    });
    assert.equal(comercial.ok, false, "extracao estatica e exclusiva do diagnostico administrativo");
    assert.equal(globalThis.__scriptExecutado, undefined);
    assert.equal(extrairDestinoEstaticoHtml(pagina(), original)?.url, destino);
    console.log("links-static-base64-discovery.test.js PASS");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

executar().catch(error => { console.error(error); process.exitCode = 1; });
