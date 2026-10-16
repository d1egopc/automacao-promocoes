"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const express = require("express");
const { criarRegistroDinamico, inferirFamiliaRascunho } =
  require("../modules/radar/redirect/dynamic-resolver-registry");
const { resolverRedirectUniversal, detectarMarketplaceRedirect } =
  require("../modules/radar/redirect/redirect-resolver");
const { criarRotasResolversDinamicos } =
  require("../modules/radar/redirect/dynamic-resolver-admin.routes");
const { extrairCandidatoContextual } =
  require("../modules/radar/redirect/contextual-html-candidate");
const { criarContratoPreparacaoLinks } = require("../modules/engine/preparacao-links.service");

const arquivo = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
assert.match(arquivo, /app\.use\("\/admin\/links\/resolvers",\s*exigirAdminMasterEstrito,\s*criarRotasResolversDinamicos\(\)\)/);

function transporte(chamadas) {
  return (url, _opcoes, callback) => {
    const req = new EventEmitter();
    req.end = () => {
      chamadas.push(url.hostname);
      const codigo = url.pathname.split("/").filter(Boolean).at(-1);
      let resposta;
      if (["tidd.ly", "desc.vc"].includes(url.hostname)) {
        resposta = { status: 302, location: `https://www.amazon.com.br/dp/${codigo === "um" ? "B012345678" : "B087654321"}` };
      } else if (url.hostname === "descontos.example") {
        resposta = url.pathname === "/go/relativo"
          ? { status: 302, location: "https://www.amazon.com.br/dp/B012345678" }
          : { status: 200, body: codigo === "ambigua"
            ? '<main><h1>Ofertas do dia</h1><a href="https://www.amazon.com.br/dp/B012345678">Ver na Loja</a><a href="https://www.amazon.com.br/dp/B087654321">Ver na Loja</a></main>'
            : codigo === "relativo"
              ? '<main><div><h1>Produto relativo</h1><a href="/go/relativo">Ver na Loja</a></div></main>'
              : `<aside><a href="https://www.amazon.com.br/dp/B099999999">Ver na Loja</a></aside><main><article><h1>Produto ${codigo}</h1><a href="https://www.amazon.com.br/dp/${codigo === "um" ? "B012345678" : "B087654321"}"><span>Ver na Loja</span></a></article></main>` };
      } else resposta = { status: 200, body: "produto oficial" };
      process.nextTick(() => {
        const res = new EventEmitter();
        res.statusCode = resposta.status;
        res.headers = { location: resposta.location };
        res.complete = true;
        res.destroyed = false;
        res.destroy = () => { res.destroyed = true; };
        callback(res);
        if (resposta.body) res.emit("data", Buffer.from(resposta.body));
        res.emit("end");
      });
    };
    req.destroy = error => { if (error) req.emit("error", error); };
    return req;
  };
}

