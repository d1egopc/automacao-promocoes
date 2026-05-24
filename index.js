
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

linksOptimus: {
  ativo: true,
  dominio: "https://automacao-promocoes-production.up.railway.app",
  formato: "/r",
  rastrearCliques: true
},

linksGerados: {},
  intervaloEnvioMinutos: 5,

  horarioInicio: "08:00",
  horarioFim: "23:00",

  pausarMadrugada: true,

  // ================= CUPONS GLOBAIS =======================

  cuponsAtivos: [
    {
      ativo: true,
      marketplace: "mercadolivre",
      cupom: "MELILIBERADO",
      categorias: ["ferramentas", "casa"],
      termos: ["lavadora", "lava jato", "pressao", "furadeira"],
      aviso: "Use o cupom MELILIBERADO + Pix para chegar neste valor."
    },
    {
      ativo: true,
      marketplace: "mercadolivre",
      cupom: "SUPERFASHION",
      categorias: ["tenis"],
      termos: ["tenis", "moda", "roupa", "mizuno", "nike"],
      aviso: "Use o cupom SUPERFASHION para chegar no melhor valor."
    }
  ],

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
  ativo: true,
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
  ativo: true,
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
let cuponsAtivos = config.cuponsAtivos || [];
let usuarios = [];

let planos = {};
let configsPorCliente = {};
let destinosPorCliente = {};

let sessoes = {};
let qrCodes = {};
let statusSessao = {};
let destinosPorSessao = {};
let gruposPorSessao = {};
let reconectando = {};
let integracoesPorCliente = {};
let sessoesMeta = {};

const FILA_FILE = "/data/fila.json";
const CONFIG_FILE = "/data/config.json";
const USUARIOS_FILE = "/data/usuarios.json";
const CONFIGS_CLIENTES_FILE = "/data/configs_clientes.json";
const DESTINOS_CLIENTES_FILE = "/data/destinos_clientes.json";
const PLANOS_FILE = "/data/planos.json";
const SESSOES_FILE = "/data/sessoes.json";
const INTEGRACOES_FILE = "/data/integracoes.json";

function getClienteDir(clienteId = "admin") {
  const id = String(clienteId || "admin").replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = `/data/clientes/${id}`;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}

function getFilaFile(clienteId = "admin") {
  return `${getClienteDir(clienteId)}/fila.json`;
}

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

function salvarFila(clienteId = "admin") {
  try {

    const filaCliente = fila.filter(
      o => String(o.clienteId || "admin") === String(clienteId)
    );

    fs.writeFileSync(
      getFilaFile(clienteId),
      JSON.stringify(filaCliente, null, 2)
    );

  } catch (e) {
    console.error("❌ ERRO AO SALVAR FILA:", e.message);
  }
}

function carregarFila(clienteId = "admin") {
  try {

    const file = getFilaFile(clienteId);

    if (fs.existsSync(file)) {

      const data = fs.readFileSync(file, "utf8");

      if (data) {

        const filaCliente = JSON.parse(data);

        fila = fila.filter(
          o => String(o.clienteId || "admin") !== String(clienteId)
        );

        fila.push(...filaCliente);

        console.log(
          `✅ Fila carregada do cliente: ${clienteId}`
        );
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

function salvarSessoesMeta() {
  fs.writeFileSync(
    SESSOES_FILE,
    JSON.stringify(sessoesMeta, null, 2)
  );
}

function salvarIntegracoesPersistidas() {
  fs.writeFileSync(
    INTEGRACOES_FILE,
    JSON.stringify(integracoesPorCliente, null, 2)
  );
}

// ================= FUNÇÃO SALVA USUARIO =================

function salvarUsuarios() {
  fs.writeFileSync(
    USUARIOS_FILE,
    JSON.stringify(usuarios, null, 2)
  );
}

// ================= CRÉDITOS =================

const CREDITOS_PLANO = {
  free: 300,
  starter: 2500,
  pro: 7500,
  enterprise: 9500
};

function obterUsuario(clienteId) {
  return usuarios.find(
    u => String(u.id) === String(clienteId)
  );
}

function renovarCreditosSeNecessario(usuario) {
  if (!usuario) return;

  const hoje = new Date();

  const mesAtual =
    `${hoje.getFullYear()}-${hoje.getMonth() + 1}`;

  if (usuario.mesCreditos === mesAtual) {
    return;
  }

  const plano =
    String(usuario.plano || "free").toLowerCase();

  usuario.creditos =
    CREDITOS_PLANO[plano] || 300;

  usuario.mesCreditos = mesAtual;

  salvarUsuarios();

  console.log("🔄 Créditos renovados:", {
    usuario: usuario.email,
    plano,
    creditos: usuario.creditos
  });
}

function usuarioTemCreditos(clienteId, quantidade = 1) {
  const usuario = obterUsuario(clienteId);

  if (!usuario) return false;

  renovarCreditosSeNecessario(usuario);

  return Number(usuario.creditos || 0) >= quantidade;
}

function debitarCreditos(clienteId, quantidade = 1) {
  const usuario = obterUsuario(clienteId);

  if (!usuario) return false;

  renovarCreditosSeNecessario(usuario);

  if (Number(usuario.creditos || 0) < quantidade) {
    return false;
  }

  usuario.creditos =
    Number(usuario.creditos || 0) - quantidade;

  salvarUsuarios();

  console.log("💳 Créditos debitados:", {
    usuario: usuario.email,
    restante: usuario.creditos,
    debitado: quantidade
  });

  return true;
}

// ================= FUNÇÃO SALVA PLANO ===================

function salvarPlanos() {
  fs.writeFileSync(
    PLANOS_FILE,
    JSON.stringify(planos, null, 2)
  );
}

// ============ FUNCAO SALVA CONFIG CLIENTES ==============

function salvarConfigsClientes() {
  fs.writeFileSync(
    CONFIGS_CLIENTES_FILE,
    JSON.stringify(configsPorCliente, null, 2)
  );
}

function salvarDestinosClientes() {
  fs.writeFileSync(
    DESTINOS_CLIENTES_FILE,
    JSON.stringify(destinosPorCliente, null, 2)
  );
}

// ================ FUNCAO CRIAR PLANO =====================

function criarPlanosPadrao() {
  if (Object.keys(planos || {}).length) return;

  planos = {

    free: {
      nome: "free",

      marketplaces: [
        "amazon",
        "shopee"
      ],

      limites: {
        sessoes: 1,
        destinos: 2,
        enviosDia: 50,
        creditos: 300
      },

      recursos: {
        buscaManual: true,
        farejadorAutomatico: false,

        whatsapp: true,
        telegram: false,

        multiSessao: false,

        linkOptimus: false,
        analytics: false,
        cupomInteligente: false
      },

      atualizadoEm: new Date().toISOString()
    },

    pro: {
      nome: "pro",

      marketplaces: [
        "amazon",
        "shopee",
        "mercadolivre",
        "aliexpress"
      ],

      limites: {
        sessoes: 3,
        destinos: 10,
        enviosDia: 500,
        creditos: 2500
      },

      recursos: {
        buscaManual: true,
        farejadorAutomatico: false,

        whatsapp: true,
        telegram: true,

        multiSessao: true,

        linkOptimus: true,
        analytics: true,
        cupomInteligente: true
      },

      atualizadoEm: new Date().toISOString()
    },

    premium: {
      nome: "premium",

      marketplaces: [
        "amazon",
        "shopee",
        "mercadolivre",
        "aliexpress",
        "awin",
        "magalu"
      ],

      limites: {
        sessoes: 10,
        destinos: 50,
        enviosDia: 5000,
        creditos: 9500
      },

      recursos: {
        buscaManual: true,
        farejadorAutomatico: true,

        whatsapp: true,
        telegram: true,

        multiSessao: true,

        linkOptimus: true,
        analytics: true,
        cupomInteligente: true,
        adminAvancado: true
      },

      atualizadoEm: new Date().toISOString()
    }
  };

  salvarPlanos();

  console.log("✅ Planos padrão criados");
}

// ================= FUNÇÃO CARREGA CONFIG =================

function carregarConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const dados = fs.readFileSync(CONFIG_FILE, "utf8");

      const configSalva = JSON.parse(dados);

      config = {
        ...config,
        ...configSalva,
        marketplaces: {
          ...config.marketplaces,
          ...(configSalva.marketplaces || {})
        }
      };

      console.log("✅ Config carregada");
    }

if (fs.existsSync(USUARIOS_FILE)) {
  usuarios = JSON.parse(
    fs.readFileSync(USUARIOS_FILE, "utf8")
  );

  console.log("✅ Usuários carregados");
}

if (fs.existsSync(INTEGRACOES_FILE)) {
  integracoesPorCliente = JSON.parse(
    fs.readFileSync(INTEGRACOES_FILE, "utf8")
  );

  console.log("✅ Integrações carregadas");
}

if (fs.existsSync(CONFIGS_CLIENTES_FILE)) {
  configsPorCliente = JSON.parse(
    fs.readFileSync(CONFIGS_CLIENTES_FILE, "utf8")
  );

  console.log("✅ Configs dos clientes carregadas");
}

if (fs.existsSync(DESTINOS_CLIENTES_FILE)) {
  destinosPorCliente = JSON.parse(
    fs.readFileSync(DESTINOS_CLIENTES_FILE, "utf8")
  );

  console.log("✅ Destinos dos clientes carregados");
}

if (fs.existsSync(PLANOS_FILE)) {
  planos = JSON.parse(
    fs.readFileSync(PLANOS_FILE, "utf8")
  );

  console.log("✅ Planos carregados");
}

   criarPlanosPadrao();


if (!usuarios.length) {
console.log("🧪 CRIANDO ADMIN PADRÃO");
  usuarios = [
 {
  id: "admin",
  nome: "Diego",
  email: "admin@optimus.local",
  senha: "123456",
  papel: "admin_master",
  plano: "master",
  creditos: 999999,
  ativo: true,
  criadoEm: new Date().toISOString()
}
  ];

  salvarUsuarios();

  console.log("👑 Usuário admin inicial criado");
}

  } catch (e) {
    console.error("❌ ERRO AO CARREGAR CONFIG:", e.message);
  }
}

// =========== LINK GLOBAL OPTIMUS ===========

function gerarLinkOptimus(linkOriginal = "", marketplace = "") {

  if (!linkOriginal) return "";

  if (!config?.linksOptimus?.ativo) {
    return linkOriginal;
  }

  config.linksGerados = config.linksGerados || {};

  const dominio =
    config.linksOptimus.dominio || "https://optimus-promo.com";

  const formato =
    config.linksOptimus.formato || "/r";

  const codigo = Math.random()
    .toString(36)
    .substring(2, 8);

  config.linksGerados[codigo] = {
  original: linkOriginal,
  urlOriginal: linkOriginal,
  marketplace,
  cliques: 0,
  ultimoClique: null,
  criadoEm: new Date().toISOString()
};

  salvarConfig();

  return `${dominio}${formato}/${codigo}`;
}

// ================= FILTROS OFERTA JA EXISTE =================

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

// ================= FILTROS UNIVERSAIS DE OFERTAS =================

function produtoSuspeito(oferta = {}) {
  const texto = normalizarTexto(`
    ${oferta.titulo || ""}
    ${oferta.nome || ""}
    ${oferta.descricao || ""}
    ${oferta.categoria || ""}
    ${oferta.marketplace || ""}
  `);

  const preco = Number(
    String(oferta.precoAtual || oferta.preco || "")
      .replace("R$", "")
      .replace(/\./g, "")
      .replace(",", ".")
      .trim()
  );

  const suspeitos = [
    "ssd externo 2026",
    "1tb 2tb 4tb",
    "alta velocidade original",
    "super capacidade",
    "expansao memoria",
    "cartao memoria 2tb",
    "pendrive 2tb",
    "disco rigido externo 4tb",
    "brand+",
    "sem marca",
    "generico",
    "unidade flash",
    "usb 3.0",
    "memoria expandida",
    "disco externo",
    "hd externo portatil",
    "armazenamento externo",
    "ssd externo",
    "expansao de memoria",
    "cartao tf",
    "micro sd 1tb",
   "micro sd 2tb",
   "pendrive usb",
   "flash drive",
   "super armazenamento",
   "armazenamento movel",                   
  ];

  if (suspeitos.some(p => texto.includes(normalizarTexto(p)))) {
    return true;
  }

  if (
    texto.includes("ssd") &&
    texto.includes("4tb") &&
    preco > 0 &&
    preco < 250
  ) {
    return true;
  }

  if (
    texto.includes("ssd") &&
    texto.includes("2tb") &&
    preco > 0 &&
    preco < 150
  ) {
    return true;
  }

  if (
    texto.includes("pendrive") &&
    texto.includes("2tb") &&
    preco > 0 &&
    preco < 100
  ) {
    return true;
  }

if (
  texto.includes("ssd") &&
  texto.includes("1tb") &&
  preco > 0 &&
  preco < 80
) {
  return true;
}

if (
  texto.includes("hd") &&
  texto.includes("16tb") &&
  preco > 0 &&
  preco < 400
) {
  return true;
}

if (
  texto.includes("hd") &&
  texto.includes("18tb") &&
  preco > 0 &&
  preco < 500
) {
  return true;
}

if (
  texto.includes("placa de video") &&
  preco > 0 &&
  preco < 250
) {
  return true;
}

return false;
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

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));

const horarioInicio = 9;
const horarioFim = 23;


// ================= FUNÇÃO RODAR AGORA =================

function podeRodarAgora() {
  return true;
}

let ultimoEnvioFila = 0;

// =================== BUSCAS GLOBAIS ===================

