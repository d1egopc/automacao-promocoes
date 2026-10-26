"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const express = require("express");
const jwt = require("jsonwebtoken");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { criarAdminMasterEstrito } = require("../utils/admin-auth-estrito");
const { criarRegistroDinamico } = require("../modules/radar/redirect/dynamic-resolver-registry");
const { criarRotasResolversDinamicos } = require("../modules/radar/redirect/dynamic-resolver-admin.routes");

async function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "links-v23-"));
  const file = path.join(dir, "registry.json");
  const registry = criarRegistroDinamico({ file });
  const calls = [];
  const responses = new Map();
  const safeHttpDeps = {
    lookup: async host => [{ address: host === "private.example.com" ? "10.0.0.2" : "8.8.8.8", family: 4 }],
    requestImpl(url, _options, callback) {
      const req = new EventEmitter();
      req.destroy = () => { req.destroyed = true; };
      req.end = () => queueMicrotask(() => {
        calls.push(url.href);
        const value = responses.get(url.hostname + url.pathname) || responses.get(url.pathname) || { status: 200, body: "" };
        if (value.error) { req.emit("error", Object.assign(new Error(value.error), { code: value.code })); return; }
        const res = new EventEmitter();
        res.statusCode = value.status;
        res.headers = { location: value.location || "" };
        res.complete = true;
        res.destroy = () => { res.destroyed = true; };
        callback(res);
        res.emit("data", Buffer.from(value.body || ""));
        res.emit("end");
      });
      return req;
    }
  };
  const users = [{ id: "admin_a", papel: "admin_master", ativo: true },
    { id: "admin_b", papel: "admin_master", ativo: true }, { id: "client_a", papel: "usuario", ativo: true }];
  const secret = "isolated-fixture-only";
  const auth = criarAdminMasterEstrito({ jwt, getJwtSecret: () => secret, getUsuarios: () => users,
    usuarioEhAdminMaster: user => user.papel === "admin_master" });
  const app = express();
  app.use(express.json());
  app.use("/admin/links/resolvers", auth, criarRotasResolversDinamicos({ registry, safeHttpDeps }));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/admin/links/resolvers`;
  const request = async (endpoint, body, who = "admin_a", method = body === undefined ? "GET" : "POST") => {
    const headers = { "content-type": "application/json" };
    if (who) headers.authorization = `Bearer ${jwt.sign({ clienteId: who }, secret)}`;
    const response = await fetch(base + endpoint, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const inspect = urlExemplo => request("/inspect", { urlExemplo });
  try { await run({ responses, registry, calls, request, inspect, file }); }
  finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
}

test("HTTP redirect, HTML contextual, meta refresh and static literals reuse the safe resolver", () => fixture(async f => {
  f.responses.set("/s/first", { status: 302, location: "https://shopee.com.br/product/10/20" });
  const a = (await f.inspect("https://external.example.com/s/first")).data;
  assert.equal(a.resultado, "resolvido");
  assert.equal(a.metodo, "http_redirect");
  assert.equal(a.rascunhoElegivel, true);
  assert.equal(a.marketplaceReconhecido, "nao_comprovado", "a origem externa não é o marketplace final");
  assert.equal(a.marketplaceCandidato, "shopee");
  assert.deepEqual(a.hops.map(x => x.status), [302, 200]);
  assert.equal(a.produtoConfirmado, false);
  assert.equal(a.afiliacaoConfirmada, false);
  assert.equal(f.registry.listar().length, 0, "inspeção não salva nem ativa");
  f.responses.set("/s/context", { status: 200, body: '<main><h1>Furadeira de impacto profissional</h1><a href="https://shopee.com.br/product/10/20">Ver oferta</a></main>' });
  assert.equal((await f.inspect("https://external.example.com/s/context")).data.metodo, "html_contextual");
  f.responses.set("/s/meta", { status: 200, body: '<meta http-equiv="refresh" content="0;url=https://shopee.com.br/product/10/20">' });
  assert.equal((await f.inspect("https://external.example.com/s/meta")).data.metodo, "meta_refresh");
  f.responses.set("/s/static", { status: 200, body: '<script>globalThis.MUST_NOT_EXECUTE=true;window.location="https://shopee.com.br/product/10/20"</script>' });
  assert.equal((await f.inspect("https://external.example.com/s/static")).data.metodo, "window_location");
  assert.equal(globalThis.MUST_NOT_EXECUTE, undefined);
  for (const status of [301, 307, 308]) {
    f.responses.set(`/s/http${status}`, { status, location: "https://shopee.com.br/product/10/20" });
    assert.equal((await f.inspect(`https://external.example.com/s/http${status}`)).data.resultado, "resolvido");
  }
}));

