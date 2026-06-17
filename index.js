
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const csv = require("csv-parser");
const zlib = require("zlib");

const {
  farejarMercadoLivre: farejarMercadoLivreModulo,
  importarMercadoLivre
} = require("./marketplaces/mercadolivre");

const {
  farejarShopee,
  buscarOfertasShopee
} = require("./marketplaces/shopee");

const {
  farejarAmazon
} = require("./marketplaces/amazon");

const {
  farejarAliExpress
} = require("./marketplaces/aliexpress/farejador");

const farejarKabum =
require("./marketplaces/kabum/farejador");

const {
  importarProdutoKabumViaAwin
} = require("./marketplaces/kabum/importador");

const {
  aplicarCuponsAutomaticos
} = require("./marketplaces/cupons");
const {
  deveIgnorarOfertaRepetida,
  registrarOfertaVista
} = require("./marketplaces/inteligencia/memoria-ofertas");

const {
  classificarCategoriaOferta
} = require("./marketplaces/inteligencia/classificador-categorias");

const {
  adicionarOfertaNaFila
} = require("./marketplaces/inteligencia/fila-inteligente");

const {
  normalizarOfertaManual,
  adicionarManualNaFila
} = require("./marketplaces/manual");

const {
  detectarMarketplaceManual,
  importarProdutoManual
} = require("./marketplaces/manual");

const {
  criarImportarAmazon
} = require("./marketplaces/amazon");

const {
  criarImportarShopee
} = require("./marketplaces/shopee");

const {
  BUSCAS_GLOBAIS,
  gerarBuscasGlobais
} = require("./marketplaces/inteligencia/buscas-globais");

const {
  CATEGORIAS_DESTINOS
} = require("./marketplaces/inteligencia/categorias-destinos");

const {
  enviarCampanhaManual
} = require("./campanhas/enviarCampanha");

const mensageiro = require("./modules/mensageiro");
const criarRotasMensageiro = require("./modules/mensageiro/routes");

const {
  calcularScoreOferta
} = require("./marketplaces/inteligencia/score-oferta");

const {
  avaliarOfertaRadar
} = require("./marketplaces/inteligencia/radar-ofertas");

const {
  montarMensagemOferta
} = require("./utils/mensagens-ofertas");

const filaOfertas = require("./utils/fila-ofertas");
const destinosUtils = require("./utils/destinos");
const integracoesUtils = require("./utils/integracoes");


