const crypto = require("crypto");
const {
  classificarCodigoSaude,
  detalhesSanitizados
} = require("./alertas-integracoes");
const {
  normalizarCredenciaisAwin,
  obterProgramaAwin
} = require("./integracoes");

const MENSAGENS = {
  ok: "Integração válida.",
  cookie_expirado: "Cookies expirados. Atualize os cookies e teste novamente.",
  cookie_ausente: "Cookies ausentes.",
  tag_ausente: "Tag ID ausente.",
  credencial_ausente: "Credenciais ausentes.",
  credencial_invalida: "Credenciais inválidas.",
  bloqueio_ml: "Mercado Livre bloqueou a validação. Tente novamente mais tarde.",
  falha_teste: "Não conseguimos validar a integração agora.",
  teste_nao_implementado: "Teste real ainda não implementado para este marketplace.",
  marketplace_nao_suportado: "Marketplace não suportado para teste de integração."
};

MENSAGENS.teste_paapi_nao_disponivel = "Teste real PA-API ainda nao disponivel.";
MENSAGENS.teste_magalu_nao_disponivel = "Teste real Magalu ainda nao disponivel.";
MENSAGENS.programa_invalido = "Programa de afiliado invalido ou indisponivel.";
MENSAGENS.afiliado_ok = MENSAGENS.ok;
MENSAGENS.cookie_valido = MENSAGENS.ok;

const TIMEOUT_TESTE_MS = Number(process.env.OPTIMUS_INTEGRACOES_TEST_TIMEOUT_MS || 12000);
const URLS_TESTE_MERCADOLIVRE = [
  "https://www.mercadolivre.com.br/processador-amd-ryzen-5-5500-36ghz-42ghz-max-turbo-cache-16mb-am4/p/MLB19444510",
  "https://www.mercadolivre.com.br/roteador-huawei-wifi-ax2s-5-ghz-wi-fi-6-harmonyos-mesh-easymeshvisualizacao-de-diagnosticos-do-wi-fi-controle-parental-branco/p/MLB20704214",
  "https://produto.mercadolivre.com.br/MLB6801238036"
];
const ASIN_TESTE_AMAZON = "B07PGL2ZSL";
const ALIEXPRESS_ITEM_URL_RE = /^https?:\/\/(?:[\w-]+\.)?aliexpress\.[\w.]+\/item\/\d+\.html/i;
const ALIEXPRESS_SHORT_URL_RE = /^https?:\/\/a\.aliexpress\.com\/_[a-z0-9]+/i;

