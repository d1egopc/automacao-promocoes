const { queryEngine } = require("../../database");
const { classificarCategoriaOferta } = require("../../../../marketplaces/inteligencia/classificador-categorias");

function categoriaGenericaMercadoLivre(categoria = "") {
  const texto = String(categoria || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  return !texto || texto === "mercadolivre" || texto === "ml" || texto === "marketplace" || texto === "generica" || texto === "geral";
}

function resolverCategoriaMercadoLivre(produto = {}) {
  const categoria = produto.categoria || produto.categoriaProduto || "";
  if (!categoriaGenericaMercadoLivre(categoria)) return categoria;

  return classificarCategoriaOferta({
    titulo: produto.titulo || produto.nome || "",
    nome: produto.nome || produto.titulo || ""
  }, produto.titulo || produto.nome || "");
}

function escolherLinkMercadoLivreDetalhado(links = [], evento = {}) {
  const candidatos = [];

  for (const link of Array.isArray(links) ? links : []) {
    candidatos.push({ url: link.url_expandida, link, campo: "url_expandida" });
    candidatos.push({ url: link.url_normalizada, link, campo: "url_normalizada" });
    candidatos.push({ url: link.url_original, link, campo: "url_original" });
  }

  if (Array.isArray(evento.links_extraidos)) {
    for (const url of evento.links_extraidos) {
      candidatos.push({ url, link: null, campo: "links_extraidos" });
    }
  }

  return candidatos
    .map(candidato => ({
      ...candidato,
      url: String(candidato.url || "").trim()
    }))
    .find(candidato => /mercadolivre\.com|meli\.la/i.test(candidato.url)) || { url: "", link: null, campo: "" };
}

function isMeliLa(url = "") {
  return /(^|\/\/)meli\.la\//i.test(String(url || ""));
}

async function expandirMeliLa(url, contexto = {}) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      }
    });

    const urlFinal = String(response.url || "").trim();
    const ok = response.ok && urlFinal && !isMeliLa(urlFinal) && /mercadolivre\.com/i.test(urlFinal);

    console.log("[ENGINE-ML-REDIRECT]", {
      ...contexto,
      urlOriginal: url,
      urlFinal,
      httpStatus: response.status,
      ok
    });

    if (!ok) {
      return { ok: false, motivo: "meli_redirect_falhou", urlFinal, httpStatus: response.status };
    }

    return { ok: true, urlFinal, httpStatus: response.status };
  } catch (e) {
    console.log("[ENGINE-ML-REDIRECT]", {
      ...contexto,
      urlOriginal: url,
      ok: false,
      motivo: "meli_redirect_falhou",
      erro: e.message
    });
    return { ok: false, motivo: "meli_redirect_falhou", erro: e.message };
  }
}

async function atualizarLinkExpandidoEngine(link = null, urlExpandida = "", contexto = {}) {
  if (!link?.id || !urlExpandida) return;

  const resultado = await queryEngine(
    `UPDATE engine_links
        SET url_expandida = $2,
            dominio_final = $3,
            redirect_ok = TRUE,
            motivo_redirect = NULL,
            metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
      WHERE id = $1`,
    [
      link.id,
      urlExpandida,
      dominioUrl(urlExpandida),
      JSON.stringify({
        expandiuMeliLa: true,
        linkOriginalEngine: link.url_original || link.url_normalizada || "",
        linkExpandidoEngine: urlExpandida
      })
    ]
  );

  if (!resultado.ok) {
    console.log("[ENGINE-ML-REDIRECT]", {
      ...contexto,
      linkId: link.id,
      urlExpandida,
      ok: false,
      motivo: "engine_links_update_falhou",
      erro: resultado.erro || resultado.motivo || ""
    });
  }
}

