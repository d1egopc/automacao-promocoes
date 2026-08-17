const {
  limitarDistribuicao,
  buscarOfertasDistribuiveis,
  tentarMarcarDistribuindo,
  marcarOfertaStatus,
  restaurarOfertaStatusSeDistribuindo,
  restaurarOfertaParaReentradaFlow,
  registrarEtapaDistribuicao,
  validarOfertaParaDistribuicao,
  adicionarOfertaNaFilaCliente,
  motivoDistribuicaoDefinitivo: motivoDistribuicaoDefinitivoService
} = require("./distributor.service");
const {
  motivoDistribuicaoDefinitivo: motivoDistribuicaoDefinitivoHelper
} = require("./motivos-definitivos");
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
const {
  decidirAbsorcaoWorkspace
} = require("../ofc/active-gate.service");
const {
  avaliarFluxoWorkspaceShadow,
  flowManagerAtivoWorkspace
} = require("../flow-manager/flow-manager.service");

const motivoDistribuicaoDefinitivo = typeof motivoDistribuicaoDefinitivoService === "function"
  ? motivoDistribuicaoDefinitivoService
  : motivoDistribuicaoDefinitivoHelper;

function motivoAdicionar(resumo, motivo = "erro_distribuicao") {
  const chave = motivo || "erro_distribuicao";
  resumo.motivos[chave] = (resumo.motivos[chave] || 0) + 1;
}

function metadataObjeto(valor = {}) {
  return valor && typeof valor === "object" ? valor : {};
}

function tipoOperacionalOferta(oferta = {}) {
  const metadata = metadataObjeto(oferta.metadata);
  const jobMetadata = metadataObjeto(oferta.job_metadata);
  return String(
    oferta.tipoOperacional ||
    oferta.tipo_operacional ||
    metadata.tipoOperacional ||
    metadata.tipo_operacional ||
    jobMetadata.tipoOperacional ||
    jobMetadata.tipo_operacional ||
    ""
  ).trim();
}

function cupomTurboOferta(oferta = {}) {
  const metadata = metadataObjeto(oferta.metadata);
  const jobMetadata = metadataObjeto(oferta.job_metadata);
  return oferta.cupomTurbo === true ||
    oferta.cupom_turbo === true ||
    metadata.cupomTurbo === true ||
    metadata.cupom_turbo === true ||
    jobMetadata.cupomTurbo === true ||
    jobMetadata.cupom_turbo === true ||
    tipoOperacionalOferta(oferta).toLowerCase() === "cupom_turbo";
}

function registrarGateResumo(resumo = null, decisao = {}) {
  if (!resumo || !decisao?.ativo) return;
  if (!resumo.gateAtivo) {
    resumo.gateAtivo = {
      avaliadas: 0,
      permitidas: 0,
      bloqueadas: 0,
      fallback: 0,
      porMotivo: {},
      capacidadeUsada: 0,
      filaAntes: null,
      filaDepois: null,
      idadeMaximaEsteiraMs: null
    };
  }
  resumo.gateAtivo.avaliadas += 1;
  if (decisao.permitir) resumo.gateAtivo.permitidas += 1;
  else resumo.gateAtivo.bloqueadas += 1;
  if (decisao.fallbackAplicado) resumo.gateAtivo.fallback += 1;
  const motivo = decisao.motivo || "sem_motivo";
  resumo.gateAtivo.porMotivo[motivo] = (resumo.gateAtivo.porMotivo[motivo] || 0) + 1;
  resumo.gateAtivo.capacidadeUsada += Number(decisao.permitir ? 1 : 0);
  if (resumo.gateAtivo.filaAntes === null) resumo.gateAtivo.filaAntes = decisao.pressaoEsteiraViva ?? null;
  resumo.gateAtivo.filaDepois = decisao.permitir
    ? Number(decisao.pressaoEsteiraViva || 0) + 1
    : decisao.pressaoEsteiraViva ?? null;
  if (decisao.idadeMaximaEsteiraMs !== undefined && decisao.idadeMaximaEsteiraMs !== null) {
    resumo.gateAtivo.idadeMaximaEsteiraMs = Math.max(
      Number(resumo.gateAtivo.idadeMaximaEsteiraMs || 0),
      Number(decisao.idadeMaximaEsteiraMs || 0)
    );
  }
}

