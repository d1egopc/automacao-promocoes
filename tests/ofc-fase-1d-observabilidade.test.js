"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { performance } = require("node:perf_hooks");
const { criarDisponibilidadeRelacao } = require("../modules/engine/ofc/optional-relation-source");
const { consultarFluxoVivoOfc } = require("../modules/engine/ofc/live-flow.repository");
const { calcularFluxoVivoShadow } = require("../modules/engine/ofc/live-flow.service");
const repo = require("../modules/fila/fila-checkpoints-entrega.repository");
const { criarCheckpointEntregaFuncional } = require("../modules/fila/fila-checkpoint-entrega.service");
const { consultarEntregasConfirmadas } = require("../modules/engine/ofc/drainage-metrics.repository");
const { criarContadorFinalizacoes, criarMetricasDrenagemShadow } = require("../modules/engine/ofc/drainage-metrics.service");
const { lerFilaWorkspaceSnapshot, criarGateAbsorcaoShadowOfc } = require("../modules/engine/ofc/absorption-gate.service");
const { criarMedidorCiclo, comMedidorCiclo, medirSerializacaoExistente } = require("../modules/telemetria/ciclo-observabilidade");
const { finalizarOfertaEnviadaFila } = require("../utils/fila-ofertas");
const { avaliarShadow } = require("../modules/auto-gate/auto-gate-state-machine");

function criarFonte(clock = Date.now, coluna) {
  return criarDisponibilidadeRelacao({ relacao: coluna ? "fila_checkpoints_entrega" : "engine_reset_operacional_operacoes", coluna, clock });
}

test("A: Reset ausente evita query de negocio e revalida por TTL", async () => {
  let agora = Date.now();
  let existe = false;
  const chamadas = [];
  const consultar = async sql => {
    chamadas.push(sql);
    if (sql.includes("to_regclass")) return { ok: true, resultado: { rows: [{ existe }] } };
    return { ok: true, resultado: { rows: [{ total: 0, cutoff_reset_referencia: new Date(agora), total_antes_reset: 0, total_depois_reset: 0 }] } };
  };
  const disponibilidadeReset = criarFonte(() => agora);
  for (let i = 0; i < 21; i++) {
    const r = await consultarFluxoVivoOfc({ consultar, disponibilidadeReset });
    assert.equal(r.ok, true);
    assert.equal(r.primeiraTentativa.reset_disponibilidade, "AUSENTE");
    assert.equal(r.primeiraTentativa.total_antes_reset, null);
    const f = calcularFluxoVivoShadow({ dados: r, agoraMs: agora });
    assert.equal(f.primeiraTentativa.totalAntesReset, null);
    assert.equal(f.primeiraTentativa.resetDisponibilidade, "AUSENTE");
    agora += 1000;
  }
  assert.equal(chamadas.filter(s => s.includes("WITH reset AS")).length, 0);
  assert.equal(chamadas.filter(s => s.includes("to_regclass")).length, 1);
  agora += 300000;
  existe = true;
  const r = await consultarFluxoVivoOfc({ consultar, disponibilidadeReset });
  assert.equal(r.primeiraTentativa.reset_disponibilidade, "DISPONIVEL");
  assert.equal(r.primeiraTentativa.total_antes_reset, 0);
  assert.equal(chamadas.filter(s => s.includes("WITH reset AS")).length, 1);
  assert.equal(chamadas.filter(s => s.includes("to_regclass")).length, 2);
});

test("B: conexao/banco com erro nunca vira AUSENTE nem zero", async () => {
  for (const erro of [false, true]) {
    const consultar = async sql => {
      if (sql.includes("to_regclass")) {
        if (erro) throw new Error("ECONNRESET");
        return { ok: false, motivo: "timeout_aquisicao_shadow" };
      }
      return { ok: true, resultado: { rows: [{ total: 0 }] } };
    };
    const r = await consultarFluxoVivoOfc({ consultar, disponibilidadeReset: criarFonte() });
    assert.equal(r.primeiraTentativa.reset_disponibilidade, "DESCONHECIDO");
    assert.equal(r.primeiraTentativa.total_depois_reset, null);
  }
});

