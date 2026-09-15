"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  adicionarOfertaFila
} = require("../utils/fila-ofertas");
const {
  VISAO_PROCESSADAS,
  VISAO_ENVIADAS,
  VISAO_PARCIAIS,
  VISAO_NAO_ENVIADAS,
  VISAO_COM_ERRO,
  marcoProcessadaItem,
  construirReadModelPublicoPorMarcos,
  atualizarProjecaoHotPorItem,
  reconciliarProjecaoHotDaFila,
  arquivosHistoricoLevePorJanela,
  lerHistoricoLeveJsonlPorJanela,
  benchmarkReadModelPublico
} = require("../modules/fila/fila-read-model-publico");

const AGORA = Date.parse("2026-09-15T15:00:00.000Z");
const DIA = 24 * 60 * 60 * 1000;

function iso(ms) {
  return new Date(ms).toISOString();
}

function timestampMsParaTeste(valor) {
  const ms = Date.parse(String(valor || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function oferta(id, extra = {}) {
  return {
    id,
    clienteId: "cliente_marcos",
    titulo: `Oferta ${id}`,
    marketplace: extra.marketplace || "amazon",
    preco: extra.preco || "R$ 99,90",
    imagem: `https://img.example/${id}.jpg`,
    dataEntradaFila: extra.dataEntradaFila,
    criadoEm: extra.criadoEm,
    status: extra.status || "pendente",
    canal: extra.canal || "telegram",
    destinoNome: extra.destinoNome || "Canal principal",
    destinosEstado: extra.destinosEstado,
    enviadoEm: extra.enviadoEm,
    finalizadoEm: extra.finalizadoEm,
    erroEm: extra.erroEm,
    expiradaEm: extra.expiradaEm,
    motivo: extra.motivo,
    statusDetalhe: extra.statusDetalhe,
    ...extra
  };
}

function registroTerminal(id, statusPublico, extra = {}) {
  const processadaEm = extra.dataEntradaFila || iso(AGORA - 60 * 60 * 1000);
  const finalizadoEm = extra.finalizadoEm || iso(AGORA - 30 * 60 * 1000);
  const item = oferta(id, {
    status: extra.status || (statusPublico === "enviado" ? "enviado" : "erro_final"),
    dataEntradaFila: processadaEm,
    finalizadoEm,
    enviadoEm: statusPublico === "enviado" ? finalizadoEm : "",
    ...(extra.marketplace ? { marketplace: extra.marketplace } : {}),
    ...(extra.canal ? { canal: extra.canal } : {}),
    ...(extra.destinoNome ? { destinoNome: extra.destinoNome } : {}),
    ...(extra.titulo ? { titulo: extra.titulo } : {}),
    destinosEstado: extra.destinosEstado || [
      { destinoId: "dest_1", destinoNome: extra.destinoNome || "Canal principal", canal: extra.canal || "telegram", estado: statusPublico === "nao_enviado" ? "erro" : "enviado" }
    ],
    motivo: extra.motivo
  });
  return {
    chave: extra.chave || `chave_${id}`,
    clienteId: "cliente_marcos",
    id,
    statusPublico,
    statusOperacional: item.status,
    item
  };
}

{
  const semMarco = oferta("pre_marc", { dataEntradaFila: "", criadoEm: "", status: "pendente" });
  assert.strictEqual(marcoProcessadaItem(semMarco).ok, false, "sem dataEntradaFila/criacao nao atingiu marco Processada");
  assert.strictEqual(
    marcoProcessadaItem(oferta("br_date", { dataEntradaFila: "15/09/2026, 12:00:00" })).campo,
    "dataEntradaFila",
    "marco Processada aceita timestamp legado pt-BR"
  );
  const model = construirReadModelPublicoPorMarcos({ clienteId: "cliente_marcos", hot: [semMarco], historicoLeve: [], agoraMs: AGORA });
  assert.strictEqual(model.metricas.processadas, 0, "antes do marco Processada fica invisivel publicamente");
  assert.strictEqual(model.diagnostico.invisiveisAntesMarco, 1);
}

{
  const hot = oferta("proc_1", { dataEntradaFila: iso(AGORA - 10 * 60 * 1000), status: "pendente" });
  const model = construirReadModelPublicoPorMarcos({ clienteId: "cliente_marcos", hot: [hot, { ...hot }], historicoLeve: [], agoraMs: AGORA });
  assert.strictEqual(model.metricas.processadas, 1, "Processadas deduplica por execucao");
  assert.strictEqual(model.metricas.emDistribuicao, 1, "em distribuicao e contador, nao estado final");
  assert.strictEqual(model.listas.processadas[0].statusPublico, "processada");
}

{
  const hot = oferta("clock_1", {
    dataEntradaFila: iso(AGORA - 20 * 60 * 1000),
    status: "retida",
    motivo: "aguardando_relogio_intervalo"
  });
  const model = construirReadModelPublicoPorMarcos({ clienteId: "cliente_marcos", hot: [hot], historicoLeve: [], agoraMs: AGORA });
  assert.strictEqual(model.metricas.processadas, 1, "aguardando relogio continua contando como processada");
  assert.strictEqual(model.listas.enviadas.length, 0, "nao vira linha aguardando em visao de resultado");
}

{
  const terminal = registroTerminal("env_1", "enviado", {
    dataEntradaFila: iso(AGORA - 2 * 60 * 60 * 1000),
    finalizadoEm: iso(AGORA - 90 * 60 * 1000)
  });
  const model = construirReadModelPublicoPorMarcos({ clienteId: "cliente_marcos", hot: [], historicoLeve: [terminal], agoraMs: AGORA });
  assert.strictEqual(model.metricas.processadas, 1);
  assert.strictEqual(model.metricas.enviadas, 1);
  assert.strictEqual(model.listas.processadas.length, 1, "terminal tambem reconstroi marco Processada");
  const enviadas = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    hot: [],
    historicoLeve: [terminal],
    agoraMs: AGORA,
    visao: VISAO_ENVIADAS
  });
  assert.strictEqual(enviadas.listas.enviadas.length, 1, "mesma execucao pode existir na visao Enviadas");
}

{
  const parcial = registroTerminal("parcial_1", "parcial", {
    destinosEstado: [
      { destinoId: "a", destinoNome: "A", canal: "telegram", estado: "enviado" },
      { destinoId: "b", destinoNome: "B", canal: "telegram", estado: "erro" }
    ]
  });
  const falha = registroTerminal("falha_1", "nao_enviado", { motivo: "sem_destino_compativel" });
  const model = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    historicoLeve: [parcial, falha],
    agoraMs: AGORA,
    visao: VISAO_NAO_ENVIADAS
  });
  assert.strictEqual(model.metricas.parciais, 1);
  assert.strictEqual(model.metricas.naoEnviadas, 1);
  assert.strictEqual(model.listas.naoEnviadas[0].motivoPublico, "sem_destino_compativel");
}

