
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const csv = require("csv-parser");
const zlib = require("zlib");


if (!fs.existsSync("/data")) {
  fs.mkdirSync("/data", { recursive: true });
  console.log("📁 Pasta /data criada");
}

let config = {
  automacaoAtiva: false,

  intervaloEnvioMinutos: 5,

  horarioInicio: "08:00",
  horarioFim: "23:00",

  pausarMadrugada: true,

  telegram: {
  ativo: false,

  destinos: [
    {
      nome: "Canal Principal",
      botToken: "",
      chatId: "",
      ativo: true
    }
  ]
},

// ================= DESTINOS INTELIGENTES =================

destinosInteligentes: [],

  marketplaces: {
    amazon: {
      ativo: true,
      intervaloFarejoMinutos: 30,
      limitePorRodada: 5,
      descontoMinimo: 20,
      precoMinimo: 25
    },

    shopee: {
      ativo: true,
      intervaloFarejoMinutos: 15,
      limitePorRodada: 10,
      descontoMinimo: 25,
      precoMinimo: 20
    },

    mercadolivre: {
  ativo: false,
  intervaloFarejoMinutos: 60,
  limitePorRodada: 5,
  descontoMinimo: 20,
  precoMinimo: 30
},

magalu: {
  ativo: true,
  intervaloFarejoMinutos: 30,
  limitePorRodada: 10,
  descontoMinimo: 15,
  precoMinimo: 20
},

awin: {
  ativo: true,
  intervaloFarejoMinutos: 30,
  limitePorRodada: 5,
  descontoMinimo: 0,
  precoMinimo: 0,
  loja: "kabum",
  feedFile: "awin_kabum.csv.gz"
},

aliexpress: {
  ativo: false,
  intervaloFarejoMinutos: 40,
  limitePorRodada: 5,
  descontoMinimo: 20,
  precoMinimo: 20,
  priorizarBrasil: true,
  permitirInternacionalForte: true,
  descontoMinimoInternacional: 40
  }
 }
};

let fila = [];
let enviandoAgora = false;
let controleEnvio = {}; // por cliente
let historicoOfertas = {};

const FILA_FILE = "/data/fila.json";
const CONFIG_FILE = "/data/config.json";
console.log("📂 Salvando dados em:", FILA_FILE);

function gerarChaveProduto(titulo = "") {
  return String(titulo)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(preto|branco|azul|rosa|verde|vermelho|127v|220v|110v|bivolt)\b/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function produtoRepetidoRecentemente(titulo, horas = 12) {
  const chave = gerarChaveProduto(titulo);
  const agora = Date.now();
  const limite = horas * 60 * 60 * 1000;

  if (historicoOfertas[chave] && agora - historicoOfertas[chave] < limite) {
    return true;
  }

  historicoOfertas[chave] = agora;
  return false;
}


function salvarFila() {
  try {
    fs.writeFileSync(FILA_FILE, JSON.stringify(fila, null, 2));
  } catch (e) {
    console.error("❌ ERRO AO SALVAR FILA:", e.message);
  }
}

function carregarFila() {
  try {
    if (fs.existsSync(FILA_FILE)) {
      const data = fs.readFileSync(FILA_FILE, "utf8");
      if (data) {
        fila = JSON.parse(data);
        console.log("✅ Fila carregada do arquivo");
      }
    }
  } catch (e) {
    console.error("❌ ERRO AO CARREGAR FILA:", e.message);
  }
}

function salvarConfig() {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(config, null, 2)
    );

    console.log("💾 Config salva");
  } catch (e) {
    console.error("❌ ERRO AO SALVAR CONFIG:", e.message);
  }
}

function carregarConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const dados = fs.readFileSync(CONFIG_FILE, "utf8");

      const configSalva = JSON.parse(dados);

      config = {
        ...config,
        ...configSalva
      };

function normalizarTexto(texto = "") {
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ofertaJaExiste(novaOferta) {
  const tituloNovo = normalizarTexto(novaOferta.titulo || novaOferta.nome);
  const linkNovo = String(novaOferta.link || novaOferta.linkAfiliado || "").trim();

  return fila.some((o) => {
    const tituloExistente = normalizarTexto(o.titulo || o.nome);
    const linkExistente = String(o.link || o.linkAfiliado || "").trim();

    if (linkNovo && linkExistente && linkNovo === linkExistente) return true;
    if (tituloNovo && tituloExistente && tituloNovo === tituloExistente) return true;

    return false;
  });
}

      console.log("✅ Config carregada");
    }
  } catch (e) {
    console.error("❌ ERRO AO CARREGAR CONFIG:", e.message);
  }
}

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const app = express(); // 👈 MUITO IMPORTANTE ter isso

const horarioInicio = 9;
const horarioFim = 23;

function podeRodarAgora() {
  return true;
}

let ultimoEnvioFila = 0;


// ================= HELPERS DESTINOS INTELIGENTES =================

function normalizarTexto(valor = "") {
  return String(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function destinoAceitaOferta(destino, oferta) {
  if (!destino?.ativo) return false;

  const marketplaceOferta = normalizarTexto(oferta.marketplace || oferta.loja || "");
  const categoriaOferta = normalizarTexto(oferta.categoria || "");

  const marketplacesDestino = (destino.marketplaces || []).map(normalizarTexto);
  const categoriasDestino = (destino.categorias || []).map(normalizarTexto);

  console.log("🧪 DESTINO DEBUG:", {
  nome: destino.nome,
  tipo: destino.tipo,
  marketplaceOferta,
  categoriaOferta,
  marketplacesDestino,
  categoriasDestino
  });

  if (
  marketplacesDestino.length &&
  marketplaceOferta &&
  !marketplacesDestino.includes(marketplaceOferta)
) {
  return false;
}

if (
  categoriasDestino.length &&
  categoriaOferta &&
  categoriaOferta !== marketplaceOferta &&
  !categoriasDestino.includes(categoriaOferta)
) {
  return false;
}

return true;
}

function destinoDentroHorario(destino) {
  const agoraBR = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );

  const horaAtual = agoraBR.getHours() * 60 + agoraBR.getMinutes();

  const [inicioH, inicioM] = (destino.horarioInicio || "00:00").split(":").map(Number);
  const [fimH, fimM] = (destino.horarioFim || "23:59").split(":").map(Number);

  const inicio = inicioH * 60 + inicioM;
  const fim = fimH * 60 + fimM;

  if (inicio <= fim) {
    return horaAtual >= inicio && horaAtual <= fim;
  }

  return horaAtual >= inicio || horaAtual <= fim;
}


// ================= ENVIO DESTINO INTELIGENTE =================

async function enviarParaDestinoInteligente(destino, oferta, mensagem) {

  try {

    if (!destinoAceitaOferta(destino, oferta)) {
      return;
    }

    if (!destinoDentroHorario(destino)) {
      console.log("⏰ Destino fora do horário:", destino.nome);
      return;
    }

    // ================= WHATSAPP =================

    if (String(destino.tipo || "").toLowerCase() === "whatsapp") {

      const sock = sessoes[destino.conexaoId];

      if (!sock) {
        console.log("❌ Sessão não encontrada:", destino.conexaoId);
        return;
      }

      const grupos = destino.gruposWhatsapp || [];

      for (const grupo of grupos) {

        if (destino.tipoMidia === "texto" || !oferta.imagem) {

          await sock.sendMessage(grupo, {
            text: mensagem
          });

        } else {

          await sock.sendMessage(grupo, {
            image: {
              url: corrigirImagemUrl(oferta.imagem) || oferta.imagem
            },
            caption: mensagem
          });

        }

        console.log("✅ Enviado destino WhatsApp:", destino.nome);

        await new Promise(r => setTimeout(r, 3000));
      }
    }

    // ================= TELEGRAM =================

      if (String(destino.tipo || "").toLowerCase() === "telegram") {

      const telegrams = config.telegram?.destinos || [];

      const selecionados =
      telegrams.filter(t =>
      (destino.telegramDestinos || []).includes(t.nome) ||
      (destino.telegramDestinos || []).includes(String(t.chatId))
      );
       
       console.log("🧪 TELEGRAM DEBUG:", {
       destinoNome: destino.nome,
       destinoTipo: destino.tipo,
       telegramDestinosDoDestino: destino.telegramDestinos,
       telegramsConfigurados: telegrams.map(t => ({
       nome: t.nome,
       ativo: t.ativo,
       chatId: t.chatId ? "OK" : "SEM CHATID",
       botToken: t.botToken ? "OK" : "SEM TOKEN"
       })),
       selecionados: selecionados.map(t => t.nome)
     });

   if (!selecionados.length) {
   console.log("⚠️ Nenhum Telegram selecionado para este destino:", destino.nome);
   }

      for (const tel of selecionados) {

        if (!tel.ativo) continue;

        if (destino.tipoMidia === "texto" || !oferta.imagem) {

          await axios.post(
            `https://api.telegram.org/bot${tel.botToken}/sendMessage`,
            {
              chat_id: tel.chatId,
              text: mensagem
            }
          );

        } else {

          await axios.post(
            `https://api.telegram.org/bot${tel.botToken}/sendPhoto`,
            {
              chat_id: tel.chatId,
              photo: corrigirImagemUrl(oferta.imagem) || oferta.imagem,
              caption: mensagem
            }
          );

        }

        console.log("✅ Enviado destino Telegram:", destino.nome);

        await new Promise(r => setTimeout(r, 2000));
      }
    }

  } catch (e) {

    console.log(
      "❌ erro destino inteligente:",
      destino?.nome,
      e.message
    );

  }
}

// ================= FUNCÃO PRCESSA FILA =================

async function processarFila() {
  if (enviandoAgora) return;
  enviandoAgora = true;

  try {
    if (!config.automacaoAtiva) return;

    if (!podeRodarAgora()) {
           return;
    }

    const agora = Date.now();
    const intervaloMs = (config.intervaloMinutos || 2) * 60 * 1000;

    const oferta = fila.find(o => o.status === "pendente");

    if (!oferta) {
      console.log("📭 Nenhuma oferta pendente");
      return;
    }

    const clienteId = oferta.clienteId || "admin";

    if (!controleEnvio[clienteId]) {
      controleEnvio[clienteId] = 0;
    }

    if (agora - controleEnvio[clienteId] < intervaloMs) {
      return;
    }

    let idSessao =
  oferta.sessaoId ||
  oferta.id ||
  Object.keys(destinosPorSessao).find(id => destinosPorSessao[id]?.length) ||
  Object.keys(sessoes)[0];

if (!destinosPorSessao[idSessao]?.length) {
  const sessaoComDestino = Object.keys(destinosPorSessao)
    .find(id => destinosPorSessao[id]?.length && statusSessao[id] === "open");

  if (sessaoComDestino) {
    idSessao = sessaoComDestino;
  }
}

const sock = sessoes[idSessao];

if (!sock) {
  console.log("❌ Nenhuma sessão conectada para:", idSessao);
  return;
}

console.log("📡 Sessão escolhida para envio:", idSessao);

    let ultimoEnvioFila = 0;

    const destinosBrutos =
  oferta.destinos?.length
    ? oferta.destinos
    : oferta.grupos?.length
      ? oferta.grupos
      : destinosPorSessao[idSessao]?.length
        ? destinosPorSessao[idSessao]
        : config?.destinosPorSessao?.[idSessao]?.length
          ? config.destinosPorSessao[idSessao]
          : oferta.destino
            ? [oferta.destino]
            : oferta.grupoDestino
              ? [oferta.grupoDestino]
              : config?.destinos?.length
                ? config.destinos
                : [];

const destinos = destinosBrutos
  .map(d => d?.id || d?.value || d?.jid || d)
  .filter(Boolean);

console.log("DESTINOS PARA ENVIO:", destinos);

// ================= DESTINOS INTELIGENTES =================

const todosDestinos = config.destinosInteligentes || [];

console.log("🧪 TODOS DESTINOS CONFIG:", todosDestinos.map(d => ({
  nome: d.nome,
  tipo: d.tipo,
  ativo: d.ativo,
  marketplaces: d.marketplaces,
  telegramDestinos: d.telegramDestinos
})));

const destinosInteligentes =
  todosDestinos.filter(destino =>
    destinoAceitaOferta(destino, oferta)
  );

console.log("🧪 DESTINOS APROVADOS:", destinosInteligentes.map(d => ({
  nome: d.nome,
  tipo: d.tipo
})));

console.log(
  "🧠 Destinos inteligentes compatíveis:",
  destinosInteligentes.map(d => d.nome)
);

  if (!destinosInteligentes.length) {
  console.log("⚠️ Sem destino carregado ainda. Aguardando...");
  enviandoAgora = false;
  return;
}
    
const titulo = oferta.nome || oferta.titulo || "Oferta";

const precoAtual = oferta.preco || oferta.precoAtual || "";
const precoAntigo = oferta.precoAntigo || "";
const cupom = oferta.cupom || "";
const avisoCupom = oferta.avisoCupom || "";
const marketplace = oferta.marketplace || "";
const link = oferta.link || oferta.linkAfiliado || "";
const parcelamento = oferta.parcelamento || "";

let mensagem = `🔥 OFERTA ENCONTRADA!

🛍️ ${titulo}`;

const antigoNum = Number(String(precoAntigo).replace(",", "."));
const atualNum = Number(String(precoAtual).replace(",", "."));

const temPrecoAntigoValido =
  precoAntigo &&
  precoAtual &&
  Number.isFinite(antigoNum) &&
  Number.isFinite(atualNum) &&
  antigoNum > atualNum;

if (temPrecoAntigoValido) {
  mensagem += `

❌ De: R$ ${precoAntigo}`;
}

if (precoAtual) {
  mensagem += `
✅ Por: R$ ${precoAtual}`;
}

if (temPrecoAntigoValido) {
  const economia = (antigoNum - atualNum).toFixed(2).replace(".", ",");
  const desconto = Math.round(((antigoNum - atualNum) / antigoNum) * 100);

  mensagem += `

💥 Economia: R$ ${economia}
🔥 ${desconto}% OFF`;

  if (desconto >= 25) {
    mensagem += `
⚠️ PREÇO MUITO BOM`;
  }
}

if (parcelamento) {
  mensagem += `

💳 ${parcelamento}`;
}

if (cupom) {
  mensagem += `

🎟️ Cupom: ${cupom}`;

  if (avisoCupom) {
    mensagem += `
🎫 ${avisoCupom}`;
  }
} else if (marketplace === "shopee") {
  mensagem += `

🎟️ Verifique se há cupons disponíveis na página`;
} else if (marketplace === "aliexpress") {
  mensagem += `

⚠️ Preço pode variar por moedas, cupom, variação ou impostos. Confira o valor final.`;
}

mensagem += `

🛒 Comprar:
${link}`;  

function parsePreco(valor) {
  if (!valor) return 0;
  return parseFloat(valor.toString().replace(",", "."));
}

const antigo = parsePreco(oferta.precoAntigo);
const atual = parsePreco(oferta.precoAtual);

if (antigo > atual && atual > 0) {
  const economia = (antigo - atual).toFixed(2);
  const porcentagem = Math.round(((antigo - atual) / antigo) * 100);

  mensagem += `

💥 Economia: R$ ${economia.replace(".", ",")}
🔥 ${porcentagem}% OFF`;
}

// ================= ENVIO DESTINOS INTELIGENTES =================

for (const destino of destinosInteligentes) {
  await enviarParaDestinoInteligente(
    destino,
    oferta,
    mensagem
  );
}

controleEnvio[clienteId] = Date.now();
ultimoEnvioFila = Date.now();

oferta.status = "enviado";

oferta.enviadoEm = new Date().toLocaleString("pt-BR", {
  timeZone: "America/Sao_Paulo"
});

oferta.dataEnvio = oferta.enviadoEm;

salvarFila();

console.log("✅ Enviado com controle de tempo");

  } catch (e) {
    console.log("❌ ERRO:", e.message);
  } finally {
    enviandoAgora = false;
  }
}
   
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: "10mb" }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.path.startsWith("/status") ||
    req.path.startsWith("/qr") ||
    req.path.startsWith("/fila") ||
    req.path.startsWith("/automacao") ||
    req.path.startsWith("/destinos") ||
    req.path.startsWith("/grupos")
}));

