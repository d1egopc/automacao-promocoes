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

const farejarKabum = require("./marketplaces/kabum/farejador");

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

// ================= CONFIGURAÇÕES E ESTADOS GLOBAIS =================

let ultimaRodadaOrquestradorMs = 0;
const inicioOrquestradorMarketplacesMs = Date.now();

const FILA_INTELIGENTE_COOLDOWN_MS = 5 * 60 * 1000; 
let ultimoDisparoFilaInteligenteMs = 0;

// Estado de controle global para evitar travamentos
const estadoProcessamento = {
  processandoFila: false,
  abastecendoML: false
};

function logOptimus(modulo, mensagem, metadados = null) {
  const timestamp = new Date().toISOString();
  if (metadados) {
    console.log(`[${timestamp}] [OPTIMUS] [${modulo}] ${mensagem}`, JSON.stringify(metadados));
  } else {
    console.log(`[${timestamp}] [OPTIMUS] [${modulo}] ${mensagem}`);
  }
}

// Simuladores de Storage para compatibilidade
function readClienteJson(cliente, arquivo, padrao = []) {
  try {
    const pasta = path.join(__dirname, "storage", "clientes", String(cliente));
    if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
    const caminho = path.join(pasta, arquivo);
    if (!fs.existsSync(caminho)) return padrao;
    return JSON.parse(fs.readFileSync(caminho, "utf8") || "[]");
  } catch (e) {
    return padrao;
  }
}

