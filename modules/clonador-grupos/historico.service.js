"use strict";

const { listarCheckpointsEntregaPorItens } = require("../fila/fila-checkpoints-entrega.repository");

// Projecao segura para a UI. Este modulo nunca devolve texto original, links,
// payloads, credenciais, stack traces ou ids externos de provider.
const STATUS_PUBLICOS = new Set([
  "capturada", "processando", "oferta_criada", "na_fila", "enviando", "enviada",
  "parcial", "pendente", "falhou", "repetida", "nao_elegivel", "sem_destino",
  "incompativel", "expirada", "erro"
]);

function texto(valor = "", max = 240) {
  return String(valor ?? "").trim().slice(0, max);
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function dataIso(valor) {
  const data = valor ? new Date(valor) : null;
  return data && Number.isFinite(data.getTime()) ? data.toISOString() : "";
}

function dataObrigatoria(valor, codigo) {
  if (!valor) return "";
  const iso = dataIso(valor);
  if (!iso) {
    const erro = new Error(codigo); erro.codigo = codigo; erro.statusCode = 400; throw erro;
  }
  return iso;
}

function motivoSeguro(valor = "") {
  const bruto = texto(valor, 120).toLowerCase();
  return /^[a-z0-9_:.\-]+$/.test(bruto) ? bruto : "";
}

function origemFluxo(buffer = {}) {
  const metadata = objeto(buffer.metadata);
  return texto(metadata.origemFluxo || metadata.clonadorGrupos?.origemFluxo || "clonador_grupos", 40) || "clonador_grupos";
}

function statusPublico({ buffer = {}, jobs = [], ofertas = [], fila = [], checkpoints = [] } = {}) {
  const metadata = objeto(buffer.metadata);
  const historico = objeto(metadata.historicoResumo);
  const historicoLegado = objeto(metadata.clonadorHistorico);
  const bridge = objeto(metadata.clonadorGruposBridge);
  const repeticao = objeto(historico.repeticoes);
  const repeticaoLegada = objeto(historicoLegado.repeticao);
  if (buffer.status === "erro") return { status: "erro", motivoCodigo: motivoSeguro(bridge.motivo || historico.motivoCodigo || "query_falhou") };
  if (buffer.status === "ignorada") return { status: "nao_elegivel", motivoCodigo: motivoSeguro(historico.motivoCodigo || "captura_ignorada") };

  const checkpointEstados = checkpoints.map(item => texto(item.estado).toLowerCase());
  if (checkpointEstados.length && checkpointEstados.every(estado => estado === "enviado")) return { status: "enviada", motivoCodigo: "" };
  if (checkpointEstados.includes("enviado")) return { status: "parcial", motivoCodigo: "" };
  if (checkpointEstados.length && checkpointEstados.every(estado => estado === "falha_confirmada")) return { status: "falhou", motivoCodigo: "" };
  if (checkpointEstados.includes("envio_iniciado")) return { status: "pendente", motivoCodigo: "" };
  if (checkpointEstados.includes("resultado_ambiguo") || checkpointEstados.includes("preparado")) return { status: "pendente", motivoCodigo: "resultado_nao_confirmado" };
  const filaStatus = fila.map(item => texto(item.status).toLowerCase());
  if (filaStatus.includes("enviado")) return { status: "enviada", motivoCodigo: "" };
  if (filaStatus.some(estado => ["processando", "enviando"].includes(estado))) return { status: "enviando", motivoCodigo: "" };
  if (filaStatus.some(estado => ["pendente", "fila"].includes(estado))) return { status: "na_fila", motivoCodigo: "" };
  const motivosFila = fila.map(item => motivoSeguro(objeto(item.metadata).motivo || item.motivo));
  if (motivosFila.some(motivo => motivo === "sem_destino" || motivo === "destino_nao_encontrado")) return { status: "sem_destino", motivoCodigo: motivosFila.find(Boolean) };
  if (motivosFila.some(motivo => motivo.includes("incompativel") || motivo === "origem_nao_permitida")) return { status: "incompativel", motivoCodigo: motivosFila.find(Boolean) };
  if (filaStatus.some(estado => estado.includes("expir"))) return { status: "expirada", motivoCodigo: "flow_expirada_frescor_comercial" };
  const oferta = ofertas[0] || {};
  const ofertaStatus = texto(oferta.status).toLowerCase();
  if (ofertaStatus.includes("duplic")) return { status: "repetida", motivoCodigo: "duplicidade_fila" };
  if (ofertaStatus.includes("retid")) return { status: "pendente", motivoCodigo: "retida_v2" };
  if (oferta.id) return { status: "oferta_criada", motivoCodigo: "" };
  const job = jobs[0] || {};
  const jobStatus = texto(job.status).toLowerCase();
  if (jobStatus.includes("erro") || jobStatus.includes("falh")) return { status: "falhou", motivoCodigo: motivoSeguro(job.motivo_final || "job_falhou") };
  if (jobStatus.includes("expir")) return { status: "expirada", motivoCodigo: "flow_expirada_frescor_comercial" };
  if (jobs.length) return { status: "processando", motivoCodigo: "" };
  const snapshotStatus = texto(historico.statusCodigo || historico.resultadoAgregado, 40).toLowerCase();
  if (STATUS_PUBLICOS.has(snapshotStatus)) return { status: snapshotStatus, motivoCodigo: motivoSeguro(historico.motivoCodigo) };
  if (buffer.status === "repetida" || Number(repeticao.total || repeticaoLegada.quantidade || 0) > 0) {
    return { status: "repetida", motivoCodigo: motivoSeguro(repeticao.motivoCodigo || repeticaoLegada.motivoCodigo || "mesma_mensagem") };
  }
  return { status: "capturada", motivoCodigo: motivoSeguro(historico.motivoCodigo || historicoLegado.motivoCodigo) };
}

function resumoProduto(buffer = {}, oferta = {}) {
  const metadata = objeto(buffer.metadata);
  const comercial = objeto(metadata.comercialCapturado);
  const resumo = objeto(metadata.historicoResumo);
  const titulo = texto(oferta.titulo || resumo.titulo || comercial.tituloCapturado, 180);
  return {
    titulo: titulo || null,
    marketplace: texto(oferta.marketplace || resumo.marketplace, 40) || null,
    imagem: texto(oferta.imagem || resumo.imagem, 500) || null,
    preco: oferta.preco ?? resumo.preco ?? comercial.precoAtual ?? null,
    precoAnterior: oferta.preco_original ?? resumo.precoAnterior ?? comercial.precoAnterior ?? null,
    cupomPresente: Boolean(texto(oferta.cupom || comercial.cupom, 120)) || resumo.cupomPresente === true,
    beneficioPresente: Boolean(texto(oferta.beneficio_extra || comercial.beneficioTexto, 120)) || resumo.beneficioPresente === true
  };
}

function cursorDe(buffer = {}) {
  if (!buffer?.capturadoEm || !buffer?.id) return null;
  return Buffer.from(JSON.stringify({ capturadoEm: buffer.capturadoEm, id: String(buffer.id) })).toString("base64url");
}

function lerCursor(cursor = "") {
  if (!cursor) return {};
  try {
    const valor = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    const cursorCapturadoEm = dataObrigatoria(valor.capturadoEm, "cursor_historico_invalido");
    const cursorId = texto(valor.id, 40);
    if (!cursorId || !/^\d+$/.test(cursorId)) {
      const erro = new Error("cursor_historico_invalido"); erro.codigo = "cursor_historico_invalido"; erro.statusCode = 400; throw erro;
    }
    return { cursorCapturadoEm, cursorId };
  } catch (_) {
    const erro = new Error("cursor_historico_invalido");
    erro.codigo = "cursor_historico_invalido";
    erro.statusCode = 400;
    throw erro;
  }
}

function agruparPorBuffer(contexto = {}, buffers = []) {
  const saida = new Map();
  const assegurar = (id) => {
    const chave = String(id || "");
    if (!saida.has(chave)) saida.set(chave, { eventos: [], jobs: [], ofertas: [], fila: [], checkpoints: [] });
    return saida.get(chave);
  };
  const eventoPorBuffer = new Map((buffers || []).map(buffer => [String(objeto(buffer.metadata).clonadorGruposBridge?.eventoId || objeto(buffer.metadata).historicoResumo?.eventoId || ""), String(buffer.id)]));
  for (const evento of contexto.eventos || []) {
    const bufferId = objeto(evento.metadata).clonadorGrupos?.bufferId || eventoPorBuffer.get(String(evento.id));
    if (bufferId) assegurar(bufferId).eventos.push(evento);
  }
  const eventoBuffer = new Map((contexto.eventos || []).map(evento => [String(evento.id), objeto(evento.metadata).clonadorGrupos?.bufferId || eventoPorBuffer.get(String(evento.id))]));
  const jobBuffer = new Map();
  for (const job of contexto.jobs || []) {
    const id = eventoBuffer.get(String(job.evento_id));
    assegurar(id).jobs.push(job);
    jobBuffer.set(String(job.id), id);
  }
  for (const oferta of contexto.ofertas || []) {
    const bufferId = jobBuffer.get(String(oferta.job_id));
    if (bufferId) assegurar(bufferId).ofertas.push(oferta);
  }
  const filaBuffer = new Map();
  for (const item of contexto.fila || []) {
    const bufferId = objeto(item.metadata).clonadorGrupos?.bufferId;
    if (bufferId) assegurar(bufferId).fila.push(item);
    filaBuffer.set(String(item.id), bufferId);
  }
  for (const checkpoint of contexto.checkpoints || []) {
    const bufferId = filaBuffer.get(String(checkpoint.filaItemId || checkpoint.fila_item_id));
    if (bufferId) assegurar(bufferId).checkpoints.push(checkpoint);
  }
  return saida;
}

function itemPublico(buffer, contexto = {}) {
  const estado = statusPublico({ buffer, ...contexto });
  const oferta = contexto.ofertas?.[0] || {};
  const historico = objeto(objeto(buffer.metadata).historicoResumo);
  return {
    bufferId: String(buffer.id),
    origemFluxo: origemFluxo(buffer),
    capturadoEm: dataIso(buffer.capturadoEm),
    grupoFonte: { sessaoId: texto(buffer.sessaoId, 120), grupoJid: texto(buffer.grupoJid, 180), grupoNome: texto(buffer.grupoNome, 180) },
    produto: resumoProduto(buffer, oferta),
    status: estado.status,
    motivoCodigo: estado.motivoCodigo,
    resultadoAgregado: texto(historico.resultadoAgregado || historico.statusCodigo, 40) || estado.status,
    destinosResumo: objeto(historico.destinos),
    repeticoes: Number(objeto(historico.repeticoes).total || 0),
    eventoId: contexto.eventos?.[0]?.id ? String(contexto.eventos[0].id) : texto(historico.eventoId || objeto(buffer.metadata).clonadorGruposBridge?.eventoId, 40),
    jobIds: [...new Set((contexto.jobs || []).map(job => String(job.id)).concat(Array.isArray(historico.jobIds) ? historico.jobIds.map(String) : []))],
    ofertaIds: [...new Set((oferta.id ? [String(oferta.id)] : []).concat(Array.isArray(historico.ofertaIds) ? historico.ofertaIds.map(String) : []))],
    ofertaId: oferta.id ? String(oferta.id) : texto(Array.isArray(historico.ofertaIds) ? historico.ofertaIds[0] : "", 40)
  };
}

function destinosDetalhados(checkpoints = []) {
  const destinos = new Map();
  for (const checkpoint of checkpoints) {
    const destinoId = texto(checkpoint.destinoChave || checkpoint.destino_chave, 120) || "desconhecido";
    if (!destinos.has(destinoId)) destinos.set(destinoId, { destinoId, canal: null, resultado: "pendente", alvos: [] });
    const destino = destinos.get(destinoId);
    const estado = texto(checkpoint.estado, 40) || "preparado";
    destino.alvos.push({
      alvoChave: texto(checkpoint.alvoChave || checkpoint.alvo_chave, 160), estado,
      motivoCodigo: motivoSeguro(checkpoint.motivoCodigo || checkpoint.motivo_codigo) || null,
      classificacao: texto(checkpoint.classificacao, 80) || null,
      statusHttp: Number.isInteger(checkpoint.statusHttp) ? checkpoint.statusHttp : null,
      providerMessageId: texto(checkpoint.providerMessageId || checkpoint.provider_message_id, 240) || null,
      creditoDebitado: typeof checkpoint.creditoDebitado === "boolean" ? checkpoint.creditoDebitado : null,
      atualizadoEm: dataIso(checkpoint.atualizadoEm || checkpoint.atualizado_em) || null
    });
  }
  for (const destino of destinos.values()) {
    const estados = destino.alvos.map(alvo => alvo.estado);
    destino.resultado = estados.length && estados.every(estado => estado === "enviado") ? "enviado"
      : estados.includes("enviado") ? "parcial"
      : estados.length && estados.every(estado => estado === "falha_confirmada") ? "falhou"
      : estados.includes("resultado_ambiguo") ? "pendente"
      : estados.includes("envio_iniciado") ? "enviando" : "pendente";
  }
  return [...destinos.values()];
}

function criarHistoricoClonador({ repository, resolverFilaPorIds, listarFila, listarCheckpoints = listarCheckpointsEntregaPorItens } = {}) {
  if (!repository) throw new Error("clonador_historico_repository_ausente");
  const limite = (valor) => {
    if (valor === undefined || valor === null || valor === "") return 25;
    const numero = Number(valor);
    if (!Number.isInteger(numero) || numero < 1 || numero > 100) {
      const erro = new Error("limit_historico_invalido"); erro.codigo = "limit_historico_invalido"; erro.statusCode = 400; throw erro;
    }
    return numero;
  };

  async function complementarFila(clienteId, buffers, contexto) {
    const porId = new Map((buffers || []).map(item => [String(item.id), item]));
    const filaItemIds = [...new Set((buffers || []).flatMap(item => {
      const resumo = objeto(objeto(item).metadata).historicoResumo || {};
      return Array.isArray(resumo.filaItemIds) ? resumo.filaItemIds.map(String) : [];
    }).filter(Boolean))];
    // `listarFila` e' somente compatibilidade de teste legado. A montagem
    // oficial injeta resolver por ID e nao percorre a fila inteira.
    const filaAtual = typeof resolverFilaPorIds === "function"
      ? await resolverFilaPorIds(clienteId, filaItemIds)
      : (typeof listarFila === "function" ? listarFila(clienteId) : []);
    const fila = (Array.isArray(filaAtual) ? filaAtual : []).map(item => ({
      id: texto(item.id || item.filaItemId), status: texto(item.status),
      metadata: objeto(item.metadata), ofertaId: texto(item.engineOfertaId || item.ofertaId), destinoId: texto(item.destinoId)
    }));
    for (const item of fila) {
      const bufferId = objeto(item.metadata).clonadorGrupos?.bufferId;
      if (!bufferId && porId.size === 1) item.metadata.clonadorGrupos = { bufferId: [...porId.keys()][0] };
    }
    contexto.fila = fila;
    if (filaItemIds.length && typeof listarCheckpoints === "function") {
      try { contexto.checkpoints = await listarCheckpoints({ clienteId, filaItemIds }); } catch { contexto.checkpoints = []; }
    }
    return contexto;
  }

  async function buscarContextoSeguro(clienteId, bufferIds, operacao) {
    try {
      return await repository.buscarContextoHistorico(clienteId, bufferIds);
    } catch (erro) {
      console.warn("[CLONADOR_HISTORICO] enriquecimento_auxiliar_falhou", {
        operacao,
        erro: texto(erro?.message || erro, 160)
      });
      return { eventos: [], jobs: [], ofertas: [], fila: [], checkpoints: [] };
    }
  }

  async function listar(clienteId, filtros = {}) {
    const cursor = lerCursor(filtros.cursor);
    const inicio = dataObrigatoria(filtros.dataInicio, "data_inicio_invalida");
    const fim = dataObrigatoria(filtros.dataFim, "data_fim_invalida");
    if (inicio && fim && new Date(inicio) > new Date(fim)) { const erro = new Error("intervalo_data_invalido"); erro.codigo = "intervalo_data_invalido"; erro.statusCode = 400; throw erro; }
    const status = texto(filtros.status, 40).toLowerCase();
    const tipo = texto(filtros.tipo, 40).toLowerCase();
    if (status && !STATUS_PUBLICOS.has(status)) { const erro = new Error("status_historico_invalido"); erro.codigo = "status_historico_invalido"; erro.statusCode = 400; throw erro; }
    if (tipo && !["erro", "repeticao"].includes(tipo)) { const erro = new Error("tipo_historico_invalido"); erro.codigo = "tipo_historico_invalido"; erro.statusCode = 400; throw erro; }
    const base = await repository.listarHistoricoBase(clienteId, { ...filtros, ...cursor, dataInicio: inicio, dataFim: fim, status, tipo, limit: limite(filtros.limit) });
    const contexto = await complementarFila(
      clienteId,
      base,
      await buscarContextoSeguro(clienteId, base.map(item => item.id), "listar")
    );
    const porBuffer = agruparPorBuffer(contexto, base);
    let itens = base.map(buffer => itemPublico(buffer, porBuffer.get(String(buffer.id)) || {}));
    return { itens, proximoCursor: base.length === limite(filtros.limit) ? cursorDe(base[base.length - 1]) : null };
  }

  async function detalhe(clienteId, bufferId) {
    if (typeof repository.obterHistoricoBasePorId === "function") {
      const buffer = await repository.obterHistoricoBasePorId(clienteId, bufferId);
      if (!buffer) return null;
      const contexto = await complementarFila(
        clienteId,
        [buffer],
        await buscarContextoSeguro(clienteId, [buffer.id], "detalhe")
      );
      const detalhes = agruparPorBuffer(contexto, [buffer]).get(String(buffer.id)) || {};
      const item = itemPublico(buffer, detalhes);
      return { ...item, origem: { adapter: "clonador_grupos", eventoId: item.eventoId || null }, timeline: [
        { etapa: "capturada", em: item.capturadoEm, motivoCodigo: item.motivoCodigo || null },
        ...(detalhes.jobs || []).map(job => ({ etapa: "job", em: dataIso(job.atualizado_em || job.criado_em), status: texto(job.status), motivoCodigo: motivoSeguro(job.motivo_final) || null })),
        ...(detalhes.ofertas || []).map(oferta => ({ etapa: "oferta", em: dataIso(oferta.criada_em), status: texto(oferta.status) }))
      ], jobs: (detalhes.jobs || []).map(job => ({ id: String(job.id), status: texto(job.status), criadoEm: dataIso(job.criado_em), atualizadoEm: dataIso(job.atualizado_em) })),
      ofertas: (detalhes.ofertas || []).map(oferta => ({ id: String(oferta.id), status: texto(oferta.status), marketplace: texto(oferta.marketplace) || null, titulo: texto(oferta.titulo, 180) || null, criadaEm: dataIso(oferta.criada_em) })),
      destinos: destinosDetalhados(detalhes.checkpoints || []) };
    }
    return null;
  }

  return { listar, detalhe, statusPublico, itemPublico, lerCursor, cursorDe };
}

module.exports = { criarHistoricoClonador, statusPublico, itemPublico, lerCursor, cursorDe, STATUS_PUBLICOS };
