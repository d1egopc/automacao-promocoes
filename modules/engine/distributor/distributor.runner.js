const {
  limitarDistribuicao,
  buscarOfertasDistribuiveis,
  tentarMarcarDistribuindo,
  marcarOfertaStatus,
  registrarEtapaDistribuicao,
  validarOfertaParaDistribuicao,
  adicionarOfertaNaFilaCliente
} = require("./distributor.service");
const {
  logEngineDistribuidorInicio,
  logEngineDistribuidorOferta,
  logEngineDistribuidorFila,
  logEngineDistribuidorRetida,
  logEngineDistribuidorErro,
  logEngineDistribuidorFim
} = require("../logger");
const coberturaRadar = require("../../radar/cobertura-v1");
const {
  registrarDistribuicaoFinal,
  registrarFilaClienteAdicionada
} = require("../ofc/commercial-events.service");

function motivoAdicionar(resumo, motivo = "erro_distribuicao") {
  const chave = motivo || "erro_distribuicao";
  resumo.motivos[chave] = (resumo.motivos[chave] || 0) + 1;
}

function metadataObjeto(valor = {}) {
  return valor && typeof valor === "object" ? valor : {};
}

function contextoCoberturaDistributor(oferta = {}, extras = {}) {
  const metadata = metadataObjeto(oferta.metadata);
  const jobMetadata = metadataObjeto(oferta.job_metadata);
  const eventoMetadata = metadataObjeto(oferta.evento_metadata);
  const links = [
    oferta.link_original,
    oferta.link_expandido,
    oferta.link_afiliado
  ].filter(Boolean);
  const destino = extras.destino || {};
  return {
    coberturaTraceId: metadata.coberturaTraceId || jobMetadata.coberturaTraceId || jobMetadata.metadataEvento?.coberturaTraceId || eventoMetadata.coberturaTraceId || "",
    fidelidadeTraceId: metadata.fidelidadeTraceId || jobMetadata.fidelidadeTraceId || jobMetadata.metadataEvento?.fidelidadeTraceId || eventoMetadata.fidelidadeTraceId || "",
    clienteId: oferta.cliente_id || "",
    marketplace: oferta.marketplace || "",
    links,
    link: oferta.link_original || oferta.link_expandido || oferta.link_afiliado || "",
    eventoEngineId: oferta.evento_id || "",
    jobId: oferta.job_id || "",
    ofertaId: oferta.id || "",
    destinoId: destino.id || destino.destinoId || destino.nome || "",
    destinoEncontrado: extras.destinoEncontrado === true,
    filaRecebeu: extras.filaRecebeu === true
  };
}

async function reterOferta(oferta, motivo, detalhes = {}, resumo = null) {
  await registrarEtapaDistribuicao(oferta.job_id, "distribuicao_final", "retida", motivo, detalhes);
  await marcarOfertaStatus(oferta.id, "retida", motivo, { jobId: oferta.job_id, clienteId: oferta.cliente_id });
  logEngineDistribuidorRetida({ ofertaId: oferta.id, jobId: oferta.job_id, clienteId: oferta.cliente_id, categoriaOferta: detalhes.categoriaOferta || oferta.categoria || "", categoriasDestino: detalhes.categoriasDestino || [], motivo });

  if (resumo) {
    resumo.retidas += 1;
    motivoAdicionar(resumo, motivo);
  }

  return { ok: false, retida: true, motivo };
}

async function erroOferta(oferta, motivo, detalhes = {}, resumo = null) {
  await registrarEtapaDistribuicao(oferta.job_id, "distribuicao_final", "erro", motivo, detalhes);
  await marcarOfertaStatus(oferta.id, "erro_distribuicao", motivo, { jobId: oferta.job_id, clienteId: oferta.cliente_id });
  logEngineDistribuidorErro({ ofertaId: oferta.id, jobId: oferta.job_id, clienteId: oferta.cliente_id, motivo, erro: detalhes.erro || "" });

  if (resumo) {
    resumo.erros += 1;
    motivoAdicionar(resumo, motivo);
  }

  return { ok: false, motivo };
}