app.post("/fila", (req, res) => {
  const body = req.body || {};

  const oferta = {
    nome: body.nome || body.titulo || "Oferta",
    titulo: body.titulo || body.nome || "Oferta",

    preco: body.preco || body.precoAtual || "",
    precoAtual: body.precoAtual || body.preco || "",

    precoAntigo: body.precoAntigo || "",
    cupom: body.cupom ? String(body.cupom).trim() : "",
    avisoCupom: body.avisoCupom || "",
    parcelamento: body.parcelamento || "",

    link: body.link || body.linkAfiliado || "",
    linkAfiliado: body.linkAfiliado || body.link || "",

    imagem: body.imagem || "",
    marketplace: body.marketplace || "",
    categoria: body.categoria || body.marketplace || "",

    clienteId: getClienteId(req),
    status: "pendente"
  };

  const html = JSON.stringify(body || "");
  const htmlLower = html.toLowerCase();

  const temCompraNoApp =
     html.includes("COMPRANOAPP") ||
    /compra\s+no\s+app/i.test(html) ||
    /use\s+o\s+app/i.test(html) ||
    /desconto\s+no\s+app/i.test(html);

  if (temCompraNoApp && !oferta.cupom) {
    oferta.cupom = "COMPRANOAPP";

    oferta.avisoCupom =
      "📱 Use no app da Amazon para tentar chegar no menor valor.";
  }

  console.log("🧪 BODY RECEBIDO NA FILA:", body);
  console.log("🧪 OFERTA FINAL PARA FILA:", oferta);
  console.log("🧪 CUPOM RECEBIDO:", body.cupom);
  console.log("🧪 AVISO RECEBIDO:", body.avisoCupom);
  console.log("🧪 OFERTA FINAL:", {
  titulo: oferta.titulo,
  cupom: oferta.cupom,
  avisoCupom: oferta.avisoCupom
});


oferta.criadoEm = oferta.criadoEm || new Date().toLocaleString("pt-BR", {
  timeZone: "America/Sao_Paulo"
}); 

  fila.push(oferta);
  salvarFila();

  console.log("📥 Oferta adicionada na fila:", {
    titulo: oferta.titulo,
    precoAntigo: oferta.precoAntigo,
    precoAtual: oferta.precoAtual,
    cupom: oferta.cupom,
    avisoCupom: oferta.avisoCupom
  });

  res.send("OK");
});

app.get("/fila", (req, res) => {
  res.json({
    ok: true,
    total: fila.length,
    pendentes: fila.filter((o) => o.status === "pendente").length,
    enviados: fila.filter((o) => o.status === "enviado").length,
    itens: fila,
    fila: fila
  });
});

// ================= TELEGRAM =================

app.get("/telegram", (req, res) => {
  res.json({
    ativo: config.telegram?.ativo || false,
    destinos: config.telegram?.destinos || []
  });
});

app.post("/telegram", (req, res) => {
  const { ativo, destinos } = req.body;

  config.telegram = {
    ativo: ativo === true,
    destinos: Array.isArray(destinos)
      ? destinos
      : config.telegram?.destinos || []
  };

  salvarConfig();

  res.json({
    ok: true,
    telegram: config.telegram
  });
});

app.post("/telegram/testar", async (req, res) => {
  try {

    const { destino } = req.body;

    if (!destino?.botToken || !destino?.chatId) {
      return res.status(400).json({
        ok: false,
        erro: "Token ou Chat ID ausente"
      });
    }

    await axios.post(
      `https://api.telegram.org/bot${destino.botToken}/sendMessage`,
      {
        chat_id: destino.chatId,
        text: "🧪 Teste Telegram Optimus Promo enviado com sucesso!"
      }
    );

    return res.json({
      ok: true,
      mensagem: "Teste enviado com sucesso"
    });

  } catch (e) {

    return res.status(400).json({
      ok: false,
      erro: e.response?.data || e.message
    });

  }
});

// ============== DESTINOS INTELIG APPGET ==============

app.get("/destinos", (req, res) => {
  res.json(config.destinosInteligentes || []);
});

app.post("/destinos", (req, res) => {

  const destinos = req.body;

  if (!Array.isArray(destinos)) {
    return res.status(400).json({
      ok: false,
      erro: "Formato inválido"
    });
  }

  config.destinosInteligentes = destinos;

  salvarConfig();

  return res.json({
    ok: true,
    destinos: config.destinosInteligentes
  });

});

app.delete("/destinos/:id", (req, res) => {

  const { id } = req.params;

  config.destinosInteligentes =
    (config.destinosInteligentes || [])
      .filter(d => d.id !== id);

  salvarConfig();

  return res.json({
    ok: true
  });

});

// ================= AUTOMAÇÃO =================

app.get("/automacao", (req, res) => {
  res.json({
    ok: true,
    ativo: config.automacaoAtiva
  });
});

app.post("/automacao/toggle", (req, res) => {
  config.automacaoAtiva = !config.automacaoAtiva;
  salvarConfig();

  console.log("🤖 Automação:", config.automacaoAtiva ? "ON" : "OFF");

  res.json({
    ok: true,
    ativo: config.automacaoAtiva
  });
});


app.delete("/fila/:index", (req, res) => {
  const index = Number(req.params.index);

  if (isNaN(index) || index < 0 || index >= fila.length) {
    return res.status(400).send("Índice inválido");
  }

  const removido = fila.splice(index, 1);

  salvarFila();

  console.log("🗑️ Removido da fila:", removido[0]?.nome || removido[0]?.titulo);

  res.send("Removido com sucesso");
});

app.post("/fila/:index/enviar-agora", async (req, res) => {
  const index = Number(req.params.index);

  if (isNaN(index) || index < 0 || index >= fila.length) {
    return res.status(400).json({ ok: false, erro: "Índice inválido" });
  }

  const oferta = fila[index];

  oferta.status = "pendente";

  // joga a oferta escolhida para o começo da fila
  fila.splice(index, 1);
  fila.unshift(oferta);
  salvarFila();

  const clienteId = oferta.clienteId || "admin";
  controleEnvio[clienteId] = 0;

  const automacaoAnterior = config.automacaoAtiva;
  config.automacaoAtiva = true;

  await processarFila();

  config.automacaoAtiva = automacaoAnterior;

  return res.json({
    ok: true,
    mensagem: "Envio manual processado",
    oferta
  });
});

app.get("/config", (req, res) => {
  return res.json({
    ok: true,
    config
  });
});

app.post("/config", (req, res) => {
  const body = req.body || {};

  config = {
    ...config,
    ...body,
    marketplaces: {
      ...config.marketplaces,
      ...(body.marketplaces || {})
    }
  };

  if (body.intervaloEnvioMinutos) {
  config.intervaloMinutos = Number(body.intervaloEnvioMinutos);
}

if (body.intervaloMinutos) {
  config.intervaloEnvioMinutos = Number(body.intervaloMinutos);
}

if (body.intervalo) {
  config.intervaloMinutos = Number(body.intervalo);
  config.intervaloEnvioMinutos = Number(body.intervalo);
}

  salvarConfig();

  return res.json({
    ok: true,
    config
  });
});

let sessoes = {};
let qrCodes = {};
let statusSessao = {};
let destinosPorSessao = {};
let gruposPorSessao = {};
let reconectando = {};
let integracoesPorCliente = {};

let sessoesMeta = {};

const SESSOES_FILE = process.env.SESSOES_FILE || "/data/sessoes.json";

function carregarSessoesMeta() {
  try {
    if (!fs.existsSync(SESSOES_FILE)) {
      console.log("ℹ️ Nenhum arquivo de sessões encontrado ainda");
      return;
    }

    const raw = fs.readFileSync(SESSOES_FILE, "utf8");
    if (!raw) return;

    sessoesMeta = JSON.parse(raw);
    console.log("✅ Sessões carregadas:", Object.keys(sessoesMeta).length);
  } catch (e) {
    console.log("❌ erro carregar sessões:", e.message);
    sessoesMeta = {};
  }
}

function salvarSessoesMeta() {
  try {
    fs.writeFileSync(SESSOES_FILE, JSON.stringify(sessoesMeta, null, 2));
  } catch (e) {
    console.log("❌ erro salvar sessões:", e.message);
  }
}

carregarSessoesMeta();

const INTEGRACOES_FILE = process.env.INTEGRACOES_FILE || "/data/integracoes.json";

function carregarIntegracoesPersistidas() {
  try {
    if (!fs.existsSync(INTEGRACOES_FILE)) {
      console.log("ℹ️ Nenhum arquivo de integrações encontrado ainda");
      return;
    }

    const raw = fs.readFileSync(INTEGRACOES_FILE, "utf8");

    if (!raw) {
      console.log("ℹ️ Arquivo de integrações vazio");
      return;
    }

    const data = JSON.parse(raw);

    if (data && typeof data === "object") {
      integracoesPorCliente = data;
      console.log("✅ Integrações carregadas do arquivo");
    }
  } catch (e) {
    console.error("ERRO AO CARREGAR INTEGRAÇÕES:", e.message);
  }
}

function salvarIntegracoesPersistidas() {
  try {
    const tempFile = `${INTEGRACOES_FILE}.tmp`;

    fs.writeFileSync(
      tempFile,
      JSON.stringify(integracoesPorCliente, null, 2),
      "utf8"
    );

    fs.renameSync(tempFile, INTEGRACOES_FILE);

    console.log("✅ Integrações salvas no arquivo");
  } catch (e) {
    console.error("ERRO AO SALVAR INTEGRAÇÕES:", e.message);
  }
}

carregarIntegracoesPersistidas();
carregarFila();
carregarConfig();

if (!config.marketplaces.awin) {
  config.marketplaces.awin = {
    ativo: true,
    intervaloFarejoMinutos: 30,
    limitePorRodada: 10,
    descontoMinimo: 0,
    precoMinimo: 0,
    loja: "kabum",
    feedFile: "awin_kabum.csv.gz"
  };

  salvarConfig();
  console.log("✅ Awin recriada no config");
}

config.marketplaces.awin.feedFile = "awin_kabum.csv.gz";


console.log("🧪 CONFIG AWIN ATUAL:", config.marketplaces?.awin);


if (config.destinosPorSessao) {
  destinosPorSessao = config.destinosPorSessao;
  console.log("✅ Destinos carregados da config");
}

const ADMIN_USER = "admin";
const ADMIN_PASS_HASH = bcrypt.hashSync("123456", 10);
const JWT_SECRET = process.env.JWT_SECRET || "segredo";

function gerarToken() {
  return jwt.sign(
    { admin: true, clienteId: "admin" },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function getClienteId(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) return "admin";

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.clienteId || "admin";
  } catch {
    return "admin";
  }
}

function auth(req, res, next) {
  if (
    req.path === "/" ||
    req.path === "/login" ||
    req.path === "/conectar" ||
    req.path.startsWith("/qr") ||
    req.path.startsWith("/status") ||
    req.path.startsWith("/reset")
  ) {
    return next();
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ erro: "Token inválido" });

  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ erro: "Não autorizado" });
  }
}

app.use(auth);

// ================= LOGIN =================

app.post("/login", async (req, res) => {
  const { user, pass } = req.body;

  if (user !== ADMIN_USER) {
    return res.status(401).json({ erro: "Usuário inválido" });
  }

  const ok = await bcrypt.compare(pass, ADMIN_PASS_HASH);

  if (!ok) {
    return res.status(401).json({ erro: "Senha inválida" });
  }

  return res.json({
    ok: true,
    token: gerarToken()
  });
});

app.get("/", (req, res) => {
  res.json({
    status: "API ONLINE",
    uptime: process.uptime()
  });
});

