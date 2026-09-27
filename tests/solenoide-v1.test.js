"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

const {
  ACOES,
  ESTADOS,
  agregarSinaisOfc,
  classificarEstado,
  criarSolenoide,
  modoSolenoide,
  planoColetor
} = require("../modules/solenoide/solenoide.service");

function workspace({
  id = "workspace",
  estoque = 0,
  alvo = 4,
  estado = "LIVRE",
  ativo = true,
  fonteValida = true,
  historico = 0,
  inativo = 0,
  turboAplicavel = false
} = {}) {
  return {
    workspaceId: id,
    topologiaOperacionalPotencial: true,
    fonteFilaValida: fonteValida,
    automacaoExecutorAtiva: ativo,
    creditosExecutorAptos: true,
    destinosAptos: ativo ? 1 : 0,
    estadoDaEsteira: estado,
    queueDepthRaw: estoque + historico + inativo,
    queueDepthActionable: estoque,
    enviado_historico: historico,
    cancelado: inativo,
    turboAplicavel,
    bufferVivoShadow: {
      bufferAtualUtil: estoque,
      bufferAlvo: alvo,
      deficitBuffer: Math.max(0, alvo - estoque),
      pressaoPorMarketplace: { shopee: estoque }
    }
  };
}

function ofc(workspaces, extras = {}) {
  return {
    ok: true,
    observabilidadeCiclo: { eventLoopLagMaxMs: extras.lagMs || 0 },
    gateAbsorcao: {
      ok: true,
      snapshotCompleto: true,
      workspaces
    }
  };
}

function avaliarUmaVez(workspaces, pressaoSistema = {}) {
  const sinais = agregarSinaisOfc(ofc(workspaces), pressaoSistema);
  return { sinais, ...classificarEstado(sinais) };
}

const testes = [];
function teste(nome, fn) {
  testes.push({ nome, fn });
}

teste("01 demanda alta + estoque baixo abre", () => {
  const resultado = avaliarUmaVez([workspace({ estoque: 1, alvo: 8 })]);
  assert.strictEqual(resultado.estado, ESTADOS.ABERTO);
  assert.strictEqual(resultado.sinais.demanda.unidades, 7);
});

teste("02 demanda baixa + estoque suficiente fecha", () => {
  const resultado = avaliarUmaVez([workspace({ estoque: 8, alvo: 8 })]);
  assert.strictEqual(resultado.estado, ESTADOS.FECHADO);
});

teste("03 demanda alta + pressao alta nao abre agressivamente", () => {
  const resultado = avaliarUmaVez([workspace({ estoque: 1, alvo: 8, estado: "SATURADA" })]);
  assert.strictEqual(resultado.estado, ESTADOS.MODERADO);
});

teste("04 pico isolado nao muda estado estabilizado", () => {
  const solenoide = criarSolenoide({ env: { SOLENOID_SHADOW: "1" }, logger: { log() {} } });
  assert.strictEqual(solenoide.avaliar({ ofc: ofc([workspace({ estoque: 0, alvo: 6 })]) }).estado, ESTADOS.ABERTO);
  const pico = solenoide.avaliar({
    ofc: ofc([workspace({ estoque: 0, alvo: 6 })], { lagMs: 5000 })
  });
  assert.strictEqual(pico.estado, ESTADOS.ABERTO);
  assert.strictEqual(pico.estadoCandidato, ESTADOS.MODERADO);
});

teste("05 histerese evita abre/fecha continuo", () => {
  const solenoide = criarSolenoide({ env: { SOLENOID_SHADOW: "1" }, logger: { log() {} } });
  const vazio = ofc([workspace({ estoque: 0, alvo: 4 })]);
  const cheio = ofc([workspace({ estoque: 4, alvo: 4 })]);
  assert.strictEqual(solenoide.avaliar({ ofc: vazio }).estado, ESTADOS.ABERTO);
  assert.strictEqual(solenoide.avaliar({ ofc: cheio }).estado, ESTADOS.ABERTO);
  assert.strictEqual(solenoide.avaliar({ ofc: vazio }).estado, ESTADOS.ABERTO);
  assert.strictEqual(solenoide.avaliar({ ofc: cheio }).estado, ESTADOS.ABERTO);
  assert.strictEqual(solenoide.avaliar({ ofc: cheio }).estado, ESTADOS.FECHADO);
});