{
  const enviadaA = registroTerminal("dup_1", "enviado", { chave: "chave_dup", finalizadoEm: iso(AGORA - 10 * 60 * 1000) });
  const enviadaB = registroTerminal("dup_1", "enviado", { chave: "chave_dup", finalizadoEm: iso(AGORA - 5 * 60 * 1000) });
  const enviadas = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    historicoLeve: [enviadaA, enviadaB],
    agoraMs: AGORA,
    visao: VISAO_ENVIADAS
  });
  const processadas = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    historicoLeve: [enviadaA, enviadaB],
    agoraMs: AGORA,
    visao: VISAO_PROCESSADAS
  });
  assert.strictEqual(enviadas.listas.enviadas.length, 1, "duplicata dentro da mesma visao e removida");
  assert.strictEqual(processadas.listas.processadas.length, 1);
}

{
  const inicial = {
    clienteId: "cliente_marcos",
    itens: [
      oferta("hot_a", { dataEntradaFila: iso(AGORA - 1000), status: "pendente" })
    ]
  };
  const depois = atualizarProjecaoHotPorItem(inicial, oferta("hot_a", {
    dataEntradaFila: iso(AGORA - 1000),
    status: "enviado",
    enviadoEm: iso(AGORA)
  }), { clienteId: "cliente_marcos", agoraMs: AGORA });
  assert.strictEqual(depois.total, 0, "HOT -> terminal remove da projecao hot");

  const parcialEmCurso = atualizarProjecaoHotPorItem({ clienteId: "cliente_marcos", itens: [] }, {
    ...oferta("hot_b", { dataEntradaFila: iso(AGORA - 1000), status: "enviado" }),
    statusPublico: "em_distribuicao",
    progresso: { enviados: 1, total: 2, pendentes: 1, erros: 0 }
  }, { clienteId: "cliente_marcos", agoraMs: AGORA });
  assert.strictEqual(parcialEmCurso.total, 1, "statusPublico em_distribuicao prevalece sobre statusOperacional enviado no HOT");
}

