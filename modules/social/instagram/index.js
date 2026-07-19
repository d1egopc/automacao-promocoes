const crypto = require("crypto");
const {
  listClientes,
  readClienteJson,
  writeClienteJson
} = require("../../../utils/storage");
const { logSocial } = require("../logs");

const INSTAGRAM_AUTH_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const INSTAGRAM_GRAPH_BASE = "https://graph.instagram.com";
const INSTAGRAM_GRAPH_VERSION = "";
const ARQUIVO_INSTAGRAM = "social-instagram.json";
const ARQUIVO_PUBLICACOES = "social-publicacoes.json";
const ARQUIVO_INTERACOES = "social-interacoes.json";
const SCOPE_BASICO = "instagram_business_basic";
const SCOPE_PUBLICAR_CONTEUDO = "instagram_business_content_publish";
const SCOPE_GERENCIAR_COMENTARIOS = "instagram_business_manage_comments";
const SCOPE_GERENCIAR_MENSAGENS = "instagram_business_manage_messages";
const WEBHOOK_CAMPOS_CONTA = ["comments", "messages"];
const CONTAINER_STATUS_PRIMEIRA_ESPERA_MS = 1500;
const CONTAINER_STATUS_INTERVALO_MS = 3000;
const CONTAINER_STATUS_MAX_TENTATIVAS = 10;
const REELS_STATUS_PRIMEIRA_ESPERA_MS = 1500;
const REELS_STATUS_INTERVALO_MS = 5000;
const REELS_STATUS_MAX_TENTATIVAS = 60;
const REELS_STATUS_MAX_TENTATIVAS_LIMITE = 180;
const PUBLICACAO_EM_ANDAMENTO_TTL_MS = 15 * 60 * 1000;
const STATE_TTL_MS = 15 * 60 * 1000;

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function numeroInteiroAmbiente(nome, padrao, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const valor = Number(process.env[nome]);
  if (!Number.isFinite(valor)) return padrao;
  return Math.max(min, Math.min(max, Math.trunc(valor)));
}

async function httpFetchPadrao(url, opcoes = {}) {
  if (typeof fetch !== "function") {
    throw new Error("fetch_indisponivel");
  }

  const resposta = await fetch(url, opcoes);
  const data = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(data?.error?.message || data?.message || `http_${resposta.status}`);
    erro.response = {
      status: resposta.status,
      data
    };
    throw erro;
  }
  return { data };
}

function httpClientPadrao() {
  return {
    async post(url, body, config = {}) {
      return httpFetchPadrao(url, {
        method: "POST",
        headers: config.headers || {},
        body
      });
    },
    async get(url, config = {}) {
      const destino = new URL(url);
      for (const [chave, valor] of Object.entries(config.params || {})) {
        destino.searchParams.set(chave, valor);
      }
      return httpFetchPadrao(destino.toString(), {
        method: "GET",
        headers: config.headers || {}
      });
    }
  };
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const limpo = texto(valor).replace(/R\$/gi, "").replace(/\s/g, "");
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const resultado = Number(normalizado);
  return Number.isFinite(resultado) ? resultado : null;
}

function agoraIso() {
  return new Date().toISOString();
}

