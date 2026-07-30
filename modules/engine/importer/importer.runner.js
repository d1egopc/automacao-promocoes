const {
  buscarJobsProntos,
  tentarMarcarImportando,
  registrarEtapaImportacao,
  carregarEventoBruto,
  carregarLinksEvento,
  gravarOfertaEngine,
  marcarJobOfertaCriada,
  marcarJobRetidaV2,
  marcarJobErroImportacao
} = require("./importer.service");
const { limitarJobs } = require("../processor.service");
const {
  logEngineImporterInicio,
  logEngineImporterJob,
  logEngineImporterAdapter,
  logEngineImporterErro,
  logEngineImporterFim
} = require("../logger");
const { importarMercadoLivreEngine } = require("./adapters/mercadolivre.adapter");
const { importarAmazonEngine } = require("./adapters/amazon.adapter");
const { importarShopeeEngine } = require("./adapters/shopee.adapter");
const { importarAliExpressEngine } = require("./adapters/aliexpress.adapter");
const { importarAwinEngine } = require("./adapters/awin.adapter");
const { escolherProdutoPrincipal } = require("../link-role.service");
const {
  usuarioAtivo,
  logUsuarioInativoIgnorado
} = require("../../../utils/usuarios-atividade");
const coberturaRadar = require("../../radar/cobertura-v1");

const ADAPTERS = {
  mercadolivre: importarMercadoLivreEngine,
  amazon: importarAmazonEngine,
  shopee: importarShopeeEngine,
  aliexpress: importarAliExpressEngine,
  awin: importarAwinEngine,
  kabum: importarAwinEngine
};

function marketplaceJob(job = {}) {
  return String(job.marketplace || job.marketplace_detectado || "").trim().toLowerCase();
}

function motivoAdicionar(resumo, motivo = "erro_importacao") {
  const chave = motivo || "erro_importacao";
  resumo.motivos[chave] = (resumo.motivos[chave] || 0) + 1;
}

function metadataJob(job = {}) {
  return job.metadata && typeof job.metadata === "object" ? job.metadata : {};
}

function contextoCoberturaImporter(job = {}, extras = {}) {
  const metadata = metadataJob(job);
  const metadataEvento = metadata.metadataEvento && typeof metadata.metadataEvento === "object"
    ? metadata.metadataEvento
    : {};
  const links = Array.isArray(extras.links)
    ? extras.links.map(item => item.url_original || item.url_expandida || item.url || item).filter(Boolean)
    : [];
  return {
    coberturaTraceId: metadata.coberturaTraceId || metadataEvento.coberturaTraceId || "",
    fidelidadeTraceId: metadata.fidelidadeTraceId || metadataEvento.fidelidadeTraceId || "",
    clienteId: job.cliente_id || "",
    marketplace: marketplaceJob(job),
    eventoEngineId: job.evento_id || "",
    jobId: job.id || "",
    ofertaId: extras.ofertaId || job.oferta_id || "",
    links,
    link: links[0] || ""
  };
}

function escolherLinkPrincipalOferta(links = [], evento = {}, marketplace = "") {
  if (["shopee", "aliexpress", "awin", "kabum"].includes(marketplace)) {
    const candidatos = [];
    for (const link of Array.isArray(links) ? links : []) {
      candidatos.push({ url: link.url_expandida, link, campo: "url_expandida" });
      candidatos.push({ url: link.url_normalizada, link, campo: "url_normalizada" });
      candidatos.push({ url: link.url_original, link, campo: "url_original" });
    }
    const produto = escolherProdutoPrincipal(candidatos, marketplace, evento);
    if (produto.link) return produto.link;
  }

  return (Array.isArray(links) ? links : []).find(link => String(link.marketplace_detectado || "").toLowerCase() === marketplace) ||
    (Array.isArray(links) ? links[0] : null) ||
    null;
}

async function finalizarErro(job, motivo, detalhes = {}, resumo) {
  await marcarJobErroImportacao(job.id, motivo, detalhes);
  if (resumo) {
    resumo.erros += 1;
    motivoAdicionar(resumo, motivo);
  }
  return { ok: false, motivo };
}