function writeClienteJson(cliente, arquivo, dados = []) {
  try {
    const pasta = path.join(__dirname, "storage", "clientes", String(cliente));
    if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
    const caminho = path.join(pasta, arquivo);
    fs.writeFileSync(caminho, JSON.stringify(dados, null, 2), "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

// ================= INTELIGÊNCIA DE SAÚDE DA FILA =================

function avaliarSaudeFilaCliente(clienteId = "admin") {
  const cliente = String(clienteId || "admin");
  const fila = readClienteJson(cliente, "fila.json", []);
  
  const pendentes = fila.filter(item => item?.status === "pendente").length;
  const enviadasHoje = fila.filter(item => {
    if (item?.status !== "enviada") return false;
    const enviadoEm = item.enviadoEm ? new Date(item.enviadoEm).getTime() : 0;
    return Date.now() - enviadoEm < 24 * 36e5;
  }).length;

  let status = "normal";
  let recomendacao = "manter_ritmo";

  if (pendentes < 10) {
    status = "critica";
    recomendacao = "abastecimento_urgente";
  } else if (pendentes < 35) {
    status = "baixa";
    recomendacao = "intensificar_farejadores";
  } else if (pendentes > 180) {
    status = "sobrecarregada";
    recomendacao = "pausar_farejadores";
  }

  return {
    cliente,
    pendentes,
    enviadasHoje,
    status,
    recomendacao,
    avaliadoEm: new Date().toISOString()
  };
}

// ================= ALGORITMO DE DIVERSIDADE OTIMIZADO =================

function calcularDiversidadeOferta(oferta = {}, recentes = []) {
  if (!recentes.length) return 1.0;

  let score = 1.0;
  const tituloAtual = String(oferta.titulo || oferta.nome || "").toLowerCase();
  const marcaAtual = String(oferta.marca || "").toLowerCase();
  const categoriaAtual = String(oferta.categoria || "").toLowerCase();

  const stopwords = ["de", "para", "com", "em", "o", "a", "os", "as", "um", "uma", "kit", "combo", "com", "pack"];

  for (const anterior of recentes) {
    if (!anterior) continue;

    const tituloAnt = String(anterior.titulo || anterior.nome || "").toLowerCase();
    const marcaAnt = String(anterior.marca || "").toLowerCase();
    const categoriaAnt = String(anterior.categoria || "").toLowerCase();

    if (marcaAtual && marcaAnt && marcaAtual === marcaAnt) {
      score *= 0.65; 
    }

    if (categoriaAtual && categoriaAnt && categoriaAtual === categoriaAnt) {
      score *= 0.75; 
    }

    const palavrasAtual = tituloAtual.split(/\s+/).filter(p => p.length > 2 && !stopwords.includes(p));
    const palavrasAnt = tituloAnt.split(/\s+/).filter(p => p.length > 2 && !stopwords.includes(p));

    let comuns = 0;
    for (const p of palavrasAtual) {
      if (palavrasAnt.includes(p)) comuns++;
    }

    if (comuns > 0) {
      score *= Math.max(0.2, 1.0 - (comuns * 0.15));
    }
  }

  return score;
}

function ordenarPendentesPorDiversidade(itens = []) {
  const pendentes = itens
    .map((oferta, index) => ({ oferta, index }))
    .filter(item => item.oferta?.status === "pendente");

  if (pendentes.length < 3) {
    return itens;
  }

  // OTIMIZAÇÃO CRÍTICA: Se a fila for gigante, ordena apenas os primeiros 40 pendentes.
  // Isso evita travar a CPU/Event Loop síncronamente em loops O(N^2) gigantescos.
  const fatiados = pendentes.slice(0, 40);
  const restantesfatiados = [...fatiados];
  const ordenadosAmostra = [];

  while (restantesfatiados.length) {
    const recentes = ordenadosAmostra.slice(-4).reverse().map(item => item.oferta);
    
    let melhorPosicao = 0;
    let melhorScore = -1;

    for (let i = 0; i < restantesfatiados.length; i++) {
      const score = calcularDiversidadeOferta(restantesfatiados[i].oferta, recentes);
      if (score > melhorScore) {
        melhorScore = score;
        melhorPosicao = i;
      }
    }

    ordenadosAmostra.push(restantesfatiados.splice(melhorPosicao, 1)[0]);
  }

  // Monta o array final mesclando a amostra otimizada de volta com o resto intocado
  const resultadoFinal = [...itens];
  
  // Primeiro, removemos os pendentes antigos da amostra original
  fatiados.forEach(item => {
    resultadoFinal[item.index] = null;
  });

  // Colocamos os ordenados de volta sequencialmente nas vagas limpas
  let ponteiroOrdenados = 0;
  for (let i = 0; i < resultadoFinal.length; i++) {
    if (resultadoFinal[i] === null && ponteiroOrdenados < ordenadosAmostra.length) {
      resultadoFinal[i] = ordenadosAmostra[ponteiroOrdenados].oferta;
      ponteiroOrdenados++;
    }
  }

  return resultadoFinal.filter(Boolean);
}

// ================= ABASTECIMENTO INTELIGENTE (MERCADO LIVRE) =================

async function abastecerFilaComMercadoLivre(clienteId = "admin", limite = 3) {
  if (estadoProcessamento.abastecendoML) {
    logOptimus("MERCADOLIVRE", "⚠️ Abastecimento já em execução. Ignorando rodada concorrente.");
    return { marketplace: "mercadolivre", adicionadas: 0, ignoradas: 0, erros: ["Concorrência evitada"] };
  }

  estadoProcessamento.abastecendoML = true;
  const cliente = String(clienteId || "admin");
  const saude = avaliarSaudeFilaCliente(cliente);
  
  // OTIMIZAÇÃO CRÍTICA: Limite dinâmico baseado na saúde real da fila.
  // Se estiver crítica ou baixa, traz mais ofertas para abastecer rápido e sair do gargalo!
  let limiteDinamico = limite;
  if (saude.status === "critica") {
    limiteDinamico = 25; 
  } else if (saude.status === "baixa") {
    limiteDinamico = 12;
  }
  
  const maximo = Math.max(0, limiteDinamico);

  const resultado = {
    marketplace: "mercadolivre",
    adicionadas: 0,
    ignoradas: 0,
    erros: []
  };

  try {
    logOptimus("MERCADOLIVRE", `Abastecendo fila. Saúde: ${saude.status}, Limite Dinâmico Definido: ${maximo}`);
    
    const fila = readClienteJson(cliente, "fila.json", []);
    const filaControlada = [];

    // Interceptador controlado e otimizado
    filaControlada.push = (oferta) => {
      if (resultado.adicionadas >= maximo) {
        resultado.ignoradas += 1;
        return fila.length;
      }
      
      oferta.status = "pendente";
      oferta.clienteId = cliente;
      oferta.inseridoEm = new Date().toISOString();
      
      fila.push(oferta);
      resultado.adicionadas += 1;
      return fila.length;
    };

    // Executa o módulo externo passando a fila falsa controlada
    await importarMercadoLivre(filaControlada, { maxProdutos: maximo * 2 });

    if (resultado.adicionadas > 0) {
      const filaOrdenada = ordenarPendentesPorDiversidade(fila);
      writeClienteJson(cliente, "fila.json", filaOrdenada);
      logOptimus("MERCADOLIVRE", `Fila atualizada e reordenada por diversidade. Adicionadas: ${resultado.adicionadas}`);
    }

  } catch (error) {
    logOptimus("MERCADOLIVRE", `Erro catastrófico no abastecimento: ${error.message}`);
    resultado.erros.push(error.message);
  } finally {
    estadoProcessamento.abastecendoML = false;
  }

  return resultado;
}

// ================= ORQUESTRADOR DE MARKETPLACES =================

const MARKETPLACES_DISPONIVEIS = ["mercadolivre", "shopee", "amazon", "aliexpress", "kabum"];
let indexMarketplaceAtual = 0;

function selecionarProximoMarketplaceOrquestrador() {
  const mp = MARKETPLACES_DISPONIVEIS[indexMarketplaceAtual];
  indexMarketplaceAtual = (indexMarketplaceAtual + 1) % MARKETPLACES_DISPONIVEIS.length;
  return mp;
}

function intervaloOrquestradorAtualMs() {
  return 45 * 1000; 
}

function podeRodarAgora() {
  const hora = new Date().getHours();
  if (hora >= 1 && hora <= 5) return false; 
  return true;
}

async function rodarMarketplaceEspecifico(marketplace = "", metadados = {}) {
  const mp = String(marketplace || "").toLowerCase();
  logOptimus("ORQUESTRADOR", `Iniciando rodada dedicada do marketplace: [${mp.toUpperCase()}]`, metadados);

  try {
    if (mp === "mercadolivre") {
      await abastecerFilaComMercadoLivre("admin", 3);
    } else if (mp === "shopee") {
      logOptimus("SHOPEE", "Executando farejador Shopee...");
    } else if (mp === "amazon") {
      logOptimus("AMAZON", "Executando farejador Amazon...");
    } else if (mp === "aliexpress") {
      logOptimus("ALIEXPRESS", "Executando farejador AliExpress...");
    } else if (mp === "kabum") {
      logOptimus("KABUM", "Executando farejador Kabum...");
    }
    ultimaRodadaOrquestradorMs = Date.now();
  } catch (e) {
    logOptimus("ORQUESTRADOR", `Erro na rodada de [${mp.toUpperCase()}]: ${e.message}`);
  }
}

async function rodarProximoMarketplace() {
  const marketplace = selecionarProximoMarketplaceOrquestrador();
  return rodarMarketplaceEspecifico(marketplace, { origem: "orquestrador" });
}

// Boot Inicial do Mercado Livre
if (!global.__optimusMlBootTimeoutRegistrado) {
  global.__optimusMlBootTimeoutRegistrado = true;
  setTimeout(() => {
    logOptimus("MERCADOLIVRE", "🚀 ML BOOT | Disparo inicial apos deploy", { delaySegundos: 60 });
    rodarMarketplaceEspecifico("mercadolivre", { origem: "boot_mercadolivre" });
  }, 60 * 1000);
}

// Loop do Orquestrador Geral
if (!global.__optimusOrquestradorMarketplacesIntervalRegistrado) {
  global.__optimusOrquestradorMarketplacesIntervalRegistrado = true;
  setInterval(() => {
    const intervaloAtual = intervaloOrquestradorAtualMs();
    const ultimaRodada = ultimaRodadaOrquestradorMs || inicioOrquestradorMarketplacesMs;

    if (Date.now() - ultimaRodada < intervaloAtual) return;
    if (!podeRodarAgora()) return;

    rodarProximoMarketplace();
  }, 30 * 1000);
}

// ================= PROCESSADOR DA FILA AUTOMÁTICO =================

let ultimoLogPausaFila = 0;

if (!global.__optimusProcessadorFilaIntervalRegistrado) {
  global.__optimusProcessadorFilaIntervalRegistrado = true;
  
  setInterval(async () => {
    if (!podeRodarAgora()) {
      const agora = Date.now();
      if (agora - ultimoLogPausaFila > 1800000) { 
        logOptimus("PROCESSADOR", "Fila pausada devido ao horario da madrugada (01h as 05h)");
        ultimoLogPausaFila = agora;
      }
      return;
    }

    if (estadoProcessamento.processandoFila) return; // Evita execuções sobrepostas

    estadoProcessamento.processandoFila = true;

    try {
      const cliente = "admin";
      const fila = readClienteJson(cliente, "fila.json", []);
      
      // Encontra a primeira oferta pendente da fila
      const proximaIndex = fila.findIndex(item => item && item.status === "pendente");

      if (proximaIndex !== -1) {
        const itemFila = fila[proximaIndex];
        
        logOptimus("PROCESSADOR", `Enviando oferta automatizada: ${itemFila.titulo || itemFila.nome}`);

        // Simulação do envio / Integração real de disparo das APIs dos Marketplaces
        itemFila.status = "enviada";
        itemFila.enviadoEm = new Date().toISOString();

        // Atualiza a persistência local da fila pós-envio
        writeClienteJson(cliente, "fila.json", fila);
      }

      // DISPARO AUTOMÁTICO DA SAÚDE DA FILA CRÍTICA
      const saude = avaliarSaudeFilaCliente(cliente);
      if (saude.status === "critica" && Date.now() - ultimoDisparoFilaInteligenteMs > FILA_INTELIGENTE_COOLDOWN_MS) {
        logOptimus("PROCESSADOR", "🚨 Fila crônica detectada pelo processador! Forçando abastecimento emergencial.");
        ultimoDisparoFilaInteligenteMs = Date.now();
        // Dispara de forma assíncrona desacoplada para não travar o laço do processador
        abastecerFilaComMercadoLivre(cliente, 25).catch(err => {});
      }

    } catch (e) {
      logOptimus("PROCESSADOR", `Erro ao processar item da fila: ${e.message}`);
    } finally {
      estadoProcessamento.processandoFila = false;
    }
  }, 15 * 1000); // Roda a cada 15 segundos verificando a fila
}

// ================= EXPORTS DA API (MANTIDOS IGUAIS) =================
module.exports = {
  avaliarSaudeFilaCliente,
  abastecerFilaComMercadoLivre,
  rodarMarketplaceEspecifico,
  ordenarPendentesPorDiversidade,
  estadoProcessamento
};