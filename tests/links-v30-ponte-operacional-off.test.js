"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { inferirFamiliaRascunho } = require("../modules/radar/redirect/dynamic-resolver-registry");
const { dominioRedirectPermitido, resolverRedirectUniversal, resolverRedirectClonador } =
  require("../modules/radar/redirect/redirect-resolver");
const { normalizarMotivoTecnicoRedirect } = require("../modules/radar/redirect/redirect-diagnostic-code");
const { detectarMarketplaceLink } = require("../modules/engine/normalizers");
const { criarContratoPreparacaoLinks } = require("../modules/engine/preparacao-links.service");
const { camposIdentidadeCanonicaOferta } = require("../modules/radar/produto-canonico");
const { resolverLinksClonador } = require("../modules/clonador-grupos/bridge");
const { createEnvelope } = require("../modules/teleradar/envelope.contract");
const { createMemoryTeleradarStore } = require("../modules/teleradar/checkpoint.repository");
const { createHandoffService } = require("../modules/teleradar/handoff.service");
const { createRadarIngressAdapter } = require("../modules/teleradar/radar-ingress.adapter");

const urls = Object.freeze({
  tiddly: "https://tidd.ly/primeiro",
  tiddlySegundo: "https://tidd.ly/segundo",
  desc: "https://desc.vc/primeiro",
  ofertou: "https://ofertou.me/primeiro",
  magalu: "https://magazineluiza.onelink.me/589508454/primeiro",
  desconhecida: "https://nao-homologado.example/primeiro"
});
const meli = "https://meli.la/abc123";
const noop = () => {};

function familiaAprovada(id, urlExemplo, metodoDescoberto) {
  return { id, ...inferirFamiliaRascunho(urlExemplo), estado: "homologado_inteligente",
    aprovadoInteligente: true, ativo: false, metodoDescoberto };
}