async function importarJobPronto(job = {}, contexto = {}, resumo = null) {
  const marketplace = marketplaceJob(job);
  logEngineImporterJob({ jobId: job.id, eventoId: job.evento_id, clienteId: job.cliente_id, marketplace });
  coberturaRadar.registrar("engine_importer_inicio", {
    ...contextoCoberturaImporter(job),
    decisao: "iniciado"
  });

  if (!usuarioAtivo(job.cliente_id)) {
    logUsuarioInativoIgnorado({ clienteId: job.cliente_id, fluxo: "engine_importer_job" });
    coberturaRadar.registrar("engine_importer_rejeitado", {
      ...contextoCoberturaImporter(job),
      decisao: "rejeitado",
      motivo: "usuario_inativo"
    });
    return finalizarErro(job, "usuario_inativo", { clienteId: job.cliente_id }, resumo);
  }

  const lock = await tentarMarcarImportando(job.id);
  if (!lock.ok) {
    if (lock.ignorado) {
      coberturaRadar.registrar("engine_job_nao_pronto", {
        ...contextoCoberturaImporter(job),
        decisao: "ignorado",
        motivo: "job_nao_pronto"
      });
      return { ok: false, ignorado: true, motivo: "job_nao_pronto" };
    }
    logEngineImporterErro({ jobId: job.id, etapa: "marcar_importando", motivo: lock.motivo || "lock_falhou", erro: lock.erro || "" });
    coberturaRadar.registrar("engine_importer_erro", {
      ...contextoCoberturaImporter(job),
      decisao: "erro",
      motivo: lock.motivo || "lock_falhou",
      erro: lock.erro || ""
    });
    return finalizarErro(job, lock.motivo || "lock_falhou", { erro: lock.erro || "" }, resumo);
  }

  await registrarEtapaImportacao(job.id, "inicio_importacao", "ok", "importacao_iniciada", {
    clienteId: job.cliente_id,
    marketplace
  });

  const eventoResultado = await carregarEventoBruto(job.evento_id);
  await registrarEtapaImportacao(job.id, "carregar_evento", eventoResultado.evento ? "ok" : "erro", eventoResultado.evento ? "evento_carregado" : "evento_nao_encontrado", {
    eventoId: job.evento_id,
    erro: eventoResultado.erro || ""
  });

  if (!eventoResultado.ok || !eventoResultado.evento) {
    coberturaRadar.registrar("engine_importer_erro", {
      ...contextoCoberturaImporter(job),
      decisao: "erro",
      motivo: "evento_nao_encontrado"
    });
    return finalizarErro(job, "evento_nao_encontrado", { eventoId: job.evento_id }, resumo);
  }

  const linksResultado = await carregarLinksEvento(job.evento_id);
  await registrarEtapaImportacao(job.id, "carregar_links", linksResultado.ok ? "ok" : "erro", linksResultado.ok ? "links_carregados" : "links_nao_carregados", {
    totalLinks: linksResultado.links.length,
    erro: linksResultado.erro || ""
  });

  if (!linksResultado.ok) {
    coberturaRadar.registrar("engine_importer_erro", {
      ...contextoCoberturaImporter(job),
      decisao: "erro",
      motivo: "links_nao_carregados"
    });
    return finalizarErro(job, "links_nao_carregados", { eventoId: job.evento_id }, resumo);
  }

  const adapter = ADAPTERS[marketplace];
  await registrarEtapaImportacao(job.id, "adapter_resolvido", adapter ? "ok" : "erro", adapter ? "adapter_resolvido" : "adapter_nao_implementado", { marketplace });
  logEngineImporterAdapter({ jobId: job.id, marketplace, adapterOk: Boolean(adapter) });

  if (!adapter) {
    coberturaRadar.registrar("engine_importer_rejeitado", {
      ...contextoCoberturaImporter(job, { links: linksResultado.links }),
      decisao: "rejeitado",
      motivo: "adapter_nao_implementado"
    });
    return finalizarErro(job, "adapter_nao_implementado", { marketplace }, resumo);
  }

  let resultadoAdapter;
  try {
    resultadoAdapter = await adapter({
      job,
      evento: eventoResultado.evento,
      links: linksResultado.links,
      deps: contexto.deps || {}
    });
  } catch (e) {
    logEngineImporterErro({ jobId: job.id, etapa: "importador_executado", motivo: "erro_importador", erro: e.message });
    await registrarEtapaImportacao(job.id, "importador_executado", "erro", "erro_importador", { erro: e.message });
    coberturaRadar.registrar("engine_importer_erro", {
      ...contextoCoberturaImporter(job, { links: linksResultado.links }),
      decisao: "erro",
      motivo: "erro_importador",
      erro: e.message
    });
    return finalizarErro(job, "erro_importador", { erro: e.message }, resumo);
  }

  await registrarEtapaImportacao(job.id, "importador_executado", resultadoAdapter?.ok ? "ok" : "erro", resultadoAdapter?.ok ? "importador_ok" : (resultadoAdapter?.motivo || "erro_importacao"), {
    marketplace,
    motivo: resultadoAdapter?.motivo || ""
  });

  if (!resultadoAdapter?.ok) {
    coberturaRadar.registrar("engine_importer_rejeitado", {
      ...contextoCoberturaImporter(job, { links: linksResultado.links }),
      decisao: "rejeitado",
      motivo: resultadoAdapter?.motivo || "erro_importacao"
    });
    return finalizarErro(job, resultadoAdapter?.motivo || "erro_importacao", { marketplace }, resumo);
  }

  console.log("[ENGINE-V2-IMPORTACAO-CONCLUIDA]", JSON.stringify({
    jobId: job.id || null,
    eventoId: job.evento_id || null,
    workspaceId: job.cliente_id || "",
    marketplace,
    temTitulo: Boolean(resultadoAdapter.titulo || resultadoAdapter.nome),
    temPreco: Boolean(resultadoAdapter.preco || resultadoAdapter.precoAtual),
    temImagem: Boolean(resultadoAdapter.imagem || resultadoAdapter.image || resultadoAdapter.imagemUrl || resultadoAdapter.thumbnail),
    temLinkAfiliado: Boolean(resultadoAdapter.linkAfiliado || resultadoAdapter.linkFinal || resultadoAdapter.link),
    cupomStatus: resultadoAdapter.cupom ? "confirmado" : (resultadoAdapter.avisoCupom ? "provavel" : "ausente")
  }));

  await registrarEtapaImportacao(job.id, "oferta_normalizada", "ok", "oferta_normalizada", {
    titulo: resultadoAdapter.titulo || "",
    temPreco: Boolean(resultadoAdapter.preco),
    temImagem: Boolean(resultadoAdapter.imagem),
    temLinkAfiliado: Boolean(resultadoAdapter.linkAfiliado)
  });

  const linkPrincipal = escolherLinkPrincipalOferta(linksResultado.links, eventoResultado.evento, marketplace);
  const gravacao = await gravarOfertaEngine(job, eventoResultado.evento, linkPrincipal, resultadoAdapter);
  await registrarEtapaImportacao(job.id, "oferta_gravada", gravacao.ok ? "ok" : "erro", gravacao.ok ? "oferta_gravada" : (gravacao.motivo || "oferta_gravacao_falhou"), {
    ofertaId: gravacao.ofertaId || null,
    erro: gravacao.erro || ""
  });

  if (!gravacao.ok) {
    coberturaRadar.registrar("engine_importer_erro", {
      ...contextoCoberturaImporter(job, { links: linksResultado.links }),
      decisao: "erro",
      motivo: gravacao.motivo || "oferta_gravacao_falhou",
      erro: gravacao.erro || ""
    });
    return finalizarErro(job, gravacao.motivo || "oferta_gravacao_falhou", { erro: gravacao.erro || "" }, resumo);
  }

  if (gravacao.retidaV2) {
    const motivoV2 = gravacao.motivoV2 || "retida_v2";
    const jobRetido = await marcarJobRetidaV2(job.id, gravacao.ofertaId, motivoV2);
    if (!jobRetido.ok) {
      return finalizarErro(job, "falha_marcar_retida_v2", {
        ofertaId: gravacao.ofertaId,
        motivoV2,
        erro: jobRetido.erro || ""
      }, resumo);
    }
    await registrarEtapaImportacao(job.id, "importacao_finalizada", "retida", motivoV2, {
      ofertaId: gravacao.ofertaId,
      marketplace,
      statusV2: gravacao.statusV2 || "retida"
    });

    coberturaRadar.registrar("engine_importer_rejeitado", {
      ...contextoCoberturaImporter(job, { links: linksResultado.links, ofertaId: gravacao.ofertaId }),
      decisao: "retido",
      motivo: motivoV2,
      ofertaId: gravacao.ofertaId
    });
    if (resumo) resumo.retidasV2 = (resumo.retidasV2 || 0) + 1;
    return { ok: true, retidaV2: true, ofertaId: gravacao.ofertaId, motivo: motivoV2 };
  }

  await marcarJobOfertaCriada(job.id, gravacao.ofertaId);
  await registrarEtapaImportacao(job.id, "importacao_finalizada", "ok", "oferta_criada", {
    ofertaId: gravacao.ofertaId,
    marketplace
  });

  coberturaRadar.registrar("engine_importer_ok", {
    ...contextoCoberturaImporter(job, { links: linksResultado.links, ofertaId: gravacao.ofertaId }),
    decisao: "aceito",
    motivo: "oferta_criada",
    ofertaId: gravacao.ofertaId
  });
  if (resumo) resumo.ofertaCriada += 1;
  return { ok: true, ofertaId: gravacao.ofertaId };
}

