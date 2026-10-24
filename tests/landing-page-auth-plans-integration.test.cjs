"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createFixture } = require("./helpers/landing-page-auth-fixture.cjs");
const { emptyConfig } = require("../modules/landing-page/service");

test("Landing integrada aos handlers oficiais de JWT, Admin, planos e /me", async (t) => {
  const fixture = await createFixture(t);
  const { request, token, planos, dataDir, persistedPlans } = fixture;
  const admin = { user: "fixture_master" };
  const updatePlan = (enabled) =>
    request("/admin/planos", {
      ...admin,
      method: "POST",
      body: {
        nome: "enabled",
        id: "enabled",
        chaveOriginal: "enabled",
        recursos: { landing_page: enabled },
      },
    });
  let a;
  let b;

  await t.test(
    "JWT ausente, inválido, expirado, desconhecido e usuário inativo bloqueados",
    async () => {
      for (const options of [
        {},
        { bearer: "invalid" },
        { bearer: token("workspace_a", { expiresIn: -1 }) },
        { user: "does_not_exist" },
        { user: "workspace_inactive" },
      ]) {
        assert.equal((await request("/landing-page", options)).status, 401);
      }
      assert.equal((await request("/admin/planos")).status, 401);
      assert.equal(
        (await request("/admin/planos", { user: "workspace_a" })).status,
        403,
      );
      assert.equal(
        (
          await request("/admin/planos", {
            user: "workspace_a",
            method: "POST",
            body: { nome: "enabled", recursos: { landing_page: true } },
          })
        ).status,
        403,
      );
      assert.equal(planos.enabled.recursos.landing_page, false);
    },
  );

  await t.test(
    "Admin habilita e persiste somente o recurso solicitado",
    async () => {
      const before = structuredClone(planos.enabled);
      const result = await updatePlan(true);
      assert.equal(result.status, 200);
      assert.equal(result.body.plano.recursos.landing_page, true);
      assert.equal(
        result.body.plano.recursos.mensageiro,
        before.recursos.mensageiro,
      );
      assert.equal(result.body.plano.limites.creditos, before.limites.creditos);
      assert.equal(persistedPlans.length, 1);
      assert.equal(
        JSON.parse(
          await fs.readFile(path.join(dataDir, "planos-fixture.json"), "utf8"),
        ).enabled.recursos.landing_page,
        true,
      );
      const me = await request("/me", { user: "workspace_a" });
      assert.equal(me.status, 200);
      assert.equal(me.body.usuario.recursos.landing_page, true);
      assert.equal(
        (await request("/landing-page", { user: "workspace_a" })).status,
        200,
      );
    },
  );

  await t.test(
    "plano bloqueado recebe 403 nas operações privadas e não cria documento",
    async () => {
      const me = await request("/me", { user: "workspace_locked" });
      assert.equal(me.body.usuario.recursos.landing_page, false);
      for (const [url, method, body] of [
        ["/landing-page", "GET"],
        ["/landing-page", "PUT", { revision: 0, config: emptyConfig() }],
        ["/landing-page/publish", "POST", { revision: 0 }],
        ["/landing-page/unpublish", "POST", { revision: 0 }],
        ["/landing-page/assets/logo", "POST"],
        ["/landing-page/assets/" + "a".repeat(64) + ".webp", "GET"],
      ])
        assert.equal(
          (await request(url, { user: "workspace_locked", method, body }))
            .status,
          403,
        );
      await assert.rejects(
        fs.stat(
          path.join(
            dataDir,
            "landing-pages",
            "workspaces",
            "workspace_locked.json",
          ),
        ),
        { code: "ENOENT" },
      );
    },
  );

  await t.test(
    "dois workspaces salvam/publicam temas próprios, ignorando tenant do payload",
    async () => {
      async function create(user, name, theme) {
        const saved = await request("/landing-page", {
          user,
          method: "PUT",
          body: {
            revision: 0,
            workspaceId: user === "workspace_a" ? "workspace_b" : "workspace_a",
            config: {
              ...emptyConfig(),
              name,
              theme,
              customDomain: "shop.example.com",
              metaPixelId:
                "<script>fbq('init','123456789012345'); alert('never execute')</script>",
            },
          },
        });
        assert.equal(saved.status, 200);
        assert.equal(saved.body.page.integrations.customDomain, "not_verified");
        assert.equal(saved.body.page.integrations.metaPixel, "not_activated");
        assert.equal(saved.body.page.draft.metaPixelId, "123456789012345");
        const published = await request("/landing-page/publish", {
          user,
          method: "POST",
          body: {
            revision: saved.body.page.revision,
            workspaceId: "workspace_locked",
          },
        });
        assert.equal(published.status, 200);
        return published.body.page;
      }
      a = await create("workspace_a", "Comunidade A", "verde");
      b = await create("workspace_b", "Comunidade B", "rosa");
      assert.notEqual(a.publicId, b.publicId);
      assert.equal(
        (await request("/landing-page", { user: "workspace_a" })).body.page
          .draft.theme,
        "verde",
      );
      assert.equal(
        (await request("/landing-page", { user: "workspace_b" })).body.page
          .draft.theme,
        "rosa",
      );
    },
  );

  await t.test(
    "acesso público anônimo expõe somente DTO público, sem Pixel ou código",
    async () => {
      const result = await request("/public/landing/" + a.publicId);
      assert.equal(result.status, 200);
      assert.equal(result.body.page.config.name, "Comunidade A");
      assert.doesNotMatch(
        JSON.stringify(result.body),
        /workspace_[ab]|"metaPixelId"|"customDomain"|123456789012345|shop.example|<script|alert\(|"revision"|"token"|"credenciais"/i,
      );
    },
  );

  await t.test(
    "quatro ofertas próprias e links públicos válidos, sem fallback de workspace",
    async () => {
      for (const id of ["workspace_a", "workspace_b"]) {
        const folder = path.join(dataDir, "clientes", id);
        await fs.mkdir(folder, { recursive: true });
        const ofertas = Array.from({ length: 6 }, (_, index) => ({
          id: id + "-offer-" + index,
          titulo: "Oferta " + index,
          enviadoEm: new Date(Date.now() - (index + 1) * 60000).toISOString(),
          token: "SECRET_CANARY",
          jobId: "internal",
          linksComerciais: [
            {
              urlOptimus:
                "https://go.optimuspromo.com.br/r/" + id + "-" + index,
            },
          ],
        }));
        ofertas.unshift({
          ...ofertas[0],
          id: "invalid-link",
          linksComerciais: [{ urlOptimus: "javascript:alert(1)" }],
        });
        await fs.writeFile(
          path.join(folder, "vitrine.json"),
          JSON.stringify({ clienteId: id, config: { ativa: true }, ofertas }),
        );
      }
      for (const [id, page] of [
        ["workspace_a", a],
        ["workspace_b", b],
      ]) {
        const result = await request("/public/landing/" + page.publicId);
        const offers = result.body.page.source.offers;
        assert.equal(offers.length, 4);
        assert.ok(offers.every((offer) => offer.id.startsWith(id + "-offer-")));
        assert.ok(
          offers.every((offer) =>
            offer.linksComerciais.every((link) =>
              /^https:\/\/go\.optimuspromo\.com\.br\/r\//.test(link.url),
            ),
          ),
        );
        assert.doesNotMatch(
          JSON.stringify(offers),
          /SECRET_CANARY|internal|invalid-link|javascript/,
        );
      }
      // A deliberately mismatched source must never fall back to the other tenant.
      await fs.writeFile(
        path.join(dataDir, "clientes", "workspace_a", "vitrine.json"),
        JSON.stringify({
          clienteId: "workspace_b",
          config: { ativa: true },
          ofertas: [],
        }),
      );
      assert.equal(
        (await request("/public/landing/" + a.publicId)).body.page.source.offers
          .length,
        0,
      );
    },
  );

  await t.test(
    "rascunho não substitui snapshot publicado até Publicar",
    async () => {
      const saved = await request("/landing-page", {
        user: "workspace_a",
        method: "PUT",
        body: {
          revision: a.revision,
          config: { ...a.draft, name: "Rascunho novo", theme: "azul" },
        },
      });
      assert.equal(saved.status, 200);
      assert.equal(
        (await request("/public/landing/" + a.publicId)).body.page.config.theme,
        "verde",
      );
      const published = await request("/landing-page/publish", {
        user: "workspace_a",
        method: "POST",
        body: { revision: saved.body.page.revision },
      });
      assert.equal(published.status, 200);
      assert.equal(
        (await request("/public/landing/" + a.publicId)).body.page.config.theme,
        "azul",
      );
      assert.equal(
        (await request("/public/landing/" + b.publicId)).body.page.config.theme,
        "rosa",
      );
    },
  );

  await t.test(
    "revogação de plano fecha API privada e página pública imediatamente",
    async () => {
      assert.equal((await updatePlan(false)).status, 200);
      assert.equal(
        (await request("/landing-page", { user: "workspace_a" })).status,
        403,
      );
      assert.equal(
        (await request("/public/landing/" + a.publicId)).status,
        404,
      );
      assert.equal((await updatePlan(true)).status, 200);
      assert.equal(
        (await request("/public/landing/" + a.publicId)).status,
        200,
      );
    },
  );

  if (process.env.LANDING_AUTH_CONTRACT_FILE) {
    const contract = {};
    for (const [key, user] of [
      ["enabled", "workspace_a"],
      ["disabled", "workspace_locked"],
      ["master", "fixture_master"],
    ]) {
      const { body } = await request("/me", { user });
      contract[key] = {
        id: body.usuario.id,
        papel: body.usuario.papel,
        recursos: body.usuario.recursos,
      };
    }
    await fs.writeFile(
      process.env.LANDING_AUTH_CONTRACT_FILE,
      JSON.stringify(contract, null, 2) + "\n",
    );
  }
});
