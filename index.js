require("dotenv").config();

const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: "10mb" }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300
}));

let sessoes = {};
let qrCodes = {};
let statusSessao = {};
let destinosPorSessao = {};
let reconectando = {};
let integracoesPorCliente = {};
let automacoesPorCliente = {};
let historicoOfertasPorCliente = {};

const DADOS_FILE = process.env.DADOS_FILE || "dados_saas.json";

function carregarDadosPersistidos() {
  try {
    if (!fs.existsSync(DADOS_FILE)) return;

    const raw = fs.readFileSync(DADOS_FILE, "utf8");
    if (!raw) return;

    const data = JSON.parse(raw);

    if (data?.integracoesPorCliente && typeof data.integracoesPorCliente === "object") {
      integracoesPorCliente = data.integracoesPorCliente;
    }

    if (data?.destinosPorSessao && typeof data.destinosPorSessao === "object") {
      destinosPorSessao = data.destinosPorSessao;
    }

    if (data?.automacoesPorCliente && typeof data.automacoesPorCliente === "object") {
      automacoesPorCliente = data.automacoesPorCliente;
    }

    if (data?.historicoOfertasPorCliente && typeof data.historicoOfertasPorCliente === "object") {
      historicoOfertasPorCliente = data.historicoOfertasPorCliente;
    }

    console.log("✅ Dados persistidos carregados");
  } catch (e) {
    console.error("ERRO AO CARREGAR DADOS PERSISTIDOS:", e.message);
  }
}