teste("06 workspace pequeno necessitado nao e mascarado pelo pesado cheio", () => {
  const resultado = avaliarUmaVez([
    workspace({ id: "pesado", estoque: 100, alvo: 10 }),
    workspace({ id: "pequeno", estoque: 0, alvo: 2 })
  ]);
  assert.strictEqual(resultado.estado, ESTADOS.ABERTO);
  assert.strictEqual(resultado.sinais.demanda.workspacesSemEstoqueUtil, 1);
});

teste("07 estoque bruto inutil nao conta como suficiente", () => {
  const resultado = avaliarUmaVez([workspace({ estoque: 0, alvo: 4, historico: 90, inativo: 10 })]);
  assert.strictEqual(resultado.sinais.estoque.util, 0);
  assert.strictEqual(resultado.estado, ESTADOS.ABERTO);
});

teste("08 historico/inativo nao entra no estoque util", () => {
  const sinais = agregarSinaisOfc(ofc([workspace({ estoque: 2, alvo: 5, historico: 900, inativo: 80 })]));
  assert.strictEqual(sinais.estoque.util, 2);
  assert.strictEqual(sinais.demanda.unidades, 3);
});

teste("09 Turbo factual nao e inventado a partir de toggle", () => {
  const sinais = agregarSinaisOfc(ofc([workspace({ estoque: 0, alvo: 2, turboAplicavel: true })]));
  assert.strictEqual(sinais.demanda.turboFactual, 0);
  const factual = agregarSinaisOfc(ofc([workspace({ estoque: 0, alvo: 2 })]), { turboFactual: 1 });
  assert.strictEqual(factual.demanda.turboFactual, 1);
});

teste("09b deficit zero explicito do OFC nao e recalculado", () => {
  const entrada = workspace({ estoque: 2, alvo: 5 });
  entrada.bufferVivoShadow.deficitBuffer = 0;
  const sinais = agregarSinaisOfc(ofc([entrada]));
  assert.strictEqual(sinais.demanda.unidades, 0);
});

teste("10 Manual/Extensao ficam fora do ponto de autoridade", () => {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "orchestrator.runner.js"), "utf8");
  assert(fonte.includes("executarImportacaoComSolenoide"));
  assert(!fonte.includes("manual-v2"));
  assert(!fonte.includes("extensao"));
});

teste("11 erro interno faz fail-open", () => {
  const solenoide = criarSolenoide({ env: { SOLENOID_ENABLED: "1" }, logger: { log() {} } });
  const decisao = solenoide.avaliar({ ofc: { ok: false } });
  const plano = solenoide.planoColetor(decisao, { marketplace: "amazon", limite: 20 });
  assert.strictEqual(decisao.failOpen, true);
  assert.strictEqual(plano.executar, true);
  assert.strictEqual(plano.limite, 20);
});

teste("12 Shadow calcula mas nao altera coleta", () => {
  const solenoide = criarSolenoide({ env: { SOLENOID_SHADOW: "1" }, logger: { log() {} } });
  const decisao = solenoide.avaliar({ ofc: ofc([workspace({ estoque: 9, alvo: 4 })]) });
  const plano = solenoide.planoColetor(decisao, { marketplace: "mercadolivre", limite: 20 });
  assert.strictEqual(decisao.estado, ESTADOS.FECHADO);
  assert.strictEqual(decisao.aplicouMudancas, false);
  assert.deepStrictEqual({ executar: plano.executar, limite: plano.limite }, { executar: true, limite: 20 });
});

teste("13 OFF e legado exato e silencioso", () => {
  let logs = 0;
  const solenoide = criarSolenoide({ env: {}, logger: { log() { logs += 1; } } });
  const entrada = ofc([workspace({ estoque: 99, alvo: 1 })]);
  const snapshot = JSON.stringify(entrada);
  const decisao = solenoide.avaliar({ ofc: entrada });
  const plano = solenoide.planoColetor(decisao, { marketplace: "shopee", limite: 17 });
  assert.strictEqual(modoSolenoide({}), "off");
  assert.strictEqual(decisao.legadoExato, true);
  assert.deepStrictEqual({ executar: plano.executar, limite: plano.limite }, { executar: true, limite: 17 });
  assert.strictEqual(JSON.stringify(entrada), snapshot);
  assert.strictEqual(logs, 0);
});

teste("14 objeto comercial nao e lido nem alterado", () => {
  const entrada = ofc([workspace({ estoque: 1, alvo: 3 })]);
  entrada.oferta = { preco: 99, cupom: "REAL", link: "https://example.test", imagem: "img", metadata: { x: 1 } };
  const snapshot = JSON.stringify(entrada);
  agregarSinaisOfc(entrada);
  assert.strictEqual(JSON.stringify(entrada), snapshot);
});