test("Reset disponivel que falha depois do probe volta a DESCONHECIDO", async () => {
  const consultar = async sql => sql.includes("to_regclass") ? { ok: true, resultado: { rows: [{ existe: true }] } }
    : sql.includes("WITH reset AS") ? { ok: false, motivo: "erro_consulta_shadow" }
      : { ok: true, resultado: { rows: [{ total: 0 }] } };
  const r = await consultarFluxoVivoOfc({ consultar, disponibilidadeReset: criarFonte() });
  assert.equal(r.ok, true);
  assert.equal(r.primeiraTentativa.reset_disponibilidade, "DESCONHECIDO");
  assert.equal(r.primeiraTentativa.total_antes_reset, null);
});

test("Reset disponivel sem referencia concluida preserva null; excecao de negocio invalida cache", async () => {
  for (const falhar of [false, true]) {
    const fonte = criarFonte();
    const consultar = async sql => {
      if (sql.includes("to_regclass")) return { ok: true, resultado: { rows: [{ existe: true }] } };
      if (sql.includes("WITH reset AS") && falhar) throw new Error("conexao_encerrada");
      return { ok: true, resultado: { rows: [{ total: 0, cutoff_reset_referencia: null }] } };
    };
    const r = await consultarFluxoVivoOfc({ consultar, disponibilidadeReset: fonte });
    assert.equal(r.primeiraTentativa.total_antes_reset, null);
    assert.equal(r.primeiraTentativa.reset_disponibilidade, falhar ? "DESCONHECIDO" : "DISPONIVEL");
    assert.equal(r.primeiraTentativa.motivo_reset_indisponivel, falhar ? "erro_diagnostico_reset" : "sem_reset_concluido");
  }
});

test("Probe concorrente e compartilhado; resultado invalido continua desconhecido", async () => {
  const fonte = criarFonte();
  let chamadas = 0;
  const consultar = async () => { chamadas++; await Promise.resolve(); return { ok: true, resultado: { rows: [] } }; };
  const resultados = await Promise.all([fonte.observar(consultar), fonte.observar(consultar)]);
  assert.equal(chamadas, 1);
  assert(resultados.every(r => r.estado === "DESCONHECIDO"));
});

