const {
  readGlobalJson,
  writeGlobalJson
} = require("../../utils/storage");

const ARQUIVO_OFERTAS_VISTAS = "ofertas_vistas.json";

function normalizarTextoLocal(texto = "") {
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&quot;/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function garantirArquivoOfertasVistas() {
  const atual = readGlobalJson(ARQUIVO_OFERTAS_VISTAS, null);

  if (!Array.isArray(atual)) {
    writeGlobalJson(ARQUIVO_OFERTAS_VISTAS, []);
  }
}

function carregarOfertasVistas() {
  try {
    garantirArquivoOfertasVistas();

    const dados = readGlobalJson(ARQUIVO_OFERTAS_VISTAS, []);

    return Array.isArray(dados) ? dados : [];
  } catch (e) {
    console.log("[ERRO] Erro ao carregar memria de ofertas:", e.message);
    return [];
  }
}

function salvarOfertasVistas(lista = []) {
  try {
    garantirArquivoOfertasVistas();

    writeGlobalJson(ARQUIVO_OFERTAS_VISTAS, lista.slice(-5000));
  } catch (e) {
    console.log("[ERRO] Erro ao salvar memria de ofertas:", e.message);
  }
}

function precoNumero(valor) {
  return Number(
    String(valor || "0")
      .replace(/[^\d,.-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  ) || 0;
}

function chaveOferta(oferta = {}) {
  const clienteId = normalizarTextoLocal(
    oferta.clienteId || "admin"
  );

  const marketplace = normalizarTextoLocal(
    oferta.marketplace || "geral"
  );

  let titulo = normalizarTextoLocal(
    oferta.titulo || oferta.nome || ""
  );

  titulo = titulo
    .replace(/\b(oferta|promocao|promocao|original|novo|nova|kaBuM|kabum)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return `${clienteId}|${marketplace}|${titulo}`;
}


function janelaHorasPorCategoria(oferta = {}) {
  const categoria = normalizarTextoLocal(oferta.categoria || "");

  if (
    categoria.includes("gamer") ||
    categoria.includes("hardware") ||
    categoria.includes("computadores")
  ) {
    return 8;
  }

  if (
    categoria.includes("roupas") ||
    categoria.includes("moda") ||
    categoria.includes("tenis") ||
    categoria.includes("chinelos")
  ) {
    return 4;
  }

  return 6;
}

function deveIgnorarOfertaRepetida(oferta = {}) {
  const agora = Date.now();
  const vistas = carregarOfertasVistas();
  const chave = chaveOferta(oferta);

  const anterior = vistas
    .filter(item => item.chave === chave)
    .sort((a, b) => new Date(b.vistoEm) - new Date(a.vistoEm))[0];

  if (!anterior) {
    return false;
  }

  const horasPassadas =
    (agora - new Date(anterior.vistoEm).getTime()) / 36e5;

  const precoAtual = precoNumero(oferta.precoAtual || oferta.preco);
  const precoAnterior = precoNumero(anterior.precoAtual || anterior.preco);

  const temCupomNovo =
    oferta.cupom &&
    String(oferta.cupom).trim() &&
    String(oferta.cupom).trim() !== String(anterior.cupom || "").trim();

  const quedaPreco =
    precoAnterior > 0 &&
    precoAtual > 0 &&
    precoAtual <= precoAnterior * 0.92;

  if (horasPassadas < 1 && !temCupomNovo && !quedaPreco) {
    console.log("[INFO] Oferta repetida ignorada <1h:", oferta.titulo || oferta.nome);
    return true;
  }

  const janelaHoras = janelaHorasPorCategoria(oferta);

  if (horasPassadas < janelaHoras && !temCupomNovo && !quedaPreco) {
    console.log("[INFO] Oferta repetida ignorada:", {
      titulo: oferta.titulo || oferta.nome,
      horasPassadas: Number(horasPassadas.toFixed(2)),
      janelaHoras
    });
    return true;
  }

  return false;
}

function registrarOfertaVista(oferta = {}) {
  const vistas = carregarOfertasVistas();

  vistas.push({
    chave: chaveOferta(oferta),
    marketplace: oferta.marketplace || "",
    titulo: oferta.titulo || oferta.nome || "",
    categoria: oferta.categoria || "",
    preco: oferta.preco || oferta.precoAtual || "",
    precoAtual: oferta.precoAtual || oferta.preco || "",
    cupom: oferta.cupom || "",
    vistoEm: new Date().toISOString()
  });

  salvarOfertasVistas(vistas);
}

module.exports = {
  deveIgnorarOfertaRepetida,
  registrarOfertaVista
};
