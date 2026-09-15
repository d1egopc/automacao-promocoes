"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const filaHistoricoPolicy = require("../../utils/fila-historico-policy");
const {
  projetarItemFilaLeve,
  FILA_PROJECAO_LEVE_ARQUIVO
} = require("./fila-v2-shadow");

const HISTORICO_LEVE_INCREMENTAL_DIR = "fila-historico-leve-incremental";
const DIA_MS = 24 * 60 * 60 * 1000;
const JANELA_PUBLICA_DIAS_PADRAO = 7;
const VISAO_PROCESSADAS = "processadas";
const VISAO_ENVIADAS = "enviadas";
const VISAO_PARCIAIS = "parciais";
const VISAO_NAO_ENVIADAS = "nao_enviadas";
const FORMATADOR_DIA_PUBLICO_SP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function textoLimitado(valor = "", limite = 240) {
  const bruto = texto(valor);
  if (!bruto) return "";
  return bruto.length > limite ? `${bruto.slice(0, Math.max(0, limite - 3))}...` : bruto;
}

function normalizarTexto(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function clienteSeguro(valor = "admin") {
  return texto(valor || "admin") || "admin";
}

function timestampMs(valor) {
  if (!valor) return null;
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  const textoValor = String(valor).trim();
  const brasileiro = textoValor.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (brasileiro) {
    const msBr = Date.UTC(
      Number(brasileiro[3]),
      Number(brasileiro[2]) - 1,
      Number(brasileiro[1]),
      Number(brasileiro[4]) + 3,
      Number(brasileiro[5]),
      Number(brasileiro[6] || 0)
    );
    if (Number.isFinite(msBr)) return msBr;
  }
  const ms = Date.parse(textoValor);
  return Number.isFinite(ms) ? ms : null;
}

function isoOuVazio(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const t = texto(valor);
    if (t) return t;
  }
  return "";
}

function dataArquivoIso(ms) {
  return isoOuVazio(ms).slice(0, 10);
}

function dataDiaPublica(ms, timeZone = "America/Sao_Paulo") {
  if (!Number.isFinite(ms)) return "";
  if (!timeZone || timeZone === "America/Sao_Paulo") {
    return FORMATADOR_DIA_PUBLICO_SP.format(new Date(ms));
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(ms));
}

