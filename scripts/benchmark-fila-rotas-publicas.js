"use strict";

const {
  VISAO_PROCESSADAS,
  VISAO_ENVIADAS,
  construirReadModelPublicoPorMarcos,
  reconciliarProjecaoHotDaFila
} = require("../modules/fila/fila-read-model-publico");

const AGORA = Date.parse("2026-09-15T15:00:00.000Z");
const DIA_MS = 24 * 60 * 60 * 1000;

function iso(ms) {
  return new Date(ms).toISOString();
}

function hot(id, indice) {
  return {
    id,
    clienteId: "bench_http",
    titulo: `Oferta hot ${id}`,
    marketplace: indice % 2 ? "amazon" : "mercadolivre",
    preco: `R$ ${99 + indice},90`,
    imagem: `https://img.example/${id}.jpg`,
    dataEntradaFila: iso(AGORA - (indice % 400) * 60 * 1000),
    statusPublico: "em_distribuicao",
    statusOperacional: indice % 5 === 0 ? "processando" : "pendente",
    canal: indice % 3 === 0 ? "whatsapp" : "telegram",
    destinoNome: `Destino ${indice % 20}`
  };
}

function statusHistorico(indice) {
  if (indice % 5 === 0) return "nao_enviado";
  if (indice % 4 === 0) return "parcial";
  return "enviado";
}

function historico(id, indice, statusPublico) {
  const finalizadoEm = iso(AGORA - (indice % 700) * 45 * 1000);
  const total = statusPublico === "parcial" ? 2 : 1;
  const enviados = statusPublico === "nao_enviado" ? 0 : statusPublico === "parcial" ? 1 : 1;
  return {
    chave: `chave_${id}`,
    clienteId: "bench_http",
    id,
    statusPublico,
    statusOperacional: statusPublico === "nao_enviado" ? "expirada_operacional" : "enviado",
    item: {
      id,
      clienteId: "bench_http",
      titulo: `Oferta historico ${id}`,
      marketplace: indice % 2 ? "amazon" : "mercadolivre",
      preco: `R$ ${199 + indice},90`,
      imagem: `https://img.example/${id}.jpg`,
      dataEntradaFila: iso(AGORA - (indice % 500) * 60 * 1000),
      finalizadoEm,
      enviadoEm: statusPublico === "enviado" ? finalizadoEm : "",
      status: statusPublico === "nao_enviado" ? "expirada_operacional" : "enviado",
      canal: indice % 3 === 0 ? "whatsapp" : "telegram",
      destinoNome: `Destino ${indice % 20}`,
      motivo: statusPublico === "nao_enviado" ? "sem_destino_compativel" : "",
      progresso: {
        enviados,
        total,
        pendentes: Math.max(0, total - enviados),
        erros: statusPublico === "nao_enviado" ? 1 : 0
      }
    }
  };
}

function criarHot(total) {
  return Array.from({ length: total }, (_, indice) => hot(`exec_${indice}`, indice));
}

function criarHistoricos(total, overlap) {
  return Array.from({ length: total }, (_, indice) =>
    historico(indice < overlap ? `exec_${indice}` : `hist_${indice}`, indice, statusHistorico(indice))
  );
}

function metricasComAliases(metricas = {}) {
  const processadas = Number(metricas.processadas || 0);
  const enviadas = Number(metricas.enviadas || 0);
  const naoEnviadas = Number(metricas.naoEnviadas || 0);
  return {
    ...metricas,
    taxaEnvio: processadas > 0 ? Math.round((enviadas / processadas) * 1000) / 10 : 0,
    erros: naoEnviadas,
    expiradas: 0
  };
}

function montarPayloadFila(readModel, clienteId = "bench_http") {
  const metricas = metricasComAliases(readModel.metricas);
  return {
    ok: true,
    clienteId,
    total: metricas.processadas,
    totalFiltrado: readModel.totalFiltrado,
    page: readModel.page,
    limit: readModel.limit,
    offset: readModel.offset,
    totalPages: readModel.totalPages,
    hasMore: readModel.hasMore,
    metricas,
    filtros: readModel.filtros || {},
    visao: readModel.visao,
    projectionReady: true,
    pendentes: metricas.emDistribuicao,
    enviados: metricas.enviadas,
    retidas: 0,
    erros: metricas.naoEnviadas,
    itens: readModel.itens
  };
}