async function executar() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-links-discovery-"));
  const file = path.join(pasta, "registro.json");
  const registro = criarRegistroDinamico({ file });
  const chamadas = [];
  const deps = { lookup: async () => [{ address: "8.8.8.8", family: 4 }], requestImpl: transporte(chamadas) };
  const app = express();
  app.use(express.json());
  app.use("/admin/links/resolvers", (req, res, next) =>
    req.get("x-test-admin") === "yes" ? next() : res.status(403).json({ erro: "FORBIDDEN" }),
  criarRotasResolversDinamicos({ registry: registro, safeHttpDeps: deps }));
  const server = await new Promise(resolve => {
    const opened = app.listen(0, "127.0.0.1", () => resolve(opened));
  });
  const base = `http://127.0.0.1:${server.address().port}/admin/links/resolvers`;
  const request = async (route, body, admin = true) => {
    const response = await fetch(`${base}${route}`, { method: "POST",
      headers: { "content-type": "application/json", "x-test-admin": admin ? "yes" : "no" },
      body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.equal((await request("/discover", { urlExemplo: "https://tidd.ly/um" }, false)).status, 403);
    assert.equal(chamadas.length, 0);
    assert.deepEqual(inferirFamiliaRascunho("https://tidd.ly/um").pathPrefix, "/");
    assert.throws(() => inferirFamiliaRascunho("https://tidd.ly/um?token=privado"), /URL_EXEMPLO_INVALIDA/);
    assert.throws(() => inferirFamiliaRascunho("http://tidd.ly/um"), /URL_EXEMPLO_INVALIDA/);
    const privado = await request("/discover", { urlExemplo: "https://127.0.0.1/um" });
    assert.equal(privado.status, 400);
    assert.equal(chamadas.length, 0, "URL privada não gera HTTP");
    for (const host of ["tidd.ly", "desc.vc"]) {
      const primeira = `https://${host}/um`;
      const descoberta = await request("/discover", { urlExemplo: primeira });
      assert.equal(descoberta.status, 200);
      assert.equal(descoberta.data.ok, true);
      assert.equal(descoberta.data.metodo, "http_redirect");
      assert.equal(descoberta.data.produtoConfirmado, false);
      assert.equal(descoberta.data.afiliacaoConfirmada, false);
      assert.equal(JSON.stringify(descoberta.data).includes("B012345678"), false);
      const salvo = await request("/drafts", { urlExemplo: primeira });
      assert.equal(salvo.status, 201);
      assert.equal(salvo.data.resolver.ativo, false);
      assert.equal(registro.localizar(`https://${host}/dois`), null);
      assert.equal(criarRegistroDinamico({ file }).buscar(salvo.data.resolver.id).estado, "rascunho");
      const segundo = await request(`/drafts/${salvo.data.resolver.id}/test`,
        { urlExemplo: `https://${host}/dois` });
      assert.equal(segundo.data.reutilizavel, true);
      assert.equal(segundo.data.metodo, "http_redirect");
      const cruzado = await request(`/drafts/${salvo.data.resolver.id}/test`,
        { urlExemplo: `https://${host === "tidd.ly" ? "desc.vc" : "tidd.ly"}/dois` });
      assert.equal(cruzado.status, 400);
      assert.equal(JSON.stringify(segundo.data).includes("B087654321"), false);
    }
    const contexto = await request("/discover", { urlExemplo: "https://descontos.example/oferta/um" });
    assert.equal(contexto.data.ok, true);
    assert.equal(contexto.data.metodo, "html_contextual");
    assert.equal(contexto.data.evidencia, "cta_unica_em_produto");
    const rascunho = await request("/drafts", { urlExemplo: "https://descontos.example/oferta/um" });
    const segundoContexto = await request(`/drafts/${rascunho.data.resolver.id}/test`,
      { urlExemplo: "https://descontos.example/oferta/dois" });
    assert.equal(segundoContexto.data.reutilizavel, true);
    const ambiguo = await request("/discover", { urlExemplo: "https://descontos.example/oferta/ambigua" });
    assert.equal(ambiguo.data.ok, false);
    assert.equal(ambiguo.data.destinoCandidato, "");
    const naoSalvar = await request("/drafts", { urlExemplo: "https://descontos.example/oferta/ambigua" });
    assert.equal(naoSalvar.status, 422);
    assert.equal(registro.listar().length, 3, "destino ambíguo não persiste rascunho");
    assert.throws(() => registro.atualizar(rascunho.data.resolver.id, { ativo: true }), /RASCUNHO_NAO_HOMOLOGADO/);
    const patchAtivo = await fetch(`${base}/${rascunho.data.resolver.id}`, { method: "PATCH",
      headers: { "content-type": "application/json", "x-test-admin": "yes" },
      body: JSON.stringify({ ativo: true }) });
    assert.equal(patchAtivo.status, 400);
    assert.equal(registro.buscar(rascunho.data.resolver.id).ativo, false);
    const resolvido = await resolverRedirectUniversal("https://descontos.example/oferta/um", {
      adminValidation: true, dynamicRegistry: { localizar: () => null },
      descobertaContextual: true, safeHttpDeps: deps
    });
    const contrato = criarContratoPreparacaoLinks({ linksOriginais: ["https://descontos.example/oferta/um"],
      redirects: [resolvido] });
    assert.equal(contrato.linksOriginais.length, 1);
    assert.equal(contrato.redirects[0].metodo, "html_contextual");
    assert.equal(contrato.redirects[0].urlFinal, "https://www.amazon.com.br/dp/B012345678");
    assert.equal(contrato.linksPreparados.length, 0, "descoberta não cria link comercial");

    const slugLongo = "a".repeat(162);
    const segundoSlug = "b".repeat(162);
    const urlLonga = `https://descontos.example/promocao/${slugLongo}`;
    const familiaLonga = inferirFamiliaRascunho(urlLonga);
    assert.equal(familiaLonga.pathPrefix, "/promocao/");
    assert.equal(familiaLonga.pathMode, "one_segment_suffix");
    assert.equal(familiaLonga.urlExemplo, urlLonga);
    assert.throws(() => inferirFamiliaRascunho(`https://descontos.example/promocao/${"x".repeat(257)}`),
      /URL_EXEMPLO_INVALIDA/);
    assert.throws(() => inferirFamiliaRascunho(`https://descontos.example/${"x".repeat(65)}/produto`),
      /URL_EXEMPLO_INVALIDA/);
    const salvoLongo = await request("/drafts", { urlExemplo: urlLonga });
    assert.equal(salvoLongo.status, 201);
    assert.equal(salvoLongo.data.resolver.ativo, false);
    assert.equal(registro.localizar(`https://descontos.example/promocao/${segundoSlug}`), null);
    const reutilizado = await request(`/drafts/${salvoLongo.data.resolver.id}/test`,
      { urlExemplo: `https://descontos.example/promocao/${segundoSlug}` });
    assert.equal(reutilizado.status, 200);
    assert.equal(reutilizado.data.reutilizavel, true);
    const outroPrefixo = await request(`/drafts/${salvoLongo.data.resolver.id}/test`,
      { urlExemplo: `https://descontos.example/outro/${segundoSlug}` });
    assert.equal(outroPrefixo.status, 400);

    const baseHtml = "https://descontos.example/promocao/produto";
    const produtoComRelacionados = '<main><nav><a href="https://www.amazon.com.br/dp/B099999999">Ver na Loja</a></nav>' +
      '<div><div><h1>Produto principal</h1><a href="https://www.amazon.com.br/dp/B012345678">Ver na Loja</a></div></div>' +
      '<section><h2>Outras ofertas</h2><a href="https://meli.la/relacionado">Outro produto</a></section></main>';
    assert.equal(extrairCandidatoContextual(produtoComRelacionados, baseHtml,
      detectarMarketplaceRedirect).url, "https://www.amazon.com.br/dp/B012345678");
    const doisProdutos = '<main><div><h1>Produto principal</h1>' +
      '<a href="https://www.amazon.com.br/dp/B012345678">Ver na Loja</a></div>' +
      '<div><h2>Segundo produto</h2><a href="https://www.amazon.com.br/dp/B087654321">Ver na Loja</a></div></main>';
    assert.equal(extrairCandidatoContextual(doisProdutos, baseHtml, detectarMarketplaceRedirect), null);
    const relativo = '<main><div><h1>Produto principal</h1><a href="/go/produto">Ver na Loja</a></div></main>';
    assert.equal(extrairCandidatoContextual(relativo, baseHtml, detectarMarketplaceRedirect).url,
      "https://descontos.example/go/produto");
    const relativoResolvido = await request("/discover", { urlExemplo: "https://descontos.example/oferta/relativo" });
    assert.equal(relativoResolvido.data.ok, true);
    assert.equal(relativoResolvido.data.marketplaceCandidato, "amazon");
    assert.equal(relativoResolvido.data.produtoConfirmado, false);
    assert.equal(extrairCandidatoContextual('<main><a href="https://www.amazon.com.br/dp/B012345678">' +
      'Ver na Loja</a></main>', baseHtml, detectarMarketplaceRedirect), null);
    assert.equal(chamadas.length > 0, true);
    console.log("links-discovery-draft.test.js PASS");
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

executar().catch(error => { console.error(error); process.exitCode = 1; });