// Modelo local, sem banco. As escritas usam o repository real e o modelo
// verifica o SQL de timestamp/CAS. Nao substitui teste integrado PostgreSQL.
function criarCheckpointsMemoria() {
  const linhas = new Map();
  let agora = Date.now();
  const id = p => JSON.stringify(p.slice(0, 4));
  const client = { async query(sql, p = []) {
    const s = sql.replace(/\s+/g, " ");
    const key = id(p);
    let linha = linhas.get(key);
    if (/INSERT INTO fila_checkpoints_entrega/.test(s)) {
      if (linha) return { rows: [], rowCount: 0 };
      linha = { cliente_id: p[0], fila_item_id: p[1], destino_chave: p[2], alvo_chave: p[3], attempt_id: p[4],
        estado: "preparado", criado_em: new Date(agora).toISOString(), atualizado_em: new Date(agora).toISOString(), confirmado_em: null };
      linhas.set(key, linha);
    } else if (s.includes("SET estado = $7")) {
      assert.match(s, /confirmado_em = CASE WHEN \$7 = 'enviado' THEN COALESCE\(confirmado_em, clock_timestamp\(\)\) ELSE confirmado_em END/);
      assert.match(s, /attempt_id = \$5 AND estado = \$6/);
      if (!linha || linha.attempt_id !== p[4] || linha.estado !== p[5]) return { rows: [], rowCount: 0 };
      linha.estado = p[6];
      linha.provider_message_id = p[7];
      if (p[6] === "enviado" && !linha.confirmado_em) linha.confirmado_em = new Date(agora).toISOString();
      linha.atualizado_em = new Date(agora).toISOString();
    } else if (s.includes("SET credito_debitado = TRUE")) {
      assert.doesNotMatch(s, /SET[\s\S]*confirmado_em\s*=/);
      if (!linha || linha.estado !== "enviado" || linha.attempt_id !== p[4]) return { rows: [], rowCount: 0 };
      linha.credito_debitado = true;
      linha.atualizado_em = new Date(agora).toISOString();
    } else if (s.includes("SELECT cliente_id")) {
      return { rows: linha ? [{ ...linha }] : [], rowCount: linha ? 1 : 0 };
    } else throw new Error("sql_nao_modelado");
    return { rows: [{ ...linha }], rowCount: 1 };
  } };
  const entrada = (destino = "telegram:a", alvo = "chat:a") => ({ clienteId: "cliente_a", filaItemId: "item_a", destinoChave: destino,
    alvoChave: alvo, attemptId: "11111111-1111-4111-8111-111111111111" });
  const consultar = async (sql, p) => {
    assert.doesNotMatch(sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bCREATE\b|\bALTER\b/i);
    if (sql.includes("pg_attribute")) return { ok: true, resultado: { rows: [{ existe: true }] } };
    assert.match(sql, /estado = 'enviado' AND confirmado_em >= statement_timestamp\(\)/);
    assert.match(sql, /confirmado_em <= statement_timestamp\(\)/);
    assert.match(sql, /LIMIT 100/);
    const grupos = new Map();
    for (const l of linhas.values()) {
      const tempo = l.confirmado_em ? Date.parse(l.confirmado_em) : NaN;
      if (l.estado !== "enviado" || !Number.isFinite(tempo) || tempo < agora - p[0] * 60000 || tempo > agora) continue;
      const k = JSON.stringify([l.cliente_id, l.destino_chave]);
      const d = grupos.get(k) || { cliente_id: l.cliente_id, destino_chave: l.destino_chave, total: 0 };
      d.total++; grupos.set(k, d);
    }
    return { ok: true, resultado: { rows: [{ total: [...grupos.values()].reduce((n, d) => n + d.total, 0),
      destinos_total: grupos.size, por_destino: [...grupos.values()],
      historico_sem_timestamp: [...linhas.values()].some(l => l.estado === "enviado" && !l.confirmado_em), observado_em: new Date(agora) }] } };
  };
  const disponibilidade = criarFonte(() => agora, "confirmado_em");
  return { linhas, client, entrada, clock: () => agora, avancar: ms => { agora += ms; },
    ler: () => consultarEntregasConfirmadas({ consultar, disponibilidade }),
    async criar(e = entrada()) { return repo.criarCheckpointEntrega(e, { client }); },
    async iniciar(e = entrada()) { return repo.transicionarCheckpointEntrega({ ...e, deEstado: "preparado", paraEstado: "envio_iniciado" }, { client }); },
    async confirmar(e = entrada()) { return repo.transicionarCheckpointEntrega({ ...e, deEstado: "envio_iniciado", paraEstado: "enviado", providerMessageId: "provider-a" }, { client }); }
  };
}

test("C: checkpoint preparado nao e entrega, mesmo com debito", async () => {
  const f = criarCheckpointsMemoria(); await f.criar();
  [...f.linhas.values()][0].credito_debitado = true;
  assert.equal((await f.ler()).total, 0);
});

test("D: envio_iniciado e resultado ambiguo nao contam", async () => {
  const f = criarCheckpointsMemoria(); await f.criar(); await f.iniciar();
  assert.equal((await f.ler()).total, 0);
  await repo.transicionarCheckpointEntrega({ ...f.entrada(), deEstado: "envio_iniciado", paraEstado: "resultado_ambiguo" }, { client: f.client });
  assert.equal((await f.ler()).total, 0);
  assert.equal([...f.linhas.values()][0].confirmado_em, null);
});

test("E/I: provider aceito + persistencia conta uma vez, inclusive reprocessamento", async () => {
  const f = criarCheckpointsMemoria();
  const repository = Object.fromEntries(["criarCheckpointEntrega", "obterCheckpointEntrega", "transicionarCheckpointEntrega", "registrarCreditoDebitadoCheckpointEntrega"].map(k => [k, e => repo[k](e, { client: f.client })]));
  const service = criarCheckpointEntregaFuncional({ repository, logger: { log() {} } });
  let envios = 0;
  const args = { clienteId: "cliente_a", oferta: { id: "item_a" }, destinoChave: "telegram:a", alvoChave: "chat:a", canal: "telegram",
    reservaParDuravel: true, exigirProviderMessageId: true, enviar: async () => { envios++; return { providerMessageId: "telegram-1" }; } };
  assert.equal((await service.executar(args)).resultado, "enviado");
  assert.equal((await f.ler()).total, 1);
  assert.equal((await service.executar(args)).resultado, "checkpoint_existente");
  assert.equal((await f.ler()).total, 1);
  assert.equal(envios, 1);
});

