const {
  listClientes,
  readClienteJson,
  readGlobalJson
} = require("../../utils/storage");
const {
  criarWorkspaceAusente,
  montarWorkspace,
  normalizarId,
  workspaceElegivelEngine
} = require("./workspace-contract");

function objeto(valor, fallback = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : fallback;
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function mesclarMapaClientes(arquivoCliente = "", global = {}, ids = []) {
  const mapa = { ...objeto(global) };
  for (const workspaceId of ids) {
    const dados = readClienteJson(workspaceId, arquivoCliente, null);
    if (dados && typeof dados === "object" && !Array.isArray(dados)) {
      const { clienteId, ...semClienteIdRaiz } = dados;
      mapa[workspaceId] = semClienteIdRaiz;
    }
  }
  return mapa;
}

function carregarFontes(fontes = {}) {
  const usuarios = lista(
    Object.prototype.hasOwnProperty.call(fontes, "usuarios")
      ? fontes.usuarios
      : readGlobalJson("usuarios.json", [])
  );
  const idsUsuarios = usuarios.map(usuario => normalizarId(usuario?.id)).filter(Boolean);
  const idsClientes = [...new Set([...idsUsuarios, ...listClientes()])];

  const planos = objeto(
    Object.prototype.hasOwnProperty.call(fontes, "planos")
      ? fontes.planos
      : readGlobalJson("planos.json", {})
  );
  const integracoes = Object.prototype.hasOwnProperty.call(fontes, "integracoesPorCliente")
    ? objeto(fontes.integracoesPorCliente)
    : mesclarMapaClientes("integracoes.json", readGlobalJson("integracoes.json", {}), idsClientes);
  const configs = Object.prototype.hasOwnProperty.call(fontes, "configsPorCliente")
    ? objeto(fontes.configsPorCliente)
    : mesclarMapaClientes("config.json", readGlobalJson("configs_clientes.json", {}), idsClientes);
  const destinos = Object.prototype.hasOwnProperty.call(fontes, "destinosPorCliente")
    ? objeto(fontes.destinosPorCliente)
    : mesclarMapaClientes("destinos.json", readGlobalJson("destinos_clientes.json", {}), idsClientes);

  return {
    usuarios,
    planos,
    integracoesPorCliente: integracoes,
    configsPorCliente: configs,
    destinosPorCliente: destinos
  };
}

function normalizarPlanoId(valor = "") {
  return String(valor ?? "").trim().toLowerCase();
}

function obterPlanoUsuario(usuario = {}, planos = {}) {
  const planoId = normalizarPlanoId(usuario?.plano);
  if (!planoId) return null;

  if (planos[planoId]) return planos[planoId];
  return Object.values(planos).find((plano) => {
    const aliases = [
      plano?.nome,
      plano?.id,
      plano?.planoId,
      ...(Array.isArray(plano?.aliasesLegados) ? plano.aliasesLegados : [])
    ];
    return aliases.some((alias) => normalizarPlanoId(alias) === planoId);
  }) || null;
}

function montarWorkspaces(fontes = {}) {
  const dados = carregarFontes(fontes);
  const vistos = new Set();
  const workspaces = [];

  for (const usuario of dados.usuarios) {
    const workspaceId = normalizarId(usuario?.id);
    if (!workspaceId || vistos.has(workspaceId)) continue;
    vistos.add(workspaceId);
    workspaces.push(montarWorkspace({
      usuario,
      plano: obterPlanoUsuario(usuario, dados.planos),
      integracoes: dados.integracoesPorCliente[workspaceId] || {},
      config: dados.configsPorCliente[workspaceId] || {},
      destinos: dados.destinosPorCliente[workspaceId] || []
    }));
  }

  return workspaces;
}

function logResumo(workspaces = []) {
  const total = workspaces.length;
  const admins = workspaces.filter(workspace => workspace.tipo === "admin").length;
  const clientes = workspaces.filter(workspace => workspace.tipo === "cliente").length;
  const ativos = workspaces.filter(workspace => workspace.ativo === true).length;
  const inativos = workspaces.filter(workspace => workspace.ativo === false).length;
  const comerciais = workspaces.filter(workspace => workspace.comercial === true).length;
  const elegiveisEngine = workspaces.filter(workspaceElegivelEngine).length;

  console.log("[WORKSPACE-REGISTRY-CARREGADO]", JSON.stringify({
    total,
    admins,
    clientes,
    ativos,
    inativos,
    comerciais,
    elegiveisEngine
  }));
}

function logAvaliacao(workspace = {}, elegivelEngine = false, motivos = []) {
  console.log("[WORKSPACE-REGISTRY-AVALIACAO]", JSON.stringify({
    workspaceId: workspace.workspaceId || "",
    tipo: workspace.tipo || null,
    comercial: workspace.comercial === true,
    ativo: workspace.ativo === true,
    elegivelEngine: elegivelEngine === true,
    motivos
  }));
}

function listarWorkspaces(opcoes = {}) {
  const workspaces = montarWorkspaces(opcoes.fontes || opcoes);
  if (opcoes.log !== false) logResumo(workspaces);
  return workspaces;
}

function listarWorkspacesComerciais(opcoes = {}) {
  return listarWorkspaces(opcoes).filter(workspace => workspace.comercial === true);
}

function avaliarWorkspaceParaEngine(workspaceId = "", opcoes = {}) {
  const id = normalizarId(workspaceId);
  const workspace = listarWorkspaces({ ...opcoes, log: false })
    .find(item => item.workspaceId === id) || criarWorkspaceAusente(id);
  const elegivelEngine = workspaceElegivelEngine(workspace);
  const motivos = Array.isArray(workspace.motivosInelegibilidade)
    ? workspace.motivosInelegibilidade
    : [];

  if (opcoes.log !== false) logAvaliacao(workspace, elegivelEngine, motivos);
  return {
    workspace,
    elegivelEngine,
    motivo: elegivelEngine ? "elegivel" : (motivos[0] || "workspace_nao_operacional"),
    motivos
  };
}

function listarWorkspacesElegiveisEngine(opcoes = {}) {
  const workspaces = listarWorkspaces(opcoes);
  return workspaces.filter(workspace => avaliarWorkspaceParaEngine(workspace.workspaceId, { ...opcoes, log: false }).elegivelEngine);
}

function obterWorkspace(workspaceId = "", opcoes = {}) {
  const id = normalizarId(workspaceId);
  return listarWorkspaces({ ...opcoes, log: false })
    .find(workspace => workspace.workspaceId === id) || criarWorkspaceAusente(id);
}

function listarWorkspaceIdsElegiveisEngine(opcoes = {}) {
  return listarWorkspacesElegiveisEngine(opcoes).map(workspace => workspace.workspaceId);
}

module.exports = {
  avaliarWorkspaceParaEngine,
  carregarFontes,
  listarWorkspaceIdsElegiveisEngine,
  listarWorkspaces,
  listarWorkspacesComerciais,
  listarWorkspacesElegiveisEngine,
  obterWorkspace
};
