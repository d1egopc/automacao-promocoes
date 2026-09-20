"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  VISAO_PROCESSADAS,
  VISAO_ENVIADAS,
  VISAO_NAO_ENVIADAS,
  VISAO_COM_ERRO,
  construirReadModelPublicoPorMarcos
} = require("../modules/fila/fila-read-model-publico");

const AGORA = Date.parse("2026-09-15T15:00:00.000Z");
const DIA = 24 * 60 * 60 * 1000;

function iso(ms) {
  return new Date(ms).toISOString();
}

function oferta(id, extra = {}) {
  return {
    id,
    clienteId: "cliente_rotas",
    titulo: extra.titulo || `Oferta ${id}`,
    marketplace: extra.marketplace || "amazon",
    preco: "R$ 99,90",
    imagem: `https://img.example/${id}.jpg`,
    linkOriginal: `https://loja.test/produto/${id}`,
    dataEntradaFila: extra.dataEntradaFila || iso(AGORA - 60 * 60 * 1000),
    status: extra.status || "pendente",
    canal: extra.canal || "telegram",
    destinoNome: extra.destinoNome || "Canal principal",
    metadata: { pesado: true },
    radarMirror: { pesado: true },
    ofertaUniversal: { pesado: true },
    ofcV24: { pesado: true },
    ...extra
  };
}

function terminal(id, statusPublico, extra = {}) {
  const finalizadoEm = extra.finalizadoEm || iso(AGORA - 30 * 60 * 1000);
  return {
    chave: `chave_${id}`,
    clienteId: "cliente_rotas",
    statusPublico,
    statusOperacional: statusPublico === "enviado" ? "enviado" : "erro_final",
    item: oferta(id, {
      status: statusPublico === "enviado" ? "enviado" : "erro_final",
      dataEntradaFila: extra.dataEntradaFila || iso(AGORA - 2 * 60 * 60 * 1000),
      finalizadoEm,
      enviadoEm: statusPublico === "enviado" ? finalizadoEm : "",
      motivo: extra.motivo !== undefined ? extra.motivo : (statusPublico === "nao_enviado" ? "sem_destino_compativel" : ""),
      destinosEstado: extra.destinosEstado,
      marketplace: extra.marketplace || "amazon",
      destinoNome: extra.destinoNome || "Canal principal",
      ...(extra.titulo ? { titulo: extra.titulo } : {})
    })
  };
}

function rotaGetBloco(fonte, rota) {
  const inicio = fonte.indexOf(`app.get("${rota}"`);
  assert(inicio >= 0, `rota ${rota} existe`);
  const proxima = fonte.indexOf("\n});", inicio);
  assert(proxima > inicio, `rota ${rota} tem fechamento`);
  return fonte.slice(inicio, proxima + 4);
}

