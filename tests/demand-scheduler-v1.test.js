"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  calcularDemandaDestino,
  criarDemandScheduler,
  demandSchedulerAtivo,
  ordenarCandidatosPorDemanda,
  ordenarDestinosPorDemanda
} = require("../modules/demand-scheduler/demand-scheduler.service");
const {
  resolverCadenciaDestino
} = require("../modules/engine/cadencia.service");

const AGORA = Date.parse("2026-09-27T12:00:00.000Z");

function destinoItem(id, {
  intervaloMin = 10,
  minutosDesdeEnvio = 0,
  liberado = false,
  turboAplicado = false
} = {}) {
  const intervaloMs = intervaloMin * 60 * 1000;
  const esperaMs = minutosDesdeEnvio * 60 * 1000;
  return {
    destino: { id, tipo: "telegram" },
    intervalo: {
      intervaloMs,
      intervaloAplicadoMin: intervaloMin,
      ultimoEnvio: AGORA - esperaMs,
      restanteMs: liberado ? 0 : Math.max(0, intervaloMs - esperaMs),
      liberado,
      turboAplicado
    },
    ultimoEnvio: AGORA - esperaMs
  };
}

{
  assert.strictEqual(demandSchedulerAtivo({}), false);
  assert.strictEqual(demandSchedulerAtivo({ DEMAND_SCHEDULER_ENABLED: "0" }), false);
  assert.strictEqual(demandSchedulerAtivo({ DEMAND_SCHEDULER_ENABLED: "1" }), true);
  assert.strictEqual(demandSchedulerAtivo({ DEMAND_SCHEDULER_ENABLED: "true" }), true);
}

{
  const baixa = calcularDemandaDestino(destinoItem("baixa", { minutosDesdeEnvio: 1 }), AGORA);
  const crescente = calcularDemandaDestino(destinoItem("crescente", { minutosDesdeEnvio: 8 }), AGORA);
  const alta = calcularDemandaDestino(destinoItem("alta", { minutosDesdeEnvio: 12, liberado: true }), AGORA);

  assert.strictEqual(baixa.nivel, "baixa", "destino que acabou de receber deve ter demanda baixa");
  assert.strictEqual(crescente.nivel, "crescente", "demanda deve crescer ao se aproximar da cadencia");
  assert.strictEqual(alta.nivel, "alta", "destino liberado/atrasado deve ter demanda alta");
  assert(baixa.valor < crescente.valor && crescente.valor < alta.valor);
}

{
  const ordenados = ordenarDestinosPorDemanda([
    destinoItem("normal_atrasado", { minutosDesdeEnvio: 20, liberado: true }),
    destinoItem("turbo_liberado", { intervaloMin: 1.5, minutosDesdeEnvio: 2, liberado: true, turboAplicado: true }),
    destinoItem("normal_baixo", { minutosDesdeEnvio: 1 })
  ], AGORA);

  assert.strictEqual(ordenados[0].destino.id, "turbo_liberado", "Turbo factual liberado usa faixa expressa");
  assert.strictEqual(ordenados[1].destino.id, "normal_atrasado", "normal atrasado vem antes de demanda baixa");
  assert.strictEqual(ordenados[2].destino.id, "normal_baixo");
}

{
  const legado = itens => [...itens].sort((a, b) => b.ranking.scoreFinal - a.ranking.scoreFinal);
  const normal = {
    elegivel: true,
    oferta: { id: "normal" },
    ranking: { scoreFinal: 100, fanoutUrgente: false },
    destinosLiberados: [destinoItem("normal", { minutosDesdeEnvio: 11, liberado: true })]
  };
  const turbo = {
    elegivel: true,
    oferta: { id: "turbo" },
    ranking: { scoreFinal: 20, fanoutUrgente: false },
    destinosLiberados: [destinoItem("turbo", { intervaloMin: 1.5, minutosDesdeEnvio: 2, liberado: true, turboAplicado: true })]
  };
  const fanoutUrgente = {
    elegivel: true,
    oferta: { id: "fanout_urgente" },
    ranking: { scoreFinal: 1, fanoutUrgente: true },
    destinosLiberados: [destinoItem("fanout", { minutosDesdeEnvio: 11, liberado: true })]
  };

  const ordenados = ordenarCandidatosPorDemanda([normal, turbo, fanoutUrgente], { agora: AGORA }, legado);
  assert.deepStrictEqual(
    ordenados.map(item => item.oferta.id),
    ["fanout_urgente", "turbo", "normal"],
    "fanout urgente permanece protegido e Turbo vence normal entre ofertas prontas"
  );
}