function incrementarContador(mapa = {}, chave = "") {
  const id = String(chave || "desconhecido").trim() || "desconhecido";
  mapa[id] = (mapa[id] || 0) + 1;
}

function criarResumoDistributorVivo(capacidadeAlvo = 0) {
  return {
    candidatosConsultados: 0,
    limiteOperacionalCandidatos: 0,
    candidatosGateBloqueados: 0,
    workspacesBloqueados: {},
    candidatosPulados: 0,
    distribuicoesUteis: 0,
    capacidadeAlvo,
    motivoEncerramento: "",
    workspacesAtendidos: {}
  };
}

function registrarResultadoDistributorVivo(resumo = null, oferta = {}, resultado = {}) {
  if (!resumo?.distributorVivo) return;
  const vivo = resumo.distributorVivo;
  vivo.candidatosConsultados += 1;

  if (resultado?.gateBloqueado) {
    vivo.candidatosGateBloqueados += 1;
    incrementarContador(vivo.workspacesBloqueados, oferta.cliente_id);
    return;
  }

  if (resultado?.ok) {
    vivo.distribuicoesUteis += 1;
    incrementarContador(vivo.workspacesAtendidos, oferta.cliente_id);
    return;
  }

  vivo.candidatosPulados += 1;
}

function logDistributorVivo(resumo = {}) {
  const vivo = resumo.distributorVivo;
  if (!vivo) return;

  try {
    console.log("[OFC-V2.8-DISTRIBUTOR-VIVO]", JSON.stringify({
      candidatosConsultados: vivo.candidatosConsultados,
      limiteOperacionalCandidatos: vivo.limiteOperacionalCandidatos || 0,
      candidatosGateBloqueados: vivo.candidatosGateBloqueados,
      workspacesBloqueados: vivo.workspacesBloqueados,
      candidatosPulados: vivo.candidatosPulados,
      distribuicoesUteis: vivo.distribuicoesUteis,
      capacidadeAlvo: vivo.capacidadeAlvo,
      motivoEncerramento: vivo.motivoEncerramento || "indefinido",
      workspacesAtendidos: vivo.workspacesAtendidos
    }));
  } catch (_) {}
}

async function registrarFlowManagerShadow(oferta = {}, validacao = {}, contexto = {}) {
  try {
    const avaliarFlow = contexto?.deps?.avaliarFluxoWorkspaceShadow || avaliarFluxoWorkspaceShadow;
    return await avaliarFlow({
      workspaceId: oferta.cliente_id || "",
      ofertaId: oferta.id,
      marketplace: oferta.marketplace || "",
      tipoOperacional: tipoOperacionalOferta(oferta),
      cupomTurbo: cupomTurboOferta(oferta),
      prioridade: oferta.prioridade ?? oferta.score ?? 0,
      oferta,
      destinosCompativeis: validacao.__destinosCompativeisRaw || []
    }, {
      ...(contexto?.deps?.flowManager || {}),
      validarCreditos: contexto.validarCreditos,
      diagnosticarDisponibilidadeEnvioWorkspace: contexto?.deps?.diagnosticarDisponibilidadeEnvioWorkspace
    });
  } catch (erro) {
    logFlowAtivo("[OPTIMUS-FLOW-V1-ERRO]", {
      workspaceId: oferta.cliente_id || "",
      ofertaId: oferta.id,
      marketplace: oferta.marketplace || "",
      aceitarAgora: true,
      motivo: "flow_shadow_indisponivel",
      aplicouMudancas: false,
      erroTipo: erro?.name || "erro"
    });
    return {
      aceitarAgora: true,
      motivo: "flow_shadow_indisponivel",
      aplicouMudancas: false,
      fallbackAplicado: true
    };
  }
}

function flowManagerAtivoParaOferta(oferta = {}, contexto = {}) {
  try {
    const resolverAtivo = contexto?.deps?.flowManagerAtivoWorkspace || flowManagerAtivoWorkspace;
    return resolverAtivo(oferta.cliente_id || "", contexto?.deps?.flowManager || {});
  } catch (_) {
    return false;
  }
}

