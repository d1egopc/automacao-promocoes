"use strict";
// Isolated fixture only. Never connects to Optimus production, PostgreSQL or /data.
if (!process.argv.includes("--local-only"))
  throw new Error("Use --local-only to start the disposable fixture.");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const cors = require("cors");
const sharp = require("sharp");
const {
  createLandingPageService,
  emptyConfig,
} = require("../../modules/landing-page/service");
const {
  createLandingPageRoutes,
} = require("../../modules/landing-page/routes");

async function main() {
  const tempRoot = path.resolve(__dirname, "../../../landing-v1-demo-data");
  await fs.mkdir(tempRoot, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(tempRoot, "demo-"));
  const id = "local_landing_demo";
  const titles = [
    "Fone sem fio para acompanhar o seu dia",
    "Cafeteira compacta: uma pausa especial",
    "Sua próxima leitura começa aqui",
    "Mais praticidade para a sua cozinha",
  ];
  const getOffers = async () => ({
    status: "ready",
    offers: titles.map((titulo, index) => ({
      id: `demo-${index}`,
      titulo,
      imagem: `http://127.0.0.1:3031/demo-image/${index}`,
      marketplace: ["Amazon", "Mercado Livre", "Shopee", "KaBuM"][index],
      preco: ["R$ 89,90", "R$ 149,00", "R$ 39,90", "R$ 119,90"][index],
      linksComerciais: [
        { url: "https://example.com/oferta", label: "Ver oferta" },
      ],
    })),
  });
  const service = createLandingPageService({
    dataDir,
    canPublish: (workspace) => workspace === id,
    getOffers,
  });
  await service.save(id, 0, {
    ...emptyConfig(),
    name: "Clube dos Achados",
    title: "Pequenas descobertas. Grandes oportunidades.",
    description:
      "Ofertas escolhidas com cuidado para facilitar o seu dia.\nEntre na comunidade e encontre seu próximo achado.",
    buttons: [
      {
        id: "whatsapp",
        icon: "whatsapp",
        label: "Fazer parte do grupo WhatsApp",
        url: "https://example.com/whatsapp",
      },
      {
        id: "telegram",
        icon: "telegram",
        label: "Receber achados no Telegram",
        url: "https://example.com/telegram",
      },
    ],
    socials: [
      {
        id: "instagram",
        icon: "instagram",
        label: "Instagram",
        url: "https://example.com/instagram",
      },
    ],
    showcase: {
      enabled: true,
      label: "Ver todos os achados",
      url: "https://example.com/vitrine",
    },
  });
  const app = express();
  app.use(cors({ origin: "http://127.0.0.1:5176" }));
  app.use(express.json({ limit: "64kb" }));
  app.post("/login", (req, res) => {
    if (
      req.body.user !== "demo-local@example.com" ||
      req.body.pass !== "local-only"
    )
      return res.status(401).json({ erro: "Use the local fixture identity." });
    res.json({ token: "landing-demo-local" });
  });
  app.get("/demo-image/:id", async (req, res) => {
    const palette = ["#ddd6fe", "#ccfbf1", "#fef3c7", "#dbeafe"];
    const buffer = await sharp({
      create: {
        width: 320,
        height: 220,
        channels: 3,
        background: palette[Number(req.params.id) % 4] || palette[0],
      },
    })
      .png()
      .toBuffer();
    res.type("png").send(buffer);
  });
  app.use(createLandingPageRoutes({ service, publicRoutes: true }));
  app.use((req, res, next) => {
    if (req.headers.authorization !== "Bearer landing-demo-local")
      return res
        .status(
          req.path === "/me" || req.path.startsWith("/landing-page")
            ? 401
            : 404,
        )
        .json({ erro: "local_fixture_only" });
    req.usuario = {
      id,
      nome: "Demonstração local",
      papel: "admin_master",
      recursos: { landing_page: true },
      ativo: true,
    };
    req.clienteId = id;
    next();
  });
  app.get("/me", (req, res) => res.json({ usuario: req.usuario }));
  app.get("/branding", (req, res) => res.json({}));
  app.use(
    createLandingPageRoutes({
      service,
      getClienteId: (req) => req.clienteId,
      usuarioTemRecurso: () => true,
    }),
  );
  const server = app.listen(3031, "127.0.0.1", () =>
    console.log(
      "LANDING_LOCAL_FIXTURE_READY=http://127.0.0.1:3031 (temporary data only)",
    ),
  );
  const close = () =>
    server.close(async () => {
      await fs.rm(dataDir, { recursive: true, force: true });
      process.exit(0);
    });
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
