const express = require("express");
const storage = require("./storage");
const { logSocial, logErroSocial } = require("./logs");
const { payloadTemplateSocialPadrao } = require("./templates");
const { payloadAgendamentoSocialPadrao } = require("./scheduler");
const { payloadDirectSocialPadrao } = require("./direct");
const {
  concluirCallbackMeta,
  iniciarConexaoMeta
} = require("./facebook");

function criarRotasSocial(deps = {}) {
  const router = express.Router();
  const getClienteId = typeof deps.getClienteId === "function"
    ? deps.getClienteId
    : () => "admin";
  const usuarioTemRecurso = typeof deps.usuarioTemRecurso === "function"
    ? deps.usuarioTemRecurso
    : () => true;

  function socialPermitido(req) {
    return req.usuario?.papel === "admin_master" || usuarioTemRecurso(req, "social");
  }

  function cliente(req) {
    return getClienteId(req) || "admin";
  }

  function limite(req, padrao = 100) {
    return Math.max(1, Math.min(500, Number(req.query?.limit || padrao) || padrao));
  }

  router.get("/config", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    return res.json({
      ok: true,
      clienteId,
      config: storage.getConfigSocial(clienteId)
    });
  });

  router.post("/config", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    const config = storage.setConfigSocial(clienteId, req.body?.config || req.body || {});

    return res.json({
      ok: true,
      clienteId,
      config
    });
  });

  router.get("/meta/status", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    return res.json({
      ok: true,
      clienteId,
      meta: storage.sanitizarConexaoMeta(storage.getConexaoMetaSocial(clienteId))
    });
  });

  router.get("/meta/conectar", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const inicio = iniciarConexaoMeta({
        clienteId,
        redirectUri: req.query?.redirectUri || req.query?.redirect_uri || ""
      });

      logSocial("[SOCIAL-META-OAUTH-INICIO]", {
        clienteId,
        provider: "meta",
        scopes: inicio.scopes
      });

      return res.json({
        ok: true,
        clienteId,
        provider: "meta",
        status: inicio.status,
        authUrl: inicio.authUrl,
        state: inicio.state,
        redirectUri: inicio.redirectUri,
        scopes: inicio.scopes
      });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "GET /social/meta/conectar" });
      return res.status(400).json({
        ok: false,
        erro: e.message || "meta_oauth_inicio_falhou"
      });
    }
  });

  router.get("/meta/callback", async (req, res) => {
    try {
      logSocial("[SOCIAL-META-CALLBACK-INICIO]", {
        codeFinal: String(req.query?.code || "").slice(-6),
        temState: Boolean(req.query?.state),
        redirectUriQuery: req.query?.redirectUri || req.query?.redirect_uri || "",
        env: {
          META_APP_ID: Boolean(process.env.META_APP_ID),
          META_APP_SECRET: Boolean(process.env.META_APP_SECRET),
          META_REDIRECT_URI: Boolean(process.env.META_REDIRECT_URI)
        }
      });

      const resultado = await concluirCallbackMeta({
        code: req.query?.code || "",
        state: req.query?.state || "",
        redirectUri: req.query?.redirectUri || req.query?.redirect_uri || ""
      });
      const salvo = storage.setConexaoMetaSocial(resultado.clienteId, resultado);
      const meta = storage.sanitizarConexaoMeta(salvo);

      logSocial("[SOCIAL-META-OAUTH-CALLBACK]", {
        clienteId: resultado.clienteId,
        conectado: meta.conectado,
        facebook: meta.facebook.conectado,
        instagram: meta.instagram.conectado,
        paginas: meta.paginas.length
      });

      return res.json({
        ok: true,
        clienteId: resultado.clienteId,
        provider: "meta",
        status: "conectado",
        meta
      });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "GET /social/meta/callback" });
      return res.status(400).json({
        ok: false,
        erro: e.message || "meta_oauth_callback_invalido"
      });
    }
  });

  router.post("/meta/desconectar", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    const meta = storage.limparConexaoMetaSocial(clienteId);

    return res.json({
      ok: true,
      clienteId,
      provider: "meta",
      status: "desconectado",
      meta
    });
  });

  router.get("/templates", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    return res.json({
      ok: true,
      clienteId,
      templatePadrao: payloadTemplateSocialPadrao(),
      templates: storage.listarTemplatesSocial(clienteId)
    });
  });

  router.post("/templates", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    const template = storage.salvarTemplateSocial(clienteId, req.body?.template || req.body || {});

    return res.json({
      ok: true,
      clienteId,
      template
    });
  });

  router.get("/agendamentos", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    return res.json({
      ok: true,
      clienteId,
      agendamentoPadrao: payloadAgendamentoSocialPadrao(),
      agendamentos: storage.listarAgendamentosSocial(clienteId)
    });
  });

  router.post("/agendamentos", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    const agendamento = storage.salvarAgendamentoSocial(clienteId, req.body?.agendamento || req.body || {});

    return res.json({
      ok: true,
      clienteId,
      agendamento
    });
  });

  router.get("/publicacoes", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    return res.json({
      ok: true,
      clienteId,
      publicacoes: storage.listarPublicacoesSocial(clienteId, limite(req))
    });
  });

  router.get("/oportunidades", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    return res.json({
      ok: true,
      clienteId,
      origem: "social-storage",
      observacao: "O Social Module consome ofertas universais prontas; a coleta externa sera conectada em sprint futura.",
      oportunidades: storage.listarOportunidadesSocial(clienteId, limite(req))
    });
  });

  router.post("/publicar", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const oferta = req.body?.ofertaUniversal || req.body?.oferta || {};
      const redes = Array.isArray(req.body?.redes) ? req.body.redes : [];

      if (!oferta || typeof oferta !== "object" || Object.keys(oferta).length === 0) {
        return res.status(400).json({
          ok: false,
          erro: "oferta_universal_obrigatoria"
        });
      }

      const ofertaUniversal =
        oferta.ofertaUniversal === true ||
        String(oferta.versaoOfertaUniversal || "").startsWith("v2") ||
        Boolean(oferta.inteligenciaUniversalV2);

      if (!ofertaUniversal) {
        return res.status(400).json({
          ok: false,
          erro: "oferta_universal_obrigatoria",
          detalhe: "Social Module consome somente Oferta Universal pronta"
        });
      }

      const publicacao = storage.registrarPublicacaoSocial(clienteId, {
        redes,
        oferta,
        conteudo: req.body?.conteudo || {},
        modo: req.body?.modo || "manual",
        agendadoPara: req.body?.agendadoPara || "",
        status: "rascunho",
        motivo: "publicacao_real_nao_implementada_nesta_sprint"
      });

      return res.json({
        ok: true,
        clienteId,
        status: "rascunho",
        publicado: false,
        motivo: "publicacao_real_nao_implementada_nesta_sprint",
        publicacao
      });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "POST /social/publicar" });
      return res.status(500).json({
        ok: false,
        erro: e.message
      });
    }
  });

  router.get("/payloads", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    return res.json({
      ok: true,
      config: storage.criarConfigPadrao(cliente(req)),
      template: payloadTemplateSocialPadrao(),
      agendamento: payloadAgendamentoSocialPadrao(),
      direct: payloadDirectSocialPadrao(),
      publicar: {
        redes: ["instagram", "facebook", "telegram"],
        ofertaUniversal: {
          ofertaUniversal: true,
          versaoOfertaUniversal: "v2-oficial",
          titulo: "",
          marketplace: "",
          precoAtual: null,
          precoOriginal: null,
          valorEfetivo: null,
          cupom: "",
          score: null,
          linkAfiliado: "",
          imagem: ""
        },
        conteudo: {},
        modo: "manual",
        agendadoPara: ""
      }
    });
  });

  logSocial("[SOCIAL-MODULE-INICIO]", {
    rotas: [
      "GET /social/config",
      "POST /social/config",
      "GET /social/meta/status",
      "GET /social/meta/conectar",
      "GET /social/meta/callback",
      "POST /social/meta/desconectar",
      "GET /social/templates",
      "POST /social/templates",
      "GET /social/agendamentos",
      "POST /social/agendamentos",
      "GET /social/publicacoes",
      "GET /social/oportunidades",
      "POST /social/publicar"
    ]
  });

  return router;
}

module.exports = criarRotasSocial;
