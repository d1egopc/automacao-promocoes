const { resolveWorkspaceId } = require("./identity");

function texto(valor = "") {
  return String(valor || "").trim();
}

function tipoCanal(canal = {}) {
  return texto(canal.tipo || canal.canal || canal.provider || "whatsapp").toLowerCase();
}

function implementacaoCanal(tipo = "") {
  const normalizado = texto(tipo).toLowerCase();

  if (normalizado === "telegram") return "bot_telegram";
  if (normalizado === "instagram" || normalizado === "facebook") return "meta";
  if (normalizado === "whatsapp") return "baileys";

  return normalizado || "desconhecida";
}

function inferirWorkspacePorPrefixo(canalId = "", usuarios = []) {
  const id = texto(canalId);

  if (!id) return { workspaceId: "", origem: "indefinida" };

  if (/^admin(?:_|$)/.test(id)) {
    return { workspaceId: "admin", origem: "prefixo_sessao" };
  }

  const usuarioPrefixo = (Array.isArray(usuarios) ? usuarios : [])
    .map(usuario => texto(usuario?.id))
    .filter(workspaceId =>
      workspaceId.startsWith("user_") &&
      (id === workspaceId || id.startsWith(`${workspaceId}_`))
    )
    .sort((a, b) => b.length - a.length)[0];

  if (usuarioPrefixo) {
    return { workspaceId: usuarioPrefixo, origem: "prefixo_sessao" };
  }

  const matchUser = id.match(/^(user_[^_]+)(?:_|$)/);
  if (matchUser?.[1]) {
    return { workspaceId: matchUser[1], origem: "prefixo_sessao" };
  }

  return { workspaceId: "", origem: "indefinida" };
}

function listarWorkspacesExplicitosCanal(meta = {}) {
  return [...new Set([
    meta.workspaceId,
    meta.clienteId,
    meta.clienteIdMensageiro,
    meta.donoClienteId
  ].map(texto).filter(Boolean))];
}

function workspaceExplicitoCanal(meta = {}) {
  return listarWorkspacesExplicitosCanal(meta)[0] || "";
}

function sessaoCanalDesativada(meta = {}) {
  if (!meta || typeof meta !== "object") return false;
  if (meta.ativo === false || meta.desativada === true || meta.desativado === true || meta.disabled === true) return true;
  const status = texto(meta.status).toLowerCase();
  return new Set([
    "desativado",
    "desativada",
    "inativo",
    "inativa",
    "apagada",
    "deleted",
    "workspace_excluido",
    "connecting",
    "reconnecting",
    "backoff",
    "precisa_qr",
    "qr",
    "erro_auth",
    "offline",
    "logged_out",
    "loggedout"
  ]).has(status);
}

function resolverCanalWorkspaceEstrito(canalEntrada = {}, deps = {}) {
  const meta = canalEntrada && typeof canalEntrada === "object"
    ? canalEntrada
    : { id: canalEntrada };
  const canalId = texto(meta.id || meta.sessaoId || meta.identificadorTecnico);
  const workspacesExplicitos = listarWorkspacesExplicitosCanal(meta);
  const workspaceExplicito = workspacesExplicitos[0] || "";
  const inferido = inferirWorkspacePorPrefixo(canalId, deps.usuarios);
  const workspacePrefixo = texto(inferido.workspaceId);
  const base = resolverCanal(meta, deps);

  if (workspacesExplicitos.length > 1 || (workspaceExplicito && workspacePrefixo && workspaceExplicito !== workspacePrefixo)) {
    return { ...base, workspaceId: "", valido: false, motivo: "sessao_workspace_inconsistente" };
  }

  const workspaceId = workspaceExplicito || workspacePrefixo;
  if (!workspaceId) {
    return { ...base, workspaceId: "", valido: false, motivo: "sessao_sem_workspace" };
  }
  if (workspaceId.toLowerCase() === "admin") {
    return { ...base, workspaceId: "", valido: false, motivo: "workspace_admin" };
  }

  const usuario = (Array.isArray(deps.usuarios) ? deps.usuarios : [])
    .find(item => texto(item?.id) === workspaceId);
  if (!usuario) {
    return { ...base, workspaceId: "", valido: false, motivo: "workspace_inexistente" };
  }
  if (usuario.ativo === false) {
    return { ...base, workspaceId: "", valido: false, motivo: "workspace_inativo" };
  }
  if (sessaoCanalDesativada(meta)) {
    return { ...base, workspaceId: "", valido: false, motivo: "sessao_desativada" };
  }

  return {
    ...base,
    workspaceId,
    origemWorkspace: workspaceExplicito ? "mapa_sessao" : "prefixo_sessao",
    valido: true,
    motivo: "workspace_resolvido"
  };
}

function resolverCanal(canalEntrada = {}, deps = {}) {
  const meta = canalEntrada && typeof canalEntrada === "object"
    ? canalEntrada
    : { id: canalEntrada };
  const canalId = texto(meta.id || meta.sessaoId || meta.identificadorTecnico);
  const tipo = tipoCanal(meta);
  const workspaceExplicito = texto(
    meta.workspaceId ||
    meta.clienteId ||
    meta.clienteIdMensageiro ||
    meta.donoClienteId
  );

  if (workspaceExplicito) {
    return {
      canalId,
      tipo,
      implementacao: implementacaoCanal(tipo),
      workspaceId: resolveWorkspaceId(workspaceExplicito, { logFallback: false }),
      origemWorkspace: "mapa_sessao",
      identificadorTecnico: canalId,
      meta
    };
  }

  const inferido = inferirWorkspacePorPrefixo(canalId, deps.usuarios);

  return {
    canalId,
    tipo,
    implementacao: implementacaoCanal(tipo),
    workspaceId: inferido.workspaceId || "",
    origemWorkspace: inferido.origem,
    identificadorTecnico: canalId,
    meta
  };
}

function obterCanalPorId(canalId = "", deps = {}) {
  const id = texto(canalId);
  const sessoesMeta = deps.sessoesMeta || {};
  const meta = sessoesMeta?.[id] || { id };

  return resolverCanal(meta, deps);
}

function canalPertenceAoWorkspace(canalEntrada = {}, workspaceId = "", deps = {}) {
  const canal = resolverCanal(canalEntrada, deps);
  const alvo = resolveWorkspaceId(workspaceId, { logFallback: false });

  return Boolean(canal.workspaceId && alvo && canal.workspaceId === alvo);
}

module.exports = {
  resolverCanal,
  resolverCanalWorkspaceEstrito,
  obterCanalPorId,
  canalPertenceAoWorkspace,
  inferirWorkspacePorPrefixo,
  sessaoCanalDesativada,
  workspaceExplicitoCanal
};