const BUSCAS_GLOBAIS = {
 pesca: [
  "vara de pesca oferta", "vara telescópica", "vara de carretilha",
  "molinete pesca promocao", "carretilha de pesca", "anzol",
  "iscas artificiais pesca", "linha de pesca", "caixa pesca organizadora",
  "mochila de pesca", "fogareiro", "fogao portatil", "chaira",
  "tenis nautico", "bota de pescador", "rede de dormir", "caixa termica",
  "barraca", "linha multifilamento", "linha fluorcarbono", "linha de pesca",
  "kit de pesca", "marine sports", "abu garcia", "lori fishing", "venza",
  "daiwa", "shimano", "nelson nakamura", "vexter", "brava", "mochila de pesca",
  "jogá", "joga", "mochila joga", "mochila de pesca com suporte", "faca de pesca"
],

  beleza: [
    "perfume masculino promocao", "kit malbec","promocao boticario",
    "perfume feminino promocao",  "kit natura","promocao natura",
    "shampoo promocao",  "kit perfume","kit locao", "kit shampoo",
    "desodorante promocao", "kit creme", "promocao de creme",
    "hidratante promocao", "kit hidratante", "sabonete", "eudora",
    "maquiagem", "esmalt", "glos labial", "baton", "pulseira" 
  ], 
 
  hardware: [
    "nvme 1tb m2", "nvme", "ssd 500 gb", "ssd kingston",
    "ssd 1tb promocao", "ssd 1tb kootion", "hd exos",
    "mouse gamer oferta", "attack shark", "redragom",
    "teclado mecanico oferta", "monitor curvo",
    "placa de video promocao", "monitor gamer",
    "headset gamer oferta", "monitor gamer oferta",
    "netac", "m2 movespeed", "movespeed", "sandisk",
    "fonte gamer", "fonte gamer promocao", "corsair", 
    "knup", "revengers", "master cool", "deep cool",
    "air cooler gamer", "water cooler", "water gamer",
    "teclado magnetico", "mini teclado", "rise mode",
    "headset promocao", "headset barato", "mouse sem fio",
    "headset rise", "headset havit", "headset headset binnune",
    "tgt", "corsair", "montech", "gabinte gamer", "binnune", 
    "nvidia", "amd", "ryzen", "intel", "redragon", "rise"  
  ],

  tenis: [
    "tenis masculino oferta", "tenis masculino adidas", "tenis masculino fila",
    "tenis feminino promocao", "tenis feminino adidas", "tenis feminino fila",
    "mizuno promocao", "fila promocao", "adidas promocao", "mizuno promocao",
    "nike promocao", "olympicus promocao", "puma promocao", "asics promocao", "fila",
    "new balance promocao", "chinelo promocao", "kappa promocao", "reebok promocao",
    "chinelo nike", "chinelo promocao", "chinelo rider", "sandalha", "rasteirinha",
    "chinelo cropped masculino", "chinelo cropped feminino", "chinelo havaianas",
    "nike", "olympicus", "mizuno", "kappa", "new balance", "havaianas", "asics"   
  ],

  casa: [
    "air fryer promocao", "condicionador de ar", "ar split",
    "liquidificador promocao", "ar condicionado", "espelho",
    "cafeteira promocao", "torneira automatica", "torneira",
    "ventilador promocao", "torneira de pia gourmet",
    "cadeira escritorio", "torneira de banheiro", "luminaria",
    "refletor externo", "refletor", "varal de chão",  "varal",
    "varal de parede", "varal versatil", "lixeira",  "campainha",
    "abajur", "fechadura eletrônica", "lustre",  "campainha sem fio"
  ],

  automotivo: [
  "central multimidia", "som automotivo", "pneu promocao",
  "oleo motor", "kit xenon", "lampada led automotiva",
  "camera de re", "multimidia android", "tapete automotivo",
  "carregador veicular", "compressor automotivo", "macaco hidraulico",
  "pelicula automotiva", "alarme automotivo", "sensor de estacionamento",
  "calota", "volante esportivo", "retrovisor automotivo",
  "caixa trio automotiva", "subwoofer", "corneta automotiva",
  "modulo taramps", "stetsom", "pioneer", "jbl selenium"
],

eletrodomesticos: [
  "geladeira promocao", "maquina de lavar", "microondas",
  "fogao promocao", "cooktop", "forno eletrico", "ar split",
  "lava e seca", "aspirador de po", "robo aspirador",
  "air fryer", "frigobar", "purificador de agua",
  "bebedouro", "freezer horizontal", "coifa cozinha",
  "depurador", "centrifuga roupa", "maquina lava louca"
],

eletroportateis: [
  "escova secadora", "secador de cabelo", "chapinha", "multi cook philco",
  "barbeador eletrico", "maquina cortar cabelo", "massageador eletrico", 
  "cafeteira", "liquidificador", "batedeira", "multi cook", "grill",
  "espremedor", "panela eletrica", "grill eletrico", "sanduicheira",
  "fritadeira eletrica", "vaporizador", "passadeira vapor",
  "aspirador portatil", "multi cook philco antiaderente" 
],

limpeza: [
  "sabao liquido", "amaciante promocao", "desinfetante",
  "detergente", "papel higienico", "kit limpeza",
  "mop giratorio", "rodo magico", "vassoura eletrica",
  "limpa piso", "alcool limpeza", "esponja limpeza",
  "lava roupas", "produto limpeza pesada", "kit lavanderia",
  "amo 4 kg", "omo", "ype", "tira mancha venesh", "venesh",
  "limpador multiuso", "veja", "downy", "cif multiuso",
  "brilhante", "downy amaciante ", "dwayne ", "bom ar"
],  

notebooksPc: [
  "notebook gamer", "notebook promocao", "pc gamer",
  "gabinete gamer", "cadeira gamer", "mesa gamer",
  "monitor gamer", "notebook lenovo", "notebook dell",
  "notebook samsung", "macbook", "mini pc",
  "all in one", "chromebook", "kit upgrade pc"
],

perifericos: [
  "mouse gamer", "mouse sem fio", "teclado mecanico",
  "headset gamer", "webcam", "microfone gamer",
  "mousepad gamer", "controle gamer", "adaptador usb",
  "hub usb", "fonte notebook", "cooler notebook",
  "cadeira gamer", "suporte notebook", "mesa digitalizadora"
],

mercearia: [
  "cafe promocao", "capsula dolce gusto", "whey protein",
  "creatina", "barra proteina", "suplemento", "olho de coco",
  "arroz promocao", "feijao promocao", "azeite", "sal marinho",
  "kit churrasco", "kit cozinha", "temperos", "sal integral",
  "chocolate promocao", "biscoito promocao", "snack fit"
],

modaFeminina: [
  "vestido feminino", "cropped",
  "conjunto feminino", "legging feminina",
  "calca feminina", "short feminino",
  "blusa feminina", "baby doll",
  "pijama feminino", "lingerie",
  "sutia", "calcinha",
  "moda evangelica feminina",
  "bolsa feminina", "sandalia feminina",
  "salto feminino", "tenis feminino",
  "jaqueta feminina", "moletom feminino",
  "roupa fitness feminina",
  "saia feminina", "biquini",
  "maio feminino", "camiseta feminina",
  "plus size feminina"
],

modaMasculina: [
  "camiseta masculina", "camisa polo",
  "bermuda masculina", "calca jeans masculina",
  "cueca", "carteira masculina",
  "tenis masculino", "chinelo masculino",
  "moletom masculino", "jaqueta masculina",
  "camisa social masculina",
  "roupa fitness masculina",
  "regata masculina",
  "short masculino",
  "bone masculino",
  "relogio masculino",
  "perfume masculino",
  "roupa evangelica masculina",
  "camisa time futebol",
  "roupa termica masculina"
],

perfumariaBeleza: [
  "perfume importado", "perfume promocao", "perfume masculino",
  "perfume feminino", "azzaro", "ferrari black",
  "eternity", "212", "armani", "hugo boss",
  "lattafa", "asad", "malbec", "natura",
  "eudora", "boticario", "kaiak",
  "essencial", "club 6", "zaad",
  "coffee woman", "quasar", "perfume arabe",
  "pomada para dor", "gel para dor muscular",
  "gelo reutilizavel", "protetor solar",
  "creme dental", "pasta de dente",
  "listerine", "enxaguante bucal",
  "fio dental", "lenco umedecido",
  "hipoglos", "vick vaporub",
  "pastilha garganta", "doralgina",
  "omeprazol", "pantoprazol",
  "vitamina c", "colageno",
  "creatina", "whey protein",
  "termogenico", "multivitaminico",
  "melzinho", "massageador corporal"
],

bebes: [
  "fralda promocao", "kit bebe",
  "mamadeira", "fralda pampers",
  "fralda huggies", "carrinho bebe",
  "berco", "banheira bebe",
  "kit fralda pampers", "roupa bebe",
  "cadeira alimentacao", "fralda",
  "chupeta", "brinquedo educativo",
  "pomada assadura", "pomada pra assadura",
  "tapete de bebe", "brinquedo infantil",
  "shampoo de bebe", "lenco umedecido",
  "kit maternidade", "saida maternidade",
  "babador", "berco portatil",
  "cadeirinha bebe", "andador bebe",
  "banho bebe", "nan", "aptamil"
],

petshop: [
  "racao cachorro", "racao gato", "areia gato",
  "brinquedo pet", "coleira cachorro",
  "tapete higienico", "casinha cachorro",
  "arranhador gato", "petisco cachorro"
],

esporte: [
  // ACADEMIA
  "halter", "kit halter",
  "barra musculacao", "anilha",
  "luva academia", "cinto musculacao",
  "corda pular", "colchonete yoga",
  "tapete yoga", "faixa elastica",
  "mini band", "garrafinha academia",
  "squeeze termica", "bolsa academia",
  "equipamento academia",
  "bicicleta ergometrica",
  "esteira eletrica",
  "smartwatch esportivo",

  // SUPLEMENTOS
  "whey protein", "creatina",
  "pre treino", "bcaa",
  "albumina", "hipercalorico",
  "termogenico", "multivitaminico",
  "colageno", "glutamina",
  "coqueteleira", "suplemento",

  // ESPORTES
  "camisa futebol",
  "bola futebol",
  "chuteira",
  "joelheira",
  "cotoveleira",
  "kimono",
  "bicicleta promocao",
  "patins",
  "skate",
  "raquete beach tennis"
],


brinquedos: [
  "lego promocao", "boneca infantil", "caminhao de controle",
  "carrinho controle remoto", "hot wheels", "lancha de controle",
  "piscina infantil", "patinete", "trator de controle remoto", 
  "bola de futebol", "skate infantil", "brinquedo educativo",
  "losa magica", "motoca", "kit de carrinho", "brinquedo educativo",
  "boneca", "boneco", "pistola de agua", "caminhao de terra",
  "batman", "homem aranha", "hulk", "robo", "homem de ferro" 
],


 ferramentas: [
    "furadeira oferta", "kit ferramentas", "parafusadeira de impacto",
    "parafusadeira promocao", "chave de impacato", "lixadeira",
    "kit ferramentas promocao", "moto serra portatil", "bomba de veneno",
    "macaco jacaré", "macaco hidraulico", "extitor automotivo", "chave philips",
    "kit parafusadeira", "extintor de incendio veicular", "chave de fenda",
    "jogo de chave combinada", "kit chave de fenda", "kit chave philips",
    "combo chave de impacto", "compressor de ar", "chave inglesa"    
  ], 

  celulares: [
    "smartphone promocao", "smartphone promocao relâmpago",
    "iphone oferta", "smartphone barato", "smartphone cupom",
    "samsung galaxy promocao", "smartphone xiaomi", "nokia",
    "xiaomi promocao", "smartphone pocophone", "smartphone galax",
     "xiaomi", "samsumg", "lg", "xiaomi", "caterpillar", "sony"
  ],

  audioTv: [
    "smart tv promocao",
    "tv 43 promocao", "tv monitor", "suporte para tv",
    "tv 55 promocao", "tv oled 144hz", "home theater",
    "tv 65 oferta", "conversor digital", "tv stick wi-fi",
    "tv 75 oferta", "box ip tv", "tv stick adroid", 
    "caixa de som bluetooth", "caixa de som jbl", "cabo hdmi",
    "caixa de som aiwa", "soundbar promocao", "samsung",
    "lg", "philco", "philips", "tcl", "roku","panassonic"
  ]
};

function gerarBuscasGlobais(limite = 30) {
  return Object.values(BUSCAS_GLOBAIS)
    .flat()
    .sort(() => Math.random() - 0.5)
    .slice(0, limite);
}

// =================== NÚCLEO GLOBAL DE OFERTAS ===================

function normalizarTexto(valor = "") {
  return String(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function detectarCategoriaGlobal(oferta = {}) {
  const texto = normalizarTexto(
    `${oferta.titulo || oferta.nome || ""} ${oferta.categoria || ""}`
  );

  for (const [categoria, buscas] of Object.entries(BUSCAS_GLOBAIS || {})) {
    const bate = buscas.some(termo => {
      const termoLimpo = normalizarTexto(termo)
        .replace("promocao", "")
        .replace("oferta", "")
        .trim();

      return termoLimpo && texto.includes(termoLimpo.split(" ")[0]);
    });

    if (bate) return categoria;
  }

  return oferta.categoria || "geral";
}

//================= FUNCAO REGISTRA CUPOM =======================

function registrarCupomAtivo(regra = {}) {

if (cupomEstaBloqueado(regra.marketplace, regra.cupom)) {
  console.log("🚫 Cupom ignorado por status expirado:", regra.cupom);
  return false;
}
  
if (
    !regra?.cupom ||
    !limparCuponsInvalidos([regra.cupom]).length
  ) {
    console.log("🚫 Cupom bloqueado:", regra?.cupom);
    return false;
  }

  config.cuponsAtivos = config.cuponsAtivos || [];
  
  config.cuponsAtivos = config.cuponsAtivos.filter(c =>
  limparCuponsInvalidos([c?.cupom]).length
  );

  const cupom = String(regra.cupom).trim().toUpperCase();
  const marketplace = normalizarTexto(regra.marketplace || "");

  const jaExiste = config.cuponsAtivos.some(c =>
    String(c.cupom || "").trim().toUpperCase() === cupom &&
    normalizarTexto(c.marketplace || "") === marketplace
  );

  if (jaExiste) return false;

  config.cuponsAtivos.push({
    ativo: true,
    marketplace,
    cupom,
    categorias: regra.categorias || [],
    termos: regra.termos || [],
    ultimaDeteccao: new Date().toISOString(),
    aviso:
      regra.aviso ||
      `Use o cupom ${cupom} para tentar chegar no melhor valor.`,
    origem: regra.origem || "farejador",
    criadoEm: new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo"
    })
  });

  salvarConfig();

  console.log("🎟️ Novo cupom ativo registrado:", cupom, marketplace);

  return true;
}

//================= FUNCAO APLICA CUPOM AUTO ====================

function aplicarCupomAutomatico(oferta = {}) {
  if (!oferta) return oferta;

  if (oferta.cupom && String(oferta.cupom).trim()) {
    return oferta;
  }

  const cupons = config.cuponsAtivos || [];
  if (!Array.isArray(cupons) || !cupons.length) return oferta;

  const titulo = normalizarTexto(oferta.titulo || oferta.nome || "");
  const marketplace = normalizarTexto(oferta.marketplace || "");
  const categoria = normalizarTexto(oferta.categoria || "");

  for (const regra of cupons) {
    if (!regra || regra.ativo === false) continue;

    const regraMarketplace = normalizarTexto(regra.marketplace || "");

    if (regraMarketplace && regraMarketplace !== marketplace) {
      continue;
    }

    const termos = regra.termos || regra.palavras || [];
    const categorias = regra.categorias || [];

    const bateCategoria =
      !categorias.length ||
      categorias.some(c => categoria.includes(normalizarTexto(c)));

    const bateTermo =
      !termos.length ||
      termos.some(t => titulo.includes(normalizarTexto(t)));

    if (bateCategoria && bateTermo && regra.cupom) {
      oferta.cupom = String(regra.cupom).trim();
      oferta.avisoCupom =
        regra.aviso ||
        `Use o cupom ${oferta.cupom} para chegar no melhor valor.`;

      oferta.cupomAutomatico = true;

      console.log("🎟️ Cupom automático aplicado:", oferta.cupom, "-", oferta.titulo || oferta.nome);
      break;
    }
  }

  return oferta;
}


// ====================== FUNCAO PREPARA OFERTA GLOBAL =========================

function prepararOfertaGlobal(oferta = {}) {
  if (!oferta) return oferta;

  oferta.titulo = oferta.titulo || oferta.nome || "Oferta";
  oferta.nome = oferta.nome || oferta.titulo;

  oferta.marketplace = normalizarTexto(oferta.marketplace || "geral");

  if (
    !oferta.categoria ||
    ["aliexpress", "amazon", "shopee", "mercadolivre", "magalu", "awin"].includes(
      normalizarTexto(oferta.categoria)
    )
  ) {
    oferta.categoria = detectarCategoriaGlobal(oferta);
  }

  const agoraBR = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

  oferta.criadoEm = oferta.criadoEm || agoraBR;
  oferta.dataEntradaFila = oferta.dataEntradaFila || agoraBR;

  oferta.status = oferta.status || "pendente";
  oferta.statusDetalhe = oferta.statusDetalhe || "Aguardando envio";
  oferta.destinosEnviados = oferta.destinosEnviados || [];
  oferta.logsEnvio = oferta.logsEnvio || [];
  oferta.erro = oferta.erro || "";
  oferta.erroEm = oferta.erroEm || "";
  oferta.dataEntradaFila = oferta.dataEntradaFila || agoraBR;

  oferta = aplicarCupomAutomatico(oferta);

  return oferta;
}

// ================= CATEGORIAS GLOBAIS =================

