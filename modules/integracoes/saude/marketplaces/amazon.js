const { sanitizarDetalhes } = require("../regras");

function numeroStatus(resultado = {}) {
  const status = Number(resultado?.detalhes?.httpStatus ?? resultado?.httpStatus ?? 0);
  return Number.isFinite(status) ? status : 0;
}

function erroPareceTimeout(resultado = {}) {
  const texto = String(resultado?.detalhes?.erro || resultado?.erro || resultado?.mensagem || "").toLowerCase();
  return /timeout|timed out|etimedout|aborted|econnreset/.test(texto);
}

function adaptarAmazon(resultado = {}) {
  const status = String(resultado.status || resultado.codigo || "").toLowerCase();
  const httpStatus = numeroStatus(resultado);
  const detalhes = sanitizarDetalhes(resultado.detalhes || {}) || {};

  if (resultado.ok === true || status === "ok") {
    return {
      marketplace: "amazon",
      estado: "saudavel",
      codigo: "produto_consultado",
      mensagem: resultado.mensagem || "Produto consultado com sucesso. Cookie e tag aceitos.",
      origem: "teste_manual",
      detalhes
    };
  }

  if (["cookie_ausente", "credencial_ausente", "tag_ausente", "credencial_invalida"].includes(status)) {
    return {
      marketplace: "amazon",
      estado: "invalida",
      codigo: status || "credencial_invalida",
      mensagem: resultado.mensagem || "Credenciais obrigatórias ausentes ou inválidas.",
      origem: "teste_manual",
      detalhes
    };
  }

  if (status === "cookie_expirado") {
    const temporario = [403, 429, 503].includes(httpStatus) || erroPareceTimeout(resultado);
    return {
      marketplace: "amazon",
      estado: temporario ? "atencao" : "invalida",
      codigo: temporario ? "bloqueio_temporario" : "cookie_expirado",
      mensagem: resultado.mensagem || (temporario
        ? "Amazon retornou bloqueio temporário. Tente novamente mais tarde."
        : "Cookie expirado ou autenticação inválida."),
      origem: "teste_manual",
      detalhes
    };
  }

  if (status === "teste_nao_implementado") {
    return {
      marketplace: "amazon",
      estado: "atencao",
      codigo: "teste_nao_implementado",
      mensagem: resultado.mensagem || "Teste real ainda não implementado para este modo.",
      origem: "teste_manual",
      detalhes
    };
  }

  return {
    marketplace: "amazon",
    estado: "atencao",
    codigo: erroPareceTimeout(resultado) ? "timeout" : (status || "falha_teste"),
    mensagem: resultado.mensagem || "Não foi possível confirmar a saúde da Amazon agora.",
    origem: "teste_manual",
    detalhes
  };
}

module.exports = { adaptarAmazon };
