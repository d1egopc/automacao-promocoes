const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { renderizarSalvar } = require("./renderer.service");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function tokenInterno() {
  return texto(process.env.SOCIAL_ART_RENDERER_TOKEN);
}

function autenticar(req, res, next) {
  const esperado = tokenInterno();
  if (!esperado) return res.status(503).json({ ok: false, erro: "renderer_token_nao_configurado" });
  const recebido = texto(req.headers.authorization).replace(/^Bearer\s+/i, "");
  if (!recebido || recebido !== esperado) return res.status(401).json({ ok: false, erro: "nao_autorizado" });
  return next();
}

function erroSeguro(erro) {
  return texto(erro?.message || "render_erro").slice(0, 180);
}

function criarApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: process.env.RENDERER_MAX_PAYLOAD || "64kb" }));
  app.use(rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RENDERER_RATE_LIMIT_PER_MINUTE || 30),
    standardHeaders: true,
    legacyHeaders: false
  }));

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      service: "optimus-social-art-renderer",
      storage: texto(process.env.SOCIAL_ART_STORAGE_PROVIDER || "r2"),
      tokenConfigurado: Boolean(tokenInterno())
    });
  });

  app.post("/render/social/post-art", autenticar, async (req, res) => {
    try {
      const resultado = await renderizarSalvar(req.body || {});
      return res.json(resultado);
    } catch (erro) {
      return res.status(422).json({
        ok: false,
        erro: erroSeguro(erro)
      });
    }
  });

  app.use((erro, req, res, next) => {
    if (res.headersSent) return next(erro);
    return res.status(400).json({
      ok: false,
      erro: erroSeguro(erro)
    });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  criarApp().listen(port, () => {
    console.log("[SOCIAL-ARTE-RENDERER-ONLINE]", JSON.stringify({ port }));
  });
}

module.exports = {
  criarApp,
  autenticar
};