function criarId(prefixo = "igpub") {
  return `${prefixo}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function limitarTexto(valor = "", max = 500) {
  return texto(valor).replace(/\s+/g, " ").slice(0, max).trim();
}

function normalizarTextoComparacao(valor = "") {
  return texto(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escaparRegex(valor = "") {
  return texto(valor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contemGatilhoSeguro(comentario = "", palavra = "") {
  const alvo = normalizarTextoComparacao(palavra);
  const textoComentario = normalizarTextoComparacao(comentario);
  if (!alvo || !textoComentario) return false;
  const re = new RegExp(`(^|\\s)${escaparRegex(alvo)}(\\s|$)`);
  return re.test(textoComentario);
}

function detectarAlgoritmoAssinaturaWebhookInstagram(assinatura = "") {
  const valor = texto(assinatura);
  if (!valor) return "";
  const [algoritmo] = valor.split("=");
  return texto(algoritmo).toLowerCase();
}

function resumoPayloadWebhookInstagram(payload = {}) {
  const entries = lista(payload?.entry);
  const changes = entries.flatMap(entry => lista(entry?.changes));
  const fields = [...new Set(changes.map(change => texto(change?.field)).filter(Boolean))];
  const eventTypes = [...new Set(changes
    .map(change => {
      const value = change?.value || {};
      return texto(value.event_type || value.eventType || value.item || value.verb || change?.field);
    })
    .filter(Boolean))];

  return {
    object: texto(payload?.object),
    entryCount: entries.length,
    changesCount: changes.length,
    field: fields.join(","),
    eventType: eventTypes.join(",")
  };
}

function logWebhookDescartadoInstagram(motivo = "", dados = {}) {
  logSocial("[INSTAGRAM-WEBHOOK-DESCARTADO]", {
    motivo: texto(motivo),
    ...dados
  });
}

function textoParcialDiagnostico(valor = "", max = 32) {
  return limitarTexto(valor, max);
}

function usernameParcialDiagnostico(valor = "") {
  const nome = limitarTexto(valor, 80);
  if (!nome) return "";
  if (nome.length <= 3) return `${nome[0] || ""}***`;
  return `${nome.slice(0, 3)}***`;
}

function urlHttps(valor = "") {
  const url = texto(valor);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function urlHttpsDeCampos(objeto = {}, campos = []) {
  if (!objeto || typeof objeto !== "object") return "";
  for (const campo of campos) {
    const url = urlHttps(objeto[campo]);
    if (url) return url;
  }
  return "";
}

function urlDestinoConversaoPublicacao(dados = {}) {
  return urlHttps(dados.urlDestino) ||
    urlHttps(dados.linkAfiliado) ||
    urlHttps(dados.linkDestino) ||
    urlHttpsDeCampos(dados.direct, ["urlDestino", "url", "link"]) ||
    urlHttpsDeCampos(dados.redirect, ["urlDestino", "url", "link"]) ||
    urlHttpsDeCampos(dados.cta, ["urlDestino", "url", "link", "linkBio", "linkGrupo"]) ||
    urlHttpsDeCampos(dados.gatilho, ["grupoUrl"]);
}

function linkFinalPublicacaoLivre(publicacao = {}) {
  return urlHttps(publicacao.urlDestino) ||
    urlHttps(publicacao.linkAfiliado) ||
    urlHttpsDeCampos(publicacao.redirect, ["urlDestino"]) ||
    urlHttpsDeCampos(publicacao.cta, ["urlDestino"]);
}

function appIdInstagram() {
  return texto(process.env.INSTAGRAM_APP_ID);
}

function appSecretInstagram() {
  return texto(process.env.INSTAGRAM_APP_SECRET);
}

function appSecretMeta() {
  return texto(process.env.META_APP_SECRET);
}

function redirectUriInstagram(valor = "") {
  return texto(valor || process.env.INSTAGRAM_REDIRECT_URI);
}

function segredoStateInstagram() {
  return texto(process.env.INSTAGRAM_OAUTH_STATE_SECRET || appSecretInstagram() || "social-instagram-state-local");
}

function criarInstagramPadrao(clienteId = "admin") {
  return {
    clienteId,
    status: "desconectado",
    conectado: false,
    instagramUserId: "",
    username: "",
    accountType: "",
    profilePictureUrl: "",
    token: {
      accessToken: "",
      tokenType: "bearer",
      expiresAt: "",
      recebidoEm: ""
    },
    scopes: [],
    webhookContaAssinada: false,
    webhookCampos: [],
    webhookAssinadoEm: "",
    webhookErro: null,
    webhookVerificadoEm: "",
    oauthStates: {},
    atualizadoEm: agoraIso()
  };
}

function calcularExpiresAt(expiresIn) {
  const segundos = Number(expiresIn || 0);
  if (!Number.isFinite(segundos) || segundos <= 0) return "";
  return new Date(Date.now() + segundos * 1000).toISOString();
}

function base64UrlJson(dados = {}) {
  return Buffer.from(JSON.stringify(dados)).toString("base64url");
}

function assinarState(payload = "") {
  return crypto
    .createHmac("sha256", segredoStateInstagram())
    .update(payload)
    .digest("base64url");
}

function gerarStateInstagram(clienteId = "admin") {
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = base64UrlJson({
    clienteId: texto(clienteId || "admin"),
    nonce,
    exp: Date.now() + STATE_TTL_MS
  });
  return {
    nonce,
    state: `${payload}.${assinarState(payload)}`
  };
}

function decodificarStateInstagram(state = "") {
  const [payload, assinatura] = texto(state).split(".");
  if (!payload || !assinatura) throw new Error("state_invalido");

  const esperada = assinarState(payload);
  const recebidaBuffer = Buffer.from(assinatura);
  const esperadaBuffer = Buffer.from(esperada);
  if (
    recebidaBuffer.length !== esperadaBuffer.length ||
    !crypto.timingSafeEqual(recebidaBuffer, esperadaBuffer)
  ) {
    throw new Error("state_invalido");
  }

  let dados;
  try {
    dados = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("state_invalido");
  }
  if (!dados?.clienteId || !dados?.nonce) throw new Error("state_invalido");
  if (Number(dados.exp || 0) < Date.now()) throw new Error("state_expirado");

  return {
    clienteId: texto(dados.clienteId),
    nonce: texto(dados.nonce),
    exp: Number(dados.exp || 0)
  };
}

function lerConexaoInstagram(clienteId = "admin") {
  const padrao = criarInstagramPadrao(clienteId);
  const dados = readClienteJson(clienteId, ARQUIVO_INSTAGRAM, padrao);
  const token = dados.token && typeof dados.token === "object" ? dados.token : {};
  const accessToken = texto(token.accessToken || dados.accessToken);

  return {
    ...padrao,
    ...(dados && typeof dados === "object" ? dados : {}),
    clienteId,
    status: accessToken
      ? (texto(dados.status) && texto(dados.status) !== "desconectado" ? texto(dados.status) : "conectado")
      : "desconectado",
    conectado: Boolean(accessToken),
    instagramUserId: texto(dados.instagramUserId || dados.userId || dados.id),
    username: texto(dados.username),
    accountType: texto(dados.accountType || dados.account_type),
    profilePictureUrl: texto(dados.profilePictureUrl || dados.profile_picture_url),
    token: {
      ...padrao.token,
      ...token,
      accessToken
    },
    scopes: lista(dados.scopes).map(texto).filter(Boolean),
    webhookContaAssinada: dados.webhookContaAssinada === true,
    webhookCampos: lista(dados.webhookCampos).map(texto).filter(Boolean),
    webhookAssinadoEm: texto(dados.webhookAssinadoEm),
    webhookErro: dados.webhookErro && typeof dados.webhookErro === "object" ? dados.webhookErro : null,
    webhookVerificadoEm: texto(dados.webhookVerificadoEm),
    oauthStates: dados.oauthStates && typeof dados.oauthStates === "object" ? dados.oauthStates : {},
    atualizadoEm: texto(dados.atualizadoEm || agoraIso())
  };
}

function salvarConexaoInstagram(clienteId = "admin", dados = {}) {
  const atualizada = {
    ...criarInstagramPadrao(clienteId),
    ...(dados && typeof dados === "object" ? dados : {}),
    clienteId,
    atualizadoEm: agoraIso()
  };

  writeClienteJson(clienteId, ARQUIVO_INSTAGRAM, atualizada);
  return lerConexaoInstagram(clienteId);
}

function sanitizarConexaoInstagram(conexao = {}) {
  return {
    conectado: conexao.conectado === true,
    status: texto(conexao.status || (conexao.conectado ? "conectado" : "desconectado")),
    instagramUserId: texto(conexao.instagramUserId),
    username: texto(conexao.username),
    accountType: texto(conexao.accountType),
    profilePictureUrl: texto(conexao.profilePictureUrl),
    tokenPresente: Boolean(texto(conexao.token?.accessToken)),
    expiresAt: texto(conexao.token?.expiresAt),
    scopes: lista(conexao.scopes).map(texto).filter(Boolean),
    webhookContaAssinada: conexao.webhookContaAssinada === true,
    webhookCampos: lista(conexao.webhookCampos).map(texto).filter(Boolean),
    webhookAssinadoEm: texto(conexao.webhookAssinadoEm),
    webhookErro: conexao.webhookErro && typeof conexao.webhookErro === "object" ? conexao.webhookErro : null,
    webhookVerificadoEm: texto(conexao.webhookVerificadoEm)
  };
}

function sanitizarErroInstagram(erro) {
  const metaErro = erro?.response?.data?.error || erro?.response?.data || {};
  const mensagemOperacional = texto(erro?.message);
  const mensagem = mensagemOperacional.startsWith("reels_")
    ? mensagemOperacional
    : texto(metaErro.message || erro?.message || "instagram_publicacao_erro");
  return {
    code: metaErro.code ?? "",
    type: texto(metaErro.type),
    message: mensagem.slice(0, 220)
  };
}

function codigoErroInstagram(erro) {
  const metaErro = erro?.response?.data?.error || erro?.response?.data || {};
  return metaErro.code ?? metaErro.error_code ?? erro?.code ?? "";
}

function tipoErroInstagram(erro) {
  const metaErro = erro?.response?.data?.error || erro?.response?.data || {};
  return texto(metaErro.type || erro?.type);
}

function endpointComentarioInstagram(commentId = "") {
  return `${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(texto(commentId))}`;
}

function sanitizarErroWebhookInstagram(erro) {
  const metaErro = erro?.response?.data?.error || erro?.response?.data || {};
  const mensagem = texto(metaErro.message || erro?.message || "instagram_webhook_conta_erro");
  return {
    statusCode: erro?.response?.status || "",
    code: metaErro.code ?? "",
    type: texto(metaErro.type),
    message: mensagem.slice(0, 220)
  };
}

function normalizarCamposWebhookInstagram(valor = []) {
  if (Array.isArray(valor)) {
    return valor
      .flatMap(item => normalizarCamposWebhookInstagram(item))
      .map(texto)
      .filter(Boolean);
  }

  if (valor && typeof valor === "object") {
    return [
      ...normalizarCamposWebhookInstagram(valor.subscribed_fields),
      ...normalizarCamposWebhookInstagram(valor.fields),
      ...normalizarCamposWebhookInstagram(valor.field)
    ];
  }

  return texto(valor)
    .split(",")
    .map(item => texto(item))
    .filter(Boolean);
}

function camposWebhookContaConfirmados(campos = []) {
  const atuais = new Set(normalizarCamposWebhookInstagram(campos));
  return WEBHOOK_CAMPOS_CONTA.every(campo => atuais.has(campo));
}

function publicacaoSanitizada(publicacao = {}) {
  const formato = texto(publicacao.formato || publicacao.formatoPublicacao || "feed").toLowerCase();
  return {
    id: texto(publicacao.id),
    rede: texto(publicacao.rede || "instagram"),
    origem: texto(publicacao.origem || "manual"),
    tipoPublicacao: texto(publicacao.tipoPublicacao || (texto(publicacao.ofertaId) ? "oferta" : "livre")),
    formato: ["feed", "reels"].includes(formato) ? formato : "feed",
    ofertaId: texto(publicacao.ofertaId),
    templateId: texto(publicacao.templateId),
    agendamentoId: texto(publicacao.agendamentoId),
    idempotencyKey: texto(publicacao.idempotencyKey),
    instagramUserId: texto(publicacao.instagramUserId),
    imagemUrl: texto(publicacao.imagemUrl),
    imagemOriginalUrl: texto(publicacao.imagemOriginalUrl),
    imagemPublicadaUrl: texto(publicacao.imagemPublicadaUrl),
    videoUrl: texto(publicacao.videoUrl),
    mediaUrl: texto(publicacao.mediaUrl),
    videoMimeType: texto(publicacao.videoMimeType),
    renderizado: publicacao.renderizado === true,
    renderHash: texto(publicacao.renderHash),
    templateVersao: publicacao.templateVersao ?? null,
    legenda: texto(publicacao.legenda),
    linkAfiliadoPresente: Boolean(texto(publicacao.linkAfiliado)),
    urlDestino: urlDestinoConversaoPublicacao(publicacao),
    mensagemPrivadaPresente: Boolean(texto(publicacao.mensagemPrivada)),
    redirectPresente: Boolean(publicacao.redirect && typeof publicacao.redirect === "object"),
    ctaPresente: Boolean(publicacao.cta && typeof publicacao.cta === "object"),
    status: texto(publicacao.status),
    instagramContainerId: texto(publicacao.instagramContainerId),
    instagramMediaId: texto(publicacao.instagramMediaId),
    criadoEm: texto(publicacao.criadoEm),
    publicadoEm: texto(publicacao.publicadoEm),
    erro: publicacao.erro && typeof publicacao.erro === "object" ? publicacao.erro : null,
    respostaPublica: texto(publicacao.respostaPublica),
    gatilho: publicacao.gatilho && typeof publicacao.gatilho === "object"
      ? sanitizarGatilhoInstagram(publicacao.gatilho, { corrigirCta: true })
      : null
  };
}

function gatilhoPadraoInstagram() {
  return {
    ativo: true,
    palavra: "EU QUERO",
    ctaPublico: "Comente EU QUERO para receber o link e o cupom no Direct.",
    respostaPublica: "Pronto! Enviei os detalhes no seu Direct 🚀",
    textoDirect: "Olá! Aqui está a oferta que você pediu:",
    textoFinal: "",
    grupoUrl: "",
    grupoTexto: ""
  };
}

function gatilhoInativoInstagram() {
  return {
    ativo: false,
    palavra: "",
    ctaPublico: "",
    respostaPublica: "",
    textoDirect: "",
    textoFinal: "",
    grupoUrl: "",
    grupoTexto: ""
  };
}

function ctaPublicoPadraoInstagram(palavra = "") {
  const palavraSegura = limitarTexto(palavra, 40).toUpperCase();
  return palavraSegura
    ? `Comente ${palavraSegura} para receber o link e o cupom no Direct.`
    : "";
}

function validarCtaGatilhoInstagram({ ativo = false, palavra = "", ctaPublico = "" } = {}) {
  if (!ativo || !texto(ctaPublico)) return;
  if (!contemGatilhoSeguro(ctaPublico, palavra)) {
    throw new Error("instagram_gatilho_cta_incoerente");
  }
}

function sanitizarGatilhoInstagram(gatilho = null, opcoes = {}) {
  const padrao = gatilhoPadraoInstagram();
  const entrada = gatilho && typeof gatilho === "object" ? gatilho : null;
  if (!entrada) return gatilhoInativoInstagram();

  const palavraEntrada = texto(entrada.palavra || entrada.keyword);
  const palavra = limitarTexto(palavraEntrada || padrao.palavra, 40).toUpperCase();
  const ativo = entrada.ativo !== false;
  let ctaPublico = limitarTexto(entrada.ctaPublico || ctaPublicoPadraoInstagram(palavra), 220);

  try {
    validarCtaGatilhoInstagram({ ativo, palavra, ctaPublico });
  } catch (e) {
    if (!opcoes.corrigirCta) throw e;
    ctaPublico = ctaPublicoPadraoInstagram(palavra);
  }

  return {
    ativo,
    palavra,
    ctaPublico,
    respostaPublica: limitarTexto(entrada.respostaPublica || padrao.respostaPublica, 220),
    textoDirect: limitarTexto(entrada.textoDirect || entrada.mensagemDirect || entrada.mensagemPrivada || padrao.textoDirect, 300),
    textoFinal: limitarTexto(entrada.textoFinal || "", 300),
    grupoUrl: urlHttps(entrada.grupoUrl || ""),
    grupoTexto: limitarTexto(entrada.grupoTexto || "", 180)
  };
}

function interacaoSanitizada(interacao = {}) {
  return {
    id: texto(interacao.id),
    instagramUserId: texto(interacao.instagramUserId),
    instagramMediaId: texto(interacao.instagramMediaId),
    instagramCommentId: texto(interacao.instagramCommentId),
    ofertaId: texto(interacao.ofertaId),
    publicacaoId: texto(interacao.publicacaoId),
    username: limitarTexto(interacao.username, 80),
    textoComentario: limitarTexto(interacao.textoComentario, 300),
    palavraGatilho: texto(interacao.palavraGatilho),
    status: texto(interacao.statusGeral || interacao.status),
    statusGeral: texto(interacao.statusGeral || interacao.status),
    respostaPublicaStatus: texto(interacao.respostaPublicaStatus),
    respostaPublicaEnviadaEm: texto(interacao.respostaPublicaEnviadaEm),
    privateReplyStatus: texto(interacao.privateReplyStatus || interacao.directStatus),
    privateReplyEnviadoEm: texto(interacao.privateReplyEnviadoEm),
    criadoEm: texto(interacao.criadoEm),
    respondidoEm: texto(interacao.respondidoEm),
    erro: interacao.erro && typeof interacao.erro === "object" ? interacao.erro : null
  };
}

function listarInteracoesInstagram(clienteId = "admin", limite = 100) {
  const max = Math.max(1, Math.min(200, Number(limite || 100) || 100));
  return lista(readClienteJson(clienteId, ARQUIVO_INTERACOES, []))
    .slice(-max)
    .reverse()
    .map(interacaoSanitizada);
}

function getInteracaoInstagram(clienteId = "admin", id = "") {
  const interacao = lista(readClienteJson(clienteId, ARQUIVO_INTERACOES, []))
    .find(item => texto(item?.id) === texto(id));
  return interacao ? interacaoSanitizada(interacao) : null;
}

function salvarInteracaoInstagram(clienteId = "admin", interacao = {}) {
  const atuais = lista(readClienteJson(clienteId, ARQUIVO_INTERACOES, []));
  const item = {
    ...interacao,
    clienteId,
    atualizadoEm: agoraIso()
  };
  const interacoes = [
    ...atuais.filter(atual => texto(atual?.id) !== texto(item.id)),
    item
  ].slice(-1000);
  writeClienteJson(clienteId, ARQUIVO_INTERACOES, interacoes);
  return item;
}

function encontrarInteracaoPorComentario(clienteId = "admin", instagramCommentId = "") {
  return lista(readClienteJson(clienteId, ARQUIVO_INTERACOES, []))
    .find(item => texto(item?.instagramCommentId) === texto(instagramCommentId));
}

function listarPublicacoesInstagram(clienteId = "admin", limite = 100) {
  const max = Math.max(1, Math.min(200, Number(limite || 100) || 100));
  return lista(readClienteJson(clienteId, ARQUIVO_PUBLICACOES, []))
    .filter(item => texto(item?.rede || "instagram") === "instagram")
    .slice(-max)
    .reverse()
    .map(publicacaoSanitizada);
}

function getPublicacaoInstagram(clienteId = "admin", id = "") {
  const publicacao = lista(readClienteJson(clienteId, ARQUIVO_PUBLICACOES, []))
    .find(item => texto(item?.id) === texto(id) && texto(item?.rede || "instagram") === "instagram");
  return publicacao ? publicacaoSanitizada(publicacao) : null;
}

function salvarPublicacaoInstagram(clienteId = "admin", publicacao = {}) {
  const atuais = lista(readClienteJson(clienteId, ARQUIVO_PUBLICACOES, []));
  const item = {
    ...publicacao,
    clienteId,
    rede: "instagram",
    atualizadoEm: agoraIso()
  };
  const publicacoes = [
    ...atuais.filter(atual => texto(atual?.id) !== texto(item.id)),
    item
  ].slice(-500);
  writeClienteJson(clienteId, ARQUIVO_PUBLICACOES, publicacoes);
  return item;
}

function encontrarPublicacaoDuplicada(clienteId = "admin", ofertaId = "", templateId = "", formato = "feed") {
  const agora = Date.now();
  const formatoSeguro = ["feed", "reels"].includes(texto(formato).toLowerCase()) ? texto(formato).toLowerCase() : "feed";
  return lista(readClienteJson(clienteId, ARQUIVO_PUBLICACOES, []))
    .find(item => {
      if (texto(item?.rede || "instagram") !== "instagram") return false;
      if (texto(item?.ofertaId) !== texto(ofertaId)) return false;
      if (texto(item?.templateId) !== texto(templateId)) return false;
      const formatoItem = texto(item?.formato || item?.formatoPublicacao || "feed").toLowerCase();
      if ((["feed", "reels"].includes(formatoItem) ? formatoItem : "feed") !== formatoSeguro) return false;

      const status = texto(item?.status);
      if (status === "publicada") return true;
      if (!["publicando", "processando"].includes(status)) return false;

      const atualizadoMs = Date.parse(texto(item?.atualizadoEm || item?.criadoEm));
      return Number.isFinite(atualizadoMs) && agora - atualizadoMs <= PUBLICACAO_EM_ANDAMENTO_TTL_MS;
    });
}

function encontrarPublicacaoPorIdempotency(clienteId = "admin", idempotencyKey = "") {
  const chave = texto(idempotencyKey);
  if (!chave) return null;

  return lista(readClienteJson(clienteId, ARQUIVO_PUBLICACOES, []))
    .find(item => texto(item?.rede || "instagram") === "instagram" && texto(item?.idempotencyKey) === chave);
}

function normalizarChave(valor = "") {
  return texto(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function idsOferta(item = {}) {
  const idBase = texto(item.id || item.ofertaId || item.ofertaUniversalId || item.produtoId || item.productId || item.sku);
  const linkOriginal = texto(item.linkOriginal || item.urlOriginal || item.url || item.link);
  const linkAfiliado = texto(item.linkAfiliado || item.linkFinal || item.link);
  const titulo = texto(item.titulo || item.nome);
  const marketplace = texto(item.marketplace);
  const ids = [
    idBase,
    texto(item.ofertaId),
    texto(item.ofertaUniversalId),
    texto(item.engineOfertaId),
    texto(item.engineOfertaUuid),
    texto(item.produtoId || item.productId || item.sku)
  ].filter(Boolean);
  const chave =
    texto(item.produtoId || item.productId || item.sku) ||
    normalizarChave(linkOriginal) ||
    normalizarChave(linkAfiliado) ||
    `${normalizarChave(titulo)}|${normalizarChave(marketplace)}`;
  const socialId = `social_${normalizarChave(idBase || chave).replace(/[^a-z0-9_-]/g, "_").slice(0, 80)}`;
  return new Set([...ids, socialId].filter(Boolean));
}

function carregarOfertaCliente(clienteId = "admin", ofertaId = "") {
  const alvo = texto(ofertaId);
  if (!alvo) throw new Error("oferta_id_obrigatorio");

  const clienteSeguro = texto(clienteId || "admin");
  const ofertas = lista(readClienteJson(clienteSeguro, "fila.json", []))
    .filter(item => !texto(item?.clienteId) || texto(item?.clienteId) === clienteSeguro);
  const oferta = ofertas.find(item => idsOferta(item).has(alvo));
  if (!oferta) throw new Error("oferta_nao_encontrada");

  const v2 = oferta.inteligenciaUniversalV2 || {};
  const imagem = texto(oferta.imagem || oferta.image || oferta.thumbnail);
  const videoUrl = texto(oferta.videoUrl || oferta.video_url || oferta.mediaUrl || oferta.midiaUrl || oferta.video);
  const videoMimeType = texto(oferta.videoMimeType || oferta.midiaMimeType || oferta.mediaMimeType || oferta.mimeType);
  const linkAfiliado = texto(oferta.linkAfiliado || oferta.linkFinal || oferta.link);
  const titulo = texto(oferta.titulo || oferta.nome);
  const marketplace = texto(oferta.marketplace);
  const precoAtual = numero(v2.valorEfetivo ?? oferta.valorEfetivo ?? oferta.precoAtual ?? oferta.preco);

  return {
    id: alvo,
    fonteId: texto(oferta.id || oferta.ofertaId || oferta.ofertaUniversalId),
    clienteId,
    titulo,
    marketplace,
    imagem,
    linkAfiliado,
    precoAtual,
    precoOriginal: numero(oferta.precoOriginal ?? oferta.precoAntigo ?? oferta.precoDe),
    desconto: texto(oferta.desconto || oferta.percentualDesconto || oferta.descontoPercentual),
    cupom: texto(oferta.cupom || oferta.cupomCodigo || oferta.cupomInfo?.cupom),
    categoria: texto(v2.categoria || oferta.categoria),
    videoUrl,
    videoMimeType
  };
}

function ofertaDaPublicacaoLivre(publicacao = {}) {
  const linkAfiliado = linkFinalPublicacaoLivre(publicacao);
  const primeiraLinhaLegenda = limitarTexto(texto(publicacao.legenda).split(/\r?\n/)[0], 120);
  return {
    id: texto(publicacao.id),
    fonteId: texto(publicacao.id),
    clienteId: texto(publicacao.clienteId),
    titulo: primeiraLinhaLegenda || "Publicacao personalizada",
    marketplace: "instagram",
    imagem: texto(publicacao.imagemPublicadaUrl || publicacao.imagemUrl),
    linkAfiliado,
    precoAtual: null,
    precoOriginal: null,
    desconto: "",
    cupom: "",
    categoria: "social"
  };
}

function moeda(valor) {
  const n = numero(valor);
  if (n === null) return "";
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

function montarLegendaInstagram(oferta = {}, templateId = "padrao-instagram", gatilho = null) {
  const linhas = [];
  linhas.push(oferta.titulo);
  if (oferta.precoAtual !== null) linhas.push(`Por: ${moeda(oferta.precoAtual)}`);
  if (oferta.precoOriginal !== null && oferta.precoOriginal > oferta.precoAtual) {
    linhas.push(`De: ${moeda(oferta.precoOriginal)}`);
  }
  if (oferta.desconto) linhas.push(`Desconto: ${oferta.desconto}`);
  if (oferta.cupom) linhas.push(`Cupom: ${oferta.cupom}`);
  if (gatilho?.ativo && gatilho.ctaPublico) {
    linhas.push("");
    linhas.push(gatilho.ctaPublico);
  } else {
    linhas.push("Confira pelo link oficial da oferta.");
  }
  if (oferta.marketplace) linhas.push(`#${normalizarChave(oferta.marketplace).replace(/[^a-z0-9]/g, "")}`);
  linhas.push("#promocao #oferta");

  return {
    templateId,
    legenda: linhas.filter(Boolean).join("\n")
  };
}