{
  const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const rotaFila = rotaGetBloco(fonte, "/fila");
  const rotaStatus = rotaGetBloco(fonte, "/fila/status");
  const rotaDetalhe = rotaGetBloco(fonte, "/fila/detalhe");

  assert(rotaFila.includes("consultarReadModelPublicoFila(clienteId, req.query"), "GET /fila usa helper leve");
  assert(fonte.includes("VISAO_COM_ERRO"), "GET /fila reconhece visao publica com_erro");
  assert(fonte.includes('"fila", "pendente", "pendentes", "processando"') && fonte.includes("return VISAO_FILA"), "estados operacionais devem mapear para a visao Fila");
  assert(fonte.includes('"erro", "erros", "falha", "falhas"') && fonte.includes("return VISAO_COM_ERRO"), "status=erro deve mapear para visao agregada com_erro");
  assert(rotaFila.includes("errosTotal: metricas.comErro"), "GET /fila deve expor alias erros como Erro publico agregado");
  assert(fonte.includes("metricasErrosAliasNaoEnviadas: false"), "Erro nao pode permanecer alias de nao_enviada/parcial");
  assert(rotaFila.includes("garantirReadModelPublicoPronto(clienteId"), "GET /fila respeita freshness/projectionReady");
  assert(!rotaFila.includes("fila: itensResposta"), "GET /fila nao duplica payload com alias fila");
  assert(!rotaFila.includes("fila.filter"), "GET /fila nao monta resposta a partir da fila pesada");
  assert(!rotaFila.includes("decorarItemFilaParaResposta"), "GET /fila nao espalha item operacional pesado");
  assert(!rotaFila.includes("filtrarItensHistoricoFila"), "GET /fila nao usa filtro legado sobre fila.json");

  assert(rotaStatus.includes("consultarReadModelPublicoFila(clienteId, { ...req.query, limit: 1 }, { somenteMetricas: true })"), "/fila/status usa caminho somente metricas");
  assert(rotaStatus.includes("garantirReadModelPublicoPronto(clienteId"), "/fila/status usa a mesma freshness");
  assert(rotaStatus.includes("erros: metricas.comErro"), "/fila/status deve expor erros como Erro publico agregado");
  assert(!rotaStatus.includes("fila.filter"), "/fila/status nao materializa lista pesada");
  assert(!rotaStatus.includes("itens:"), "/fila/status nao retorna pagina de itens");
  assert(!rotaStatus.includes("fila:"), "/fila/status nao retorna alias fila");

  assert(fonte.includes("app.get(\"/fila/detalhe\", auth"), "/fila/detalhe exige auth");
  assert(rotaDetalhe.includes("getClienteId(req)"), "/fila/detalhe usa clienteId autenticado");
  assert(!rotaDetalhe.includes("req.query.clienteId"), "/fila/detalhe nao aceita clienteId por query");
  assert(rotaDetalhe.includes("resolverDetalhePublicoFilaPorRef"), "/fila/detalhe usa resolver publico leve");
  assert(!rotaDetalhe.includes("readJsonCliente"), "/fila/detalhe nao le fila.json diretamente");

  const helper = fonte.slice(fonte.indexOf("function consultarReadModelPublicoFila"), fonte.indexOf("app.get(\"/fila\"", fonte.indexOf("function consultarReadModelPublicoFila")));
  assert(helper.includes("FILA_PROJECAO_LEVE_ARQUIVO"), "helper le projecao HOT leve");
  assert(helper.includes("HISTORICO_LEVE_INCREMENTAL_DIR"), "helper le historico leve JSONL");
  assert(!helper.includes("\"fila.json\""), "helper nao le fila.json");
  assert(!helper.includes("FILA_VIVA_ARQUIVO"), "helper nao usa fila-viva como autoridade publica");
}