test("403, timeout, network failure, loop, redirect limit and missing identity remain explicit", () => fixture(async f => {
  const cases = [
    ["403", { status: 403 }, "http_status_403", "http"],
    ["timeout", { error: "REDIRECT_TIMEOUT" }, "redirect_timeout", "rede"],
    ["network", { error: "socket unavailable", code: "ECONNRESET" }, "redirect_bloqueado", "rede"],
    ["loop", { status: 302, location: "/s/loop" }, "REDIRECT_LOOP", "redirect"],
    ["empty", { status: 200, body: "no destination" }, "html_destino_nao_identificado", "html"]
  ];
  for (const [slug, response, reason, stage] of cases) {
    f.responses.set(`/s/${slug}`, response);
    const value = (await f.inspect(`https://external.example.com/s/${slug}`)).data;
    assert.equal(value.resultado, "investigacao_pendente", slug);
    assert.equal(value.motivoTecnico, reason, slug);
    assert.equal(value.etapa, stage, slug);
    assert.equal(value.rascunhoElegivel, false);
    assert.equal(value.investigacaoElegivel, true);
  }
  for (let n = 0; n < 7; n++) f.responses.set(`/s/limit${n}`, { status: 302, location: `/s/limit${n + 1}` });
  assert.equal((await f.inspect("https://external.example.com/s/limit0")).data.motivoTecnico, "REDIRECT_LIMIT");
  f.responses.set("/s/home", { status: 302, location: "https://shopee.com.br/" });
  const home = (await f.inspect("https://external.example.com/s/home")).data;
  assert.equal(home.resultado, "investigacao_pendente");
  assert.equal(home.motivoTecnico, "identidade_nao_comprovada");
  assert.equal(home.rascunhoElegivel, false);
  assert.equal((await f.request("/drafts", { urlExemplo: "https://external.example.com/s/home" })).status, 422);
  assert.equal(home.identidade, "nao_comprovada");
  assert.equal(home.produtoConfirmado, false);
  assert.equal(home.afiliacaoConfirmada, false);
  f.responses.set("/s/legacy", { status: 302, location: "https://amzlink.to/public-fixture" });
  const legacy = f.registry.adicionar({ host: "external.example.com", pathPrefix: "/s/", urlExemplo: "https://external.example.com/s/legacy" });
  const retest = await f.request(`/${legacy.id}/test`, {});
  assert.equal(retest.data.ok, false);
  assert.equal(retest.data.debug.motivo, "identidade_nao_comprovada", "rejeição não pode afirmar validado");
}));

test("unsafe origin, DNS, redirect and ambiguous HTML never authorize a domain", () => fixture(async f => {
  for (const url of ["http://127.0.0.1/s/a", "http://169.254.169.254/latest", "https://private.example.com/s/a", "https://user:password@external.example.com/s/a"]) {
    const value = (await f.inspect(url)).data;
    assert.equal(value.resultado, "bloqueado_seguranca");
    assert.equal(value.rascunhoElegivel, false);
    assert.equal(value.investigacaoElegivel, false);
  }
  assert.equal(f.calls.length, 0, "nenhuma requisição alcança rede privada");
  f.responses.set("/s/private", { status: 302, location: "http://169.254.169.254/latest" });
  assert.equal((await f.inspect("https://external.example.com/s/private")).data.resultado, "bloqueado_seguranca");
  assert.equal(f.calls.length, 1);
  f.responses.set("/s/ambiguous", { status: 200, body: '<main><h1>Produto</h1><a href="https://shopee.com.br/product/1/2">Ver oferta</a><a href="https://amazon.com.br/dp/B012345678">Ver oferta</a></main>' });
  assert.equal((await f.inspect("https://external.example.com/s/ambiguous")).data.resultado, "investigacao_pendente");
  assert.equal(f.registry.listar().length, 0);
}));

