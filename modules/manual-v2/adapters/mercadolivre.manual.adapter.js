const {
  normalizarOfertaManualV2
} = require("../manual-offers.contract");
const {
  importarMercadoLivre: importarMercadoLivreAtual
} = require("../../../marketplaces/mercadolivre/importar");

const ADAPTER_MERCADOLIVRE_MANUAL_V2 = "mercadolivre.manual.adapter";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarChave(valor = "") {
  return texto(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const atual = texto(valor);
    if (atual) return atual;
  }
  return "";
}

function origemPrecoAnteriorComprovada(produto = {}) {
  const origem = normalizarChave(
    produto.precoAnteriorOrigem ||
    produto.precoAntigoOrigem ||
    produto.precoOriginalOrigem ||
    produto.origemPrecoAnterior ||
    produto.origemPrecoAntigo ||
    ""
  );

  if (!origem) return false;
  if (origem.includes("desconto") || origem.includes("calcul")) return false;

  return (
    origem.includes("html") ||
    origem.includes("jsonld") ||
    origem.includes("pagina") ||
    origem.includes("page") ||
    origem.includes("api") ||
    origem.includes("schema") ||
    origem.includes("meta")
  );
}

function precoAnteriorManualMercadoLivre(produto = {}) {
  const explicito = primeiroTexto(produto.precoAnterior);
  if (explicito) return explicito;
  if (!origemPrecoAnteriorComprovada(produto)) return "";
  return primeiroTexto(produto.precoAntigo, produto.precoOriginal, produto.precoDe);
}

function categoriaManualMercadoLivre(produto = {}) {
  const categoria = primeiroTexto(produto.categoriaProduto, produto.categoria);
  const chave = normalizarChave(categoria);
  if (!categoria || ["mercadolivre", "ml"].includes(chave)) return "";
  return categoria;
}

function cupomManualMercadoLivre(produto = {}) {
  const origem = normalizarChave(produto.cupomOrigem || produto.tipoCupom || produto.cupomTipo || "");
  if (origem.includes("texto")) return "";
  return primeiroTexto(produto.cupom, produto.codigoCupom);
}

function observacoesMercadoLivre(produto = {}, avisos = []) {
  return [
    produto.aviso || "",
    produto.avisoCupom || "",
    ...avisos
  ]
    .map(texto)
    .filter(Boolean)
    .join(" | ");
}

function camposConfiaveisMercadoLivre(oferta = {}) {
  return [
    ["urlOriginal", oferta.urlOriginal],
    ["urlAfiliada", oferta.urlAfiliada],
    ["titulo", oferta.titulo],
    ["precoAtual", oferta.precoAtual],
    ["precoAnterior", oferta.precoAnterior],
    ["imagem", oferta.imagem],
    ["categoria", oferta.categoria],
    ["cupom", oferta.cupom],
    ["parcelamento", oferta.parcelamento]
  ]
    .filter(([, valor]) => texto(valor))
    .map(([campo]) => campo);
}

function avisosMercadoLivre(produto = {}, precoAnterior = "") {
  const avisos = [];
  const temPrecoDerivado = primeiroTexto(produto.precoAntigo, produto.precoOriginal, produto.precoDe) &&
    !precoAnterior;

  if (temPrecoDerivado) {
    avisos.push("preco_anterior_ignorado_sem_origem_comprovada");
  }

  if (produto.fallbackTituloMercadoLivre === true || produto.fallbackPrecoMercadoLivre === true) {
    avisos.push("fallback_textual_ignorado_no_manual_v2");
  }

  return avisos;
}

async function importarMercadoLivreManualV2(urlManual = "", opcoes = {}) {
  const urlOriginal = texto(urlManual);
  if (!urlOriginal) {
    throw new Error("url_manual_obrigatoria");
  }

  const clienteId = texto(opcoes.clienteId) || "admin";
  const importarMercadoLivre = opcoes.importarMercadoLivre || importarMercadoLivreAtual;
  const getIntegracaoCliente = typeof opcoes.getIntegracaoCliente === "function"
    ? opcoes.getIntegracaoCliente
    : () => null;
  const gerarLinkAfiliadoMercadoLivre = typeof opcoes.gerarLinkAfiliadoMercadoLivre === "function"
    ? opcoes.gerarLinkAfiliadoMercadoLivre
    : async () => "";

  const produto = await importarMercadoLivre(urlOriginal, clienteId, {
    getIntegracaoCliente,
    gerarLinkAfiliadoMercadoLivre
  });
  if (!produto || typeof produto !== "object") {
    return {
      ok: false,
      erro: "mercadolivre_importacao_sem_dados_confiaveis",
      motivo: "mercadolivre_importacao_sem_dados_confiaveis",
      aviso: "Nao foi possivel importar dados confiaveis do Mercado Livre.",
      marketplaceDetectado: "mercadolivre",
      parseOnly: true,
      urlOriginal
    };
  }
  const dados = produto && typeof produto === "object" ? produto : {};
  const precoAnterior = precoAnteriorManualMercadoLivre(dados);
  const avisos = avisosMercadoLivre(dados, precoAnterior);

  const oferta = normalizarOfertaManualV2(
    {
      marketplace: "mercadolivre",
      urlOriginal: primeiroTexto(dados.linkOriginal, dados.urlFinal, urlOriginal),
      urlAfiliada: primeiroTexto(dados.linkAfiliado, dados.linkFinal, dados.link),
      titulo: primeiroTexto(dados.titulo, dados.nome),
      precoAtual: primeiroTexto(dados.precoAtual, dados.preco),
      precoAnterior,
      imagem: primeiroTexto(dados.imagem),
      categoria: categoriaManualMercadoLivre(dados),
      cupom: cupomManualMercadoLivre(dados),
      parcelamento: primeiroTexto(dados.parcelamento),
      observacoes: observacoesMercadoLivre(dados, avisos),
      fonteImportacao: {
        marketplaceDetectado: "mercadolivre",
        adapter: ADAPTER_MERCADOLIVRE_MANUAL_V2,
        parseOnly: true,
        avisos
      }
    },
    {
      clienteId,
      now: opcoes.now,
      idFactory: opcoes.idFactory
    }
  );

  oferta.fonteImportacao.camposConfiaveis = camposConfiaveisMercadoLivre(oferta);

  return oferta;
}

module.exports = {
  ADAPTER_MERCADOLIVRE_MANUAL_V2,
  importarMercadoLivreManualV2,
  precoAnteriorManualMercadoLivre,
  origemPrecoAnteriorComprovada
};
