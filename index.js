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

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("🚀 API ONLINE");
});

// ================== CONFIG ==================
let config = {
  plataformas: {
    shopee: { ativo: false, cookie: "" },
    aliexpress: { ativo: false, key: "", secret: "" },
    amazon: { ativo: false, key: "", secret: "", tag: "" },
    mercadolivre: { ativo: false, token: "" }
  },
  destinos: []
};

app.post("/config", (req, res) => {
  config = { ...config, ...req.body };
  console.log("⚙️ CONFIG ATUALIZADA");
  res.json({ ok: true });
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

// ================== BUSCA ==================
async function buscarShopee() {
  if (!config.plataformas.shopee.ativo) return [];

  try {
    const res = await axios.get(
      "https://shopee.com.br/api/v4/recommend/recommend",
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Cookie": config.plataformas.shopee.cookie
        }
      }
    );

    const itens = res.data?.data?.sections?.[0]?.data?.item || [];

    return itens.map(p => ({
      nome: p.name,
      preco: p.price / 100000,
      preco_antigo: p.price_before_discount / 100000,
      link: `https://shopee.com.br/product/${p.shopid}/${p.itemid}`,
      origem: "Shopee"
    }));

  } catch (err) {
    console.log("Erro Shopee:", err.message);
    return [];
  }
}

async function buscarAliExpress() { return []; }
async function buscarAmazon() { return []; }
async function buscarMercadoLivre() { return []; }

// ================== FILTRO ==================
function filtrar(lista) {
  return lista.filter(p => {
    if (!p.preco || !p.preco_antigo) return true;
    const d = ((p.preco_antigo - p.preco) / p.preco_antigo) * 100;
    return d >= 30;
  });
}

// ================== MENSAGEM ==================
function montarMensagem(p) {
  return `🔥 ${p.origem} OFERTA

🛍️ ${p.nome}
💰 R$ ${p.preco}
❌ De: R$ ${p.preco_antigo}

👉 ${p.link}`;
}

// ================== ENVIO ==================
async function enviar(msg) {
  if (!sock) return;

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

// ================== AUTOMAÇÃO ==================
cron.schedule("*/10 * * * *", async () => {
  console.log("🚀 Rodando automação...");

  let lista = [];

  lista.push(...await buscarShopee());
  lista.push(...await buscarAliExpress());
  lista.push(...await buscarAmazon());
  lista.push(...await buscarMercadoLivre());

  lista = filtrar(lista);

  for (let p of lista) {
    await enviar(montarMensagem(p));
  }
});

// ================== START ==================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🌐 API ON na porta", PORT);
});

iniciarWhatsApp();