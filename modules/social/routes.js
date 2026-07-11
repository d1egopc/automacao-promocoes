const express = require("express");
const storage = require("./storage");
const { logSocial, logErroSocial } = require("./logs");
const { payloadTemplateSocialPadrao } = require("./templates");
const { payloadAgendamentoSocialPadrao } = require("./scheduler");
const { payloadDirectSocialPadrao } = require("./direct");
const {
  consultarAtivosMeta,
  concluirCallbackMeta,
  iniciarConexaoMeta
} = require("./facebook");
const {
  concluirCallbackInstagram,
  iniciarConexaoInstagram,
  lerConexaoInstagram,
  limparConexaoInstagram,
  sanitizarConexaoInstagram
} = require("./instagram");

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

  function redirectFrontendMeta(status = "") {
    const frontendUrl = String(process.env.FRONTEND_URL || "").trim();
    if (!frontendUrl) return "";

    try {
      const destino = new URL("/social", frontendUrl);
      destino.searchParams.set("meta", status);
      return destino.toString();
    } catch {
      return "";
    }
  }

  function redirectFrontendInstagram(status = "") {
    const frontendUrl = String(process.env.FRONTEND_URL || "").trim();
    if (!frontendUrl) return "";

    try {
      const destino = new URL("/social", frontendUrl);
      destino.searchParams.set("instagram", status);
      return destino.toString();
    } catch {
      return "";
    }
  }

  function erroInstagramSeguro(erro = "") {
    const codigo = String(erro || "").trim();
    const permitidos = new Set([
      "instagram_nao_configurado",
      "state_invalido",
      "state_expirado",
      "code_ausente",
      "troca_token_falhou",
      "consulta_conta_falhou"
    ]);
    return permitidos.has(codigo) ? codigo : "instagram_oauth_falhou";
  }

  function payloadStatusInstagram(conexao = {}) {
    const instagram = sanitizarConexaoInstagram(conexao);
    if (!instagram.conectado) {
      return {
        ok: true,
        conectado: false,
        status: "desconectado"
      };
    }

    return {
      ok: true,
      conectado: true,
      status: "conectado",
      instagramUserId: instagram.instagramUserId,
      username: instagram.username,
      accountType: instagram.accountType,
      profilePictureUrl: instagram.profilePictureUrl,
      tokenPresente: instagram.tokenPresente,
      expiresAt: instagram.expiresAt,
      scopes: instagram.scopes
    };
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

  router.get("/meta/ativos", async (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const conexao = storage.getConexaoMetaSocial(clienteId);
      const accessToken = conexao.token?.accessToken || "";

      if (!accessToken) {
        return res.status(400).json({
          ok: false,
          clienteId,
          status: "desconectado",
          erro: "meta_token_ausente"
        });
      }

      const ativos = await consultarAtivosMeta({
        clienteId,
        accessToken
      });
      const salvo = storage.setConexaoMetaSocial(clienteId, {
        ...conexao,
        paginas: ativos.paginas || [],
        ativos: {
          status: ativos.status,
          motivo: ativos.motivo || "",
          atualizadoEm: new Date().toISOString()
        }
      });
      const meta = storage.sanitizarConexaoMeta(salvo);

      return res.status(ativos.ok ? 200 : 409).json({
        ok: ativos.ok,
        clienteId,
        status: ativos.status,
        motivo: ativos.motivo || "",
        meta,
        paginas: meta.paginas
      });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "GET /social/meta/ativos" });
      return res.status(500).json({
        ok: false,
        erro: e.message || "meta_ativos_erro"
      });
    }
  });

  router.post("/meta/selecionar", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const salvo = storage.selecionarAtivoMetaSocial(clienteId, req.body || {});
      const meta = storage.sanitizarConexaoMeta(salvo);

      return res.json({
        ok: true,
        clienteId,
        status: "ativo_selecionado",
        meta
      });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "POST /social/meta/selecionar" });
      return res.status(400).json({
        ok: false,
        erro: e.message || "meta_ativo_selecao_invalida"
      });
    }
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
    console.log("[SOCIAL-META-CALLBACK-ENTROU]");
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

      const redirectSucesso = redirectFrontendMeta("conectado");
      if (redirectSucesso) {
        return res.redirect(302, redirectSucesso);
      }

      return res.json({
        ok: true,
        clienteId: resultado.clienteId,
        provider: "meta",
        status: "conectado",
        meta
      });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "GET /social/meta/callback" });
      const redirectErro = redirectFrontendMeta("erro");
      if (redirectErro) {
        return res.redirect(302, redirectErro);
      }

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

  router.get("/instagram/status", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    return res.json(payloadStatusInstagram(lerConexaoInstagram(clienteId)));
  });

  router.get("/instagram/conectar", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const inicio = iniciarConexaoInstagram({
        clienteId,
        redirectUri: req.query?.redirectUri || req.query?.redirect_uri || ""
      });

      logSocial("[SOCIAL-INSTAGRAM-OAUTH-INICIO]", {
        clienteId,
        provider: "instagram",
        redirectUri: inicio.redirectUri,
        scopes: inicio.scopes
      });

      return res.json({
        ok: true,
        authUrl: inicio.authUrl
      });
    } catch (e) {
      const erro = erroInstagramSeguro(e.message);
      logErroSocial({ erro, rota: "GET /social/instagram/conectar" });
      return res.status(400).json({
        ok: false,
        erro
      });
    }
  });

  router.get("/instagram/callback", async (req, res) => {
    try {
      logSocial("[SOCIAL-INSTAGRAM-CALLBACK-INICIO]", {
        codePresente: Boolean(req.query?.code),
        temState: Boolean(req.query?.state),
        env: {
          INSTAGRAM_APP_ID: Boolean(process.env.INSTAGRAM_APP_ID),
          INSTAGRAM_APP_SECRET: Boolean(process.env.INSTAGRAM_APP_SECRET),
          INSTAGRAM_REDIRECT_URI: Boolean(process.env.INSTAGRAM_REDIRECT_URI)
        }
      });

      const conexao = await concluirCallbackInstagram({
        code: req.query?.code || "",
        state: req.query?.state || "",
        redirectUri: req.query?.redirectUri || req.query?.redirect_uri || ""
      });
      const instagram = sanitizarConexaoInstagram(conexao);

      const redirectSucesso = redirectFrontendInstagram("conectado");
      if (redirectSucesso) {
        return res.redirect(302, redirectSucesso);
      }

      return res.json({
        ok: true,
        conectado: true,
        status: "conectado",
        instagramUserId: instagram.instagramUserId,
        username: instagram.username,
        accountType: instagram.accountType,
        profilePictureUrl: instagram.profilePictureUrl,
        tokenPresente: instagram.tokenPresente,
        expiresAt: instagram.expiresAt,
        scopes: instagram.scopes
      });
    } catch (e) {
      const erro = erroInstagramSeguro(e.message);
      logErroSocial({ erro, rota: "GET /social/instagram/callback" });
      const redirectErroBase = redirectFrontendInstagram("erro");
      const redirectErro = redirectErroBase ? (() => {
        const destino = new URL(redirectErroBase);
        destino.searchParams.set("erro", erro);
        return destino.toString();
      })() : "";
      if (redirectErro) {
        return res.redirect(302, redirectErro);
      }

      return res.status(400).json({
        ok: false,
        erro
      });
    }
  });

  router.post("/instagram/desconectar", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    const conexao = limparConexaoInstagram(clienteId);

    return res.json({
      ok: true,
      conectado: false
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
    const limiteSeguro = Math.min(limite(req, 50), 50);
    logSocial("[SOCIAL-OPORTUNIDADES-CONSULTA]", {
      clienteId,
      limite: limiteSeguro
    });

    const oportunidades = storage.listarOportunidadesSocial(clienteId, limiteSeguro);
    logSocial("[SOCIAL-OPORTUNIDADES-RESULTADO]", {
      clienteId,
      total: oportunidades.length
    });

    return res.json({
      ok: true,
      clienteId,
      total: oportunidades.length,
      oportunidades
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
      "GET /social/meta/ativos",
      "POST /social/meta/selecionar",
      "GET /social/meta/conectar",
      "GET /social/meta/callback",
      "POST /social/meta/desconectar",
      "GET /social/instagram/status",
      "GET /social/instagram/conectar",
      "GET /social/instagram/callback",
      "POST /social/instagram/desconectar",
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