function validarImagemPublica(url = "") {
  const valor = texto(url);
  if (!valor) throw new Error("imagem_ausente");
  let parsed;
  try {
    parsed = new URL(valor);
  } catch {
    throw new Error("imagem_nao_publica");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("imagem_nao_publica");
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error("imagem_nao_publica");
  }
  return valor;
}

function validarUrlPublicaSocial(url = "", { erroAusente = "url_ausente", erroInvalida = "url_nao_publica" } = {}) {
  const valor = texto(url);
  if (!valor) throw new Error(erroAusente);
  let parsed;
  try {
    parsed = new URL(valor);
  } catch {
    throw new Error(erroInvalida);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(erroInvalida);
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error(erroInvalida);
  }
  return valor;
}

function validarVideoReelsPublico(url = "", metadados = {}) {
  const valor = validarUrlPublicaSocial(url, {
    erroAusente: "reels_video_ausente",
    erroInvalida: "reels_video_invalido"
  });
  const mimeType = texto(
    metadados.mimeType ||
    metadados.videoMimeType ||
    metadados.videoMimeTypeOferta ||
    metadados.midiaMimeType ||
    metadados.mediaMimeType
  ).toLowerCase();
  if (mimeType && !mimeType.startsWith("video/")) throw new Error("reels_video_invalido");
  if (!mimeType) {
    try {
      const parsed = new URL(valor);
      const pathname = parsed.pathname.toLowerCase();
      if (pathname && !/\.(mp4|mov|m4v|webm)$/i.test(pathname)) throw new Error("reels_video_invalido");
    } catch (e) {
      if (e.message === "reels_video_invalido") throw e;
    }
  }
  return valor;
}

function removerStatesExpirados(states = {}) {
  const agora = Date.now();
  return Object.fromEntries(
    Object.entries(states || {}).filter(([, state]) => {
      const exp = Number(state?.exp || 0);
      return exp && exp >= agora;
    })
  );
}

function registrarStatePendente(clienteId = "admin", nonce = "", exp = 0) {
  const atual = lerConexaoInstagram(clienteId);
  const oauthStates = removerStatesExpirados(atual.oauthStates);
  oauthStates[nonce] = {
    status: "pendente",
    exp,
    criadoEm: agoraIso()
  };
  salvarConexaoInstagram(clienteId, {
    ...atual,
    oauthStates
  });
}

function consumirStatePendente(clienteId = "admin", nonce = "") {
  const atual = lerConexaoInstagram(clienteId);
  const oauthStates = removerStatesExpirados(atual.oauthStates);
  const state = oauthStates[nonce];
  if (!state) throw new Error("instagram_state_replay_ou_ausente");
  if (state.status !== "pendente") throw new Error("instagram_state_reutilizado");
  oauthStates[nonce] = {
    ...state,
    status: "usado",
    usadoEm: agoraIso()
  };
  salvarConexaoInstagram(clienteId, {
    ...atual,
    oauthStates
  });
}

function scopesInstagramConexao() {
  return [SCOPE_BASICO, SCOPE_PUBLICAR_CONTEUDO, SCOPE_GERENCIAR_COMENTARIOS, SCOPE_GERENCIAR_MENSAGENS];
}

function iniciarConexaoInstagram({ clienteId = "admin", redirectUri = "" } = {}) {
  const appId = appIdInstagram();
  const uri = redirectUriInstagram(redirectUri);
  if (!appId || !appSecretInstagram() || !uri) throw new Error("instagram_nao_configurado");

  const { nonce, state } = gerarStateInstagram(clienteId);
  const { exp } = decodificarStateInstagram(state);
  registrarStatePendente(clienteId, nonce, exp);

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: uri,
    response_type: "code",
    scope: scopesInstagramConexao().join(","),
    force_reauth: "true",
    state
  });

  return {
    ok: true,
    provider: "instagram",
    status: "oauth_iniciado",
    authUrl: `${INSTAGRAM_AUTH_URL}?${params.toString()}`,
    redirectUri: uri,
    state,
    scopes: scopesInstagramConexao()
  };
}

function normalizarToken(dados = {}) {
  return {
    accessToken: texto(dados.access_token),
    tokenType: texto(dados.token_type || "bearer"),
    expiresAt: calcularExpiresAt(dados.expires_in),
    recebidoEm: agoraIso()
  };
}

async function trocarCodePorTokenCurto({ code = "", redirectUri = "", httpClient = httpClientPadrao() } = {}) {
  const appId = appIdInstagram();
  const appSecret = appSecretInstagram();
  const uri = redirectUriInstagram(redirectUri);
  if (!appId || !appSecret || !uri) throw new Error("instagram_nao_configurado");
  if (!texto(code)) throw new Error("code_ausente");

  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: uri,
    code
  });
  try {
    const resposta = await httpClient.post(INSTAGRAM_TOKEN_URL, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000
    });
    const dados = resposta?.data || {};
    if (!dados.access_token) throw new Error("token_curto_nao_retornado");
    return dados;
  } catch {
    throw new Error("troca_token_falhou");
  }
}

async function trocarTokenLongaDuracao({ accessToken = "", httpClient = httpClientPadrao() } = {}) {
  const appSecret = appSecretInstagram();
  if (!appSecret) throw new Error("instagram_nao_configurado");
  if (!texto(accessToken)) throw new Error("troca_token_falhou");

  try {
    const resposta = await httpClient.get(`${INSTAGRAM_GRAPH_BASE}/access_token`, {
      params: {
        grant_type: "ig_exchange_token",
        client_secret: appSecret,
        access_token: accessToken
      },
      timeout: 10000
    });
    const dados = resposta?.data || {};
    if (!dados.access_token) throw new Error("token_longo_nao_retornado");
    return dados;
  } catch {
    throw new Error("troca_token_falhou");
  }
}

async function consultarContaInstagram({ accessToken = "", httpClient = httpClientPadrao() } = {}) {
  if (!texto(accessToken)) throw new Error("consulta_conta_falhou");

  try {
    const resposta = await httpClient.get(`${INSTAGRAM_GRAPH_BASE}/me`, {
      params: {
        fields: "user_id,username,account_type,profile_picture_url",
        access_token: accessToken
      },
      timeout: 10000
    });
    const dados = resposta?.data || {};
    const instagramUserId = texto(dados.user_id || dados.id);
    if (!instagramUserId) throw new Error("me_id_nao_retornado");

    return {
      instagramUserId,
      username: texto(dados.username),
      accountType: texto(dados.account_type),
      profilePictureUrl: texto(dados.profile_picture_url)
    };
  } catch {
    throw new Error("consulta_conta_falhou");
  }
}

async function consultarAssinaturasWebhookContaInstagram({ instagramUserId = "", accessToken = "", httpClient = httpClientPadrao() } = {}) {
  const igId = texto(instagramUserId);
  if (!igId || !texto(accessToken)) throw new Error("instagram_webhook_conta_nao_conectada");

  const resposta = await httpClient.get(`${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(igId)}/subscribed_apps`, {
    params: {
      access_token: accessToken
    },
    timeout: 10000
  });
  const dados = resposta?.data || {};
  const registros = Array.isArray(dados.data) ? dados.data : [dados];
  const campos = [...new Set(normalizarCamposWebhookInstagram(registros))];

  return {
    campos,
    confirmado: camposWebhookContaConfirmados(campos),
    brutoDisponivel: Boolean(resposta)
  };
}