function salvarDadosPersistidos() {
  try {
    const payload = {
      integracoesPorCliente,
      destinosPorSessao,
      automacoesPorCliente,
      historicoOfertasPorCliente,
      atualizadoEm: new Date().toISOString()
    };

    const tempFile = `${DADOS_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tempFile, DADOS_FILE);

    console.log("✅ Dados persistidos salvos");
  } catch (e) {
    console.error("ERRO AO SALVAR DADOS PERSISTIDOS:", e.message);
  }
}

carregarDadosPersistidos();

const ADMIN_USER = "admin";
const ADMIN_PASS_HASH = bcrypt.hashSync("123456", 10);
const JWT_SECRET = process.env.JWT_SECRET || "segredo";

function gerarToken() {
  return jwt.sign(
    { admin: true, clienteId: "admin" },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function getClienteId(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) return "admin";

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.clienteId || "admin";
  } catch {
    return "admin";
  }
}

function auth(req, res, next) {
  if (
    req.path === "/" ||
    req.path === "/login" ||
    req.path === "/conectar" ||
    req.path.startsWith("/qr") ||
    req.path.startsWith("/status") ||
    req.path.startsWith("/reset")
  ) {
    return next();
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ erro: "Token inválido" });

  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ erro: "Não autorizado" });
  }
}

app.use(auth);

// ================= LOGIN =================

app.post("/login", async (req, res) => {
  const { user, pass } = req.body;

  if (user !== ADMIN_USER) {
    return res.status(401).json({ erro: "Usuário inválido" });
  }

  const ok = await bcrypt.compare(pass, ADMIN_PASS_HASH);

  if (!ok) {
    return res.status(401).json({ erro: "Senha inválida" });
  }

  return res.json({
    ok: true,
    token: gerarToken()
  });
});

app.get("/", (req, res) => {
  res.json({
    status: "API ONLINE",
    uptime: process.uptime()
  });
});

// ================= INTEGRAÇÕES =================

const marketplaceRules = {
  shopee: {
    nome: "Shopee",
    required: ["appId", "secret"],
    allowed: ["appId", "secret"]
  },
  amazon: {
    nome: "Amazon",
    modes: {
      api: {
        required: ["appId", "accessKey", "secretKey"],
        allowed: ["modo", "appId", "accessKey", "secretKey"]
      },
      cookies: {
        required: ["cookies"],
        allowed: ["modo", "appId", "cookies"]
      }
    }
  },
 mercadolivre: {
  nome: "Mercado Livre",
  required: ["cookies", "tag"],
  allowed: ["cookies", "tag"]
},
  aliexpress: {
    nome: "AliExpress",
    required: ["appKey", "secret", "trackingId"],
    allowed: ["appKey", "secret", "trackingId"]
  },
  awin: {
  nome: "Awin",
  required: ["publisherId", "apiToken", "loja"],
  allowed: ["publisherId", "apiToken", "loja"]
}
};

function limparCredencial(config, allowed) {
  const clean = {};
  for (const field of allowed) {
    if (config[field] !== undefined && config[field] !== null) {
      clean[field] = String(config[field]).trim();
    }
  }
  return clean;
}

function validarIntegracao(marketplace, body) {
  const rule = marketplaceRules[marketplace];

  if (!rule) return { ok: false, erro: "Marketplace não suportado" };

  if (marketplace === "amazon") {
    const modo = body.modo || "api";
    const modeRule = rule.modes[modo];

    if (!modeRule) return { ok: false, erro: "Modo Amazon inválido" };

    const missing = modeRule.required.filter((field) => !body[field]);

    if (missing.length) {
      return {
        ok: false,
        erro: "Campos obrigatórios ausentes",
        campos: missing
      };
    }

    return {
      ok: true,
      modo,
      clean: limparCredencial({ ...body, modo }, modeRule.allowed)
    };
  }

  const missing = rule.required.filter((field) => !body[field]);

  if (missing.length) {
    return {
      ok: false,
      erro: "Campos obrigatórios ausentes",
      campos: missing
    };
  }
  return {
    ok: true,
    clean: limparCredencial(body, rule.allowed)
  };
}

function mascararIntegracao(config) {
  const masked = { ...config };

  for (const key of Object.keys(masked)) {
    if (
      key.toLowerCase().includes("secret") ||
      key.toLowerCase().includes("key") ||
      key.toLowerCase().includes("token") ||
      key.toLowerCase().includes("cookies")
    ) {
      masked[key] = "•••••••• configurado";
    }
  }

  return masked;
}

app.get("/integracoes", (req, res) => {
  const clienteId = getClienteId(req);
  const data = integracoesPorCliente[clienteId] || {};
  const resposta = {};

  for (const [marketplace, config] of Object.entries(data)) {
    resposta[marketplace] = {
      marketplace,
      nome: marketplaceRules[marketplace]?.nome || marketplace,
      configurado: true,
      status: config.status || "configurado",
      credenciais: mascararIntegracao(config.credenciais || {}),
      atualizadoEm: config.atualizadoEm
    };
  }

  return res.json({
    ok: true,
    clienteId,
    integracoes: resposta
  });
});

app.post("/integracoes/:marketplace", (req, res) => {
  const clienteId = getClienteId(req);
  const marketplace = req.params.marketplace.toLowerCase();

  const validacao = validarIntegracao(marketplace, req.body);

  if (!validacao.ok) return res.status(400).json(validacao);

  if (!integracoesPorCliente[clienteId]) {
    integracoesPorCliente[clienteId] = {};
  }

  integracoesPorCliente[clienteId][marketplace] = {
    marketplace,
    nome: marketplaceRules[marketplace]?.nome || marketplace,
    modo: validacao.modo || req.body.modo || null,
    credenciais: validacao.clean,
    status: "configurado",
    atualizadoEm: new Date().toISOString()
  };

  salvarDadosPersistidos();

  return res.json({
    ok: true,
    message: `${marketplace} configurado com sucesso`,
    marketplace,
    status: "configurado"
  });
});

app.post("/integracoes/:marketplace/test", (req, res) => { 
  const clienteId = getClienteId(req);
  const marketplace = req.params.marketplace.toLowerCase();
  const config = integracoesPorCliente[clienteId]?.[marketplace];

  if (!config) {
    return res.status(400).json({
      ok: false,
      erro: "Integração não configurada"
    });
  }

  return res.json({
    ok: true,
    marketplace,
    status: "conectado",
    message: `${config.nome || marketplace} configurado.`
  });
});

app.delete("/integracoes/:marketplace", (req, res) => {
  const clienteId = getClienteId(req);
  const marketplace = req.params.marketplace.toLowerCase();

  if (integracoesPorCliente[clienteId]?.[marketplace]) {
    delete integracoesPorCliente[clienteId][marketplace];
  }

  salvarDadosPersistidos();

  return res.json({
    ok: true,
    message: `${marketplace} removido com sucesso`,
    marketplace
  });
});

// ================= DESTINOS / AUTOMAÇÃO BASE =================

app.get("/automacao/config", (req, res) => {
  const clienteId = getClienteId(req);

  return res.json({
    ok: true,
    clienteId,
    config: automacoesPorCliente[clienteId] || {
      ativa: false,
      marketplaces: [],
      palavrasChave: [],
      intervaloMinutos: 30,
      horarioInicio: 8,
      horarioFim: 22,
      descontoMinimo: 0,
      precoMaximo: null,
      evitarRepetidos: true
    }
  });
});

app.post("/automacao/config", (req, res) => {
  const clienteId = getClienteId(req);

  const configAtual = automacoesPorCliente[clienteId] || {};

  automacoesPorCliente[clienteId] = {
    ...configAtual,
    ativa: Boolean(req.body.ativa),
    marketplaces: Array.isArray(req.body.marketplaces) ? req.body.marketplaces : [],
    palavrasChave: Array.isArray(req.body.palavrasChave) ? req.body.palavrasChave : [],
    intervaloMinutos: Number(req.body.intervaloMinutos || 30),
    horarioInicio: Number(req.body.horarioInicio || 8),
    horarioFim: Number(req.body.horarioFim || 22),
    descontoMinimo: Number(req.body.descontoMinimo || 0),
    precoMaximo: req.body.precoMaximo === null || req.body.precoMaximo === undefined || req.body.precoMaximo === ""
      ? null
      : Number(req.body.precoMaximo),
    evitarRepetidos: req.body.evitarRepetidos !== false,
    atualizadoEm: new Date().toISOString()
  };

  salvarDadosPersistidos();

  return res.json({
    ok: true,
    message: "Configuração de automação salva",
    config: automacoesPorCliente[clienteId]
  });
});

app.get("/automacao/historico", (req, res) => {
  const clienteId = getClienteId(req);

  return res.json({
    ok: true,
    clienteId,
    historico: historicoOfertasPorCliente[clienteId] || []
  });
});

app.delete("/automacao/historico", (req, res) => {
  const clienteId = getClienteId(req);
  historicoOfertasPorCliente[clienteId] = [];

  salvarDadosPersistidos();

  return res.json({
    ok: true,
    message: "Histórico de ofertas limpo"
  });
});

// ================= HELPERS DE IMPORTAÇÃO =================

function htmlDecode(str) {
  if (!str) return "";
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .trim();
}

function extrairMeta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["'][^>]*>`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return htmlDecode(match[1]);
  }

  return "";
}
function extrairJsonLd(html) {
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const match of matches) {
    try {
      const raw = htmlDecode(match[1]);
      const data = JSON.parse(raw);

      if (Array.isArray(data)) {
        const product = data.find((x) => x["@type"] === "Product");
        if (product) return product;
      }

      if (data["@type"] === "Product") return data;

      if (data["@graph"]) {
        const product = data["@graph"].find((x) => x["@type"] === "Product");
        if (product) return product;
      }
    } catch {}
  }

  return null;
}

