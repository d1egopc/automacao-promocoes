const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  BUCKET_STATUS,
  CAMPOS_TIMESTAMP_FILA,
  criarGateAbsorcaoShadowOfc,
  montarGateWorkspace,
  classificarEstadoEsteira,
  classificarStatusFila,
  classificarItemEsteiraShadow,
  itemPressionaCapacidade,
  resumoFilaWorkspace,
  capacidadeDestinoShadow,
  timestampFila,
  slotsCobertura
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
  { id: "p1", status: "pendente", marketplace: "mercadolivre", destinoId: "destino_a", criadoEm: new Date(agora - 20 * 60 * 1000).toISOString(), cupom: "MODA10" },
  { id: "p2", status: "enviando", marketplace: "amazon", destinoId: "destino_a", dataEntradaFila: new Date(agora - 20 * 60 * 1000).toISOString() },
  { id: "p3", status: "erro_temporario", marketplace: "shopee", destinoId: "destino_b", adicionado_em: new Date(agora - 5 * 60 * 1000).toISOString() },
  { id: "velho", status: "pendente", marketplace: "mercadolivre", destinoId: "destino_a", criadoEm: new Date(agora - 35 * 60 * 1000).toISOString() },
  { id: "turbo_velho", status: "pendente", marketplace: "mercadolivre", destinoId: "destino_a", criadoEm: new Date(agora - 11 * 60 * 1000).toISOString(), cupomTurbo: true },
  { id: "cooldown_curto", status: "pendente", marketplace: "mercadolivre", destinoId: "destino_a", criadoEm: new Date(agora - 5 * 60 * 1000).toISOString(), proximaTentativaEnvioEm: new Date(agora + 5 * 60 * 1000).toISOString() },
  { id: "cooldown_longo", status: "pendente", marketplace: "mercadolivre", destinoId: "destino_a", criadoEm: new Date(agora - 5 * 60 * 1000).toISOString(), proximaTentativaEnvioEm: new Date(agora + 40 * 60 * 1000).toISOString() },
  { id: "inelegivel", status: "pendente", marketplace: "mercadolivre", destinoId: "destino_a", criadoEm: new Date(agora - 5 * 60 * 1000).toISOString(), motivo: "categoria_incompativel" },
  { id: "sem_timestamp", status: "pendente", marketplace: "amazon" },
  { id: "desconhecido", status: "misterioso", marketplace: "amazon", criadoEm: new Date(agora - 5 * 60 * 1000).toISOString() },
  ...Array.from({ length: 500 }, (_, i) => ({ id: `h${i}`, status: "enviado", criadoEm: new Date(agora - 60 * 60 * 1000).toISOString() })),
  { id: "erro_final", status: "erro", criadoEm: new Date(agora - 50 * 60 * 1000).toISOString() },
  { id: "cancelado", status: "cancelado", criadoEm: new Date(agora - 50 * 60 * 1000).toISOString() },
  { id: "expirado", status: "expirado", criadoEm: new Date(agora - 50 * 60 * 1000).toISOString() }
];

assert(CAMPOS_TIMESTAMP_FILA.includes("dataEntradaFila"));
assert(CAMPOS_TIMESTAMP_FILA.includes("adicionado_em"));
assert.strictEqual(classificarStatusFila({ status: "pendente" }), BUCKET_STATUS.PENDENTE_VIVO);
assert.strictEqual(classificarStatusFila({ status: "enviando" }), BUCKET_STATUS.EM_TENTATIVA);
assert.strictEqual(classificarStatusFila({ status: "erro_temporario" }), BUCKET_STATUS.ERRO_TEMPORARIO_RECUPERAVEL);
assert.strictEqual(classificarStatusFila({ status: "enviado" }), BUCKET_STATUS.ENVIADO_HISTORICO);
assert.strictEqual(classificarStatusFila({ status: "erro" }), BUCKET_STATUS.ERRO_FINAL);
assert.strictEqual(classificarStatusFila({ status: "misterioso" }), BUCKET_STATUS.STATUS_DESCONHECIDO);
assert.strictEqual(classificarStatusFila({}), BUCKET_STATUS.STATUS_DESCONHECIDO);

assert.strictEqual(timestampFila({ dataEntradaFila: "2026-07-31T21:00:00.000Z" }).campo, "dataEntradaFila");
assert.strictEqual(timestampFila({ adicionado_em: "2026-07-31T21:00:00.000Z" }).campo, "adicionado_em");
assert.strictEqual(timestampFila({}).ms, null);

