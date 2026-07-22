const express = require("express");
const storage = require("./storage");
const { logSocial, logErroSocial } = require("./logs");
const { payloadTemplateSocialPadrao } = require("./templates");
const { payloadAgendamentoSocialPadrao } = require("./scheduler");
const { payloadDirectSocialPadrao } = require("./direct");
const { publicarNoInstagram } = require("./publicador-instagram.service");
const {
  executarAgendamentosPendentesCliente,
  executarAutomaticoCliente,
  publicarAgendamentoAgora,
  simularSelecaoAutomatica
} = require("./automatico.service");
const socialMediaStorage = require("./social-media-storage");
const {
  consultarAtivosMeta,
  concluirCallbackMeta,
  iniciarConexaoMeta
} = require("./facebook");
const {
  concluirCallbackInstagram,
  diagnosticarComentariosPublicacaoInstagram,
  getPublicacaoInstagram,
  getInteracaoInstagram,
  iniciarConexaoInstagram,
  lerConexaoInstagram,
  listarInteracoesInstagram,
  listarPublicacoesInstagram,
  limparConexaoInstagram,
  processarWebhookInstagram,
  sanitizarConexaoInstagram,
  validarAssinaturaWebhookInstagram
} = require("./instagram");

const FRONTEND_URL_OFICIAL_SOCIAL = "https://optimuspromo.vercel.app";
const SOCIAL_MEDIA_UPLOAD_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm"
];

function frontendUrlSocialOficial() {
  const configurada = String(process.env.FRONTEND_URL || "").trim();
  const candidatos = [configurada, FRONTEND_URL_OFICIAL_SOCIAL].filter(Boolean);

  for (const candidato of candidatos) {
    try {
      const url = new URL(candidato);
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:") continue;
      if (host === "lovable.app" || host.endsWith(".lovable.app")) continue;
      return url.origin;
    } catch {
      // tenta o proximo candidato seguro
    }
  }

  return FRONTEND_URL_OFICIAL_SOCIAL;
}