function dominioUrl(url = "") {
  try {
    return new URL(String(url || "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

async function importarMercadoLivreEngine({ job = {}, evento = {}, links = [], deps = {} } = {}) {
  const clienteId = String(job.cliente_id || "").trim();
  const linkEscolhido = escolherLinkMercadoLivreDetalhado(links, evento);
  const urlOriginalEngine = linkEscolhido.url;

  if (!clienteId) {
    return { ok: false, motivo: "cliente_invalido", marketplace: "mercadolivre" };
  }

  if (!urlOriginalEngine) {
    return { ok: false, motivo: "link_mercadolivre_nao_encontrado", marketplace: "mercadolivre" };
  }

  if (typeof deps.importarMercadoLivre !== "function") {
    return { ok: false, motivo: "importador_ml_indisponivel", marketplace: "mercadolivre" };
  }

  if (typeof deps.getIntegracaoCliente !== "function") {
    return { ok: false, motivo: "get_integracao_indisponivel", marketplace: "mercadolivre" };
  }

  const integracao = deps.getIntegracaoCliente(clienteId, "mercadolivre");
  if (!integracao) {
    return { ok: false, motivo: "integracao_ausente", marketplace: "mercadolivre" };
  }

  let urlImportador = urlOriginalEngine;
  let linkExpandidoEngine = "";
  let expandiuMeliLa = false;

  if (isMeliLa(urlOriginalEngine)) {
    const redirect = await expandirMeliLa(urlOriginalEngine, {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId
    });

    if (!redirect.ok) {
      return {
        ok: false,
        motivo: "meli_redirect_falhou",
        marketplace: "mercadolivre",
        linkOriginal: urlOriginalEngine,
        metadata: {
          linkOriginalEngine: urlOriginalEngine,
          linkExpandidoEngine: redirect.urlFinal || "",
          expandiuMeliLa: false,
          erroRedirect: redirect.erro || "",
          httpStatusRedirect: redirect.httpStatus || null
        }
      };
    }

    expandiuMeliLa = true;
    linkExpandidoEngine = redirect.urlFinal;
    urlImportador = redirect.urlFinal;
    await atualizarLinkExpandidoEngine(linkEscolhido.link, linkExpandidoEngine, {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId
    });
  }

  const produto = await deps.importarMercadoLivre(urlImportador, clienteId, {
    getIntegracaoCliente: deps.getIntegracaoCliente,
    gerarLinkAfiliadoMercadoLivre: deps.gerarLinkAfiliadoMercadoLivre,
    contextoEngine: {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId
    }
  });

  if (!produto) {
    return { ok: false, motivo: "importador_sem_retorno", marketplace: "mercadolivre", linkOriginal: urlOriginalEngine };
  }

  const linkAfiliado = produto.linkAfiliado || produto.linkFinal || produto.link || "";
  if (!linkAfiliado) {
    console.log("[ENGINE-ML-LINK-AFILIADO-VAZIO]", {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      linkOriginalEngine: urlOriginalEngine,
      linkExpandidoEngine,
      urlImportador,
      expandiuMeliLa,
      camposProduto: Object.keys(produto || {})
    });

    return {
      ok: false,
      motivo: "link_afiliado_vazio",
      marketplace: "mercadolivre",
      linkOriginal: urlOriginalEngine,
      linkExpandido: linkExpandidoEngine || urlImportador,
      metadata: {
        linkOriginalEngine: urlOriginalEngine,
        linkExpandidoEngine,
        expandiuMeliLa,
        camposProduto: Object.keys(produto || {}),
        produto
      }
    };
  }

  return {
    ok: true,
    marketplace: "mercadolivre",
    titulo: produto.titulo || produto.nome || "",
    preco: produto.precoAtual || produto.preco || "",
    precoOriginal: produto.precoAntigo || "",
    imagem: produto.imagem || "",
    linkOriginal: produto.linkOriginal || urlOriginalEngine,
    linkExpandido: produto.urlFinal || linkExpandidoEngine || urlImportador,
    linkAfiliado,
    categoria: resolverCategoriaMercadoLivre(produto),
    cupom: produto.cupom || "",
    cupomTipo: produto.tipoCupom || "",
    score: produto.score || null,
    metadata: {
      adapter: "mercadolivre",
      jobId: job.id,
      eventoId: job.evento_id,
      linkOriginalEngine: urlOriginalEngine,
      linkExpandidoEngine,
      expandiuMeliLa,
      camposProduto: Object.keys(produto || {}),
      produto
    }
  };
}

module.exports = {
  importarMercadoLivreEngine
};