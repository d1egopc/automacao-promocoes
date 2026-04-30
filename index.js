require("dotenv").config();

const fs = require("fs");
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

  if (!token) {
    return res.status(401).json({ erro: "Token inválido" });
  }

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

// ================= INTEGRAÇÕES SAAS =================

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

  if (!rule) {
    return { ok: false, erro: "Marketplace não suportado" };
  }

  if (marketplace === "amazon") {
    const modo = body.modo || "api";
    const modeRule = rule.modes[modo];

    if (!modeRule) {
      return { ok: false, erro: "Modo Amazon inválido" };
    }

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

  if (!validacao.ok) {
    return res.status(400).json(validacao);
  }

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
    message: `${config.nome || marketplace} configurado. Teste real da API será ligado na próxima etapa.`
  });
});

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
      try {
        await sessoes[id].logout();
      } catch {}

      try {
        sessoes[id].end?.();
      } catch {}

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

  if (!id) {
    return res.status(400).json({ erro: "ID obrigatório" });
  }

  if (!sessoes[id]) {
    iniciarWhatsApp(id);
  }

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

  if (!sock) {
    return res.status(400).json({ erro: "Sem sessão" });
  }

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

function corrigirImagemUrl(imagem) {
  if (!imagem || typeof imagem !== "string") return null;

  let imagemFinal = imagem.trim();

  if (!imagemFinal.startsWith("http")) return null;

  if (imagemFinal.includes(".webp")) {
    imagemFinal = imagemFinal.replace(".webp", ".jpg");
  }

  return imagemFinal;
}

app.post("/test-send/:id", async (req, res) => {
  const { id } = req.params;
  const sock = sessoes[id];
  const destinos = destinosPorSessao[id] || [];

  if (!sock) {
    return res.status(400).json({ erro: "Sem sessão" });
  }

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