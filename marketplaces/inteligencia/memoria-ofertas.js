const {
  readGlobalJson,
  writeGlobalJson
} = require("../../utils/storage");

const ARQUIVO_OFERTAS_VISTAS = "ofertas_vistas.json";

// --- OTIMIZAÇÃO: Cache em RAM para evitar leitura constante de disco ---
let CACHE_OFERTAS_VISTAS = null;
let ESTA_SALVANDO = false;

function normalizarTextoLocal(texto = "") {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&quot;/g, "")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function garantirArquivoOfertasVistas() {
  const atual = readGlobalJson(ARQUIVO_OFERTAS_VISTAS, null);
  if (!Array.isArray(atual)) {
    writeGlobalJson(ARQUIVO_OFERTAS_VISTAS, []);
  }
}

// OTIMIZADO: Só lê do disco uma única vez quando o servidor inicia
function carregarOfertasVistas() {
  if (CACHE_OFERTAS_VISTAS !== null) {
    return CACHE_OFERTAS_VISTAS;
  }
  try {
    garantirArquivoOfertasVistas();
    const dados = readGlobalJson(ARQUIVO_OFERTAS_VISTAS, []);
    CACHE_OFERTAS_VISTAS = Array.isArray(dados) ? dados : [];
    return CACHE_OFERTAS_VISTAS;
  } catch (e) {
    console.log("[ERRO] Erro ao carregar memoria de ofertas:", e.message);
    CACHE_OFERTAS_VISTAS = [];
    return CACHE_OFERTAS_VISTAS;
  }
}

// OTIMIZADO: Salva no disco sem bloquear o Event Loop (Desacoplado)
function salvarOfertasVistas(lista = []) {
  if (ESTA_SALVANDO) return; // Evita gravações simultâneas concorrentes
  
  ESTA_SALVANDO = true;
  // setTimeout joga a escrita pesada para a próxima iteração do loop, aliviando a requisição atual
  setTimeout(() => {
    try {
      garantirArquivoOfertasVistas();
      writeGlobalJson(ARQUIVO_OFERTAS_VISTAS, lista.slice(-5000)); // Reduzido ligeiramente para 5k para melhor performance
    } catch (e) {
      console.log("[ERRO] Erro ao salvar memoria de ofertas:", e.message);
    } finally {
      ESTA_SALVANDO = false;
    }
  }, 50); 
}