{
  const gates = [
    "fora_horario",
    "intervalo",
    "limite_diario",
    "sem_creditos",
    "categoria",
    "marketplace",
    "sessao_indisponivel",
    "dedupe",
    "destino_invalido"
  ];
  const bloqueados = gates.map((motivo, indice) => ({
    elegivel: false,
    motivo,
    oferta: { id: `bloqueada_${indice}` },
    ranking: { scoreFinal: 999 },
    destinosLiberados: [destinoItem(`destino_${indice}`, { liberado: true, turboAplicado: true })]
  }));
  const elegivel = {
    elegivel: true,
    oferta: { id: "elegivel" },
    ranking: { scoreFinal: 1 },
    destinosLiberados: [destinoItem("destino_elegivel", { minutosDesdeEnvio: 11, liberado: true })]
  };

  const resultado = ordenarCandidatosPorDemanda([...bloqueados, elegivel], { agora: AGORA }, itens => itens);
  assert.deepStrictEqual(resultado.map(item => item.oferta.id), ["elegivel"]);
  assert.deepStrictEqual(
    bloqueados.map(item => item.motivo),
    gates,
    "Scheduler nao converte nenhum gate homologado em elegibilidade"
  );
}

{
  const envOff = { DEMAND_SCHEDULER_ENABLED: "0" };
  const schedulerOff = criarDemandScheduler({ env: envOff, logger: { log() { throw new Error("nao deve logar OFF"); } } });
  const workspaces = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const destinos = [
    destinoItem("mais_novo", { minutosDesdeEnvio: 1 }),
    destinoItem("mais_antigo", { minutosDesdeEnvio: 5 })
  ];

  assert.deepStrictEqual(schedulerOff.ordenarWorkspaces(workspaces).map(item => item.id), ["a", "b", "c"]);
  assert.deepStrictEqual(
    schedulerOff.ordenarDestinos(destinos, AGORA).map(item => item.destino.id),
    ["mais_antigo", "mais_novo"],
    "OFF preserva a ordenacao legada por ultimo envio"
  );
  assert.doesNotThrow(() => schedulerOff.registrar("teste", { token: "segredo" }));
}

{
  const schedulerOff = criarDemandScheduler({
    env: {},
    logger: { log() { throw new Error("OFF nao deve produzir observabilidade"); } }
  });
  const candidatos = [
    { oferta: { id: "legado_b" }, ranking: { scoreFinal: 2 } },
    { oferta: { id: "legado_a" }, ranking: { scoreFinal: 1 } }
  ];
  const legado = itens => [...itens].sort((a, b) => a.ranking.scoreFinal - b.ranking.scoreFinal);
  const resultado = schedulerOff.ordenarCandidatos(candidatos, { agora: AGORA }, legado);

  assert.deepStrictEqual(resultado, legado(candidatos), "flag ausente deve ser equivalente ao seletor legado");
  assert.strictEqual(resultado[0], candidatos[1], "OFF nao deve reconstruir a oferta/candidato legado");
  assert.strictEqual(resultado[1], candidatos[0], "OFF preserva identidade e ordem efetiva do legado");
}

{
  const scheduler = criarDemandScheduler({
    env: { DEMAND_SCHEDULER_ENABLED: "1" },
    logger: { log() { throw new Error("logger_indisponivel"); } }
  });
  const candidato = {
    elegivel: true,
    oferta: { id: "fallback" },
    ranking: { scoreFinal: 1 },
    destinosLiberados: []
  };
  const ordenarLegado = itens => [...itens];
  assert.deepStrictEqual(
    scheduler.ordenarCandidatos([candidato], { agora: AGORA }, ordenarLegado).map(item => item.oferta.id),
    ["fallback"],
    "falha auxiliar nao interrompe o caminho homologado"
  );
  assert.doesNotThrow(() => scheduler.registrar("teste", { oferta: candidato.oferta }));
}

