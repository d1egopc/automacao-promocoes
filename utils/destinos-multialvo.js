"use strict";

const MAX_ALVOS_DESTINO = 5;
const ESTADOS_ALVO_TERMINAIS = new Set(["enviado", "erro_terminal", "erro_definitivo", "terminal"]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function tipoDestino(destino = {}) {
  const tipo = texto(destino.tipo || destino.canal).toLowerCase();
  if (tipo === "discord") return "discord";
  if (tipo === "whatsapp") return "whatsapp";
  return "";
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function chaveAlvo(alvo = {}) {
  return texto(alvo.alvoId || alvo.id || alvo.grupoId || alvo.channelId || alvo.canalId || alvo.chatId);
}

function alvoWhatsapp(item = {}, destino = {}) {
  const raw = item && typeof item === "object" ? item : { id: item };
  const grupoId = texto(
    raw.grupoId ||
    raw.groupId ||
    raw.jid ||
    raw.chatId ||
    raw.id ||
    raw.value ||
    raw.grupo
  );
  if (!grupoId) return null;

  const sessao = texto(raw.sessao || raw.conexaoId || raw.sessaoId || destino.conexaoId || destino.sessao || destino.sessaoId);
  return {
    tipo: "whatsapp",
    alvoId: grupoId,
    id: grupoId,
    grupoId,
    sessao,
    conexaoId: sessao,
    nome: texto(raw.nome || raw.name || raw.subject || raw.grupoNome || raw.nomeGrupo || raw.label || grupoId)
  };
}

function alvoDiscord(item = {}, destino = {}) {
  const raw = item && typeof item === "object" ? item : { id: item };
  const channelId = texto(
    raw.channelId ||
    raw.canalId ||
    raw.id ||
    raw.value ||
    raw.grupo ||
    raw.canal
  );
  if (!channelId) return null;

  const conexaoId = texto(raw.conexaoId || raw.sessao || raw.idConexao || destino.conexaoId || destino.sessao || destino.idConexao);
  return {
    tipo: "discord",
    alvoId: channelId,
    id: channelId,
    channelId,
    canalId: channelId,
    conexaoId,
    sessao: conexaoId,
    nome: texto(raw.nome || raw.name || raw.channelName || raw.grupoNome || raw.nomeGrupo || raw.label || channelId)
  };
}

function candidatosLegadosWhatsapp(destino = {}) {
  const grupos = lista(destino.gruposWhatsapp);
  if (grupos.length) return grupos;
  const grupo = texto(destino.grupo || destino.grupoId || destino.chatId || destino.canal);
  return grupo ? [grupo] : [];
}

function candidatosLegadosDiscord(destino = {}) {
  const channelId = texto(destino.channelId || destino.canalId || destino.grupo || destino.canal);
  return channelId ? [{ id: channelId, nome: destino.channelName || destino.grupoNome || destino.nomeGrupo }] : [];
}

function normalizarAlvosDestino(destino = {}) {
  const tipo = tipoDestino(destino);
  if (!tipo) return [];

  const recebidos = lista(destino.alvos).length
    ? lista(destino.alvos)
    : tipo === "whatsapp"
      ? candidatosLegadosWhatsapp(destino)
      : candidatosLegadosDiscord(destino);

  const vistos = new Set();
  const out = [];
  for (const item of recebidos) {
    const alvo = tipo === "whatsapp" ? alvoWhatsapp(item, destino) : alvoDiscord(item, destino);
    if (!alvo) continue;
    const chave = chaveAlvo(alvo);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(alvo);
    if (out.length >= MAX_ALVOS_DESTINO) break;
  }
  return out;
}

function aplicarContratoMultiAlvoDestino(destino = {}) {
  const tipo = tipoDestino(destino);
  if (!tipo) return destino;

  const alvos = normalizarAlvosDestino(destino);
  const primeiro = alvos[0] || null;
  const normalizado = {
    ...destino,
    alvos
  };

  if (tipo === "whatsapp") {
    const sessao = texto(normalizado.conexaoId || normalizado.sessao || normalizado.sessaoId || primeiro?.sessao);
    normalizado.conexaoId = sessao;
    normalizado.sessao = texto(normalizado.sessao || sessao);
    normalizado.sessaoId = texto(normalizado.sessaoId || sessao);
    normalizado.idSessao = texto(normalizado.idSessao || sessao);
    normalizado.gruposWhatsapp = alvos.map(alvo => alvo.grupoId).filter(Boolean);
    if (primeiro) {
      normalizado.grupo = primeiro.grupoId;
      normalizado.grupoNome = primeiro.nome || normalizado.grupoNome;
    }
    normalizado.telegramDestinos = [];
  }

  if (tipo === "discord") {
    const conexaoId = texto(normalizado.conexaoId || normalizado.sessao || primeiro?.conexaoId);
    normalizado.conexaoId = conexaoId;
    normalizado.sessao = texto(normalizado.sessao || conexaoId);
    normalizado.gruposWhatsapp = [];
    normalizado.telegramDestinos = [];
    if (primeiro) {
      normalizado.channelId = primeiro.channelId;
      normalizado.canalId = primeiro.channelId;
      normalizado.grupo = primeiro.channelId;
      normalizado.channelName = primeiro.nome || normalizado.channelName;
      normalizado.grupoNome = primeiro.nome || normalizado.grupoNome;
    }
  }

  return normalizado;
}

function estadoAlvoTerminal(estado = "") {
  return ESTADOS_ALVO_TERMINAIS.has(texto(estado).toLowerCase());
}

function snapshotAlvosDestino(destino = {}) {
  return normalizarAlvosDestino(destino).map(alvo => ({ ...alvo }));
}

function prepararEstadoAlvos(estado = {}, snapshot = []) {
  const existentes = new Map(lista(estado.alvosEstado).map(item => [chaveAlvo(item), item]));
  return snapshot.map(alvo => {
    const existente = existentes.get(chaveAlvo(alvo)) || {};
    return {
      alvoId: chaveAlvo(alvo),
      estado: texto(existente.estado || "pendente"),
      tentativas: Number(existente.tentativas || 0),
      enviadoEm: texto(existente.enviadoEm),
      erro: texto(existente.erro)
    };
  });
}

function criarOuAtualizarSnapshotEstado(estado = {}, destino = {}) {
  const snapshotExistente = lista(estado.snapshotAlvos);
  const snapshot = snapshotExistente.length ? snapshotExistente : snapshotAlvosDestino(destino);
  return {
    ...estado,
    snapshotAlvos: snapshot,
    alvosEstado: prepararEstadoAlvos(estado, snapshot)
  };
}

function alvosPendentesEstado(estado = {}) {
  const completo = criarOuAtualizarSnapshotEstado(estado);
  const porId = new Map(lista(completo.alvosEstado).map(item => [chaveAlvo(item), item]));
  return lista(completo.snapshotAlvos).filter(alvo => {
    const atual = porId.get(chaveAlvo(alvo));
    return !atual || !estadoAlvoTerminal(atual.estado);
  });
}

function registrarResultadoAlvo(estado = {}, alvo = {}, resultado = {}) {
  const completo = criarOuAtualizarSnapshotEstado(estado);
  const alvoId = chaveAlvo(alvo);
  const agora = texto(resultado.enviadoEm || resultado.data) || new Date().toISOString();
  const index = completo.alvosEstado.findIndex(item => item.alvoId === alvoId);
  const anterior = index >= 0 ? completo.alvosEstado[index] : { alvoId, tentativas: 0 };
  const proximo = {
    alvoId,
    estado: texto(resultado.estado || (resultado.ok ? "enviado" : "falha")),
    tentativas: Number(anterior.tentativas || 0) + (resultado.contarTentativa === false ? 0 : 1),
    enviadoEm: resultado.ok ? agora : texto(anterior.enviadoEm),
    erro: resultado.ok ? "" : texto(resultado.erro || resultado.motivo || "erro_envio")
  };

  if (index >= 0) completo.alvosEstado[index] = proximo;
  else completo.alvosEstado.push(proximo);
  return completo;
}

function destinoConcluidoPorAlvos(estado = {}) {
  const completo = criarOuAtualizarSnapshotEstado(estado);
  if (!lista(completo.snapshotAlvos).length) return false;
  const porId = new Map(lista(completo.alvosEstado).map(item => [item.alvoId, item]));
  return completo.snapshotAlvos.every(alvo => {
    const atual = porId.get(chaveAlvo(alvo));
    return atual && estadoAlvoTerminal(atual.estado);
  });
}

function destinoEnviadoPorAlvos(estado = {}) {
  const completo = criarOuAtualizarSnapshotEstado(estado);
  if (!lista(completo.snapshotAlvos).length) return false;
  const porId = new Map(lista(completo.alvosEstado).map(item => [item.alvoId, item]));
  return completo.snapshotAlvos.every(alvo => {
    const atual = porId.get(chaveAlvo(alvo));
    return atual && atual.estado === "enviado";
  });
}

function estadoLogicoPorAlvos(estado = {}) {
  if (destinoEnviadoPorAlvos(estado)) return "enviado";
  if (destinoConcluidoPorAlvos(estado)) return "erro_definitivo";
  return "aguardando";
}

module.exports = {
  MAX_ALVOS_DESTINO,
  aplicarContratoMultiAlvoDestino,
  alvosPendentesEstado,
  chaveAlvo,
  criarOuAtualizarSnapshotEstado,
  destinoConcluidoPorAlvos,
  destinoEnviadoPorAlvos,
  estadoAlvoTerminal,
  estadoLogicoPorAlvos,
  normalizarAlvosDestino,
  registrarResultadoAlvo,
  snapshotAlvosDestino
};
