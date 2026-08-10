const ALIASES_CATEGORIA_DESTINO = {
  bebes: "bebeseacessorios",
  bebe: "bebeseacessorios",
  mercearia: "alimentosemercearia",
  alimentos: "alimentosemercearia",
  casa: "casamoveisedecoracao",
  hardware: "gamerehardware",
  gamerhardware: "gamerehardware",
  eletronico: "eletronicos",
  eletroportados: "eletroportateis",
  celularesmartphones: "celularesesmartphones",
  celularsmartphones: "celularesesmartphones",
  jogosconsole: "gameseconsole",
  jogos: "gameseconsole",
  pesca: "pescaepescaria",
  farmacia: "perfumariafarmaciaebeleza",
  farmaciabeleza: "perfumariafarmaciaebeleza",
  beleza: "perfumariafarmaciaebeleza",
  perfumaria: "perfumariafarmaciaebeleza",
  moda: "roupasemodamasculina",
  roupas: "roupasemodamasculina",
  roupamasculina: "roupasemodamasculina",
  roupasmasculinas: "roupasemodamasculina",
  modamasculina: "roupasemodamasculina",
  roupafeminina: "roupasemodafeminina",
  roupasfemininas: "roupasemodafeminina",
  modafeminina: "roupasemodafeminina",
  tenis: "tenisechinelos",
  calcados: "tenisechinelos",
  chinelos: "tenisechinelos",
  outros: "diversos",
  outro: "diversos",
  diverso: "diversos",
  diversos: "diversos"
};

const ALIASES_MARKETPLACE_DESTINO = {
  awin: ["awin", "kabum"],
  kabum: ["kabum", "awin"],
  awinkabum: ["awin", "kabum"],
  kabumawin: ["kabum", "awin"],
  feedawin: ["awin", "kabum"],
  feedkabum: ["kabum", "awin"]
};

let categoriasOficiaisDestinoCache = null;

const ROTULOS_DESTINO_GERAL = new Set([
  "geral",
  "todos",
  "todas",
  "qualquer",
  "qualquercategoria",
  "qualquercategorias",
  "todacategoria",
  "todascategorias",
  "todosascategorias",
  "todasascategorias",
  "geraltodascategorias",
  "geraltodosascategorias",
  "semfiltro",
  "semfiltros",
  "semrestricao",
  "semrestricoes",
  "semrestricaocategoria",
  "semrestricoesdecategoria",
  "all",
  "allcategories"
]);

const CAMPOS_FLAG_TODAS_CATEGORIAS = [
  "todasCategorias",
  "categoriasTodas",
  "aceitarTodasCategorias",
  "aceitaTodasCategorias",
  "todasAsCategorias",
  "allCategories"
];

const CAMPOS_MODO_CATEGORIA = [
  "modoCategoria",
  "modoCategorias",
  "categoriaModo",
  "categoriasModo",
  "tipoCategoria",
  "tipoCategorias"
];