function limiteUploadMidiaSocial() {
  const imagem = Number(process.env.SOCIAL_MEDIA_MAX_BYTES || 8 * 1024 * 1024);
  const video = Number(process.env.SOCIAL_MEDIA_VIDEO_MAX_BYTES || 64 * 1024 * 1024);
  const limites = [imagem, video].filter(valor => Number.isFinite(valor) && valor > 0);
  return Math.max(...limites, 8 * 1024 * 1024);
}

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
    const frontendUrl = frontendUrlSocialOficial();
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
    const frontendUrl = frontendUrlSocialOficial();
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
      "consulta_conta_falhou",
      "instagram_nao_conectado",
      "instagram_token_expirado",
      "oferta_id_obrigatorio",
      "oferta_nao_encontrada",
      "oferta_link_ausente",
      "oferta_status_invalido",
      "oferta_cupom_expirado",
      "oferta_bloqueada_inativa",
      "oferta_ja_publicada",
      "oferta_ja_agendada",
      "imagem_ausente",
      "imagem_nao_publica",
      "legenda_obrigatoria",
      "social_media_storage_nao_configurado",
      "social_media_arquivo_obrigatorio",
      "social_media_arquivo_muito_grande",
      "social_media_tipo_invalido",
      "formato_publicacao_invalido",
      "reels_video_ausente",
      "reels_video_invalido",
      "reels_container_erro",
      "reels_container_expirado",
      "reels_container_estado_desconhecido",
      "reels_processamento_timeout",
      "reels_publicacao_meta_erro"
    ]);
    return permitidos.has(codigo) ? codigo : "instagram_oauth_falhou";
  }

  function texto(valor = "") {
    return String(valor ?? "").trim();
  }

  function tipoPublicacaoSeguro(dados = {}) {
    const tipo = texto(dados.tipoPublicacao || dados.tipo || "oferta").toLowerCase();
    return ["oferta", "livre"].includes(tipo) ? tipo : "oferta";
  }

  function formatoPublicacaoSeguro(dados = {}) {
    const informado = Object.prototype.hasOwnProperty.call(dados, "formato") ||
      Object.prototype.hasOwnProperty.call(dados, "formatoPublicacao");
    const formato = texto(dados.formato || dados.formatoPublicacao || "feed").toLowerCase();
    if (informado && !["feed", "reels"].includes(formato)) throw new Error("formato_publicacao_invalido");
    return ["feed", "reels"].includes(formato) ? formato : "feed";
  }

  function origemPublicacaoSegura(dados = {}, tipo = "oferta", fallback = "") {
    const padrao = fallback || (tipo === "livre" ? "personalizada" : "manual");
    const origem = texto(dados.origem || padrao).toLowerCase();
    return ["manual", "personalizada", "automatica", "agendada"].includes(origem) ? origem : padrao;
  }

  function valorTexto(dados = {}, chaves = [], fallback = "") {
    for (const chave of chaves) {
      if (Object.prototype.hasOwnProperty.call(dados, chave)) return texto(dados[chave]);
    }
    return texto(fallback);
  }

  function valorObjeto(dados = {}, chaves = [], fallback = undefined) {
    for (const chave of chaves) {
      if (dados?.[chave] && typeof dados[chave] === "object") return dados[chave];
    }
    return fallback && typeof fallback === "object" ? fallback : undefined;
  }

  function mensagemPrivadaPayload(dados = {}, fallback = {}) {
    return valorTexto(dados, ["mensagemPrivada", "mensagemDirect", "textoDirect"], "") ||
      valorTexto(dados.direct || {}, ["mensagem", "texto", "textoDirect"], "") ||
      valorTexto(dados.gatilho || {}, ["mensagemPrivada", "mensagemDirect", "textoDirect"], "") ||
      texto(fallback.mensagemPrivada || fallback.gatilho?.textoDirect);
  }

  function urlDestinoPayload(dados = {}, fallback = {}) {
    return valorTexto(dados, ["urlDestino", "linkDestino", "linkAfiliado"], "") ||
      valorTexto(dados.direct || {}, ["urlDestino", "url", "link"], "") ||
      valorTexto(dados.redirect || {}, ["urlDestino", "url", "link"], "") ||
      valorTexto(dados.cta || {}, ["urlDestino", "url", "link", "linkBio", "linkGrupo"], "") ||
      texto(fallback.urlDestino || fallback.linkAfiliado);
  }

  function payloadPublicacaoSocial(dados = {}, fallback = {}) {
    const entrada = dados && typeof dados === "object" ? dados : {};
    const tipoPublicacao = tipoPublicacaoSeguro({ ...fallback, ...entrada });
    const mensagemPrivada = mensagemPrivadaPayload(entrada, fallback);
    const gatilhoEntrada = entrada.gatilho && typeof entrada.gatilho === "object" ? { ...entrada.gatilho } : fallback.gatilho;
    const gatilho = gatilhoEntrada && typeof gatilhoEntrada === "object"
      ? {
        ...gatilhoEntrada,
        ...(mensagemPrivada && !texto(gatilhoEntrada.textoDirect) ? { textoDirect: mensagemPrivada } : {})
      }
      : gatilhoEntrada;
    return {
      ...fallback,
      ...entrada,
      origem: origemPublicacaoSegura({ ...fallback, ...entrada }, tipoPublicacao, fallback.origem),
      tipoPublicacao,
      formato: formatoPublicacaoSeguro({ ...fallback, ...entrada }),
      ofertaId: valorTexto(entrada, ["ofertaId", "oportunidadeId"], fallback.ofertaId),
      imagemUrl: valorTexto(entrada, ["imagemUrl", "imagem"], fallback.imagemUrl),
      videoUrl: valorTexto(entrada, ["videoUrl", "video_url", "mediaUrl", "midiaUrl"], fallback.videoUrl || fallback.mediaUrl || fallback.midiaUrl),
      mimeType: valorTexto(entrada, ["mimeType", "mediaMimeType", "midiaMimeType", "videoMimeType"], fallback.mimeType || fallback.mediaMimeType || fallback.midiaMimeType || fallback.videoMimeType),
      legenda: valorTexto(entrada, ["legenda", "mensagem"], fallback.legenda),
      templateId: texto(entrada.templateId || fallback.templateId || (tipoPublicacao === "livre" ? "livre-instagram" : "padrao-instagram")),
      respostaPublica: Object.prototype.hasOwnProperty.call(entrada, "respostaPublica")
        ? texto(entrada.respostaPublica)
        : texto(entrada.gatilho?.respostaPublica || fallback.respostaPublica),
      gatilho,
      mensagemPrivada,
      direct: valorObjeto(entrada, ["direct"], fallback.direct),
      redirect: valorObjeto(entrada, ["redirect"], fallback.redirect),
      urlDestino: urlDestinoPayload(entrada, fallback),
      cta: valorObjeto(entrada, ["cta"], fallback.cta),
      linkAfiliado: valorTexto(entrada, ["linkAfiliado"], fallback.linkAfiliado)
    };
  }

  function validarPayloadPublicavel(payload = {}) {
    if (payload.tipoPublicacao === "livre") {
      if (payload.formato === "reels") {
        if (!texto(payload.videoUrl)) throw new Error("reels_video_ausente");
      } else if (!texto(payload.imagemUrl)) {
        throw new Error("imagem_url_obrigatoria");
      }
      if (!texto(payload.legenda)) throw new Error("legenda_obrigatoria");
      return;
    }
    if (!texto(payload.ofertaId)) throw new Error("oferta_id_obrigatorio");
  }

  function revalidarOportunidadeManual(clienteId, payload = {}, opcoes = {}) {
    if (payload.tipoPublicacao !== "oferta") return;
    const resultado = storage.validarOportunidadeSocialManual(clienteId, payload.ofertaId, opcoes);
    if (!resultado.ok) throw new Error(resultado.motivo || "oferta_nao_encontrada");
  }

  function validarDataAgendamento(agendadoPara = "") {
    const ms = Date.parse(texto(agendadoPara));
    if (!Number.isFinite(ms)) throw new Error("agendamento_data_invalida");
    if (ms <= Date.now()) throw new Error("agendamento_data_passada");
  }

  async function publicarPayloadSocial(clienteId, payload = {}, extras = {}) {
    validarPayloadPublicavel(payload);
    revalidarOportunidadeManual(clienteId, payload);
    return publicarNoInstagram({
      clienteId,
      origem: payload.origem,
      tipoPublicacao: payload.tipoPublicacao,
      formato: payload.formato,
      ofertaId: payload.ofertaId,
      imagemUrl: payload.imagemUrl,
      videoUrl: payload.videoUrl,
      mimeType: payload.mimeType,
      legenda: payload.legenda,
      templateId: payload.templateId,
      gatilho: payload.gatilho,
      respostaPublica: payload.respostaPublica,
      mensagemPrivada: payload.mensagemPrivada,
      direct: payload.direct,
      redirect: payload.redirect,
      urlDestino: payload.urlDestino,
      cta: payload.cta,
      linkAfiliado: payload.linkAfiliado,
      ...extras
    });
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
      status: instagram.status,
      instagramUserId: instagram.instagramUserId,
      username: instagram.username,
      accountType: instagram.accountType,
      profilePictureUrl: instagram.profilePictureUrl,
      tokenPresente: instagram.tokenPresente,
      expiresAt: instagram.expiresAt,
      scopes: instagram.scopes,
      webhookContaAssinada: instagram.webhookContaAssinada,
      webhookCampos: instagram.webhookCampos,
      webhookAssinadoEm: instagram.webhookAssinadoEm,
      webhookErro: instagram.webhookErro,
      webhookVerificadoEm: instagram.webhookVerificadoEm
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
        accessToken,
        selecaoAtual: {
          pageId: conexao.facebook?.pageId,
          instagramBusinessAccountId: conexao.instagram?.instagramBusinessAccountId
        }
      });
      const paginas = ativos.paginas || [];
      const paginaSelecionada = paginas.find(pagina => pagina.conectado === true) || {};
      const salvo = storage.setConexaoMetaSocial(clienteId, {
        ...conexao,
        facebook: {
          ...(conexao.facebook || {}),
          conectado: Boolean(paginaSelecionada.id),
          pageId: paginaSelecionada.id || "",
          pageAccessToken: paginaSelecionada.accessToken || "",
          pageName: paginaSelecionada.name || "",
          pageUsername: paginaSelecionada.username || ""
        },
        instagram: {
          ...(conexao.instagram || {}),
          conectado: Boolean(paginaSelecionada.instagramBusinessAccountId),
          instagramBusinessAccountId: paginaSelecionada.instagramBusinessAccountId || "",
          username: paginaSelecionada.instagramUsername || "",
          name: paginaSelecionada.instagramName || ""
        },
        paginas,
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
        scopes: instagram.scopes,
        webhookContaAssinada: instagram.webhookContaAssinada,
        webhookCampos: instagram.webhookCampos,
        webhookAssinadoEm: instagram.webhookAssinadoEm,
        webhookErro: instagram.webhookErro,
        webhookVerificadoEm: instagram.webhookVerificadoEm
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

  router.post("/instagram/publicar", async (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const payload = payloadPublicacaoSocial(req.body || {});
      validarPayloadPublicavel(payload);
      revalidarOportunidadeManual(clienteId, payload);
      const resultado = await publicarNoInstagram({
        clienteId,
        origem: payload.origem,
        tipoPublicacao: payload.tipoPublicacao,
        formato: payload.formato,
        ofertaId: payload.ofertaId,
        imagemUrl: payload.imagemUrl,
        videoUrl: payload.videoUrl,
        mimeType: payload.mimeType,
        legenda: payload.legenda,
        templateId: payload.templateId,
        gatilho: payload.gatilho,
        respostaPublica: payload.respostaPublica,
        mensagemPrivada: payload.mensagemPrivada,
        direct: payload.direct,
        redirect: payload.redirect,
        urlDestino: payload.urlDestino,
        cta: payload.cta,
        linkAfiliado: payload.linkAfiliado,
        agendamentoId: req.body?.agendamentoId || "",
        idempotencyKey: req.body?.idempotencyKey || ""
      });

      return res.status(resultado.publicacao.status === "erro" ? 502 : 200).json({
        ok: resultado.publicacao.status !== "erro",
        duplicada: resultado.duplicada,
        publicacao: resultado.publicacao
      });
    } catch (e) {
      const erro = erroInstagramSeguro(e.message);
      logErroSocial({ erro, rota: "POST /social/instagram/publicar" });
      return res.status(400).json({
        ok: false,
        erro
      });
    }
  });

  router.get("/instagram/webhook", (req, res) => {
    const verifyToken = String(process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "").trim();
    const mode = String(req.query?.["hub.mode"] || "").trim();
    const token = String(req.query?.["hub.verify_token"] || "").trim();
    const challenge = String(req.query?.["hub.challenge"] || "").trim();

    if (verifyToken && mode === "subscribe" && token === verifyToken) {
      return res.status(200).send(challenge);
    }

    return res.status(403).json({ ok: false, erro: "verify_token_invalido" });
  });

  router.post("/instagram/webhook", (req, res) => {
    logSocial("[INSTAGRAM-WEBHOOK-POST-RECEBIDO]", {
      recebidoEm: new Date().toISOString(),
      metodo: req.method,
      path: req.path,
      contentType: String(req.headers["content-type"] || ""),
      userAgent: String(req.headers["user-agent"] || ""),
      bodyTamanho: Buffer.isBuffer(req.rawBody)
        ? req.rawBody.length
        : Buffer.byteLength(JSON.stringify(req.body || {})),
      temAssinaturaSha256: Boolean(req.headers["x-hub-signature-256"]),
      temAssinaturaLegacy: Boolean(req.headers["x-hub-signature"])
    });
    const assinatura = String(req.headers["x-hub-signature-256"] || "");
    const assinaturaLegacy = String(req.headers["x-hub-signature"] || "");
    const algoritmoDetectado = assinatura ? "sha256" : (assinaturaLegacy ? "sha1" : "");
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    logSocial("[INSTAGRAM-WEBHOOK-ASSINATURA-INICIO]", {
      status: "iniciando",
      motivo: "",
      algoritmo: algoritmoDetectado
    });
    const assinaturaValida = validarAssinaturaWebhookInstagram({ assinatura, rawBody });
    if (!assinaturaValida) {
      logSocial("[INSTAGRAM-WEBHOOK-ASSINATURA-INVALIDA]", {
        status: "invalida",
        motivo: assinatura ? "hmac_invalido" : "assinatura_sha256_ausente",
        algoritmo: algoritmoDetectado
      });
      return res.status(403).json({ ok: false, erro: "assinatura_invalida" });
    }
    logSocial("[INSTAGRAM-WEBHOOK-ASSINATURA-OK]", {
      status: "ok",
      motivo: "",
      algoritmo: algoritmoDetectado
    });

    setImmediate(() => {
      processarWebhookInstagram({
        payload: req.body || {},
        assinatura,
        rawBody
      }).catch(e => {
        logErroSocial({ erro: e.message || "webhook_instagram_falhou", rota: "POST /social/instagram/webhook" });
      });
    });

    return res.status(200).json({ ok: true });
  });

  router.get("/instagram/publicacoes", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    return res.json({
      ok: true,
      publicacoes: listarPublicacoesInstagram(clienteId, limite(req, 100))
    });
  });

  router.get("/instagram/publicacoes/:id", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    const publicacao = getPublicacaoInstagram(clienteId, req.params.id);
    if (!publicacao) {
      return res.status(404).json({
        ok: false,
        erro: "publicacao_nao_encontrada"
      });
    }

    return res.json({
      ok: true,
      publicacao
    });
  });

  router.post("/instagram/diagnostico-comentarios", async (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const resultado = await diagnosticarComentariosPublicacaoInstagram({
        clienteId,
        publicacaoId: req.body?.publicacaoId || ""
      });
      return res.status(resultado.ok ? 200 : 502).json(resultado);
    } catch (e) {
      const codigo = String(e.message || "instagram_diagnostico_comentarios_falhou").trim();
      const status = codigo === "publicacao_nao_encontrada" ? 404 : 400;
      logErroSocial({ erro: codigo, rota: "POST /social/instagram/diagnostico-comentarios" });
      return res.status(status).json({
        ok: false,
        erro: codigo
      });
    }
  });

  router.get("/instagram/interacoes", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    return res.json({
      ok: true,
      interacoes: listarInteracoesInstagram(clienteId, limite(req, 100))
    });
  });

  router.get("/instagram/interacoes/:id", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    const interacao = getInteracaoInstagram(clienteId, req.params.id);
    if (!interacao) {
      return res.status(404).json({ ok: false, erro: "interacao_nao_encontrada" });
    }

    return res.json({ ok: true, interacao });
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

  router.delete("/templates/:id", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    const template = storage.removerTemplateSocial(clienteId, req.params.id);
    if (!template) return res.status(404).json({ ok: false, erro: "template_nao_encontrado" });
    return res.json({ ok: true, clienteId, template });
  });

  router.get("/rascunhos", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    return res.json({
      ok: true,
      clienteId,
      rascunhos: storage.listarRascunhosSocial(clienteId)
    });
  });

  router.post("/rascunhos", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const payload = payloadPublicacaoSocial(req.body?.rascunho || req.body || {});
      const rascunho = storage.salvarRascunhoSocial(clienteId, {
        ...payload,
        id: req.body?.id || req.body?.rascunho?.id,
        nome: req.body?.nome || req.body?.rascunho?.nome,
        status: "rascunho",
        agendadoPara: req.body?.agendadoPara || req.body?.rascunho?.agendadoPara || ""
      });
      return res.json({ ok: true, clienteId, rascunho });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "POST /social/rascunhos" });
      return res.status(400).json({ ok: false, erro: e.message || "social_rascunho_invalido" });
    }
  });

  router.put("/rascunhos/:id", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const existente = storage.getRascunhoSocial(clienteId, req.params.id);
      if (!existente) return res.status(404).json({ ok: false, erro: "rascunho_nao_encontrado" });
      const payload = payloadPublicacaoSocial(req.body?.rascunho || req.body || {}, existente);
      const rascunho = storage.salvarRascunhoSocial(clienteId, {
        ...payload,
        id: existente.id,
        nome: req.body?.nome || req.body?.rascunho?.nome || existente.nome,
        status: "rascunho",
        agendadoPara: req.body?.agendadoPara || req.body?.rascunho?.agendadoPara || existente.agendadoPara
      });
      return res.json({ ok: true, clienteId, rascunho });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "PUT /social/rascunhos/:id" });
      return res.status(400).json({ ok: false, erro: e.message || "social_rascunho_invalido" });
    }
  });

  router.delete("/rascunhos/:id", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    const rascunho = storage.removerRascunhoSocial(clienteId, req.params.id);
    if (!rascunho) return res.status(404).json({ ok: false, erro: "rascunho_nao_encontrado" });
    return res.json({ ok: true, clienteId, rascunho });
  });

  router.post("/rascunhos/:id/publicar", async (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const rascunho = storage.getRascunhoSocial(clienteId, req.params.id);
      if (!rascunho) return res.status(404).json({ ok: false, erro: "rascunho_nao_encontrado" });
      const payload = payloadPublicacaoSocial(req.body?.rascunho || req.body || {}, rascunho);
      const resultado = await publicarPayloadSocial(clienteId, payload, {
        idempotencyKey: `rascunho:${clienteId}:${rascunho.id}:${payload.formato || "feed"}`
      });
      const status = resultado.publicacao?.status === "publicada" ? "publicada" : "erro";
      const atualizado = storage.salvarRascunhoSocial(clienteId, {
        ...payload,
        id: rascunho.id,
        nome: rascunho.nome,
        status,
        publicacaoId: resultado.publicacao?.id || "",
        erro: resultado.publicacao?.erro || null
      });
      return res.status(status === "erro" ? 502 : 200).json({
        ok: status !== "erro",
        clienteId,
        rascunho: atualizado,
        publicacao: resultado.publicacao
      });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "POST /social/rascunhos/:id/publicar" });
      return res.status(400).json({ ok: false, erro: e.message || "social_rascunho_publicacao_falhou" });
    }
  });

  router.post("/rascunhos/:id/agendar", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const rascunho = storage.getRascunhoSocial(clienteId, req.params.id);
      if (!rascunho) return res.status(404).json({ ok: false, erro: "rascunho_nao_encontrado" });
      const agendadoPara = texto(req.body?.agendadoPara || req.body?.agendamento?.agendadoPara || rascunho.agendadoPara);
      validarDataAgendamento(agendadoPara);
      const payload = payloadPublicacaoSocial(req.body?.agendamento || req.body || {}, rascunho);
      validarPayloadPublicavel(payload);
      revalidarOportunidadeManual(clienteId, payload);
      const agendamento = storage.salvarAgendamentoSocial(clienteId, {
        ...payload,
        nome: req.body?.nome || req.body?.agendamento?.nome || rascunho.nome,
        origem: "agendada",
        status: "agendada",
        ativo: true,
        agendadoPara
      });
      const rascunhoAtualizado = storage.salvarRascunhoSocial(clienteId, {
        ...rascunho,
        status: "agendada",
        agendadoPara,
        agendamentoId: agendamento.id
      });
      return res.json({ ok: true, clienteId, rascunho: rascunhoAtualizado, agendamento });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "POST /social/rascunhos/:id/agendar" });
      return res.status(400).json({ ok: false, erro: e.message || "social_rascunho_agendamento_falhou" });
    }
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

    try {
      const clienteId = cliente(req);
      const entrada = req.body?.agendamento || req.body || {};
      const agendadoPara = texto(entrada.agendadoPara || req.body?.agendadoPara);
      validarDataAgendamento(agendadoPara);
      const payload = payloadPublicacaoSocial(entrada, { origem: "agendada" });
      validarPayloadPublicavel(payload);
      revalidarOportunidadeManual(clienteId, payload);
      const statusSolicitado = texto(entrada.status || "agendada");
      const agendamento = storage.salvarAgendamentoSocial(clienteId, {
        ...payload,
        id: entrada.id,
        nome: entrada.nome,
        ativo: entrada.ativo !== false,
        status: statusSolicitado === "rascunho" ? "agendada" : statusSolicitado,
        agendadoPara,
        horario: entrada.horario,
        timezone: entrada.timezone,
        regras: entrada.regras
      });

      return res.json({
        ok: true,
        clienteId,
        agendamento
      });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "POST /social/agendamentos" });
      return res.status(400).json({ ok: false, erro: e.message || "social_agendamento_invalido" });
    }
  });

  router.put("/agendamentos/:id", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const existente = storage.getAgendamentoSocial(clienteId, req.params.id);
      if (!existente) return res.status(404).json({ ok: false, erro: "agendamento_nao_encontrado" });
      if (["publicada", "processando"].includes(texto(existente.status))) {
        return res.status(409).json({ ok: false, erro: "agendamento_nao_editavel" });
      }
      const entrada = req.body?.agendamento || req.body || {};
      const agendadoPara = texto(entrada.agendadoPara || existente.agendadoPara);
      validarDataAgendamento(agendadoPara);
      const payload = payloadPublicacaoSocial(entrada, existente);
      validarPayloadPublicavel(payload);
      revalidarOportunidadeManual(clienteId, payload, { ignorarAgendamentoId: existente.id });
      const agendamento = storage.salvarAgendamentoSocial(clienteId, {
        ...payload,
        id: existente.id,
        nome: entrada.nome || existente.nome,
        ativo: entrada.ativo !== false,
        status: entrada.status || "agendada",
        agendadoPara,
        horario: entrada.horario || existente.horario,
        timezone: entrada.timezone || existente.timezone,
        regras: entrada.regras || existente.regras
      });
      return res.json({ ok: true, clienteId, agendamento });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "PUT /social/agendamentos/:id" });
      return res.status(400).json({ ok: false, erro: e.message || "social_agendamento_invalido" });
    }
  });

  router.post("/agendamentos/:id/reagendar", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const existente = storage.getAgendamentoSocial(clienteId, req.params.id);
      if (!existente) return res.status(404).json({ ok: false, erro: "agendamento_nao_encontrado" });
      const agendadoPara = texto(req.body?.agendadoPara || req.body?.agendamento?.agendadoPara);
      validarDataAgendamento(agendadoPara);
      const agendamento = storage.salvarAgendamentoSocial(clienteId, {
        ...existente,
        agendadoPara,
        status: "agendada",
        ativo: true,
        erro: null
      });
      return res.json({ ok: true, clienteId, agendamento });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "POST /social/agendamentos/:id/reagendar" });
      return res.status(400).json({ ok: false, erro: e.message || "social_agendamento_reagendar_falhou" });
    }
  });

  router.post("/agendamentos/:id/cancelar", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    const existente = storage.getAgendamentoSocial(clienteId, req.params.id);
    if (!existente) return res.status(404).json({ ok: false, erro: "agendamento_nao_encontrado" });
    const agendamento = storage.salvarAgendamentoSocial(clienteId, {
      ...existente,
      status: "cancelada",
      ativo: false
    });
    return res.json({ ok: true, clienteId, agendamento });
  });

  router.delete("/agendamentos", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const modo = texto(req.body?.modo || req.query?.modo);
      const resultado = storage.limparAgendamentosSocial(clienteId, modo);
      return res.json({ ok: true, clienteId, ...resultado });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "DELETE /social/agendamentos" });
      return res.status(400).json({ ok: false, erro: e.message || "social_agendamentos_limpeza_invalida" });
    }
  });

  router.delete("/agendamentos/concluidos", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const resultado = storage.limparAgendamentosConcluidosSocial(clienteId);
      return res.json({ ok: true, clienteId, ...resultado });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "DELETE /social/agendamentos/concluidos" });
      return res.status(400).json({ ok: false, erro: e.message || "social_agendamentos_concluidos_limpeza_falhou" });
    }
  });

  router.delete("/agendamentos/:id", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    const agendamento = storage.removerAgendamentoSocial(clienteId, req.params.id);
    if (!agendamento) return res.status(404).json({ ok: false, erro: "agendamento_nao_encontrado" });
    return res.json({ ok: true, clienteId, agendamento });
  });

  router.post("/agendamentos/:id/publicar", async (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const agendamento = storage.getAgendamentoSocial(clienteId, req.params.id);
      if (!agendamento) return res.status(404).json({ ok: false, erro: "agendamento_nao_encontrado" });
      revalidarOportunidadeManual(clienteId, agendamento, { ignorarAgendamentoId: agendamento.id });
      const resultado = await publicarAgendamentoAgora({
        clienteId,
        agendamentoId: req.params.id
      });
      return res.status(resultado.ok ? 200 : 409).json(resultado);
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "POST /social/agendamentos/:id/publicar" });
      return res.status(400).json({ ok: false, erro: e.message || "social_agendamento_publicacao_falhou" });
    }
  });

  router.get("/automatico/config", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    const clienteId = cliente(req);
    return res.json({
      ok: true,
      clienteId,
      config: storage.getConfigAutomaticoSocial(clienteId)
    });
  });

  router.post("/automatico/config", async (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const config = storage.setConfigAutomaticoSocial(clienteId, req.body?.config || req.body || {});
      return res.json({
        ok: true,
        clienteId,
        config,
        sincronizacao: {
          agendamentosCriados: 0,
          motivo: config.ativo ? "ciclo_automatico_sincronizado" : "automatico_desativado"
        }
      });
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "POST /social/automatico/config" });
      return res.status(400).json({ ok: false, erro: e.message || "social_automatico_config_invalida" });
    }
  });

  router.post("/automatico/simular", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const resultado = simularSelecaoAutomatica({
        clienteId,
        limite: Math.min(limite(req, 50), 50)
      });
      return res.json(resultado);
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "POST /social/automatico/simular" });
      return res.status(400).json({ ok: false, erro: e.message || "social_automatico_simulacao_falhou" });
    }
  });

  router.post("/automatico/executar", async (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const resultado = await executarAutomaticoCliente({ clienteId });
      return res.status(resultado.ok ? 200 : 409).json(resultado);
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "POST /social/automatico/executar" });
      return res.status(400).json({ ok: false, erro: e.message || "social_automatico_execucao_falhou" });
    }
  });

  router.post("/agendamentos/executar", async (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const resultado = await executarAgendamentosPendentesCliente({ clienteId });
      return res.json(resultado);
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "POST /social/agendamentos/executar" });
      return res.status(400).json({ ok: false, erro: e.message || "social_agendamentos_execucao_falhou" });
    }
  });

  router.post(
    "/midia/upload",
    express.raw({ type: SOCIAL_MEDIA_UPLOAD_MIMES, limit: limiteUploadMidiaSocial() }),
    (req, res) => {
      if (!socialPermitido(req)) {
        return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
      }

      try {
        const clienteId = cliente(req);
        const resultado = socialMediaStorage.salvar({
          clienteId,
          buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          mimeType: req.headers["content-type"] || "",
          nomeLogico: req.query?.nome || "publicacao_livre"
        });
        return res.json({
          ok: true,
          clienteId,
          url: resultado.url,
          mimeType: resultado.mimeType,
          tipo: resultado.tipo,
          midia: {
            url: resultado.url,
            mimeType: resultado.mimeType,
            tipo: resultado.tipo,
            bytes: resultado.bytes,
            hash: resultado.hash.slice(0, 12)
          }
        });
      } catch (e) {
        const erro = erroInstagramSeguro(e.message);
        logErroSocial({ erro, rota: "POST /social/midia/upload" });
        const status = erro === "social_media_storage_nao_configurado" ? 501 : 400;
        return res.status(status).json({ ok: false, erro });
      }
    },
    (erro, req, res, next) => {
      if (erro?.type === "entity.too.large") {
        logErroSocial({ erro: "social_media_arquivo_muito_grande", rota: "POST /social/midia/upload" });
        return res.status(413).json({ ok: false, erro: "social_media_arquivo_muito_grande" });
      }
      return next(erro);
    }
  );

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
      total: oportunidades.length,
      oportunidades
    });
  });

  router.post("/oportunidades/limpar", (req, res) => {
    if (!socialPermitido(req)) {
      return res.status(403).json({ ok: false, erro: "Social Module nao disponivel no plano" });
    }

    try {
      const clienteId = cliente(req);
      const modoSolicitado = texto(req.body?.modo || req.body?.tipo || "galeria").toLowerCase();
      const modo = modoSolicitado === "antigas" ? "antigas" : "galeria";
      const config = storage.getConfigAutomaticoSocial(clienteId);
      const resultado = storage.limparOportunidadesSocial(clienteId, {
        modo,
        idadeMaximaHoras: config.idadeMaximaHoras
      });
      return res.json(resultado);
    } catch (e) {
      logErroSocial({ erro: e.message, rota: "POST /social/oportunidades/limpar" });
      return res.status(400).json({ ok: false, erro: e.message || "social_oportunidades_limpeza_falhou" });
    }
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
      "POST /social/instagram/publicar",
      "GET /social/instagram/webhook",
      "POST /social/instagram/webhook",
      "GET /social/instagram/publicacoes",
      "GET /social/instagram/publicacoes/:id",
      "POST /social/instagram/diagnostico-comentarios",
      "GET /social/instagram/interacoes",
      "GET /social/instagram/interacoes/:id",
      "GET /social/templates",
      "POST /social/templates",
      "DELETE /social/templates/:id",
      "GET /social/rascunhos",
      "POST /social/rascunhos",
      "PUT /social/rascunhos/:id",
      "DELETE /social/rascunhos/:id",
      "POST /social/rascunhos/:id/publicar",
      "POST /social/rascunhos/:id/agendar",
      "GET /social/agendamentos",
      "POST /social/agendamentos",
      "PUT /social/agendamentos/:id",
      "POST /social/agendamentos/:id/reagendar",
      "POST /social/agendamentos/:id/cancelar",
      "DELETE /social/agendamentos",
      "DELETE /social/agendamentos/concluidos",
      "DELETE /social/agendamentos/:id",
      "POST /social/agendamentos/:id/publicar",
      "GET /social/automatico/config",
      "POST /social/automatico/config",
      "POST /social/automatico/simular",
      "POST /social/automatico/executar",
      "POST /social/agendamentos/executar",
      "POST /social/midia/upload",
      "GET /social/publicacoes",
      "GET /social/oportunidades",
      "POST /social/oportunidades/limpar",
      "POST /social/publicar"
    ]
  });

  return router;
}

module.exports = criarRotasSocial;