function logFlowAtivo(tag = "", payload = {}) {
  try {
    console.log(tag, JSON.stringify({
      workspaceId: payload.workspaceId || "",
      ofertaId: payload.ofertaId || null,
      marketplace: payload.marketplace || "",
      aceitarAgora: payload.aceitarAgora === true,
      motivo: payload.motivo || "",
      nivelAlvo: payload.nivelAlvo ?? null,
      bufferAtual: payload.bufferAtual ?? null,
      vagasDisponiveis: payload.vagasDisponiveis ?? null,
      tipoFluxo: payload.tipoFluxo || "",
      ttlMs: payload.ttlMs ?? null,
      erroTipo: payload.erroTipo || "",
      aplicouMudancas: payload.aplicouMudancas === true
    }));
  } catch (_) {}
}

async function finalizarFlowNaoAceita(oferta = {}, decisao = {}, resumo = null, origem = "flow_manager") {
  const motivo = decisao.motivo || "flow_sem_capacidade";
  const classificacao = motivoDistribuicaoDefinitivo(motivo, {
    origem,
    clienteId: oferta.cliente_id || "",
    marketplace: oferta.marketplace || "",
    destinosCompativeis: decisao.destinosCompativeis,
    temIntegracao: decisao.temIntegracao,
    temCaminhoOperacional: decisao.temCaminhoOperacional
  });
  if (classificacao.definitivo) {
    return reterOferta(oferta, motivo, {
      origem,
      resultadoDistribuicao: "definitivo_nao_aceito",
      definitivoOperacional: true,
      classificacaoOperacional: classificacao.tipo,
      statusOperacional: classificacao.statusOperacional,
      filaRecebeu: false,
      escopo: "workspace"
    }, resumo);
  }

  return reprogramarFlowTemporario(oferta, decisao, resumo, origem, classificacao);
}

function proximaTentativaFlowTemporario(decisao = {}) {
  const valor = decisao.proximaTentativaEm || decisao.proximaTentativa || decisao.proximaTentativaEnvioEm || "";
  const msPersistido = Date.parse(valor);
  if (Number.isFinite(msPersistido) && msPersistido > Date.now()) {
    return new Date(msPersistido).toISOString();
  }

  const motivo = String(decisao.motivo || "").toLowerCase();
  let atrasoMs = 5 * 60 * 1000;
  if (/limite_diario/.test(motivo)) atrasoMs = 60 * 60 * 1000;
  if (/janela|fora_horario/.test(motivo)) atrasoMs = 15 * 60 * 1000;
  if (/intervalo|cooldown|proxima_tentativa/.test(motivo)) atrasoMs = 5 * 60 * 1000;
  if (/esteira|capacidade|gate_absorcao/.test(motivo)) atrasoMs = 5 * 60 * 1000;
  if (/sessao|integracao|canal|credito/.test(motivo)) atrasoMs = 10 * 60 * 1000;
  return new Date(Date.now() + atrasoMs).toISOString();
}

async function reprogramarFlowTemporario(oferta = {}, decisao = {}, resumo = null, origem = "flow_manager", classificacao = {}) {
  const motivo = decisao.motivo || "flow_sem_capacidade";
  const motivoReentrada = `flow_aguardando_${motivo}`;
  const proximaTentativaEm = proximaTentativaFlowTemporario(decisao);
  const statusAnterior = String(oferta.__statusComercialAnterior || oferta.status || "").trim();

  await registrarEtapaDistribuicao(oferta.job_id, "flow_manager", "aguardando", motivo, {
    ofertaId: oferta.id,
    clienteId: oferta.cliente_id,
    marketplace: oferta.marketplace,
    aceitarAgora: false,
    nivelAlvo: decisao.nivelAlvo,
    bufferAtual: decisao.bufferAtual,
    vagasDisponiveis: decisao.vagasDisponiveis,
    tipoFluxo: decisao.tipoFluxo,
    ttlMs: decisao.ttlMs,
    natureza: "temporaria",
    classificacaoOperacional: classificacao.tipo || "temporario",
    proximaTentativaEm,
    origem
  });
  await registrarEtapaDistribuicao(oferta.job_id, "distribuicao_final", "aguardando", "flow_reentrada_temporaria", {
    ofertaId: oferta.id,
    clienteId: oferta.cliente_id,
    resultadoDistribuicao: "flow_reentrada_temporaria",
    motivo,
    filaRecebeu: false,
    statusAnterior,
    proximaTentativaEm,
    origem,
    escopo: "workspace"
  });
  if (typeof restaurarOfertaParaReentradaFlow === "function") {
    await restaurarOfertaParaReentradaFlow(oferta.id, statusAnterior, motivoReentrada, {
      motivo,
      proximaTentativaEm,
      origem
    }, {
      jobId: oferta.job_id,
      clienteId: oferta.cliente_id
    });
  } else {
    await marcarOfertaStatus(oferta.id, statusAnterior, motivoReentrada, {
      jobId: oferta.job_id,
      clienteId: oferta.cliente_id,
      origem
    });
  }

  logFlowAtivo("[OPTIMUS-FLOW-V1-ATIVO-REENTRADA]", {
    workspaceId: oferta.cliente_id || "",
    ofertaId: oferta.id,
    marketplace: oferta.marketplace || "",
    ...decisao,
    aceitarAgora: false,
    aplicouMudancas: true
  });

  if (resumo) {
    motivoAdicionar(resumo, motivoReentrada);
  }

  return {
    ok: false,
    flowBloqueado: true,
    reentradaFlow: true,
    motivo,
    status: statusAnterior,
    motivoStatus: motivoReentrada,
    proximaTentativaEm
  };
}