async function importarJobsProntosEngine({ limite = 10, marketplace = "", deps = {} } = {}) {
  const limiteFinal = limitarJobs(limite);
  const resumo = {
    ok: true,
    processados: 0,
    ofertaCriada: 0,
    retidasV2: 0,
    erros: 0,
    motivos: {}
  };

  logEngineImporterInicio({ limite: limiteFinal, marketplace: marketplace || "" });

  const jobs = await buscarJobsProntos({ limite: limiteFinal, marketplace });
  if (!jobs.ok) {
    logEngineImporterErro({ etapa: "buscar_jobs_prontos", motivo: jobs.motivo || "buscar_jobs_falhou", erro: jobs.erro || "" });
    return {
      ...resumo,
      ok: false,
      motivo: jobs.motivo || "buscar_jobs_falhou",
      erro: jobs.erro || ""
    };
  }

  for (const job of jobs.jobs) {
    resumo.processados += 1;
    try {
      const resultado = await importarJobPronto(job, { deps }, resumo);
      if (resultado.ignorado) resumo.processados -= 1;
    } catch (e) {
      resumo.erros += 1;
      motivoAdicionar(resumo, "erro_importacao");
      logEngineImporterErro({ jobId: job.id, etapa: "importar_job", motivo: "erro_importacao", erro: e.message });
      await marcarJobErroImportacao(job.id, "erro_importacao", { erro: e.message });
    }
  }

  logEngineImporterFim(resumo);
  return resumo;
}

module.exports = {
  importarJobsProntosEngine,
  importarJobPronto
};
