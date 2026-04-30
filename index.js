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

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

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
  return jwt.sign({ admin: true, clienteId: "admin" }, JWT_SECRET, { expiresIn: "7d" });
}

function getClienteId(req) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  try {
    return jwt.verify(token, JWT_SECRET).clienteId || "admin";
  } catch {
    return "admin";
  }
}

app.use((req, res, next) => {
  if (req.path === "/" || req.path === "/login" || req.path.startsWith("/qr") || req.path.startsWith("/status") || req.path.startsWith("/reset")) return next();
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ erro: "Token inválido" });
  try { jwt.verify(token, JWT_SECRET); next(); } catch { return res.status(401).json({ erro: "Não autorizado" }); }
});

// ================= LOGIN =================

app.post("/login", async (req, res) => {
  const { user, pass } = req.body;
  if (user !== ADMIN_USER) return res.status(401).json({ erro: "Usuário inválido" });
  const ok = await bcrypt.compare(pass, ADMIN_PASS_HASH);
  if (!ok) return res.status(401).json({ erro: "Senha inválida" });
  res.json({ ok: true, token: gerarToken() });
});

app.get("/", (req, res) => {
  res.json({ status: "API ONLINE" });
});

// ================= PREÇO AJUSTADO =================

function limparPreco(valor) {
  if (!valor) return "";

  let texto = String(valor).trim();

  texto = texto.replace(/\D/g, "");

  if (!texto) return "";

  let numero = Number(texto);

  if (numero > 1000) {
    numero = numero / 100;
  }

  return numero.toFixed(2).replace(".", ",");
}

// ================= MERCADO LIVRE =================

async function importarMercadoLivre(url) {
  const html = await (await fetch(url)).text();

  const titulo = (html.match(/<title>(.*?)<\/title>/)?.[1] || "").replace(" | Mercado Livre", "");

  let precoMatch = html.match(/"price":\s?([0-9.]+)/);
  let preco = precoMatch ? limparPreco(precoMatch[1]) : "";

  let precoNumero = Number(preco.replace(",", "."));
  let precoAntigo = precoNumero ? (precoNumero * 1.2).toFixed(2).replace(".", ",") : "";

  let imagem = html.match(/"secure_url":"(https:\/\/http.*?)"/)?.[1]?.replace(/\\u002F/g, "/") || "";

  return {
    marketplace: "mercadolivre",
    titulo,
    precoAntigo,
    precoAtual: preco,
    linkOriginal: url,
    linkAfiliado: url,
    imagem,
    categoria: "Mercado Livre"
  };
}

// ================= IMPORTAÇÃO =================

app.post("/importar-produto", async (req, res) => {
  const { marketplace, url } = req.body;

  if (marketplace === "mercadolivre") {
    try {
      return res.json(await importarMercadoLivre(url));
    } catch {
      return res.json({ titulo: "Produto Mercado Livre importado" });
    }
  }

  return res.json({ titulo: "Produto importado" });
});

// ================= WHATSAPP =================

app.post("/conectar", async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ erro: "ID obrigatório" });
  iniciarWhatsApp(id);
  res.json({ ok: true });
});

app.get("/status/:id", (req, res) => {
  res.json({ conectado: statusSessao[req.params.id] === "open" });
});

app.get("/qr/:id", (req, res) => {
  res.json({ qr: qrCodes[req.params.id] || null });
});

app.post("/destinos/:id", (req, res) => {
  destinosPorSessao[req.params.id] = req.body.destinos;
  res.json({ ok: true });
});

app.post("/test-send/:id", async (req, res) => {
  const sock = sessoes[req.params.id];
  const destinos = destinosPorSessao[req.params.id] || [];

  for (const d of destinos) {
    await sock.sendMessage(d, { text: req.body.mensagem || "teste" });
  }

  res.json({ ok: true });
});

async function iniciarWhatsApp(id) {
  const { state, saveCreds } = await useMultiFileAuthState("auth_" + id);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({ version, auth: state });
  sessoes[id] = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, qr }) => {
    if (qr) qrCodes[id] = await qrcode.toDataURL(qr);
    if (connection === "open") statusSessao[id] = "open";
  });
}

app.listen(3000, () => console.log("🔥 API ONLINE"));