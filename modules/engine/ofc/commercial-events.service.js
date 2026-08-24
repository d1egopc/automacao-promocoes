const {
  inserirEventoComercial,
  prepararSchemaEventosComerciaisSeguro
} = require("./commercial-events.repository");

const TIPOS_EVENTO_COMERCIAL = Object.freeze({
  OFERTA_UNIVERSAL_CRIADA: "oferta_universal_criada",
  DISTRIBUICAO_FINAL: "distribuicao_final",
  FILA_CLIENTE_ADICIONADA: "fila_cliente_adicionada",
  DESTINO_CANDIDATO: "destino_candidato",
  DESTINO_SELECIONADO: "destino_selecionado",
  DESTINO_REJEITADO: "destino_rejeitado",
  EXECUTOR_ENVIADO: "executor_enviado",
  EXECUTOR_ERRO_FINAL: "executor_erro_final"
});

const CHAVES_METADATA_PERMITIDAS = Object.freeze([
  "status",
  "motivo",
  "statusOferta",
  "statusFilaAntes",
  "statusFilaDepois",
  "destinosEnviados",
  "destinosTentados",
  "destinosElegiveis",
  "temImagem",
  "score",
  "prioridade",
  "erroTipo",
  "origem",
  "eventoId",
  "workspaceId",
  "destinoId",
  "destinoTipo",
  "destinoNomeSanitizado",
  "canal",
  "decisao",
  "motivoCodigo",
  "categoriaOferta",
  "categoriaDestino",
  "marketplacePermitido",
  "dentroJanela",
  "cooldownAtivo",
  "maxDiaAtingido",
  "sessaoStatus",
  "destinoAtivo",
  "destinosTotal",
  "destinosCompativeis",
  "intervaloConfiguradoMin",
  "intervaloEfetivoMin",
  "turboAplicado",
  "ultimoEnvioEm",
  "proximoPermitidoEm",
  "selecionadoEm",
  "enviadoEm",
  "atrasoOperacionalMs",
  "observabilidadeVersao"
]);

function texto(valor = "", limite = 180) {
  return String(valor ?? "").trim().slice(0, limite);
}

function textoId(valor = "", limite = 120) {
  return texto(valor, limite).replace(/[\r\n\t]+/g, " ");
}

