const {
  normalizarOfertaManualV2
} = require("../manual-offers.contract");
const {
  importarAliExpress: importarAliExpressAtual,
  extrairProductIdAliExpressManual
} = require("../../../marketplaces/aliexpress/importar");

const ADAPTER_ALIEXPRESS_MANUAL_V2 = "aliexpress.manual.adapter";

const CAMPOS_PRECO_ATUAL_ALIEXPRESS = Object.freeze([
  "target_sale_price",
  "sale_price",
  "target_app_sale_price",
  "app_sale_price"
]);

const CAMPOS_PRECO_MIN_ALIEXPRESS = Object.freeze([
  "target_min_sale_price",
  "min_sale_price",
  "target_sale_price_min",
  "product_min_price",
  "target_product_min_price"
]);

const CAMPOS_PRECO_MAX_ALIEXPRESS = Object.freeze([
  "target_max_sale_price",
  "max_sale_price",
  "target_sale_price_max",
  "product_max_price",
  "target_product_max_price"
]);

const CAMPOS_PRECO_ANTERIOR_ALIEXPRESS = Object.freeze([
  "target_original_price",
  "original_price",
  "product_original_price"
]);

const CAMPOS_PRECO_API_ALIEXPRESS = Object.freeze([
  ...CAMPOS_PRECO_ATUAL_ALIEXPRESS,
  ...CAMPOS_PRECO_MIN_ALIEXPRESS,
  ...CAMPOS_PRECO_MAX_ALIEXPRESS,
  ...CAMPOS_PRECO_ANTERIOR_ALIEXPRESS
]);

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

