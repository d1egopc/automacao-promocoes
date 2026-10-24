"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const sharp = require("sharp");
const {
  createLandingPageService,
  createVitrineOfferReader,
  emptyConfig,
  validateConfig,
  httpsUrl,
  pixelId,
  LANDING_THEME_IDS,
} = require("../modules/landing-page/service");
const { createLandingPageRoutes } = require("../modules/landing-page/routes");

const tempRoot = path.resolve(__dirname, "../tmp/landing-page-tests");
async function fixture(t) {
  await fs.mkdir(tempRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(tempRoot, "fixture-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const enabled = new Set(["workspace_a", "workspace_b"]);
  const options = { dataDir: dir, canPublish: (id) => enabled.has(id) };
  const service = createLandingPageService(options);
  return { dir, options, service, enabled };
}
const config = (name) => ({
  ...emptyConfig(),
  name,
  buttons: [
    {
      id: "whatsapp",
      icon: "whatsapp",
      label: "Entre no grupo",
      url: "https://chat.whatsapp.com/example",
    },
  ],
});

test("GET não cria documento, configuração pública ou diretório", async (t) => {
  const { service, dir } = await fixture(t);
  const page = await service.get("workspace_a");
  assert.equal(page.revision, 0);
  assert.equal(page.publicId, "");
  assert.deepEqual(await fs.readdir(dir), []);
});

test("tema padrão, seleção persistida e isolamento por workspace", async (t) => {
  const { service, options } = await fixture(t);
  const initial = await service.get("workspace_a");
  const other = await service.get("workspace_b");
  assert.equal(initial.draft.theme, "optimus");
  assert.equal(other.draft.theme, "optimus");

  let revision = initial.revision;
  for (const theme of LANDING_THEME_IDS) {
    const saved = await service.save("workspace_a", revision, {
      ...config("Comunidade A"),
      theme,
    });
    revision = saved.revision;
    assert.equal((await service.get("workspace_a")).draft.theme, theme);
  }
  const published = await service.publish("workspace_a", revision);
  assert.equal(
    (await service.publicPage(published.publicId)).config.theme,
    "amarelo",
  );
  const reloaded = createLandingPageService(options);
  assert.equal((await reloaded.get("workspace_a")).draft.theme, "amarelo");
  assert.equal((await reloaded.get("workspace_b")).draft.theme, "optimus");
  const currentRevision = (await reloaded.get("workspace_a")).revision;
  await assert.rejects(
    reloaded.save("workspace_a", currentRevision, {
      ...config("Comunidade A"),
      theme: "neon",
    }),
    /tema_invalido/,
  );
});

test("configuração V1 sem campo de tema continua usando Optimus Promo", async (t) => {
  const { service, dir } = await fixture(t);
  const documentDir = path.join(dir, "landing-pages", "workspaces");
  await fs.mkdir(documentDir, { recursive: true });
  const legacyDraft = { ...config("Página antiga") };
  delete legacyDraft.theme;
  await fs.writeFile(
    path.join(documentDir, "workspace_a.json"),
    JSON.stringify({
      version: 1,
      workspaceId: "workspace_a",
      revision: 3,
      publicId: "a".repeat(32),
      draft: legacyDraft,
      published: null,
      assets: [],
      updatedAt: "",
    }),
  );
  assert.equal((await service.get("workspace_a")).draft.theme, "optimus");
});

test("rascunho, snapshot publicado e despublicação preservam persistência após recarregar", async (t) => {
  const { service, options } = await fixture(t);
  const first = await service.save("workspace_a", 0, config("Comunidade A"));
  assert.match(first.publicId, /^[a-f0-9]{32}$/);
  await assert.rejects(
    service.publicPage(first.publicId),
    /pagina_nao_encontrada/,
  );
  const published = await service.publish("workspace_a", first.revision);
  const edited = await service.save(
    "workspace_a",
    published.revision,
    config("Rascunho novo"),
  );
  assert.equal(
    (await service.publicPage(first.publicId)).config.name,
    "Comunidade A",
  );
  const reloaded = createLandingPageService(options);
  assert.equal((await reloaded.get("workspace_a")).draft.name, "Rascunho novo");
  assert.equal(
    (await reloaded.publicPage(first.publicId)).config.name,
    "Comunidade A",
  );
  await service.unpublish("workspace_a", edited.revision);
  await assert.rejects(
    service.publicPage(first.publicId),
    /pagina_nao_encontrada/,
  );
  assert.equal((await service.get("workspace_a")).draft.name, "Rascunho novo");
});

test("dois workspaces não compartilham configuração, IDs públicos ou dados internos", async (t) => {
  const { service } = await fixture(t);
  const a = await service.save("workspace_a", 0, {
    ...config("A"),
    workspaceId: "workspace_b",
    token: "SECRET_CANARY",
  });
  const b = await service.save("workspace_b", 0, config("B"));
  assert.notEqual(a.publicId, b.publicId);
  await service.publish("workspace_a", a.revision);
  await service.publish("workspace_b", b.revision);
  const publicA = await service.publicPage(a.publicId);
  assert.equal(publicA.config.name, "A");
  assert.equal((await service.publicPage(b.publicId)).config.name, "B");
  assert.doesNotMatch(
    JSON.stringify(publicA),
    /workspace_[ab]|SECRET_CANARY|revision|token/,
  );
  await assert.rejects(service.get("../workspace_b"), /workspace_invalido/);
});

test("perda de permissão revoga acesso público imediatamente", async (t) => {
  const { service, enabled } = await fixture(t);
  const state = await service.save("workspace_a", 0, config("A"));
  await service.publish("workspace_a", state.revision);
  enabled.delete("workspace_a");
  await assert.rejects(
    service.publicPage(state.publicId),
    /pagina_nao_encontrada/,
  );
});

test("revisão divergente e escritas simultâneas falham fechadas", async (t) => {
  const { service } = await fixture(t);
  const results = await Promise.allSettled([
    service.save("workspace_a", 0, config("Primeira")),
    service.save("workspace_a", 0, config("Segunda")),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected")[0].reason
      .statusCode,
    409,
  );
  const before = await service.get("workspace_a");
  await assert.rejects(
    service.save("workspace_a", 0, config("Obsoleta")),
    /revisao_desatualizada/,
  );
  assert.deepEqual(await service.get("workspace_a"), before);
});

test("falha no rename não substitui o documento e permite retry na mesma revisão", async (t) => {
  const { service, dir } = await fixture(t);
  const state = await service.save("workspace_a", 0, config("Persistida"));
  const rename = fs.rename;
  fs.rename = async (...args) => {
    if (args[1] === path.join(dir, "landing-pages/workspaces/workspace_a.json"))
      throw Object.assign(new Error("fixture_write_failure"), { code: "EIO" });
    return rename(...args);
  };
  try {
    await assert.rejects(
      service.save("workspace_a", state.revision, config("Não persistida")),
      /fixture_write_failure/,
    );
  } finally {
    fs.rename = rename;
  }
  assert.equal((await service.get("workspace_a")).draft.name, "Persistida");
  const retry = await service.save(
    "workspace_a",
    state.revision,
    config("Retry"),
  );
  assert.equal(retry.revision, state.revision + 1);
});

test("lock interrompido e documento inválido nunca são apagados ou substituídos automaticamente", async (t) => {
  const { service, dir } = await fixture(t);
  const state = await service.save("workspace_a", 0, config("A"));
  const file = path.join(dir, "landing-pages/workspaces/workspace_a.json");
  await fs.writeFile(`${file}.lock`, "fixture-owner");
  await assert.rejects(
    service.save("workspace_a", state.revision, config("B")),
    /landing_em_edicao/,
  );
  assert.equal(await fs.readFile(`${file}.lock`, "utf8"), "fixture-owner");
  await fs.unlink(`${file}.lock`);
  await fs.writeFile(file, "invalid_fixture");
  await assert.rejects(service.get("workspace_a"), /persistencia_indisponivel/);
  assert.equal(await fs.readFile(file, "utf8"), "invalid_fixture");
});

test("HTML, URLs inseguras, links duplicados e assets de outro workspace são rejeitados", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://example.com",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://user:pass@example.com",
    "https://example.com:8080",
  ])
    assert.throws(() => httpsUrl(url));
  assert.throws(() =>
    validateConfig({ ...config("A"), title: "<script>bad</script>" }),
  );
  assert.throws(() =>
    validateConfig({ ...config("A"), banner: `${"a".repeat(64)}.webp` }),
  );
  const value = config("A");
  value.buttons.push(value.buttons[0]);
  assert.throws(() => validateConfig(value), /botoes_invalidos/);
  assert.equal(
    validateConfig(config("A")).buttons[0].url,
    "https://chat.whatsapp.com/example",
  );
});

