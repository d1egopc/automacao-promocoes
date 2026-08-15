const MARKETPLACES_MANUAL_V2 = Object.freeze([
  "mercadolivre",
  "amazon",
  "shopee",
  "aliexpress",
  "awin",
  "kabum",
  "magalu",
  "manual"
]);

const STATUS_MANUAL_V2 = Object.freeze([
  "salva",
  "agendada",
  "enviando",
  "enviada",
  "erro"
]);

const STATUS_INICIAL_MANUAL_V2 = "salva";

const CAMPOS_EDITAVEIS_MANUAL_V2 = Object.freeze([
  "marketplace",
  "urlOriginal",
  "urlAfiliada",
  "titulo",
  "precoAtual",
  "precoAnterior",
  "precoMin",
  "precoMax",
  "temVariacaoPreco",
  "imagem",
  "categoria",
  "seller",
  "cupom",
  "parcelamento",
  "observacoes"
]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarMarketplaceManualV2(valor = "") {
  const normalizado = texto(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

  if (["mercadolivre", "mercadolibre", "meli", "ml"].includes(normalizado)) return "mercadolivre";
  if (normalizado === "amazon") return "amazon";
  if (normalizado === "shopee") return "shopee";
  if (["aliexpress", "aliexp"].includes(normalizado)) return "aliexpress";
  if (["awin", "awinkabum"].includes(normalizado)) return "awin";
  if (["kabum", "kabumawin"].includes(normalizado)) return "kabum";
  if (["magalu", "magazineluiza", "magazinevoce", "magazinevoce"].includes(normalizado)) return "magalu";
  if (normalizado === "manual") return "manual";

  return "manual";
}

function normalizarStatusManualV2(valor = "") {
  const status = texto(valor).toLowerCase();
  return STATUS_MANUAL_V2.includes(status) ? status : STATUS_INICIAL_MANUAL_V2;
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const atual = texto(valor);
    if (atual) return atual;
  }
  return "";
}

function normalizarListaTexto(valor) {
  if (!Array.isArray(valor)) return [];
  return valor
    .map(texto)
    .filter(Boolean);
}

function normalizarDestinoAgendadoManualV2(destino = {}) {
  const id = primeiroTexto(destino.id, destino.destinoId);
  if (!id) return null;
  return {
    id,
    nome: primeiroTexto(destino.nome, destino.titulo, destino.label),
    tipo: texto(destino.tipo).toLowerCase() === "telegram" ? "telegram" : "whatsapp",
    ativo: destino.ativo !== false,
    utilizavel: destino.utilizavel === true,
    motivoIndisponivel: primeiroTexto(destino.motivoIndisponivel, destino.motivo),
    identificacaoVisual: primeiroTexto(destino.identificacaoVisual, destino.identificacao)
  };
}

function normalizarDestinosAgendadosManualV2(valor) {
  if (!Array.isArray(valor)) return [];
  return valor
    .map((destino) => destino && typeof destino === "object" ? normalizarDestinoAgendadoManualV2(destino) : null)
    .filter(Boolean);
}

function inteiroNaoNegativo(valor = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? Math.floor(numero) : 0;
}

function numeroPrecoBR(valor = "") {
  const bruto = texto(valor);
  if (!bruto) return null;
  const limpo = bruto
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : null;
}

function temFaixaRealPreco(precoMin = "", precoMax = "") {
  const min = numeroPrecoBR(precoMin);
  const max = numeroPrecoBR(precoMax);
  return min !== null && max !== null && Math.abs(min - max) >= 0.01;
}

function normalizarFonteImportacaoManualV2(fonte = {}, contexto = {}) {
  const agora = texto(contexto.now) || new Date().toISOString();
  return {
    marketplaceDetectado: normalizarMarketplaceManualV2(
      fonte.marketplaceDetectado || fonte.marketplace || contexto.marketplaceDetectado || ""
    ),
    adapter: primeiroTexto(fonte.adapter, contexto.adapter, "manual"),
    parseOnly: fonte.parseOnly === false ? false : true,
    importadoEm: primeiroTexto(fonte.importadoEm, contexto.importadoEm, agora),
    camposConfiaveis: normalizarListaTexto(fonte.camposConfiaveis),
    camposAusentes: normalizarListaTexto(fonte.camposAusentes),
    avisos: normalizarListaTexto(fonte.avisos)
  };
}

function camposAusentesEditaveis(oferta = {}) {
  return CAMPOS_EDITAVEIS_MANUAL_V2.filter((campo) => {
    if (campo === "temVariacaoPreco") return false;
    return !texto(oferta[campo]);
  });
}

function gerarIdManualV2() {
  return `manual_v2_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function normalizarOfertaManualV2(entrada = {}, contexto = {}) {
  const agora = texto(contexto.now) || new Date().toISOString();
  const fonteEntrada = entrada.fonteImportacao && typeof entrada.fonteImportacao === "object"
    ? entrada.fonteImportacao
    : {};

  const precoMin = primeiroTexto(entrada.precoMin, entrada.preco_min);
  const precoMax = primeiroTexto(entrada.precoMax, entrada.preco_max);
  const temVariacaoPreco = entrada.temVariacaoPreco === true ||
    entrada.tem_variacao_preco === true ||
    temFaixaRealPreco(precoMin, precoMax);

  const oferta = {
    id: primeiroTexto(entrada.id) || (typeof contexto.idFactory === "function" ? contexto.idFactory() : gerarIdManualV2()),
    clienteId: primeiroTexto(entrada.clienteId, contexto.clienteId, "admin"),

    marketplace: normalizarMarketplaceManualV2(entrada.marketplace || contexto.marketplace || ""),
    urlOriginal: primeiroTexto(entrada.urlOriginal, entrada.linkOriginal, entrada.url, entrada.original),
    urlAfiliada: primeiroTexto(entrada.urlAfiliada, entrada.linkAfiliado, entrada.linkFinal, entrada.link),

    titulo: primeiroTexto(entrada.titulo, entrada.nome, entrada.title),
    precoAtual: primeiroTexto(entrada.precoAtual, entrada.preco, entrada.precoPor, entrada.valor, entrada.price),
    precoAnterior: primeiroTexto(entrada.precoAnterior, entrada.precoAntigo, entrada.precoOriginal, entrada.precoDe, entrada.de),
    precoMin,
    precoMax,
    temVariacaoPreco,

    imagem: primeiroTexto(entrada.imagem, entrada.image, entrada.imageUrl, entrada.foto, entrada.thumbnail),
    categoria: primeiroTexto(entrada.categoria, entrada.categoriaProduto),
    seller: primeiroTexto(entrada.seller, entrada.vendedor, entrada.loja, entrada.store),
    cupom: primeiroTexto(entrada.cupom, entrada.codigoCupom),
    parcelamento: primeiroTexto(entrada.parcelamento, entrada.parcelas),
    observacoes: primeiroTexto(entrada.observacoes, entrada.observacao, entrada.aviso),

    status: normalizarStatusManualV2(entrada.status),

    fonteImportacao: normalizarFonteImportacaoManualV2(fonteEntrada, {
      ...contexto,
      now: agora,
      marketplaceDetectado: fonteEntrada.marketplaceDetectado || entrada.marketplace || contexto.marketplace
    }),

    criadoEm: primeiroTexto(entrada.criadoEm, entrada.criado_em, agora),
    atualizadoEm: primeiroTexto(entrada.atualizadoEm, entrada.atualizado_em, agora),

    agendadoPara: primeiroTexto(entrada.agendadoPara, entrada.agendado_para),
    agendamentoTimezone: primeiroTexto(entrada.agendamentoTimezone, entrada.timezone),
    agendamentoLocal: primeiroTexto(entrada.agendamentoLocal, entrada.horarioLocal),
    agendamentoCriadoEm: primeiroTexto(entrada.agendamentoCriadoEm),
    agendamentoAtualizadoEm: primeiroTexto(entrada.agendamentoAtualizadoEm),
    agendamentoCanceladoEm: primeiroTexto(entrada.agendamentoCanceladoEm),
    destinosIds: normalizarListaTexto(entrada.destinosIds),
    destinosAgendados: normalizarDestinosAgendadosManualV2(entrada.destinosAgendados),
    agendamentoLockId: primeiroTexto(entrada.agendamentoLockId),
    agendamentoLockEm: primeiroTexto(entrada.agendamentoLockEm),
    agendamentoTentativas: inteiroNaoNegativo(entrada.agendamentoTentativas),
    agendamentoErroResumo: primeiroTexto(entrada.agendamentoErroResumo).slice(0, 1000)
  };

  if (oferta.temVariacaoPreco && !texto(entrada.precoAtual) && !texto(entrada.preco) && !texto(entrada.precoPor)) {
    oferta.precoAtual = "";
  }

  if (!oferta.urlAfiliada) {
    oferta.urlAfiliada = oferta.urlOriginal;
  }

  const ausentesCalculados = camposAusentesEditaveis(oferta);
  if (!oferta.fonteImportacao.camposAusentes.length) {
    oferta.fonteImportacao.camposAusentes = ausentesCalculados;
  }

  return oferta;
}

module.exports = {
  MARKETPLACES_MANUAL_V2,
  STATUS_MANUAL_V2,
  STATUS_INICIAL_MANUAL_V2,
  CAMPOS_EDITAVEIS_MANUAL_V2,
  normalizarMarketplaceManualV2,
  normalizarStatusManualV2,
  normalizarOfertaManualV2,
  camposAusentesEditaveis,
  temFaixaRealPreco,
  normalizarDestinoAgendadoManualV2,
  normalizarDestinosAgendadosManualV2
};