function parseDiaArquivo(nome = "") {
  const match = String(nome || "").match(/^(\d{4})-(\d{2})-(\d{2})\.jsonl$/);
  if (!match) return null;
  const ms = Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

function marcoProcessadaItem(item = {}) {
  const candidatos = [
    ["dataEntradaFila", item.dataEntradaFila],
    ["filaCriadoEm", item.filaCriadoEm],
    ["adicionadoEm", item.adicionadoEm],
    ["criadoEm", item.criadoEm],
    ["createdAt", item.createdAt],
    ["created_at", item.created_at]
  ];
  for (const [campo, valor] of candidatos) {
    const ms = timestampMs(valor);
    if (Number.isFinite(ms)) {
      return { ok: true, campo, valor: String(valor), ms };
    }
  }
  return { ok: false, campo: "", valor: "", ms: null };
}

function timestampResultadoItem(item = {}) {
  for (const valor of [
    item.finalizadoEm,
    item.enviadoEm,
    item.dataEnvio,
    item.erroEm,
    item.retidaEm,
    item.expiradaEm,
    item.updatedAt,
    item.atualizadoEm
  ]) {
    const ms = timestampMs(valor);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function hashCurto(valor = "") {
  return crypto.createHash("sha1").update(String(valor || "")).digest("hex");
}

function idExecucaoItem(item = {}, indice = -1) {
  return texto(
    item.id ||
    item.filaItemId ||
    item.itemFilaId ||
    item.filaId ||
    item.idFila ||
    item.execucaoId ||
    item.executionId ||
    item.distribuicaoId ||
    item.distributionId ||
    item.jobId ||
    item.job_id ||
    item.ofertaOperacionalId ||
    item.operacionalId ||
    item.ofertaId ||
    item.oferta_id ||
    item.engineOfertaId ||
    item.engine_oferta_id ||
    item.idOferta
  ) || `indice:${indice}`;
}

function identidadeFallback(clienteId = "admin", item = {}, indice = -1) {
  const nascimento = primeiroTexto(
    item.dataEntradaFila,
    item.criadoEm,
    item.createdAt,
    item.adicionadoEm,
    item.filaCriadoEm
  ) || `pos:${indice}`;
  const base = [
    clienteSeguro(clienteId),
    idExecucaoItem(item, indice),
    nascimento
  ].join("|");
  return `fallback:${hashCurto(base)}`;
}

function identidadesRegistro(registro = {}, indice = -1, clienteIdPadrao = "admin") {
  const item = registro?.item && typeof registro.item === "object" ? registro.item : registro;
  const cliente = clienteSeguro(registro?.clienteId || item?.clienteId || clienteIdPadrao);
  const ids = [];
  const chave = texto(registro?.chave || item?.chave);
  const detalheId = texto(registro?.detalheRef?.id || item?.detalheRef?.id);
  const id = idExecucaoItem(item, indice);
  if (chave) ids.push(`chave:${chave}`);
  if (id) ids.push(`id:${id}`);
  if (detalheId) ids.push(`id:${detalheId}`);
  ids.push(identidadeFallback(cliente, item, indice));
  return [...new Set(ids)];
}

function identidadePrincipal(registro = {}, indice = -1, clienteIdPadrao = "admin") {
  const identidades = identidadesRegistro(registro, indice, clienteIdPadrao);
  const porId = identidades.find(id => id.startsWith("id:"));
  return porId || identidades[0] || "";
}

function registroDentroJanela(ms, opcoes = {}) {
  if (!Number.isFinite(ms)) return false;
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const periodo = normalizarTexto(opcoes.periodo || "");
  if (periodo === "hoje") {
    return dataDiaPublica(ms, opcoes.timeZone) === dataDiaPublica(agoraMs, opcoes.timeZone);
  }
  const janelaDias = Number(opcoes.janelaDias || JANELA_PUBLICA_DIAS_PADRAO);
  if (!Number.isFinite(janelaDias) || janelaDias <= 0) return true;
  return ms >= agoraMs - janelaDias * DIA_MS && ms <= agoraMs + DIA_MS;
}

function resultadoPublicoTerminal(item = {}) {
  const statusPublico = normalizarTexto(item.statusPublico);
  if (statusPublico === "enviado") return "enviado";
  if (statusPublico === "parcial") return "parcial";
  if (statusPublico === "nao enviado" || statusPublico === "nao_enviado") return "nao_enviado";

  const progresso = item.progresso && typeof item.progresso === "object" ? item.progresso : {};
  const total = Number(progresso.total || 0);
  const enviados = Number(progresso.enviados || 0);
  if (total > 0) {
    if (enviados >= total) return "enviado";
    if (enviados > 0) return "parcial";
    return "nao_enviado";
  }

  const status = normalizarTexto(item.statusOperacional || item.status || item.estado);
  if (["enviado", "enviada", "historico", "sucesso"].includes(status)) return "enviado";
  return "nao_enviado";
}

function itemEhTerminal(item = {}) {
  const statusPublico = normalizarTexto(item.statusPublico);
  if (statusPublico === "em distribuicao") return false;
  if (["enviado", "parcial", "nao enviado"].includes(statusPublico)) return true;
  return filaHistoricoPolicy.classificarEstadoFila({
    ...item,
    status: item.statusOperacional || item.statusPublico || item.status || item.estado
  }).estado === "final";
}

function normalizarItemPublico(origem = {}, dados = {}) {
  const item = origem?.item && typeof origem.item === "object" ? origem.item : origem;
  const projetado = dados.projetado || projetarItemFilaLeve(item, {
    clienteId: dados.clienteId,
    indice: dados.indice,
    agora: dados.agoraMs
  });
  const processada = dados.processada || marcoProcessadaItem(item);
  const resultadoMs = Number.isFinite(dados.resultadoMs) ? dados.resultadoMs : timestampResultadoItem(item);
  const timestamp = dados.tipoVisao === VISAO_PROCESSADAS
    ? processada.ms
    : (Number.isFinite(resultadoMs) ? resultadoMs : processada.ms);
  const statusResultado = dados.resultadoPublico || "";
  const detalheRef = item.detalheRef && typeof item.detalheRef === "object"
    ? item.detalheRef
    : projetado.detalheRef;

  return {
    id: projetado.id,
    chave: texto(origem?.chave || item.chave),
    clienteId: clienteSeguro(dados.clienteId || projetado.clienteId || item.clienteId),
    titulo: projetado.titulo,
    marketplace: projetado.marketplace,
    categoria: textoLimitado(primeiroTexto(projetado.categoria, item.categoria, item.categoriaProduto), 120),
    imagemRef: projetado.imagemRef,
    thumbRef: projetado.imagemRef,
    precoExibivel: projetado.precoExibivel,
    canal: projetado.canal,
    destinoResumo: primeiroTexto(projetado.destinoNome, projetado.destinoId),
    destinos: Array.isArray(projetado.destinos) ? projetado.destinos : [],
    statusPublico: dados.tipoVisao === VISAO_PROCESSADAS ? "processada" : statusResultado,
    resultadoPublico: statusResultado,
    marco: dados.tipoVisao === VISAO_PROCESSADAS ? "processada" : "resultado_distribuicao",
    tipoVisao: dados.tipoVisao,
    timestamp: isoOuVazio(timestamp),
    processadaEm: isoOuVazio(processada.ms),
    processadaCampo: processada.campo,
    enviadoEm: projetado.enviadoEm,
    finalizadoEm: projetado.finalizadoEm || isoOuVazio(resultadoMs),
    progresso: projetado.progresso,
    motivoPublico: textoLimitado(primeiroTexto(projetado.motivoPublico, item.motivoPublico, item.motivoFinal, item.motivoRetencao, item.motivo, item.erro), 240),
    detalheRef: {
      arquivo: texto(detalheRef?.arquivo || ""),
      id: texto(detalheRef?.id || projetado.id)
    },
    identidade: dados.identidade
  };
}

function ordenarRegistrosPublicos(a, b) {
  const ta = timestampMs(a.timestamp) || 0;
  const tb = timestampMs(b.timestamp) || 0;
  if (tb !== ta) return tb - ta;
  return String(a.identidade || a.id || "").localeCompare(String(b.identidade || b.id || ""));
}

function upsertPorIdentidade(mapa, registro) {
  const chave = registro.identidade;
  if (!chave) return;
  const atual = mapa.get(chave);
  if (!atual || ordenarRegistrosPublicos(registro, atual) < 0) {
    mapa.set(chave, registro);
  }
}

function removerPorIdentidades(projecaoAtual = {}, identidades = new Set(), clienteId = "admin", agoraMs = Date.now(), motivo = "hot_remove") {
  const atual = Array.isArray(projecaoAtual.itens) ? projecaoAtual.itens : [];
  const restantes = atual.filter(entrada => !identidadesRegistro(entrada, -1, clienteId).some(id => identidades.has(id)));
  return montarProjecaoHot(clienteId, restantes, agoraMs, motivo);
}

function registroCombinaFiltros(registro = {}, filtros = {}) {
  const marketplace = normalizarTexto(filtros.marketplace);
  const canal = normalizarTexto(filtros.canal);
  const destino = normalizarTexto(filtros.destino);
  const q = normalizarTexto(filtros.q || filtros.busca);
  if (marketplace && !normalizarTexto(registro.marketplace).includes(marketplace)) return false;
  if (canal && !normalizarTexto(registro.canal).includes(canal)) return false;
  if (destino) {
    const alvoDestino = normalizarTexto([
      registro.destinoResumo,
      ...(Array.isArray(registro.destinos) ? registro.destinos.map(d => `${d.destinoNome || ""} ${d.destinoId || ""} ${d.canal || ""}`) : [])
    ].join(" "));
    if (!alvoDestino.includes(destino)) return false;
  }
  if (q) {
    const alvo = normalizarTexto([
      registro.titulo,
      registro.marketplace,
      registro.destinoResumo,
      registro.motivoPublico
    ].join(" "));
    if (!alvo.includes(q)) return false;
  }
  return true;
}

function paginar(itens = [], opcoes = {}) {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(opcoes.limit || 50))));
  const pageQuery = Math.floor(Number(opcoes.page || 0));
  const offsetQuery = Math.max(0, Math.floor(Number(opcoes.offset || 0)));
  const page = Math.max(1, pageQuery || Math.floor(offsetQuery / limit) + 1);
  const offset = (page - 1) * limit;
  const totalFiltrado = Number.isFinite(Number(opcoes.totalFiltradoOverride))
    ? Number(opcoes.totalFiltradoOverride)
    : itens.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltrado / limit));
  return {
    page,
    limit,
    offset,
    totalFiltrado,
    totalPages,
    hasMore: page < totalPages,
    itens: itens.slice(offset, offset + limit)
  };
}

