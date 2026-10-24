"use strict";

// Executes exact production handler slices, without booting index.js schedulers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const { criarAdminMasterEstrito } = require("../../utils/admin-auth-estrito");
const identity = require("../../modules/workspace/identity");
const quotas = require("../../utils/cotas-flexiveis-planos");
const {
  normalizarPoliticaIdentidadeVisual,
} = require("../../modules/identidade-visual-ofertas/politica");
const {
  createLandingPageService,
  createVitrineOfferReader,
} = require("../../modules/landing-page/service");
const {
  createLandingPageRoutes,
} = require("../../modules/landing-page/routes");
const source = fs.readFileSync(
  path.resolve(__dirname, "../../index.js"),
  "utf8",
);

function slice(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "production handler boundaries must exist");
  return source.slice(a, b);
}

async function createFixture(t) {
  const parent = path.resolve(__dirname, "../../tmp/landing-integration");
  await fsp.mkdir(parent, { recursive: true });
  const dataDir = await fsp.mkdtemp(path.join(parent, "run-"));
  t.after(() => fsp.rm(dataDir, { recursive: true, force: true }));
  const usuarios = [
    {
      id: "fixture_master",
      papel: "admin_master",
      plano: "enabled",
      ativo: true,
    },
    { id: "workspace_a", papel: "cliente", plano: "enabled", ativo: true },
    { id: "workspace_b", papel: "cliente", plano: "enabled", ativo: true },
    { id: "workspace_locked", papel: "cliente", plano: "locked", ativo: true },
    {
      id: "workspace_inactive",
      papel: "cliente",
      plano: "enabled",
      ativo: false,
    },
  ];
  const makePlan = (id) => ({
    id,
    nome: id,
    limites: { creditos: 123, maxConexoes: 2 },
    marketplaces: ["amazon"],
    recursos: { landing_page: false, vitrine: true, mensageiro: true },
  });
  const planos = { enabled: makePlan("enabled"), locked: makePlan("locked") };
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  const secret = crypto.randomBytes(32).toString("hex");
  const persistedPlans = [];
  const context = vm.createContext({
    app,
    jwt,
    JWT_SECRET: secret,
    usuarios,
    planos,
    process: { env: { DATA_DIR: dataDir } },
    path,
    createLandingPageService,
    createVitrineOfferReader,
    createLandingPageRoutes,
    saasFundacao: require("../../utils/saas-fundacao"),
    ...quotas,
    normalizarPoliticaIdentidadeVisual,
    usuarioEhAdminMaster: identity.isAdminMaster,
    resolveWorkspaceId: (id, options) =>
      identity.resolveWorkspaceId(id, { ...options, logFallback: false }),
    salvarPlanos: () => {
      const snapshot = JSON.stringify(planos);
      fs.writeFileSync(path.join(dataDir, "planos-fixture.json"), snapshot);
      persistedPlans.push(snapshot);
    },
    criarAdminMasterEstrito,
    // Unrelated /me counters use empty local fixtures; auth/plan logic is real.
    criarPerfTimer: () => ({ etapaSync: (_, fn) => fn(), fim() {} }),
    contextoPerfHttp: () => ({}),
    renovarCreditosSeNecessario() {},
    saldoCreditosParaExibicao: async () => 123,
    contarConexoesWorkspace: () => ({
      total: 0,
      whatsapp: 0,
      telegram: 0,
      discord: 0,
    }),
    destinosPorCliente: {},
    configsPorCliente: {},
    fila: [],
    marketplacesSelecionadosCliente: () => [],
    resolverFinanceiroUsuarioMe: () => ({}),
  });
  const run = (code) =>
    vm.runInContext(code, context, { filename: "index.js:landing-fixture" });
  run(slice("function buscarUsuarioPorIdSeguro(", "function obterUsuario("));
  run(
    slice(
      "function isAdminMaster(req)",
      "function normalizarMarketplaceIntegracao(",
    ),
  );
  run(
    slice("function getClienteId(req)", "function exigirClienteAutenticado("),
  );
  run(slice("function auth(req, res, next)", "\ncarregarConfig();"));
  run(
    slice(
      "const exigirAdminMasterEstrito = criarAdminMasterEstrito(",
      "const telegramTeleRadarControlPlane",
    ),
  );
  run(slice('app.get("/admin/planos",', "function confirmacaoExclusaoValida("));
  run(
    slice(
      "const landingPageService = createLandingPageService(",
      "const captureHandoffService",
    ),
  );
  app.use(context.auth);
  run(
    "app.use(createLandingPageRoutes({ service: landingPageService, getClienteId, usuarioTemRecurso }));",
  );
  run(slice('app.get("/me", async', "const marketplaceRules ="));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  const token = (id, options = {}) =>
    jwt.sign({ clienteId: id }, secret, { expiresIn: "5m", ...options });
  async function request(url, { user, bearer, body, method = "GET" } = {}) {
    const response = await fetch(base + url, {
      method,
      headers: {
        ...(user || bearer
          ? { Authorization: "Bearer " + (bearer || token(user)) }
          : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json() };
  }
  return { request, token, usuarios, planos, dataDir, persistedPlans };
}

module.exports = { createFixture };