test("F: debito posterior nao altera horario nem repoe entrega fora da janela", async () => {
  const f = criarCheckpointsMemoria(); await f.criar(); await f.iniciar();
  const enviado = await f.confirmar();
  const horario = enviado.checkpoint.confirmadoEm;
  assert(horario);
  f.avancar(60000);
  await repo.registrarCreditoDebitadoCheckpointEntrega(f.entrada(), { client: f.client });
  assert.equal([...f.linhas.values()][0].confirmado_em, horario);
  assert.notEqual([...f.linhas.values()][0].atualizado_em, horario);
  assert.equal((await f.ler()).total, 1);
  f.avancar(15 * 60000);
  await repo.registrarCreditoDebitadoCheckpointEntrega(f.entrada(), { client: f.client });
  assert.equal((await f.ler()).total, 0);
});

test("Resposta do provider sem confirmado persistido nao entra no throughput", async () => {
  const f = criarCheckpointsMemoria();
  const executarSql = f.client.query.bind(f.client);
  f.client.query = async (sql, params) => sql.includes("SET estado = $7") && params[6] === "enviado"
    ? { rows: [], rowCount: 0 } : executarSql(sql, params);
  const repository = Object.fromEntries(["criarCheckpointEntrega", "obterCheckpointEntrega", "transicionarCheckpointEntrega", "registrarCreditoDebitadoCheckpointEntrega"].map(k => [k, e => repo[k](e, { client: f.client })]));
  const service = criarCheckpointEntregaFuncional({ repository, logger: { log() {} } });
  const r = await service.executar({ clienteId: "cliente_a", oferta: { id: "item_a" }, destinoChave: "telegram:a", alvoChave: "chat:a", canal: "telegram",
    reservaParDuravel: true, exigirProviderMessageId: true, enviar: async () => ({ providerMessageId: "telegram-1" }) });
  assert.equal(r.respostaExternaConfirmada, true);
  assert.equal(r.ok, false);
  assert.equal((await f.ler()).total, 0);
});

test("G/H: fanout parcial conserva transporte; 3 destinos e 1 finalizacao somente apos terminal persistido", async () => {
  const f = criarCheckpointsMemoria();
  for (const destino of ["telegram:a", "whatsapp:b", "discord:c"]) {
    const e = f.entrada(destino); await f.criar(e); await f.iniciar(e); await f.confirmar(e);
  }
  const oferta = { id: "item_a", clienteId: "cliente_a", status: "pendente", destinosEnviados: [{ id: "a" }, { id: "b" }, { id: "c" }] };
  const contar = item => { const c = criarContadorFinalizacoes({ clienteId: "cliente_a", agoraMs: f.clock() }); c.observar(item); c.observar(item); return c.resumo(); };
  const montar = item => criarMetricasDrenagemShadow({ agoraMs: f.clock(), consultarConfirmacoes: f.ler,
    fluxoComercial: { ok: true, enviosConfirmadosPorMinuto: 0, observadoEmMs: f.clock() },
    gateAbsorcao: { ok: true, finalizacoesComerciaisObservadas: { ...contar(item), disponivel: true, completo: true } } });
  const parcial = await montar(oferta);
  assert.equal(parcial.throughputEntregasConfirmadasPorDestino.total, 3);
  assert.equal(parcial.throughputEntregasConfirmadasPorDestino.porDestino.length, 3);
  assert.equal(parcial.finalizacoesComerciaisPorOferta.total, 0);
  assert.equal(parcial.outputRate.valor, 0);
  const terminal = finalizarOfertaEnviadaFila([oferta], oferta, { clienteId: "cliente_a", enviadoEm: new Date(f.clock()).toISOString() });
  assert.equal(terminal.ok, true);
  const completo = await montar(terminal.oferta);
  assert.equal(completo.throughputEntregasConfirmadasPorDestino.total, 3);
  assert.equal(completo.finalizacoesComerciaisPorOferta.total, 1);
  assert.equal(completo.usoDecisorio, false);
});

test("Identidade por alvo e workspace nao colapsa destinos com multiplos alvos", async () => {
  const f = criarCheckpointsMemoria();
  for (const e of [f.entrada(), f.entrada("telegram:a", "chat:b"), { ...f.entrada(), clienteId: "cliente_b" }]) {
    await f.criar(e); await f.iniciar(e); await f.confirmar(e);
  }
  const r = await f.ler();
  assert.equal(r.total, 3);
  assert.equal(r.porDestino.length, 2);
});

