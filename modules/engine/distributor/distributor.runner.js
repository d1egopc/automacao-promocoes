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

function motivoAdicionar(resumo, motivo = "erro_distribuicao") {
  const chave = motivo || "erro_distribuicao";
  resumo.motivos[chave] = (resumo.motivos[chave] || 0) + 1;
}

async function reterOferta(oferta, motivo, detalhes = {}, resumo = null) {
  await registrarEtapaDistribuicao(oferta.job_id, "distribuicao_final", "retida", motivo, detalhes);
  await marcarOfertaStatus(oferta.id, "retida", motivo);
  logEngineDistribuidorRetida({ ofertaId: oferta.id, jobId: oferta.job_id, clienteId: oferta.cliente_id, motivo });

  if (resumo) {
    resumo.retidas += 1;
    motivoAdicionar(resumo, motivo);
  }

  return { ok: false, retida: true, motivo };
}

async function erroOferta(oferta, motivo, detalhes = {}, resumo = null) {
  await registrarEtapaDistribuicao(oferta.job_id, "distribuicao_final", "erro", motivo, detalhes);
  await marcarOfertaStatus(oferta.id, "erro_distribuicao", motivo);
  logEngineDistribuidorErro({ ofertaId: oferta.id, jobId: oferta.job_id, clienteId: oferta.cliente_id, motivo, erro: detalhes.erro || "" });

  if (resumo) {
    resumo.erros += 1;
    motivoAdicionar(resumo, motivo);
  }

  return { ok: false, motivo };
}

async function distribuirOfertaEngine(oferta = {}, contexto = {}, resumo = null) {
  logEngineDistribuidorOferta({ ofertaId: oferta.id, jobId: oferta.job_id, clienteId: oferta.cliente_id, marketplace: oferta.marketplace });

  const lock = await tentarMarcarDistribuindo(oferta.id);
  if (!lock.ok) {
    if (lock.ignorado) return { ok: false, ignorado: true, motivo: "oferta_nao_distribuivel" };
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
    return reterOferta(oferta, validacao.motivo, validacao.detalhes || {}, resumo);
  }

  const fila = await adicionarOfertaNaFilaCliente(oferta, contexto);
  await registrarEtapaDistribuicao(oferta.job_id, "adicionar_fila", fila.ok ? "ok" : "retida", fila.ok ? "adicionada_fila" : fila.motivo, {
    clienteId: oferta.cliente_id,
    itemId: fila.itemFila?.id || null
  });

  if (!fila.ok) {
    if (fila.motivo === "duplicidade_fila") {
      return reterOferta(oferta, "duplicidade_fila", {}, resumo);
    }

    return erroOferta(oferta, fila.motivo || "erro_fila", {}, resumo);
  }

  await marcarOfertaStatus(oferta.id, "fila", "adicionada_fila");
  await registrarEtapaDistribuicao(oferta.job_id, "distribuicao_final", "ok", "adicionada_fila", {
    ofertaId: oferta.id,
    itemFilaId: fila.itemFila?.id || null
  });

  logEngineDistribuidorFila({ ofertaId: oferta.id, jobId: oferta.job_id, clienteId: oferta.cliente_id, itemFilaId: fila.itemFila?.id || null });

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
      await erroOferta(oferta, "erro_distribuicao", { erro: e.message });
    }
  }

  logEngineDistribuidorFim(resumo);
  return resumo;
}

module.exports = { distribuirOfertasEngine };