function limparPreco(valor) {
  if (!valor) return "";

  let texto = String(valor).trim();

  texto = texto
    .replace("R$", "")
    .replace(/\s/g, "");

  if (/^\d+\.\d{1,2}$/.test(texto)) {
    const numero = Number(texto);
    return numero.toFixed(2).replace(".", ",");
  }

  if (texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
    const numero = Number(texto);
    if (!Number.isFinite(numero)) return "";
    return numero.toFixed(2).replace(".", ",");
  }

  texto = texto.replace(/\D/g, "");

  if (!texto) return "";

  let numero = Number(texto);

  if (numero > 10000) {
    numero = numero / 100;
  }

  return numero.toFixed(2).replace(".", ",");
}

function corrigirImagemUrl(imagem) {
  if (!imagem || typeof imagem !== "string") return null;

  let imagemFinal = imagem.trim();

  if (!imagemFinal.startsWith("http")) return null;

  if (imagemFinal.includes(".webp")) {
    imagemFinal = imagemFinal.replace(".webp", ".jpg");
  }

  return imagemFinal;
}

async function buscarCsrfTokenMercadoLivre(cookies) {
  try {
    if (!cookies) return "";

    const response = await fetch(
      "https://www.mercadolivre.com.br/afiliados/linkbuilder",
      {
        method: "GET",
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Cookie": cookies
        }
      }
    );

    const html = await response.text();

    const patterns = [
      /x-csrf-token["']?\s*[:=]\s*["']([^"']+)["']/i,
      /csrfToken["']?\s*[:=]\s*["']([^"']+)["']/i,
      /csrf-token["']?\s*content=["']([^"']+)["']/i,
      /_csrf["']?\s*[:=]\s*["']([^"']+)["']/i
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return match[1];
    }

    console.log("ML CSRF: token não encontrado automaticamente");
    return "";
  } catch (e) {
    console.error("ERRO BUSCAR CSRF ML:", e.message);
    return "";
  }
}

