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
  const origem = resultado.origem || "teste_manual";
  const testeManual = origem === "teste_manual";
  const detalhes = sanitizarDetalhes(resultado.detalhes || {}) || {};

  if (resultado.ok === true || status === "ok") {
    return {
      marketplace: "amazon",
      estado: "ok",
      codigo: "produto_consultado",
      mensagem: resultado.mensagem || "Produto consultado com sucesso. Cookie e tag aceitos.",
      origem,
      detalhes
    };
  }

  if (["cookie_ausente", "credencial_ausente", "tag_ausente", "credencial_invalida"].includes(status)) {
    return {
      marketplace: "amazon",
      estado: "invalida",
      codigo: status || "credencial_invalida",
      mensagem: resultado.mensagem || "Credenciais obrigatórias ausentes ou inválidas.",
      origem,
      detalhes
    };
  }

  if (status === "cookie_expirado") {
    const temporario = [403, 429, 503].includes(httpStatus) || erroPareceTimeout(resultado);
    if (testeManual) {
      return {
        marketplace: "amazon",
        estado: "invalida",
        codigo: temporario ? "bloqueio_temporario" : "cookie_expirado",
        mensagem: resultado.mensagem || (temporario
          ? "Amazon bloqueou a validação manual neste momento."
          : "Cookie expirado ou autenticação inválida."),
        origem,
        detalhes
      };
    }
    return {
      marketplace: "amazon",
      estado: temporario ? "ok" : "invalida",
      codigo: temporario ? "bloqueio_temporario" : "cookie_expirado",
      mensagem: resultado.mensagem || (temporario
        ? "Amazon retornou bloqueio temporário. Tente novamente mais tarde."
        : "Cookie expirado ou autenticação inválida."),
      origem,
      falhaTemporaria: temporario,
      detalhes
    };
  }

  if (status === "teste_nao_implementado") {
    if (testeManual) {
      return {
        marketplace: "amazon",
        estado: "invalida",
        codigo: "teste_nao_implementado",
        mensagem: resultado.mensagem || "Teste real ainda não implementado para este modo.",
        origem,
        detalhes
      };
    }
    return {
      marketplace: "amazon",
      estado: "ok",
      codigo: "teste_nao_implementado",
      mensagem: resultado.mensagem || "Teste real ainda não implementado para este modo.",
      origem,
      falhaTemporaria: true,
      detalhes
    };
  }

  if (testeManual) {
    return {
      marketplace: "amazon",
      estado: "invalida",
      codigo: erroPareceTimeout(resultado) ? "timeout" : (status || "falha_teste"),
      mensagem: resultado.mensagem || "Teste manual não comprovou produto com link afiliado válido.",
      origem,
      detalhes
    };
  }

  return {
    marketplace: "amazon",
    estado: "ok",
    codigo: erroPareceTimeout(resultado) ? "timeout" : (status || "falha_teste"),
    mensagem: resultado.mensagem || "Não foi possível confirmar a Amazon agora.",
    origem,
    falhaTemporaria: true,
    detalhes
  };
}

module.exports = { adaptarAmazon };