test("Timestamp ausente/antigo/futuro nao vira confirmacao recente; schema ausente nao falha repetidamente", async () => {
  const f = criarCheckpointsMemoria(); await f.criar(); await f.iniciar(); await f.confirmar();
  [...f.linhas.values()][0].confirmado_em = null;
  const observado = await f.ler(); assert.equal(observado.total, 0); assert.equal(observado.historicoSemTimestamp, true);
  let queries = 0;
  const disponibilidade = criarFonte(Date.now, "confirmado_em");
  const consultar = async () => { queries++; return { ok: true, resultado: { rows: [{ existe: false }] } }; };
  for (let i = 0; i < 3; i++) {
    const r = await consultarEntregasConfirmadas({ consultar, disponibilidade });
    assert.equal(r.ok, false); assert.equal(r.disponibilidade.estado, "AUSENTE");
  }
  assert.equal(queries, 1);
  [...f.linhas.values()][0].confirmado_em = new Date(f.clock() + 1000).toISOString();
  assert.equal((await f.ler()).total, 0);
});

test("Fonte indisponivel e campos desconhecidos publicam null, nao zero", async () => {
  const r = await criarMetricasDrenagemShadow({ consultarConfirmacoes: async () => { throw new Error("db offline"); } });
  assert.equal(r.throughputEntregasConfirmadasPorDestino.valor, null);
  assert.equal(r.finalizacoesComerciaisPorOferta.valor, null);
  assert.equal(r.outputRate.valor, null);
  assert.equal(r.throughputEntregasConfirmadasPorDestino.qualidadeFonte, "INDISPONIVEL");
});

test("Observacao da fila reutiliza snapshot, nao altera oferta e indica alcance parcial", async () => {
  const agora = Date.now();
  const item = Object.freeze({ id: "item_a", status: "enviado", enviadoEm: new Date(agora - 1000).toISOString(),
    titulo: "Oferta oficial", preco: 12, precoAnterior: 15, cupom: "REAL10", imagem: "https://oficial/image", link: "https://produto", linkAfiliado: "https://afiliado" });
  let leituras = 0;
  const r = await criarGateAbsorcaoShadowOfc({ agoraMs: agora, clock: () => agora,
    usuarios: [{ id: "cliente_a", creditos: 100 }], listarClientesAtivos: () => ["cliente_a"], destinosPorCliente: {},
    configsPorCliente: {}, configPadrao: {}, consultarEventosAbsorcao: async () => ({ ok: true, porWorkspace: [] }),
    readFilaSnapshot: () => { leituras++; return { ok: true, itens: [item, item], collectedAtMs: agora }; }
  });
  assert.equal(leituras, 1); assert.equal(r.finalizacoesComerciaisObservadas.total, 1);
  assert.equal(item.linkAfiliado, "https://afiliado"); assert.equal(item.cupom, "REAL10");
  const c = criarContadorFinalizacoes({ clienteId: "a", agoraMs: agora });
  c.observar({ status: "enviado", id: "sem_tempo" });
  assert.equal(c.resumo().semIdentidadeOuHorario, 1);
  assert.equal(c.resumo().total, 0);
});

test("Medidor cobre cauda sincrona, encerra timers e serializa apenas o payload existente", async () => {
  let t = 0, encerramentos = 0, desativacoes = 0;
  const m = criarMedidorCiclo({ clock: () => t, wallClock: Date.now,
    monitor: () => ({ max: 0, enable() {}, disable() { desativacoes++; } }),
    setTimer: () => ({ unref() {} }), clearTimer: () => { encerramentos++; } });
  await m.medir("gate", async () => { t += 500; });
  let serializacoes = 0;
  await comMedidorCiclo(m, () => {
    assert.equal(medirSerializacaoExistente({ toJSON() { serializacoes++; return { ok: true }; } }), '{"ok":true}');
  });
  const r = m.finalizar();
  assert.equal(r.etapasMs.gate, 500); assert.equal(r.eventLoopLagMaxMs, 480);
  assert.equal(r.serializacao.chamadas, 1); assert.equal(serializacoes, 1);
  assert.equal(m.finalizar(), r); assert.equal(encerramentos, 1); assert.equal(desativacoes, 1);
});

