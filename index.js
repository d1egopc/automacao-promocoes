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

app.get("/", (req, res) => {
  res.send("🚀 API ONLINE");
});

// ================== ESTRUTURA ==================
let sessoes = {};            // sockets por cliente
let qrCodes = {};            // QR por cliente
let statusSessao = {};       // status conexão
let destinosPorSessao = {};  // destinos por cliente

// ================== CONECTAR ==================
app.post("/conectar", async (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ erro: "ID obrigatório" });
  }

  iniciarWhatsApp(id);

  res.json({ ok: true, mensagem: "Iniciando conexão..." });
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
    return res.send("QR ainda não disponível...");
  }

  res.send(`
    <h2>Conectar WhatsApp</h2>
    <img src="${qrCodes[id]}" />
    <p>Atualize se necessário</p>
  `);
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

  destinosPorSessao[id] = destinos;

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
    return res.status(400).json({ erro: "Nenhum destino cadastrado" });
  }

  try {
    for (let destino of destinos) {
      await sock.sendMessage(destino, {
        text: "🧪 TESTE " + new Date().toLocaleTimeString()
      });

      console.log(`📨 [${id}] Enviado para:`, destino);
    }

    res.json({ ok: true });

  } catch (e) {
    console.log("Erro envio:", e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ================== WHATSAPP ==================
async function iniciarWhatsApp(id) {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("auth_" + id);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state
    });

    sessoes[id] = sock;
    statusSessao[id] = "connecting";

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, qr } = update;

      if (qr) {
        console.log("📱 QR gerado para:", id);
        qrCodes[id] = await qrcode.toDataURL(qr);
      }

      if (connection === "open") {
        console.log("✅ Conectado:", id);
        statusSessao[id] = "open";
        qrCodes[id] = null;
      }

      if (connection === "close") {
        console.log("❌ Desconectado:", id);
        statusSessao[id] = "closed";

        setTimeout(() => iniciarWhatsApp(id), 5000);
      }
    });

  } catch (err) {
    console.log("Erro sessão:", err.message);
  }
}

// ================== CRON ==================
cron.schedule("*/10 * * * *", async () => {
  console.log("⏱️ Rodando automação...");

  for (let id in sessoes) {
    const sock = sessoes[id];
    const destinos = destinosPorSessao[id] || [];

    if (!sock || destinos.length === 0) continue;

    for (let destino of destinos) {
      try {
        await sock.sendMessage(destino, {
          text: "🔥 Promoção automática " + new Date().toLocaleTimeString()
        });

        console.log(`📨 [${id}] Auto enviado para:`, destino);

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