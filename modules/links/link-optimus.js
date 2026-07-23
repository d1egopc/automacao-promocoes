const { normalizarDominioPublico, textoLink } = require("./url-normalizer");

function normalizarDominioLinkOptimus(valor = "") {
  return normalizarDominioPublico(valor);
}

function normalizarFormatoLinkOptimus(valor = "/r") {
  const texto = String(valor || "/r").trim() || "/r";
  const comBarra = texto.startsWith("/") ? texto : "/" + texto;
  return comBarra.replace(/\/+$/, "") || "/r";
}

function resolverDominioBaseLinkOptimus(configBase = {}, dominioFallback = "") {
  const dominioConfigurado = normalizarDominioLinkOptimus(configBase?.linksOptimus?.dominio);
  if (dominioConfigurado) return dominioConfigurado;
  return normalizarDominioLinkOptimus(dominioFallback || "");
}

function montarUrlLinkOptimus(codigo = "", configBase = {}, dominioFallback = "") {
  const dominio = resolverDominioBaseLinkOptimus(configBase, dominioFallback);
  if (!dominio || !codigo) return "";
  return dominio + "/r/" + codigo;
}

function origemDominioLinkOptimus(configBase = {}, dominioFallback = "") {
  const dominioConfig = normalizarDominioLinkOptimus(configBase?.linksOptimus?.dominio);
  if (dominioConfig) {
    return {
      dominio: dominioConfig,
      origem: "config"
    };
  }

  const dominioRailway = normalizarDominioLinkOptimus(dominioFallback || "");
  if (dominioRailway) {
    return {
      dominio: dominioRailway,
      origem: "railway"
    };
  }

  return {
    dominio: "",
    origem: "indisponivel"
  };
}

function montarRespostaConfigLinksOptimus(configBase = {}, dominioFallback = "") {
  const efetivo = origemDominioLinkOptimus(configBase, dominioFallback);
  return {
    dominio: normalizarDominioLinkOptimus(configBase?.linksOptimus?.dominio),
    dominioEfetivo: efetivo.dominio,
    origem: efetivo.origem
  };
}

function normalizarDominioConfigLinkOptimus(valor = "") {
  const texto = textoLink(valor);
  if (!texto) {
    return {
      ok: true,
      dominio: ""
    };
  }

  if (!/^https?:\/\//i.test(texto)) {
    return {
      ok: false,
      erro: "dominio_deve_incluir_http_ou_https"
    };
  }

  try {
    const url = new URL(texto);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
      return {
        ok: false,
        erro: "dominio_invalido"
      };
    }

    if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
      return {
        ok: false,
        erro: "dominio_nao_deve_conter_caminho_query_ou_fragmento"
      };
    }

    url.pathname = "/";
    url.search = "";
    url.hash = "";

    return {
      ok: true,
      dominio: url.toString().replace(/\/+$/, "")
    };
  } catch {
    return {
      ok: false,
      erro: "dominio_invalido"
    };
  }
}

function extrairLinkAfiliadoOferta(oferta = {}) {
  return String(
    oferta.linkAfiliado ||
    oferta.linkFinal ||
    oferta.link ||
    oferta.urlAfiliada ||
    oferta.url ||
    ""
  ).trim();
}

function copiarOfertaComLinkResolvido(oferta = {}, linkResolvido = "", linkOriginal = "") {
  return {
    ...oferta,
    linkAfiliadoOriginal: oferta.linkAfiliado || "",
    linkFinalOriginal: oferta.linkFinal || "",
    linkOriginalAntesLinkOptimus: linkOriginal,
    linkAfiliado: linkResolvido,
    linkFinal: linkResolvido,
    link: linkResolvido,
    urlAfiliada: linkResolvido,
    url: linkResolvido,
    linkOptimusAplicado: true
  };
}

function normalizarModoLinkDestino(valor = "") {
  return String(valor || "").trim().toLowerCase() === "optimus" ? "optimus" : "original";
}

module.exports = {
  normalizarDominioLinkOptimus,
  normalizarFormatoLinkOptimus,
  resolverDominioBaseLinkOptimus,
  montarUrlLinkOptimus,
  origemDominioLinkOptimus,
  montarRespostaConfigLinksOptimus,
  normalizarDominioConfigLinkOptimus,
  extrairLinkAfiliadoOferta,
  copiarOfertaComLinkResolvido,
  normalizarModoLinkDestino
};