function construirReadModelPublicoPorMarcos(params = {}) {
  const inicio = process.hrtime.bigint();
  const agoraMs = Number(params.agoraMs || Date.now());
  const clienteId = clienteSeguro(params.clienteId || "admin");
  if (params.exigirProjectionReady === true && params.projectionReady !== true) {
    return {
      ok: false,
      motivo: "projection_not_ready",
      versao: 1,
      clienteId,
      projectionReady: false,
      visao: texto(params.visao || params.filtros?.visao || VISAO_PROCESSADAS) || VISAO_PROCESSADAS,
      metricas: {
        processadas: 0,
        enviadas: 0,
        parciais: 0,
        naoEnviadas: 0,
        emDistribuicao: 0,
        fechaMatematicamente: true
      },
      listas: {
        processadas: [],
        enviadas: [],
        parciais: [],
        naoEnviadas: []
      },
      pagina: paginar([], params),
      itens: [],
      diagnostico: {
        duracaoMs: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6),
        bloqueadoPorProjectionReady: true
      }
    };
  }
  const hot = Array.isArray(params.hot) ? params.hot : [];
  const historicoLeve = Array.isArray(params.historicoLeve) ? params.historicoLeve : [];
  const filtros = params.filtros || {};
  const visao = texto(params.visao || filtros.visao || VISAO_PROCESSADAS) || VISAO_PROCESSADAS;
  const somenteMetricas = params.somenteMetricas === true;
  const periodo = normalizarTexto(params.periodo || filtros.periodo || "");
  const janelaDiasPublica = periodo === "hoje" ? 1 : Number(params.janelaDias || JANELA_PUBLICA_DIAS_PADRAO);
  const filtrosAtivos = Boolean(
    normalizarTexto(filtros.marketplace) ||
    normalizarTexto(filtros.canal) ||
    normalizarTexto(filtros.destino) ||
    normalizarTexto(filtros.q || filtros.busca)
  );
  const leiturasFisicas = Number(params.leiturasFisicas || 0);
  const bytesLidos = Number(params.bytesLidos || 0);
  const listaSolicitada = new Map();
  const processadasIds = new Set();
  const enviadasIds = new Set();
  const parciaisIds = new Set();
  const naoEnviadasIds = new Set();
  const terminaisIdentidades = new Set();
  const terminaisPrincipais = new Set();
  const terminaisResultadoPorIdentidade = new Map();
  let invisiveisAntesMarco = 0;
  let hotRemovidosPorTerminal = 0;
  let historicoLeveConsiderado = 0;

  function registrarListaSeSolicitada(tipoVisao, registro) {
    if (!somenteMetricas && tipoVisao === visao) {
      upsertPorIdentidade(listaSolicitada, registro);
    }
  }

  for (let indice = 0; indice < historicoLeve.length; indice += 1) {
    const registro = historicoLeve[indice] || {};
    const item = registro.item && typeof registro.item === "object" ? registro.item : registro;
    const processada = marcoProcessadaItem(item);
    if (!processada.ok) continue;
    const resultadoMs = timestampResultadoItem(item);
    const resultadoReferenciaMs = Number.isFinite(resultadoMs) ? resultadoMs : processada.ms;
    const dentroProcessada = registroDentroJanela(processada.ms, { agoraMs, janelaDias: janelaDiasPublica, periodo });
    const dentroTerminal = registroDentroJanela(resultadoReferenciaMs, { agoraMs, janelaDias: janelaDiasPublica, periodo });
    if (!dentroProcessada && !dentroTerminal) continue;
    historicoLeveConsiderado += 1;
    const identidades = identidadesRegistro(registro, indice, clienteId);
    identidades.forEach(id => terminaisIdentidades.add(id));
    const identidade = identidadePrincipal(registro, indice, clienteId);
    terminaisPrincipais.add(identidade);
    const resultadoPublico = resultadoPublicoTerminal({
      ...item,
      statusPublico: registro.statusPublico || item.statusPublico,
      statusOperacional: registro.statusOperacional || item.statusOperacional || registro.status
    });
    terminaisResultadoPorIdentidade.set(identidade, resultadoPublico);
    const precisaProjetar = filtrosAtivos ||
      (!somenteMetricas && ((dentroProcessada && visao === VISAO_PROCESSADAS) ||
      (dentroTerminal && visao === (resultadoPublico === "enviado" ? VISAO_ENVIADAS : resultadoPublico === "parcial" ? VISAO_PARCIAIS : VISAO_NAO_ENVIADAS))));
    const projetado = precisaProjetar
      ? projetarItemFilaLeve(item, {
          clienteId,
          indice,
          agora: agoraMs
        })
      : null;
    let processadaPublica = null;
    if (dentroProcessada && (filtrosAtivos || (!somenteMetricas && visao === VISAO_PROCESSADAS))) {
      processadaPublica = normalizarItemPublico(registro, {
        clienteId,
        indice,
        agoraMs,
        projetado,
        processada,
        resultadoMs,
        tipoVisao: VISAO_PROCESSADAS,
        resultadoPublico,
        identidade
      });
    }
    if (dentroProcessada && (!filtrosAtivos || registroCombinaFiltros(processadaPublica, filtros))) {
      processadasIds.add(identidade);
      if (processadaPublica) registrarListaSeSolicitada(VISAO_PROCESSADAS, processadaPublica);
    }
    const tipoVisaoTerminal = resultadoPublico === "enviado" ? VISAO_ENVIADAS : resultadoPublico === "parcial" ? VISAO_PARCIAIS : VISAO_NAO_ENVIADAS;
    let terminalPublico = null;
    if (dentroTerminal && (filtrosAtivos || (!somenteMetricas && visao === tipoVisaoTerminal))) {
      terminalPublico = normalizarItemPublico(registro, {
        clienteId,
        indice,
        agoraMs,
        projetado,
        processada,
        resultadoMs,
        tipoVisao: tipoVisaoTerminal,
        resultadoPublico,
        identidade
      });
    }
    if (dentroTerminal && (!filtrosAtivos || registroCombinaFiltros(terminalPublico, filtros))) {
      if (resultadoPublico === "enviado") enviadasIds.add(identidade);
      else if (resultadoPublico === "parcial") parciaisIds.add(identidade);
      else naoEnviadasIds.add(identidade);
      if (terminalPublico) registrarListaSeSolicitada(tipoVisaoTerminal, terminalPublico);
    }
  }

  for (let indice = 0; indice < hot.length; indice += 1) {
    const item = hot[indice] || {};
    const processada = marcoProcessadaItem(item);
    if (!processada.ok) {
      invisiveisAntesMarco += 1;
      continue;
    }
    if (!registroDentroJanela(processada.ms, { agoraMs, janelaDias: janelaDiasPublica, periodo })) continue;
    const identidades = identidadesRegistro(item, indice, clienteId);
    const jaTerminal = identidades.some(id => terminaisIdentidades.has(id));
    if (jaTerminal || itemEhTerminal(item)) {
      hotRemovidosPorTerminal += 1;
      continue;
    }
    const identidade = identidadePrincipal(item, indice, clienteId);
    const projetado = projetarItemFilaLeve(item, {
      clienteId,
      indice,
      agora: agoraMs
    });
    let processadaPublica = null;
    if (filtrosAtivos || (!somenteMetricas && visao === VISAO_PROCESSADAS)) {
      processadaPublica = normalizarItemPublico(item, {
        clienteId,
        indice,
        agoraMs,
        projetado,
        processada,
        tipoVisao: VISAO_PROCESSADAS,
        resultadoPublico: "em_distribuicao",
        identidade
      });
    }
    if (!filtrosAtivos || registroCombinaFiltros(processadaPublica, filtros)) {
      processadasIds.add(identidade);
      if (processadaPublica) registrarListaSeSolicitada(VISAO_PROCESSADAS, processadaPublica);
    }
  }

  const metricas = {
    processadas: processadasIds.size,
    enviadas: enviadasIds.size,
    parciais: parciaisIds.size,
    naoEnviadas: naoEnviadasIds.size,
    emDistribuicao: [...processadasIds].filter(id => !terminaisPrincipais.has(id)).length
  };
  metricas.fechaMatematicamente = metricas.enviadas + metricas.parciais + metricas.naoEnviadas + metricas.emDistribuicao === metricas.processadas;

  const listaBase = [...listaSolicitada.values()].sort(ordenarRegistrosPublicos);
  const totalVisao = visao === VISAO_ENVIADAS
    ? metricas.enviadas
    : visao === VISAO_PARCIAIS
      ? metricas.parciais
      : visao === VISAO_NAO_ENVIADAS
        ? metricas.naoEnviadas
        : metricas.processadas;
  const pagina = paginar(listaBase, { ...params, totalFiltradoOverride: totalVisao });
  const listas = {
    processadas: visao === VISAO_PROCESSADAS ? listaBase : [],
    enviadas: visao === VISAO_ENVIADAS ? listaBase : [],
    parciais: visao === VISAO_PARCIAIS ? listaBase : [],
    naoEnviadas: visao === VISAO_NAO_ENVIADAS ? listaBase : []
  };
  const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
  return {
    ok: true,
    versao: 1,
    clienteId,
    marcoProcessada: {
      campoPrimario: "dataEntradaFila",
      fallbacks: ["filaCriadoEm", "adicionadoEm", "criadoEm", "createdAt", "created_at"],
      origem: "item_ja_adicionado_a_fila"
    },
    projectionReady: params.projectionReady === true,
    visao,
    metricas,
    listas,
    pagina,
    itens: pagina.itens,
    totalFiltrado: pagina.totalFiltrado,
    page: pagina.page,
    limit: pagina.limit,
    offset: pagina.offset,
    totalPages: pagina.totalPages,
    hasMore: pagina.hasMore,
    diagnostico: {
      hotLidos: hot.length,
      historicoLeveLidos: historicoLeve.length,
      historicoLeveConsiderado,
      visaoMaterializada: visao,
      itensMaterializados: listaBase.length,
      somenteMetricas,
      invisiveisAntesMarco,
      hotRemovidosPorTerminal,
      terminaisComIdentidade: terminaisResultadoPorIdentidade.size,
      leiturasFisicas,
      bytesLidos,
      duracaoMs
    }
  };
}