function numeroOuNull(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function inteiroOuNull(valor) {
  const numero = numeroOuNull(valor);
  return numero === null ? null : Math.trunc(numero);
}

function normalizarMotivoDestino(motivo = "") {
  const chave = texto(motivo, 120).toLowerCase();
  const mapa = {
    marketplace: "marketplace_nao_permitido",
    marketplace_nao_permitido: "marketplace_nao_permitido",
    retida_marketplace_nao_marcado: "marketplace_nao_permitido",
    categoria: "categoria_nao_permitida",
    categoria_incompativel: "categoria_nao_permitida",
    categoria_nao_permitida: "categoria_nao_permitida",
    retida_categoria_nao_marcada: "categoria_nao_permitida",
    fora_horario: "fora_janela",
    fora_da_janela: "fora_janela",
    fora_janela: "fora_janela",
    fora_janela_global: "fora_janela",
    intervalo: "cooldown",
    intervalo_aguardando: "cooldown",
    intervalo_nao_atingido: "cooldown",
    repetida_no_executor_2h: "cooldown",
    cooldown: "cooldown",
    limite_diario: "max_dia",
    max_dia: "max_dia",
    max_por_dia: "max_dia",
    max_dia_atingido: "max_dia",
    capacidade: "capacidade",
    esteira_saturada: "capacidade",
    gate_absorcao_bloqueado: "capacidade",
    gate_bloqueado_piloto: "capacidade",
    duplicidade: "duplicidade",
    duplicidade_fila: "duplicidade",
    duplicata: "duplicidade",
    sem_destino_compativel: "sem_destino_elegivel",
    retida_sem_destino_compativel: "sem_destino_elegivel",
    sem_destino_elegivel: "sem_destino_elegivel",
    perfil_nao_elegivel: "perfil_nao_elegivel",
    automacao_desligada: "automacao_inativa",
    automacao_inativa: "automacao_inativa",
    destino_inativo: "destino_inativo",
    sessao_indisponivel: "sessao_offline",
    sessao_offline: "sessao_offline",
    sessao_fechada: "sessao_offline",
    sessao_closed: "sessao_offline",
    sessao_invalida: "sessao_invalida",
    integracao_ausente: "sessao_invalida",
    destino_compativel: "destino_compativel",
    destino_liberado: "destino_liberado",
    envio_confirmado: "envio_confirmado"
  };
  return mapa[chave] || "nao_determinado";
}

function extrairOfertaIdObservabilidade(oferta = {}) {
  return oferta.engineOfertaId || oferta.ofertaId || oferta.oferta_id || "";
}

function extrairJobIdObservabilidade(oferta = {}) {
  return oferta.engineJobId || oferta.jobId || oferta.job_id || "";
}

function extrairEventoIdObservabilidade(oferta = {}) {
  return oferta.engineEventoId || oferta.eventoId || oferta.evento_id || oferta.eventoEngineId || "";
}

function extrairDestinoIdObservabilidade(destino = {}) {
  return textoId(
    destino.id ||
    destino.destinoId ||
    destino.chatId ||
    destino.channelId ||
    destino.webhookId ||
    destino.conexaoId ||
    destino.nome ||
    ""
  );
}

function extrairDestinoTipoObservabilidade(destino = {}) {
  return textoId(destino.tipo || destino.canal || "", 60).toLowerCase();
}

function destinoNomeSanitizado(destino = {}) {
  return texto(destino.nome || destino.name || destino.titulo || destino.label || "", 80);
}

function metadataSanitizada(metadata = {}) {
  const origem = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata
    : {};
  const destino = {};

  for (const chave of CHAVES_METADATA_PERMITIDAS) {
    if (!Object.prototype.hasOwnProperty.call(origem, chave)) continue;
    const valor = origem[chave];
    if (valor === null || valor === undefined || valor === "") continue;
    if (typeof valor === "boolean") {
      destino[chave] = valor;
    } else if (typeof valor === "number") {
      destino[chave] = Number.isFinite(valor) ? valor : null;
    } else if (Array.isArray(valor)) {
      destino[chave] = valor.slice(0, 10).map(item => texto(item, 80)).filter(Boolean);
    } else if (typeof valor === "object") {
      destino[chave] = "[objeto_sanitizado]";
    } else {
      destino[chave] = texto(valor, 160);
    }
  }

  return destino;
}

function montarChaveIdempotencia(evento = {}) {
  const partes = [
    evento.tipoEvento,
    evento.clienteId,
    evento.workspaceId,
    evento.ofertaId,
    evento.jobId,
    evento.filaItemId,
    evento.destinoId,
    evento.canal,
    evento.marketplace
  ].map(item => textoId(item || "-", 140));

  return partes.join("|").slice(0, 500);
}

function normalizarEventoComercial(evento = {}) {
  const tipoEvento = textoId(evento.tipoEvento || evento.tipo_evento || "");
  const clienteId = textoId(evento.clienteId || evento.cliente_id || "");
  const workspaceId = textoId(evento.workspaceId || evento.workspace_id || clienteId || "");
  const ofertaId = inteiroOuNull(evento.ofertaId || evento.oferta_id);
  const jobId = inteiroOuNull(evento.jobId || evento.job_id);
  const filaItemId = textoId(evento.filaItemId || evento.fila_item_id || "");
  const destinoId = textoId(evento.destinoId || evento.destino_id || "");
  const canal = textoId(evento.canal || "");
  const marketplace = textoId(evento.marketplace || "").toLowerCase();
  const origemPipeline = textoId(evento.origemPipeline || evento.origem_pipeline || "engine_v2");
  const ocorridoEm = textoId(evento.ocorridoEm || evento.ocorrido_em || "");
  const metadata = metadataSanitizada(evento.metadata || {});

  const normalizado = {
    tipoEvento,
    clienteId,
    workspaceId,
    ofertaId,
    jobId,
    filaItemId,
    destinoId,
    canal,
    marketplace,
    origemPipeline,
    ocorridoEm,
    metadata
  };
  normalizado.chaveIdempotencia = textoId(
    evento.chaveIdempotencia || evento.chave_idempotencia || montarChaveIdempotencia(normalizado),
    500
  );
  return normalizado;
}

function logErroObservabilidadeComercial(payload = {}) {
  try {
    console.log("[ENGINE-EVENTO-COMERCIAL-ERRO]", JSON.stringify({
      tipoEvento: textoId(payload.tipoEvento || ""),
      clienteId: textoId(payload.clienteId || ""),
      ofertaId: payload.ofertaId || null,
      jobId: payload.jobId || null,
      motivo: texto(payload.motivo || "evento_comercial_falhou", 120),
      erro: texto(payload.erro || "", 180)
    }));
  } catch {
    // Observabilidade nunca pode interromper o pipeline.
  }
}

async function registrarEventoComercialSeguro(evento = {}, opcoes = {}) {
  const repositorio = opcoes.repositorio || inserirEventoComercial;
  let normalizado = null;
  try {
    normalizado = normalizarEventoComercial(evento);
    if (!normalizado.tipoEvento || !normalizado.chaveIdempotencia) {
      return { ok: false, motivo: "evento_comercial_incompleto" };
    }

    const resultado = await repositorio(normalizado);
    if (!resultado.ok) {
      logErroObservabilidadeComercial({
        ...normalizado,
        motivo: resultado.motivo,
        erro: resultado.erro || ""
      });
    }
    return {
      ...resultado,
      evento: normalizado
    };
  } catch (e) {
    logErroObservabilidadeComercial({
      ...(normalizado || {}),
      tipoEvento: evento.tipoEvento || evento.tipo_evento || "",
      clienteId: evento.clienteId || evento.cliente_id || "",
      ofertaId: evento.ofertaId || evento.oferta_id || null,
      jobId: evento.jobId || evento.job_id || null,
      motivo: "evento_comercial_exception",
      erro: e?.message || "erro_desconhecido"
    });
    return {
      ok: false,
      motivo: "evento_comercial_exception",
      erro: e?.message || ""
    };
  }
}

function registrarOfertaUniversalCriada({ job = {}, ofertaId = null, oferta = {}, status = "", motivo = "" } = {}) {
  return registrarEventoComercialSeguro({
    tipoEvento: TIPOS_EVENTO_COMERCIAL.OFERTA_UNIVERSAL_CRIADA,
    clienteId: job.cliente_id || job.clienteId || "",
    workspaceId: job.workspace_id || job.workspaceId || job.cliente_id || job.clienteId || "",
    ofertaId,
    jobId: job.id || job.jobId || "",
    marketplace: oferta.marketplace || job.marketplace || job.marketplace_detectado || "",
    origemPipeline: "engine_importer",
    metadata: {
      status,
      motivo,
      statusOferta: status,
      temImagem: Boolean(oferta.imagem || oferta.imagemUrl),
      score: oferta.score,
      prioridade: oferta.prioridade
    }
  });
}

function registrarFilaClienteAdicionada({ oferta = {}, itemFila = {} } = {}) {
  return registrarEventoComercialSeguro({
    tipoEvento: TIPOS_EVENTO_COMERCIAL.FILA_CLIENTE_ADICIONADA,
    clienteId: oferta.cliente_id || itemFila.clienteId || "",
    workspaceId: oferta.workspace_id || oferta.cliente_id || itemFila.clienteId || "",
    ofertaId: oferta.id || oferta.oferta_id || itemFila.engineOfertaId || "",
    jobId: oferta.job_id || itemFila.engineJobId || "",
    filaItemId: itemFila.id || "",
    marketplace: oferta.marketplace || itemFila.marketplace || "",
    origemPipeline: "engine_distributor",
    metadata: {
      status: "ok",
      motivo: "adicionada_fila",
      statusFilaDepois: itemFila.status || "pendente",
      temImagem: Boolean(itemFila.imagem)
    }
  });
}

function registrarDistribuicaoFinal({ oferta = {}, itemFila = {} } = {}) {
  return registrarEventoComercialSeguro({
    tipoEvento: TIPOS_EVENTO_COMERCIAL.DISTRIBUICAO_FINAL,
    clienteId: oferta.cliente_id || itemFila.clienteId || "",
    workspaceId: oferta.workspace_id || oferta.cliente_id || itemFila.clienteId || "",
    ofertaId: oferta.id || oferta.oferta_id || itemFila.engineOfertaId || "",
    jobId: oferta.job_id || itemFila.engineJobId || "",
    filaItemId: itemFila.id || "",
    marketplace: oferta.marketplace || itemFila.marketplace || "",
    origemPipeline: "engine_distributor",
    metadata: {
      status: "ok",
      motivo: "adicionada_fila"
    }
  });
}

function registrarDecisaoDestinoComercial({
  clienteId = "",
  oferta = {},
  destino = {},
  decisao = "",
  motivo = "",
  categoriaOferta = "",
  categoriaDestino = "",
  marketplacePermitido,
  dentroJanela,
  cooldownAtivo,
  maxDiaAtingido,
  sessaoStatus = "",
  destinosTotal,
  destinosCompativeis,
  selecionadoEm = "",
  proximoPermitidoEm = "",
  repositorio = null
} = {}) {
  const decisaoNormalizada = textoId(decisao, 40).toLowerCase();
  const tipoEventoPorDecisao = {
    candidato: TIPOS_EVENTO_COMERCIAL.DESTINO_CANDIDATO,
    selecionado: TIPOS_EVENTO_COMERCIAL.DESTINO_SELECIONADO,
    rejeitado: TIPOS_EVENTO_COMERCIAL.DESTINO_REJEITADO
  };
  const tipoEvento = tipoEventoPorDecisao[decisaoNormalizada];
  if (!tipoEvento) {
    return Promise.resolve({ ok: false, motivo: "decisao_destino_invalida" });
  }

  const destinoId = extrairDestinoIdObservabilidade(destino);
  const destinoTipo = extrairDestinoTipoObservabilidade(destino);
  const motivoCodigo = normalizarMotivoDestino(motivo);
  const opcoes = typeof repositorio === "function" ? { repositorio } : {};

  return registrarEventoComercialSeguro({
    tipoEvento,
    clienteId,
    workspaceId: clienteId,
    ofertaId: extrairOfertaIdObservabilidade(oferta),
    jobId: extrairJobIdObservabilidade(oferta),
    filaItemId: oferta.id || oferta.filaItemId || "",
    destinoId,
    canal: destinoTipo,
    marketplace: oferta.marketplace || oferta.mercado || "",
    origemPipeline: "executor_destinos",
    metadata: {
      status: decisaoNormalizada,
      motivo: motivoCodigo,
      eventoId: extrairEventoIdObservabilidade(oferta),
      destinoId,
      destinoTipo,
      destinoNomeSanitizado: destinoNomeSanitizado(destino),
      decisao: decisaoNormalizada,
      motivoCodigo,
      categoriaOferta: categoriaOferta || oferta.categoria || oferta.categoriaProduto || "",
      categoriaDestino: categoriaDestino || destino.categoria || destino.categoriaId || "",
      marketplacePermitido,
      dentroJanela,
      cooldownAtivo,
      maxDiaAtingido,
      sessaoStatus,
      destinoAtivo: destino?.ativo !== false,
      destinosTotal,
      destinosCompativeis,
      proximoPermitidoEm,
      selecionadoEm,
      observabilidadeVersao: "v2.1"
    }
  }, opcoes);
}

function registrarExecutorEnviado({ clienteId = "", oferta = {}, destinosEnviados = 0, destinosDetalhes = [], repositorio = null } = {}) {
  const opcoes = typeof repositorio === "function" ? { repositorio } : {};
  const detalhes = Array.isArray(destinosDetalhes) ? destinosDetalhes.filter(Boolean) : [];
  if (detalhes.length > 0) {
    return Promise.all(detalhes.map(detalhe => registrarEventoComercialSeguro({
      tipoEvento: TIPOS_EVENTO_COMERCIAL.EXECUTOR_ENVIADO,
      clienteId,
      workspaceId: detalhe.workspaceId || clienteId,
      ofertaId: oferta.engineOfertaId || oferta.ofertaId || oferta.oferta_id || "",
      jobId: oferta.engineJobId || oferta.jobId || oferta.job_id || "",
      filaItemId: oferta.id || "",
      destinoId: detalhe.destinoId || "",
      canal: detalhe.canal || "",
      marketplace: oferta.marketplace || oferta.mercado || "",
      ocorridoEm: detalhe.enviadoEm || oferta.enviadoEm || oferta.dataEnvio || "",
      origemPipeline: "executor",
      metadata: {
        status: "enviado",
        motivo: "envio_confirmado",
        statusFilaDepois: oferta.status || "enviado",
        destinosEnviados,
        workspaceId: detalhe.workspaceId || clienteId,
        destinoId: detalhe.destinoId || "",
        canal: detalhe.canal || "",
        intervaloConfiguradoMin: detalhe.intervaloConfiguradoMin,
        intervaloEfetivoMin: detalhe.intervaloEfetivoMin,
        turboAplicado: detalhe.turboAplicado === true,
        ultimoEnvioEm: detalhe.ultimoEnvioEm || "",
        proximoPermitidoEm: detalhe.proximoPermitidoEm || "",
        selecionadoEm: detalhe.selecionadoEm || "",
        enviadoEm: detalhe.enviadoEm || "",
        atrasoOperacionalMs: detalhe.atrasoOperacionalMs
      }
    }, opcoes)));
  }

  return registrarEventoComercialSeguro({
    tipoEvento: TIPOS_EVENTO_COMERCIAL.EXECUTOR_ENVIADO,
    clienteId,
    workspaceId: clienteId,
    ofertaId: oferta.engineOfertaId || oferta.ofertaId || oferta.oferta_id || "",
    jobId: oferta.engineJobId || oferta.jobId || oferta.job_id || "",
    filaItemId: oferta.id || "",
    marketplace: oferta.marketplace || oferta.mercado || "",
    ocorridoEm: oferta.enviadoEm || oferta.dataEnvio || "",
    origemPipeline: "executor",
    metadata: {
      status: "enviado",
      motivo: "envio_confirmado",
      statusFilaDepois: oferta.status || "enviado",
      destinosEnviados
    }
  }, opcoes);
}

function registrarExecutorErroFinal({ clienteId = "", oferta = {}, motivo = "", destinosTentados = 0, destinosElegiveis = 0 } = {}) {
  return registrarEventoComercialSeguro({
    tipoEvento: TIPOS_EVENTO_COMERCIAL.EXECUTOR_ERRO_FINAL,
    clienteId,
    workspaceId: clienteId,
    ofertaId: oferta.engineOfertaId || oferta.ofertaId || oferta.oferta_id || "",
    jobId: oferta.engineJobId || oferta.jobId || oferta.job_id || "",
    filaItemId: oferta.id || "",
    marketplace: oferta.marketplace || oferta.mercado || "",
    ocorridoEm: oferta.erroEm || "",
    origemPipeline: "executor",
    metadata: {
      status: "erro",
      motivo: motivo || oferta.erro || "nenhum_destino_confirmou_envio",
      statusFilaDepois: oferta.status || "erro",
      destinosTentados,
      destinosElegiveis
    }
  });
}

module.exports = {
  TIPOS_EVENTO_COMERCIAL,
  metadataSanitizada,
  montarChaveIdempotencia,
  normalizarEventoComercial,
  prepararSchemaEventosComerciaisSeguro,
  registrarEventoComercialSeguro,
  registrarOfertaUniversalCriada,
  registrarFilaClienteAdicionada,
  registrarDistribuicaoFinal,
  registrarDecisaoDestinoComercial,
  registrarExecutorEnviado,
  registrarExecutorErroFinal,
  normalizarMotivoDestino
};
