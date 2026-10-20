function inventoryLegacy({ workspaceId, mensageiroConfig = {}, clientFiles = [] } = {}) {
  return {
    workspaceId: String(workspaceId || ""),
    profiles: (mensageiroConfig.perfis || []).map(p => ({ id: p.id, name: p.nome, removed: Boolean(p.removidoEm), sessionId: Boolean(p.sessaoId) })),
    schedules: (mensageiroConfig.programacoes || []).map(p => ({ id: p.id, name: p.nome, profileId: p.perfilId || null, active: p.ativo === true, executableLegacy: !p.perfilId })),
    tombstones: (mensageiroConfig.perfisExcluidos || []).map(p => ({ profileId: p.perfilId, removedAt: p.removidoEm })),
    clientFiles: clientFiles.map(String),
    executableLegacyCount: (mensageiroConfig.programacoes || []).filter(p => !p.perfilId && p.ativo === true).length
  };
}

function buildResetPlan(inventory, { confirmWorkspaceIds = [] } = {}) {
  const allowed = new Set(confirmWorkspaceIds.map(String));
  const workspaceId = String(inventory?.workspaceId || "");
  if (!workspaceId || !allowed.has(workspaceId)) return { ok: false, reason: "workspace_nao_confirmada", workspaceId };
  return {
    ok: true,
    workspaceId,
    actions: [
      "quarentenar legado fora da fonte executável",
      "criar backup restrito e não executável",
      "inicializar estado V3 vazio",
      "criar perfis com IDs novos",
      "validar zero programações V3 antes de reconfigurar",
      "habilitar somente scheduler V3"
    ],
    mustNot: ["alterar outros workspaces", "reutilizar IDs", "ativar scheduler legado", "restaurar legado no rollback"]
  };
}

module.exports = { inventoryLegacy, buildResetPlan };
