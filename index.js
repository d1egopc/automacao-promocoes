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
    required: ["clientId", "cookies"],
    allowed: ["clientId", "cookies"]
  },
  aliexpress: {
    nome: "AliExpress",
    required: ["appKey", "secret", "trackingId"],
    allowed: ["appKey", "secret", "trackingId"]
  },
  awin: {
    nome: "Awin",
    required: ["appId", "secret"],
    allowed: ["appId", "secret"]
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

  if (/^\d+\.\d{2}$/.test(texto)) {
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

  if (numero > 1000) {
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

  return {
    marketplace: "mercadolivre",
    titulo: htmlDecode(titulo).replace(" | MercadoLivre", "").replace(" | Mercado Livre", ""),
    precoAntigo,
    precoAtual: preco,
    cupom: "",
    linkOriginal: url,
    linkAfiliado: url,
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
// ================= IMPORTAR PRODUTO =================

app.post("/importar-produto", async (req, res) => {
  const clienteId = getClienteId(req);
  const marketplace = String(req.body.marketplace || "").toLowerCase();
  const { url } = req.body;

  if (!marketplace || !url) {
    return res.status(400).json({
      erro: "marketplace e url obrigatórios"
    });
  }

  const config = integracoesPorCliente[clienteId]?.[marketplace];

  if (!config) {
    return res.status(400).json({
      erro: `Integração ${marketplace} não configurada`
    });
  }

  if (marketplace === "amazon") {
    try {
      const produto = await importarAmazon(url, config);

      if (!produto.titulo || produto.titulo === "Produto Amazon") {
        return res.json({
          marketplace: "amazon",
          titulo: "Produto importado da Amazon",
          precoAntigo: "",
          precoAtual: "",
          cupom: "",
          linkOriginal: url,
          linkAfiliado: url,
          imagem: "",
          categoria: "Amazon",
          aviso: "Dados não encontrados automaticamente. Preencha manualmente."
        });
      }

      return res.json(produto);
    } catch (e) {
      console.error("ERRO AMAZON:", e);

      return res.json({
        marketplace: "amazon",
        titulo: "Produto importado da Amazon",
        precoAntigo: "",
        precoAtual: "",
        cupom: "",
        linkOriginal: url,
        linkAfiliado: url,
        imagem: "",
        categoria: "Amazon",
        aviso: "Erro ao consultar Amazon. Preencha manualmente."
      });
    }
  }
  if (marketplace === "aliexpress") {
    try {
      const produto = await importarAliExpress(url, config);

      if (!produto.titulo || produto.titulo === "Produto AliExpress") {
        return res.json({
          marketplace: "aliexpress",
          titulo: "Produto importado do AliExpress",
          precoAntigo: "",
          precoAtual: "",
          cupom: "",
          linkOriginal: url,
          linkAfiliado: url,
          imagem: "",
          categoria: "AliExpress",
          aviso: "Dados não encontrados automaticamente. Preencha manualmente."
        });
      }

      return res.json(produto);
    } catch (e) {
      console.error("ERRO ALIEXPRESS:", e);

      return res.json({
        marketplace: "aliexpress",
        titulo: "Produto importado do AliExpress",
        precoAntigo: "",
        precoAtual: "",
        cupom: "",
        linkOriginal: url,
        linkAfiliado: url,
        imagem: "",
        categoria: "AliExpress",
        aviso: "Erro ao consultar AliExpress. Preencha manualmente."
      });
    }
  }
  if (marketplace === "mercadolivre") {
    try {
      const produto = await importarMercadoLivre(url, config);

      if (!produto.titulo || produto.titulo === "Produto Mercado Livre") {
        return res.json({
          marketplace: "mercadolivre",
          titulo: "Produto importado de Mercado Livre",
          precoAntigo: "",
          precoAtual: "",
          cupom: "",
          linkOriginal: url,
          linkAfiliado: url,
          imagem: "",
          categoria: "Mercado Livre",
          aviso: "Dados não encontrados automaticamente. Preencha manualmente."
        });
      }
async function importarAliExpress(url, config) {
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

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

    const regexes = [
      /R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})/g,
      /US\s*\$\s*\d+(?:\.\d{2})?/g,
      /\$\s*\d+(?:\.\d{2})?/g
    ];

    for (const regex of regexes) {
      const matches = html.match(regex) || [];

      for (const item of matches) {
        let valor = String(item)
          .replace("US", "")
          .replace("$", "")
          .replace("R$", "")
          .trim();

        const precoLimpo = limparPreco(valor);
        const numero = Number(String(precoLimpo).replace(",", "."));

        if (Number.isFinite(numero) && numero > 0) {
          encontrados.push({ texto: precoLimpo, numero });
        }
      }
    }

    return encontrados;
  }

  const titulo =
    extrairMeta(html, "og:title") ||
    extrairMeta(html, "twitter:title") ||
    primeiroMatch(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    primeiroMatch(/"subject"\s*:\s*"([^"]+)"/i) ||
    primeiroMatch(/"title"\s*:\s*"([^"]+)"/i) ||
    "Produto AliExpress";

  let preco =
    extrairMeta(html, "product:price:amount") ||
    extrairMeta(html, "og:price:amount") ||
    primeiroMatch(/"salePrice"\s*:\s*"([^"]+)"/i) ||
    primeiroMatch(/"formattedPrice"\s*:\s*"([^"]+)"/i) ||
    primeiroMatch(/"minActivityAmount"\s*:\s*"([^"]+)"/i) ||
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

  let precoAntigo = "";

  if (precosEncontrados.length && preco) {
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
      precoAntigo = (precoNumero * 1.25)
        .toFixed(2)
        .replace(".", ",");
    }
  }

  let imagem =
    extrairMeta(html, "og:image") ||
    extrairMeta(html, "twitter:image") ||
    primeiroMatch(/"imagePath"\s*:\s*"([^"]+)"/i) ||
    primeiroMatch(/"imageUrl"\s*:\s*"([^"]+)"/i) ||
    "";

  imagem = htmlDecode(imagem).replace(/\\u002F/g, "/");

  if (imagem && imagem.startsWith("//")) {
    imagem = "https:" + imagem;
  }

  const trackingId = config?.credenciais?.trackingId || "";

  let linkAfiliado = url;

  // Por enquanto mantém o link original.
  // A conversão afiliada real do AliExpress normalmente precisa da API de geração de link.
  if (trackingId) {
    linkAfiliado = url;
  }

  return {
    marketplace: "aliexpress",
    titulo: htmlDecode(titulo)
      .replace(" | AliExpress", "")
      .replace("- AliExpress", "")
      .trim(),
    precoAntigo,
    precoAtual: preco,
    cupom: "",
    linkOriginal: url,
    linkAfiliado,
    imagem: corrigirImagemUrl(imagem) || imagem,
    categoria: "AliExpress"
  };
}
      return res.json(produto);
    } catch (e) {
      console.error("ERRO MERCADO LIVRE:", e);

      return res.json({
        marketplace: "mercadolivre",
        titulo: "Produto importado de Mercado Livre",
        precoAntigo: "",
        precoAtual: "",
        cupom: "",
        linkOriginal: url,
        linkAfiliado: url,
        imagem: "",
        categoria: "Mercado Livre",
        aviso: "Erro ao consultar Mercado Livre. Preencha manualmente."
      });
    }
  }

  if (marketplace === "shopee") {
    try {
      const { appId, secret } = config.credenciais || {};

      if (!appId || !secret) {
        return res.status(400).json({
          erro: "Credenciais Shopee inválidas"
        });
      }

      const timestamp = Math.floor(Date.now() / 1000);

      const bodyPayload = {
        query: `
          query {
            productOfferV2(url: "${url}") {
              title
              price
              priceBeforeDiscount
              imageUrl
              productLink
            }
          }
        `
      };

      const payload = JSON.stringify(bodyPayload);
      const baseString = `${appId}${timestamp}${payload}${secret}`;

      const sign = crypto
        .createHash("sha256")
        .update(baseString)
        .digest("hex");

      const response = await fetch(
        "https://open-api.affiliate.shopee.com.br/graphql",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${sign}`
          },
          body: payload
        }
      );

      const data = await response.json();

      console.log("SHOPEE RESPONSE:", JSON.stringify(data));

      const produto = data?.data?.productOfferV2;

      if (!response.ok || !produto) {
        return res.json({
          marketplace: "shopee",
          titulo: "Produto Shopee importado",
          precoAntigo: "",
          precoAtual: "",
          cupom: "",
          linkOriginal: url,
          linkAfiliado: url,
          imagem: "",
          categoria: "Shopee",
          aviso: "Shopee não retornou dados completos. Preencha manualmente."
        });
      }

      return res.json({
        marketplace: "shopee",
        titulo: produto.title || "Produto Shopee",
        precoAntigo: produto.priceBeforeDiscount || "",
        precoAtual: produto.price || "",
        cupom: "",
        linkOriginal: url,
        linkAfiliado: produto.productLink || url,
        imagem: produto.imageUrl || "",
        categoria: "Shopee"
      });
    } catch (e) {
      console.error("ERRO SHOPEE:", e);

      return res.json({
        marketplace: "shopee",
        titulo: "Produto Shopee importado",
        precoAntigo: "",
        precoAtual: "",
        cupom: "",
        linkOriginal: url,
        linkAfiliado: url,
        imagem: "",
        categoria: "Shopee",
        aviso: "Erro ao consultar Shopee. Preencha manualmente."
      });
    }
  }

  return res.json({
    marketplace,
    titulo: `Produto importado de ${config.nome || marketplace}`,
    precoAntigo: "",
    precoAtual: "",
    cupom: "",
    linkOriginal: url,
    linkAfiliado: url,
    imagem: "",
    categoria: config.nome || marketplace
  });
});

// ================= WHATSAPP =================

app.post("/reset/:id", async (req, res) => {
  const { id } = req.params;

  try {
    reconectando[id] = false;

    if (sessoes[id]) {
      try { await sessoes[id].logout(); } catch {}
      try { sessoes[id].end?.(); } catch {}
      delete sessoes[id];
    }

    delete qrCodes[id];
    delete statusSessao[id];
    delete destinosPorSessao[id];

    fs.rmSync("auth_" + id, { recursive: true, force: true });

    return res.json({
      ok: true,
      message: "Sessão resetada",
      id
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
});

app.post("/conectar", async (req, res) => {
  const { id } = req.body;

  if (!id) return res.status(400).json({ erro: "ID obrigatório" });

  if (!sessoes[id]) iniciarWhatsApp(id);

  return res.json({
    ok: true,
    message: "Sessão iniciada",
    id
  });
});

app.get("/status/:id", (req, res) => {
  const { id } = req.params;

  res.json({
    conectado: statusSessao[id] === "open",
    status: statusSessao[id] || "offline"
  });
});

app.get("/qr/:id", (req, res) => {
  const { id } = req.params;

  if (!qrCodes[id]) {
    return res.json({
      status: "loading",
      qr: null
    });
  }

  return res.json({
    status: "ready",
    qr: qrCodes[id]
  });
});

app.get("/grupos/:id", async (req, res) => {
  const sock = sessoes[req.params.id];

  if (!sock) return res.status(400).json({ erro: "Sem sessão" });

  if (statusSessao[req.params.id] !== "open") {
    return res.status(400).json({ erro: "WhatsApp não conectado" });
  }

  try {
    const grupos = await sock.groupFetchAllParticipating();

    const lista = Object.entries(grupos).map(([id, g]) => ({
      id,
      nome: g.subject || "Grupo sem nome"
    }));

    return res.json(lista);
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
});

app.post("/destinos/:id", (req, res) => {
  const { destinos } = req.body;

  if (!Array.isArray(destinos)) {
    return res.status(400).json({ erro: "destinos deve ser array" });
  }

  destinosPorSessao[req.params.id] = destinos;

  return res.json({
    ok: true,
    destinos
  });
});

app.get("/destinos/:id", (req, res) => {
  return res.json({
    ok: true,
    destinos: destinosPorSessao[req.params.id] || []
  });
});

app.post("/test-send/:id", async (req, res) => {
  const { id } = req.params;
  const sock = sessoes[id];
  const destinos = destinosPorSessao[id] || [];

  if (!sock) return res.status(400).json({ erro: "Sem sessão" });

  if (statusSessao[id] !== "open") {
    return res.status(400).json({ erro: "WhatsApp não conectado" });
  }

  if (!destinos.length) {
    return res.status(400).json({ erro: "Nenhum destino selecionado" });
  }

  const mensagem =
    req.body?.mensagem ||
    "🧪 TESTE " + new Date().toLocaleTimeString();

  const imagemOriginal = req.body?.imagem;
  const imagemFinal = corrigirImagemUrl(imagemOriginal);

  const resultados = [];

  for (const destino of destinos) {
    try {
      if (imagemFinal) {
        await sock.sendMessage(destino, {
          image: { url: imagemFinal },
          caption: mensagem
        });

        resultados.push({
          destino,
          ok: true,
          tipo: "imagem_com_legenda",
          imagemEnviada: imagemFinal
        });
      } else {
        await sock.sendMessage(destino, {
          text: mensagem
        });

        resultados.push({
          destino,
          ok: true,
          tipo: "texto"
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (e) {
      resultados.push({
        destino,
        ok: false,
        erro: e.message
      });
    }
  }

  return res.json({
    ok: true,
    resultados
  });
});

async function iniciarWhatsApp(id) {
  console.log("🚀 Iniciando sessão:", id);

  statusSessao[id] = "connecting";
  qrCodes[id] = null;
  reconectando[id] = false;

  const { state, saveCreds } = await useMultiFileAuthState("auth_" + id);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: ["Chrome", "Desktop", "1.0.0"]
  });

  sessoes[id] = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      console.log("🔥 QR RECEBIDO");
      qrCodes[id] = await qrcode.toDataURL(qr);
      statusSessao[id] = "qr";
    }

    if (connection === "open") {
      console.log("✅ WHATSAPP CONECTADO:", id);
      statusSessao[id] = "open";
      qrCodes[id] = null;
      reconectando[id] = false;
    }

    if (connection === "close") {
      const motivo = lastDisconnect?.error?.output?.statusCode;

      console.log("❌ WHATSAPP DESCONECTADO:", id);
      console.log("Motivo:", motivo);

      qrCodes[id] = null;
      delete sessoes[id];

      if (motivo === DisconnectReason.loggedOut) {
        statusSessao[id] = "loggedOut";
        reconectando[id] = false;
        return;
      }

      statusSessao[id] = "reconnecting";

      if (!reconectando[id]) {
        reconectando[id] = true;

        setTimeout(() => {
          iniciarWhatsApp(id).catch((e) => {
            console.error("ERRO AO RECONECTAR:", e);
            statusSessao[id] = "offline";
            reconectando[id] = false;
          });
        }, 5000);
      }
    }
  });
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🔥 API ONLINE NA PORTA " + PORT);
});