test("Instrumentacao leitura/parse conta arquivos/itens sem reler ou serializar snapshot", () => {
  const m = criarMedidorCiclo();
  let chamadas = 0;
  const r = lerFilaWorkspaceSnapshot("a", { medidorCiclo: m, getClienteJsonPath: () => "arquivo_injetado",
    readFileSync: () => { chamadas++; return '[{"id":"a"}]'; } });
  const perf = m.finalizar();
  assert.equal(r.ok, true); assert.equal(chamadas, 1); assert.equal(perf.leiturasFilas.arquivos, 1);
  assert.equal(perf.leiturasFilas.itens, 1); assert.equal(perf.leiturasFilas.arquivosComBytesConhecidos, 0);
  assert.equal(perf.serializacao.chamadas, 0);
});

function carregarIsolado(arquivo, stubs, logs) {
  const local = path.join(__dirname, "..", arquivo);
  const requireReal = createRequire(local);
  const context = { module: { exports: {} }, require: n => stubs[n] || requireReal(n),
    console: { log: (tag, payload) => logs.push({ tag, payload }) }, process, Date, setTimeout, clearTimeout, setInterval, clearInterval };
  vm.runInNewContext(fs.readFileSync(local, "utf8"), context, { filename: local });
  return context.module.exports;
}

test("Controller publica 3 metricas, preserva ambos logs completos e mede etapas", async () => {
  const logs = [];
  const metrics = { consumoReal: {}, reservatorio: { porMarketplace: [], porCliente: [] } };
  const controller = carregarIsolado("modules/engine/ofc/controller.runner.js", {
    "./metrics.service": { coletarMetricasOfc: async () => metrics },
    "./planner.service": { criarPlanoShadowOfc: () => ({}) },
    "./active-queue.service": { criarFilaAtivaShadowOfc: async () => ({ ok: true }) },
    "./live-flow.service": { criarFluxoVivoShadowOfc: async () => ({ ok: true }) },
    "./commercial-flow.service": { criarFluxoComercialShadowOfc: async () => ({ ok: true, enviosConfirmadosPorMinuto: 0 }) },
    "./absorption-gate.service": { criarGateAbsorcaoShadowOfc: async () => ({ ok: true, workspaces: [], resumo: {}, finalizacoesComerciaisObservadas: { disponivel: true, total: 0, completo: true } }) },
    "../../ofc-v2/auditoria-ofc": { criarAuditoriaOfcV24Shadow: () => ({ ok: false }) }
  }, logs);
  const r = await controller.executarObservabilidadeOfc({ drenagem: { consultarConfirmacoes: async () => ({ ok: false }) } });
  assert.equal(r.ok, true); assert.equal(r.drenagem.outputRate.valor, 0);
  assert.equal(r.drenagem.throughputEntregasConfirmadasPorDestino.valor, null);
  assert.equal(r.drenagem.finalizacoesComerciaisPorOferta.total, 0);
  for (const e of ["coletaInicial", "filaAtiva", "fluxoVivo", "fluxoComercial", "absorptionGate", "metricasDrenagem"]) assert(e in r.observabilidadeCiclo.etapasMs);
  const tags = ["[OFC-GATE-ABSORCAO-DINAMICO-SHADOW]", "[OFC-GATE-ESTEIRA-VIVA-SHADOW]"];
  for (const tag of tags) assert.deepEqual(JSON.parse(logs.find(l => l.tag === tag).payload).workspaces, []);
});