app.post("/desconectar/:id", async (req, res) => {
  try {
    const id = req.params.id || "sessao1";

    if (sessoes[id]?.sock) {
      try {
        await sessoes[id].sock.logout();
      } catch (e) {
        console.log("⚠️ erro logout:", e.message);
      }
    }

    delete sessoes[id];
    delete qrcodes[id];

    res.json({
      ok: true,
      message: "WhatsApp desconectado."
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

app.post("/limpar-sessao/:id", async (req, res) => {
  try {
    const id = req.params.id || "sessao1";

    if (sessoes[id]?.sock) {
      try {
        await sessoes[id].sock.logout();
      } catch (e) {
        console.log("⚠️ erro logout ao limpar:", e.message);
      }
    }

    delete sessoes[id];
    delete qrcodes[id];

    const pastaAuth = path.join(__dirname, `auth_${id}`);

    if (fs.existsSync(pastaAuth)) {
      fs.rmSync(pastaAuth, { recursive: true, force: true });
      console.log("🗑️ Sessão limpa:", pastaAuth);
    }

    res.json({
      ok: true,
      message: "Sessão limpa. Gere um novo QR Code."
    });
  } catch (e) {
    console.log("❌ erro limpar sessão:", e.message);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ================= INTEGRAÇÕES =================

const marketplaceRules = {
  shopee: {
    nome: "Shopee",
    required: ["appId", "secret"],
    allowed: ["appId", "secret"]
  },
  amazon: {
    nome: "Amazon",
    modes: {
      api: {
        required: ["appId", "accessKey", "secretKey"],
        allowed: ["modo", "appId", "accessKey", "secretKey"]
      },
      cookies: {
        required: ["cookies"],
        allowed: ["modo", "appId", "cookies"]
      }
    }
  },
 mercadolivre: {
  nome: "Mercado Livre",
  required: ["cookies", "tag"],
  allowed: ["cookies", "tag"]
},
  aliexpress: {
    nome: "AliExpress",
    required: ["appKey", "secret", "trackingId"],
    allowed: ["appKey", "secret", "trackingId"]
  },

  magalu: {
    nome: "Magalu",
    required: ["promoterId"],
    allowed: ["promoterId"]
  },

    awin: {
    nome: "Awin",
    required: ["publisherId", "apiToken", "loja"],
    allowed: ["publisherId", "apiToken", "loja", "advertiserId"]
  }
};

function limparCredencial(config, allowed) {
  const clean = {};
  for (const field of allowed) {
    if (config[field] !== undefined && config[field] !== null) {
      clean[field] = String(config[field]).trim();
    }
  }
  return clean;
}

function validarIntegracao(marketplace, body) {
  const rule = marketplaceRules[marketplace];

  if (!rule) return { ok: false, erro: "Marketplace não suportado" };

  if (marketplace === "amazon") {
    const modo = body.modo || "api";
    const modeRule = rule.modes[modo];

    if (!modeRule) return { ok: false, erro: "Modo Amazon inválido" };

    const missing = modeRule.required.filter((field) => !body[field]);

    if (missing.length) {
      return {
        ok: false,
        erro: "Campos obrigatórios ausentes",
        campos: missing
      };
    }

    return {
      ok: true,
      modo,
      clean: limparCredencial({ ...body, modo }, modeRule.allowed)
    };
  }

  const missing = rule.required.filter((field) => !body[field]);

  if (missing.length) {
    return {
      ok: false,
      erro: "Campos obrigatórios ausentes",
      campos: missing
    };
  }

  return {
    ok: true,
    clean: limparCredencial(body, rule.allowed)
  };
}

function mascararIntegracao(config) {
  const masked = { ...config };

  for (const key of Object.keys(masked)) {
    if (
  key.toLowerCase().includes("secret") ||
  key.toLowerCase().includes("key") ||
  key.toLowerCase().includes("token") ||
  key.toLowerCase().includes("cookies")
) {
  masked[key] = "•••••••• configurado";
}
  }

  return masked;
}

app.get("/integracoes", (req, res) => {
  const clienteId = getClienteId(req);
  const data = integracoesPorCliente[clienteId] || {};
  const resposta = {};

  for (const [marketplace, config] of Object.entries(data)) {
    resposta[marketplace] = {
      marketplace,
      nome: marketplaceRules[marketplace]?.nome || marketplace,
      configurado: true,
      status: config.status || "configurado",
      credenciais: mascararIntegracao(config.credenciais || {}),
      atualizadoEm: config.atualizadoEm
    };
  }

  return res.json({
    ok: true,
    clienteId,
    integracoes: resposta
  });
});

app.post("/integracoes/:marketplace", (req, res) => {
  const clienteId = getClienteId(req);
  const marketplace = req.params.marketplace.toLowerCase();

  const validacao = validarIntegracao(marketplace, req.body);

  if (!validacao.ok) return res.status(400).json(validacao);

  if (!integracoesPorCliente[clienteId]) {
    integracoesPorCliente[clienteId] = {};
  }

  integracoesPorCliente[clienteId][marketplace] = {
  marketplace,
  nome: marketplaceRules[marketplace]?.nome || marketplace,
  modo: validacao.modo || req.body.modo || null,
  credenciais: validacao.clean,
  status: "configurado",
  atualizadoEm: new Date().toISOString()
};

salvarIntegracoesPersistidas();

return res.json({
  ok: true,
  message: `${marketplace} configurado com sucesso`,
  marketplace,
  status: "configurado"
});
});

app.post("/integracoes/:marketplace/test", async (req, res) => {
  const clienteId = getClienteId(req);
  const marketplace = req.params.marketplace.toLowerCase();
  const config = integracoesPorCliente[clienteId]?.[marketplace];

  if (!config) {
    return res.status(400).json({
      ok: false,
      erro: "Integração não configurada"
    });
  }

  if (marketplace === "awin") {
    try {
      const { publisherId, apiToken } = config.credenciais || {};

      if (!publisherId || !apiToken) {
        return res.status(400).json({
          ok: false,
          erro: "Awin sem publisherId ou apiToken"
        });
      }

      const url = `https://api.awin.com/publishers/${publisherId}/programmes`;

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${apiToken}`
        },
        params: {
          relationship: "joined"
        },
        timeout: 15000
      });

      return res.json({
        ok: true,
        marketplace: "awin",
        status: "conectado",
        message: "Awin conectada com sucesso",
        totalProgramas: Array.isArray(response.data) ? response.data.length : 0
      });

    } catch (e) {
      return res.status(500).json({
        ok: false,
        marketplace: "awin",
        erro: "Erro ao consultar API da Awin",
        detalhe: e.response?.data || e.message
      });
    }
  }

  return res.json({
    ok: true,
    marketplace,
    status: "conectado",
    message: `${config.nome || marketplace} configurado.`
  });
});

// ================= AWIN DEEP LINK MANUAL =================

async function gerarDeepLinkAwin(urlOriginal, clienteId = "admin") {
  const integracao = integracoesPorCliente[clienteId]?.awin;
  const credenciais = integracao?.credenciais || {};

  const { publisherId, apiToken, advertiserId } = credenciais;

  if (!publisherId || !apiToken || !advertiserId) {
    throw new Error("Awin sem publisherId, apiToken ou advertiserId configurado.");
  }

  const response = await axios.post(
    `https://api.awin.com/publishers/${publisherId}/linkbuilder/generate`,
    {
      advertiserId: Number(advertiserId),
      destinationUrl: urlOriginal
    },
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      timeout: 15000
    }
  );

  return (
    response.data?.shortUrl ||
    response.data?.url ||
    response.data?.link ||
    response.data?.trackingLink ||
    response.data?.clickUrl ||
    ""
  );
}

app.post("/awin/gerar-link", async (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        ok: false,
        erro: "URL obrigatória"
      });
    }

    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
      },
      timeout: 15000
    });

    const html = response.data || "";

    // ================= EXTRAIR TÍTULO =================

    const titulo =
      html.match(/<title>(.*?)<\/title>/i)?.[1]
        ?.replace(/\s+/g, " ")
        ?.trim() ||
      "Produto importado de Awin";

    // ================= EXTRAIR IMAGEM =================

    const imagem =
      html.match(/property="og:image"\s*content="([^"]+)"/i)?.[1] ||
      html.match(/<img[^>]+src="([^"]+)"/i)?.[1] ||
      "";

    // ================= EXTRAIR PREÇO =================

let precoAtual = "";
let precoAntigo = "";
let avisoPagamento = "";

const precosEncontrados = [
  ...html.matchAll(/R\$\s?[\d\.]+,\d{2}/g)
]
  .map(m => m[0])
  .map(p => p.replace(/\s+/g, " ").trim());

const precosNumericos = precosEncontrados
  .map((texto) => {
    const numero = Number(
      texto
        .replace("R$", "")
        .replace(/\./g, "")
        .replace(",", ".")
        .trim()
    );

    return { texto, numero };
  })
  .filter(p => Number.isFinite(p.numero) && p.numero > 0);

const pixMatch = html.match(/R\$\s?[\d\.]+,\d{2}\s*À vista no PIX/i);

if (pixMatch) {
  const precoPixTexto = pixMatch[0]
    .replace(/À vista no PIX/i, "")
    .trim();

  precoAtual = precoPixTexto;
  avisoPagamento = "À vista no PIX";
}

const precosValidos = precosNumericos.filter((p) => {
  return p.numero > 80 && p.numero < 100000;
});

if (!precoAtual && precosValidos.length) {
  const menor = [...precosValidos].sort((a, b) => a.numero - b.numero)[0];
  const maior = [...precosValidos].sort((a, b) => b.numero - a.numero)[0];

  let precoBase = menor.numero;

  const matchPix = html.match(/PIX\s+com\s+(\d+)%\s+de\s+desconto/i);

  if (matchPix?.[1]) {
    const descontoPix = Number(matchPix[1]);
    const precoPix = precoBase * (1 - descontoPix / 100);

    precoAtual = `R$ ${precoPix.toFixed(2).replace(".", ",")}`;
    avisoPagamento = `À vista no PIX com ${descontoPix}% de desconto`;
  } else {
    precoAtual = menor.texto;
  }

  if (maior && maior.numero > precoBase) {
    precoAntigo = maior.texto;
  }
}

    // ================= LINK AFILIADO =================

    const linkAfiliado = await gerarDeepLinkAwin(url, clienteId);

    if (!linkAfiliado) {
      return res.status(500).json({
        ok: false,
        erro: "Awin não retornou link afiliado"
      });
    }

  return res.json({
  ok: true,
  urlOriginal: url,
  linkAfiliado,
  titulo,
  precoAtual,
  precoAntigo,
  avisoPagamento,
  imagem
  });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: "Erro ao importar produto Awin",
      detalhe: e.response?.data || e.message
    });
  }
});

// ================= HELPERS DE IMPORTAÇÃO =================

function htmlDecode(str) {
  if (!str) return "";
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .trim();
}

function extrairMeta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["'][^>]*>`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return htmlDecode(match[1]);
  }

  return "";
}

function extrairJsonLd(html) {
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const match of matches) {
    try {
      const raw = htmlDecode(match[1]);
      const data = JSON.parse(raw);

      if (Array.isArray(data)) {
        const product = data.find((x) => x["@type"] === "Product");
        if (product) return product;
      }

      if (data["@type"] === "Product") return data;

      if (data["@graph"]) {
        const product = data["@graph"].find((x) => x["@type"] === "Product");
        if (product) return product;
      }
    } catch {}
  }

  return null;
}


// ================= FILTROS UNIVERSAIS DE OFERTAS =================

function normalizarTexto(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function pontuarOferta(oferta = {}, opcoes = {}) {
  let score = 0;

  const texto = normalizarTexto(`
    ${oferta.titulo || ""}
    ${oferta.nome || ""}
    ${oferta.descricao || ""}
    ${oferta.categoria || ""}
    ${oferta.marketplace || ""}
    ${oferta.origem || ""}
    ${oferta.link || ""}
    ${oferta.linkAfiliado || ""}
  `);

  if (texto.includes("envio do brasil")) score += 100;
  if (texto.includes("estoque no brasil")) score += 90;
  if (texto.includes("produto no brasil")) score += 80;
  if (texto.includes("brasil")) score += 40;
  if (texto.includes("brazil")) score += 40;

  if (oferta.imagem) score += 10;
  if (oferta.precoAtual || oferta.preco) score += 10;
  if (oferta.cupom) score += 15;
  if (oferta.precoAntigo) score += 8;

  if (opcoes.preferirEnvioBrasil && texto.includes("brasil")) {
    score += 30;
  }

  return score;
}

function removerDuplicadas(ofertas = []) {
  const vistas = new Set();

for (const existente of fila || []) {
  const linkExistente = String(existente.linkAfiliado || existente.link || "")
    .split("?")[0]
    .toLowerCase()
    .trim();

  const tituloExistente = normalizarTexto(existente.titulo || existente.nome || "");

  if (linkExistente) vistas.add(linkExistente);
  if (tituloExistente) vistas.add(tituloExistente);
}

  return ofertas.filter((oferta) => {
    const link = String(oferta.linkAfiliado || oferta.link || "")
      .split("?")[0]
      .toLowerCase()
      .trim();

    const titulo = normalizarTexto(oferta.titulo || oferta.nome || "");

    const chave = link || titulo;

    if (!chave) return true;

    if (vistas.has(chave)) {
      console.log("⏭️ Duplicada removida pelo filtro universal:", oferta.titulo || oferta.nome);
      return false;
    }

    vistas.add(chave);
    return true;
  });
}

function ofertaPassaNosFiltros(oferta = {}, opcoes = {}) {
  const bloquearSemImagem = opcoes.bloquearSemImagem ?? true;
  const bloquearSemPreco = opcoes.bloquearSemPreco ?? true;

  if (bloquearSemImagem && !oferta.imagem) {
    return { ok: false, motivo: "sem_imagem" };
  }

  if (bloquearSemPreco && !(oferta.precoAtual || oferta.preco)) {
    return { ok: false, motivo: "sem_preco" };
  }

  return { ok: true, motivo: "ok" };
}

function aplicarFiltrosUniversais(ofertas = [], opcoes = {}) {
  return removerDuplicadas(ofertas)
    .map((oferta) => ({
      ...oferta,
      score: pontuarOferta(oferta, opcoes),
    }))
    .filter((oferta) => {
      const resultado = ofertaPassaNosFiltros(oferta, opcoes);

      if (!resultado.ok) {
        console.log(
          "⏭️ Oferta ignorada pelo filtro universal:",
          resultado.motivo,
          oferta.titulo || oferta.nome || "sem título"
        );
      }

      return resultado.ok;
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

function limparPreco(valor) {
  if (!valor) return "";

  let texto = String(valor).trim();

  texto = texto
    .replace("R$", "")
    .replace(/\s/g, "");

  if (/^\d+\.\d{1,2}$/.test(texto)) {
  const numero = Number(texto);
  return numero.toFixed(2).replace(".", ",");
}

  if (texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
    const numero = Number(texto);
    if (!Number.isFinite(numero)) return "";
    return numero.toFixed(2).replace(".", ",");
  }

  texto = texto.replace(/\D/g, "");

  if (!texto) return "";

  let numero = Number(texto);

  if (numero > 10000) {
  numero = numero / 100;
}

  return numero.toFixed(2).replace(".", ",");
}

function corrigirImagemUrl(imagem) {
  if (!imagem || typeof imagem !== "string") return null;

  let imagemFinal = imagem.trim();

  if (!imagemFinal.startsWith("http")) return null;

  if (imagemFinal.includes(".webp")) {
    imagemFinal = imagemFinal.replace(".webp", ".jpg");
  }

  return imagemFinal;
}
async function buscarCsrfTokenMercadoLivre(cookies) {
  try {
    if (!cookies) return "";

    const response = await fetch(
      "https://www.mercadolivre.com.br/afiliados/linkbuilder",
      {
        method: "GET",
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Cookie": cookies
        }
      }
    );

    const html = await response.text();

    console.log("🧪 HTML INICIO:");
    console.log(html.slice(0, 3000)); 

    const patterns = [
      /x-csrf-token["']?\s*[:=]\s*["']([^"']+)["']/i,
      /csrfToken["']?\s*[:=]\s*["']([^"']+)["']/i,
      /csrf-token["']?\s*content=["']([^"']+)["']/i,
      /_csrf["']?\s*[:=]\s*["']([^"']+)["']/i
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return match[1];
    }

    console.log("ML CSRF: token não encontrado automaticamente");
    return "";
  } catch (e) {
    console.error("ERRO BUSCAR CSRF ML:", e.message);
    return "";
  }
}

async function gerarLinkAfiliadoMercadoLivre(url, config) {
  try {
    const credenciais = config?.credenciais || {};

    const cookies = credenciais.cookies || "";
    const tag = credenciais.tag || "";

    if (!url || !cookies || !tag) {
      console.log("ML AFILIADO: faltando cookies ou tag");
      return "";
    }

    const csrfToken = await buscarCsrfTokenMercadoLivre(cookies);

    if (!csrfToken) {
      console.log("ML AFILIADO: csrfToken automático não encontrado");
      return "";
    }

    const response = await fetch(
      "https://www.mercadolivre.com.br/affiliate-program/api/v2/stripe/user/links",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Origin": "https://www.mercadolivre.com.br",
          "Referer": "https://www.mercadolivre.com.br/afiliados/linkbuilder",
          "Cookie": cookies,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          url,
          tag
        })
      }
    );

    const data = await response.json().catch(() => null);

    console.log("ML AFILIADO RESPONSE:", JSON.stringify(data));

    if (!response.ok) {
      console.log("ML AFILIADO ERRO STATUS:", response.status);
      return "";
    }

 return data?.short_url || data?.shortUrl || data?.url || "";
  } catch (e) {
    console.error("ERRO ML AFILIADO:", e.message);
    return "";
  }
}

const encurtarUrl = async (url) => {
  try {
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    return await res.text();
  } catch {
    return url;
  }
};

async function importarMercadoLivre(url, config) {
  const cookies = config?.credenciais?.cookies || "";
  
  console.log("🌐 AMAZON URL:", url);

  const response = await fetch(url, {
  method: "GET",
  redirect: "follow",
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",

    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",

    "Accept-Language":
      "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",

    "Cache-Control": "no-cache",

    "Pragma": "no-cache",

    "Upgrade-Insecure-Requests": "1",

    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",

    "Referer": "https://www.google.com/",

    "Cookie": cookies || ""
  }
});

console.log("🌍 URL FINAL:", response.url);
  
  const html = await response.text();

  const jsonLd = extrairJsonLd(html);

  const titulo =
    jsonLd?.name ||
    extrairMeta(html, "og:title") ||
    extrairMeta(html, "twitter:title") ||
    "Produto Mercado Livre";

  let preco =
    jsonLd?.offers?.price ||
    extrairMeta(html, "product:price:amount") ||
    extrairMeta(html, "og:price:amount") ||
    "";

  const imagem =
    (Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image) ||
    extrairMeta(html, "og:image") ||
    extrairMeta(html, "twitter:image") ||
    "";

  preco = limparPreco(preco);

  let precoNumero = Number(String(preco).replace(",", "."));
  let precoAntigo = "";
  
  const descontoMatch =
  html.match(/(\d{1,2})\s*%\s*OFF/i) ||
  html.match(/"discount_rate"\s*:\s*(\d{1,2})/i) ||
  html.match(/"discountPercentage"\s*:\s*(\d{1,2})/i) ||
  html.match(/(\d{1,2})\s*%\s*de desconto/i);
const descontoReal = descontoMatch ? Number(descontoMatch[1]) : 0;

if (
  Number.isFinite(precoNumero) &&
  precoNumero > 0 &&
  descontoReal > 0 &&
  descontoReal < 90
) {
  precoAntigo = (precoNumero / (1 - descontoReal / 100))
    .toFixed(2)
    .replace(".", ",");

  console.log("🏷️ Desconto real ML detectado:", descontoReal + "%");
}


    const linkAfiliadoGerado = await gerarLinkAfiliadoMercadoLivre(url, config);

  return {
    marketplace: "mercadolivre",
    titulo: htmlDecode(titulo).replace(" | MercadoLivre", "").replace(" | Mercado Livre", ""),
    precoAntigo,
    precoAtual: preco,
    cupom: "",
    linkOriginal: url,
    linkAfiliado: linkAfiliadoGerado || url,
    imagem: corrigirImagemUrl(imagem) || imagem,
    categoria: "Mercado Livre"
  };
}

