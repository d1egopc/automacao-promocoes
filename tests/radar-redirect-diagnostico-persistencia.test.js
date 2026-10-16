"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizarMotivoTecnicoRedirect } =
  require("../modules/radar/redirect/redirect-diagnostic-code");

const raiz = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(raiz, "index.js"), "utf8");
const inbox = fs.readFileSync(path.join(raiz, "modules/engine/inbox.service.js"), "utf8");
const original = "https://seuhardware.com/s/fixture?tracking=SEGREDO";

function trecho(fonte, inicio, fim) {
  const a = fonte.indexOf(inicio);
  const b = fonte.indexOf(fim, a);
  assert.ok(a >= 0 && b > a, `fronteira ausente: ${inicio}`);
  return fonte.slice(a, b);
}

function criarResolver(resposta) {
  const corpo = trecho(index, "async function resolverLinkOriginalRadar(", "function motivoKabumIncompletoControlado(");
  return new Function(
    "limparLinkRadar", "dominioRadar", "logDebug", "logRedirectRadar",
    "dominioMarketplaceConhecidoRadar", "camposIdentidadeCanonicaOferta",
    "linkRedirectPermitidoRadar", "normalizarMarketplaceRadar",
    "detectarMarketplaceRadarLink", "resolverRedirectUniversal",
    "logPromozoneRadar", "normalizarMotivoTecnicoRedirect",
    "limparUrlProdutoRadar", "logProdutoCanonicoRadar",
    `${corpo}; return resolverLinkOriginalRadar;`
  )(
    url => url, url => url ? new URL(url).hostname : "", () => {}, () => {},
    () => "", () => ({}), () => true, valor => valor,
    () => "", async () => resposta, () => {}, normalizarMotivoTecnicoRedirect,
    url => url, () => {}
  );
}

function criarPreparador(resolver) {
  const corpo = trecho(index, "async function prepararLinksRedirectEngineRadar(", "async function registrarEventoBrutoEngineRadar(");
  return new Function(
    "linkRedirectPermitidoRadar", "resolverLinkOriginalRadar",
    "dominioMarketplaceConhecidoRadar", "criarContratoPreparacaoLinks",
    `${corpo}; return prepararLinksRedirectEngineRadar;`
  )(
    () => true, resolver, () => "",
    dados => ({
      linksOriginais: dados.linksOriginais,
      linksPreparados: dados.linksPreparados,
      redirects: dados.redirects,
      identidadesCanonicas: dados.identidadesCanonicas
    })
  );
}

function criarPersistidor(consultas) {
  const corpo = trecho(inbox, "function listarRedirectsEvento(", "// Opt-in local candidate.");
  return new Function(
    "normalizarUrl", "normalizarMotivoTecnicoRedirect",
    "detectarMarketplaceLink", "classificarLinkEngine", "dominioUrl",
    "jsonbParam", "logEngineEventoBrutoErro", "queryEngine",
    `${corpo}; return salvarLinksEvento;`
  )(
    url => url, normalizarMotivoTecnicoRedirect, () => "",
    () => ({ papelLink: "desconhecido", motivo: "sem_identidade", confianca: "baixa", urlProduto: "" }),
    url => new URL(url).hostname, JSON.stringify, () => {},
    async (sql, parametros) => { consultas.push({ sql, parametros }); return { ok: true }; }
  );
}

async function capturar(fn) {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
}

