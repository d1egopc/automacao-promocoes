const cron = require("node-cron");
const express = require("express");
const cors = require("cors");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
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

// ================== MEMORY ==================
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
// 🔥 AGORA RETORNA STRING DIRETA (SEM CONVERTER)
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

// ================== WHATSAPP ==================
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

    sock.ev.on("connection.update", (update) => {
      const { connection, qr } = update;

      console.log("📡 EVENTO:", { connection });

      // 🔥 QR AGORA É STRING DIRETA (SEM CONVERSÃO)
      if (qr) {
        console.log("📲 QR GERADO:", id);

        qrCodes[id] = qr; // 👈 CORREÇÃO PRINCIPAL
      }

      if (connection === "open") {
        console.log("✅ CONECTADO:", id);
        statusSessao[id] = "open";
        qrCodes[id] = null;
      }

      if (connection === "close") {
        console.log("❌ DESCONECTADO:", id);
        statusSessao[id] = "closed";
        qrCodes[id] = null;
      }
    });

  } catch (err) {
    console.log("🔥 ERRO:", err.message);
  }
}

// ================== CRON ==================
cron.schedule("*/10 * * * *", async () => {
  console.log("⏱️ AUTOMACAO RODANDO");

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