async function inscreverContaWebhookInstagram({ clienteId = "admin", instagramUserId = "", accessToken = "", httpClient = httpClientPadrao() } = {}) {
  const igId = texto(instagramUserId);
  const token = texto(accessToken);
  if (!igId || !token) throw new Error("instagram_webhook_conta_nao_conectada");

  logSocial("[INSTAGRAM-WEBHOOK-CONTA-ASSINATURA-INICIO]", {
    clienteId,
    instagramUserId: igId,
    campos: WEBHOOK_CAMPOS_CONTA,
    status: "iniciando"
  });

  try {
    await httpClient.post(`${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(igId)}/subscribed_apps`, new URLSearchParams({
      subscribed_fields: WEBHOOK_CAMPOS_CONTA.join(","),
      access_token: token
    }).toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000
    });

    let diagnostico = {
      campos: [...WEBHOOK_CAMPOS_CONTA],
      confirmado: true,
      brutoDisponivel: false
    };

    try {
      diagnostico = await consultarAssinaturasWebhookContaInstagram({
        instagramUserId: igId,
        accessToken: token,
        httpClient
      });
    } catch (erroDiagnostico) {
      diagnostico = {
        campos: [...WEBHOOK_CAMPOS_CONTA],
        confirmado: true,
        brutoDisponivel: false,
        erro: sanitizarErroWebhookInstagram(erroDiagnostico)
      };
    }

    logSocial("[INSTAGRAM-WEBHOOK-CONTA-DIAGNOSTICO]", {
      clienteId,
      instagramUserId: igId,
      campos: diagnostico.campos,
      status: diagnostico.confirmado ? "confirmado" : "incompleto",
      statusCode: diagnostico.erro?.statusCode || "",
      erro: diagnostico.erro || null
    });

    if (!diagnostico.confirmado) {
      const erro = new Error("instagram_webhook_campos_nao_confirmados");
      erro.response = {
        status: "",
        data: {
          error: {
            message: "comments_messages_nao_confirmados",
            type: "WebhookSubscription",
            code: "campos_nao_confirmados"
          }
        }
      };
      throw erro;
    }

    const agora = agoraIso();
    const resultado = {
      webhookContaAssinada: true,
      webhookCampos: [...WEBHOOK_CAMPOS_CONTA],
      webhookAssinadoEm: agora,
      webhookErro: null,
      webhookVerificadoEm: diagnostico.brutoDisponivel ? agora : ""
    };

    logSocial("[INSTAGRAM-WEBHOOK-CONTA-ASSINADA]", {
      clienteId,
      instagramUserId: igId,
      campos: resultado.webhookCampos,
      status: "assinado",
      statusCode: ""
    });

    return resultado;
  } catch (erro) {
    const erroSanitizado = sanitizarErroWebhookInstagram(erro);
    logSocial("[INSTAGRAM-WEBHOOK-CONTA-ASSINATURA-ERRO]", {
      clienteId,
      instagramUserId: igId,
      campos: WEBHOOK_CAMPOS_CONTA,
      status: "erro",
      statusCode: erroSanitizado.statusCode,
      erro: erroSanitizado
    });

    return {
      webhookContaAssinada: false,
      webhookCampos: [],
      webhookAssinadoEm: "",
      webhookErro: erroSanitizado,
      webhookVerificadoEm: ""
    };
  }
}

async function criarContainerImagemInstagram({ instagramUserId = "", imagemUrl = "", legenda = "", accessToken = "", httpClient = httpClientPadrao() } = {}) {
  const igId = texto(instagramUserId);
  if (!igId || !texto(accessToken)) throw new Error("instagram_nao_conectado");

  const resposta = await httpClient.post(`${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(igId)}/media`, new URLSearchParams({
    image_url: imagemUrl,
    caption: legenda,
    access_token: accessToken
  }).toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000
  });
  const id = texto(resposta?.data?.id);
  if (!id) throw new Error("instagram_container_nao_retornado");
  return id;
}

async function criarContainerReelInstagram({ instagramUserId = "", videoUrl = "", legenda = "", accessToken = "", httpClient = httpClientPadrao() } = {}) {
  const igId = texto(instagramUserId);
  if (!igId || !texto(accessToken)) throw new Error("instagram_nao_conectado");

  const resposta = await httpClient.post(`${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(igId)}/media`, new URLSearchParams({
    media_type: "REELS",
    video_url: videoUrl,
    caption: legenda,
    access_token: accessToken
  }).toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000
  });
  const id = texto(resposta?.data?.id);
  if (!id) throw new Error("instagram_container_nao_retornado");
  return id;
}

async function publicarContainerInstagram({ instagramUserId = "", containerId = "", accessToken = "", httpClient = httpClientPadrao() } = {}) {
  const igId = texto(instagramUserId);
  const creationId = texto(containerId);
  if (!igId || !creationId || !texto(accessToken)) throw new Error("instagram_nao_conectado");

  const resposta = await httpClient.post(`${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(igId)}/media_publish`, new URLSearchParams({
    creation_id: creationId,
    access_token: accessToken
  }).toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000
  });
  const id = texto(resposta?.data?.id);
  if (!id) throw new Error("instagram_media_nao_retornada");
  return id;
}

function aguardar(ms = 0) {
  const tempo = Math.max(0, Number(ms) || 0);
  if (!tempo) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, tempo));
}

async function consultarStatusContainerInstagram({ containerId = "", accessToken = "", httpClient = httpClientPadrao() } = {}) {
  const id = texto(containerId);
  if (!id || !texto(accessToken)) throw new Error("instagram_nao_conectado");

  const resposta = await httpClient.get(`${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(id)}`, {
    params: {
      fields: "status_code,status",
      access_token: accessToken
    },
    timeout: 10000
  });
  const dados = resposta?.data || {};
  return {
    statusCode: texto(dados.status_code).toUpperCase(),
    status: texto(dados.status)
  };
}

function sanitizarErroDiagnosticoInstagram(erro) {
  const metaErro = erro?.response?.data?.error || erro?.response?.data || {};
  const mensagem = texto(metaErro.message || erro?.message || "instagram_diagnostico_erro");
  return {
    statusCode: erro?.response?.status || "",
    code: metaErro.code ?? "",
    subcode: metaErro.error_subcode ?? metaErro.subcode ?? "",
    type: texto(metaErro.type),
    message: mensagem.slice(0, 220)
  };
}

async function consultarGraphDiagnosticoInstagram({ url = "", params = {}, httpClient = httpClientPadrao() } = {}) {
  try {
    const resposta = await httpClient.get(url, {
      params,
      timeout: 10000
    });
    return {
      ok: true,
      statusCode: resposta?.status || resposta?.statusCode || 200,
      data: resposta?.data || {},
      erro: null
    };
  } catch (erro) {
    const erroSanitizado = sanitizarErroDiagnosticoInstagram(erro);
    return {
      ok: false,
      statusCode: erroSanitizado.statusCode || 0,
      data: {},
      erro: erroSanitizado
    };
  }
}

function sanitizarComentarioDiagnosticoInstagram(comentario = {}) {
  return {
    id: texto(comentario.id),
    usernameParcial: usernameParcialDiagnostico(comentario.username),
    textoNormalizadoParcial: textoParcialDiagnostico(normalizarTextoComparacao(comentario.text), 32),
    timestamp: texto(comentario.timestamp)
  };
}

function extrairCamposAssinaturaDiagnosticoInstagram(dados = {}) {
  const registros = Array.isArray(dados.data) ? dados.data : [];
  return [...new Set(normalizarCamposWebhookInstagram(registros))];
}

async function diagnosticarComentariosPublicacaoInstagram({ clienteId = "admin", publicacaoId = "", httpClient = httpClientPadrao() } = {}) {
  const clienteSeguro = texto(clienteId || "admin") || "admin";
  const idPublicacao = texto(publicacaoId);
  if (!idPublicacao) throw new Error("publicacao_id_obrigatorio");

  logSocial("[INSTAGRAM-DIAGNOSTICO-COMENTARIOS-INICIO]", {
    clienteId: clienteSeguro,
    publicacaoId: idPublicacao
  });

  try {
    const publicacao = lista(readClienteJson(clienteSeguro, ARQUIVO_PUBLICACOES, []))
      .find(item => texto(item?.id) === idPublicacao && texto(item?.rede || "instagram") === "instagram");
    if (!publicacao) throw new Error("publicacao_nao_encontrada");

    const conexao = lerConexaoInstagram(clienteSeguro);
    const instagramMediaId = texto(publicacao.instagramMediaId);
    const instagramUserId = texto(conexao.instagramUserId || publicacao.instagramUserId);
    const accessToken = texto(conexao.token?.accessToken);
    if (!instagramMediaId) throw new Error("instagram_media_id_ausente");
    if (!instagramUserId || !accessToken) throw new Error("instagram_nao_conectado");

    const comentarios = await consultarGraphDiagnosticoInstagram({
      url: `${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(instagramMediaId)}/comments`,
      params: {
        fields: "id,text,username,timestamp",
        access_token: accessToken
      },
      httpClient
    });

    const assinatura = await consultarGraphDiagnosticoInstagram({
      url: `${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(instagramUserId)}/subscribed_apps`,
      params: {
        access_token: accessToken
      },
      httpClient
    });

    const comentariosLista = Array.isArray(comentarios.data?.data) ? comentarios.data.data : [];
    const amostraComentarios = comentariosLista
      .slice(0, 10)
      .map(sanitizarComentarioDiagnosticoInstagram);
    const comentarioEncontrado = amostraComentarios
      .some(item => contemGatilhoSeguro(item.textoNormalizadoParcial, "promo"));
    const webhookCampos = assinatura.ok ? extrairCamposAssinaturaDiagnosticoInstagram(assinatura.data) : [];
    const webhookContaAssinada = webhookCampos.includes("comments") && webhookCampos.includes("messages");
    const erroSanitizado = comentarios.erro || assinatura.erro || null;

    const resultado = {
      ok: comentarios.ok && assinatura.ok,
      clienteId: clienteSeguro,
      publicacaoId: idPublicacao,
      instagramMediaId,
      comentarioEncontrado,
      totalComentarios: comentariosLista.length,
      amostraComentarios,
      webhookContaAssinada,
      webhookCampos,
      statusCodeComentarios: comentarios.statusCode,
      statusCodeAssinatura: assinatura.statusCode,
      erroSanitizado
    };

    logSocial("[INSTAGRAM-DIAGNOSTICO-COMENTARIOS-RESULTADO]", {
      clienteId: clienteSeguro,
      publicacaoId: idPublicacao,
      instagramMediaId,
      comentarioEncontrado,
      totalComentarios: resultado.totalComentarios,
      webhookContaAssinada,
      statusCodeComentarios: resultado.statusCodeComentarios,
      statusCodeAssinatura: resultado.statusCodeAssinatura,
      erroSanitizado
    });

    return resultado;
  } catch (erro) {
    const erroSanitizado = sanitizarErroDiagnosticoInstagram(erro);
    logSocial("[INSTAGRAM-DIAGNOSTICO-COMENTARIOS-ERRO]", {
      clienteId: clienteSeguro,
      publicacaoId: idPublicacao,
      erro: erroSanitizado
    });
    throw erro;
  }
}

async function aguardarContainerProntoInstagram({
  containerId = "",
  accessToken = "",
  httpClient = httpClientPadrao(),
  polling = {}
} = {}) {
  const primeiraEsperaMs = Math.max(0, Number(polling.primeiraEsperaMs ?? CONTAINER_STATUS_PRIMEIRA_ESPERA_MS) || 0);
  const intervaloMs = Math.max(0, Number(polling.intervaloMs ?? CONTAINER_STATUS_INTERVALO_MS) || 0);
  const maxTentativas = Math.max(1, Math.min(20, Number(polling.maxTentativas ?? CONTAINER_STATUS_MAX_TENTATIVAS) || CONTAINER_STATUS_MAX_TENTATIVAS));

  await aguardar(primeiraEsperaMs);

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa += 1) {
    const status = await consultarStatusContainerInstagram({ containerId, accessToken, httpClient });
    logSocial("[INSTAGRAM-CONTAINER-STATUS]", {
      containerId,
      tentativa,
      statusCode: status.statusCode,
      status: status.status
    });

    if (status.statusCode === "FINISHED") {
      logSocial("[INSTAGRAM-CONTAINER-PRONTO]", { containerId, tentativa });
      return status;
    }
    if (status.statusCode === "ERROR") {
      const erro = new Error(status.status || "container_processamento_erro");
      erro.instagramStatusCode = "ERROR";
      throw erro;
    }
    if (status.statusCode === "EXPIRED") {
      throw new Error("container_expirado");
    }

    if (tentativa < maxTentativas) await aguardar(intervaloMs);
  }

  logSocial("[INSTAGRAM-CONTAINER-TIMEOUT]", { containerId, tentativas: maxTentativas });
  throw new Error("processamento_midia_timeout");
}