(async () => {
  const casos = [
    [{ motivo: "redirect_timeout", metodo: "erro_http" }, "redirect_timeout"],
    [{ motivo: "REDIRECT_LIMIT", metodo: "erro_http" }, "REDIRECT_LIMIT"],
    [{ motivo: "REDIRECT_LOOP", metodo: "erro_http" }, "REDIRECT_LOOP"],
    [{ motivo: "URL_BLOQUEADA_SEGURANCA", metodo: "erro_http" }, "URL_BLOQUEADA_SEGURANCA"],
    [{ motivo: "REDIRECT_BODY_LIMIT", metodo: "erro_http" }, "REDIRECT_BODY_LIMIT"],
    [{ motivo: "http_status_403", metodo: "erro_http", statusHttp: 403 }, "http_status_403"],
    [{ motivo: "http_status_502", metodo: "erro_http", statusHttp: 502 }, "http_status_502"],
    [{ motivo: "limite_redirect_html", metodo: "meta_refresh" }, "limite_redirect_html"],
    [{ motivo: "redirect_nao_resolvido", metodo: "html_sem_redirect" }, "html_destino_nao_identificado"],
    [{ motivo: "identidade_ml_nao_comprovada", metodo: "validacao_identidade" }, "identidade_ml_nao_comprovada"],
    [{ motivo: `https://site.exemplo/produto?token=SEGREDO`, metodo: "erro_http" }, "redirect_falha_nao_classificada"]
  ];

  for (const [falha, esperado] of casos) {
    const resposta = { ok: false, urlFinal: "", marketplaceDetectado: "", ...falha };
    const resolver = criarResolver(resposta);
    const resultado = await capturar(() => resolver(original));
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, falha.metodo === "erro_http"
      ? "promozone_redirect_bloqueado" : "promozone_redirect_nao_resolvido");
    assert.equal(resultado.motivoTecnico, resultado.motivo, "campo legado preservado");
    assert.equal(resultado.motivoRedirectTecnico, esperado);

    const preparado = await capturar(() => criarPreparador(resolver)({ linksExtraidos: [original] }));
    assert.deepEqual(preparado.dados.linksExtraidos, [original]);
    assert.equal(preparado.dados.metadata.redirectsRadar[0].motivo, resultado.motivo);
    assert.equal(preparado.dados.metadata.redirectsRadar[0].motivoRedirectTecnico, esperado);
    assert.equal(preparado.dados.metadata.redirectsRadar[0].linkOriginalCapturado, original);

    const consultas = [];
    await criarPersistidor(consultas)(42, preparado.dados.linksExtraidos, preparado.dados.metadata);
    assert.equal(consultas.length, 1);
    const valores = consultas[0].parametros;
    assert.equal(valores[1], original, "url_original intacta");
    assert.equal(valores[6], false, "redirect_ok legado inalterado");
    assert.equal(valores[7], resultado.motivo, "motivo_redirect legado inalterado");
    const metadata = JSON.parse(valores[9]);
    assert.equal(metadata.motivoRedirectTecnico, esperado);
    assert.equal(metadata.papelLink, "desconhecido", "classificacao comercial inalterada");
    assert.ok(!JSON.stringify(metadata).includes("SEGREDO") || metadata.linkOriginalCapturado === original,
      "diagnostico nao pode copiar segredo para campo tecnico");
    assert.equal(metadata.motivoRedirectTecnico.includes("SEGREDO"), false);
  }

  assert.equal(normalizarMotivoTecnicoRedirect({ motivo: "http_status_403?token=SEGREDO" }),
    "redirect_falha_nao_classificada");
  const consultasNaoConfiaveis = [];
  await criarPersistidor(consultasNaoConfiaveis)(43, [original], {
    redirectsRadar: [{ linkOriginalCapturado: original, status: "falhou",
      motivo: "promozone_redirect_bloqueado", motivoRedirectTecnico: "erro token=SEGREDO" }]
  });
  assert.equal(JSON.parse(consultasNaoConfiaveis[0].parametros[9]).motivoRedirectTecnico,
    "redirect_falha_nao_classificada", "persistencia revalida codigo controlado");

  const produto = "https://www.amazon.com.br/dp/B0TESTE123";
  const resolvido = await capturar(() => criarResolver({ ok: true, urlFinal: produto,
    marketplaceDetectado: "amazon", motivo: "redirect_resolvido_marketplace" })(original));
  assert.equal(resolvido.ok, true);
  assert.equal(resolvido.linkResolvido, produto);
  assert.equal(resolvido.motivoRedirectTecnico, undefined, "sucesso nao ganha diagnostico de falha");
  const preparadoResolvido = await capturar(() => criarPreparador(criarResolver({ ok: true,
    urlFinal: produto, marketplaceDetectado: "amazon", motivo: "redirect_resolvido_marketplace" }))
    ({ linksExtraidos: [original] }));
  assert.deepEqual(preparadoResolvido.dados.linksExtraidos, [produto]);
  assert.equal(Object.hasOwn(preparadoResolvido.dados.metadata.redirectsRadar[0], "motivoRedirectTecnico"), false);
  const consultasResolvidas = [];
  await criarPersistidor(consultasResolvidas)(44, [produto], preparadoResolvido.dados.metadata);
  assert.equal(consultasResolvidas[0].parametros[1], original);
  assert.equal(consultasResolvidas[0].parametros[6], true);
  assert.equal(Object.hasOwn(JSON.parse(consultasResolvidas[0].parametros[9]), "motivoRedirectTecnico"), false);

  const destinoNaoComprovado = await capturar(() => criarResolver({ ok: true,
    urlFinal: original, marketplaceDetectado: "", motivo: "redirect_resolvido_marketplace" })(original));
  assert.equal(destinoNaoComprovado.ok, false);
  assert.equal(destinoNaoComprovado.motivoRedirectTecnico, "destino_comercial_nao_comprovado");
  assert.equal(destinoNaoComprovado.motivo, "promozone_redirect_nao_resolvido");
  console.log("radar-redirect-diagnostico-persistencia.test.js ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