const CATEGORIAS_GLOBAIS = {
  
 pesca: {
    nome: "Pesca e Pescaria",
    palavras: [
      "vara de pesca", "molinete", "carretilha", "anzol", "mochila de molinete",
      "isca artificial", "chumbada", "camisa pesca", "lanterna", "bolsa de pesca",
      "linha de multifilamento", "camiseta uv", "camisa pesca", "lanterna",
      "oculos polarisado", "oculos de pesca", "canivete", "daiwa", "nelson nakamura",
      "caixa organizadora de isca", "box de anzol", "iscas de pesca", "divisórias pesca",
      "jennerlure", "jogá", "nautika", "monster 3x", "lixxada", "camping", "bravinha", 
      "jennerlure", "luri", "caixa de isca", "caixa pesca", "divisórias pesca", "camping",   
      "divisorias pesca","farolete de pesca", "lampião pesca", "barraca", "rede de dormir"    
    ]
  },

  beleza: {
    nome: "Perfumaria, Farmácia e Beleza",
    palavras: [
      "perfume", "shampoo", "condicionador", "hidratante",
      "desodorante", "sabonete", "protetor solar", "creme dental",
      "carolona herrera", "ferrari", "sundown", "neutrogena", "clean",
      "boticário", "azzaro", "armani", "natura", "clean", "malbec", "fralda"
    ]
  },

  hardware: {
    nome: "Gamer e Hardware",
    palavras: [
      "ssd", "nvme", "placa de video", "placa de vídeo", "fonte",
      "memoria ram", "memória ram", "fonte gamer", "gabinete gamer",
      "headset gamer", "teclado mecanico", "mouse gamer","jieshuo",
      "amd", "nvidia", "pny", "jieshuo", "veineda", "kllisre",
      "kingston", "seagate", "samsung", "western digital", "veineda",
      "arsrock", "asus", "netac", "kootion", "neologic", "risemod",
      "tgt", "redragon", "giabyte", "hp", "intel", "hyperx",
      "jbl", "lenovo"
    ]
  },

  tenis: {
    nome: "Tênis e Chinelos",
    palavras: [
      "tenis", "tênis", "chinelo", "sandalia", "sandália",
      "havaianas", "papete", "salto alto", "loafer", "puma",
      "rider", "reebok", "under armor", "new balance", "adidas",
      "mocassin", "mizuno", "asics", "nike", "olympikus", "penalty"   
    ]
  },

alimentos: {
  nome: "Alimentos e Mercearia",
  palavras: [
    "chocolate", "cafe", "café", "capsula de cafe", "cápsula de café",
    "arroz", "feijao", "feijão", "biscoito", "bolacha",
    "bombom", "salgadinho", "temperos", "salame", "cereal"
  ]
},

audioTv: {
  nome: "Audio TV",
  palavras: [
    "tv 65pl", "tv 55pl", "tv 75ol", "lg", "tcl", "philips",
    "tv", "smart tv", "televisor", "televisao", "televisão",
    "caixa de som", "soundbar", "jbl", "boombox",
    "radio", "rádio", "conversor digital", "iptv", "jbl" 
  ]
},

eletroportateis: {
  nome: "Eletroportáteis",
  palavras: [
    "air fryer", "fritadeira eletrica", "fritadeira elétrica",
    "liquidificador", "cafeteira", "batedeira", "mixer",
    "sanduicheira", "grill", "aspirador", "panela eletrica",
    "panela elétrica", "processador de alimentos"
  ]
},
  
automotivo: {
  nome: "Automotivo",
  palavras: [
    "multimidia", "som automotivo", "camera de re", "câmera de ré",
    "farol", "lampada automotiva", "lâmpada automotiva",
    "taramps", "pioneer", "aiwa", "hbuster", "retrovisor"
  ]
},

bebidas: {
  nome: "Bebidas",
  palavras: [
    "heineken", "cerveja", "whisky", "vodka",
    "energetico", "energético", "gatorade",
    "red label", "old par", "chopp","cerveja heineken",
    "amstel", "heineken barril 5 litros", "colorado",
    "coca cola", "tnt", "monster", "ipa", "burn"
  ]
},

computadores: {
  nome: "Computadores e Notebook",
  palavras: [
    "notebook", "laptop", "pc gamer", "computador",
    "all in one", "desktop", "macbook",
    "ipad", "tablet", "monitor"
  ]
},

brinquedos: {
  nome: "Brinquedos e Artigos Infantis",
  palavras: [
    "lego", "carrinho", "helicoptero", "helicóptero",
    "controle remoto", "boneca", "quebra cabeca",
    "quebra cabeça", "domino", "dominó", "trator brinquedo"
  ]
},

casaDecoracao: {
  nome: "Casa, Móveis e Decoração",
  palavras: [
    "sofa", "sofá", "mesa", "cadeira", "guarda roupa",
    "armario", "armário", "espelho", "torneira",
    "painel tv", "penteadeira", "cômoda"
  ]
},


celulares: {
  nome: "Celulares e Smartphones",
  palavras: [
    "iphone", "samsung galaxy", "xiaomi", "motorola",
    "redmi", "poco x", "realme", "smartphone",
    "celular", "iphone 13", "iphone 14", "iphone 15",
    "galaxy s23", "galaxy s24", "moto g", "infinix"
  ]
},

ferramentas: {
  nome: "Ferramentas",
  palavras: [
    "furadeira", "parafusadeira", "martelete",
    "chave de impacto", "serra marmore", "serra mármore",
    "makita", "dewalt", "bosch", "vonder",
    "jogo de ferramentas", "maleta de ferramentas",
    "manifold suryha", "manifold agetherm", "manifold elitech",
    "manifold Digital suryha", "manifold agetherm",
    "balanca nao programavel", "manifold digital",
    "FINYQBET conjunto de manômetro", "bomba de vacuo",
    "alicate amperimetro", "capacimetro", "alicate",
    "jogo mangueira manifold premium", "compressor de ar"
  ]
},

limpeza: {
  nome: "Limpeza",
  palavras: [
    "amaciante", "sabao em po", "sabão em pó",
    "desinfetante", "detergente", "papel higienico",
    "papel higiênico", "limpeza pesada",
    "multiuso", "veja", "omo", "ypê",
    "candida", "água sanitaria", "agua sanitaria"
  ]
},

eletronicos: {
  nome: "Eletrônicos",
  palavras: [
    "smartwatch", "fone bluetooth", "caixa bluetooth",
    "ring light", "drone", "camera wifi",
    "camera ip", "webcam", "projetor",
    "mini projetor", "echo dot", "alexa"
  ]
},

perifericos: {
  nome: "Periféricos",
  palavras: [
    "mouse", "teclado", "mousepad", "Headset gamer",
    "webcam gamer", "headphone", "fone gamer",
    "controle pc", "adaptador usb", "Headset",
    "hub usb", "microfone gamer", "teclado magnetico",
    "cadeira gamer", "monitor gamer"
  ]
},

eletrodomesticos: {
  nome: "Eletrodomésticos",
  palavras: [
    "geladeira", "freezer", "microondas", "micro-ondas",
    "fogao", "fogão", "lava e seca", "ar condicionado",
    "micro-ondas", "lava loucas", "lava louças", "secadora",
    "elgin", "lg", "philco", "hisense", "electrolux",
    "consul", "brastemp", "hd", "gree", "tcl", "agratto",
  ]
},

infantil: {
  nome: "Roupas e Calçados Infantil",
  palavras: [
    "tenis infantil", "tênis infantil", "camisa infantil",
    "sandalia infantil", "sandalia infantil",
    "roupa infantil", "moda infantil", "bebe",
    "bebê", "body infantil"
  ]
},

petshop: {
  nome: "Pet Shop e Fazendinha",
  palavras: [
    "racao", "ração", "coleira", "comedouro",
    "bebedouro", "aquario", "aquário",
    "areia gato", "ração cachorro", "ração gato"
  ]
},

esporte: {
  nome: "Esporte e Suplementos",
  palavras: [
    "creatina", "whey", "suplemento",
    "academia", "camisa time", "roupa academia",
    "beta alanina", "pré treino", "pre treino"
  ]
},

games: {
  nome: "Games e Console",
  palavras: [
    "xbox", "playstation", "ps5", "ps4",
    "nintendo switch", "controle xbox",
    "joystick", "game stick", "fliperama"
  ]
},

 modaMasculina: {
    nome: "Roupas e Moda Masculina",
    palavras: [
      "camiseta masculina", "cueca", "kit cuecas", "bermuda",
      "calca masculina", "calça masculina", "moletom masculino",
      "carteira masculina", "cinto masculino", "jaqueta"
    ]
  },

  modaFeminina: {
    nome: "Roupas e Moda Feminina",
    palavras: [
      "blusinha", "lingerie", "calcinha", "biquini", "saia",
      "vestido", "sandalia feminina", "shorts feminino", 
      "shorts feminino", "kit calca feminina", "shorts feminino",
      "calça jeans feminina", "shortes jeans feminino", "colar"
    ]
  }
};

function classificarCategoriaOferta(oferta = {}, termo = "") {
  const texto = normalizarTexto(`
    ${termo}
    ${oferta.titulo || ""}
    ${oferta.nome || ""}
    ${oferta.descricao || ""}
    ${oferta.categoria || ""}
  `);

  for (const categoria of Object.values(CATEGORIAS_GLOBAIS)) {
    const bateu = categoria.palavras.some(palavra =>
      texto.includes(normalizarTexto(palavra))
    );

    if (bateu) {
      return categoria.nome;
    }
  }

  return "Alimentos e Mercearia";
}

// ================= HELPERS DESTINOS INTELIGENTES =================

function normalizarTexto(valor = "") {
  return String(valor || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "e")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// ================= HELPERS DESTINOS INTELIGENTES =================

function normalizarDestino(valor = "") {
  return String(valor || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "e")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function destinoAceitaOferta(destino, oferta) {
  if (!destino?.ativo) return false;

console.log("🎯 DESTINO CHECK:", {
  destino: destino.nome,
  categoriasDestino: destino.categorias,
  categoriaOferta: oferta.categoria,
  titulo: oferta.titulo || oferta.nome
   });

  const marketplaceOferta = normalizarDestino(oferta.marketplace || oferta.loja || "");

  const categoriaClassificada = classificarCategoriaOferta(oferta, oferta.termo || "");
  const categoriaOferta = normalizarDestino(categoriaClassificada);

  const marketplacesDestino = (destino.marketplaces || []).map(normalizarDestino);
  const categoriasDestino = (destino.categorias || []).map(normalizarDestino);


  if (
    marketplacesDestino.length &&
    marketplaceOferta &&
    !marketplacesDestino.includes(marketplaceOferta)
  ) {
    return false;
  }

if (categoriasDestino.length && categoriaOferta) {
  const categoriaOk =
    categoriasDestino.includes(categoriaOferta) ||
    categoriasDestino.includes("geral");

  if (!categoriaOk) {
    return false;
  }
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

async function enviarParaDestinoInteligente(destino, oferta, mensagem, clienteId, configCliente) {
  try {
    clienteId = clienteId || oferta.clienteId || "admin";
    configCliente = configCliente || configsPorCliente?.[clienteId] || config;

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
        
      if (!usuarioTemCreditos(clienteId, 1)) {
      console.log("🚫 Sem créditos:", clienteId);
      continue;
      }

      debitarCreditos(clienteId, 1);            

        if (destino.tipoMidia === "texto" || !oferta.imagem) {
          await sock.sendMessage(grupo, { text: mensagem });
        } else {
          await sock.sendMessage(grupo, {
            image: {
              url: corrigirImagemUrl(oferta.imagem) || oferta.imagem
            },
            caption: mensagem
          });
        }

        console.log("✅ Enviado WhatsApp:", {
          clienteId,
          destino: destino.nome,
          grupo
        });

        oferta.destinosEnviados = oferta.destinosEnviados || [];
        oferta.destinosEnviados.push({
          clienteId,
          nome: destino.nome || "Destino",
          tipo: "whatsapp",
          grupo,
          creditos: 1,
          dataEnvio: new Date().toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo"
          })
        });

        await new Promise(r => setTimeout(r, 3000));
      }
    }

    // ================= ENVIO TELEGRAM =================

    if (String(destino.tipo || "").toLowerCase() === "telegram") {
      const telegrams = configCliente.telegram?.destinos || [];

      const selecionados = telegrams.filter(t =>
        (destino.telegramDestinos || []).includes(t.nome) ||
        (destino.telegramDestinos || []).includes(String(t.chatId))
      );

      if (!selecionados.length) {
        console.log("⚠️ Nenhum Telegram selecionado para este destino:", destino.nome);
      }

      for (const tel of selecionados) {
       
      if (!usuarioTemCreditos(clienteId, 1)) {
      console.log("🚫 Sem créditos:", clienteId);
      continue;
      }

      debitarCreditos(clienteId, 1); 
            
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

        console.log("✅ Enviado Telegram:", {
          clienteId,
          destino: destino.nome,
          chatId: tel.chatId
        });

        oferta.destinosEnviados = oferta.destinosEnviados || [];
        oferta.destinosEnviados.push({
          clienteId,
          nome: destino.nome || "Destino",
          tipo: "telegram",
          chatId: tel.chatId,
          creditos: 1,
          dataEnvio: new Date().toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo"
          })
        });

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


// ================= FUNCÃO PROCESSA FILA =================

async function processarFila() {
  if (enviandoAgora) return;
  enviandoAgora = true;

  try {
    const oferta = fila.find(o => {
  if (o.status !== "pendente") return false;

  const clienteIdOferta = o.clienteId || "admin";
  const configClienteOferta =
    configsPorCliente?.[clienteIdOferta] || config;

  return configClienteOferta.automacaoAtiva === true;
});

if (!oferta) {
  console.log("📭 Nenhuma oferta pendente");
  return;
}

const clienteId = oferta.clienteId || "admin";

const configCliente =
  configsPorCliente?.[clienteId] || config;

const clienteAtivo =
  configCliente.automacaoAtiva === true;

if (!clienteAtivo) {
  console.log("⏸ Automação desligada para cliente:", clienteId);
  return;
}

    if (!podeRodarAgora()) {
      return;
    }

    const agora = Date.now();

       const intervaloMs =
      (configCliente.intervaloMinutos || config.intervaloMinutos || 2) *
      60 *
      1000;

    if (!controleEnvio[clienteId]) {
      controleEnvio[clienteId] = 0;
    }

    if (agora - controleEnvio[clienteId] < intervaloMs) {
      return;
    }

    let idSessao =
      oferta.sessaoId ||
      oferta.idSessao ||
      oferta.id ||
      Object.keys(destinosPorSessao || {}).find(id =>
        destinosPorSessao[id]?.length &&
        statusSessao[id] === "open"
      ) ||
      Object.keys(sessoes || {})[0];

    if (!destinosPorSessao?.[idSessao]?.length) {
      const sessaoComDestino = Object.keys(destinosPorSessao || {})
        .find(id =>
          destinosPorSessao[id]?.length &&
          statusSessao[id] === "open"
        );

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
    console.log("👤 Cliente dono da oferta:", clienteId);

    const destinosBrutos =
      oferta.destinos?.length
        ? oferta.destinos
        : oferta.grupos?.length
          ? oferta.grupos
          : destinosPorSessao?.[idSessao]?.length
            ? destinosPorSessao[idSessao]
            : configCliente?.destinosPorSessao?.[idSessao]?.length
              ? configCliente.destinosPorSessao[idSessao]
              : oferta.destino
                ? [oferta.destino]
                : oferta.grupoDestino
                  ? [oferta.grupoDestino]
                  : configCliente?.destinos?.length
                    ? configCliente.destinos
                    : [];

    const destinos = destinosBrutos
      .map(d => d?.id || d?.value || d?.jid || d)
      .filter(Boolean);

    console.log("DESTINOS PARA ENVIO:", destinos);

// ================= DESTINOS INTELIGENTES =================

const destinosCliente =
  destinosPorCliente?.[clienteId] ||
  configCliente?.destinosInteligentes ||
  [];

const todosDestinos = Array.isArray(destinosCliente)
  ? destinosCliente.filter(d => d?.ativo !== false)
  : [];

console.log("🧪 DESTINOS RESUMO:", todosDestinos.map(d => ({
  nome: d.nome,
  tipo: d.tipo,
  ativo: d.ativo,
  conexaoId: d.conexaoId,
  grupos: d.gruposWhatsapp?.length || 0,
  telegram: d.telegramDestinos?.length || 0,
  marketplaces: d.marketplaces,
  categorias: d.categorias?.length || 0
})));

console.log("🧪 OFERTA PARA ROTEAR:", {
  titulo: oferta.titulo || oferta.nome,
  marketplace: oferta.marketplace,
  loja: oferta.loja,
  categoria: oferta.categoria,
  status: oferta.status
});

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

if (!categoriaPermitidaNoDestino(oferta, destino)) {
  console.log("⏭️ Categoria bloqueada para destino:", {
    destino: destino.nome,
    categoriaOferta: oferta.categoria
  });

  continue;
}
  await enviarParaDestinoInteligente(
  destino,
  oferta,
  mensagem,
  clienteId,
  configCliente
);
}

controleEnvio[clienteId] = Date.now();
ultimoEnvioFila = Date.now();

oferta.status = "enviado";

oferta.enviadoEm = new Date().toLocaleString("pt-BR", {
  timeZone: "America/Sao_Paulo"
});

oferta.dataEnvio = oferta.enviadoEm;
oferta.statusDetalhe = `Enviada para ${destinosInteligentes.length} destino(s)`;

oferta.logsEnvio = oferta.logsEnvio || [];
oferta.logsEnvio.push({
  tipo: "sucesso",
  mensagem: oferta.statusDetalhe,
  data: oferta.enviadoEm
});

salvarFila(clienteId);

console.log("✅ Enviado com controle de tempo");

 } catch (e) {
  console.log("❌ ERRO:", e.message);

  if (oferta) {
    oferta.status = "erro";
    oferta.erro = e.message;
    oferta.erroEm = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo"
    });
    oferta.statusDetalhe = `Erro no envio: ${e.message}`;

    oferta.logsEnvio = oferta.logsEnvio || [];
    oferta.logsEnvio.push({
      tipo: "erro",
      mensagem: oferta.statusDetalhe,
      data: oferta.erroEm
    });

    salvarFila(oferta.clienteId || "admin");
  }

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
app.use(cors({
  origin: true,
  credentials: true
}));

app.options("*", cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: "10mb" }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.path.startsWith("/conexoes") ||
    req.path.startsWith("/sessoes") ||
    req.path.startsWith("/conectar") ||
    req.path.startsWith("/desconectar") ||
    req.path.startsWith("/reset") ||
    req.path.startsWith("/limpar-sessao") ||
    req.path.startsWith("/login") ||
    req.path.startsWith("/config") ||
    req.path.startsWith("/status") ||
    req.path.startsWith("/qr") ||
    req.path.startsWith("/fila") ||
    req.path.startsWith("/automacao") ||
    req.path.startsWith("/destinos") ||
    req.path.startsWith("/grupos")
}));