teste("15 Demand Scheduler permanece desacoplado", () => {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "modules", "solenoide", "solenoide.service.js"), "utf8");
  assert(!fonte.includes("demand-scheduler"));
  assert(!fonte.includes("ordenarCandidatos"));
});

teste("16 Worker OFC permanece somente produtor do resumo", () => {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "modules", "solenoide", "solenoide.service.js"), "utf8");
  assert(!fonte.includes("worker_threads"));
  assert(!fonte.includes("workspace-worker"));
  assert(!fonte.includes("readFile"));
});

teste("17 nao cria timer por destino/workspace", () => {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "modules", "solenoide", "solenoide.service.js"), "utf8");
  assert(!/setInterval|setTimeout/.test(fonte));
});

teste("18 sanity 25 workspaces e centenas de rodadas", () => {
  const workspaces = Array.from({ length: 25 }, (_, indice) => workspace({
    id: `ws_${indice}`,
    estoque: indice % 4,
    alvo: 4 + (indice % 3),
    estado: indice % 9 === 0 ? "LIMITADA" : "LIVRE"
  }));
  const solenoide = criarSolenoide({ env: { SOLENOID_SHADOW: "1" }, logger: { log() {} } });
  const handlesAntes = typeof process._getActiveHandles === "function" ? process._getActiveHandles().length : 0;
  const listenersAntes = process.eventNames().reduce((total, evento) => total + process.listenerCount(evento), 0);
  const inicioHeap = process.memoryUsage().heapUsed;
  const inicio = performance.now();
  for (let rodada = 0; rodada < 500; rodada += 1) {
    const decisao = solenoide.avaliar({ ofc: ofc(workspaces), rodadaId: `r_${rodada}` });
    assert([ESTADOS.ABERTO, ESTADOS.MODERADO, ESTADOS.FECHADO].includes(decisao.estado));
  }
  const duracaoMs = performance.now() - inicio;
  const deltaHeap = process.memoryUsage().heapUsed - inicioHeap;
  const handlesDepois = typeof process._getActiveHandles === "function" ? process._getActiveHandles().length : 0;
  const listenersDepois = process.eventNames().reduce((total, evento) => total + process.listenerCount(evento), 0);
  assert(duracaoMs < 1000, `sanity deve ser leve, observado ${duracaoMs.toFixed(1)} ms`);
  assert(deltaHeap < 20 * 1024 * 1024, `sem crescimento evidente de heap: ${deltaHeap}`);
  assert(handlesDepois <= handlesAntes + 1, `sem crescimento de handles: ${handlesAntes} -> ${handlesDepois}`);
  assert.strictEqual(listenersDepois, listenersAntes, "nenhum listener novo por rodada");
  console.log(`sanity - 25 workspaces x 500 rodadas: ${duracaoMs.toFixed(2)} ms; deltaHeap=${deltaHeap}; handles=${handlesAntes}->${handlesDepois}; listeners=${listenersAntes}->${listenersDepois}`);
});

teste("19 modo ativo aplica somente normal/reducao/pulo", () => {
  assert.deepStrictEqual(planoColetor({ estado: ESTADOS.ABERTO, aplicouMudancas: true }, { limite: 20 }), {
    marketplace: "", executar: true, limite: 20, alterou: false, motivo: "solenoide_aberto"
  });
  assert.strictEqual(planoColetor({ estado: ESTADOS.MODERADO, aplicouMudancas: true }, { limite: 20 }).limite, 10);
  assert.strictEqual(planoColetor({ estado: ESTADOS.FECHADO, aplicouMudancas: true }, { limite: 20 }).executar, false);
  assert.strictEqual(ACOES.REDUZIR, "reduzir_lote");
});

teste("20 log Shadow e pequeno e nao contem payload sensivel", () => {
  const logs = [];
  const solenoide = criarSolenoide({
    env: { SOLENOID_ENABLED: "1", SOLENOID_SHADOW: "1" },
    logger: { log: (...args) => logs.push(args) }
  });
  const entrada = ofc([workspace({ id: "nao_deve_logar_workspace", estoque: 0, alvo: 2 })]);
  entrada.token = "segredo";
  entrada.cookie = "segredo";
  const decisao = solenoide.avaliar({ ofc: entrada, rodadaId: "r1", coletores: ["shopee"] });
  const texto = JSON.stringify(logs);
  assert.strictEqual(decisao.modo, "shadow", "Shadow vence dupla flag e nao ganha autoridade");
  assert(texto.includes("[SOLENOID]") && texto.includes("shopee"));
  assert(!texto.includes("segredo") && !texto.includes("nao_deve_logar_workspace"));
  assert(texto.length < 3000);
});

