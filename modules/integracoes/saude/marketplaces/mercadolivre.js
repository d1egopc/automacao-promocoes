const { sanitizarDetalhes } = require("../regras");

function erroPareceTimeout(resultado = {}) {
  const texto = String(resultado?.detalhes?.erro || resultado?.erro || resultado?.mensagem || "").toLowerCase();
  return /timeout|timed out|etimedout|aborted|econnreset/.test(texto);
}

function adaptarMercadoLivre(resultado = {}) {
  const status = String(resultado.status || resultado.codigo || "").toLowerCase();
  const detalhes = sanitizarDetalhes(resultado.detalhes || {}) || {};

  if (resultado.ok === true || status === "ok") {
    return {
      marketplace: "mercadolivre",
      estado: "saudavel",
      codigo: "link_convertido",
      mensagem: resultado.mensagem || "Link de teste convertido com sucesso.",
      origem: "teste_manual",
      detalhes
    };
  }

  if (["cookie_ausente", "cookie_expirado", "credencial_ausente", "credencial_invalida", "tag_ausente"].includes(status)) {
    return {
      marketplace: "mercadolivre",
      estado: "invalida",
      codigo: status || "credencial_invalida",
      mensagem: resultado.mensagem || "Credenciais ausentes, expiradas ou inválidas.",
      origem: "teste_manual",
      detalhes
    };
  }

  if (status === "bloqueio_ml") {
    return {
      marketplace: "mercadolivre",
      estado: "atencao",
      codigo: "bloqueio_temporario",
      mensagem: resultado.mensagem || "Mercado Livre bloqueou temporariamente a validação.",
      origem: "teste_manual",
      detalhes
    };
  }

  return {
    marketplace: "mercadolivre",
    estado: "atencao",
    codigo: erroPareceTimeout(resultado) ? "timeout" : (status || "falha_teste"),
    mensagem: resultado.mensagem || "Não foi possível confirmar a saúde do Mercado Livre agora.",
    origem: "teste_manual",
    detalhes
  };
}

module.exports = { adaptarMercadoLivre };