function transporte(chamadas) {
  return (url, options, callback) => {
    const req = new EventEmitter();
    req.end = () => process.nextTick(() => {
      chamadas.push({ host: url.hostname, method: options.method });
      let status = 200;
      let location = "";
      let body = "<html>pagina sintetica</html>";
      if (url.hostname === "tidd.ly") {
        status = 302;
        location = url.pathname === "/primeiro"
          ? "https://www.kabum.com.br/produto/10101"
          : "https://www.kabum.com.br/produto/20202";
      } else if (url.hostname === "desc.vc") {
        status = 302;
        location = "https://descontostop.example/promocao/primeiro";
      } else if (url.hostname === "descontostop.example") {
        body = '<nav><a href="https://www.amazon.com.br/dp/B000000001">Anuncio</a></nav>' +
          '<main><article><h1>Produto em destaque</h1>' +
          '<a href="https://www.amazon.com.br/dp/B012345678">Ver na Loja</a></article></main>';
      } else if (url.hostname === "ofertou.me") {
        const literal = Buffer.from(meli).toString("base64");
        body = `<script>fetch('/tracking',{method:'POST'});globalThis.__executado=true;` +
          `location.replace(atob("${literal}"));</script>`;
      } else if (url.hostname === "magazineluiza.onelink.me") {
        status = 302;
        location = "https://www.magazineluiza.com.br/produto/p/123456789";
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

function extrairFuncao(nome, proximo) {
  const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  const start = source.indexOf(`async function ${nome}(`);
  const end = source.indexOf(proximo, start);
  assert(start >= 0 && end > start, `fronteira real ${nome} preservada`);
  return source.slice(start, end);
}

function criarPreparadorRadar(permitir, resolver) {
  const corpo = extrairFuncao("prepararLinksRedirectEngineRadar",
    "async function registrarEventoBrutoEngineRadar");
  return new Function("linkRedirectPermitidoRadar", "camposIdentidadeCanonicaOferta",
    "resolverLinkOriginalRadar", "dominioMarketplaceConhecidoRadar", "criarContratoPreparacaoLinks",
    `${corpo}; return prepararLinksRedirectEngineRadar;`)(
    permitir, camposIdentidadeCanonicaOferta, resolver, detectarMarketplaceLink,
    criarContratoPreparacaoLinks);
}

function criarResolverRadar(permitir) {
  const corpo = extrairFuncao("resolverLinkOriginalRadar", "function motivoKabumIncompletoControlado");
  return new Function("limparLinkRadar", "dominioRadar", "logDebug", "logRedirectRadar",
    "dominioMarketplaceConhecidoRadar", "camposIdentidadeCanonicaOferta",
    "linkRedirectPermitidoRadar", "normalizarMarketplaceRadar", "detectarMarketplaceRadarLink",
    "resolverRedirectUniversal", "logPromozoneRadar", "normalizarMotivoTecnicoRedirect",
    `${corpo}; return resolverLinkOriginalRadar;`)(
    value => String(value || "").trim(), value => { try { return new URL(value).hostname; } catch { return ""; } }, noop, noop,
    detectarMarketplaceLink, camposIdentidadeCanonicaOferta, permitir,
    value => value, () => "", resolverRedirectUniversal, noop, normalizarMotivoTecnicoRedirect);
}

async function executar() {
  const chamadas = [];
  const safeHttpDeps = { lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    requestImpl: transporte(chamadas) };
  let consultasLegadas = 0;
  let gravacoes = 0;
  const dynamicRegistry = { localizar: () => { consultasLegadas++; return null; },
    adicionar: () => { gravacoes++; }, atualizar: () => { gravacoes++; },
    excluir: () => { gravacoes++; } };
  const aprovadas = [
    familiaAprovada("kabum", urls.tiddly, "http_redirect"),
    familiaAprovada("amazon", urls.desc, "html_contextual"),
    familiaAprovada("meli", urls.ofertou, "html_static_base64"),
    familiaAprovada("magalu", urls.magalu, "http_redirect")
  ];
  const habilitada = { habilitada: true, familias: aprovadas };
  const off = { habilitada: false, get familias() { throw new Error("OFF leu familias"); } };
  const base = { dynamicRegistry, safeHttpDeps };

  assert.equal(dominioRedirectPermitido(urls.tiddly, { ...base, ponteInteligente: off }), false);
  const chamadasAntes = chamadas.length;
  const semOpcao = await resolverRedirectUniversal(urls.tiddly, base);
  const desabilitada = await resolverRedirectUniversal(urls.tiddly,
    { ...base, ponteInteligente: off });
  const invalida = await resolverRedirectUniversal(urls.tiddly,
    { ...base, ponteInteligente: { habilitada: "true", familias: aprovadas } });
  assert.deepEqual(desabilitada, semOpcao, "OFF e byte-a-byte equivalente ao retorno legado");
  assert.deepEqual(invalida, semOpcao, "configuracao invalida falha fechada");
  assert.equal(chamadas.length, chamadasAntes, "OFF nao faz HTTP adicional");
  assert.equal(consultasLegadas, 4, "OFF so consulta o registry legado como antes");
  assert.equal(gravacoes, 0, "OFF nao grava registry");
  assert.deepEqual(await resolverRedirectUniversal(urls.tiddly,
    { ...base, ponteInteligente: off, clienteId: "workspace-b" }), semOpcao,
  "a mesma URL em outra workspace sem opt-in continua no legado");
  assert.equal(dominioRedirectPermitido(urls.desconhecida,
    { ...base, ponteInteligente: habilitada }), false);
  const rascunho = { ...aprovadas[0], estado: "rascunho", aprovadoInteligente: false };
  const legadoAtivo = { ...aprovadas[0], ativo: true };
  for (const registro of [rascunho, legadoAtivo]) {
    assert.equal(dominioRedirectPermitido(urls.tiddly,
      { ...base, ponteInteligente: { habilitada: true, familias: [registro] } }), false);
  }
  assert.equal(dominioRedirectPermitido(urls.tiddly,
    { ...base, ponteInteligente: { habilitada: true, familias: [aprovadas[0], aprovadas[0]] } }), false,
  "familia duplicada nao fornece autoridade ambigua");
  assert.equal(dominioRedirectPermitido(urls.tiddly,
    { ...base, ponteInteligente: { habilitada: true, familias: Array(33).fill(aprovadas[0]) } }), false,
  "configuracao excessiva falha fechada");

  const resolucoes = new Map();
  for (const url of [urls.tiddly, urls.tiddlySegundo, urls.desc, urls.ofertou, urls.magalu]) {
    const result = await resolverRedirectUniversal(url,
      { ...base, ponteInteligente: habilitada });
    resolucoes.set(url, result);
    assert.equal(result.ok, false, "destino aprendido jamais e um link comercial resolvido");
    assert.equal(result.prontoComercial, false);
    assert.equal(result.chaveCanonica, undefined);
    assert.equal(result.linkAfiliado, undefined);
  }
  for (const url of [urls.tiddly, urls.tiddlySegundo, urls.desc, urls.ofertou]) {
    const result = resolucoes.get(url);
    assert.equal(result.status, "candidato");
    assert(result.destinoCandidato.startsWith("https://"));
    assert(result.marketplaceCandidato);
    assert.equal(result.urlFinal, "", "candidato nao substitui o link original");
  }
  assert.equal(resolucoes.get(urls.magalu).status, "falhou");
  assert.equal(resolucoes.get(urls.magalu).statusHttp, 403);
  assert.equal(resolucoes.get(urls.magalu).destinoCandidato, undefined);
  assert.equal(resolucoes.get(urls.magalu).urlFinal, "",
    "HTTP 403 nao entrega URL de produto ao Radar como prova de identidade");
  assert.equal(globalThis.__executado, undefined, "scripts nao foram executados");
  assert(chamadas.every(item => item.method === "GET"), "tracking POST nao foi executado");
  assert(!chamadas.some(item => item.host === "meli.la"));

  const erroMetodo = await resolverRedirectUniversal(urls.tiddly, { ...base,
    ponteInteligente: { habilitada: true, familias: [
      { ...aprovadas[0], metodoDescoberto: "html_contextual" }
    ] } });
  assert.equal(erroMetodo.ok, false);
  assert.equal(erroMetodo.destinoCandidato, undefined);
  assert.equal(erroMetodo.motivo, "familia_metodo_divergente");
  const naoConfiavel = await resolverRedirectUniversal(urls.tiddly, { ...base,
    ponteInteligente: { habilitada: true, familias: [{ ...aprovadas[0],
      linkAfiliado: "https://affiliate.example/terceiro",
      evidenciaOficial: { productId: "produto-divergente" } }] } });
  assert.equal(naoConfiavel.status, "candidato");
  assert.equal(naoConfiavel.linkAfiliado, undefined);
  assert.equal(naoConfiavel.chaveCanonica, undefined,
    "registro aprendido nao injeta identidade nem afiliacao de terceiros");

  const permitir = (url, opcoes) => dominioRedirectPermitido(url,
    { ...base, ponteInteligente: opcoes?.ponteInteligente });
  const resolverRadar = criarResolverRadar(permitir);
  const prepararRadar = criarPreparadorRadar(permitir, resolverRadar);
  const dados = { linksExtraidos: [urls.tiddly, urls.desc, urls.ofertou, urls.magalu],
    textoOriginal: "Captura sintetica com APP, PC, Moedas e Resgate",
    clienteId: "workspace-a", sessaoId: "sessao-a", grupoId: "grupo-a",
    metadata: { origem: "radar_whatsapp", prioridade: "normal", precoOrigem: "captura" } };
  const radar = await prepararRadar(dados, { ponteInteligente: habilitada, safeHttpDeps });
  assert.deepEqual(radar.preparacaoLinks.linksOriginais, dados.linksExtraidos);
  assert.deepEqual(radar.preparacaoLinks.linksPreparados, dados.linksExtraidos,
    "preparacao real nao promove candidatos a links comerciais");
  assert.deepEqual(radar.preparacaoLinks.redirects.map(item => item.destinoCandidato || ""),
    dados.linksExtraidos.map(url => resolucoes.get(url).destinoCandidato || ""));
  assert.deepEqual(radar.preparacaoLinks.identidadesCanonicas, []);
  assert.equal(radar.dados.clienteId, "workspace-a");
  assert.equal(radar.dados.sessaoId, "sessao-a");
  assert.equal(radar.dados.grupoId, "grupo-a");
  assert.equal(radar.dados.metadata.prioridade, "normal");
  assert.equal(radar.dados.metadata.precoOrigem, "captura");
  assert.equal(radar.dados.textoOriginal, dados.textoOriginal);

  // O adaptador Telegram e o handoff continuam donos de checkpoint, ACK e dedupe.
  const store = createMemoryTeleradarStore();
  const context = { clientId: "admin", workspaceId: "workspace_admin", scope: "admin_master",
    feature: "teleradar", accountIdInterno: "telegram-admin" };
  let ingressos = 0;
  let checkpoints = 0;
  let teleradarPreparado;
  const ingress = createRadarIngressAdapter({ processarMensagemRadar: async recebida => {
    ingressos++;
    assert.equal(recebida.fonteCaptura, "teleradar");
    assert.equal(recebida.aguardarAckEngine, true);
    teleradarPreparado = await prepararRadar({ linksExtraidos: recebida.linksCapturados,
      textoOriginal: recebida.texto, clienteId: context.clientId, sessaoId: recebida.sessaoId,
      grupoId: recebida.grupoId, metadata: { origem: recebida.fonteCaptura } },
    { ponteInteligente: habilitada, safeHttpDeps });
    return { radarAccepted: true, radarAck: "RADAR_ACCEPTED", radarEventId: "simulado-1" };
  } });
  const handoff = createHandoffService({ context, store, radarIngress: ingress,
    clock: () => new Date("2026-10-16T10:00:01Z"), beforeAttempt: async () => { checkpoints++; } });
  const envelope = createEnvelope({ accountId: "10001", chatId: "-10001", messageId: "20001",
    senderId: "30001", receivedAt: "2026-10-16T10:00:01Z",
    sourceTimestamp: "2026-10-16T10:00:00Z", text: `Oferta ${urls.tiddly}`,
    entities: [{ type: "url", occurrence: 0, offset: 7, length: urls.tiddly.length,
      label: urls.tiddly, url: urls.tiddly }] });
  assert.equal((await handoff.persistEnvelope(envelope)).created, true);
  assert.equal((await handoff.attempt(envelope.eventId)).accepted, true);
  assert.equal((await handoff.persistEnvelope(envelope)).created, false);
  assert.equal((await handoff.attempt(envelope.eventId)).skipped, true);
  assert.equal(ingressos, 1);
  assert.equal(checkpoints, 1);
  assert.equal((await handoff.get(envelope.eventId)).status, "acked");
  assert.equal(teleradarPreparado.dados.clienteId, "admin");
  assert.equal(teleradarPreparado.dados.metadata.origem, "teleradar");
  assert.deepEqual(teleradarPreparado.preparacaoLinks.linksPreparados, [urls.tiddly]);
  assert(teleradarPreparado.preparacaoLinks.redirects[0].destinoCandidato);

  const clone = await resolverLinksClonador(dados.linksExtraidos, url =>
    resolverRedirectClonador(url, { ...base, ponteInteligente: habilitada }));
  assert.deepEqual(clone.linksOriginais, dados.linksExtraidos);
  assert.deepEqual(clone.linksPreparados, dados.linksExtraidos);
  assert.deepEqual(clone.identidadesCanonicas, []);
  assert.deepEqual(clone.redirects.map(item => item.destinoCandidato || ""),
    dados.linksExtraidos.map(url => resolucoes.get(url).destinoCandidato || ""));
  assert.equal((await resolverRedirectClonador(meli, base)).ok, false,
    "o caminho especializado meli.la nao e promovido pela ponte");

  const antesRollback = chamadas.length;
  assert.deepEqual(await resolverRedirectUniversal(urls.tiddly,
    { ...base, ponteInteligente: off }), semOpcao, "OFF restaura o comportamento legado");
  assert.equal(chamadas.length, antesRollback, "rollback logico nao faz HTTP");
  assert.equal(gravacoes, 0, "simulacao inteira nao grava no registry");
  console.log("links-v30-ponte-operacional-off.test.js PASS");
}

executar().catch(error => { console.error(error); process.exitCode = 1; });