function precoNumero(valor) {
  return Number(
    String(valor || "0")
      .replace(/[^\d,.-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  ) || 0;
}

function descontoNumero(oferta = {}) {
  return Number(String(oferta.desconto || "0").replace(/[^\d]/g, "")) || 0;
}

function extrairProdutoId(oferta = {}) {
  const texto = [
    oferta.idProduto,
    oferta.productId,
    oferta.asin,
    oferta.mlb,
    oferta.itemId,
    oferta.linkOriginal,
    oferta.link,
    oferta.linkAfiliado
  ].filter(Boolean).join(" ");

  const mlb = String(texto).match(/MLB-?\d{6,}/i)?.[0];
  if (mlb) return mlb.toUpperCase().replace("MLB-", "MLB");

  const asin = String(texto).match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i)?.[1];
  if (asin) return asin.toUpperCase();

  return "";
}

function chaveOferta(oferta = {}) {
  const clienteId = normalizarTextoLocal(oferta.clienteId || "admin");
  const marketplace = normalizarTextoLocal(oferta.marketplace || "geral");
  const produtoId = extrairProdutoId(oferta);

  if (produtoId) {
    return `${clienteId}|${marketplace}|produto:${produtoId}`;
  }

  let titulo = normalizarTextoLocal(oferta.titulo || oferta.nome || "");

  titulo = titulo
    .replace(/\b(oferta|promocao|promoção|original|novo|nova|kit|combo)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return `${clienteId}|${marketplace}|titulo:${titulo}`;
}

function ofertaOrigemRadar(oferta = {}) {
  return String(oferta.origem || "").toLowerCase() === "radar" ||
    oferta.radar === true ||
    oferta.radarNaFila === true;
}

function cupomValidoMemoria(oferta = {}) {
  const cupom = String(oferta.cupom || "").trim().toLowerCase();
  return Boolean(
    cupom &&
    cupom !== "copiado" &&
    cupom !== "cupom copiado" &&
    cupom !== "sem cupom"
  );
}

function ofertaTemBeneficioMemoria(oferta = {}) {
  return Boolean(
    cupomValidoMemoria(oferta) ||
    String(oferta.tipoCupom || "").trim() ||
    String(oferta.avisoCupom || "").trim() ||
    String(oferta.beneficioExtra || "").trim() ||
    String(oferta.linkResgateCupom || "").trim() ||
    String(oferta.descontoPix || "").trim() ||
    String(oferta.descontoApp || "").trim() ||
    descontoNumero(oferta) >= 25 ||
    Number(oferta.score || 0) >= 80
  );
}

function janelaHorasPorOferta(oferta = {}) {
  const categoria = normalizarTextoLocal(oferta.categoria || "");
  const marketplace = normalizarTextoLocal(oferta.marketplace || "");
  const ehRadar = ofertaOrigemRadar(oferta);

  if (ehRadar) return 0.5;
  if (marketplace.includes("mercadolivre") || marketplace.includes("mercado livre")) return 0.5;
  if (marketplace.includes("shopee")) return 2;
  if (marketplace.includes("amazon")) return 3;

  if (
    categoria.includes("roupas") || categoria.includes("moda") ||
    categoria.includes("tenis") || categoria.includes("chinelos")
  ) {
    return 2;
  }

  if (
    categoria.includes("gamer") || categoria.includes("hardware") ||
    categoria.includes("computadores") || categoria.includes("notebook")
  ) {
    return 5;
  }

  return 4;
}

function quedaPrecoRelevante(precoAtual = 0, precoAnterior = 0) {
  if (!precoAtual || !precoAnterior) return false;

  const diferenca = precoAnterior - precoAtual;
  const percentual = diferenca / precoAnterior;

  if (percentual >= 0.12) return true;
  if (precoAnterior <= 30 && diferenca >= 5) return true;
  if (precoAnterior <= 80 && diferenca >= 10) return true;
  if (precoAnterior > 80 && diferenca >= 20) return true;

  return false;
}

function deveIgnorarOfertaRepetida(oferta = {}) {
  const agora = Date.now();
  const vistas = carregarOfertasVistas(); // Puxa instantaneamente do Cache RAM
  const chave = chaveOferta(oferta);

  // OTIMIZAÇÃO: Busca reversa simples e rápida para evitar ordenar 7000 itens a cada request
  let anterior = null;
  for (let i = vistas.length - 1; i >= 0; i--) {
    if (vistas[i].chave === chave) {
      anterior = vistas[i];
      break;
    }
  }

  if (!anterior) return false;

  const horasPassadas = (agora - new Date(anterior.vistoEm).getTime()) / 36e5;
  const precoAtual = precoNumero(oferta.precoAtual || oferta.preco);
  const precoAnterior = precoNumero(anterior.precoAtual || anterior.preco);

  const cupomAtual = String(oferta.cupom || "").trim();
  const cupomAnterior = String(anterior.cupom || "").trim();

  const temCupomNovo = cupomAtual && cupomAtual.toLowerCase() !== "copiado" && cupomAtual !== cupomAnterior;
  const ehRadar = ofertaOrigemRadar(oferta);
  const temBeneficio = ofertaTemBeneficioMemoria(oferta);
  const desconto = descontoNumero(oferta);
  const quedaPreco = quedaPrecoRelevante(precoAtual, precoAnterior);

  const marketplace = normalizarTextoLocal(oferta.marketplace || oferta.mercado || "");

  if (marketplace.includes("mercadolivre") || marketplace.includes("mercado livre")) {
    if (ehRadar || temBeneficio || desconto >= 5 || quedaPreco) {
      return false;
    }
  }

  if (ehRadar) return false;
  if (temCupomNovo) return false;
  if (temBeneficio && horasPassadas >= 0.25) return false;
  if (desconto >= 25 && horasPassadas >= 0.25) return false;
  if (quedaPreco && horasPassadas >= 0.25) return false;

  if (horasPassadas < 0.25 && !temCupomNovo && !quedaPreco && !temBeneficio) {
    return true;
  }

  const janelaHoras = janelaHorasPorOferta(oferta);

  if (horasPassadas < janelaHoras && !temCupomNovo && !quedaPreco && !temBeneficio) {
    return true;
  }

  return false;
}

function registrarOfertaVista(oferta = {}) {
  const vistas = carregarOfertasVistas(); // Puxa do Cache RAM em 0ms

  vistas.push({
    chave: chaveOferta(oferta),
    produtoId: extrairProdutoId(oferta),
    clienteId: oferta.clienteId || "admin",
    marketplace: oferta.marketplace || "",
    titulo: oferta.titulo || oferta.nome || "",
    categoria: oferta.categoria || "",
    preco: oferta.preco || oferta.precoAtual || "",
    precoAtual: oferta.precoAtual || oferta.preco || "",
    cupom: oferta.cupom || "",
    tipoCupom: oferta.tipoCupom || "",
    avisoCupom: oferta.avisoCupom || "",
    origem: oferta.origem || "",
    vistoEm: new Date().toISOString()
  });

  // Atualiza o cache RAM e despacha o salvamento assíncrono em segundo plano
  CACHE_OFERTAS_VISTAS = vistas.slice(-5000);
  salvarOfertasVistas(CACHE_OFERTAS_VISTAS);
}

module.exports = {
  deveIgnorarOfertaRepetida,
  registrarOfertaVista
};