{
  const scheduler = criarDemandScheduler({
    env: { DEMAND_SCHEDULER_ENABLED: "1" },
    logger: { log() {} }
  });
  const oferta = {
    id: "oferta_failsafe",
    status: "pendente",
    preco: 99.9,
    creditosConsumidos: 0
  };
  const candidatoComErroInterno = {
    elegivel: true,
    oferta,
    ranking: { scoreFinal: 1 },
    get destinosLiberados() {
      throw new Error("erro_interno_forcado");
    }
  };
  let chamadasLegado = 0;
  const legado = itens => {
    chamadasLegado += 1;
    return [...itens];
  };

  const resultado = scheduler.ordenarCandidatos(
    [candidatoComErroInterno],
    { agora: AGORA },
    legado
  );

  assert.strictEqual(chamadasLegado, 2, "failsafe faz uma unica recuperacao legada apos a tentativa ON");
  assert.strictEqual(resultado.length, 1, "failsafe nao perde nem duplica oferta");
  assert.strictEqual(resultado[0], candidatoComErroInterno, "fallback usa o mesmo candidato da rodada");
  assert.strictEqual(oferta.status, "pendente", "Scheduler nao marca envio no failsafe");
  assert.strictEqual(oferta.creditosConsumidos, 0, "Scheduler nao consome credito no failsafe");
}

for (const total of [5, 25]) {
  const scheduler = criarDemandScheduler({
    env: { DEMAND_SCHEDULER_ENABLED: "1" },
    logger: { log() {} }
  });
  const workspaces = Array.from({ length: total }, (_, indice) => ({ id: `ws_${indice}` }));
  const primeiros = new Set();
  for (let rodada = 0; rodada < total; rodada++) {
    primeiros.add(scheduler.ordenarWorkspaces(workspaces)[0].id);
  }
  assert.strictEqual(primeiros.size, total, `fairness deve dar primeira oportunidade a ${total} workspaces`);
}

{
  const ativo = destinoItem("ativo", { minutosDesdeEnvio: 30, liberado: true });
  const aguardando = destinoItem("aguardando", { minutosDesdeEnvio: 20, liberado: true });
  const primeira = ordenarDestinosPorDemanda([ativo, aguardando], AGORA);
  assert.strictEqual(primeira[0].destino.id, "ativo", "maior demanda recebe a primeira oportunidade");

  ativo.intervalo.ultimoEnvio = AGORA;
  ativo.intervalo.restanteMs = ativo.intervalo.intervaloMs;
  ativo.intervalo.liberado = false;
  ativo.ultimoEnvio = AGORA;
  const segunda = ordenarDestinosPorDemanda([ativo, aguardando], AGORA);
  assert.strictEqual(
    segunda[0].destino.id,
    "aguardando",
    "destino recem atendido nao monopoliza a rodada seguinte"
  );
}

{
  const legado = itens => [...itens];
  const normal = {
    elegivel: true,
    oferta: { id: "normal_aguardando" },
    ranking: { scoreFinal: 1, fanoutUrgente: false },
    destinosLiberados: [destinoItem("normal", { minutosDesdeEnvio: 20, liberado: true })]
  };
  const turbo = {
    elegivel: true,
    oferta: { id: "turbo_factual" },
    ranking: { scoreFinal: 1, fanoutUrgente: false },
    destinosLiberados: [destinoItem("turbo", {
      intervaloMin: 1.5,
      minutosDesdeEnvio: 2,
      liberado: true,
      turboAplicado: true
    })]
  };
  assert.strictEqual(
    ordenarCandidatosPorDemanda([normal, turbo], { agora: AGORA }, legado)[0].oferta.id,
    "turbo_factual",
    "Turbo factual recebe prioridade quando elegivel"
  );

  turbo.elegivel = false;
  turbo.motivo = "intervalo";
  assert.deepStrictEqual(
    ordenarCandidatosPorDemanda([normal, turbo], { agora: AGORA }, legado).map(item => item.oferta.id),
    ["normal_aguardando"],
    "Turbo atendido/bloqueado volta aos gates e nao causa starvation permanente"
  );
}

{
  const legado = itens => [...itens];
  const normal = {
    elegivel: true,
    oferta: { id: "normal_pos_fanout" },
    ranking: { scoreFinal: 1, fanoutUrgente: false },
    destinosLiberados: [destinoItem("normal", { minutosDesdeEnvio: 11, liberado: true })]
  };
  const urgente = {
    elegivel: true,
    oferta: { id: "fanout_urgente" },
    ranking: { scoreFinal: 1, fanoutUrgente: true },
    destinosLiberados: [destinoItem("fanout", { minutosDesdeEnvio: 11, liberado: true })]
  };
  assert.strictEqual(
    ordenarCandidatosPorDemanda([normal, urgente], { agora: AGORA }, legado)[0].oferta.id,
    "fanout_urgente"
  );
  urgente.elegivel = false;
  urgente.motivo = "dedupe";
  assert.deepStrictEqual(
    ordenarCandidatosPorDemanda([normal, urgente], { agora: AGORA }, legado).map(item => item.oferta.id),
    ["normal_pos_fanout"],
    "fanout urgente concluido sai pela elegibilidade e os demais voltam a avancar"
  );
}

