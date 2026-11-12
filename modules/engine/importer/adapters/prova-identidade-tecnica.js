function texto(valor = "") {
  return String(valor ?? "").trim();
}

function montarProvaTituloTecnico({
  marketplace = "",
  job = {},
  workspaceId = "",
  links = [],
  linkEscolhido = {},
  urlOriginal = "",
  urlCanonica = "",
  produtoId = "",
  titulo = "",
  fonteTitulo = ""
} = {}) {
  const link = linkEscolhido?.link || null;
  const indice = Array.isArray(links) && link ? links.indexOf(link) : -1;
  const ordem = Number(link?.ordem_captura || link?.ordemCaptura || link?.ordem || (indice >= 0 ? indice + 1 : 0)) || 0;
  const linkId = texto(link?.ocorrenciaId || link?.idOcorrencia || link?.ocorrencia_id ||
    link?.id || link?.link_id || "");
  const anchor = texto(link?.url_original || link?.urlOriginal || link?.url_normalizada ||
    link?.urlNormalizada || link?.url_expandida || link?.urlExpandida || urlOriginal);
  const canonical = texto(urlCanonica);
  const id = texto(produtoId);
  const title = texto(titulo);
  const source = texto(fonteTitulo);

  if (!link || (!linkId && !ordem) || !anchor || !canonical || !id || !title || !source || !job?.id || !job?.evento_id || !workspaceId) {
    return null;
  }

  return {
    versao: 1,
    marketplace: texto(marketplace).toLowerCase(),
    jobId: String(job.id),
    eventoId: String(job.evento_id),
    workspaceId: String(workspaceId),
    ocorrenciaLink: {
      ...(linkId ? { id: linkId } : {}),
      ordem,
      campo: texto(linkEscolhido?.campo || ""),
      urlOriginal: anchor
    },
    produto: { produtoIdCanonico: id, urlCanonica: canonical },
    titulo: { valor: title, fonte: source }
  };
}

function vincularOcorrenciaProduto({ job = {}, evento = {}, link = {}, marketplace, urlOriginal } = {}) {
  const workspaceId = texto(job.cliente_id || job.clienteId);
  const eventoId = texto(job.evento_id);
  const jobId = texto(job.id);
  const ocorrenciaId = texto(link.id || link.ocorrenciaId);
  if (!workspaceId || !jobId || !eventoId || eventoId !== texto(evento.id) || !ocorrenciaId ||
      !marketplace || !urlOriginal || urlOriginal !== texto(link.url_original || link.urlOriginal)) return null;
  return { workspaceId, eventoId, jobId, ocorrenciaId, marketplace, urlOriginal };
}

module.exports = { montarProvaTituloTecnico, vincularOcorrenciaProduto };
