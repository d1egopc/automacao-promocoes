"use strict";

const { readGlobalJson, readClienteJson } = require("../../../utils/storage");
const {
  resumoFilaWorkspace,
  avaliarDestinosWorkspace
} = require("./absorption-gate.service");

const MODO_ATIVO_PILOTO = "ativo_piloto";
const WORKSPACE_ADMIN = "admin";
const COBERTURA_NORMAL_MINUTOS = 10;
const COBERTURA_TURBO_MINUTOS = 5;

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function texto(valor = "") {
  return String(valor || "").trim();
}

function normalizar(valor = "") {
  return texto(valor).toLowerCase();
}

function numero(valor, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function parseWorkspacesAtivos(valor = process.env.OFC_GATE_ATIVO_WORKSPACES || "") {
  return new Set(
    String(valor || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean)
      .filter(item => item !== WORKSPACE_ADMIN)
  );
}

function workspaceGateAtivo(workspaceId = "", opcoes = {}) {
  const id = texto(workspaceId);
  if (!id || id === WORKSPACE_ADMIN) return false;
  const listaAtiva = opcoes.workspacesAtivos instanceof Set
    ? opcoes.workspacesAtivos
    : parseWorkspacesAtivos(opcoes.workspacesAtivos ?? opcoes.flagWorkspaces);
  return listaAtiva.has(id);
}

function carregarUsuarios(opcoes = {}) {
  if (Array.isArray(opcoes.usuarios)) return opcoes.usuarios;
  const lerGlobal = opcoes.readGlobalJson || readGlobalJson;
  const usuarios = lerGlobal("usuarios.json", []);
  return Array.isArray(usuarios) ? usuarios : [];
}

function usuarioPorId(usuarios = [], workspaceId = "") {
  return lista(usuarios).find(usuario => texto(usuario?.id) === texto(workspaceId)) || null;
}

function workspaceProtegido(workspaceId = "", opcoes = {}) {
  if (texto(workspaceId) === WORKSPACE_ADMIN) return true;
  const usuario = usuarioPorId(carregarUsuarios(opcoes), workspaceId);
  return normalizar(usuario?.papel) === "admin_master";
}

function cupomTurboAtivo({ tipoOperacional = "", cupomTurbo = false } = {}) {
  return cupomTurbo === true || normalizar(tipoOperacional) === "cupom_turbo";
}

function destinosParaCupomTurbo(destinos = [], ativo = false) {
  if (!ativo) return lista(destinos);
  return lista(destinos).map(destino => ({
    ...objeto(destino),
    cupomTurbo: true
  }));
}

function destinoPossuiIntegracaoInapta(capacidade = []) {
  return lista(capacidade).some(destino =>
    destino.destinoHabilitado === true && destino.integracaoApta === false
  );
}

function destinoPossuiLimiteZerado(capacidade = []) {
  return lista(capacidade).some(destino =>
    destino.destinoHabilitado === true &&
    destino.integracaoApta === true &&
    destino.limiteDiarioRestante === 0
  );
}

function motivoFechado(destinosResumo = {}) {
  const capacidade = lista(destinosResumo.capacidadePorDestino);
  if (destinosResumo.automacaoAtiva !== true) return "automacao_desligada";
  if (destinoPossuiIntegracaoInapta(capacidade)) return "integracao_inapta";
  if (destinoPossuiLimiteZerado(capacidade)) return "limite_diario_esgotado";
  if (destinosResumo.janelaAbertaAgora !== true) return "janela_fechada";
  if (numero(destinosResumo.destinosAptos) <= 0) return "sem_destino_apto";
  return "capacidade_zero";
}

function calcularFilaAlvo(destinosResumo = {}, turbo = false) {
  return turbo
    ? numero(destinosResumo.filaAlvo5Min)
    : numero(destinosResumo.filaAlvo10Min);
}

function classificarDecisao({ destinosResumo = {}, pressaoEsteiraViva = 0, filaAlvo = 0, quantidadeSolicitada = 1 } = {}) {
  const destinosAptos = numero(destinosResumo.destinosAptos);
  const capacidadeAtual = Math.max(0, filaAlvo - numero(pressaoEsteiraViva));
  if (destinosResumo.automacaoAtiva !== true || destinosResumo.janelaAbertaAgora !== true || destinosAptos <= 0 || filaAlvo <= 0) {
    return {
      permitir: false,
      estadoDaEsteira: "FECHADA",
      motivo: motivoFechado(destinosResumo),
      capacidadeAtual,
      quantidadeAceitaAgora: 0
    };
  }
  if (numero(pressaoEsteiraViva) >= filaAlvo || capacidadeAtual <= 0) {
    return {
      permitir: false,
      estadoDaEsteira: "SATURADA",
      motivo: "esteira_saturada",
      capacidadeAtual,
      quantidadeAceitaAgora: 0
    };
  }

  const quantidadeAceitaAgora = Math.max(0, Math.min(Math.floor(quantidadeSolicitada), Math.floor(capacidadeAtual)));
  if (quantidadeAceitaAgora <= 0) {
    return {
      permitir: false,
      estadoDaEsteira: "LIMITADA",
      motivo: "capacidade_inteira_indisponivel",
      capacidadeAtual,
      quantidadeAceitaAgora: 0
    };
  }

  if (quantidadeAceitaAgora < quantidadeSolicitada || capacidadeAtual <= quantidadeSolicitada) {
    return {
      permitir: true,
      estadoDaEsteira: "LIMITADA",
      motivo: "capacidade_limitada",
      capacidadeAtual,
      quantidadeAceitaAgora
    };
  }

  if (pressaoEsteiraViva > 0) {
    return {
      permitir: true,
      estadoDaEsteira: "ESTAVEL",
      motivo: "esteira_com_capacidade",
      capacidadeAtual,
      quantidadeAceitaAgora
    };
  }

  return {
    permitir: true,
    estadoDaEsteira: "LIVRE",
    motivo: "capacidade_livre_para_agua_nova",
    capacidadeAtual,
    quantidadeAceitaAgora
  };
}

function logGateAtivo(marcador = "", payload = {}) {
  console.log(marcador, JSON.stringify({
    workspaceId: payload.workspaceId || "",
    ofertaId: payload.ofertaId || null,
    estadoDaEsteira: payload.estadoDaEsteira || "",
    permitir: payload.permitir === true,
    quantidadeSolicitada: numero(payload.quantidadeSolicitada, 1),
    quantidadeAceitaAgora: numero(payload.quantidadeAceitaAgora),
    pressaoEsteiraViva: numero(payload.pressaoEsteiraViva),
    filaAlvo: numero(payload.filaAlvo),
    capacidadeAtual: numero(payload.capacidadeAtual),
    cupomTurbo: payload.cupomTurbo === true,
    motivo: payload.motivo || "",
    duracaoMs: numero(payload.duracaoMs),
    fallbackAplicado: payload.fallbackAplicado === true
  }));
}

function criarRespostaInativa(workspaceId = "") {
  return {
    modo: "shadow",
    ativo: false,
    workspaceId,
    permitir: true,
    quantidadeAceitaAgora: 1,
    estadoDaEsteira: "INATIVO",
    motivo: "gate_ativo_desabilitado",
    capacidadeAtual: null,
    pressaoEsteiraViva: null,
    filaAlvo: null,
    fallbackAplicado: false
  };
}

async function decidirAbsorcaoWorkspace(entrada = {}, opcoes = {}) {
  const inicio = Date.now();
  const workspaceId = texto(entrada.workspaceId);
  const ofertaId = entrada.ofertaId ?? null;
  const quantidadeSolicitada = Math.max(1, Math.floor(numero(entrada.quantidadeSolicitada, 1)));

  if (!workspaceGateAtivo(workspaceId, opcoes) || workspaceProtegido(workspaceId, opcoes)) {
    return criarRespostaInativa(workspaceId);
  }

  try {
    const turbo = cupomTurboAtivo(entrada);
    const destinos = destinosParaCupomTurbo(entrada.destinosCompativeis, turbo);
    const destinosPreview = avaliarDestinosWorkspace(destinos, 15, []);
    const fila = resumoFilaWorkspace(workspaceId, {
      ...opcoes,
      readClienteJson: opcoes.readClienteJson || readClienteJson,
      janelaAbertaAgora: destinosPreview.janelaAbertaAgora
    });
    const destinosResumo = avaliarDestinosWorkspace(destinos, 15, fila.itens || []);
    const filaAlvo = calcularFilaAlvo(destinosResumo, turbo);
    const pressaoEsteiraViva = numero(fila.pressaoEsteiraViva);
    const decisao = classificarDecisao({
      destinosResumo,
      pressaoEsteiraViva,
      filaAlvo,
      quantidadeSolicitada
    });

    const resposta = {
      modo: MODO_ATIVO_PILOTO,
      ativo: true,
      workspaceId,
      ofertaId,
      permitir: decisao.permitir,
      quantidadeAceitaAgora: decisao.quantidadeAceitaAgora,
      estadoDaEsteira: decisao.estadoDaEsteira,
      motivo: decisao.motivo,
      capacidadeAtual: decisao.capacidadeAtual,
      pressaoEsteiraViva,
      filaAlvo,
      fallbackAplicado: false,
      cupomTurbo: turbo,
      coberturaMinutos: turbo ? COBERTURA_TURBO_MINUTOS : COBERTURA_NORMAL_MINUTOS,
      capacidadeTeorica: numero(destinosResumo.capacidadeTeorica),
      idadeMaximaEsteiraMs: fila.idadeMaximaVivaMs ?? null,
      destinosAptos: numero(destinosResumo.destinosAptos),
      integracoesAptas: numero(destinosResumo.integracoesAptas),
      janelaAbertaAgora: destinosResumo.janelaAbertaAgora === true,
      quantidadeSolicitada,
      duracaoMs: Date.now() - inicio
    };

    logGateAtivo("[OFC-GATE-ATIVO-DECISAO]", resposta);
    if (!resposta.permitir) logGateAtivo("[OFC-GATE-ATIVO-BLOQUEIO-PILOTO]", resposta);
    return resposta;
  } catch (erro) {
    const resposta = {
      modo: MODO_ATIVO_PILOTO,
      ativo: true,
      workspaceId,
      ofertaId,
      permitir: false,
      quantidadeAceitaAgora: 0,
      estadoDaEsteira: "FECHADA",
      motivo: "gate_indisponivel_piloto",
      capacidadeAtual: 0,
      pressaoEsteiraViva: 0,
      filaAlvo: 0,
      fallbackAplicado: true,
      cupomTurbo: cupomTurboAtivo(entrada),
      quantidadeSolicitada,
      duracaoMs: Date.now() - inicio,
      erro: erro?.message || ""
    };
    logGateAtivo("[OFC-GATE-ATIVO-FALLBACK]", resposta);
    logGateAtivo("[OFC-GATE-ATIVO-BLOQUEIO-PILOTO]", resposta);
    return resposta;
  }
}

module.exports = {
  MODO_ATIVO_PILOTO,
  COBERTURA_NORMAL_MINUTOS,
  COBERTURA_TURBO_MINUTOS,
  parseWorkspacesAtivos,
  workspaceGateAtivo,
  cupomTurboAtivo,
  classificarDecisao,
  decidirAbsorcaoWorkspace
};
