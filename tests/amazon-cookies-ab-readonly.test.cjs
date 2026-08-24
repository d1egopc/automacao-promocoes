"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

const inicio = fonte.indexOf('app.get("/integracoes/amazon/cookies/ab"');
assert.ok(inicio >= 0, "Endpoint temporario A/B Amazon Cookies deve existir");

const fim = fonte.indexOf("//============= ROTA INTEGRACOES", inicio);
assert.ok(fim > inicio, "Endpoint A/B deve ficar isolado antes das rotas de integracoes");

const trecho = fonte.slice(inicio, fim);

assert.ok(trecho.includes("isAdminMaster(req)"), "Endpoint A/B deve exigir Admin Master");
assert.ok(trecho.includes("obterClienteIdAmazonCookiesAb(req)"), "Endpoint A/B deve exigir workspace alvo explicito");
assert.ok(trecho.includes("clienteId/workspaceId alvo obrigatorio"), "Admin sem clienteId deve receber erro controlado");
assert.ok(trecho.includes("workspaceExisteAmazonCookiesAb(clienteId)"), "Endpoint A/B deve validar existencia do workspace alvo");
assert.ok(trecho.includes("Workspace alvo nao encontrado"), "Workspace inexistente deve receber erro controlado");
assert.ok(trecho.includes('getIntegracaoCliente(clienteId, "amazon")'), "Endpoint A/B deve usar somente integracao Amazon");
assert.ok(trecho.includes("Amazon nao configurada para este workspace"), "Amazon ausente deve receber erro controlado");
assert.ok(trecho.includes("!modoAmazonCookies(config)"), "Endpoint A/B nao deve atingir Amazon API");
assert.ok(trecho.includes("Amazon em modo API; A/B Cookies nao executado"), "Amazon API deve ser bloqueada sem executar A/B cookies");
assert.ok(trecho.includes("AMAZON_COOKIES_AB_COOKIE_LIXO"), "Endpoint A/B deve comparar contra cookie lixo controlado");
assert.ok(trecho.includes("medirProvaAmazonCookiesAb(clienteId, configBase)"), "Endpoint A/B deve medir cookies reais");
assert.ok(trecho.includes("medirProvaAmazonCookiesAb(clienteId, {"), "Endpoint A/B deve medir cookie lixo com a mesma operacao");
assert.ok(trecho.includes('diferenciou = real.resultado === "saudavel" && lixo.resultado !== "saudavel"'), "Diferenciacao deve exigir real saudavel e lixo nao saudavel");
assert.ok(!trecho.includes("getClienteId(req)"), "Endpoint A/B nao deve cair no workspace do chamador");
assert.ok(!trecho.includes("registrarSucessoIntegracao"), "Endpoint A/B nao pode registrar sucesso de saude");
assert.ok(!trecho.includes("registrarAlertaIntegracao"), "Endpoint A/B nao pode registrar alerta de saude");
assert.ok(!trecho.includes("salvarIntegracoesPersistidas"), "Endpoint A/B nao pode persistir integracoes");
assert.ok(!trecho.includes("salvarResultadoTesteIntegracao"), "Endpoint A/B nao pode persistir ultimo teste");
const payloadResposta = trecho.slice(trecho.indexOf("return res.json({"));
assert.ok(!payloadResposta.includes("cookiesReais"), "Endpoint A/B nao pode retornar cookies reais");
assert.ok(!payloadResposta.includes("credenciais"), "Endpoint A/B nao pode retornar credenciais");

const helperWorkspace = fonte.slice(
  fonte.indexOf("function obterClienteIdAmazonCookiesAb"),
  fonte.indexOf('app.get("/integracoes/amazon/cookies/ab"')
);

assert.ok(helperWorkspace.includes("req.query.clienteId || req.query.workspaceId"), "Helper deve aceitar clienteId ou workspaceId");
assert.ok(helperWorkspace.includes("usuarios.some"), "Helper deve validar workspace alvo na lista de usuarios");

const helper = fonte.slice(
  fonte.indexOf("function criarImportadorAmazonCookiesAb"),
  fonte.indexOf('app.get("/integracoes/amazon/cookies/ab"', fonte.indexOf("async function medirProvaAmazonCookiesAb"))
);

assert.ok(helper.includes("criarImportarAmazon({"), "A/B deve reutilizar o importador Amazon real");
assert.ok(helper.includes('sinal.tipo = "sucesso"'), "A/B deve capturar sucesso em memoria");
assert.ok(helper.includes('sinal.tipo = "alerta"'), "A/B deve capturar alerta em memoria");
assert.ok(helper.includes('ativo: false'), "A/B deve desativar Link Optimus para nao criar persistencia auxiliar");
assert.ok(helper.includes('codigo === "cookie_valido"'), "A/B deve considerar positivo somente cookie_valido real do importador");
assert.ok(helper.includes('codigo === "cookie_expirado"'), "A/B deve considerar invalido somente cookie_expirado real do importador");
assert.ok(!helper.includes("registrarResultadoSaudeIntegracao"), "Helper A/B nao pode persistir saude");

console.log("amazon-cookies-ab-readonly.test.cjs ok");