test("Meta Pixel retém somente um ID e domínio permanece sem ativação externa", async (t) => {
  const { service } = await fixture(t);
  const code =
    "<script>fbq('init', '123456789012345');fbq('track', 'PageView');</script>";
  assert.equal(pixelId(code), "123456789012345");
  assert.throws(() => pixelId("<script>alert(1)</script>"), /pixel_invalido/);
  assert.throws(
    () =>
      pixelId("fbq('init','123456789012345');fbq('init','987654321012345')"),
    /pixel_invalido/,
  );
  const saved = await service.save("workspace_a", 0, {
    ...config("A"),
    customDomain: "ofertas.example.com",
    metaPixelId: code,
  });
  assert.equal(saved.draft.metaPixelId, "123456789012345");
  assert.equal(saved.integrations.customDomain, "not_verified");
  assert.equal(saved.integrations.metaPixel, "not_activated");
  await service.publish("workspace_a", saved.revision);
  assert.doesNotMatch(
    JSON.stringify(await service.publicPage(saved.publicId)),
    /fbq|123456789012345|customDomain|metaPixel/,
  );
});

test("upload real é normalizado; rascunho e asset de outro workspace não ficam públicos", async (t) => {
  const { service } = await fixture(t);
  const png = await sharp({
    create: { width: 8, height: 8, channels: 4, background: "#783def" },
  })
    .png()
    .toBuffer();
  const state = await service.upload(
    "workspace_a",
    0,
    "banner",
    png,
    "image/png",
  );
  assert.match(state.draft.banner, /^[a-f0-9]{64}\.webp$/);
  const asset = await service.asset("workspace_a", state.draft.banner);
  assert.equal(
    (await sharp(await fs.readFile(asset)).metadata()).format,
    "webp",
  );
  await assert.rejects(
    service.asset(state.publicId, state.draft.banner, true),
    /pagina_nao_encontrada/,
  );
  await assert.rejects(
    service.asset("workspace_b", state.draft.banner),
    /imagem_nao_encontrada/,
  );
  await assert.rejects(
    service.save("workspace_b", 0, {
      ...config("B"),
      banner: state.draft.banner,
    }),
    /imagem_nao_pertence/,
  );
  const saved = await service.save("workspace_a", state.revision, {
    ...state.draft,
    name: "A",
  });
  await service.publish("workspace_a", saved.revision);
  assert.equal(
    await service.asset(state.publicId, state.draft.banner, true),
    asset,
  );
  await assert.rejects(
    service.upload("workspace_a", 3, "logo", png, "image/jpeg"),
    /imagem_tipo_invalido/,
  );
  await assert.rejects(
    service.upload(
      "workspace_a",
      3,
      "logo",
      Buffer.from("<svg>bad</svg>"),
      "image/png",
    ),
    /imagem_tipo_invalido/,
  );
});