assert.strictEqual(classificarItemEsteiraShadow(filaComHistorico[0], { agoraMs: agora, janelaAbertaAgora: true }), "aindaVivos");
assert.strictEqual(classificarItemEsteiraShadow(filaComHistorico[3], { agoraMs: agora, janelaAbertaAgora: true }), "vencidosOperacionalmente");
assert.strictEqual(classificarItemEsteiraShadow(filaComHistorico[8], { agoraMs: agora, janelaAbertaAgora: true }), "aguardandoAuditoria");
assert.strictEqual(classificarItemEsteiraShadow(filaComHistorico[9], { agoraMs: agora, janelaAbertaAgora: true }), "aguardandoAuditoria");
assert.strictEqual(classificarItemEsteiraShadow(filaComHistorico[1], { agoraMs: agora, janelaAbertaAgora: false }), "candidatosExpiracao");
assert.strictEqual(itemPressionaCapacidade(filaComHistorico[0], agora).pressiona, true);
assert.strictEqual(itemPressionaCapacidade(filaComHistorico[3], agora).motivo, "ttl_operacional_vencido");
assert.strictEqual(itemPressionaCapacidade(filaComHistorico[4], agora).motivo, "ttl_operacional_vencido");
assert.strictEqual(itemPressionaCapacidade(filaComHistorico[5], agora).motivo, "cooldown_curto_vivo");
assert.strictEqual(itemPressionaCapacidade(filaComHistorico[6], agora).motivo, "cooldown_ultrapassa_ttl_operacional");
assert.strictEqual(itemPressionaCapacidade(filaComHistorico[7], agora).motivo, "categoria_incompativel");

const resumoFila = resumoFilaWorkspace("user_pressao", {
  agoraMs: agora,
  janelaAbertaAgora: true,
  readClienteJson: () => filaComHistorico
});
assert.strictEqual(resumoFila.pendentesVivos, 7);
assert.strictEqual(resumoFila.emTentativaEnvio, 1);
assert.strictEqual(resumoFila.errosTemporariosRecuperaveis, 1);
assert.strictEqual(resumoFila.pressaoEsteiraViva, 4);
assert.strictEqual(resumoFila.pressaoPendenteVivo, 2);
assert.strictEqual(resumoFila.pressaoEmTentativa, 1);
assert.strictEqual(resumoFila.pressaoErroTemporarioRecuperavel, 1);
assert.strictEqual(resumoFila.itensPressaoVivaTotal, 4);
assert.strictEqual(resumoFila.motivosForaPressaoViva.ttl_operacional_vencido, 2);
assert.strictEqual(resumoFila.motivosForaPressaoViva.cooldown_ultrapassa_ttl_operacional, 1);
assert.strictEqual(resumoFila.motivosForaPressaoViva.categoria_incompativel, 1);
assert.strictEqual(resumoFila.motivosForaPressaoViva.sem_timestamp_operacional, 1);
assert.strictEqual(resumoFila.status_desconhecido, 1);
assert.strictEqual(resumoFila.enviados, 500);
assert.strictEqual(resumoFila.totalEnviadosHistorico, 500);
assert.strictEqual(resumoFila.errosFinais, 1);
assert.strictEqual(resumoFila.cancelados, 1);
assert.strictEqual(resumoFila.expirados, 1);
assert.strictEqual(resumoFila.itensSemTimestamp, 1);
assert.strictEqual(resumoFila.idadeMinimaVivaMs, 5 * 60 * 1000);
assert.strictEqual(resumoFila.idadeMaximaVivaMs, 35 * 60 * 1000);
assert.strictEqual(resumoFila.itensAte5Min, 4);
assert.strictEqual(resumoFila.itens10a15Min, 1);
assert.strictEqual(resumoFila.itens15a30Min, 2);
assert.strictEqual(resumoFila.itens30a60Min, 1);
assert.strictEqual(resumoFila.porMarketplace.amazon, 2);
assert.strictEqual(resumoFila.porDestino.destino_a, 7);
assert.strictEqual(resumoFila.porTipoOperacional.cupom, 1);
assert.strictEqual(resumoFila.camposTimestampEncontrados.criadoEm, 6);
assert.strictEqual(resumoFila.camposTimestampEncontrados.dataEntradaFila, 1);
assert.strictEqual(resumoFila.camposTimestampEncontrados.adicionado_em, 1);
assert.strictEqual(resumoFila.aindaVivos, 6);
assert.strictEqual(resumoFila.vencidosOperacionalmente, 2);
assert.strictEqual(resumoFila.aguardandoAuditoria, 1);