async function aguardarContainerReelProntoInstagram({
  containerId = "",
  accessToken = "",
  httpClient = httpClientPadrao(),
  polling = {}
} = {}) {
  const primeiraEsperaPadrao = numeroInteiroAmbiente(
    "INSTAGRAM_REELS_POLL_PRIMEIRA_ESPERA_MS",
    REELS_STATUS_PRIMEIRA_ESPERA_MS,
    { min: 0, max: 60000 }
  );
  const intervaloPadrao = numeroInteiroAmbiente(
    "INSTAGRAM_REELS_POLL_INTERVALO_MS",
    REELS_STATUS_INTERVALO_MS,
    { min: 0, max: 60000 }
  );
  const maxTentativasPadrao = numeroInteiroAmbiente(
    "INSTAGRAM_REELS_POLL_MAX_TENTATIVAS",
    REELS_STATUS_MAX_TENTATIVAS,
    { min: 1, max: REELS_STATUS_MAX_TENTATIVAS_LIMITE }
  );
  const primeiraEsperaMs = Math.max(0, Number(polling.primeiraEsperaMs ?? primeiraEsperaPadrao) || 0);
  const intervaloMs = Math.max(0, Number(polling.intervaloMs ?? intervaloPadrao) || 0);
  const maxTentativas = Math.max(
    1,
    Math.min(
      REELS_STATUS_MAX_TENTATIVAS_LIMITE,
      Number(polling.maxTentativas ?? maxTentativasPadrao) || maxTentativasPadrao
    )
  );

  await aguardar(primeiraEsperaMs);

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa += 1) {
    const status = await consultarStatusContainerInstagram({ containerId, accessToken, httpClient });
    logSocial("[INSTAGRAM-REELS-CONTAINER-STATUS]", {
      containerId,
      tentativa,
      statusCode: status.statusCode,
      status: status.status
    });

    if (status.statusCode === "FINISHED") {
      logSocial("[INSTAGRAM-REELS-CONTAINER-PRONTO]", { containerId, tentativa });
      return status;
    }
    if (status.statusCode === "ERROR") throw new Error("reels_container_erro");
    if (status.statusCode === "EXPIRED") throw new Error("reels_container_expirado");
    if (status.statusCode && status.statusCode !== "IN_PROGRESS") throw new Error("reels_container_estado_desconhecido");

    if (tentativa < maxTentativas) await aguardar(intervaloMs);
  }

  logSocial("[INSTAGRAM-REELS-CONTAINER-TIMEOUT]", { containerId, tentativas: maxTentativas });
  throw new Error("reels_processamento_timeout");
}

async function publicarImagemInstagram({
  clienteId = "admin",
  ofertaId = "",
  templateId = "padrao-instagram",
  gatilho = undefined,
  legenda = "",
  respostaPublica = "",
  origem = "manual",
  tipoPublicacao = "oferta",
  formato = "feed",
  agendamentoId = "",
  idempotencyKey = "",
  httpClient = httpClientPadrao(),
  polling = {},
  renderizadorArte = null
} = {}) {
  const tpl = texto(templateId || "padrao-instagram") || "padrao-instagram";
  const formatoSeguro = ["feed", "reels"].includes(texto(formato).toLowerCase()) ? texto(formato).toLowerCase() : "feed";
  const ofertaIdSeguro = texto(ofertaId);
  if (!ofertaIdSeguro) throw new Error("oferta_id_obrigatorio");

  const conexao = lerConexaoInstagram(clienteId);
  if (!conexao.conectado || !texto(conexao.token?.accessToken) || !texto(conexao.instagramUserId)) {
    throw new Error("instagram_nao_conectado");
  }

  if (conexao.token?.expiresAt && Date.parse(conexao.token.expiresAt) <= Date.now()) {
    throw new Error("instagram_token_expirado");
  }

  const duplicadaIdempotente = encontrarPublicacaoPorIdempotency(clienteId, idempotencyKey);
  if (duplicadaIdempotente) {
    return {
      duplicada: true,
      publicacao: publicacaoSanitizada(duplicadaIdempotente)
    };
  }

  const duplicada = encontrarPublicacaoDuplicada(clienteId, ofertaIdSeguro, tpl, formatoSeguro);
  if (duplicada) {
    return {
      duplicada: true,
      publicacao: publicacaoSanitizada(duplicada)
    };
  }

  const oferta = carregarOfertaCliente(clienteId, ofertaIdSeguro);
  if (!oferta.linkAfiliado) throw new Error("oferta_link_ausente");
  const imagemOriginalUrl = validarImagemPublica(oferta.imagem);
  const gatilhoSeguro = gatilho && typeof gatilho === "object" ? sanitizarGatilhoInstagram(gatilho) : null;
  const legendaMontada = montarLegendaInstagram(oferta, tpl, gatilhoSeguro).legenda;
  const legendaFinal = limitarTexto(legenda || legendaMontada, 2200);
  const id = criarId("igpub");
  let imagemUrl = imagemOriginalUrl;
  let publicacaoAtual = {
    id,
    origem: texto(origem || "manual"),
    tipoPublicacao: texto(tipoPublicacao || "oferta") || "oferta",
    formato: formatoSeguro,
    ofertaId: ofertaIdSeguro,
    templateId: tpl,
    agendamentoId: texto(agendamentoId),
    idempotencyKey: texto(idempotencyKey),
    instagramUserId: conexao.instagramUserId,
    imagemUrl,
    imagemOriginalUrl,
    imagemPublicadaUrl: "",
    renderizado: false,
    renderHash: "",
    templateVersao: null,
    legenda: legendaFinal,
    linkAfiliado: oferta.linkAfiliado,
    status: "publicando",
    instagramContainerId: "",
    instagramMediaId: "",
    gatilho: gatilhoSeguro,
    respostaPublica: limitarTexto(respostaPublica || gatilhoSeguro?.respostaPublica || "", 220),
    criadoEm: agoraIso(),
    tentativaEm: agoraIso(),
    publicadoEm: "",
    erro: null
  };

  publicacaoAtual = salvarPublicacaoInstagram(clienteId, publicacaoAtual);

  let instagramContainerId = "";
  try {
    if (typeof renderizadorArte === "function") {
      const arte = await renderizadorArte({
        clienteId,
        ofertaId: ofertaIdSeguro,
        oferta: {
          ...oferta,
          imagem: imagemOriginalUrl
        },
        templateId: tpl,
        gatilho: gatilhoSeguro
      });
      imagemUrl = validarImagemPublica(arte?.imagemUrlPublica || arte?.imagemUrl || arte?.url);
      publicacaoAtual = salvarPublicacaoInstagram(clienteId, {
        ...publicacaoAtual,
        imagemUrl,
        imagemOriginalUrl,
        imagemPublicadaUrl: imagemUrl,
        renderizado: true,
        renderHash: texto(arte?.hash),
        templateVersao: arte?.templateVersao ?? null,
        atualizadoEm: agoraIso()
      });
    }

    instagramContainerId = await criarContainerImagemInstagram({
      instagramUserId: conexao.instagramUserId,
      imagemUrl,
      legenda: legendaFinal,
      accessToken: conexao.token.accessToken,
      httpClient
    });
    logSocial("[INSTAGRAM-CONTAINER-CRIADO]", {
      clienteId,
      ofertaId: ofertaIdSeguro,
      publicacaoId: id,
      instagramContainerId
    });
    const comContainer = salvarPublicacaoInstagram(clienteId, {
      ...publicacaoAtual,
      status: "processando",
      instagramContainerId
    });
    await aguardarContainerProntoInstagram({
      containerId: instagramContainerId,
      accessToken: conexao.token.accessToken,
      httpClient,
      polling
    });
    const instagramMediaId = await publicarContainerInstagram({
      instagramUserId: conexao.instagramUserId,
      containerId: instagramContainerId,
      accessToken: conexao.token.accessToken,
      httpClient
    });
    const publicada = salvarPublicacaoInstagram(clienteId, {
      ...comContainer,
      status: "publicada",
      instagramMediaId,
      publicadoEm: agoraIso(),
      atualizadoEm: agoraIso(),
      erro: null
    });

    logSocial("[INSTAGRAM-PUBLICACAO-CONCLUIDA]", {
      clienteId,
      ofertaId: ofertaIdSeguro,
      publicacaoId: id,
      instagramUserId: conexao.instagramUserId,
      instagramMediaId
    });
    logSocial("[SOCIAL-INSTAGRAM-PUBLICACAO-OK]", {
      clienteId,
      ofertaId: ofertaIdSeguro,
      publicacaoId: id,
      instagramUserId: conexao.instagramUserId,
      instagramMediaId
    });

    return {
      duplicada: false,
      publicacao: publicacaoSanitizada(publicada)
    };
  } catch (e) {
    const erro = sanitizarErroInstagram(e);
    const falha = salvarPublicacaoInstagram(clienteId, {
      ...publicacaoAtual,
      instagramContainerId,
      status: "erro",
      erro
    });
    logSocial("[SOCIAL-INSTAGRAM-PUBLICACAO-ERRO]", {
      clienteId,
      ofertaId: ofertaIdSeguro,
      publicacaoId: id,
      erro
    });
    logSocial("[INSTAGRAM-PUBLICACAO-ERRO]", {
      clienteId,
      ofertaId: ofertaIdSeguro,
      publicacaoId: id,
      instagramContainerId,
      erro
    });
    return {
      duplicada: false,
      publicacao: publicacaoSanitizada(falha)
    };
  }
}

async function publicarReelInstagram({
  clienteId = "admin",
  ofertaId = "",
  videoUrl = "",
  mediaUrl = "",
  midiaUrl = "",
  mimeType = "",
  mediaMimeType = "",
  midiaMimeType = "",
  videoMimeType = "",
  templateId = "padrao-instagram",
  gatilho = undefined,
  legenda = "",
  respostaPublica = "",
  mensagemPrivada = "",
  direct = undefined,
  redirect = undefined,
  urlDestino = "",
  cta = undefined,
  linkAfiliado = "",
  origem = "manual",
  tipoPublicacao = "oferta",
  agendamentoId = "",
  idempotencyKey = "",
  httpClient = httpClientPadrao(),
  polling = {}
} = {}) {
  const tipoSeguro = texto(tipoPublicacao || "oferta") || "oferta";
  const tpl = texto(templateId || (tipoSeguro === "livre" ? "livre-instagram" : "padrao-instagram")) || "padrao-instagram";
  const ofertaIdSeguro = texto(ofertaId);

  const conexao = lerConexaoInstagram(clienteId);
  if (!conexao.conectado || !texto(conexao.token?.accessToken) || !texto(conexao.instagramUserId)) {
    throw new Error("instagram_nao_conectado");
  }

  if (conexao.token?.expiresAt && Date.parse(conexao.token.expiresAt) <= Date.now()) {
    throw new Error("instagram_token_expirado");
  }

  const duplicadaIdempotente = encontrarPublicacaoPorIdempotency(clienteId, idempotencyKey);
  if (duplicadaIdempotente) {
    return {
      duplicada: true,
      publicacao: publicacaoSanitizada(duplicadaIdempotente)
    };
  }

  let oferta = null;
  if (tipoSeguro !== "livre") {
    if (!ofertaIdSeguro) throw new Error("oferta_id_obrigatorio");
    const duplicada = encontrarPublicacaoDuplicada(clienteId, ofertaIdSeguro, tpl, "reels");
    if (duplicada) {
      return {
        duplicada: true,
        publicacao: publicacaoSanitizada(duplicada)
      };
    }
    oferta = carregarOfertaCliente(clienteId, ofertaIdSeguro);
    if (!oferta.linkAfiliado) throw new Error("oferta_link_ausente");
  }

  const videoCandidato = texto(videoUrl || mediaUrl || midiaUrl || oferta?.videoUrl);
  const videoPublico = validarVideoReelsPublico(videoCandidato, {
    mimeType,
    mediaMimeType,
    midiaMimeType,
    videoMimeType,
    videoMimeTypeOferta: oferta?.videoMimeType
  });
  const gatilhoEntrada = gatilho && typeof gatilho === "object"
    ? {
      ...gatilho,
      ...(mensagemPrivada && !texto(gatilho.textoDirect) ? { textoDirect: mensagemPrivada } : {})
    }
    : null;
  const gatilhoSeguro = gatilhoEntrada ? sanitizarGatilhoInstagram(gatilhoEntrada) : null;
  const legendaMontada = oferta ? montarLegendaInstagram(oferta, tpl, gatilhoSeguro).legenda : "";
  const legendaFinal = limitarTexto(legenda || legendaMontada, 2200);
  if (tipoSeguro === "livre" && !legendaFinal) throw new Error("legenda_obrigatoria");
  const destinoConversao = urlDestinoConversaoPublicacao({
    urlDestino,
    linkAfiliado: linkAfiliado || oferta?.linkAfiliado,
    redirect,
    cta,
    gatilho
  });
  const mensagemPrivadaFinal = limitarTexto(
    mensagemPrivada ||
    direct?.mensagem ||
    direct?.texto ||
    direct?.textoDirect ||
    gatilho?.mensagemPrivada ||
    gatilho?.mensagemDirect ||
    gatilho?.textoDirect ||
    "",
    300
  );
  const respostaPublicaFinal = limitarTexto(respostaPublica || gatilhoEntrada?.respostaPublica || "", 220);
  const id = criarId("igpub");
  const base = {
    id,
    origem: texto(origem || "manual"),
    tipoPublicacao: tipoSeguro,
    formato: "reels",
    ofertaId: tipoSeguro === "livre" ? "" : ofertaIdSeguro,
    templateId: tpl,
    agendamentoId: texto(agendamentoId),
    idempotencyKey: texto(idempotencyKey),
    instagramUserId: conexao.instagramUserId,
    imagemUrl: "",
    imagemOriginalUrl: "",
    imagemPublicadaUrl: "",
    videoUrl: videoPublico,
    mediaUrl: videoPublico,
    videoMimeType: texto(videoMimeType || mediaMimeType || midiaMimeType || mimeType || oferta?.videoMimeType),
    renderizado: false,
    renderHash: "",
    templateVersao: null,
    legenda: legendaFinal,
    linkAfiliado: destinoConversao,
    urlDestino: destinoConversao,
    mensagemPrivada: mensagemPrivadaFinal,
    direct: direct && typeof direct === "object" ? direct : null,
    redirect: redirect && typeof redirect === "object" ? redirect : null,
    cta: cta && typeof cta === "object" ? cta : null,
    status: "publicando",
    instagramContainerId: "",
    instagramMediaId: "",
    gatilho: gatilhoSeguro,
    respostaPublica: respostaPublicaFinal,
    criadoEm: agoraIso(),
    tentativaEm: agoraIso(),
    publicadoEm: "",
    erro: null
  };

  salvarPublicacaoInstagram(clienteId, base);

  let instagramContainerId = "";
  try {
    instagramContainerId = await criarContainerReelInstagram({
      instagramUserId: conexao.instagramUserId,
      videoUrl: videoPublico,
      legenda: legendaFinal,
      accessToken: conexao.token.accessToken,
      httpClient
    });
    logSocial("[INSTAGRAM-REELS-CONTAINER-CRIADO]", {
      clienteId,
      ofertaId: ofertaIdSeguro,
      publicacaoId: id,
      instagramContainerId
    });
    const comContainer = salvarPublicacaoInstagram(clienteId, {
      ...base,
      status: "processando",
      instagramContainerId
    });
    await aguardarContainerReelProntoInstagram({
      containerId: instagramContainerId,
      accessToken: conexao.token.accessToken,
      httpClient,
      polling
    });
    const instagramMediaId = await publicarContainerInstagram({
      instagramUserId: conexao.instagramUserId,
      containerId: instagramContainerId,
      accessToken: conexao.token.accessToken,
      httpClient
    }).catch(erroOriginal => {
      const erro = new Error("reels_publicacao_meta_erro");
      erro.response = erroOriginal?.response;
      throw erro;
    });
    const publicada = salvarPublicacaoInstagram(clienteId, {
      ...comContainer,
      status: "publicada",
      instagramMediaId,
      publicadoEm: agoraIso(),
      atualizadoEm: agoraIso(),
      erro: null
    });

    logSocial("[INSTAGRAM-REELS-PUBLICACAO-CONCLUIDA]", {
      clienteId,
      ofertaId: ofertaIdSeguro,
      publicacaoId: id,
      instagramUserId: conexao.instagramUserId,
      instagramMediaId
    });

    return {
      duplicada: false,
      publicacao: publicacaoSanitizada(publicada)
    };
  } catch (e) {
    const erro = sanitizarErroInstagram(e);
    const falha = salvarPublicacaoInstagram(clienteId, {
      ...base,
      instagramContainerId,
      status: "erro",
      erro
    });
    logSocial("[INSTAGRAM-REELS-PUBLICACAO-ERRO]", {
      clienteId,
      ofertaId: ofertaIdSeguro,
      publicacaoId: id,
      instagramContainerId,
      erro
    });
    return {
      duplicada: false,
      publicacao: publicacaoSanitizada(falha)
    };
  }
}