function atualizarProjecaoHotPorItem(projecaoAtual = {}, item = {}, opcoes = {}) {
  const clienteId = clienteSeguro(opcoes.clienteId || projecaoAtual.clienteId || item.clienteId || "admin");
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const atual = Array.isArray(projecaoAtual.itens) ? [...projecaoAtual.itens] : [];
  const idsItem = new Set(identidadesRegistro(item, -1, clienteId));
  const semItem = atual.filter(entrada => !identidadesRegistro(entrada, -1, clienteId).some(id => idsItem.has(id)));
  const processada = marcoProcessadaItem(item);
  if (!processada.ok || itemEhTerminal(item)) {
    return montarProjecaoHot(clienteId, semItem, agoraMs, itemEhTerminal(item) ? "terminal_removido" : "sem_marco_processada");
  }
  const projetado = {
    ...projetarItemFilaLeve({ ...item, clienteId }, { clienteId, agora: agoraMs }),
    statusPublico: "em_distribuicao"
  };
  return montarProjecaoHot(clienteId, [...semItem, projetado], agoraMs, "hot_upsert");
}

function removerProjecaoHotPorItem(projecaoAtual = {}, item = {}, opcoes = {}) {
  const clienteId = clienteSeguro(opcoes.clienteId || projecaoAtual.clienteId || item.clienteId || "admin");
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const idsItem = new Set(identidadesRegistro(item, -1, clienteId));
  return montarProjecaoHot(clienteId, removerPorIdentidades(projecaoAtual, idsItem, clienteId, agoraMs, "hot_remove").itens, agoraMs, "hot_remove");
}

