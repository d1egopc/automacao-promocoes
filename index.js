
const fs = require("fs");

if (!fs.existsSync("/data")) {
  fs.mkdirSync("/data", { recursive: true });
  console.log("📁 Pasta /data criada");
}

let config = {
  intervaloMinutos: 2
};

let fila = [];
let enviandoAgora = false;
let controleEnvio = {}; // por cliente

const FILA_FILE = "/data/fila.json";
console.log("📂 Salvando dados em:", FILA_FILE);

function salvarFila() {
  try {
    fs.writeFileSync(FILA_FILE, JSON.stringify(fila, null, 2));
  } catch (e) {
    console.error("❌ ERRO AO SALVAR FILA:", e.message);
  }
}

function carregarFila() {
  try {
    if (fs.existsSync(FILA_FILE)) {
      const data = fs.readFileSync(FILA_FILE, "utf8");
      if (data) {
        fila = JSON.parse(data);
        console.log("✅ Fila carregada do arquivo");
      }
    }
  } catch (e) {
    console.error("❌ ERRO AO CARREGAR FILA:", e.message);
  }
}

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const app = express(); // 👈 MUITO IMPORTANTE ter isso

const horarioInicio = 9;
const horarioFim = 23;

function podeRodarAgora() {
  return true;
}

let ultimoEnvioFila = 0;

async function processarFila() {
  if (enviandoAgora) return;
  enviandoAgora = true;

  try {
    if (!config.automacaoAtiva) return;

    const agora = Date.now();
    const intervaloMs = (config.intervaloMinutos || 2) * 60 * 1000;

    const oferta = fila.find(o => o.status === "pendente");

    if (!oferta) {
      console.log("📭 Nenhuma oferta pendente");
      return;
    }

    const clienteId = oferta.clienteId || "admin";

    if (!controleEnvio[clienteId]) {
      controleEnvio[clienteId] = 0;
    }

    if (agora - controleEnvio[clienteId] < intervaloMs) {
      return;
    }

    const idSessao = oferta.sessaoId || oferta.id || Object.keys(sessoes)[0];
    const sock = sessoes[idSessao];

    if (!sock) {
      console.log("❌ Nenhuma sessão conectada");
      return;
    }

    let ultimoEnvioFila = 0;

   const destinosBrutos =
  oferta.destinos?.length
    ? oferta.destinos
    : oferta.grupos?.length
      ? oferta.grupos
      : destinosPorSessao[idSessao]?.length
        ? destinosPorSessao[idSessao]
        : oferta.destino
          ? [oferta.destino]
          : oferta.grupoDestino
            ? [oferta.grupoDestino]
            : config?.destinos?.length
              ? config.destinos
              : [];

const destinos = destinosBrutos
  .map(d => d?.id || d?.value || d?.jid || d)
  .filter(Boolean);

console.log("DESTINOS PARA ENVIO:", destinos);

if (!destinos.length) {
  console.log("⚠️ Sem destino carregado ainda. Aguardando...");
  enviandoAgora = false;
  return;
}
    
const titulo = oferta.nome || oferta.titulo || "Oferta";

const precoAtual = oferta.preco || oferta.precoAtual || "";
const precoAntigo = oferta.precoAntigo || "";
const cupom = oferta.cupom || "";
const avisoCupom = oferta.avisoCupom || "";
const marketplace = oferta.marketplace || "";
const link = oferta.link || oferta.linkAfiliado || "";
const parcelamento = oferta.parcelamento || "";

let mensagem = `🔥 OFERTA ENCONTRADA!

🛍️ ${titulo}`;

const antigoNum = Number(String(precoAntigo).replace(",", "."));
const atualNum = Number(String(precoAtual).replace(",", "."));

const temPrecoAntigoValido =
  precoAntigo &&
  precoAtual &&
  Number.isFinite(antigoNum) &&
  Number.isFinite(atualNum) &&
  antigoNum > atualNum;

if (temPrecoAntigoValido) {
  mensagem += `

❌ De: R$ ${precoAntigo}`;
}

if (precoAtual) {
  mensagem += `
✅ Por: R$ ${precoAtual}`;
}

if (temPrecoAntigoValido) {
  const economia = (antigoNum - atualNum).toFixed(2).replace(".", ",");
  const desconto = Math.round(((antigoNum - atualNum) / antigoNum) * 100);

  mensagem += `

💥 Economia: R$ ${economia}
🔥 ${desconto}% OFF`;

  if (desconto >= 25) {
    mensagem += `
⚠️ PREÇO MUITO BOM`;
  }
}

if (parcelamento) {
  mensagem += `

💳 ${parcelamento}`;
}

if (cupom) {
  mensagem += `

🎟️ Cupom: ${cupom}`;

  if (avisoCupom) {
    mensagem += `
🎫 ${avisoCupom}`;
  }
} else if (marketplace === "shopee") {
  mensagem += `

🎟️ Verifique se há cupons disponíveis na página`;
} else if (marketplace === "aliexpress") {
  mensagem += `

⚠️ Preço pode variar por moedas, cupom, variação ou impostos. Confira o valor final.`;
}

mensagem += `

🛒 Comprar:
${link}`;  

function parsePreco(valor) {
  if (!valor) return 0;
  return parseFloat(valor.toString().replace(",", "."));
}

const antigo = parsePreco(oferta.precoAntigo);
const atual = parsePreco(oferta.precoAtual);

if (antigo > atual && atual > 0) {
  const economia = (antigo - atual).toFixed(2);
  const porcentagem = Math.round(((antigo - atual) / antigo) * 100);

  mensagem += `

💥 Economia: R$ ${economia.replace(".", ",")}
🔥 ${porcentagem}% OFF`;
}

    
    for (const destino of destinos) {
      if (oferta.imagem) {
        await sock.sendMessage(destino, {
          image: { url: corrigirImagemUrl(oferta.imagem) || oferta.imagem },
          caption: mensagem
        });
      } else {
        await sock.sendMessage(destino, {
          text: mensagem
        });
      }

      await new Promise(r => setTimeout(r, 3000));
    }

    controleEnvio[clienteId] = Date.now();
    ultimoEnvioFila = Date.now();
    oferta.status = "enviado";
    oferta.dataEnvio = new Date();
    
    salvarFila();

    console.log("✅ Enviado com controle de tempo");

  } catch (e) {
    console.log("❌ ERRO:", e.message);
  } finally {
    enviandoAgora = false;
  }
}
   
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: "10mb" }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300
}));