function rawBodyBuffer(body, rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (typeof rawBody === "string") return Buffer.from(rawBody);
  return Buffer.from(JSON.stringify(body || {}));
}

function assinaturaWebhookConfere({ recebido = "", rawBody = Buffer.alloc(0), secret = "" } = {}) {
  if (!texto(recebido) || !texto(secret)) return false;
  const esperado = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(recebido, "hex"), Buffer.from(esperado, "hex"));
  } catch {
    return false;
  }
}

function validarAssinaturaWebhookInstagram({ assinatura = "", rawBody = Buffer.alloc(0), secret = "" } = {}) {
  const valor = texto(assinatura);
  if (!valor || !valor.startsWith("sha256=")) return false;
  const recebido = valor.slice("sha256=".length);

  const segredoExplicito = texto(secret);
  if (segredoExplicito) {
    return assinaturaWebhookConfere({ recebido, rawBody, secret: segredoExplicito });
  }

  const candidatos = [
    { origem: "meta_app_secret", secret: appSecretMeta() },
    { origem: "instagram_app_secret", secret: appSecretInstagram() }
  ].filter(item => texto(item.secret));

  for (const candidato of candidatos) {
    if (assinaturaWebhookConfere({ recebido, rawBody, secret: candidato.secret })) {
      logSocial("[INSTAGRAM-WEBHOOK-SECRET-CORRESPONDENTE]", {
        origem: candidato.origem
      });
      return true;
    }
  }

  return false;
}

function normalizarEventosWebhookInstagram(payload = {}) {
  const eventos = [];
  for (const entry of lista(payload.entry)) {
    const instagramUserId = texto(entry.id || entry.uid);
    for (const change of lista(entry.changes)) {
      const value = change?.value || {};
      const mediaId = texto(value.media?.id || value.media_id || value.mediaId);
      const commentId = texto(value.id || value.comment_id || value.commentId);
      const comentario = texto(value.text || value.message || value.comment_text);
      const from = value.from || value.user || {};
      eventos.push({
        field: texto(change.field),
        instagramUserId: texto(value.instagram_user_id || value.ig_user_id || instagramUserId),
        instagramMediaId: mediaId,
        instagramCommentId: commentId,
        textoComentario: comentario,
        username: limitarTexto(from.username || value.username, 80),
        fromId: texto(from.id || value.user_id || value.sender_id),
        removido: value.is_deleted === true || value.deleted === true || texto(value.verb).toLowerCase() === "remove"
      });
    }
  }
  return eventos.filter(evento => evento.instagramCommentId || evento.instagramMediaId || evento.textoComentario);
}

function encontrarPublicacaoPorMedia(instagramUserId = "", instagramMediaId = "") {
  const candidatos = [];
  for (const clienteId of listClientes()) {
    let conexao;
    try {
      conexao = lerConexaoInstagram(clienteId);
    } catch (e) {
      logSocial("[INSTAGRAM-WEBHOOK-CONEXAO-INVALIDA]", { clienteId, erro: e.message });
      continue;
    }
    if (texto(conexao.instagramUserId) !== texto(instagramUserId)) continue;
    const publicacao = lista(readClienteJson(clienteId, ARQUIVO_PUBLICACOES, []))
      .find(item => texto(item?.instagramMediaId) === texto(instagramMediaId) && texto(item?.status) === "publicada");
    if (publicacao) candidatos.push({ clienteId, conexao, publicacao });
  }
  if (candidatos.length > 1) {
    logSocial("[INSTAGRAM-WEBHOOK-CLIENTE-DUPLICADO]", {
      instagramUserId,
      instagramMediaId,
      total: candidatos.length
    });
    logWebhookDescartadoInstagram("cliente_nao_encontrado", {
      instagramUserId,
      instagramMediaId,
      total: candidatos.length
    });
    return null;
  }
  return candidatos[0] || null;
}

async function responderComentarioInstagram({ commentId = "", mensagem = "", accessToken = "", httpClient = httpClientPadrao() } = {}) {
  const resposta = await httpClient.post(`${endpointComentarioInstagram(commentId)}/replies`, new URLSearchParams({
    message: limitarTexto(mensagem, 220),
    access_token: accessToken
  }).toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000
  });
  return texto(resposta?.data?.id || resposta?.data?.comment_id || "ok");
}

async function publicarImagemLivreInstagram({
  clienteId = "admin",
  imagemUrl = "",
  legenda = "",
  templateId = "livre-instagram",
  gatilho = undefined,
  respostaPublica = "",
  mensagemPrivada = "",
  direct = undefined,
  redirect = undefined,
  urlDestino = "",
  cta = undefined,
  linkAfiliado = "",
  origem = "manual",
  tipoPublicacao = "livre",
  formato = "feed",
  agendamentoId = "",
  idempotencyKey = "",
  httpClient = httpClientPadrao(),
  polling = {}
} = {}) {
  const tpl = texto(templateId || "livre-instagram") || "livre-instagram";
  const formatoSeguro = ["feed", "reels"].includes(texto(formato).toLowerCase()) ? texto(formato).toLowerCase() : "feed";
  const imagemPublica = validarImagemPublica(imagemUrl);
  const legendaFinal = limitarTexto(legenda, 2200);
  if (!legendaFinal) throw new Error("legenda_obrigatoria");

  const conexao = lerConexaoInstagram(clienteId);
  if (!conexao.conectado || !texto(conexao.token?.accessToken) || !texto(conexao.instagramUserId)) {
    throw new Error("instagram_nao_conectado");
  }

  if (conexao.token?.expiresAt && Date.parse(conexao.token.expiresAt) <= Date.now()) {
    throw new Error("instagram_token_expirado");
  }

  const duplicadaIdempotente = encontrarPublicacaoPorIdempotency(clienteId, idempotencyKey);
  if (duplicadaIdempotente) {
    return {
      duplicada: true,
      publicacao: publicacaoSanitizada(duplicadaIdempotente)
    };
  }

  const destinoConversao = urlDestinoConversaoPublicacao({
    urlDestino,
    linkAfiliado,
    redirect,
    cta,
    gatilho
  });
  const mensagemPrivadaFinal = limitarTexto(
    mensagemPrivada ||
    direct?.mensagem ||
    direct?.texto ||
    direct?.textoDirect ||
    gatilho?.mensagemPrivada ||
    gatilho?.mensagemDirect ||
    gatilho?.textoDirect ||
    "",
    300
  );
  const gatilhoEntrada = gatilho && typeof gatilho === "object"
    ? {
      ...gatilho,
      ...(mensagemPrivadaFinal && !texto(gatilho.textoDirect) ? { textoDirect: mensagemPrivadaFinal } : {})
    }
    : null;
  const gatilhoSeguro = gatilhoEntrada ? sanitizarGatilhoInstagram(gatilhoEntrada) : null;
  const respostaPublicaFinal = limitarTexto(respostaPublica || gatilhoEntrada?.respostaPublica || "", 220);
  const id = criarId("igpub");
  const base = {
    id,
    origem: texto(origem || "manual"),
    tipoPublicacao: texto(tipoPublicacao || "livre") || "livre",
    formato: formatoSeguro,
    ofertaId: "",
    templateId: tpl,
    agendamentoId: texto(agendamentoId),
    idempotencyKey: texto(idempotencyKey),
    instagramUserId: conexao.instagramUserId,
    imagemUrl: imagemPublica,
    imagemOriginalUrl: imagemPublica,
    imagemPublicadaUrl: imagemPublica,
    renderizado: false,
    renderHash: "",
    templateVersao: null,
    legenda: legendaFinal,
    linkAfiliado: destinoConversao,
    urlDestino: destinoConversao,
    mensagemPrivada: mensagemPrivadaFinal,
    direct: direct && typeof direct === "object" ? direct : null,
    redirect: redirect && typeof redirect === "object" ? redirect : null,
    cta: cta && typeof cta === "object" ? cta : null,
    status: "publicando",
    instagramContainerId: "",
    instagramMediaId: "",
    gatilho: gatilhoSeguro,
    respostaPublica: respostaPublicaFinal,
    criadoEm: agoraIso(),
    tentativaEm: agoraIso(),
    publicadoEm: "",
    erro: null
  };

  salvarPublicacaoInstagram(clienteId, base);

  let instagramContainerId = "";
  try {
    instagramContainerId = await criarContainerImagemInstagram({
      instagramUserId: conexao.instagramUserId,
      imagemUrl: imagemPublica,
      legenda: legendaFinal,
      accessToken: conexao.token.accessToken,
      httpClient
    });
    const comContainer = salvarPublicacaoInstagram(clienteId, {
      ...base,
      status: "processando",
      instagramContainerId
    });
    await aguardarContainerProntoInstagram({
      containerId: instagramContainerId,
      accessToken: conexao.token.accessToken,
      httpClient,
      polling
    });
    const instagramMediaId = await publicarContainerInstagram({
      instagramUserId: conexao.instagramUserId,
      containerId: instagramContainerId,
      accessToken: conexao.token.accessToken,
      httpClient
    });
    const publicada = salvarPublicacaoInstagram(clienteId, {
      ...comContainer,
      status: "publicada",
      instagramMediaId,
      publicadoEm: agoraIso(),
      atualizadoEm: agoraIso(),
      erro: null
    });

    logSocial("[SOCIAL-INSTAGRAM-PUBLICACAO-LIVRE-OK]", {
      clienteId,
      publicacaoId: id,
      origem: base.origem,
      instagramUserId: conexao.instagramUserId,
      instagramMediaId
    });

    return {
      duplicada: false,
      publicacao: publicacaoSanitizada(publicada)
    };
  } catch (e) {
    const erro = sanitizarErroInstagram(e);
    const falha = salvarPublicacaoInstagram(clienteId, {
      ...base,
      instagramContainerId,
      status: "erro",
      erro
    });
    logSocial("[SOCIAL-INSTAGRAM-PUBLICACAO-LIVRE-ERRO]", {
      clienteId,
      publicacaoId: id,
      origem: base.origem,
      instagramContainerId,
      erro
    });
    return {
      duplicada: false,
      publicacao: publicacaoSanitizada(falha)
    };
  }
}