function montarProjecaoHot(clienteId, itens, agoraMs, motivo = "reconcile_hot") {
  const normalizados = (Array.isArray(itens) ? itens : []).filter(item => {
    const processada = marcoProcessadaItem(item);
    return processada.ok && !itemEhTerminal(item);
  });
  return {
    versao: 1,
    tipo: "fila_projecao_hot",
    clienteId: clienteSeguro(clienteId),
    geradoEm: isoOuVazio(agoraMs),
    motivo,
    total: normalizados.length,
    contadores: {
      total: normalizados.length,
      emDistribuicao: normalizados.length
    },
    itens: normalizados
  };
}

function reconciliarProjecaoHotDaFila(filaMemoria = [], opcoes = {}) {
  const clienteId = clienteSeguro(opcoes.clienteId || "admin");
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const itens = [];
  for (const item of Array.isArray(filaMemoria) ? filaMemoria : []) {
    if (clienteSeguro(item?.clienteId || "admin") !== clienteId) continue;
    if (!marcoProcessadaItem(item).ok || itemEhTerminal(item)) continue;
    itens.push({
      ...projetarItemFilaLeve({ ...item, clienteId }, { clienteId, agora: agoraMs }),
      statusPublico: "em_distribuicao"
    });
  }
  return {
    projectionReady: true,
    fonte: "fila_memoria",
    arquivo: FILA_PROJECAO_LEVE_ARQUIVO,
    projecao: montarProjecaoHot(clienteId, itens, agoraMs, "reconcile_fila_memoria")
  };
}

