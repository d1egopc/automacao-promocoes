const { normalizarNumeroMoeda } = require("../../utils/moeda");

const CLASSIFICACOES_PRECO = {
  CONFIAVEL: "PRECO_CONFIAVEL",
  DIVERGENTE: "PRECO_DIVERGENTE",
  AMBIGUO: "PRECO_AMBIGUO",
  SUSPEITO: "PRECO_SUSPEITO",
  SEM_EVIDENCIA: "PRECO_SEM_EVIDENCIA"
};

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function primeiroValor(...valores) {
  for (const valor of valores) {
    if (valor !== null && valor !== undefined && texto(valor) !== "") return valor;
  }
  return "";
}

function extrairNumero(...valores) {
  for (const valor of valores) {
    const numero = normalizarNumeroMoeda(valor);
    if (numero !== null) return numero;
  }
  return null;
}

function cupomMonetarioConfirmado(oferta = {}, ofertaEntrada = {}) {
  const metadataProduto = ofertaEntrada?.metadata?.produto || {};
  const valorCupom = extrairNumero(
    oferta.valorCupom,
    oferta.cupomValor,
    ofertaEntrada.valorCupom,
    ofertaEntrada.cupomValor,
    metadataProduto.valorCupom,
    metadataProduto.cupomValor
  );
  const percentualCupom = extrairNumero(
    oferta.percentualCupom,
    oferta.cupomPercentual,
    ofertaEntrada.percentualCupom,
    ofertaEntrada.cupomPercentual,
    metadataProduto.percentualCupom,
    metadataProduto.cupomPercentual
  );
  const tipoCupom = texto(primeiroValor(oferta.cupomTipo, oferta.tipoCupom, ofertaEntrada.cupomTipo, ofertaEntrada.tipoCupom)).toLowerCase();

  return Boolean(
    (valorCupom !== null && valorCupom > 0) ||
    (percentualCupom !== null && percentualCupom > 0 && percentualCupom <= 95) ||
    /monetario|valor|percentual|confirmado|detectado_html/.test(tipoCupom)
  );
}

function extrairComparacaoRadarLocal(ofertaEntrada = {}) {
  const candidatos = [
    ofertaEntrada?.metadata?.comparacaoRadarLocal,
    ofertaEntrada?.metadata?.radarHibrido?.comparacao,
    ofertaEntrada?.metadata?.produto?.comparacaoRadarLocal,
    ofertaEntrada?.comparacaoRadarLocal,
    ofertaEntrada?.radarHibridoComparacao
  ];

  return candidatos.find(item => item && typeof item === "object") || null;
}

function divergenciaOrdemGrandeza(a, b) {
  if (a === null || b === null || a <= 0 || b <= 0) return false;
  const maior = Math.max(a, b);
  const menor = Math.min(a, b);
  return maior / menor >= 20 && Math.abs(maior - menor) >= 50;
}

function validarCoerenciaPreco(oferta = {}, contexto = {}) {
  const ofertaEntrada = contexto.ofertaEntrada || {};
  const precoAtual = extrairNumero(oferta.precoAtual, oferta.preco, oferta.valor);
  const precoOriginal = extrairNumero(oferta.precoOriginal, oferta.precoAntigo, oferta.precoDe);
  const comparacaoLocal = extrairComparacaoRadarLocal(ofertaEntrada);
  const precoLocal = extrairNumero(comparacaoLocal?.precoAtualLocal);
  const precoImportadorComparacao = extrairNumero(comparacaoLocal?.precoAtualImportador);
  const cupomConfirmado = cupomMonetarioConfirmado(oferta, ofertaEntrada);
  const motivos = [];
  const evidencias = {
    precoAtual,
    precoOriginal,
    precoLocal,
    precoImportadorComparacao,
    cupomConfirmado
  };

  if (precoAtual === null) {
    return {
      ok: false,
      bloquear: true,
      classificacao: CLASSIFICACOES_PRECO.SEM_EVIDENCIA,
      motivo: "preco_atual_sem_evidencia",
      motivos: ["preco_atual_sem_evidencia"],
      evidencias
    };
  }

  if (precoLocal !== null && precoImportadorComparacao !== null && divergenciaOrdemGrandeza(precoLocal, precoImportadorComparacao)) {
    return {
      ok: false,
      bloquear: true,
      classificacao: CLASSIFICACOES_PRECO.DIVERGENTE,
      motivo: "preco_divergente_extrator_importador",
      motivos: ["preco_divergente_extrator_importador"],
      evidencias
    };
  }

  if (precoLocal !== null && divergenciaOrdemGrandeza(precoLocal, precoAtual)) {
    return {
      ok: false,
      bloquear: true,
      classificacao: CLASSIFICACOES_PRECO.DIVERGENTE,
      motivo: "preco_divergente_extrator_oferta",
      motivos: ["preco_divergente_extrator_oferta"],
      evidencias
    };
  }

  if (precoOriginal !== null && precoOriginal > 0 && precoAtual > 0) {
    const descontoPercentual = ((precoOriginal - precoAtual) / precoOriginal) * 100;
    evidencias.descontoPercentual = Math.round(descontoPercentual * 100) / 100;

    if (precoOriginal > precoAtual && descontoPercentual >= 90 && !cupomConfirmado) {
      motivos.push("desconto_extremo_sem_cupom_confirmado");
    }
  }

  if (motivos.length) {
    return {
      ok: false,
      bloquear: true,
      classificacao: CLASSIFICACOES_PRECO.SUSPEITO,
      motivo: motivos[0],
      motivos,
      evidencias
    };
  }

  return {
    ok: true,
    bloquear: false,
    classificacao: CLASSIFICACOES_PRECO.CONFIAVEL,
    motivo: "preco_coerente",
    motivos: [],
    evidencias
  };
}

module.exports = {
  CLASSIFICACOES_PRECO,
  validarCoerenciaPreco
};