{
  const ofertaNormal = { marketplace: "mercadolivre", cupom: "" };
  const ofertaCupom = { marketplace: "mercadolivre", cupom: "PROMO", cupomConfirmado: true };
  const destinoTurboOn = { intervaloMinutos: 8, prioridadeCupomAtiva: true };
  const destinoTurboOff = { intervaloMinutos: 8, prioridadeCupomAtiva: false };

  const normal = resolverCadenciaDestino({
    destino: destinoTurboOn,
    oferta: ofertaNormal,
    cupomFastLaneTipo: () => ""
  });
  const cupomOn = resolverCadenciaDestino({
    destino: destinoTurboOn,
    oferta: ofertaCupom,
    cupomFastLaneTipo: () => "real_detectado"
  });
  const cupomOff = resolverCadenciaDestino({
    destino: destinoTurboOff,
    oferta: ofertaCupom,
    cupomFastLaneTipo: () => "real_detectado"
  });

  assert.strictEqual(normal.turboAplicado, false, "oferta normal nao vira Turbo");
  assert.strictEqual(cupomOn.turboAplicado, true, "cupom factual + Turbo ON usa faixa expressa");
  assert.strictEqual(cupomOn.intervaloEfetivoMin, 1.5, "faixa expressa homologada permanece em 1,5 minuto");
  assert.strictEqual(cupomOff.turboAplicado, false, "cupom factual + Turbo OFF permanece normal");
  assert.strictEqual(cupomOff.intervaloEfetivoMin, 8);
  assert.deepStrictEqual(ofertaCupom, { marketplace: "mercadolivre", cupom: "PROMO", cupomConfirmado: true });
}

{
  const shopee = resolverCadenciaDestino({
    destino: { intervaloMinutos: 8, prioridadeCupomAtiva: true },
    oferta: {
      marketplace: "shopee",
      linksComerciais: [{
        papel: "link_resgate",
        tipo: "resgate",
        renderizavel: true,
        conversaoStatus: "convertida",
        urlAfiliadaWorkspace: "https://s.shopee.com.br/resgate-factual"
      }]
    },
    cupomFastLaneTipo: () => "provavel"
  });
  const aliexpressDoisLinks = resolverCadenciaDestino({
    destino: { intervaloMinutos: 8, prioridadeCupomAtiva: true },
    oferta: {
      marketplace: "aliexpress",
      linksComerciais: [
        { papel: "link_produto", tipo: "app", urlAfiliadaWorkspace: "https://a.example/app" },
        { papel: "link_produto", tipo: "pc", urlAfiliadaWorkspace: "https://a.example/pc" }
      ]
    },
    cupomFastLaneTipo: () => ""
  });

  assert.strictEqual(shopee.turboAplicado, true, "resgate Shopee factual e renderizavel pode usar Turbo");
  assert.strictEqual(aliexpressDoisLinks.turboAplicado, false, "links APP+PC sozinhos nao caracterizam Turbo");
}

