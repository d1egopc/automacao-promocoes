const crypto = require("crypto");
const {
  readClienteJson,
  writeClienteJson
} = require("../../../utils/storage");
const { logSocial } = require("../logs");

const INSTAGRAM_AUTH_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const INSTAGRAM_GRAPH_BASE = "https://graph.instagram.com";
const ARQUIVO_INSTAGRAM = "social-instagram.json";
const ARQUIVO_PUBLICACOES = "social-publicacoes.json";
const SCOPE_BASICO = "instagram_business_basic";
const SCOPE_PUBLICAR_CONTEUDO = "instagram_business_content_publish";
const STATE_TTL_MS = 15 * 60 * 1000;

function texto(valor = "") {
  return String(valor ?? "").trim();
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

function appIdInstagram() {
  return texto(process.env.INSTAGRAM_APP_ID);
}

function appSecretInstagram() {
  return texto(process.env.INSTAGRAM_APP_SECRET);
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
    status: accessToken ? "conectado" : "desconectado",
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
    instagramUserId: texto(conexao.instagramUserId),
    username: texto(conexao.username),
    accountType: texto(conexao.accountType),
    profilePictureUrl: texto(conexao.profilePictureUrl),
    tokenPresente: Boolean(texto(conexao.token?.accessToken)),
    expiresAt: texto(conexao.token?.expiresAt),
    scopes: lista(conexao.scopes).map(texto).filter(Boolean)
  };
}

function sanitizarErroInstagram(erro) {
  const metaErro = erro?.response?.data?.error || erro?.response?.data || {};
  const mensagem = texto(metaErro.message || erro?.message || "instagram_publicacao_erro");
  return {
    code: metaErro.code ?? "",
    type: texto(metaErro.type),
    message: mensagem.slice(0, 220)
  };
}

function publicacaoSanitizada(publicacao = {}) {
  return {
    id: texto(publicacao.id),
    ofertaId: texto(publicacao.ofertaId),
    templateId: texto(publicacao.templateId),
    instagramUserId: texto(publicacao.instagramUserId),
    imagemUrl: texto(publicacao.imagemUrl),
    legenda: texto(publicacao.legenda),
    linkAfiliadoPresente: Boolean(texto(publicacao.linkAfiliado)),
    status: texto(publicacao.status),
    instagramContainerId: texto(publicacao.instagramContainerId),
    instagramMediaId: texto(publicacao.instagramMediaId),
    criadoEm: texto(publicacao.criadoEm),
    publicadoEm: texto(publicacao.publicadoEm),
    erro: publicacao.erro && typeof publicacao.erro === "object" ? publicacao.erro : null
  };
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

function encontrarPublicacaoDuplicada(clienteId = "admin", ofertaId = "", templateId = "") {
  return lista(readClienteJson(clienteId, ARQUIVO_PUBLICACOES, []))
    .find(item =>
      texto(item?.rede || "instagram") === "instagram" &&
      texto(item?.ofertaId) === texto(ofertaId) &&
      texto(item?.templateId) === texto(templateId) &&
      ["publicando", "publicada"].includes(texto(item?.status))
    );
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
    categoria: texto(v2.categoria || oferta.categoria)
  };
}

