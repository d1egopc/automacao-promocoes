const cron = require("node-cron");
const qrcode = require("qrcode");
const express = require("express");
const cors = require("cors");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

// ================== API ==================
const app = express();
app.use(cors());
app.use(express.json());

// ================== STATUS API ==================
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

  if (!id) {
    return res.status(400).json({ erro: "ID obrigatório" });
  }

  console.log("🚀 Conectando:", id);

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
  const { id } = req.params;
  const sock = sessoes[id];

  if (!sock) {
    return res.status(400).json({ erro: "Sessão não encontrada" });
  }

  try {
    const grupos = await sock.groupFetchAllParticipating();

    const lista = Object.entries(grupos).map(([gid, g]) => ({
      id: gid,
      nome: g.subject
    }));

    res.json(lista);

  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ================== DESTINOS ==================
app.post("/destinos/:id", (req, res) => {
  const { id } = req.params;
  const { destinos } = req.body;

  destinosPorSessao[id] = destinos || [];

  res.json({ ok: true });
});

app.get("/destinos/:id", (req, res) => {
  const { id } = req.params;

  res.json(destinosPorSessao[id] || []);
});

// ================== TESTE ==================
app.post("/test-send/:id", async (req, res) => {
  const { id } = req.params;
  const sock = sessoes[id];
  const destinos = destinosPorSessao[id] || [];

  if (!sock) {
    return res.status(400).json({ erro: "Sessão não encontrada" });
  }

  if (destinos.length === 0) {
    return res.status(400).json({ erro: "Nenhum destino selecionado" });
  }

  try {
    for (let destino of destinos) {
      await sock.sendMessage(destino, {
        text: "🧪 TESTE " + new Date().toLocaleTimeString()
      });
    }

    res.json({ ok: true });

  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ================== WHATSAPP CORE FIXED ==================
async function iniciarWhatsApp(id) {
  try {
    console.log("🚀 INICIANDO WHATSAPP:", id);

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
      const { connection, qr } = update;

      console.log("📡 EVENTO:", { id, connection });

      // 🔥 QR GERADO (CORRIGIDO)
      if (qr) {
        console.log("📲 QR GERADO:", id);

        try {
          const qrImage = await qrcode.toDataURL(qr);
          qrCodes[id] = qrImage;
        } catch (err) {
          console.log("Erro QR:", err.message);
        }
      }

      // 🔥 CONECTADO
      if (connection === "open") {
        console.log("✅ CONECTADO:", id);
        statusSessao[id] = "open";
        qrCodes[id] = null;
      }

      // 🔥 FECHADO
      if (connection === "close") {
        console.log("❌ DESCONECTADO:", id);
        statusSessao[id] = "closed";
        qrCodes[id] = null;
      }
    });

  } catch (err) {
    console.log("🔥 ERRO WHATSAPP:", err.message);
  }
}

// ================== CRON ==================
cron.schedule("*/10 * * * *", async () => {
  console.log("⏱️ AUTOMAÇÃO RODANDO...");

  for (let id in sessoes) {
    const sock = sessoes[id];
    const destinos = destinosPorSessao[id] || [];

    if (!sock || destinos.length === 0) continue;

    for (let destino of destinos) {
      try {
        await sock.sendMessage(destino, {
          text: "🔥 Promoção automática " + new Date().toLocaleTimeString()
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
  console.log("🌐 API RODANDO NA PORTA", PORT);
});