{
  const hot = [
    oferta("hot_hoje", { dataEntradaFila: iso(AGORA - 10 * 60 * 1000), destinoNome: "Destino A" }),
    oferta("hot_ontem", { dataEntradaFila: iso(AGORA - 2 * DIA), marketplace: "mercadolivre", destinoNome: "Destino B" })
  ];
  const historico = [
    terminal("env_hoje", "enviado", { dataEntradaFila: iso(AGORA - 60 * 60 * 1000), titulo: "Notebook Gamer", destinoNome: "Destino A" }),
    terminal("falha_7d", "nao_enviado", { dataEntradaFila: iso(AGORA - 6 * DIA), marketplace: "mercadolivre", destinoNome: "Destino B" })
  ];

  const processadasHoje = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_rotas",
    hot,
    historicoLeve: historico,
    projectionReady: true,
    exigirProjectionReady: true,
    periodo: "hoje",
    visao: VISAO_PROCESSADAS,
    filtros: { periodo: "hoje" },
    page: 1,
    limit: 50,
    agoraMs: AGORA
  });
  assert.strictEqual(processadasHoje.ok, true);
  assert.strictEqual(processadasHoje.metricas.processadas, 1, "GET /fila processadas hoje exclui trabalho vivo");
  assert.strictEqual(processadasHoje.metricas.emDistribuicao, 1, "GET /fila contabiliza trabalho vivo somente na Fila");
  assert.strictEqual(processadasHoje.limit, 50, "paginacao limit=50 preservada");
  assert.strictEqual(processadasHoje.fila, undefined, "read model puro nao cria alias fila");

  const processadas7d = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_rotas",
    hot,
    historicoLeve: historico,
    projectionReady: true,
    periodo: "7dias",
    visao: VISAO_PROCESSADAS,
    filtros: { periodo: "7dias" },
    page: 1,
    limit: 50,
    agoraMs: AGORA
  });
  assert.strictEqual(processadas7d.metricas.processadas, 2, "GET /fila processadas 7 dias contem somente terminais completos");
  assert.strictEqual(processadas7d.metricas.emDistribuicao, 2);

  const enviadas = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_rotas",
    hot,
    historicoLeve: historico,
    projectionReady: true,
    periodo: "7dias",
    visao: VISAO_ENVIADAS,
    filtros: { periodo: "7dias" },
    page: 1,
    limit: 50,
    agoraMs: AGORA
  });
  assert.strictEqual(enviadas.metricas.enviadas, 1, "GET /fila enviadas");
  assert.strictEqual(enviadas.itens.length, 1);
  assert.strictEqual(enviadas.itens[0].statusPublico, "enviada", "status publico de sucesso deve ser Enviada");

  const naoEnviadas = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_rotas",
    hot,
    historicoLeve: historico,
    projectionReady: true,
    periodo: "7dias",
    visao: VISAO_NAO_ENVIADAS,
    filtros: { periodo: "7dias" },
    page: 1,
    limit: 50,
    agoraMs: AGORA
  });
  assert.strictEqual(naoEnviadas.metricas.naoEnviadas, 1, "GET /fila nao_enviadas");

  const comErro = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_rotas",
    hot,
    historicoLeve: [
      ...historico,
      terminal("parcial_7d", "parcial", {
        dataEntradaFila: iso(AGORA - 5 * DIA),
        titulo: "Fone com atencao",
        destinosEstado: [
          { destinoId: "ok", estado: "enviado" },
          { destinoId: "falhou", estado: "erro_final" }
        ]
      }),
      terminal("falha_real_7d", "nao_enviado", {
        dataEntradaFila: iso(AGORA - 5 * DIA),
        motivo: "erro_envio",
        destinosEstado: [{ destinoId: "falhou", estado: "erro_final" }]
      })
    ],
    projectionReady: true,
    periodo: "7dias",
    visao: VISAO_COM_ERRO,
    filtros: { periodo: "7dias" },
    page: 1,
    limit: 50,
    agoraMs: AGORA
  });
  assert.strictEqual(comErro.metricas.comErro, 2, "GET /fila com_erro soma excecoes reais");
  assert.strictEqual(comErro.totalFiltrado, 2);
  assert.strictEqual(comErro.itens.length, 2);
  assert(comErro.itens.every(item => item.statusPublico === "erro" && item.resultadoPublico === "erro"), "GET /fila com_erro deve expor somente status publico Erro");

  const marketplace = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_rotas",
    hot,
    historicoLeve: historico,
    projectionReady: true,
    periodo: "7dias",
    visao: VISAO_PROCESSADAS,
    filtros: { periodo: "7dias", marketplace: "mercadolivre" },
    page: 1,
    limit: 50,
    agoraMs: AGORA
  });
  assert.strictEqual(marketplace.metricas.processadas, 1, "filtro marketplace nao mistura HOT");

  const destino = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_rotas",
    hot,
    historicoLeve: historico,
    projectionReady: true,
    periodo: "7dias",
    visao: VISAO_PROCESSADAS,
    filtros: { periodo: "7dias", destino: "Destino B" },
    page: 1,
    limit: 50,
    agoraMs: AGORA
  });
  assert.strictEqual(destino.metricas.processadas, 1, "filtro destino nao mistura HOT");

  const busca = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_rotas",
    hot,
    historicoLeve: historico,
    projectionReady: true,
    periodo: "7dias",
    visao: VISAO_PROCESSADAS,
    filtros: { periodo: "7dias", busca: "Notebook" },
    page: 1,
    limit: 50,
    agoraMs: AGORA
  });
  assert.strictEqual(busca.metricas.processadas, 1, "busca por titulo/produto");

  const serializado = JSON.stringify(processadas7d.itens);
  for (const proibido of ["metadata", "radarMirror", "ofertaUniversal", "ofcV24", "pesado"]) {
    assert(!serializado.includes(proibido), `payload leve nao contem ${proibido}`);
  }
  assert(processadas7d.itens.every(item => item.detalheRef && item.timestamp), "linhas preservam detalheRef e timestamp");

  const status = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_rotas",
    hot,
    historicoLeve: historico,
    projectionReady: true,
    periodo: "7dias",
    visao: VISAO_PROCESSADAS,
    filtros: { periodo: "7dias" },
    somenteMetricas: true,
    page: 1,
    limit: 1,
    agoraMs: AGORA
  });
  assert.strictEqual(status.diagnostico.itensMaterializados, 0, "/fila/status nao materializa lista desnecessaria");
  assert.strictEqual(status.itens.length, 0);

  const bloqueado = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_rotas",
    hot,
    historicoLeve: historico,
    projectionReady: false,
    exigirProjectionReady: true,
    periodo: "7dias",
    visao: VISAO_PROCESSADAS,
    agoraMs: AGORA
  });
  assert.strictEqual(bloqueado.ok, false, "projectionReady respeitado");
  assert.strictEqual(bloqueado.motivo, "projection_not_ready");
}

console.log("fila-read-model-publico-rotas.test.js OK");
