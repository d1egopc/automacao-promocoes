"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const express = require("express");
const {
  createLandingPageService,
  emptyConfig,
  pixelId,
} = require("../modules/landing-page/service");
const { createLandingPageRoutes } = require("../modules/landing-page/routes");
const {
  createVercelDomainProvider,
  publicIp,
  httpsReady,
} = require("../modules/landing-page/vercel-domains");
const { slug, customerDomain } = require("../modules/landing-page/addresses");
const recorded = require("./fixtures/landing-vercel-domain-response.json");

function simulatedVercel() {
  const state = {
    domains: new Map(),
    owned: false,
    dns: false,
    https: false,
    verify: true,
    calls: [],
    timeoutAdd: false,
    failRemove: false,
    badProject: false,
  };
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const provider = createVercelDomainProvider({
    env: {
      LANDING_DOMAINS_ENABLED: "true",
      LANDING_VERCEL_TOKEN: "fixture-only-never-a-real-token",
      LANDING_VERCEL_PROJECT_ID: "prj_fixture",
      LANDING_VERCEL_TEAM_ID: "team_fixture",
    },
    ownership: async () => state.owned,
    https: async () => state.https,
    fetch: async (url, options) => {
      assert.equal(url.origin, "https://api.vercel.com");
      assert.equal(url.searchParams.get("teamId"), "team_fixture");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal);
      state.calls.push({ path: url.pathname, method: options.method });
      if (url.pathname === "/v9/projects/prj_fixture")
        return json({
          id: state.badProject ? "prj_other" : "prj_fixture",
          accountId: "team_fixture",
          link: {
            type: "github",
            org: "d1egopc",
            repo: "optimuspromo-frontend",
            productionBranch: "main",
          },
        });
      if (url.pathname.startsWith("/v6/domains/"))
        return json({ ...recorded.config, misconfigured: !state.dns });
      if (url.pathname === "/v10/projects/prj_fixture/domains") {
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body).sort(), ["gitBranch", "name"]);
        assert.equal(body.gitBranch, null);
        const value = { ...recorded.domain, name: body.name, verified: false };
        state.domains.set(body.name, value);
        if (state.timeoutAdd) throw new Error("simulated_timeout");
        return json(value);
      }
      const match =
        /^\/v9\/projects\/prj_fixture\/domains\/([^/]+)(\/verify)?$/.exec(
          url.pathname,
        );
      assert.ok(match, "unknown Vercel endpoint must fail the fixture");
      const host = decodeURIComponent(match[1]);
      const value = state.domains.get(host);
      if (!value) return json({ error: { code: "not_found" } }, 404);
      if (match[2]) {
        value.verified = state.verify;
        return json(value);
      }
      if (options.method === "DELETE") {
        if (state.failRemove)
          return json({ error: { code: "unavailable" } }, 503);
        state.domains.delete(host);
        return new Response(null, { status: 204 });
      }
      return json(value);
    },
  });
  return { provider, state };
}

async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "optimus-landing-v12-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const clock = { value: 1800000000000 };
  const vercel = simulatedVercel();
  const permitted = new Set(["workspace_a", "workspace_b"]);
  const service = createLandingPageService({
    dataDir: dir,
    canPublish: async (id) => permitted.has(id),
    domainProvider: vercel.provider,
    now: () => clock.value,
    ...options,
  });
  const config = (extra = {}) => ({
    ...emptyConfig(),
    name: "Fixture loja",
    ...extra,
  });
  const save = (id, extra, revision = 0) =>
    service.save(id, revision, config(extra));
  const advance = () => {
    clock.value += 11000;
  };
  return { dir, service, clock, permitted, ...vercel, config, save, advance };
}