function montarPayloadStatus(readModel, clienteId = "bench_http") {
  const metricas = metricasComAliases(readModel.metricas);
  return {
    ok: true,
    clienteId,
    total: metricas.processadas,
    pendentes: metricas.emDistribuicao,
    enviados: metricas.enviadas,
    retidas: 0,
    erros: metricas.naoEnviadas,
    expiradas: 0,
    metricas,
    filtros: readModel.filtros || {},
    visao: readModel.visao,
    projectionReady: true
  };
}

function medir(nome, params = {}, tipo = "fila") {
  const inicioTotal = process.hrtime.bigint();
  const inicioReader = process.hrtime.bigint();
  const readModel = construirReadModelPublicoPorMarcos({
    clienteId: "bench_http",
    hot: params.hot,
    historicoLeve: params.historicoLeve,
    projectionReady: true,
    exigirProjectionReady: true,
    periodo: params.periodo,
    janelaDias: params.periodo === "hoje" ? 1 : 7,
    visao: params.visao,
    filtros: {
      periodo: params.periodo,
      visao: params.visao,
      marketplace: params.marketplace || "",
      canal: params.canal || "",
      destino: params.destino || "",
      busca: params.busca || ""
    },
    page: 1,
    limit: tipo === "status" ? 1 : 50,
    somenteMetricas: tipo === "status",
    leiturasFisicas: 0,
    bytesLidos: 0,
    agoraMs: AGORA
  });
  const readerMs = Math.round(Number(process.hrtime.bigint() - inicioReader) / 1e6);
  const inicioSerializacao = process.hrtime.bigint();
  const payload = tipo === "status" ? montarPayloadStatus(readModel) : montarPayloadFila(readModel);
  const json = JSON.stringify(payload);
  const serializacaoMs = Math.round(Number(process.hrtime.bigint() - inicioSerializacao) / 1e6);
  const totalMs = Math.round(Number(process.hrtime.bigint() - inicioTotal) / 1e6);
  console.log(JSON.stringify({
    nome,
    tipo,
    periodo: params.periodo,
    visao: params.visao,
    totalMs,
    readerMs,
    serializacaoMs,
    maiorTrechoSyncMs: Math.max(readerMs, serializacaoMs),
    bytesResposta: Buffer.byteLength(json, "utf8"),
    leiturasFisicas: 0,
    metricas: payload.metricas,
    pagina: tipo === "status" ? null : {
      page: payload.page,
      limit: payload.limit,
      totalFiltrado: payload.totalFiltrado,
      hasMore: payload.hasMore
    },
    itensMaterializados: readModel.diagnostico?.itensMaterializados || 0
  }));
}

const hotItens = criarHot(827);
const historicoLeve = criarHistoricos(753, 289);
const reconcileInicio = process.hrtime.bigint();
const reconciliacao = reconciliarProjecaoHotDaFila(hotItens, { clienteId: "bench_http", agoraMs: AGORA });
const reconcileMs = Math.round(Number(process.hrtime.bigint() - reconcileInicio) / 1e6);
console.log(JSON.stringify({
  nome: "reconcile_producao_like_827",
  reconcileMs,
  projectionReady: reconciliacao.projectionReady === true,
  hotProjetado: reconciliacao.projecao.total,
  janelaDias: 7,
  diaMs: DIA_MS
}));

medir("GET /fila?periodo=hoje&page=1&limit=50", { hot: hotItens, historicoLeve, periodo: "hoje", visao: VISAO_PROCESSADAS });
medir("GET /fila?periodo=7dias&page=1&limit=50", { hot: hotItens, historicoLeve, periodo: "7dias", visao: VISAO_PROCESSADAS });
medir("GET /fila?visao=enviadas&periodo=7dias&page=1&limit=50", { hot: hotItens, historicoLeve, periodo: "7dias", visao: VISAO_ENVIADAS });
medir("GET /fila/status?periodo=hoje", { hot: hotItens, historicoLeve, periodo: "hoje", visao: VISAO_PROCESSADAS }, "status");
