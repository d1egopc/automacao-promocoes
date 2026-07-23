const {
  montarUrlLinkOptimus,
  resolverDominioBaseLinkOptimus
} = require("./link-optimus");

function localizarLinkOptimusExistente({
  clienteId = "",
  linkOriginal = "",
  repository = null,
  configBase = {},
  dominioFallback = ""
} = {}) {
  const link = String(linkOriginal || "").trim();
  if (!link || !repository || typeof repository.buscarPorLinkOriginal !== "function") return null;

  const existente = repository.buscarPorLinkOriginal({ clienteId, linkOriginal: link });
  if (!existente) return null;

  const url = montarUrlLinkOptimus(existente.codigo, configBase, dominioFallback);
  if (!url) return null;
  return { codigo: existente.codigo, url, dados: existente.dados };
}

function gerarCodigoLinkOptimus(repository = null) {
  if (!repository || typeof repository.gerarCodigoDisponivel !== "function") return "";
  return repository.gerarCodigoDisponivel();
}

function criarLinkOptimus(linkOriginal = "", marketplace = "", opcoes = {}) {
  const configBase = opcoes.configGlobal || {};
  const repository = opcoes.repository || null;
  const dominioFallback = opcoes.dominioFallback || "";
  const link = String(linkOriginal || "").trim();
  const clienteId = String(opcoes.clienteId || "").trim();

  if (!link) return { ok: false, motivo: "link_original_ausente" };
  if (configBase?.linksOptimus?.ativo !== true) return { ok: false, motivo: "config_desativada" };
  if (!resolverDominioBaseLinkOptimus(configBase, dominioFallback)) return { ok: false, motivo: "dominio_ausente" };
  if (!repository) return { ok: false, motivo: "repository_indisponivel" };

  const existente = localizarLinkOptimusExistente({
    clienteId,
    linkOriginal: link,
    repository,
    configBase,
    dominioFallback
  });

  if (existente) {
    return { ok: true, url: existente.url, codigo: existente.codigo, reutilizado: true };
  }

  const codigo = gerarCodigoLinkOptimus(repository);
  repository.criarRegistro({ codigo, linkOriginal: link, marketplace, clienteId });

  try {
    repository.salvar();
  } catch (erro) {
    repository.removerRegistro(codigo);
    throw erro;
  }

  return {
    ok: true,
    url: montarUrlLinkOptimus(codigo, configBase, dominioFallback),
    codigo,
    reutilizado: false
  };
}

function gerarLinkOptimus(linkOriginal = "", marketplace = "", opcoes = {}) {
  const resultado = criarLinkOptimus(linkOriginal, marketplace, opcoes);
  return resultado.ok ? resultado.url : String(linkOriginal || "");
}

module.exports = {
  localizarLinkOptimusExistente,
  gerarCodigoLinkOptimus,
  criarLinkOptimus,
  gerarLinkOptimus
};
