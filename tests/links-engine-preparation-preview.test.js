"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const express = require("express");
const { criarRegistroDinamico } = require("../modules/radar/redirect/dynamic-resolver-registry");
const { resolverRedirectUniversal } = require("../modules/radar/redirect/redirect-resolver");
const { criarRotasResolversDinamicos, montarContratoPreview } =
  require("../modules/radar/redirect/dynamic-resolver-admin.routes");

const entrada = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
assert.match(entrada, /app\.use\("\/admin\/links\/resolvers",\s*exigirAdminMasterEstrito,\s*criarRotasResolversDinamicos\(\{/);
assert.match(entrada, /obterIdentidadeMercadoLivre:\s*localWorkerService\.obterIdentidadeMercadoLivre/);
assert.match(entrada, /obterIdentidadeMagalu:\s*localWorkerService\.obterIdentidadeMagalu/);

function transporte(chamadas) {
  return (url, _opcoes, callback) => {
    const req = new EventEmitter();
    req.end = () => {
      chamadas.push(`${url.hostname}${url.pathname}`);
      const codigo = url.pathname.split("/").filter(Boolean).at(-1);
      let resposta;
      if (url.hostname === "tidd.ly") {
        resposta = { status: 302, location: `https://www.kabum.com.br/produto/${codigo === "um" ? "10101" : "20202"}` };
      } else if (url.hostname === "desc.vc") {
        resposta = { status: 302, location: `https://descontostop.example/promocao/${codigo}` };
      } else if (url.hostname === "descontostop.example") {
        resposta = { status: 200, body: codigo === "ambiguo"
          ? '<main><article><h1>Produto A</h1><a href="https://www.amazon.com.br/dp/B012345678">Ver na Loja</a></article>' +
            '<article><h2>Produto B</h2><a href="https://www.amazon.com.br/dp/B087654321">Ver na Loja</a></article></main>'
          : '<main><article><h1>Produto certo</h1><a href="https://www.amazon.com.br/dp/B012345678">' +
            'Ver na Loja</a></article></main>' };
      } else resposta = { status: 200, body: "pagina oficial" };
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
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-links-engine-preview-"));
  const file = path.join(pasta, "registro.json");
  const registry = criarRegistroDinamico({ file });
  const chamadas = [];
  const resultadosResolvidos = [];
  const deps = { lookup: async () => [{ address: "8.8.8.8", family: 4 }], requestImpl: transporte(chamadas) };
  let falhaComSegredo = false;
  const resolve = async (url, opcoes) => {
    if (falhaComSegredo) return { ok: false, urlOriginal: url, urlFinal: "", marketplaceDetectado: "",
      motivo: "token=nao-expor", metodo: "erro_resolver" };
    const resultado = await resolverRedirectUniversal(url, opcoes);
    resultadosResolvidos.push({ url, resultado });
    return resultado;
  };
  const app = express();
  app.use(express.json());
  app.use("/admin/links/resolvers", (req, res, next) =>
    req.get("x-test-admin") === "yes" ? next() : res.status(403).json({ erro: "FORBIDDEN" }),
  criarRotasResolversDinamicos({ registry, resolve, safeHttpDeps: deps }));
  const server = await new Promise(resolveServer => {
    const opened = app.listen(0, "127.0.0.1", () => resolveServer(opened));
  });
  const base = `http://127.0.0.1:${server.address().port}/admin/links/resolvers`;
  const post = async (rota, body, admin = true) => {
    const response = await fetch(`${base}${rota}`, { method: "POST",
      headers: { "content-type": "application/json", "x-test-admin": admin ? "yes" : "no" },
      body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.equal((await post("/drafts", { urlExemplo: "https://tidd.ly/um" }, false)).status, 403);
    assert.equal(chamadas.length, 0);
    const kabum = await post("/drafts", { urlExemplo: "https://tidd.ly/um" });
    assert.equal(kabum.status, 201);
    const idKabum = kabum.data.resolver.id;
    const originalRegistro = fs.readFileSync(file);
    const papeis = ["app", "pc", "moedas", "resgate", "moda"];
    const ocorrencias = papeis.map((papel, indice) => ({
      urlExemplo: `https://tidd.ly/${indice === 0 ? "um" : `outro${indice}`}`,
      papel
    }));
    const antes = chamadas.length;
    assert.equal((await post(`/drafts/${idKabum}/engine-preview`, { ocorrencias }, false)).status, 403);
    assert.equal(chamadas.length, antes, "acesso negado não chama o resolvedor");
    assert.equal((await post(`/drafts/${idKabum}/engine-preview`, { ocorrencias: [
      { urlExemplo: "https://desc.vc/um", papel: "pc" }
    ] })).status, 400);
    assert.equal(chamadas.length, antes, "familia diferente falha antes de HTTP");
    assert.equal((await post(`/drafts/${idKabum}/engine-preview`, { ocorrencias: [
      { urlExemplo: "https://tidd.ly/um?token=privado", papel: "pc" }
    ] })).status, 400);
    assert.equal((await post(`/drafts/${idKabum}/engine-preview`, { ocorrencias: [
      { urlExemplo: "https://127.0.0.1/um", papel: "pc" }
    ] })).status, 400);
    assert.equal((await post(`/drafts/${idKabum}/engine-preview`, { ocorrencias: [
      { urlExemplo: "https://tidd.ly/um", papel: "admin" }
    ] })).status, 400);
    assert.equal(chamadas.length, antes, "entradas invalidas não iniciam resolução");

    const resolvidosAntesPreview = resultadosResolvidos.length;
    const previewKabum = await post(`/drafts/${idKabum}/engine-preview`, { ocorrencias });
    assert.equal(previewKabum.status, 200);
    assert.equal(previewKabum.data.ok, true);
    assert.equal(previewKabum.data.prontoComercial, false);
    assert.equal(chamadas.length - antes, 10, "cada ocorrencia faz somente a cadeia HTTP necessaria");
    assert.equal(previewKabum.data.modo, "previsualizacao_sem_ingresso");
    assert.deepEqual(previewKabum.data.contrato, {
      linksOriginais: 5, destinosCandidatos: 5, linksPreparados: 0, identidadesCanonicas: 0
    });
    assert.deepEqual(previewKabum.data.ocorrencias.map(item => item.papelOriginal), papeis);
    assert(previewKabum.data.ocorrencias.every(item => item.identidade === "pendente" &&
      item.afiliacao === "nao_comprovada" && item.marketplaceCandidato === "awin" &&
      item.produtoConfirmado === false && item.afiliacaoConfirmada === false));
    assert(previewKabum.data.ocorrencias.every(item => item.statusDestino === "candidato_encontrado"));
    assert.equal(registry.buscar(idKabum).ativo, false, "preview não ativa rascunho");
    assert.deepEqual(fs.readFileSync(file), originalRegistro, "preview não grava registry");
    assert.equal(JSON.stringify(previewKabum.data).includes("10101"), false, "produto não aparece em saída administrativa");
    assert.equal(JSON.stringify(previewKabum.data).includes("20202"), false);
    assert.equal(JSON.stringify(previewKabum.data).includes("https://tidd.ly/um"), false);

    const resultadosPreview = resultadosResolvidos.slice(resolvidosAntesPreview);
    assert.equal(resultadosPreview.length, ocorrencias.length);
    const contrato = montarContratoPreview(ocorrencias, resultadosPreview.map(item => ({
      ok: item.resultado.ok, marketplace: item.resultado.marketplaceDetectado,
      resultado: item.resultado
    })));
    assert.equal(contrato.linksOriginais[0], "https://tidd.ly/um");
    assert.equal(contrato.redirects[0].linkOriginalCapturado, "https://tidd.ly/um");
    assert.equal(contrato.redirects[0].linkResolvido, "https://www.kabum.com.br/produto/10101",
      "o candidato atravessa o contrato oficial somente em redirects");
    assert.deepEqual(contrato.redirects.map(item => item.papelOriginal), papeis);
    assert(contrato.redirects.every(item => item.proveniencia === "admin_links_preview"));
    assert.deepEqual(contrato.linksPreparados, []);
    assert.deepEqual(contrato.identidadesCanonicas, []);

    const amazon = await post("/drafts", { urlExemplo: "https://desc.vc/um" });
    assert.equal(amazon.status, 201);
    const registroAposCadastros = fs.readFileSync(file);
    const idAmazon = amazon.data.resolver.id;
    const previewAmazon = await post(`/drafts/${idAmazon}/engine-preview`, { ocorrencias: [
      { urlExemplo: "https://desc.vc/um", papel: "produto" },
      { urlExemplo: "https://desc.vc/ambiguo", papel: "pc" }
    ] });
    assert.equal(previewAmazon.status, 200);
    assert.equal(previewAmazon.data.ok, false, "pagina ambigua falha fechada");
    assert.equal(previewAmazon.data.contrato.destinosCandidatos, 1);
    assert.equal(previewAmazon.data.ocorrencias[0].metodo, "html_contextual");
    assert.equal(previewAmazon.data.ocorrencias[0].marketplaceCandidato, "amazon");
    assert.equal(previewAmazon.data.ocorrencias[1].statusDestino, "nao_encontrado");
    assert.equal(previewAmazon.data.ocorrencias[1].marketplaceCandidato, "nao_comprovado");
    assert.equal(previewAmazon.data.ocorrencias[1].destinoCandidato, "");
    assert.equal(previewAmazon.data.ocorrencias[1].identidade, "nao_comprovada");
    assert.deepEqual(fs.readFileSync(file), registroAposCadastros);

    falhaComSegredo = true;
    const erroSeguro = await post(`/drafts/${idKabum}/engine-preview`, { urlExemplo: "https://tidd.ly/um" });
    assert.equal(erroSeguro.status, 200);
    assert.equal(erroSeguro.data.ocorrencias[0].motivoTecnico, "redirect_falha_nao_classificada");
    assert.equal(JSON.stringify(erroSeguro.data).includes("token=nao-expor"), false);
    assert.deepEqual(fs.readFileSync(file), registroAposCadastros,
      "nenhuma previsualizacao modifica o registry");
    console.log("links-engine-preparation-preview.test.js PASS");
  } finally {
    await new Promise(resolveServer => server.close(resolveServer));
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

executar().catch(error => { console.error(error); process.exitCode = 1; });
