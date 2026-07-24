const { centavosMonetarios: centavosMoeda } = require("../../utils/moeda");
function texto(valor = "") {
  return String(valor ?? "").trim();
}

function centavosMonetarios(valor) {
  if (typeof valor === "number") {
    return Number.isFinite(valor) && valor >= 0 ? Math.round(valor * 100) : null;
  }

  let entrada = texto(valor);
  if (!entrada) return null;
  entrada = entrada.replace(/^R\$\s*/i, "").replace(/\s+/g, "");

  if (!/^\d+(?:[.,]\d{1,2})?$/.test(entrada) && !/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(entrada)) {
    return null;
  }

  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(entrada)) {
    entrada = entrada.replace(/\./g, "").replace(",", ".");
  } else if (entrada.includes(",")) {
    entrada = entrada.replace(",", ".");
  }

  const numero = Number(entrada);
  return Number.isFinite(numero) && numero >= 0 ? Math.round(numero * 100) : null;
}

function percentualNumerico(valor) {
  if (typeof valor === "number") {
    return Number.isFinite(valor) && valor > 0 && valor <= 100 ? valor : null;
  }

  const entrada = texto(valor);
  const match = entrada.match(/^(\d+(?:[.,]\d{1,2})?)\s*%?$/);
  if (!match) return null;
  const percentual = Number(match[1].replace(",", "."));
  return Number.isFinite(percentual) && percentual > 0 && percentual <= 100 ? percentual : null;
}

function descontoMisto(valor, precoBaseCentavos) {
  const entrada = texto(valor);
  if (!entrada) return null;

  if (entrada.endsWith("%")) {
    const percentual = percentualNumerico(entrada);
    if (percentual === null) return null;
    return {
      centavos: Math.round(precoBaseCentavos * percentual / 100),
      tipo: "percentual",
      percentual
    };
  }

  const centavos = centavosMonetarios(valor);
  return centavos !== null && centavos > 0
    ? { centavos, tipo: "valor_fixo" }
    : null;
}

function componente(tipo, dados = {}) {
  return { tipo, ...dados };
}

function adicionarBeneficiosTextuaisIgnorados(beneficios, ignorados) {
  for (const beneficio of Array.isArray(beneficios) ? beneficios : []) {
    if (typeof beneficio === "string") {
      ignorados.push(componente("beneficio_textual", { valor: beneficio, motivo: "sem_impacto_financeiro_comprovado" }));
      continue;
    }

    if (beneficio && typeof beneficio === "object") {
      ignorados.push(componente(texto(beneficio.tipo) || "beneficio", {
        valor: beneficio.valor ?? beneficio.texto ?? "",
        motivo: "componente_nao_estruturado_para_calculo"
      }));
    }
  }
}

