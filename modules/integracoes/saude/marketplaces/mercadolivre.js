const { sanitizarDetalhes } = require("../regras");

function erroPareceTimeout(resultado = {}) {
  const texto = String(resultado?.detalhes?.erro || resultado?.erro || resultado?.mensagem || "").toLowerCase();
  return /timeout|timed out|etimedout|aborted|econnreset/.test(texto);
}

function adaptarMercadoLivre(resultado = {}) {
  const status = String(resultado.status || resultado.codigo || "").toLowerCase();
  const origem = resultado.origem || "teste_manual";
  const testeManual = origem === "teste_manual";
  const detalhes = sanitizarDetalhes(resultado.detalhes || {}) || {};

  if (resultado.ok === true || status === "ok") {
    return {
      marketplace: "mercadolivre",
      estado: "ok",
      codigo: "link_convertido",
      mensagem: resultado.mensagem || "Link de teste convertido com sucesso.",
      origem,
      detalhes
    };
  }

  if (["cookie_ausente", "cookie_expirado", "credencial_ausente", "credencial_invalida", "tag_ausente"].includes(status)) {
    return {
      marketplace: "mercadolivre",
      estado: "invalida",
      codigo: status || "credencial_invalida",
      mensagem: resultado.mensagem || "Credenciais ausentes, expiradas ou inválidas.",
      origem,
      detalhes
    };
  }

  if (testeManual) {
    return {
      marketplace: "mercadolivre",
      estado: "invalida",
      codigo: erroPareceTimeout(resultado) ? "timeout" : (status || "falha_teste"),
      mensagem: resultado.mensagem || "Teste manual não comprovou importação com link afiliado válido.",
      origem,
      detalhes
    };
  }

  if (status === "bloqueio_ml") {
    return {
      marketplace: "mercadolivre",
      estado: "ok",
      codigo: "bloqueio_temporario",
      mensagem: resultado.mensagem || "Mercado Livre bloqueou temporariamente a validação.",
      origem,
      falhaTemporaria: true,
      detalhes
    };
  }

  return {
    marketplace: "mercadolivre",
    estado: "ok",
    codigo: erroPareceTimeout(resultado) ? "timeout" : (status || "falha_teste"),
    mensagem: resultado.mensagem || "Não foi possível confirmar o Mercado Livre agora.",
    origem,
    falhaTemporaria: true,
    detalhes
  };
}

module.exports = { adaptarMercadoLivre };
