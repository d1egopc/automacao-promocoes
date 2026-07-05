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

const ADAPTERS = {
  mercadolivre: importarMercadoLivreEngine,
  amazon: importarAmazonEngine,
  shopee: importarShopeeEngine,
  aliexpress: importarAliExpressEngine,
  awin: importarAwinEngine
};

function marketplaceJob(job = {}) {
  return String(job.marketplace || job.marketplace_detectado || "").trim().toLowerCase();
}

function motivoAdicionar(resumo, motivo = "erro_importacao") {
  const chave = motivo || "erro_importacao";
  resumo.motivos[chave] = (resumo.motivos[chave] || 0) + 1;
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

  const lock = await tentarMarcarImportando(job.id);
  if (!lock.ok) {
    if (lock.ignorado) return { ok: false, ignorado: true, motivo: "job_nao_pronto" };
    logEngineImporterErro({ jobId: job.id, etapa: "marcar_importando", motivo: lock.motivo || "lock_falhou", erro: lock.erro || "" });
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
    return finalizarErro(job, "evento_nao_encontrado", { eventoId: job.evento_id }, resumo);
  }

  const linksResultado = await carregarLinksEvento(job.evento_id);
  await registrarEtapaImportacao(job.id, "carregar_links", linksResultado.ok ? "ok" : "erro", linksResultado.ok ? "links_carregados" : "links_nao_carregados", {
    totalLinks: linksResultado.links.length,
    erro: linksResultado.erro || ""
  });

  if (!linksResultado.ok) {
    return finalizarErro(job, "links_nao_carregados", { eventoId: job.evento_id }, resumo);
  }

  const adapter = ADAPTERS[marketplace];
  await registrarEtapaImportacao(job.id, "adapter_resolvido", adapter ? "ok" : "erro", adapter ? "adapter_resolvido" : "adapter_nao_implementado", { marketplace });
  logEngineImporterAdapter({ jobId: job.id, marketplace, adapterOk: Boolean(adapter) });

  if (!adapter) {
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
    return finalizarErro(job, "erro_importador", { erro: e.message }, resumo);
  }

  await registrarEtapaImportacao(job.id, "importador_executado", resultadoAdapter?.ok ? "ok" : "erro", resultadoAdapter?.ok ? "importador_ok" : (resultadoAdapter?.motivo || "erro_importacao"), {
    marketplace,
    motivo: resultadoAdapter?.motivo || ""
  });

  if (!resultadoAdapter?.ok) {
    return finalizarErro(job, resultadoAdapter?.motivo || "erro_importacao", { marketplace }, resumo);
  }

  await registrarEtapaImportacao(job.id, "oferta_normalizada", "ok", "oferta_normalizada", {
    titulo: resultadoAdapter.titulo || "",
    temPreco: Boolean(resultadoAdapter.preco),
    temImagem: Boolean(resultadoAdapter.imagem),
    temLinkAfiliado: Boolean(resultadoAdapter.linkAfiliado)
  });

  const linkPrincipal = linksResultado.links.find(link => String(link.marketplace_detectado || "").toLowerCase() === marketplace) || linksResultado.links[0] || null;
  const gravacao = await gravarOfertaEngine(job, eventoResultado.evento, linkPrincipal, resultadoAdapter);
  await registrarEtapaImportacao(job.id, "oferta_gravada", gravacao.ok ? "ok" : "erro", gravacao.ok ? "oferta_gravada" : (gravacao.motivo || "oferta_gravacao_falhou"), {
    ofertaId: gravacao.ofertaId || null,
    erro: gravacao.erro || ""
  });

  if (!gravacao.ok) {
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

    if (resumo) resumo.retidasV2 = (resumo.retidasV2 || 0) + 1;
    return { ok: true, retidaV2: true, ofertaId: gravacao.ofertaId, motivo: motivoV2 };
  }

  await marcarJobOfertaCriada(job.id, gravacao.ofertaId);
  await registrarEtapaImportacao(job.id, "importacao_finalizada", "ok", "oferta_criada", {
    ofertaId: gravacao.ofertaId,
    marketplace
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
