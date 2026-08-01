"use strict";

const {
  resumoFilaWorkspace,
  avaliarDestinosWorkspace
} = require("../engine/ofc/absorption-gate.service");

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function numero(valor, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function arredondar(valor, casas = 2) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

function porMinuto(total, janelaMinutos) {
  return arredondar(numero(total) / Math.max(1, numero(janelaMinutos, 15)), 2);
}

function nullQuandoSemAmostra(valor, amostra) {
  return numero(amostra) > 0 ? valor : null;
}

function calcularUTOOferta({ destinosCompativeis = [], execucoesPrevistas = null } = {}) {
  const destinos = lista(destinosCompativeis).filter(destino => destino && destino.ativo !== false);
  const custo = execucoesPrevistas !== null && execucoesPrevistas !== undefined
    ? Math.max(0, Math.floor(numero(execucoesPrevistas)))
    : Math.max(1, destinos.length || 1);
  return {
    custoUTO: custo,
    criterio: "quantidade_de_execucoes_previstas",
    destinosConsiderados: destinos.length,
    aplicouMudancas: false
  };
}

function medirWorkspaceOperacional({
  workspaceId = "",
  destinos = [],
  eventos15m = {},
  eventos60m = {},
  readClienteJson,
  agoraMs = Date.now()
} = {}) {
  const destinosPreview = avaliarDestinosWorkspace(destinos, 15, []);
  const fila = resumoFilaWorkspace(workspaceId, {
    readClienteJson,
    agoraMs,
    janelaAbertaAgora: destinosPreview.janelaAbertaAgora
  });
  const destinosResumo = avaliarDestinosWorkspace(destinos, 15, fila.itens || []);
  const entrada15 = numero(eventos15m.ofertasCriadas ?? eventos15m.entrada ?? eventos15m.itensAdicionadosFila);
  const saida15 = numero(eventos15m.enviosConfirmados ?? eventos15m.saida);
  const entrada60 = numero(eventos60m.ofertasCriadas ?? eventos60m.entrada ?? eventos60m.itensAdicionadosFila);
  const saida60 = numero(eventos60m.enviosConfirmados ?? eventos60m.saida);
  const tentativas = numero(eventos15m.enviosConfirmados) + numero(eventos15m.enviosErroFinal);
  const sucesso = tentativas > 0 ? arredondar(numero(eventos15m.enviosConfirmados) / tentativas, 4) : null;

  return {
    workspaceId,
    destinosAtivos: numero(destinosResumo.destinosAtivos),
    destinosOperacionais: numero(destinosResumo.destinosAptos),
    sessoesDisponiveis: numero(destinosResumo.integracoesAptas),
    janelaAberta: destinosResumo.janelaAbertaAgora === true,
    unidadesPendentes: numero(fila.pressaoEsteiraViva),
    unidadesEmExecucao: numero(fila.emTentativaEnvio),
    ofertasPendentes: numero(fila.pendentesVivos),
    taxaEntrada15m: porMinuto(entrada15, 15),
    taxaSaida15m: porMinuto(saida15, 15),
    taxaEntrada60m: porMinuto(entrada60, 60),
    taxaSaida60m: porMinuto(saida60, 60),
    idadeMediaOfertasMinutos: fila.idadeMediaVivaMs === null ? null : arredondar(fila.idadeMediaVivaMs / 60000, 2),
    idadeP90OfertasMinutos: fila.idadeP95VivaMs === null ? null : arredondar(fila.idadeP95VivaMs / 60000, 2),
    tempoMedioAteEnvioMinutos: nullQuandoSemAmostra(
      eventos15m.tempoMedioAteEnvioMs ? arredondar(numero(eventos15m.tempoMedioAteEnvioMs) / 60000, 2) : null,
      eventos15m.amostraTempoEnvio
    ),
    taxaSucessoExecutor: sucesso,
    amostraSuficiente: {
      tempoMedioAteEnvio: numero(eventos15m.amostraTempoEnvio) > 0,
      taxaSucessoExecutor: tentativas > 0
    },
    medidoEm: new Date(agoraMs).toISOString()
  };
}

module.exports = {
  calcularUTOOferta,
  medirWorkspaceOperacional
};