async function gerarLinkAfiliadoMercadoLivre(url, config) {
  try {
    const credenciais = config?.credenciais || {};

    const cookies = credenciais.cookies || "";
    const tag = credenciais.tag || "";

    if (!url || !cookies || !tag) {
      console.log("ML AFILIADO: faltando cookies ou tag");
      return "";
    }

    const csrfToken = await buscarCsrfTokenMercadoLivre(cookies);

    if (!csrfToken) {
      console.log("ML AFILIADO: csrfToken automático não encontrado");
      return "";
    }

    const response = await fetch(
      "https://www.mercadolivre.com.br/affiliate-program/api/v2/stripe/user/links",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Origin": "https://www.mercadolivre.com.br",
          "Referer": "https://www.mercadolivre.com.br/afiliados/linkbuilder",
          "Cookie": cookies,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          url,
          tag
        })
      }
    );

    const data = await response.json().catch(() => null);

    console.log("ML AFILIADO RESPONSE:", JSON.stringify(data));

    if (!response.ok) {
      console.log("ML AFILIADO ERRO STATUS:", response.status);
      return "";
    }

    return data?.short_url || data?.shortUrl || data?.url || "";
  } catch (e) {
    console.error("ERRO ML AFILIADO:", e.message);
    return "";
  }
}
async function importarMercadoLivre(url, config) {
  const cookies = config?.credenciais?.cookies || "";

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cookie": cookies
    }
  });

  const html = await response.text();

  const jsonLd = extrairJsonLd(html);

  const titulo =
    jsonLd?.name ||
    extrairMeta(html, "og:title") ||
    extrairMeta(html, "twitter:title") ||
    "Produto Mercado Livre";

  let preco =
    jsonLd?.offers?.price ||
    extrairMeta(html, "product:price:amount") ||
    extrairMeta(html, "og:price:amount") ||
    "";

  const imagem =
    (Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image) ||
    extrairMeta(html, "og:image") ||
    extrairMeta(html, "twitter:image") ||
    "";

  preco = limparPreco(preco);

  let precoNumero = Number(String(preco).replace(",", "."));
  let precoAntigo = "";

  if (Number.isFinite(precoNumero) && precoNumero > 0) {
    precoAntigo = (precoNumero * 1.52)
      .toFixed(2)
      .replace(".", ",");
  }

  const linkAfiliadoGerado = await gerarLinkAfiliadoMercadoLivre(url, config);

  return {
    marketplace: "mercadolivre",
    titulo: htmlDecode(titulo).replace(" | MercadoLivre", "").replace(" | Mercado Livre", ""),
    precoAntigo,
    precoAtual: preco,
    cupom: "",
    linkOriginal: url,
    linkAfiliado: linkAfiliadoGerado || url,
    imagem: corrigirImagemUrl(imagem) || imagem,
    categoria: "Mercado Livre"
  };
}

