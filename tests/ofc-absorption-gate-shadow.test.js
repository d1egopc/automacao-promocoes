const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  criarGateAbsorcaoShadowOfc,
  montarGateWorkspace,
  classificarEstadoEsteira,
  classificarStatusFila,
  resumoFilaWorkspace,
  capacidadeDestinoShadow
} = require("../modules/engine/ofc/absorption-gate.service");
const {
  consultarEventosAbsorcaoPorWorkspace
} = require("../modules/engine/ofc/absorption-gate.repository");

const agora = Date.parse("2026-07-31T22:00:00.000Z");

const destinoApto = {
  id: "destino_a",
  ativo: true,
  tipo: "telegram",
  botToken: "token",
  chatId: "123",
  horarioInicio: "00:00",
  horarioFim: "23:59",
  intervaloMinutos: 5
};

const destinoTurbo = {
  ...destinoApto,
  id: "destino_turbo",
  cupomTurbo: true,
  intervaloTurboMinutos: 2.5
};

const filaComHistorico = [
  { id: "p1", status: "pendente", criadoEm: new Date(agora - 20 * 60 * 1000).toISOString() },
  { id: "p2", status: "enviando", criadoEm: new Date(agora - 10 * 60 * 1000).toISOString() },
  { id: "p3", status: "erro_temporario", criadoEm: new Date(agora - 5 * 60 * 1000).toISOString() },
  ...Array.from({ length: 500 }, (_, i) => ({ id: `h${i}`, status: "enviado", criadoEm: new Date(agora - 60 * 60 * 1000).toISOString() })),
  { id: "erro_final", status: "erro", criadoEm: new Date(agora - 50 * 60 * 1000).toISOString() },
  { id: "cancelado", status: "cancelado", criadoEm: new Date(agora - 50 * 60 * 1000).toISOString() },
  { id: "expirado", status: "expirado", criadoEm: new Date(agora - 50 * 60 * 1000).toISOString() }
];

assert.strictEqual(classificarStatusFila({ status: "pendente" }), "pendentesVivos");
assert.strictEqual(classificarStatusFila({ status: "enviando" }), "emTentativaEnvio");
assert.strictEqual(classificarStatusFila({ status: "erro_temporario" }), "errosTemporariosRecuperaveis");
assert.strictEqual(classificarStatusFila({ status: "enviado" }), "enviados");
assert.strictEqual(classificarStatusFila({ status: "erro" }), "errosFinais");

const resumoFila = resumoFilaWorkspace("user_pressao", {
  agoraMs: agora,
  readClienteJson: () => filaComHistorico
});
assert.strictEqual(resumoFila.pendentesVivos, 1);
assert.strictEqual(resumoFila.emTentativaEnvio, 1);
assert.strictEqual(resumoFila.errosTemporariosRecuperaveis, 1);
assert.strictEqual(resumoFila.pressaoEsteiraViva, 3);
assert.strictEqual(resumoFila.enviados, 500);
assert.strictEqual(resumoFila.totalEnviadosHistorico, 500);
assert.strictEqual(resumoFila.errosFinais, 1);
assert.strictEqual(resumoFila.cancelados, 1);
assert.strictEqual(resumoFila.expirados, 1);
assert.strictEqual(resumoFila.idadeMaisAntigaViva, 20 * 60 * 1000);

const capacidadeNormal = capacidadeDestinoShadow(destinoApto, 0, []);
assert.strictEqual(capacidadeNormal.aptoAgora, true);
assert.strictEqual(capacidadeNormal.intervaloNormal, 5);
assert.strictEqual(capacidadeNormal.turboAplicavel, false);
assert.strictEqual(capacidadeNormal.capacidade5Min, 1);
assert.strictEqual(capacidadeNormal.capacidade10Min, 2);
assert.strictEqual(capacidadeNormal.capacidade15Min, 3);

const capacidadeTurbo = capacidadeDestinoShadow(destinoTurbo, 0, []);
assert.strictEqual(capacidadeTurbo.turboAplicavel, true);
assert.strictEqual(capacidadeTurbo.intervaloEfetivo, 2.5);
assert.strictEqual(capacidadeTurbo.capacidade5Min, 2);
assert.strictEqual(capacidadeTurbo.capacidade10Min, 4);
assert.strictEqual(capacidadeTurbo.capacidade15Min, 6);