app.post("/fila", (req, res) => {
  const body = req.body || {};

  const oferta = {
    ...body,

    nome: body.nome || body.titulo || "Oferta",
    titulo: body.titulo || body.nome || "Oferta",

    preco: body.preco || body.precoAtual || "",
    precoAtual: body.precoAtual || body.preco || "",

    precoAntigo: body.precoAntigo || "",
    cupom: body.cupom || "",
    avisoCupom: body.avisoCupom || "",
    parcelamento: body.parcelamento || "",

    link: body.link || body.linkAfiliado || "",
    linkAfiliado: body.linkAfiliado || body.link || "",

    imagem: body.imagem || "",
    marketplace: body.marketplace || "",
    categoria: body.categoria || body.marketplace || "",

    clienteId: getClienteId(req),
    status: "pendente"
  };

  fila.push(oferta);
  salvarFila();

  console.log("📥 Oferta adicionada na fila:", {
    titulo: oferta.titulo,
    precoAntigo: oferta.precoAntigo,
    precoAtual: oferta.precoAtual,
    cupom: oferta.cupom,
    avisoCupom: oferta.avisoCupom
  });

  res.send("OK");
});

// ================= AUTOMAÇÃO =================

app.get("/automacao", (req, res) => {
  res.json({
    ok: true,
    ativo: config.automacaoAtiva
  });
});

app.post("/automacao/toggle", (req, res) => {
  config.automacaoAtiva = !config.automacaoAtiva;

  console.log("🤖 Automação:", config.automacaoAtiva ? "ON" : "OFF");

  res.json({
    ok: true,
    ativo: config.automacaoAtiva
  });
});