function calcularValorEfetivo(entrada = {}) {
  const ignorados = [];
  adicionarBeneficiosTextuaisIgnorados(entrada.beneficios, ignorados);

  const precoBaseCentavos = centavosMonetarios(entrada.preco);
  if (precoBaseCentavos === null || precoBaseCentavos <= 0) {
    return {
      valorEfetivo: null,
      valorEfetivoCentavos: null,
      valorEfetivoOrigem: "preco_invalido",
      valorEfetivoDetalhes: {
        precoBase: null,
        descontoAplicado: 0,
        cashbackAplicado: 0,
        freteAplicado: 0,
        componentesAplicados: [],
        componentesIgnorados: ignorados,
        comprovado: false
      }
    };
  }

  const freteConhecido = centavosMonetarios(entrada.freteValor);
  const freteBaseCentavos = freteConhecido ?? 0;
  const cenarios = [{
    valorCentavos: precoBaseCentavos + freteBaseCentavos,
    origem: freteConhecido !== null ? "preco_com_frete" : "preco",
    descontoCentavos: 0,
    cashbackCentavos: 0,
    freteCentavos: freteBaseCentavos,
    componentes: [componente("preco_base", { valorCentavos: precoBaseCentavos })]
  }];

  const precoPixCentavos = centavosMonetarios(entrada.precoPix);
  if (precoPixCentavos !== null && precoPixCentavos < precoBaseCentavos) {
    cenarios.push({
      valorCentavos: precoPixCentavos + freteBaseCentavos,
      origem: "preco_pix",
      descontoCentavos: precoBaseCentavos - precoPixCentavos,
      cashbackCentavos: 0,
      freteCentavos: freteBaseCentavos,
      componentes: [componente("preco_pix", { valorCentavos: precoPixCentavos })]
    });
  } else if (texto(entrada.precoPix)) {
    ignorados.push(componente("preco_pix", { valor: entrada.precoPix, motivo: precoPixCentavos === null ? "valor_nao_numerico" : "preco_pix_nao_menor" }));
  }

  const descontoPix = descontoMisto(entrada.descontoPix, precoBaseCentavos);
  if (descontoPix && descontoPix.centavos > 0 && descontoPix.centavos <= precoBaseCentavos) {
    cenarios.push({
      valorCentavos: precoBaseCentavos - descontoPix.centavos + freteBaseCentavos,
      origem: `desconto_pix_${descontoPix.tipo}`,
      descontoCentavos: descontoPix.centavos,
      cashbackCentavos: 0,
      freteCentavos: freteBaseCentavos,
      componentes: [componente("desconto_pix", descontoPix)]
    });
  } else if (texto(entrada.descontoPix)) {
    ignorados.push(componente("desconto_pix", { valor: entrada.descontoPix, motivo: "desconto_nao_comprovado" }));
  }

  const valorCupomCentavos = centavosMonetarios(entrada.valorCupom);
  const percentualCupom = percentualNumerico(entrada.percentualCupom);
  const descontosCupom = [];
  if (valorCupomCentavos !== null && valorCupomCentavos > 0) descontosCupom.push({ centavos: valorCupomCentavos, tipo: "valor_fixo" });
  if (percentualCupom !== null) descontosCupom.push({ centavos: Math.round(precoBaseCentavos * percentualCupom / 100), tipo: "percentual", percentual: percentualCupom });
  const cupomComprovado = descontosCupom.filter(item => item.centavos <= precoBaseCentavos).sort((a, b) => b.centavos - a.centavos)[0];

  if (cupomComprovado) {
    cenarios.push({
      valorCentavos: precoBaseCentavos - cupomComprovado.centavos + freteBaseCentavos,
      origem: `cupom_${cupomComprovado.tipo}`,
      descontoCentavos: cupomComprovado.centavos,
      cashbackCentavos: 0,
      freteCentavos: freteBaseCentavos,
      componentes: [componente("cupom", { codigo: texto(entrada.cupom), ...cupomComprovado })]
    });
  } else if (texto(entrada.cupom)) {
    ignorados.push(componente("cupom_textual", { valor: entrada.cupom, motivo: "sem_desconto_numerico_comprovado" }));
  }

  const cashbackValorCentavos = centavosMonetarios(entrada.cashbackValor);
  const cashbackPercentual = percentualNumerico(entrada.cashbackPercentual);
  const cashbacks = [];
  if (cashbackValorCentavos !== null && cashbackValorCentavos > 0) cashbacks.push({ centavos: cashbackValorCentavos, tipo: "valor_fixo" });
  if (cashbackPercentual !== null) cashbacks.push({ centavos: Math.round(precoBaseCentavos * cashbackPercentual / 100), tipo: "percentual", percentual: cashbackPercentual });
  const cashbackComprovado = cashbacks.filter(item => item.centavos <= precoBaseCentavos).sort((a, b) => b.centavos - a.centavos)[0];

  if (cashbackComprovado) {
    cenarios.push({
      valorCentavos: precoBaseCentavos - cashbackComprovado.centavos + freteBaseCentavos,
      origem: `cashback_${cashbackComprovado.tipo}`,
      descontoCentavos: 0,
      cashbackCentavos: cashbackComprovado.centavos,
      freteCentavos: freteBaseCentavos,
      componentes: [componente("cashback", cashbackComprovado)]
    });
  } else if (texto(entrada.cashbackValor) || texto(entrada.cashbackPercentual)) {
    ignorados.push(componente("cashback", { valor: entrada.cashbackValor || entrada.cashbackPercentual, motivo: "cashback_nao_numerico" }));
  }

  if (entrada.freteGratis === true) {
    if (freteConhecido !== null && freteConhecido > 0) {
      cenarios.push({
        valorCentavos: precoBaseCentavos,
        origem: "frete_gratis",
        descontoCentavos: 0,
        cashbackCentavos: 0,
        freteCentavos: 0,
        componentes: [componente("frete_gratis", { economiaCentavos: freteConhecido })]
      });
    } else {
      ignorados.push(componente("frete_gratis", { motivo: "frete_valor_desconhecido" }));
    }
  }

  cenarios.sort((a, b) => a.valorCentavos - b.valorCentavos);
  const escolhido = cenarios[0];
  for (const cenario of cenarios.slice(1)) {
    if (cenario.origem === "preco" || cenario.origem === "preco_com_frete") continue;
    ignorados.push(componente(cenario.origem, { motivo: "beneficio_nao_acumulado" }));
  }

  return {
    valorEfetivo: escolhido.valorCentavos / 100,
    valorEfetivoCentavos: escolhido.valorCentavos,
    valorEfetivoOrigem: escolhido.origem,
    valorEfetivoDetalhes: {
      precoBase: precoBaseCentavos / 100,
      descontoAplicado: escolhido.descontoCentavos / 100,
      cashbackAplicado: escolhido.cashbackCentavos / 100,
      freteAplicado: escolhido.freteCentavos / 100,
      componentesAplicados: escolhido.componentes,
      componentesIgnorados: ignorados,
      comprovado: true
    }
  };
}

module.exports = {
  calcularValorEfetivo
};
