const {
  normalizarOfertaManualV2
} = require("../manual-offers.contract");
const {
  importarAliExpress: importarAliExpressAtual,
  extrairProductIdAliExpressManual
} = require("../../../marketplaces/aliexpress/importar");

const ADAPTER_ALIEXPRESS_MANUAL_V2 = "aliexpress.manual.adapter";

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

function tituloGenericoAliExpress(titulo = "") {
  const chave = normalizarChave(titulo);
  return !chave || chave === "produtoaliexpress" || chave === "aliexpress";
}

function categoriaManualAliExpress(produto = {}) {
  const categoria = primeiroTexto(produto.categoriaProduto, produto.categoria);
  const chave = normalizarChave(categoria);
  if (!categoria || chave === "aliexpress") return "";
  return categoria;
}

function productIdManualAliExpress(produto = {}, urlOriginal = "") {
  return primeiroTexto(
    produto.productId,
    produto.produtoId,
    produto.itemId,
    produto.item_id,
    produto.metadata?.productId,
    extrairProductIdAliExpressManual(produto.linkOriginal || ""),
    extrairProductIdAliExpressManual(produto.urlOriginal || ""),
    extrairProductIdAliExpressManual(produto.linkExpandido || ""),
    extrairProductIdAliExpressManual(urlOriginal)
  );
}

function retornoGenericoAliExpress(produto = {}, urlOriginal = "") {
  const motivo = normalizarChave(
    produto.motivoErroAliExpress ||
    produto.erroTecnico ||
    produto.motivo ||
    produto.aviso ||
    ""
  );

  if (motivo.includes("productidausente")) return true;
  if (motivo.includes("credenciaisincompletas")) return true;
  if (motivo.includes("produtosemcamposessenciais")) return true;
  if (motivo.includes("fallbackgenerico")) return true;
  if (motivo.includes("erroaoconsultarapialiexpress")) return true;

  return !productIdManualAliExpress(produto, urlOriginal) && tituloGenericoAliExpress(produto.titulo || produto.nome);
}

function origemPrecoAnteriorComprovadaAliExpress(produto = {}) {
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
      !retornoGenericoAliExpress(produto, produto.linkOriginal || produto.urlOriginal || "");
  }
  if (origem.includes("desconto") || origem.includes("calcul")) return false;

  return (
    origem.includes("api") ||
    origem.includes("productdetail") ||
    origem.includes("productquery") ||
    origem.includes("originalprice") ||
    origem.includes("targetoriginalprice") ||
    origem.includes("pagina") ||
    origem.includes("page")
  );
}

function precoAnteriorManualAliExpress(produto = {}) {
  const explicito = primeiroTexto(produto.precoAnterior);
  if (explicito) return explicito;
  if (!origemPrecoAnteriorComprovadaAliExpress(produto)) return "";
  return primeiroTexto(produto.precoAntigo, produto.precoOriginal, produto.precoDe);
}

function urlAfiliadaGeradaAliExpress(produto = {}) {
  const candidata = primeiroTexto(produto.urlAfiliada, produto.linkAfiliado, produto.linkFinal);
  if (!candidata) return "";

  try {
    const parsed = new URL(candidata);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname;

    if (host === "s.click.aliexpress.com" && /^\/e\/_[a-z0-9]+/i.test(path)) return candidata;
    if (produto.metadata?.linkAfiliadoGerado === true && host.endsWith(".aliexpress.com")) return candidata;
    if (produto.tipoLinkAfiliado === "promotion_link" && host.endsWith(".aliexpress.com")) return candidata;
  } catch {}

  return "";
}