async function diagnosticarComentarioInstagram({ commentId = "", accessToken = "", httpClient = httpClientPadrao() } = {}) {
  try {
    await httpClient.get(endpointComentarioInstagram(commentId), {
      params: {
        fields: "id",
        access_token: accessToken
      },
      timeout: 10000
    });
    const resultado = { commentId: texto(commentId), consultavel: true, codigoErro: "", tipoErro: "" };
    logSocial("[INSTAGRAM-COMENTARIO-DIAGNOSTICO]", resultado);
    return resultado;
  } catch (e) {
    const resultado = {
      commentId: texto(commentId),
      consultavel: false,
      codigoErro: codigoErroInstagram(e),
      tipoErro: tipoErroInstagram(e)
    };
    logSocial("[INSTAGRAM-COMENTARIO-DIAGNOSTICO]", resultado);
    return resultado;
  }
}

function normalizarPermissaoInstagram(item = {}) {
  return {
    nome: texto(item.permission || item.name || item.scope),
    concedida: ["granted", "installed"].includes(texto(item.status || item.value).toLowerCase()) || item.granted === true
  };
}

function diagnosticoPermissoesConexaoInstagram(conexao = {}, origem = "conexao_salva") {
  const scopes = lista(conexao.scopes).map(texto).filter(Boolean);
  return {
    manageComments: scopes.includes(SCOPE_GERENCIAR_COMENTARIOS),
    manageMessages: scopes.includes(SCOPE_GERENCIAR_MENSAGENS),
    origem
  };
}

async function diagnosticarPermissoesTokenInstagram({ conexao = {}, accessToken = "", httpClient = httpClientPadrao() } = {}) {
  try {
    const resposta = await httpClient.get(`${INSTAGRAM_GRAPH_BASE}/me/permissions`, {
      params: { access_token: accessToken },
      timeout: 10000
    });
    const permissoes = lista(resposta?.data?.data).map(normalizarPermissaoInstagram);
    const resultado = {
      manageComments: permissoes.some(item => item.nome === SCOPE_GERENCIAR_COMENTARIOS && item.concedida),
      manageMessages: permissoes.some(item => item.nome === SCOPE_GERENCIAR_MENSAGENS && item.concedida),
      origem: "introspeccao"
    };
    logSocial("[INSTAGRAM-TOKEN-PERMISSOES]", resultado);
    return resultado;
  } catch {
    const resultado = diagnosticoPermissoesConexaoInstagram(conexao, "conexao_salva");
    logSocial("[INSTAGRAM-TOKEN-PERMISSOES]", resultado);
    return resultado;
  }
}

async function responderPrivadoComentarioInstagram({ clienteId = "", commentId = "", mensagem = "", httpClient = httpClientPadrao() } = {}) {
  const conexao = lerConexaoInstagram(clienteId);
  const instagramUserId = texto(conexao.instagramUserId);
  const accessToken = texto(conexao.token?.accessToken);
  const idComentario = texto(commentId);
  const textoMensagem = texto(mensagem);
  const caminho = `/${instagramUserId}/messages`;
  const endpoint = `${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(instagramUserId)}/messages`;
  const contextoLog = {
    clienteId: texto(clienteId),
    instagramUserId,
    commentId: idComentario,
    tokenPresente: Boolean(accessToken)
  };

  logSocial("[INSTAGRAM-DIRECT-INICIO]", contextoLog);

  if (!instagramUserId) {
    const erro = new Error("instagram_direct_instagram_user_id_ausente");
    logSocial("[INSTAGRAM-DIRECT-ERRO]", { ...contextoLog, erro: sanitizarErroInstagram(erro) });
    throw erro;
  }
  if (!accessToken) {
    const erro = new Error("instagram_direct_token_ausente");
    logSocial("[INSTAGRAM-DIRECT-ERRO]", { ...contextoLog, erro: sanitizarErroInstagram(erro) });
    throw erro;
  }
  if (!idComentario) {
    const erro = new Error("instagram_direct_comment_id_ausente");
    logSocial("[INSTAGRAM-DIRECT-ERRO]", { ...contextoLog, erro: sanitizarErroInstagram(erro) });
    throw erro;
  }
  if (!textoMensagem) {
    const erro = new Error("instagram_direct_mensagem_ausente");
    logSocial("[INSTAGRAM-DIRECT-ERRO]", { ...contextoLog, erro: sanitizarErroInstagram(erro) });
    throw erro;
  }

  logSocial("[INSTAGRAM-DIRECT-REQUEST]", {
    ...contextoLog,
    host: INSTAGRAM_GRAPH_BASE,
    caminho,
    recipientTipo: "comment_id"
  });

  try {
    const resposta = await httpClient.post(endpoint, new URLSearchParams({
      recipient: JSON.stringify({ comment_id: idComentario }),
      message: JSON.stringify({ text: textoMensagem.slice(0, 950) }),
      access_token: accessToken
    }).toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000
    });
    const resultado = {
      recipientIdPresente: Boolean(texto(resposta?.data?.recipient_id)),
      messageIdPresente: Boolean(texto(resposta?.data?.message_id || resposta?.data?.id))
    };
    logSocial("[INSTAGRAM-DIRECT-SUCESSO]", {
      ...contextoLog,
      ...resultado
    });
    return texto(resposta?.data?.message_id || resposta?.data?.id || "ok");
  } catch (e) {
    const erro = sanitizarErroInstagram(e);
    logSocial("[INSTAGRAM-DIRECT-ERRO]", {
      ...contextoLog,
      statusHttp: e?.response?.status || "",
      code: erro.code,
      type: erro.type,
      message: erro.message
    });
    throw e;
  }
}

function montarMensagemDirectInstagram({ oferta = {}, gatilho = {} } = {}) {
  const linhas = [];
  if (gatilho.textoDirect) linhas.push(gatilho.textoDirect);
  if (oferta.titulo) linhas.push(oferta.titulo);
  if (oferta.precoAtual !== null) linhas.push(`Por: ${moeda(oferta.precoAtual)}`);
  if (oferta.cupom) linhas.push(`Cupom: ${oferta.cupom}`);
  if (oferta.linkAfiliado) {
    linhas.push("Link:");
    linhas.push(oferta.linkAfiliado);
  }
  if (gatilho.grupoUrl) {
    if (gatilho.grupoTexto) linhas.push(gatilho.grupoTexto);
    linhas.push(gatilho.grupoUrl);
  }
  if (gatilho.textoFinal) linhas.push(gatilho.textoFinal);
  return linhas.filter(Boolean).join("\n");
}

