"use strict";

const HOST_MAGALU_PRODUTO = new Set([
  "magazineluiza.com.br",
  "www.magazineluiza.com.br",
  "magalu.com",
  "www.magalu.com"
]);

const HOST_MAGAZINE_VOCE = new Set([
  "magazinevoce.com.br",
  "www.magazinevoce.com.br"
]);

const HOST_ONELINK_MAGALU = "magazineluiza.onelink.me";

function resultadoLinkMagalu({
  urlAfiliada = "",
  tipoLink = "desconhecido",
  proveniencia = "",
  comprovado = false,
  avisos = []
} = {}) {
  return {
    urlAfiliada,
    tipoLink,
    proveniencia,
    comprovado: comprovado === true,
    avisos: [...avisos]
  };
}

function limparTexto(valor = "") {
  return String(valor || "").trim();
}

function parseUrl(url = "") {
  try {
    const parsed = new URL(limparTexto(url));
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function normalizarPromoterIdMagalu(promoterId = "") {
  return limparTexto(promoterId)
    .toLowerCase()
    .replace(/^https?:\/\/(?:www\.)?magazinevoce\.com\.br\//i, "")
    .replace(/^\/+|\/+$/g, "")
    .split(/[/?#]/)[0]
    .replace(/[^a-z0-9_-]/g, "");
}

function normalizarSlugLojaMagalu(promoterId = "") {
  const id = normalizarPromoterIdMagalu(promoterId);
  if (!id) return "";
  return id.startsWith("magazine") ? id : `magazine${id}`;
}

function primeiroSegmento(pathname = "") {
  return String(pathname || "")
    .split("/")
    .filter(Boolean)[0] || "";
}

function caminhoPareceProdutoMagalu(pathname = "") {
  const path = String(pathname || "").toLowerCase();
  return /\/p\/[^/]+/.test(path) || /\/produto\/\d+/.test(path);
}

function montarUrlLojaProdutoMagalu(urlProduto, slugLoja = "") {
  const parsed = parseUrl(urlProduto);
  if (!parsed || !slugLoja) return "";

  const destino = new URL(`https://www.magazinevoce.com.br/${slugLoja}${parsed.pathname}`);
  destino.search = parsed.search;
  destino.hash = parsed.hash;
  return destino.toString();
}

function linkPertenceLojaMagalu(url = "", promoterId = "") {
  const parsed = parseUrl(url);
  const slugEsperado = normalizarSlugLojaMagalu(promoterId);

  if (!parsed || !slugEsperado || !HOST_MAGAZINE_VOCE.has(parsed.hostname.toLowerCase())) {
    return false;
  }

  return primeiroSegmento(parsed.pathname).toLowerCase() === slugEsperado;
}

function classificarLinkMagalu(url = "", promoterId = "") {
  const parsed = parseUrl(url);
  const slugEsperado = normalizarSlugLojaMagalu(promoterId);

  if (!parsed) {
    return resultadoLinkMagalu({
      tipoLink: "url_invalida",
      avisos: ["magalu_url_invalida"]
    });
  }

  const host = parsed.hostname.toLowerCase();

  if (HOST_ONELINK_MAGALU === host) {
    return resultadoLinkMagalu({
      tipoLink: "onelink_magalu",
      proveniencia: "host_magazineluiza_onelink",
      avisos: ["magalu_onelink_classificado_sem_prova_de_promoter"]
    });
  }

  if (HOST_MAGAZINE_VOCE.has(host)) {
    if (!slugEsperado) {
      return resultadoLinkMagalu({
        tipoLink: "magazinevoce_sem_promoter",
        proveniencia: "host_magazinevoce",
        avisos: ["magalu_promoter_ausente"]
      });
    }

    if (!linkPertenceLojaMagalu(parsed.toString(), promoterId)) {
      return resultadoLinkMagalu({
        tipoLink: "magazinevoce_outra_loja",
        proveniencia: "host_magazinevoce_slug_divergente",
        avisos: ["magalu_link_loja_divergente"]
      });
    }

    return resultadoLinkMagalu({
      urlAfiliada: parsed.toString(),
      tipoLink: "magazinevoce_loja",
      proveniencia: "url_ja_pertence_a_loja_configurada",
      comprovado: true
    });
  }

  if (HOST_MAGALU_PRODUTO.has(host)) {
    return resultadoLinkMagalu({
      tipoLink: "magazineluiza_original",
      proveniencia: "host_produto_magalu_original",
      avisos: ["magalu_url_original_nao_e_afiliada"]
    });
  }

  return resultadoLinkMagalu({
    tipoLink: "host_nao_suportado",
    avisos: ["magalu_host_nao_suportado"]
  });
}

function gerarLinkAfiliadoMagaluSeguro(urlProduto = "", promoterId = "") {
  const parsed = parseUrl(urlProduto);
  const slugLoja = normalizarSlugLojaMagalu(promoterId);

  if (!parsed) {
    return resultadoLinkMagalu({
      tipoLink: "url_invalida",
      avisos: ["magalu_url_invalida"]
    });
  }

  if (!slugLoja) {
    return resultadoLinkMagalu({
      tipoLink: "promoter_ausente",
      avisos: ["magalu_promoter_ausente"]
    });
  }

  const classificacao = classificarLinkMagalu(parsed.toString(), promoterId);
  if (classificacao.comprovado) return classificacao;

  const host = parsed.hostname.toLowerCase();
  if (HOST_ONELINK_MAGALU === host) {
    return classificacao;
  }

  if (!HOST_MAGALU_PRODUTO.has(host)) {
    return classificacao;
  }

  if (!caminhoPareceProdutoMagalu(parsed.pathname)) {
    return resultadoLinkMagalu({
      tipoLink: "magazineluiza_original_sem_produto",
      proveniencia: "host_produto_magalu_original",
      avisos: ["magalu_url_sem_caminho_de_produto"]
    });
  }

  const urlAfiliada = montarUrlLojaProdutoMagalu(parsed.toString(), slugLoja);
  if (!linkPertenceLojaMagalu(urlAfiliada, promoterId)) {
    return resultadoLinkMagalu({
      tipoLink: "magazinevoce_nao_comprovado",
      proveniencia: "conversao_slug_falhou",
      avisos: ["magalu_link_convertido_sem_prova"]
    });
  }

  return resultadoLinkMagalu({
    urlAfiliada,
    tipoLink: "magazinevoce_loja_produto",
    proveniencia: "conversao_dominio_oficial_para_loja_configurada",
    comprovado: true
  });
}

module.exports = {
  gerarLinkAfiliadoMagaluSeguro,
  classificarLinkMagalu,
  linkPertenceLojaMagalu,
  montarUrlLojaProdutoMagalu,
  normalizarPromoterIdMagalu,
  normalizarSlugLojaMagalu,
  caminhoPareceProdutoMagalu
};