function gerarLinkMagalu(linkOriginal, promoterId) {
  if (!linkOriginal || !promoterId) return linkOriginal;

  const urlLimpa = String(linkOriginal).trim();
  const loja = String(promoterId).trim();

  // Se já for link da loja do influenciador, mantém
  if (urlLimpa.includes("magazinevoce.com.br")) {
    return urlLimpa;
  }

  // Converte link comum do Magalu para link da loja
  return urlLimpa.replace(
    "https://www.magazineluiza.com.br",
    `https://www.magazinevoce.com.br/${loja}`
  );
}

async function importarAliExpress(urlEntrada, config = {}) {
  try {
    if (urlEntrada && !urlEntrada.startsWith("http")) {
      urlEntrada = "https://" + urlEntrada;
    }

  const ehBrasil =
  String(urlEntrada).includes("ship_from%22%3A%22BR") ||
  String(urlEntrada).includes('"ship_from":"BR"') ||
  String(urlEntrada).includes("%22ship_from%22%3A%22BR%22");

    const productId =
      urlEntrada.match(/\/item\/(\d+)\.html/i)?.[1] ||
      urlEntrada.match(/[?&]productId=(\d+)/i)?.[1];

    if (!productId) {
      throw new Error("Product ID não encontrado no link AliExpress");
    }

    const credenciais = config?.credenciais || {};
    const appKey = credenciais.appKey || "";
    const secret = credenciais.secret || "";
    const trackingId = credenciais.trackingId || "";

    if (!appKey || !secret || !trackingId) {
      throw new Error("Credenciais AliExpress incompletas");
    }

    function timestampGMT8() {
      const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const pad = (n) => String(n).padStart(2, "0");

      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    }

    function assinar(params, appSecret) {
      const sortedKeys = Object.keys(params).sort();
      let base = appSecret;

      for (const key of sortedKeys) {
        if (key === "sign") continue;
        base += key + params[key];
      }

      base += appSecret;

      return crypto
        .createHash("md5")
        .update(base, "utf8")
        .digest("hex")
        .toUpperCase();
    }

    const params = {
      method: "aliexpress.affiliate.productdetail.get",
      app_key: appKey,
      timestamp: timestampGMT8(),
      sign_method: "md5",
      format: "json",
      v: "2.0",
      product_ids: productId,
      target_currency: "BRL",
      target_language: "PT",
      ship_to_country: "BR",
      tracking_id: trackingId
    };

    params.sign = assinar(params, secret);

    const body = new URLSearchParams(params);

    const response = await fetch("https://api-sg.aliexpress.com/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
      },
      body
    });

    const data = await response.json();

    console.log("ALIEXPRESS API RESPONSE:", JSON.stringify(data));

    const result =
      data?.aliexpress_affiliate_productdetail_get_response?.resp_result?.result ||
      data?.resp_result?.result ||
      data?.result ||
      {};

    const produto =
      result?.products?.product?.[0] ||
      result?.products?.[0] ||
      result?.product?.[0] ||
      result?.product ||
      {};

  const avisoCupom = ehBrasil
  ? "🇧🇷 Produto no Brasil. Confira cupom ou desconto com moedas na página."
  : "🌍 Compra internacional. Pode haver imposto/taxa. Confira cupom ou desconto com moedas na página.";

      
      if (!produto || Object.keys(produto).length === 0) {
  console.log("⚠️ AliExpress sem produto retornado pela API:", productId);

  let precoAntigoUrl = "";
  let precoAtualUrl = "";

  try {
    const urlDecodificada = decodeURIComponent(urlEntrada);
    const pdpMatch = urlDecodificada.match(/pdp_npi=([^&]+)/);

    if (pdpMatch?.[1]) {
      const numeros = pdpMatch[1]
        .split("!")
        .filter((p) => /^\d+(\.\d+)?$/.test(p))
        .map(Number)
        .filter((n) => n > 0);

      if (numeros.length >= 2) {
        precoAntigoUrl = numeros[0].toFixed(2);
        precoAtualUrl = numeros[1].toFixed(2);
      }
    }
  } catch (e) {
    console.log("Erro fallback pdp_npi AliExpress:", e.message);
  }

  return {
    marketplace: "aliexpress",
    titulo: "Produto AliExpress",
    precoAntigo: precoAntigoUrl,
    precoAtual: precoAtualUrl,
    cupom: "",
    linkOriginal: urlEntrada,
    linkAfiliado: urlEntrada,
    imagem: "",
    categoria: "AliExpress",
    avisoCupom,
    aviso: "AliExpress não retornou dados pela API. Preços extraídos do link quando disponíveis."
  };
}
    
    let titulo =
      produto.product_title ||
      produto.title ||
      produto.productTitle ||
      "Produto AliExpress";

    let imagem =
      produto.product_main_image_url ||
      produto.product_small_image_urls?.string?.[0] ||
      produto.product_small_image_urls?.[0] ||
      produto.image_url ||
      "";
     
 let precoAtual =
  produto.target_sale_price ||
  produto.sale_price ||
  produto.target_app_sale_price ||
  produto.app_sale_price ||
  produto.target_min_sale_price ||
  produto.min_sale_price ||
  "";

precoAtual = String(precoAtual).trim();
console.log("✅ ALI PREÇO ESCOLHIDO:", precoAtual);
   
   
  let precoAntigo =
  produto.target_original_price ||
  produto.original_price ||
  "";

precoAntigo = String(precoAntigo).trim();
console.log("✅ ALI PREÇO ANTIGO ESCOLHIDO:", precoAntigo);

if (precoAntigo === precoAtual) {
  precoAntigo = "";
}

   console.log("💰 ALI PREÇOS RAW:", {
  target_sale_price: produto.target_sale_price,
  sale_price: produto.sale_price,
  app_sale_price: produto.app_sale_price,
  target_app_sale_price: produto.target_app_sale_price,
  target_min_sale_price: produto.target_min_sale_price,
  min_sale_price: produto.min_sale_price,
  target_original_price: produto.target_original_price,
  original_price: produto.original_price
});

  
  if (produto.discount === "0%" && limparPreco(precoAtual) === limparPreco(precoAntigo)) {
  precoAntigo = "";
}
 
// 🔥 PRIORIDADE: preço real da URL (AliExpress promo)
try {
  const urlDecodificada = decodeURIComponent(urlEntrada);

  // pega exatamente o padrão pdp_npi
  const match = urlDecodificada.match(/BRL!([\d.]+)!([\d.]+)/);

  if (match) {
    const antigo = match[1];
    const atual = match[2];

    // só usa se fizer sentido (evita bug tipo 8.93)
    if (parseFloat(atual) < parseFloat(antigo)) {
      precoAntigo = antigo;
      precoAtual = atual;
    }
  }

} catch (e) {
  console.log("Erro ao extrair preço da URL:", e.message);
}

    let linkAfiliado =
      produto.promotion_link ||
      produto.product_detail_url ||
      urlEntrada;

    if (!linkAfiliado && trackingId) {
      linkAfiliado =
        `https://s.click.aliexpress.com/deep_link.htm?aff_short_key=${trackingId}&dl_target_url=${encodeURIComponent(urlEntrada)}`;
    }

     const linkFinal = await encurtarUrl(linkAfiliado);

   return {
      marketplace: "aliexpress",
      titulo: htmlDecode(titulo || "Produto AliExpress"),
      precoAntigo: limparPreco(precoAntigo || ""),
      precoAtual: limparPreco(precoAtual || ""),
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado: linkFinal,
      imagem: corrigirImagemUrl(imagem) || imagem,
      categoria: "AliExpress",
      avisoCupom,
      aviso: !imagem || titulo === "Produto AliExpress"
        ? "Dados parciais retornados pela API AliExpress."
        : ""
    };

  } catch (e) {
    console.error("ERRO ALIEXPRESS:", e.message);

    return {
      marketplace: "aliexpress",
      titulo: "Produto AliExpress",
      precoAntigo: "",
      precoAtual: "",
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado: urlEntrada,
      imagem: "",
      categoria: "AliExpress",
      aviso: "Erro ao consultar API AliExpress"
    };
  }
}

async function importarMagalu(urlEntrada, config = {}) {
  try {
    const promoterId =
      config?.credenciais?.promoterId ||
      config?.promoterId ||
      "";

    const linkAfiliado = gerarLinkMagalu(urlEntrada, promoterId);

   const urlConsulta = String(urlEntrada)
  .replace(
    /https:\/\/www\.magazinevoce\.com\.br\/[^/]+/i,
    "https://www.magazineluiza.com.br"
  );

const response = await fetch(urlConsulta, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9"
  }
});
    
    const html = await response.text();

    const titulo =
      html.match(/<title>(.*?)<\/title>/i)?.[1]
        ?.replace(" | Magazine Luiza", "")
        ?.trim() ||
      "Produto Magalu";

    const imagem =
      html.match(/property="og:image" content="([^"]+)"/i)?.[1] || "";

    let precoAtual = "";

    const precoMatch =
      html.match(/"price":"([^"]+)"/i) ||
      html.match(/"finalPrice":"([^"]+)"/i);

    if (precoMatch?.[1]) {
      precoAtual = `R$ ${String(precoMatch[1]).replace(".", ",")}`;
    }

    return {
      marketplace: "magalu",
      titulo,
      precoAntigo: "",
      precoAtual,
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado,
      imagem,
      categoria: "Magalu",
      aviso: "Verifique se há cupons disponíveis na página"
    };
  } catch (e) {
    console.log("❌ erro importarMagalu:", e.message);

    return {
      marketplace: "magalu",
      titulo: "Produto Magalu",
      precoAntigo: "",
      precoAtual: "",
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado: urlEntrada,
      imagem: "",
      categoria: "Magalu",
      aviso: "Erro ao consultar Magalu"
    };
  }
}

async function buscarProdutosAliExpressAPI(termo) {
  const credenciais = integracoesPorCliente["admin"]?.aliexpress?.credenciais || {};

  const appKey = credenciais.appKey || "";
  const secret = credenciais.secret || "";
  const trackingId = credenciais.trackingId || "";

  if (!appKey || !secret || !trackingId) {
    console.log("⚠️ AliExpress API sem credenciais.");
    return [];
  }

  function timestampGMT8() {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  function assinar(params, appSecret) {
    const sortedKeys = Object.keys(params).sort();
    let base = appSecret;

    for (const key of sortedKeys) {
      if (key !== "sign") base += key + params[key];
    }

    base += appSecret;

    return crypto
      .createHash("md5")
      .update(base, "utf8")
      .digest("hex")
      .toUpperCase();
  }

  const params = {
    method: "aliexpress.affiliate.product.query",
    app_key: appKey,
    timestamp: timestampGMT8(),
    sign_method: "md5",
    format: "json",
    v: "2.0",
    keywords: termo,
    target_currency: "BRL",
    target_language: "PT",
    ship_to_country: "BR",
    tracking_id: trackingId,
    page_no: "1",
    page_size: "10"
  };

  params.sign = assinar(params, secret);

  const response = await fetch("https://api-sg.aliexpress.com/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
    },
    body: new URLSearchParams(params)
  });

  const data = await response.json();

  console.log("🧪 ALI API RESPONSE:", JSON.stringify(data).slice(0, 1000));

  const lista =
    data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product ||
    data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products ||
    [];

  return Array.isArray(lista) ? lista : [lista];
}

// ================= FAREJADOR ALIEXPRESS =================

async function farejarAliExpress() {
  try {
    if (!config.marketplaces?.aliexpress?.ativo) {
      console.log("⏸ AliExpress desativado. Farejador ignorado.");
      return;
    }

    console.log("🛒 Farejando ofertas AliExpress...");

    const cfg = config.marketplaces?.aliexpress || {};
    const limitePorRodada = cfg.limitePorRodada || 5;
    let adicionadasNestaRodada = 0;

    let ofertasEncontradas = [];

   const buscasBrasil = [

  "pen drive brasil",

  "hd exos brasil",
  "hd seagate exos brasil",
  "hd 16tb brasil",
  "hd 18tb brasil",

  "ssd samsung brasil",
  "ssd kingston brasil",
  "ssd crucial brasil",

  "ssd 1tb brasil",
  "ssd 2tb brasil",
  "ssd nvme 1tb brasil",
  "ssd nvme brasil",

  "rx 6600 brasil",
  "rx 7600 brasil",
  "rx 7900 brasil",

  "rtx 4060 brasil",
  "rtx 4070 brasil",

  "placa de video brasil",
  "kit xeon brasil",
  "mini pc brasil",

  "mouse gamer brasil",
  "teclado mecanico brasil",
  "teclado gamer brasil",

  "fone bluetooth brasil",
  "caixinha de som brasil",
  "speaker bluetooth brasil",

  "webcam brasil",
  "face cam brasil",

  "smartwatch brasil",
  "camera wifi brasil",

  "multimetro digital brasil",
  "estacao de solda brasil",
  "fonte bancada brasil"
];

const buscasInternacionais = [
 
  "hd exos",
  "seagate exos",
  "hd 16tb",
  "hd 18tb",

  "ssd samsung",
  "ssd kingston",
  "ssd crucial",

  "ssd 1tb",
  "ssd 2tb",
  "ssd nvme 1tb",
  "ssd nvme",

  "rx 6600",
  "rx 7600",
  "rx 7900",
  "rx 590",

  "rtx 4060",
  "rtx 4070",

  "kit xeon",
  "placa de video",
  "mini pc",

  "mouse gamer",
  "teclado mecanico",
  "teclado gamer",

  "fone bluetooth",
  "caixinha de som",
  "speaker bluetooth",

  "webcam",
  "face cam",

  "smartwatch",
  "camera wifi",

  "tv box",
  "drone"
];

  async function buscarTermoAliExpress(termo, tipo) {
  try {
    if (adicionadasNestaRodada >= limitePorRodada) return;

    console.log(`${tipo} Busca AliExpress API:`, termo);

    const produtosAPI = await buscarProdutosAliExpressAPI(termo);

    console.log(`🔎 ${termo}: ${produtosAPI.length} produtos AliExpress via API`);

    for (const item of produtosAPI.slice(0, 5)) {
      try {
        if (adicionadasNestaRodada >= limitePorRodada) return;

        const link =
          item.promotion_link ||
          item.product_detail_url ||
          item.product_url ||
          item.target_sale_url ||
          "";

const linkLimpo = String(link).split("?")[0];

if (produtoRepetidoRecentemente(linkLimpo, 48)) {
  console.log("⏭️ Link AliExpress repetido ignorado:", linkLimpo);
  return;
}
        const titulo =
          item.product_title ||
          item.title ||
          item.product_subject ||
          "Produto AliExpress";

const chaveRepeticao =
  gerarChaveProduto(titulo + " aliexpress");

if (produtoRepetidoRecentemente(chaveRepeticao, 48)) {
  console.log("⏭️ AliExpress repetido ignorado:", titulo);
  return;
}

        const precoAtual =
          limparPreco(
            item.target_sale_price ||
            item.sale_price ||
            item.app_sale_price ||
            item.original_price
          );

        const precoAntigo =
          limparPreco(
            item.target_original_price ||
            item.original_price ||
            item.product_original_price
          );

        const imagem =
          item.product_main_image_url ||
          item.image_url ||
          item.product_small_image_urls?.string?.[0] ||
          "";

        const descontoTexto =
          item.discount ||
          item.discount_rate ||
          item.evaluate_rate ||
          "";

        const precoNumero = Number(
          String(precoAtual || "")
            .replace("R$", "")
            .replace(/\./g, "")
            .replace(",", ".")
            .trim()
        );

        const precoAntigoNumero = Number(
          String(precoAntigo || "")
            .replace("R$", "")
            .replace(/\./g, "")
            .replace(",", ".")
            .trim()
        );

        const desconto =
          precoAntigoNumero > precoNumero
            ? ((precoAntigoNumero - precoNumero) / precoAntigoNumero) * 100
            : Number(String(descontoTexto).replace(/\D/g, "")) || 0;

      console.log("🧪 PRODUTO ALI API:", {
      titulo,
      precoAtual,
      precoAntigo,
      desconto: Math.round(desconto) + "%",
      link: link?.slice(0, 80)
      });
        

const tituloLower = titulo.toLowerCase();

const palavrasBloqueadas = [
  "cabelo",
  "peruca",
  "extensão",
  "extensões",
  "sapato",
  "sandália",
  "chinelo",
  "salto",
  "batom",
  "cílios",
  "unha",
  "bolsa",
  "sutiã",
  "calcinha",
  "wedding",
  "bridal"
];

if (palavrasBloqueadas.some(p => tituloLower.includes(p))) {
  console.log("🚫 Produto bloqueado:", titulo);
  continue;
}
        
        if (!link) continue;
if (!precoNumero || !Number.isFinite(precoNumero)) continue;

const precoMinimo = Number(cfg.precoMinimo) || 0;
const descontoMinimo = Number(cfg.descontoMinimo) || 0;

const descontoMinimoInternacional =
  Number(cfg.descontoMinimoInternacional) || descontoMinimo;

const minimoDescontoAplicado =
  tipo === "🌍"
    ? descontoMinimoInternacional
    : descontoMinimo;

if (precoNumero < precoMinimo) continue;
if (desconto < minimoDescontoAplicado) continue;
         
        const linkCurto = await encurtarUrl(link);

        const novaOferta = {
          nome: titulo,
          titulo,
          preco: precoAtual,
          precoAtual,
          precoAntigo: precoAntigo || "",
          cupom: "",
          avisoCupom: desconto >= minimoDescontoAplicado ? `${Math.round(desconto)}% OFF no AliExpress.` : "",
          parcelamento: "",
          link: linkCurto,
          linkAfiliado: linkCurto,
          imagem,
          marketplace: "aliexpress",
          categoria: "AliExpress",
          sessaoId: "sessao1",
          status: "pendente",
          clienteId: "admin"
        };

        const jaExiste = ofertaJaExiste(novaOferta);

        if (!jaExiste) {
          novaOferta.criadoEm = new Date().toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo"
          });

          ofertasEncontradas.push(novaOferta);

          adicionadasNestaRodada++;

          console.log("🤖 Nova oferta AliExpress:", {
            titulo: novaOferta.titulo,
            preco: novaOferta.precoAtual,
            precoAntigo: novaOferta.precoAntigo,
            desconto: Math.round(desconto) + "%",
            link: novaOferta.linkAfiliado?.slice(0, 80)
          });
        }

        await new Promise(r => setTimeout(r, 1500));
      } catch (e) {
        console.log("❌ erro produto AliExpress API:", e.message);
      }
    }

    await new Promise(r => setTimeout(r, 3000));
  } catch (e) {
    console.log("❌ erro busca AliExpress API:", termo, e.message);
  }
}

    for (const termo of buscasBrasil) {
      await buscarTermoAliExpress(termo, "🇧🇷");
      if (adicionadasNestaRodada >= limitePorRodada) break;
    }

    if (cfg.permitirInternacionalForte && adicionadasNestaRodada < limitePorRodada) {
      for (const termo of buscasInternacionais) {
        await buscarTermoAliExpress(termo, "🌍");
        if (adicionadasNestaRodada >= limitePorRodada) break;
      }
    }

