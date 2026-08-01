"use strict";

const { calcularUTOOferta, medirWorkspaceOperacional } = require("./medidor-operacional");

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function numero(valor, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

const AUDITORIA_LOGICA_FIXA = [
  {
    arquivo: "modules/engine/ofc/absorption-gate.service.js",
    funcao: "avaliarDestinosWorkspace",
    regraEncontrada: "filaAlvo5Min/filaAlvo10Min/filaAlvo15Min = soma de slots por destino",
    efeitoAtual: "Define capacidade Shadow por cobertura fixa de 5/10/15 minutos.",
    risco: "Pode ser interpretado como estoque alvo se usado fora de simulacao.",
    acaoRecomendada: "Manter temporariamente como metrica Shadow e substituir por capacidade adaptativa na V2.4 ativa."
  },
  {
    arquivo: "modules/engine/ofc/absorption-gate.service.js",
    funcao: "classificarEstadoEsteira",
    regraEncontrada: "pressaoEsteiraViva >= filaAlvo15Min classifica SATURADA",
    efeitoAtual: "Classifica a esteira Shadow usando teto de 15 minutos.",
    risco: "Cobertura de 15 minutos pode aceitar estoque maior que Fluxo Vivo deseja.",
    acaoRecomendada: "Migrar para calculo adaptativo baseado em absorcao real por workspace."
  },
  {
    arquivo: "modules/engine/ofc/active-gate.service.js",
    funcao: "calcularFilaAlvo",
    regraEncontrada: "Gate ativo piloto usa 10 min normal e 5 min turbo",
    efeitoAtual: "Roger usa filaAlvo10Min ou filaAlvo5Min antes de permitir a oferta atual.",
    risco: "Ainda e uma cobertura fixa, embora restrita ao piloto.",
    acaoRecomendada: "Manter ate V2.4 Shadow homologar capacidade real; nao expandir globalmente."
  },
  {
    arquivo: "modules/engine/distributor/distributor.runner.js",
    funcao: "distribuirOfertaEngine",
    regraEncontrada: "filaAlvo e gravado apenas em etapa/auditoria do gate_absorcao",
    efeitoAtual: "Nao muda fanout global; registra decisao por workspace.",
    risco: "Baixo; risco semantico se tratado como status comercial global.",
    acaoRecomendada: "Continuar como auditoria por workspace."
  },
  {
    arquivo: "utils/performance-hotfix.js",
    funcao: "avaliarLimiteFilaHotfix",
    regraEncontrada: "bloqueio legado com 40/60 pendentes para farejadores",
    efeitoAtual: "Limita fluxos legados automaticos fora do Engine V2 oficial.",
    risco: "Pode criar divergencia operacional entre farejadores legados e OFC.",
    acaoRecomendada: "Nao remover agora; mapear migracao para OFC apos Gate adaptativo."
  },
  {
    arquivo: "modules/engine/ofc/controller.runner.js",
    funcao: "executarObservabilidadeOfc",
    regraEncontrada: "reservatorio e metrica agregada do OFC Shadow",
    efeitoAtual: "Aparece apenas em observabilidade, sem alterar Worker.",
    risco: "Baixo; nome pode sugerir estoque permanente.",
    acaoRecomendada: "Renomear semanticamente em fase futura para reservatorio_operacional_shadow."
  }
];

function auditarLogicaFixaOfc() {
  return AUDITORIA_LOGICA_FIXA.map(item => ({ ...item }));
}

function resumirUTO(workspaces = []) {
  const resumo = {
    totalWorkspaces: 0,
    utoPressaoViva: 0,
    utoCapacidade15Min: 0,
    porEstado: {}
  };
  for (const workspace of lista(workspaces)) {
    resumo.totalWorkspaces += 1;
    resumo.utoPressaoViva += numero(workspace.pressaoEsteiraViva);
    resumo.utoCapacidade15Min += numero(workspace.slots15Min);
    const estado = workspace.estadoDaEsteira || workspace.estado || "desconhecido";
    resumo.porEstado[estado] = (resumo.porEstado[estado] || 0) + 1;
  }
  return resumo;
}

function metricasWorkspaceDaEsteira(gateAbsorcao = {}) {
  return lista(gateAbsorcao.workspaces).map(workspace => ({
    workspaceId: workspace.workspaceId || "",
    destinosAtivos: numero(workspace.capacidadePorDestino?.length),
    destinosOperacionais: numero(workspace.destinosAptos),
    sessoesDisponiveis: numero(workspace.integracoesAptas),
    janelaAberta: workspace.janelaAbertaAgora === true,
    unidadesPendentes: numero(workspace.pressaoEsteiraViva),
    unidadesEmExecucao: numero(workspace.emTentativaEnvio),
    ofertasPendentes: numero(workspace.pendentesVivos),
    taxaEntrada15m: workspace.entrada15Min === undefined ? null : numero(workspace.entrada15Min) / 15,
    taxaSaida15m: workspace.saida15Min === undefined ? null : numero(workspace.saida15Min) / 15,
    taxaEntrada60m: null,
    taxaSaida60m: null,
    idadeMediaOfertasMinutos: workspace.idadeMediaVivaMs === null || workspace.idadeMediaVivaMs === undefined
      ? null
      : Math.round((numero(workspace.idadeMediaVivaMs) / 60000) * 100) / 100,
    idadeP90OfertasMinutos: workspace.idadeP95VivaMs === null || workspace.idadeP95VivaMs === undefined
      ? null
      : Math.round((numero(workspace.idadeP95VivaMs) / 60000) * 100) / 100,
    tempoMedioAteEnvioMinutos: null,
    taxaSucessoExecutor: null,
    medidoEm: new Date().toISOString()
  }));
}

function criarAuditoriaOfcV24Shadow({ gateAbsorcao = {}, amostrasUTO = [] } = {}) {
  const workspaces = lista(gateAbsorcao.workspaces);
  const utoAmostra = lista(amostrasUTO).map(item => calcularUTOOferta(item));

  return {
    ok: true,
    modo: "shadow",
    aplicouMudancas: false,
    auditoriaFilaFixa: auditarLogicaFixaOfc(),
    metricasWorkspace: metricasWorkspaceDaEsteira(gateAbsorcao),
    uto: {
      resumo: resumirUTO(workspaces),
      amostra: utoAmostra
    },
    medidorOperacionalDisponivel: typeof medirWorkspaceOperacional === "function",
    duracaoMs: 0
  };
}

module.exports = {
  auditarLogicaFixaOfc,
  criarAuditoriaOfcV24Shadow
};