function solenoideComDecisao({ modo = "active", estado = ESTADOS.FECHADO } = {}) {
  let agora = 1_800_000_000_000;
  const env = modo === "shadow" ? { SOLENOID_SHADOW: "1" } : { SOLENOID_ENABLED: "1" };
  const solenoide = criarSolenoide({ env, logger: { log() {} }, clock: () => agora });
  const fila = estado === ESTADOS.FECHADO
    ? [workspace({ estoque: 4, alvo: 4 })]
    : estado === ESTADOS.MODERADO
      ? [workspace({ estoque: 0, alvo: 4, estado: "SATURADA" })]
      : [workspace({ estoque: 0, alvo: 4 })];
  solenoide.avaliar({ ofc: ofc(fila) });
  return { solenoide, avancar: ms => { agora += ms; } };
}

teste("21 Radar manual OFF vence Solenoide", () => {
  const { solenoide } = solenoideComDecisao({ estado: ESTADOS.ABERTO });
  const resultado = solenoide.avaliarOrigem({ origem: "radar", manualAtivo: false, dentroHorario: true, solenoideAuto: true });
  assert.strictEqual(resultado.permitido, false);
  assert.strictEqual(resultado.bypass, "controle_manual_off");
});

teste("22 Radar fora do horario vence Solenoide", () => {
  const { solenoide } = solenoideComDecisao({ estado: ESTADOS.ABERTO });
  const resultado = solenoide.avaliarOrigem({ origem: "radar", manualAtivo: true, dentroHorario: false, solenoideAuto: true });
  assert.strictEqual(resultado.permitido, false);
  assert.strictEqual(resultado.bypass, "fora_horario");
});

teste("23 Radar Auto OFF preserva legado", () => {
  const { solenoide } = solenoideComDecisao({ estado: ESTADOS.FECHADO });
  const resultado = solenoide.avaliarOrigem({ origem: "radar", manualAtivo: true, dentroHorario: true, solenoideAuto: false });
  assert.strictEqual(resultado.permitido, true);
  assert.strictEqual(resultado.bypass, "toggle_off");
});

teste("24 Radar Auto ausente preserva legado", () => {
  const { solenoide } = solenoideComDecisao({ estado: ESTADOS.FECHADO });
  assert.strictEqual(solenoide.avaliarOrigem({ origem: "radar", manualAtivo: true, dentroHorario: true }).permitido, true);
});

teste("25 Radar Shadow calcula FECHADO sem bloquear", () => {
  const { solenoide } = solenoideComDecisao({ modo: "shadow", estado: ESTADOS.FECHADO });
  const resultado = solenoide.avaliarOrigem({ origem: "radar", manualAtivo: true, dentroHorario: true, solenoideAuto: true });
  assert.strictEqual(resultado.estado, ESTADOS.FECHADO);
  assert.strictEqual(resultado.permitido, true);
  assert.strictEqual(resultado.aplicouMudancas, false);
});

teste("26 Radar autoridade ativa respeita FECHADO", () => {
  const { solenoide } = solenoideComDecisao({ estado: ESTADOS.FECHADO });
  assert.strictEqual(solenoide.avaliarOrigem({ origem: "radar", manualAtivo: true, dentroHorario: true, solenoideAuto: true }).permitido, false);
});

teste("27 Radar MODERADO reduz sem timer e sem mutar entrada", () => {
  const { solenoide } = solenoideComDecisao({ estado: ESTADOS.MODERADO });
  const entrada = { origem: "radar", manualAtivo: true, dentroHorario: true, solenoideAuto: true };
  const snapshot = JSON.stringify(entrada);
  const primeiro = solenoide.avaliarOrigem(entrada);
  const segundo = solenoide.avaliarOrigem(entrada);
  assert.notStrictEqual(primeiro.permitido, segundo.permitido);
  assert.strictEqual(JSON.stringify(entrada), snapshot);
});

teste("28 TeleRadar manual OFF vence Solenoide", () => {
  const { solenoide } = solenoideComDecisao({ estado: ESTADOS.ABERTO });
  const resultado = solenoide.avaliarOrigem({ origem: "teleradar", manualAtivo: false, dentroHorario: true, solenoideAuto: true });
  assert.deepStrictEqual({ permitido: resultado.permitido, bypass: resultado.bypass }, { permitido: false, bypass: "controle_manual_off" });
});