function arquivosHistoricoLevePorJanela(dir, opcoes = {}) {
  const fsImpl = opcoes.fs || fs;
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const periodo = normalizarTexto(opcoes.periodo || "");
  const janelaDias = periodo === "hoje" ? 1 : Number(opcoes.janelaDias || JANELA_PUBLICA_DIAS_PADRAO);
  const minDiaMs = Date.parse(dataArquivoIso(agoraMs - Math.max(0, janelaDias - 1) * DIA_MS) + "T00:00:00.000Z");
  const maxDiaMs = Date.parse(dataArquivoIso(agoraMs) + "T00:00:00.000Z");
  try {
    if (!fsImpl.existsSync(dir)) return [];
    return fsImpl.readdirSync(dir)
      .filter(nome => {
        const diaMs = parseDiaArquivo(nome);
        return Number.isFinite(diaMs) && diaMs >= minDiaMs && diaMs <= maxDiaMs;
      })
      .sort((a, b) => String(b).localeCompare(String(a)))
      .map(nome => path.join(dir, nome));
  } catch {
    return [];
  }
}

function lerHistoricoLeveJsonlPorJanela(params = {}) {
  const fsImpl = params.fs || fs;
  const dir = params.dir || params.historicoDir || "";
  const arquivos = arquivosHistoricoLevePorJanela(dir, { ...params, fs: fsImpl });
  const registros = [];
  let bytesLidos = 0;
  let invalidos = 0;
  for (const arquivo of arquivos) {
    let conteudo = "";
    try {
      conteudo = fsImpl.readFileSync(arquivo, "utf8");
      bytesLidos += Buffer.byteLength(conteudo, "utf8");
    } catch {
      invalidos += 1;
      continue;
    }
    for (const linha of conteudo.split(/\r?\n/)) {
      if (!linha.trim()) continue;
      try {
        registros.push(JSON.parse(linha));
      } catch {
        invalidos += 1;
      }
    }
  }
  return {
    registros,
    arquivos,
    leiturasFisicas: arquivos.length,
    bytesLidos,
    invalidos
  };
}