test("pending persistence contains no confidential URL, cannot activate, and is tenant scoped", () => fixture(async f => {
  f.responses.set("/s/pending", { status: 403 });
  const urlExemplo = "https://external.example.com/s/pending?token=CONFIDENTIAL_VALUE&email=private@example.com";
  assert.equal((await f.request("/inspect", { urlExemplo }, "client_a")).status, 403);
  assert.equal((await f.request("/inspect", { urlExemplo }, null)).status, 401);
  assert.equal(f.calls.length, 0);
  const saved = await f.request("/investigations", { urlExemplo });
  assert.equal(saved.status, 201);
  const record = saved.data.resolver;
  assert.equal(record.ativo, false);
  assert.equal(record.estado, "investigacao_pendente");
  assert.equal(record.urlExemplo, undefined);
  assert.equal(record.workspaceId, undefined);
  const persisted = fs.readFileSync(f.file, "utf8");
  for (const secret of ["CONFIDENTIAL_VALUE", "private@example.com", "?token", "/pending"]) assert.equal(persisted.includes(secret), false);
  assert.equal(criarRegistroDinamico({ file: f.file }).listar()[0].estado, "investigacao_pendente");
  const baselineModule = { exports: {} };
  const baselineSource = execFileSync("git", ["show", "31ea52117bf98fc8d3494126cc445920332e98d1:modules/radar/redirect/dynamic-resolver-registry.js"], { encoding: "utf8" });
  vm.runInNewContext(baselineSource, { module: baselineModule, exports: baselineModule.exports, require, process });
  const rollbackReader = baselineModule.exports.criarRegistroDinamico({ file: f.file });
  assert.equal(rollbackReader.buscar(record.id).estado, "rascunho");
  assert.throws(() => rollbackReader.atualizar(record.id, { ativo: true }), /RASCUNHO_NAO_HOMOLOGADO/,
    "a versão publicada também deve impedir ativação ao ler a investigação após rollback");
  assert.equal(f.registry.localizar(urlExemplo), null);
  assert.equal((await f.request("", undefined, "admin_b")).data.resolvers.length, 0);
  assert.equal((await f.request(`/${record.id}`, { ativo: true }, "admin_a", "PATCH")).status, 400);
  assert.equal((await f.request(`/${record.id}`, undefined, "admin_b", "DELETE")).status, 400);
  assert.equal((await f.request(`/${record.id}/debug`, undefined, "admin_b")).status, 400);
  assert.equal((await f.request(`/${record.id}/test`, {})).status, 400);
  assert.equal((await f.request(`/${record.id}`, undefined, "admin_a", "DELETE")).status, 200);
}));

test("same family requires two compatible current examples before explicit authorization", () => fixture(async f => {
  f.responses.set("/s/first", { status: 302, location: "https://shopee.com.br/product/10/20" });
  f.responses.set("/s/second", { status: 302, location: "https://shopee.com.br/product/10/21" });
  const first = "https://external.example.com/s/first";
  const second = "https://external.example.com/s/second";
  const id = (await f.request("/drafts", { urlExemplo: first })).data.resolver.id;
  assert.equal(f.registry.localizar(first), null);
  assert.equal((await f.request(`/drafts/${id}/authorize`, {})).data.erro, "SEGUNDO_EXEMPLO_OBRIGATORIO");
  assert.equal((await f.request(`/drafts/${id}/test`, { urlExemplo: first })).status, 400);
  assert.equal((await f.request(`/drafts/${id}/test`, { urlExemplo: "https://external.example.com/other/second" })).status, 400);
  assert.equal((await f.request(`/drafts/${id}/test`, { urlExemplo: second })).data.reutilizavel, true);
  f.responses.set("/s/second", { status: 200, body: '<main><h1>Produto profissional</h1><a href="https://shopee.com.br/product/10/21">Ver oferta</a></main>' });
  assert.equal((await f.request(`/drafts/${id}/test`, { urlExemplo: second })).data.reutilizavel, false, "método diferente não comprova a mesma família");
  f.responses.set("/s/second", { status: 302, location: "https://amazon.com.br/dp/B012345678" });
  assert.equal((await f.request(`/drafts/${id}/test`, { urlExemplo: second })).data.reutilizavel, false);
  assert.equal((await f.request(`/drafts/${id}/authorize`, { urlExemplo: second })).status, 400);
  assert.equal(f.registry.localizar(first), null);
  f.responses.set("/s/second", { status: 302, location: "https://shopee.com.br/product/10/21" });
  const approved = await f.request(`/drafts/${id}/authorize`, { urlExemplo: second });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.resolver.exemplosHomologados, 2);
  assert.equal(f.registry.localizar(second)?.id, id);
  assert.equal((await f.inspect(first)).data.cadastroExistente.id, id);
  assert.equal((await f.inspect(first)).data.rascunhoElegivel, false);
  assert.equal((await f.request("/drafts", { urlExemplo: first })).status, 409);
}));

test("official control is inspectable but cannot become a dynamic draft; parameter hint is not proof", () => fixture(async f => {
  f.responses.set("meli.la/22PX5vX", { status: 302, location: "https://www.mercadolivre.com.br/MLB-123456789-produto-_JM" });
  const control = (await f.inspect("https://meli.la/22PX5vX")).data;
  assert.equal(control.resolverOficial, true);
  assert.equal(control.rascunhoElegivel, false);
  assert.equal((await f.request("/drafts", { urlExemplo: "https://meli.la/22PX5vX" })).data.erro, "RESOLVER_HARDCODED");
  const hint = (await f.inspect("https://external.example.com/s/nohtml?url=https%3A%2F%2Fshopee.com.br%2Fproduct%2F10%2F20")).data;
  assert.equal(hint.resultado, "investigacao_pendente");
  assert.match(hint.pistaParametro, /shopee/);
  assert.equal(hint.produtoConfirmado, false);
}));