test("Pixel: extração, IDs inválidos, snapshot publicado e isolamento", async (t) => {
  const { service, save } = await fixture(t);
  const code =
    '<script>fbq("init", "123456789012345"); window.ARBITRARY_SENTINEL=true;</script>';
  assert.equal(pixelId(code), "123456789012345");
  for (const input of [
    "<script>alert(1)</script>",
    "javascript:alert(1)",
    "12",
    'fbq("init","123456789012345");fbq("init","999999999999999")',
  ])
    assert.throws(() => pixelId(input));
  await assert.rejects(
    save("workspace_a", { metaPixelEnabled: true }),
    /pixel_id_obrigatorio/,
  );
  let a = await save("workspace_a", {
    metaPixelId: code,
    metaPixelEnabled: true,
  });
  assert.equal(a.draft.metaPixelId, "123456789012345");
  assert.doesNotMatch(JSON.stringify(a), /ARBITRARY_SENTINEL|<script/);
  await assert.rejects(service.publicPage(a.publicId), { statusCode: 404 });
  a = await service.publish("workspace_a", a.revision);
  assert.equal(
    (await service.publicPage(a.publicId)).pixel.id,
    "123456789012345",
  );
  const b = await save("workspace_b", {
    metaPixelId: "999999999999999",
    metaPixelEnabled: true,
  });
  await service.publish("workspace_b", b.revision);
  assert.equal(
    (await service.publicPage(b.publicId)).pixel.id,
    "999999999999999",
  );
  a = await service.save("workspace_a", a.revision, {
    ...a.draft,
    metaPixelEnabled: false,
  });
  assert.ok(
    (await service.publicPage(a.publicId)).pixel,
    "draft cannot turn off the published Pixel",
  );
  await service.publish("workspace_a", a.revision);
  assert.equal((await service.publicPage(a.publicId)).pixel, undefined);
  assert.ok((await service.publicPage(b.publicId)).pixel);
});

test("slug: duplicados, reservados, concorrência, alteração e reserva após despublicar", async (t) => {
  const { service, save } = await fixture(t);
  for (const value of [
    "admin",
    "login",
    "terms",
    "ab",
    "a".repeat(51),
    "../loja",
    "loja/aaa",
    "a--b",
    "a".repeat(32),
  ])
    assert.throws(() => slug(value));
  assert.equal(slug("Minha-Loja"), "minha-loja");
  let a = await save("workspace_a", { slug: "minha-loja" });
  let b = await save("workspace_b", { slug: "minha-loja" });
  const concurrent = await Promise.allSettled([
    service.publish("workspace_a", a.revision),
    service.publish("workspace_b", b.revision),
  ]);
  assert.equal(concurrent.filter((x) => x.status === "fulfilled").length, 1);
  const winner =
    concurrent[0].status === "fulfilled" ? "workspace_a" : "workspace_b";
  const loser = winner === "workspace_a" ? "workspace_b" : "workspace_a";
  let page = await service.get(winner);
  assert.equal(
    (await service.publicPage("minha-loja")).publicId,
    page.publicId,
  );
  assert.equal(
    (await service.slugAvailability(loser, "minha-loja")).available,
    false,
  );
  page = await service.unpublish(winner, page.revision);
  await assert.rejects(service.publicPage("minha-loja"), { statusCode: 404 });
  assert.equal(
    (await service.slugAvailability(loser, "minha-loja")).available,
    false,
  );
  page = await service.publish(winner, page.revision);
  page = await service.save(winner, page.revision, {
    ...page.draft,
    slug: "nova-loja",
  });
  assert.equal(
    (await service.publicPage("minha-loja")).publicId,
    page.publicId,
  );
  await service.publish(winner, page.revision);
  await assert.rejects(service.publicPage("minha-loja"), { statusCode: 404 });
  assert.equal((await service.publicPage("nova-loja")).publicId, page.publicId);
  assert.equal(
    (await service.publicPage(page.publicId)).publicId,
    page.publicId,
  );
  assert.equal(
    (await service.slugAvailability(loser, "minha-loja")).available,
    true,
  );
});

