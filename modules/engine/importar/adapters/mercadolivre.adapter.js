function escolherLinkMercadoLivre(links = [], evento = {}) {
  const candidatos = [];

  for (const link of Array.isArray(links) ? links : []) {
    candidatos.push(link.url_expandida, link.url_normalizada, link.url_original);
  }

  if (Array.isArray(evento.links_extraidos)) {
    candidatos.push(...evento.links_extraidos);
  }

  return candidatos
    .map(link => String(link || "").trim())
    .find(link => /mercadolivre\.com|meli\.la/i.test(link)) || "";
}

async function importarMercadoLivreEngine({ job = {}, evento = {}, links = [], deps = {} } = {}) {
  const clienteId = String(job.cliente_id || "").trim();
  const url = escolherLinkMercadoLivre(links, evento);

  if (!clienteId) {
    return { ok: false, motivo: "cliente_invalido", marketplace: "mercadolivre" };
  }

  if (!url) {
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

  const produto = await deps.importarMercadoLivre(url, clienteId, {
    getIntegracaoCliente: deps.getIntegracaoCliente,
    gerarLinkAfiliadoMercadoLivre: deps.gerarLinkAfiliadoMercadoLivre,
    contextoEngine: {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId
    }
  });

  if (!produto) {
    return { ok: false, motivo: "importador_sem_retorno", marketplace: "mercadolivre", linkOriginal: url };
  }

  return {
    ok: true,
    marketplace: "mercadolivre",
    titulo: produto.titulo || produto.nome || "",
    preco: produto.precoAtual || produto.preco || "",
    precoOriginal: produto.precoAntigo || "",
    imagem: produto.imagem || "",
    linkOriginal: produto.linkOriginal || url,
    linkExpandido: produto.urlFinal || "",
    linkAfiliado: produto.linkAfiliado || produto.linkFinal || produto.link || "",
    categoria: produto.categoria || "Mercado Livre",
    cupom: produto.cupom || "",
    cupomTipo: produto.tipoCupom || "",
    score: produto.score || null,
    metadata: {
      adapter: "mercadolivre",
      jobId: job.id,
      eventoId: job.evento_id,
      camposProduto: Object.keys(produto || {}),
      produto
    }
  };
}

module.exports = {
  importarMercadoLivreEngine
};