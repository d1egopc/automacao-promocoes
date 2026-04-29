const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode");
const cron = require("node-cron");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();
app.use(cors());
app.use(express.json());

// ================== SAFE HANDLERS ==================
process.on("uncaughtException", (err) => {
  console.log("🔥 UNCaughtException:", err.message);
});

process.on("unhandledRejection", (err) => {
  console.log("🔥 UnhandledRejection:", err);
});

// ================== MEMORY ==================
let sessoes = {};
let qrCodes = {};
let statusSessao = {};
let destinosPorSessao = {};

// ================== HEALTH ==================
app.get("/", (req, res) => {
  res.json({ status: "API ONLINE" });
});

app.get("/automacao", (req, res) => {
  res.json({ status: "ok", message: "WhatsApp API rodando" });
});

// ================== CONECTAR ==================
app.post("/conectar", async (req, res) => {
  const { id } = req.body;

  if (!id) return res.status(400).json({ erro: "ID obrigatório" });

  iniciarWhatsApp(id);

  res.json({ ok: true, message: "Conectando..." });
});

// ================== STATUS ==================
app.get("/status/:id", (req, res) => {
  const { id } = req.params;

  res.json({
    conectado: statusSessao[id] === "open",
    status: statusSessao[id] || "offline"
  });
});

// ================== QR ==================
app.get("/qr/:id", (req, res) => {
  const { id } = req.params;

  if (!qrCodes[id]) {
    return res.json({
      status: "loading",
      qr: null
    });
  }

  res.json({
    status: "ready",
    qr: qrCodes[id]
  });
});

// ================== GRUPOS ==================
app.get("/grupos/:id", async (req, res) => {
  const sock = sessoes[req.params.id];

  if (!sock) return res.status(400).json({ erro: "Sem sessão" });

  try {
    const grupos = await sock.groupFetchAllParticipating();

    const lista = Object.entries(grupos).map(([id, g]) => ({
      id,
      nome: g.subject
    }));

    res.json(lista);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ================== DESTINOS ==================
app.post("/destinos/:id", (req, res) => {
  destinosPorSessao[req.params.id] = req.body.destinos || [];
  res.json({ ok: true });
});

app.get("/destinos/:id", (req, res) => {
  res.json(destinosPorSessao[req.params.id] || []);
});

// ================== TESTE ENVIO ==================
app.post("/test-send/:id", async (req, res) => {
  const sock = sessoes[req.params.id];
  const destinos = destinosPorSessao[req.params.id] || [];

  if (!sock) return res.status(400).json({ erro: "Sem sessão" });

  for (let d of destinos) {
    await sock.sendMessage(d, {
      text: "🧪 TESTE " + new Date().toLocaleTimeString()
    });
  }

  res.json({ ok: true });
});

// ================== WHATSAPP CORE (ANTI-CRASH) ==================
async function iniciarWhatsApp(id) {
  try {
    console.log("🚀 INICIANDO:", id);

    const { state, saveCreds } = await useMultiFileAuthState("auth_" + id);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false
    });

    sessoes[id] = sock;
    statusSessao[id] = "connecting";
    qrCodes[id] = null;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

      console.log("📡 EVENTO:", connection);

      // ================= QR =================
      if (qr) {
        console.log("📲 QR GERADO:", id);

        try {
          qrCodes[id] = await qrcode.toDataURL(qr);
        } catch (e) {
          console.log("QR ERROR:", e.message);
        }
      }

      // ================= CONNECTED =================
      if (connection === "open") {
        console.log("✅ CONECTADO:", id);
        statusSessao[id] = "open";
        qrCodes[id] = null;
      }

      // ================= DISCONNECT (SAFE) =================
      if (connection === "close") {
        const reason = lastDisconnect?.error?.output?.statusCode;

        console.log("❌ DESCONECTADO:", id, reason);

        statusSessao[id] = "closed";
        qrCodes[id] = null;

        // 🔥 ANTI LOOP CRASH
        if (reason !== DisconnectReason.loggedOut) {
          setTimeout(() => {
            console.log("♻️ RECONNECT:", id);
            iniciarWhatsApp(id);
          }, 8000);
        }
      }
    });

  } catch (err) {
    console.log("🔥 INIT ERROR:", err.message);
  }
}

// ================== CRON ==================
cron.schedule("*/10 * * * *", async () => {
  console.log("⏱️ AUTOMAÇÃO RODANDO");

  for (let id in sessoes) {
    const sock = sessoes[id];
    const destinos = destinosPorSessao[id] || [];

    if (!sock) continue;

    for (let d of destinos) {
      try {
        await sock.sendMessage(d, {
          text: "🔥 Promo automática " + new Date().toLocaleTimeString()
        });
      } catch (e) {
        console.log("Erro envio:", e.message);
      }
    }
  }
});

// ================== START ==================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🌐 API ONLINE NA PORTA", PORT);
});