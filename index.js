```js
// index.js

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode");
const cron = require("node-cron");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();

const logger = pino({
  transport: {
    target: "pino-pretty"
  }
});

app.use(helmet());

app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true
}));

app.use(express.json({ limit: "10mb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300
});

app.use(limiter);

// ================= SAFE =================

process.on("uncaughtException", (err) => {
  logger.error(err);
});

process.on("unhandledRejection", (err) => {
  logger.error(err);
});

// ================= MEMÓRIA =================

let sessoes = {};
let qrCodes = {};
let statusSessao = {};
let destinosPorSessao = {};

let automacaoState = {
  ativa: false,
  ligadaEm: null,
  desligadaEm: null,
};

// ================= AUTH =================

const ADMIN_USER = "admin";
const ADMIN_PASS_HASH = bcrypt.hashSync("123456", 10);

function gerarToken() {
  return jwt.sign(
    { admin: true },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {

  if (req.path === "/") {
    return next();
  }

  if (req.path === "/login") {
    return next();
  }

  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      erro: "Token inválido"
    });
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      erro: "Não autorizado"
    });
  }
}

app.use(auth);

// ================= LOGIN =================

app.post("/login", async (req, res) => {

  const { user, pass } = req.body;

  if (user !== ADMIN_USER) {
    return res.status(401).json({
      erro: "Usuário inválido"
    });
  }

  const ok = await bcrypt.compare(
    pass,
    ADMIN_PASS_HASH
  );

  if (!ok) {
    return res.status(401).json({
      erro: "Senha inválida"
    });
  }

  const token = gerarToken();

  res.json({
    ok: true,
    token
  });
});

// ================= HEALTH =================

app.get("/", (req, res) => {
  res.json({
    status: "API ONLINE",
    uptime: process.uptime()
  });
});

// ================= AUTOMAÇÃO =================

app.get("/automacao", (req, res) => {

  res.json({
    ok: true,
    ativa: automacaoState.ativa,
    ligadaEm: automacaoState.ligadaEm,
    desligadaEm: automacaoState.desligadaEm,
  });
});

app.post("/automacao/toggle", (req, res) => {

  automacaoState.ativa =
    !automacaoState.ativa;

  if (automacaoState.ativa) {
    automacaoState.ligadaEm =
      new Date().toISOString();
  } else {
    automacaoState.desligadaEm =
      new Date().toISOString();
  }

  logger.info(
    `AUTOMACAO: ${automacaoState.ativa}`
  );

  res.json({
    ok: true,
    ativa: automacaoState.ativa
  });
});

// ================= CONECTAR =================

app.post("/conectar", async (req, res) => {

  const { id } = req.body;

  if (!id) {
    return res.status(400).json({
      erro: "ID obrigatório"
    });
  }

  if (sessoes[id]) {
    return res.json({
      ok: true,
      message: "Sessão já conectada"
    });
  }

  iniciarWhatsApp(id);

  res.json({
    ok: true
  });
});

// ================= STATUS =================

app.get("/status/:id", (req, res) => {

  const { id } = req.params;

  res.json({
    conectado: statusSessao[id] === "open",
    status: statusSessao[id] || "offline"
  });
});

// ================= QR =================

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

// ================= GRUPOS =================

app.get("/grupos/:id", async (req, res) => {

  const sock = sessoes[req.params.id];

  if (!sock) {
    return res.status(400).json({
      erro: "Sem sessão"
    });
  }

  try {

    const grupos =
      await sock.groupFetchAllParticipating();

    const lista =
      Object.entries(grupos).map(([id, g]) => ({
        id,
        nome: g.subject
      }));

    res.json(lista);

  } catch (e) {

    logger.error(e);

    res.status(500).json({
      erro: e.message
    });
  }
});

// ================= DESTINOS =================

app.post("/destinos/:id", (req, res) => {

  if (!Array.isArray(req.body.destinos)) {
    return res.status(400).json({
      erro: "destinos deve ser array"
    });
  }

  destinosPorSessao[req.params.id] =
    req.body.destinos;

  res.json({
    ok: true
  });
});

app.get("/destinos/:id", (req, res) => {

  res.json(
    destinosPorSessao[req.params.id] || []
  );
});

// ================= DELAY =================

function randomDelay() {

  const min =
    Number(process.env.MIN_DELAY || 4000);

  const max =
    Number(process.env.MAX_DELAY || 9000);

  return Math.floor(
    Math.random() * (max - min + 1)
  ) + min;
}

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

// ================= TEST SEND =================

app.post("/test-send/:id", async (req, res) => {

  const sock = sessoes[req.params.id];

  const destinos =
    destinosPorSessao[req.params.id] || [];

  if (!sock) {
    return res.status(400).json({
      erro: "Sem sessão"
    });
  }

  for (const d of destinos) {

    try {

      await sock.sendMessage(d, {
        text:
          "🧪 TESTE " +
          new Date().toLocaleTimeString()
      });

      logger.info(
        `Mensagem enviada para ${d}`
      );

      await sleep(randomDelay());

    } catch (e) {

      logger.error(e);
    }
  }

  res.json({
    ok: true
  });
});

// ================= WHATSAPP =================

async function iniciarWhatsApp(id) {

  try {

    logger.info(`INICIANDO ${id}`);

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(
      "auth_" + id
    );

    const {
      version
    } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false
    });

    sessoes[id] = sock;

    statusSessao[id] = "connecting";

    qrCodes[id] = null;

    sock.ev.on(
      "creds.update",
      saveCreds
    );

    sock.ev.on(
      "connection.update",
      async (update) => {

        const {
          connection,
          qr,
          lastDisconnect
        } = update;

        if (qr) {

          try {

            qrCodes[id] =
              await qrcode.toDataURL(qr);

          } catch (e) {

            logger.error(e);
          }
        }

        if (connection === "open") {

          logger.info(
            `CONECTADO ${id}`
          );

          statusSessao[id] = "open";

          qrCodes[id] = null;
        }

        if (connection === "close") {

          const reason =
            lastDisconnect?.error?.output
              ?.statusCode;

          logger.warn(
            `DESCONECTADO ${id}`
          );

          statusSessao[id] = "closed";

          qrCodes[id] = null;

          delete sessoes[id];

          if (
            reason !==
            DisconnectReason.loggedOut
          ) {

            setTimeout(() => {

              iniciarWhatsApp(id);

            }, 8000);
          }
        }
      }
    );

  } catch (err) {

    logger.error(err);
  }
}

// ================= CRON =================

cron.schedule("*/10 * * * *", async () => {

  if (!automacaoState.ativa) {

    logger.info(
      "AUTOMAÇÃO DESLIGADA"
    );

    return;
  }

  logger.info(
    "AUTOMAÇÃO RODANDO"
  );

  for (const id in sessoes) {

    const sock = sessoes[id];

    const destinos =
      destinosPorSessao[id] || [];

    if (
      !sock ||
      statusSessao[id] !== "open"
    ) {
      continue;
    }

    for (const d of destinos) {

      try {

        await sock.sendMessage(d, {
          text:
            "🔥 Promo automática " +
            new Date().toLocaleTimeString()
        });

        logger.info(
          `Enviado para ${d}`
        );

        await sleep(randomDelay());

      } catch (e) {

        logger.error(e);
      }
    }
  }
});

// ================= HEARTBEAT =================

setInterval(() => {

  logger.info("SERVER ALIVE");

}, 30000);

// ================= START =================

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  logger.info(
    `API ONLINE NA PORTA ${PORT}`
  );
});
```
