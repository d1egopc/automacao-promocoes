"use strict";

const repository = require("./storage.repository");
const {
  CATEGORIAS_STORAGE,
  CLASSIFICACAO_STORAGE,
  POLITICAS_RETENCAO_PADRAO,
  LIMIARES_HEALTH
} = require("./storage.types");

function percentual(parte, total) {
  if (!total) return 0;
  return Number(((Number(parte || 0) / Number(total)) * 100).toFixed(2));
}

function nivelHealth(score) {
  if (score >= LIMIARES_HEALTH.excelente) return "Excelente";
  if (score >= LIMIARES_HEALTH.bom) return "Bom";
  if (score >= LIMIARES_HEALTH.atencao) return "Atencao";
  if (score >= LIMIARES_HEALTH.critico) return "Critico";
  return "Emergencia";
}

function classificarCategoria(categoria) {
  if ([CATEGORIAS_STORAGE.FILAS, CATEGORIAS_STORAGE.SESSOES, CATEGORIAS_STORAGE.CLIENTES].includes(categoria)) {
    return {
      classificacao: CLASSIFICACAO_STORAGE.VERDE,
      acao: "NAO_TOCAR",
      motivo: "dados_operacionais_ativos_ou_sensiveis"
    };
  }

  if ([CATEGORIAS_STORAGE.SNAPSHOTS, CATEGORIAS_STORAGE.BACKUPS, CATEGORIAS_STORAGE.ORFAOS].includes(categoria)) {
    return {
      classificacao: CLASSIFICACAO_STORAGE.AMARELO,
      acao: "PRECISA_AUDITORIA",
      motivo: "pode_conter_rollback_historico_ou_arquivo_sem_referencia"
    };
  }

  if ([CATEGORIAS_STORAGE.LOGS, CATEGORIAS_STORAGE.TEMPORARIOS, CATEGORIAS_STORAGE.CACHES].includes(categoria)) {
    return {
      classificacao: CLASSIFICACAO_STORAGE.VERMELHO,
      acao: "CANDIDATO_A_LIMPEZA",
      motivo: "grupo_tipicamente_reconstruivel_ou_descartavel_apos_validacao"
    };
  }

  if (categoria === CATEGORIAS_STORAGE.MIDIAS) {
    return {
      classificacao: CLASSIFICACAO_STORAGE.AMARELO,
      acao: "RECONSTRUIVEL_OU_AUDITAR",
      motivo: "midias_podem_ser_cache_ou_ativos_publicados"
    };
  }

  return {
    classificacao: CLASSIFICACAO_STORAGE.AMARELO,
    acao: "PRECISA_AUDITORIA",
    motivo: "categoria_generica_sem_politica_especifica"
  };
}

function estimarPotencialRecuperavel(categorias = {}) {
  const resumo = {
    baixoRiscoBytes: 0,
    precisaAuditoriaBytes: 0,
    reconstruivelBytes: 0,
    naoTocarBytes: 0,
    porCategoria: {}
  };

  for (const [categoria, dados] of Object.entries(categorias)) {
    const regra = classificarCategoria(categoria);
    const tamanhoBytes = Number(dados.tamanhoBytes || 0);
    const item = {
      ...dados,
      ...regra,
      espacoRecuperavelEstimadoBytes: 0,
      espacoRecuperavelEstimado: repository.bytesLegiveis(0),
      risco: "baixo",
      dependencias: [],
      validacaoNecessaria: []
    };

    if (regra.acao === "CANDIDATO_A_LIMPEZA") {
      item.espacoRecuperavelEstimadoBytes = tamanhoBytes;
      item.espacoRecuperavelEstimado = repository.bytesLegiveis(tamanhoBytes);
      item.risco = categoria === CATEGORIAS_STORAGE.TEMPORARIOS || categoria === CATEGORIAS_STORAGE.CACHES ? "baixo" : "medio";
      item.dependencias = ["confirmar_idade", "confirmar_ausencia_de_processo_ativo"];
      item.validacaoNecessaria = ["listar_amostras", "confirmar_retencao", "aprovar_limpeza_explicita"];
      resumo.baixoRiscoBytes += tamanhoBytes;
    } else if (regra.acao === "RECONSTRUIVEL_OU_AUDITAR") {
      item.risco = "medio";
      item.dependencias = ["confirmar_se_e_cache_ou_ativo_publicado"];
      item.validacaoNecessaria = ["amostrar_referencias", "verificar_frontend_envios", "aprovar_limpeza_explicita"];
      resumo.reconstruivelBytes += tamanhoBytes;
    } else if (regra.acao === "PRECISA_AUDITORIA") {
      item.risco = "medio_alto";
      item.dependencias = ["confirmar_operacao_origem", "confirmar_necessidade_de_rollback"];
      item.validacaoNecessaria = ["auditoria_por_operacao", "retencao", "aprovacao_explicita"];
      resumo.precisaAuditoriaBytes += tamanhoBytes;
    } else {
      item.risco = "alto_se_removido";
      item.dependencias = ["operacao_normal_do_optimus"];
      item.validacaoNecessaria = ["nao_remover_nesta_fase"];
      resumo.naoTocarBytes += tamanhoBytes;
    }

    resumo.porCategoria[categoria] = item;
  }

  resumo.baixoRisco = repository.bytesLegiveis(resumo.baixoRiscoBytes);
  resumo.precisaAuditoria = repository.bytesLegiveis(resumo.precisaAuditoriaBytes);
  resumo.reconstruivel = repository.bytesLegiveis(resumo.reconstruivelBytes);
  resumo.naoTocar = repository.bytesLegiveis(resumo.naoTocarBytes);
  return resumo;
}

