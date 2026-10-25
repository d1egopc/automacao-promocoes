"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const sharp = require("sharp");
const { createLandingPageService, emptyConfig, validateConfig, MAX_UPLOAD } = require("../modules/landing-page/service");
const { createLandingPageRoutes } = require("../modules/landing-page/routes");

async function fixture(t) {
  const parent = path.resolve(__dirname, "../tmp/landing-v13-tests");
  await fs.mkdir(parent, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(parent, "case-"));
  const enabled = new Set(["workspace_a", "workspace_b"]);
  const options = { dataDir, canPublish: id => enabled.has(id) };
  const service = createLandingPageService(options);
  const app = express();
  app.use(helmet()); // Reproduce the real production default, including CORP same-origin.
  app.use(createLandingPageRoutes({ service, publicRoutes: true }));
  app.use((req, res, next) => {
    const id = { "Bearer fixture-a": "workspace_a", "Bearer fixture-b": "workspace_b" }[req.get("Authorization")];
    if (id) { req.usuario = { id }; req.clienteId = id; }
    next();
  });
  app.use(createLandingPageRoutes({ service, getClienteId: req => req.clienteId, usuarioTemRecurso: req => enabled.has(req.clienteId) }));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { service, options, enabled, base, app };
}
const image = color => sharp({ create: { width: 720, height: 480, channels: 3, background: color } }).png().toBuffer();
const button = avatar => ({ id: "group", label: "Meu grupo", url: "https://chat.whatsapp.com/example", icon: "link", ...(avatar === undefined ? {} : { avatar }) });

