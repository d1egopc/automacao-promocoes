"use strict";

function texto(valor = "") {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function numero(valor, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

const MOTIVOS_TEMPORARIOS = new Set([
  "cooldown",
  "intervalo",
  "intervalo_nao_atingido",
  "proxima_tentativa_futura",
  "fora_horario",
  "fora_da_janela",
  "janela_fechada",
  "limite_diario",
  "limite_diario_esgotado",
  "sem_credito",
  "creditos_insuficientes",
  "esteira_saturada",
  "flow_sem_capacidade",
  "gate_absorcao_bloqueado",
  "gate_indisponivel_piloto",
  "sessao_indisponivel",
  "erro_temporario",
  "erro_recuperavel",
  "retry"
]);

const MOTIVOS_DEFINITIVOS = new Set([
  "marketplace_bloqueado",
  "marketplace_desabilitado",
  "retida_marketplace_nao_marcado",
  "categoria_incompativel",
  "categoria_bloqueada",
  "categoria_nao_marcada",
  "retida_categoria_nao_marcada",
  "sem_destino",
  "sem_destino_compativel",
  "retida_sem_destino_compativel",
  "sem_clientes_operacionais",
  "nenhum_destino_compativel",
  "sem_destino_apto",
  "automacao_desligada",
  "automacao_sem_destino_ativo",
  "cliente_invalido",
  "usuario_inativo",
  "workspace_inativo",
  "integracao_ausente",
  "erro_configuracao",
  "configuracao_invalida",
  "adapter_nao_implementado",
  "expirada_frescor_comercial",
  "flow_expirada_frescor_comercial"
]);

function motivoNormalizado(motivo = "") {
  return texto(motivo)
    .replace(/^flow_/, "")
    .replace(/^retida_/, "retida_");
}

function existeOutroDestinoCompativel(contexto = {}) {
  if (Array.isArray(contexto.destinosCompativeis)) return contexto.destinosCompativeis.length > 0;
  if (Array.isArray(contexto.destinosRestantesCompativeis)) return contexto.destinosRestantesCompativeis.length > 0;
  return numero(contexto.destinosCompativeis, -1) > 0 ||
    numero(contexto.destinosRestantesCompativeis, -1) > 0 ||
    numero(contexto.destinosElegiveis, -1) > 0;
}

function motivoDistribuicaoDefinitivo(motivo = "", contexto = {}) {
  const chave = motivoNormalizado(motivo);
  const contextoSeguro = contexto && typeof contexto === "object" ? contexto : {};

  if (!chave) {
    return {
      definitivo: false,
      motivo: "",
      tipo: "indefinido",
      statusOperacional: "temporario"
    };
  }

  if (MOTIVOS_TEMPORARIOS.has(chave)) {
    return {
      definitivo: false,
      motivo: chave,
      tipo: "temporario",
      statusOperacional: "temporario"
    };
  }

  if (chave === "sessao_ou_integracao_inapta") {
    const semIntegracaoConfigurada =
      contextoSeguro.integracaoAusente === true ||
      contextoSeguro.temIntegracao === false ||
      contextoSeguro.temCaminhoOperacional === false;
    return {
      definitivo: semIntegracaoConfigurada,
      motivo: chave,
      tipo: semIntegracaoConfigurada ? "definitivo" : "temporario",
      statusOperacional: semIntegracaoConfigurada ? "terminal" : "temporario"
    };
  }

  if (chave === "categoria_incompativel" && existeOutroDestinoCompativel(contextoSeguro)) {
    return {
      definitivo: false,
      motivo: chave,
      tipo: "parcial_por_destino",
      statusOperacional: "continuar_destinos_restantes"
    };
  }

  if (MOTIVOS_DEFINITIVOS.has(chave)) {
    return {
      definitivo: true,
      motivo: chave,
      tipo: "definitivo",
      statusOperacional: "terminal"
    };
  }

  if (/marketplace.*(bloquead|desabilitad|nao.*marcad)/.test(chave)) {
    return { definitivo: true, motivo: chave, tipo: "definitivo", statusOperacional: "terminal" };
  }
  if (/categoria.*(incompativel|bloquead|nao.*marcad)/.test(chave) && !existeOutroDestinoCompativel(contextoSeguro)) {
    return { definitivo: true, motivo: chave, tipo: "definitivo", statusOperacional: "terminal" };
  }
  if (/sem.*destino|nenhum.*destino|sem.*cliente.*operacional/.test(chave)) {
    return { definitivo: true, motivo: chave, tipo: "definitivo", statusOperacional: "terminal" };
  }
  if (/integracao.*ausent|credencial.*ausent|cliente.*invalido|usuario.*inativo|workspace.*inativo/.test(chave)) {
    return { definitivo: true, motivo: chave, tipo: "definitivo", statusOperacional: "terminal" };
  }

  return {
    definitivo: false,
    motivo: chave,
    tipo: "temporario_por_padrao",
    statusOperacional: "temporario"
  };
}

module.exports = {
  motivoDistribuicaoDefinitivo,
  motivoNormalizado
};
