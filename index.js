const cron = require("node-cron");
const qrcode = require("qrcode-terminal");
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

// ================== API ==================
const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("🚀 API ONLINE");
});

// ================== CONFIG ==================
let config = {
  ativa: true,
  intervalo: "*/10 * * * *",
  plataformas: {
    shopee: { ativo: false, cookie: "" },
    aliexpress: { ativo: false, key: "", secret: "" },
    amazon: { ativo: false, key: "", secret: "", tag: "" },
    mercadolivre: { ativo: false, token: "" }
  },
  destinos: []
};

// ================== ROTAS ==================

app.get("/automacao", (req, res) => {
  res.json({
    ativa: config.ativa,
    intervalo: config.intervalo,
    destinos: config.destinos.length,
    plataformas: config.plataformas
  });
});

app.post("/automacao/toggle", (req, res) => {
  config.ativa = !config.ativa;

  if (config.ativa) {
    startCron();
    console.log("🟢 Automação ATIVADA");
  } else {
    if (task) task.stop();
    console.log("🔴 Automação DESLIGADA");
  }

  res.json({ ativa: config.ativa });
});

app.post("/automacao/intervalo", (req, res) => {
  const { intervalo } = req.body;

  if (!intervalo) {
    return res.status(400).json({ erro: "Intervalo obrigatório" });
  }

  config.intervalo = intervalo;
  restartCron();

  res.json({ intervalo });
});

app.post("/config", (req, res) => {
  config = { ...config, ...req.body };
  console.log("⚙️ CONFIG ATUALIZADA");
  restartCron();
  res.json({ ok: true });
});

// ================== TESTE ENVIO ==================
app.post("/test-send", async (req, res) => {
  try {
    console.log("🧪 Teste manual disparado");
    console.log("Destinos:", config.destinos);

    if (!sock) {
      console.log("❌ WhatsApp não conectado");
      return res.status(500).json({ erro: "WhatsApp não conectado" });
    }

    if (!config.destinos || config.destinos.length === 0) {
      console.log("❌ Nenhum destino cadastrado");
      return res.status(400).json({ erro: "Nenhum destino cadastrado" });
    }

    for (let destino of config.destinos) {
      try {
        console.log("📤 Enviando para:", destino);

        await sock.sendMessage(destino, {
          text: "🧪 TESTE OK - sua automação está funcionando!"
        });

        console.log("✅ Enviado com sucesso:", destino);

      } catch (e) {
        console.log("❌ Erro envio para", destino, ":", e.message);
      }
    }

    res.json({ ok: true });

  } catch (err) {
    console.log("❌ Erro geral:", err.message);
    res.status(500).json({ erro: "Erro ao enviar teste" });
  }
});

// ================== WHATSAPP ==================
let sock;
let reconnecting = false;

async function iniciarWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({ version, auth: state });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, qr } = update;

      if (qr) {
        console.log("📱 Escaneie o QR:");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        console.log("✅ WhatsApp conectado!");
      }

      if (connection === "close") {
        console.log("❌ Desconectado");

        if (!reconnecting) {
          reconnecting = true;
          setTimeout(() => {
            reconnecting = false;
            iniciarWhatsApp();
          }, 5000);
        }
      }
    });

  } catch (err) {
    console.log("Erro WhatsApp:", err.message);
  }
}

// ================== ENVIO ==================
async function enviar(msg) {
  if (!sock || !config.ativa) return;

  for (let destino of config.destinos) {
    try {
      await sock.sendMessage(destino, { text: msg });
      console.log("📨 Enviado:", destino);
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      console.log("Erro envio:", e.message);
    }
  }
}

// ================== CRON ==================
let task;

function startCron() {
  if (task) task.stop();

  task = cron.schedule(config.intervalo, async () => {
    if (!config.ativa) return;

    console.log("🚀 Rodando automação...");

    let lista = [];

    lista = [];

    for (let p of lista) {
      await enviar(`🔥 ${p.origem}\n${p.nome}\n💰 R$ ${p.preco}\n👉 ${p.link}`);
    }
  });

  console.log("⏱️ Cron iniciado:", config.intervalo);
}

function restartCron() {
  console.log("🔄 Reiniciando cron...");
  startCron();
}

// ================== START ==================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🌐 API ON na porta", PORT);
});

startCron();
iniciarWhatsApp();