const capacidadeFechada = capacidadeDestinoShadow({ ...destinoApto, horarioInicio: "23:58", horarioFim: "23:59" }, 0, []);
assert.strictEqual(capacidadeFechada.aptoAgora, false);
assert.strictEqual(capacidadeFechada.capacidade15Min, 0);

const capacidadeInapta = capacidadeDestinoShadow({ ...destinoApto, cookiesVencidos: true }, 0, []);
assert.strictEqual(capacidadeInapta.integracaoApta, false);
assert.strictEqual(capacidadeInapta.capacidade15Min, 0);

const capacidadeLimiteZero = capacidadeDestinoShadow({ ...destinoApto, limiteDiario: 10, enviosHoje: 10 }, 0, []);
assert.strictEqual(capacidadeLimiteZero.limiteDiarioRestante, 0);
assert.strictEqual(capacidadeLimiteZero.capacidade15Min, 0);

const gateLivre = montarGateWorkspace({
  clienteId: "user_livre",
  usuario: { id: "user_livre" },
  destinos: [destinoApto, destinoTurbo],
  fila: { ...resumoFilaWorkspace("user_livre", { readClienteJson: () => [], agoraMs: agora }) },
  eventos: { ofertasCriadas: 1, enviosConfirmados: 1 },
  janelaMinutos: 15
});
assert.strictEqual(gateLivre.estado, "LIVRE");
assert.strictEqual(gateLivre.filaAlvo5Min, 3);
assert.strictEqual(gateLivre.filaAlvo10Min, 6);
assert.strictEqual(gateLivre.filaAlvo15Min, 9);
assert.strictEqual(gateLivre.capacidadeAbsorcaoAgora, 9);
assert.strictEqual(gateLivre.quantidadeQueAceitariaAgora, 9);
assert.strictEqual(gateLivre.turboAplicavel, true);
assert.strictEqual(gateLivre.aplicouMudancas, undefined);

const gateSaturado = montarGateWorkspace({
  clienteId: "user_saturado",
  usuario: { id: "user_saturado" },
  destinos: [destinoApto],
  fila: resumoFila,
  eventos: { ofertasCriadas: 5, enviosConfirmados: 0 },
  janelaMinutos: 15
});
assert.strictEqual(gateSaturado.estado, "SATURADA");
assert.strictEqual(gateSaturado.pressaoEsteiraViva, 3);
assert.strictEqual(gateSaturado.quantidadeFilaAtual, 3);
assert.strictEqual(gateSaturado.totalEnviadosHistorico, 500);
assert.strictEqual(gateSaturado.capacidadeAbsorcaoAgora, 0);
assert.strictEqual(gateSaturado.quantidadeQueRecusariaAgora, 1);
assert.strictEqual(gateSaturado.entrada15Min, 5);
assert.strictEqual(gateSaturado.saida15Min, 0);
assert.strictEqual(gateSaturado.entrandoMaisQueSaindo, true);
assert.strictEqual(gateSaturado.tempoEstimadoEsvaziarEsteira, null);

const gateFechado = montarGateWorkspace({
  clienteId: "user_fechado",
  usuario: { id: "user_fechado" },
  destinos: [{ ...destinoApto, horarioInicio: "23:58", horarioFim: "23:59" }],
  fila: resumoFilaWorkspace("user_fechado", { readClienteJson: () => [], agoraMs: agora }),
  eventos: {},
  janelaMinutos: 15
});
assert.strictEqual(gateFechado.estado, "FECHADA");
assert.strictEqual(gateFechado.capacidadeAbsorcaoAgora, 0);

const classificadoFechado = classificarEstadoEsteira({
  automacaoAtiva: false,
  janelaAbertaAgora: false,
  destinosAptos: 0,
  filaAlvo15Min: 0,
  capacidadeAbsorcaoAgora: 0,
  pressaoEsteiraViva: 0
});
assert.strictEqual(classificadoFechado.estado, "FECHADA");