async function importarAmazon(url, config) {
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  const cookies = config?.credenciais?.cookies || "";

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cookie": cookies
    }
  });

  const html = await response.text();
  const jsonLd = extrairJsonLd(html);

  function limparHtml(texto) {
    if (!texto) return "";
    return htmlDecode(String(texto).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }

  function primeiroMatch(regex) {
    const match = html.match(regex);
    return match?.[1] ? limparHtml(match[1]) : "";
  }

  function todosPrecosDoHtml() {
    const encontrados = [];
    const regex = /R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})|R\$\s*\d+(?:,\d{2})?/g;
    const matches = html.match(regex) || [];

    for (const item of matches) {
      const precoLimpo = limparPreco(item);
      const numero = Number(String(precoLimpo).replace(",", "."));

      if (Number.isFinite(numero) && numero > 0) {
        encontrados.push({ texto: precoLimpo, numero });
      }
    }

    return encontrados;
  }

  function extrairImagemAmazon() {
    const imagemMeta =
      (Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image) ||
      extrairMeta(html, "og:image") ||
      extrairMeta(html, "twitter:image") ||
      html.match(/id=["']landingImage["'][^>]+src=["']([^"']+)["']/i)?.[1] ||
      html.match(/data-old-hires=["']([^"']+)["']/i)?.[1] ||
      "";

    if (imagemMeta) return htmlDecode(imagemMeta).replace(/\\u002F/g, "/");

    const dynamicImageRaw =
      html.match(/data-a-dynamic-image=["']([^"']+)["']/i)?.[1] ||
      "";

    if (dynamicImageRaw) {
      try {
        const decoded = htmlDecode(dynamicImageRaw).replace(/\\u002F/g, "/");
        const parsed = JSON.parse(decoded);
        const primeira = Object.keys(parsed || {})[0];

        if (primeira) return primeira;
      } catch {}
    }

    const hiRes =
      html.match(/"hiRes"\s*:\s*"([^"]+)"/i)?.[1] ||
      html.match(/"large"\s*:\s*"([^"]+)"/i)?.[1] ||
      "";

    return hiRes ? hiRes.replace(/\\u002F/g, "/") : "";
  }

  const titulo =
    jsonLd?.name ||
    extrairMeta(html, "og:title") ||
    extrairMeta(html, "twitter:title") ||
    primeiroMatch(/<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i) ||
    "Produto Amazon";

  const precoOffscreenAtual =
    primeiroMatch(/id=["']corePriceDisplay_desktop_feature_div["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
    primeiroMatch(/id=["']corePrice_feature_div["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
    primeiroMatch(/class=["'][^"']*priceToPay[^"']*["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
    primeiroMatch(/id=["']apex_desktop["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);

  const precoWholeFractionMatch =
    html.match(/class=["'][^"']*a-price-whole[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?class=["'][^"']*a-price-fraction[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);

  let preco =
    precoOffscreenAtual ||
    jsonLd?.offers?.price ||
    extrairMeta(html, "product:price:amount") ||
    extrairMeta(html, "og:price:amount") ||
    (precoWholeFractionMatch ? `${limparHtml(precoWholeFractionMatch[1])},${limparHtml(precoWholeFractionMatch[2])}` : "") ||
    primeiroMatch(/id=["']priceblock_ourprice["'][^>]*>([\s\S]*?)<\/span>/i) ||
    primeiroMatch(/id=["']priceblock_dealprice["'][^>]*>([\s\S]*?)<\/span>/i) ||
    "";

  preco = limparPreco(htmlDecode(preco));

  const precosEncontrados = todosPrecosDoHtml();

  if (!preco && precosEncontrados.length) {
    const menorPreco = precosEncontrados
      .map((p) => p.numero)
      .filter((n) => n > 1)
      .sort((a, b) => a - b)[0];

    if (menorPreco) {
      preco = menorPreco.toFixed(2).replace(".", ",");
    }
  }

  let precoAntigoRaw =
    primeiroMatch(/class=["'][^"']*a-text-price[^"']*["'][^>]*>[\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
    primeiroMatch(/data-a-strike=["']true["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
    "";

  let precoAntigo = limparPreco(htmlDecode(precoAntigoRaw));

  if (!precoAntigo && precosEncontrados.length && preco) {
    const precoAtualNumero = Number(String(preco).replace(",", "."));
    const maiorPreco = precosEncontrados
      .map((p) => p.numero)
      .filter((n) => Number.isFinite(n) && n > precoAtualNumero)
      .sort((a, b) => b - a)[0];

    if (maiorPreco) {
      precoAntigo = maiorPreco.toFixed(2).replace(".", ",");
    }
  }

  if (!precoAntigo) {
    const precoNumero = Number(String(preco).replace(",", "."));
    if (Number.isFinite(precoNumero) && precoNumero > 0) {
      precoAntigo = (precoNumero * 1.2)
        .toFixed(2)
        .replace(".", ",");
    }
  }

  const imagem = extrairImagemAmazon();

  let linkAfiliado = url;
  const trackingId =
    config?.credenciais?.trackingId ||
    config?.credenciais?.partnerTag ||
    config?.credenciais?.appId ||
    "";

  if (trackingId) {
    try {
      const u = new URL(url);
      u.searchParams.set("tag", trackingId);
      linkAfiliado = u.toString();
    } catch {
      linkAfiliado = url;
    }
  }

  return {
    marketplace: "amazon",
    titulo: htmlDecode(titulo)
      .replace("Amazon.com.br:", "")
      .replace("Amazon.com:", "")
      .trim(),
    precoAntigo,
    precoAtual: preco,
    cupom: "",
    linkOriginal: url,
    linkAfiliado,
    imagem: corrigirImagemUrl(imagem) || imagem,
    categoria: "Amazon"
  };
}
async function importarShopee(url, config) {
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  const { appId, secret } = config.credenciais || {};

  function normalizarPrecoShopee(valor) {
    if (!valor) return "";

    let texto = String(valor).trim();

    if (texto.includes(",")) return limparPreco(texto);

    if (/^\d+\.\d{2}$/.test(texto)) {
      return Number(texto).toFixed(2).replace(".", ",");
    }

    if (/^\d+$/.test(texto)) {
      let numero = Number(texto);

      if (numero > 100000) {
        numero = numero / 100000;
      } else if (numero > 1000) {
        numero = numero / 100;
      }

      return numero.toFixed(2).replace(".", ",");
    }

    return limparPreco(texto);
  }

  function extrairIdsShopee(link) {
    const texto = String(link || "");

    const match1 = texto.match(/-i\.(\d+)\.(\d+)/i);
    if (match1) {
      return {
        shopId: match1[1],
        itemId: match1[2]
      };
    }

    const match2 = texto.match(/i\.(\d+)\.(\d+)/i);
    if (match2) {
      return {
        shopId: match2[1],
        itemId: match2[2]
      };
    }

    return {
      shopId: "",
      itemId: ""
    };
  }

  function gerarKeywordShopee(link) {
    try {
      const semQuery = String(link).split("?")[0];
      const parte = decodeURIComponent(semQuery.split("/").pop() || "");
      const antesDoId = parte.split("-i.")[0] || parte;

      return antesDoId
        .replace(/-/g, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
    } catch {
      return "";
    }
  }

  async function chamarShopeeGraphQL(bodyPayload) {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify(bodyPayload);

    const baseString = `${appId}${timestamp}${payload}${secret}`;

    const sign = crypto
      .createHash("sha256")
      .update(baseString, "utf8")
      .digest("hex");

    const response = await fetch(
      "https://open-api.affiliate.shopee.com.br/graphql",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${sign}`
        },
        body: payload
      }
    );

    const data = await response.json();

    console.log("SHOPEE RESPONSE:", JSON.stringify(data));

    return data;
  }

  const ids = extrairIdsShopee(url);
  const keyword = gerarKeywordShopee(url);

  let produto = null;

  // 1) Tenta buscar pelo itemId do próprio link
  if (ids.itemId) {
    try {
      const bodyPayload = {
        query: `
          query {
            productOfferV2(
              itemId: ${ids.itemId},
              page: 1,
              limit: 10
            ) {
              nodes {
                itemId
                productName
                productLink
                offerLink
                imageUrl
                priceMin
                priceMax
                priceDiscountRate
                sales
                ratingStar
                commissionRate
                shopId
                shopName
              }
            }
          }
        `
      };

      const data = await chamarShopeeGraphQL(bodyPayload);
      const nodes = data?.data?.productOfferV2?.nodes || [];

      produto =
        nodes.find((p) => String(p.itemId) === String(ids.itemId)) ||
        nodes[0] ||
        null;
    } catch (e) {
      console.error("SHOPEE ITEMID ERRO:", e.message);
    }
  }

  // 2) Se não achou, tenta por keyword do link
  if (!produto && keyword) {
    try {
      const bodyPayload = {
        query: `
          query {
            productOfferV2(
              keyword: ${JSON.stringify(keyword)},
              listType: 0,
              sortType: 2,
              page: 1,
              limit: 20
            ) {
              nodes {
                itemId
                productName
                productLink
                offerLink
                imageUrl
                priceMin
                priceMax
                priceDiscountRate
                sales
                ratingStar
                commissionRate
                shopId
                shopName
              }
            }
          }
        `
      };

      const data = await chamarShopeeGraphQL(bodyPayload);
      const nodes = data?.data?.productOfferV2?.nodes || [];

      produto = nodes[0] || null;
    } catch (e) {
      console.error("SHOPEE KEYWORD ERRO:", e.message);
    }
  }

  // 3) Se a API não encontrou, fallback simples pelo HTML
  if (!produto) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });

      const html = await response.text();

      const titulo =
        extrairMeta(html, "og:title") ||
        extrairMeta(html, "twitter:title") ||
        keyword ||
        "Produto Shopee";

      const imagem =
        extrairMeta(html, "og:image") ||
        extrairMeta(html, "twitter:image") ||
        "";

      return {
        marketplace: "shopee",
        titulo: htmlDecode(titulo)
          .replace(" | Shopee Brasil", "")
          .replace(" | Shopee", "")
          .trim(),
        precoAntigo: "",
        precoAtual: "",
        cupom: "",
        linkOriginal: url,
        linkAfiliado: url,
        imagem: corrigirImagemUrl(imagem) || imagem,
        categoria: "Shopee"
      };
    } catch (e) {
      console.error("SHOPEE HTML ERRO:", e.message);
    }
  }

  const precoMin = normalizarPrecoShopee(produto?.priceMin || "");
  const precoMax = normalizarPrecoShopee(produto?.priceMax || "");

  let precoAtual = "";
  let precoAntigo = "";

  const minNumero = Number(String(precoMin).replace(",", "."));
  const maxNumero = Number(String(precoMax).replace(",", "."));

  const temMin = Number.isFinite(minNumero) && minNumero > 0;
  const temMax = Number.isFinite(maxNumero) && maxNumero > 0;

  if (temMin && temMax && minNumero !== maxNumero) {
    precoAtual = `${precoMin} a ${precoMax}`;

    // Produto com variação: não inventa preço antigo automático
    precoAntigo = "";
  } else {
    precoAtual = precoMin || precoMax || "";

    const desconto = Number(produto?.priceDiscountRate || 0);
    const precoNumero = Number(String(precoAtual).replace(",", "."));

    if (Number.isFinite(precoNumero) && desconto > 0 && desconto < 80) {
      precoAntigo = (precoNumero / (1 - desconto / 100))
        .toFixed(2)
        .replace(".", ",");
    } else {
      precoAntigo = "";
    }
  }

  let imagem = produto?.imageUrl || "";
  imagem = htmlDecode(imagem).replace(/\\u002F/g, "/");

  if (imagem && imagem.startsWith("//")) {
    imagem = "https:" + imagem;
  }

  return {
    marketplace: "shopee",
    titulo: htmlDecode(produto?.productName || keyword || "Produto Shopee")
      .replace(" | Shopee Brasil", "")
      .replace(" | Shopee", "")
      .trim(),
    precoAntigo,
    precoAtual,
    cupom: "",
    linkOriginal: url,
    linkAfiliado: produto?.offerLink || produto?.productLink || url,
    imagem: corrigirImagemUrl(imagem) || imagem,
    categoria: "Shopee"
  };
}
function extrairMeta(html, name) {
  const match = html.match(
    new RegExp(`<meta[^>]+property=['"]${name}['"][^>]+content=['"]([^'"]+)['"]`, "i")
  );

  if (match) {
    return match[1];
  }

  return "";
}

function htmlDecode(input) {
  const doc = new DOMParser().parseFromString(input, "text/html");
  return doc.documentElement.textContent;
}

function corrigirImagemUrl(url) {
  if (!url) return url;

  if (url.startsWith("//")) {
    return "https:" + url;
  }

  return url;
}

function normalizarPreco(valor) {
  if (!valor) return "";

  let texto = String(valor).trim();

  texto = texto.replace("R$", "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");

  const numero = Number(texto);

  if (!Number.isFinite(numero)) return String(valor);

  return numero.toFixed(2).replace(".", ",");
}

function normalizarPrecoShopee(valor) {
  if (!valor) return "";

  let texto = String(valor).trim();

  texto = texto.replace(/\s/g, "").replace(",", ".");

  const numero = Number(texto);

  if (!Number.isFinite(numero)) return String(valor);

  return numero.toFixed(2).replace(".", ",");
}
async function chamarAwinAPI(url, cookies) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cookie": cookies
  };

  const response = await fetch(url, { method: "GET", headers });

  const data = await response.json();
  return data;
}

async function buscarProdutoAwin(url, cookies) {
  const linkProduto = url;
  const linkConvertido = `https://www.awin1.com/cread.php?awinmid=YOUR_AFFILIATE_ID&clickref=YOUR_REFERRAL&subid=YOUR_SUBID&url=${encodeURIComponent(linkProduto)}`;

  const produto = await chamarAwinAPI(linkConvertido, cookies);

  if (!produto) {
    return {
      status: "erro",
      mensagem: "Produto não encontrado no Awin."
    };
  }

  const preco = produto.price;
  const precoAtual = preco ? `R$ ${normalizarPreco(preco)}` : "Não disponível";
  const titulo = produto.title;
  const imagem = produto.image;
  const linkAfiliado = linkConvertido;

  return {
    marketplace: "awin",
    titulo,
    precoAntigo: "",
    precoAtual,
    cupom: "",
    linkOriginal: linkProduto,
    linkAfiliado,
    imagem,
    categoria: produto.category || "Awin"
  };
}