const ofertasFiltradas = aplicarFiltrosUniversais(
  ofertasEncontradas,
  {
    preferirEnvioBrasil: true,
    bloquearSemImagem: true,
    bloquearSemPreco: true,
  }
);

console.log(
  `🧠 Ofertas AliExpress após filtros universais: ${ofertasFiltradas.length}`
);

for (const oferta of ofertasFiltradas) {
  fila.push(oferta);
}

salvarFila();


    console.log(`✅ AliExpress finalizado. Adicionadas: ${adicionadasNestaRodada}`);
  } catch (e) {
    console.log("❌ erro farejador AliExpress:", e.message);
  }
}

async function farejarMagalu() {
  try {
    console.log("🟦 Farejando ofertas Magalu...");

    // em breve:
    // buscarOfertasMagalu()

  } catch (e) {
    console.log("❌ erro farejador Magalu:", e.message);
  }
}

// ================= FAREJADOR AWIN =================

async function farejarAwin() {
  try {
    console.log("🛒 Farejando produtos reais Awin KaBuM...");

    const cfg = config.marketplaces?.awin || {};

    if (!cfg.ativo) {
      console.log("⏸ Awin desativada. Farejador ignorado.");
      return;
    }

    const limitePorRodada = cfg.limitePorRodada || 5;
    const precoMinimo = cfg.precoMinimo || 20;
    const feedFile = cfg.feedFile || "awin_kabum.csv";

    const caminhoFeed = path.join(__dirname, feedFile);

    if (!fs.existsSync(caminhoFeed)) {
      console.log("❌ Feed Awin não encontrado:", caminhoFeed);
      return;
    }

    const produtos = [];

    await new Promise((resolve, reject) => {
    fs.createReadStream(caminhoFeed)
    .pipe(zlib.createGunzip())
    .pipe(csv())
    .on("data", (row) => {
      produtos.push(row);
    })
    .on("end", resolve)
    .on("error", reject);
    });

    console.log("📦 Produtos no feed Awin:", produtos.length);
    
    console.log("🧪 PRIMEIRO PRODUTO AWIN:", produtos[0]);

    let adicionadas = 0;
    let ofertasEncontradas = [];

    for (const item of produtos) {
      if (adicionadas >= limitePorRodada) break;

      const titulo = item.product_name || item.name || "";
      const preco = Number(String(item.search_price || "0").replace(",", "."));
      const imagem = item.merchant_image_url || item.aw_image_url || "";
      const link = item.aw_deep_link || item.product_url || item.merchant_deep_link || "";
      const categoria = item.merchant_category || "KaBuM";

      if (!titulo || !link) continue;
      if (preco < precoMinimo) continue;

      if (produtoRepetidoRecentemente(titulo, 24)) {
        console.log("⏭️ Awin repetido ignorado:", titulo);
        continue;
      }

      const oferta = {
        id: Date.now() + "-" + Math.random().toString(36).slice(2),
        titulo,
        precoAtual: preco ? `R$ ${preco.toFixed(2).replace(".", ",")}` : "",
        precoAntigo: "",
        cupom: "",
        avisoCupom: "",
        parcelamento: "",
        imagem,
        link,
        linkAfiliado: link,
        marketplace: "Awin",
        loja: "KaBuM",
        categoria,
        status: "pendente",
        clienteId: "admin",
        criadoEm: new Date().toISOString()
      };

       ofertasEncontradas.push(oferta);
      adicionadas++;

      console.log("✅ Produto Awin encontrado:", titulo);
    }

    const ofertasFiltradas = aplicarFiltrosUniversais(
      ofertasEncontradas,
      {
        preferirEnvioBrasil: false,
        bloquearSemImagem: true,
        bloquearSemPreco: true,
      }
    );

    console.log(
      `🧠 Ofertas Awin após filtros universais: ${ofertasFiltradas.length}`
    );

    for (const oferta of ofertasFiltradas) {
      fila.push(oferta);
    }

    salvarFila();

    console.log(`🚀 Awin finalizado. Produtos adicionados: ${ofertasFiltradas.length}`);
  } catch (e) {
    console.log("❌ erro farejador Awin:", e.message);
  }
}

// ================= FAREJADOR AMAZON =================