test("domínio self-service: TXT, Vercel, DNS, HTTPS, exclusividade e desconexão", async (t) => {
  const { service, save, state, advance, permitted } = await fixture(t);
  const host = "ofertas.fixture-shop.com";
  let a = await save("workspace_a", { customDomain: host });
  a = await service.publish("workspace_a", a.revision);
  a = await service.connectDomain("workspace_a", a.revision, host);
  assert.equal(a.domain.status, "pending");
  assert.equal(a.domain.reason, "txt_de_titularidade_pendente");
  assert.equal(
    a.domain.records.find((x) => x.type === "CNAME").value,
    recorded.config.recommendedCNAME[0].value,
  );
  assert.match(
    a.domain.records.find((x) => x.name === `_optimus-verify.${host}`).value,
    /^optimus-[a-f0-9]{48}$/,
  );
  await assert.rejects(service.publicDomain(host), { statusCode: 404 });
  let b = await save("workspace_b", { customDomain: host });
  const calls = state.calls.length;
  await assert.rejects(
    service.connectDomain("workspace_b", b.revision, host),
    /dominio_ja_associado/,
  );
  assert.equal(state.calls.length, calls);
  state.owned = true;
  state.verify = false;
  advance();
  a = await service.verifyDomain("workspace_a", a.revision);
  assert.equal(a.domain.reason, "verificacao_vercel_pendente");
  state.verify = true;
  advance();
  a = await service.verifyDomain("workspace_a", a.revision);
  assert.equal(a.domain.reason, "dns_ainda_nao_propagado");
  state.dns = true;
  advance();
  a = await service.verifyDomain("workspace_a", a.revision);
  assert.equal(a.domain.status, "verified");
  assert.equal(a.domain.reason, "https_em_emissao");
  await assert.rejects(service.publicDomain(host), { statusCode: 404 });
  state.https = true;
  advance();
  a = await service.verifyDomain("workspace_a", a.revision);
  assert.equal(a.domain.status, "active");
  assert.equal((await service.publicDomain(host)).publicId, a.publicId);
  permitted.delete("workspace_a");
  await assert.rejects(service.publicDomain(host), { statusCode: 404 });
  permitted.add("workspace_a");
  const draft = structuredClone(a.draft);
  state.failRemove = true;
  await assert.rejects(
    service.disconnectDomain("workspace_a", a.revision),
    /vercel_operacao/,
  );
  await assert.rejects(service.publicDomain(host), { statusCode: 404 });
  advance();
  await service.verifyDueDomains();
  assert.equal(
    (await service.get("workspace_a")).domain.status,
    "disconnecting",
  );
  state.failRemove = false;
  a = await service.disconnectDomain("workspace_a", a.revision);
  assert.equal(a.domain.status, "disconnected");
  assert.deepEqual(a.draft, draft);
  assert.ok(a.published);
  assert.equal((await service.publicPage(a.publicId)).publicId, a.publicId);
  assert.equal(state.domains.has(host), false);
});

test("domínio: ausência de credencial, domínio preexistente e associação incerta falham fechados", async (t) => {
  const missing = createVercelDomainProvider({
    env: {},
    fetch: () => {
      throw new Error("must_not_fetch");
    },
  });
  const blocked = await fixture(t, { domainProvider: missing });
  let p = await blocked.save("workspace_a", {
    customDomain: "loja.fixture-shop.com",
  });
  p = await blocked.service.publish("workspace_a", p.revision);
  await assert.rejects(
    blocked.service.connectDomain(
      "workspace_a",
      p.revision,
      p.draft.customDomain,
    ),
    { statusCode: 503 },
  );
  assert.ok(await blocked.service.publicPage(p.publicId));
  assert.equal(
    (await blocked.service.get("workspace_a")).domain.status,
    "disconnected",
  );
  for (const host of [
    "www.optimuspromo.com.br",
    "go.optimuspromo.com.br",
    "foo.vercel.app",
    "127.0.0.1",
    "localhost",
    "https://shop.com",
    "foo.com:443",
    "foo.com/path",
  ])
    assert.throws(() => customerDomain(host));
  const { service, save, state, advance } = await fixture(t);
  const host = "loja.fixture-shop.com";
  let a = await save("workspace_a", { customDomain: host });
  state.domains.set(host, { ...recorded.domain, name: host });
  await assert.rejects(
    service.connectDomain("workspace_a", a.revision, host),
    /ja_existente_na_vercel/,
  );
  assert.equal((await service.get("workspace_a")).revision, a.revision);
  state.domains.delete(host);
  state.timeoutAdd = true;
  a = await service.connectDomain("workspace_a", a.revision, host);
  assert.equal(a.domain.status, "error");
  const adds = state.calls.filter(
    (x) => x.method === "POST" && x.path.endsWith("/domains"),
  ).length;
  advance();
  a = await service.verifyDomain("workspace_a", a.revision);
  assert.notEqual(a.domain.status, "active");
  assert.equal(
    state.calls.filter(
      (x) => x.method === "POST" && x.path.endsWith("/domains"),
    ).length,
    adds,
    "verify never repeats uncertain association",
  );
  state.owned = true;
  state.dns = true;
  state.https = true;
  advance();
  a = await service.verifyDomain("workspace_a", a.revision);
  assert.equal(a.domain.status, "active");
  await assert.rejects(
    service.publicDomain(host),
    { statusCode: 404 },
    "not published yet",
  );
  await service.publish("workspace_a", a.revision);
  assert.equal((await service.publicDomain(host)).publicId, a.publicId);
});

test("provider: token somente servidor, escopo/projeto correto e destinos privados bloqueados", async () => {
  const { provider, state } = simulatedVercel();
  state.badProject = true;
  await assert.rejects(
    provider.add("loja.fixture-shop.com"),
    /projeto_ou_production_branch_divergente/,
  );
  assert.equal(state.calls.filter((x) => x.method !== "GET").length, 0);
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "fe80::1",
  ])
    assert.equal(publicIp(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(publicIp(ip), true, ip);
});

