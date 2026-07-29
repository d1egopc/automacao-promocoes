const { WORKSPACE_ADMIN_ID } = require("./identity");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarId(valor = "") {
  return texto(valor);
}

function normalizarTipoWorkspace(usuario = null, workspaceId = "") {
  const id = normalizarId(workspaceId || usuario?.id);
  const papel = texto(usuario?.papel).toLowerCase();
  if (id === WORKSPACE_ADMIN_ID || papel === "admin_master") return "admin";
  return "cliente";
}

function normalizarMarketplace(valor = "") {
  return texto(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_");
}

function normalizarListaMarketplaces(lista = []) {
  return [...new Set(
    (Array.isArray(lista) ? lista : [])
      .map(normalizarMarketplace)
      .filter(Boolean)
  )];
}

function listarPermissoesPlano(plano = null) {
  const recursos = plano && typeof plano === "object" && plano.recursos && typeof plano.recursos === "object"
    ? plano.recursos
    : {};

  return Object.entries(recursos)
    .filter(([, valor]) => valor === true)
    .map(([chave]) => chave)
    .sort();
}

function planoTemPermissaoEngine(plano = null) {
  const recursos = plano && typeof plano === "object" && plano.recursos && typeof plano.recursos === "object"
    ? plano.recursos
    : {};
  const chaves = [
    "engine",
    "engineV2",
    "engine_v2",
    "automacao",
    "ofertasAutomaticas",
    "ofertas_automaticas",
    "radarAutomatico",
    "radar_automatico"
  ];

  const declaradas = chaves.filter(chave => Object.prototype.hasOwnProperty.call(recursos, chave));
  if (!declaradas.length) return false;
  return declaradas.some(chave => recursos[chave] === true);
}

function temDestinoAtivo(destinos = []) {
  if (!Array.isArray(destinos)) return false;
  return destinos.some(destino => destino && typeof destino === "object" && destino.ativo !== false);
}

function creditosOkUsuario(usuario = null) {
  if (!usuario || typeof usuario !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(usuario, "creditos")) return null;
  const creditos = Number(usuario.creditos);
  return Number.isFinite(creditos) ? creditos > 0 : null;
}

function criarWorkspaceAusente(workspaceId = "") {
  const id = normalizarId(workspaceId);
  return {
    workspaceId: id,
    tipo: null,
    comercial: false,
    existente: false,
    ativo: false,
    plano: {
      id: null,
      nome: null,
      ativo: null
    },
    permissoes: [],
    marketplacesPermitidos: [],
    operacional: {
      automacaoAtiva: null,
      temDestino: null,
      creditosOk: null
    },
    integracoes: {},
    destinos: [],
    motivosInelegibilidade: ["workspace_inexistente"]
  };
}

function montarWorkspace({
  usuario = null,
  plano = null,
  integracoes = {},
  config = {},
  destinos = []
} = {}) {
  const workspaceId = normalizarId(usuario?.id);
  if (!workspaceId) return criarWorkspaceAusente("");

  const tipo = normalizarTipoWorkspace(usuario, workspaceId);
  const comercial = tipo === "cliente";
  const ativo = usuario?.ativo !== false;
  const planoId = texto(usuario?.plano);
  const planoNome = texto(plano?.nome || planoId) || null;
  const planoAtivo = plano
    ? plano.ativo !== false
    : null;
  const permissaoEngine = planoTemPermissaoEngine(plano);
  const motivos = [];

  if (!comercial) motivos.push("workspace_admin");
  if (!ativo) motivos.push("workspace_inativo");
  if (comercial && !planoId) motivos.push("workspace_sem_plano");
  if (comercial && planoId && !plano) motivos.push("plano_inexistente");
  if (comercial && plano && plano.ativo === false) motivos.push("plano_inativo");
  if (comercial && plano && plano.ativo !== false && permissaoEngine !== true) motivos.push("plano_sem_permissao");
  if (comercial && (usuario?.operacional === false || config?.operacional === false || usuario?.bloqueado === true)) {
    motivos.push("workspace_nao_operacional");
  }

  return {
    workspaceId,
    tipo,
    comercial,
    existente: true,
    ativo,
    plano: {
      id: planoId || null,
      nome: planoNome,
      ativo: planoAtivo
    },
    permissoes: listarPermissoesPlano(plano),
    marketplacesPermitidos: normalizarListaMarketplaces(plano?.marketplaces),
    operacional: {
      automacaoAtiva: Object.prototype.hasOwnProperty.call(config || {}, "automacaoAtiva") ? config.automacaoAtiva === true : null,
      temDestino: Array.isArray(destinos) ? temDestinoAtivo(destinos) : null,
      creditosOk: creditosOkUsuario(usuario)
    },
    integracoes: integracoes && typeof integracoes === "object" && !Array.isArray(integracoes) ? integracoes : {},
    destinos: Array.isArray(destinos) ? destinos : [],
    motivosInelegibilidade: [...new Set(motivos)]
  };
}

function workspaceElegivelEngine(workspace = {}) {
  const motivos = Array.isArray(workspace.motivosInelegibilidade)
    ? workspace.motivosInelegibilidade
    : [];
  const bloqueantes = new Set([
    "workspace_inexistente",
    "workspace_admin",
    "workspace_inativo",
    "workspace_sem_plano",
    "plano_inexistente",
    "plano_inativo",
    "plano_sem_permissao",
    "workspace_nao_operacional"
  ]);

  return !motivos.some(motivo => bloqueantes.has(motivo));
}

module.exports = {
  criarWorkspaceAusente,
  montarWorkspace,
  normalizarId,
  normalizarListaMarketplaces,
  normalizarMarketplace,
  workspaceElegivelEngine
};