async function importarAmazon(url, config) {
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  const cookies = config?.credenciais?.cookies || "";

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cookie": cookies
    }
  });

  const html = await response.text();
  const jsonLd = extrairJsonLd(html);

  function limparHtml(texto) {
    if (!texto) return "";
    return htmlDecode(String(texto).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }

  function primeiroMatch(regex) {
    const match = html.match(regex);
    return match?.[1] ? limparHtml(match[1]) : "";
  }

  function todosPrecosDoHtml() {
    const encontrados = [];
    const regex = /R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})|R\$\s*\d+(?:,\d{2})?/g;
    const matches = html.match(regex) || [];

    for (const item of matches) {
      const precoLimpo = limparPreco(item);
      const numero = Number(String(precoLimpo).replace(",", "."));

      if (Number.isFinite(numero) && numero > 0) {
        encontrados.push({ texto: precoLimpo, numero });
      }
    }

    return encontrados;
  }

  function extrairImagemAmazon() {
    const imagemMeta =
      (Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image) ||
      extrairMeta(html, "og:image") ||
      extrairMeta(html, "twitter:image") ||
      html.match(/id=["']landingImage["'][^>]+src=["']([^"']+)["']/i)?.[1] ||
      html.match(/data-old-hires=["']([^"']+)["']/i)?.[1] ||
      "";

    if (imagemMeta) return htmlDecode(imagemMeta).replace(/\\u002F/g, "/");

    const dynamicImageRaw =
      html.match(/data-a-dynamic-image=["']([^"']+)["']/i)?.[1] ||
      "";

    if (dynamicImageRaw) {
      try {
        const decoded = htmlDecode(dynamicImageRaw).replace(/\\u002F/g, "/");
        const parsed = JSON.parse(decoded);
        const primeira = Object.keys(parsed || {})[0];

        if (primeira) return primeira;
      } catch {}
    }

    const hiRes =
      html.match(/"hiRes"\s*:\s*"([^"]+)"/i)?.[1] ||
      html.match(/"large"\s*:\s*"([^"]+)"/i)?.[1] ||
      "";

    return hiRes ? hiRes.replace(/\\u002F/g, "/") : "";
  }

  const titulo =
    jsonLd?.name ||
    extrairMeta(html, "og:title") ||
    extrairMeta(html, "twitter:title") ||
    primeiroMatch(/<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i) ||
    "Produto Amazon";

  const precoOffscreenAtual =
    primeiroMatch(/id=["']corePriceDisplay_desktop_feature_div["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
    primeiroMatch(/id=["']corePrice_feature_div["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
    primeiroMatch(/class=["'][^"']*priceToPay[^"']*["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
    primeiroMatch(/id=["']apex_desktop["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);

  const precoWholeFractionMatch =
    html.match(/class=["'][^"']*a-price-whole[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?class=["'][^"']*a-price-fraction[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);

  let preco =
    precoOffscreenAtual ||
    jsonLd?.offers?.price ||
    extrairMeta(html, "product:price:amount") ||
    extrairMeta(html, "og:price:amount") ||
    (precoWholeFractionMatch ? `${limparHtml(precoWholeFractionMatch[1])},${limparHtml(precoWholeFractionMatch[2])}` : "") ||
    primeiroMatch(/id=["']priceblock_ourprice["'][^>]*>([\s\S]*?)<\/span>/i) ||
    primeiroMatch(/id=["']priceblock_dealprice["'][^>]*>([\s\S]*?)<\/span>/i) ||
    "";

  preco = limparPreco(htmlDecode(preco));

  const precosEncontrados = todosPrecosDoHtml();

  if (!preco && precosEncontrados.length) {
    const menorPreco = precosEncontrados
      .map((p) => p.numero)
      .filter((n) => n > 1)
      .sort((a, b) => a - b)[0];

    if (menorPreco) {
      preco = menorPreco.toFixed(2).replace(".", ",");
    }
  }

  let precoAntigoRaw =
    primeiroMatch(/class=["'][^"']*a-text-price[^"']*["'][^>]*>[\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
    primeiroMatch(/data-a-strike=["']true["'][\s\S]*?<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
    "";

  let precoAntigo = limparPreco(htmlDecode(precoAntigoRaw));

  if (!precoAntigo && precosEncontrados.length && preco) {
    const precoAtualNumero = Number(String(preco).replace(",", "."));
    const maiorPreco = precosEncontrados
      .map((p) => p.numero)
      .filter((n) => Number.isFinite(n) && n > precoAtualNumero)
      .sort((a, b) => b - a)[0];

    if (maiorPreco) {
      precoAntigo = maiorPreco.toFixed(2).replace(".", ",");
    }
  }

  if (!precoAntigo) {
    const precoNumero = Number(String(preco).replace(",", "."));
    if (Number.isFinite(precoNumero) && precoNumero > 0) {
      precoAntigo = (precoNumero * 1.2)
        .toFixed(2)
        .replace(".", ",");
    }
  }

  let parcelamento =
  primeiroMatch(/(\d+x\s+de\s+R\$\s*[\d.,]+\s*sem juros)/i) ||
  primeiroMatch(/(\d+\s*x\s*R\$\s*[\d.,]+)/i) ||
  "";
  const imagem = extrairImagemAmazon();

  let linkAfiliado = url;
  const trackingId =
    config?.credenciais?.trackingId ||
    config?.credenciais?.partnerTag ||
    config?.credenciais?.appId ||
    "";

  if (trackingId) {
    try {
      const u = new URL(url);
      u.searchParams.set("tag", trackingId);
      linkAfiliado = u.toString();
    } catch {
      linkAfiliado = url;
    }
  }

  let cupom =
  primeiroMatch(/Salve o cupom[^:]{0,80}:\s*([A-Z0-9]{4,20})/i) ||
  primeiroMatch(/Desconto de R\$\s*[\d.,]+[^<]{0,80}código\s+([A-Z0-9]{4,20})/i) ||
  primeiroMatch(/com o código\s+([A-Z0-9]{4,20})/i) ||
  primeiroMatch(/Insira o código\s+([A-Z0-9]{4,20})/i) ||
  primeiroMatch(/Aplique o cupom\s+([A-Z0-9]{4,20})/i) ||
  primeiroMatch(/Use o cupom\s+([A-Z0-9]{4,20})/i) ||
  "";

 let avisoCupom = "";

if (cupom) {
  avisoCupom = `Resgate/aplique o cupom ${cupom} na página antes de finalizar.`;
} else if (/resgatar|cupom|código|desconto extra/i.test(html)) {
  avisoCupom = "Há cupom/desconto extra na página. Resgate antes de finalizar.";
}

if (cupom) {
  avisoCupom = `Aplique o cupom ${cupom} no carrinho.`;
} else if (/resgatar|aplique o cupom|cupom disponível|desconto extra/i.test(html)) {
  avisoCupom = "Há cupom/desconto extra na página. Resgate antes de finalizar.";
}

const linkFinal = await encurtarUrl(linkAfiliado); 
 
const temCompraNoApp =
  /COMPRANOAPP[\s\S]{0,120}(app|aplicativo|desconto|off|cupom|resgate)/i.test(html) ||
  /(app|aplicativo|desconto|off|cupom|resgate)[\s\S]{0,120}COMPRANOAPP/i.test(html) ||
  /compra\s+no\s+app/i.test(html) ||
  /desconto\s+no\s+app/i.test(html)

console.log("🎟️ AMAZON CUPOM DETECTADO:", cupom);
console.log("🎫 AMAZON AVISO CUPOM:", avisoCupom);
console.log("🔎 AMAZON TEM COMPRANOAPP?", html.includes("COMPRANOAPP"));
console.log("🔎 AMAZON TEM CUPOM?", /cupom/i.test(html));

return {
    marketplace: "amazon",
    titulo: htmlDecode(titulo)
      .replace("Amazon.com.br:", "")
      .replace("Amazon.com:", "")
      .trim(),
    precoAntigo,
    precoAtual: preco,
    parcelamento,
    cupom,
    avisoCupom,
    linkOriginal: url,
    linkAfiliado: linkFinal,
    imagem: corrigirImagemUrl(imagem) || imagem,
    categoria: "Amazon"
  };

}async function importarShopee(url, config) {
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  const { appId, secret } = config.credenciais || {};

  function normalizarPrecoShopee(valor) {
    if (!valor) return "";

    let texto = String(valor).trim();

    if (texto.includes(",")) return limparPreco(texto);

    if (/^\d+\.\d{2}$/.test(texto)) {
      return Number(texto).toFixed(2).replace(".", ",");
    }

    if (/^\d+$/.test(texto)) {
      let numero = Number(texto);

      if (numero > 100000) {
        numero = numero / 100000;
      } else if (numero > 1000) {
        numero = numero / 100;
      }

      return numero.toFixed(2).replace(".", ",");
    }

    return limparPreco(texto);
  }

  function extrairIdsShopee(link) {
    const texto = String(link || "").split("?")[0];

    // Formato novo: /product/shopId/itemId
    const matchProduct = texto.match(/\/product\/(\d+)\/(\d+)/i);
    if (matchProduct) {
      return {
        shopId: matchProduct[1],
        itemId: matchProduct[2]
      };
    }

    // Formato antigo: -i.shopId.itemId
    const match1 = texto.match(/-i\.(\d+)\.(\d+)/i);
    if (match1) {
      return {
        shopId: match1[1],
        itemId: match1[2]
      };
    }

    // Outro formato: i.shopId.itemId
    const match2 = texto.match(/i\.(\d+)\.(\d+)/i);
    if (match2) {
      return {
        shopId: match2[1],
        itemId: match2[2]
      };
    }

    return {
      shopId: "",
      itemId: ""
    };
  }

  function gerarKeywordShopee(link) {
    try {
      const semQuery = String(link).split("?")[0];
      const parte = decodeURIComponent(semQuery.split("/").pop() || "");
      const antesDoId = parte.split("-i.")[0] || parte;

      return antesDoId
        .replace(/-/g, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
    } catch {
      return "";
    }
  }

  async function chamarShopeeGraphQL(bodyPayload) {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify(bodyPayload);

    const baseString = `${appId}${timestamp}${payload}${secret}`;

    const sign = crypto
      .createHash("sha256")
      .update(baseString, "utf8")
      .digest("hex");

    const response = await fetch(
      "https://open-api.affiliate.shopee.com.br/graphql",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${sign}`
        },
        body: payload
      }
    );

    const data = await response.json();

    console.log("SHOPEE RESPONSE:", JSON.stringify(data));

    return data;
  }

  const ids = extrairIdsShopee(url);
  const keyword = gerarKeywordShopee(url);

  let produto = null;

  // 1) Tenta buscar pelo itemId do próprio link
  if (ids.itemId) {
    try {
      const bodyPayload = {
        query: `
          query {
            productOfferV2(
              itemId: ${ids.itemId},
              page: 1,
              limit: 10
            ) {
              nodes {
                itemId
                productName
                productLink
                offerLink
                imageUrl
                priceMin
                priceMax
                priceDiscountRate
                sales
                ratingStar
                commissionRate
                shopId
                shopName
              }
            }
          }
        `
      };

      const data = await chamarShopeeGraphQL(bodyPayload);
      const nodes = data?.data?.productOfferV2?.nodes || [];

      produto =
        nodes.find((p) => String(p.itemId) === String(ids.itemId)) ||
        nodes[0] ||
        null;
    } catch (e) {
      console.error("SHOPEE ITEMID ERRO:", e.message);
    }
  }

  // 2) Se não achou, tenta por keyword do link
  if (!produto && keyword) {
    try {
      const bodyPayload = {
        query: `
          query {
            productOfferV2(
              keyword: ${JSON.stringify(keyword)},
              listType: 0,
              sortType: 2,
              page: 1,
              limit: 20
            ) {
              nodes {
                itemId
                productName
                productLink
                offerLink
                imageUrl
                priceMin
                priceMax
                priceDiscountRate
                sales
                ratingStar
                commissionRate
                shopId
                shopName
              }
            }
          }
        `
      };

      const data = await chamarShopeeGraphQL(bodyPayload);
      const nodes = data?.data?.productOfferV2?.nodes || [];

      produto = nodes[0] || null;
    } catch (e) {
      console.error("SHOPEE KEYWORD ERRO:", e.message);
    }
  }

  // 3) Se a API não encontrou, fallback simples pelo HTML
  if (!produto) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });

      const html = await response.text();

      const titulo =
        extrairMeta(html, "og:title") ||
        extrairMeta(html, "twitter:title") ||
        keyword ||
        "Produto Shopee";

        const imagem =
        extrairMeta(html, "og:image") ||
        extrairMeta(html, "twitter:image") ||
        "";

       console.log("🧪 SHOPEE PRODUTO RAW:", JSON.stringify(produto, null, 2));

      let cupom = "";
      let avisoCupom = "";

      if (produto?.priceDiscountRate) {
         avisoCupom =
         "🎟️ Verifique e resgate os cupons disponíveis na página da Shopee antes de finalizar.";
      }

        return {
        marketplace: "shopee",
        titulo: htmlDecode(titulo)
          .replace(" | Shopee Brasil", "")
          .replace(" | Shopee", "")
          .trim(),
        precoAntigo: "",
        precoAtual: "",
        cupom,
        avisoCupom, 
        linkOriginal: url,
        linkAfiliado: url,
        imagem: corrigirImagemUrl(imagem) || imagem,
        categoria: "Shopee"
      };
    } catch (e) {
      console.error("SHOPEE HTML ERRO:", e.message);
    }
  }

 const precoMin = normalizarPrecoShopee(produto?.priceMin || "");
const precoMax = normalizarPrecoShopee(produto?.priceMax || "");

let precoAtual = "";
let precoAntigo = "";

const minNumero = Number(String(precoMin).replace(",", "."));
const maxNumero = Number(String(precoMax).replace(",", "."));

const temMin = Number.isFinite(minNumero) && minNumero > 0;
const temMax = Number.isFinite(maxNumero) && maxNumero > 0;

if (temMin && temMax && minNumero !== maxNumero) {
  precoAtual = `${precoMin} a ${precoMax}`;

  // Produto com variação: não inventa preço antigo automático
  precoAntigo = "";
} else {
  precoAtual = precoMin || precoMax || "";

  // Shopee não retorna preço antigo real nesse endpoint.
  // Não calcular "De" automaticamente para evitar desconto inflado.
  precoAntigo = "";
}

  let imagem = produto?.imageUrl || "";
  imagem = htmlDecode(imagem).replace(/\\u002F/g, "/");

  if (imagem && imagem.startsWith("//")) {
    imagem = "https:" + imagem;
  }

  return {
    marketplace: "shopee",
    titulo: htmlDecode(produto?.productName || keyword || "Produto Shopee")
      .replace(" | Shopee Brasil", "")
      .replace(" | Shopee", "")
      .trim(),
    precoAntigo,
    precoAtual,
    cupom: "",
    linkOriginal: url,
    linkAfiliado: produto?.offerLink || produto?.productLink || url,
    imagem: corrigirImagemUrl(imagem) || imagem,
    categoria: "Shopee"
  };
}

// ================= IMPORTAR PRODUTO =================

app.post("/importar-produto", async (req, res) => {
  const clienteId = getClienteId(req);
let marketplace = String(req.body.marketplace || "").toLowerCase();
let { url } = req.body;

url = String(url || "").trim();

if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
  url = "https://" + url;
}

const urlLower = url.toLowerCase();

if (urlLower.includes("amazon.com") || urlLower.includes("amzn.to")) {
  marketplace = "amazon";
} else if (urlLower.includes("mercadolivre.com") || urlLower.includes("meli.la")) {
  marketplace = "mercadolivre";
} else if (urlLower.includes("shopee.com") || urlLower.includes("s.shopee")) {
  marketplace = "shopee";
} else if (urlLower.includes("aliexpress.com")) {
  marketplace = "aliexpress";
}

  if (!marketplace || !url) {
    return res.status(400).json({
      erro: "marketplace e url obrigatórios"
    });
  }

  const config = integracoesPorCliente[clienteId]?.[marketplace];

  if (!config) {
    return res.status(400).json({
      erro: `Integração ${marketplace} não configurada`
    });
  }

  if (marketplace === "amazon") {
    try {
      const produto = await importarAmazon(url, config);

      if (!produto.titulo || produto.titulo === "Produto Amazon") {
        return res.json({
          marketplace: "amazon",
          titulo: "Produto importado da Amazon",
          precoAntigo: "",
          precoAtual: "",
          cupom: "",
          linkOriginal: url,
          linkAfiliado: url,
          imagem: "",
          categoria: "Amazon",
          aviso: "Dados não encontrados automaticamente. Preencha manualmente."
        });
      }

      return res.json(produto);
    } catch (e) {
      console.error("ERRO AMAZON:", e);

      return res.json({
        marketplace: "amazon",
        titulo: "Produto importado da Amazon",
        precoAntigo: "",
        precoAtual: "",
        cupom: "",
        linkOriginal: url,
        linkAfiliado: url,
        imagem: "",
        categoria: "Amazon",
        aviso: "Erro ao consultar Amazon. Preencha manualmente."
      });
    }
  }

     if (marketplace === "aliexpress") {
  try {
    const produto = await importarAliExpress(url, config);
    return res.json(produto);
  } catch (e) {
    console.error("ERRO ALIEXPRESS:", e);

    return res.json({
      marketplace: "aliexpress",
      titulo: "Produto importado da AliExpress",
      precoAntigo: "",
      precoAtual: "",
      cupom: "",
      linkOriginal: url,
      linkAfiliado: url,
      imagem: "",
      categoria: "AliExpress",
      aviso: "Erro ao consultar AliExpress"
    });
  }
}

if (marketplace === "magalu") {
  try {
    const produto = await importarMagalu(url, config);
    return res.json(produto);
  } catch (e) {
    console.error("ERRO MAGALU:", e);

    return res.json({
      marketplace: "magalu",
      titulo: "Produto importado de Magalu",
      precoAntigo: "",
      precoAtual: "",
      cupom: "",
      linkOriginal: url,
      linkAfiliado: url,
      imagem: "",
      categoria: "Magalu",
      aviso: "Erro ao gerar link Magalu. Preencha manualmente."
    });
  }
}

  if (marketplace === "mercadolivre") {
    try {
      const produto = await importarMercadoLivre(url, config);

      if (!produto.titulo || produto.titulo === "Produto Mercado Livre") {
        return res.json({
          marketplace: "mercadolivre",
          titulo: "Produto importado de Mercado Livre",
          precoAntigo: "",
          precoAtual: "",
          cupom: "",
          linkOriginal: url,
          linkAfiliado: url,
          imagem: "",
          categoria: "Mercado Livre",
          aviso: "Dados não encontrados automaticamente. Preencha manualmente."
        });
      }
       const novaOferta = {
      nome: produto.nome || produto.titulo,
      preco: produto.preco || produto.precoAtual,
      link: produto.linkAfiliado || produto.linkOriginal,
      imagem: produto.imagem,
      status: "pendente"
    };
    
    const precoNumero = Number(
  String(novaOferta.preco || "")
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim()
);

if (!precoNumero || !Number.isFinite(precoNumero)) {
  console.log("⚠️ Oferta ignorada: preço inválido", novaOferta.nome);
  return res.json({
    ...produto,
    aviso: "Produto importado, mas não foi enviado para fila porque não tem preço válido."
  });
}

const precoAntigoNumero = Number(
  String(produto.precoAntigo || "")
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim()
);

const temCupom = Boolean(produto.cupom && String(produto.cupom).trim());

const temDescontoReal =
  precoAntigoNumero &&
  Number.isFinite(precoAntigoNumero) &&
  precoAntigoNumero > precoNumero;

const descontoPercentual = temDescontoReal
  ? ((precoAntigoNumero - precoNumero) / precoAntigoNumero) * 100
  : 0;

if (!temCupom && descontoPercentual < 10) {
  console.log("⚠️ Oferta ignorada: desconto baixo", novaOferta.nome);

  return res.json({
    ...produto,
    aviso: "Produto importado, mas não foi enviado para fila porque o desconto parece baixo."
  });
}


    const jaExiste = fila.some(
  (o) => o.link === novaOferta.link
);

if (jaExiste) {
  console.log("⚠️ Oferta já existe na fila:", novaOferta.nome);
} else {
  
  if (produtoRepetidoRecentemente(novaOferta.nome, 12)) {
  console.log("🔁 Oferta parecida ignorada:", novaOferta.titulo);
  return;
}

  fila.push(novaOferta);
  salvarFila();

  console.log("🤖 Oferta adicionada automaticamente:", novaOferta.nome);
}

return res.json(produto);

    } catch (e) {
      console.error("ERRO MERCADO LIVRE:", e);

      return res.json({
        marketplace: "mercadolivre",
        titulo: "Produto importado de Mercado Livre",
        precoAntigo: "",
        precoAtual: "",
        cupom,
        avisoCupom,
        linkOriginal: url,
        linkAfiliado: url,
        imagem: "",
        categoria: "Mercado Livre",
        aviso: "Erro ao consultar Mercado Livre. Preencha manualmente."
      });
    }
  }

  if (marketplace === "shopee") {
    try {
      const produto = await importarShopee(url, config);

      if ((!produto.titulo || produto.titulo === "Produto Shopee") && !produto.precoAtual && !produto.imagem) {
        return res.json({
          marketplace: "shopee",
          titulo: "Produto Shopee importado",
          precoAntigo: "",
          precoAtual: "",
          cupom: "",
          linkOriginal: url,
          linkAfiliado: url,
          imagem: "",
          categoria: "Shopee",
          aviso: "Shopee não retornou dados completos. Preencha manualmente."
        });
      }

      return res.json(produto);
    } catch (e) {
      console.error("ERRO SHOPEE:", e);

      return res.json({
        marketplace: "shopee",
        titulo: "Produto Shopee importado",
        precoAntigo: "",
        precoAtual: "",
        cupom: "",
        linkOriginal: url,
        linkAfiliado: url,
        imagem: "",
        categoria: "Shopee",
        aviso: "Erro ao consultar Shopee. Preencha manualmente."
      });
    }
  }
  return res.json({
    marketplace,
    titulo: `Produto importado de ${config.nome || marketplace}`,
    precoAntigo: "",
    precoAtual: "",
    cupom: "",
    linkOriginal: url,
    linkAfiliado: url,
    imagem: "",
    categoria: config.nome || marketplace
  });
});

// ================= WHATSAPP =================

app.get("/sessoes", (req, res) => {
  const lista = Object.values(sessoesMeta).map(sessao => {
    const id = sessao.id;

    return {
      ...sessao,
      status: statusSessao[id] || "offline",
      conectado: statusSessao[id] === "open",
      qrDisponivel: !!qrCodes[id],
      grupos: gruposPorSessao[id]?.length || 0,
      destinos: destinosPorSessao[id]?.length || 0
    };
  });

  return res.json({
    ok: true,
    sessoes: lista
  });
});

app.post("/sessoes", (req, res) => {
  try {
    const nome = req.body.nome || "WhatsApp";
    const tipo = req.body.tipo || "whatsapp";

    const total = Object.keys(sessoesMeta).length + 1;
    const id = req.body.id || `sessao${total}`;

    if (sessoesMeta[id]) {
      return res.status(400).json({
        ok: false,
        erro: "Sessão já existe"
      });
    }

    sessoesMeta[id] = {
      id,
      nome,
      tipo,
      criadoEm: new Date().toISOString()
    };

    salvarSessoesMeta();

    return res.json({
      ok: true,
      sessao: sessoesMeta[id]
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.delete("/sessoes/:id", async (req, res) => {
  try {
    const { id } = req.params;

    try {
      if (sessoes[id]?.sock?.logout) {
        await sessoes[id].sock.logout();
      }
    } catch (e) {
      console.log("⚠️ logout ignorado ao excluir:", e.message);
    }

    try {
      sessoes[id]?.sock?.end?.();
    } catch (e) {
      console.log("⚠️ end ignorado ao excluir:", e.message);
    }

    delete sessoes[id];
    delete qrCodes[id];
    delete statusSessao[id];
    delete destinosPorSessao[id];
    delete gruposPorSessao[id];
    delete reconectando[id];
    delete sessoesMeta[id];

    fs.rmSync("/data/auth_" + id, {
      recursive: true,
      force: true
    });

    salvarSessoesMeta();

    return res.json({
      ok: true,
      message: "Sessão excluída com sucesso",
      id
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.post("/reset/:id", async (req, res) => {
  const { id } = req.params;

  try {
    console.log("🔄 Resetando sessão:", id);

    if (typeof reconectando !== "undefined") {
      reconectando[id] = false;
    }

    if (sessoes[id]) {

      try {
        await sessoes[id]?.sock?.logout?.();
      } catch (e) {
        console.log("⚠️ logout ignorado:", e.message);
      }

      try {
        sessoes[id]?.sock?.end?.();
      } catch (e) {
        console.log("⚠️ end ignorado:", e.message);
      }

      delete sessoes[id];
    }

    if (typeof qrCodes !== "undefined") {
      delete qrCodes[id];
    }

    if (typeof statusSessao !== "undefined") {
      delete statusSessao[id];
    }

    if (typeof destinosPorSessao !== "undefined") {
      delete destinosPorSessao[id];
    }

    fs.rmSync("/data/auth_" + id, {
      recursive: true,
      force: true
    });

    return res.json({
      ok: true,
      message: "Sessão resetada. Gere novo QR.",
      id
    });

  } catch (e) {
    console.log("❌ erro reset sessão:", e.message);

    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.post("/conectar", async (req, res) => {
  const { id } = req.body;

  if (!id) return res.status(400).json({ erro: "ID obrigatório" });

  iniciarWhatsApp(id, false);

  return res.json({
    ok: true,
    message: "Sessão iniciada",
    id
  });
});

app.get("/status/:id", (req, res) => {
  const { id } = req.params;

  res.json({
    conectado: statusSessao[id] === "open",
    status: statusSessao[id] || "offline"
  });
});

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

async function carregarGruposSessao(id) {
  const sock = sessoes[id];
if (gruposPorSessao[id]?.length) {
  return gruposPorSessao[id];
}

  if (!sock) {
    console.log("⚠️ Não carregou grupos: sem sessão");
    return [];
  }

  if (statusSessao[id] !== "open") {
    console.log("⚠️ Não carregou grupos: WhatsApp não está open");
    return [];
  }

  try {
    const grupos = await sock.groupFetchAllParticipating();

    const lista = Object.entries(grupos).map(([gid, g]) => ({
      id: gid,
      nome: g.subject || "Grupo sem nome"
    }));

    gruposPorSessao[id] = lista;

    console.log(`✅ Grupos carregados automaticamente: ${lista.length}`);

    return lista;
  } catch (e) {
    console.log("❌ Erro ao carregar grupos:", e.message);
    return [];
  }
}

app.get("/grupos/:id", async (req, res) => {
  const lista = await carregarGruposSessao(req.params.id);

  if (!lista.length) {
    return res.status(400).json({ erro: "Sem grupos carregados" });
  }

  return res.json(lista);
});

app.post("/magalu/gerar-link", (req, res) => {
  try {
    const { link } = req.body;

    const promoterId = integracoes?.magalu?.promoterId;

    if (!promoterId) {
      return res.status(400).json({
        ok: false,
        erro: "Magalu não configurada."
      });
    }

    if (!link) {
      return res.status(400).json({
        ok: false,
        erro: "Informe o link."
      });
    }

    const linkAfiliado = gerarLinkMagalu(link, promoterId);

    res.json({
      ok: true,
      marketplace: "magalu",
      linkOriginal: link,
      linkAfiliado
    });

  } catch (err) {
    console.error("❌ Erro Magalu:", err);

    res.status(500).json({
      ok: false,
      erro: "Erro ao gerar link Magalu"
    });
  }
});

app.post("/destinos/:id", (req, res) => {
  const { destinos } = req.body;

  if (!Array.isArray(destinos)) {
    return res.status(400).json({ erro: "destinos deve ser array" });
  }

  const id = req.params.id;

  destinosPorSessao[id] = destinos;

  if (!config.destinosPorSessao) {
    config.destinosPorSessao = {};
  }

  config.destinosPorSessao[id] = destinos;

  salvarConfig();
  console.log("💾 Destinos salvos na config:", id, destinos);

  return res.json({
    ok: true,
    destinos
  });
});

app.get("/destinos/:id", (req, res) => {
  const id = req.params.id;

  return res.json({
    ok: true,
    destinos:
      destinosPorSessao[id] ||
      config?.destinosPorSessao?.[id] ||
      []
  });
});

app.post("/test-send-todos", async (req, res) => {
  const mensagem =
    req.body?.mensagem ||
    "🧪 TESTE " + new Date().toLocaleTimeString();

  const imagemOriginal = req.body?.imagem;
  const imagemFinal = corrigirImagemUrl(imagemOriginal);

  const resultados = [];

  for (const id of Object.keys(sessoes)) {
    const sock = sessoes[id];

    if (!sock || statusSessao[id] !== "open") {
      resultados.push({
        sessao: id,
        ok: false,
        erro: "Sessão offline"
      });
      continue;
    }

    const destinos =
      destinosPorSessao[id] ||
      config?.destinosPorSessao?.[id] ||
      [];

    for (const destino of destinos) {
      try {
        if (imagemFinal) {
          await sock.sendMessage(destino, {
            image: { url: imagemFinal },
            caption: mensagem
          });

          resultados.push({
            sessao: id,
            destino,
            ok: true,
            tipo: "imagem_com_legenda"
          });
        } else {
          await sock.sendMessage(destino, {
            text: mensagem
          });

          resultados.push({
            sessao: id,
            destino,
            ok: true,
            tipo: "texto"
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch (e) {
        resultados.push({
          sessao: id,
          destino,
          ok: false,
          erro: e.message
        });
      }
    }
  }

  if (typeof enviarTelegram === "function") {
    try {
      await enviarTelegram(
        {
          ...req.body,
          imagem: imagemFinal,
          marketplace: req.body.marketplace || req.body.loja || ""
        },
        mensagem
      );

      resultados.push({
        destino: "telegram",
        ok: true,
        tipo: "telegram"
      });
    } catch (e) {
      resultados.push({
        destino: "telegram",
        ok: false,
        erro: e.message
      });
    }
  }

  return res.json({
    ok: true,
    resultados
  });
});

// ================= TELEGRAM =================

async function enviarTelegram(oferta, mensagem) {
  try {
    if (!config.telegram?.ativo) {
      console.log("⏸ Telegram desativado.");
      return;
    }

    const destinos = config.telegram?.destinos || [];

    if (!destinos.length) {
      console.log("⚠️ Nenhum destino Telegram configurado.");
      return;
    }

    for (const destino of destinos) {
      if (!destino.ativo) continue;

      const token = destino.botToken;
      const chatId = destino.chatId;

      if (!token || !chatId) {
        console.log("⚠️ Telegram destino incompleto:", destino.nome);
        continue;
      }

      if (oferta.imagem) {
        await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, {
          chat_id: chatId,
          photo: corrigirImagemUrl(oferta.imagem) || oferta.imagem,
          caption: mensagem
        });
      } else {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
          chat_id: chatId,
          text: mensagem
        });
      }

      console.log("✅ Telegram enviado:", destino.nome || chatId);

      await new Promise(r => setTimeout(r, 1500));
    }

  } catch (e) {
    console.log("❌ Erro Telegram:", e.response?.data || e.message);
  }
}

// ================= FUNCÃO WHATSAPP =================

async function iniciarWhatsApp(id, force = false) {
  console.log("🚀 Iniciando sessão:", id, "force:", force);

  const statusAtual = statusSessao[id];

  if (!force && sessoes[id] && ["connecting", "qr", "open", "reconnecting"].includes(statusAtual)) {
    console.log("⏸ Sessão já em andamento, não vou recriar:", id, statusAtual);
    return sessoes[id];
  }

  if (!force && qrCodes[id] && statusAtual === "qr") {
    console.log("⏸ QR já ativo, não vou recriar:", id);
    return sessoes[id] || null;
  }

  if (force && sessoes[id]) {
    try {
      console.log("♻️ Forçando reinício da sessão:", id);
      sessoes[id].end?.();
    } catch (e) {
      console.log("⚠️ Erro ao encerrar sessão antiga:", e.message);
    }

    delete sessoes[id];
    qrCodes[id] = null;
  }

  statusSessao[id] = "connecting";
  reconectando[id] = false;

  const { state, saveCreds } = await useMultiFileAuthState("/data/auth_" + id);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: ["Chrome", "Desktop", "1.0.0"]
  });

  sessoes[id] = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      console.log("🔥 QR RECEBIDO:", id);
      qrCodes[id] = await qrcode.toDataURL(qr);
      statusSessao[id] = "qr";
    }

    if (connection === "open") {
      console.log("✅ WHATSAPP CONECTADO:", id);

      statusSessao[id] = "open";
      qrCodes[id] = null;
      reconectando[id] = false;

      setTimeout(() => carregarGruposSessao(id), 3000);
    }

    if (connection === "close") {
      const motivo = lastDisconnect?.error?.output?.statusCode;

      console.log("❌ WHATSAPP DESCONECTADO:", id);
      console.log("Motivo:", motivo);

      qrCodes[id] = null;
      delete sessoes[id];

      if (motivo === DisconnectReason.loggedOut) {
        statusSessao[id] = "loggedOut";
        reconectando[id] = false;
        return;
      }

      statusSessao[id] = "reconnecting";

      if (!reconectando[id]) {
        reconectando[id] = true;

        setTimeout(() => {
          iniciarWhatsApp(id).catch((e) => {
            console.error("ERRO AO RECONECTAR:", e);
            statusSessao[id] = "offline";
            reconectando[id] = false;
          });
        }, 5000);
      }
    }
  });

  return sock;
}

// ================= FAREJADOR MERCADO LIVRE =================

async function farejarMercadoLivre() {
  try {

if (!config.marketplaces?.mercadolivre?.ativo) {
  console.log("⏸ Mercado Livre desativado. Farejador ignorado.");
  return;
}
    console.log("🐶 Farejando ofertas ML (modo stealth)...");

    const buscas = [
      "tenis masculino oferta",
      "air fryer promocao",
      "fone bluetooth promocao",
      "smartwatch oferta",
      "furadeira oferta",
      "perfume masculino promocao",
      "cadeira gamer oferta",
      "monitor gamer promocao",
      "mouse gamer oferta",
      "teclado mecanico oferta",
      "ssd 1tb promocao",
      "kit ferramentas promocao"
    ];

    for (const termo of buscas) {
      try {
        const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(termo)}`;

        console.log("🌐 AMAZON URL:", url);

        const response = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Accept":
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
          }
        });

        console.log("🌐 URL:", url);
        console.log("📡 STATUS:", response.status);

        if (!response.ok) {
          await new Promise(r => setTimeout(r, 6000));
          continue;
        }

        const html = await response.text();

        let cupom = "";
        let avisoCupom = "";
        
        console.log("🧪 HTML TAMANHO:", html.length);
        console.log("🧪 TEM MLB?", html.includes("MLB"));
        console.log("🧪 TEM item?", html.includes("item"));
        console.log("🧪 HTML INICIO:", html.slice(0, 1000));
        
        const cupomMatch =
  html.match(/cupom\s+([A-Z0-9]{4,20})/i) ||
  html.match(/código\s+([A-Z0-9]{4,20})/i) ||
  html.match(/use\s+o\s+cupom\s+([A-Z0-9]{4,20})/i) ||
  html.match(/aplique\s+o\s+cupom\s+([A-Z0-9]{4,20})/i);

if (cupomMatch?.[1]) {
  cupom = cupomMatch[1].trim().toUpperCase();
  avisoCupom = `Aplique o cupom ${cupom} antes de finalizar.`;
} else if (/cupom|código promocional|desconto extra|aplicar desconto/i.test(html)) {
  avisoCupom = "Há possível cupom/desconto extra na página. Confira antes de finalizar.";
}

const compraNoApp =
  /compra\s+no\s+app/i.test(html) ||
  /menor\s+preço\s+no\s+app/i.test(html) ||
  /app\s+garante/i.test(html) ||
  /desconto\s+no\s+app/i.test(html);

if (compraNoApp && !cupom) {
  cupom = "VER NO APP";
  avisoCupom = "📱 Confira pelo app do Mercado Livre, pode aparecer menor valor ou desconto exclusivo.";
}
        
        const linksExtraidos = [
  ...html.matchAll(/href="([^"]*\/MLB-[^"]*)"/g),
  ...html.matchAll(/href="([^"]*\/p\/MLB[^"]*)"/g),
  ...html.matchAll(/"permalink":"([^"]*MLB[^"]*)"/g),
  ...html.matchAll(/"url":"([^"]*MLB[^"]*)"/g)
]
  .map(m => m[1] || m[0])
  .map(link => {
    let limpo = String(link)
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&")
      .split("#")[0];

    if (limpo.startsWith("/")) {
      limpo = "https://www.mercadolivre.com.br" + limpo;
    }

    return limpo;
  })
  .filter(link =>
    link.includes("mercadolivre.com.br") &&
    link.includes("MLB") &&
    !link.includes("lista.mercadolivre") &&
    !link.includes("registration") &&
    !link.includes("security.js") &&
    !link.includes("privacidade") &&
    !link.includes("account-verification")
  );

        const links = [...new Set(linksExtraidos)].slice(0, 8);
        console.log("🧪 LINKS LIMPOS:", links);

        console.log(`🔎 ${termo}: ${links.length} produtos`);

        for (const link of links) {
          try {
            const produto = await importarMercadoLivre(link, {
              credenciais: integracoesPorCliente["admin"]?.mercadolivre?.credenciais
            });

            if (!produto.precoAtual) continue;

            const precoNumero = Number(
              String(produto.precoAtual)
                .replace("R$", "")
                .replace(/\./g, "")
                .replace(",", ".")
                .trim()
            );

            const precoAntigoNumero = Number(
              String(produto.precoAntigo || "")
                .replace("R$", "")
                .replace(/\./g, "")
                .replace(",", ".")
                .trim()
            );

            const desconto =
              precoAntigoNumero > precoNumero
                ? ((precoAntigoNumero - precoNumero) / precoAntigoNumero) * 100
                : 0;

             if (!precoNumero || !Number.isFinite(precoNumero)) continue;

if (precoNumero < (config.marketplaces?.amazon?.precoMinimo || 25)) continue;

if (desconto < (config.marketplaces?.amazon?.descontoMinimo || 20) && !produto.avisoCupom) continue;

const tituloLower = String(produto.titulo || "").toLowerCase();

if (
  tituloLower.includes("refil") ||
  tituloLower.includes("amostra") ||
  tituloLower.includes("mini") ||
  tituloLower.includes("teste")
) continue;

            const novaOferta = {
              nome: produto.titulo,
              titulo: produto.titulo,
              preco: produto.precoAtual,
              precoAtual: produto.precoAtual,
              precoAntigo: produto.precoAntigo || "",
              cupom: produto.cupom || "",
              avisoCupom: produto.avisoCupom || "",
              parcelamento: produto.parcelamento || "",
              link: produto.linkAfiliado || produto.linkOriginal || link,
              linkAfiliado: produto.linkAfiliado || produto.linkOriginal || link,
              imagem: produto.imagem || "",
              marketplace: "mercadolivre",
              categoria: "Mercado Livre",
              sessaoId: "sessao1",
              status: "pendente",
              clienteId: "admin"
            };

           const jaExiste = ofertaJaExiste(novaOferta);

            if (!jaExiste) {
              fila.push(novaOferta);
              salvarFila();

              console.log("🤖 Nova oferta ML:", {
                titulo: novaOferta.titulo,
                preco: novaOferta.precoAtual,
                precoAntigo: novaOferta.precoAntigo,
                desconto: Math.round(desconto) + "%",
                link: novaOferta.link
              });
            }

            await new Promise(r =>
            setTimeout(r, 4000 + Math.random() * 4000)
            );

          } catch (e) {
            console.log("❌ erro produto ML:", e.message);
          }
        }

         await new Promise(r =>
         setTimeout(r, 4000 + Math.random() * 6000)
        );

      } catch (e) {
        console.log("❌ erro busca ML:", e.message);
      }
    }

  } catch (e) {
    console.log("❌ erro farejador ML:", e.message);
  }
}

function ofertaJaExiste(oferta) {
  const linkNovo = String(
    oferta.link || oferta.linkAfiliado || ""
  ).trim();

  return fila.some(item => {
    const linkItem = String(
      item.link || item.linkAfiliado || ""
    ).trim();

    return (
      linkNovo &&
      linkItem &&
      linkItem === linkNovo
    );
  });
}

// ================= FAREJADOR AMAZON =================

async function farejarAmazon() {
  try {

if (!config.marketplaces?.amazon?.ativo) {
  console.log("⏸ Amazon desativada. Farejador ignorado.");
  return;
}
    console.log("🐶 Farejando ofertas Amazon...");
    
    let adicionadasNestaRodada = 0;
    let ofertasEncontradas = [];
    
    const limitePorRodada =
    config.marketplaces?.amazon?.limitePorRodada || 5;

    const buscas = [
      "air fryer",
      "fone bluetooth",
      "mouse gamer",
      "teclado mecanico",
      "ssd 1tb",
      "monitor gamer",
      "smartwatch",
      "cafeteira",
      "furadeira",
      "cadeira escritorio",
      "produto de limpeza",
      "amaciante",
      "desinfetante",
      "sabao em po",
      "papel higienico",
      "kit limpeza",
      "perfume masculino",
      "perfume feminino",
      "bicicleta eletrica",
      "chuteira",
      "camisa brasil",
      "copa do mundo",
      "smart tv",
    ];

    for (const termo of buscas) {
      const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(termo)}&rh=p_n_deal_type%3A23565492011`;

      console.log("🌐 AMAZON URL:", url);

      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept-Language":
            "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });

      console.log("📡 AMAZON STATUS:", response.status);

      if (!response.ok) {
      console.log("⚠️ Amazon recusou essa busca:", response.status);
      continue;
      }

   const html = await response.text();


    if (!html || html.length < 5000) {
    console.log("⚠️ HTML Amazon muito pequeno ou inválido.");
    continue;
    }
   
      console.log("🧪 AMAZON HTML:", html.length);
      console.log("🧪 TEM ASIN?", html.includes("/dp/"));

      const linksExtraidos = [
  ...html.matchAll(/href="([^"]*\/dp\/[A-Z0-9]{10}[^"]*)"/g),
  ...html.matchAll(/href="([^"]*\/gp\/product\/[A-Z0-9]{10}[^"]*)"/g)
]
  .map(m => m[1])
  .map(link => {
    let limpo = String(link)
      .replace(/&amp;/g, "&")
      .split("?")[0];

    if (limpo.startsWith("/")) {
      limpo = "https://www.amazon.com.br" + limpo;
    }

    return limpo;
  })
  .filter(link =>
    link.includes("amazon.com.br") &&
    !link.includes("/sspa/") &&
    !link.includes("/gp/slredirect")
  );

const links = [...new Set(linksExtraidos)].slice(0, 3);

console.log("🧪 AMAZON LINKS:", links);
console.log(`🔎 ${termo}: ${links.length} produtos Amazon`);

for (const link of links) {
  try {
    const produto = await importarAmazon(link, {
      credenciais: integracoesPorCliente["admin"]?.amazon?.credenciais
    });

    console.log("🧪 PRODUTO AMAZON:", {
      titulo: produto.titulo,
      precoAtual: produto.precoAtual,
      precoAntigo: produto.precoAntigo,
      cupom: produto.cupom,
      avisoCupom: produto.avisoCupom
    });

 const precoNumero = Number(
  String(produto.precoAtual || "")
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim()
);

const precoAntigoNumero = Number(
  String(produto.precoAntigo || "")
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim()
);

const desconto =
  precoAntigoNumero > precoNumero
    ? ((precoAntigoNumero - precoNumero) / precoAntigoNumero) * 100
    : 0;

if (!precoNumero || !Number.isFinite(precoNumero)) continue;
if (precoNumero < 30) continue;
if (desconto < 15 && !produto.avisoCupom) continue;

const novaOferta = {
  nome: produto.titulo,
  titulo: produto.titulo,
  preco: produto.precoAtual,
  precoAtual: produto.precoAtual,
  precoAntigo: produto.precoAntigo || "",
  cupom: produto.cupom || "",
  avisoCupom: produto.avisoCupom || "",
  parcelamento: produto.parcelamento || "",
  link: produto.linkAfiliado || produto.linkOriginal || link,
  linkAfiliado: produto.linkAfiliado || produto.linkOriginal || link,
  imagem: produto.imagem || "",
  marketplace: "amazon",
  categoria: "Amazon",
  sessaoId: "sessao1",
  status: "pendente",
  clienteId: "admin"
};

const jaExiste = ofertaJaExiste(novaOferta);

if (!jaExiste) {

novaOferta.criadoEm = novaOferta.criadoEm || new Date().toLocaleString("pt-BR", {
  timeZone: "America/Sao_Paulo"
});

ofertasEncontradas.push(novaOferta);

adicionadasNestaRodada++;

if (adicionadasNestaRodada >= limitePorRodada) {
  console.log("🛑 Limite Amazon por rodada atingido");
  return;
}

  console.log("🤖 Nova oferta Amazon:", {
    titulo: novaOferta.titulo,
    preco: novaOferta.precoAtual,
    precoAntigo: novaOferta.precoAntigo,
    desconto: Math.round(desconto) + "%",
    cupom: novaOferta.cupom,
    avisoCupom: novaOferta.avisoCupom
  });
}

    await new Promise(r =>
      setTimeout(r, 3000 + Math.random() * 5000)
    );

  } catch (e) {
    console.log("❌ erro produto Amazon:", e.message);
  }
}

      await new Promise(r =>
        setTimeout(r, 4000 + Math.random() * 5000)
      );
    }

const ofertasFiltradas = aplicarFiltrosUniversais(
  ofertasEncontradas,
  {
    preferirEnvioBrasil: false,
    bloquearSemImagem: true,
    bloquearSemPreco: true,
  }
);

console.log(
  `🧠 Ofertas Amazon após filtros universais: ${ofertasFiltradas.length}`
);

for (const oferta of ofertasFiltradas) {
  fila.push(oferta);
}

salvarFila();

console.log(`✅ Amazon finalizado. Adicionadas: ${adicionadasNestaRodada}`);


  } catch (e) {
    console.log("❌ erro farejador Amazon:", e.message);
  }
}

// ================= TESTE AWIN =================

async function testarAwinProdutos() {

  try {

    console.log("🧪 TESTE AWIN INICIADO");

    const clienteId = "admin";

    const integracao =
      integracoesPorCliente?.[clienteId]?.awin;

    if (!integracao) {
      console.log("❌ Awin não configurada");
      return;
    }

    const {
      publisherId,
      apiToken
    } = integracao.credenciais || {};

    if (!publisherId || !apiToken) {
      console.log("❌ Credenciais Awin inválidas");
      return;
    }

    const url =
      `https://api.awin.com/publishers/${publisherId}/programmes`;

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${apiToken}`
      },
      params: {
        relationship: "joined"
      },
      timeout: 15000
    });

    console.log(
      "🧪 AWIN PROGRAMAS:",
      JSON.stringify(response.data, null, 2)
    );

  } catch (e) {

    console.log(
      "❌ erro teste awin:",
      e.response?.data || e.message
    );

  }
}

async function buscarOfertasShopee() {
  const configShopee = integracoesPorCliente["admin"]?.shopee;

  if (!configShopee?.credenciais?.appId || !configShopee?.credenciais?.secret) {
    console.log("❌ Shopee sem credenciais configuradas");
    return [];
  }

  const { appId, secret } = configShopee.credenciais;

  const timestamp = Math.floor(Date.now() / 1000);

  const bodyPayload = {
    query: `
      query {
        productOfferV2(
          listType: 0,
          sortType: 2,
          page: 1,
          limit: 30
        ) {
          nodes {
            itemId
            productName
            productLink
            offerLink
            imageUrl
            priceMin
            priceMax
            priceDiscountRate
            sales
            ratingStar
            commissionRate
            shopId
            shopName
          }
        }
      }
    `
  };

  const payload = JSON.stringify(bodyPayload);
  const baseString = `${appId}${timestamp}${payload}${secret}`;

  const sign = crypto
    .createHash("sha256")
    .update(baseString, "utf8")
    .digest("hex");

  const response = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${sign}`
    },
    body: payload
  });

  const data = await response.json();

  console.log("🛍️ SHOPEE BUSCA RESPONSE:", JSON.stringify(data).slice(0, 1000));

  return data?.data?.productOfferV2?.nodes || [];
}


// ================= FAREJADOR SHOPEE =================

async function farejarShopee() {
  try {
    if (!config.marketplaces?.shopee?.ativo) {
      console.log("⏸ Shopee desativada. Farejador ignorado.");
      return;
    }

    console.log("🛍️ Farejando ofertas Shopee...");

    const produtos = await buscarOfertasShopee();

    if (!Array.isArray(produtos)) {
      console.log("❌ Shopee não retornou array");
      return;
    }

    console.log(`🔎 ${produtos.length} produtos Shopee encontrados`);

    let adicionadasNestaRodada = 0;
    let ofertasEncontradas = [];

    const limitePorRodada =
      config.marketplaces?.shopee?.limitePorRodada || 10;

    for (const item of produtos) {
      try {
        const desconto = Number(item.priceDiscountRate || 0);
        const vendas = Number(item.sales || 0);
        const nota = Number(item.ratingStar || 0);
        const precoAtualNumero = Number(item.priceMin || 0);

        if (desconto < (config.marketplaces?.shopee?.descontoMinimo || 15)) continue;
        if (!precoAtualNumero) continue;
        if (precoAtualNumero < (config.marketplaces?.shopee?.precoMinimo || 20)) continue;
        if (vendas < 20) continue;
        if (nota > 0 && nota < 4.5) continue;

        const precoAtual = precoAtualNumero.toFixed(2).replace(".", ",");

        const precoAntigoNumero =
          precoAtualNumero / (1 - desconto / 100);

        const precoAntigo = precoAntigoNumero.toFixed(2).replace(".", ",");

        const novaOferta = {
          nome: item.productName,
          titulo: item.productName,
          preco: precoAtual,
          precoAtual,
          precoAntigo,
          link: item.offerLink,
          linkAfiliado: item.offerLink,
          imagem: item.imageUrl,
          marketplace: "shopee",
          categoria: "Shopee",
          sessaoId: "sessao1",
          status: "pendente",
          clienteId: "admin",
          criadoEm: new Date().toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo"
          }),
          cupom: "",
          avisoCupom: "🎟️ Confira cupons disponíveis na página antes de finalizar."
        };

        const jaExiste = fila.some(o =>
          o.link === novaOferta.link ||
          o.titulo === novaOferta.titulo
        );

        if (jaExiste) continue;

        ofertasEncontradas.push(novaOferta);
        adicionadasNestaRodada++;

        console.log("🛍️ Nova oferta Shopee:", {
          titulo: novaOferta.titulo,
          preco: novaOferta.precoAtual,
          desconto: desconto + "%"
        });

        if (adicionadasNestaRodada >= limitePorRodada) {
          console.log("🛑 Limite Shopee atingido");
          break;
        }

        await new Promise(r =>
          setTimeout(r, 3000 + Math.random() * 4000)
        );

      } catch (e) {
        console.log("❌ erro item Shopee:", e.message);
      }
    }

    const ofertasFiltradas = aplicarFiltrosUniversais(
      ofertasEncontradas,
      {
        preferirEnvioBrasil: false,
        bloquearSemImagem: true,
        bloquearSemPreco: true,
      }
    );

    console.log(
      `🧠 Ofertas Shopee após filtros universais: ${ofertasFiltradas.length}`
    );

    for (const oferta of ofertasFiltradas) {
      fila.push(oferta);
    }

    salvarFila();

    console.log(`✅ Shopee finalizado. Adicionadas: ${adicionadasNestaRodada}`);

  } catch (e) {
    console.log("❌ erro farejador Shopee:", e.message);
  }
}

const PORT = process.env.PORT || 3000;

function podeRodarAgora() {
  const agoraBR = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );

  const horaAtual = agoraBR.getHours() * 60 + agoraBR.getMinutes();

  console.log({
    pausarMadrugada: config.pausarMadrugada,
    inicio: config.horarioInicio,
    fim: config.horarioFim,
    horaServidorBR: `${String(agoraBR.getHours()).padStart(2, "0")}:${String(agoraBR.getMinutes()).padStart(2, "0")}`
  });

  if (!config.pausarMadrugada) return true;

  const [inicioH, inicioM] = (config.horarioInicio || "08:00").split(":").map(Number);
  const [fimH, fimM] = (config.horarioFim || "23:00").split(":").map(Number);

  const inicio = inicioH * 60 + inicioM;
  const fim = fimH * 60 + fimM;

  if (inicio <= fim) {
    return horaAtual >= inicio && horaAtual <= fim;
  }

  return horaAtual >= inicio || horaAtual <= fim;
}

app.listen(PORT, () => {
  console.log("🔥 API ONLINE NA PORTA " + PORT);

setTimeout(() => {
  console.log("🧪 TESTE DIRETO ALIEXPRESS");
  farejarAliExpress();
}, 15000);

setTimeout(() => {
  console.log("🚀 Iniciando Shopee após boot...");
  farejarShopee();
}, 5 * 60 * 1000);

setTimeout(() => {
  console.log("🚀 Iniciando Amazon após boot...");
  farejarAmazon();
}, 10 * 60 * 1000);

setTimeout(() => {
  console.log("🔄 Reconectando sessões WhatsApp automaticamente...");

  const sessoesParaReconectar = Object.keys(config?.destinosPorSessao || {});

  if (!sessoesParaReconectar.includes("sessao1")) {
    sessoesParaReconectar.push("sessao1");
  }

  sessoesParaReconectar.forEach((id, index) => {
    setTimeout(() => {
      console.log("🚀 Reconectando sessão:", id);
      iniciarWhatsApp(id);
    }, 3000 + index * 4000);
  });

}, 3000);

}); 
 
setTimeout(() => {
  setInterval(() => {
    const cfg = config.marketplaces?.shopee;

    if (
  config.automacaoAtiva &&
  cfg?.ativo &&
  podeRodarAgora()
) {
      console.log("⏱️ Rodando farejador Shopee...");
      farejarShopee();
    }
  }, (config.marketplaces?.shopee?.intervaloFarejoMinutos || 10) * 60 * 1000);
}, 5 * 60 * 1000);

setTimeout(() => {
  setInterval(() => {
    const cfg = config.marketplaces?.amazon;

    if (
  config.automacaoAtiva &&
  cfg?.ativo &&
  podeRodarAgora()
) {
      console.log("⏱️ Rodando farejador Amazon...");
      farejarAmazon();
    }
  }, (config.marketplaces?.amazon?.intervaloFarejoMinutos || 15) * 60 * 1000);
}, 5 * 60 * 1000);

setTimeout(() => {
  setInterval(() => {
    const cfg = config.marketplaces?.aliexpress;
  console.log("🧪 CHECK ALIEXPRESS:", {
  ativo: config.marketplaces?.aliexpress?.ativo,
  automacao: config.automacaoAtiva,
  podeRodar: podeRodarAgora(),
  intervalo: config.marketplaces?.aliexpress?.intervaloFarejoMinutos
  });

    if (
      config.automacaoAtiva &&
      cfg?.ativo &&
      podeRodarAgora()
    ) {
      console.log("⏱️ Rodando farejador AliExpress...");
      farejarAliExpress();
    }
  }, (config.marketplaces?.aliexpress?.intervaloFarejoMinutos || 40) * 60 * 1000);
},  10 * 60 * 1000);

setTimeout(() => {
  setInterval(() => {
    const cfg = config.marketplaces?.magalu;

    if (
      config.automacaoAtiva &&
      cfg?.ativo &&
      podeRodarAgora()
    ) {
      console.log("🟦 Rodando farejador Magalu...");
      farejarMagalu();
    }
  }, (config.marketplaces?.magalu?.intervaloFarejoMinutos || 30) * 60 * 1000);
}, 25 * 60 * 1000);

setTimeout(() => {
  setInterval(() => {
    const cfg = config.marketplaces?.awin;

    if (
      config.automacaoAtiva &&
      cfg?.ativo &&
      podeRodarAgora()
    ) {
      console.log("🟪 Rodando farejador Awin...");
      farejarAwin();
    }
  }, (config.marketplaces?.awin?.intervaloFarejoMinutos || 30) * 60 * 1000);
}, 1 * 60 * 1000);


let ultimoLogPausaFila = 0;

setInterval(() => {
  if (!podeRodarAgora()) {
    const agora = Date.now();

    if (agora - ultimoLogPausaFila > 5 * 60 * 1000) {
      console.log("🌙 Fila pausada fora do horário configurado");
      ultimoLogPausaFila = agora;
    }

    return;
  }


setInterval(() => {
  processarFila();
}, 10 * 1000);

  processarFila();
}, 10 * 1000);