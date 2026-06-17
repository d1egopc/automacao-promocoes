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

  const marketplaceOferta = normalizarDestino(
    oferta.marketplace || oferta.mercado || oferta.loja || ""
  );

  const categoriaClassificada =
    oferta.categoria ||
    oferta.categoriaProduto ||
    classificarCategoriaOferta(oferta, oferta.termo || "");

  const categoriaOferta = normalizarCategoriaDestino(categoriaClassificada);

  const marketplacesDestino = (destino.marketplaces || [])
    .map(normalizarDestino)
    .filter(Boolean);

  const categoriasDestino = (
    destino.categorias ||
    destino.categoriasPermitidas ||
    []
  )
    .map(normalizarCategoriaDestino)
    .filter(Boolean);

  const aceitaMarketplace =
    !marketplacesDestino.length ||
    marketplacesDestino.includes("geral") ||
    marketplacesDestino.includes("todos") ||
    marketplacesDestino.includes("todas") ||
    marketplacesDestino.includes(marketplaceOferta);

  const aceitaCategoria =
    !categoriasDestino.length ||
    categoriasDestino.includes("geral") ||
    categoriasDestino.includes("todos") ||
    categoriasDestino.includes("todas") ||
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

  logger.log("Check destino:", {
    nome: destino.nome,
    marketplaceOferta,
    aceitaMarketplace,
    categoriaOferta,
    aceitaCategoria
  });

  return {
    aceita: aceitaMarketplace && aceitaCategoria,
    motivo,
    marketplaceOferta,
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

  const [inicioH, inicioM] = (destino.horarioInicio || "00:00")
    .split(":")
    .map(Number);

  const [fimH, fimM] = (destino.horarioFim || "23:59")
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
    destino.categorias ||
    destino.categoriasPermitidas ||
    []
  )
    .map(normalizarCategoriaDestino)
    .filter(Boolean);

  if (!categoriasDestino.length) return true;

  return (
    categoriasDestino.includes("geral") ||
    categoriasDestino.includes("todas") ||
    categoriasDestino.includes(categoriaOferta)
  );
}

module.exports = {
  normalizarDestino,
  normalizarCategoriaDestino,
  categoriaPermitidaNoDestino,
  analisarDestinoOferta,
  destinoAceitaOferta,
  destinoDentroHorario,
  categoriaBase,
  ALIASES_CATEGORIA_DESTINO
};