if (!fs.existsSync("/data")) {
  fs.mkdirSync("/data", { recursive: true });
  console.log("[OK] Pasta /data criada");
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

kabum: {
  ativo: true,
  intervaloFarejoMinutos: 20,
  limitePorRodada: 2,
  descontoMinimo: 10,
  precoMinimo: 30
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
let enviandoAgoraPorCliente = {};
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

console.log("[OK]📂Salvando dados em:", FILA_FILE);

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

function normalizarTextoBasico(texto = "") {
  return gerarChaveProduto(texto);
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

function detectarMarcaOferta(texto = "", oferta = {}) {
  if (oferta.marca) {
    return normalizarTextoBasico(oferta.marca);
  }

  const marcas = [
    "jbl", "kingston", "samsung", "xiaomi", "lg", "philips", "sony",
    "lenovo", "dell", "acer", "asus", "apple", "motorola", "nike",
    "adidas", "olympikus", "puma", "fila", "topper", "tramontina",
    "vonder", "bosch", "makita", "dewalt", "mondial", "britania",
    "philco", "electrolux", "consul", "brastemp", "redragon", "hyperx",
    "logitech", "corsair", "intel", "amd", "nvidia", "kabum"
  ];

  return marcas.find(marca => texto.includes(` ${marca} `)) || "";
}

function detectarProdutoBaseOferta(texto = "") {
  const padroes = [
    ["memoria ram", ["memoria ram", "ddr4", "ddr5"]],
    ["placa de video", ["placa de video", "placa grafica", "rtx", "gtx", "radeon"]],
    ["fone", ["fone", "headphone", "headset", "earbuds"]],
    ["smartphone", ["smartphone", "celular", "iphone", "galaxy", "redmi", "moto g"]],
    ["notebook", ["notebook", "laptop", "chromebook"]],
    ["ssd", ["ssd", "nvme", "m 2"]],
    ["moletom", ["moletom", "blusa de frio", "casaco"]],
    ["tenis", ["tenis", "sapatenis", "chinelo", "sandalia"]],
    ["bola", ["bola futebol", "bola futsal", "bola society", "bola volei", "bola"]],
    ["furadeira", ["furadeira", "parafusadeira", "martelete"]],
    ["air fryer", ["air fryer", "fritadeira sem oleo"]],
    ["perfume", ["perfume", "parfum", "colonia", "malbec"]]
  ];

  for (const [base, termos] of padroes) {
    if (termos.some(termo => texto.includes(termo))) {
      return base;
    }
  }

  const stopwords = new Set([
    "kit", "combo", "oferta", "promocao", "original", "novo", "nova",
    "com", "sem", "para", "por", "de", "do", "da", "das", "dos",
    "masculino", "feminino", "infantil", "preto", "branco", "azul",
    "rosa", "verde", "vermelho", "unissex", "premium"
  ]);

  return texto
    .split(" ")
    .filter(token =>
      token.length > 2 &&
      !stopwords.has(token) &&
      !/^\d+$/.test(token)
    )
    .slice(0, 3)
    .join(" ");
}

function sinaisDiversidadeOferta(oferta = {}) {
  const texto = ` ${normalizarTextoBasico([
    oferta.titulo,
    oferta.nome,
    oferta.categoria,
    oferta.categoriaProduto,
    oferta.marketplace,
    oferta.marca
  ].filter(Boolean).join(" "))} `;

  const categoria = normalizarTextoBasico(
    oferta.categoria || oferta.categoriaProduto || "geral"
  );

  const marca = detectarMarcaOferta(texto, oferta);
  const produtoBase = detectarProdutoBaseOferta(texto);
  const tema = produtoBase || categoria || "geral";

  return {
    categoria,
    marca,
    produtoBase,
    tema
  };
}

function calcularDiversidadeOferta(oferta = {}, recentes = []) {
  const sinais = sinaisDiversidadeOferta(oferta);
  let score = 100;
  const motivos = [];

  recentes.forEach((recente, index) => {
    const peso = Math.max(1, 4 - index);
    const sinaisRecentes = recente.__sinaisDiversidade || sinaisDiversidadeOferta(recente);

    if (sinais.produtoBase && sinais.produtoBase === sinaisRecentes.produtoBase) {
      score -= 18 * peso;
      motivos.push("produto_base_repetido");
    }

    if (sinais.marca && sinais.marca === sinaisRecentes.marca) {
      score -= 10 * peso;
      motivos.push("marca_repetida");
    }

    if (sinais.tema && sinais.tema === sinaisRecentes.tema) {
      score -= 8 * peso;
      motivos.push("tema_repetido");
    }

    if (sinais.categoria && sinais.categoria === sinaisRecentes.categoria) {
      score -= 5 * peso;
      motivos.push("categoria_repetida");
    }
  });

  return {
    score: Math.max(0, score),
    sinais,
    motivos: [...new Set(motivos)]
  };
}

function ordenarPendentesPorDiversidade(itens = []) {
  const pendentes = itens
    .map((oferta, index) => ({ oferta, index }))
    .filter(item => item.oferta?.status === "pendente");

  if (pendentes.length < 3) {
    return itens;
  }

  const restantes = [...pendentes];
  const ordenados = [];

  while (restantes.length) {
    const recentes = ordenados.slice(-4).reverse().map(item => item.oferta);

    const melhor = restantes
      .map((item, posicao) => {
        const diversidade = calcularDiversidadeOferta(item.oferta, recentes);
        return {
          item,
          posicao,
          diversidade,
          scoreFinal: diversidade.score - item.index * 0.001
        };
      })
      .sort((a, b) => b.scoreFinal - a.scoreFinal)[0];

    melhor.item.oferta.diversidadeScore = melhor.diversidade.score;
    melhor.item.oferta.diversidadeSinais = melhor.diversidade.sinais;
    melhor.item.oferta.diversidadeMotivos = melhor.diversidade.motivos;
    melhor.item.oferta.__sinaisDiversidade = melhor.diversidade.sinais;

    ordenados.push(melhor.item);
    restantes.splice(melhor.posicao, 1);
  }

  const filaOrdenada = [...itens];
  let indicePendente = 0;

  for (let i = 0; i < filaOrdenada.length; i++) {
    if (filaOrdenada[i]?.status === "pendente") {
      filaOrdenada[i] = ordenados[indicePendente].oferta;
      delete filaOrdenada[i].__sinaisDiversidade;
      indicePendente++;
    }
  }

  return filaOrdenada;
}

function aplicarDiversidadeFila(clienteId = "admin") {
  const cliente = String(clienteId || "admin");
  const itensCliente = fila.filter(item =>
    String(item.clienteId || "admin") === cliente
  );

  const itensOrdenados = ordenarPendentesPorDiversidade(itensCliente);
  let indiceCliente = 0;

  fila = fila.map(item => {
    if (String(item.clienteId || "admin") !== cliente) {
      return item;
    }

    return itensOrdenados[indiceCliente++];
  });
}

function salvarFila(clienteId = "admin") {
  aplicarDiversidadeFila(clienteId);

  return filaOfertas.salvarFila({
    fila,
    clienteId,
    getFilaFile,
    logger: console
  });
}

function carregarFila(clienteId = "admin") {
  fila = filaOfertas.carregarFila({
    fila,
    clienteId,
    getFilaFile,
    logger: console
  });

  return fila;
}

function garantirIdsFila() {
  let alterou = false;

  for (const item of fila) {
    if (!item.id) {
      item.id = `oferta_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      alterou = true;
    }
  }

  if (alterou) {
    salvarFila(clienteId)
    console.log("[FILA] IDs corrigidos em itens antigos da fila");
  }
}

// ================= FUNCAO SALVAR SESSOES META =======================

function salvarSessoesMeta() {
  fs.writeFileSync(
    SESSOES_FILE,
    JSON.stringify(sessoesMeta, null, 2)
  );
}

// ================= FUNCAO CARREGA SESSOES META =======================

function carregarSessoesMeta() {
  try {
    if (!fs.existsSync(SESSOES_FILE)) {
      sessoesMeta = {};
      salvarSessoesMeta();
      return;
    }

    const dados = JSON.parse(
      fs.readFileSync(SESSOES_FILE, "utf8")
    );

    sessoesMeta = dados && typeof dados === "object" ? dados : {};

    console.log("[OK] Sesses meta carregadas:", Object.keys(sessoesMeta).length);
  } catch (e) {
    console.log("[ERRO]❌Erro ao carregar sesses meta:", e.message);
    sessoesMeta = {};
  }
}

// ================= FUNCAO SALVA INTEGRACOES =======================

function salvarIntegracoesPersistidas() {
  fs.writeFileSync(
    INTEGRACOES_FILE,
    JSON.stringify(integracoesPorCliente, null, 2)
  );
}

// ================= FUNCAO SALVA USUARIO =================

function salvarUsuarios() {
  fs.writeFileSync(
    USUARIOS_FILE,
    JSON.stringify(usuarios, null, 2)
  );
}

// ================= CREDITOS =================

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

  console.log("[INFO] Crditos renovados:", {
    usuario: usuario.email,
    plano,
    creditos: usuario.creditos
  });
}

// ================ FUNCAO USUARIO TEM CRÃ‰DITO ==================

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

  console.log("[INFO] Crditos debitados:", {
    usuario: usuario.email,
    restante: usuario.creditos,
    debitado: quantidade
  });

  return true;
}

// ================= FUNCAO SALVA PLANO ===================

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

function salvarConfig() {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(config, null, 2)
    );

    console.log("[OK]💾 Config salva");
  } catch (e) {
    console.error("[ERRO]❌ ERRO AO SALVAR CONFIG:", e.message);
  }
}

function sessaoPersistidaValida(id) {
  if (!id) return false;

  return !!sessoesMeta?.[id];
}

function removerIdsDeArray(lista, idsRemover) {
  if (!Array.isArray(lista)) return lista;

  return lista.filter(id => !idsRemover.has(String(id)));
}

function limparDestinoSessao(destino, idsRemover) {
  if (!destino || typeof destino !== "object") return;

  if (destino.conexaoId && idsRemover.has(String(destino.conexaoId))) {
    destino.conexaoId = "";
  }

  if (destino.sessaoId && idsRemover.has(String(destino.sessaoId))) {
    destino.sessaoId = "";
  }

  if (destino.idSessao && idsRemover.has(String(destino.idSessao))) {
    destino.idSessao = "";
  }

  destino.sessoes = removerIdsDeArray(destino.sessoes, idsRemover);
  destino.sessoesWhatsapp = removerIdsDeArray(destino.sessoesWhatsapp, idsRemover);
}

function limparMapaDestinosPorSessao(mapa, idsRemover) {
  if (!mapa || typeof mapa !== "object") return;

  for (const id of idsRemover) {
    delete mapa[id];
  }
}

function removerReferenciasSessao(ids = [], clienteId = null) {
  const idsRemover = new Set(
    ids
      .map(id => String(id || "").trim())
      .filter(Boolean)
  );

  if (!idsRemover.size) return;

  config.sessoesWhatsapp = removerIdsDeArray(config.sessoesWhatsapp || [], idsRemover);
  limparMapaDestinosPorSessao(config.destinosPorSessao, idsRemover);
  limparMapaDestinosPorSessao(destinosPorSessao, idsRemover);

  for (const cfg of Object.values(configsPorCliente || {})) {
    limparMapaDestinosPorSessao(cfg?.destinosPorSessao, idsRemover);
  }

  const clientes = clienteId
    ? [clienteId]
    : Object.keys(destinosPorCliente || {});

  for (const cid of clientes) {
    const destinosCliente = destinosPorCliente?.[cid];

    if (Array.isArray(destinosCliente)) {
      destinosCliente.forEach(destino => limparDestinoSessao(destino, idsRemover));
    } else if (destinosCliente && typeof destinosCliente === "object") {
      for (const id of idsRemover) {
        delete destinosCliente[id];
      }

      Object.values(destinosCliente).forEach(lista => {
        if (Array.isArray(lista)) {
          lista.forEach(destino => limparDestinoSessao(destino, idsRemover));
        }
      });
    }
  }
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
        cupomInteligente: false,
        campanhas: true,
        templatePersonalizado: false
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
        cupomInteligente: true,
        campanhas: false,
        mensageiro: false,
        templatePersonalizado: false
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
        adminAvancado: true,
        campanhas: true,
        templatePersonalizado: false
      },

      atualizadoEm: new Date().toISOString()
    }
  };

  salvarPlanos();

  console.log("[OK]✅ Planos padro criados");
}

// ================= FUNÃ‡ÃƒO CARREGA CONFIG =================

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

      console.log("[OK]✅ Config carregada");
    }

         
if (fs.existsSync(USUARIOS_FILE)) {
  usuarios = JSON.parse(
    fs.readFileSync(USUARIOS_FILE, "utf8")
  );

  console.log("[OK]✅ Usurios carregados");
}

if (fs.existsSync(INTEGRACOES_FILE)) {
  integracoesPorCliente = JSON.parse(
    fs.readFileSync(INTEGRACOES_FILE, "utf8")
  );

  console.log("[OK]✅ Integraes carregadas");
}

if (fs.existsSync(CONFIGS_CLIENTES_FILE)) {
  configsPorCliente = JSON.parse(
    fs.readFileSync(CONFIGS_CLIENTES_FILE, "utf8")
  );

  console.log("[OK]✅ Configs dos clientes carregadas");
}

if (fs.existsSync(DESTINOS_CLIENTES_FILE)) {
  destinosPorCliente = JSON.parse(
    fs.readFileSync(DESTINOS_CLIENTES_FILE, "utf8")
  );

  console.log("[DESTINO] Destinos dos clientes carregados");
}

if (fs.existsSync(PLANOS_FILE)) {
  planos = JSON.parse(
    fs.readFileSync(PLANOS_FILE, "utf8")
  );

  console.log("[OK]✅ Planos carregados");
}

if (fs.existsSync(SESSOES_FILE)) {
  sessoesMeta = JSON.parse(
    fs.readFileSync(SESSOES_FILE, "utf8")
  );

  console.log("[OK]✅ Sesses meta carregadas:", Object.keys(sessoesMeta).length);
}

  mensageiro.carregarMensageiro();

   criarPlanosPadrao();


if (!usuarios.length) {
console.log("[INFO] CRIANDO ADMIN PADRO");
  usuarios = [
 {
  id: "admin",
  nome: "Diego",
  email: "admin@optimus.local",
  senha: "fzt976",
  papel: "admin_master",
  plano: "master",
  creditos: 999999,
  ativo: true,
  criadoEm: new Date().toISOString()
}
  ];

  salvarUsuarios();

  console.log("[OK]✅ Usurio admin inicial criado");
}

  } catch (e) {
    console.error("[ERRO] ERRO AO CARREGAR CONFIG:", e.message);
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


// ========== LIGAÃ‡ÃƒO IMPORTAR AMAZON E SHOPEE ===================

const importarAmazon = criarImportarAmazon({
  extrairJsonLd,
  extrairMeta,
  htmlDecode,
  limparPreco,
  corrigirImagemUrl,
  limparLinkAmazon,
  gerarLinkOptimus
});

const importarShopee = criarImportarShopee({
  limparPreco,
  htmlDecode,
  extrairMeta,
  corrigirImagemUrl
});

// ================= FILTROS OFERTA JA EXISTE =================

function gerarChaveDuplicidadeOferta(oferta = {}) {
  return normalizarTexto(
    oferta.titulo ||
    oferta.nome ||
    ""
  )
    .replace(/\b(preto|preta|branco|branca|azul|vermelho|verde|rosa|cinza)\b/g, "")
    .replace(/\b(bivolt|110v|220v|110-220v|110\/220v)\b/g, "")
    .replace(/\b(cor|tamanho|modelo)\b/g, "")
    .replace(/\b(mlb\d+)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairIdMercadoLivreOferta(oferta = {}) {
  const texto = String(
    oferta.linkOriginal ||
    oferta.link ||
    oferta.linkAfiliado ||
    ""
  );

  return texto.match(/MLB-?\d+/i)?.[0]?.replace("-", "").toUpperCase() || "";
}

function ofertaJaExiste(novaOferta) {
  const tituloNovo = normalizarTexto(novaOferta.titulo || novaOferta.nome);
  const chaveNova = gerarChaveDuplicidadeOferta(novaOferta);
  const idMlNovo = extrairIdMercadoLivreOferta(novaOferta);

  const linkNovo = String(
    novaOferta.linkOriginal ||
    novaOferta.link ||
    novaOferta.linkAfiliado ||
    ""
  ).trim();

  const precoNovo = String(
    novaOferta.preco ||
    novaOferta.precoAtual ||
    ""
  ).trim();

  const marketplaceNovo = normalizarTexto(novaOferta.marketplace || novaOferta.mercado || "");

  const agora = Date.now();
  const HORAS_BLOQUEIO = 12;

  return fila.some((o) => {
    const tituloExistente = normalizarTexto(o.titulo || o.nome);
    const chaveExistente = gerarChaveDuplicidadeOferta(o);
    const idMlExistente = extrairIdMercadoLivreOferta(o);

    const linkExistente = String(
      o.linkOriginal ||
      o.link ||
      o.linkAfiliado ||
      ""
    ).trim();

    const precoExistente = String(
      o.preco ||
      o.precoAtual ||
      ""
    ).trim();

    const marketplaceExistente = normalizarTexto(o.marketplace || o.mercado || "");

    const dataItem = new Date(
      o.criadoEm || o.dataCriacao || o.enviadoEm || o.dataEnvio || 0
    ).getTime();

    const itemRecente =
      dataItem && agora - dataItem < HORAS_BLOQUEIO * 60 * 60 * 1000;

    if (!itemRecente) return false;

    if (idMlNovo && idMlExistente && idMlNovo === idMlExistente) {
      console.log("[INFO] DUPLICADA ML POR ID:", {
        id: idMlNovo,
        tituloNovo: novaOferta.titulo || novaOferta.nome,
        tituloExistente: o.titulo || o.nome
      });
      return true;
    }

    if (linkNovo && linkExistente && linkNovo === linkExistente) {
      console.log("[INFO] DUPLICADA POR LINK:", {
        tituloNovo: novaOferta.titulo || novaOferta.nome,
        tituloExistente: o.titulo || o.nome
      });
      return true;
    }

    if (tituloNovo && tituloExistente && tituloNovo === tituloExistente) {
      console.log("[INFO] DUPLICADA POR TTULO:", {
        tituloNovo: novaOferta.titulo || novaOferta.nome,
        tituloExistente: o.titulo || o.nome
      });
      return true;
    }

    if (
      chaveNova &&
      chaveExistente &&
      chaveNova === chaveExistente &&
      precoNovo &&
      precoExistente &&
      precoNovo === precoExistente &&
      marketplaceNovo &&
      marketplaceExistente &&
      marketplaceNovo === marketplaceExistente
    ) {
      console.log("[INFO] DUPLICADA POR CHAVE + PREO + MARKETPLACE:", {
        chave: chaveNova,
        preco: precoNovo,
        marketplace: marketplaceNovo,
        tituloNovo: novaOferta.titulo || novaOferta.nome,
        tituloExistente: o.titulo || o.nome
      });
      return true;
    }

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
const app = express(); // ðŸ‘ˆ MUITO IMPORTANTE ter isso

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));

const horarioInicio = 9;
const horarioFim = 23;


// ================= FUNÃ‡ÃƒO RODAR AGORA =================

function podeRodarAgora() {
  return true;
}

let ultimoEnvioFila = 0;

// =================== NÃšCLEO GLOBAL DE OFERTAS ===================

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
  console.log("[INFO] registrarCupomAtivo desativado");
  return false;
}

// ====================== FUNCAO PREPARA OFERTA GLOBAL =========================

function prepararOfertaGlobal(oferta = {}) {
 
if (!oferta.id) {
    oferta.id = `oferta_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  if (!oferta) return oferta;

  oferta.titulo = oferta.titulo || oferta.nome || "Oferta";
  oferta.nome = oferta.nome || oferta.titulo;

  oferta.marketplace = normalizarTexto(oferta.marketplace || "geral");

const categoriaNormalizada = normalizarTexto(oferta.categoria || "");

if (
  !oferta.categoria ||
  ["aliexpress", "amazon", "shopee", "mercadolivre", "magalu", "awin", "kabum"].includes(categoriaNormalizada) ||
  categoriaNormalizada.includes("computador") ||
  categoriaNormalizada.includes("escritorio") ||
  categoriaNormalizada.includes("escritÃ³rio")
) {
  oferta.categoria = classificarCategoriaOferta(oferta);
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

  // oferta = aplicarCupomAutomatico(oferta); // cupom antigo desativado

oferta.precoAtual = oferta.precoAtual || oferta.preco || "";
oferta.preco = oferta.preco || oferta.precoAtual || "";

oferta.avisoPagamento = oferta.avisoPagamento || "";
oferta.parcelamento = oferta.parcelamento || "";
oferta.avisoCupom = oferta.avisoCupom || "";

  return oferta;
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
  return destinosUtils.normalizarDestino(valor);
}


function normalizarCategoriaDestino(valor = "") {
  return destinosUtils.normalizarCategoriaDestino(valor);
}


// ====================== FUNCAO DESTINO ACEITA OFERTAS =========================

function destinoAceitaOferta(destino, oferta) {
  return destinosUtils.destinoAceitaOferta(destino, oferta, {
    classificarCategoriaOferta,
    logger: console
  });

}


// ========== FUNCAO DESTINO DENTRO HORARIO ==================

function destinoDentroHorario(destino = {}) {
  return destinosUtils.destinoDentroHorario(destino);
}

// ========================== ENVIO DESTINO INTELIGENTE ============================

async function enviarParaDestinoInteligente(destino, oferta, mensagem, clienteId, configCliente) {
  try {
    clienteId = clienteId || oferta.clienteId || "admin";
    configCliente = configCliente || configsPorCliente?.[clienteId] || config;

    if (!destinoAceitaOferta(destino, oferta)) {
      return { enviado: false, motivo: "nao_aceita" };
    }

    if (!destinoDentroHorario(destino)) {
      console.log("[DESTINO] Destino fora do horrio:", destino.nome);
      return { enviado: false, motivo: "fora_horario" };
    }

 
// =========================== WHATSAPP ================================

if (String(destino.tipo || "").toLowerCase() === "whatsapp") {
  const sock = sessoes[destino.conexaoId];

  if (!sock) {
    console.log("[WHATSAPP] Sesso no encontrada:", destino.conexaoId);
    return { enviado: false, motivo: "sessao_nao_encontrada" };
  }

  const grupos = (destino.gruposWhatsapp || [])
    .map(g => {
      if (!g) return null;
      if (typeof g === "string") return g;
      return g.id || g.value || g.grupoId || null;
    })
    .filter(Boolean);

  if (!grupos.length) {
    console.log("[WHATSAPP] Destino WhatsApp sem grupos vlidos:", destino.nome);
    return { enviado: false, motivo: "sem_grupos" };
  }

  for (const grupo of grupos) {
    if (!usuarioTemCreditos(clienteId, 1)) {
      console.log("[AVISO] Sem crditos:", clienteId);
      return { enviado: false, motivo: "sem_creditos" };
    }

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

    debitarCreditos(clienteId, 1);

    console.log("[WHATSAPP] Enviado WhatsApp:", {
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

  return { enviado: true };
}


    // ================= ENVIO TELEGRAM =================

    if (String(destino.tipo || "").toLowerCase() === "telegram") {
      const telegrams = configCliente.telegram?.destinos || [];

const telegramsSelecionados = destino.telegramDestinos || [];

const selecionados = telegramsSelecionados.length
  ? telegrams.filter(t =>
      telegramsSelecionados.includes(t.nome) ||
      telegramsSelecionados.includes(String(t.chatId))
    )
  : telegrams.filter(t => t.ativo);
  
      if (!selecionados.length) {
        console.log("[TELEGRAM] Nenhum Telegram selecionado para este destino:", destino.nome);
      }

      for (const tel of selecionados) {
       
      if (!usuarioTemCreditos(clienteId, 1)) {
      console.log("[AVISO] Sem crditos:", clienteId);
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

        console.log("[TELEGRAM] Enviado Telegram:", {
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

      if (selecionados.length) {
        return { enviado: true };
      }
    }

  } catch (e) {
    console.log(
      "âŒ erro destino inteligente:",
      destino?.nome,
      e.message
    );

    return { enviado: false, motivo: "erro", erro: e.message };
  }

  return { enviado: false, motivo: "nao_enviado" };
}

// ================= FUNCÃƒO PROCESSA FILA =================

async function processarFila(clienteIdAlvo = null) {
  const clienteFila = clienteIdAlvo || "admin";

  if (enviandoAgoraPorCliente[clienteFila]) return;

  enviandoAgoraPorCliente[clienteFila] = true;
  let oferta = null;

  try {
    oferta = fila.find(o => {

  const mesmoCliente =
    !clienteIdAlvo ||
    String(o.clienteId || "admin") === String(clienteIdAlvo);

  if (!mesmoCliente) return false;

  if (o.status !== "pendente") return false;

  const clienteIdOferta = o.clienteId || "admin";
  const configClienteOferta =
    configsPorCliente?.[clienteIdOferta] || config;

  return configClienteOferta.automacaoAtiva === true;
});

if (!oferta) {
  console.log("[FILA] Nenhuma oferta pendente");
  return;
}

const clienteId = oferta.clienteId || "admin";

if (oferta.sessaoId === "sessao1") {
  oferta.sessaoId = normalizarSessaoId(clienteId, "sessao1");
  salvarFila();
}

const configCliente =
  configsPorCliente?.[clienteId] || config;

const clienteAtivo =
  configCliente.automacaoAtiva === true;

if (!clienteAtivo) {
  console.log("[INFO] Automao desligada para cliente:", clienteId);
  return;
}

    if (!podeRodarAgora()) {
      return;
    }

  const agora = Date.now();

    let idSessao =
  normalizarSessaoId(
    clienteId,
    oferta.sessaoId || oferta.idSessao || "sessao1"
  );

if (!sessoes[idSessao]) {
  idSessao =
    Object.keys(destinosPorSessao || {}).find(id =>
      String(id).startsWith(clienteId + "_") &&
      destinosPorSessao[id]?.length &&
      statusSessao[id] === "open"
    ) ||
    Object.keys(sessoes || {}).find(id =>
      String(id).startsWith(clienteId + "_")
    );
}

    if (!destinosPorSessao?.[idSessao]?.length) {
      const sessaoComDestino = Object.keys(destinosPorSessao || {})
        .find(id =>
        String(id).startsWith(clienteId + "_") &&
        destinosPorSessao[id]?.length &&
        statusSessao[id] === "open"
        );

      if (sessaoComDestino) {
        idSessao = sessaoComDestino;
      }
    }

    const sock = sessoes[idSessao];

    if (!sock) {
      console.log("[WHATSAPP] Nenhuma sesso conectada para:", idSessao);
      return;
    }

    console.log("[WHATSAPP] Sesso escolhida para envio:", idSessao);
    console.log("[INFO] Cliente dono da oferta:", clienteId);

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

    console.log("[DESTINO] DESTINOS PARA ENVIO:", destinos);

// ================= ENVIO DESTINOS INTELIGENTES =================

const destinosInteligentes =
  Array.isArray(destinosPorCliente?.[clienteId]) && destinosPorCliente[clienteId].length
    ? destinosPorCliente[clienteId]
    : Array.isArray(configCliente?.destinosInteligentes) && configCliente.destinosInteligentes.length
      ? configCliente.destinosInteligentes
      : Array.isArray(config?.destinosInteligentes)
        ? config.destinosInteligentes
        : [];

const usuarioOferta =
  usuarios.find(u => String(u.id) === String(clienteId)) || null;

const plano =
  getPlanoPorNome(usuarioOferta?.plano || "free") || {};

let enviouParaAlgumDestino = false;

let pulouPorIntervalo = false;
let pulouPorHorario = false;
let houveFalhaReal = false;

for (const destino of destinosInteligentes) {
  const chaveControle = `${clienteId}_${destino.id || destino.nome || destino.conexaoId}`;

  const intervaloDestinoMin = Number(
    destino.intervaloMinutos ||
    destino.intervalo ||
    configCliente.intervaloMinutos ||
    config.intervaloMinutos ||
    2
  );

  const intervaloMs = intervaloDestinoMin * 60 * 1000;

  if (!controleEnvio[chaveControle]) {
    controleEnvio[chaveControle] = 0;
  }

  if (agora - controleEnvio[chaveControle] < intervaloMs) {
    pulouPorIntervalo = true;
    console.log("[DESTINO] Destino aguardando intervalo:", {
      clienteId,
      destino: destino.nome,
      intervaloMinutos: intervaloDestinoMin
    });
    continue;
  }

  const marketplaceOfertaLog = String(oferta.marketplace || oferta.mercado || "").toLowerCase();

  if (marketplaceOfertaLog === "mercadolivre" || marketplaceOfertaLog === "mercado_livre") {
    const linkFinal = oferta.linkFinal || oferta.linkAfiliado || oferta.link || oferta.linkOriginal || "";
    console.log("🧪 ENVIO ML", {
      clienteId,
      marketplace: oferta.marketplace,
      titulo: oferta.titulo || oferta.nome || "",
      linkOriginal: oferta.linkOriginal || "",
      linkAfiliado: oferta.linkAfiliado || "",
      linkFinal
    });
  }

  const mensagem = montarMensagemOferta(oferta, {
    destino,
    plano,
    clienteId
  });

  const enviado = await enviarParaDestinoInteligente(
    destino,
    oferta,
    mensagem,
    clienteId,
    configCliente
  );
  const resultadoEnvio =
    typeof enviado === "object" && enviado !== null
      ? enviado
      : { enviado: enviado === true, motivo: enviado === false ? "nao_enviado" : "" };

  if (resultadoEnvio.enviado === true) {
    enviouParaAlgumDestino = true;
    controleEnvio[chaveControle] = Date.now();
  } else if (resultadoEnvio.motivo === "fora_horario") {
    pulouPorHorario = true;
  } else if (!["nao_aceita"].includes(resultadoEnvio.motivo)) {
    houveFalhaReal = true;
  }
}


if (!enviouParaAlgumDestino && (pulouPorIntervalo || pulouPorHorario) && !houveFalhaReal) {
  oferta.status = "pendente";
  oferta.statusDetalhe = pulouPorHorario
    ? "Aguardando horario do destino"
    : "Aguardando intervalo dos destinos";
  oferta.erro = "";
  oferta.erroEm = "";
  salvarFila(clienteId);
  console.log("[DESTINO] Oferta aguardando destino liberar envio:", oferta.titulo);
  return;
}

if (!enviouParaAlgumDestino) {
  console.log("[ERRO] Oferta no enviada. Marcando como erro:", oferta.titulo);

  oferta.status = "erro";
  oferta.statusDetalhe = "Falha ao enviar para destinos";
  oferta.erro = "Nenhum destino confirmou envio";
  oferta.erroEm = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

  salvarFila(clienteId);
  return;
}


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

console.log("[ENVIO] Enviado com controle de tempo");

 } catch (e) {
  console.log("[ERRO] ERRO:", e.message);

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
  enviandoAgoraPorCliente[clienteFila] = false;
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
  try {
    const body = req.body || {};
    const clienteId = getClienteId(req);

    if (!clienteId) {
      return res.status(401).json({
        ok: false,
        erro: "UsuÃ¡rio nÃ£o identificado"
      });
    }

    const resultado = adicionarManualNaFila(body, {
      fila,
      clienteId,
      salvarFila,
      classificarCategoriaOferta,
      normalizarTexto,
      deveIgnorarOfertaRepetida,
      registrarOfertaVista,
      prepararOfertaGlobal
    });

    if (resultado?.ok && !resultado?.ignorada) {
      console.log("[FILA] Oferta manual adicionada  fila:", {
        clienteId,
        id: resultado.oferta?.id,
        titulo: resultado.oferta?.titulo,
        categoria: resultado.oferta?.categoria,
        dataEntradaFila: resultado.oferta?.dataEntradaFila
      });
    }

    return res.json(resultado);

  } catch (e) {
    console.log("[ERRO] [FILA] erro ao adicionar oferta na fila:", e.message);

    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

// ================= ENVIO MANUAL =================

app.post("/enviar-manual", async (req, res) => {
 console.log("[ENVIO] Envio manual recebido:", req.body?.titulo);

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

   const agora = new Date().toLocaleString("pt-BR", {
  timeZone: "America/Sao_Paulo"
});

const categoriaDetectada = classificarCategoriaOferta(
  {
    titulo: body.titulo || body.nome || "",
    nome: body.nome || body.titulo || "",
    categoria: categoriaManual,
    marketplace: body.marketplace || ""
  },
  body.titulo || body.nome || ""
);

const oferta = {
  id:
    body.id ||
    `manual_${Date.now()}_${Math.random().toString(36).slice(2)}`,

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

  categoria: categoriaDetectada,
  categoriaProduto: categoriaDetectada,

  origem: "manual",
  manual: true,
  clienteId: getClienteId(req),
  status: "pendente",
  statusDetalhe: "Na fila",
  criadoEm: body.criadoEm || agora,
  dataEntradaFila: agora
};

 const clienteId = oferta.clienteId || "admin";

if (deveIgnorarOfertaRepetida(oferta)) {
  return res.json({
    ok: true,
    ignorada: true,
    motivo: "Oferta repetida recentemente sem queda relevante de preÃ§o ou cupom novo.",
    oferta
  });
}

oferta.status = "pendente";
oferta.statusDetalhe = "Na fila";

registrarOfertaVista(oferta);

fila.unshift(oferta);
salvarFila(clienteId);

const configCliente =
  configsPorCliente?.[clienteId] || config;

const automacaoAnterior = configCliente.automacaoAtiva;
configCliente.automacaoAtiva = true;

await processarFila(clienteId);

configCliente.automacaoAtiva = automacaoAnterior;
  
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
      return res.status(404).send("Link nÃ£o encontrado");
    }

    dados.cliques = (dados.cliques || 0) + 1;
    dados.ultimoClique = new Date().toISOString();

    salvarConfig();

    return res.redirect(dados.original);

  } catch (e) {
    console.log("[ERRO] erro link optimus:", e.message);

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
        text: "ðŸ§ª Teste Telegram Optimus Promo enviado com sucesso!"
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
      erro: "Formato invÃ¡lido"
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

// ================= AUTOMAÃ‡ÃƒO POR CLIENTE =================

app.get("/automacao/status", (req, res) => {
  const clienteId = getClienteId(req);

  if (!clienteId) {
    return res.status(401).json({
      ok: false,
      erro: "UsuÃ¡rio nÃ£o identificado"
    });
  }

  const configCliente = configsPorCliente?.[clienteId] || {};
  const configFinal = {
    ...config,
    ...configCliente
  };

  const usuario = usuarios.find(
    u => String(u.id) === String(clienteId)
  );

  const itensCliente = fila.filter(o =>
    String(o.clienteId || "admin") === String(clienteId)
  );

  const hojeBR = new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

  function dataEnvioOferta(oferta = {}) {
    const valor = oferta.enviadoEm || oferta.dataEnvio || "";
    if (!valor) return null;

    const dataDireta = new Date(valor);
    if (!Number.isNaN(dataDireta.getTime())) return dataDireta;

    const partes = String(valor).match(
      /(\d{2})\/(\d{2})\/(\d{4})(?:,?\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/
    );

    if (!partes) return null;

    const [, dia, mes, ano, hora = "00", minuto = "00", segundo = "00"] = partes;
    const data = new Date(
      Number(ano),
      Number(mes) - 1,
      Number(dia),
      Number(hora),
      Number(minuto),
      Number(segundo)
    );

    return Number.isNaN(data.getTime()) ? null : data;
  }

  function ofertaEnviadaHoje(oferta = {}) {
    const data = dataEnvioOferta(oferta);

    if (data) {
      return data.toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo"
      }) === hojeBR;
    }

    const valor = String(oferta.enviadoEm || oferta.dataEnvio || "");
    return valor.startsWith(hojeBR);
  }

  const enviadas = itensCliente
    .filter(o => o.status === "enviado" && (o.enviadoEm || o.dataEnvio));

  const ultimaOfertaEnviada = enviadas
    .map(oferta => ({
      oferta,
      data: dataEnvioOferta(oferta)
    }))
    .sort((a, b) => {
      const dataA = a.data ? a.data.getTime() : 0;
      const dataB = b.data ? b.data.getTime() : 0;
      return dataB - dataA;
    })[0]?.oferta || null;

  const destinosCliente = destinosPorCliente?.[clienteId];
  const listasDestinos = Array.isArray(destinosCliente)
    ? [destinosCliente]
    : Object.values(destinosCliente || {}).filter(Array.isArray);

  const destinosAtivos = listasDestinos
    .flat()
    .filter(destino => destino?.ativo === true)
    .length;

  const sessoesAtivas = Object.values(sessoesMeta || {})
    .filter(sessao => {
      const id = String(sessao.id || "");

      return (
        id.startsWith(clienteId + "_") ||
        id === clienteId ||
        (clienteId === "admin" && id.startsWith("admin_"))
      );
    })
    .filter(sessao => {
      const id = sessao.id;
      return statusSessao[id] === "open" || statusSessao[id] === "aberto";
    })
    .length;

  return res.json({
    ok: true,
    clienteId,
    ativa: configCliente.automacaoAtiva === true,
    pendentes: itensCliente.filter(o => o.status === "pendente").length,
    enviadasHoje: enviadas.filter(ofertaEnviadaHoje).length,
    creditos: usuario?.creditos ?? null,
    sessoesAtivas,
    destinosAtivos,
    ultimoEnvio: ultimaOfertaEnviada?.enviadoEm || ultimaOfertaEnviada?.dataEnvio || null,
    config: {
      intervaloMinutos: configFinal.intervaloMinutos ?? configFinal.intervaloEnvioMinutos ?? null,
      horarioInicio: configFinal.horarioInicio ?? null,
      horarioFim: configFinal.horarioFim ?? null,
      pausarMadrugada: configFinal.pausarMadrugada ?? null
    },
    orquestrador: {
      marketplaceAtual: ordemMarketplaces?.[indiceMarketplaceAtual] ?? null,
      intervaloGlobalMinutos: config.intervaloFarejadorGlobalMinutos ?? 10,
      farejadorRodando
    }
  });
});

app.get("/automacao", (req, res) => {
  const clienteId = getClienteId(req);

  if (!clienteId) {
    return res.status(401).json({
      ok: false,
      erro: "UsuÃ¡rio nÃ£o identificado"
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
      erro: "UsuÃ¡rio nÃ£o identificado"
    });
  }

  configsPorCliente[clienteId] = configsPorCliente[clienteId] || {};

  configsPorCliente[clienteId].automacaoAtiva =
    !configsPorCliente[clienteId].automacaoAtiva;

  salvarConfigsClientes();

  console.log("[INFO] Automao cliente:", {
    clienteId,
    ativo: configsPorCliente[clienteId].automacaoAtiva
  });

  return res.json({
    ok: true,
    clienteId,
    ativo: configsPorCliente[clienteId].automacaoAtiva
  });
});


app.delete("/fila/item/:id", (req, res) => {
  const clienteId = getClienteId(req);
  const id = req.params.id;

  const index = fila.findIndex(item =>
    String(item.id) === String(id) &&
    String(item.clienteId || "admin") === String(clienteId)
  );

  if (index === -1) {
    return res.status(404).json({
      ok: false,
      erro: "Item nÃ£o encontrado para este usuÃ¡rio"
    });
  }

  fila.splice(index, 1);
  salvarFila(clienteId);

  return res.json({
    ok: true,
    message: "Item removido da fila"
  });
});

app.delete("/fila/limpar", (req, res) => {
  const clienteId = getClienteId(req);
  const status = req.query.status;

  const antes = fila.length;

  fila = fila.filter(item => {
    const dono = String(item.clienteId || "admin");

    const mesmoCliente =
      dono === String(clienteId);

    const mesmoStatus =
      status
        ? String(item.status) === String(status)
        : true;

    return !(mesmoCliente && mesmoStatus);
  });

  const removidos = antes - fila.length;

  salvarFila(clienteId);

  console.log("[FILA] LIMPEZA FILA:", {
    clienteId,
    status: status || "todos",
    removidos
  });

  return res.json({
    ok: true,
    clienteId,
    status: status || "todos",
    removidos
  });
});

app.delete("/fila/:index", (req, res) => {
  const index = Number(req.params.index);
  const clienteId = getClienteId(req);

  if (isNaN(index) || index < 0 || index >= fila.length) {
    return res.status(400).send("Ãndice invÃ¡lido");
  }

  const oferta = fila[index];

  if ((oferta.clienteId || "admin") !== clienteId) {
    return res.status(403).json({
      ok: false,
      erro: "Sem permissÃ£o para remover esta oferta"
    });
  }

  const removido = fila.splice(index, 1);

  salvarFila(clienteId);

  console.log("[FILA] Removido da fila:", {
    clienteId,
    titulo: removido[0]?.nome || removido[0]?.titulo
  });

  res.json({
    ok: true,
    mensagem: "Removido com sucesso"
  });
});

// ============== POST FILA INDEX ===========================

app.post("/fila/:index/enviar-agora", async (req, res) => {
  const index = Number(req.params.index);
const clienteIdReq = getClienteId(req);

const filaCliente = fila.filter(o =>
  String(o.clienteId || "admin") === String(clienteIdReq)
);

if (isNaN(index) || index < 0 || index >= filaCliente.length) {
  return res.status(400).json({
    ok: false,
    erro: "Ãndice invÃ¡lido"
  });
}

const oferta = filaCliente[index];

const indexReal = fila.findIndex(o => o === oferta);

  if ((oferta.clienteId || "admin") !== clienteIdReq) {
    return res.status(403).json({
      ok: false,
      erro: "Sem permissÃ£o para enviar esta oferta"
    });
  }

  oferta.status = "pendente";

  console.log("[FILA] ENTRANDO NA FILA:", {
    clienteId: clienteIdReq,
    titulo: oferta.titulo || oferta.nome,
    preco: oferta.precoAtual || oferta.preco,
    imagem: !!oferta.imagem,
    marketplace: oferta.marketplace,
    categoria: oferta.categoria
  });

fila.splice(indexReal, 1);
fila.unshift(oferta);

const clienteId = clienteIdReq;

salvarFila(clienteId);

  controleEnvio = {};

  const configCliente =
    configsPorCliente?.[clienteId] || config;

  const automacaoAnterior = configCliente.automacaoAtiva;

  configCliente.automacaoAtiva = true;

  await processarFila(clienteId);

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
      erro: "Nome do plano obrigatÃ³rio"
    });
  }

  const nomePlano = String(body.nome || "").trim();
  const planoAnterior =
    planos[nomePlano] ||
    planos[nomePlano.toLowerCase()] ||
    {};
  const limitesBody = body.limites || {};
  const recursosBody = body.recursos || {};
  const limitesAnteriores = planoAnterior.limites || {};
  const recursosAnteriores = planoAnterior.recursos || {};

  const numeroPlano = (valor, fallback = 0) => {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : fallback;
  };

  const booleanPlano = (chave, fallback = false) => {
    if (Object.prototype.hasOwnProperty.call(recursosBody, chave)) {
      return !!recursosBody[chave];
    }

    return !!fallback;
  };

  planos[nomePlano] = {
    nome: nomePlano,
    preco: String(body.preco ?? planoAnterior.preco ?? ""),

    marketplaces: Array.isArray(body.marketplaces)
      ? body.marketplaces
      : Array.isArray(planoAnterior.marketplaces)
        ? planoAnterior.marketplaces
        : [],

    limites: {
      sessoes: numeroPlano(limitesBody.sessoes, numeroPlano(limitesAnteriores.sessoes, 0)),
      destinos: numeroPlano(limitesBody.destinos, numeroPlano(limitesAnteriores.destinos, 0)),
      enviosDia: numeroPlano(limitesBody.enviosDia, numeroPlano(limitesAnteriores.enviosDia, 0)),
      creditos: numeroPlano(
        limitesBody.creditos ?? limitesBody.creditosMes ?? body.creditos,
        numeroPlano(limitesAnteriores.creditos ?? limitesAnteriores.creditosMes, 0)
      )
    },

    recursos: {
      linkOptimus: booleanPlano("linkOptimus", recursosAnteriores.linkOptimus),
      analytics: booleanPlano("analytics", recursosAnteriores.analytics),
      cupomInteligente: booleanPlano("cupomInteligente", recursosAnteriores.cupomInteligente),
      campanhas: booleanPlano("campanhas", recursosAnteriores.campanhas),
      mensageiro: booleanPlano("mensageiro", recursosAnteriores.mensageiro),
      templatePersonalizado: booleanPlano("templatePersonalizado", recursosAnteriores.templatePersonalizado),
      whatsapp: booleanPlano("whatsapp", recursosAnteriores.whatsapp),
      telegram: booleanPlano("telegram", recursosAnteriores.telegram),
      automacao: booleanPlano("automacao", recursosAnteriores.automacao)
    },

    atualizadoEm: new Date().toISOString()
  };

  salvarPlanos();

  return res.json({
    ok: true,
    plano: planos[nomePlano]
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
      erro: "Plano nÃ£o encontrado"
    });
  }

  const usuariosUsandoPlano = usuarios.filter(
    u => String(u.plano).toLowerCase() === String(nome).toLowerCase()
  );

  if (usuariosUsandoPlano.length > 0) {
    return res.status(400).json({
      ok: false,
      erro: "NÃ£o Ã© possÃ­vel excluir plano em uso por usuÃ¡rios"
    });
  }

  delete planos[nome];

  salvarPlanos();

  return res.json({
    ok: true,
    mensagem: "Plano excluÃ­do com sucesso"
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
      erro: "NÃ£o Ã© possÃ­vel excluir o Admin Master principal"
    });
  }

  const antes = usuarios.length;

  usuarios = usuarios.filter(u => String(u.id) !== String(id));

  if (usuarios.length === antes) {
    return res.status(404).json({
      ok: false,
      erro: "UsuÃ¡rio nÃ£o encontrado"
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
    mensagem: "UsuÃ¡rio excluÃ­do com sucesso",
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
      erro: "Nome, email e senha obrigatÃ³rios"
    });
  }

  const existe = usuarios.find(
    u => u.email.toLowerCase() === body.email.toLowerCase()
  );

  if (existe) {
    return res.status(400).json({
      ok: false,
      erro: "Email jÃ¡ cadastrado"
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
      erro: "UsuÃ¡rio nÃ£o encontrado"
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
      erro: "Cliente nÃ£o identificado"
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

      // usuÃ¡rio comum sÃ³ liga/desliga
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

// ===================== FUNCAO RECURSOS ============================

function usuarioTemRecurso(req, recurso) {
  const usuario = getUsuarioAtual(req);

  if (!usuario) return false;

  if (usuario.papel === "admin_master") {
    return true;
  }

  const plano = getPlanoUsuario(req);

  return plano?.recursos?.[recurso] === true;
}

function clienteTemRecursoMensageiro(clienteId = "admin") {
  const usuario = usuarios.find(u => u.id === clienteId) || null;

  if (!usuario) return clienteId === "admin";
  if (usuario.papel === "admin_master") return true;

  const nomePlano = String(usuario.plano || "").trim().toLowerCase();
  const plano = Object.values(planos || {}).find(p =>
    String(p.nome || "").trim().toLowerCase() === nomePlano
  );

  return plano?.recursos?.mensageiro === true;
}

// ======================== FUNCAO GET INTEGRACOES ========================

function getIntegracaoCliente(clienteId = "admin", marketplace = "") {
  const mp = String(marketplace || "").toLowerCase();
  const cid = String(clienteId || "admin");

  // Admin pode usar integraÃ§Ãµes do admin
  if (cid === "admin") {
    return integracoesPorCliente?.admin?.[mp] || null;
  }

  // UsuÃ¡rio comum sÃ³ pode usar integraÃ§Ã£o prÃ³pria
  return integracoesPorCliente?.[cid]?.[mp] || null;
}

// ======================== FUNCAO GERAR ID ===============================

function gerarId() {
  return "user_" + Math.random().toString(36).substring(2, 10);
}


const JWT_SECRET = process.env.JWT_SECRET || "segredo";

// ======================== FUNCAO CLIENTE ID =============================

function getClienteId(req) {
  if (req.clienteId) return req.clienteId;

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

// ============ FUNCAO AUTH ===============================================

function auth(req, res, next) {

  if (req.method === "OPTIONS") {
    return next();
  }

  if (
    req.path === "/" ||
    req.path === "/login" ||
    req.path === "/kabum/importar" ||
    req.path === "/kabum/importar-teste" ||
    req.path === "/conectar" ||
    req.path.startsWith("/qr") ||
    req.path.startsWith("/status") ||
    req.path.startsWith("/reset")
  ) {
    return next();
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ erro: "Token invÃ¡lido" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const clienteId = decoded.clienteId || "admin";

    const usuarioExiste = usuarios.find(u =>
      String(u.id) === String(clienteId)
    );

    if (!usuarioExiste || usuarioExiste.ativo === false) {
      return res.status(401).json({
        ok: false,
        erro: "UsuÃ¡rio nÃ£o existe ou foi desativado"
      });
    }

    req.usuario = usuarioExiste;
    req.clienteId = clienteId;

    next();
  } catch {
    return res.status(401).json({ erro: "NÃ£o autorizado" });
  }
}

carregarConfig();

app.use(auth);

function lerFilasRadarSomenteLeitura() {
  const itens = [];
  const vistos = new Set();

  function adicionar(oferta = {}, clienteIdOrigem = "") {
    if (!oferta || typeof oferta !== "object") return;

    const origemClienteId = String(
      oferta.clienteId ||
      clienteIdOrigem ||
      "admin"
    );

    const chave = [
      origemClienteId,
      oferta.id || "",
      oferta.linkAfiliado || oferta.link || "",
      normalizarTexto(oferta.titulo || oferta.nome || "")
    ].join("|");

    if (vistos.has(chave)) return;

    vistos.add(chave);
    itens.push({
      ...oferta,
      origemClienteId
    });
  }

  for (const oferta of fila || []) {
    adicionar(oferta, oferta?.clienteId || "admin");
  }

  const clientesDir = "/data/clientes";

  if (fs.existsSync(clientesDir)) {
    for (const entrada of fs.readdirSync(clientesDir, { withFileTypes: true })) {
      if (!entrada.isDirectory()) continue;

      const clienteIdOrigem = entrada.name;
      const arquivoFila = path.join(clientesDir, clienteIdOrigem, "fila.json");

      if (!fs.existsSync(arquivoFila)) continue;

      try {
        const dados = JSON.parse(fs.readFileSync(arquivoFila, "utf8") || "[]");

        if (Array.isArray(dados)) {
          for (const oferta of dados) {
            adicionar(oferta, clienteIdOrigem);
          }
        }
      } catch (e) {
        console.log("[RADAR] Falha ao ler fila do cliente:", {
          clienteId: clienteIdOrigem,
          erro: e.message
        });
      }
    }
  }

  if (fs.existsSync(FILA_FILE)) {
    try {
      const dadosLegados = JSON.parse(fs.readFileSync(FILA_FILE, "utf8") || "[]");

      if (Array.isArray(dadosLegados)) {
        for (const oferta of dadosLegados) {
          adicionar(oferta, oferta?.clienteId || "admin");
        }
      }
    } catch (e) {
      console.log("[RADAR] Falha ao ler fila legada:", e.message);
    }
  }

  return itens;
}

function radarConfigPadrao() {
  return {
    monitoramentoAtivo: true,
    sessaoWhatsappId: "",
    gruposMonitorados: [],
    telegramMonitorados: [],
    monitoramento: {
      horaInicial: "07:00",
      horaFinal: "00:50",
      intervaloMinutos: 6,
      maxPorDia: 180
    },
    categoriasPermitidas: [],
    templateMidia: {
      template: "padrao_optimus",
      tipoMidia: "imagem"
    }
  };
}

function getRadarConfigFile(clienteId = "admin") {
  return path.join(getClienteDir(clienteId), "radar-config.json");
}

function listarSessoesWhatsappCliente(clienteId = "admin") {
  return Object.values(sessoesMeta || {})
    .filter(sessao => {
      const id = String(sessao.id || "");

      return (
        id.startsWith(clienteId + "_") ||
        id === clienteId ||
        (clienteId === "admin" && id.startsWith("admin_"))
      );
    })
    .map(sessao => {
      const id = sessao.id;
      const totalGrupos = gruposPorSessao[id]?.length || 0;

      const nomeAmigavel =
        sessao.nome ||
        sessao.nomeSessao ||
        sessao.apelido ||
        sessao.titulo ||
        sessao.label ||
        id;

      return {
        ...sessao,
        id,
        sessaoId: id,
        nome: nomeAmigavel,
        nomeAmigavel,
        nomeExibicao: nomeAmigavel,
        idTecnico: id,
        status: statusSessao[id] || "offline",
        conectado: statusSessao[id] === "open" || statusSessao[id] === "aberto",
        qrDisponivel: !!qrCodes[id],
        grupos: totalGrupos,
        totalGrupos,
        destinos: destinosPorSessao[id]?.length || 0
      };
    });
}

function listarTelegramRadarCliente(clienteId = "admin") {
  const configCliente = configsPorCliente?.[clienteId] || {};
  const destinos = configCliente.telegram?.destinos || [];

  if (!Array.isArray(destinos)) {
    return [];
  }

  return destinos.map((destino, index) => ({
    ...destino,
    id: String(destino.id || destino.chatId || destino.nome || `telegram_${index}`),
    nome: destino.nome || destino.titulo || destino.label || String(destino.chatId || `Telegram ${index + 1}`),
    chatId: destino.chatId || "",
    ativo: destino.ativo === true,
    status: destino.ativo === true ? "conectado" : "desconectado"
  }));
}

function carregarRadarConfigCliente(clienteId = "admin") {
  const arquivo = getRadarConfigFile(clienteId);
  const padrao = radarConfigPadrao();

  if (!fs.existsSync(arquivo)) {
    return padrao;
  }

  try {
    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8") || "{}");

    return {
      monitoramentoAtivo: dados.monitoramentoAtivo !== false,
      sessaoWhatsappId: dados.sessaoWhatsappId || "",
      gruposMonitorados: Array.isArray(dados.gruposMonitorados)
        ? dados.gruposMonitorados
        : [],
      telegramMonitorados: Array.isArray(dados.telegramMonitorados)
        ? dados.telegramMonitorados
        : [],
      monitoramento: {
        ...padrao.monitoramento,
        ...(dados.monitoramento && typeof dados.monitoramento === "object" ? dados.monitoramento : {})
      },
      categoriasPermitidas: Array.isArray(dados.categoriasPermitidas)
        ? dados.categoriasPermitidas
        : [],
      templateMidia: {
        ...padrao.templateMidia,
        ...(dados.templateMidia && typeof dados.templateMidia === "object" ? dados.templateMidia : {})
      }
    };
  } catch (e) {
    console.log("[RADAR] Falha ao carregar config:", {
      clienteId,
      erro: e.message
    });

    return padrao;
  }
}

function numeroRadarConfig(valor, fallback) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? numero : fallback;
}

function normalizarHoraRadar(valor, fallback) {
  const texto = String(valor || "").trim();
  return /^\d{2}:\d{2}$/.test(texto) ? texto : fallback;
}

function salvarRadarConfigCliente(clienteId = "admin", dados = {}) {
  const arquivo = getRadarConfigFile(clienteId);
  const padrao = radarConfigPadrao();
  const atual = carregarRadarConfigCliente(clienteId);
  const possuiCampo = campo => Object.prototype.hasOwnProperty.call(dados, campo);
  const monitoramentoBase = atual.monitoramento && typeof atual.monitoramento === "object"
    ? atual.monitoramento
    : padrao.monitoramento;
  const monitoramento = dados.monitoramento && typeof dados.monitoramento === "object"
    ? { ...monitoramentoBase, ...dados.monitoramento }
    : monitoramentoBase;
  const templateMidiaBase = atual.templateMidia && typeof atual.templateMidia === "object"
    ? atual.templateMidia
    : padrao.templateMidia;
  const templateMidia = dados.templateMidia && typeof dados.templateMidia === "object"
    ? { ...templateMidiaBase, ...dados.templateMidia }
    : templateMidiaBase;
  const payload = {
    clienteId,
    monitoramentoAtivo: possuiCampo("monitoramentoAtivo")
      ? dados.monitoramentoAtivo !== false
      : atual.monitoramentoAtivo !== false,
    sessaoWhatsappId: possuiCampo("sessaoWhatsappId")
      ? dados.sessaoWhatsappId || ""
      : atual.sessaoWhatsappId || "",
    gruposMonitorados: Array.isArray(dados.gruposMonitorados)
      ? dados.gruposMonitorados
      : Array.isArray(atual.gruposMonitorados)
        ? atual.gruposMonitorados
        : [],
    telegramMonitorados: Array.isArray(dados.telegramMonitorados)
      ? dados.telegramMonitorados
      : Array.isArray(atual.telegramMonitorados)
        ? atual.telegramMonitorados
        : [],
    monitoramento: {
      horaInicial: normalizarHoraRadar(monitoramento.horaInicial, padrao.monitoramento.horaInicial),
      horaFinal: normalizarHoraRadar(monitoramento.horaFinal, padrao.monitoramento.horaFinal),
      intervaloMinutos: numeroRadarConfig(monitoramento.intervaloMinutos, padrao.monitoramento.intervaloMinutos),
      maxPorDia: numeroRadarConfig(monitoramento.maxPorDia, padrao.monitoramento.maxPorDia)
    },
    categoriasPermitidas: Array.isArray(dados.categoriasPermitidas)
      ? dados.categoriasPermitidas.map(c => String(c || "").trim()).filter(Boolean)
      : Array.isArray(atual.categoriasPermitidas)
        ? atual.categoriasPermitidas
        : [],
    templateMidia: {
      template: String(templateMidia.template || padrao.templateMidia.template),
      tipoMidia: String(templateMidia.tipoMidia || padrao.templateMidia.tipoMidia)
    },
    atualizadoEm: new Date().toISOString()
  };

  fs.writeFileSync(arquivo, JSON.stringify(payload, null, 2));

  return payload;
}

function textoRadarId(valor = "") {
  return String(valor || "").trim();
}

function chaveRadarId(valor = "") {
  return normalizarTexto(textoRadarId(valor));
}

function extrairIdsMonitoradosRadar(lista = [], campos = []) {
  const ids = new Set();

  for (const item of Array.isArray(lista) ? lista : []) {
    if (typeof item === "string" || typeof item === "number") {
      const chave = chaveRadarId(item);
      if (chave) ids.add(chave);
      continue;
    }

    if (!item || typeof item !== "object") continue;

    for (const campo of campos) {
      const chave = chaveRadarId(item[campo]);
      if (chave) ids.add(chave);
    }
  }

  return ids;
}

function extrairIdsTelegramMonitoradosRadar(lista = []) {
  const ids = new Set();

  for (const item of Array.isArray(lista) ? lista : []) {
    if (!item || typeof item !== "object" || item.ativo !== true) continue;

    for (const campo of ["id", "chatId", "grupoId"]) {
      const chave = chaveRadarId(item[campo]);
      if (chave) ids.add(chave);
    }
  }

  return ids;
}

function temFontesMonitoradasRadar(configRadar = {}) {
  return (
    (Array.isArray(configRadar.gruposMonitorados) && configRadar.gruposMonitorados.length > 0) ||
    (Array.isArray(configRadar.telegramMonitorados) && configRadar.telegramMonitorados.length > 0)
  );
}

function minutosHoraRadar(valor = "") {
  const partes = String(valor || "").split(":").map(Number);
  if (partes.length !== 2 || partes.some(n => !Number.isFinite(n))) return null;
  const [hora, minuto] = partes;
  if (hora < 0 || hora > 23 || minuto < 0 || minuto > 59) return null;
  return hora * 60 + minuto;
}

function radarDentroHorarioMonitoramento(configRadar = {}) {
  const cfg = configRadar.monitoramento || {};
  const inicio = minutosHoraRadar(cfg.horaInicial);
  const fim = minutosHoraRadar(cfg.horaFinal);

  if (inicio === null || fim === null) return true;

  const agora = new Date();
  const horaBR = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(agora);
  const atual = minutosHoraRadar(horaBR);

  if (atual === null) return true;
  if (inicio === fim) return true;
  if (inicio < fim) return atual >= inicio && atual <= fim;

  return atual >= inicio || atual <= fim;
}

function totalRadarCapturadoHoje() {
  const hoje = new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

  return lerFilasRadarSomenteLeitura().filter(item => {
    if (item.origem !== "radar" && item.radar !== true) return false;

    const data = String(item.capturadaEm || item.dataEntradaRadar || item.dataEntradaFila || "");
    return data.includes(hoje);
  }).length;
}

function radarPodeCapturarAgora(configRadar = {}) {
  if (configRadar.monitoramentoAtivo === false) {
    return { ok: false, motivo: "radar_monitoramento_inativo" };
  }

  if (!radarDentroHorarioMonitoramento(configRadar)) {
    return { ok: false, motivo: "fora_do_horario_monitoramento" };
  }

  const maxPorDia = Number(configRadar.monitoramento?.maxPorDia || 0);
  if (maxPorDia > 0 && totalRadarCapturadoHoje() >= maxPorDia) {
    return { ok: false, motivo: "limite_diario_radar_atingido" };
  }

  return { ok: true };
}

function motivoRadarDebug(motivo = "") {
  const chave = String(motivo || "").trim();
  const mapa = {
    integracao_marketplace_ausente: "sem integração",
    sem_destino_compativel: "sem destino compatível",
    oferta_duplicada: "duplicada",
    oferta_repetida_na_memoria: "memória",
    limite_radar_pendente_total: "limite Radar",
    limite_radar_com_cupom: "limite Radar",
    limite_radar_sem_cupom: "limite Radar",
    limite_diario_radar_atingido: "limite Radar",
    marketplace_nao_permitido_no_plano: "marketplace bloqueado",
    marketplace_desativado_no_cliente: "marketplace bloqueado",
    fora_do_horario_monitoramento: "horário fora da janela",
    categoria_nao_permitida_radar: "categoria bloqueada",
    link_afiliado_nao_gerado: "link afiliado inválido",
    link_afiliado_igual_original: "link afiliado inválido",
    link_original_nao_resolvido: "link original não resolvido"
  };

  return mapa[chave] || chave || "motivo_nao_informado";
}

function logRadarRejeitado(motivo = "", contexto = {}) {
  console.log(`[RADAR] rejeitado: ${motivoRadarDebug(motivo)}`, {
    motivoTecnico: motivo || "",
    ...contexto
  });
}

function dataHoraRadarOferta(oferta = {}) {
  return textoRadarId(
    oferta.dataEntradaRadar ||
    oferta.capturadaEm ||
    oferta.dataCaptura ||
    oferta.dataEntradaFila ||
    oferta.criadoEm ||
    oferta.createdAt ||
    oferta.data ||
    ""
  );
}

function obterOrigemOfertaRadar(oferta = {}) {
  const origemTipoRaw =
    oferta.origemTipo ||
    oferta.tipoOrigem ||
    oferta.tipoFonte ||
    oferta.canalOrigem ||
    oferta.canal ||
    "";

  const origemGrupoId = textoRadarId(
    oferta.origemGrupoId ||
    oferta.grupoId ||
    oferta.chatId ||
    oferta.remoteJid ||
    oferta.jid ||
    ""
  );

  const origemGrupoNome = textoRadarId(
    oferta.origemGrupoNome ||
    oferta.grupoNome ||
    oferta.nomeGrupo ||
    oferta.chatNome ||
    oferta.nomeCanal ||
    oferta.canalNome ||
    ""
  );

  const origemSessaoId = textoRadarId(
    oferta.origemSessaoId ||
    oferta.sessaoId ||
    oferta.idSessao ||
    oferta.sessionId ||
    ""
  );

  const origemTipoNormalizada = normalizarTexto(origemTipoRaw);
  const origemLegada = normalizarTexto(oferta.origem || "");
  let origemTipo = "farejador";

  if (origemTipoNormalizada.includes("telegram")) {
    origemTipo = "telegram";
  } else if (origemTipoNormalizada.includes("whatsapp")) {
    origemTipo = "whatsapp";
  } else if (origemTipoNormalizada.includes("manual") || origemLegada === "manual") {
    origemTipo = "manual";
  } else if (origemTipoNormalizada.includes("farejador") || origemLegada === "farejador") {
    origemTipo = "farejador";
  } else if (origemGrupoId || origemGrupoNome || origemSessaoId) {
    origemTipo = "whatsapp";
  }

  return {
    origemGrupoId,
    origemGrupoNome,
    origemSessaoId,
    origemTipo
  };
}

function origemOfertaEstaMonitoradaRadar(oferta = {}, configRadar = {}) {
  if (!temFontesMonitoradasRadar(configRadar)) {
    return { ok: false, motivo: "radar_sem_fontes_monitoradas" };
  }

  const origem = obterOrigemOfertaRadar(oferta);
  const grupoId = chaveRadarId(origem.origemGrupoId);
  const grupoNome = chaveRadarId(origem.origemGrupoNome);
  const sessaoId = chaveRadarId(origem.origemSessaoId);

  if (!["whatsapp", "telegram"].includes(origem.origemTipo)) {
    return {
      ok: false,
      motivo: "origem_nao_monitoravel",
      origem
    };
  }

  if (!grupoId && !grupoNome) {
    return {
      ok: false,
      motivo: "oferta_sem_origem_monitorada",
      origem
    };
  }

  if (origem.origemTipo === "telegram") {
    const telegramIds = extrairIdsTelegramMonitoradosRadar(configRadar.telegramMonitorados);

    const ok = grupoId && telegramIds.has(grupoId);

    return {
      ok,
      motivo: ok ? "" : "telegram_nao_monitorado",
      origem
    };
  }

  const gruposIds = extrairIdsMonitoradosRadar(configRadar.gruposMonitorados, [
    "id",
    "grupoId",
    "value",
    "jid",
    "remoteJid",
    "nome",
    "titulo",
    "label"
  ]);

  const sessoesIds = extrairIdsMonitoradosRadar(configRadar.gruposMonitorados, [
    "sessaoId",
    "origemSessaoId",
    "sessionId"
  ]);

  const grupoMonitorado = [grupoId, grupoNome].some(chave => chave && gruposIds.has(chave));
  const sessaoMonitorada = !sessoesIds.size || (sessaoId && sessoesIds.has(sessaoId));
  const sessaoConfig = chaveRadarId(configRadar.sessaoWhatsappId);
  const sessaoConfigOk = !sessaoConfig || (sessaoId && sessaoId === sessaoConfig);
  const ok = grupoMonitorado && sessaoMonitorada && sessaoConfigOk;

  return {
    ok,
    motivo: ok ? "" : "grupo_whatsapp_nao_monitorado",
    origem
  };
}

function normalizarCupomRadar(oferta = {}) {
  const cupom = textoRadarId(oferta.cupom || oferta.codigoCupom || "").toUpperCase();
  const bloqueados = new Set([
    "VER NO APP",
    "COPIADO",
    "APPLIED",
    "APPEARANCE",
    "APPLINK",
    "CUPOM",
    "DESCONTO",
    "CONFIRA",
    "RESGATE",
    "COMPRAR",
    "COMPRE",
    "VER OFERTA",
    "PEGAR OFERTA",
    "ABRIR OFERTA",
    "BOTAO",
    "BUTTON",
    "TEMA",
    "APLICAR",
    "VALIDO"
  ]);
  const cupomConfirmado = Boolean(
    cupom &&
    !bloqueados.has(cupom) &&
    !/^(VER|CONFIRA|COMPR|PEGAR|ABRIR|APLICAR|RESGAT)/i.test(cupom) &&
    /^[A-Z0-9][A-Z0-9_-]{3,39}$/.test(cupom)
  );
  const avisoCupom = textoRadarId(oferta.avisoCupom || oferta.aviso_cupom || "");
  const possivelCupom = !cupomConfirmado && Boolean(cupom || avisoCupom);

  return {
    cupom: cupomConfirmado ? cupom : "",
    cupomConfirmado,
    possivelCupom,
    avisoCupom: cupomConfirmado
      ? avisoCupom
      : (avisoCupom || (cupom ? `Possivel cupom: ${cupom}. Conferir antes de publicar.` : ""))
  };
}

function categoriaRadarReclassificada(oferta = {}) {
  const texto = normalizarTexto([
    oferta.titulo,
    oferta.nome,
    oferta.descricao,
    oferta.termo
  ].filter(Boolean).join(" "));

  if (/mop|esfregao|rodo|vassoura|multiuso|desinfetante|detergente|desengordurante|amaciante|sabaoliquido|sabaoempo|lavaroupas|tiramanchas|alvejante|aguasanitaria|limpavidro|limpapiso|papelhigienico|kitlimpeza|refilmop|esponjalimpeza/.test(texto)) {
    return "Limpeza";
  }

  if (/processadordealimentos|multiprocessador|liquidificador|mixer|batedeira/.test(texto)) {
    return "Eletroport\u00e1teis";
  }

  return classificarCategoriaOferta({
    ...oferta,
    categoria: "",
    categoriaProduto: ""
  }, oferta.titulo || oferta.nome || oferta.termo || "");
}

function chaveDuplicidadeRadar(oferta = {}) {
  const titulo = normalizarTexto(oferta.titulo || oferta.nome || "");
  const links = [
    oferta.linkOriginal,
    oferta.linkAfiliado,
    oferta.link,
    oferta.linkFinal
  ]
    .map(link => textoRadarId(link).toLowerCase())
    .filter(Boolean);

  return [
    ...links.map(link => `link:${link}`),
    titulo ? `titulo:${titulo}` : ""
  ].filter(Boolean);
}

function deduplicarOportunidadesRadar(oportunidades = []) {
  const vistos = new Set();
  const unicas = [];

  for (const oportunidade of oportunidades) {
    const chaves = chaveDuplicidadeRadar(oportunidade);
    if (chaves.some(chave => vistos.has(chave))) continue;

    for (const chave of chaves) {
      vistos.add(chave);
    }

    unicas.push(oportunidade);
  }

  return unicas;
}

function validarSessaoRadarCliente(clienteId = "admin", sessaoWhatsappId = "") {
  const sessaoInformada = String(sessaoWhatsappId || "").trim();

  if (!sessaoInformada) {
    return { ok: true, sessaoWhatsappId: "" };
  }

  const sessaoNormalizada = normalizarSessaoId(clienteId, sessaoInformada);
  const existe =
    sessoesMeta[sessaoInformada] ||
    sessoesMeta[sessaoNormalizada] ||
    statusSessao[sessaoInformada] ||
    statusSessao[sessaoNormalizada] ||
    sessoes[sessaoInformada] ||
    sessoes[sessaoNormalizada];

  if (!existe) {
    return { ok: false, motivo: "sessao_whatsapp_nao_encontrada" };
  }

  return {
    ok: true,
    sessaoWhatsappId: sessoesMeta[sessaoInformada] || statusSessao[sessaoInformada] || sessoes[sessaoInformada]
      ? sessaoInformada
      : sessaoNormalizada
  };
}

function normalizarMarketplaceRadar(marketplace = "") {
  const mp = normalizarTexto(marketplace || "");
  return mp === "kabum" ? "awin" : mp;
}

function destinosClienteNormalizados(clienteId = "admin") {
  const destinosCliente = destinosPorCliente?.[clienteId];

  if (Array.isArray(destinosCliente)) {
    return destinosCliente;
  }

  return Object.values(destinosCliente || {})
    .filter(Array.isArray)
    .flat();
}

function obterClienteIdAdminMaster() {
  return usuarios.find(u => u?.ativo !== false && u.papel === "admin_master")?.id || "admin";
}

function carregarRadarConfigAdminMaster() {
  return carregarRadarConfigCliente(obterClienteIdAdminMaster());
}

function extrairMensagemInternaRadar(conteudo = {}) {
  return (
    conteudo.ephemeralMessage?.message ||
    conteudo.viewOnceMessage?.message ||
    conteudo.viewOnceMessageV2?.message ||
    conteudo.documentWithCaptionMessage?.message ||
    conteudo
  );
}

function extrairTextoMensagemRadar(mensagem = {}) {
  const conteudo = extrairMensagemInternaRadar(mensagem.message || {});

  return [
    conteudo.conversation,
    conteudo.extendedTextMessage?.text,
    conteudo.imageMessage?.caption,
    conteudo.videoMessage?.caption,
    conteudo.documentMessage?.caption,
    conteudo.buttonsResponseMessage?.selectedDisplayText,
    conteudo.listResponseMessage?.title,
    conteudo.templateButtonReplyMessage?.selectedDisplayText
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function limparLinkRadar(link = "") {
  return String(link || "")
    .trim()
    .replace(/[)\].,;!?]+$/g, "");
}

function extrairLinksRadar(texto = "") {
  const encontrados = String(texto || "").match(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi) || [];
  const unicos = new Set();

  for (const link of encontrados) {
    const limpo = limparLinkRadar(link);
    if (!limpo) continue;

    unicos.add(limpo.startsWith("www.") ? `https://${limpo}` : limpo);
  }

  return [...unicos];
}

function obterNomeGrupoRadar(sessaoId = "", grupoId = "") {
  const grupos = gruposPorSessao[sessaoId] || [];
  const grupo = grupos.find(g =>
    [g.id, g.grupoId, g.value, g.jid, g.remoteJid]
      .filter(Boolean)
      .some(valor => String(valor) === String(grupoId))
  );

  return grupo?.nome || grupo?.name || grupo?.subject || grupo?.titulo || grupo?.label || "";
}

function detectarMarketplaceRadarLink(url = "") {
  const urlLower = String(url || "").toLowerCase();

  if (urlLower.includes("mercadolivre.com") || urlLower.includes("mercadolivre.com.br") || urlLower.includes("meli.la")) {
    return "mercadolivre";
  }

  if (urlLower.includes("shopee.com")) {
    return "shopee";
  }

  if (urlLower.includes("amazon.") || urlLower.includes("amzn.to")) {
    return "amazon";
  }

  if (urlLower.includes("aliexpress.")) {
    return "aliexpress";
  }

  if (urlLower.includes("kabum.com.br")) {
    return "kabum";
  }

  if (urlLower.includes("awin1.com") || urlLower.includes("awin.com")) {
    return "awin";
  }

  return detectarMarketplaceManual(url, "");
}

function extrairAmazonAsinRadar(pathname = "") {
  const match = String(pathname || "").match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return match?.[1] || "";
}

function limparUrlProdutoRadar(url = "", marketplace = "") {
  const mp = normalizarMarketplaceRadar(marketplace || detectarMarketplaceRadarLink(url));

  try {
    const parsed = new URL(url);
    parsed.hash = "";

    if (mp === "amazon") {
      const asin = extrairAmazonAsinRadar(parsed.pathname);
      if (!asin) return "";
      parsed.pathname = `/dp/${asin}`;
      parsed.search = "";
      return parsed.toString();
    }

    if (mp === "shopee") {
      parsed.search = "";
      return parsed.toString();
    }

    if (mp === "mercadolivre") {
      parsed.search = "";
      return parsed.toString();
    }

    if (mp === "aliexpress") {
      const itemMatch = parsed.pathname.match(/\/item\/(\d+)\.html/i);
      if (itemMatch?.[1]) {
        parsed.pathname = `/item/${itemMatch[1]}.html`;
      }
      parsed.search = "";
      return parsed.toString();
    }

    if (mp === "kabum" || mp === "awin") {
      parsed.search = "";
      return parsed.toString();
    }

    parsed.search = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

async function resolverLinkOriginalRadar(url = "") {
  const capturada = limparLinkRadar(url);

  if (!capturada) {
    return { ok: false, motivo: "link_original_nao_resolvido" };
  }

  try {
    const resposta = await axios.get(capturada, {
      maxRedirects: 5,
      timeout: 7000,
      validateStatus: () => true,
      responseType: "stream",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OptimusRadar/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    if (resposta.data?.destroy) resposta.data.destroy();
    const resolvida =
      resposta?.request?.res?.responseUrl ||
      resposta?.request?._redirectable?._currentUrl ||
      capturada;
    const marketplaceReal = detectarMarketplaceRadarLink(resolvida);
    const linkOriginalLimpo = marketplaceReal
      ? limparUrlProdutoRadar(resolvida, marketplaceReal)
      : "";

    if (!resolvida || !marketplaceReal || marketplaceReal === "awin" || !linkOriginalLimpo) {
      return {
        ok: false,
        motivo: "link_original_nao_resolvido",
        urlCapturada: capturada,
        urlResolvida: resolvida || "",
        marketplaceReal: marketplaceReal || ""
      };
    }

    return {
      ok: true,
      urlCapturada: capturada,
      urlResolvida: resolvida,
      marketplaceReal,
      linkOriginalLimpo
    };
  } catch (e) {
    return {
      ok: false,
      motivo: "link_original_nao_resolvido",
      urlCapturada: capturada,
      erro: e.message
    };
  }
}

async function importarOfertaRadarPorLink(url = "", contexto = {}) {
  const adminMasterId = obterClienteIdAdminMaster();
  const resolucao = await resolverLinkOriginalRadar(url);

  if (!resolucao.ok) {
    return {
      ok: false,
      motivo: resolucao.motivo || "link_original_nao_resolvido",
      resolucao
    };
  }

  const marketplaceDetectado = resolucao.marketplaceReal;
  const linkOriginalLimpo = resolucao.linkOriginalLimpo;

  try {
    if (marketplaceDetectado === "kabum") {
      const produtoKabum = await importarProdutoKabumViaAwin(linkOriginalLimpo, adminMasterId, {
        gerarDeepLinkAwin
      });

      return {
        ok: true,
        resolucao,
        oferta: {
          ...produtoKabum,
          marketplace: produtoKabum.marketplace || "kabum",
          linkOriginal: linkOriginalLimpo,
          linkCapturado: resolucao.urlCapturada,
          linkResolvidoRadar: resolucao.urlResolvida,
          origem: "radar",
          radar: true,
          status: "rascunho"
        }
      };
    }

    const resultado = await importarProdutoManual({
      clienteId: adminMasterId,
      headers: {},
      body: {
        url: linkOriginalLimpo,
        marketplace: marketplaceDetectado
      }
    }, {
      getClienteId,
      integracoesPorCliente,
      getIntegracaoCliente,
      importarAmazon,
      importarAliExpress,
      importarMagalu,
      importarMercadoLivre,
      importarShopee,
      gerarLinkAfiliadoMercadoLivre
    });

    if (resultado.status >= 400 || resultado.body?.ok === false) {
      return {
        ok: false,
        motivo: resultado.body?.erro || "importacao_falhou",
        resolucao
      };
    }

    return {
      ok: true,
      resolucao,
      oferta: {
        ...(resultado.body || {}),
        marketplace: resultado.body?.marketplace || marketplaceDetectado,
        linkOriginal: linkOriginalLimpo,
        linkCapturado: resolucao.urlCapturada,
        linkResolvidoRadar: resolucao.urlResolvida,
        origem: "radar",
        radar: true,
        status: "rascunho"
      }
    };
  } catch (e) {
    return {
      ok: false,
      motivo: e.message || "erro_importacao_radar",
      resolucao,
      contexto
    };
  }
}

async function adicionarRadarCapturadoNaFilaClientes(ofertaBase = {}, opcoes = {}) {
  const resultados = [];
  const radarConfigFontes = opcoes.radarConfigFontes || carregarRadarConfigAdminMaster();
  const clientesAtivos = usuarios.filter(usuario => usuario?.ativo);

  console.log("[RADAR] clientes elegíveis encontrados:", clientesAtivos.length);

  for (const usuario of clientesAtivos) {
    const clienteId = usuario.id;

    console.log("[RADAR] cliente analisado:", clienteId);

    const resultado = await adicionarRadarNaFilaCliente(ofertaBase, clienteId, {
      radarConfigFontes
    });

    if (!resultado.ok || !resultado.adicionada) {
      logRadarRejeitado(resultado.motivo || "nao_adicionada", {
        clienteId
      });
    } else {
      console.log(`[RADAR] ADICIONADA FILA clienteId=${clienteId}`);
    }

    resultados.push({
      clienteId,
      ok: !!resultado.ok,
      motivo: resultado.motivo || "",
      adicionada: !!resultado.adicionada
    });
  }

  return resultados;
}

async function processarMensagemRadar({
  origemTipo,
  sessaoId,
  grupoId,
  grupoNome,
  texto,
  capturadaEm,
  raw
} = {}) {
  const tipo = normalizarTexto(origemTipo || "");
  const origemTipoFinal = tipo.includes("telegram") ? "telegram" : tipo.includes("whatsapp") ? "whatsapp" : "";
  const grupoIdTexto = textoRadarId(grupoId);
  const grupoNomeTexto = textoRadarId(grupoNome);
  const sessaoIdTexto = textoRadarId(sessaoId || (origemTipoFinal === "telegram" ? "telegram" : ""));

  console.log("[RADAR] mensagem recebida", {
    origemTipo: origemTipoFinal || origemTipo,
    sessaoId: sessaoIdTexto,
    grupoId: grupoIdTexto,
    grupoNome: grupoNomeTexto,
    tamanhoTexto: String(texto || "").length
  });

  if (!["whatsapp", "telegram"].includes(origemTipoFinal)) {
    logRadarRejeitado("origem_tipo_invalida", {
      origemTipo
    });
    return { ok: false, motivo: "origem_tipo_invalida" };
  }

  if (!grupoIdTexto) {
    logRadarRejeitado("grupo_ou_chat_ausente", {
      origemTipo: origemTipoFinal
    });
    return { ok: false, motivo: "grupo_ou_chat_ausente" };
  }

  const links = extrairLinksRadar(texto);
  console.log(`[RADAR] links detectados: ${links.length}`, {
    origemTipo: origemTipoFinal,
    grupo: grupoNomeTexto || grupoIdTexto
  });

  if (!links.length) {
    logRadarRejeitado("sem_links", {
      origemTipo: origemTipoFinal,
      grupo: grupoNomeTexto || grupoIdTexto
    });
    return { ok: false, motivo: "sem_links" };
  }

  const adminMasterId = obterClienteIdAdminMaster();
  const radarConfig = carregarRadarConfigCliente(adminMasterId);
  const capturaPermitida = radarPodeCapturarAgora(radarConfig);

  if (!capturaPermitida.ok) {
    logRadarRejeitado(capturaPermitida.motivo, {
      origemTipo: origemTipoFinal,
      grupo: grupoNomeTexto || grupoIdTexto
    });
    return capturaPermitida;
  }

  const origemBase = {
    origemTipo: origemTipoFinal,
    origemGrupoId: grupoIdTexto,
    origemGrupoNome: grupoNomeTexto,
    origemSessaoId: sessaoIdTexto,
    grupoId: grupoIdTexto,
    grupoNome: grupoNomeTexto,
    chatId: origemTipoFinal === "telegram" ? grupoIdTexto : "",
    sessaoId: sessaoIdTexto
  };
  const origemMonitorada = origemOfertaEstaMonitoradaRadar(origemBase, radarConfig);

  if (!origemMonitorada.ok) {
    logRadarRejeitado(origemMonitorada.motivo, {
      origemTipo: origemTipoFinal,
      grupo: grupoNomeTexto || grupoIdTexto
    });
    return { ok: false, motivo: origemMonitorada.motivo };
  }

  console.log("[RADAR] grupo monitorado confirmado", {
    origemTipo: origemTipoFinal,
    sessaoId: sessaoIdTexto,
    grupoId: grupoIdTexto,
    grupoNome: grupoNomeTexto
  });

  const resultados = [];
  const dataCaptura = capturadaEm || new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

  for (const link of links) {
    console.log("[RADAR] link capturado", { url: link });

    const importacao = await importarOfertaRadarPorLink(link, {
      origemTipo: origemTipoFinal,
      sessaoId: sessaoIdTexto,
      grupoId: grupoIdTexto,
      grupoNome: grupoNomeTexto
    });

    if (!importacao.ok) {
      console.log("[RADAR] importação falhou:", {
        motivo: importacao.motivo || "importacao_falhou",
        link,
        urlResolvida: importacao.resolucao?.urlResolvida || "",
        marketplace: importacao.resolucao?.marketplaceReal || ""
      });
      logRadarRejeitado(importacao.motivo || "importacao_falhou", {
        link,
        urlResolvida: importacao.resolucao?.urlResolvida || "",
        marketplace: importacao.resolucao?.marketplaceReal || ""
      });
      resultados.push({ link, ok: false, motivo: importacao.motivo });
      continue;
    }

    console.log("[RADAR] URL resolvida", {
      capturada: importacao.resolucao?.urlCapturada || link,
      resolvida: importacao.resolucao?.urlResolvida || ""
    });
    console.log("[RADAR] marketplace real", {
      marketplace: importacao.resolucao?.marketplaceReal || importacao.oferta?.marketplace || ""
    });
    console.log("[RADAR] link original limpo", {
      linkOriginal: importacao.resolucao?.linkOriginalLimpo || importacao.oferta?.linkOriginal || ""
    });
    console.log("[RADAR] importação sucesso", {
      link,
      marketplace: importacao.oferta?.marketplace || importacao.resolucao?.marketplaceReal || "",
      titulo: importacao.oferta?.titulo || importacao.oferta?.nome || ""
    });

    const ofertaRadar = prepararOfertaGlobal({
      ...importacao.oferta,
      ...origemBase,
      origemClienteId: adminMasterId,
      origem: "radar",
      origemTipo: origemTipoFinal,
      radar: true,
      linkOriginal: importacao.resolucao?.linkOriginalLimpo || importacao.oferta.linkOriginal,
      linkCapturado: importacao.resolucao?.urlCapturada || link,
      linkResolvidoRadar: importacao.resolucao?.urlResolvida || importacao.oferta.linkResolvidoRadar || "",
      mensagemOriginalRadar: texto.slice(0, 1000),
      capturadaEm: dataCaptura,
      dataEntradaRadar: dataCaptura
    });

    const clientes = await adicionarRadarCapturadoNaFilaClientes(ofertaRadar, {
      radarConfigFontes: radarConfig
    });

    resultados.push({
      link,
      ok: true,
      marketplace: ofertaRadar.marketplace,
      clientes
    });
  }

  const adicionadas = resultados.reduce((total, item) =>
    total + (item.clientes || []).filter(cliente => cliente.adicionada).length,
    0
  );

  if (resultados.length) {
    console.log("[RADAR] Mensagem monitorada processada:", {
      origemTipo: origemTipoFinal,
      sessaoId: sessaoIdTexto,
      grupo: grupoNomeTexto || grupoIdTexto,
      links: links.length,
      adicionadas
    });
  }

  return {
    ok: true,
    links: links.length,
    adicionadas,
    resultados
  };
}

async function processarMensagemRadarAutomatica({ mensagem, sessaoId, sock } = {}) {
  const remoteJid = mensagem?.key?.remoteJid || "";

  if (!remoteJid || !remoteJid.endsWith("@g.us") || mensagem?.key?.fromMe) {
    return { ok: false, motivo: "mensagem_nao_monitoravel" };
  }

  return processarMensagemRadar({
    origemTipo: "whatsapp",
    sessaoId,
    grupoId: remoteJid,
    grupoNome: obterNomeGrupoRadar(sessaoId, remoteJid),
    texto: extrairTextoMensagemRadar(mensagem),
    raw: mensagem
  });
}

function normalizarMensagemTelegramRadar(payload = {}) {
  const mensagem =
    payload.message ||
    payload.channel_post ||
    payload.edited_message ||
    payload.edited_channel_post ||
    payload;
  const chat = mensagem.chat || payload.chat || {};
  const grupoId = textoRadarId(
    payload.grupoId ||
    payload.chatId ||
    chat.id ||
    mensagem.chatId ||
    ""
  );
  const grupoNome = textoRadarId(
    payload.grupoNome ||
    payload.nome ||
    chat.title ||
    chat.username ||
    chat.first_name ||
    ""
  );
  const texto = textoRadarId(
    payload.texto ||
    payload.text ||
    mensagem.text ||
    mensagem.caption ||
    ""
  );

  return {
    origemTipo: "telegram",
    sessaoId: "telegram",
    grupoId,
    grupoNome,
    texto,
    capturadaEm: payload.capturadaEm || new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo"
    }),
    raw: payload
  };
}

function clienteAceitaMarketplaceAtivo(clienteId = "admin", marketplace = "") {
  const configCliente = configsPorCliente?.[clienteId] || {};
  const regraCliente = configCliente.marketplaces?.[marketplace];

  return regraCliente?.ativo !== false;
}

function existeDestinoCompativelRadar(clienteId = "admin", oferta = {}) {
  const destinosCliente = destinosClienteNormalizados(clienteId);

  return destinosCliente.some(destino =>
    destinoAceitaOferta(destino, oferta)
  );
}

async function prepararOfertaRadarParaCliente(ofertaBase = {}, clienteId = "admin", opcoes = {}) {
  const usuario = usuarios.find(u => String(u.id) === String(clienteId));

  if (!usuario || usuario.ativo === false) {
    return { ok: false, motivo: "cliente_inativo_ou_inexistente" };
  }

  const radarConfig = opcoes.radarConfigFontes || carregarRadarConfigAdminMaster();
  const origemMonitorada = origemOfertaEstaMonitoradaRadar(ofertaBase, radarConfig);

  if (!origemMonitorada.ok) {
    return { ok: false, motivo: origemMonitorada.motivo };
  }

  let ofertaPreparada = prepararOfertaGlobal({
    ...(ofertaBase || {}),
    ...origemMonitorada.origem
  });
  const cupomRadar = normalizarCupomRadar(ofertaPreparada);
  ofertaPreparada.cupom = cupomRadar.cupom;
  ofertaPreparada.avisoCupom = cupomRadar.avisoCupom;
  ofertaPreparada.cupomConfirmado = cupomRadar.cupomConfirmado;
  ofertaPreparada.possivelCupom = cupomRadar.possivelCupom;
  ofertaPreparada.categoria = categoriaRadarReclassificada(ofertaPreparada);

  const categoriasPermitidas = Array.isArray(radarConfig.categoriasPermitidas)
    ? radarConfig.categoriasPermitidas
    : [];

  if (categoriasPermitidas.length) {
    const categoriaOferta = normalizarTexto(ofertaPreparada.categoria || "");
    const permitido = categoriasPermitidas.some(categoria =>
      normalizarTexto(categoria) === categoriaOferta
    );

    if (!permitido) {
      return { ok: false, motivo: "categoria_nao_permitida_radar" };
    }
  }

  const marketplaceOriginal = normalizarTexto(
    ofertaPreparada.marketplace ||
    ofertaPreparada.mercado ||
    ofertaBase.marketplace ||
    ""
  );
  const marketplace = normalizarMarketplaceRadar(marketplaceOriginal);

  if (!marketplace) {
    return { ok: false, motivo: "marketplace_ausente" };
  }

  ofertaPreparada.marketplace = marketplace;

  if (marketplaceOriginal && marketplaceOriginal !== marketplace) {
    ofertaPreparada.marketplaceOriginalRadar = marketplaceOriginal;
  }

  if (!usuarioPodeReceberMarketplace(usuario, marketplace)) {
    return { ok: false, motivo: "marketplace_nao_permitido_no_plano" };
  }

  if (!clienteAceitaMarketplaceAtivo(clienteId, marketplace)) {
    return { ok: false, motivo: "marketplace_desativado_no_cliente" };
  }

  if (!usuarioTemIntegracaoMarketplace(clienteId, marketplace)) {
    return { ok: false, motivo: "integracao_marketplace_ausente" };
  }

  const radar = avaliarOfertaRadar(ofertaPreparada);
  const temCupomForte = cupomRadar.cupomConfirmado;
  const tipoRadar = temCupomForte ? "radarComCupom" : "radarSemCupom";
  const prioridadeFila = temCupomForte ? 80 : 40;
  const linkOriginal =
    ofertaPreparada.linkOriginal ||
    ofertaPreparada.link ||
    ofertaPreparada.linkAfiliado ||
    "";

  console.log("[RADAR] score", {
    clienteId,
    score: radar.radarScore,
    nivel: radar.nivel,
    decisao: radar.decisao
  });
  console.log("[RADAR] tipoRadar", {
    clienteId,
    tipoRadar
  });

  if (!linkOriginal) {
    console.log("[RADAR] aprovado/reprovado", {
      clienteId,
      aprovado: false,
      motivo: "link_original_ausente"
    });
    return { ok: false, motivo: "link_original_ausente" };
  }

  const linkAfiliadoCliente = await gerarLinkAfiliadoCliente(
    clienteId,
    marketplace,
    linkOriginal,
    ofertaPreparada
  );

  if (!linkAfiliadoCliente) {
    console.log("[RADAR] aprovado/reprovado", {
      clienteId,
      aprovado: false,
      motivo: "link_afiliado_nao_gerado"
    });
    return { ok: false, motivo: "link_afiliado_nao_gerado" };
  }

  if (String(linkAfiliadoCliente).trim() === String(linkOriginal).trim()) {
    console.log("[RADAR] aprovado/reprovado", {
      clienteId,
      aprovado: false,
      motivo: "link_afiliado_igual_original"
    });
    return { ok: false, motivo: "link_afiliado_igual_original" };
  }

  console.log("[RADAR] link afiliado cliente gerado", {
    clienteId,
    marketplace,
    linkOriginal,
    linkAfiliado: linkAfiliadoCliente
  });

  const agoraBR = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

  const ofertaCliente = {
    ...ofertaPreparada,
    clienteId,
    origem: "radar",
    radar: true,
    tipoRadar,
    prioridadeFila,
    marketplace,
    linkOriginal,
    linkAfiliado: linkAfiliadoCliente,
    link: linkAfiliadoCliente,
    linkFinal: linkAfiliadoCliente,
    status: "pendente",
    statusDetalhe: temCupomForte
      ? "Radar: cupom detectado"
      : cupomRadar.possivelCupom
      ? "Radar: possivel cupom, conferir"
      : "Radar: oportunidade",
    origemGrupoId: origemMonitorada.origem.origemGrupoId,
    origemGrupoNome: origemMonitorada.origem.origemGrupoNome,
    origemSessaoId: origemMonitorada.origem.origemSessaoId,
    origemTipo: origemMonitorada.origem.origemTipo,
    coletadoDe: origemMonitorada.origem.origemGrupoNome || origemMonitorada.origem.origemGrupoId,
    cupomConfirmado: cupomRadar.cupomConfirmado,
    possivelCupom: cupomRadar.possivelCupom,
    destinosEnviados: [],
    logsEnvio: [],
    enviadoEm: "",
    dataEnvio: "",
    radarScore: radar.radarScore,
    radarNivel: radar.nivel,
    radarDecisao: radar.decisao,
    radarMotivos: radar.motivos,
    radarAlertas: radar.alertas,
    dataEntradaRadar: agoraBR,
    capturadaEm: ofertaPreparada.capturadaEm || agoraBR,
    dataEntradaFila: agoraBR,
    criadoEm: ofertaPreparada.criadoEm || agoraBR
  };

  if (!existeDestinoCompativelRadar(clienteId, ofertaCliente)) {
    console.log("[RADAR] aprovado/reprovado", {
      clienteId,
      aprovado: false,
      motivo: "sem_destino_compativel"
    });
    return { ok: false, motivo: "sem_destino_compativel" };
  }

  if (ofertaJaExiste(ofertaCliente)) {
    console.log("[RADAR] aprovado/reprovado", {
      clienteId,
      aprovado: false,
      motivo: "oferta_duplicada"
    });
    return { ok: false, motivo: "oferta_duplicada" };
  }

  if (deveIgnorarOfertaRepetida(ofertaCliente)) {
    console.log("[RADAR] aprovado/reprovado", {
      clienteId,
      aprovado: false,
      motivo: "oferta_repetida_na_memoria"
    });
    return { ok: false, motivo: "oferta_repetida_na_memoria" };
  }

  console.log("[RADAR] aprovado/reprovado", {
    clienteId,
    aprovado: true,
    decisao: radar.decisao
  });

  return { ok: true, oferta: ofertaCliente };
}

async function adicionarRadarNaFilaCliente(ofertaBase = {}, clienteId = "admin", opcoes = {}) {
  const preparado = await prepararOfertaRadarParaCliente(ofertaBase, clienteId, opcoes);

  if (!preparado.ok) {
    return preparado;
  }

  const oferta = preparado.oferta;
  const pendentesRadar = fila.filter(item =>
    String(item.clienteId || "admin") === String(clienteId) &&
    item.status === "pendente" &&
    item.origem === "radar"
  );

  const totalRadar = pendentesRadar.length;
  const totalComCupom = pendentesRadar.filter(item =>
    item.tipoRadar === "radarComCupom"
  ).length;
  const totalSemCupom = pendentesRadar.filter(item =>
    item.tipoRadar === "radarSemCupom"
  ).length;

  if (totalRadar >= 10) {
    console.log("[RADAR] aprovado/reprovado", {
      clienteId,
      aprovado: false,
      motivo: "limite_radar_pendente_total"
    });
    return { ok: false, motivo: "limite_radar_pendente_total" };
  }

  if (oferta.tipoRadar === "radarComCupom" && totalComCupom >= 4) {
    console.log("[RADAR] aprovado/reprovado", {
      clienteId,
      aprovado: false,
      motivo: "limite_radar_com_cupom"
    });
    return { ok: false, motivo: "limite_radar_com_cupom" };
  }

  if (oferta.tipoRadar === "radarSemCupom" && totalSemCupom >= 6) {
    console.log("[RADAR] aprovado/reprovado", {
      clienteId,
      aprovado: false,
      motivo: "limite_radar_sem_cupom"
    });
    return { ok: false, motivo: "limite_radar_sem_cupom" };
  }

  fila.push(oferta);
  registrarOfertaVista(oferta);
  salvarFila(clienteId);

  return {
    ok: true,
    adicionada: true,
    oferta
  };
}

app.get("/radar/config", (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        erro: "Acesso restrito ao admin_master"
      });
    }

    const clienteId = getClienteId(req);

    if (!clienteId) {
      return res.status(401).json({
        ok: false,
        erro: "Cliente nao autenticado"
      });
    }

    const radarConfig = carregarRadarConfigCliente(clienteId);
    const sessoesWhatsapp = listarSessoesWhatsappCliente(clienteId);
    const telegramDisponiveis = listarTelegramRadarCliente(clienteId);

    return res.json({
      monitoramentoAtivo: radarConfig.monitoramentoAtivo,
      sessaoWhatsappId: radarConfig.sessaoWhatsappId,
      gruposMonitorados: radarConfig.gruposMonitorados,
      telegramMonitorados: radarConfig.telegramMonitorados,
      monitoramento: radarConfig.monitoramento,
      categoriasPermitidas: radarConfig.categoriasPermitidas,
      templateMidia: radarConfig.templateMidia,
      sessoesWhatsapp,
      sessoes: sessoesWhatsapp,
      telegramDisponiveis,
      telegram: telegramDisponiveis
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.post("/radar/config", (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        erro: "Acesso restrito ao admin_master"
      });
    }

    const clienteId = getClienteId(req);

    if (!clienteId) {
      return res.status(401).json({
        ok: false,
        erro: "Cliente nao autenticado"
      });
    }

    const body = req.body || {};
    const possuiCampo = campo => Object.prototype.hasOwnProperty.call(body, campo);
    const gruposMonitorados = body.gruposMonitorados;
    const telegramMonitorados = body.telegramMonitorados;

    if (possuiCampo("gruposMonitorados") && !Array.isArray(gruposMonitorados)) {
      return res.status(400).json({
        ok: false,
        erro: "gruposMonitorados deve ser array"
      });
    }

    if (possuiCampo("telegramMonitorados") && !Array.isArray(telegramMonitorados)) {
      return res.status(400).json({
        ok: false,
        erro: "telegramMonitorados deve ser array"
      });
    }

    if (possuiCampo("monitoramento") && (!body.monitoramento || typeof body.monitoramento !== "object" || Array.isArray(body.monitoramento))) {
      return res.status(400).json({
        ok: false,
        erro: "monitoramento deve ser objeto"
      });
    }

    if (possuiCampo("categoriasPermitidas") && !Array.isArray(body.categoriasPermitidas)) {
      return res.status(400).json({
        ok: false,
        erro: "categoriasPermitidas deve ser array"
      });
    }

    if (possuiCampo("templateMidia") && (!body.templateMidia || typeof body.templateMidia !== "object" || Array.isArray(body.templateMidia))) {
      return res.status(400).json({
        ok: false,
        erro: "templateMidia deve ser objeto"
      });
    }

    const dadosConfig = {};

    if (possuiCampo("monitoramentoAtivo")) {
      dadosConfig.monitoramentoAtivo = body.monitoramentoAtivo !== false;
    }

    if (possuiCampo("sessaoWhatsappId")) {
      const sessaoValidada = validarSessaoRadarCliente(
        clienteId,
        body.sessaoWhatsappId
      );

      if (!sessaoValidada.ok) {
        return res.status(400).json({
          ok: false,
          erro: sessaoValidada.motivo
        });
      }

      dadosConfig.sessaoWhatsappId = sessaoValidada.sessaoWhatsappId;
    }

    if (possuiCampo("gruposMonitorados")) dadosConfig.gruposMonitorados = gruposMonitorados;
    if (possuiCampo("telegramMonitorados")) dadosConfig.telegramMonitorados = telegramMonitorados;
    if (possuiCampo("monitoramento")) dadosConfig.monitoramento = body.monitoramento;
    if (possuiCampo("categoriasPermitidas")) dadosConfig.categoriasPermitidas = body.categoriasPermitidas;
    if (possuiCampo("templateMidia")) dadosConfig.templateMidia = body.templateMidia;

    const radarConfig = salvarRadarConfigCliente(clienteId, dadosConfig);

    return res.json({
      ok: true,
      monitoramentoAtivo: radarConfig.monitoramentoAtivo,
      sessaoWhatsappId: radarConfig.sessaoWhatsappId,
      gruposMonitorados: radarConfig.gruposMonitorados,
      telegramMonitorados: radarConfig.telegramMonitorados,
      monitoramento: radarConfig.monitoramento,
      categoriasPermitidas: radarConfig.categoriasPermitidas,
      templateMidia: radarConfig.templateMidia
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

// Endpoint interno para plugar webhook/polling Telegram futuramente.
// Requer Bearer token de admin_master e processa somente chats ativos em telegramMonitorados.
app.post("/radar/telegram/inbound", async (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        motivo: "acesso_restrito_admin_master"
      });
    }

    const entrada = normalizarMensagemTelegramRadar(req.body || {});

    if (!entrada.grupoId) {
      return res.status(400).json({
        ok: false,
        motivo: "telegram_chat_id_obrigatorio"
      });
    }

    if (!entrada.texto) {
      return res.status(400).json({
        ok: false,
        motivo: "telegram_texto_obrigatorio"
      });
    }

    const resultado = await processarMensagemRadar(entrada);

    return res.json({
      ok: !!resultado.ok,
      origemTipo: "telegram",
      motivo: resultado.motivo || "",
      links: resultado.links || 0,
      adicionadas: resultado.adicionadas || 0,
      resultados: resultado.resultados || []
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      motivo: e.message
    });
  }
});

app.get("/radar", (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        erro: "Acesso restrito ao admin_master"
      });
    }

    const clienteId = String(req.query?.clienteId || getClienteId(req) || "admin");
    const radarConfig = carregarRadarConfigCliente(clienteId);

    if (!temFontesMonitoradasRadar(radarConfig)) {
      return res.json({
        ok: true,
        total: 0,
        aviso: "Nenhum grupo monitorado configurado para o Radar.",
        clienteId,
        oportunidades: []
      });
    }

    const oportunidades = deduplicarOportunidadesRadar(lerFilasRadarSomenteLeitura()
      .filter((oferta) => String(oferta.origemClienteId || oferta.clienteId || "admin") === clienteId)
      .filter((oferta) => origemOfertaEstaMonitoradaRadar(oferta, radarConfig).ok)
      .map((oferta) => {
        const origem = obterOrigemOfertaRadar(oferta);
        const cupomRadar = normalizarCupomRadar(oferta);
        const categoria = categoriaRadarReclassificada(oferta);
        const dataEntradaRadar = dataHoraRadarOferta(oferta);
        const capturadaEm = dataHoraRadarOferta({
          capturadaEm: oferta.capturadaEm,
          dataEntradaRadar,
          dataEntradaFila: oferta.dataEntradaFila,
          criadoEm: oferta.criadoEm
        });
        const ofertaRadar = {
          ...oferta,
          categoria,
          categoriaProduto: "",
          cupom: cupomRadar.cupom,
          avisoCupom: cupomRadar.avisoCupom,
          cupomConfirmado: cupomRadar.cupomConfirmado,
          possivelCupom: cupomRadar.possivelCupom
        };
        const radar = avaliarOfertaRadar(ofertaRadar, {
          termo: oferta.titulo || oferta.nome || "",
          possivelRepeticao: oferta.possivelRepeticao
        });

        return {
          id: oferta.id || "",
          titulo: oferta.titulo || oferta.nome || "",
          dataEntradaRadar,
          capturadaEm,
          imagem: oferta.imagem || "",
          marketplace: oferta.marketplace || oferta.mercado || "",
          categoria: radar.categoria,
          precoAtual: oferta.precoAtual || oferta.preco || "",
          precoAntigo: oferta.precoAntigo || "",
          descontoPercentual: radar.descontoPercentual,
          cupom: cupomRadar.cupom,
          avisoCupom: cupomRadar.avisoCupom,
          cupomConfirmado: cupomRadar.cupomConfirmado,
          possivelCupom: cupomRadar.possivelCupom,
          linkOriginal: oferta.linkOriginal || "",
          link: oferta.link || "",
          linkAfiliado: oferta.linkAfiliado || "",
          radar: {
            radarScore: radar.radarScore,
            nivel: radar.nivel,
            motivos: radar.motivos,
            alertas: radar.alertas,
            decisao: radar.decisao
          },
          origemClienteId: oferta.origemClienteId || oferta.clienteId || "admin",
          origemGrupoId: origem.origemGrupoId,
          origemGrupoNome: origem.origemGrupoNome,
          origemSessaoId: origem.origemSessaoId,
          origemTipo: origem.origemTipo,
          coletadoDe: origem.origemGrupoNome || origem.origemGrupoId,
          statusFila: oferta.status || ""
        };
      })
      .sort((a, b) => (b.radar.radarScore || 0) - (a.radar.radarScore || 0)));

    return res.json({
      ok: true,
      total: oportunidades.length,
      clienteId,
      oportunidades: oportunidades.slice(0, 50)
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.post("/radar/adicionar-fila", async (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        motivo: "acesso_restrito_admin_master"
      });
    }

    const clienteId = String(req.body?.clienteId || "admin");
    const oferta = req.body?.oferta || {};

    const resultado = await adicionarRadarNaFilaCliente(oferta, clienteId);

    if (!resultado.ok) {
      return res.json({
        ok: false,
        motivo: resultado.motivo
      });
    }

    return res.json({
      ok: true,
      adicionada: true,
      oferta: resultado.oferta
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      motivo: e.message
    });
  }
});

// =============== ROTA DO MENSAGEIRO =================

app.use("/mensageiro", criarRotasMensageiro({
  getClienteId,
  getPlanoUsuario,
  usuarioTemRecurso,
  getMensageiroCliente: mensageiro.getMensageiroCliente,
  setMensageiroCliente: mensageiro.setMensageiroCliente
}));


// ================= LOGIN ==========================

app.post("/login", async (req, res) => {
  const { user, pass } = req.body || {};

  const login = String(user || "").trim().toLowerCase();

  const usuario = usuarios.find(u =>
    String(u.email || "").toLowerCase() === login ||
    String(u.id || "").toLowerCase() === login
  );

  if (!usuario) {
    return res.status(401).json({ erro: "UsuÃ¡rio invÃ¡lido" });
  }

  if (usuario.ativo === false) {
    return res.status(403).json({ erro: "UsuÃ¡rio inativo" });
  }

 let senhaOk = false;

senhaOk = String(usuario.senha || "") === String(pass || "");

if (!senhaOk) {
  return res.status(401).json({ erro: "Senha invÃ¡lida" });
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

  const id = normalizarSessaoId(
  clienteId,
  req.params.id
  );

    if (sessoes[id]) {
      try {
        await sessoes[id]?.logout?.();
      } catch (e) {
        console.log("[ERRO] erro logout:", e.message);
      }

      try {
        sessoes[id]?.end?.();
      } catch (e) {
        console.log("[ERRO] erro end:", e.message);
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

    const id = normalizarSessaoId(
    clienteId,
    req.params.id
    );

    if (sessoes[id]) {
      try {
        await sessoes[id]?.logout?.();
      } catch (e) {
        console.log("[ERRO] erro logout ao limpar:", e.message);
      }

      try {
        sessoes[id]?.end?.();
      } catch (e) {
        console.log("[ERRO] erro end ao limpar:", e.message);
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

      console.log("[WHATSAPP] Sesso limpa:", pastaAuth);
    }

    return res.json({
      ok: true,
      message: "SessÃ£o limpa. Gere um novo QR Code.",
      id
    });

  } catch (e) {
    console.log("[ERRO] [WHATSAPP] erro limpar sesso:", e.message);

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
      erro: "UsuÃ¡rio nÃ£o encontrado"
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

 const planoAtual = getPlanoUsuario(req) || {};

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
    marketplacesLiberados: planoAtual.marketplaces || [],
    recursos: planoAtual.recursos || {},
    limites: planoAtual.limites || {}
  },
  marketplacesLiberados: planoAtual.marketplaces || [],
      
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

// ================= INTEGRAÃ‡Ã•ES =================

const marketplaceRules = integracoesUtils.marketplaceRules;

function limparCredencial(config, allowed) {
  return integracoesUtils.limparCredencial(config, allowed);
}

function validarIntegracao(marketplace, body) {
  return integracoesUtils.validarIntegracao(marketplace, body);
}

function mascararIntegracao(config = {}) {
  return integracoesUtils.mascararIntegracao(config);
}

function normalizarCredenciaisAwin(config = {}) {
  return integracoesUtils.normalizarCredenciaisAwin(config);
}

function obterProgramaAwin(credenciais = {}, alvo = "kabum") {
  return integracoesUtils.obterProgramaAwin(credenciais, alvo);
}

//============= ROTA INTEGRACOES =======================================

app.get("/integracoes", (req, res) => {
  const clienteId = getClienteId(req);
  const data = integracoesPorCliente[clienteId] || {};
  const resposta = {};

  const reveal =
    req.query.reveal === "1" ||
    req.query.reveal === "true";

  for (const [marketplace, config] of Object.entries(data)) {
    const credenciais = marketplace === "awin"
      ? normalizarCredenciaisAwin(config?.credenciais || {})
      : config?.credenciais || {};

    const camposConfigurados = Object.keys(credenciais).filter(k => {
      const valor = credenciais[k];

      return (
        valor !== undefined &&
        valor !== null &&
        String(valor).trim() !== ""
      );
    });

    const configurado = camposConfigurados.length > 0;

    const credenciaisResposta =
      reveal
        ? credenciais
        : mascararIntegracao(credenciais);

    resposta[marketplace] = {
      marketplace,
      nome: marketplaceRules?.[marketplace]?.nome || marketplace,
      configurado,
      status: configurado
        ? (config.status || "conectado")
        : "incompleto",
      camposConfigurados,
      credenciais: credenciaisResposta,
      atualizadoEm: config?.atualizadoEm || null
    };
  }

  return res.json({
    ok: true,
    clienteId,
    reveal,
    integracoes: resposta
  });
});


//============= ROTA POST INTEGRACOES MARTPLACES ====================

app.post("/integracoes/:marketplace", (req, res) => {
  const clienteId = getClienteId(req);
  const marketplace = req.params.marketplace.toLowerCase();

  const plano = getPlanoUsuario(req);

if (!isAdminMaster(req)) {
  const liberados = plano?.marketplaces || [];

  if (!liberados.includes(marketplace)) {
    return res.status(403).json({
      ok: false,
      erro: `Marketplace ${marketplace} nÃ£o liberado no seu plano`
    });
  }
}

  const payload = req.body?.credenciais || req.body;

  const validacao = validarIntegracao(marketplace, payload);

  if (!validacao.ok) return res.status(400).json(validacao);

  if (!integracoesPorCliente[clienteId]) {
    integracoesPorCliente[clienteId] = {};
  }

  integracoesPorCliente[clienteId][marketplace] = {
  marketplace,
  nome: marketplaceRules[marketplace]?.nome || marketplace,
  modo: validacao.modo || req.body.modo || null,
  credenciais: validacao.clean || payload,
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

app.delete("/integracoes/:marketplace", (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const marketplace = req.params.marketplace.toLowerCase();

    if (!integracoesPorCliente[clienteId]) {
      integracoesPorCliente[clienteId] = {};
    }

    delete integracoesPorCliente[clienteId][marketplace];

    salvarIntegracoesPersistidas();

    return res.json({
      ok: true,
      marketplace,
      configurado: false,
      status: "nao_configurado",
      message: "IntegraÃ§Ã£o removida com sucesso"
    });

  } catch (e) {
    console.log("[ERRO] Erro ao remover integrao:", e.message);

    return res.status(500).json({
      ok: false,
      erro: "Erro interno ao remover integraÃ§Ã£o"
    });
  }
});

app.post("/integracoes/:marketplace/test", async (req, res) => {
  const clienteId = getClienteId(req);
  const marketplace = req.params.marketplace.toLowerCase();
  const config = integracoesPorCliente[clienteId]?.[marketplace];

  if (!config) {
    return res.status(400).json({
      ok: false,
      erro: "IntegraÃ§Ã£o nÃ£o configurada"
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

  const { publisherId, apiToken } = credenciais;
  const programaAwin = obterProgramaAwin(credenciais, urlOriginal);
  const advertiserId = programaAwin?.advertiserId || "";

if (!publisherId || !apiToken || !advertiserId) {
  console.log("[AVISO] AWIN sem credenciais/programa:", {
    clienteId,
    programa: programaAwin?.nome || ""
  });
}
  if (!publisherId || !apiToken || !advertiserId) {
    throw new Error("Awin sem publisherId, apiToken ou programa advertiserId configurado.");
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

console.log("[INFO] AWIN Deeplink OK");

  return (
    response.data?.shortUrl ||
    response.data?.url ||
    response.data?.link ||
    response.data?.trackingLink ||
    response.data?.clickUrl ||
    ""
  );
}


app.get("/teste-kabum-rota", (req, res) => {
  return res.json({ ok: true, rota: "kabum ativa" });
});

app.post("/awin/gerar-link", async (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        ok: false,
        erro: "URL obrigatÃ³ria"
      });
    }

    if (url.includes("kabum.com.br")) {
      const produto = await importarProdutoKabumViaAwin(
      url,
      clienteId,
     {
     gerarDeepLinkAwin
    }
    );

      return res.json({
        ok: true,
        ...produto
      });
    }

    const linkAfiliado = await gerarDeepLinkAwin(url, clienteId);

  console.log("[INFO] AWIN link gerado com sucesso");

    if (!linkAfiliado) {
      return res.status(400).json({
        ok: false,
        erro: "NÃ£o foi possÃ­vel gerar o link afiliado Awin"
      });
    }

    return res.json({
      ok: true,
      marketplace: "awin",
      linkOriginal: url,
      link: linkAfiliado,
      linkAfiliado
    });

  } catch (e) {
    console.error("[ERRO] ERRO GERAR LINK AWIN:", e.message);

    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

// ================= HELPERS DE IMPORTAÃ‡ÃƒO =================

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
      console.log("[INFO] Duplicada removida pelo filtro universal:", oferta.titulo || oferta.nome);
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
          "â­ï¸ Oferta ignorada pelo filtro universal:",
          resultado.motivo,
          oferta.titulo || oferta.nome || "sem tÃ­tulo"
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
    console.log("[AVISO] Mercado Livre bloqueou por trfego suspeito. Pulando rodada.");
    return;
    }

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

    console.log("[INFO] ML CSRF: token no encontrado automaticamente");
    return "";
  } catch (e) {
    console.error("[ERRO] ERRO BUSCAR CSRF ML:", e.message);
    return "";
  }
}

async function gerarLinkAfiliadoMercadoLivre(url, config, contexto = {}) {
  try {

if (String(url || "").includes("meli.la")) {
  console.log("[INFO] Link ML j encurtado detectado. No vou reutilizar para outro cliente.");
  return "";
}

    const credenciais = config?.credenciais || {};

    const cookies = credenciais.cookies || "";
    const tag = credenciais.tag || "";

    if (!url || !cookies || !tag) {
      console.log("[INFO] ML AFILIADO: faltando cookies ou tag");
      return "";
    }

    const csrfToken = await buscarCsrfTokenMercadoLivre(cookies);

    if (!csrfToken) {
      console.log("[INFO] ML AFILIADO: csrfToken automtico no encontrado");
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

  console.log("[INFO] ML afiliado respondeu");

    if (!response.ok) {
      console.log("[ERRO] ML AFILIADO ERRO STATUS:", response.status);
      return "";
    }

 return data?.short_url || data?.shortUrl || data?.url || "";
  } catch (e) {
    console.error("[ERRO] ERRO ML AFILIADO:", e.message);
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


function gerarLinkMagalu(linkOriginal, promoterId) {
  if (!linkOriginal || !promoterId) return linkOriginal;

  const urlLimpa = String(linkOriginal).trim();
  const loja = String(promoterId).trim();

  // Se jÃ¡ for link da loja do influenciador, mantÃ©m
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
      throw new Error("Product ID nÃ£o encontrado no link AliExpress");
    }

    const credenciais = marketplace === "awin"
      ? normalizarCredenciaisAwin(config?.credenciais || {})
      : config?.credenciais || {};
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

console.log("[INFO] AliExpress produto encontrado");

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
  ? "ðŸ‡§ðŸ‡· Produto no Brasil. Confira cupom ou desconto com moedas na pÃ¡gina."
  : "ðŸŒ Compra internacional. Pode haver imposto/taxa. Confira cupom ou desconto com moedas na pÃ¡gina.";

      
      if (!produto || Object.keys(produto).length === 0) {
  console.log("[AVISO] AliExpress sem produto retornado pela API:", productId);

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
    console.log("[ERRO] Erro fallback pdp_npi AliExpress:", e.message);
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
    aviso: "AliExpress nÃ£o retornou dados pela API. PreÃ§os extraÃ­dos do link quando disponÃ­veis."
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
console.log("[INFO] ALI PREO ESCOLHIDO:", precoAtual);
   
   
  let precoAntigo =
  produto.target_original_price ||
  produto.original_price ||
  "";

precoAntigo = String(precoAntigo).trim();
console.log("[INFO] ALI PREO ANTIGO ESCOLHIDO:", precoAntigo);

if (precoAntigo === precoAtual) {
  precoAntigo = "";
}

   console.log("[INFO] ALI PREOS RAW:", {
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
 
// ðŸ”¥ PRIORIDADE: preÃ§o real da URL (AliExpress promo)
try {
  const urlDecodificada = decodeURIComponent(urlEntrada);

  // pega exatamente o padrÃ£o pdp_npi
  const match = urlDecodificada.match(/BRL!([\d.]+)!([\d.]+)/);

  if (match) {
    const antigo = match[1];
    const atual = match[2];

    // sÃ³ usa se fizer sentido (evita bug tipo 8.93)
    if (parseFloat(atual) < parseFloat(antigo)) {
      precoAntigo = antigo;
      precoAtual = atual;
    }
  }

} catch (e) {
  console.log("[ERRO] Erro ao extrair preo da URL:", e.message);
}

    let linkAfiliado =
  produto.promotion_link ||
  produto.promotion_link_short ||
  produto.product_detail_url ||
  produto.product_url ||
  urlEntrada;

// ðŸ”¥ Limpar link gigante AliExpress
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
    console.log("[ERRO] Erro limpando link AliExpress:", e.message);
  }
}

// Se jÃ¡ vier link oficial curto da Ali, mantÃ©m ele.
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
    console.error("[ERRO] ERRO ALIEXPRESS:", e.message);

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
      aviso: "Verifique se hÃ¡ cupons disponÃ­veis na pÃ¡gina"
    };
  } catch (e) {
    console.log("[API] erro importarMagalu:", e.message);

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
    console.log("[AVISO] AliExpress API sem credenciais.");
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
        erro: "URL obrigatÃ³ria"
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
        erro: "Produto invÃ¡lido"
      });
    }

    const clienteId = getClienteId(req);

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
  sessaoId: normalizarSessaoId(clienteId, "sessao1"),
  status: "pendente",
  clienteId
};

novaOferta.status = novaOferta.status || "pendente";
novaOferta.statusDetalhe = novaOferta.statusDetalhe || "Na fila";

const adicionou = adicionarOfertaNaFila(fila, novaOferta, "manual-magalu");

if (adicionou) {
  salvarFila(clienteId);
}

    return res.json({
      ok: true,
      produto: novaOferta
    });

  } catch (e) {

    console.log("[API] erro importar manual Magalu:", e.message);

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

      console.log("[INFO] Cupom expirado por tempo:", mp, cp);
      return false;
    }
  }

  return true;
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
      console.log("[INFO] Cupom expirado automaticamente:", mp, cp);
    }
  }

  atual.ultimaUtilizacao = new Date().toISOString();

  config.cuponsStatus[mp][cp] = atual;
  salvarConfig();
}

// =========== INTELIGÃŠNCIA GLOBAL DE CUPONS ===========

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
    console.log("[INFO] Cupom marcado como expirado:", mp, cp);
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

  console.log("[INFO] Cupom validado como ativo:", mp, cp);
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
          console.log("[INFO] Cupom expirado por decaimento:", marketplace, cupom);
        }
      }
    }

    salvarConfig();
  } catch (e) {
    console.log("[ERRO] erro decairConfiancaCupons:", e.message);
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

// ========================= CATEGORIA BASE ============================

function categoriaBase(txt = "") {
  return destinosUtils.categoriaBase(txt);
}

// =========== VALIDAR CATEGORIA DO DESTINO ===========

function categoriaPermitidaNoDestino(oferta, destino) {
  return destinosUtils.categoriaPermitidaNoDestino(oferta, destino);
}

//============ FUNCAO FAREJAR CUPOM MERCADO LIVRE ================
// DESATIVADA: nÃ£o registrar cupons ML automaticamente

async function farejarCuponsMercadoLivre(html = "") {
  console.log("[INFO] farejarCuponsMercadoLivre desativado");
  return [];
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

   console.log("[INFO] Ali link");

    const linkGerado =
      data?.aliexpress_affiliate_link_generate_response?.resp_result?.result?.promotion_links?.promotion_link?.[0]?.promotion_link ||
      data?.resp_result?.result?.promotion_links?.promotion_link?.[0]?.promotion_link ||
      "";

    return linkGerado || urlOriginal;

  } catch (e) {
    console.log("[ERRO] Erro gerar link curto AliExpress:", e.message);
    return urlOriginal;
  }
}

// ======================= FUNCAO PLANO NOME =========================================

function getPlanoPorNome(nome = "free") {
  const chave = normalizarTexto(nome || "free");

  if (planos?.[chave]) {
    return planos[chave];
  }

  const encontrado = Object.entries(planos || {}).find(([key, plano]) => {
    return (
      normalizarTexto(key) === chave ||
      normalizarTexto(plano?.nome || "") === chave
    );
  });

  return encontrado?.[1] || planos?.free || null;
}

// =============== FUNCAO GERAR LINK AFILIADO SHOPEE ========================================

async function gerarLinkShopeeCliente(clienteId, ofertaBase = {}) {
  try {
    const integracao = getIntegracaoCliente(clienteId, "shopee");

    console.log("[INFO] CLIENTE:", clienteId);
    console.log("[INFO] MARKETPLACE:", "shopee");
    console.log("[INFO] Integrao encontrada?", !!integracao);
    console.log("[INFO] Tem credenciais?", !!integracao?.credenciais);

    const appId = integracao?.credenciais?.appId || "";
    const secret = integracao?.credenciais?.secret || "";

    if (!appId || !secret) {
      return "";
    }

    const keyword = String(
      ofertaBase.titulo ||
      ofertaBase.nome ||
      ""
    )
      .replace(/"/g, "")
      .slice(0, 80);

    if (!keyword) {
      return "";
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

    return produto?.offerLink || "";

  } catch (e) {
    console.log("[ERRO] erro gerarLinkShopeeCliente:", e.message);
    return "";
  }
}

// =============== FUNCAO GERAR LINK AFILIADO VARIOS MARKTPLACES  ============================

async function gerarLinkAfiliadoCliente(clienteId, marketplace, linkOriginal, ofertaBase = {}) {
  try {
    const mp = String(marketplace || "").toLowerCase();

    const integracao = getIntegracaoCliente(clienteId, mp);

    console.log("[INFO] ====================================");
    console.log("[INFO] CLIENTE:", clienteId);
    console.log("[INFO] MARKETPLACE:", mp);
    console.log("[INFO] Integrao encontrada?", !!integracao);
    console.log("[INFO] Tem credenciais?", !!integracao?.credenciais);
    console.log("[INFO] ====================================");

    const linkBase =
      linkOriginal ||
      ofertaBase.linkOriginal ||
      ofertaBase.link ||
      "";

    if (!linkBase) {
      return "";
    }

    if (mp === "mercadolivre") {
      const linkML = await gerarLinkAfiliadoMercadoLivre(
        linkBase,
        integracao,
        { clienteId }
      );

      return linkML || "";
    }

    if (mp === "shopee") {
      return await gerarLinkShopeeCliente(clienteId, ofertaBase);
    }

    if (mp === "amazon") {
  const trackingId =
    integracao?.credenciais?.trackingId ||
    integracao?.credenciais?.partnerTag ||
    integracao?.credenciais?.tag ||
    integracao?.credenciais?.affiliateTag ||
    "";

  if (!trackingId) {
    console.log("[AVISO] Amazon sem trackingId/tag afiliada:", {
      clienteId,
      credenciais: Object.keys(integracao?.credenciais || {})
    });
    return "";
  }

  try {
    const u = new URL(linkBase);
    u.searchParams.set("tag", trackingId);
    return u.toString();
  } catch {
    return "";
  }
}

    if (mp === "aliexpress") {
      const linkAli = await gerarLinkCurtoAliExpress(
        linkBase,
        integracao?.credenciais || {}
      );

      return linkAli || "";
    }

    if (mp === "awin") {
      const linkAwin = await gerarDeepLinkAwin(
        linkBase,
        clienteId
      );

      return linkAwin || "";
    }

    if (mp === "magalu") {
      const promoterId =
        integracao?.credenciais?.promoterId || "";

      if (!promoterId) {
        return "";
      }

      try {
        return gerarLinkMagalu(linkBase, promoterId) || "";
      } catch {
        return "";
      }
    }

    return "";

  } catch (e) {
    console.log("[ERRO]❌ Erro ao gerar link afiliado do cliente:", {
      clienteId,
      marketplace,
      erro: e.message
    });

    return "";
  }
}

// =========================== HEPERS DE WHATSAPP =================================

function normalizarSessaoId(clienteId, id = "sessao1") {

  const cliente = String(clienteId || "admin").trim();

  let sessao = String(id || "sessao1").trim();

  // remove duplicaÃ§Ã£o
  if (sessao.startsWith(cliente + "_")) {
    sessao = sessao.slice((cliente + "_").length);
  }

  // evita admin_admin_sessao1
  sessao = sessao.replace(/^admin_/g, "");

  return `${cliente}_${sessao}`;
}

// ============== HELPERS DISTRIBUIDOR OFERTAS ==================================

function usuarioPodeReceberMarketplace(usuario, marketplace) {

  if (!usuario?.ativo) return false;

  if (usuario.papel === "admin_master") {
    return true;
  }

  const plano = getPlanoPorNome(usuario.plano) || {};

  const marketplacesLiberados = plano.marketplaces || [];

  return marketplacesLiberados.includes(
    normalizarTexto(marketplace || "")
  );
}

// ============ FUNCAO INTEGRACAO MARKET POR CLIENTE ID ===================

function usuarioTemIntegracaoMarketplace(clienteId, marketplace) {
  const mp = normalizarTexto(marketplace || "");

  const integracao = getIntegracaoCliente(clienteId, mp);
  const cred = integracao?.credenciais || {};

  console.log("[DEBUG]✅ CHECK INTEGRAO CLIENTE:", {
    clienteId,
    marketplace: mp,
    temIntegracao: !!integracao,
    campos: Object.keys(cred)
  });

  if (!integracao) return false;

  if (mp === "amazon") {
    return !!(
      cred.tag ||
      cred.trackingId ||
      cred.partnerTag ||
      cred.appId ||
      cred.cookies
    );
  }

  if (mp === "mercadolivre") {
    return !!(
      cred.tag ||
      cred.cookies
    );
  }

  if (mp === "shopee") {
    return !!(
      cred.appId &&
      cred.secret
    );
  }

  if (mp === "aliexpress") {
    return !!(
      cred.appKey &&
      cred.secret &&
      cred.trackingId
    );
  }

  if (mp === "kabum") {
    const awin = getIntegracaoCliente(clienteId, "awin");
    const awinCred = awin?.credenciais || {};

    return !!(
      awinCred.publisherId &&
      awinCred.apiToken
    );
  }

  if (mp === "awin") {
    const awinCred = normalizarCredenciaisAwin(cred);
    return !!(
      awinCred.publisherId &&
      awinCred.apiToken
    );
  }

  return Object.keys(cred).length > 0;
}


// =============== FUNCAO DISTRIBUIDOR OFERTAS ======================================

async function distribuirOfertaParaClientes(ofertaBase) {

  ofertaBase = prepararOfertaGlobal(ofertaBase);

  for (const usuario of usuarios) {
    if (!usuario?.ativo) continue;

    const clienteId = usuario.id;
    const adminMaster = usuario.papel === "admin_master";

    const mp = normalizarTexto(ofertaBase.marketplace || "");

    if (!usuarioPodeReceberMarketplace(usuario, mp)) {

      console.log("[INFO] Usurio no recebe marketplace pelo plano:", {
        clienteId,
        plano: usuario.plano,
        marketplace: mp
      });
      continue;
    }


console.log("[DEBUG]✅ CHECK INTEGRAO:", {
  clienteId,
  marketplace: mp,
  integracao: !!getIntegracaoCliente(clienteId, mp),
  campos: Object.keys(getIntegracaoCliente(clienteId, mp)?.credenciais || {})
});

   if (!usuarioTemIntegracaoMarketplace(clienteId, mp)) {
     console.log("[AVISO] Usurio sem integrao configurada:", {
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

console.log("[INFO]🔗 LINK CLIENTE GERADO:", {
  clienteId,
  marketplace: mp,
  linkOriginal,
  linkAfiliadoCliente
});

 if (!linkAfiliadoCliente) {
  console.log("[AVISO] Oferta bloqueada: cliente sem link afiliado prprio:", {
    clienteId,
    marketplace: mp,
    titulo: ofertaBase.titulo
  });
  continue;
}

const linkAfiliadoIgualOriginal =
  String(linkAfiliadoCliente || "").trim() === String(linkOriginal || "").trim();

if (mp === "mercadolivre" && linkAfiliadoIgualOriginal) {
  console.log("[AVISO] ML bloqueado: link afiliado igual ao original", {
    clienteId,
    marketplace: mp,
    titulo: ofertaBase.titulo,
    linkOriginal
  });
  continue;
}

if (linkAfiliadoIgualOriginal) {
  console.log("[INFO] Link afiliado igual ao original, permitindo por enquanto:", {
    clienteId,
    marketplace: mp,
    titulo: ofertaBase.titulo,
    linkAfiliadoCliente,
    linkOriginal
  });
}

    const ofertaCliente = {
      ...ofertaBase,
      clienteId,
      marketplace: mp,
      linkOriginal,
      linkAfiliado: linkAfiliadoCliente,
      link: linkAfiliadoCliente,
      linkFinal: linkAfiliadoCliente,
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

if (deveIgnorarOfertaRepetida(ofertaCliente)) {
  console.log("[INFO] Oferta automtica ignorada pela memria:", {
    clienteId,
    marketplace: ofertaCliente.marketplace,
    titulo: ofertaCliente.titulo
  });
  continue;
}

ofertaCliente.status = ofertaCliente.status || "pendente";
ofertaCliente.statusDetalhe = ofertaCliente.statusDetalhe || "Na fila";

// â­ SCORE V1
try {
  const resultadoScore = calcularScoreOferta(ofertaCliente);

  ofertaCliente.score = resultadoScore.score;
  ofertaCliente.nivelScore = resultadoScore.nivel;
  ofertaCliente.descontoScore = resultadoScore.desconto;
  ofertaCliente.motivosScore = resultadoScore.motivos;

    console.log("[DEBUG] SCORE OFERTA:", {
    titulo: ofertaCliente.titulo || ofertaCliente.nome,
    score: ofertaCliente.score,
    nivel: ofertaCliente.nivelScore,
    motivos: ofertaCliente.motivosScore
  });


} catch (e) {
  console.log("[ERRO] Erro ao calcular score:", e.message);
}

registrarOfertaVista(ofertaCliente);

fila.push(ofertaCliente);

salvarFila(clienteId);

console.log("[INFO] Oferta distribuda para cliente:", {
  clienteId,
  titulo: ofertaCliente.titulo,
  marketplace: ofertaCliente.marketplace
});

  }
}

      async function buscarTermoAliExpress(termo, tipo) {
      try {
        if (adicionadasNestaRodada >= limitePorRodada) return;

        console.log(`[INFO] ${tipo} Busca AliExpress API:`, termo);

        const produtosAPI = await buscarProdutosAliExpressAPI(termo);

        console.log(`[INFO] ${termo}: ${produtosAPI.length} produtos AliExpress via API`);

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
              console.log("[AVISO] AliExpress item repetido ignorado:", chaveAli);
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
              console.log("[AVISO] AliExpress ttulo repetido ignorado:", titulo);
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

            const tituloLower = titulo.toLowerCase();

            const palavrasBloqueadas = [
              "cabelo",
              "peruca",
              "extensÃ£o",
              "extensÃµes",
              "sapato",
              "sandÃ¡lia",
              "chinelo",
              "salto",
              "batom",
              "cÃ­lios",
              "unha",
              "bolsa",
              "sutiÃ£",
              "calcinha",
              "wedding",
              "bridal"
            ];

            if (palavrasBloqueadas.some(p => tituloLower.includes(p))) {
              console.log("[AVISO] Produto bloqueado:", titulo);
              continue;
            }

            if (!precoNumero || !Number.isFinite(precoNumero)) continue;

            const precoMinimo = Number(cfg.precoMinimo) || 0;
            const descontoMinimo = Number(cfg.descontoMinimo) || 0;

            const descontoMinimoInternacional =
              Number(cfg.descontoMinimoInternacional) || descontoMinimo;

            const minimoDescontoAplicado =
              tipo === "ðŸŒ"
                ? descontoMinimoInternacional
                : descontoMinimo;

            if (precoNumero < precoMinimo) continue;
            if (desconto < minimoDescontoAplicado) continue;

           const clienteId = "admin";

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
              linkOriginal: linkOriginalAli || link,
              link: linkOriginalAli || link,
              linkAfiliado: "",
              imagem,
              marketplace: "aliexpress",
              categoria: "AliExpress",
              sessaoId: normalizarSessaoId(clienteId, "sessao1"),
              status: "pendente",
              clienteId
            };

            novaOferta = prepararOfertaGlobal(novaOferta);

            const jaExiste = ofertaJaExiste(novaOferta);

            if (!jaExiste) {
              novaOferta.criadoEm = new Date().toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo"
              });

              ofertasEncontradas.push(novaOferta);
              adicionadasNestaRodada++;

              console.log("[INFO] Nova oferta AliExpress:", {
                titulo: novaOferta.titulo,
                preco: novaOferta.precoAtual,
                precoAntigo: novaOferta.precoAntigo,
                desconto: Math.round(desconto) + "%",
                link: novaOferta.linkAfiliado?.slice(0, 80)
              });
            }

            await new Promise(r => setTimeout(r, 1500));
          } catch (e) {
            console.log("[ERRO]❌ erro produto AliExpress API:", e.message);
          }
        }    

    for (const termo of buscasBrasil) {
      await buscarTermoAliExpress(termo, "ðŸ‡§ðŸ‡·");
      if (adicionadasNestaRodada >= limitePorRodada) break;
    }

    if (cfg.permitirInternacionalForte && adicionadasNestaRodada < limitePorRodada) {
      for (const termo of buscasInternacional) {
        await buscarTermoAliExpress(termo, "ðŸŒ");
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
      ` 🔍Ofertas AliExpress filtros universais: ${ofertasFiltradas.length}`
    );

  for (const oferta of ofertasFiltradas) {
  await distribuirOfertaParaClientes(oferta);
  }

    console.log(`[FILA] AliExpress finalizado. Adicionadas: ${adicionadasNestaRodada}`);
  } catch (e) {
    console.log("[ERRO] erro farejador AliExpress:", e.message);
  }
}


// ================= FAREJADOR MAGALU =================

async function farejarMagalu() {
  try {
    if (!config.marketplaces?.magalu?.ativo) {
      console.log("[AVISO] Magalu desativada. Farejador ignorado.");
      return;
    }

    console.log("[INFO] Farejando ofertas Magalu...");

   const integracao =
   getIntegracaoCliente("admin", "magalu");

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

      console.log("[INFO] MAGALU BUSCA:", urlBusca);

      const response = await fetch(urlBusca, {
        headers: {
          ...gerarHeadersStealth(),
          ...(integracao?.credenciais?.cookies
            ? { Cookie: integracao.credenciais.cookies }
            : {})
        }
      });

      console.log("[INFO] MAGALU STATUS:", response.status);

      if (!response.ok) {

  console.log(
    "ðŸ›¡ï¸ Magalu bloqueou status:",
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

      console.log(`[INFO] ${termo}: ${links.length} links Magalu`);

      for (const link of links) {
        if (adicionadas >= limitePorRodada) break;

        try {
         const produto = await importarMagalu(link);

          console.log("[API] PRODUTO MAGALU IMPORTADO:", produto);     

          if (!produto?.precoAtual) continue;

        const clienteId = getClienteId(req);
          
        let novaOferta = {
            nome: produto.titulo,
            titulo: produto.titulo,
            preco: produto.precoAtual,
            precoAtual: produto.precoAtual,
            precoAntigo: produto.precoAntigo || "",
            cupom: produto.cupom || "",
            avisoCupom: produto.avisoCupom || produto.aviso || "",
            parcelamento: produto.parcelamento || "",
            linkOriginal: produto.linkOriginal || link,
            link: produto.linkOriginal || link,
            linkAfiliado: "",
            imagem: produto.imagem || "",
            marketplace: "magalu",
            categoria: "Magalu",
            sessaoId: normalizarSessaoId(clienteId, "sessao1"),
            status: "pendente",
            clienteId
          };

          novaOferta = prepararOfertaGlobal(novaOferta);

          if (produtoSuspeito(novaOferta)) continue;
          if (ofertaJaExiste(novaOferta)) continue;

          await distribuirOfertaParaClientes(novaOferta);
          adicionadas++;

          console.log("[INFO] Nova oferta Magalu:", {
            titulo: novaOferta.titulo,
            preco: novaOferta.precoAtual,
            link: novaOferta.link
          });

          await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));
        } catch (e) {
          console.log("[ERRO] erro produto Magalu:", e.message);
        }
      }

      await new Promise(r => setTimeout(r, 5000 + Math.random() * 6000));
    }

    console.log(`[FILA] Magalu finalizado. Adicionadas: ${adicionadas}`);
  } catch (e) {
    console.log("[ERRO] erro farejador Magalu:", e.message);
  }
}

// ================= FAREJADOR AWIN =================

async function farejarAwin(clienteId = "admin", deps = {}) {

  const {
    config,
    integracoesPorCliente,
    classificarCategoriaOferta,
    aplicarFiltrosUniversais,
    distribuirOfertaParaClientes,
    normalizarSessaoId
  } = deps;

  try {
    console.log("[INFO] Farejando produtos reais Awin KaBuM...", {
      clienteId
    });

    const cfg = config.marketplaces?.awin || {};

    if (!cfg.ativo) {
      console.log("[AVISO] Awin desativada. Farejador ignorado.");
      return;
    }

    const integracaoAwin =
      integracoesPorCliente?.[clienteId]?.awin;

    if (!integracaoAwin?.credenciais) {
      console.log(
        "âŒ Awin sem integraÃ§Ã£o configurada:",
        clienteId
      );
      return;
    }

    const limitePorRodada = cfg.limitePorRodada || 5;
    const precoMinimo = cfg.precoMinimo || 20;
    const feedFile = cfg.feedFile || "awin_kabum.csv";

    const caminhoFeed = path.join(__dirname, feedFile);

    if (!fs.existsSync(caminhoFeed)) {
      console.log(
        "âŒ Feed Awin nÃ£o encontrado:",
        caminhoFeed
      );
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

    console.log("[INFO] Produtos no feed Awin:", produtos.length);
    
    let adicionadas = 0;
    let ofertasEncontradas = [];

    for (const item of produtos) {
      if (adicionadas >= limitePorRodada) break;

      const titulo = item.product_name || item.name || "";
      const preco = Number(String(item.search_price || "0").replace(",", "."));
      const imagem = item.merchant_image_url || item.aw_image_url || "";
      const link = item.aw_deep_link || item.product_url || item.merchant_deep_link || "";
      const categoriaOriginal =
      item.merchant_category ||
      item.category_name ||
      item.aw_category ||
      "KaBuM";

     const categoria = classificarCategoriaOferta(
     {
     titulo,
     nome: titulo,
     descricao: item.description || item.product_short_description || "",
     categoria: categoriaOriginal
     },
    `${titulo} ${categoriaOriginal}`
     );

      if (!titulo || !link) continue;
      if (preco < precoMinimo) continue;

      if (produtoRepetidoRecentemente(titulo, 24)) {
        console.log("[AVISO] Awin repetido ignorado:", titulo);
        continue;
      }

     const clienteId = "admin";

     const oferta = {
        id: Date.now() + "-" + Math.random().toString(36).slice(2),
        titulo,
        precoAtual: preco ? `R$ ${preco.toFixed(2).replace(".", ",")}` : "",
        precoAntigo: "",
        cupom: "",
        avisoCupom: "",
        parcelamento: "",
        imagem,
        linkOriginal: item.product_url || item.merchant_deep_link || link,
        link: item.product_url || item.merchant_deep_link || link,
        linkAfiliado: "",
        marketplace: "awin",
        loja: "KaBuM",
        categoria,
        categoriaOriginal,
        status: "pendente",
        clienteId,
        sessaoId: normalizarSessaoId(clienteId, "sessao1"),
        criadoEm: new Date().toISOString()
      };

       ofertasEncontradas.push(oferta);
      adicionadas++;

      console.log("[INFO] Produto Awin encontrado:", titulo);
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
      `ðŸ§  Ofertas Awin apÃ³s filtros universais: ${ofertasFiltradas.length}`
    );

   for (const oferta of ofertasFiltradas) {
   await distribuirOfertaParaClientes(oferta);
  }

    console.log(`[INFO] Awin finalizado. Produtos adicionados: ${ofertasFiltradas.length}`);
  } catch (e) {
    console.log("[ERRO]❌ erro farejador Awin:", e.message);
  }
}


// ================= IMPORTAR PRODUTO MANUAL UNIVERSAL =================

app.post("/importar-produto", async (req, res) => {
  try {
    const resultado = await importarProdutoManual(req, {
      getClienteId,
      integracoesPorCliente,
      getIntegracaoCliente,

      importarAmazon,
      importarAliExpress,
      importarMagalu,
      importarMercadoLivre,
      importarShopee,

      gerarLinkAfiliadoMercadoLivre
    });

    return res
      .status(resultado.status || 200)
      .json(resultado.body);

  } catch (e) {
    console.log("[API] erro rota importar-produto:", e.message);

    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

// ================= WHATSAPP SESSOES =================

app.get("/sessoes", (req, res) => {
  const clienteId = getClienteId(req);
  const lista = listarSessoesWhatsappCliente(clienteId);

  return res.json({
    ok: true,
    sessoes: lista
  });
});

app.post("/sessoes", (req, res) => {
   console.log("[WHATSAPP] Nova sesso solicitada:", {
  nome: req.body?.nome,
  id: req.body?.id
});

  const clienteId = getClienteId(req);

  const planoUsuario = getPlanoUsuario(req);

  const limite = isAdminMaster(req)
  ? 999
  : Number(planoUsuario?.limites?.sessoes || 1);

 const sessoesCliente = Object.values(sessoesMeta)
  .filter(s => {
    const id = String(s.id || "");

    return (
      id.startsWith(clienteId + "_") ||
      id === clienteId ||
      (clienteId === "admin" && id.startsWith("admin_"))
    );
  });

  if (!isAdminMaster(req) && sessoesCliente.length >= limite) {
  return res.status(403).json({
    ok: false,
    erro: `Seu plano permite apenas ${limite} sessÃ£o(Ãµes).`
  });
}

  try {
    const nome = req.body.nome || "WhatsApp";
    const tipo = req.body.tipo || "whatsapp";

    const idRecebido = String(req.body.id || "").trim();

    const nomeSessao =
    !idRecebido || idRecebido === "sessao1"
    ? gerarProximaSessaoId(clienteId)
    : idRecebido;

const id = normalizarSessaoId(
  clienteId,
  nomeSessao
);

    if (sessoesMeta[id]) {
      return res.status(400).json({
        ok: false,
        erro: "SessÃ£o jÃ¡ existe"
      });
    }

    sessoesMeta[id] = {
      id,
      nome,
      tipo,
      criadoEm: new Date().toISOString()
    };

    salvarSessoesMeta();

console.log("[WHATSAPP]💾 Sesso criada e salva:", sessoesMeta[id]);

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

  const id = normalizarSessaoId(
  clienteId,
  req.params.id
  );

const idsPossiveis = [...new Set([
  id,
  req.params.id
])];

    try {
      if (sessoes[id]?.sock?.logout) {
        await sessoes[id].sock.logout();
      }
    } catch (e) {
      console.log("[AVISO] logout ignorado ao excluir:", e.message);
    }

    try {
      sessoes[id]?.sock?.end?.();
    } catch (e) {
      console.log("[AVISO] end ignorado ao excluir:", e.message);
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

removerReferenciasSessao(idsPossiveis, clienteId);

const destinosCliente = destinosPorCliente?.[clienteId] || [];

const listasDestinosCliente = Array.isArray(destinosCliente)
  ? [destinosCliente]
  : Object.values(destinosCliente || {}).filter(Array.isArray);

for (const listaDestino of listasDestinosCliente) {
  for (const destino of listaDestino) {
    if (destino.conexaoId && idsPossiveis.includes(destino.conexaoId)) {
      destino.conexaoId = "";
    }

    if (Array.isArray(destino.sessoes)) {
      destino.sessoes = destino.sessoes.filter(
        s => !idsPossiveis.includes(s)
      );
    }

    if (Array.isArray(destino.sessoesWhatsapp)) {
      destino.sessoesWhatsapp = destino.sessoesWhatsapp.filter(
        s => !idsPossiveis.includes(s)
      );
    }
  }
}

salvarDestinosClientes();
salvarConfigsClientes();
salvarConfig();

    salvarSessoesMeta();

    return res.json({
      ok: true,
      message: "SessÃ£o excluÃ­da com sucesso",
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
 const id = normalizarSessaoId(clienteId, req.params.id);

  try {
    console.log("[WHATSAPP] Resetando sesso:", id);

    if (typeof reconectando !== "undefined") {
      reconectando[id] = false;
    }

    if (sessoes[id]) {

      try {
        await sessoes[id]?.logout?.();
      } catch (e) {
        console.log("[AVISO] logout ignorado:", e.message);
      }

      try {
        sessoes[id]?.end?.();
      } catch (e) {
        console.log("[AVISO] end ignorado:", e.message);
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

    delete gruposPorSessao[id];
    delete reconectando[id];
    delete sessoesMeta[id];

    removerReferenciasSessao([id], clienteId);
    salvarDestinosClientes();
    salvarConfigsClientes();
    salvarConfig();
    salvarSessoesMeta();
       
     
    fs.rmSync("/data/auth_" + id, {
      recursive: true,
      force: true
    });

    return res.json({
      ok: true,
      message: "SessÃ£o resetada. Gere novo QR.",
      id
    });

  } catch (e) {
    console.log("[ERRO]❌ [WHATSAPP] erro reset sesso:", e.message);

    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

// ===================== FUNÃ‡ÃƒO LIMETE SESSÃƒO WHATSAPP ========================

function obterLimiteSessoesCliente(clienteId) {
  const usuario = obterUsuario(clienteId);
  const nomePlano = String(usuario?.plano || "free").toLowerCase();
  const plano = getPlanoPorNome(nomePlano);

  return Number(
    plano?.limites?.sessoes ||
    usuario?.limites?.sessoes ||
    1
  );
}

function listarSessoesCliente(clienteId) {
  config.sessoesWhatsapp = config.sessoesWhatsapp || [];

  return config.sessoesWhatsapp.filter(id =>
    String(id).startsWith(`${clienteId}_`)
  );
}

function gerarProximaSessaoId(clienteId) {
  const sessoesCliente = listarSessoesCliente(clienteId);

  const numeros = sessoesCliente
    .map(id => {
      const match = String(id).match(/_sessao(\d+)$/);
      return match ? Number(match[1]) : 0;
    })
    .filter(n => Number.isFinite(n));

  const proximo = numeros.length
    ? Math.max(...numeros) + 1
    : 1;

  return `sessao${proximo}`;
}

// ========================== ROTA CONECTAR ================================

app.post("/conectar", async (req, res) => {
  const clienteId = getClienteId(req);

  if (!clienteId) {
    return res.status(401).json({ erro: "UsuÃ¡rio nÃ£o identificado" });
  }

  config.sessoesWhatsapp = config.sessoesWhatsapp || [];

 const limiteSessoes = isAdminMaster(req)
  ? 999
  : obterLimiteSessoesCliente(clienteId);

const sessoesCliente = listarSessoesCliente(clienteId);

if (!isAdminMaster(req) && sessoesCliente.length >= limiteSessoes) {


    return res.status(403).json({
      ok: false,
      erro: `Seu plano permite atÃ© ${limiteSessoes} sessÃ£o(Ãµes) WhatsApp.`,
      limite: limiteSessoes,
      usadas: sessoesCliente.length
    });
  }

  const idRecebido = String(
    req.body?.id ||
    req.body?.sessaoId ||
    ""
  ).trim();

  const idBase =
    !idRecebido || idRecebido === "sessao1"
      ? gerarProximaSessaoId(clienteId)
      : idRecebido;

  const sessaoId = normalizarSessaoId(clienteId, idBase);

  if (config.sessoesWhatsapp.includes(sessaoId)) {
    return res.status(400).json({
      ok: false,
      erro: "JÃ¡ existe uma conexÃ£o com esse ID. Tente criar uma nova conexÃ£o novamente.",
      id: sessaoId
    });
  }

  config.sessoesWhatsapp.push(sessaoId);
  salvarConfig();

  console.log("[WHATSAPP]💾 Sesso WhatsApp salva para reconexo:", {
    clienteId,
    sessaoId,
    limiteSessoes,
    usadas: sessoesCliente.length + 1
  });

  iniciarWhatsApp(sessaoId, false);

  return res.json({
    ok: true,
    message: "SessÃ£o iniciada",
    id: sessaoId
  });
});


// ================= FUNCAO CARREGAR SESSAO ID ==========================

async function carregarGruposSessao(id, opcoes = {}) {
  const force = opcoes.force === true;

  const clienteId =
    opcoes.clienteId ||
    (
      id.startsWith("user_") && id.includes("_sessao")
        ? id.split("_sessao")[0]
        : "admin"
    );

  console.log("[WHATSAPP] Tentando carregar grupos da sesso:", {
    id,
    clienteId
  });

  const idNormalizado = normalizarSessaoId(clienteId, id);

  const sessao =
    sessoes[id] ||
    sessoes[idNormalizado] ||
    sessoes[`${clienteId}_${id}`];

  const sock = sessao?.sock || sessao;

  const chaveCache =
    sessoes[id] ? id :
    sessoes[idNormalizado] ? idNormalizado :
    sessoes[`${clienteId}_${id}`] ? `${clienteId}_${id}` :
    idNormalizado;

  if (!force && gruposPorSessao[chaveCache]?.length) {
    return gruposPorSessao[chaveCache];
  }

  if (!sock) {
    console.log("[WHATSAPP] No carregou grupos: sem sesso", id);
    return gruposPorSessao[chaveCache] || [];
  }

  if (typeof sock.groupFetchAllParticipating !== "function") {
    console.log("[WHATSAPP] Sesso existe, mas no tem groupFetchAllParticipating:", id);
    return gruposPorSessao[chaveCache] || [];
  }

  try {
 const grupos = await sock.groupFetchAllParticipating();

console.log(
   "👥 Grupos carregados:",
  Object.keys(grupos || {}).length
);

    const lista = Object.entries(grupos || {}).map(([gid, g]) => ({
      id: gid,
      nome: g.subject || "Grupo sem nome"
    }));

    gruposPorSessao[chaveCache] = lista;
    gruposPorSessao[id] = lista;

    if (idNormalizado) {
      gruposPorSessao[idNormalizado] = lista;
    }

    console.log(`[OK] Grupos carregados automaticamente: ${lista.length}`);

    return lista;
  } catch (e) {
    console.log("[ERRO] Erro ao carregar grupos:", e.message);
    return gruposPorSessao[chaveCache] || [];
  }
}

//================= POST MAGALU =======================================

app.post("/magalu/gerar-link", (req, res) => {
  try {
    const { link } = req.body;

    const promoterId = integracoes?.magalu?.promoterId;

    if (!promoterId) {
      return res.status(400).json({
        ok: false,
        erro: "Magalu nÃ£o configurada."
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
    console.error("[ERRO] Erro Magalu:", err);

    res.status(500).json({
      ok: false,
      erro: "Erro ao gerar link Magalu"
    });
  }
});


// ================= GRUPOS ID ==============================

app.get("/grupos/:id", async (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const id = normalizarSessaoId(clienteId, req.params.id);
    const force = req.query.force === "true";

    const status = statusSessao[id];

    if (status !== "open" && status !== "aberto") {
      return res.json({
        ok: false,
        id,
        status: status || "offline",
        total: gruposPorSessao[id]?.length || 0,
        grupos: gruposPorSessao[id] || [],
        gruposLista: gruposPorSessao[id] || [],
        cache: true,
        aviso: "SessÃ£o nÃ£o estÃ¡ conectada."
      });
    }

    console.log("[INFO] ROTA /grupos buscando:", {
      id,
      force,
      temCache: !!gruposPorSessao[id]?.length,
      totalCache: gruposPorSessao[id]?.length || 0
    });

    if (!force && gruposPorSessao[id]?.length) {
      return res.json({
        ok: true,
        id,
        total: gruposPorSessao[id].length,
        grupos: gruposPorSessao[id],
        gruposLista: gruposPorSessao[id],
        cache: true
      });
    }

    const grupos = await carregarGruposSessao(id, { force: true });

    return res.json({
      ok: true,
      id,
      total: grupos.length,
      grupos,
      gruposLista: grupos,
      cache: false,
      atualizado: true
    });
  } catch (e) {
    console.log("[ERRO] Erro rota /grupos/:id:", e.message);

    return res.status(500).json({
      ok: false,
      erro: e.message,
      total: 0,
      grupos: [],
      gruposLista: []
    });
  }
});

// ================= ROTA QRCOD ID ==============================

app.get("/qr/:id", (req, res) => {
  const clienteId = getClienteId(req);
  const idOriginal = req.params.id;

  const id = normalizarSessaoId(clienteId, idOriginal);

console.log("[WHATSAPP] Buscando QR:", {
  clienteId,
  id,
  temQr: !!qrCodes[id],
  status: statusSessao[id]
});

  if (!qrCodes[id]) {
    return res.json({
      ok: false,
      status: statusSessao[id] || "loading",
      qr: null,
      qrCode: null,
      id
    });
  }

  return res.json({
    ok: true,
    status: "ready",
    qr: qrCodes[id],
    qrCode: qrCodes[id],
    id
  });
});

// ===================== ROTA STATUS ==========================

app.get("/status/:id", (req, res) => {
  const clienteId = getClienteId(req);

  const id = normalizarSessaoId(
    clienteId,
    req.params.id
  );

  return res.json({
    ok: true,
    id,
    status: statusSessao[id] || "offline",
    conectado: statusSessao[id] === "open" || statusSessao[id] === "aberto",
    qrDisponivel: !!qrCodes[id],
    grupos: gruposPorSessao[id]?.length || 0
  });
});

app.get("/fila/status", (req, res) => {
  const clienteId = getClienteId(req);

  const itensCliente = fila.filter(o =>
    String(o.clienteId || "admin") === String(clienteId)
  );

  return res.json({
    ok: true,
    clienteId,
    total: itensCliente.length,
    pendentes: itensCliente.filter(o => o.status === "pendente").length,
    enviados: itensCliente.filter(o => o.status === "enviado").length,
    erros: itensCliente.filter(o => o.status === "erro").length
  });
});


// =================== POST DESTINOS ================================

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

  const id = normalizarSessaoId(
  clienteId,
  req.params.id
);

  destinosPorSessao[id] = destinos;

  if (!config.destinosPorSessao) {
    config.destinosPorSessao = {};
  }

  destinosPorCliente[clienteId] =
  destinosPorCliente[clienteId] || {};

 destinosPorCliente[clienteId][id] = destinos;

 salvarDestinosClientes();
  console.log("[DESTINO]💾 Destinos salvos na config:", id, destinos);

  return res.json({
    ok: true,
    destinos
  });
});

app.get("/destinos/:id", (req, res) => {
  const clienteId = getClienteId(req);

  const id = normalizarSessaoId(
  clienteId,
  req.params.id
 );

  const destinos =
    destinosPorCliente?.[clienteId]?.[id] || [];

  return res.json({
    ok: true,
    destinos
  });
});

// ================ CAMPANHAS =======================

app.post("/campanhas/enviar", async (req, res) => {
  try {
    const clienteId = getClienteId(req);

    const {
      mensagem,
      imagemUrl,
      destinosIds
    } = req.body || {};

    const resultado = await enviarCampanhaManual({
      clienteId,
      mensagem,
      imagemUrl,
      destinosIds,
      destinosPorCliente,
      sessoes,
      configsPorCliente,
      usuarioTemCreditos,
      debitarCreditos,
      corrigirImagemUrl
    });

    return res.json({
      ok: true,
      ...resultado
    });

  } catch (e) {
    console.log("[ERRO]❌ Erro campanha manual:", e.message);

    return res.status(400).json({
      ok: false,
      erro: e.message
    });
  }
});

// ================= TELEGRAM =================

async function enviarTelegram(oferta, mensagem) {
  try {
    if (!config.telegram?.ativo) {
      console.log("[TELEGRAM] Telegram desativado.");
      return;
    }

    const destinos = config.telegram?.destinos || [];

    if (!destinos.length) {
      console.log("[TELEGRAM] Nenhum destino Telegram configurado.");
      return;
    }

    for (const destino of destinos) {
      if (!destino.ativo) continue;

      const token = destino.botToken;
      const chatId = destino.chatId;

      if (!token || !chatId) {
        console.log("[TELEGRAM] Telegram destino incompleto:", destino.nome);
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

      console.log("[TELEGRAM] Telegram enviado:", destino.nome || chatId);

      await new Promise(r => setTimeout(r, 1500));
    }

  } catch (e) {
    console.log("[ERRO] [TELEGRAM] Erro Telegram:", e.message);
  }
}

         
// ================= FUNCÃƒO WHATSAPP =================

async function iniciarWhatsApp(id, force = false) {
  console.log("[WHATSAPP] Iniciando sesso:", id, "force:", force);

  const chaveSessao = id;
  const statusAtual = statusSessao[chaveSessao];

  if (!force && sessoes[id] && ["connecting", "qr", "open", "reconnecting"].includes(statusAtual)) {
    console.log("[WHATSAPP] Sesso j em andamento, no vou recriar:", id, statusAtual);
    return sessoes[id];
  }

  if (!force && qrCodes[id] && statusAtual === "qr") {
    console.log("[WHATSAPP] QR j ativo, no vou recriar:", id);
    return sessoes[id] || null;
  }

  if (force && sessoes[id]) {
    try {
      console.log("[WHATSAPP] Forando reincio da sesso:", id);
      sessoes[id].end?.();
    } catch (e) {
      console.log("[ERRO] [WHATSAPP] Erro ao encerrar sesso antiga:", e.message);
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

const clienteIdMensageiro =
  id.startsWith("user_") && id.includes("_sessao")
    ? id.split("_sessao")[0]
    : "admin";

if (id.startsWith("user_")) {
  console.log("[INFO] Cliente mensageiro:", {
    sessao: id,
    clienteIdMensageiro
  });
}

// =============== EVENTO MENSAGEIRO =================

sock.ev.on("messages.upsert", async ({ messages = [] } = {}) => {
  try {
    for (const mensagem of messages) {
      await processarMensagemRadarAutomatica({
        mensagem,
        sessaoId: id,
        sock
      });

      await mensageiro.tratarMensagemPrivadaAtendimento({
        clienteId: clienteIdMensageiro,
        sessaoId: id,
        sock,
        mensagem,
        planoLiberado: clienteTemRecursoMensageiro(clienteIdMensageiro)
      });
    }
  } catch (e) {
    console.log("[MENSAGEIRO-ERRO]⚠️ messages.upsert:", e.message);
  }
});

sock.ev.on("group-participants.update", async (evento) => {
  
  console.log("[INFO] EVENTO GRUPO MENSAGEIRO:", {
    quando: new Date().toISOString(),
    clienteIdMensageiro,
    sessaoId: id,
    grupoId: evento?.id,
    acao: evento?.action,
    participantes: evento?.participants
  });

   try {
    await mensageiro.tratarEventoGrupoMensageiro({
      clienteId: clienteIdMensageiro,
      sessaoId: id,
      sock,
      evento
    });
  } catch (e) {
    console.log("[ERRO]⚠️ Erro evento Mensageiro:", e.message);
  }
});

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      console.log("[WHATSAPP]📲 QR RECEBIDO:", id);
      qrCodes[id] = await qrcode.toDataURL(qr);
      statusSessao[id] = "qr";
    }

    if (connection === "open") {
      console.log("[WHATSAPP] WHATSAPP CONECTADO:", id);

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

  setTimeout(async () => {
  try {
    await carregarGruposSessao(id, {
  clienteId: clienteIdMensageiro
  });
  } catch (e) {
    console.log(
      "⚠️ Erro ao carregar grupos no pos conexao:",
      e.message
    );
  }
}, 3000);
    }

    if (connection === "close") {
      const motivo = lastDisconnect?.error?.output?.statusCode;

      console.log("[WHATSAPP] WHATSAPP DESCONECTADO:", id);
      console.log("[INFO] Motivo:", motivo);

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
            console.error("[ERRO] ERRO AO RECONECTAR:", e);
            statusSessao[id] = "offline";
            reconectando[id] = false;
          });
        }, 5000);
      }
    }
  });

  return sock;
}



// ================= TESTE AWIN =================

async function testarAwinProdutos() {

  try {

    console.log("[INFO] TESTE AWIN INICIADO");

    const clienteId = "admin";

    const integracao =
    getIntegracaoCliente(clienteId, "awin");

    if (!integracao) {
      console.log("[INFO] Awin no configurada");
      return;
    }

    const {
      publisherId,
      apiToken
    } = integracao.credenciais || {};

    if (!publisherId || !apiToken) {
      console.log("[INFO] Credenciais Awin invlidas");
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

  } catch (e) {

    console.log(
      "âŒ erro teste awin:",
      e.response?.data || e.message
    );

  }
}

// =========================== PROCESSOS ================================

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

function garantirIdsFila() {
  let alterou = false;

  fila = fila.map((item) => {
    if (!item.id) {
      alterou = true;

      return {
        ...item,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`
      };
    }

    return item;
  });

  if (alterou) {
    salvarFila();
    console.log("[FILA] IDs antigos da fila corrigidos");
  }
}

garantirIdsFila();

console.log("[BOOT] Dados iniciais carregados:", {
  fila: fila.length,
  usuarios: usuarios.length,
  integracoesClientes: Object.keys(integracoesPorCliente || {}).length,
  destinosClientes: Object.keys(destinosPorCliente || {}).length
});

app.listen(PORT, () => {
  console.log("[API]🟢🧠 API ONLINE NA PORTA " + PORT);

decairConfiancaCupons();

setInterval(() => {
  decairConfiancaCupons();
}, 4 * 60 * 60 * 1000);

  setTimeout(() => {
    console.log("[WHATSAPP] Reconectando sesses WhatsApp automaticamente...");
 
let sessoesParaReconectar = [
  ...new Set(config?.sessoesWhatsapp || [])
];

sessoesParaReconectar = sessoesParaReconectar
  .filter(id => id && id.includes("_"))
  .filter(id => !id.includes("_user_"))
  .filter(id => !/^user_[^_]+_user_/.test(id));

const sessoesFantasma = sessoesParaReconectar.filter(id => !sessaoPersistidaValida(id));

if (sessoesFantasma.length) {
  console.log("[INFO] Sesses fantasmas removidas da reconexo:", sessoesFantasma);
}

sessoesParaReconectar = sessoesParaReconectar.filter(sessaoPersistidaValida);

config.sessoesWhatsapp = sessoesParaReconectar;
salvarConfig();

    sessoesParaReconectar.forEach((id, index) => {
      setTimeout(() => {
        console.log("[WHATSAPP] Reconectando sesso:", id);
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
  "kabum",
  "awin",
];

const farejadoresMarketplaces = {
  mercadolivre: farejarMercadoLivreModulo,
  shopee: farejarShopee,
  amazon: farejarAmazon,
  aliexpress: farejarAliExpress,
  kabum: farejarKabum,
  awin: farejarAwin,
  magalu: farejarMagalu,
};

let indiceMarketplaceAtual = 0;
let farejadorRodando = false;

async function rodarProximoMarketplace() {

// Farejador global roda apenas no ADMIN MASTER
const admin = usuarios.find(u => u.papel === "admin_master");

if (!admin) {
  console.log("[AVISO] Nenhum admin master encontrado. Farejador global bloqueado.");
  return;
}

  if (farejadorRodando) return;

  if (!config.automacaoAtiva) {
    console.log("[INFO] Farejador parado: automao global desligada");
    return;
  }

  if (!podeRodarAgora()) return;

  const marketplace = ordemMarketplaces[indiceMarketplaceAtual];

  indiceMarketplaceAtual =
    (indiceMarketplaceAtual + 1) % ordemMarketplaces.length;

  const cfg = config.marketplaces?.[marketplace];


  if (!cfg?.ativo) {
    console.log(`[INFO] ${marketplace} desativado. Pulando.`);
    return;
  }

  const farejador = farejadoresMarketplaces[marketplace];

  if (typeof farejador !== "function") {
    console.log(`[INFO] Farejador no encontrado: ${marketplace}`);
    return;
  }

  try {
    farejadorRodando = true;

console.log(`[INFO] Rodada multiusurio: ${marketplace}`);

for (const usuario of usuarios) {
  if (!usuario?.ativo) continue;

  const clienteId = usuario.id;

  if (!usuarioPodeReceberMarketplace(usuario, marketplace)) {
    console.log("[INFO] Usurio no recebe marketplace pelo plano:", {
      clienteId,
      marketplace
    });
    continue;
  }

  const marketplaceIntegracao =
  marketplace === "kabum"
    ? "awin"
    : marketplace;

if (!usuarioTemIntegracaoMarketplace(clienteId, marketplaceIntegracao)) {
  console.log("[AVISO] Usurio sem integrao configurada:", {
    clienteId,
    marketplace,
    marketplaceIntegracao
  });
  continue;
}

  console.log("[INFO] Farejando marketplace para cliente:", {
    clienteId,
    marketplace
  });

console.log("[INFO] CHAMANDO FAREJADOR:", {
  clienteId,
  marketplace,
  funcao: typeof farejador
});


await farejador(clienteId, {
  config,
  integracoesPorCliente,
  getIntegracaoCliente,
  fila,
  salvarFila,
  prepararOfertaGlobal,
  ofertaJaExiste,
  prepararOfertaGlobal,
  ofertaJaExiste,
  deveIgnorarOfertaRepetida,
  registrarOfertaVista,
  classificarCategoriaOferta,
  classificarCategoriaOferta,
  gerarBuscasGlobais,
  gerarHeadersStealth,
  farejarCuponsMercadoLivre,
  importarMercadoLivre: (url, clienteIdAlvo = "admin") =>
  importarMercadoLivre(url, clienteIdAlvo, {
  getIntegracaoCliente,
  gerarLinkAfiliadoMercadoLivre
  }),
  importarAmazon: importarAmazon,
  buscarOfertasShopee,
  normalizarSessaoId,
  aplicarFiltrosUniversais,
  distribuirOfertaParaClientes,
  encurtarUrl,
  gerarDeepLinkAwin,
  importarProdutoKabumViaAwin,

});
}
  
  console.log(`[INFO] Rodada multiusurio finalizada: ${marketplace}`);
 
  } catch (e) {
    console.log(`[ERRO] Erro na rodada ${marketplace}:`, e.message);
  } finally {
    farejadorRodando = false;
  }
}

// ============================= TESTE MANUAL =========================

 setTimeout(async () => {
   console.log("[INFO] TESTE MANUAL ORQUESTRADOR ML");

  const indicemercadolivre =
   ordemMarketplaces.indexOf("mercadolivre");

   if (indicemercadolivre >= 0) {
     indiceMarketplaceAtual = indicemercadolivre;
  }

  await rodarProximoMarketplace();

 }, 60 * 1000);

 

setInterval(() => {
  rodarProximoMarketplace();
}, (config.intervaloFarejadorGlobalMinutos || 10) * 60 * 1000);

setTimeout(() => {
  console.log("[INFO] Primeira rodada do orquestrador em 1 minuto...");
  rodarProximoMarketplace();
}, 1 * 60 * 1000);

// ================= PROCESSADOR DA FILA =================

let ultimoLogPausaFila = 0;

setInterval(() => {
  if (!podeRodarAgora()) {
    const agora = Date.now();

    if (agora - ultimoLogPausaFila > 5 * 60 * 1000) {
      console.log("[FILA] Fila pausada fora do horrio configurado");
      ultimoLogPausaFila = agora;
    }

    return;
  }

  for (const usuario of usuarios) {
    if (!usuario?.ativo) continue;

    processarFila(usuario.id);
  }

}, 10 * 1000);