(async () => {
  const gate = await criarGateAbsorcaoShadowOfc({
    janelaMinutos: 15,
    usuarios: [
      { id: "user_livre" },
      { id: "user_saturado" },
      { id: "user_fechado" }
    ],
    listarClientesAtivos: () => ["user_livre", "user_saturado", "user_fechado"],
    destinosPorCliente: {
      user_livre: [destinoApto, destinoTurbo],
      user_saturado: [destinoApto],
      user_fechado: [{ ...destinoApto, horarioInicio: "23:58", horarioFim: "23:59" }]
    },
    agoraMs: agora,
    readClienteJson: (clienteId, arquivo, fallback) => {
      if (arquivo !== "fila.json") return fallback;
      if (clienteId === "user_saturado") return filaComHistorico;
      return [];
    },
    consultarEventosAbsorcao: async () => ({
      ok: true,
      janelaMinutos: 15,
      porWorkspace: [
        { workspace_id: "user_livre", ofertas_criadas: 1, itens_adicionados_fila: 0, distribuicoes_finais: 0, envios_confirmados: 1, envios_erro_final: 0 },
        { workspace_id: "user_saturado", ofertas_criadas: 5, itens_adicionados_fila: 3, distribuicoes_finais: 0, envios_confirmados: 0, envios_erro_final: 0 }
      ]
    })
  });

  assert.strictEqual(gate.ok, true);
  assert.strictEqual(gate.modo, "shadow");
  assert.strictEqual(gate.aplicouMudancas, false);
  assert.strictEqual(gate.totalWorkspaces, 3);
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_livre").estado, "LIVRE");
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_saturado").estado, "SATURADA");
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_fechado").estado, "FECHADA");
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_saturado").pressaoEsteiraViva, 3);
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_saturado").totalEnviadosHistorico, 500);
  assert.strictEqual(gate.resumo.porEstado.LIVRE, 1);
  assert.strictEqual(gate.resumo.porEstado.SATURADA, 1);
  assert.strictEqual(gate.resumo.porEstado.FECHADA, 1);
  assert.strictEqual(gate.resumo.pressaoEsteiraViva, 3);

  const falha = await criarGateAbsorcaoShadowOfc({
    consultarEventosAbsorcao: async () => ({ ok: false, motivo: "query_falhou", erro: "db" })
  });
  assert.strictEqual(falha.ok, false);
  assert.strictEqual(falha.failSafe, true);
  assert.strictEqual(falha.aplicouMudancas, false);

  const sqls = [];
  const repo = await consultarEventosAbsorcaoPorWorkspace({
    janelaMinutos: 15,
    query: async (sql, params) => {
      sqls.push({ sql, params });
      return { ok: true, resultado: { rows: [] } };
    }
  });
  assert.strictEqual(repo.ok, true);
  assert.strictEqual(repo.janelaMinutos, 15);
  assert.strictEqual(sqls.length, 1);
  assert(sqls[0].sql.includes("engine_eventos_comerciais"));
  assert.strictEqual(/UPDATE|DELETE|INSERT/i.test(sqls[0].sql), false);

  const controller = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "ofc", "controller.runner.js"), "utf8");
  assert(controller.includes("[OFC-GATE-ABSORCAO-DINAMICO-SHADOW]"));
  assert(controller.includes("[OFC-GATE-ABSORCAO-ERRO]"));

  for (const arquivoWorker of [
    path.join("modules", "engine", "orchestrator.runner.js"),
    path.join("modules", "engine", "processor.runner.js"),
    path.join("modules", "engine", "processor.service.js"),
    path.join("modules", "engine", "importer", "importer.service.js"),
    path.join("modules", "engine", "distributor", "distributor.runner.js")
  ]) {
    const fonte = fs.readFileSync(path.join(__dirname, "..", arquivoWorker), "utf8");
    assert(!fonte.includes("absorption-gate"), `${arquivoWorker} nao deve depender do Gate de Absorcao`);
    assert(!fonte.includes("OFC-GATE-ABSORCAO"), `${arquivoWorker} nao deve emitir Gate de Absorcao`);
  }

  console.log("ofc-absorption-gate-shadow.test.js OK");
})().catch(e => {
  console.error(e);
  process.exit(1);
});