function normalizarDestino(valor = "") {
  return String(valor || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "e")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function normalizarCategoriaDestino(valor = "") {
  const slug = normalizarDestino(valor);
  return ALIASES_CATEGORIA_DESTINO[slug] || slug;
}

function primeiraListaDestino(...listas) {
  for (const lista of listas) {
    if (Array.isArray(lista) && lista.length) return lista;
  }
  return [];
}

function categoriaDestinoEhGeral(valor = "") {
  return ROTULOS_DESTINO_GERAL.has(normalizarCategoriaDestino(valor));
}

function listaCategoriasDestinoEhGeral(categoriasDestino = []) {
  if (!Array.isArray(categoriasDestino) || !categoriasDestino.length) return false;
  return categoriasDestino.some(categoriaDestinoEhGeral);
}

function categoriasOficiaisDestinoNormalizadas() {
  if (categoriasOficiaisDestinoCache) return categoriasOficiaisDestinoCache;

  try {
    const { CATEGORIAS_DESTINOS } = require("../marketplaces/inteligencia/categorias-destinos");
    categoriasOficiaisDestinoCache = Object.values(CATEGORIAS_DESTINOS || {})
      .map(item => normalizarCategoriaDestino(item?.nome || ""))
      .filter(Boolean);
  } catch (_) {
    categoriasOficiaisDestinoCache = [];
  }

  return categoriasOficiaisDestinoCache;
}

function listaCategoriasEhSnapshotCompleto(categorias = []) {
  const oficiais = categoriasOficiaisDestinoNormalizadas();
  if (!oficiais.length || !Array.isArray(categorias) || !categorias.length) return false;

  const recebidas = new Set(categorias.map(normalizarCategoriaDestino).filter(Boolean));
  if (!recebidas.size) return false;

  return oficiais.every(categoria => recebidas.has(categoria));
}

function destinoTemFlagTodasCategorias(destino = {}) {
  if (!destino || typeof destino !== "object" || Array.isArray(destino)) return false;
  if (CAMPOS_FLAG_TODAS_CATEGORIAS.some(campo => destino[campo] === true)) return true;
  return CAMPOS_MODO_CATEGORIA.some(campo => categoriaDestinoEhGeral(destino[campo]));
}

function destinoAceitaTodasCategorias(destino = {}) {
  if (!destino || typeof destino !== "object" || Array.isArray(destino)) return false;
  if (destinoTemFlagTodasCategorias(destino)) return true;

  const categorias = primeiraListaDestino(destino.categorias, destino.categoriasPermitidas);
  return listaCategoriasDestinoEhGeral(categorias) || listaCategoriasEhSnapshotCompleto(categorias);
}

function normalizarDestinoContratoCategorias(destino = {}) {
  if (!destino || typeof destino !== "object" || Array.isArray(destino)) return destino;

  const todasCategorias = destinoAceitaTodasCategorias(destino);
  const normalizado = {
    ...destino,
    todasCategorias
  };

  if (!todasCategorias) return normalizado;

  normalizado.modoCategoria = "todas";
  if (Array.isArray(destino.categorias)) normalizado.categorias = ["geral"];
  if (Array.isArray(destino.categoriasPermitidas)) normalizado.categoriasPermitidas = ["geral"];
  if (!Array.isArray(destino.categorias) && !Array.isArray(destino.categoriasPermitidas)) {
    normalizado.categorias = ["geral"];
  }

  return normalizado;
}

function expandirMarketplacesDestino(valores = []) {
  const lista = Array.isArray(valores) ? valores : [valores];
  const expandidos = new Set();

  for (const valor of lista) {
    const slug = normalizarDestino(valor);
    if (!slug) continue;
    expandidos.add(slug);
    for (const alias of ALIASES_MARKETPLACE_DESTINO[slug] || []) {
      expandidos.add(alias);
    }
  }

  return [...expandidos].filter(Boolean);
}

function destinoAceitaOferta(destino, oferta, opcoes = {}) {
  return analisarDestinoOferta(destino, oferta, opcoes).aceita;
}

function analisarDestinoOferta(destino, oferta, opcoes = {}) {
  if (!destino?.ativo) {
    return {
      aceita: false,
      motivo: "destino_inativo",
      marketplaceOferta: "",
      categoriaOferta: "",
      aceitaMarketplace: false,
      aceitaCategoria: false
    };
  }

  const classificarCategoriaOferta =
    opcoes.classificarCategoriaOferta ||
    (() => oferta?.categoria || oferta?.categoriaProduto || "");

  const logger = opcoes.logger || console;

  const marketplaceOfertaBruto = oferta.marketplace || oferta.mercado || oferta.loja || "";
  const marketplaceOferta = normalizarDestino(marketplaceOfertaBruto);
  const marketplacesOferta = expandirMarketplacesDestino([marketplaceOfertaBruto]);

  const categoriaClassificada =
    oferta.categoria ||
    oferta.categoriaProduto ||
    classificarCategoriaOferta(oferta, oferta.termo || "");

  const categoriaOferta = normalizarCategoriaDestino(categoriaClassificada);

  const marketplacesDestino = expandirMarketplacesDestino(
    primeiraListaDestino(destino.marketplaces, destino.marketplacesPermitidos)
  );

  const categoriasDestino = (
    primeiraListaDestino(destino.categorias, destino.categoriasPermitidas)
  )
    .map(normalizarCategoriaDestino)
    .filter(Boolean);

  const aceitaMarketplace =
    !marketplacesDestino.length ||
    marketplacesDestino.includes("geral") ||
    marketplacesDestino.includes("todos") ||
    marketplacesDestino.includes("todas") ||
    marketplacesOferta.some(marketplace => marketplacesDestino.includes(marketplace));

  const aceitaCategoria =
    destinoAceitaTodasCategorias(destino) ||
    categoriasDestino.some(cat =>
      cat === categoriaOferta ||
      cat.includes(categoriaOferta) ||
      categoriaOferta.includes(cat)
    );

  const motivo = !aceitaMarketplace
    ? "marketplace"
    : !aceitaCategoria
      ? "categoria"
      : "";

  if (String(process.env.DEBUG_LOGS || "").toLowerCase() === "true") {
    logger.log("Check destino:", {
      nome: destino.nome,
      marketplaceOferta,
      aceitaMarketplace,
      categoriaOferta,
      aceitaCategoria
    });
  }

  return {
    aceita: aceitaMarketplace && aceitaCategoria,
    motivo,
    marketplaceOferta,
    marketplacesOferta,
    marketplacesDestino,
    categoriaOferta,
    aceitaMarketplace,
    aceitaCategoria
  };
}

function destinoDentroHorario(destino = {}) {
  const agoraBR = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "America/Sao_Paulo"
    })
  );

  const horaAtual = agoraBR.getHours() * 60 + agoraBR.getMinutes();

  const horaInicio =
    destino.horarioInicio ||
    destino.horaInicio ||
    destino.horaInicial ||
    destino.inicio ||
    destino.horarioInicial ||
    "00:00";
  const horaFim =
    destino.horarioFim ||
    destino.horaFim ||
    destino.horaFinal ||
    destino.fim ||
    destino.horarioFinal ||
    "23:59";

  const [inicioH, inicioM] = String(horaInicio)
    .split(":")
    .map(Number);

  const [fimH, fimM] = String(horaFim)
    .split(":")
    .map(Number);

  const inicio = inicioH * 60 + inicioM;
  const fim = fimH * 60 + fimM;

  if (inicio <= fim) {
    return horaAtual >= inicio && horaAtual <= fim;
  }

  return horaAtual >= inicio || horaAtual <= fim;
}

function categoriaBase(txt = "") {
  return normalizarCategoriaDestino(txt || "geral");
}

function categoriaPermitidaNoDestino(oferta, destino) {
  const categoriaOferta = normalizarCategoriaDestino(
    oferta.categoria || "Diversos"
  );

  const categoriasDestino = (
    primeiraListaDestino(destino.categorias, destino.categoriasPermitidas)
  )
    .map(normalizarCategoriaDestino)
    .filter(Boolean);

  if (destinoAceitaTodasCategorias(destino)) return true;

  return (
    categoriasDestino.includes(categoriaOferta)
  );
}

module.exports = {
  normalizarDestino,
  normalizarCategoriaDestino,
  categoriaDestinoEhGeral,
  listaCategoriasDestinoEhGeral,
  categoriasOficiaisDestinoNormalizadas,
  listaCategoriasEhSnapshotCompleto,
  destinoAceitaTodasCategorias,
  normalizarDestinoContratoCategorias,
  expandirMarketplacesDestino,
  categoriaPermitidaNoDestino,
  analisarDestinoOferta,
  destinoAceitaOferta,
  destinoDentroHorario,
  categoriaBase,
  ALIASES_CATEGORIA_DESTINO
};