{
  const destinoTurbo = { intervaloMinutos: 8, prioridadeCupomAtiva: true };
  const produtoShopee = {
    papel: "link_produto",
    tipo: "produto",
    renderizavel: true,
    conversaoStatus: "convertida",
    urlAfiliadaWorkspace: "https://s.shopee.com.br/produto"
  };
  const resgateShopee = {
    papel: "link_resgate",
    tipo: "resgate",
    renderizavel: true,
    conversaoStatus: "convertida",
    urlAfiliadaWorkspace: "https://s.shopee.com.br/resgate"
  };
  const shopeeCupom = {
    marketplace: "shopee",
    cupom: "SHOPEE10",
    linksComerciais: [produtoShopee]
  };
  const shopeeResgate = {
    marketplace: "shopee",
    linksComerciais: [produtoShopee, resgateShopee]
  };
  const shopeeDoisComuns = {
    marketplace: "shopee",
    linksComerciais: [
      produtoShopee,
      { ...produtoShopee, urlAfiliadaWorkspace: "https://s.shopee.com.br/produto-2" }
    ]
  };
  const mlMulticupom = {
    marketplace: "mercadolivre",
    cupons: ["ML10", "ML20"],
    linksComerciais: [{ papel: "link_produto", urlAfiliadaWorkspace: "https://produto.mercadolivre.com.br/item" }]
  };
  const aliexpressComBeneficio = {
    marketplace: "aliexpress",
    cupom: "ALI15",
    linksComerciais: [
      { papel: "link_produto", tipo: "app", urlAfiliadaWorkspace: "https://a.example/app" },
      { papel: "link_produto", tipo: "pc", urlAfiliadaWorkspace: "https://a.example/pc" }
    ]
  };
  const snapshots = [shopeeCupom, shopeeResgate, shopeeDoisComuns, mlMulticupom, aliexpressComBeneficio]
    .map(oferta => JSON.stringify(oferta));

  const resultados = [
    resolverCadenciaDestino({ destino: destinoTurbo, oferta: shopeeCupom, cupomFastLaneTipo: () => "real_detectado" }),
    resolverCadenciaDestino({ destino: destinoTurbo, oferta: shopeeResgate, cupomFastLaneTipo: () => "provavel" }),
    resolverCadenciaDestino({ destino: destinoTurbo, oferta: shopeeDoisComuns, cupomFastLaneTipo: () => "" }),
    resolverCadenciaDestino({ destino: destinoTurbo, oferta: mlMulticupom, cupomFastLaneTipo: () => "real_detectado" }),
    resolverCadenciaDestino({ destino: destinoTurbo, oferta: aliexpressComBeneficio, cupomFastLaneTipo: () => "real_detectado" })
  ];

  assert.strictEqual(resultados[0].turboAplicado, true, "cupom factual Shopee e elegivel");
  assert.strictEqual(resultados[1].turboAplicado, true, "voucher/resgate factual Shopee e elegivel");
  assert.strictEqual(resultados[2].turboAplicado, false, "dois links comuns Shopee nao inventam beneficio");
  assert.strictEqual(resultados[3].turboAplicado, true, "um ou varios cupons factuais ML sao elegiveis");
  assert.strictEqual(resultados[4].turboAplicado, true, "AliExpress exige beneficio factual alem de APP+PC");
  assert.strictEqual(shopeeResgate.linksComerciais[0], produtoShopee, "produto permanece separado do resgate");
  assert.strictEqual(shopeeResgate.linksComerciais[1], resgateShopee, "resgate factual permanece separado");
  assert.strictEqual(mlMulticupom.linksComerciais.length, 1, "ML nao ganha link de resgate inventado");
  assert.deepStrictEqual(
    [shopeeCupom, shopeeResgate, shopeeDoisComuns, mlMulticupom, aliexpressComBeneficio].map(oferta => JSON.stringify(oferta)),
    snapshots,
    "cadencia/Turbo nao transforma o objeto comercial"
  );
}

{
  const oferta = {
    id: "imutavel",
    titulo: "Oferta factual",
    marketplace: "shopee",
    categoria: "casa",
    preco: 89.9,
    precoAnterior: 119.9,
    cupom: "CASA10",
    cupons: ["CASA10", "EXTRA5"],
    imagem: "https://imagem.example/oferta.jpg",
    link: "https://produto.example/item",
    linkResgate: "https://resgate.example/voucher",
    linksComerciais: [
      { papel: "link_produto", urlAfiliadaWorkspace: "https://produto.example/item" },
      { papel: "link_resgate", urlAfiliadaWorkspace: "https://resgate.example/voucher" }
    ],
    metadata: { marca: "marca", render: { template: "oficial", branding: "optimus" } },
    midia: { tipo: "imagem", template: "oficial" }
  };
  const snapshot = JSON.parse(JSON.stringify(oferta));
  const candidato = {
    elegivel: true,
    oferta,
    ranking: { scoreFinal: 1 },
    destinosLiberados: [destinoItem("imutavel", { liberado: true, turboAplicado: true })]
  };
  const resultado = ordenarCandidatosPorDemanda([candidato], { agora: AGORA }, itens => [...itens]);

  assert.deepStrictEqual(oferta, snapshot, "Scheduler nao altera verdade comercial da oferta");
  assert.strictEqual(resultado[0].oferta, oferta, "Scheduler preserva a mesma instancia comercial");
  assert.strictEqual(resultado[0].oferta.linksComerciais, oferta.linksComerciais);
  assert.strictEqual(resultado[0].oferta.metadata, oferta.metadata);
  assert.strictEqual(resultado[0].oferta.midia, oferta.midia);
}

