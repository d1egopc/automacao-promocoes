const SCHEMA_VERSION = "engine-v2-oferta-universal-3a";

function texto(valor = "") {
  return String(valor || "").trim();
}

function numeroOuNull(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function objeto(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function lista(valor = []) {
  return Array.isArray(valor) ? valor.filter(item => item !== null && item !== undefined && item !== "") : [];
}

function descontoComprovado(precoAtual, precoAnterior, descontoEntrada = null) {
  const atual = numeroOuNull(precoAtual);
  const anterior = numeroOuNull(precoAnterior);
  const desconto = numeroOuNull(descontoEntrada);

  if (desconto !== null && desconto >= 0) return desconto;
  if (atual === null || anterior === null || anterior <= 0 || atual <= 0 || anterior <= atual) return null;
  return Math.round(((anterior - atual) / anterior) * 10000) / 100;
}

function resolverProdutoId(oferta = {}, metadata = {}) {
  const produto = objeto(metadata.produto);
  return texto(
    oferta.produtoIdDetectado ||
    oferta.produtoId ||
    oferta.itemId ||
    produto.produtoId ||
    produto.id ||
    produto.itemId ||
    ""
  ) || null;
}

function montarEvidencias({ evento = {}, link = {}, ofertaEntrada = {}, metadata = {} } = {}) {
  const produto = objeto(metadata.produto || ofertaEntrada.metadata?.produto);
  return {
    evento: {
      origem: texto(evento.origem || evento.fonte || "radar") || null,
      origemTipo: texto(evento.origem_tipo || evento.origemTipo) || null,
      grupoId: texto(evento.grupo_id || evento.grupoId) || null,
      grupoNome: texto(evento.grupo_nome || evento.grupoNome) || null
    },
    link: {
      urlOriginal: texto(link.url_original || ofertaEntrada.linkOriginal) || null,
      urlExpandida: texto(link.url_expandida || ofertaEntrada.linkExpandido || ofertaEntrada.urlFinal) || null,
      dominioOriginal: texto(link.dominio_original) || null,
      dominioFinal: texto(link.dominio_final) || null,
      redirectOk: link.redirect_ok === true ? true : link.redirect_ok === false ? false : null
    },
    importador: {
      adapter: texto(metadata.adapter) || null,
      camposProduto: lista(metadata.camposProduto),
      statusHttp: numeroOuNull(ofertaEntrada.statusHttp ?? produto.statusHttp)
    },
    imagem: objeto(metadata.imagemAuditoria),
    inteligencia: objeto(metadata.inteligenciaUniversalV2)
  };
}

function montarOfertaUniversalEngine({
  oferta = {},
  ofertaEntrada = {},
  job = {},
  evento = {},
  link = {},
  metadata = {},
  status = "importada",
  motivo = ""
} = {}) {
  const inteligencia = objeto(metadata.inteligenciaUniversalV2);
  const templateInput = objeto(inteligencia.templateInput);
  const produtoMetadata = objeto(metadata.produto || ofertaEntrada.metadata?.produto);
  const precoAtual = numeroOuNull(oferta.preco);
  const precoAnterior = numeroOuNull(oferta.precoOriginal);
  const descontoPercentual = descontoComprovado(
    precoAtual,
    precoAnterior,
    ofertaEntrada.descontoPercentual || produtoMetadata.descontoPercentual
  );
  const imagemPrincipal = texto(oferta.imagem) || null;
  const imagensCandidatas = lista(produtoMetadata.imagemCandidatos || ofertaEntrada.imagemCandidatos);
  const beneficios = lista([
    ofertaEntrada.beneficioTexto,
    ofertaEntrada.beneficioExtra,
    ofertaEntrada.avisoCupom,
    ...(Array.isArray(templateInput.beneficios) ? templateInput.beneficios : []),
    ...(Array.isArray(produtoMetadata.beneficios) ? produtoMetadata.beneficios : [])
  ].map(texto));
  const agora = new Date().toISOString();
  const linkOriginal = texto(oferta.linkOriginal || link.url_original || ofertaEntrada.linkOriginal);
  const linkCanonico = texto(oferta.linkExpandido || link.url_expandida || link.url_normalizada || ofertaEntrada.linkExpandido || ofertaEntrada.urlFinal);
  const linkAfiliado = texto(oferta.linkAfiliado);

  return {
    ofertaId: oferta.id || job.oferta_id || null,
    schemaVersion: SCHEMA_VERSION,
    eventoId: job.evento_id || evento.id || null,
    jobId: job.id || null,
    workspaceId: texto(job.workspaceId || job.cliente_id || job.clienteId) || null,
    origem: texto(oferta.origem || "engine_importer") || null,
    marketplace: texto(oferta.marketplace || job.marketplace || job.marketplace_detectado) || null,
    produto: {
      idExterno: resolverProdutoId(oferta, { ...metadata, produto: produtoMetadata }),
      titulo: texto(oferta.titulo) || null,
      marca: texto(ofertaEntrada.marca || produtoMetadata.marca) || null,
      categoriaOrigem: texto(ofertaEntrada.categoria || ofertaEntrada.categoriaProduto || produtoMetadata.categoria) || null,
      categoriaNormalizada: texto(oferta.categoria || inteligencia.categoria) || null,
      urlOriginal: linkOriginal || null,
      urlCanonica: linkCanonico || linkOriginal || null
    },
    comercial: {
      precoAtual,
      precoAnterior,
      descontoPercentual,
      moeda: texto(oferta.moeda || "BRL") || "BRL",
      parcelamento: texto(ofertaEntrada.parcelamento || templateInput.parcelamento) || null,
      frete: texto(ofertaEntrada.frete || ofertaEntrada.freteValor || produtoMetadata.frete || produtoMetadata.freteValor) || null,
      cupom: texto(oferta.cupom) || null,
      beneficios
    },
    midia: {
      imagemPrincipal,
      imagens: imagemPrincipal ? [imagemPrincipal, ...imagensCandidatas.filter(url => url !== imagemPrincipal)] : imagensCandidatas,
      origemImagem: texto(oferta.imagemOrigem || metadata.imagemOrigem) || null
    },
    afiliacao: {
      urlBase: linkCanonico || linkOriginal || null,
      urlAfiliada: linkAfiliado || null,
      statusConversao: linkAfiliado ? "convertida" : "ausente"
    },
    inteligencia: {
      score: numeroOuNull(inteligencia.score ?? oferta.score),
      classificacao: texto(inteligencia.status || status) || null,
      prioridade: numeroOuNull(inteligencia.prioridade ?? oferta.prioridade),
      motivos: lista([
        motivo,
        inteligencia.motivoDecisao,
        inteligencia.motivo,
        inteligencia.motivoMemoria,
        ...(Array.isArray(inteligencia.logs) ? inteligencia.logs.map(item => item?.motivo || item?.mensagem || "") : [])
      ].map(texto)),
      avisos: lista([
        ...(Array.isArray(inteligencia.logs) ? inteligencia.logs.filter(item => item?.status === "alerta").map(item => item.motivo || item.mensagem || "") : []),
        ...(metadata.imagemAusenteMotivo ? [metadata.imagemAusenteMotivo] : [])
      ].map(texto))
    },
    evidencias: montarEvidencias({ evento, link, ofertaEntrada, metadata }),
    status: texto(status) || "importada",
    criadoEm: evento.capturado_em ? new Date(evento.capturado_em).toISOString() : agora,
    atualizadoEm: agora
  };
}

function validarContratoOfertaUniversal(ofertaUniversal = {}) {
  const motivos = [];
  if (!ofertaUniversal.eventoId) motivos.push("evento_id_ausente");
  if (!ofertaUniversal.jobId) motivos.push("job_id_ausente");
  if (!ofertaUniversal.workspaceId) motivos.push("workspace_id_ausente");
  if (!ofertaUniversal.marketplace) motivos.push("marketplace_ausente");
  if (!ofertaUniversal.produto?.titulo) motivos.push("titulo_ausente");
  if (!ofertaUniversal.comercial || ofertaUniversal.comercial.precoAtual === null) motivos.push("preco_ausente");
  if (!ofertaUniversal.afiliacao?.urlAfiliada) motivos.push("link_afiliado_ausente");

  return {
    ok: motivos.length === 0,
    status: motivos.length ? "rejeitada" : "validada",
    motivos
  };
}

function congelarOfertaUniversal(valor) {
  return JSON.parse(JSON.stringify(valor || {}));
}

function resumoOfertaUniversalLog(ofertaUniversal = {}, validacao = {}) {
  return {
    schemaVersion: ofertaUniversal.schemaVersion || "",
    eventoId: ofertaUniversal.eventoId || null,
    jobId: ofertaUniversal.jobId || null,
    ofertaId: ofertaUniversal.ofertaId || null,
    workspaceId: ofertaUniversal.workspaceId || "",
    marketplace: ofertaUniversal.marketplace || "",
    status: ofertaUniversal.status || "",
    validacao: validacao.status || "",
    motivos: Array.isArray(validacao.motivos) ? validacao.motivos : [],
    temPreco: ofertaUniversal.comercial?.precoAtual !== null && ofertaUniversal.comercial?.precoAtual !== undefined,
    temImagem: Boolean(ofertaUniversal.midia?.imagemPrincipal),
    temCupom: Boolean(ofertaUniversal.comercial?.cupom),
    afiliacao: ofertaUniversal.afiliacao?.statusConversao || ""
  };
}

module.exports = {
  SCHEMA_VERSION,
  montarOfertaUniversalEngine,
  validarContratoOfertaUniversal,
  congelarOfertaUniversal,
  resumoOfertaUniversalLog
};
