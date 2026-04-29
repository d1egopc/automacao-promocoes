const cron = require("node-cron");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
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

app.get("/", (req, res) => {
  res.send("🚀 API ONLINE");
});

// ================== CONFIG ==================
let config = {
  ativa: true,
  intervalo: "*/10 * * * *",
  destinos: []
};

// ================== ROTAS ==================

app.get("/automacao", (req, res) => {
  res.json({
    ativa: config.ativa,
    intervalo: config.intervalo,
    destinos: config.destinos.length
  });
});

app.post("/config", (req, res) => {
  config = { ...config, ...req.body };
  console.log("⚙️ CONFIG ATUALIZADA:", config);
  res.json({ ok: true });
});

// ================== TESTE ENVIO ==================
app.post("/test-send", async (req, res) => {
  try {
    console.log("🧪 Teste manual disparado");
    console.log("📍 Destinos:", config.destinos);

    if (!sock) {
      return res.status(500).json({ erro: "WhatsApp não conectado" });
    }

    for (let destino of config.destinos) {
      await sock.sendMessage(destino, {
        text: "🧪 TESTE " + new Date().toLocaleTimeString()
      });
      console.log("📨 Enviado:", destino);
    }

    res.json({ ok: true });

  } catch (err) {
    console.log("❌ Erro:", err.message);
    res.status(500).json({ erro: "Erro ao enviar" });
  }
});

// ================== QR WEB ==================
let qrCodeBase64 = null;

app.get("/qr", (req, res) => {
  if (!qrCodeBase64) {
    return res.send("QR ainda não gerado...");
  }

  res.send(`
    <h2>Escaneie o QR do WhatsApp</h2>
    <img src="${qrCodeBase64}" />
    <p>Atualize a página se não aparecer</p>
  `);
});

// ================== WHATSAPP ==================
let sock;

async function iniciarWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({ version, auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr } = update;

    if (qr) {
      console.log("📱 Novo QR gerado");

      // Terminal (pequeno)
      qrcodeTerminal.generate(qr, { small: true });

      // Web (imagem)
      qrCodeBase64 = await qrcode.toDataURL(qr);

      console.log("👉 Abra no navegador:");
      console.log("https://automacao-promocoes-production.up.railway.app/qr");
    }

    if (connection === "open") {
      console.log("✅ WhatsApp conectado!");
      qrCodeBase64 = null;
    }

    if (connection === "close") {
      console.log("❌ Desconectado — gerando novo QR...");
      setTimeout(iniciarWhatsApp, 5000);
    }
  });
}

// ================== CRON ==================
cron.schedule(config.intervalo, () => {
  if (!config.ativa) return;
  console.log("🚀 Rodando automação...");
});

// ================== START ==================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🌐 API ON na porta", PORT);
});

iniciarWhatsApp();