test("banner, logo e miniatura publicados são imagens anônimas cross-origin; privado continua protegido", async t => {
  const { service, base } = await fixture(t);
  let state = await service.upload("workspace_a", 0, "banner", await image("red"), "image/png");
  state = await service.upload("workspace_a", state.revision, "logo", await image("blue"), "image/png");
  const before = structuredClone(state.draft);
  state = await service.upload("workspace_a", state.revision, "button", await image("green"), "image/png");
  assert.deepEqual(state.draft, before, "avatar registration must preserve the entire saved draft");
  const avatar = state.uploadedAsset;
  assert.match(avatar, /^[a-f0-9]{64}\.webp$/);
  const metadata = await sharp(await fs.readFile(await service.asset("workspace_a", avatar))).metadata();
  assert.equal(metadata.format, "webp"); assert.ok(metadata.width <= 512 && metadata.height <= 512);
  state = await service.save("workspace_a", state.revision, { ...state.draft, name: "Fixture A", slug: "media-a", buttons: [button(avatar)] });
  const files = [state.draft.banner, state.draft.logo, avatar];
  for (const name of files) assert.equal((await fetch(`${base}/public/landing/${state.publicId}/assets/${name}`)).status, 404);
  state = await service.publish("workspace_a", state.revision);
  for (const id of [state.publicId, "media-a"]) for (const name of files) {
    const response = await fetch(`${base}/public/landing/${id}/assets/${name}`, { headers: { Origin: "https://www.optimuspromo.com.br" } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^image\/webp/);
    assert.equal(response.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  assert.equal((await fetch(`${base}/landing-page/assets/${avatar}`)).status, 401);
  const privateImage = await fetch(`${base}/landing-page/assets/${avatar}`, { headers: { Authorization: "Bearer fixture-a" } });
  assert.equal(privateImage.status, 200); assert.equal(privateImage.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal((await fetch(`${base}/landing-page/assets/${avatar}`, { headers: { Authorization: "Bearer fixture-b" } })).status, 404);
  assert.equal((await service.publicPage(state.publicId)).config.buttons[0].avatar, avatar);
});

test("rascunho e novo upload não vazam para snapshot; reabrir mantém avatar e despublicar revoga acesso", async t => {
  const { service, base, options, enabled } = await fixture(t);
  let state = await service.upload("workspace_a", 0, "button", await image("red"), "image/png");
  const first = state.uploadedAsset;
  state = await service.save("workspace_a", state.revision, { ...state.draft, name: "Fixture A", buttons: [button(first)] });
  state = await service.publish("workspace_a", state.revision);
  state = await service.upload("workspace_a", state.revision, "button", await image("blue"), "image/png");
  const second = state.uploadedAsset;
  state = await service.save("workspace_a", state.revision, { ...state.draft, buttons: [button(second)] });
  const reloaded = createLandingPageService(options);
  assert.equal((await reloaded.get("workspace_a")).draft.buttons[0].avatar, second);
  assert.equal((await reloaded.publicPage(state.publicId)).config.buttons[0].avatar, first);
  const url = name => `${base}/public/landing/${state.publicId}/assets/${name}`;
  assert.equal((await fetch(url(first))).status, 200); assert.equal((await fetch(url(second))).status, 404);
  await assert.rejects(service.save("workspace_b", 0, { ...emptyConfig(), buttons: [button(second)] }), /imagem_nao_pertence/);
  enabled.delete("workspace_a"); assert.equal((await fetch(url(first))).status, 404);
  enabled.add("workspace_a");
  state = await service.publish("workspace_a", state.revision);
  assert.equal((await fetch(url(first))).status, 404); assert.equal((await fetch(url(second))).status, 200);
  state = await service.unpublish("workspace_a", state.revision);
  assert.equal((await fetch(url(second))).status, 404);
  assert.equal((await service.get("workspace_a")).draft.buttons[0].avatar, second);
});

test("avatar opcional é retrocompatível, valida registro local e rejeita URLs, travessia e SVG", async t => {
  const { service } = await fixture(t);
  assert.deepEqual(validateConfig({ ...emptyConfig(), buttons: [button()] }).buttons[0], button());
  assert.equal(validateConfig({ ...emptyConfig(), buttons: [button("")] }).buttons[0].avatar, "");
  for (const value of ["https://example.com/x.webp", "data:image/svg+xml,bad", "../x.webp", "a".repeat(64)+".webp", null])
    assert.throws(() => validateConfig({ ...emptyConfig(), buttons: [button(value)] }), /imagem_nao_pertence/);
  await assert.rejects(service.upload("workspace_a", 0, "button", Buffer.from("<svg></svg>"), "image/svg+xml"), /imagem_tipo_invalido/);
  await assert.rejects(service.upload("workspace_a", 0, "button", Buffer.alloc(MAX_UPLOAD + 1), "image/png"), /imagem_invalida/);
  await assert.rejects(service.upload("workspace_a", 0, "button", await image("red"), "image/jpeg"), /imagem_tipo_invalido/);
  assert.equal((await service.get("workspace_a")).revision, 0);
});

test("API de avatar preserva autenticação, plano, revisão e quota sem escrita parcial", async t => {
  const { service, base, enabled } = await fixture(t);
  const png = await image("purple");
  const upload = (token, revision) => fetch(`${base}/landing-page/assets/button`, { method: "POST", headers: { Authorization: token, "Content-Type": "image/png", "X-Landing-Revision": String(revision) }, body: png });
  assert.equal((await upload("", 0)).status, 401);
  enabled.delete("workspace_a"); assert.equal((await upload("Bearer fixture-a", 0)).status, 403);
  enabled.add("workspace_a");
  const valid = await upload("Bearer fixture-a", 0); assert.equal(valid.status, 200);
  assert.match((await valid.json()).page.uploadedAsset, /^[a-f0-9]{64}\.webp$/);
  assert.equal((await upload("Bearer fixture-a", 0)).status, 409);
  let state = await service.get("workspace_a");
  for (let i = 0; i < 31; i++) state = await service.upload("workspace_a", state.revision, "button", await image({ r: i * 8, g: 100, b: 200 }), "image/png");
  const revision = state.revision;
  await assert.rejects(service.upload("workspace_a", revision, "button", await image("orange"), "image/png"), /limite_de_imagens/);
  assert.equal((await service.get("workspace_a")).revision, revision);
});