function moeda(valor) {
  const n = numero(valor);
  if (n === null) return "";
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

function montarLegendaInstagram(oferta = {}, templateId = "padrao-instagram") {
  const linhas = [];
  linhas.push(oferta.titulo);
  if (oferta.precoAtual !== null) linhas.push(`Por: ${moeda(oferta.precoAtual)}`);
  if (oferta.precoOriginal !== null && oferta.precoOriginal > oferta.precoAtual) {
    linhas.push(`De: ${moeda(oferta.precoOriginal)}`);
  }
  if (oferta.desconto) linhas.push(`Desconto: ${oferta.desconto}`);
  if (oferta.cupom) linhas.push(`Cupom: ${oferta.cupom}`);
  linhas.push("Confira pelo link oficial da oferta.");
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
  return [SCOPE_BASICO, SCOPE_PUBLICAR_CONTEUDO];
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

async function publicarImagemInstagram({ clienteId = "admin", ofertaId = "", templateId = "padrao-instagram", httpClient = httpClientPadrao() } = {}) {
  const tpl = texto(templateId || "padrao-instagram") || "padrao-instagram";
  const ofertaIdSeguro = texto(ofertaId);
  if (!ofertaIdSeguro) throw new Error("oferta_id_obrigatorio");

  const conexao = lerConexaoInstagram(clienteId);
  if (!conexao.conectado || !texto(conexao.token?.accessToken) || !texto(conexao.instagramUserId)) {
    throw new Error("instagram_nao_conectado");
  }

  if (conexao.token?.expiresAt && Date.parse(conexao.token.expiresAt) <= Date.now()) {
    throw new Error("instagram_token_expirado");
  }

  const duplicada = encontrarPublicacaoDuplicada(clienteId, ofertaIdSeguro, tpl);
  if (duplicada) {
    return {
      duplicada: true,
      publicacao: publicacaoSanitizada(duplicada)
    };
  }

  const oferta = carregarOfertaCliente(clienteId, ofertaIdSeguro);
  if (!oferta.linkAfiliado) throw new Error("oferta_link_ausente");
  const imagemUrl = validarImagemPublica(oferta.imagem);
  const { legenda } = montarLegendaInstagram(oferta, tpl);
  const id = criarId("igpub");
  const base = {
    id,
    ofertaId: ofertaIdSeguro,
    templateId: tpl,
    instagramUserId: conexao.instagramUserId,
    imagemUrl,
    legenda,
    linkAfiliado: oferta.linkAfiliado,
    status: "publicando",
    instagramContainerId: "",
    instagramMediaId: "",
    criadoEm: agoraIso(),
    publicadoEm: "",
    erro: null
  };

  salvarPublicacaoInstagram(clienteId, base);

  let instagramContainerId = "";
  try {
    instagramContainerId = await criarContainerImagemInstagram({
      instagramUserId: conexao.instagramUserId,
      imagemUrl,
      legenda,
      accessToken: conexao.token.accessToken,
      httpClient
    });
    const comContainer = salvarPublicacaoInstagram(clienteId, {
      ...base,
      instagramContainerId
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
      erro: null
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
      ...base,
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
    return {
      duplicada: false,
      publicacao: publicacaoSanitizada(falha)
    };
  }
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

  const conexao = salvarConexaoInstagram(estado.clienteId, {
    status: "conectado",
    conectado: true,
    ...conta,
    token,
    scopes: scopesInstagramConexao(),
    oauthStates: lerConexaoInstagram(estado.clienteId).oauthStates
  });

  logSocial("[SOCIAL-INSTAGRAM-OAUTH-CONECTADO]", {
    clienteId: estado.clienteId,
    instagramUserId: conta.instagramUserId,
    username: conta.username,
    tokenPresente: Boolean(token.accessToken),
    expiresAt: token.expiresAt,
    scopes: scopesInstagramConexao()
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
  INSTAGRAM_AUTH_URL,
  INSTAGRAM_GRAPH_BASE,
  SCOPE_BASICO,
  SCOPE_PUBLICAR_CONTEUDO,
  criarAdaptadorInstagram,
  criarInstagramPadrao,
  iniciarConexaoInstagram,
  concluirCallbackInstagram,
  lerConexaoInstagram,
  limparConexaoInstagram,
  listarPublicacoesInstagram,
  getPublicacaoInstagram,
  publicarImagemInstagram,
  carregarOfertaCliente,
  montarLegendaInstagram,
  validarImagemPublica,
  sanitizarConexaoInstagram,
  decodificarStateInstagram,
  scopesInstagramConexao
};
