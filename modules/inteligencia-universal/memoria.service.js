const { texto } = require("./normalizacao.service");
const { cupomValido } = require("./beneficios.service");

function normalizarLinkProduto(valor = "") {
  const link = texto(valor);
  if (!link) return "";

  try {
    const url = new URL(link);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const caminho = url.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${caminho}`;
  } catch {
    return link.toLowerCase().split("#")[0].split("?")[0].replace(/\/+$/, "");
  }
}

function tituloNormalizadoForte(valor = "") {
  return normalizarComparacao(valor)
    .replace(/\b(oferta|promocao|original|novo|nova|kit|combo|cupom|desconto|frete gratis)\b/g, " ")
    .replace(/\b\d{1,3}%\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectarIdentidadeProdutoUniversal(oferta = {}) {
  const raw = oferta.raw && typeof oferta.raw === "object" ? oferta.raw : {};
  const metadata = raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
  const campos = [
    oferta.produtoIdDetectado,
    oferta.idProduto,
    oferta.productId,
    oferta.asin,
    oferta.mlb,
    oferta.shopId,
    oferta.itemId,
    oferta.linkOriginal,
    oferta.linkExpandido,
    oferta.linkAfiliado,
    oferta.link,
    raw.produtoIdDetectado,
    raw.idProduto,
    raw.productId,
    raw.asin,
    raw.mlb,
    raw.shopId,
    raw.itemId,
    raw.linkOriginal,
    raw.linkExpandido,
    raw.linkAfiliado,
    metadata.produtoId,
    metadata.idProduto,
    metadata.productId,
    metadata.asin,
    metadata.mlb,
    metadata.shopId,
    metadata.itemId
  ].filter(Boolean).join(" ");

  const mlb = campos.match(/\bMLB-?(\d{6,})\b/i)?.[1];
  if (mlb) return { produtoIdDetectado: `MLB${mlb}`, tipoIdentidade: "mlb" };

  const asinExplicito = texto(oferta.asin || raw.asin || metadata.asin).match(/\b([A-Z0-9]{10})\b/i)?.[1];
  const asinLink = campos.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})(?:[/?#]|\s|$)/i)?.[1];
  const asin = asinExplicito || asinLink;
  if (asin) return { produtoIdDetectado: asin.toUpperCase(), tipoIdentidade: "asin" };

  const shopIdExplicito = texto(oferta.shopId || raw.shopId || metadata.shopId);
  const itemIdExplicito = texto(oferta.itemId || raw.itemId || metadata.itemId);
  const shopeeProduct = campos.match(/\/product\/(\d+)\/(\d+)/i);
  const shopeeAntigo = campos.match(/(?:-i\.|\/i\.)(\d+)\.(\d+)/i);
  const shopId = shopIdExplicito || shopeeProduct?.[1] || shopeeAntigo?.[1] || campos.match(/[?&]shop_?id=(\d+)/i)?.[1];
  const itemId = itemIdExplicito || shopeeProduct?.[2] || shopeeAntigo?.[2] || campos.match(/[?&]item_?id=(\d+)/i)?.[1];
  if (shopId && itemId) return { produtoIdDetectado: `${shopId}/${itemId}`, tipoIdentidade: "shopee" };

  const linkNormalizado = normalizarLinkProduto(
    oferta.linkExpandido || raw.linkExpandido || oferta.linkOriginal || raw.linkOriginal || oferta.linkAfiliado || raw.linkAfiliado || oferta.link
  );
  if (linkNormalizado) return { produtoIdDetectado: `link:${linkNormalizado}`, tipoIdentidade: "link_normalizado" };

  const tituloForte = tituloNormalizadoForte(oferta.titulo || raw.titulo || oferta.tituloNormalizado || raw.tituloNormalizado);
  if (tituloForte.length >= 12) return { produtoIdDetectado: `titulo:${tituloForte}`, tipoIdentidade: "titulo_normalizado_forte" };

  return { produtoIdDetectado: "", tipoIdentidade: "sem_identidade" };
}

function chaveMemoriaUniversal(ofertaUniversal = {}) {
  const identidade = detectarIdentidadeProdutoUniversal(ofertaUniversal);
  return [
    texto(ofertaUniversal.clienteId),
    texto(ofertaUniversal.marketplace),
    identidade.produtoIdDetectado
  ].filter(Boolean).join("|");
}

function precoMenor(precoAtual, precoAnterior) {
  const atual = Number(precoAtual || 0);
  const anterior = Number(precoAnterior || 0);
  if (!atual || !anterior || atual >= anterior) return false;
  const diff = anterior - atual;
  return diff >= 5 || diff / anterior >= 0.08;
}

function normalizarComparacao(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function numeroMemoria(valor) {
  const numero = Number(valor || 0);
  return Number.isFinite(numero) ? numero : 0;
}

function mesmoPreco(precoAtual, precoAnterior) {
  const atual = numeroMemoria(precoAtual);
  const anterior = numeroMemoria(precoAnterior);
  if (!atual || !anterior) return false;
  return Math.abs(atual - anterior) < 0.01;
}

function mesmoCupom(cupomAtual = "", cupomAnterior = "") {
  return texto(cupomAtual).toLowerCase() === texto(cupomAnterior).toLowerCase();
}

function assinaturaBeneficio(oferta = {}) {
  return [
    texto(oferta.cupomTipo || oferta.tipoCupom),
    texto(oferta.beneficioTexto || oferta.beneficioExtra || oferta.avisoCupom),
    oferta.freteGratis === true ? "frete_gratis" : "",
    texto(oferta.cashback),
    texto(oferta.parcelamento)
  ].filter(Boolean).join("|").toLowerCase();
}

function beneficioMelhorou(ofertaAtual = {}, ofertaAnterior = {}) {
  const atual = assinaturaBeneficio(ofertaAtual);
  const anterior = assinaturaBeneficio(ofertaAnterior);
  if (!atual) return false;
  if (!anterior) return true;
  return atual !== anterior;
}

function horasDesdeOferta(oferta = {}) {
  const data = oferta.criadaEm || oferta.criada_em || oferta.capturadaEm || oferta.capturada_em || oferta.vistoEm || "";
  const timestamp = data ? new Date(data).getTime() : 0;
  if (!timestamp || Number.isNaN(timestamp)) return null;
  return (Date.now() - timestamp) / 36e5;
}

function dentroJanelaCurta(oferta = {}, contexto = {}) {
  const janelaHoras = Number(contexto.janelaRepeticaoHoras || 2);
  const horas = horasDesdeOferta(oferta);
  if (horas === null) return false;
  return horas >= 0 && horas <= janelaHoras;
}

function encontrarAnteriorRelevante(ofertaUniversal = {}, anteriores = []) {
  const chave = chaveMemoriaUniversal(ofertaUniversal);
  const identidadeAtual = detectarIdentidadeProdutoUniversal(ofertaUniversal);
  const linkAtual = texto(ofertaUniversal.linkOriginal || ofertaUniversal.linkAfiliado).toLowerCase();
  const tituloAtual = normalizarComparacao(ofertaUniversal.titulo);
  const marketplaceAtual = normalizarComparacao(ofertaUniversal.marketplace);

  return anteriores.find(item => {
    const chaveItem = texto(item.chave) || chaveMemoriaUniversal(item);
    const identidadeItem = detectarIdentidadeProdutoUniversal(item);
    const linkItem = texto(item.linkOriginal || item.linkAfiliado).toLowerCase();
    const tituloItem = normalizarComparacao(item.titulo || item.tituloNormalizado);
    const marketplaceItem = normalizarComparacao(item.marketplace);

    if (chaveItem && chaveItem === chave) return true;
    if (
      identidadeAtual.produtoIdDetectado &&
      identidadeItem.produtoIdDetectado &&
      identidadeAtual.produtoIdDetectado === identidadeItem.produtoIdDetectado &&
      marketplaceAtual === marketplaceItem
    ) return true;
    if (linkAtual && linkItem && linkAtual === linkItem) return true;
    return Boolean(tituloAtual && tituloItem && tituloAtual === tituloItem && marketplaceAtual === marketplaceItem);
  });
}

function avaliarMemoriaUniversal(ofertaUniversal = {}, contexto = {}) {
  const chave = chaveMemoriaUniversal(ofertaUniversal);
  const anteriores = Array.isArray(contexto.memoriaAnteriores) ? contexto.memoriaAnteriores : [];
  const anterior = encontrarAnteriorRelevante(ofertaUniversal, anteriores);
  const identidade = detectarIdentidadeProdutoUniversal(ofertaUniversal);

  if (!anterior) {
    return {
      chave,
      repetida: false,
      bloquear: false,
      motivo: "sem_historico",
      motivoMemoria: anteriores.length ? "sem_historico_compativel" : "sem_historico_cliente_marketplace",
      produtoIdDetectado: identidade.produtoIdDetectado,
      tipoIdentidade: identidade.tipoIdentidade,
      totalMemoriaAnteriores: anteriores.length,
      precoCaiu: false,
      cupomNovo: false,
      beneficioMelhorou: false,
      repeticaoIdentica: false,
      logs: [{
        etapa: "memoria",
        status: "ok",
        motivo: "sem_historico",
        motivoMemoria: anteriores.length ? "sem_historico_compativel" : "sem_historico_cliente_marketplace",
        produtoIdDetectado: identidade.produtoIdDetectado,
        totalMemoriaAnteriores: anteriores.length
      }]
    };
  }

  const cupomNovo = cupomValido(ofertaUniversal.cupom) && texto(ofertaUniversal.cupom).toLowerCase() !== texto(anterior.cupom).toLowerCase();
  const precoCaiu = precoMenor(ofertaUniversal.precoAtual, anterior.precoAtual || anterior.preco);
  const beneficioNovoOuMelhor = beneficioMelhorou(ofertaUniversal, anterior);
  const temBeneficio = Boolean(cupomNovo || beneficioNovoOuMelhor || texto(ofertaUniversal.beneficioTexto) || ofertaUniversal.freteGratis || texto(ofertaUniversal.cashback));
  const origemRadar = texto(ofertaUniversal.origem).toLowerCase() === "radar" || contexto.origem === "radar";
  const dentroJanela = dentroJanelaCurta(anterior, contexto);
  const precoIgual = mesmoPreco(ofertaUniversal.precoAtual, anterior.precoAtual || anterior.preco);
  const cupomIgual = mesmoCupom(ofertaUniversal.cupom, anterior.cupom);
  const repeticaoRigida = Boolean(dentroJanela && precoIgual && cupomIgual && !cupomNovo && !precoCaiu && !beneficioNovoOuMelhor);

  const bloquear = repeticaoRigida || !(cupomNovo || precoCaiu || temBeneficio || origemRadar);
  const motivo = repeticaoRigida ? "repeticao_rigida_janela_curta" : (bloquear ? "repeticao_identica_sem_beneficio" : "repeticao_flexivel_liberada");

  return {
    chave,
    repetida: true,
    bloquear,
    motivo,
    motivoMemoria: motivo,
    produtoIdDetectado: identidade.produtoIdDetectado,
    tipoIdentidade: identidade.tipoIdentidade,
    totalMemoriaAnteriores: anteriores.length,
    precoCaiu,
    cupomNovo,
    beneficioMelhorou: beneficioNovoOuMelhor,
    repeticaoIdentica: repeticaoRigida,
    detalhes: {
      repeticaoRigida,
      dentroJanelaCurta: dentroJanela,
      precoIgual,
      cupomIgual,
      cupomNovo,
      precoCaiu,
      beneficioMelhorou: beneficioNovoOuMelhor,
      temBeneficio,
      origemRadar,
      anteriorId: anterior.id || null
    },
    logs: [{
      etapa: "memoria",
      status: bloquear ? "bloqueada" : "liberada",
      motivo,
      motivoMemoria: motivo,
      produtoIdDetectado: identidade.produtoIdDetectado,
      totalMemoriaAnteriores: anteriores.length,
      precoCaiu,
      cupomNovo,
      beneficioMelhorou: beneficioNovoOuMelhor,
      repeticaoIdentica: repeticaoRigida
    }]
  };
}

module.exports = {
  avaliarMemoriaUniversal,
  chaveMemoriaUniversal,
  detectarIdentidadeProdutoUniversal
};