const resumoFechado = resumoFilaWorkspace("user_fechado", {
  agoraMs: agora,
  janelaAbertaAgora: false,
  readClienteJson: () => filaComHistorico
});
assert.strictEqual(resumoFechado.candidatosExpiracao, 2);
assert.strictEqual(resumoFechado.vencidosOperacionalmente, 2);
assert.strictEqual(resumoFechado.aguardandoAuditoria, 1);

assert.strictEqual(slotsCobertura(5, 3.5), 1);
assert.strictEqual(slotsCobertura(10, 3.5), 2);
assert.strictEqual(slotsCobertura(15, 3.5), 4);
assert.strictEqual(slotsCobertura(5, 10), 0);

const capacidadeNormal = capacidadeDestinoShadow(destinoApto, 0, []);
assert.strictEqual(capacidadeNormal.aptoAgora, true);
assert.strictEqual(capacidadeNormal.intervaloNormal, 5);
assert.strictEqual(capacidadeNormal.turboAplicavel, false);
assert.strictEqual(capacidadeNormal.slots5Min, 1);
assert.strictEqual(capacidadeNormal.slots10Min, 2);
assert.strictEqual(capacidadeNormal.slots15Min, 3);
assert.strictEqual(capacidadeNormal.capacidade5Min, 1);
assert.strictEqual(capacidadeNormal.capacidade10Min, 2);
assert.strictEqual(capacidadeNormal.capacidade15Min, 3);

const capacidadeTurbo = capacidadeDestinoShadow(destinoTurbo, 0, []);
assert.strictEqual(capacidadeTurbo.turboAplicavel, true);
assert.strictEqual(capacidadeTurbo.intervaloEfetivo, 1.5);
assert.strictEqual(capacidadeTurbo.cadenciaModo, "cadencia_v2");
assert.strictEqual(capacidadeTurbo.slots5Min, 3);
assert.strictEqual(capacidadeTurbo.slots10Min, 6);
assert.strictEqual(capacidadeTurbo.slots15Min, 10);

const capacidadeFechada = capacidadeDestinoShadow({ ...destinoApto, horarioInicio: "00:00", horarioFim: "00:01" }, 0, []);
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
assert.strictEqual(gateLivre.filaAlvo5Min, 4);
assert.strictEqual(gateLivre.filaAlvo10Min, 8);
assert.strictEqual(gateLivre.filaAlvo15Min, 13);
assert.strictEqual(gateLivre.filaAlvo, 8);
assert.strictEqual(gateLivre.capacidadeAbsorcaoAgora, 13);
assert.strictEqual(gateLivre.quantidadeQueAceitariaAgora, 13);
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
assert.strictEqual(gateSaturado.pressaoEsteiraViva, 4);
assert.strictEqual(gateSaturado.pressaoVivaConfirmada, 4);
assert.strictEqual(gateSaturado.statusDesconhecido, 1);
assert.strictEqual(gateSaturado.itensSemTimestamp, 1);
assert.strictEqual(gateSaturado.quantidadeFilaAtual, 4);
assert.strictEqual(gateSaturado.totalEnviadosHistorico, 500);
assert.strictEqual(gateSaturado.capacidadeAbsorcaoAgora, 0);
assert.strictEqual(gateSaturado.quantidadeQueRecusariaAgora, 1);
assert.strictEqual(gateSaturado.entrada15Min, 5);
assert.strictEqual(gateSaturado.saida15Min, 0);
assert.strictEqual(gateSaturado.entrandoMaisQueSaindo, true);
assert.strictEqual(gateSaturado.tempoEstimadoEsvaziarEsteira, null);
assert.strictEqual(gateSaturado.faixasIdade.itensAcima2h, 0);
assert.strictEqual(gateSaturado.vencidosOperacionalmente, 2);