test("Engine mede ciclo/pulos e nao espera Auto Gate nem altera sequencia comercial", async () => {
  const logs = [];
  const ordem = [];
  let liberar;
  const bloqueado = new Promise(resolve => { liberar = resolve; });
  const engine = carregarIsolado("modules/engine/orchestrator.runner.js", {
    "./ofc": { executarObservabilidadeOfc: async () => { await bloqueado; ordem.push("ofc"); return { ok: true }; } },
    "../auto-gate/auto-gate-shadow.service": { createAutoGateShadow: () => ({ observe: () => { ordem.push("autoGate"); return new Promise(() => {}); } }) },
    "./auto-clean/auto-clean.service": { autoCleanShadowAtivo: () => false },
    "../telemetria/engine-memory-stage": { criarMedidorEngineMemoryStage: () => ({ fim() {} }), registrarPontoEngineMemoryStage() {}, resumirJobsPorEtapaEngineMemory: () => ({}) }
  }, logs);
  const opcoes = { processarJobsPendentesEngine: async () => { ordem.push("processar"); return {}; },
    validarJobsDiagnosticadosEngine: async () => { ordem.push("validar"); return {}; },
    importarJobsProntosEngine: async a => { ordem.push(`importar:${a.marketplace}`); return {}; },
    distribuirOfertasEngine: async a => { ordem.push(`distribuir:${a.marketplace}`); return {}; } };
  const rodando = engine.executarRodadaEngineOrquestrador(opcoes);
  const pulado = await engine.executarRodadaEngineOrquestrador(opcoes);
  assert.equal(pulado.pulado, true); liberar();
  const r = await rodando; assert.equal(r.ok, true);
  assert.deepEqual(ordem.slice(0, 4), ["ofc", "autoGate", "processar", "validar"]);
  const perf = JSON.parse(logs.find(l => l.tag === "[ENGINE-CICLO-PERF-SHADOW]").payload);
  assert("ofc" in perf.etapasMs); assert("processar" in perf.etapasMs); assert("distribuir_magalu" in perf.etapasMs);
  const pulo = logs.find(l => l.tag === "[ENGINE-ORQUESTRADOR-PULADO-EM-EXECUCAO]").payload;
  assert(pulo.rodadaAnteriorId); assert(pulo.idadeRodadaAnteriorMs >= 0);
});

test("Custo incremental local da instrumentacao, sem I/O real nem snapshots adicionais", () => {
  const texto = JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ id: String(i), status: "pendente", titulo: "Produto oficial" })));
  const opts = { getClienteJsonPath: () => "fixture", readFileSync: () => texto };
  for (let i = 0; i < 20; i++) lerFilaWorkspaceSnapshot("a", opts);
  const rodadas = 200;
  const inicioBase = performance.now();
  for (let i = 0; i < rodadas; i++) lerFilaWorkspaceSnapshot("a", opts);
  const baseMs = performance.now() - inicioBase;
  const inicioMedido = performance.now();
  for (let i = 0; i < rodadas; i++) {
    const m = criarMedidorCiclo(); lerFilaWorkspaceSnapshot("a", { ...opts, medidorCiclo: m });
    assert.equal(m.finalizar().serializacao.chamadas, 0);
  }
  const medidoMs = performance.now() - inicioMedido;
  console.log("PERF_FASE_1D_LOCAL", JSON.stringify({ rodadas, itensPorRodada: 1000, bytesFixture: Buffer.byteLength(texto),
    baseMs, medidoMs, deltaPorRodadaMs: (medidoMs - baseMs) / rodadas, incluiIOMetadados: false }));
});

test("Novas metricas nao mudam estados, evidence, dwell, cooldown ou autoridade", () => {
  let historicoA = {}, historicoB = {};
  for (let ciclo = 0; ciclo < 30; ciclo++) {
    const saturada = ciclo > 5 && ciclo < 20;
    const m = { ok: true, observedAtMs: Date.now(), sinaisAusentes: [], inputTotal: 5, inputRadar: 5, inputTeleRadar: 0,
      outputRate: saturada ? 0 : 2, queueDepthActionable: saturada ? 100 : 0,
      oldestActionableAge: saturada ? 1200000 : 0, capacityEffective: saturada ? 0 : 10,
      freshReserveObservada: 0, capacityUnknownWorkspaces: 0, capacityEffectiveComplete: true,
      observedWorkspaceScope: "global", radarOperacional: { enabled: true, withinSchedule: true, sourceConfigured: true },
      teleRadarOperacional: { enabled: false, withinSchedule: true, listenerActive: true, accountAuthorized: true, selectedSourceCount: 1 } };
    const a = avaliarShadow(m, historicoA);
    const b = avaliarShadow({ ...m, drenagemObservacional: { outputRate: { valor: 9999 },
      throughputEntregasConfirmadasPorDestino: { valor: ciclo % 2 ? null : 9999 }, finalizacoesComerciaisPorOferta: { valor: 9999 } } }, historicoB);
    assert.deepEqual(a, b);
    assert.notEqual(b.autorizadoParaExecucao, true);
    historicoA = a.history; historicoB = b.history;
  }
});