async function processarEventoComentarioInstagram(evento = {}, { httpClient = httpClientPadrao() } = {}) {
  const encontrado = encontrarPublicacaoPorMedia(evento.instagramUserId, evento.instagramMediaId);
  if (!encontrado) {
    logWebhookDescartadoInstagram("media_nao_encontrada", {
      instagramUserId: evento.instagramUserId,
      instagramMediaId: evento.instagramMediaId,
      instagramCommentId: evento.instagramCommentId
    });
    return { status: "ignorado", motivo: "publicacao_nao_optimus" };
  }

  const { clienteId, conexao, publicacao } = encontrado;
  logSocial("[INSTAGRAM-WEBHOOK-COMENTARIO-DETECTADO]", {
    clienteId,
    instagramUserId: evento.instagramUserId,
    instagramMediaId: evento.instagramMediaId,
    instagramCommentId: evento.instagramCommentId,
    field: texto(evento.field)
  });

  const existente = encontrarInteracaoPorComentario(clienteId, evento.instagramCommentId);
  const podeRetentarPrivateReply =
    existente &&
    texto(existente.respostaPublicaStatus) === "concluida" &&
    texto(existente.privateReplyStatus || existente.directStatus) === "erro";
  if (existente && !podeRetentarPrivateReply) {
    logWebhookDescartadoInstagram("duplicado", {
      clienteId,
      instagramUserId: evento.instagramUserId,
      instagramMediaId: evento.instagramMediaId,
      instagramCommentId: evento.instagramCommentId
    });
    return { status: "duplicado", interacao: interacaoSanitizada(existente) };
  }

  const gatilho = sanitizarGatilhoInstagram(publicacao.gatilho, { corrigirCta: true });
  const base = {
    ...(existente || {}),
    id: texto(existente?.id) || criarId("igint"),
    instagramUserId: evento.instagramUserId,
    instagramMediaId: evento.instagramMediaId,
    instagramCommentId: evento.instagramCommentId,
    ofertaId: publicacao.ofertaId,
    publicacaoId: publicacao.id,
    username: evento.username,
    textoComentario: limitarTexto(evento.textoComentario, 300),
    palavraGatilho: gatilho.palavra,
    statusGeral: "ignorado",
    respostaPublicaStatus: texto(existente?.respostaPublicaStatus) || "nao_enviada",
    respostaPublicaEnviadaEm: texto(existente?.respostaPublicaEnviadaEm),
    privateReplyStatus: texto(existente?.privateReplyStatus || existente?.directStatus) || "nao_enviado",
    privateReplyEnviadoEm: texto(existente?.privateReplyEnviadoEm),
    criadoEm: texto(existente?.criadoEm) || agoraIso(),
    respondidoEm: texto(existente?.respondidoEm),
    erro: null
  };

  if (!gatilho.ativo) {
    logWebhookDescartadoInstagram("gatilho_inativo", {
      clienteId,
      instagramUserId: evento.instagramUserId,
      instagramMediaId: evento.instagramMediaId,
      instagramCommentId: evento.instagramCommentId
    });
    return { status: "ignorado", interacao: interacaoSanitizada(salvarInteracaoInstagram(clienteId, { ...base, statusGeral: "ignorado", erro: { message: "gatilho_inativo" } })) };
  }
  if (!evento.instagramCommentId || !evento.textoComentario || evento.removido) {
    logWebhookDescartadoInstagram("payload_invalido", {
      clienteId,
      instagramUserId: evento.instagramUserId,
      instagramMediaId: evento.instagramMediaId,
      instagramCommentId: evento.instagramCommentId
    });
    return { status: "ignorado", interacao: interacaoSanitizada(salvarInteracaoInstagram(clienteId, { ...base, statusGeral: "ignorado", erro: { message: "comentario_invalido" } })) };
  }
  if (texto(evento.fromId) && texto(evento.fromId) === texto(conexao.instagramUserId)) {
    logWebhookDescartadoInstagram("comentario_proprio", {
      clienteId,
      instagramUserId: evento.instagramUserId,
      instagramMediaId: evento.instagramMediaId,
      instagramCommentId: evento.instagramCommentId
    });
    return { status: "ignorado", interacao: interacaoSanitizada(salvarInteracaoInstagram(clienteId, { ...base, statusGeral: "ignorado", erro: { message: "comentario_proprio" } })) };
  }
  if (!contemGatilhoSeguro(evento.textoComentario, gatilho.palavra)) {
    logWebhookDescartadoInstagram("gatilho_nao_corresponde", {
      clienteId,
      instagramUserId: evento.instagramUserId,
      instagramMediaId: evento.instagramMediaId,
      instagramCommentId: evento.instagramCommentId
    });
    return { status: "ignorado", interacao: interacaoSanitizada(salvarInteracaoInstagram(clienteId, { ...base, statusGeral: "ignorado", erro: { message: "sem_gatilho" } })) };
  }

  const tipoPublicacaoWebhook = texto(publicacao.tipoPublicacao || (texto(publicacao.ofertaId) ? "oferta" : "livre"));
  const oferta = texto(publicacao.ofertaId)
    ? carregarOfertaCliente(clienteId, publicacao.ofertaId)
    : ofertaDaPublicacaoLivre({ ...publicacao, clienteId });
  if (tipoPublicacaoWebhook === "livre") {
    oferta.linkAfiliado = texto(oferta.linkAfiliado) || linkFinalPublicacaoLivre(publicacao);
  }
  const publicacaoLivre = tipoPublicacaoWebhook === "livre";
  const respostaPublicaLivre = texto(publicacao.respostaPublica);
  const mensagemPrivadaLivre = texto(
    publicacao.mensagemPrivada ||
    publicacao.direct?.mensagem ||
    publicacao.direct?.texto ||
    publicacao.direct?.textoDirect
  );
  const deveEnviarRespostaPublica = publicacaoLivre ? Boolean(respostaPublicaLivre) : true;
  const deveEnviarDirect = publicacaoLivre ? Boolean(mensagemPrivadaLivre) : true;
  const gatilhoParaResposta = publicacaoLivre && respostaPublicaLivre
    ? { ...gatilho, respostaPublica: respostaPublicaLivre }
    : gatilho;
  const gatilhoParaDirect = publicacaoLivre && mensagemPrivadaLivre
    ? { ...gatilho, textoDirect: mensagemPrivadaLivre }
    : gatilho;
  logSocial("[INSTAGRAM-WEBHOOK-LINK-DIAGNOSTICO]", {
    clienteId,
    instagramUserId: evento.instagramUserId,
    instagramMediaId: evento.instagramMediaId,
    instagramCommentId: evento.instagramCommentId,
    tipoPublicacao: tipoPublicacaoWebhook,
    origem: texto(publicacao.origem),
    urlDestinoPresente: Boolean(urlHttps(publicacao.urlDestino)),
    linkAfiliadoPresente: Boolean(urlHttps(publicacao.linkAfiliado)),
    redirectPresente: Boolean(publicacao.redirect && typeof publicacao.redirect === "object"),
    ctaUrlPresente: Boolean(urlHttpsDeCampos(publicacao.cta, ["urlDestino"])),
    linkFinalPresente: Boolean(texto(oferta.linkAfiliado))
  });
  if (!oferta.linkAfiliado && !publicacaoLivre) {
    logWebhookDescartadoInstagram("oferta_link_ausente", {
      clienteId,
      instagramUserId: evento.instagramUserId,
      instagramMediaId: evento.instagramMediaId,
      instagramCommentId: evento.instagramCommentId
    });
    return { status: "erro", interacao: interacaoSanitizada(salvarInteracaoInstagram(clienteId, { ...base, statusGeral: "erro", erro: { message: "oferta_link_ausente" } })) };
  }
  if (publicacaoLivre && !deveEnviarRespostaPublica && !deveEnviarDirect) {
    logWebhookDescartadoInstagram("acao_configurada_ausente", {
      clienteId,
      instagramUserId: evento.instagramUserId,
      instagramMediaId: evento.instagramMediaId,
      instagramCommentId: evento.instagramCommentId
    });
    return { status: "ignorado", interacao: interacaoSanitizada(salvarInteracaoInstagram(clienteId, { ...base, statusGeral: "ignorado", erro: { message: "acao_configurada_ausente" } })) };
  }

  let atual = salvarInteracaoInstagram(clienteId, {
    ...base,
    statusGeral: "processando",
    privateReplyStatus: podeRetentarPrivateReply ? "processando" : base.privateReplyStatus
  });

  if (deveEnviarRespostaPublica && texto(atual.respostaPublicaStatus) !== "concluida") {
    try {
      await responderComentarioInstagram({
        commentId: evento.instagramCommentId,
        mensagem: gatilhoParaResposta.respostaPublica,
        accessToken: conexao.token.accessToken,
        httpClient
      });
      atual = salvarInteracaoInstagram(clienteId, {
        ...atual,
        respostaPublicaStatus: "concluida",
        respostaPublicaEnviadaEm: agoraIso()
      });
      logSocial("[INSTAGRAM-WEBHOOK-RESPOSTA-PUBLICA]", {
        clienteId,
        instagramUserId: evento.instagramUserId,
        instagramMediaId: evento.instagramMediaId,
        instagramCommentId: evento.instagramCommentId,
        status: "concluida"
      });
    } catch (e) {
      const erro = sanitizarErroInstagram(e);
      atual = salvarInteracaoInstagram(clienteId, {
        ...atual,
        statusGeral: "erro",
        respostaPublicaStatus: "erro",
        erro
      });
      logSocial("[INSTAGRAM-WEBHOOK-RESPOSTA-PUBLICA]", {
        clienteId,
        instagramUserId: evento.instagramUserId,
        instagramMediaId: evento.instagramMediaId,
        instagramCommentId: evento.instagramCommentId,
        status: "erro",
        erro
      });
      logSocial("[INSTAGRAM-WEBHOOK-CONCLUIDO]", {
        clienteId,
        instagramUserId: evento.instagramUserId,
        instagramMediaId: evento.instagramMediaId,
        instagramCommentId: evento.instagramCommentId,
        status: atual.statusGeral
      });
      return { status: "erro", interacao: interacaoSanitizada(atual) };
    }
  }

  if (!deveEnviarDirect) {
    atual = salvarInteracaoInstagram(clienteId, {
      ...atual,
      statusGeral: "respondida",
      respondidoEm: agoraIso(),
      erro: null
    });
    logSocial("[INSTAGRAM-WEBHOOK-CONCLUIDO]", {
      clienteId,
      instagramUserId: evento.instagramUserId,
      instagramMediaId: evento.instagramMediaId,
      instagramCommentId: evento.instagramCommentId,
      status: atual.statusGeral
    });
    return { status: atual.statusGeral, interacao: interacaoSanitizada(atual) };
  }

  await diagnosticarComentarioInstagram({
    commentId: evento.instagramCommentId,
    accessToken: conexao.token.accessToken,
    httpClient
  });
  await diagnosticarPermissoesTokenInstagram({
    conexao,
    accessToken: conexao.token.accessToken,
    httpClient
  });

  try {
    await responderPrivadoComentarioInstagram({
      clienteId,
      commentId: evento.instagramCommentId,
      mensagem: montarMensagemDirectInstagram({ oferta, gatilho: gatilhoParaDirect }),
      httpClient
    });
    atual = salvarInteracaoInstagram(clienteId, {
      ...atual,
      statusGeral: "respondida",
      privateReplyStatus: "concluido",
      privateReplyEnviadoEm: agoraIso(),
      respondidoEm: agoraIso(),
      erro: null
    });
    logSocial("[INSTAGRAM-WEBHOOK-DIRECT]", {
      clienteId,
      instagramUserId: evento.instagramUserId,
      instagramMediaId: evento.instagramMediaId,
      instagramCommentId: evento.instagramCommentId,
      status: "concluido"
    });
  } catch (e) {
    atual = salvarInteracaoInstagram(clienteId, {
      ...atual,
      statusGeral: "parcial",
      privateReplyStatus: "erro",
      respondidoEm: agoraIso(),
      erro: sanitizarErroInstagram(e)
    });
    logSocial("[INSTAGRAM-WEBHOOK-DIRECT]", {
      clienteId,
      instagramUserId: evento.instagramUserId,
      instagramMediaId: evento.instagramMediaId,
      instagramCommentId: evento.instagramCommentId,
      status: "erro",
      erro: atual.erro
    });
    logSocial("[INSTAGRAM-PRIVATE-REPLY-INDISPONIVEL]", {
      commentId: evento.instagramCommentId,
      codigoErro: atual.erro.code,
      motivo: atual.erro.message
    });
  }

  logSocial("[INSTAGRAM-WEBHOOK-CONCLUIDO]", {
    clienteId,
    instagramUserId: evento.instagramUserId,
    instagramMediaId: evento.instagramMediaId,
    instagramCommentId: evento.instagramCommentId,
    status: atual.statusGeral
  });

  return { status: atual.statusGeral, interacao: interacaoSanitizada(atual) };
}

async function processarWebhookInstagram({ payload = {}, assinatura = "", rawBody = null, httpClient = httpClientPadrao() } = {}) {
  const raw = rawBodyBuffer(payload, rawBody);
  if (!validarAssinaturaWebhookInstagram({ assinatura, rawBody: raw })) {
    throw new Error("assinatura_invalida");
  }
  const resumo = resumoPayloadWebhookInstagram(payload);
  logSocial("[INSTAGRAM-WEBHOOK-PAYLOAD]", resumo);

  if (!payload || typeof payload !== "object" || !lista(payload.entry).length) {
    logWebhookDescartadoInstagram("payload_invalido", resumo);
  }
  if (resumo.object && resumo.object !== "instagram") {
    logWebhookDescartadoInstagram("objeto_desconhecido", resumo);
  }

  const eventosNormalizados = normalizarEventosWebhookInstagram(payload);
  const eventos = eventosNormalizados
    .filter(evento => ["comments", "mentions"].includes(texto(evento.field)) || evento.instagramCommentId);
  for (const evento of eventosNormalizados) {
    if (!eventos.includes(evento)) {
      logWebhookDescartadoInstagram("field_nao_monitorado", {
        instagramUserId: evento.instagramUserId,
        instagramMediaId: evento.instagramMediaId,
        instagramCommentId: evento.instagramCommentId,
        field: texto(evento.field)
      });
    }
  }
  if (!eventos.length && eventosNormalizados.length) {
    logWebhookDescartadoInstagram("field_nao_monitorado", resumo);
  }
  const resultados = [];
  for (const evento of eventos) {
    resultados.push(await processarEventoComentarioInstagram(evento, { httpClient }));
  }
  logSocial("[INSTAGRAM-WEBHOOK-CONCLUIDO]", {
    status: "processado",
    total: resultados.length
  });
  return { ok: true, total: resultados.length, resultados };
}

async function concluirCallbackInstagram({ code = "", state = "", redirectUri = "", httpClient = httpClientPadrao() } = {}) {
  if (!texto(code)) throw new Error("code_ausente");

  const estado = decodificarStateInstagram(state);
  consumirStatePendente(estado.clienteId, estado.nonce);
  const uri = redirectUriInstagram(redirectUri);
  const tokenCurto = await trocarCodePorTokenCurto({ code, redirectUri: uri, httpClient });
  const tokenLongo = await trocarTokenLongaDuracao({
    accessToken: tokenCurto.access_token,
    httpClient
  });
  const token = normalizarToken(tokenLongo);
  const conta = await consultarContaInstagram({
    accessToken: token.accessToken,
    httpClient
  });

  salvarConexaoInstagram(estado.clienteId, {
    status: "conectado",
    conectado: true,
    ...conta,
    token,
    scopes: scopesInstagramConexao(),
    oauthStates: lerConexaoInstagram(estado.clienteId).oauthStates
  });

  const assinaturaWebhook = await inscreverContaWebhookInstagram({
    clienteId: estado.clienteId,
    instagramUserId: conta.instagramUserId,
    accessToken: token.accessToken,
    httpClient
  });

  const conexao = salvarConexaoInstagram(estado.clienteId, {
    ...lerConexaoInstagram(estado.clienteId),
    status: assinaturaWebhook.webhookContaAssinada ? "conectado_webhook_pronto" : "conectado_webhook_erro",
    conectado: true,
    ...assinaturaWebhook
  });

  logSocial("[SOCIAL-INSTAGRAM-OAUTH-CONECTADO]", {
    clienteId: estado.clienteId,
    instagramUserId: conta.instagramUserId,
    username: conta.username,
    tokenPresente: Boolean(token.accessToken),
    expiresAt: token.expiresAt,
    scopes: scopesInstagramConexao(),
    webhookContaAssinada: conexao.webhookContaAssinada,
    webhookCampos: conexao.webhookCampos,
    webhookErro: conexao.webhookErro
  });

  return conexao;
}

function limparConexaoInstagram(clienteId = "admin") {
  const atual = lerConexaoInstagram(clienteId);
  return salvarConexaoInstagram(clienteId, {
    ...criarInstagramPadrao(clienteId),
    oauthStates: atual.oauthStates
  });
}

function criarAdaptadorInstagram() {
  return {
    rede: "instagram",
    publicarImplementado: false,
    oauthImplementado: true,
    loginDiretoImplementado: true,
    status: "fase_a_instagram_login_direto"
  };
}

module.exports = {
  ARQUIVO_INSTAGRAM,
  ARQUIVO_PUBLICACOES,
  ARQUIVO_INTERACOES,
  INSTAGRAM_AUTH_URL,
  INSTAGRAM_GRAPH_BASE,
  INSTAGRAM_GRAPH_VERSION,
  SCOPE_BASICO,
  SCOPE_PUBLICAR_CONTEUDO,
  SCOPE_GERENCIAR_COMENTARIOS,
  SCOPE_GERENCIAR_MENSAGENS,
  WEBHOOK_CAMPOS_CONTA,
  criarAdaptadorInstagram,
  criarInstagramPadrao,
  iniciarConexaoInstagram,
  concluirCallbackInstagram,
  diagnosticarComentariosPublicacaoInstagram,
  consultarAssinaturasWebhookContaInstagram,
  inscreverContaWebhookInstagram,
  lerConexaoInstagram,
  limparConexaoInstagram,
  listarPublicacoesInstagram,
  getPublicacaoInstagram,
  listarInteracoesInstagram,
  getInteracaoInstagram,
  publicarImagemInstagram,
  publicarImagemLivreInstagram,
  publicarReelInstagram,
  processarWebhookInstagram,
  processarEventoComentarioInstagram,
  diagnosticarComentarioInstagram,
  diagnosticarPermissoesTokenInstagram,
  validarAssinaturaWebhookInstagram,
  normalizarEventosWebhookInstagram,
  sanitizarGatilhoInstagram,
  contemGatilhoSeguro,
  carregarOfertaCliente,
  montarLegendaInstagram,
  validarImagemPublica,
  validarVideoReelsPublico,
  sanitizarConexaoInstagram,
  decodificarStateInstagram,
  scopesInstagramConexao
};