app.delete("/fila/:index", (req, res) => {
  const index = Number(req.params.index);

  if (isNaN(index) || index < 0 || index >= fila.length) {
    return res.status(400).send("Índice inválido");
  }

  const removido = fila.splice(index, 1);

  salvarFila();

  console.log("🗑️ Removido da fila:", removido[0]?.nome || removido[0]?.titulo);

  res.send("Removido com sucesso");
});

app.post("/config", (req, res) => {
  const intervalo = Number(req.body.intervalo);

  if (!intervalo || intervalo <= 0) {
    return res.status(400).send("Intervalo inválido");
  }

  config.intervaloMinutos = intervalo;

  console.log("⚙️ Novo intervalo:", intervalo, "minutos");

  res.send("Config atualizada");
});

let sessoes = {};
let qrCodes = {};
let statusSessao = {};
let destinosPorSessao = {};
let gruposPorSessao = {};
let reconectando = {};
let integracoesPorCliente = {};

const INTEGRACOES_FILE = process.env.INTEGRACOES_FILE || "/data/integracoes.json";

function carregarIntegracoesPersistidas() {
  try {
    if (!fs.existsSync(INTEGRACOES_FILE)) {
      console.log("ℹ️ Nenhum arquivo de integrações encontrado ainda");
      return;
    }

    const raw = fs.readFileSync(INTEGRACOES_FILE, "utf8");

    if (!raw) {
      console.log("ℹ️ Arquivo de integrações vazio");
      return;
    }

    const data = JSON.parse(raw);

    if (data && typeof data === "object") {
      integracoesPorCliente = data;
      console.log("✅ Integrações carregadas do arquivo");
    }
  } catch (e) {
    console.error("ERRO AO CARREGAR INTEGRAÇÕES:", e.message);
  }
}

function salvarIntegracoesPersistidas() {
  try {
    const tempFile = `${INTEGRACOES_FILE}.tmp`;

    fs.writeFileSync(
      tempFile,
      JSON.stringify(integracoesPorCliente, null, 2),
      "utf8"
    );

    fs.renameSync(tempFile, INTEGRACOES_FILE);

    console.log("✅ Integrações salvas no arquivo");
  } catch (e) {
    console.error("ERRO AO SALVAR INTEGRAÇÕES:", e.message);
  }
}

carregarIntegracoesPersistidas();
carregarFila();
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