function numeroPrecoBR(valor = "") {
  const bruto = texto(valor);
  if (!bruto) return null;
  const normalizado = bruto
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function valoresDiferentesPreco(a = "", b = "") {
  const valorA = numeroPrecoBR(a);
  const valorB = numeroPrecoBR(b);
  return valorA !== null && valorB !== null && Math.abs(valorA - valorB) >= 0.01;
}

function lerCaminho(objeto = {}, caminho = "") {
  if (!objeto || typeof objeto !== "object") return "";
  return caminho.split(".").reduce((atual, parte) => {
    if (atual === null || atual === undefined) return "";
    return atual[parte];
  }, objeto);
}

function valorCampoAliExpress(produto = {}, campo = "") {
  const candidatos = [
    produto,
    produto.rawAliExpress,
    produto.raw,
    produto.dadosBrutos,
    produto.metadata?.rawAliExpress,
    produto.metadata?.dadosBrutos,
    produto.metadata?.camposPrecoAliExpress
  ];

  for (const candidato of candidatos) {
    const valor = lerCaminho(candidato, campo);
    const atual = texto(valor);
    if (atual) return atual;
  }

  return "";
}

function primeiroCampoPrecoAliExpress(produto = {}, campos = []) {
  for (const campo of campos) {
    const valor = valorCampoAliExpress(produto, campo);
    if (valor) return { campo, valor };
  }
  return { campo: "", valor: "" };
}

function camposBrutosPrecoAliExpress(produto = {}) {
  const bruto = {};
  CAMPOS_PRECO_API_ALIEXPRESS.forEach((campo) => {
    const valor = valorCampoAliExpress(produto, campo);
    if (valor) bruto[campo] = valor;
  });
  return bruto;
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

function precoManualAliExpress(produto = {}) {
  const atual = primeiroCampoPrecoAliExpress(produto, CAMPOS_PRECO_ATUAL_ALIEXPRESS);
  const minimo = primeiroCampoPrecoAliExpress(produto, CAMPOS_PRECO_MIN_ALIEXPRESS);
  const maximo = primeiroCampoPrecoAliExpress(produto, CAMPOS_PRECO_MAX_ALIEXPRESS);
  const anterior = primeiroCampoPrecoAliExpress(produto, CAMPOS_PRECO_ANTERIOR_ALIEXPRESS);
  const temFaixa = minimo.valor && maximo.valor && valoresDiferentesPreco(minimo.valor, maximo.valor);
  const somenteMinimo = minimo.valor && !maximo.valor && !atual.valor;
  const precoAtualNormalizado = primeiroTexto(produto.precoAtual, produto.preco);
  const precoAnteriorNormalizado = precoAnteriorManualAliExpress(produto);
  const camposBrutos = camposBrutosPrecoAliExpress(produto);
  const temProvenienciaBruta = Object.keys(camposBrutos).length > 0;

  return {
    precoAtual: temFaixa || somenteMinimo
      ? ""
      : primeiroTexto(atual.valor, precoAtualNormalizado),
    precoAnterior: primeiroTexto(anterior.valor, precoAnteriorNormalizado),
    precoMin: primeiroTexto(minimo.valor, produto.precoMin, produto.preco_min),
    precoMax: primeiroTexto(maximo.valor, produto.precoMax, produto.preco_max),
    temVariacaoPreco: Boolean(temFaixa || produto.temVariacaoPreco === true),
    evidencia: {
      origem: temProvenienciaBruta ? "resposta_importer" : "limitada_importer_normalizado",
      camposBrutos,
      usadoPara: {
        precoAtual: atual.valor
          ? atual.campo
          : (precoAtualNormalizado && !somenteMinimo ? "precoAtual" : ""),
        precoAnterior: anterior.valor
          ? anterior.campo
          : (precoAnteriorNormalizado ? "precoAntigo" : ""),
        precoMin: minimo.valor ? minimo.campo : (primeiroTexto(produto.precoMin, produto.preco_min) ? "precoMin" : ""),
        precoMax: maximo.valor ? maximo.campo : (primeiroTexto(produto.precoMax, produto.preco_max) ? "precoMax" : "")
      },
      temFaixaReal: Boolean(temFaixa),
      somenteMinimoSemMaximo: Boolean(somenteMinimo),
      observacao: temProvenienciaBruta
        ? ""
        : "Importer atual nao preservou campos brutos de preco; Manual V2 manteve somente valores normalizados."
    }
  };
}

function criarProvenienciaAfiliadaAliExpress() {
  return {
    sourceValues: "",
    retornoGerador: "",
    deeplinkGerado: false
  };
}

function linkAfiliadoAliExpressValido(link = "") {
  const candidato = texto(link);
  if (!candidato) return false;

  try {
    const parsed = new URL(candidato);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname;
    if (host === "s.click.aliexpress.com" && /^\/(e\/_|s\/)[a-z0-9]/i.test(path)) return true;
    if (host.endsWith(".aliexpress.com") && /(^|[?&])(aff_fcid|aff_fsk|aff_platform|aff_trace_key|dp)=/i.test(parsed.search)) return true;
  } catch {}

  return false;
}

function envolverGeradorLinkCurtoAliExpress(gerador, proveniencia, clienteId = "") {
  if (typeof gerador !== "function") return gerador;

  return async function gerarLinkCurtoAliExpressManualV2(linkLongo, credenciais = {}, contexto = {}) {
    const retorno = await gerador(linkLongo, credenciais, {
      ...contexto,
      clienteId: contexto?.clienteId || clienteId
    });
    proveniencia.sourceValues = texto(linkLongo);
    proveniencia.retornoGerador = texto(retorno);
    proveniencia.deeplinkGerado = Boolean(
      proveniencia.retornoGerador &&
      proveniencia.sourceValues &&
      proveniencia.retornoGerador !== proveniencia.sourceValues &&
      linkAfiliadoAliExpressValido(proveniencia.retornoGerador)
    );
    return retorno;
  };
}

function urlOriginalAliExpress(produto = {}) {
  return primeiroTexto(produto.linkOriginal, produto.urlOriginal, produto.url);
}

function urlAfiliadaGeradaAliExpress(produto = {}, contexto = {}) {
  const candidata = primeiroTexto(produto.urlAfiliada, produto.linkAfiliado, produto.linkFinal);
  if (!candidata) return "";

  try {
    const parsed = new URL(candidata);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname;

    if (linkAfiliadoAliExpressValido(candidata)) return candidata;
    if (produto.metadata?.linkAfiliadoGerado === true && host.endsWith(".aliexpress.com")) return candidata;
    if (produto.tipoLinkAfiliado === "promotion_link" && host.endsWith(".aliexpress.com")) return candidata;
    if (
      contexto.provenienciaAfiliada?.deeplinkGerado === true &&
      candidata !== urlOriginalAliExpress(produto)
    ) {
      return candidata;
    }
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
    ["precoMin", oferta.precoMin],
    ["precoMax", oferta.precoMax],
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
  const credenciais = integracao?.credenciais || integracao || {};
  const provenienciaAfiliada = criarProvenienciaAfiliadaAliExpress();

  const produto = await importarAliExpress(urlOriginal, {
    ...integracao,
    clienteId,
    credenciais,
    gerarLinkCurtoAliExpress: envolverGeradorLinkCurtoAliExpress(
      opcoes.gerarLinkCurtoAliExpress,
      provenienciaAfiliada,
      clienteId
    ),
    gerarLinkOptimus: opcoes.gerarLinkOptimus
  });
  const dados = produto && typeof produto === "object" ? produto : {};
  const productId = productIdManualAliExpress(dados, urlOriginal);
  const semProductId = !productId;
  const generico = retornoGenericoAliExpress(dados, urlOriginal);
  const usarDados = !semProductId && !generico;
  const precos = usarDados ? precoManualAliExpress(dados) : precoManualAliExpress({});
  const precoAnterior = usarDados ? precos.precoAnterior : "";
  const urlAfiliada = usarDados ? urlAfiliadaGeradaAliExpress(dados, { provenienciaAfiliada }) : "";
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
      precoAtual: usarDados ? precos.precoAtual : "",
      precoAnterior,
      precoMin: usarDados ? precos.precoMin : "",
      precoMax: usarDados ? precos.precoMax : "",
      temVariacaoPreco: usarDados ? precos.temVariacaoPreco : false,
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
  oferta.fonteImportacao.precoAliExpress = precos.evidencia;
  oferta.fonteImportacao.linkAfiliadoAliExpress = {
    deeplinkGerado: Boolean(provenienciaAfiliada.deeplinkGerado),
    sourceValuesUsado: provenienciaAfiliada.sourceValues ? "informado_ao_gerador" : "",
    retornoGerador: provenienciaAfiliada.retornoGerador ? "url_retornada" : ""
  };

  return oferta;
}

module.exports = {
  ADAPTER_ALIEXPRESS_MANUAL_V2,
  importarAliExpressManualV2,
  productIdManualAliExpress,
  retornoGenericoAliExpress,
  precoAnteriorManualAliExpress,
  origemPrecoAnteriorComprovadaAliExpress,
  urlAfiliadaGeradaAliExpress,
  precoManualAliExpress
};