function benchmarkReadModelPublico(params = {}) {
  const inicio = process.hrtime.bigint();
  const leitura = params.historicoDir
    ? lerHistoricoLeveJsonlPorJanela(params)
    : {
        registros: Array.isArray(params.historicoLeve) ? params.historicoLeve : [],
        arquivos: [],
        leiturasFisicas: Number(params.leiturasFisicas || 0),
        bytesLidos: Number(params.bytesLidos || 0),
        invalidos: 0
      };
  const aposLeitura = process.hrtime.bigint();
  const readModel = construirReadModelPublicoPorMarcos({
    ...params,
    historicoLeve: leitura.registros,
    leiturasFisicas: leitura.leiturasFisicas,
    bytesLidos: leitura.bytesLidos
  });
  const aposReadModel = process.hrtime.bigint();
  const bytesResposta = Buffer.byteLength(JSON.stringify({
    metricas: readModel.metricas,
    itens: readModel.itens,
    page: readModel.page,
    limit: readModel.limit,
    totalFiltrado: readModel.totalFiltrado
  }), "utf8");
  return {
    ok: true,
    hot: Array.isArray(params.hot) ? params.hot.length : 0,
    historico: leitura.registros.length,
    leiturasFisicas: leitura.leiturasFisicas,
    bytesLidos: leitura.bytesLidos,
    invalidos: leitura.invalidos,
    leituraMs: Math.round(Number(aposLeitura - inicio) / 1e6),
    readModelMs: Math.round(Number(aposReadModel - aposLeitura) / 1e6),
    totalMs: Math.round(Number(aposReadModel - inicio) / 1e6),
    maiorTrechoSyncMs: Math.max(
      Math.round(Number(aposLeitura - inicio) / 1e6),
      Math.round(Number(aposReadModel - aposLeitura) / 1e6)
    ),
    bytesResposta,
    metricas: readModel.metricas,
    pagina: {
      totalFiltrado: readModel.totalFiltrado,
      page: readModel.page,
      limit: readModel.limit,
      hasMore: readModel.hasMore
    }
  };
}

module.exports = {
  HISTORICO_LEVE_INCREMENTAL_DIR,
  JANELA_PUBLICA_DIAS_PADRAO,
  VISAO_PROCESSADAS,
  VISAO_ENVIADAS,
  VISAO_PARCIAIS,
  VISAO_NAO_ENVIADAS,
  marcoProcessadaItem,
  identidadesRegistro,
  identidadePrincipal,
  resultadoPublicoTerminal,
  itemEhTerminal,
  construirReadModelPublicoPorMarcos,
  atualizarProjecaoHotPorItem,
  removerProjecaoHotPorItem,
  reconciliarProjecaoHotDaFila,
  arquivosHistoricoLevePorJanela,
  lerHistoricoLeveJsonlPorJanela,
  benchmarkReadModelPublico
};
