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
  obterCanalPorId,
  canalPertenceAoWorkspace,
  inferirWorkspacePorPrefixo
};
