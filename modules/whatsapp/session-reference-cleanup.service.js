"use strict";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function sessaoDoGrupo(grupo = {}) {
  if (!grupo || typeof grupo !== "object") return "";
  return texto(grupo.sessaoId || grupo.origemSessaoId || grupo.sessionId || grupo.sessao_id);
}

function copiarObjeto(valor) {
  if (Array.isArray(valor)) return valor.map(copiarObjeto);
  if (!valor || typeof valor !== "object") return valor;
  return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, copiarObjeto(item)]));
}

function limparVinculoDestino(destino, idsRemover) {
  if (!destino || typeof destino !== "object") return false;
  let alterou = false;
  const camposSessao = ["conexaoId", "sessaoId", "idSessao", "sessao", "idConexao"];
  let sessaoRemovida = false;
  const limparCampo = campo => {
    if (idsRemover.has(texto(destino[campo]))) {
      destino[campo] = "";
      alterou = true;
      sessaoRemovida = true;
    }
  };

  for (const campo of camposSessao) limparCampo(campo);

  if (sessaoRemovida && texto(destino.grupoJid)) {
    destino.grupoJid = "";
    alterou = true;
  }

  for (const campo of ["sessoes", "sessoesWhatsapp"]) {
    if (!Array.isArray(destino[campo])) continue;
    const antes = destino[campo].length;
    destino[campo] = destino[campo].filter(id => !idsRemover.has(texto(id)));
    alterou = alterou || antes !== destino[campo].length;
  }

  return alterou;
}

function limparColecaoDestinos(colecao, idsRemover) {
  if (!colecao || typeof colecao !== "object") return 0;
  let alteracoes = 0;
  if (Array.isArray(colecao)) {
    for (const destino of colecao) {
      if (limparVinculoDestino(destino, idsRemover)) alteracoes += 1;
    }
    return alteracoes;
  }

  const possuiCamposVinculo = ["conexaoId", "sessaoId", "idSessao", "sessao", "idConexao", "grupoJid", "sessoes", "sessoesWhatsapp"]
    .some(campo => Object.prototype.hasOwnProperty.call(colecao, campo));
  if (possuiCamposVinculo) {
    return limparVinculoDestino(colecao, idsRemover) ? 1 : 0;
  }

  for (const chave of Object.keys(colecao)) {
    if (idsRemover.has(texto(chave))) {
      delete colecao[chave];
      alteracoes += 1;
      continue;
    }
    alteracoes += limparColecaoDestinos(colecao[chave], idsRemover);
  }
  return alteracoes;
}

function colecaoContemVinculo(colecao, idsRemover) {
  if (!colecao || typeof colecao !== "object") return false;
  if (Array.isArray(colecao)) {
    return colecao.some(destino => {
      if (!destino || typeof destino !== "object") return false;
      if (["conexaoId", "sessaoId", "idSessao"].some(campo => idsRemover.has(texto(destino[campo])))) return true;
      if (["sessoes", "sessoesWhatsapp"].some(campo =>
        Array.isArray(destino[campo]) && destino[campo].some(id => idsRemover.has(texto(id)))
      )) return true;
      return false;
    });
  }
  const possuiCamposVinculo = ["conexaoId", "sessaoId", "idSessao", "sessao", "idConexao", "grupoJid", "sessoes", "sessoesWhatsapp"]
    .some(campo => Object.prototype.hasOwnProperty.call(colecao, campo));
  if (possuiCamposVinculo) {
    const sessaoVinculada = ["conexaoId", "sessaoId", "idSessao", "sessao", "idConexao"]
      .some(campo => idsRemover.has(texto(colecao[campo])));
    return sessaoVinculada ||
      ["sessoes", "sessoesWhatsapp"].some(campo =>
        Array.isArray(colecao[campo]) && colecao[campo].some(id => idsRemover.has(texto(id)))
      ) || (sessaoVinculada && idsRemover.has(texto(colecao.grupoJid)));
  }
  return Object.entries(colecao).some(([chave, valor]) =>
    idsRemover.has(texto(chave)) || colecaoContemVinculo(valor, idsRemover)
  );
}

function grupoPertenceSessao(grupo, sessaoId) {
  return sessaoDoGrupo(grupo) === texto(sessaoId);
}

