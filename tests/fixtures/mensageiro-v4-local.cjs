"use strict";
// Disposable loopback-only fixture. No production credentials or sockets.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("fixture_production_forbidden");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-v4-browser-"));
  process.env.DATA_DIR = dataDir;
  const express = require("express"),
    jwt = require("jsonwebtoken");
  const { V3Store } = require("../../modules/mensageiro-v3/src/v3/store");
  const { V4Repository } = require("../../modules/mensageiro-v4/repository");
  const { V4Engine } = require("../../modules/mensageiro-v4/engine");
  const { Diagnostics } = require("../../modules/mensageiro-v4/diagnostics");
  const { createV4Routes } = require("../../modules/mensageiro-v4/routes");
  const filePath = path.join(dataDir, "mensageiro-v3", "state.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const store = new V3Store({ filePath }),
    secret = crypto.randomBytes(32);
  const users = ["fixture_A", "fixture_B"].map((id, i) => ({
    id,
    nome: "Empresa fictícia " + (i ? "B" : "A"),
    papel: "user",
    ativo: true,
    plano: "fixture",
    recursos: { mensageiro: i === 0, vitrine: true, landing_page: true },
    limites: {},
    creditos: 100,
    assinaturaStatus: "ativa",
    statusConta: "ativo",
  }));
  fs.writeFileSync(path.join(dataDir, "usuarios.json"), JSON.stringify(users));
  for (const u of users) {
    const p = store.createProfile({
      workspaceId: u.id,
      sessionId: u.id + "_phone",
      name: "Atendimento " + u.nome,
    });
    store.updateProfile(u.id, p.id, {
      active: true,
      destinations: [u.id + "@g.us"],
    });
    store.saveCard(u.id, p.id, "groupManager", {
      active: true,
      configuration: {
        isentarAdmins: true,
        isentarDono: true,
        v4: { migrationVersion: 4 },
        regras: [
          {
            id: "links",
            ativo: true,
            tipo: "links_externos",
            parametros: {},
            acao: "apagar_avisar",
          },
        ],
      },
    });
  }
  const repository = new V4Repository({ filePath });
  const owns = (w, s) => users.some((u) => u.id === w && s === w + "_phone");
  const diagnostics = new Diagnostics({ ownsSession: owns });
  const engine = new V4Engine({
    repository,
    enabled: (w) => users.some((u) => u.id === w),
    contextValid: () => false,
  });
  const app = express();
  app.use(require("cors")({ origin: "http://127.0.0.1:5180" }));
  app.use(express.json({ limit: "20mb" }));
  app.post("/login", (req, res) => {
    const user = users.find((u) => u.id === req.body.user);
    if (!user || req.body.pass !== "fixture-only")
      return res.status(401).json({ erro: "fixture_auth" });
    res.json({
      token: jwt.sign({ id: user.id }, secret, { expiresIn: "1h" }),
      usuario: user,
    });
  });
  app.use((req, res, next) => {
    try {
      const decoded = jwt.verify(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
        secret,
      );
      req.usuario = users.find((u) => u.id === decoded.id);
      req.clienteId = req.usuario?.id;
    } catch {}
    next();
  });
  app.get("/me", (req, res) =>
    req.usuario
      ? res.json({ usuario: req.usuario })
      : res.status(401).json({ erro: "fixture_auth" }),
  );
  app.use(
    "/mensageiro-v4",
    createV4Routes({
      repository,
      engine,
      diagnostics,
      getWorkspace: (req) => req.clienteId,
      hasFeature: (req) => req.usuario.recursos.mensageiro === true,
      listSessions: (w) => [
        { id: w + "_phone", name: "Celular de teste", connected: true },
      ],
      listGroups: (w, s) =>
        owns(w, s)
          ? [
              {
                id: w + "@g.us",
                name: "Grupo de teste " + (w.endsWith("A") ? "A" : "B"),
              },
            ]
          : [],
    }),
  );
  app.get("/sessoes", (req, res) => res.json({ sessoes: [] }));
  app.get("*", (req, res) =>
    res.json({ ok: true, source: "isolated_fixture", items: [], branding: {} }),
  );
  const server = app.listen(4197, "127.0.0.1", () =>
    console.log("V4_FIXTURE_READY=http://127.0.0.1:4197"),
  );
  process.on("SIGTERM", () => {
    server.close();
    repository.close().finally(() => {
      fs.rmSync(dataDir, { recursive: true, force: true });
      process.exit(0);
    });
  });
}
main().catch((e) => {
  console.error(e.code || e.message);
  process.exitCode = 1;
});