salvarIntegracoesPersistidas();

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

  salvarIntegracoesPersistidas();

  return res.json({
    ok: true,
    message: `${marketplace} removido com sucesso`,
    marketplace
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

const encurtarUrl = async (url) => {
  try {
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    return await res.text();
  } catch {
    return url;
  }
};

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
  
  const descontoMatch =
  html.match(/(\d{1,2})\s*%\s*OFF/i) ||
  html.match(/"discount_rate"\s*:\s*(\d{1,2})/i) ||
  html.match(/"discountPercentage"\s*:\s*(\d{1,2})/i) ||
  html.match(/(\d{1,2})\s*%\s*de desconto/i);
const descontoReal = descontoMatch ? Number(descontoMatch[1]) : 0;

if (
  Number.isFinite(precoNumero) &&
  precoNumero > 0 &&
  descontoReal > 0 &&
  descontoReal < 90
) {
  precoAntigo = (precoNumero / (1 - descontoReal / 100))
    .toFixed(2)
    .replace(".", ",");

  console.log("🏷️ Desconto real ML detectado:", descontoReal + "%");
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

async function importarAliExpress(urlEntrada, config = {}) {
  try {
    if (urlEntrada && !urlEntrada.startsWith("http")) {
      urlEntrada = "https://" + urlEntrada;
    }

    const productId =
      urlEntrada.match(/\/item\/(\d+)\.html/i)?.[1] ||
      urlEntrada.match(/[?&]productId=(\d+)/i)?.[1];

    if (!productId) {
      throw new Error("Product ID não encontrado no link AliExpress");
    }

    const credenciais = config?.credenciais || {};
    const appKey = credenciais.appKey || "";
    const secret = credenciais.secret || "";
    const trackingId = credenciais.trackingId || "";

    if (!appKey || !secret || !trackingId) {
      throw new Error("Credenciais AliExpress incompletas");
    }

    function timestampGMT8() {
      const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const pad = (n) => String(n).padStart(2, "0");

      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    }

    function assinar(params, appSecret) {
      const sortedKeys = Object.keys(params).sort();
      let base = appSecret;

      for (const key of sortedKeys) {
        if (key === "sign") continue;
        base += key + params[key];
      }

      base += appSecret;

      return crypto
        .createHash("md5")
        .update(base, "utf8")
        .digest("hex")
        .toUpperCase();
    }

    const params = {
      method: "aliexpress.affiliate.productdetail.get",
      app_key: appKey,
      timestamp: timestampGMT8(),
      sign_method: "md5",
      format: "json",
      v: "2.0",
      product_ids: productId,
      target_currency: "BRL",
      target_language: "PT",
      ship_to_country: "BR",
      tracking_id: trackingId
    };

    params.sign = assinar(params, secret);

    const body = new URLSearchParams(params);

    const response = await fetch("https://api-sg.aliexpress.com/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
      },
      body
    });

    const data = await response.json();

    console.log("ALIEXPRESS API RESPONSE:", JSON.stringify(data));

    const result =
      data?.aliexpress_affiliate_productdetail_get_response?.resp_result?.result ||
      data?.resp_result?.result ||
      data?.result ||
      {};

    const produto =
      result?.products?.product?.[0] ||
      result?.products?.[0] ||
      result?.product?.[0] ||
      result?.product ||
      {};

    let titulo =
      produto.product_title ||
      produto.title ||
      produto.productTitle ||
      "Produto AliExpress";

    let imagem =
      produto.product_main_image_url ||
      produto.product_small_image_urls?.string?.[0] ||
      produto.product_small_image_urls?.[0] ||
      produto.image_url ||
      "";

   let precoAtual =
       produto.target_sale_price ||
       produto.sale_price ||
       produto.app_sale_price || "";

    let precoAntigo =
      produto.target_original_price ||
      produto.original_price ||
      "";
  if (produto.discount === "0%" && limparPreco(precoAtual) === limparPreco(precoAntigo)) {
  precoAntigo = "";
}
 
// 🔥 PRIORIDADE: preço real da URL (AliExpress promo)
try {
  const urlDecodificada = decodeURIComponent(urlEntrada);

  // pega exatamente o padrão pdp_npi
  const match = urlDecodificada.match(/BRL!([\d.]+)!([\d.]+)/);

  if (match) {
    const antigo = match[1];
    const atual = match[2];

    // só usa se fizer sentido (evita bug tipo 8.93)
    if (parseFloat(atual) < parseFloat(antigo)) {
      precoAntigo = antigo;
      precoAtual = atual;
    }
  }

} catch (e) {
  console.log("Erro ao extrair preço da URL:", e.message);
}

    let linkAfiliado =
      produto.promotion_link ||
      produto.product_detail_url ||
      urlEntrada;

    if (!linkAfiliado && trackingId) {
      linkAfiliado =
        `https://s.click.aliexpress.com/deep_link.htm?aff_short_key=${trackingId}&dl_target_url=${encodeURIComponent(urlEntrada)}`;
    }

    // Fallback: se API não trouxer preço, tenta pegar do parâmetro pdp_npi da URL
    
     // 🔥 PRIORIDADE: preço real da URL (AliExpress promo)
  try {
  const urlDecodificada = decodeURIComponent(urlEntrada);

  // 1) Tenta padrão exato: BRL!68.88!28.93
  let m = urlDecodificada.match(/BRL[!|%21]+(\d+(?:\.\d+)?)[!|%21]+(\d+(?:\.\d+)?)/);

  if (m) {
    precoAntigo = m[1]; // 68.88
    precoAtual  = m[2]; // 28.93
  } else {
    // 2) Fallback: pega R$ 68,88 / R$ 28,93
    const precos = [...urlDecodificada.matchAll(/R\$ ?([\d.,]+)/g)]
      .map(x => x[1])
      .filter(Boolean);

    if (precos.length >= 2) {
      precoAntigo = precos[0];
      precoAtual  = precos[1];
    } else if (precos.length === 1) {
      precoAtual = precos[0];
    }
  }
} catch {}

     const linkFinal = await encurtarUrl(linkAfiliado);

   return {
      marketplace: "aliexpress",
      titulo: htmlDecode(titulo || "Produto AliExpress"),
      precoAntigo: limparPreco(precoAntigo || ""),
      precoAtual: limparPreco(precoAtual || ""),
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado: linkFinal,
      imagem: corrigirImagemUrl(imagem) || imagem,
      categoria: "AliExpress",
      aviso: !imagem || titulo === "Produto AliExpress"
        ? "Dados parciais retornados pela API AliExpress."
        : ""
    };

  } catch (e) {
    console.error("ERRO ALIEXPRESS:", e.message);

    return {
      marketplace: "aliexpress",
      titulo: "Produto AliExpress",
      precoAntigo: "",
      precoAtual: "",
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado: urlEntrada,
      imagem: "",
      categoria: "AliExpress",
      aviso: "Erro ao consultar API AliExpress"
    };
  }
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

  let parcelamento =
  primeiroMatch(/(\d+x\s+de\s+R\$\s*[\d.,]+\s*sem juros)/i) ||
  primeiroMatch(/(\d+\s*x\s*R\$\s*[\d.,]+)/i) ||
  "";
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

  let cupom = "";

const matchCupom =
  html.match(/COMPRANOAPP/i) ||
  html.match(/cupom.{0,80}COMPRANOAPP/i) ||
  html.match(/aplique.{0,80}COMPRANOAPP/i) ||
  html.match(/use.{0,80}COMPRANOAPP/i);

if (matchCupom) {
  cupom = "COMPRANOAPP";
} else {
  cupom =
    primeiroMatch(/Insira o código\s+([A-Z0-9]+)/i) ||
    primeiroMatch(/Aplique o cupom\s+([A-Z0-9]{4,20})/i) ||
    primeiroMatch(/Use o cupom\s+([A-Z0-9]{4,20})/i) ||
    primeiroMatch(/cupom[^A-Z0-9]{0,40}([A-Z0-9]{4,20})/i) ||
    primeiroMatch(/código[^A-Z0-9]{0,40}([A-Z0-9]{4,20})/i) ||
    "";
}

let avisoCupom = "";

if (cupom) {
  avisoCupom = `Aplique o cupom ${cupom} no carrinho.`;
} else if (/resgatar|aplique o cupom|cupom disponível|desconto extra/i.test(html)) {
  avisoCupom = "Há cupom/desconto extra na página. Resgate antes de finalizar.";
}

const linkFinal = await encurtarUrl(linkAfiliado); 
 
console.log("🎟️ AMAZON CUPOM DETECTADO:", cupom);
console.log("🎫 AMAZON AVISO CUPOM:", avisoCupom);
console.log("🔎 AMAZON TEM COMPRANOAPP?", html.includes("COMPRANOAPP"));
console.log("🔎 AMAZON TEM CUPOM?", /cupom/i.test(html));

return {
    marketplace: "amazon",
    titulo: htmlDecode(titulo)
      .replace("Amazon.com.br:", "")
      .replace("Amazon.com:", "")
      .trim(),
    precoAntigo,
    precoAtual: preco,
    parcelamento,
    cupom,
    avisoCupom,
    linkOriginal: url,
    linkAfiliado: linkFinal,
    imagem: corrigirImagemUrl(imagem) || imagem,
    categoria: "Amazon"
  };

}async function importarShopee(url, config) {
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
    const texto = String(link || "").split("?")[0];

    // Formato novo: /product/shopId/itemId
    const matchProduct = texto.match(/\/product\/(\d+)\/(\d+)/i);
    if (matchProduct) {
      return {
        shopId: matchProduct[1],
        itemId: matchProduct[2]
      };
    }

    // Formato antigo: -i.shopId.itemId
    const match1 = texto.match(/-i\.(\d+)\.(\d+)/i);
    if (match1) {
      return {
        shopId: match1[1],
        itemId: match1[2]
      };
    }

    // Outro formato: i.shopId.itemId
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

  // Shopee não retorna preço antigo real nesse endpoint.
  // Não calcular "De" automaticamente para evitar desconto inflado.
  precoAntigo = "";
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

// ================= IMPORTAR PRODUTO =================

app.post("/importar-produto", async (req, res) => {
  const clienteId = getClienteId(req);
let marketplace = String(req.body.marketplace || "").toLowerCase();
let { url } = req.body;

url = String(url || "").trim();

if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
  url = "https://" + url;
}

const urlLower = url.toLowerCase();

if (urlLower.includes("amazon.com") || urlLower.includes("amzn.to")) {
  marketplace = "amazon";
} else if (urlLower.includes("mercadolivre.com") || urlLower.includes("meli.la")) {
  marketplace = "mercadolivre";
} else if (urlLower.includes("shopee.com") || urlLower.includes("s.shopee")) {
  marketplace = "shopee";
} else if (urlLower.includes("aliexpress.com")) {
  marketplace = "aliexpress";
}

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
    return res.json(produto);
  } catch (e) {
    console.error("ERRO ALIEXPRESS:", e);

    return res.json({
      marketplace: "aliexpress",
      titulo: "Produto importado da AliExpress",
      precoAntigo: "",
      precoAtual: "",
      cupom: "",
      linkOriginal: url,
      linkAfiliado: url,
      imagem: "",
      categoria: "AliExpress",
      aviso: "Erro ao consultar AliExpress"
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
       const novaOferta = {
      nome: produto.nome || produto.titulo,
      preco: produto.preco || produto.precoAtual,
      link: produto.linkAfiliado || produto.linkOriginal,
      imagem: produto.imagem,
      status: "pendente"
    };
    
    const precoNumero = Number(
  String(novaOferta.preco || "")
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim()
);

if (!precoNumero || !Number.isFinite(precoNumero)) {
  console.log("⚠️ Oferta ignorada: preço inválido", novaOferta.nome);
  return res.json({
    ...produto,
    aviso: "Produto importado, mas não foi enviado para fila porque não tem preço válido."
  });
}

const precoAntigoNumero = Number(
  String(produto.precoAntigo || "")
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim()
);

const temCupom = Boolean(produto.cupom && String(produto.cupom).trim());

const temDescontoReal =
  precoAntigoNumero &&
  Number.isFinite(precoAntigoNumero) &&
  precoAntigoNumero > precoNumero;

const descontoPercentual = temDescontoReal
  ? ((precoAntigoNumero - precoNumero) / precoAntigoNumero) * 100
  : 0;

if (!temCupom && descontoPercentual < 10) {
  console.log("⚠️ Oferta ignorada: desconto baixo", novaOferta.nome);

  return res.json({
    ...produto,
    aviso: "Produto importado, mas não foi enviado para fila porque o desconto parece baixo."
  });
}


    const jaExiste = fila.some(
  (o) => o.link === novaOferta.link
);

if (jaExiste) {
  console.log("⚠️ Oferta já existe na fila:", novaOferta.nome);
} else {
  fila.push(novaOferta);
  salvarFila();

  console.log("🤖 Oferta adicionada automaticamente:", novaOferta.nome);
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
      const produto = await importarShopee(url, config);

      if ((!produto.titulo || produto.titulo === "Produto Shopee") && !produto.precoAtual && !produto.imagem) {
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

      return res.json(produto);
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

    fs.rmSync("/data/auth_" + id, { recursive: true, force: true });

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

async function carregarGruposSessao(id) {
  const sock = sessoes[id];
if (gruposPorSessao[id]?.length) {
  return gruposPorSessao[id];
}

  if (!sock) {
    console.log("⚠️ Não carregou grupos: sem sessão");
    return [];
  }

  if (statusSessao[id] !== "open") {
    console.log("⚠️ Não carregou grupos: WhatsApp não está open");
    return [];
  }

  try {
    const grupos = await sock.groupFetchAllParticipating();

    const lista = Object.entries(grupos).map(([gid, g]) => ({
      id: gid,
      nome: g.subject || "Grupo sem nome"
    }));

    gruposPorSessao[id] = lista;

    console.log(`✅ Grupos carregados automaticamente: ${lista.length}`);

    return lista;
  } catch (e) {
    console.log("❌ Erro ao carregar grupos:", e.message);
    return [];
  }
}

app.get("/grupos/:id", async (req, res) => {
  const lista = await carregarGruposSessao(req.params.id);

  if (!lista.length) {
    return res.status(400).json({ erro: "Sem grupos carregados" });
  }

  return res.json(lista);
});

app.post("/destinos/:id", (req, res) => {
  const { destinos } = req.body;

  if (!Array.isArray(destinos)) {
    return res.status(400).json({ erro: "destinos deve ser array" });
  }

  const id = req.params.id;

  destinosPorSessao[id] = destinos;

  if (!config.destinosPorSessao) {
    config.destinosPorSessao = {};
  }

  config.destinosPorSessao[id] = destinos;

  try {
  if (typeof salvarIntegracoes === "function") {
    salvarIntegracoes();
  } else {
    console.log("⚠️ salvarIntegracoes não encontrada. Destinos salvos só em memória.");
  }
} catch (e) {
  console.log("⚠️ Erro ao salvar destinos:", e.message);
}

  return res.json({
    ok: true,
    destinos
  });
});

app.get("/destinos/:id", (req, res) => {
  const id = req.params.id;

  return res.json({
    ok: true,
    destinos:
      destinosPorSessao[id] ||
      config?.destinosPorSessao?.[id] ||
      []
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

  const { state, saveCreds } = await useMultiFileAuthState("/data/auth_" + id);
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

  setTimeout(() => carregarGruposSessao(id), 3000);
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

async function farejarMercadoLivre() {
  try {
    console.log("🐶 Farejando ofertas ML (modo stealth)...");

    const buscas = [
      "tv 50 polegadas",
      "fone bluetooth",
      "smartwatch",
      "air fryer",
      "tenis masculino",
      "perfume importado",
      "furadeira",
      "bicicleta"
    ];

    for (const termo of buscas) {
      try {
        const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(termo)}`;

        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept-Language": "pt-BR,pt;q=0.9"
          }
        });

        console.log("🌐 URL:", url);
        console.log("📡 STATUS:", response.status);

        const html = await response.text();

        const links = [
          ...html.matchAll(/https:\/\/produto\.mercadolivre\.com\.br\/[^\s"]+/g)
        ]
          .map(m => m[0])
          .slice(0, 5);

        console.log(`🔎 ${termo}: ${links.length} produtos`);

        for (const link of links) {
          try {
            const produto = await importarMercadoLivre(link, {
              credenciais: integracoesPorCliente["admin"]?.mercadolivre?.credenciais
            });

            if (!produto.precoAtual) continue;

            const precoNumero = Number(
              String(produto.precoAtual).replace(",", ".")
            );

            const precoAntigoNumero = Number(
              String(produto.precoAntigo || "").replace(",", ".")
            );

            const desconto =
              precoAntigoNumero > precoNumero
                ? ((precoAntigoNumero - precoNumero) / precoAntigoNumero) * 100
                : 0;

            if (desconto < 10) continue;
            if (precoNumero < 30) continue;

            const novaOferta = {
              nome: produto.titulo,
              preco: produto.precoAtual,
              link: produto.linkAfiliado,
              imagem: produto.imagem,
              status: "pendente"
            };

            const jaExiste = fila.some(o => o.link === novaOferta.link);

            if (!jaExiste) {
              fila.push(novaOferta);
              salvarFila();

              console.log("🤖 Nova oferta:", novaOferta.nome);
            }

            await new Promise(r => setTimeout(r, 2000));

          } catch (e) {
            console.log("❌ erro produto", e.message);
          }
        }

        await new Promise(r => setTimeout(r, 4000));

      } catch (e) {
        console.log("❌ erro busca", e.message);
      }
    }

  } catch (e) {
    console.log("❌ erro farejador", e.message);
  }
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🔥 API ONLINE NA PORTA " + PORT);

 setTimeout(() => {
    console.log("🔄 Tentando reconectar WhatsApp automaticamente...");
    iniciarWhatsApp("sessao1");
  }, 3000);
});
 
 setInterval(() => {
  processarFila();
}, 10 * 1000); // roda a cada 10 segundos

setInterval(() => {
  if (config.automacaoAtiva) {
    farejarMercadoLivre();
  } else {
    console.log("⏸️ Farejador pausado");
  }
}, 2 * 60 * 1000);