const gateFechado = montarGateWorkspace({
  clienteId: "user_fechado",
  usuario: { id: "user_fechado" },
  destinos: [{ ...destinoApto, horarioInicio: "00:00", horarioFim: "00:01" }],
  fila: resumoFilaWorkspace("user_fechado", { readClienteJson: () => filaComHistorico, agoraMs: agora, janelaAbertaAgora: false }),
  eventos: {},
  janelaMinutos: 15
});
assert.strictEqual(gateFechado.estado, "FECHADA");
assert.strictEqual(gateFechado.capacidadeAbsorcaoAgora, 0);
assert.strictEqual(gateFechado.filaAlvo15Min, 0);
assert.strictEqual(gateFechado.candidatosExpiracao, 2);
assert.strictEqual(gateFechado.vencidosOperacionalmente, 2);
assert.strictEqual(gateFechado.aguardandoAuditoria, 1);

const filaRogerVelha = [
  { id: "r1", status: "pendente", marketplace: "mercadolivre", criadoEm: new Date(agora - 31 * 60 * 1000).toISOString() },
  { id: "r2", status: "pendente", marketplace: "amazon", criadoEm: new Date(agora - 40 * 60 * 1000).toISOString() },
  { id: "r3", status: "erro_temporario", marketplace: "shopee", criadoEm: new Date(agora - 45 * 60 * 1000).toISOString() }
];
const gateRogerLiberado = montarGateWorkspace({
  clienteId: "user_9hqs434h",
  usuario: { id: "user_9hqs434h" },
  destinos: [destinoApto],
  fila: resumoFilaWorkspace("user_9hqs434h", { readClienteJson: () => filaRogerVelha, agoraMs: agora, janelaAbertaAgora: true }),
  eventos: {},
  janelaMinutos: 15
});
assert.strictEqual(gateRogerLiberado.filaAlvo15Min, 3);
assert.strictEqual(gateRogerLiberado.pressaoEsteiraViva, 0);
assert.strictEqual(gateRogerLiberado.capacidadeAbsorcaoAgora, 3);
assert.strictEqual(gateRogerLiberado.estado, "LIVRE");

const filaRogerParcial = [
  { id: "r1", status: "pendente", marketplace: "mercadolivre", criadoEm: new Date(agora - 5 * 60 * 1000).toISOString() },
  { id: "r2", status: "pendente", marketplace: "amazon", criadoEm: new Date(agora - 10 * 60 * 1000).toISOString() },
  { id: "r3", status: "pendente", marketplace: "shopee", criadoEm: new Date(agora - 31 * 60 * 1000).toISOString() }
];
const gateRogerUmaVaga = montarGateWorkspace({
  clienteId: "user_9hqs434h",
  usuario: { id: "user_9hqs434h" },
  destinos: [destinoApto],
  fila: resumoFilaWorkspace("user_9hqs434h", { readClienteJson: () => filaRogerParcial, agoraMs: agora, janelaAbertaAgora: true }),
  eventos: {},
  janelaMinutos: 15
});
assert.strictEqual(gateRogerUmaVaga.filaAlvo15Min, 3);
assert.strictEqual(gateRogerUmaVaga.pressaoEsteiraViva, 2);
assert.strictEqual(gateRogerUmaVaga.capacidadeAbsorcaoAgora, 1);
assert.strictEqual(gateRogerUmaVaga.estado, "ESTAVEL");

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
      user_fechado: [{ ...destinoApto, horarioInicio: "00:00", horarioFim: "00:01" }]
    },
    agoraMs: agora,
    readClienteJson: (clienteId, arquivo, fallback) => {
      if (arquivo !== "fila.json") return fallback;
      if (clienteId === "user_saturado" || clienteId === "user_fechado") return filaComHistorico;
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
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_saturado").pressaoEsteiraViva, 4);
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_saturado").totalEnviadosHistorico, 500);
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_fechado").filaAlvo15Min, 0);
  assert.strictEqual(gate.resumo.porEstado.LIVRE, 1);
  assert.strictEqual(gate.resumo.porEstado.SATURADA, 1);
  assert.strictEqual(gate.resumo.porEstado.FECHADA, 1);
  assert.strictEqual(gate.resumo.pressaoEsteiraViva, 8);
  assert.strictEqual(gate.resumo.statusDesconhecido, 2);
  assert.strictEqual(gate.resumo.itensSemTimestamp, 2);

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
  assert(controller.includes("[OFC-GATE-ESTEIRA-VIVA-SHADOW]"));
  assert(controller.includes("[OFC-GATE-ESTEIRA-VIVA-ERRO]"));

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
