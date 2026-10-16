"use strict";

// Simulacao administrativa: rascunhos explicitos, HTTP falso e nenhum ingresso
// comercial. As funcoes de fronteira abaixo sao as mesmas usadas em producao.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const express = require("express");
const { inferirFamiliaRascunho } = require("../modules/radar/redirect/dynamic-resolver-registry");
const { criarRotasResolversDinamicos, montarContratoPreview } =
  require("../modules/radar/redirect/dynamic-resolver-admin.routes");
const { resolverRedirectUniversal, resolverRedirectClonador } =
  require("../modules/radar/redirect/redirect-resolver");
const { resolverLinksClonador } = require("../modules/clonador-grupos/bridge");
const { detectarMarketplaceLink } = require("../modules/engine/normalizers");
const { criarContratoPreparacaoLinks } = require("../modules/engine/preparacao-links.service");
const { camposIdentidadeCanonicaOferta } = require("../modules/radar/produto-canonico");
const { createEnvelope } = require("../modules/teleradar/envelope.contract");
const { createMemoryTeleradarStore } = require("../modules/teleradar/checkpoint.repository");
const { createHandoffService } = require("../modules/teleradar/handoff.service");
const { createRadarIngressAdapter } = require("../modules/teleradar/radar-ingress.adapter");

const entradas = Object.freeze({
  kabum: "https://tidd.ly/primeiro",
  kabum2: "https://tidd.ly/segundo",
  amazon: "https://desc.vc/primeiro",
  meli: "https://ofertou.me/primeiro",
  magalu: "https://magazineluiza.onelink.me/589508454/primeiro"
});
const papeis = ["app", "pc", "moedas", "resgate", "moda"];
const destinoMeli = "https://meli.la/abc123";
const urlMagalu = "https://www.magazineluiza.com.br/produto/p/123456789";
const paginaBase64 = `<html><script>fetch('/tracking',{method:'POST'});` +
  `globalThis.__executado=true;location.replace(atob("${Buffer.from(destinoMeli).toString("base64")}"));` +
  `</script></html>`;

function transporte(chamadas) {
  return (url, options, callback) => {
    const req = new EventEmitter();
    req.end = () => process.nextTick(() => {
      chamadas.push({ host: url.hostname, method: options.method });
      const codigo = url.pathname.split("/").filter(Boolean).at(-1);
      let status = 200;
      let location = "";
      let body = "<html><body>produto</body></html>";
      if (url.hostname === "tidd.ly") {
        status = 302;
        location = `https://www.kabum.com.br/produto/${codigo === "primeiro" ? "10101" : "20202"}`;
      } else if (url.hostname === "desc.vc") {
        status = 302;
        location = "https://descontostop.example/promocao/primeiro";
      } else if (url.hostname === "descontostop.example") {
        body = '<nav><a href="https://www.amazon.com.br/dp/B000000001">Anuncio</a></nav>' +
          '<main><article><h1>Produto principal</h1>' +
          '<a href="https://www.amazon.com.br/dp/B012345678">Ver na Loja</a></article></main>';
      } else if (url.hostname === "ofertou.me") {
        body = paginaBase64;
      } else if (url.hostname === "magazineluiza.onelink.me") {
        status = 302;
        location = urlMagalu;
      } else if (url.hostname === "www.magazineluiza.com.br") {
        status = 403;
        body = "";
      }
      const res = new EventEmitter();
      res.statusCode = status;
      res.headers = location ? { location } : {};
      res.complete = true;
      res.destroyed = false;
      res.destroy = () => { res.destroyed = true; };
      callback(res);
      if (body) res.emit("data", Buffer.from(body));
      res.emit("end");
    });
    req.destroy = error => { if (error) req.emit("error", error); };
    return req;
  };
}

function preparadorRadar(resolver) {
  const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  const start = source.indexOf("async function prepararLinksRedirectEngineRadar(");
  const end = source.indexOf("async function registrarEventoBrutoEngineRadar(", start);
  assert(start >= 0 && end > start, "fronteira real Radar deve continuar identificavel");
  return new Function("linkRedirectPermitidoRadar", "camposIdentidadeCanonicaOferta",
    "resolverLinkOriginalRadar", "dominioMarketplaceConhecidoRadar", "criarContratoPreparacaoLinks",
    `${source.slice(start, end)}; return prepararLinksRedirectEngineRadar;`)(
    // Somente no teste: familias inativas sao entradas explicitas, nao uma allowlist operacional.
    url => Object.values(entradas).includes(url), camposIdentidadeCanonicaOferta,
    resolver, detectarMarketplaceLink, criarContratoPreparacaoLinks);
}