test("HTTPS real do verifier: IP fixado, SNI e certificado válidos são obrigatórios", async () => {
  const { EventEmitter } = require("node:events");
  function dependencies({
    ip = "1.1.1.1",
    authorized = true,
    certificate = "ofertas.fixture-shop.com",
  } = {}) {
    let connections = 0;
    return {
      lookup: async () => [{ address: ip }],
      connect(options) {
        connections++;
        assert.equal(options.host, ip);
        assert.equal(options.servername, "ofertas.fixture-shop.com");
        assert.equal(options.rejectUnauthorized, true);
        assert.equal(options.port, 443);
        const socket = new EventEmitter();
        socket.authorized = authorized;
        socket.destroy = () => {};
        socket.setTimeout = () => {};
        socket.getPeerCertificate = () => ({
          subjectaltname: `DNS:${certificate}`,
        });
        queueMicrotask(() => socket.emit("secureConnect"));
        return socket;
      },
      count: () => connections,
    };
  }
  assert.equal(
    await httpsReady("ofertas.fixture-shop.com", dependencies()),
    true,
  );
  assert.equal(
    await httpsReady(
      "ofertas.fixture-shop.com",
      dependencies({ authorized: false }),
    ),
    false,
  );
  assert.equal(
    await httpsReady(
      "ofertas.fixture-shop.com",
      dependencies({ certificate: "other-shop.com" }),
    ),
    false,
  );
  const local = dependencies({ ip: "127.0.0.1" });
  assert.equal(await httpsReady("ofertas.fixture-shop.com", local), false);
  assert.equal(local.count(), 0);
});

test("proof de domínio expira fechado; worker renova sem mudar revisão do editor", async (t) => {
  const { service, provider, clock, save, state } = await fixture(t);
  const host = "ofertas.fixture-shop.com";
  let page = await save("workspace_a", { customDomain: host });
  page = await service.publish("workspace_a", page.revision);
  state.owned = true;
  state.dns = true;
  state.https = true;
  page = await service.connectDomain("workspace_a", page.revision, host);
  assert.equal(page.domain.status, "active");
  clock.value += 600001;
  await assert.rejects(service.publicDomain(host), { statusCode: 404 });
  await service.verifyDueDomains();
  assert.equal((await service.get("workspace_a")).revision, page.revision);
  assert.ok(await service.publicDomain(host));
  provider.enabled = false;
  await assert.rejects(service.publicDomain(host), { statusCode: 404 });
  assert.ok(await service.publicPage(page.publicId));
});

test("lock interrompido não é apagado ou ignorado", async (t) => {
  const { service, save, dir } = await fixture(t);
  const page = await save("workspace_a", { slug: "loja-fenced" });
  const folder = path.join(dir, "landing-pages", "addresses");
  await fs.mkdir(folder, { recursive: true });
  const lock = path.join(folder, "slugs.lock");
  await fs.writeFile(lock, "fixture-stale-owner");
  await assert.rejects(service.publish("workspace_a", page.revision), {
    statusCode: 409,
  });
  assert.equal(await fs.readFile(lock, "utf8"), "fixture-stale-owner");
  assert.equal((await service.get("workspace_a")).revision, page.revision);
});

test("API pública ignora Host forjado e APIs novas preservam gate de plano", async (t) => {
  const { service, save } = await fixture(t);
  const a = await save("workspace_a", { slug: "loja-publica" });
  await service.publish("workspace_a", a.revision);
  const app = express();
  app.use(express.json());
  app.use(createLandingPageRoutes({ service, publicRoutes: true }));
  app.use((req, res, next) => {
    req.usuario = {};
    req.clienteId = "workspace_b";
    next();
  });
  app.use(
    createLandingPageRoutes({
      service,
      getClienteId: (req) => req.clienteId,
      usuarioTemRecurso: () => false,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const result = await fetch(base + "/public/landing/loja-publica", {
    headers: { Host: "evil.com", "X-Forwarded-Host": "victim.com" },
  });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).page.publicId, a.publicId);
  assert.equal(
    (
      await fetch(base + "/public/landing-domain?host=evil.com", {
        headers: { Host: "ofertas.fixture-shop.com" },
      })
    ).status,
    404,
  );
  for (const action of ["connect", "verify", "disconnect"])
    assert.equal(
      (
        await fetch(base + `/landing-page/domain/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision: 0,
            hostname: "shop.com",
            workspaceId: "workspace_a",
          }),
        })
      ).status,
      403,
    );
  assert.equal(
    (await fetch(base + "/landing-page/slug-availability?slug=minha-loja"))
      .status,
    403,
  );
});