// ============== POST FILA ENVIO =================

app.post("/fila", (req, res) => {
  const body = req.body || {};
  const clienteId = getClienteId(req);

  if (!clienteId) {
    return res.status(401).json({ erro: "Usuário não identificado" });
  }

  let oferta = {
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

    clienteId,
    status: "pendente",
    criadoEm: new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo"
    })
  };

  const html = JSON.stringify(body || "");

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

 oferta = prepararOfertaGlobal(oferta);

 fila.push(oferta);

 salvarFila(clienteId);

  console.log("📥 Oferta adicionada na fila:", {
    clienteId,
    titulo: oferta.titulo,
    marketplace: oferta.marketplace,
    categoria: oferta.categoria,
    cupom: oferta.cupom
  });

  res.json({
    ok: true,
    mensagem: "Oferta adicionada na fila",
    oferta
  });
});

// ================= ENVIO MANUAL =================

app.post("/enviar-manual", async (req, res) => {
  console.log("🧪 /enviar-manual BODY:", req.body);

  try {
    const body = req.body || {};

    const categoriaManual =
      body.categoria &&
      body.categoria !== body.marketplace
        ? body.categoria
        : body.categoriaProduto &&
          body.categoriaProduto !== body.marketplace
            ? body.categoriaProduto
            : "geral";

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
      categoria: categoriaManual,
      categoriaProduto: categoriaManual,
      origem: "manual",
      manual: true,
      clienteId: getClienteId(req),
      status: "pendente",
      criadoEm: new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo"
      })
    };

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
      mensagem: "Oferta enviada manualmente",
      oferta
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.get("/fila", (req, res) => {
  const clienteId = getClienteId(req);

  const itensCliente = fila.filter((o) =>
    (o.clienteId || "admin") === clienteId
  );

  res.json({
    ok: true,
    clienteId,
    total: itensCliente.length,
    pendentes: itensCliente.filter((o) => o.status === "pendente").length,
    enviados: itensCliente.filter((o) => o.status === "enviado").length,
    itens: itensCliente,
    fila: itensCliente
  });
});

// =========== REDIRECIONADOR OPTIMUS ===========

app.get("/r/:codigo", (req, res) => {
  try {
    const codigo = req.params.codigo;

    config.linksGerados = config.linksGerados || {};

    const dados = config.linksGerados[codigo];

    if (!dados?.original) {
      return res.status(404).send("Link não encontrado");
    }

    dados.cliques = (dados.cliques || 0) + 1;
    dados.ultimoClique = new Date().toISOString();

    salvarConfig();

    return res.redirect(dados.original);

  } catch (e) {
    console.log("❌ erro link optimus:", e.message);

    return res.status(500).send("Erro ao abrir link");
  }
});

// ================= TELEGRAM =================

app.get("/telegram", (req, res) => {

  const clienteId = getClienteId(req);

  const configCliente =
    configsPorCliente[clienteId] || {};

  res.json({
    ativo: configCliente.telegram?.ativo || false,
    destinos: configCliente.telegram?.destinos || []
  });
});


app.post("/telegram", (req, res) => {
  const { ativo, destinos } = req.body;

const clienteId = getClienteId(req);

configsPorCliente[clienteId] =
  configsPorCliente[clienteId] || {};

configsPorCliente[clienteId].telegram = {
  ativo: ativo === true,
  destinos: Array.isArray(destinos)
    ? destinos
    : configsPorCliente[clienteId]?.telegram?.destinos || []
};

  salvarConfigsClientes();

  res.json({
    ok: true,
    telegram: configsPorCliente[clienteId].telegram
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

// ============== DESTINOS INTELIGENTES =================

app.get("/destinos", (req, res) => {
  const clienteId = getClienteId(req);

  const destinos =
    destinosPorCliente?.[clienteId] || [];

  return res.json(destinos);
});

app.post("/destinos", (req, res) => {
  const clienteId = getClienteId(req);

  const destinos = req.body;

  if (!Array.isArray(destinos)) {
    return res.status(400).json({
      ok: false,
      erro: "Formato inválido"
    });
  }

  destinosPorCliente[clienteId] = destinos;

  salvarDestinosClientes();

  return res.json({
    ok: true,
    destinos: destinosPorCliente[clienteId]
  });
});

app.delete("/destinos/:id", (req, res) => {
  const clienteId = getClienteId(req);

  const { id } = req.params;

  destinosPorCliente[clienteId] =
    (destinosPorCliente?.[clienteId] || [])
      .filter(d => d.id !== id);

  salvarDestinosClientes();

  return res.json({
    ok: true
  });
});

// ================= AUTOMAÇÃO POR CLIENTE =================

app.get("/automacao", (req, res) => {
  const clienteId = getClienteId(req);

  if (!clienteId) {
    return res.status(401).json({
      ok: false,
      erro: "Usuário não identificado"
    });
  }

  configsPorCliente[clienteId] = configsPorCliente[clienteId] || {};

  return res.json({
    ok: true,
    clienteId,
    ativo: configsPorCliente[clienteId].automacaoAtiva === true
  });
});

app.post("/automacao/toggle", (req, res) => {
  const clienteId = getClienteId(req);

  if (!clienteId) {
    return res.status(401).json({
      ok: false,
      erro: "Usuário não identificado"
    });
  }

  configsPorCliente[clienteId] = configsPorCliente[clienteId] || {};

  configsPorCliente[clienteId].automacaoAtiva =
    !configsPorCliente[clienteId].automacaoAtiva;

  salvarConfigsClientes();

  console.log("🤖 Automação cliente:", {
    clienteId,
    ativo: configsPorCliente[clienteId].automacaoAtiva
  });

  return res.json({
    ok: true,
    clienteId,
    ativo: configsPorCliente[clienteId].automacaoAtiva
  });
});

app.delete("/fila/:index", (req, res) => {
  const index = Number(req.params.index);
  const clienteId = getClienteId(req);

  if (isNaN(index) || index < 0 || index >= fila.length) {
    return res.status(400).send("Índice inválido");
  }

  const oferta = fila[index];

  if ((oferta.clienteId || "admin") !== clienteId) {
    return res.status(403).json({
      ok: false,
      erro: "Sem permissão para remover esta oferta"
    });
  }

  const removido = fila.splice(index, 1);

  salvarFila();

  console.log("🗑️ Removido da fila:", {
    clienteId,
    titulo: removido[0]?.nome || removido[0]?.titulo
  });

  res.json({
    ok: true,
    mensagem: "Removido com sucesso"
  });
});

app.post("/fila/:index/enviar-agora", async (req, res) => {
  const index = Number(req.params.index);
const clienteIdReq = getClienteId(req);

const filaCliente = fila.filter(o =>
  String(o.clienteId || "admin") === String(clienteIdReq)
);

if (isNaN(index) || index < 0 || index >= filaCliente.length) {
  return res.status(400).json({
    ok: false,
    erro: "Índice inválido"
  });
}

const oferta = filaCliente[index];

const indexReal = fila.findIndex(o => o === oferta);

  if ((oferta.clienteId || "admin") !== clienteIdReq) {
    return res.status(403).json({
      ok: false,
      erro: "Sem permissão para enviar esta oferta"
    });
  }

  oferta.status = "pendente";

  console.log("📦 ENTRANDO NA FILA:", {
    clienteId: clienteIdReq,
    titulo: oferta.titulo || oferta.nome,
    preco: oferta.precoAtual || oferta.preco,
    imagem: !!oferta.imagem,
    marketplace: oferta.marketplace,
    categoria: oferta.categoria
  });

  fila.splice(indexReal, 1);
  fila.unshift(oferta);

  salvarFila();

  const clienteId = oferta.clienteId || "admin";

  controleEnvio[clienteId] = 0;

  const configCliente =
    configsPorCliente?.[clienteId] || config;

  const automacaoAnterior = configCliente.automacaoAtiva;

  configCliente.automacaoAtiva = true;

  await processarFila();

  configCliente.automacaoAtiva = automacaoAnterior;

  return res.json({
    ok: true,
    mensagem: "Envio manual processado",
    oferta
  });
});

app.get("/config", (req, res) => {
  const clienteId = getClienteId(req);
  const isAdmin = isAdminMaster(req);

  if (isAdmin) {
    return res.json({
      ok: true,
      clienteId,
      config
    });
  }

  const configCliente = configsPorCliente?.[clienteId] || {};

  return res.json({
    ok: true,
    clienteId,
    config: {
      ...config,
      ...configCliente,
      marketplaces: {
        ...config.marketplaces,
        ...(configCliente.marketplaces || {})
      }
    }
  });
});

app.get("/minha-config", (req, res) => {
  const clienteId = getClienteId(req);
  const configCliente = getConfigCliente(clienteId);

  return res.json({
    ok: true,
    clienteId,
    config: {
      ...config,
      ...configCliente
    }
  });
});

app.get("/admin/usuarios", (req, res) => {
  if (!isAdminMaster(req)) {
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao Admin Master"
    });
  }

  return res.json({
    ok: true,
    usuarios
  });
});

app.get("/admin/planos", (req, res) => {
  if (!isAdminMaster(req)) {
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao Admin Master"
    });
  }

return res.json({
  ok: true,
  planos,
  lista: Object.values(planos || {})
 });
}); 

app.post("/admin/planos", (req, res) => {
  if (!isAdminMaster(req)) {
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao Admin Master"
    });
  }

  const body = req.body || {};

  if (!body.nome) {
    return res.status(400).json({
      ok: false,
      erro: "Nome do plano obrigatório"
    });
  }

 planos[body.nome] = {
  nome: body.nome,

  marketplaces: Array.isArray(body.marketplaces)
    ? body.marketplaces
    : [],

  limites: {
    sessoes: Number(body.limites?.sessoes || 0),
    destinos: Number(body.limites?.destinos || 0),
    enviosDia: Number(body.limites?.enviosDia || 0),
    creditos: Number(body.limites?.creditos || body.creditos || 0)
  },

  recursos: {
    linkOptimus: !!body.recursos?.linkOptimus,
    analytics: !!body.recursos?.analytics,
    cupomInteligente: !!body.recursos?.cupomInteligente
  },

  atualizadoEm: new Date().toISOString()
};

  salvarPlanos();

  return res.json({
    ok: true,
    plano: planos[body.nome]
  });
});

app.delete("/admin/planos/:nome", (req, res) => {
  if (!isAdminMaster(req)) {
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao Admin Master"
    });
  }

  const { nome } = req.params;

  if (!planos[nome]) {
    return res.status(404).json({
      ok: false,
      erro: "Plano não encontrado"
    });
  }

  const usuariosUsandoPlano = usuarios.filter(
    u => String(u.plano).toLowerCase() === String(nome).toLowerCase()
  );

  if (usuariosUsandoPlano.length > 0) {
    return res.status(400).json({
      ok: false,
      erro: "Não é possível excluir plano em uso por usuários"
    });
  }

  delete planos[nome];

  salvarPlanos();

  return res.json({
    ok: true,
    mensagem: "Plano excluído com sucesso"
  });
});

app.delete("/admin/usuarios/:id", (req, res) => {
  if (!isAdminMaster(req)) {
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao Admin Master"
    });
  }

  const { id } = req.params;

  if (id === "admin") {
    return res.status(400).json({
      ok: false,
      erro: "Não é possível excluir o Admin Master principal"
    });
  }

  const antes = usuarios.length;

  usuarios = usuarios.filter(u => String(u.id) !== String(id));

  if (usuarios.length === antes) {
    return res.status(404).json({
      ok: false,
      erro: "Usuário não encontrado"
    });
  }

  delete configsPorCliente[id];
  delete destinosPorCliente[id];
  delete integracoesPorCliente[id];

  salvarUsuarios();
  salvarConfigsClientes();
  salvarDestinosClientes();
  salvarIntegracoesPersistidas();

  return res.json({
    ok: true,
    mensagem: "Usuário excluído com sucesso",
    id
  });
});

app.post("/admin/usuarios", (req, res) => {
  if (!isAdminMaster(req)) {
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao Admin Master"
    });
  }

  const body = req.body || {};

  if (!body.nome || !body.email || !body.senha) {
    return res.status(400).json({
      ok: false,
      erro: "Nome, email e senha obrigatórios"
    });
  }

  const existe = usuarios.find(
    u => u.email.toLowerCase() === body.email.toLowerCase()
  );

  if (existe) {
    return res.status(400).json({
      ok: false,
      erro: "Email já cadastrado"
    });
  }

  const novoUsuario = {
    id: gerarId(),
    nome: body.nome,
    email: body.email.toLowerCase(),
    senha: body.senha,
    papel: body.papel || "cliente",
    plano: body.plano || "free",
    creditos: Number(body.creditos || 0),
    ativo: true,
    criadoEm: new Date().toISOString()
  };

  usuarios.push(novoUsuario);

  salvarUsuarios();

  return res.json({
    ok: true,
    usuario: novoUsuario
  });
});

app.put("/admin/usuarios/:id", (req, res) => {
  if (!isAdminMaster(req)) {
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito"
    });
  }

  const { id } = req.params;

  const usuario = usuarios.find(
    u => String(u.id) === String(id)
  );

  if (!usuario) {
    return res.status(404).json({
      ok: false,
      erro: "Usuário não encontrado"
    });
  }

  const body = req.body || {};

  usuario.nome = body.nome || usuario.nome;

  usuario.email =
    (body.email || usuario.email).toLowerCase();

  if (body.senha) {
    usuario.senha = body.senha;
  }

  usuario.plano = body.plano || usuario.plano;

  usuario.papel = body.papel || usuario.papel;

  usuario.creditos = Number(
    body.creditos ?? usuario.creditos ?? 0
  );

  if (typeof body.ativo === "boolean") {
    usuario.ativo = body.ativo;
  }

  usuario.atualizadoEm =
    new Date().toISOString();

  salvarUsuarios();

  return res.json({
    ok: true,
    usuario
  });
});

app.post("/minha-config", (req, res) => {
  const clienteId = getClienteId(req);
  const body = req.body || {};

  configsPorCliente[clienteId] = {
    ...configsPorCliente[clienteId],
    ...body
  };

  salvarConfigsClientes();

  return res.json({
    ok: true,
    clienteId,
    config: configsPorCliente[clienteId]
  });
});

app.post("/config", (req, res) => {

  const clienteId = getClienteId(req);

  if (!clienteId) {
    return res.status(401).json({
      ok: false,
      erro: "Cliente não identificado"
    });
  }

  const body = req.body || {};

  configsPorCliente[clienteId] =
    configsPorCliente[clienteId] || {};

  const configCliente =
    configsPorCliente[clienteId];

  const isAdmin =
    isAdminMaster(req);

  // ================= MARKETPLACES =================

  configCliente.marketplaces = {
    ...(configCliente.marketplaces || {})
  };

  if (body.marketplaces) {

    for (const [nome, dados] of Object.entries(body.marketplaces)) {

      configCliente.marketplaces[nome] =
        configCliente.marketplaces[nome] || {};

      // usuário comum só liga/desliga
      configCliente.marketplaces[nome].ativo =
        dados?.ativo === true;

      // admin controla farejo global
      if (isAdmin) {

    config.marketplaces[nome] =
    config.marketplaces[nome] || {};

    if (dados.ativo != null) {
    config.marketplaces[nome].ativo =
    dados.ativo === true;
    }

        if (dados.intervaloFarejoMinutos != null) {
          config.marketplaces[nome].intervaloFarejoMinutos =
            Number(dados.intervaloFarejoMinutos);
        }

        if (dados.limitePorRodada != null) {
          config.marketplaces[nome].limitePorRodada =
            Number(dados.limitePorRodada);
        }

        if (dados.descontoMinimo != null) {
          config.marketplaces[nome].descontoMinimo =
            Number(dados.descontoMinimo);
        }

        if (dados.precoMinimo != null) {
          config.marketplaces[nome].precoMinimo =
            Number(dados.precoMinimo);
        }

      }
    }
  }

if (body.horarioInicio != null) {
  configCliente.horarioInicio = body.horarioInicio;

  if (isAdmin) {
    config.horarioInicio = body.horarioInicio;
  }
}

if (body.horarioFim != null) {
  configCliente.horarioFim = body.horarioFim;

  if (isAdmin) {
    config.horarioFim = body.horarioFim;
  }
}

if (body.pausarMadrugada != null) {
  configCliente.pausarMadrugada =
    body.pausarMadrugada === true;

  if (isAdmin) {
    config.pausarMadrugada =
      body.pausarMadrugada === true;
  }
}

  // ================= CONFIG CLIENTE =================

 if (body.automacaoAtiva != null) {
  configCliente.automacaoAtiva =
    body.automacaoAtiva === true;

  if (isAdmin) {
    config.automacaoAtiva =
      body.automacaoAtiva === true;
  }
}

  if (body.intervaloMinutos != null) {
    configCliente.intervaloMinutos =
      Number(body.intervaloMinutos);
  }

  if (body.intervaloEnvioMinutos != null) {
    configCliente.intervaloEnvioMinutos =
      Number(body.intervaloEnvioMinutos);
  }

  if (body.horarioInicio) {
    configCliente.horarioInicio =
      body.horarioInicio;
  }

  if (body.horarioFim) {
    configCliente.horarioFim =
      body.horarioFim;
  }

  salvarConfigsClientes();
  salvarConfig();

  return res.json({
    ok: true,
    clienteId,
    configCliente,
    configGlobal: isAdmin ? config : undefined
  });
});

