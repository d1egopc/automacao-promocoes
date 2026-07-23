function criarLinkOptimusRepository({ configBase = {}, salvarConfig = () => {} } = {}) {
  function linksGerados() {
    configBase.linksGerados = configBase.linksGerados || {};
    return configBase.linksGerados;
  }

  function buscarPorCodigo(codigo = "") {
    const chave = String(codigo || "").trim();
    if (!chave) return null;
    const dados = linksGerados()[chave];
    if (!dados || typeof dados !== "object") return null;
    return { codigo: chave, dados };
  }

  function buscarPorLinkOriginal({ clienteId = "", linkOriginal = "" } = {}) {
    const cliente = String(clienteId || "").trim();
    const link = String(linkOriginal || "").trim();
    if (!link) return null;

    for (const [codigo, dados] of Object.entries(linksGerados())) {
      if (!dados || typeof dados !== "object") continue;
      const linkGerado = String(dados.urlOriginal || dados.original || "").trim();
      const clienteGerado = String(dados.clienteId || "").trim();
      if (linkGerado !== link) continue;
      if (clienteGerado !== cliente) continue;
      return { codigo, dados };
    }

    return null;
  }

  function gerarCodigoDisponivel() {
    const existentes = linksGerados();
    for (let tentativa = 0; tentativa < 10; tentativa += 1) {
      const codigo = Math.random().toString(36).substring(2, 8);
      if (codigo && !existentes[codigo]) return codigo;
    }
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  }

  function criarRegistro({ codigo = "", linkOriginal = "", marketplace = "", clienteId = "", criadoEm = new Date().toISOString() } = {}) {
    const chave = String(codigo || "").trim();
    const link = String(linkOriginal || "").trim();
    if (!chave || !link) return null;

    linksGerados()[chave] = {
      original: link,
      urlOriginal: link,
      marketplace,
      clienteId,
      cliques: 0,
      ultimoClique: null,
      criadoEm
    };

    return { codigo: chave, dados: linksGerados()[chave] };
  }

  function removerRegistro(codigo = "") {
    const chave = String(codigo || "").trim();
    if (!chave) return false;
    delete linksGerados()[chave];
    return true;
  }

  function salvar() {
    return salvarConfig();
  }

  function incrementarClique(codigo = "", { agora = new Date().toISOString() } = {}) {
    const registro = buscarPorCodigo(codigo);
    if (!registro?.dados?.original) return null;
    registro.dados.cliques = (registro.dados.cliques || 0) + 1;
    registro.dados.ultimoClique = agora;
    salvar();
    return registro;
  }

  return {
    buscarPorCodigo,
    buscarPorLinkOriginal,
    gerarCodigoDisponivel,
    criarRegistro,
    removerRegistro,
    salvar,
    incrementarClique
  };
}

module.exports = {
  criarLinkOptimusRepository
};
