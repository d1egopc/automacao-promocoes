const WORKSPACE_ADMIN_ID = "admin";
const PAPEL_ADMIN_MASTER = "admin_master";

function texto(valor = "") {
  return String(valor || "").trim();
}

function resolveWorkspaceId(valor = "", opcoes = {}) {
  const workspaceId = texto(valor);

  if (workspaceId) {
    return workspaceId;
  }

  const fallback = texto(opcoes.fallback) || WORKSPACE_ADMIN_ID;

  if (fallback === WORKSPACE_ADMIN_ID && opcoes.logFallback !== false) {
    const motivo = texto(opcoes.motivo) || "workspace_ausente";
    const origem = texto(opcoes.origem) || "workspace";
    const logger = opcoes.logger || console;

    if (typeof logger.warn === "function") {
      logger.warn("[WORKSPACE-FALLBACK-ADMIN]", {
        origem,
        motivo
      });
    }
  }

  return fallback;
}

function resolveWorkspace(entrada = {}, opcoes = {}) {
  const workspaceId = resolveWorkspaceId(
    entrada.workspaceId || entrada.clienteId || entrada.id,
    opcoes
  );

  return {
    workspaceId,
    clienteId: workspaceId
  };
}

function isAdminMaster(usuario = {}) {
  return texto(usuario?.papel) === PAPEL_ADMIN_MASTER;
}

function isWorkspaceOwner(usuario = {}, workspaceId = "") {
  const usuarioId = texto(usuario?.id);
  const alvo = resolveWorkspaceId(workspaceId, { logFallback: false });

  return Boolean(usuarioId && usuarioId === alvo);
}

function resolveCanal(canal = {}) {
  return {
    tipo: texto(canal.tipo || canal.canal || canal.provider),
    sessaoId: texto(canal.sessaoId || canal.id),
    workspaceId: resolveWorkspaceId(canal.workspaceId || canal.clienteId, {
      origem: "canal",
      motivo: "canal_sem_workspace"
    })
  };
}

module.exports = {
  WORKSPACE_ADMIN_ID,
  PAPEL_ADMIN_MASTER,
  resolveWorkspaceId,
  resolveWorkspace,
  isAdminMaster,
  isWorkspaceOwner,
  resolveCanal
};
