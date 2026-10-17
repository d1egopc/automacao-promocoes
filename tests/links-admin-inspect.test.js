"use strict";

const assert = require("node:assert/strict");
const express = require("express");
const { criarRotasResolversDinamicos } = require("../modules/radar/redirect/dynamic-resolver-admin.routes");

async function main() {
  const calls = [];
  const registry = { listar: () => [], adicionarRascunho: () => { throw Error("UNEXPECTED_WRITE"); } };
  const app = express();
  app.use(express.json());
  app.use("/admin/links/resolvers", (req, res, next) =>
    req.get("x-admin-master") === "yes" ? next() : res.status(403).json({ erro: "FORBIDDEN" }),
  criarRotasResolversDinamicos({ registry, resolveInspecao: async (url, options) => {
    calls.push({ url, options });
    if (url.includes("timeout")) return { ok: false, urlFinal: url, metodo: "erro_http",
      motivo: "redirect_timeout", statusHttp: "", erro: "token=nao_expor" };
    if (url.includes("unknown")) return { ok: false, urlFinal: url, metodo: "erro_http",
      motivo: "segredo=nao_expor" };
    if (url.includes("amazon.com.br")) return { ok: false, urlFinal: url, metodo: "html_sem_redirect",
      statusHttp: 200, motivo: "redirect_nao_resolvido" };
    if (url.includes("intermediario")) return { ok: false, urlFinal: "https://ponte.example/salto?token=privado",
      metodo: "html_sem_redirect", motivo: "redirect_nao_resolvido" };
    return { ok: true, urlFinal: "https://www.amazon.com.br/dp/B012345678?tag=privado",
      urlExpandida: "https://www.amazon.com.br/dp/B012345678?tag=privado",
      marketplaceDetectado: "amazon", metodo: "http_redirect", motivo: "redirect_resolvido_marketplace" };
  } }));
  const server = await new Promise(resolve => {
    const opened = app.listen(0, "127.0.0.1", () => resolve(opened));
  });
  const base = `http://127.0.0.1:${server.address().port}/admin/links/resolvers/inspect`;
  async function request(urlExemplo, admin = true) {
    const response = await fetch(base, { method: "POST", headers: {
      "content-type": "application/json", "x-admin-master": admin ? "yes" : "no"
    }, body: JSON.stringify({ urlExemplo }) });
    return { status: response.status, body: await response.json() };
  }
  try {
    assert.equal((await request("https://tidd.ly/um", false)).status, 403);
    assert.equal(calls.length, 0);
    assert.equal((await request("http://127.0.0.1/private")).status, 400);
    assert.equal(calls.length, 0);
    const candidate = await request("https://tidd.ly/um?token=privado");
    assert.equal(candidate.status, 200);
    assert.equal(candidate.body.estado, "oferta_candidata");
    assert.equal(candidate.body.marketplaceCandidato, "amazon");
    assert.equal(candidate.body.marketplaceReconhecido, "amazon");
    assert.equal(candidate.body.rascunhoElegivel, false, "query nao vira familia permanente");
    assert.equal(candidate.body.produtoConfirmado, false);
    assert.equal(candidate.body.afiliacaoConfirmada, false);
    assert.equal(candidate.body.prontoComercial, false);
    assert.equal(candidate.body.urlOriginalSanitizada, "tidd.ly/[redacted]");
    assert.equal(candidate.body.urlExpandidaSanitizada, "www.amazon.com.br/dp/[redacted]");
    assert.doesNotMatch(JSON.stringify(candidate.body), /privado|B012345678|tag=/);
    const draftable = await request("https://tidd.ly/um");
    assert.equal(draftable.body.rascunhoElegivel, true);
    assert.equal(draftable.body.familia.pathPrefix, "/");
    const direct = await request("https://www.amazon.com.br/dp/B012345678");
    assert.equal(direct.body.marketplaceReconhecido, "amazon");
    assert.equal(direct.body.marketplaceCandidato, "nao_comprovado");
    assert.equal(direct.body.produtoConfirmado, false);
    assert.equal(direct.body.rascunhoElegivel, false);
    const unknown = await request("https://ponte.example/intermediario");
    assert.equal(unknown.body.estado, "link_intermediario");
    assert.equal(unknown.body.motivoTecnico, "html_destino_nao_identificado");
    const timeout = await request("https://ponte.example/timeout");
    assert.equal(timeout.body.estado, "falha_resolucao");
    assert.equal(timeout.body.motivoTecnico, "redirect_timeout");
    assert.doesNotMatch(JSON.stringify(timeout.body), /nao_expor/);
    const unexpected = await request("https://ponte.example/unknown");
    assert.equal(unexpected.body.motivoTecnico, "redirect_falha_nao_classificada");
    assert.doesNotMatch(JSON.stringify(unexpected.body), /nao_expor/);
    assert.equal(calls.every(call => call.options.secureDynamic === true &&
      call.options.descobertaContextual === true && call.options.maxRedirects === 5), true);
    console.log("links-admin-inspect PASS");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