function draft(id, urlExemplo, metodoDescoberto) {
  return { id, estado: "rascunho", ativo: false,
    ...inferirFamiliaRascunho(urlExemplo), metodoDescoberto };
}

async function executar() {
  const registros = new Map([
    ["kabum", draft("kabum", entradas.kabum, "http_redirect")],
    ["amazon", draft("amazon", entradas.amazon, "html_contextual")],
    ["meli", draft("meli", entradas.meli, "html_static_base64")],
    ["magalu", draft("magalu", entradas.magalu, "http_redirect")]
  ]);
  const chamadas = [];
  const resolucoes = new Map();
  const safeHttpDeps = { lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    requestImpl: transporte(chamadas) };
  const resolve = async (url, options) => {
    const result = await resolverRedirectUniversal(url, options);
    resolucoes.set(url, result);
    return result;
  };
  const app = express();
  app.use(express.json());
  app.use("/admin/links/resolvers", (req, res, next) =>
    req.get("x-test-admin") === "yes" ? next() : res.status(403).json({ erro: "FORBIDDEN" }),
  criarRotasResolversDinamicos({ registry: { buscar: id => registros.get(id) || null },
    resolve, safeHttpDeps }));
  const server = await new Promise(ok => {
    const listening = app.listen(0, "127.0.0.1", () => ok(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}/admin/links/resolvers`;
  const post = async (route, body, admin = true) => {
    const response = await fetch(`${base}${route}`, { method: "POST",
      headers: { "content-type": "application/json", "x-test-admin": admin ? "yes" : "no" },
      body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const cincoLinks = papeis.map((papel, index) => ({
      urlExemplo: index === 0 ? entradas.kabum : `https://tidd.ly/papel${index}`, papel
    }));
    const negado = await post("/drafts/kabum/engine-preview", { ocorrencias: cincoLinks }, false);
    assert.equal(negado.status, 403);
    assert.equal(chamadas.length, 0);
    assert.equal((await post("/drafts/desconhecido/engine-preview", {
      urlExemplo: entradas.kabum, papel: "pc" })).status, 400);
    assert.equal((await post("/drafts/kabum/engine-preview", {
      urlExemplo: entradas.amazon, papel: "pc" })).status, 400);
    assert.equal(chamadas.length, 0, "familia ausente ou incompativel nao inicia HTTP");
    const kabum = await post("/drafts/kabum/engine-preview", { ocorrencias: cincoLinks });
    assert.equal(kabum.status, 200);
    assert.equal(kabum.data.ok, true);
    assert.deepEqual(kabum.data.ocorrencias.map(item => item.papelOriginal), papeis);
    assert.deepEqual(kabum.data.contrato, { linksOriginais: 5, destinosCandidatos: 5,
      linksPreparados: 0, identidadesCanonicas: 0 });
    assert(kabum.data.ocorrencias.every(item => item.identidade === "pendente" &&
      item.afiliacao === "nao_comprovada" && item.produtoConfirmado === false &&
      item.afiliacaoConfirmada === false));
    assert.equal(kabum.data.prontoComercial, false);
    const reused = await post("/drafts/kabum/test", { urlExemplo: entradas.kabum2 });
    assert.equal(reused.status, 200);
    assert.equal(reused.data.reutilizavel, true, "segundo link usa a mesma familia sem codigo novo");

    const terceiro = "https://affiliate.example/conta-de-terceiro";
    const amazon = await post("/drafts/amazon/engine-preview", { urlExemplo: entradas.amazon,
      papel: "pc", linkAfiliado: terceiro, afiliacaoConfirmada: true,
      evidenciaOficial: { estado: "valida", productId: "produto-de-outra-oferta" } });
    assert.equal(amazon.status, 200);
    assert.equal(amazon.data.ocorrencias[0].statusDestino, "candidato_encontrado");
    assert.equal(amazon.data.ocorrencias[0].metodo, "html_contextual");
    assert.equal(amazon.data.ocorrencias[0].marketplaceCandidato, "amazon");
    assert.equal(amazon.data.contrato.identidadesCanonicas, 0);
    assert.equal(amazon.data.ocorrencias[0].afiliacaoConfirmada, false);
    assert.equal(amazon.data.ocorrencias[0].evidenciaOficial, "nao_avaliada",
      "prova incompativel enviada pelo cliente nao substitui validadores oficiais");
    assert.equal(JSON.stringify(amazon.data).includes(terceiro), false);
    const meli = await post("/drafts/meli/engine-preview", { urlExemplo: entradas.meli, papel: "resgate" });
    assert.equal(meli.status, 200);
    assert.equal(meli.data.ocorrencias[0].statusDestino, "candidato_encontrado");
    assert.equal(meli.data.ocorrencias[0].metodo, "html_static_base64");
    assert.equal(meli.data.ocorrencias[0].evidenciaOficial, "nao_avaliada");
    assert.equal(meli.data.contrato.identidadesCanonicas, 0, "meli.la nao prova MLB");
    const magalu = await post("/drafts/magalu/engine-preview", { urlExemplo: entradas.magalu, papel: "pc" });
    assert.equal(magalu.status, 200);
    assert.equal(magalu.data.ocorrencias[0].statusDestino, "nao_encontrado");
    assert.equal(magalu.data.ocorrencias[0].evidenciaOficial, "nao_avaliada");
    assert.equal(magalu.data.prontoComercial, false);
    assert.equal(globalThis.__executado, undefined, "JavaScript e tracking nunca sao executados");
    assert(chamadas.every(item => item.method === "GET"));
    assert(!chamadas.some(item => item.host === "meli.la"), "destino Base64 e candidato, nao fetch comercial");
    assert([...registros.values()].every(item => item.ativo === false), "previa nao ativa familias");

    const analises = cincoLinks.map(item => ({ ok: resolucoes.get(item.urlExemplo)?.ok === true,
      marketplace: resolucoes.get(item.urlExemplo)?.marketplaceDetectado,
      resultado: resolucoes.get(item.urlExemplo) }));
    const contratoPreview = montarContratoPreview(cincoLinks, analises);
    assert.deepEqual(contratoPreview.linksOriginais, cincoLinks.map(item => item.urlExemplo));
    assert.deepEqual(contratoPreview.redirects.map(item => item.papelOriginal), papeis);
    assert(contratoPreview.redirects.every(item => item.proveniencia === "admin_links_preview"));
    assert.deepEqual(contratoPreview.linksPreparados, []);
    assert.deepEqual(contratoPreview.identidadesCanonicas, []);
    assert.equal(contratoPreview.redirects[0].linkResolvido, resolucoes.get(entradas.kabum).urlFinal);
    for (const [url, papel] of [[entradas.amazon, "pc"], [entradas.meli, "resgate"],
      [entradas.magalu, "pc"]]) {
      const result = resolucoes.get(url);
      const contrato = montarContratoPreview([{ urlExemplo: url, papel }], [{
        ok: result.ok === true, marketplace: result.marketplaceDetectado || "", resultado: result
      }]);
      assert.deepEqual(contrato.linksOriginais, [url]);
      assert.equal(contrato.redirects[0].papelOriginal, papel);
      assert.equal(contrato.redirects[0].proveniencia, "admin_links_preview");
      assert.deepEqual(contrato.linksPreparados, []);
      assert.deepEqual(contrato.identidadesCanonicas, []);
    }
    const provaIncompativel = montarContratoPreview([{ urlExemplo: entradas.meli, papel: "pc" }],
      [{ ok: true, marketplace: "mercadolivre", resultado: resolucoes.get(entradas.meli) }],
      [{ estado: "incompativel", marketplace: "mercadolivre", productId: "MLB000000000" }]);
    assert.deepEqual(provaIncompativel.identidadesCanonicas, [],
      "prova rejeitada nao atravessa o contrato da Engine");

    // Radar: apenas a funcao de preparacao real, nunca registro de evento ou Engine comercial.
    const original = [entradas.kabum, entradas.kabum2];
    const resolverSimulado = async url => {
      const result = resolucoes.get(url);
      return { ...result, linkOriginalLimpo: result.ok ? (result.urlExpandida || result.urlFinal) : "",
        marketplaceReal: result.marketplaceDetectado || "" };
    };
    const preparar = preparadorRadar(resolverSimulado);
    const radar = await preparar({ linksExtraidos: original, textoOriginal: "Oferta sintetica",
      origemTipo: "whatsapp", clienteId: "workspace-a", sessaoId: "sessao-a", grupoId: "grupo-a",
      metadata: { proveniencia: "radar_fixture", prioridade: "normal" } });
    assert.deepEqual(radar.preparacaoLinks.linksOriginais, original);
    assert.deepEqual(radar.preparacaoLinks.linksPreparados, original.map(url =>
      resolucoes.get(url).urlExpandida || resolucoes.get(url).urlFinal));
    assert.deepEqual(radar.dados.metadata.linksOriginaisCapturados, original);
    assert.equal(radar.dados.clienteId, "workspace-a");
    assert.equal(radar.dados.sessaoId, "sessao-a");
    assert.equal(radar.dados.metadata.proveniencia, "radar_fixture");
    assert.equal(radar.dados.metadata.prioridade, "normal");

    // TeleRadar: envelope, handoff, checkpoint e ACK reais; o handler apenas prepara em memoria.
    const envelopes = [];
    const store = createMemoryTeleradarStore();
    const context = { clientId: "admin", workspaceId: "workspace_admin", scope: "admin_master",
      feature: "teleradar", accountIdInterno: "telegram-b" };
    let ingressos = 0;
    let checkpoints = 0;
    const ingress = createRadarIngressAdapter({ processarMensagemRadar: async dados => {
      ingressos++;
      assert.equal(dados.origemTipo, "telegram");
      assert.equal(dados.fonteCaptura, "teleradar");
      assert.equal(dados.aguardarAckEngine, true);
      envelopes.push(await preparar({ linksExtraidos: dados.linksCapturados,
        textoOriginal: dados.texto, clienteId: context.clientId, sessaoId: dados.sessaoId,
        grupoId: dados.grupoId, metadata: { proveniencia: dados.fonteCaptura } }));
      return { radarAccepted: true, radarAck: "RADAR_ACCEPTED", radarEventId: "simulado-1" };
    } });
    const handoff = createHandoffService({ context, store, radarIngress: ingress,
      clock: () => new Date("2026-10-16T10:00:01Z"),
      beforeAttempt: async () => { checkpoints++; } });
    const envelope = createEnvelope({ accountId: "10001", chatId: "-10001", messageId: "20001",
      senderId: "30001", receivedAt: "2026-10-16T10:00:01Z",
      sourceTimestamp: "2026-10-16T10:00:00Z", text: `Oferta ${entradas.kabum}`,
      entities: [{ type: "url", occurrence: 0, offset: 7, length: entradas.kabum.length,
        label: entradas.kabum, url: entradas.kabum }] });
    assert.equal((await handoff.persistEnvelope(envelope)).created, true);
    assert.equal((await handoff.attempt(envelope.eventId)).accepted, true);
    assert.equal((await handoff.persistEnvelope(envelope)).created, false);
    assert.equal((await handoff.attempt(envelope.eventId)).skipped, true);
    assert.equal(ingressos, 1);
    assert.equal(checkpoints, 1);
    assert.equal((await handoff.get(envelope.eventId)).status, "acked");
    assert.deepEqual(envelopes[0].preparacaoLinks.linksOriginais, [entradas.kabum]);
    assert.equal(envelopes[0].dados.clienteId, "admin");
    assert.equal(envelopes[0].dados.metadata.proveniencia, "teleradar");
    assert.notEqual(envelopes[0].dados.clienteId, radar.dados.clienteId);

    // Clonador: a bridge especializada mantem seu contrato e nao inventa identidade.
    const clone = await resolverLinksClonador(original, async url => resolucoes.get(url));
    assert.deepEqual(clone.linksOriginais, original);
    assert.deepEqual(clone.linksPreparados, radar.preparacaoLinks.linksPreparados);
    assert.deepEqual(clone.identidadesCanonicas, []);
    assert.deepEqual(Object.keys(clone).sort(), Object.keys(criarContratoPreparacaoLinks()).sort());
    assert.equal(clone.redirects.length, original.length);
    assert.deepEqual((await resolverLinksClonador([entradas.kabum, entradas.kabum],
      async url => resolucoes.get(url))).linksOriginais, [entradas.kabum],
    "bridge conserva sua deduplicacao por URL original");
    const meliClonador = await resolverRedirectClonador(destinoMeli, { safeHttpDeps });
    assert.equal(meliClonador.ok, false);
    assert.equal(meliClonador.motivo, "identidade_ml_nao_comprovada",
      "a excecao da bridge exige a identidade ML factual, nao apenas meli.la");

    // A allowlist operacional nao recebe nenhum rascunho da simulacao.
    const operacional = await resolverRedirectUniversal(entradas.meli, {
      dynamicRegistry: { localizar: () => null }, safeHttpDeps });
    assert.equal(operacional.ok, false);
    assert.equal(globalThis.__executado, undefined);
    assert.equal(JSON.stringify({ kabum: kabum.data, amazon: amazon.data, meli: meli.data,
      magalu: magalu.data }).includes("https://"), false, "API administrativa nao expoe URLs brutas");
    console.log("links-v29-consumidores-simulacao.test.js PASS");
  } finally {
    await new Promise(ok => server.close(ok));
  }
}

executar().catch(error => { console.error(error); process.exitCode = 1; });
