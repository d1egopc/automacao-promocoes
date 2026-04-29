require("dotenv").config();

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
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const app = express();

// ================= CONFIG =================

app.use(helmet());
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300
}));

// ================= MEMÓRIA =================

let sessoes = {};
let qrCodes = {};
let statusSessao = {};

// ================= AUTH =================

const ADMIN_USER = "admin";
const ADMIN_PASS_HASH = bcrypt.hashSync("123456", 10);

function gerarToken() {
  return jwt.sign({ admin: true }, process.env.JWT_SECRET || "segredo", {
    expiresIn: "7d"
  });
}

function auth(req, res, next) {
  if (
    req.path === "/" ||
    req.path === "/login" ||
    req.path.startsWith("/qr") ||
    req.path.startsWith("/status")
  ) {
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

  res.json({ ok: true, token: gerarToken() });
});

// ================= HEALTH =================

app.get("/", (req, res) => {
  res.json({ status: "API ONLINE" });
});

// ================= CONECTAR =================

app.post("/conectar", async (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ erro: "ID obrigatório" });
  }

  try {
    await iniciarWhatsApp(id);
    res.json({ ok: true });
  } catch (e) {
    console.error("ERRO AO CONECTAR:", e);
    res.status(500).json({ erro: e.message });
  }
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

// ================= WHATSAPP =================

async function iniciarWhatsApp(id) {
  console.log("🚀 Iniciando sessão:", id);

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
    console.log("📡 UPDATE:", update);

    const { connection, qr } = update;

    if (qr) {
      console.log("🔥 QR RECEBIDO!");

      qrCodes[id] = await qrcode.toDataURL(qr);
    }

    if (connection === "open") {
      console.log("✅ WHATSAPP CONECTADO");

      statusSessao[id] = "open";
      qrCodes[id] = null;
    }

    if (connection === "close") {
      console.log("❌ WHATSAPP DESCONECTADO");

      statusSessao[id] = "closed";
      delete sessoes[id];
    }
  });
}

// ================= START =================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🔥 API ONLINE NA PORTA " + PORT);
});