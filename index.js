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

// ================== HEALTH CHECK ==================
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

  iniciarWhatsApp(id);

  res.json({ ok: true, mensagem: "Conectando WhatsApp..." });
});

// ================== STATUS ==================
app.get("/status/:id", (req, res) => {
  const { id } = req.params;

  res.json({
    conectado: statusSessao[id] === "open",
    status: statusSessao[id] || "offline"
  });
});

// ================== QR (IMPORTANTE) ==================
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

// ================== WHATSAPP CORE ==================
async function iniciarWhatsApp(id) {
  try {
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
    qrCodes[id] = null;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, qr } = update;

      // 🔥 QR GERADO
      if (qr) {
        console.log("📲 QR GERADO:", id);

        try {
          qrCodes[id] = await qrcode.toDataURL(qr);
        } catch (err) {
          console.log("Erro QR encode:", err.message);
        }
      }

      // 🔥 CONECTADO
      if (connection === "open") {
        console.log("✅ CONECTADO:", id);
        statusSessao[id] = "open";
        qrCodes[id] = null;
      }

      // 🔥 DESCONECTADO
      if (connection === "close") {
        console.log("❌ DESCONECTADO:", id);
        statusSessao[id] = "closed";
      }
    });

  } catch (err) {
    console.log("🔥 ERRO WHATSAPP:", err.message);
  }
}

// ================== CRON ==================
cron.schedule("*/10 * * * *", async () => {
  console.log("⏱️ Automação rodando...");

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
  console.log("🌐 API rodando na porta", PORT);
});