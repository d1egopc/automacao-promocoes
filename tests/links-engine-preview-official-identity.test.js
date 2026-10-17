"use strict";

const assert = require("node:assert/strict");
const express = require("express");
const { EventEmitter } = require("node:events");
const { criarRotasResolversDinamicos, montarContratoPreview } =
  require("../modules/radar/redirect/dynamic-resolver-admin.routes");
const { chaveIdentidadeMagalu } = require("../modules/local-worker/magalu-identity.contract");
const { detectarMarketplaceHost } = require("../modules/engine/normalizers");

const mlb = "MLB123456789";
const mlUrl = `https://produto.mercadolivre.com.br/${mlb}-tenis`;
const magaluOriginal = "https://magazineluiza.onelink.me/589508454/c3qooxsv";
const magaluUrl = "https://www.magalu.com/potes-hermeticos/p/123456789/ud/poud/";

function provaMl() {
  const collectedAt = new Date().toISOString();
  return {
    capability: "ml_identity_v1", contractVersion: 1, marketplace: "mercadolivre",
    expectedMlb: mlb, observedMlb: mlb, identidadeValidada: true,
    tituloOficial: "Tenis Nike Air Max Excee Masculino", origemTitulo: "jsonld.name",
    imagemOficial: "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB123456789.jpg",
    origemImagem: "jsonld.image", finalUrl: mlUrl, canonicalUrl: mlUrl, collectedAt,
    provaTecnica: { capability: "ml_identity_v1", contractVersion: 1,
      source: "local_first_party", provenance: "local_worker.ml_identity_v1",
      expectedMlb: mlb, observedMlb: mlb, sameProductObject: true,
      origemTitulo: "jsonld.name", origemImagem: "jsonld.image",
      finalUrl: mlUrl, canonicalUrl: mlUrl, collectedAt }
  };
}

function provaMagalu() {
  const collectedAt = new Date().toISOString();
  const identityKey = chaveIdentidadeMagalu(magaluOriginal);
  return {
    capability: "magalu_identity_v1", contractVersion: 1, marketplace: "magalu",
    identityKey, sourceUrl: magaluOriginal, observedProductId: "123456789",
    identidadeValidada: true, finalUrl: magaluUrl, canonicalUrl: magaluUrl, collectedAt,
    provaTecnica: { capability: "magalu_identity_v1", contractVersion: 1,
      source: "local_first_party", provenance: "local_worker.magalu_identity_v1",
      identityKey, observedProductId: "123456789", redirected: true,
      statusHttp: 403, finalUrl: magaluUrl, collectedAt }
  };
}

function transporteMagaluSeguro(statusProduto) {
  return (url, _opcoes, callback) => {
    const requisicao = new EventEmitter();
    requisicao.end = () => process.nextTick(() => {
      const onelink = url.hostname === "magazineluiza.onelink.me";
      const resposta = new EventEmitter();
      resposta.statusCode = onelink ? 302 : statusProduto;
      resposta.headers = onelink ? { location: magaluUrl.replace("www.magalu.com", "www.magazineluiza.com.br") } : {};
      resposta.complete = true;
      resposta.destroyed = false;
      resposta.destroy = () => { resposta.destroyed = true; };
      callback(resposta);
      if (!onelink) resposta.emit("data", Buffer.from("<html><body>Produto oficial</body></html>"));
      resposta.emit("end");
    });
    requisicao.destroy = error => { if (error) requisicao.emit("error", error); };
    return requisicao;
  };
}

