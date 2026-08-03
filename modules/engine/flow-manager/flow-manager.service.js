"use strict";

const { readClienteJson } = require("../../../utils/storage");
const {
  resumoFilaWorkspace,
  avaliarDestinosWorkspace
} = require("../ofc/absorption-gate.service");

const COBERTURA_NORMAL_MINUTOS = 10;
const COBERTURA_TURBO_MINUTOS = 5;
const TTL_NORMAL_MS = 30 * 60 * 1000;
const TTL_TURBO_MS = 10 * 60 * 1000;

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function texto(valor = "") {
  return String(valor || "").trim();
}

function numero(valor, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function limitarNaoNegativo(valor = 0) {
  return Math.max(0, numero(valor));
}

function dataOfertaMs(oferta = {}, agoraMs = Date.now()) {
  const candidatos = [
    oferta.criada_em,
    oferta.criado_em,
    oferta.criadoEm,
    oferta.dataEntradaFila,
    oferta.capturado_em,
    oferta.capturadaEm,
    oferta.atualizada_em
  ];

  for (const candidato of candidatos) {
    if (!candidato) continue;
    const ms = Date.parse(candidato);
    if (Number.isFinite(ms)) return ms;
  }

  return agoraMs;
}

function tipoFluxoOferta(entrada = {}) {
  const oferta = objeto(entrada.oferta);
  const tipo = texto(
    entrada.tipoFluxo ||
    entrada.tipoOperacional ||
    entrada.tipo_operacional ||
    oferta.tipoOperacional ||
    oferta.tipo_operacional
  ).toLowerCase();
  const turbo = entrada.cupomTurbo === true ||
    oferta.cupomTurbo === true ||
    oferta.cupom_turbo === true ||
    tipo === "cupom_turbo";
  return turbo ? "cupom_turbo" : "oferta_comum";
}

function ttlFluxoMs(tipoFluxo = "") {
  return tipoFluxo === "cupom_turbo" ? TTL_TURBO_MS : TTL_NORMAL_MS;
}

function coberturaFluxoMinutos(tipoFluxo = "") {
  return tipoFluxo === "cupom_turbo" ? COBERTURA_TURBO_MINUTOS : COBERTURA_NORMAL_MINUTOS;
}

function prioridadeFluxoOferta(entrada = {}, tipoFluxo = "") {
  const oferta = objeto(entrada.oferta);
  const base = numero(
    entrada.prioridade ??
    entrada.prioridadeFluxo ??
    oferta.prioridade ??
    oferta.prioridadeEnvio ??
    oferta.prioridadeFila ??
    oferta.score,
    40
  );
  if (tipoFluxo === "cupom_turbo") return Math.max(110, base);
  return Math.max(0, Math.min(100, Math.round(base)));
}

function motivoSemCapacidade(destinosResumo = {}, creditoOk = true, runtime = null, nivelAlvo = 0) {
  if (!creditoOk) return "sem_credito";
  if (runtime) return runtime.motivo || "sessao_ou_integracao_inapta";
  if (numero(destinosResumo.destinosAtivos) <= 0) return "automacao_desligada";
  if (numero(destinosResumo.integracoesAptas) <= 0) return "sessao_ou_integracao_inapta";
  if (numero(destinosResumo.destinosAptos) <= 0) {
    const capacidades = lista(destinosResumo.capacidadePorDestino);
    const integracoes = capacidades.filter(item => item.destinoHabilitado && item.integracaoApta);
    const todosLimiteZerado = integracoes.length > 0 && integracoes.every(item => item.limiteDiarioRestante === 0);
    return todosLimiteZerado ? "limite_diario_esgotado" : "janela_fechada";
  }
  if (nivelAlvo <= 0) return "sem_saida_possivel";
  return "esteira_saturada";
}

async function verificarCreditos(workspaceId = "", oferta = {}, opcoes = {}) {
  if (typeof opcoes.validarCreditos !== "function") return { ok: true };
  try {
    const resultado = await opcoes.validarCreditos(workspaceId, oferta);
    if (resultado?.ok === false) return { ok: false, motivo: resultado.motivo || "sem_credito" };
    return { ok: true };
  } catch (_) {
    return { ok: false, motivo: "creditos_indisponiveis" };
  }
}

function diagnosticarRuntime(entrada = {}, opcoes = {}) {
  if (typeof opcoes.diagnosticarDisponibilidadeEnvioWorkspace !== "function") return null;
  try {
    const resultado = opcoes.diagnosticarDisponibilidadeEnvioWorkspace(entrada.workspaceId || "", {
      destinosCompativeis: entrada.destinosCompativeis || [],
      oferta: entrada.oferta || {
        id: entrada.ofertaId,
        marketplace: entrada.marketplace
      }
    });
    if (!resultado || resultado.ok !== false) return null;
    const motivo = texto(resultado.motivo).toLowerCase();
    if (/credito/.test(motivo)) return { motivo: "sem_credito" };
    if (/destino/.test(motivo)) return { motivo: "sem_destino_apto" };
    if (/janela|horario|horário/.test(motivo)) return { motivo: "janela_fechada" };
    if (/sessao|sessão|integracao|integração|canal|whatsapp|telegram/.test(motivo)) {
      return { motivo: "sessao_ou_integracao_inapta" };
    }
    return { motivo: motivo || "workspace_indisponivel" };
  } catch (_) {
    return { motivo: "workspace_indisponivel" };
  }
}

function nivelAlvoPorCobertura(destinosResumo = {}, tipoFluxo = "") {
  return tipoFluxo === "cupom_turbo"
    ? limitarNaoNegativo(destinosResumo.filaAlvo5Min ?? destinosResumo.slots5Min)
    : limitarNaoNegativo(destinosResumo.filaAlvo10Min ?? destinosResumo.slots10Min);
}

function logFlowShadow(decisao = {}) {
  try {
    console.log("[OPTIMUS-FLOW-V1-SHADOW]", JSON.stringify({
      workspaceId: texto(decisao.workspaceId),
      ofertaId: decisao.ofertaId ?? null,
      marketplace: texto(decisao.marketplace),
      tipoFluxo: texto(decisao.tipoFluxo),
      aceitarAgora: decisao.aceitarAgora === true,
      motivo: texto(decisao.motivo),
      nivelAlvo: decisao.nivelAlvo ?? null,
      bufferAtual: decisao.bufferAtual ?? null,
      vagasDisponiveis: decisao.vagasDisponiveis ?? null,
      destinosAptos: decisao.destinosAptos ?? null,
      ttlMs: decisao.ttlMs ?? null,
      idadeOfertaMs: decisao.idadeOfertaMs ?? null,
      prioridadeFluxo: decisao.prioridadeFluxo ?? null,
      aplicouMudancas: false
    }));
  } catch (_) {}
}

async function avaliarFluxoWorkspaceShadow(entrada = {}, opcoes = {}) {
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const workspaceId = texto(entrada.workspaceId || entrada.clienteId || entrada.oferta?.cliente_id);
  const oferta = objeto(entrada.oferta);
  const marketplace = texto(entrada.marketplace || oferta.marketplace);
  const ofertaId = entrada.ofertaId ?? oferta.id ?? null;
  const tipoFluxo = tipoFluxoOferta(entrada);
  const coberturaMinutos = coberturaFluxoMinutos(tipoFluxo);
  const ttlMs = ttlFluxoMs(tipoFluxo);
  const origemMs = dataOfertaMs(oferta, agoraMs);
  const idadeOfertaMs = Math.max(0, agoraMs - origemMs);
  const expiraEm = new Date(origemMs + ttlMs).toISOString();
  const prioridadeFluxo = prioridadeFluxoOferta(entrada, tipoFluxo);

  try {
    const destinos = lista(entrada.destinosCompativeis);
    const destinosPreview = avaliarDestinosWorkspace(destinos, coberturaMinutos, []);
    const fila = resumoFilaWorkspace(workspaceId, {
      ...opcoes,
      readClienteJson: opcoes.readClienteJson || readClienteJson,
      janelaAbertaAgora: destinosPreview.janelaAbertaAgora
    });
    const destinosResumo = avaliarDestinosWorkspace(destinos, coberturaMinutos, fila.itens || []);
    const credito = await verificarCreditos(workspaceId, oferta, opcoes);
    const runtime = diagnosticarRuntime({ ...entrada, workspaceId, oferta }, opcoes);
    const nivelCalculado = nivelAlvoPorCobertura(destinosResumo, tipoFluxo);
    const nivelAlvo = destinosResumo.janelaAbertaAgora === true && !runtime && credito.ok
      ? nivelCalculado
      : 0;
    const bufferAtual = limitarNaoNegativo(fila.pressaoEsteiraViva);
    const vagasDisponiveis = Math.max(0, nivelAlvo - bufferAtual);
    const aceitarAgora = nivelAlvo > 0 && vagasDisponiveis > 0;
    const motivo = aceitarAgora
      ? "capacidade_disponivel"
      : motivoSemCapacidade(destinosResumo, credito.ok, runtime || (credito.ok ? null : { motivo: credito.motivo }), nivelAlvo);

    const decisao = {
      modo: "shadow",
      workspaceId,
      ofertaId,
      marketplace,
      aceitarAgora,
      motivo,
      quantidadeAceita: aceitarAgora ? 1 : 0,
      nivelAlvo,
      bufferAtual,
      vagasDisponiveis,
      destinosAptos: limitarNaoNegativo(destinosResumo.destinosAptos),
      ttlMs,
      expiraEm,
      prioridadeFluxo,
      tipoFluxo,
      idadeOfertaMs,
      aplicouMudancas: false
    };
    logFlowShadow(decisao);
    return decisao;
  } catch (erro) {
    const decisao = {
      modo: "shadow",
      workspaceId,
      ofertaId,
      marketplace,
      aceitarAgora: true,
      motivo: "flow_shadow_indisponivel",
      quantidadeAceita: 1,
      nivelAlvo: null,
      bufferAtual: null,
      vagasDisponiveis: null,
      destinosAptos: null,
      ttlMs,
      expiraEm,
      prioridadeFluxo,
      tipoFluxo,
      idadeOfertaMs,
      erro: erro?.message || "",
      aplicouMudancas: false
    };
    logFlowShadow(decisao);
    return decisao;
  }
}

module.exports = {
  COBERTURA_NORMAL_MINUTOS,
  COBERTURA_TURBO_MINUTOS,
  TTL_NORMAL_MS,
  TTL_TURBO_MS,
  avaliarFluxoWorkspaceShadow,
  coberturaFluxoMinutos,
  ttlFluxoMs,
  nivelAlvoPorCobertura,
  prioridadeFluxoOferta
};