// ===================== FUNCAO ADMIN MASTER ==============================

function isAdminMaster(req) {
  const clienteId = getClienteId(req);
  const usuario = usuarios.find(u => u.id === clienteId);

  return usuario?.papel === "admin_master";
}

// ===================== FUNCAO USUARIO ATUAL ============================

function getUsuarioAtual(req) {
  const clienteId = getClienteId(req);
  return usuarios.find(u => u.id === clienteId) || null;
}

function getPlanoUsuario(req) {
  const usuario = getUsuarioAtual(req);

  if (!usuario) return null;

  const nomePlano =
    String(usuario.plano || "")
      .trim()
      .toLowerCase();

  const planoEncontrado = Object.values(planos).find(
    p =>
      String(p.nome || "")
        .trim()
        .toLowerCase() === nomePlano
  );

  return planoEncontrado || null;
}

// ======================== FUNCAO GET INTEGRACOES ========================

function getIntegracaoCliente(clienteId = "admin", marketplace = "") {
  const mp = String(marketplace || "").toLowerCase();

  return (
    integracoesPorCliente?.[clienteId]?.[mp] ||
    integracoesPorCliente?.admin?.[mp] ||
    null
  );
}

// ======================== FUNCAO GERAR ID ===============================

function gerarId() {
  return "user_" + Math.random().toString(36).substring(2, 10);
}

// ======================== FUNCAO CLIENTE ID =============================

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

function getConfigCliente(clienteId = "admin") {
  configsPorCliente[clienteId] =
    configsPorCliente[clienteId] || {};

  return configsPorCliente[clienteId];
}