{
  const hotStale = oferta("stale_1", { dataEntradaFila: iso(AGORA - 60 * 60 * 1000), status: "pendente" });
  const historico = registroTerminal("stale_1", "enviado", { chave: "chave_stale_1" });
  const model = construirReadModelPublicoPorMarcos({ clienteId: "cliente_marcos", hot: [hotStale], historicoLeve: [historico], agoraMs: AGORA });
  assert.strictEqual(model.metricas.processadas, 1);
  assert.strictEqual(model.metricas.enviadas, 1, "historico prevalece contra hot stale");
  assert.strictEqual(model.metricas.emDistribuicao, 0);
  assert.strictEqual(model.diagnostico.hotRemovidosPorTerminal, 1);
}

{
  const filaMemoria = [
    oferta("mem_1", { dataEntradaFila: iso(AGORA - 1000), status: "pendente" }),
    oferta("mem_2", { dataEntradaFila: iso(AGORA - 1000), status: "enviado", enviadoEm: iso(AGORA) })
  ];
  const reconciliada = reconciliarProjecaoHotDaFila(filaMemoria, { clienteId: "cliente_marcos", agoraMs: AGORA });
  assert.strictEqual(reconciliada.projectionReady, true);
  assert.strictEqual(reconciliada.fonte, "fila_memoria");
  assert.strictEqual(reconciliada.projecao.total, 1, "reconcile de restart nao precisa reler fila.json e remove terminal");
}

{
  const bloqueado = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    hot: [oferta("not_ready", { dataEntradaFila: iso(AGORA - 1000) })],
    historicoLeve: [],
    agoraMs: AGORA,
    exigirProjectionReady: true,
    projectionReady: false
  });
  assert.strictEqual(bloqueado.ok, false, "reader publico nao serve estado antes do projectionReady");
  assert.strictEqual(bloqueado.motivo, "projection_not_ready");

  const pronto = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    hot: [oferta("ready", { dataEntradaFila: iso(AGORA - 1000) })],
    historicoLeve: [],
    agoraMs: AGORA,
    exigirProjectionReady: true,
    projectionReady: true
  });
  assert.strictEqual(pronto.ok, true);
  assert.strictEqual(pronto.metricas.processadas, 1);
}

{
  const filaFormalizada = [];
  const entrada = oferta("formalizada", { dataEntradaFila: iso(AGORA - 2000), status: "pendente" });
  const adicionou = adicionarOfertaFila(filaFormalizada, entrada, { logger: { log() {}, error() {} } });
  assert.strictEqual(adicionou, true);
  assert.strictEqual(filaFormalizada[0].dataEntradaFila, entrada.dataEntradaFila, "adicionarOfertaFila recebe item ja formalizado com dataEntradaFila");
}