async function distribuirOfertaEngine(oferta = {}, contexto = {}, resumo = null) {
  logEngineDistribuidorOferta({ ofertaId: oferta.id, jobId: oferta.job_id, clienteId: oferta.cliente_id, marketplace: oferta.marketplace });
  coberturaRadar.registrar("engine_distributor_inicio", {
    ...contextoCoberturaDistributor(oferta),
    decisao: "iniciado"
  });

  const lock = await tentarMarcarDistribuindo(oferta.id, { jobId: oferta.job_id, clienteId: oferta.cliente_id });
  if (!lock.ok) {
    if (lock.ignorado) {
      coberturaRadar.registrar("engine_distributor_nao_distribuivel", {
        ...contextoCoberturaDistributor(oferta),
        decisao: "ignorado",
        motivo: "oferta_nao_distribuivel",
        filaRecebeu: false
      });
      return { ok: false, ignorado: true, motivo: "oferta_nao_distribuivel" };
    }
    coberturaRadar.registrar("engine_distributor_erro", {
      ...contextoCoberturaDistributor(oferta),
      decisao: "erro",
      motivo: lock.motivo || "erro_distribuicao",
      erro: lock.erro || "",
      filaRecebeu: false
    });
    return erroOferta(oferta, lock.motivo || "erro_distribuicao", { erro: lock.erro || "" }, resumo);
  }

  await registrarEtapaDistribuicao(oferta.job_id, "inicio_distribuicao", "ok", "distribuicao_iniciada", {
    ofertaId: oferta.id,
    clienteId: oferta.cliente_id,
    marketplace: oferta.marketplace
  });

  const validacao = await validarOfertaParaDistribuicao(oferta, contexto);
  await registrarEtapaDistribuicao(oferta.job_id, "validar_oferta", validacao.ok ? "ok" : "retida", validacao.ok ? "oferta_validada" : validacao.motivo, validacao);

  if (!validacao.ok) {
    coberturaRadar.registrar("engine_distributor_retida", {
      ...contextoCoberturaDistributor(oferta, {
        destinoEncontrado: false,
        filaRecebeu: false
      }),
      decisao: "retido",
      motivo: validacao.motivo || "validacao_distribuicao_rejeitada"
    });
    return reterOferta(oferta, validacao.motivo, validacao.detalhes || {}, resumo);
  }

  const fila = await adicionarOfertaNaFilaCliente(oferta, contexto);
  await registrarEtapaDistribuicao(oferta.job_id, "adicionar_fila", fila.ok ? "ok" : "retida", fila.ok ? "adicionada_fila" : fila.motivo, {
    clienteId: oferta.cliente_id,
    itemId: fila.itemFila?.id || null
  });

  if (!fila.ok) {
    if (fila.motivo === "duplicidade_fila") {
      coberturaRadar.registrar("engine_distributor_retida", {
        ...contextoCoberturaDistributor(oferta, {
          destinoEncontrado: true,
          filaRecebeu: false
        }),
        decisao: "retido",
        motivo: "duplicidade_fila"
      });
      return reterOferta(oferta, "duplicidade_fila", {}, resumo);
    }

    coberturaRadar.registrar("engine_distributor_erro", {
      ...contextoCoberturaDistributor(oferta, {
        destinoEncontrado: true,
        filaRecebeu: false
      }),
      decisao: "erro",
      motivo: fila.motivo || "erro_fila"
    });
    return erroOferta(oferta, fila.motivo || "erro_fila", {}, resumo);
  }

  void registrarFilaClienteAdicionada({
    oferta,
    itemFila: fila.itemFila
  });
  await marcarOfertaStatus(oferta.id, "fila", "adicionada_fila", { jobId: oferta.job_id, clienteId: oferta.cliente_id });
  await registrarEtapaDistribuicao(oferta.job_id, "distribuicao_final", "ok", "adicionada_fila", {
    ofertaId: oferta.id,
    itemFilaId: fila.itemFila?.id || null
  });
  void registrarDistribuicaoFinal({
    oferta,
    itemFila: fila.itemFila
  });

  const destinosImagemAuditoria = Array.isArray(validacao.destinosCompativeisDetalhes) ? validacao.destinosCompativeisDetalhes : [];
  logEngineDistribuidorFila({
    ofertaId: oferta.id,
    jobId: oferta.job_id,
    clienteId: oferta.cliente_id,
    marketplace: oferta.marketplace,
    itemFilaId: fila.itemFila?.id || null,
    temImagem: Boolean(fila.itemFila?.imagem),
    imagemPreview: String(fila.itemFila?.imagem || "").slice(0, 140),
    destinos: destinosImagemAuditoria,
    destino: destinosImagemAuditoria.map(item => item.destino).filter(Boolean).join(" | "),
    tipoMidia: destinosImagemAuditoria.map(item => item.tipoMidia).filter(Boolean).join(" | ")
  });
  coberturaRadar.registrar("engine_distributor_fila", {
    ...contextoCoberturaDistributor(oferta, {
      destino: destinosImagemAuditoria[0]?.destino || {},
      destinoEncontrado: true,
      filaRecebeu: true
    }),
    decisao: "aceito",
    motivo: "adicionada_fila",
    ofertaId: oferta.id,
    filaRecebeu: true
  });

  console.log("[ENGINE-V2-DISTRIBUICAO-CONCLUIDA]", JSON.stringify({
    ofertaId: oferta.id || null,
    jobId: oferta.job_id || null,
    eventoId: oferta.evento_id || null,
    workspaceId: oferta.cliente_id || "",
    marketplace: oferta.marketplace || "",
    filaItemId: fila.itemFila?.id || null,
    filaRecebeu: true,
    destinosCompativeis: validacao.destinosCompativeis || 0,
    temImagem: Boolean(fila.itemFila?.imagem),
    ofertaUniversalSchemaVersion: oferta.metadata?.ofertaUniversalSchemaVersion || oferta.metadata?.ofertaUniversal?.schemaVersion || ""
  }));

  if (resumo) resumo.adicionadasFila += 1;
  return { ok: true, itemFilaId: fila.itemFila?.id || null };
}