teste("29 TeleRadar fora do horario vence Solenoide", () => {
  const { solenoide } = solenoideComDecisao({ estado: ESTADOS.ABERTO });
  const resultado = solenoide.avaliarOrigem({ origem: "teleradar", manualAtivo: true, dentroHorario: false, solenoideAuto: true });
  assert.deepStrictEqual({ permitido: resultado.permitido, bypass: resultado.bypass }, { permitido: false, bypass: "fora_horario" });
});

teste("30 TeleRadar Auto OFF preserva legado", () => {
  const { solenoide } = solenoideComDecisao({ estado: ESTADOS.FECHADO });
  assert.strictEqual(solenoide.avaliarOrigem({ origem: "teleradar", manualAtivo: true, dentroHorario: true, solenoideAuto: false }).permitido, true);
});

teste("31 TeleRadar campo ausente preserva legado", () => {
  const { solenoide } = solenoideComDecisao({ estado: ESTADOS.FECHADO });
  assert.strictEqual(solenoide.avaliarOrigem({ origem: "teleradar", manualAtivo: true, dentroHorario: true }).bypass, "toggle_off");
});

teste("32 TeleRadar Shadow nao ganha autoridade", () => {
  const { solenoide } = solenoideComDecisao({ modo: "shadow", estado: ESTADOS.FECHADO });
  const resultado = solenoide.avaliarOrigem({ origem: "teleradar", manualAtivo: true, dentroHorario: true, solenoideAuto: true });
  assert.strictEqual(resultado.permitido, true);
  assert.strictEqual(resultado.bypass, "shadow");
});

teste("33 TeleRadar autoridade ativa respeita FECHADO", () => {
  const { solenoide } = solenoideComDecisao({ estado: ESTADOS.FECHADO });
  assert.strictEqual(solenoide.avaliarOrigem({ origem: "teleradar", manualAtivo: true, dentroHorario: true, solenoideAuto: true }).permitido, false);
});

teste("34 Radar e TeleRadar possuem toggles independentes", () => {
  const { solenoide } = solenoideComDecisao({ estado: ESTADOS.FECHADO });
  const radar = solenoide.avaliarOrigem({ origem: "radar", manualAtivo: true, dentroHorario: true, solenoideAuto: true });
  const tele = solenoide.avaliarOrigem({ origem: "teleradar", manualAtivo: true, dentroHorario: true, solenoideAuto: false });
  assert.deepStrictEqual([radar.permitido, tele.permitido], [false, true]);
});

teste("35 independencia funciona tambem no sentido inverso", () => {
  const { solenoide } = solenoideComDecisao({ estado: ESTADOS.FECHADO });
  const radar = solenoide.avaliarOrigem({ origem: "radar", manualAtivo: true, dentroHorario: true, solenoideAuto: false });
  const tele = solenoide.avaliarOrigem({ origem: "teleradar", manualAtivo: true, dentroHorario: true, solenoideAuto: true });
  assert.deepStrictEqual([radar.permitido, tele.permitido], [true, false]);
});

teste("36 decisao expirada faz fail-open", () => {
  const { solenoide, avancar } = solenoideComDecisao({ estado: ESTADOS.FECHADO });
  avancar(6 * 60 * 1000);
  const resultado = solenoide.avaliarOrigem({ origem: "radar", manualAtivo: true, dentroHorario: true, solenoideAuto: true });
  assert.strictEqual(resultado.permitido, true);
  assert.strictEqual(resultado.failOpen, true);
});

teste("37 logs de origem sao compactos, anonimos e limitados", () => {
  const logs = [];
  const solenoide = criarSolenoide({
    env: { SOLENOID_SHADOW: "1" },
    logger: { log: (...args) => logs.push(args) },
    clock: () => 1_800_000_000_000
  });
  solenoide.avaliar({ ofc: ofc([workspace({ estoque: 4, alvo: 4 })]) });
  for (let indice = 0; indice < 20; indice += 1) {
    solenoide.avaliarOrigem({ origem: "radar", manualAtivo: true, dentroHorario: true, solenoideAuto: true, token: "segredo" });
  }
  const logsOrigem = logs.filter(item => String(item[1] || "").includes('"origem":"radar"'));
  assert.strictEqual(logsOrigem.length, 1);
  assert(!JSON.stringify(logsOrigem).includes("segredo"));
});

(async () => {
  for (const item of testes) {
    await item.fn();
    console.log(`ok - ${item.nome}`);
  }
  console.log(`Solenoide V1: ${testes.length}/${testes.length} testes passaram.`);
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