{
  const virada = registroTerminal("virada_dia", "enviado", {
    dataEntradaFila: "2026-09-15T02:59:00.000Z",
    finalizadoEm: "2026-09-15T03:02:00.000Z"
  });
  const hojeProcessadas = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    historicoLeve: [virada],
    agoraMs: AGORA,
    periodo: "hoje",
    visao: VISAO_PROCESSADAS
  });
  assert.strictEqual(hojeProcessadas.metricas.processadas, 0, "Processadas hoje usa dataEntradaFila e exclui entrada de 14/09 23:59");
  assert.strictEqual(hojeProcessadas.metricas.enviadas, 1, "Enviadas hoje usa timestamp terminal de 15/09 00:02");
  assert.strictEqual(hojeProcessadas.metricas.emDistribuicao, 0, "terminal existente nao vira emDistribuicao artificial");
  assert.strictEqual(hojeProcessadas.metricas.fechaMatematicamente, false, "na virada, metricas por marco proprio podem nao fechar");

  const hojeEnviadas = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    historicoLeve: [virada],
    agoraMs: AGORA,
    periodo: "hoje",
    visao: VISAO_ENVIADAS
  });
  assert.strictEqual(hojeEnviadas.itens.length, 1, "Enviadas hoje lista o resultado enviado em 15/09 00:02");

  const seteDiasProcessadas = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    historicoLeve: [virada],
    agoraMs: AGORA,
    periodo: "7dias",
    visao: VISAO_PROCESSADAS
  });
  assert.strictEqual(seteDiasProcessadas.metricas.processadas, 1, "7 dias inclui Processada pelo marco de entrada");
  assert.strictEqual(seteDiasProcessadas.metricas.enviadas, 1, "7 dias inclui Enviada pelo marco terminal");
  assert.strictEqual(seteDiasProcessadas.metricas.fechaMatematicamente, true);
}

{
  const hot = Array.from({ length: 3 }, (_, i) => oferta(`hot_metric_${i}`, {
    dataEntradaFila: iso(AGORA - 30 * 60 * 1000 - i),
    status: "pendente"
  }));
  const hist = [
    ...Array.from({ length: 66 }, (_, i) => registroTerminal(`env_metric_${i}`, "enviado")),
    registroTerminal("falha_metric", "nao_enviado")
  ];
  const model = construirReadModelPublicoPorMarcos({ clienteId: "cliente_marcos", hot, historicoLeve: hist, agoraMs: AGORA });
  assert.strictEqual(model.metricas.processadas, 70);
  assert.strictEqual(model.metricas.enviadas, 66);
  assert.strictEqual(model.metricas.naoEnviadas, 1);
  assert.strictEqual(model.metricas.emDistribuicao, 3);
  assert.strictEqual(model.metricas.fechaMatematicamente, true);
}

{
  const hist = Array.from({ length: 60 }, (_, i) => registroTerminal(`pag_${i}`, i % 2 ? "enviado" : "nao_enviado", {
    dataEntradaFila: iso(AGORA - i * 1000),
    finalizadoEm: iso(AGORA - i * 1000),
    itemExtra: i
  }));
  const model = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    historicoLeve: hist,
    agoraMs: AGORA,
    visao: VISAO_ENVIADAS,
    filtros: { marketplace: "amazon", q: "Oferta pag_" },
    page: 2,
    limit: 10
  });
  assert.strictEqual(model.totalFiltrado, 30);
  assert.strictEqual(model.page, 2);
  assert.strictEqual(model.limit, 10);
  assert.strictEqual(model.itens.length, 10);
  assert.strictEqual(model.hasMore, true);
}