async function distribuirOfertasEngine({ limite = 10, marketplace = "", clienteId = "", contexto = {}, deps = {} } = {}) {
  const limiteFinal = limitarDistribuicao(limite);
  const resumo = {
    ok: true,
    processadas: 0,
    adicionadasFila: 0,
    retidas: 0,
    erros: 0,
    motivos: {}
  };

  const contextoFinal = {
    ...contexto,
    deps
  };

  logEngineDistribuidorInicio({ limite: limiteFinal, marketplace: marketplace || "", clienteId: clienteId || "" });

  const busca = await buscarOfertasDistribuiveis({ limite: limiteFinal, marketplace, clienteId });
  if (!busca.ok) {
    logEngineDistribuidorErro({ etapa: "buscar_ofertas", motivo: busca.motivo || "buscar_ofertas_falhou", erro: busca.erro || "" });
    return {
      ...resumo,
      ok: false,
      motivo: busca.motivo || "buscar_ofertas_falhou",
      erro: busca.erro || ""
    };
  }

  for (const oferta of busca.ofertas) {
    resumo.processadas += 1;

    try {
      const resultado = await distribuirOfertaEngine(oferta, contextoFinal, resumo);
      if (resultado.ignorado) resumo.processadas -= 1;
    } catch (e) {
      resumo.erros += 1;
      motivoAdicionar(resumo, "erro_distribuicao");
      logEngineDistribuidorErro({ ofertaId: oferta.id, jobId: oferta.job_id, etapa: "distribuir_oferta", motivo: "erro_distribuicao", erro: e.message });
      coberturaRadar.registrar("engine_distributor_erro", {
        ...contextoCoberturaDistributor(oferta),
        decisao: "erro",
        motivo: "erro_distribuicao",
        erro: e.message,
        filaRecebeu: false
      });
      await erroOferta(oferta, "erro_distribuicao", { erro: e.message });
    }
  }

  logEngineDistribuidorFim(resumo);
  return resumo;
}

module.exports = { distribuirOfertasEngine };
