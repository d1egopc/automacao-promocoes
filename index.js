const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode");
const cron = require("node-cron");
const path = require("path");
const fs = require("fs");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();
app.use(cors());
app.use(express.json());

// ================== SAFE ==================
process.on("uncaughtException", (err) => {
  console.log("🔥 uncaughtException:", err.message);
});
process.on("unhandledRejection", (err) => {
  console.log("🔥 unhandledRejection:", err);
});

// ================== MEMORY ==================
let sessoes = {};
let qrCodes = {};
let statusSessao = {};
let destinosPorSessao = {};

// ================== AUTOMAÇÃO ==================
let automacaoState = {
  ativa: false,
  ligadaEm: null,
  desligadaEm: null,
};

// ================== HEALTH ==================
app.get("/", (req, res) => {
  res.json({ status: "API ONLINE" });
});

// ================== AUTOMAÇÃO ==================
app.get("/automacao", (req, res) => {
  res.json({
    ok: true,
    ativa: automacaoState.ativa,
    ligadaEm: automacaoState.ligadaEm,
    desligadaEm: automacaoState.desligadaEm,
  });
});

app.post("/automacao/toggle", (req, res) => {
  automacaoState.ativa = !automacaoState.ativa;

  if (automacaoState.ativa) {
    automacaoState.ligadaEm = new Date().toISOString();
  } else {
    automacaoState.desligadaEm = new Date().toISOString();
  }

  res.json({ ok: true, ativa: automacaoState.ativa });
});

// ================== WHATSAPP CORE ==================
async function iniciarWhatsApp(id, { forceQr = false } = {}) {
  try {
    const authDir = path.join(__dirname, "auth", id);
    fs.mkdirSync(authDir, { recursive: true });

    if (forceQr) {
      fs.rmSync(authDir, { recursive: true, force: true });
      fs.mkdirSync(authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ["DiegoPC", "Chrome", "1.0.0"],
    });

    sessoes[id] = sock;
    statusSessao[id] = "connecting";
    qrCodes[id] = null;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        qrCodes[id] = await qrcode.toDataURL(qr);
        statusSessao[id] = "qr";
      }

      if (connection === "open") {
        statusSessao[id] = "open";
        qrCodes[id] = null;
        console.log("✅ Conectado:", id);
      }

      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;

        statusSessao[id] = loggedOut ? "logged_out" : "offline";
        qrCodes[id] = null;

        if (!loggedOut) {
          setTimeout(() => iniciarWhatsApp(id), 3000);
        } else {
          fs.rmSync(authDir, { recursive: true, force: true });
        }
      }
    });

  } catch (err) {
    console.log("Erro iniciar:", err.message);
  }
}

// ================== RESTORE ==================
async function restoreAllSessions() {
  const baseDir = path.join(__dirname, "auth");
  if (!fs.existsSync(baseDir)) return;

  const ids = fs.readdirSync(baseDir);
  for (const id of ids) {
    iniciarWhatsApp(id);
  }
}
restoreAllSessions();

// ================== CONECTAR ==================
app.post("/conectar", async (req, res) => {
  const { id, forceQr } = req.body;

  if (!id) return res.status(400).json({ erro: "ID obrigatório" });

  const status = statusSessao[id];

  if (status === "open" || status === "connecting") {
    return res.json({ ok: true, status });
  }

  await iniciarWhatsApp(id, { forceQr });

  res.json({ ok: true, status: "connecting" });
});

// ================== STATUS ==================
app.get("/status/:id", (req, res) => {
  res.json({
    status: statusSessao[req.params.id] || "offline",
    conectado: statusSessao[req.params.id] === "open",
  });
});

// ================== QR ==================
app.get("/qr/:id", (req, res) => {
  res.json({
    qr: qrCodes[req.params.id] || null,
  });
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
      text: "🧪 TESTE " + new Date().toLocaleTimeString(),
    });
  }

  res.json({ ok: true });
});

// ================== ENVIAR MENSAGEM ==================
app.post("/enviar", async (req, res) => {
  try {
    const { clientId, destino, mensagem, tipo } = req.body;

    if (!clientId || !destino || !mensagem) {
      return res.status(400).json({
        ok: false,
        error: "clientId, destino e mensagem são obrigatórios",
      });
    }

    const sock = sessoes[clientId];

    if (!sock) {
      return res.status(404).json({
        ok: false,
        error: `Sessão ${clientId} não está ativa.`,
      });
    }

    if (!sock.user) {
      return res.status(409).json({
        ok: false,
        error: "WhatsApp desconectado.",
      });
    }

    let jid;

    if (tipo === "grupo" || destino.includes("@g.us")) {
      jid = destino.includes("@g.us") ? destino : `${destino}@g.us`;
    } else {
      const numero = String(destino).replace(/\D/g, "");
      if (!numero) {
        return res.status(400).json({ ok: false, error: "Número inválido" });
      }
      jid = `${numero}@s.whatsapp.net`;
    }

    const result = await sock.sendMessage(jid, {
      text: mensagem,
    });

    console.log(`📤 [${clientId}] → ${jid}`);

    res.json({
      ok: true,
      messageId: result?.key?.id ?? null,
      jid,
    });

  } catch (err) {
    console.error("Erro envio:", err);

    res.status(500).json({
      ok: false,
      error: err?.message || "Erro ao enviar",
    });
  }
});

// ================== CRON ==================
cron.schedule("*/10 * * * *", async () => {
  if (!automacaoState.ativa) return;

  for (let id in sessoes) {
    const sock = sessoes[id];
    const destinos = destinosPorSessao[id] || [];

    if (!sock) continue;

    for (let d of destinos) {
      try {
        await sock.sendMessage(d, {
          text: "🔥 Promo automática " + new Date().toLocaleTimeString(),
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
  console.log("🌐 Rodando na porta", PORT);
});