{
  const totalParciais = 59;
  const totalNaoEnviadas = 231;
  const totalComErro = totalParciais + totalNaoEnviadas;
  const hist = [
    ...Array.from({ length: totalParciais }, (_, i) => registroTerminal(`com_erro_parcial_${i}`, "parcial", {
      dataEntradaFila: iso(AGORA - 2 * 60 * 60 * 1000 - i),
      finalizadoEm: iso(AGORA - i * 1000),
      marketplace: i % 10 === 0 ? "mercadolivre" : "amazon",
      canal: i % 7 === 0 ? "whatsapp" : "telegram",
      destinoNome: i % 5 === 0 ? "Destino Especial" : "Canal principal",
      titulo: i % 11 === 0 ? `Oferta EspecialBusca Parcial ${i}` : `Oferta Parcial ${i}`,
      destinosEstado: [
        { destinoId: "ok", destinoNome: "Canal principal", canal: i % 7 === 0 ? "whatsapp" : "telegram", estado: "enviado" },
        { destinoId: "erro", destinoNome: "Destino falhou", canal: "telegram", estado: "erro" }
      ]
    })),
    ...Array.from({ length: totalNaoEnviadas }, (_, i) => registroTerminal(`com_erro_falha_${i}`, "nao_enviado", {
      dataEntradaFila: iso(AGORA - 3 * 60 * 60 * 1000 - i),
      finalizadoEm: iso(AGORA - (totalParciais + i) * 1000),
      marketplace: i % 10 === 0 ? "mercadolivre" : "amazon",
      canal: i % 7 === 0 ? "whatsapp" : "telegram",
      destinoNome: i % 5 === 0 ? "Destino Especial" : "Canal principal",
      titulo: i % 11 === 0 ? `Oferta EspecialBusca Falha ${i}` : `Oferta Falha ${i}`
    }))
  ];
  const esperadoGlobal = hist
    .map(registro => {
      const item = registro.item;
      return {
        id: item.id,
        finalizadoEm: timestampMsParaTeste(item.finalizadoEm),
        marketplace: item.marketplace,
        canal: item.canal,
        destinoNome: item.destinoNome,
        titulo: item.titulo
      };
    })
    .sort((a, b) => {
      if (b.finalizadoEm !== a.finalizadoEm) return b.finalizadoEm - a.finalizadoEm;
      return String(a.id).localeCompare(String(b.id));
    });
  const idsPaginaEsperada = (page, limit = 50) => esperadoGlobal
    .slice((page - 1) * limit, page * limit)
    .map(item => item.id);
  const ids = resultado => resultado.itens.map(item => item.id);
  const page1 = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    historicoLeve: hist,
    agoraMs: AGORA,
    periodo: "hoje",
    visao: VISAO_COM_ERRO,
    page: 1,
    limit: 50
  });
  const page2 = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    historicoLeve: hist,
    agoraMs: AGORA,
    periodo: "hoje",
    visao: VISAO_COM_ERRO,
    page: 2,
    limit: 50
  });
  assert.strictEqual(page1.totalFiltrado, totalComErro, "Com erro soma parciais reais e nao enviadas");
  assert.strictEqual(page1.metricas.comErro, totalComErro);
  assert.strictEqual(page1.totalPages, 6);
  assert.strictEqual(page1.hasMore, true);
  assert.deepStrictEqual(ids(page1), idsPaginaEsperada(1), "page=1 traz os 50 mais recentes globais");
  assert.deepStrictEqual(ids(page2), idsPaginaEsperada(2), "page=2 traz posicoes globais 51..100");
  assert.strictEqual(page2.totalFiltrado, totalComErro);
  assert.strictEqual(page2.page, 2);
  assert.strictEqual(page2.limit, 50);
  assert.strictEqual(page2.hasMore, true);
  const idsCombinados = [...ids(page1), ...ids(page2)];
  assert.strictEqual(new Set(idsCombinados).size, idsCombinados.length, "Com erro nao duplica entre paginas");
  assert(!ids(page2).some(id => idsPaginaEsperada(1).includes(id)), "page=2 nao repete page=1");

  const filtroMarketplace = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    historicoLeve: hist,
    agoraMs: AGORA,
    periodo: "hoje",
    visao: VISAO_COM_ERRO,
    filtros: { marketplace: "mercadolivre" },
    page: 1,
    limit: 50
  });
  assert.strictEqual(filtroMarketplace.totalFiltrado, esperadoGlobal.filter(item => item.marketplace === "mercadolivre").length, "filtro marketplace aplica antes da paginacao Com erro");

  const filtroCanal = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    historicoLeve: hist,
    agoraMs: AGORA,
    periodo: "hoje",
    visao: VISAO_COM_ERRO,
    filtros: { canal: "whatsapp" },
    page: 1,
    limit: 50
  });
  assert.strictEqual(filtroCanal.totalFiltrado, esperadoGlobal.filter(item => item.canal === "whatsapp").length, "filtro canal aplica antes da paginacao Com erro");

  const filtroBusca = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    historicoLeve: hist,
    agoraMs: AGORA,
    periodo: "hoje",
    visao: VISAO_COM_ERRO,
    filtros: { busca: "EspecialBusca" },
    page: 1,
    limit: 50
  });
  assert.strictEqual(
    filtroBusca.totalFiltrado,
    esperadoGlobal.filter(item => item.titulo.includes("EspecialBusca")).length,
    "busca aplica antes da paginacao Com erro"
  );

  const seteDias = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_marcos",
    historicoLeve: hist,
    agoraMs: AGORA,
    periodo: "7dias",
    visao: VISAO_COM_ERRO,
    page: 1,
    limit: 50
  });
  assert.strictEqual(seteDias.totalFiltrado, totalComErro, "periodo 7 dias mantem total Com erro do fixture");
}

