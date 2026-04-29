const cron = require("node-cron");
const qrcode = require("qrcode");
const express = require("express");
const cors = require("cors");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();
app.use(cors());
app.use(express.json());

// ================== STATUS ==================
app.get("/", (req, res) => {
  res.json({ status: "API ONLINE" });
});

app.get("/automacao", (req, res) => {
  res.json({ status: "ok", message: "Automação WhatsApp online" });
});

// ================== MEMÓRIA ==================
let sessoes = {};
let qrCodes = {};
let statusSessao = {};
let destinosPorSessao = {};

// ================== CONECTAR ==================
app.post("/conectar", async (req, res) => {
  const { id } = req.body;

  if (!id) return res.status(400).json({ erro: "ID obrigatório" });

  iniciarWhatsApp(id);

  res.json({ ok: true, message: "Conectando WhatsApp..." });
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

  return res.json({
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

// ================== TESTE ==================
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

// ================== WHATSAPP BLINDADO ==================
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

    // 🔥 EVENTO PRINCIPAL BLINDADO
    sock.ev.on("connection.update", async (update) => {
      console.log("📡 EVENTO:", JSON.stringify(update));

      const connection = update.connection;

      // 🔥 QR (forma mais confiável possível)
      if (update.qr) {
        console.log("📲 QR GERADO:", id);

        try {
          qrCodes[id] = await qrcode.toDataURL(update.qr);
        } catch (e) {
          console.log("Erro QR:", e.message);
        }
      }

      // 🔥 CONECTADO
      if (connection === "open") {
        console.log("✅ CONECTADO:", id);
        statusSessao[id] = "open";
        qrCodes[id] = null;
      }

      // 🔥 FECHADO + RECONNECT INTELIGENTE
      if (connection === "close") {
        const reason = update.lastDisconnect?.error?.output?.statusCode;

        console.log("❌ FECHADO:", id, "REASON:", reason);

        statusSessao[id] = "closed";
        qrCodes[id] = null;

        // reconexão controlada
        if (reason !== DisconnectReason.loggedOut) {
          setTimeout(() => iniciarWhatsApp(id), 4000);
        }
      }
    });

  } catch (err) {
    console.log("🔥 ERRO WHATSAPP:", err.message);
  }
}

// ================== CRON ==================
cron.schedule("*/10 * * * *", async () => {
  console.log("⏱️ AUTOMAÇÃO RODANDO");

  for (let id in sessoes) {
    const sock = sessoes[id];
    const destinos = destinosPorSessao[id] || [];

    if (!sock || destinos.length === 0) continue;

    for (let d of destinos) {
      try {
        await sock.sendMessage(d, {
          text: "🔥 Promo automática " + new Date().toLocaleTimeString()
        });
      } catch (e) {
        console.log("Erro auto:", e.message);
      }
    }
  }
});

// ================== START ==================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🌐 API ONLINE NA PORTA", PORT);
});