test("fonte comercial retorna quatro envios recentes do mesmo workspace sem segredos", async (t) => {
  const { dir } = await fixture(t);
  const sourceDir = path.join(dir, "clientes/workspace_a");
  await fs.mkdir(sourceDir, { recursive: true });
  const offers = Array.from({ length: 7 }, (_, i) => ({
    id: `offer-${i}`,
    titulo: `Oferta ${i}`,
    enviadoEm: new Date(Date.now() - (i + 1) * 60000).toISOString(),
    token: "SECRET_CANARY",
    linksComerciais: [
      { urlOptimus: `https://go.optimuspromo.com.br/r/offer-${i}` },
    ],
  }));
  offers.push({
    ...offers[0],
    id: "expired",
    enviadoEm: new Date(Date.now() - 90 * 3600000).toISOString(),
  });
  offers.push({
    ...offers[0],
    id: "future",
    enviadoEm: new Date(Date.now() + 3600000).toISOString(),
  });
  await fs.writeFile(
    path.join(sourceDir, "vitrine.json"),
    JSON.stringify({
      clienteId: "workspace_a",
      config: { ativa: true },
      ofertas: offers,
    }),
  );
  const read = createVitrineOfferReader({
    getWorkspaceDir: (id) => path.join(dir, "clientes", id),
    canRead: () => true,
  });
  const result = await read("workspace_a");
  assert.equal(result.status, "ready");
  assert.equal(result.offers.length, 4);
  assert.equal(result.offers[0].id, "offer-0");
  assert.doesNotMatch(
    JSON.stringify(result),
    /SECRET_CANARY|future|expired|workspace_a/,
  );
  await fs.writeFile(
    path.join(sourceDir, "vitrine.json"),
    JSON.stringify({
      clienteId: "workspace_b",
      config: { ativa: true },
      ofertas: offers,
    }),
  );
  assert.deepEqual((await read("workspace_a")).offers, []);
  await fs.writeFile(
    path.join(sourceDir, "vitrine.json"),
    "x".repeat(2 * 1024 * 1024 + 1),
  );
  assert.equal((await read("workspace_a")).status, "source_unavailable");
});