{
  const antigo = registroTerminal("old_1", "enviado", { dataEntradaFila: iso(AGORA - 8 * DIA) });
  const recente = registroTerminal("new_1", "enviado", { dataEntradaFila: iso(AGORA - 6 * DIA) });
  const model = construirReadModelPublicoPorMarcos({ clienteId: "cliente_marcos", historicoLeve: [antigo, recente], agoraMs: AGORA, janelaDias: 7 });
  assert.strictEqual(model.metricas.processadas, 1, "janela de retencao publica e respeitada");
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-read-model-marcos-"));
  try {
    const histDir = path.join(dir, "hist");
    fs.mkdirSync(histDir, { recursive: true });
    fs.writeFileSync(path.join(histDir, "2026-09-07.jsonl"), `${JSON.stringify(registroTerminal("fora", "enviado", { dataEntradaFila: "2026-09-07T10:00:00.000Z" }))}\n`, "utf8");
    fs.writeFileSync(path.join(histDir, "2026-09-14.jsonl"), `${JSON.stringify(registroTerminal("dentro", "enviado", { dataEntradaFila: "2026-09-14T10:00:00.000Z" }))}\n`, "utf8");
    fs.writeFileSync(path.join(histDir, "2026-09-15.jsonl"), "{malformado\n", "utf8");
    const arquivos = arquivosHistoricoLevePorJanela(histDir, { agoraMs: AGORA, janelaDias: 7 });
    assert.deepStrictEqual(arquivos.map(a => path.basename(a)), ["2026-09-15.jsonl", "2026-09-14.jsonl"]);
    const leitura = lerHistoricoLeveJsonlPorJanela({ dir: histDir, agoraMs: AGORA, janelaDias: 7 });
    assert.strictEqual(leitura.registros.length, 1);
    assert.strictEqual(leitura.invalidos, 1);
    assert.strictEqual(leitura.leiturasFisicas, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

{
  const bench = benchmarkReadModelPublico({
    clienteId: "cliente_marcos",
    hot: [oferta("bench_hot", { dataEntradaFila: iso(AGORA - 1000), status: "pendente" })],
    historicoLeve: [registroTerminal("bench_env", "enviado")],
    agoraMs: AGORA,
    limit: 50
  });
  assert.strictEqual(bench.ok, true);
  assert.strictEqual(bench.metricas.processadas, 2);
  assert(bench.bytesResposta > 0);
}

console.log("fila-read-model-publico-marcos.test.js OK");