function calcularStorageHealth(espaco, inventario, potencial) {
  if (!espaco || espaco.ok === false || !Number.isFinite(Number(espaco.percentualUsado))) {
    return { score: 0, nivel: "Indisponivel", motivos: ["espaco_volume_indisponivel"] };
  }

  const usado = Number(espaco.percentualUsado || 0);
  let score = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, usado - 50) * 1.4)));
  const motivos = [`uso_volume_${usado}%`];

  if (usado >= 95) {
    score = Math.min(score, 20);
    motivos.push("volume_emergencia");
  } else if (usado >= 90) {
    score = Math.min(score, 35);
    motivos.push("volume_critico");
  } else if (usado >= 80) {
    score = Math.min(score, 55);
    motivos.push("volume_atencao");
  }

  const totalArquivos = Number(inventario?.tamanhoTotalArquivosBytes || 0);
  const recuperavel = Number(potencial?.baixoRiscoBytes || 0) + Number(potencial?.precisaAuditoriaBytes || 0);
  if (totalArquivos && recuperavel / totalArquivos > 0.25) {
    score = Math.max(0, score - 10);
    motivos.push("alto_potencial_de_limpeza_exige_auditoria");
  }

  return { score, nivel: nivelHealth(score), motivos };
}

function topConsumo(inventario, limite = 5) {
  return Object.entries(inventario?.porCategoria || {})
    .sort((a, b) => b[1].tamanhoBytes - a[1].tamanhoBytes)
    .slice(0, limite)
    .map(([categoria, dados]) => ({ categoria, ...dados }));
}

function criarResumoExecutivo({ espaco, inventario, potencial, health }) {
  const maioresCategorias = topConsumo(inventario, 3);
  return {
    storageHealth: health.score,
    storageHealthNivel: health.nivel,
    maiorConsumo: maioresCategorias[0] || null,
    segundoMaiorConsumo: maioresCategorias[1] || null,
    terceiroMaiorConsumo: maioresCategorias[2] || null,
    espacoPotencialRecuperavelBaixoRisco: potencial.baixoRisco,
    espacoPotencialRecuperavelBaixoRiscoBytes: potencial.baixoRiscoBytes,
    limpezaAutomaticaPossivel: false,
    necessitaAuditoria: true,
    volume: espaco
  };
}

function gerarDiagnosticoStorage(opcoes = {}) {
  const dataDir = opcoes.dataDir || repository.DEFAULT_DATA_DIR;
  const top = Math.max(1, Math.min(500, Number(opcoes.top || 50) || 50));
  const timeoutMs = Math.max(1000, Math.min(120000, Number(opcoes.timeoutMs || 30000) || 30000));
  const deadlineMs = opcoes.deadlineMs || Date.now() + timeoutMs;
  const politicasRetencao = {
    ...POLITICAS_RETENCAO_PADRAO,
    ...(opcoes.politicasRetencao || {})
  };

  const inicio = Date.now();
  const espaco = repository.obterEspacoVolume(dataDir);
  const inventario = repository.inventariarVolume({ dataDir, top, deadlineMs });
  const filas = repository.resumirFilas({ dataDir, recentMinutes: opcoes.recentMinutes || 30, deadlineMs });
  const potencial = estimarPotencialRecuperavel(inventario.porCategoria);
  const health = calcularStorageHealth(espaco, inventario, potencial);

  return {
    ok: true,
    modo: "somente_leitura",
    aplicouMudancas: false,
    geradoEm: new Date().toISOString(),
    duracaoMs: Date.now() - inicio,
    timeoutMs,
    dataDir: "/data",
    politicasRetencao,
    resumo: criarResumoExecutivo({ espaco, inventario, potencial, health }),
    health,
    espaco,
    inventario,
    filas,
    potencialRecuperacao: potencial,
    seguranca: {
      naoApaga: true,
      naoCompacta: true,
      naoMove: true,
      naoAlteraFilas: true,
      naoExecutaReset: true,
      naoCriaRotinaAutomatica: true,
      naoImprimeConteudoArquivos: true,
      caminhosSanitizados: true,
      limpezaAutomaticaPossivel: false
    }
  };
}

async function diagnosticarDiretorios(opcoes = {}) {
  return repository.auditarDiretoriosPrimeiroNivel(opcoes);
}

async function diagnosticarWorkspaces(opcoes = {}) {
  return repository.auditarWorkspaces(opcoes);
}

async function diagnosticarWorkspace(workspaceId, opcoes = {}) {
  return repository.auditarWorkspaceIndividual(workspaceId, opcoes);
}

async function diagnosticarFilas(opcoes = {}) {
  return repository.auditarFilasIncremental(opcoes);
}

async function diagnosticarCategoria(categoria, opcoes = {}) {
  return repository.auditarCategoriaIncremental(categoria, opcoes);
}

async function executarLimpezaEmergencialFilaBak(opcoes = {}) {
  return repository.executarLimpezaFilaBakControlada(opcoes);
}

module.exports = {
  gerarDiagnosticoStorage,
  diagnosticarDiretorios,
  diagnosticarWorkspaces,
  diagnosticarWorkspace,
  diagnosticarFilas,
  diagnosticarCategoria,
  executarLimpezaEmergencialFilaBak,
  classificarCategoria,
  calcularStorageHealth,
  estimarPotencialRecuperavel
};
