const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  criarGateAbsorcaoShadowOfc,
  montarGateWorkspace,
  classificarEstadoEsteira
} = require("../modules/engine/ofc/absorption-gate.service");
const {
  consultarEventosAbsorcaoPorWorkspace
} = require("../modules/engine/ofc/absorption-gate.repository");

const agora = Date.parse("2026-07-31T22:00:00.000Z");

const destinoApto = {
  ativo: true,
  tipo: "telegram",
  botToken: "token",
  chatId: "123",
  horarioInicio: "00:00",
  horarioFim: "23:59",
  intervaloMinutos: 5
};

const filaUserLivre = [];
const filaUserSaturado = [
  { id: "a", status: "pendente", criadoEm: new Date(agora - 40 * 60 * 1000).toISOString() },
  { id: "b", status: "pendente", criadoEm: new Date(agora - 20 * 60 * 1000).toISOString() },
  { id: "c", status: "pendente", criadoEm: new Date(agora - 10 * 60 * 1000).toISOString() },
  { id: "d", status: "enviado", criadoEm: new Date(agora - 60 * 60 * 1000).toISOString() }
];

const gateLivre = montarGateWorkspace({
  clienteId: "user_livre",
  usuario: { id: "user_livre" },
  destinos: [destinoApto],
  fila: { quantidadeFilaAtual: 0, idadeItemMaisAntigoFila: null },
  eventos: { ofertasCriadas: 1, enviosConfirmados: 1 },
  janelaMinutos: 15
});
assert.strictEqual(gateLivre.estado, "LIVRE");
assert.strictEqual(gateLivre.janelaAbertaAgora, true);
assert.strictEqual(gateLivre.destinosAptos, 1);
assert.strictEqual(gateLivre.capacidadeTeorica, 3);
assert.strictEqual(gateLivre.quantidadeQueAceitariaAgora, 3);
assert.strictEqual(gateLivre.aplicouMudancas, undefined);

const gateSaturado = montarGateWorkspace({
  clienteId: "user_saturado",
  usuario: { id: "user_saturado" },
  destinos: [destinoApto],
  fila: { quantidadeFilaAtual: 3, idadeItemMaisAntigoFila: 40 * 60 * 1000 },
  eventos: { ofertasCriadas: 5, enviosConfirmados: 0 },
  janelaMinutos: 15
});
assert.strictEqual(gateSaturado.estado, "SATURADA");
assert.strictEqual(gateSaturado.quantidadeQueAceitariaAgora, 0);
assert.strictEqual(gateSaturado.quantidadeQueRecusariaAgora, 1);
assert.strictEqual(gateSaturado.idadeMaisAntiga, 40 * 60 * 1000);

const gateFechado = montarGateWorkspace({
  clienteId: "user_fechado",
  usuario: { id: "user_fechado" },
  destinos: [{ ...destinoApto, horarioInicio: "23:58", horarioFim: "23:59" }],
  fila: { quantidadeFilaAtual: 0, idadeItemMaisAntigoFila: null },
  eventos: {},
  janelaMinutos: 15
});
assert.strictEqual(["FECHADA", "LIVRE", "ESTAVEL", "LIMITADA", "SATURADA"].includes(gateFechado.estado), true);

const classificadoFechado = classificarEstadoEsteira({
  automacaoAtiva: false,
  janelaAbertaAgora: false,
  destinosAptos: 0,
  capacidadeTeorica: 0,
  capacidadeLivre: 0,
  quantidadeFilaAtual: 0
});
assert.strictEqual(classificadoFechado.estado, "FECHADA");

(async () => {
  const gate = await criarGateAbsorcaoShadowOfc({
    janelaMinutos: 15,
    usuarios: [
      { id: "user_livre" },
      { id: "user_saturado" }
    ],
    listarClientesAtivos: () => ["user_livre", "user_saturado"],
    destinosPorCliente: {
      user_livre: [destinoApto],
      user_saturado: [destinoApto]
    },
    agoraMs: agora,
    readClienteJson: (clienteId, arquivo, fallback) => {
      if (arquivo !== "fila.json") return fallback;
      if (clienteId === "user_saturado") return filaUserSaturado;
      return filaUserLivre;
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
  assert.strictEqual(gate.totalWorkspaces, 2);
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_livre").estado, "LIVRE");
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_saturado").estado, "SATURADA");
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_saturado").quantidadeFilaAtual, 3);
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_saturado").consumoComercialUltimos15Min, 0);
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_saturado").entradaComercialUltimos15Min, 5);
  assert.strictEqual(gate.resumo.porEstado.LIVRE, 1);
  assert.strictEqual(gate.resumo.porEstado.SATURADA, 1);

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
  assert(controller.includes("[OFC-GATE-ABSORCAO-SHADOW]"));
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