function auth(req, res, next) {

  if (req.method === "OPTIONS") {
    return next();
  }

  if (
    req.path === "/" ||
    req.path === "/login" ||
    req.path === "/debug-usuarios" ||
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

app.get("/debug-usuarios", (req, res) => {
  res.json(usuarios);
});

app.use(auth);

carregarConfig();

const JWT_SECRET = process.env.JWT_SECRET || "segredo";

// ================= LOGIN =================

app.post("/login", async (req, res) => {
  const { user, pass } = req.body || {};

  const login = String(user || "").trim().toLowerCase();

  const usuario = usuarios.find(u =>
    String(u.email || "").toLowerCase() === login ||
    String(u.id || "").toLowerCase() === login
  );

  if (!usuario) {
    return res.status(401).json({ erro: "Usuário inválido" });
  }

  if (usuario.ativo === false) {
    return res.status(403).json({ erro: "Usuário inativo" });
  }

  let senhaOk = false;

  if (usuario.id === "admin" && pass === "123456") {
    senhaOk = true;
  } else {
    senhaOk = String(usuario.senha || "") === String(pass || "");
  }

  if (!senhaOk) {
    return res.status(401).json({ erro: "Senha inválida" });
  }

  const token = jwt.sign(
    {
      clienteId: usuario.id,
      papel: usuario.papel || "cliente",
      plano: usuario.plano || "free"
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  return res.json({
    ok: true,
    token,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      papel: usuario.papel,
      plano: usuario.plano,
      creditos: usuario.creditos,
      ativo: usuario.ativo
    }
  });
});

app.get("/", (req, res) => {
  res.json({
    status: "API ONLINE",
    uptime: process.uptime()
  });
});

app.get("/debug-usuarios", (req, res) => {
  res.json(usuarios);
});

app.post("/desconectar/:id", async (req, res) => {
  try {
    const clienteId = getClienteId(req);

    const id = isAdminMaster(req)
  ? req.params.id
  : String(req.params.id).startsWith(clienteId + "_")
    ? req.params.id
    : `${clienteId}_${req.params.id}`;

    if (sessoes[id]) {
      try {
        await sessoes[id]?.logout?.();
      } catch (e) {
        console.log("⚠️ erro logout:", e.message);
      }

      try {
        sessoes[id]?.end?.();
      } catch (e) {
        console.log("⚠️ erro end:", e.message);
      }
    }

    delete sessoes[id];

    if (typeof qrCodes !== "undefined") {
      delete qrCodes[id];
    }

    if (typeof statusSessao !== "undefined") {
      delete statusSessao[id];
    }

    res.json({
      ok: true,
      message: "WhatsApp desconectado.",
      id
    });

  } catch (e) {
    res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.post("/limpar-sessao/:id", async (req, res) => {
  try {
    const clienteId = getClienteId(req);

    const id = isAdminMaster(req)
      ? req.params.id
      : `${clienteId}_${req.params.id}`;

    if (sessoes[id]) {
      try {
        await sessoes[id]?.logout?.();
      } catch (e) {
        console.log("⚠️ erro logout ao limpar:", e.message);
      }

      try {
        sessoes[id]?.end?.();
      } catch (e) {
        console.log("⚠️ erro end ao limpar:", e.message);
      }
    }

    delete sessoes[id];

    if (typeof qrCodes !== "undefined") {
      delete qrCodes[id];
    }

    if (typeof statusSessao !== "undefined") {
      delete statusSessao[id];
    }

    if (typeof destinosPorSessao !== "undefined") {
      delete destinosPorSessao[id];
    }

    const pastaAuth = `/data/auth_${id}`;

    if (fs.existsSync(pastaAuth)) {
      fs.rmSync(pastaAuth, {
        recursive: true,
        force: true
      });

      console.log("🗑️ Sessão limpa:", pastaAuth);
    }

    return res.json({
      ok: true,
      message: "Sessão limpa. Gere um novo QR Code.",
      id
    });

  } catch (e) {
    console.log("❌ erro limpar sessão:", e.message);

    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

// ================= ME ==========================

app.get("/me", (req, res) => {
  const clienteId = getClienteId(req);

  const usuario = usuarios.find(
    u => String(u.id) === String(clienteId)
  );

  if (!usuario) {
    return res.status(404).json({
      ok: false,
      erro: "Usuário não encontrado"
    });
  }

  renovarCreditosSeNecessario(usuario);

  const sessoesUsuario = Object.values(sessoesMeta || {}).filter(s =>
    String(s.id || "").startsWith(clienteId + "_") ||
    (clienteId === "admin" && !String(s.id || "").includes("_"))
  );

  const destinosUsuario =
    destinosPorCliente?.[clienteId] || {};

  const filaUsuario = fila.filter(o =>
    String(o.clienteId || "admin") === String(clienteId)
  );

  const hoje = new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

  const enviosHoje = filaUsuario.filter(o =>
    String(o.enviadoEm || "").startsWith(hoje)
  ).length;

  return res.json({
    ok: true,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      plano: usuario.plano,
      creditos: usuario.creditos,
      papel: usuario.papel,
      ativo: usuario.ativo,
      marketplacesLiberados: getPlanoUsuario(req)?.marketplaces || []
    },
    marketplacesLiberados:getPlanoUsuario(req)?.marketplaces || [],
       
    consumo: {
      enviosHoje,
      sessoes: sessoesUsuario.length,
      destinos: Object.keys(destinosUsuario).length,
      ofertasNaFila: filaUsuario.filter(o => o.status === "pendente").length,
      ofertasEnviadas: filaUsuario.filter(o => o.status === "enviado").length
    },
    status: {
      automacaoAtiva: configsPorCliente?.[clienteId]?.automacaoAtiva === true
    }
  });
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

  const plano = getPlanoUsuario(req);

if (!isAdminMaster(req)) {
  const liberados = plano?.marketplaces || [];

  if (!liberados.includes(marketplace)) {
    return res.status(403).json({
      ok: false,
      erro: `Marketplace ${marketplace} não liberado no seu plano`
    });
  }
}

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

  const credenciais = config.credenciais || {};

  const temAlgumaCredencial = Object.values(credenciais)
    .some(v => String(v || "").trim());

  if (!temAlgumaCredencial) {
    return res.status(400).json({
      ok: false,
      erro: "Insira as credenciais antes de testar."
    });
  }

  if (marketplace === "awin") {
    try {
      const { publisherId, apiToken } = credenciais;

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
    status: "credenciais_presentes",
    message: `${config.nome || marketplace} possui credenciais salvas.`
  });
});

// ================= AWIN IMPORTAR DEEP LINK MANUAL =================

async function gerarDeepLinkAwin(urlOriginal, clienteId = "admin") {
  const integracao =
  getIntegracaoCliente(clienteId, "awin");
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
let parcelamento = "";

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

const pixMatch = html.match(/(R\$\s?[\d\.]+,\d{2})[\s\S]{0,80}À vista no PIX/i);

const parcelamentoMatch = html.match(
  /(R\$\s?[\d\.]+,\d{2})[\s\S]{0,40}em\s+até\s+(\d+)x[\s\S]{0,30}de\s+(R\$\s?[\d\.]+,\d{2})[\s\S]{0,40}sem\s+juros/i
);

if (parcelamentoMatch?.[2] && parcelamentoMatch?.[3]) {
  parcelamento = `💳 Ou ${parcelamentoMatch[2]}x de ${parcelamentoMatch[3]} sem juros`;
}

if (!parcelamento) {
  const precoParcela = precosNumericos
    .filter(p => p.numero > 20 && p.numero < 1000)
    .sort((a, b) => a.numero - b.numero)[0];

  const precoTotalParcelado = precosNumericos
    .filter(p => p.numero > precoParcela?.numero * 5)
    .sort((a, b) => a.numero - b.numero)[0];

  if (precoParcela && precoTotalParcelado) {
    const vezes = Math.round(precoTotalParcelado.numero / precoParcela.numero);

    if (vezes >= 2 && vezes <= 12) {
      parcelamento = `💳 Ou ${vezes}x de ${precoParcela.texto} sem juros`;
    }
  }
}

if (pixMatch?.[1]) {
  precoAtual = pixMatch[1].trim();
  avisoPagamento = "À vista no PIX";
}

const precosValidos = precosNumericos.filter((p) => {
  return p.numero > 80 && p.numero < 100000;
});

if (!precoAtual && precosValidos.length) {
  const unicos = [];

  for (const preco of precosValidos) {
    if (!unicos.some(p => p.numero === preco.numero)) {
      unicos.push(preco);
    }
  }

  const ordenados = [...unicos].sort((a, b) => a.numero - b.numero);

  precoAtual = ordenados[0]?.texto || "";

  const possivelAntigo = [...unicos]
    .filter(p => p.numero > (ordenados[0]?.numero || 0))
    .sort((a, b) => b.numero - a.numero)[0];

  if (possivelAntigo) {
    precoAntigo = possivelAntigo.texto;
  }
}

console.log("🧪 PREÇOS KABUM EXTRAÍDOS:", precosEncontrados.slice(0, 20));
console.log("🧪 PREÇOS VALIDOS:", precosValidos.slice(0, 20));

    // ================= LINK AFILIADO =================

    const linkAfiliado = await gerarDeepLinkAwin(url, clienteId);

    if (!linkAfiliado) {
      return res.status(500).json({
        ok: false,
        erro: "Awin não retornou link afiliado"
      });
    }

console.log("🧪 PARCELAMENTO KABUM:", parcelamento);

  return res.json({
  ok: true,
  urlOriginal: url,
  linkAfiliado,
  titulo,
  precoAtual,
  precoAntigo,
  parcelamento,
  avisoPagamento,
  avisoCupom: "💳 Com desconto à vista no PIX.",
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

  const marcasFortes = [
  "logitech",
  "jbl",
  "xiaomi",
  "huawei",
  "kingston",
  "redragon",
  "hyperx",
  "aoc",
  "lg",
  "samsung",
  "philips",
  "cadence",
  "elgin",
  "tp-link",
  "intelbras",
  "dell"
];

if (
  marcasFortes.some(marca =>
    texto.includes(normalizarTexto(marca))
  )
) {
  score += 25;
}

if (texto.includes("oficial")) score += 10;
if (texto.includes("original")) score += 10;

if (texto.includes("premium")) score -= 8;
if (texto.includes("generico")) score -= 15;
if (texto.includes("replica")) score -= 20;

const vendas = Number(oferta.sales || oferta.vendas || 0);
const nota = Number(oferta.ratingStar || oferta.nota || 0);
const comissao = Number(oferta.commissionRate || oferta.comissao || 0);

if (vendas >= 5000) score += 35;
else if (vendas >= 1000) score += 25;
else if (vendas >= 100) score += 10;

if (nota >= 4.8) score += 25;
else if (nota >= 4.5) score += 15;
else if (nota >= 4.0) score += 5;

if (comissao >= 0.2) score += 20;
else if (comissao >= 0.1) score += 10;

if (produtoSuspeito(oferta)) {
  score -= 100;
}

if (
  texto.includes("ssd") &&
  texto.includes("1tb") &&
  !texto.includes("kingston") &&
  !texto.includes("sandisk") &&
  !texto.includes("wd") &&
  !texto.includes("western digital")
) {
  score -= 40;
}

if (
  texto.includes("micro sd") &&
  texto.includes("1tb")
) {
  score -= 50;
}

if (
  texto.includes("super armazenamento")
) {
  score -= 50;
}

if (
  texto.includes("alta velocidade")
) {
  score -= 20;
}

if (
  vendas <= 3 &&
  nota > 0 &&
  nota < 4
) {
  score -= 25;
}

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

  if (produtoSuspeito(oferta)) {
  return { ok: false, motivo: "produto_suspeito" };
}

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

    if (html.includes("suspicious-traffic-frontend")) {
    console.log("🛡️ Mercado Livre bloqueou por tráfego suspeito. Pulando rodada.");
    return;
    }

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

if (String(url || "").includes("meli.la")) {
  console.log("⚠️ Link ML já afiliado. Reutilizando.");
  return url;
}

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
  
  console.log("🌐 ML URL:", url);

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
    linkAfiliado: gerarLinkOptimus(urlEntrada, "aliexpress"),
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
  produto.promotion_link_short ||
  produto.product_detail_url ||
  produto.product_url ||
  urlEntrada;

// 🔥 Limpar link gigante AliExpress
if (
  linkAfiliado.includes("s.click.aliexpress.com/s/")
) {
  try {
    const match = linkAfiliado.match(
      /https:\/\/s\.click\.aliexpress\.com\/e\/_[a-zA-Z0-9]+/i
    );

    if (match?.[0]) {
      linkAfiliado = match[0];
    }
  } catch (e) {
    console.log("Erro limpando link AliExpress:", e.message);
  }
}

// Se já vier link oficial curto da Ali, mantém ele.
const linkAliOficial = String(linkAfiliado || "").includes("s.click.aliexpress.com")
  ? linkAfiliado
  : linkAfiliado;

// Depois passa pelo motor Optimus.
// Se linksOptimus.ativo = false, volta o link oficial/original.
// Se linksOptimus.ativo = true, vira /r/codigo.
const linkAliCurto = await gerarLinkCurtoAliExpress(
  linkAfiliado,
  credenciais
);

const linkFinal = gerarLinkOptimus(
  linkAliCurto,
  "aliexpress"
);

   return {
      marketplace: "aliexpress",
      titulo: htmlDecode(titulo || "Produto AliExpress"),
      precoAntigo: limparPreco(precoAntigo || ""),
      precoAtual: limparPreco(precoAtual || ""),
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado: linkFinal,
      imagem: corrigirImagemUrl(imagem) || imagem,
      categoria:
      produto.first_level_category_name ||
      produto.second_level_category_name ||
      "AliExpress",
      categoriaProduto:
      produto.first_level_category_name ||
      produto.second_level_category_name ||
      "AliExpress",
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

//================== FUNCAO IMPORTAR MAGALU =========================

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
    ...gerarHeadersStealth(),
    ...(getIntegracaoCliente("admin", "magalu")?.credenciais?.cookies
      ? {
          Cookie:
            getIntegracaoCliente("admin", "magalu").credenciais.cookies
        }
      : {})
  }
});

    const html = await response.text();

    console.log("🧪 HTML MAGALU:", html.slice(0, 2000));

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
  const credenciais =
  getIntegracaoCliente("admin", "aliexpress")?.credenciais || {};

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

//================ IMPORTE MANUAL MAGALU ===================

app.post("/importar-magalu-manual", async (req, res) => {
  try {

    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        ok: false,
        erro: "URL obrigatória"
      });
    }

    const integracao =
    getIntegracaoCliente("admin", "magalu");

    const promoterId =
      integracao?.credenciais?.promoterId || "";

    const produto = await importarMagalu(url, {
      credenciais: { promoterId }
    });

    if (!produto?.precoAtual) {
      return res.status(400).json({
        ok: false,
        erro: "Produto inválido"
      });
    }

    const novaOferta = {
      nome: produto.titulo,
      titulo: produto.titulo,
      preco: produto.precoAtual,
      precoAtual: produto.precoAtual,
      precoAntigo: produto.precoAntigo || "",
      cupom: produto.cupom || "",
      avisoCupom: produto.avisoCupom || "",
      parcelamento: produto.parcelamento || "",
      link: produto.linkAfiliado || url,
      linkAfiliado: produto.linkAfiliado || url,
      imagem: produto.imagem || "",
      marketplace: "magalu",
      categoria: classificarCategoriaOferta(produto, ""),
      sessaoId: "sessao1",
      status: "pendente",
      clienteId: "admin"
    };

    fila.push(novaOferta);

    salvarFila();

    return res.json({
      ok: true,
      produto: novaOferta
    });

  } catch (e) {

    console.log("❌ erro importar manual Magalu:", e.message);

    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

// ================= AREA GLOBAL STEALTH  =================

const USER_AGENTS_STEALTH = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/136.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Mobile Safari/537.36"
];

function gerarHeadersStealth() {
  const userAgent =
    USER_AGENTS_STEALTH[
      Math.floor(Math.random() * USER_AGENTS_STEALTH.length)
    ];

  return {
    "User-Agent": userAgent,
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
    "Sec-Fetch-User": "?1"
  };
}

// =========== FILTRO GLOBAL DE CUPONS ===========

function limparCuponsInvalidos(cupons = []) {
  const blacklist = [
    "APPLE",
    "APPLICATION",
    "APPPROPS",
    "OFFSET",
    "OFFICIAL",
    "APPLY",
    "APPENDCHILD",
    "OFFERS",
    "OFFER",
    "OFFSETHEIGHT",
    "APPLEWEBKIT",
    "MELIDATA",   
    "MELISEARCH",
    "MELISESSION",
    "MELISTORE",
    "MELIPAY",
    "MELICLIENT",
    "MELIDATA",
    "MELIMAIS",
    "MELIPLUS",
    "FUNCTION",
    "OBJECT",
    "RETURN",
    "SCRIPT",
    "WEBPACK",
    "WINDOW",
    "DOCUMENT",
    "NULL",
    "UNDEFINED"
  ];

  return [...new Set(
    cupons.filter(c =>
      c &&
      typeof c === "string" &&
      c.length >= 4 &&
      c.length <= 20 &&
      /^[A-Z0-9_-]+$/i.test(c) &&
      !blacklist.includes(c.toUpperCase())
    )
  )];
}

// ===================== FUNCAO VALIDAR CUPOM ========================

function validarCupomAutomaticamente(marketplace = "", cupom = "") {
  const mp = normalizarTexto(marketplace || "");
  const cp = String(cupom || "").trim().toUpperCase();

  if (!mp || !cp) return false;

  const status = config.cuponsStatus?.[mp]?.[cp];

  if (!status) return true;

  if (status.status === "expirado") return false;

  if ((status.falhas || 0) >= 3) return false;

  const ultima =
    status.ultimoSucesso ||
    status.ultimaDeteccao ||
    status.ultimaUtilizacao ||
    status.criadoEm;

  if (ultima) {
    const horasSemValidar =
      (Date.now() - new Date(ultima).getTime()) / (1000 * 60 * 60);

    if (horasSemValidar >= 24 && (status.confianca || 50) <= 50) {
      status.status = "expirado";
      status.expirouEm = new Date().toISOString();
      salvarConfig();

      console.log("⏳ Cupom expirado por tempo:", mp, cp);
      return false;
    }
  }

  return true;
}

// ============== ESCOLHER MELHOR CUPOM GLOBAL =======================

function escolherMelhorCupom(marketplace, titulo = "", categoria = "") {
 const fonteCupons = [
  ...(config?.cuponsAtivos || []),
  ...(cuponsAtivos || [])
];

const lista = fonteCupons.filter(c =>
  c?.cupom &&
  limparCuponsInvalidos([c.cupom]).length &&
  validarCupomAutomaticamente(
    c.marketplace || marketplace,
    c.cupom
  )
);

  const normalizar = txt =>
    String(txt || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const mp = normalizar(marketplace);
  const t = normalizar(titulo);
  const cat = normalizar(categoria);

  const candidatos = lista.filter(c => {
    if (!c || !c.cupom) return false;

    const cupomMarketplace = normalizar(c.marketplace);
    const cupomCategoria = normalizar(c.categoria || "");
    const cupomTitulo = normalizar(c.titulo || "");

    if (cupomMarketplace && cupomMarketplace !== mp) return false;
    if (cupomCategoria && cat && cupomCategoria !== cat) return false;
    if (cupomTitulo && t && !t.includes(cupomTitulo)) return false;

    return true;
  });

  if (!candidatos.length) return null;

  return candidatos[0];
}

// =========== RESULTADO INTELIGENTE DE CUPOM ===========

function registrarResultadoCupom(marketplace = "", cupom = "", sucesso = false) {
  const mp = normalizarTexto(marketplace || "");
  const cp = String(cupom || "").trim().toUpperCase();

  if (!mp || !cp) return;

  config.cuponsStatus = config.cuponsStatus || {};
  config.cuponsStatus[mp] = config.cuponsStatus[mp] || {};

  const atual = config.cuponsStatus[mp][cp] || {
    falhas: 0,
    sucessos: 0,
    confianca: 50,
    status: "ativo"
  };

  if (sucesso) {
    atual.sucessos = (atual.sucessos || 0) + 1;
    atual.falhas = 0;
    atual.confianca = Math.min(100, (atual.confianca || 50) + 15);
    atual.status = "ativo";
    atual.ultimoSucesso = new Date().toISOString();
  } else {
    atual.falhas = (atual.falhas || 0) + 1;
    atual.confianca = Math.max(0, (atual.confianca || 50) - 20);
    atual.ultimaFalha = new Date().toISOString();

    if (atual.falhas >= 3 || atual.confianca <= 20) {
      atual.status = "expirado";
      atual.expirouEm = new Date().toISOString();
      console.log("🚫 Cupom expirado automaticamente:", mp, cp);
    }
  }

  atual.ultimaUtilizacao = new Date().toISOString();

  config.cuponsStatus[mp][cp] = atual;
  salvarConfig();
}

// =========== INTELIGÊNCIA GLOBAL DE CUPONS ===========

function cupomEstaBloqueado(marketplace = "", cupom = "") {
  const mp = normalizarTexto(marketplace || "");
  const cp = String(cupom || "").trim().toUpperCase();

  const status = config.cuponsStatus || {};
  const dados = status?.[mp]?.[cp];

  return dados?.status === "expirado" && (dados?.falhas || 0) >= 3;
}

function registrarFalhaCupom(marketplace = "", cupom = "") {
  const mp = normalizarTexto(marketplace || "");
  const cp = String(cupom || "").trim().toUpperCase();

  if (!mp || !cp) return;

  config.cuponsStatus = config.cuponsStatus || {};
  config.cuponsStatus[mp] = config.cuponsStatus[mp] || {};

  const atual = config.cuponsStatus[mp][cp] || {
    falhas: 0,
    status: "ativo"
  };

  atual.falhas = (atual.falhas || 0) + 1;
  atual.ultimoTeste = new Date().toISOString();

  if (atual.falhas >= 3) {
    atual.status = "expirado";
    atual.expirouEm = new Date().toISOString();
    console.log("🚫 Cupom marcado como expirado:", mp, cp);
  }

  config.cuponsStatus[mp][cp] = atual;
  salvarConfig();
}

function registrarSucessoCupom(marketplace = "", cupom = "") {
  const mp = normalizarTexto(marketplace || "");
  const cp = String(cupom || "").trim().toUpperCase();

  if (!mp || !cp) return;

  config.cuponsStatus = config.cuponsStatus || {};
  config.cuponsStatus[mp] = config.cuponsStatus[mp] || {};

  config.cuponsStatus[mp][cp] = {
    falhas: 0,
    status: "ativo",
    ultimoSucesso: new Date().toISOString()
  };

  salvarConfig();

  console.log("✅ Cupom validado como ativo:", mp, cp);
}

// =========== DECAIMENTO GLOBAL DE CUPONS ===========

function decairConfiancaCupons() {
  try {
    config.cuponsStatus = config.cuponsStatus || {};
    const agora = Date.now();

    for (const [marketplace, cupons] of Object.entries(config.cuponsStatus)) {
      for (const [cupom, status] of Object.entries(cupons)) {
        if (!status || status.status === "expirado") continue;

        const ultima =
          status.ultimoSucesso ||
          status.ultimaDeteccao ||
          status.ultimaUtilizacao ||
          status.criadoEm;

        if (!ultima) continue;

        const horas = (agora - new Date(ultima).getTime()) / (1000 * 60 * 60);

        if (horas >= 24) {
          status.confianca = Math.max(0, (status.confianca || 50) - 20);
          status.ultimaDecaida = new Date().toISOString();
        }

        if (horas >= 48 || status.confianca <= 20) {
          status.status = "expirado";
          status.expirouEm = new Date().toISOString();
          console.log("⏳ Cupom expirado por decaimento:", marketplace, cupom);
        }
      }
    }

    salvarConfig();
  } catch (e) {
    console.log("❌ erro decairConfiancaCupons:", e.message);
  }
}

// =========== NORMALIZADOR GLOBAL DE CATEGORIAS ===========

function normalizarCategoria(txt = "") {
  return String(txt || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// =========== CATEGORIA BASE GLOBAL ===========

function categoriaBase(txt = "") {
  const c = normalizarCategoria(txt);

  for (const [chave, categoria] of Object.entries(CATEGORIAS_GLOBAIS || {})) {

    const nomeCategoria = normalizarCategoria(
      categoria.nome || ""
    );

    // bate nome da categoria
    if (
      c === chave ||
      c === nomeCategoria ||
      c.includes(nomeCategoria) ||
      nomeCategoria.includes(c)
    ) {
      return chave;
    }

    // bate palavras da categoria
    const bateu = (categoria.palavras || []).some(palavra => {
      const p = normalizarCategoria(palavra);

      return (
        c.includes(p) ||
        p.includes(c)
      );
    });

    if (bateu) {
      return chave;
    }
  }

  return c || "geral";
}

// =========== VALIDAR CATEGORIA DO DESTINO ===========

function categoriaPermitidaNoDestino(oferta, destino) {
  
const categoriaOferta = categoriaBase(
  oferta.categoria ||
  oferta.categoriaProduto ||
  oferta.titulo ||
  oferta.nome ||
  ""
);

  const categoriasDestino = (
    destino.categorias ||
    destino.categoriasPermitidas ||
    []
  )
   .map(categoriaBase)
    .filter(Boolean);

  if (!categoriasDestino.length) return true;

  if (!categoriaOferta) return false;

  if (categoriaOferta === "geral") {
    const nomeDestino = normalizarCategoria(destino.nome || "");

    return (
      nomeDestino.includes("geral") ||
      categoriasDestino.includes("geral") ||
      categoriasDestino.includes("todas") ||
      categoriasDestino.length >= 8
    );
  }

  return categoriasDestino.some(cat =>
    categoriaOferta === cat ||
    categoriaOferta.includes(cat) ||
    cat.includes(categoriaOferta)
  );
}

//============ FUNCAO FAREJAR CUPOM MERCADO LIVRE ================

async function farejarCuponsMercadoLivre(html = "") {
  try {
    const texto = String(html || "").toUpperCase();

    let cuponsEncontrados = [
      ...texto.matchAll(
        /\b(CASINHA|SUPERFASHION|APP[A-Z0-9]{2,}|OFF[A-Z0-9]{2,})\b/g
      )
    ].map(m => m[1]);

    // 🔥 limpeza global
    cuponsEncontrados = limparCuponsInvalidos(cuponsEncontrados);

    // 🔥 remove duplicados
    const cuponsUnicos = [...new Set(cuponsEncontrados)];

    for (const cupom of cuponsUnicos) {
      registrarCupomAtivo({
        marketplace: "mercadolivre",
        cupom,
        origem: "mercadolivre-auto",
        aviso: `Use o cupom ${cupom} para chegar no melhor valor.`
      });
    }

    if (cuponsUnicos.length) {
      console.log("🎟️ Cupons ML encontrados:", cuponsUnicos);
    }

  } catch (e) {
    console.log("❌ erro farejarCuponsMercadoLivre:", e.message);
  }
}

// ===================== FUNCAO TIMES TAMP =============================

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

// ======================= FUNCAO LIMPAR LINK AMAZON =======================

function limparLinkAmazon(url = "") {
  try {
    const u = new URL(url);
    const asin =
    u.pathname.match(/\/dp\/([A-Z0-9]{10})/i)?.[1] ||
    u.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i)?.[1] ||
    u.pathname.match(/\/([A-Z0-9]{10})(?:\/|$)/i)?.[1];

    if (!asin) return url;

    const tag = u.searchParams.get("tag") || "d1egopcoff-20";

    return `https://www.amazon.com.br/dp/${asin}?tag=${tag}`;
  } catch (e) {
    return url;
  }
}

// =================== LINK CURTO OFICIAL ALIEXPRESS ===================

async function gerarLinkCurtoAliExpress(urlOriginal, credenciais = {}) {
  try {
    const appKey = credenciais.appKey || "";
    const secret = credenciais.secret || "";
    const trackingId = credenciais.trackingId || "";

    if (!appKey || !secret || !trackingId || !urlOriginal) {
      return urlOriginal;
    }

    const params = {
      method: "aliexpress.affiliate.link.generate",
      app_key: appKey,
      timestamp: timestampGMT8(),
      sign_method: "md5",
      format: "json",
      v: "2.0",
      promotion_link_type: "0",
      source_values: urlOriginal,
      tracking_id: trackingId
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

    console.log("🔗 ALI LINK GENERATE RESPONSE:", JSON.stringify(data));

    const linkGerado =
      data?.aliexpress_affiliate_link_generate_response?.resp_result?.result?.promotion_links?.promotion_link?.[0]?.promotion_link ||
      data?.resp_result?.result?.promotion_links?.promotion_link?.[0]?.promotion_link ||
      "";

    return linkGerado || urlOriginal;

  } catch (e) {
    console.log("❌ Erro gerar link curto AliExpress:", e.message);
    return urlOriginal;
  }
}

// ======================= FUNCAO PLANO NOME =========================================

function getPlanoPorNome(nome) {
  return planos?.[nome] || null;
}

// =============== FUNCAO GERAR LINK AFILIADO SHOPEE ========================================

async function gerarLinkShopeeCliente(clienteId, ofertaBase = {}) {
  try {
    const integracao = getIntegracaoCliente(clienteId, "shopee");

console.log("👤 CLIENTE:", clienteId);
console.log("🛒 MARKETPLACE:", "shopee");
console.log("🔑 Integração encontrada?", !!integracao);
console.log(
  "🔑 Tem credenciais?",
  !!integracao?.credenciais
 );

    const appId = integracao?.credenciais?.appId || "";
    const secret = integracao?.credenciais?.secret || "";

    if (!appId || !secret) {
      return ofertaBase.linkAfiliado || ofertaBase.link || "";
    }

    const keyword = String(
      ofertaBase.titulo ||
      ofertaBase.nome ||
      ""
    )
      .replace(/"/g, "")
      .slice(0, 80);

    if (!keyword) {
      return ofertaBase.linkAfiliado || ofertaBase.link || "";
    }

    const timestamp = Math.floor(Date.now() / 1000);

    const bodyPayload = {
      query: `
        query {
          productOfferV2(
            keyword: "${keyword}",
            page: 1,
            limit: 5
          ) {
            nodes {
              productName
              productLink
              offerLink
              itemId
              shopId
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

    const data = await response.json().catch(() => null);

    const nodes = data?.data?.productOfferV2?.nodes || [];

    const ofertaTitulo = String(ofertaBase.titulo || ofertaBase.nome || "")
      .toLowerCase()
      .slice(0, 40);

    const produto =
      nodes.find(n =>
        String(n.productName || "")
          .toLowerCase()
          .includes(ofertaTitulo.slice(0, 20))
      ) || nodes[0];

    return (
      produto?.offerLink ||
      ofertaBase.linkAfiliado ||
      ofertaBase.link ||
      ""
    );

  } catch (e) {
    console.log("❌ erro gerarLinkShopeeCliente:", e.message);
    return ofertaBase.linkAfiliado || ofertaBase.link || "";
  }
}

// =============== FUNCAO GERAR LINK AFILIADO VARIOS MARKTPLACES  ============================

async function gerarLinkAfiliadoCliente(clienteId, marketplace, linkOriginal, ofertaBase = {}) {
  try {
    const mp = String(marketplace || "").toLowerCase();

    const integracao =
      getIntegracaoCliente(clienteId, mp);

console.log("====================================");
console.log("👤 CLIENTE:", clienteId);
console.log("🛒 MARKETPLACE:", mp);
console.log("🔑 Integração encontrada?", !!integracao);
console.log("🔑 Tem credenciais?", !!integracao?.credenciais);
console.log("====================================");

    if (mp === "mercadolivre") {
      const linkML = await gerarLinkAfiliadoMercadoLivre(
        linkOriginal || ofertaBase.linkOriginal || ofertaBase.link,
        integracao
      );

      return linkML || linkOriginal || ofertaBase.linkAfiliado || ofertaBase.link || "";
    }

    if (mp === "shopee") {
    return await gerarLinkShopeeCliente(
    clienteId,
    ofertaBase
    );
    }

    if (mp === "amazon") {
      const trackingId =
      integracao?.credenciais?.trackingId ||
      integracao?.credenciais?.partnerTag ||
      integracao?.credenciais?.tag ||
      integracao?.credenciais?.appId ||
      "";

      if (!trackingId) {
        return linkOriginal || ofertaBase.linkAfiliado || ofertaBase.link || "";
      }

      try {
        const u = new URL(
          linkOriginal || ofertaBase.linkOriginal || ofertaBase.link
        );

        u.searchParams.set("tag", trackingId);

        return u.toString();
      } catch {
        return linkOriginal || ofertaBase.linkAfiliado || ofertaBase.link || "";
      }
    }

     if (mp === "aliexpress") {

      const linkAli = await gerarLinkCurtoAliExpress(
        linkOriginal || ofertaBase.linkOriginal || ofertaBase.link,
        integracao?.credenciais || {}
      );

      return (
        linkAli ||
        linkOriginal ||
        ofertaBase.linkAfiliado ||
        ofertaBase.link ||
        ""
      );
    }

   if (mp === "awin") {
    const linkAwin = await gerarDeepLinkAwin(
    linkOriginal || ofertaBase.linkOriginal || ofertaBase.link,
    clienteId
  );

  return (
    linkAwin ||
    linkOriginal ||
    ofertaBase.linkAfiliado ||
    ofertaBase.link ||
    ""
  );
}

if (mp === "magalu") {

  const promoterId =
    integracao?.credenciais?.promoterId || "";

  if (!promoterId) {
    return linkOriginal || ofertaBase.linkAfiliado || ofertaBase.link || "";
  }

  try {
    return gerarLinkMagalu(
      linkOriginal || ofertaBase.linkOriginal || ofertaBase.link,
      promoterId
    );

  } catch {
    return linkOriginal || ofertaBase.linkAfiliado || ofertaBase.link || "";
  }
}

  return linkOriginal || ofertaBase.linkAfiliado || ofertaBase.link || "";

 } catch (e) {
    console.log("⚠️ Erro ao gerar link afiliado do cliente:", {
      clienteId,
      marketplace,
      erro: e.message
    });

    return linkOriginal || ofertaBase.linkAfiliado || ofertaBase.link || "";
  }
}

// ============== HELPERS DISTRIBUIDOR OFERTAS =====================================

function usuarioPodeReceberMarketplace(usuario, marketplace) {
  if (!usuario?.ativo) return false;

  if (usuario.papel === "admin_master") {
    return true;
  }

  const plano =
    getPlanoPorNome(usuario.plano) || {};

  const marketplacesLiberados =
    plano.marketplaces || [];

  return marketplacesLiberados.includes(
    normalizarTexto(marketplace || "")
  );
}

function usuarioTemIntegracaoMarketplace(clienteId, marketplace) {
  const integracao =
    getIntegracaoCliente(
      clienteId,
      normalizarTexto(marketplace || "")
    );

  return !!integracao?.credenciais;
}

// =============== FUNCAO DISTRIBUIDOR OFERTAS ======================================

async function distribuirOfertaParaClientes(ofertaBase) {
  for (const usuario of usuarios) {
    if (!usuario?.ativo) continue;

    const clienteId = usuario.id;
    const adminMaster = usuario.papel === "admin_master";

    const mp = normalizarTexto(ofertaBase.marketplace || "");

    if (!usuarioPodeReceberMarketplace(usuario, mp)) {

      console.log("⏭️ Usuário não recebe marketplace pelo plano:", {
        clienteId,
        plano: usuario.plano,
        marketplace: mp
      });
      continue;
    }

   if (!usuarioTemIntegracaoMarketplace(clienteId, mp)) {
     console.log("🚫 Usuário sem integração configurada:", {
     clienteId,
     marketplace: mp,
      titulo: ofertaBase.titulo
   });
   continue;
   }

    const linkOriginal =
      ofertaBase.linkOriginal ||
      ofertaBase.link ||
      ofertaBase.linkAfiliado ||
      "";

    const linkAfiliadoCliente = await gerarLinkAfiliadoCliente(
      clienteId,
      mp,
      linkOriginal,
      ofertaBase
    );

    if (!linkAfiliadoCliente || linkAfiliadoCliente === linkOriginal) {
      console.log("🚫 Oferta bloqueada: cliente sem link afiliado próprio:", {
        clienteId,
        marketplace: mp,
        titulo: ofertaBase.titulo
      });
      continue;
    }

    const ofertaCliente = {
      ...ofertaBase,
      clienteId,
      marketplace: mp,
      linkAfiliado: linkAfiliadoCliente,
      link: linkAfiliadoCliente,
      status: "pendente",
      destinosEnviados: [],
      logsEnvio: [],
      enviadoEm: "",
      dataEnvio: "",
      statusDetalhe: "Aguardando envio",
      criadoEm: new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo"
      })
    };

    const jaExisteCliente = fila.some(o =>
      String(o.clienteId || "admin") === String(clienteId) &&
      (
        String(o.link || o.linkAfiliado || "") === String(ofertaCliente.link || ofertaCliente.linkAfiliado || "") ||
        normalizarTexto(o.titulo || o.nome || "") === normalizarTexto(ofertaCliente.titulo || ofertaCliente.nome || "")
      )
    );

    if (jaExisteCliente) continue;

  fila.push(ofertaCliente);

  salvarFila(clienteId);

    console.log("✅ Oferta distribuída para cliente:", {
      clienteId,
      titulo: ofertaCliente.titulo,
      marketplace: ofertaCliente.marketplace
    });
  }
}

// ================= FAREJADOR ALIEXPRESS ========================

async function farejarAliExpress() {
  try {
    if (!config.marketplaces?.aliexpress?.ativo) {
      console.log("⏸ AliExpress desativado. Farejador ignorado.");
      return;
    }

    console.log("🛒 Farejando ofertas AliExpress...");

    const cfg = config.marketplaces?.aliexpress || {};
    const integracao = getIntegracaoCliente("admin", "aliexpress");

    const limitePorRodada = cfg.limitePorRodada || 5;
    let adicionadasNestaRodada = 0;
    let ofertasEncontradas = [];

    const buscasBrasil = gerarBuscasGlobais(
      cfg.limiteBuscasBrasil || 20
    );

    const buscasInternacional = gerarBuscasGlobais(
      cfg.limiteBuscasInternacional || 10
    );

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

            if (!link) continue;

            const linkAliCurto = await gerarLinkCurtoAliExpress(
              link,
              integracao?.credenciais || {}
            );

            const linkFinal = gerarLinkOptimus(
              linkAliCurto,
              "aliexpress"
            );

            const linkOriginalAli =
              item.product_detail_url ||
              item.product_url ||
              item.target_sale_url ||
              link ||
              "";

            const itemIdAli =
              String(linkOriginalAli).match(/item\/(\d+)\.html/)?.[1] ||
              String(linkOriginalAli).match(/\/(\d{10,})/)?.[1] ||
              "";

            const chaveAli = itemIdAli
              ? `aliexpress_item_${itemIdAli}`
              : gerarChaveProduto(String(linkOriginalAli).split("?")[0]);

            if (produtoRepetidoRecentemente(chaveAli, 48)) {
              console.log("⏭️ AliExpress item repetido ignorado:", chaveAli);
              continue;
            }

            const titulo =
              item.product_title ||
              item.title ||
              item.product_subject ||
              "Produto AliExpress";

            const chaveRepeticao =
              gerarChaveProduto(titulo + " aliexpress");

            if (produtoRepetidoRecentemente(chaveRepeticao, 48)) {
              console.log("⏭️ AliExpress título repetido ignorado:", titulo);
              continue;
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

            let novaOferta = {
              nome: titulo,
              titulo,
              preco: precoAtual,
              precoAtual,
              precoAntigo: precoAntigo || "",
              cupom: "",
              avisoCupom:
                desconto >= minimoDescontoAplicado
                  ? `${Math.round(desconto)}% OFF no AliExpress.`
                  : "",
              parcelamento: "",
              link: linkFinal,
              linkAfiliado: linkFinal,
              imagem,
              marketplace: "aliexpress",
              categoria: "AliExpress",
              sessaoId: "sessao1",
              status: "pendente",
              clienteId: "admin"
            };

            novaOferta = prepararOfertaGlobal(novaOferta);

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
      for (const termo of buscasInternacional) {
        await buscarTermoAliExpress(termo, "🌍");
        if (adicionadasNestaRodada >= limitePorRodada) break;
      }
    }

    const ofertasFiltradas = aplicarFiltrosUniversais(
      ofertasEncontradas,
      {
        preferirEnvioBrasil: true,
        bloquearSemImagem: true,
        bloquearSemPreco: true
      }
    );

    console.log(
      `🧠 Ofertas AliExpress após filtros universais: ${ofertasFiltradas.length}`
    );

  for (const oferta of ofertasFiltradas) {
  await distribuirOfertaParaClientes(oferta);
  }

    console.log(`✅ AliExpress finalizado. Adicionadas: ${adicionadasNestaRodada}`);
  } catch (e) {
    console.log("❌ erro farejador AliExpress:", e.message);
  }
}


// ================= FAREJADOR MAGALU =================

async function farejarMagalu() {
  try {
    if (!config.marketplaces?.magalu?.ativo) {
      console.log("⏸ Magalu desativada. Farejador ignorado.");
      return;
    }

    console.log("🟦 Farejando ofertas Magalu...");

     const integracao =
     getIntegracaoCliente("admin", "magalu");
     const promoterId =
      integracao?.credenciais?.promoterId ||
      integracao?.promoterId ||
      "";

    if (!promoterId) {
      console.log("❌ Magalu sem promoterId configurado.");
      return;
    }

    const limitePorRodada =
      config.marketplaces?.magalu?.limitePorRodada || 3;

    const buscas = [
      "air fryer",
      "fone bluetooth",
      "smartwatch",
      "cadeira escritorio",
      "furadeira",
      "cafeteira",
      "liquidificador",
      "ventilador",
      "microondas",
      "notebook"
    ];

    const buscasDaRodada = [...buscas]
      .sort(() => Math.random() - 0.5)
      .slice(0, 1);

    let adicionadas = 0;

    for (const termo of buscasDaRodada) {
      if (adicionadas >= limitePorRodada) break;

      const urlBusca = `https://www.magazineluiza.com.br/busca/${encodeURIComponent(termo)}/`;

      console.log("🌐 MAGALU BUSCA:", urlBusca);

      const response = await fetch(urlBusca, {
        headers: {
          ...gerarHeadersStealth(),
          ...(integracao?.credenciais?.cookies
            ? { Cookie: integracao.credenciais.cookies }
            : {})
        }
      });

      console.log("📡 MAGALU STATUS:", response.status);

      if (!response.ok) {

  console.log(
    "🛡️ Magalu bloqueou status:",
    response.status,
    "- parando rodada."
  );

  await new Promise(r => setTimeout(r, 15000));

  return;
}

const html = await response.text();

     const linksExtraidos = [
  ...html.matchAll(/href="([^"]*\/p\/[^"]+)"/g),
  ...html.matchAll(/href="([^"]*\/produto\/[^"]+)"/g),
  ...html.matchAll(/"url":"([^"]*magazineluiza\.com\.br[^"]*)"/g),
  ...html.matchAll(/"productUrl":"([^"]*)"/g),
  ...html.matchAll(/"canonicalUrl":"([^"]*)"/g)
  ]
        .map(m => m[1])
        .map(link => String(link).replace(/\\\//g, "/").replace(/&amp;/g, "&"))
        .map(link => {
          if (link.startsWith("/")) {
            return "https://www.magazineluiza.com.br" + link;
          }
          return link;
        })
        .filter(link =>
          link.includes("magazineluiza.com.br") &&
          link.includes("/p/") &&
          !link.includes("login") &&
          !link.includes("sacola")
        );

      const links = [...new Set(linksExtraidos)].slice(0, 5);

      console.log(`🔎 ${termo}: ${links.length} links Magalu`);

      for (const link of links) {
        if (adicionadas >= limitePorRodada) break;

        try {
          const produto = await importarMagalu(link, {
            credenciais: { promoterId }
          });

          console.log("🧪 PRODUTO MAGALU IMPORTADO:", produto);     

          if (!produto?.precoAtual) continue;

          let novaOferta = {
            nome: produto.titulo,
            titulo: produto.titulo,
            preco: produto.precoAtual,
            precoAtual: produto.precoAtual,
            precoAntigo: produto.precoAntigo || "",
            cupom: produto.cupom || "",
            avisoCupom: produto.avisoCupom || produto.aviso || "",
            parcelamento: produto.parcelamento || "",
            link: produto.linkAfiliado || produto.linkOriginal || link,
            linkAfiliado: produto.linkAfiliado || produto.linkOriginal || link,
            imagem: produto.imagem || "",
            marketplace: "magalu",
            categoria: "Magalu",
            sessaoId: "sessao1",
            status: "pendente",
            clienteId: "admin"
          };

          novaOferta = prepararOfertaGlobal(novaOferta);

          if (produtoSuspeito(novaOferta)) continue;
          if (ofertaJaExiste(novaOferta)) continue;

          await distribuirOfertaParaClientes(novaOferta);
          adicionadas++;

          console.log("🤖 Nova oferta Magalu:", {
            titulo: novaOferta.titulo,
            preco: novaOferta.precoAtual,
            link: novaOferta.link
          });

          await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));
        } catch (e) {
          console.log("❌ erro produto Magalu:", e.message);
        }
      }

      await new Promise(r => setTimeout(r, 5000 + Math.random() * 6000));
    }

    console.log(`✅ Magalu finalizado. Adicionadas: ${adicionadas}`);
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
        marketplace: "awin",
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
   await distribuirOfertaParaClientes(oferta);
  }

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

const temCompraNoApp =
  /COMPRANOAPP[\s\S]{0,120}(app|aplicativo|desconto|off|cupom|resgate)/i.test(html) ||
  /(app|aplicativo|desconto|off|cupom|resgate)[\s\S]{0,120}COMPRANOAPP/i.test(html) ||
  /compra\s+no\s+app/i.test(html) ||
  /desconto\s+no\s+app/i.test(html)

console.log("🎟️ AMAZON CUPOM DETECTADO:", cupom);
console.log("🎫 AMAZON AVISO CUPOM:", avisoCupom);
console.log("🔎 AMAZON TEM COMPRANOAPP?", html.includes("COMPRANOAPP"));
console.log("🔎 AMAZON TEM CUPOM?", /cupom/i.test(html));

linkAfiliado = limparLinkAmazon(linkAfiliado);

const linkFinal = gerarLinkOptimus(linkAfiliado, "amazon"); 

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

}

async function importarShopee(url, config) {
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

// ================= IMPORTAR PRODUTO AMAZON =================

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

} else if (
  urlLower.includes("mercadolivre.com") ||
  urlLower.includes("meli.la")
) {
  marketplace = "mercadolivre";

} else if (
  urlLower.includes("shopee.com") ||
  urlLower.includes("s.shopee")
) {
  marketplace = "shopee";

} else if (
  urlLower.includes("awin1.com") ||
  urlLower.includes("awin.com")
) {
  marketplace = "awin";

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

       
 const cupomEscolhido = escolherMelhorCupom(
  "mercadolivre",
  produto.nome || produto.titulo,
  produto.categoria || ""
 );

const novaOferta = {
  nome: produto.nome || produto.titulo,
  preco: produto.preco || produto.precoAtual,
  link: produto.linkAfiliado || produto.linkOriginal,
  imagem: produto.imagem,
  status: "pendente",

  // 🔥 cupom automático
  cupom: cupomEscolhido?.cupom || "",
  avisoCupom: cupomEscolhido?.aviso || ""
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

const temCupom = Boolean(
  novaOferta.cupom &&
  String(novaOferta.cupom).trim()
);

const temDescontoReal =
  precoAntigoNumero &&
  Number.isFinite(precoAntigoNumero) &&
  precoAntigoNumero > precoNumero;

const descontoPercentual = temDescontoReal
  ? ((precoAntigoNumero - precoNumero) / precoAntigoNumero) * 100
  : 0;

if (cupomEscolhido?.cupom) {
  registrarResultadoCupom(
    "mercadolivre",
    cupomEscolhido.cupom,
    temDescontoReal && descontoPercentual >= 10
  );
}

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
  const clienteId = getClienteId(req);

  const lista = Object.values(sessoesMeta)
  .filter(sessao =>
    isAdminMaster(req) ||
    String(sessao.id || "").startsWith(clienteId + "_")
  )
  .map(sessao => {
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
   console.log("🧪 BODY NOVA SESSÃO:", req.body);

  const clienteId = getClienteId(req);

  const planoUsuario = getPlanoUsuario(req);

  const limite = isAdminMaster(req)
  ? 999
  : Number(planoUsuario?.limites?.sessoes || 1);

  const sessoesCliente = Object.values(sessoesMeta)
    .filter(s =>
      String(s.id || "").startsWith(clienteId + "_") ||
      (clienteId === "admin" && !String(s.id).includes("_"))
    );

  if (!isAdminMaster(req) && sessoesCliente.length >= limite) {
  return res.status(403).json({
    ok: false,
    erro: `Seu plano permite apenas ${limite} sessão(ões).`
  });
}

  try {
    const nome = req.body.nome || "WhatsApp";
    const tipo = req.body.tipo || "whatsapp";

    const total = Object.keys(sessoesMeta).length + 1;
    const nomeSessao = req.body.id || `sessao${total}`;
    const id = clienteId === "admin"
   ? nomeSessao
   : `${clienteId}_${nomeSessao}`;

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

console.log("✅ Sessão criada e salva:", sessoesMeta[id]);

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
  const clienteId = getClienteId(req);

const id = isAdminMaster(req)
  ? req.params.id
  : String(req.params.id).startsWith(clienteId + "_")
    ? req.params.id
    : `${clienteId}_${req.params.id}`;

const idsPossiveis = [...new Set([
  id,
  req.params.id
])];

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

   for (const sid of idsPossiveis) {
  delete sessoes[sid];
  delete qrCodes[sid];
  delete statusSessao[sid];
  delete destinosPorSessao[sid];
  delete gruposPorSessao[sid];
  delete reconectando[sid];
  delete sessoesMeta[sid];

  fs.rmSync("/data/auth_" + sid, {
    recursive: true,
    force: true
  });
}

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
  const clienteId = getClienteId(req);
  const id = isAdminMaster(req)
  ? req.params.id
  : `${clienteId}_${req.params.id}`;

  try {
    console.log("🔄 Resetando sessão:", id);

    if (typeof reconectando !== "undefined") {
      reconectando[id] = false;
    }

    if (sessoes[id]) {

      try {
        await sessoes[id]?.logout?.();
      } catch (e) {
        console.log("⚠️ logout ignorado:", e.message);
      }

      try {
        sessoes[id]?.end?.();
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
  const clienteId = getClienteId(req);
  const { id } = req.body;

  if (!clienteId) {
    return res.status(401).json({ erro: "Usuário não identificado" });
  }

  if (!id) {
    return res.status(400).json({ erro: "ID obrigatório" });
  }

  const sessaoId = clienteId === "admin"
  ? id
  : String(id).startsWith(clienteId + "_")
    ? id
    : `${clienteId}_${id}`;

  if (!id) return res.status(400).json({ erro: "ID obrigatório" });

  config.sessoesWhatsapp = config.sessoesWhatsapp || [];

  if (!config.sessoesWhatsapp.includes(sessaoId)) {
  config.sessoesWhatsapp.push(sessaoId);
  salvarConfig();
  console.log("💾 Sessão WhatsApp salva para reconexão:", id);
 }

 iniciarWhatsApp(sessaoId, clienteId, false);

  return res.json({
  ok: true,
  message: "Sessão iniciada",
  id: sessaoId
  });
  });

app.get("/status/:id", (req, res) => {
  const clienteId = getClienteId(req);
  const idOriginal = req.params.id;

  const id = clienteId === "admin"
    ? idOriginal
    : String(idOriginal).startsWith(clienteId + "_")
      ? idOriginal
      : statusSessao[idOriginal] !== undefined
        ? idOriginal
        : `${clienteId}_${idOriginal}`;

  res.json({
    conectado: statusSessao[id] === "open",
    status: statusSessao[id] || "offline"
  });
});

app.get("/qr/:id", (req, res) => {
  const clienteId = getClienteId(req);
  const idOriginal = req.params.id;

  const id =
    qrCodes[idOriginal] !== undefined
      ? idOriginal
      : `${clienteId}_${idOriginal}`;

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
console.log("🔎 Tentando carregar grupos da sessão:", id);
console.log("📌 Sessões abertas:", Object.keys(sessoes));
console.log("📌 Status sessões:", statusSessao);
  
const sock = sessoes[id]?.sock || sessoes[id];

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
  const clienteId = getClienteId(req);
  const id = clienteId === "admin"
  ? req.params.id
  : String(req.params.id).startsWith(clienteId + "_")
    ? req.params.id
    : `${clienteId}_${req.params.id}`;

  const lista = await carregarGruposSessao(id);

  if (!lista.length) {
    return res.status(400).json({ erro: "Sem grupos carregados" });
  }

return res.json({
  ok: true,
  total: lista.length,
  grupos: lista,
  lista
});
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

const planoUsuario = getPlanoUsuario(req);

const limiteDestinos = isAdminMaster(req)
  ? 999
  : Number(planoUsuario?.limites?.destinos || 3);

  if (destinos.length > limiteDestinos) {
    return res.status(403).json({
      ok: false,
      erro: `Seu plano permite apenas ${limiteDestinos} destino(s).`
    });
  }

  const clienteId = getClienteId(req);

  const id = clienteId === "admin"
    ? req.params.id
    : `${clienteId}_${req.params.id}`;

  destinosPorSessao[id] = destinos;

  if (!config.destinosPorSessao) {
    config.destinosPorSessao = {};
  }

  destinosPorCliente[clienteId] =
  destinosPorCliente[clienteId] || {};

 destinosPorCliente[clienteId][id] = destinos;

 salvarDestinosClientes();
  console.log("💾 Destinos salvos na config:", id, destinos);

  return res.json({
    ok: true,
    destinos
  });
});

app.get("/destinos/:id", (req, res) => {
  const clienteId = getClienteId(req);

  const id = clienteId === "admin"
    ? req.params.id
    : `${clienteId}_${req.params.id}`;

  const destinos =
    destinosPorCliente?.[clienteId]?.[id] || [];

  return res.json({
    ok: true,
    destinos
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

async function iniciarWhatsApp(id, clienteId = "admin", force = false) {
  console.log("🚀 Iniciando sessão:", id, "force:", force);

  const clienteIdFinal = clienteId || "admin";
  const chaveSessao = `${clienteIdFinal}_${id}`;

  const statusAtual = statusSessao[chaveSessao];

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

sessoesMeta[id] = sessoesMeta[id] || {
  id,
  nome: id,
  tipo: "whatsapp",
  criadoEm: new Date().toISOString()
};

sessoesMeta[id].status = "open";
sessoesMeta[id].conectadoEm = new Date().toISOString();

salvarSessoesMeta();

      setTimeout(() => carregarGruposSessao(id), 3000);
    }

    if (connection === "close") {
      const motivo = lastDisconnect?.error?.output?.statusCode;

      console.log("❌ WHATSAPP DESCONECTADO:", id);
      console.log("Motivo:", motivo);

      qrCodes[id] = null;
      if (statusSessao[id] !== "open") {
      delete sessoes[id];
      }

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

    const buscas = gerarBuscasGlobais(40);

      const limiteBuscas =
      config.marketplaces?.mercadolivre?.limiteBuscasPorRodada || 1;

      const buscasEmbaralhadas = [...buscas].sort(() => Math.random() - 0.5);
      const buscasDaRodada = buscasEmbaralhadas.slice(0, limiteBuscas);

      for (const termo of buscasDaRodada) {
      try {
        const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(termo)}`;

       console.log("🌐 MERCADO LIVRE URL:", url);

      const response = await fetch(url, {
  headers: {
    ...gerarHeadersStealth(),
    ...(getIntegracaoCliente("admin", "mercadolivre")?.credenciais?.cookies
      ? {
          Cookie:
            getIntegracaoCliente("admin", "mercadolivre").credenciais.cookies
        }
      : {})
  }
});

        console.log("🌐 URL:", url);
        console.log("📡 STATUS:", response.status);

       if (!response.ok) {

      console.log(
    "🛡️ ML bloqueou status:",
    response.status,
    "- parando rodada."
  );

  await new Promise(r => setTimeout(r, 15000));

  return;
}

const html = await response.text(); 

await farejarCuponsMercadoLivre(html);

if (html.includes("suspicious-traffic-frontend")) {
  console.log("🛡️ Mercado Livre bloqueou por tráfego suspeito.");
  return;
}

let cupom = "";
let avisoCupom = "";
        
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
            const integracaoML =
  getIntegracaoCliente("admin", "mercadolivre");

  const produto = await importarMercadoLivre(link, {
  credenciais: integracaoML?.credenciais
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

if (precoNumero < (config.marketplaces?.mercadolivre?.precoMinimo || 25)) continue;

if (
  desconto < (config.marketplaces?.mercadolivre?.descontoMinimo || 20) &&
  !produto.avisoCupom
) continue;

const tituloLower = String(produto.titulo || "").toLowerCase();

if (
  tituloLower.includes("refil") ||
  tituloLower.includes("amostra") ||
  tituloLower.includes("mini") ||
  tituloLower.includes("teste")
) continue;

            
            let novaOferta = {
              nome: produto.titulo,
              titulo: produto.titulo,
              preco: produto.precoAtual,
              precoAtual: produto.precoAtual,
              precoAntigo: produto.precoAntigo || "",
              cupom: produto.cupom || "",
              avisoCupom: produto.avisoCupom || "",
              parcelamento: produto.parcelamento || "",
              linkOriginal: produto.linkOriginal || link,
              link: produto.linkOriginal || link,
              linkAfiliado: "",
              imagem: produto.imagem || "",
              marketplace: "mercadolivre",
              categoria: classificarCategoriaOferta(produto, termo),
              sessaoId: "sessao1",
              status: "pendente",
              clienteId: "admin"
            };

          novaOferta = prepararOfertaGlobal(novaOferta);

          const jaExiste = ofertaJaExiste(novaOferta);

          if (!jaExiste) {
          await distribuirOfertaParaClientes(novaOferta);

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

    const buscas = gerarBuscasGlobais(
    config.marketplaces?.amazon?.limiteBuscas || 30
    );

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

for (const link of links) {
  try {
    const integracaoAmazon =
  getIntegracaoCliente("admin", "amazon");

  const produto = await importarAmazon(link, {
  credenciais: integracaoAmazon?.credenciais
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

let novaOferta = {
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

novaOferta = prepararOfertaGlobal(novaOferta);

const jaExiste = ofertaJaExiste(novaOferta);

if (!jaExiste) {

novaOferta.criadoEm = novaOferta.criadoEm || new Date().toLocaleString("pt-BR", {
  timeZone: "America/Sao_Paulo"
});

ofertasEncontradas.push(novaOferta);

adicionadasNestaRodada++;

if (adicionadasNestaRodada >= limitePorRodada) {
  console.log("🛑 Limite Amazon por rodada atingido");
  break;
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
  await distribuirOfertaParaClientes(oferta);
}

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
    getIntegracaoCliente(clienteId, "awin");

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
  const configShopee =
  getIntegracaoCliente("admin", "shopee");

if (
  !configShopee?.credenciais?.appId ||
  !configShopee?.credenciais?.secret
) {
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
          limit: ${config.marketplaces?.shopee?.limiteBuscas || 30}
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

        let novaOferta = {
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

        novaOferta = prepararOfertaGlobal(novaOferta);

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
   await distribuirOfertaParaClientes(oferta);
   }

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

carregarConfig();
for (const usuario of usuarios) {
  carregarFila(usuario.id);
}

console.log("🚀 Dados iniciais carregados:", {
  fila: fila.length,
  usuarios: usuarios.length,
  integracoesClientes: Object.keys(integracoesPorCliente || {}).length,
  destinosClientes: Object.keys(destinosPorCliente || {}).length
});

app.listen(PORT, () => {
  console.log("🔥 API ONLINE NA PORTA " + PORT);

decairConfiancaCupons();

setInterval(() => {
  decairConfiancaCupons();
}, 4 * 60 * 60 * 1000);

  setTimeout(() => {
    console.log("🔄 Reconectando sessões WhatsApp automaticamente...");

    const sessoesParaReconectar = [
  ...new Set([
    ...Object.keys(config?.destinosPorSessao || {}),
    ...(config?.sessoesWhatsapp || []),
    "sessao1"
  ])
];
    sessoesParaReconectar.forEach((id, index) => {
      setTimeout(() => {
        console.log("🚀 Reconectando sessão:", id);
        iniciarWhatsApp(id);
      }, 3000 + index * 4000);
    });

  }, 3000);
});

// ================= ORQUESTRADOR GLOBAL DE MARKETPLACES =================

const ordemMarketplaces = [
  "mercadolivre",
  "shopee",
  "amazon",
  "aliexpress",
  "awin",
  "magalu"
];

const farejadoresMarketplaces = {
  mercadolivre: farejarMercadoLivre,
  shopee: farejarShopee,
  amazon: farejarAmazon,
  aliexpress: farejarAliExpress,
  awin: farejarAwin,
  magalu: farejarMagalu,
};

let indiceMarketplaceAtual = 0;
let farejadorRodando = false;

async function rodarProximoMarketplace() {
  console.log("🧪 ORQUESTRADOR TENTOU RODAR", {
    farejadorRodando,
    automacaoAtiva: config.automacaoAtiva,
    horarioOk: podeRodarAgora()
  });

// Farejador global roda apenas no ADMIN MASTER
const admin = usuarios.find(u => u.papel === "admin_master");

if (!admin) {
  console.log("⛔ Nenhum admin master encontrado. Farejador global bloqueado.");
  return;
}

  if (farejadorRodando) return;

  if (!config.automacaoAtiva) {
    console.log("⏸ Farejador parado: automação global desligada");
    return;
  }

  if (!podeRodarAgora()) return;

  const marketplace = ordemMarketplaces[indiceMarketplaceAtual];

  indiceMarketplaceAtual =
    (indiceMarketplaceAtual + 1) % ordemMarketplaces.length;

  const cfg = config.marketplaces?.[marketplace];

  console.log("🧪 ORQUESTRADOR CHECK:", {
    marketplace,
    ativo: cfg?.ativo
  });

  if (!cfg?.ativo) {
    console.log(`⏭️ ${marketplace} desativado. Pulando.`);
    return;
  }

  const farejador = farejadoresMarketplaces[marketplace];

  if (typeof farejador !== "function") {
    console.log(`⚠️ Farejador não encontrado: ${marketplace}`);
    return;
  }

  try {
    farejadorRodando = true;

    console.log(`🎯 Rodada global: ${marketplace}`);

    await farejador();

    console.log(`✅ Rodada finalizada: ${marketplace}`);
  } catch (e) {
    console.log(`❌ Erro na rodada ${marketplace}:`, e.message);
  } finally {
    farejadorRodando = false;
  }
}

setInterval(() => {
  rodarProximoMarketplace();
}, (config.intervaloFarejadorGlobalMinutos || 10) * 60 * 1000);

setTimeout(() => {
  rodarProximoMarketplace();
}, 30 * 1000);

// ================= PROCESSADOR DA FILA =================

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

  processarFila();
}, 10 * 1000);