function limparRadarConfigSessao(config = {}, sessaoId = "") {
  const alvo = texto(sessaoId);
  if (!alvo || !config || typeof config !== "object" || Array.isArray(config)) {
    return { config: copiarObjeto(config), changed: false, removedGroups: 0, remainingGroups: 0 };
  }

  const proximo = copiarObjeto(config);
  const sessoesEntrada = Array.isArray(proximo.sessoesWhatsappMonitoradas)
    ? proximo.sessoesWhatsappMonitoradas
    : [];
  const sessoesRestantes = [];
  let removidos = 0;

  for (const sessao of sessoesEntrada) {
    if (!sessao || typeof sessao !== "object") continue;
    const idSessao = texto(sessao.sessaoId || sessao.id || sessao.sessionId);
    const grupos = Array.isArray(sessao.gruposMonitorados) ? sessao.gruposMonitorados : [];
    if (idSessao === alvo) {
      removidos += grupos.length;
      continue;
    }
    const gruposRestantes = grupos.filter(grupo => {
      const remove = grupoPertenceSessao(grupo, alvo);
      if (remove) removidos += 1;
      return !remove;
    });
    sessoesRestantes.push({ ...sessao, gruposMonitorados: gruposRestantes });
  }

  const sessaoLegada = texto(proximo.sessaoWhatsappId);
  const gruposLegadosEntrada = Array.isArray(proximo.gruposMonitorados) ? proximo.gruposMonitorados : [];
  const gruposLegados = gruposLegadosEntrada.filter(grupo => {
    const idGrupo = sessaoDoGrupo(grupo);
    const remove = idGrupo === alvo || (!idGrupo && sessaoLegada === alvo);
    if (remove) removidos += 1;
    return !remove;
  });

  const gruposDerivados = sessoesRestantes.flatMap(sessao =>
    (Array.isArray(sessao.gruposMonitorados) ? sessao.gruposMonitorados : [])
      .map(grupo => ({ ...grupo, sessaoId: texto(sessao.sessaoId || sessao.id || sessao.sessionId) }))
  );
  const gruposFinais = [...gruposDerivados, ...gruposLegados.filter(grupo =>
    !gruposDerivados.some(item => texto(item.grupoId || item.id || item.remoteJid) === texto(grupo.grupoId || grupo.id || grupo.remoteJid))
  )];
  const restanteTelegram = Array.isArray(proximo.telegramMonitorados)
    ? proximo.telegramMonitorados.filter(Boolean)
    : [];

  proximo.sessoesWhatsappMonitoradas = sessoesRestantes;
  proximo.gruposMonitorados = gruposFinais;
  const sessaoComGrupo = sessoesRestantes.find(sessao =>
    Array.isArray(sessao?.gruposMonitorados) && sessao.gruposMonitorados.length > 0
  );
  proximo.sessaoWhatsappId = texto(sessaoComGrupo?.sessaoId || "");
  if (!gruposFinais.length && !restanteTelegram.length) {
    proximo.monitoramentoAtivo = false;
    proximo.monitoramentoAtivadoEm = "";
  }

  const changed = removidos > 0 ||
    JSON.stringify(proximo.sessoesWhatsappMonitoradas) !== JSON.stringify(config.sessoesWhatsappMonitoradas || []) ||
    JSON.stringify(proximo.gruposMonitorados) !== JSON.stringify(config.gruposMonitorados || []) ||
    texto(proximo.sessaoWhatsappId) !== texto(config.sessaoWhatsappId) ||
    proximo.monitoramentoAtivo !== config.monitoramentoAtivo;

  return {
    config: proximo,
    changed,
    removedGroups: removidos,
    remainingGroups: gruposFinais.length
  };
}

function radarConfigContemSessao(config = {}, sessaoId = "") {
  const alvo = texto(sessaoId);
  if (!alvo || !config || typeof config !== "object") return false;
  if (texto(config.sessaoWhatsappId) === alvo) return true;
  const sessoes = Array.isArray(config.sessoesWhatsappMonitoradas) ? config.sessoesWhatsappMonitoradas : [];
  if (sessoes.some(sessao => texto(sessao?.sessaoId || sessao?.id || sessao?.sessionId) === alvo)) return true;
  const grupos = Array.isArray(config.gruposMonitorados) ? config.gruposMonitorados : [];
  return grupos.some(grupo => sessaoDoGrupo(grupo) === alvo);
}

function filtrarFontesClonadorPorSessao(fontes = [], sessaoId = "", clienteId = "") {
  const alvo = texto(sessaoId);
  const workspace = texto(clienteId);
  if (!alvo) return Array.isArray(fontes) ? fontes.slice() : [];
  return (Array.isArray(fontes) ? fontes : []).filter(fonte =>
    !(texto(fonte?.sessaoId || fonte?.sessao_id || fonte?.sessionId) === alvo &&
      (!workspace || texto(fonte?.clienteId || fonte?.cliente_id) === workspace))
  );
}

module.exports = {
  copiarObjeto,
  limparVinculoDestino,
  limparColecaoDestinos,
  colecaoContemVinculo,
  limparRadarConfigSessao,
  radarConfigContemSessao,
  filtrarFontesClonadorPorSessao
};
