const express = require("express");
const {
  criarUrlConexaoDiscord,
  processarCallbackDiscord
} = require("./discord-oauth");
const {
  listarConexoesDiscord,
  salvarConexaoDiscord,
  desconectarConexaoDiscord
} = require("./discord-connections.storage");
const {
  registrarStateDiscordOAuth,
  consumirStateDiscordOAuth
} = require("./discord-oauth-state.storage");
const {
  listarCanaisDiscord
} = require("./discord-channels");
const {
  enviarDiscord
} = require("./discord-sender");

const MENSAGEM_TESTE_DISCORD = "✅ Optimus Promo conectado ao Discord com sucesso.";

function erroMensagem(erro, fallback = "Erro Discord") {
  return erro?.codigo || erro?.message || fallback;
}

function criarRotasDiscord(deps = {}) {
  const router = express.Router();
  const getClienteId = deps.getClienteId || ((req) => req.clienteId || "admin");
  const usuarioTemRecurso = deps.usuarioTemRecurso || (() => false);
  const jwt = deps.jwt;
  const secret = deps.jwtSecret;
  const env = deps.env || process.env;
  const httpClient = deps.httpClient;
  const storageDeps = deps.storageDeps || {};

  router.get("/conectar", (req, res) => {
    const clienteId = getClienteId(req);
    if (!usuarioTemRecurso(req, "discord")) {
      return res.status(403).json({ ok: false, erro: "Recurso Discord indisponivel no plano" });
    }

    try {
      const resultado = criarUrlConexaoDiscord({
        clienteId,
        env,
        jwt,
        secret,
        registrarStateDiscordOAuth: (id, dados) => registrarStateDiscordOAuth(id, dados, storageDeps)
      });
      return res.json({ ok: true, url: resultado.url });
    } catch (erro) {
      return res.status(503).json({ ok: false, erro: erroMensagem(erro, "Discord nao configurado") });
    }
  });

  router.get("/callback", async (req, res) => {
    try {
      const conexao = await processarCallbackDiscord({
        query: req.query || {},
        env,
        jwt,
        secret,
        httpClient,
        consumirStateDiscordOAuth: (clienteId, nonce) => consumirStateDiscordOAuth(clienteId, nonce, storageDeps),
        salvarConexaoDiscord: (clienteId, dados) => salvarConexaoDiscord(clienteId, dados, storageDeps)
      });

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(`<!doctype html><html><body><p>Discord conectado: ${conexao.guildName || "servidor"}</p></body></html>`);
    } catch (erro) {
      return res.status(400).json({ ok: false, erro: erroMensagem(erro, "Falha ao conectar Discord") });
    }
  });

  router.get("/conexoes", (req, res) => {
    const clienteId = getClienteId(req);
    const conexoes = listarConexoesDiscord(clienteId, storageDeps);
    return res.json({ ok: true, conexoes });
  });

  router.get("/conexoes/:id/canais", async (req, res) => {
    const clienteId = getClienteId(req);
    if (!usuarioTemRecurso(req, "discord")) {
      return res.status(403).json({ ok: false, erro: "Recurso Discord indisponivel no plano" });
    }

    const conexaoId = req.params.id;
    const conexoes = listarConexoesDiscord(clienteId, storageDeps);
    const conexao = conexoes.find((item) => item.id === conexaoId);
    if (!conexao) {
      return res.status(404).json({ ok: false, erro: "Conexao Discord nao encontrada" });
    }
    if (conexao.ativo === false) {
      return res.status(400).json({ ok: false, erro: "Conexao Discord inativa" });
    }

    try {
      const canais = await listarCanaisDiscord({ guildId: conexao.guildId, env, httpClient });
      return res.json({ ok: true, canais });
    } catch (erro) {
      return res.status(502).json({ ok: false, erro: erroMensagem(erro, "Falha ao listar canais Discord") });
    }
  });

  router.post("/conexoes/:id/testar", async (req, res) => {
    const clienteId = getClienteId(req);
    if (!usuarioTemRecurso(req, "discord")) {
      return res.status(403).json({ ok: false, erro: "Recurso Discord indisponivel no plano" });
    }

    const conexaoId = req.params.id;
    const channelId = String(req.body?.channelId || "").trim();
    if (!channelId) {
      return res.status(400).json({ ok: false, erro: "Canal Discord obrigatorio" });
    }

    const conexoes = listarConexoesDiscord(clienteId, storageDeps);
    const conexao = conexoes.find((item) => item.id === conexaoId);
    if (!conexao) {
      return res.status(404).json({ ok: false, erro: "Conexao Discord nao encontrada" });
    }
    if (conexao.ativo === false) {
      return res.status(400).json({ ok: false, erro: "Conexao Discord inativa" });
    }

    try {
      const canais = await listarCanaisDiscord({ guildId: conexao.guildId, env, httpClient });
      const canal = canais.find((item) => item.id === channelId);
      if (!canal) {
        return res.status(404).json({ ok: false, erro: "Canal Discord nao encontrado" });
      }
      if (!canal.utilizavel) {
        return res.status(400).json({ ok: false, erro: canal.motivoIndisponivel || "Canal Discord indisponivel" });
      }

      const resultado = await enviarDiscord({
        channelId: canal.id,
        mensagem: MENSAGEM_TESTE_DISCORD,
        env,
        httpClient
      });
      if (!resultado.ok) {
        return res.status(resultado.statusHttp || 502).json({
          ok: false,
          erro: resultado.erro || "Falha ao testar Discord",
          resultado
        });
      }
      return res.json({ ok: true, resultado });
    } catch (erro) {
      return res.status(502).json({ ok: false, erro: erroMensagem(erro, "Falha ao testar Discord") });
    }
  });

  router.post("/desconectar", (req, res) => {
    const clienteId = getClienteId(req);
    const conexaoId = req.body?.id || req.body?.conexaoId || req.body?.guildId;
    const conexao = desconectarConexaoDiscord(clienteId, conexaoId, storageDeps);
    if (!conexao) {
      return res.status(404).json({ ok: false, erro: "Conexao Discord nao encontrada" });
    }
    return res.json({ ok: true, conexao });
  });

  return router;
}

module.exports = criarRotasDiscord;
module.exports.MENSAGEM_TESTE_DISCORD = MENSAGEM_TESTE_DISCORD;