function normalizarMarketplace(marketplace = "") {
  const valor = String(marketplace || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

  const aliases = {
    ml: "mercadolivre",
    meli: "mercadolivre",
    mercadolivrebr: "mercadolivre",
    mercadolivre: "mercadolivre",
    mercadoLivre: "mercadolivre",
    amazonbr: "amazon",
    amazon: "amazon",
    shopee: "shopee",
    awin: "awin",
    feedawin: "awin",
    kabum: "kabum",
    feedkabum: "kabum",
    magalu: "magalu",
    magazineluiza: "magalu",
    ali: "aliexpress",
    aliexpress: "aliexpress",
    aliexpressbr: "aliexpress"
  };

  return aliases[valor] || valor;
}

function resultado(marketplace, status, detalhes = {}, ok = false, mensagem = "") {
  const codigo = String(status || "falha_teste");
  const detalhesSeguros = detalhesSanitizados(detalhes || {});
  const statusSaude = classificarCodigoSaude(codigo, detalhesSeguros);
  const mp = normalizarMarketplace(marketplace);
  const integracaoId = String(detalhes?.integracaoId || "").trim().toLowerCase();
  return {
    ok: ok === true,
    marketplace: mp,
    ...(integracaoId ? { integracaoId } : {}),
    status: codigo,
    codigo,
    mensagem: mensagem || MENSAGENS[codigo] || MENSAGENS.falha_teste,
    detalhes: detalhesSeguros,
    saude: {
      marketplace: mp,
      status: statusSaude,
      codigo,
      ...(integracaoId ? { integracaoId } : {}),
      mensagem: statusSaude === "saudavel"
        ? "Integracao funcionando"
        : statusSaude === "invalida"
          ? "Integracao invalida ou expirada"
          : "Saude da integracao desconhecida",
      origem: "manual"
    },
    testadoEm: new Date().toISOString()
  };
}

async function fetchComTimeout(url, opcoes = {}, timeoutMs = TIMEOUT_TESTE_MS) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), Math.max(1000, timeoutMs))
    : null;

  try {
    return await fetch(url, {
      ...opcoes,
      ...(controller ? { signal: controller.signal } : {})
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function erroTransitorio(e = {}) {
  return e?.name === "AbortError" ? "timeout" : "erro_rede";
}

function primeiroValorTexto(...valores) {
  return valores
    .map(valor => String(valor || "").trim())
    .find(Boolean) || "";
}

function urlsTesteMercadoLivre(config = {}) {
  const c = credenciais(config);
  const configurada = primeiroValorTexto(
    valorTexto(c, ["urlTeste", "linkTeste"]),
    process.env.MERCADOLIVRE_HEALTHCHECK_URL,
    process.env.MERCADOLIVRE_URL_TESTE
  );
  return [
    configurada,
    ...URLS_TESTE_MERCADOLIVRE
  ].filter((url, indice, lista) =>
    /^https?:\/\//i.test(url) && lista.indexOf(url) === indice
  ).slice(0, 3);
}

function linkAfiliadoMercadoLivreValido(link = "") {
  return /^https?:\/\/meli\.la\//i.test(String(link || "").trim());
}

function saudeManualIndicaCredencialInvalida(saude = {}) {
  if (!saude || saude.status !== "invalida") return false;
  const codigo = String(saude.codigo || "").toLowerCase();
  const motivo = String(saude.detalhes?.motivo || "").toLowerCase();
  const statusHttp = Number(saude.detalhes?.httpStatus || saude.detalhes?.statusHttp || 0);
  if (motivo.includes("csrf") || statusHttp === 429) return false;
  return ["cookie_expirado", "cookie_invalido", "cookies_invalidos", "credencial_invalida"].includes(codigo) ||
    [401, 403, 407, 419].includes(statusHttp);
}

async function testarMercadoLivreComConversorOficial(clienteId = "admin", config = {}, deps = {}) {
  const c = credenciais(config);
  const cookies = valorTexto(c, ["cookies", "cookie"]);
  const tagId = tagMercadoLivre(config);
  const gerarLinkAfiliadoMercadoLivre = deps.gerarLinkAfiliadoMercadoLivre;

  if (!tagId) return resultado("mercadolivre", "tag_ausente", { faltandoTag: true }, false);
  if (!cookies) return resultado("mercadolivre", "cookie_ausente", { faltandoCookies: true }, false);
  if (typeof gerarLinkAfiliadoMercadoLivre !== "function") return null;

  try {
    const urlsTeste = urlsTesteMercadoLivre(config);
    for (const urlTeste of urlsTeste) {
      const linkAfiliado = await gerarLinkAfiliadoMercadoLivre(urlTeste, config, {
        clienteId,
        origem: "teste_manual_integracao"
      });

      if (linkAfiliadoMercadoLivreValido(linkAfiliado)) {
        return resultado("mercadolivre", "afiliado_ok", {
          linkAfiliado,
          urlTeste,
          prova: "conversor_oficial"
        }, true);
      }

      const saudeAtual = typeof deps.obterSaudeIntegracaoAtual === "function"
        ? deps.obterSaudeIntegracaoAtual(clienteId, "mercadolivre", config)
        : null;
      if (saudeManualIndicaCredencialInvalida(saudeAtual)) {
        return resultado("mercadolivre", "cookie_expirado", {
          urlTeste,
          prova: "conversor_oficial",
          codigoSaude: saudeAtual.codigo || "",
          httpStatus: saudeAtual.detalhes?.httpStatus || null
        }, false);
      }
    }

    return resultado("mercadolivre", "falha_teste", {
      motivo: "conversor_oficial_sem_link_afiliado",
      prova: "conversor_oficial"
    }, false);
  } catch (e) {
    return resultado("mercadolivre", "falha_teste", {
      motivo: erroTransitorio(e),
      prova: "conversor_oficial"
    }, false);
  }
}

function amazonTemProvaProduto(html = "") {
  const texto = String(html || "");
  return /id=["']productTitle["']/i.test(texto) ||
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>/i.test(texto) ||
    /property=["']og:title["']/i.test(texto) ||
    /data-a-dynamic-image=["'][^"']+["']/i.test(texto);
}

function amazonTemBloqueioTransitorio(texto = "") {
  const lower = String(texto || "").toLowerCase();
  return lower.includes("captcha") ||
    lower.includes("robot check") ||
    lower.includes("automated access") ||
    lower.includes("digite os caracteres");
}

function amazonTemLoginInequivoco(urlFinal = "", html = "") {
  const lower = `${urlFinal}\n${html}`.toLowerCase();
  return /\/ap\/signin|sign-in|signin|login/i.test(String(urlFinal || "")) ||
    lower.includes("iniciar sess");
}

async function testarAmazonComProvaAutenticada(clienteId = "admin", config = {}, deps = {}) {
  const c = credenciais(config);
  const modo = String(config?.modo || c.modo || "cookies").toLowerCase();
  const tagId = tagAmazon(config);
  const cookies = valorTexto(c, ["cookies", "cookie"]);
  const asin = valorTexto(c, ["asinTeste", "asin"]) || ASIN_TESTE_AMAZON;

  if (!tagId) return resultado("amazon", "tag_ausente", { faltandoTag: true, modo }, false);
  if (modo === "api") return null;
  if (!cookies) return resultado("amazon", "cookie_ausente", { faltandoCookies: true, modo }, false);

  const linkBase = `https://www.amazon.com.br/dp/${encodeURIComponent(asin)}`;
  const linkAfiliado = typeof deps.gerarLinkAmazon === "function"
    ? deps.gerarLinkAmazon(clienteId, linkBase, config)
    : (() => {
        const url = new URL(linkBase);
        url.searchParams.set("tag", tagId);
        return url.toString();
      })();

  if (!linkAfiliado || (!linkAfiliado.includes(`tag=${encodeURIComponent(tagId)}`) && !linkAfiliado.includes(`tag=${tagId}`))) {
    return resultado("amazon", "falha_teste", { modo, motivo: "link_afiliado_nao_gerado" }, false);
  }

  try {
    const response = await fetchComTimeout(linkAfiliado, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Cookie: cookies
      }
    });

    const html = await response.text().catch(() => "");
    const urlFinal = response.url || "";
    const lower = `${urlFinal}\n${html}`.toLowerCase();
    const statusHttp = Number(response.status);

    if ([429, 500, 502, 503, 504].includes(statusHttp) || amazonTemBloqueioTransitorio(lower)) {
      return resultado("amazon", "falha_teste", { modo, httpStatus: response.status, motivo: "bloqueio_transitorio" }, false);
    }

    const loginInequivoco = amazonTemLoginInequivoco(urlFinal, html);
    const authInequivoca = loginInequivoco ||
      [401, 419].includes(statusHttp) ||
      (statusHttp === 403 &&
        /cookie expirad|sess[aã]o expirada|credencial|invalid credentials|unauthorized|forbidden|fa[cç]a login|entre na sua conta/i.test(lower));

    if (authInequivoca) {
      return resultado("amazon", "cookie_expirado", { modo, httpStatus: response.status, urlFinal }, false);
    }

    if (!response.ok) {
      return resultado("amazon", "falha_teste", { modo, httpStatus: response.status, urlFinal }, false);
    }

    if (!amazonTemProvaProduto(html)) {
      return resultado("amazon", "falha_teste", { modo, httpStatus: response.status, motivo: "html_sem_prova_produto" }, false);
    }

    return resultado("amazon", "cookie_valido", {
      modo,
      linkAfiliado,
      httpStatus: response.status,
      prova: "produto_autenticado_com_tag"
    }, true);
  } catch (e) {
    return resultado("amazon", "falha_teste", { modo, motivo: erroTransitorio(e) }, false);
  }
}

function urlAliExpressValida(url = "") {
  const valor = String(url || "").trim();
  return ALIEXPRESS_ITEM_URL_RE.test(valor) || ALIEXPRESS_SHORT_URL_RE.test(valor);
}

async function obterUrlAliExpressRecenteObservada(opcoes = {}) {
  const query = opcoes.queryEngine || (() => {
    try {
      return require("../modules/engine/database").queryEngine;
    } catch {
      return null;
    }
  })();

  if (typeof query !== "function") return null;

  const sql = `
    SELECT url_original, url_expandida, url_normalizada
      FROM engine_links
     WHERE criado_em >= NOW() - INTERVAL '7 days'
       AND (
         LOWER(COALESCE(url_original, '')) LIKE '%aliexpress.%/item/%'
         OR LOWER(COALESCE(url_expandida, '')) LIKE '%aliexpress.%/item/%'
         OR LOWER(COALESCE(url_normalizada, '')) LIKE '%aliexpress.%/item/%'
         OR LOWER(COALESCE(url_original, '')) LIKE 'https://a.aliexpress.com/_%'
         OR LOWER(COALESCE(url_expandida, '')) LIKE 'https://a.aliexpress.com/_%'
         OR LOWER(COALESCE(url_normalizada, '')) LIKE 'https://a.aliexpress.com/_%'
       )
     ORDER BY criado_em DESC, id DESC
     LIMIT 20`;

  const resultado = await query(sql);
  if (!resultado?.ok) return null;

  for (const row of resultado.resultado?.rows || []) {
    const candidatos = [row.url_original, row.url_expandida, row.url_normalizada];
    const url = candidatos.find(urlAliExpressValida);
    if (url) return String(url).trim();
  }

  return null;
}

async function origemUrlTesteAliExpress(config = {}) {
  const c = credenciais(config);
  const configurada = valorTexto(c, [
    "urlTeste",
    "linkTeste",
    "healthCheckUrl",
    "urlProdutoTeste",
    "produtoTesteUrl",
    "sourceValueTeste"
  ]);
  if (configurada && urlAliExpressValida(configurada)) return { url: configurada, origem: "configuracao" };

  const env = String(process.env.ALIEXPRESS_HEALTHCHECK_URL || process.env.ALIEXPRESS_URL_TESTE || "").trim();
  if (env && urlAliExpressValida(env)) return { url: env, origem: "env" };

  const recente = await obterUrlAliExpressRecenteObservada(config);
  if (recente) return { url: recente, origem: "engine_links_recente" };

  return {
    url: "",
    origem: configurada ? "configuracao_invalida" : env ? "env_invalida" : "sem_url_real_observada"
  };
}

function diagnosticoUrlAliExpress(url = "") {
  try {
    const parsed = new URL(String(url || ""));
    return {
      host: parsed.hostname,
      path: parsed.pathname
    };
  } catch {
    return {
      host: "url_invalida",
      path: ""
    };
  }
}

function timestampGMT8() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function assinarAliExpress(params, secret) {
  const keys = Object.keys(params).sort();
  let base = secret;
  for (const key of keys) {
    if (key !== "sign") base += key + params[key];
  }
  base += secret;
  return crypto.createHash("md5").update(base, "utf8").digest("hex").toUpperCase();
}

function credenciais(config = {}) {
  return config?.credenciais || config || {};
}

function valorTexto(obj = {}, campos = []) {
  for (const campo of campos) {
    const valor = obj?.[campo];
    if (valor !== undefined && valor !== null && String(valor).trim()) {
      return String(valor).trim();
    }
  }
  return "";
}

function tagMercadoLivre(config = {}) {
  const c = credenciais(config);
  return valorTexto(c, [
    "tag",
    "tagId",
    "tagID",
    "tag_id",
    "codigoAfiliado",
    "trackingId",
    "partnerTag",
    "affiliateTag"
  ]);
}

function tagAmazon(config = {}) {
  const c = credenciais(config);
  return valorTexto(c, [
    "trackingId",
    "partnerTag",
    "tag",
    "tagId",
    "affiliateTag",
    "appId"
  ]);
}

function extrairCsrfMercadoLivre(html = "") {
  const texto = String(html || "");
  const patterns = [
    /x-csrf-token["']?\s*[:=]\s*["']([^"']+)["']/i,
    /name=["']_csrf["'][^>]*value=["']([^"']+)["']/i,
    /value=["']([^"']+)["'][^>]*name=["']_csrf["']/i,
    /csrfToken["']?\s*[:=]\s*["']([^"']+)["']/i,
    /csrf-token["']?\s*content=["']([^"']+)["']/i,
    /_csrf["']?\s*[:=]\s*["']([^"']+)["']/i
  ];

  for (const pattern of patterns) {
    const match = texto.match(pattern);
    if (match?.[1]) return match[1];
  }

  return "";
}

function textoBloqueioMl(texto = "") {
  const lower = String(texto || "").toLowerCase();
  return (
    lower.includes("suspicious-traffic") ||
    lower.includes("account-verification") ||
    lower.includes("captcha") ||
    lower.includes("verificacao") ||
    lower.includes("verificacion")
  );
}

function textoLoginMl(texto = "") {
  const lower = String(texto || "").toLowerCase();
  return (
    lower.includes("/login") ||
    lower.includes("login") ||
    lower.includes("iniciar sess") ||
    lower.includes("entrar na sua conta") ||
    lower.includes("account-verification")
  );
}

async function testarMercadoLivre(config = {}, clienteId = "admin", deps = {}) {
  const provaOficial = await testarMercadoLivreComConversorOficial(clienteId, config, deps);
  if (provaOficial) return provaOficial;

  const c = credenciais(config);
  const cookies = valorTexto(c, ["cookies", "cookie"]);
  const tagId = tagMercadoLivre(config);
  const urlTeste = valorTexto(c, ["urlTeste", "linkTeste"]) || "https://www.mercadolivre.com.br/ofertas";

  if (!tagId) return resultado("mercadolivre", "tag_ausente", { faltandoTag: true }, false);
  if (!cookies) return resultado("mercadolivre", "cookie_ausente", { faltandoCookies: true }, false);

  try {
    const response = await fetchComTimeout("https://www.mercadolivre.com.br/afiliados/linkbuilder", {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Cookie: cookies
      }
    });

    const html = await response.text().catch(() => "");
    const urlFinal = response.url || "";
    const diagnostico = `${urlFinal}\n${html}`;

    if (textoBloqueioMl(diagnostico)) {
      return resultado("mercadolivre", "bloqueio_ml", { httpStatus: response.status, urlFinal }, false);
    }

    if ([401, 419].includes(Number(response.status)) ||
      (Number(response.status) === 403 && textoLoginMl(diagnostico))) {
      return resultado("mercadolivre", "cookie_expirado", { httpStatus: response.status, urlFinal }, false);
    }

    if ([429, 500, 502, 503, 504].includes(Number(response.status)) || !response.ok) {
      return resultado("mercadolivre", "falha_teste", { httpStatus: response.status, urlFinal }, false);
    }

    const csrf = extrairCsrfMercadoLivre(html);
    if (!csrf) {
      return resultado("mercadolivre", "falha_teste", {
        motivo: "csrf_nao_encontrado",
        httpStatus: response.status,
        urlFinal
      }, false);
    }

    const conversao = await fetchComTimeout("https://www.mercadolivre.com.br/affiliate-program/api/v2/stripe/user/links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Origin: "https://www.mercadolivre.com.br",
        Referer: "https://www.mercadolivre.com.br/afiliados/linkbuilder",
        Cookie: cookies,
        "x-csrf-token": csrf
      },
      body: JSON.stringify({ url: urlTeste, tag: tagId })
    });

    const data = await conversao.json().catch(() => null);
    const linkAfiliado = valorTexto(data || {}, ["short_url", "shortUrl", "url"]);

    if ([401, 419].includes(Number(conversao.status))) {
      return resultado("mercadolivre", "cookie_expirado", { httpStatus: conversao.status }, false);
    }

    if (!conversao.ok || !/^https?:\/\/meli\.la\//i.test(linkAfiliado)) {
      return resultado("mercadolivre", "falha_teste", {
        httpStatus: conversao.status,
        linkAfiliado: linkAfiliado || null
      }, false);
    }

    return resultado("mercadolivre", "ok", { linkAfiliado }, true);
  } catch (e) {
    return resultado("mercadolivre", "falha_teste", { motivo: erroTransitorio(e) }, false);
  }
}

async function testarAmazon(config = {}, clienteId = "admin", deps = {}) {
  const provaAutenticada = await testarAmazonComProvaAutenticada(clienteId, config, deps);
  if (provaAutenticada) return provaAutenticada;

  const c = credenciais(config);
  const modo = String(config?.modo || c.modo || "cookies").toLowerCase();
  const tagId = tagAmazon(config);
  const cookies = valorTexto(c, ["cookies", "cookie"]);
  const asin = valorTexto(c, ["asinTeste", "asin"]) || "B07PGL2ZSL";

  if (!tagId) return resultado("amazon", "tag_ausente", { faltandoTag: true, modo }, false);

  if (modo === "api") {
    const accessKey = valorTexto(c, ["accessKey", "access_key"]);
    const secretKey = valorTexto(c, ["secretKey", "secret_key"]);
    if (!accessKey || !secretKey) {
      return resultado("amazon", "credencial_ausente", {
        modo,
        faltandoAccessKey: !accessKey,
        faltandoSecretKey: !secretKey
      }, false);
    }

    return resultado("amazon", "teste_paapi_nao_disponivel", { modo }, false);
  }

  if (!cookies) return resultado("amazon", "cookie_ausente", { faltandoCookies: true, modo }, false);

  try {
    const url = new URL(`https://www.amazon.com.br/dp/${encodeURIComponent(asin)}`);
    url.searchParams.set("tag", tagId);
    const linkAfiliado = url.toString();

    const response = await fetchComTimeout(linkAfiliado, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Cookie: cookies
      }
    });

    const html = await response.text().catch(() => "");
    const urlFinal = response.url || "";
    const lower = `${urlFinal}\n${html}`.toLowerCase();

    if (
      [429, 500, 502, 503, 504].includes(Number(response.status)) ||
      lower.includes("captcha") ||
      lower.includes("robot check") ||
      lower.includes("automated access") ||
      lower.includes("digite os caracteres")
    ) {
      return resultado("amazon", "falha_teste", { modo, httpStatus: response.status, motivo: "bloqueio_transitorio" }, false);
    }

    const statusHttp = Number(response.status);
    const loginInequivoco = /\/ap\/signin|sign-in|signin|login/i.test(urlFinal) ||
      lower.includes("iniciar sess");
    const authInequivoca = loginInequivoco ||
      [401, 419].includes(statusHttp) ||
      (statusHttp === 403 &&
        /cookie expirad|sess[aã]o expirada|credencial|invalid credentials|unauthorized|forbidden|fa[cç]a login|entre na sua conta/i.test(lower));

    if (
      authInequivoca
    ) {
      return resultado("amazon", "cookie_expirado", { modo, httpStatus: response.status, urlFinal }, false);
    }

    if (!response.ok) {
      return resultado("amazon", "falha_teste", { modo, httpStatus: response.status, urlFinal }, false);
    }

    if (!linkAfiliado.includes(`tag=${encodeURIComponent(tagId)}`) && !linkAfiliado.includes(`tag=${tagId}`)) {
      return resultado("amazon", "falha_teste", { modo, linkAfiliado }, false);
    }

    return resultado("amazon", "ok", { modo, linkAfiliado, httpStatus: response.status }, true);
  } catch (e) {
    return resultado("amazon", "falha_teste", { modo, motivo: erroTransitorio(e) }, false);
  }
}

function credenciaisShopee(config = {}) {
  const c = credenciais(config);
  return {
    appId: valorTexto(c, ["appId", "app_id"]),
    secret: valorTexto(c, ["secret", "appSecret", "app_secret"])
  };
}

async function testarShopee(config = {}) {
  const c = credenciaisShopee(config);
  if (!c.appId || !c.secret) {
    return resultado("shopee", "credencial_ausente", {
      faltandoAppId: !c.appId,
      faltandoSecret: !c.secret
    }, false);
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = {
      query: `
        query {
          productOfferV2(keyword: "oferta", page: 1, limit: 1) {
            nodes {
              itemId
              productName
              offerLink
            }
          }
        }
      `
    };
    const payload = JSON.stringify(body);
    const sign = crypto
      .createHash("sha256")
      .update(`${c.appId}${timestamp}${payload}${c.secret}`, "utf8")
      .digest("hex");

    const response = await fetchComTimeout("https://open-api.affiliate.shopee.com.br/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `SHA256 Credential=${c.appId}, Timestamp=${timestamp}, Signature=${sign}`
      },
      body: payload
    });

    const data = await response.json().catch(() => null);
    const erros = Array.isArray(data?.errors) ? data.errors : [];

    if ([429, 500, 502, 503, 504].includes(Number(response.status))) {
      return resultado("shopee", "falha_teste", { httpStatus: response.status }, false);
    }

    if ([401, 403].includes(Number(response.status)) || erros.length) {
      return resultado("shopee", "credencial_invalida", {
        httpStatus: response.status,
        totalErros: erros.length
      }, false);
    }

    if (!response.ok) {
      return resultado("shopee", "falha_teste", { httpStatus: response.status, resposta: data }, false);
    }

    const nodes = data?.data?.productOfferV2?.nodes || [];
    const primeiroLink = String(nodes?.[0]?.offerLink || "").trim();
    if (!/^https?:\/\//i.test(primeiroLink)) {
      return resultado("shopee", "falha_teste", {
        motivo: "offer_link_nao_retornado",
        totalItens: Array.isArray(nodes) ? nodes.length : 0
      }, false);
    }

    return resultado("shopee", "ok", {
      httpStatus: response.status,
      totalItens: nodes.length,
      linkAfiliado: primeiroLink
    }, true);
  } catch (e) {
    return resultado("shopee", "falha_teste", { motivo: erroTransitorio(e) }, false);
  }
}