{
  const logs = [];
  const scheduler = criarDemandScheduler({
    env: { DEMAND_SCHEDULER_ENABLED: "1" },
    logger: { log: (...args) => logs.push(args) }
  });
  scheduler.registrar("resultado_destino", {
    workspace: "workspace_1",
    destino: { id: "destino_1", botToken: "nao-logar" },
    demanda: { nivel: "alta", faixa: "turbo", esperaMs: 48_000 },
    elegivel: true,
    oferta: { id: "oferta_1", link: "nao-logar" },
    resultado: "despachado",
    token: "nao-logar"
  });
  const serializado = JSON.stringify(logs);
  assert(serializado.includes("workspace_1") && serializado.includes("destino_1"));
  assert(serializado.includes("despachado") && serializado.includes("turbo"));
  assert(!serializado.includes("nao-logar"), "observabilidade nao pode serializar payload, link ou token");
}

{
  const raiz = path.join(__dirname, "..");
  const fonteIndex = fs.readFileSync(path.join(raiz, "index.js"), "utf8");
  const fonteScheduler = fs.readFileSync(
    path.join(raiz, "modules", "demand-scheduler", "demand-scheduler.service.js"),
    "utf8"
  );

  assert(fonteIndex.includes("demandScheduler.ativo()"), "integracao deve permanecer protegida pela flag");
  assert(fonteIndex.includes(": ordenarOfertasFilaViva"), "OFF deve preservar seletor legado exato");
  assert(fonteIndex.includes("destinosComIntervalo.sort((a, b) => a.ultimoEnvio - b.ultimoEnvio)"), "OFF preserva ordem legada de destinos");
  assert(fonteIndex.includes("processarEnvioAutomaticoDestino({"), "envio continua no Executor homologado");
  assert(!fonteScheduler.includes("setInterval("), "Scheduler nao cria timer por destino");
  assert(!fonteScheduler.includes("readFile") && !fonteScheduler.includes("writeFile"), "Scheduler nao le nem grava filas");
  assert(!fonteScheduler.includes("JSON.parse"), "Scheduler nao faz parse de fila");
  assert(!fonteScheduler.includes("pg."), "Scheduler nao cria explosao SQL");
}

{
  const handlesAntes = typeof process._getActiveHandles === "function"
    ? process._getActiveHandles().length
    : 0;
  if (typeof global.gc === "function") global.gc();
  const heapAntes = process.memoryUsage().heapUsed;
  const scheduler = criarDemandScheduler({
    env: { DEMAND_SCHEDULER_ENABLED: "1" },
    logger: { log() {} }
  });
  const workspaces = Array.from({ length: 25 }, (_, indice) => ({ id: `perf_ws_${indice}` }));
  const candidatos = Array.from({ length: 250 }, (_, indice) => ({
    elegivel: true,
    oferta: { id: `perf_oferta_${indice}` },
    ranking: { scoreFinal: 250 - indice, fanoutUrgente: indice % 97 === 0 },
    destinosLiberados: [destinoItem(`perf_destino_${indice}`, {
      minutosDesdeEnvio: (indice % 20) + 1,
      liberado: indice % 3 === 0,
      turboAplicado: indice % 41 === 0
    })]
  }));
  const inicio = process.hrtime.bigint();
  for (let rodada = 0; rodada < 400; rodada += 1) {
    scheduler.ordenarWorkspaces(workspaces);
    scheduler.ordenarCandidatos(candidatos, { agora: AGORA + rodada }, itens => [...itens]);
  }
  const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
  if (typeof global.gc === "function") global.gc();
  const heapDepois = process.memoryUsage().heapUsed;
  const handlesDepois = typeof process._getActiveHandles === "function"
    ? process._getActiveHandles().length
    : handlesAntes;

  assert(duracaoMs < 5_000, `sanity de centenas de rodadas deve ser pequeno (${duracaoMs.toFixed(2)} ms)`);
  assert(heapDepois - heapAntes < 32 * 1024 * 1024, "sanity nao mostra crescimento evidente de heap");
  assert.strictEqual(handlesDepois, handlesAntes, "Scheduler nao deixa handles ativos");
}

console.log("demand-scheduler-v1.test.js OK");
