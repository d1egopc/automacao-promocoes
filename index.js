require("dotenv").config();

const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode");
const cron = require("node-cron");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();
const logger = pino();

// ================= CONFIG =================

app.use(helmet());

app.use(cors({
  origin: "*",
  credentials: true
}));

app.use(express.json({ limit: "10mb" }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300
}));

// ================= MEMÓRIA =================

let sessoes = {};
let qrCodes = {};
let statusSessao = {};
let destinosPorSessao = {};

let automacaoState = {
  ativa: false,
  ligadaEm: null,
  desligadaEm: null,
};

// ================= AUTH =================

const ADMIN_USER = "admin";
const ADMIN_PASS_HASH = bcrypt.hashSync("123456", 10);

function gerarToken() {
  return jwt.sign(
    { admin: true },
    process.env.JWT_SECRET || "segredo",
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  if (req.path === "/" || req.path === "/login") {
    return next();
  }

  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ erro: "Token inválido" });
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET || "segredo");
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

  res.json({
    ok: true,
    token: gerarToken()
  });
});

// ================= HEALTH =================

app.get("/", (req, res) => {
  res.json({
    status: "API ONLINE",
    uptime: process.uptime()
  });
});

// ================= AUTOMAÇÃO =================

app.get("/automacao", (req, res) => {
  res.json({
    ok: true,
    ativa: automacaoState.ativa
  });
});

app.post("/automacao/toggle", (req, res) => {
  automacaoState.ativa = !automacaoState.ativa;

  logger.info("AUTOMACAO: " + automacaoState.ativa);

  res.json({
    ok: true,
    ativa: automacaoState.ativa
  });
});

// ================= CONECTAR =================

app.post("/conectar", async (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ erro: "ID obrigatório" });
  }

  if (!sessoes[id]) {
    iniciarWhatsApp(id);
  }

  res.json({ ok: true });
});

// ================= STATUS =================

app.get("/status/:id", (req, res) => {
  const { id } = req.params;

  res.json({
    conectado: statusSessao[id] === "open",
    status: statusSessao[id] || "offline"
  });
});

// ================= QR =================

app.get("/qr/:id", (req, res) => {
  const { id } = req.params;

  if (!qrCodes[id]) {
    return res.json({ status: "loading", qr: null });
  }

  res.json({ status: "ready", qr: qrCodes[id] });
});

// ================= GRUPOS =================

app.get("/grupos/:id", async (req, res) => {
  const sock = sessoes[req.params.id];

  if (!sock) {
    return res.status(400).json({ erro: "Sem sessão" });
  }

  try {
    const grupos = await sock.groupFetchAllParticipating();

    const lista = Object.entries(grupos).map(([id, g]) => ({
      id,
      nome: g.subject
    }));

    res.json(lista);
  } catch (e) {
    logger.error(e);
    res.status(500).json({ erro: e.message });
  }
});

// ================= DESTINOS =================

app.post("/destinos/:id", (req, res) => {
  destinosPorSessao[req.params.id] = req.body.destinos || [];
  res.json({ ok: true });
});

// ================= TEST SEND =================

app.post("/test-send/:id", async (req, res) => {
  const sock = sessoes[req.params.id];
  const destinos = destinosPorSessao[req.params.id] || [];

  if (!sock) {
    return res.status(400).json({ erro: "Sem sessão" });
  }

  for (const d of destinos) {
    try {
      await sock.sendMessage(d, {
        text: "🧪 TESTE " + new Date().toLocaleTimeString()
      });

      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      logger.error(e);
    }
  }

  res.json({ ok: true });
});

// ================= WHATSAPP =================

async function iniciarWhatsApp(id) {
  const { state, saveCreds } = await useMultiFileAuthState("auth_" + id);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false
  });

  sessoes[id] = sock;
  statusSessao[id] = "connecting";

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr } = update;

    if (qr) {
      qrCodes[id] = await qrcode.toDataURL(qr);
    }

    if (connection === "open") {
      statusSessao[id] = "open";
      qrCodes[id] = null;
      logger.info("WHATSAPP CONECTADO: " + id);
    }

    if (connection === "close") {
      statusSessao[id] = "closed";
      delete sessoes[id];
      logger.warn("WHATSAPP DESCONECTADO: " + id);
    }
  });
}

// ================= START =================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info("API ONLINE NA PORTA " + PORT);
});