function avisosAliExpress(produto = {}, contexto = {}) {
  const avisos = [];

  if (contexto.semProductId) {
    avisos.push("aliexpress_product_id_ausente_sem_produto_fabricado");
  }

  if (contexto.generico) {
    avisos.push("aliexpress_retorno_generico_ignorado_no_manual_v2");
  }

  if (!contexto.precoAnterior && primeiroTexto(produto.precoAntigo, produto.precoOriginal, produto.precoDe)) {
    avisos.push("preco_anterior_ignorado_sem_origem_comprovada");
  }

  if (!contexto.urlAfiliada && primeiroTexto(produto.linkAfiliado, produto.linkFinal, produto.urlAfiliada)) {
    avisos.push("url_afiliada_ignorada_sem_shortlink_confirmado");
  }

  if (!primeiroTexto(produto.titulo, produto.precoAtual, produto.preco, produto.imagem)) {
    avisos.push("aliexpress_retorno_parcial_campos_editaveis");
  }

  return [...new Set([
    ...avisos,
    produto.aviso || "",
    produto.avisoCupom || ""
  ].map(texto).filter(Boolean))];
}

function camposConfiaveisAliExpress(oferta = {}) {
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

function observacoesAliExpress(avisos = []) {
  return avisos
    .map(texto)
    .filter(Boolean)
    .join(" | ");
}

async function importarAliExpressManualV2(urlManual = "", opcoes = {}) {
  const urlOriginal = texto(urlManual);
  if (!urlOriginal) {
    throw new Error("url_manual_obrigatoria");
  }

  const clienteId = texto(opcoes.clienteId) || "admin";
  const importarAliExpress = typeof opcoes.importarAliExpress === "function"
    ? opcoes.importarAliExpress
    : importarAliExpressAtual;
  const integracao = opcoes.integracao ||
    (typeof opcoes.getIntegracaoCliente === "function"
      ? opcoes.getIntegracaoCliente(clienteId, "aliexpress")
      : null) ||
    {};

  const produto = await importarAliExpress(urlOriginal, {
    ...integracao,
    clienteId,
    credenciais: integracao?.credenciais || integracao || {},
    gerarLinkCurtoAliExpress: opcoes.gerarLinkCurtoAliExpress,
    gerarLinkOptimus: opcoes.gerarLinkOptimus
  });
  const dados = produto && typeof produto === "object" ? produto : {};
  const productId = productIdManualAliExpress(dados, urlOriginal);
  const semProductId = !productId;
  const generico = retornoGenericoAliExpress(dados, urlOriginal);
  const usarDados = !semProductId && !generico;
  const precoAnterior = usarDados ? precoAnteriorManualAliExpress(dados) : "";
  const urlAfiliada = usarDados ? urlAfiliadaGeradaAliExpress(dados) : "";
  const avisos = avisosAliExpress(dados, {
    semProductId,
    generico,
    precoAnterior,
    urlAfiliada
  });

  const oferta = normalizarOfertaManualV2(
    {
      marketplace: "aliexpress",
      urlOriginal: primeiroTexto(dados.linkOriginal, dados.urlOriginal, urlOriginal),
      urlAfiliada,
      titulo: usarDados && !tituloGenericoAliExpress(dados.titulo || dados.nome)
        ? primeiroTexto(dados.titulo, dados.nome)
        : "",
      precoAtual: usarDados ? primeiroTexto(dados.precoAtual, dados.preco) : "",
      precoAnterior,
      imagem: usarDados ? primeiroTexto(dados.imagem, dados.imageUrl) : "",
      categoria: usarDados ? categoriaManualAliExpress(dados) : "",
      cupom: "",
      parcelamento: usarDados ? primeiroTexto(dados.parcelamento) : "",
      observacoes: observacoesAliExpress(avisos),
      fonteImportacao: {
        marketplaceDetectado: "aliexpress",
        adapter: ADAPTER_ALIEXPRESS_MANUAL_V2,
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

  oferta.fonteImportacao.camposConfiaveis = camposConfiaveisAliExpress(oferta);

  return oferta;
}

module.exports = {
  ADAPTER_ALIEXPRESS_MANUAL_V2,
  importarAliExpressManualV2,
  productIdManualAliExpress,
  retornoGenericoAliExpress,
  precoAnteriorManualAliExpress,
  origemPrecoAnteriorComprovadaAliExpress,
  urlAfiliadaGeradaAliExpress
};