async function executar() {
  const registroMl = { id: "ml", estado: "rascunho", ativo: false,
    host: "tidd.ly", pathPrefix: "/", pathMode: "one_segment_suffix" };
  const registroMagalu = { id: "magalu", estado: "rascunho", ativo: false,
    host: "magazineluiza.onelink.me", pathPrefix: "/589508454/", pathMode: "one_segment_suffix" };
  let destinoMl = mlUrl;
  let destinoMagalu = magaluUrl;
  let falhaRedirect = false;
  let evidenciaMl = provaMl();
  let evidenciaMagalu = provaMagalu();
  let consultaFalha = false;
  let resultadoMagalu = null;
  const consultas = [];
  let resolucoes = 0;
  const resolve = async url => {
    resolucoes++;
    if (falhaRedirect) return { ok: false, motivo: "HTTP_403", urlFinal: "" };
    const ml = new URL(url).hostname === "tidd.ly";
    if (!ml && resultadoMagalu) return resultadoMagalu;
    return { ok: true, urlExpandida: ml ? destinoMl : destinoMagalu,
      marketplaceDetectado: ml ? "mercadolivre" : "magalu", metodo: "http_redirect" };
  };
  const registry = { buscar: id => ({ ml: registroMl, magalu: registroMagalu })[id] || null };
  const app = express();
  app.use(express.json());
  app.use("/admin/links/resolvers", (req, res, next) =>
    req.get("x-admin") === "yes" ? next() : res.status(403).json({ erro: "FORBIDDEN" }),
  criarRotasResolversDinamicos({ registry, resolve,
    obterIdentidadeMercadoLivre: async ({ productId }) => {
      consultas.push(["ml", productId]);
      if (consultaFalha) throw Object.assign(new Error("HTTP 403 token=privado"), { status: 403 });
      return evidenciaMl;
    },
    obterIdentidadeMagalu: async ({ sourceUrl }) => {
      consultas.push(["magalu", sourceUrl]);
      if (consultaFalha) throw Object.assign(new Error("HTTP 403 token=privado"), { status: 403 });
      return evidenciaMagalu;
    }
  }));
  const server = await new Promise(ok => {
    const listening = app.listen(0, "127.0.0.1", () => ok(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}/admin/links/resolvers`;
  const post = async (id, urlExemplo, admin = true) => {
    const response = await fetch(`${base}/drafts/${id}/engine-preview`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin": admin ? "yes" : "no" },
      body: JSON.stringify({ ocorrencias: [{ urlExemplo, papel: "pc" }],
        evidenciaOficial: provaMl(), precoRadar: 1769.91, cupomRadar: "IFPVFHL2" })
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    const antes = resolucoes;
    assert.equal((await post("ml", "https://tidd.ly/um", false)).status, 403);
    assert.equal(resolucoes, antes);
    assert.deepEqual(consultas, []);

    const ml = await post("ml", "https://tidd.ly/um");
    assert.equal(ml.status, 200);
    assert.equal(ml.data.ocorrencias[0].evidenciaOficial, "valida");
    assert.equal(ml.data.contrato.identidadesCanonicas, 1);
    assert.equal(ml.data.ocorrencias[0].identidade, "pendente", "V2.4 mantém o campo legado");
    assert.equal(ml.data.prontoComercial, false);
    assert.equal(ml.data.contrato.linksPreparados, 0);
    assert.equal(ml.data.ocorrencias[0].afiliacao, "nao_comprovada");
    assert.deepEqual(consultas.at(-1), ["ml", mlb]);
    const captura = { urlExemplo: "https://tidd.ly/um", papel: "pc", origem: "teleradar",
      precoAnunciado: 1769.91, cupomInformado: "IFPVFHL2", textoCapturado: "oferta sintética" };
    const contrato = montarContratoPreview([captura],
      [{ ok: true, resultado: { urlExpandida: mlUrl }, marketplace: "mercadolivre" }],
      [{ estado: "valida", marketplace: "mercadolivre", productId: mlb,
        proveniencia: "local_worker.ml_identity_v1" }]);
    assert.equal(contrato.linksOriginais[0], "https://tidd.ly/um");
    assert.equal(contrato.redirects[0].papelOriginal, "pc");
    assert.equal(contrato.identidadesCanonicas[0].chaveCanonica, mlb);
    assert.equal(contrato.identidadesCanonicas[0].linkOriginalCapturado, "https://tidd.ly/um");
    assert.equal(contrato.identidadesCanonicas[0].proveniencia, "local_worker.ml_identity_v1");
    assert.deepEqual(captura, { urlExemplo: "https://tidd.ly/um", papel: "pc", origem: "teleradar",
      precoAnunciado: 1769.91, cupomInformado: "IFPVFHL2", textoCapturado: "oferta sintética" },
    "a prévia não altera preço, cupom, texto nem proveniência capturados");

    const magalu = await post("magalu", magaluOriginal);
    assert.equal(magalu.status, 200);
    assert.equal(magalu.data.ocorrencias[0].evidenciaOficial, "valida",
      "403 com redirect e prova oficial valida nao significa produto ausente");
    assert.equal(magalu.data.contrato.identidadesCanonicas, 1);
    assert.deepEqual(consultas.at(-1), ["magalu", magaluOriginal]);
    assert.equal(magalu.data.ocorrencias[0].marketplaceReconhecido, "magalu");
    assert.equal(magalu.data.ocorrencias[0].afiliacaoConfirmada, false);

    destinoMagalu = magaluUrl.replace("www.magalu.com", "www.magazineluiza.com.br");
    const dominioComWww = await post("magalu", magaluOriginal);
    assert.equal(dominioComWww.data.ocorrencias[0].marketplaceCandidato, "magalu");
    assert.equal(dominioComWww.data.ocorrencias[0].evidenciaOficial, "valida");
    destinoMagalu = destinoMagalu.replace("www.magazineluiza.com.br", "magazineluiza.com.br");
    const dominioSemWww = await post("magalu", magaluOriginal);
    assert.equal(dominioSemWww.data.ocorrencias[0].marketplaceCandidato, "magalu");
    assert.equal(dominioSemWww.data.ocorrencias[0].evidenciaOficial, "valida");
    assert.equal(detectarMarketplaceHost("www.magazineluiza.com.br"), "magalu");
    assert.equal(detectarMarketplaceHost("magazineluiza.com.br"), "magalu");
    assert.equal(detectarMarketplaceHost("magazineluiza.onelink.me"), "magalu");
    assert.equal(detectarMarketplaceHost("evilmagalu.com"), "");
    assert.equal(detectarMarketplaceHost("www.magazineluiza.com.br.evil.example"), "");
    assert.equal(detectarMarketplaceHost("amazon.com.br"), "amazon");
    destinoMagalu = magaluUrl;

    resultadoMagalu = { ok: false, urlFinal: magaluUrl.replace("www.magalu.com", "www.magazineluiza.com.br"),
      statusHttp: 200, motivo: "redirect_nao_resolvido", metodo: "http_redirect" };
    const candidatoHttp200 = await post("magalu", magaluOriginal);
    assert.equal(candidatoHttp200.data.ok, true);
    assert.equal(candidatoHttp200.data.ocorrencias[0].statusDestino, "candidato_encontrado");
    assert.equal(candidatoHttp200.data.ocorrencias[0].evidenciaOficial, "valida");
    assert.equal(candidatoHttp200.data.ocorrencias[0].identidade, "pendente");
    assert.equal(candidatoHttp200.data.ocorrencias[0].produtoConfirmado, false);
    assert.equal(candidatoHttp200.data.ocorrencias[0].afiliacaoConfirmada, false);
    resultadoMagalu = { ok: false, urlFinal: magaluOriginal, statusHttp: 200,
      motivo: "redirect_nao_resolvido", metodo: "http_sem_redirect" };
    const onelinkSemDestino = await post("magalu", magaluOriginal);
    assert.equal(onelinkSemDestino.data.ocorrencias[0].marketplaceReconhecido, "magalu");
    assert.equal(onelinkSemDestino.data.ocorrencias[0].statusDestino, "nao_encontrado");
    assert.equal(onelinkSemDestino.data.ocorrencias[0].evidenciaOficial, "nao_avaliada");
    resultadoMagalu = null;

    destinoMagalu = "https://evilmagalu.com/p/123456789";
    const antesHostFalso = consultas.length;
    const hostFalso = await post("magalu", magaluOriginal);
    assert.equal(hostFalso.data.ocorrencias[0].statusDestino, "nao_encontrado");
    assert.equal(hostFalso.data.ocorrencias[0].marketplaceCandidato, "nao_comprovado");
    assert.equal(consultas.length, antesHostFalso);
    destinoMagalu = "https://www.amazon.com.br/dp/B012345678";
    const outroMarketplace = await post("magalu", magaluOriginal);
    assert.equal(outroMarketplace.data.ocorrencias[0].marketplaceCandidato, "nao_comprovado");
    assert.equal(outroMarketplace.data.ocorrencias[0].evidenciaOficial, "nao_avaliada");
    assert.equal(consultas.length, antesHostFalso);
    destinoMagalu = magaluUrl;

    destinoMagalu = magaluUrl.replace("123456789", "987654321");
    const divergente = await post("magalu", magaluOriginal);
    assert.equal(divergente.data.ocorrencias[0].evidenciaOficial, "incompativel");
    assert.equal(divergente.data.contrato.identidadesCanonicas, 0);
    destinoMagalu = magaluUrl;

    evidenciaMagalu = null;
    const cacheAusente = await post("magalu", magaluOriginal);
    assert.equal(cacheAusente.data.ocorrencias[0].evidenciaOficial, "ausente");
    assert.equal(cacheAusente.data.contrato.identidadesCanonicas, 0);
    evidenciaMagalu = provaMagalu();

    evidenciaMl = { ...provaMl(), provaTecnica: { ...provaMl().provaTecnica,
      provenance: "forjada" } };
    const invalida = await post("ml", "https://tidd.ly/um");
    assert.equal(invalida.data.ocorrencias[0].evidenciaOficial, "incompativel");
    assert.equal(invalida.data.contrato.identidadesCanonicas, 0);
    evidenciaMl = null;
    assert.equal((await post("ml", "https://tidd.ly/um")).data.ocorrencias[0].evidenciaOficial, "ausente");

    consultaFalha = true;
    const indisponivel = await post("magalu", magaluOriginal);
    assert.equal(indisponivel.data.ocorrencias[0].evidenciaOficial, "indisponivel");
    assert.equal(indisponivel.data.contrato.identidadesCanonicas, 0);
    consultaFalha = false;
    falhaRedirect = true;
    const antesFalha = consultas.length;
    const naoResolvido = await post("magalu", magaluOriginal);
    assert.equal(naoResolvido.data.ocorrencias[0].evidenciaOficial, "nao_avaliada");
    assert.equal(naoResolvido.data.ocorrencias[0].marketplaceReconhecido, "magalu");
    assert.equal(naoResolvido.data.ocorrencias[0].statusDestino, "nao_encontrado");
    assert.equal(consultas.length, antesFalha, "403 do resolvedor nao consulta cache nem afirma ausencia");
    for (const resposta of [ml, magalu, dominioComWww, dominioSemWww, candidatoHttp200,
      onelinkSemDestino, hostFalso, outroMarketplace, divergente, cacheAusente, invalida,
      indisponivel, naoResolvido]) {
      const texto = JSON.stringify(resposta.data);
      for (const segredo of [mlb, "123456789", "987654321", "token=privado", "IFPVFHL2",
        "1769.91", "https://tidd.ly/um", magaluOriginal]) {
        assert.equal(texto.includes(segredo), false, `saida administrativa vazou ${segredo}`);
      }
      assert.equal(resposta.data.prontoComercial, false);
      assert.equal(resposta.data.ocorrencias[0].afiliacaoConfirmada, false);
    }

    let statusProduto = 200;
    let consultasReais = 0;
    const appSeguro = express();
    appSeguro.use(express.json());
    appSeguro.use("/admin/links/resolvers", (req, res, next) =>
      req.get("x-admin") === "yes" ? next() : res.status(403).json({ erro: "FORBIDDEN" }),
    criarRotasResolversDinamicos({ registry,
      safeHttpDeps: { lookup: async () => [{ address: "8.8.8.8", family: 4 }],
        requestImpl: (...args) => transporteMagaluSeguro(statusProduto)(...args) },
      obterIdentidadeMagalu: async () => { consultasReais++; return provaMagalu(); }
    }));
    const servidorSeguro = await new Promise(ok => {
      const listening = appSeguro.listen(0, "127.0.0.1", () => ok(listening));
    });
    try {
      const url = `http://127.0.0.1:${servidorSeguro.address().port}/admin/links/resolvers/drafts/magalu/engine-preview`;
      const requisitar = async () => (await fetch(url, { method: "POST",
        headers: { "content-type": "application/json", "x-admin": "yes" },
        body: JSON.stringify({ urlExemplo: magaluOriginal, papel: "pc" }) })).json();
      const http200 = await requisitar();
      assert.equal(http200.ocorrencias[0].statusDestino, "candidato_encontrado");
      assert.equal(http200.ocorrencias[0].evidenciaOficial, "valida");
      assert.equal(http200.ocorrencias[0].produtoConfirmado, false);
      assert.equal(http200.prontoComercial, false);
      assert.equal(consultasReais, 1);
      statusProduto = 403;
      const http403 = await requisitar();
      assert.equal(http403.ocorrencias[0].marketplaceReconhecido, "magalu");
      assert.equal(http403.ocorrencias[0].statusDestino, "nao_encontrado");
      assert.equal(http403.ocorrencias[0].evidenciaOficial, "nao_avaliada");
      assert.equal(http403.ocorrencias[0].afiliacaoConfirmada, false);
      assert.equal(consultasReais, 1, "403 nao autoriza consultar cache nem provar produto");
    } finally {
      await new Promise(ok => servidorSeguro.close(ok));
    }
    console.log("links-engine-preview-official-identity.test.js PASS");
  } finally {
    await new Promise(ok => server.close(ok));
  }
}

executar().catch(error => { console.error(error); process.exitCode = 1; });
