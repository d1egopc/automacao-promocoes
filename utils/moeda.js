function texto(valor = "") {
  return String(valor ?? "").trim();
}

function analisarValorMonetario(valor, opcoes = {}) {
  const valorOriginal = valor;
  const tipo = valor === null ? "null" : typeof valor;
  const moedaExplicita = /R\$/i.test(String(valor ?? ""));
  const permitirZero = opcoes.permitirZero === true;

  if (valor === null || valor === undefined || valor === "") {
    return { ok: false, numero: null, valorOriginal, tipo, motivo: "vazio", moedaExplicita };
  }

  if (typeof valor === "number") {
    const ok = Number.isFinite(valor) && (permitirZero ? valor >= 0 : valor > 0);
    return {
      ok,
      numero: ok ? Math.round(valor * 100) / 100 : null,
      valorOriginal,
      tipo,
      motivo: ok ? "numero_direto" : "numero_invalido",
      moedaExplicita
    };
  }

  let bruto = texto(valor)
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/[^\d.,-]/g, "");

  if (!bruto || !/\d/.test(bruto)) {
    return { ok: false, numero: null, valorOriginal, tipo, motivo: "sem_digitos", moedaExplicita };
  }

  const negativo = bruto.startsWith("-");
  bruto = bruto.replace(/-/g, "");

  const temVirgula = bruto.includes(",");
  const temPonto = bruto.includes(".");
  let normalizado = bruto;
  let estrategia = "inteiro";
  let ambiguo = false;

  if (temVirgula && temPonto) {
    const ultimaVirgula = bruto.lastIndexOf(",");
    const ultimoPonto = bruto.lastIndexOf(".");

    if (ultimaVirgula > ultimoPonto) {
      normalizado = bruto.replace(/\./g, "").replace(",", ".");
      estrategia = "ptbr_milhar_decimal";
    } else {
      normalizado = bruto.replace(/,/g, "");
      estrategia = "internacional_milhar_decimal";
    }
  } else if (temVirgula) {
    normalizado = bruto.replace(",", ".");
    estrategia = "virgula_decimal";
  } else if (temPonto) {
    const partes = bruto.split(".");
    const ultimo = partes[partes.length - 1] || "";
    const formatoMilhar = /^\d{1,3}(?:\.\d{3})+$/.test(bruto);

    if (partes.length === 2 && ultimo.length <= 2) {
      normalizado = bruto;
      estrategia = "ponto_decimal";
    } else if (partes.length === 2 && ultimo.length === 3 && !moedaExplicita && partes[0].length >= 2) {
      normalizado = `${partes[0]}.${ultimo.replace(/0+$/, "") || "0"}`;
      estrategia = "ponto_decimal_tres_casas_sem_moeda";
      ambiguo = true;
    } else if (formatoMilhar) {
      normalizado = bruto.replace(/\./g, "");
      estrategia = "ponto_milhar";
    } else {
      const centavos = partes.pop();
      normalizado = `${partes.join("")}.${centavos}`;
      estrategia = "ponto_decimal_composto";
      ambiguo = true;
    }
  }

  if (negativo) normalizado = `-${normalizado}`;
  const numero = Number(normalizado);
  const ok = Number.isFinite(numero) && (permitirZero ? numero >= 0 : numero > 0);

  return {
    ok,
    numero: ok ? Math.round(numero * 100) / 100 : null,
    valorOriginal,
    tipo,
    motivo: ok ? estrategia : "numero_invalido",
    moedaExplicita,
    ambiguo
  };
}

function normalizarNumeroMoeda(valor, opcoes = {}) {
  const analise = analisarValorMonetario(valor, opcoes);
  return analise.ok ? analise.numero : null;
}

function normalizarPrecoTextoBR(valor) {
  const numero = normalizarNumeroMoeda(valor);
  return numero === null ? "" : numero.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatarMoedaBR(valor) {
  const numero = normalizarNumeroMoeda(valor);
  return numero === null ? "" : `R$ ${normalizarPrecoTextoBR(numero)}`;
}

function centavosMonetarios(valor, opcoes = {}) {
  const numero = normalizarNumeroMoeda(valor, { ...opcoes, permitirZero: opcoes.permitirZero === true });
  return numero === null ? null : Math.round(numero * 100);
}

module.exports = {
  analisarValorMonetario,
  normalizarNumeroMoeda,
  normalizarPrecoTextoBR,
  formatarMoedaBR,
  centavosMonetarios
};