async function restaurarStatusComercialAposGate(oferta = {}, motivo = "") {
  const statusAnterior = String(oferta.status || "").trim();
  if (!["importada", "oferta_criada"].includes(statusAnterior)) {
    return { ok: true, ignorado: true, motivo: "status_anterior_nao_restauravel" };
  }
  if (typeof restaurarOfertaStatusSeDistribuindo === "function") {
    return restaurarOfertaStatusSeDistribuindo(oferta.id, statusAnterior, motivo, {
      jobId: oferta.job_id,
      clienteId: oferta.cliente_id
    });
  }
  return marcarOfertaStatus(oferta.id, statusAnterior, "", {
    jobId: oferta.job_id,
    clienteId: oferta.cliente_id,
    motivoGate: motivo
  });
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
  const classificacao = motivoDistribuicaoDefinitivo(motivo, {
    ...detalhes,
    clienteId: oferta.cliente_id || "",
    marketplace: oferta.marketplace || ""
  });
  const detalhesFinais = {
    ...detalhes,
    definitivoOperacional: detalhes.definitivoOperacional === true || classificacao.definitivo === true,
    classificacaoOperacional: detalhes.classificacaoOperacional || classificacao.tipo,
    statusOperacional: detalhes.statusOperacional || classificacao.statusOperacional,
    filaRecebeu: detalhes.filaRecebeu === true
  };

  await registrarEtapaDistribuicao(oferta.job_id, "distribuicao_final", "retida", motivo, detalhesFinais);
  await marcarOfertaStatus(oferta.id, "retida", motivo, { jobId: oferta.job_id, clienteId: oferta.cliente_id });
  logEngineDistribuidorRetida({ ofertaId: oferta.id, jobId: oferta.job_id, clienteId: oferta.cliente_id, categoriaOferta: detalhesFinais.categoriaOferta || oferta.categoria || "", categoriasDestino: detalhesFinais.categoriasDestino || [], motivo });

  if (resumo) {
    resumo.retidas += 1;
    motivoAdicionar(resumo, motivo);
  }

  return { ok: false, retida: true, motivo, definitivoOperacional: detalhesFinais.definitivoOperacional };
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

  const statusComercialAnterior = String(oferta.status || "").trim();
  oferta.__statusComercialAnterior = statusComercialAnterior;
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

  const flow = await registrarFlowManagerShadow(oferta, validacao, contexto);
  const flowAtivo = flowManagerAtivoParaOferta(oferta, contexto);

  if (flowAtivo && flow?.aceitarAgora === false) {
    return finalizarFlowNaoAceita(oferta, {
      ...flow,
      destinosCompativeis: validacao.destinosCompativeis
    }, resumo);
  }

  const decidirGate = contexto?.deps?.decidirAbsorcaoWorkspace || decidirAbsorcaoWorkspace;
  const gate = await decidirGate({
    workspaceId: oferta.cliente_id || "",
    ofertaId: oferta.id,
    marketplace: oferta.marketplace || "",
    tipoOperacional: tipoOperacionalOferta(oferta),
    destinosCompativeis: validacao.__destinosCompativeisRaw || [],
    cupomTurbo: cupomTurboOferta(oferta),
    quantidadeSolicitada: 1
  }, contexto?.deps?.gateAtivo || {});
  registrarGateResumo(resumo, gate);

  if (gate?.ativo) {
    await registrarEtapaDistribuicao(oferta.job_id, "gate_absorcao", gate.permitir ? "ok" : "bloqueada", gate.motivo || "", {
      ofertaId: oferta.id,
      clienteId: oferta.cliente_id,
      modo: gate.modo,
      estadoDaEsteira: gate.estadoDaEsteira,
      permitir: gate.permitir === true,
      quantidadeAceitaAgora: gate.quantidadeAceitaAgora || 0,
      pressaoEsteiraViva: gate.pressaoEsteiraViva,
      filaAlvo: gate.filaAlvo,
      capacidadeAtual: gate.capacidadeAtual,
      fallbackAplicado: gate.fallbackAplicado === true
    });

    if (!gate.permitir) {
      const classificacaoGate = motivoDistribuicaoDefinitivo(gate.motivo || "gate_absorcao_bloqueado", {
        origem: "gate",
        clienteId: oferta.cliente_id || "",
        marketplace: oferta.marketplace || "",
        destinosCompativeis: validacao.destinosCompativeis,
        estadoDaEsteira: gate.estadoDaEsteira,
        capacidadeAtual: gate.capacidadeAtual,
        pressaoEsteiraViva: gate.pressaoEsteiraViva,
        filaAlvo: gate.filaAlvo
      });
      if (classificacaoGate.definitivo) {
        coberturaRadar.registrar("engine_distributor_retida", {
          ...contextoCoberturaDistributor(oferta, {
            destinoEncontrado: true,
            filaRecebeu: false
          }),
          decisao: "retido",
          motivo: gate.motivo || "gate_absorcao_bloqueado"
        });
        return reterOferta(oferta, gate.motivo || "gate_absorcao_bloqueado", {
          ofertaId: oferta.id,
          clienteId: oferta.cliente_id,
          resultadoDistribuicao: "gate_definitivo_terminal",
          motivo: gate.motivo || "gate_absorcao_bloqueado",
          estadoDaEsteira: gate.estadoDaEsteira,
          filaRecebeu: false,
          escopo: "workspace",
          definitivoOperacional: true,
          classificacaoOperacional: classificacaoGate.tipo,
          statusOperacional: classificacaoGate.statusOperacional
        }, resumo);
      }

      if (flowAtivo) {
        return finalizarFlowNaoAceita(oferta, {
          ...(flow || {}),
          aceitarAgora: false,
          motivo: gate.motivo || "gate_absorcao_bloqueado",
          nivelAlvo: gate.filaAlvo ?? flow?.nivelAlvo,
          bufferAtual: gate.pressaoEsteiraViva ?? flow?.bufferAtual,
          vagasDisponiveis: gate.capacidadeAtual ?? flow?.vagasDisponiveis,
          tipoFluxo: flow?.tipoFluxo || tipoOperacionalOferta(oferta),
          ttlMs: flow?.ttlMs,
          destinosCompativeis: validacao.destinosCompativeis
        }, resumo, "gate");
      }
      await registrarEtapaDistribuicao(oferta.job_id, "distribuicao_final", "bloqueada", "gate_bloqueado_piloto", {
        ofertaId: oferta.id,
        clienteId: oferta.cliente_id,
        resultadoDistribuicao: "gate_bloqueado_piloto",
        motivo: gate.motivo || "gate_absorcao_bloqueado",
        estadoDaEsteira: gate.estadoDaEsteira,
        filaRecebeu: false,
        escopo: "workspace"
      });
      await restaurarStatusComercialAposGate(oferta, gate.motivo || "gate_absorcao_bloqueado");
      if (resumo) motivoAdicionar(resumo, gate.motivo || "gate_absorcao_bloqueado");
      coberturaRadar.registrar("engine_distributor_gate_bloqueado", {
        ...contextoCoberturaDistributor(oferta, {
          destinoEncontrado: true,
          filaRecebeu: false
        }),
        decisao: "bloqueado",
        motivo: gate.motivo || "gate_absorcao_bloqueado",
        filaRecebeu: false
      });
      return {
        ok: false,
        gateBloqueado: true,
        motivo: gate.motivo || "gate_absorcao_bloqueado",
        estadoDaEsteira: gate.estadoDaEsteira
      };
    }
  }

  const contextoFila = flowAtivo && flow?.aceitarAgora === true
    ? { ...contexto, flowManagerDecisao: flow }
    : contexto;
  const fila = await adicionarOfertaNaFilaCliente(oferta, contextoFila);
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
    motivos: {},
    distributorVivo: criarResumoDistributorVivo(limiteFinal)
  };

  const contextoFinal = {
    ...contexto,
    deps
  };

  logEngineDistribuidorInicio({ limite: limiteFinal, marketplace: marketplace || "", clienteId: clienteId || "" });

  const idsProcessados = new Set();
  const maxCandidatos = Math.max(
    limiteFinal,
    Math.min(Number(contexto.maxCandidatosDistributor || deps.maxCandidatosDistributor || limiteFinal * 50), 500)
  );
  resumo.distributorVivo.limiteOperacionalCandidatos = maxCandidatos;

  while (resumo.adicionadasFila < limiteFinal && idsProcessados.size < maxCandidatos) {
    const limiteBusca = Math.max(1, Math.min(limiteFinal, maxCandidatos - idsProcessados.size));
    const busca = await buscarOfertasDistribuiveis({
      limite: limiteBusca,
      marketplace,
      clienteId,
      excluirOfertaIds: [...idsProcessados]
    });

    if (!busca.ok) {
      logEngineDistribuidorErro({ etapa: "buscar_ofertas", motivo: busca.motivo || "buscar_ofertas_falhou", erro: busca.erro || "" });
      return {
        ...resumo,
        ok: false,
        motivo: busca.motivo || "buscar_ofertas_falhou",
        erro: busca.erro || ""
      };
    }

    const ofertasNovas = (busca.ofertas || []).filter(oferta => {
      const id = String(oferta.id || "");
      return id && !idsProcessados.has(id);
    });

    if (!ofertasNovas.length) {
      resumo.distributorVivo.motivoEncerramento = "candidatos_esgotados";
      break;
    }

    for (const oferta of ofertasNovas) {
      const ofertaId = String(oferta.id || "");
      if (ofertaId) idsProcessados.add(ofertaId);
      resumo.processadas += 1;

      try {
        const resultado = await distribuirOfertaEngine(oferta, contextoFinal, resumo);
        if (resultado.ignorado) resumo.processadas -= 1;
        registrarResultadoDistributorVivo(resumo, oferta, resultado);
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
        registrarResultadoDistributorVivo(resumo, oferta, { ok: false, motivo: "erro_distribuicao" });
      }

      if (resumo.adicionadasFila >= limiteFinal || idsProcessados.size >= maxCandidatos) break;
    }
  }

  if (!resumo.distributorVivo.motivoEncerramento) {
    resumo.distributorVivo.motivoEncerramento = resumo.adicionadasFila >= limiteFinal
      ? "capacidade_util_atendida"
      : "limite_seguro_de_candidatos";
  }

  logEngineDistribuidorFim(resumo);
  logDistributorVivo(resumo);
  if (resumo.gateAtivo) {
    console.log("[OFC-GATE-ATIVO-RESUMO]", JSON.stringify({
      modo: "ativo_piloto",
      avaliadas: resumo.gateAtivo.avaliadas,
      permitidas: resumo.gateAtivo.permitidas,
      bloqueadas: resumo.gateAtivo.bloqueadas,
      fallback: resumo.gateAtivo.fallback,
      porMotivo: resumo.gateAtivo.porMotivo,
      capacidadeUsada: resumo.gateAtivo.capacidadeUsada,
      filaAntes: resumo.gateAtivo.filaAntes,
      filaDepois: resumo.gateAtivo.filaDepois,
      idadeMaximaEsteiraMs: resumo.gateAtivo.idadeMaximaEsteiraMs
    }));
  }
  return resumo;
}

module.exports = { distribuirOfertasEngine };