function credenciaisAwin(config = {}) {
  return normalizarCredenciaisAwin(credenciais(config));
}

function integracaoIdAwin(programa = {}) {
  const advertiserId = String(programa?.advertiserId || programa?.id || "").trim();
  return advertiserId ? `advertiser:${advertiserId}` : "";
}

function programaEstaJoined(programas = [], advertiserId = "") {
  return programas.some(item =>
    String(item?.id || item?.advertiserId || item?.advertiser_id || "") === String(advertiserId)
  );
}

function destinoTesteAwin(programa = {}) {
  const informado = valorTexto(programa, ["urlTeste", "linkTeste", "destinationUrl", "url"]);
  if (informado) return informado;
  const advertiserId = String(programa?.advertiserId || programa?.id || "").trim();
  const nome = String(programa?.nome || programa?.name || programa?.loja || "").toLowerCase();
  if (advertiserId === "17729" || nome.includes("kabum") || nome.includes("ka bum")) {
    return "https://www.kabum.com.br/";
  }
  return "";
}

function extrairLinkAwin(data = {}) {
  return valorTexto(data || {}, ["shortUrl", "url", "link", "trackingLink", "clickUrl"]);
}

async function testarDeeplinkAwin(c = {}, programa = {}, marketplace = "awin") {
  const advertiserId = String(programa?.advertiserId || programa?.id || "").trim();
  const integracaoId = integracaoIdAwin(programa);
  const destinationUrl = destinoTesteAwin(programa);

  if (!advertiserId || !integracaoId) {
    return {
      marketplace,
      integracaoId,
      status: "programa_invalido",
      codigo: "programa_invalido",
      mensagem: MENSAGENS.programa_invalido,
      detalhes: { motivo: "advertiser_id_ausente" }
    };
  }

  if (!/^https?:\/\//i.test(destinationUrl)) {
    return {
      marketplace,
      integracaoId,
      status: "falha_teste",
      codigo: "falha_teste",
      mensagem: MENSAGENS.falha_teste,
      detalhes: { advertiserId, motivo: "destino_teste_awin_indisponivel" }
    };
  }

  const linkbuilder = await fetchComTimeout(
    `https://api.awin.com/publishers/${encodeURIComponent(c.publisherId)}/linkbuilder/generate`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.apiToken}`
      },
      body: JSON.stringify({
        advertiserId: Number(advertiserId),
        destinationUrl
      })
    }
  );
  const linkData = await linkbuilder.json().catch(() => null);
  const link = extrairLinkAwin(linkData);

  if ([401, 403].includes(Number(linkbuilder.status))) {
    return {
      marketplace,
      integracaoId,
      status: "credencial_invalida",
      codigo: "credencial_invalida",
      mensagem: MENSAGENS.credencial_invalida,
      detalhes: { httpStatus: linkbuilder.status, advertiserId }
    };
  }
  if ([429, 500, 502, 503, 504].includes(Number(linkbuilder.status))) {
    return {
      marketplace,
      integracaoId,
      status: "falha_teste",
      codigo: "falha_teste",
      mensagem: MENSAGENS.falha_teste,
      detalhes: { httpStatus: linkbuilder.status, advertiserId }
    };
  }
  if (!linkbuilder.ok || !/^https?:\/\//i.test(link)) {
    return {
      marketplace,
      integracaoId,
      status: "programa_invalido",
      codigo: "programa_invalido",
      mensagem: MENSAGENS.programa_invalido,
      detalhes: { httpStatus: linkbuilder.status, advertiserId }
    };
  }

  return {
    marketplace,
    integracaoId,
    status: "ok",
    codigo: "ok",
    mensagem: MENSAGENS.ok,
    detalhes: { httpStatus: linkbuilder.status, advertiserId, destinationUrl }
  };
}

async function testarAwin(config = {}, marketplace = "awin") {
  const credenciaisOriginais = credenciais(config);
  const c = credenciaisAwin(config);
  if (!c.publisherId || !c.apiToken) {
    return resultado(marketplace, "credencial_ausente", {
      faltandoPublisherId: !c.publisherId,
      faltandoApiToken: !c.apiToken
    }, false);
  }

  try {
    const url = new URL(`https://api.awin.com/publishers/${encodeURIComponent(c.publisherId)}/programmes`);
    url.searchParams.set("relationship", "joined");

    const response = await fetchComTimeout(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${c.apiToken}`
      }
    });
    const data = await response.json().catch(() => null);

    if ([401, 403].includes(Number(response.status))) {
      return resultado(marketplace, "credencial_invalida", { httpStatus: response.status }, false);
    }

    if ([429, 500, 502, 503, 504].includes(Number(response.status))) {
      return resultado(marketplace, "falha_teste", { httpStatus: response.status }, false);
    }

    if (!response.ok) {
      return resultado(marketplace, "falha_teste", { httpStatus: response.status }, false);
    }

    if (marketplace === "kabum") {
      const programa = obterProgramaAwin(c, "kabum");
      const advertiserId = programa?.advertiserId || "";
      const programas = Array.isArray(data) ? data : [];
      const integracaoId = integracaoIdAwin(programa);

      if (!advertiserId) {
        return resultado("kabum", "programa_invalido", { motivo: "kabum_sem_advertiser_id" }, false);
      }

      const programaJoined = programaEstaJoined(programas, advertiserId);
      if (programas.length && !programaJoined) {
        return resultado("kabum", "programa_invalido", { advertiserId, integracaoId }, false);
      }

      const prova = await testarDeeplinkAwin(c, programa, "kabum");
      if (prova.status !== "ok") {
        return resultado("kabum", prova.codigo, { ...(prova.detalhes || {}), advertiserId, integracaoId }, false);
      }

      return resultado("kabum", "ok", {
        httpStatus: prova.detalhes?.httpStatus,
        totalProgramas: programas.length,
        advertiserId,
        integracaoId
      }, true);
    }

    const programas = Array.isArray(data) ? data : [];
    const possuiProgramaDeclarado = Array.isArray(credenciaisOriginais.programas) ||
      Boolean(credenciaisOriginais.advertiserId || credenciaisOriginais.loja);
    const filhos = [];
    if (possuiProgramaDeclarado && Array.isArray(c.programas)) {
      for (const programa of c.programas.filter(item => item?.ativo !== false && integracaoIdAwin(item))) {
        const advertiserId = String(programa.advertiserId || "").trim();
        const joined = programaEstaJoined(programas, advertiserId);
        if (programas.length && !joined) {
          filhos.push({
            marketplace: "awin",
            integracaoId: integracaoIdAwin(programa),
            status: "programa_invalido",
            codigo: "programa_invalido",
            mensagem: MENSAGENS.programa_invalido,
            detalhes: { advertiserId, programa: programa.nome || "" }
          });
          continue;
        }
        filhos.push(await testarDeeplinkAwin(c, programa, "awin"));
      }
    }

    if (possuiProgramaDeclarado && !filhos.length) {
      return resultado(marketplace, "programa_invalido", {
        httpStatus: response.status,
        motivo: "programa_teste_nao_configurado"
      }, false);
    }

    const algumInvalido = filhos.some(item => ["programa_invalido", "credencial_invalida"].includes(item.status));
    const algumInconclusivo = filhos.some(item => item.status === "falha_teste");
    const codigoAgregado = algumInvalido ? "programa_invalido" : (algumInconclusivo ? "falha_teste" : "ok");

    const agregado = resultado(marketplace, codigoAgregado, {
      httpStatus: response.status,
      totalProgramas: programas.length,
      ...(filhos.length === 1 && filhos[0]?.integracaoId ? { integracaoId: filhos[0].integracaoId } : {})
    }, codigoAgregado === "ok", algumInvalido ? MENSAGENS.programa_invalido : "");
    agregado.saudeFilhas = filhos;
    return agregado;
  } catch (e) {
    return resultado(marketplace, "falha_teste", { motivo: erroTransitorio(e) }, false);
  }
}

async function testarAliExpress(config = {}) {
  const c = credenciais(config);
  const appKey = valorTexto(c, ["appKey", "app_key"]);
  const secret = valorTexto(c, ["secret", "appSecret", "app_secret"]);
  const trackingId = valorTexto(c, ["trackingId", "tracking_id"]);

  if (!appKey || !secret || !trackingId) {
    return resultado("aliexpress", "credencial_ausente", {
      faltandoAppKey: !appKey,
      faltandoSecret: !secret,
      faltandoTrackingId: !trackingId
    }, false);
  }

  try {
    const urlProva = await origemUrlTesteAliExpress(config);
    if (!urlProva.url) {
      return resultado("aliexpress", "falha_teste", {
        motivo: "url_prova_aliexpress_indisponivel",
        provaOrigem: urlProva.origem
      }, false);
    }

    const diagnosticoUrl = diagnosticoUrlAliExpress(urlProva.url);
    const params = {
      method: "aliexpress.affiliate.link.generate",
      app_key: appKey,
      timestamp: timestampGMT8(),
      sign_method: "md5",
      format: "json",
      v: "2.0",
      promotion_link_type: "0",
      source_values: urlProva.url,
      tracking_id: trackingId
    };
    params.sign = assinarAliExpress(params, secret);

    const response = await fetchComTimeout("https://api-sg.aliexpress.com/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
      },
      body: new URLSearchParams(params)
    });
    const data = await response.json().catch(() => null);
    const erro = data?.error_response ||
      data?.aliexpress_affiliate_link_generate_response?.resp_result?.error_response ||
      null;
    const codigoApi = erro?.code || data?.code || "";
    const mensagemApi = String(erro?.msg || erro?.sub_msg || data?.msg || "").toLowerCase();

    if ([401, 403].includes(Number(response.status)) || /invalid|secret|signature|app.?key|permission|auth/i.test(`${codigoApi} ${mensagemApi}`)) {
      return resultado("aliexpress", "credencial_invalida", {
        httpStatus: response.status,
        codigoApi: String(codigoApi || ""),
        motivo: "credencial_invalida",
        provaOrigem: urlProva.origem,
        provaHost: diagnosticoUrl.host,
        provaPath: diagnosticoUrl.path
      }, false);
    }

    if ([429, 500, 502, 503, 504].includes(Number(response.status)) || !response.ok || erro) {
      return resultado("aliexpress", "falha_teste", {
        httpStatus: response.status,
        codigoApi: String(codigoApi || ""),
        motivo: erro ? "api_retornou_erro" : "erro_transitorio_api",
        provaOrigem: urlProva.origem,
        provaHost: diagnosticoUrl.host,
        provaPath: diagnosticoUrl.path
      }, false);
    }

    const link =
      data?.aliexpress_affiliate_link_generate_response?.resp_result?.result?.promotion_links?.promotion_link?.[0]?.promotion_link ||
      data?.resp_result?.result?.promotion_links?.promotion_link?.[0]?.promotion_link ||
      data?.result?.promotion_links?.promotion_link?.[0]?.promotion_link ||
      "";

    if (!/^https?:\/\//i.test(String(link || ""))) {
      return resultado("aliexpress", "falha_teste", {
        motivo: "promotion_link_nao_retornado",
        codigoApi: String(codigoApi || ""),
        provaOrigem: urlProva.origem,
        provaHost: diagnosticoUrl.host,
        provaPath: diagnosticoUrl.path
      }, false);
    }

    return resultado("aliexpress", "ok", {
      httpStatus: response.status,
      provaOrigem: urlProva.origem,
      provaHost: diagnosticoUrl.host,
      provaPath: diagnosticoUrl.path,
      promocaoGerada: true
    }, true);
  } catch (e) {
    return resultado("aliexpress", "falha_teste", { motivo: erroTransitorio(e) }, false);
  }
}

async function testarIntegracaoMarketplace(clienteId = "admin", marketplace = "", integracao = {}, deps = {}) {
  const mp = normalizarMarketplace(marketplace);
  const config = integracao || {};

  if (!config && mp !== "kabum") {
    return resultado(mp, "credencial_ausente", { clienteId, motivo: "integracao_nao_configurada" }, false);
  }

  if (mp === "mercadolivre") return testarMercadoLivre(config, clienteId, deps);
  if (mp === "amazon") return testarAmazon(config, clienteId, deps);
  if (mp === "shopee") return testarShopee(config);
  if (mp === "awin") return testarAwin(config, "awin");
  if (mp === "kabum") return testarAwin(config, "kabum");
  if (mp === "aliexpress") return testarAliExpress(config);
  if (mp === "magalu") return resultado("magalu", "teste_magalu_nao_disponivel", {}, false);

  return resultado(mp, "marketplace_nao_suportado", { clienteId }, false);
}

module.exports = {
  testarIntegracaoMarketplace,
  normalizarMarketplaceIntegracaoTeste: normalizarMarketplace
};