test("backpressure rejeita upload concorrente antes de nova transformação", async (t) => {
  const { service } = await fixture(t);
  const png = await sharp({
    create: { width: 8, height: 8, channels: 4, background: "#783def" },
  })
    .png()
    .toBuffer();
  const results = await Promise.allSettled([
    service.upload("workspace_a", 0, "banner", png, "image/png"),
    service.upload("workspace_a", 0, "logo", png, "image/png"),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected")[0].reason
      .statusCode,
    429,
  );
  assert.equal((await service.get("workspace_a")).revision, 1);
});

test("API exige autenticação e recurso; publicação é pública e ignora workspace no payload", async (t) => {
  const { service } = await fixture(t);
  const app = express();
  app.use(express.json());
  app.use(createLandingPageRoutes({ service, publicRoutes: true }));
  app.use((req, res, next) => {
    if (req.headers["x-fixture-user"]) {
      req.usuario = { papel: "cliente" };
      req.clienteId = req.headers["x-fixture-user"];
    }
    next();
  });
  app.use(
    createLandingPageRoutes({
      service,
      getClienteId: (req) => req.clienteId,
      usuarioTemRecurso: (req) => req.headers["x-fixture-plan"] === "enabled",
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    "x-fixture-user": "workspace_a",
    "x-fixture-plan": "enabled",
    "content-type": "application/json",
  };
  assert.equal((await fetch(`${base}/landing-page`)).status, 401);
  assert.equal(
    (
      await fetch(`${base}/landing-page`, {
        headers: { "x-fixture-user": "workspace_a" },
      })
    ).status,
    403,
  );
  const save = await fetch(`${base}/landing-page`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      revision: 0,
      workspaceId: "workspace_b",
      config: config("A"),
    }),
  });
  assert.equal(save.status, 200);
  const saved = (await save.json()).page;
  const publish = await fetch(`${base}/landing-page/publish`, {
    method: "POST",
    headers,
    body: JSON.stringify({ revision: saved.revision }),
  });
  assert.equal(publish.status, 200);
  const response = await fetch(`${base}/public/landing/${saved.publicId}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).page.config.name, "A");
  assert.equal((await service.get("workspace_b")).revision, 0);
});

test("wiring adiciona somente o recurso de plano e mantém público antes da autenticação", async () => {
  const source = await fs.readFile(
    path.resolve(__dirname, "../index.js"),
    "utf8",
  );
  assert.match(
    source,
    /landing_page: booleanPlano\("landing_page", recursosAnteriores\.landing_page\)/,
  );
  assert.ok(
    source.indexOf("publicRoutes: true") < source.indexOf("app.use(auth);"),
  );
  assert.ok(
    source.indexOf("getClienteId, usuarioTemRecurso }") >
      source.indexOf("app.use(auth);"),
  );
});
