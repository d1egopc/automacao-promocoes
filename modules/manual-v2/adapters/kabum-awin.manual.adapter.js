const axios = require("axios");
const {
  normalizarOfertaManualV2
} = require("../manual-offers.contract");
const {
  importarProdutoKabumViaAwin: importarProdutoKabumViaAwinAtual
} = require("../../../marketplaces/kabum/importador");
const {
  criarGerarDeepLinkAwin
} = require("../../marketplaces/conversores/awin.converter");
const {
  obterProgramaAwin
} = require("../../../utils/integracoes");

const ADAPTER_KABUM_AWIN_MANUAL_V2 = "kabum-awin.manual.adapter";

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

function urlKabumProduto(url = "") {
  try {
    const parsed = new URL(texto(url));
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return host.endsWith("kabum.com.br") && /^\/produto\/\d+(?:\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function produtoKabumGenerico(produto = {}) {
  const titulo = normalizarChave(produto.titulo || produto.nome);
  const motivo = normalizarChave(
    produto.motivo ||
    produto.motivoFalha ||
    produto.erroTecnico ||
    produto.aviso ||
    produto.statusDetalhe ||
    ""
  );

  if (!titulo || titulo === "produtoimportadodeawin" || titulo === "kabum" || titulo === "brkabum") return true;
  if (motivo.includes("generico") || motivo.includes("bloqueou") || motivo.includes("intermediario")) return true;
  if (motivo.includes("naocomprovado") || motivo.includes("403")) return true;
  return false;
}

function produtoIdKabumManual(produto = {}, urlOriginal = "") {
  return primeiroTexto(
    produto.produtoIdCanonico,
    produto.produtoId,
    produto.idProdutoKabum,
    produto.kabumProdutoId,
    texto(urlOriginal).match(/\/produto\/(\d+)/i)?.[1]
  );
}

function origemPrecoAnteriorComprovadaKabum(produto = {}) {
  const origem = normalizarChave(
    produto.precoAnteriorOrigem ||
    produto.precoAntigoOrigem ||
    produto.precoOriginalOrigem ||
    produto.origemPrecoAnterior ||
    produto.origemPrecoAntigo ||
    ""
  );

  if (primeiroTexto(produto.precoAnterior)) return true;
  if (!origem) {
    return Boolean(primeiroTexto(produto.precoAntigo, produto.precoOriginal, produto.precoDe)) &&
      Boolean(produtoIdKabumManual(produto, produto.linkOriginal || produto.urlOriginal || ""));
  }
  if (origem.includes("desconto") || origem.includes("calcul")) return false;

  return (
    origem.includes("html") ||
    origem.includes("parser") ||
    origem.includes("pagina") ||
    origem.includes("page") ||
    origem.includes("jsonld") ||
    origem.includes("precosvalidos")
  );
}

function precoAnteriorManualKabum(produto = {}) {
  const explicito = primeiroTexto(produto.precoAnterior);
  if (explicito) return explicito;
  if (!origemPrecoAnteriorComprovadaKabum(produto)) return "";
  return primeiroTexto(produto.precoAntigo, produto.precoOriginal, produto.precoDe);
}

function urlAfiliadaAwinGerada(produto = {}, urlOriginal = "") {
  const candidata = primeiroTexto(produto.urlAfiliada, produto.linkAfiliado, produto.linkFinal, produto.link);
  if (!candidata || candidata === urlOriginal || candidata === produto.linkOriginal) return "";

  try {
    const parsed = new URL(candidata);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "awin1.com" || host.endsWith(".awin1.com")) return candidata;
    if (host === "awin.com" || host.endsWith(".awin.com")) return candidata;
    if (host.includes("awin") && /cread|click|linkbuilder|ued|awinmid|awinaffid/i.test(candidata)) return candidata;
  } catch {}

  return "";
}

function categoriaManualKabum(produto = {}) {
  const categoria = primeiroTexto(produto.categoriaProduto, produto.categoria);
  const chave = normalizarChave(categoria);
  if (!categoria || chave === "kabum" || chave === "awin") return "";
  return categoria;
}

function criarGerarDeepLinkAwinManualV2(opcoes = {}) {
  if (typeof opcoes.gerarDeepLinkAwin === "function") return opcoes.gerarDeepLinkAwin;

  if (typeof opcoes.getIntegracaoCliente !== "function") {
    return async () => "";
  }

  return criarGerarDeepLinkAwin({
    axios: opcoes.axios || axios,
    getIntegracaoCliente: opcoes.getIntegracaoCliente,
    obterProgramaAwin: opcoes.obterProgramaAwin || obterProgramaAwin,
    registrarSucessoIntegracao: opcoes.registrarSucessoIntegracao,
    registrarAlertaIntegracao: opcoes.registrarAlertaIntegracao
  });
}

function avisosKabumAwin(produto = {}, contexto = {}) {
  const avisos = [];

  if (contexto.generico) {
    avisos.push("kabum_produto_nao_comprovado_sem_dados_fabricados");
  }

  if (!contexto.urlAfiliada) {
    avisos.push("awin_deeplink_ausente_url_afiliada_vazia");
  }

  if (!contexto.precoAnterior && primeiroTexto(produto.precoAntigo, produto.precoOriginal, produto.precoDe)) {
    avisos.push("preco_anterior_ignorado_sem_origem_comprovada");
  }

  if (!primeiroTexto(produto.titulo, produto.precoAtual, produto.preco, produto.imagem)) {
    avisos.push("kabum_retorno_parcial_campos_editaveis");
  }

  return [...new Set([
    ...avisos,
    produto.aviso || "",
    produto.avisoCupom || "",
    produto.avisoPagamento || ""
  ].map(texto).filter(Boolean))];
}

function camposConfiaveisKabumAwin(oferta = {}) {
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

function observacoesKabumAwin(avisos = []) {
  return avisos
    .map(texto)
    .filter(Boolean)
    .join(" | ");
}

async function importarKabumAwinManualV2(urlManual = "", opcoes = {}) {
  const urlOriginal = texto(urlManual);
  if (!urlOriginal) {
    throw new Error("url_manual_obrigatoria");
  }

  const clienteId = texto(opcoes.clienteId) || "admin";
  const importarProdutoKabumViaAwin = typeof opcoes.importarProdutoKabumViaAwin === "function"
    ? opcoes.importarProdutoKabumViaAwin
    : importarProdutoKabumViaAwinAtual;
  const gerarDeepLinkAwin = criarGerarDeepLinkAwinManualV2(opcoes);

  let produto = {};
  let erroImportacao = "";
  try {
    produto = await importarProdutoKabumViaAwin(urlOriginal, clienteId, {
      gerarDeepLinkAwin
    });
  } catch (erro) {
    erroImportacao = erro?.motivo || erro?.codigo || erro?.message || "kabum_importador_falhou";
    produto = {
      linkOriginal: urlOriginal,
      aviso: erroImportacao
    };
  }

  const dados = produto && typeof produto === "object" ? produto : {};
  const produtoId = produtoIdKabumManual(dados, urlOriginal);
  const generico = produtoKabumGenerico(dados) || !produtoId || !urlKabumProduto(primeiroTexto(dados.linkOriginal, urlOriginal));
  const usarDados = !generico;
  const precoAnterior = usarDados ? precoAnteriorManualKabum(dados) : "";
  const urlAfiliada = usarDados ? urlAfiliadaAwinGerada(dados, urlOriginal) : "";
  const avisos = avisosKabumAwin(dados, {
    generico,
    urlAfiliada,
    precoAnterior
  });

  if (erroImportacao && !avisos.includes(erroImportacao)) {
    avisos.push(erroImportacao);
  }

  const oferta = normalizarOfertaManualV2(
    {
      marketplace: "kabum",
      urlOriginal: primeiroTexto(dados.linkOriginal, urlOriginal),
      urlAfiliada,
      titulo: usarDados ? primeiroTexto(dados.titulo, dados.nome) : "",
      precoAtual: usarDados ? primeiroTexto(dados.precoAtual, dados.preco) : "",
      precoAnterior,
      imagem: usarDados ? primeiroTexto(dados.imagem, dados.imageUrl) : "",
      categoria: usarDados ? categoriaManualKabum(dados) : "",
      cupom: "",
      parcelamento: usarDados ? primeiroTexto(dados.parcelamento) : "",
      observacoes: observacoesKabumAwin(avisos),
      fonteImportacao: {
        marketplaceDetectado: "kabum",
        adapter: ADAPTER_KABUM_AWIN_MANUAL_V2,
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

  if (!urlAfiliada) {
    oferta.urlAfiliada = "";
    if (!oferta.fonteImportacao.camposAusentes.includes("urlAfiliada")) {
      oferta.fonteImportacao.camposAusentes.push("urlAfiliada");
    }
  }

  oferta.fonteImportacao.camposConfiaveis = camposConfiaveisKabumAwin(oferta);

  return oferta;
}

module.exports = {
  ADAPTER_KABUM_AWIN_MANUAL_V2,
  importarKabumAwinManualV2,
  produtoIdKabumManual,
  produtoKabumGenerico,
  precoAnteriorManualKabum,
  origemPrecoAnteriorComprovadaKabum,
  urlAfiliadaAwinGerada
};
