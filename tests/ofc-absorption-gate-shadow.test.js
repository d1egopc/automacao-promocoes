const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  BUCKET_STATUS,
  CAMPOS_TIMESTAMP_FILA,
  TTL_ESTEIRA_MS,
  criarGateAbsorcaoShadowOfc,
  montarGateWorkspace,
  classificarEstadoEsteira,
  classificarStatusFila,
  lerFilaWorkspaceSnapshot,
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

function testarLeituraEstritaFila() {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "ofc-fila-snapshot-"));
  const arquivo = path.join(dir, "fila.json");
  const opcoes = { getClienteJsonPath: () => arquivo, clock: () => agora };
  try {
    fs.writeFileSync(arquivo, "[]");
    const vaziaValida = lerFilaWorkspaceSnapshot("user_teste", opcoes);
    assert.strictEqual(vaziaValida.ok, true);
    assert.deepStrictEqual(vaziaValida.itens, []);
    assert.strictEqual(vaziaValida.collectedAtMs, agora);

    fs.rmSync(arquivo);
    assert.strictEqual(lerFilaWorkspaceSnapshot("user_teste", opcoes).motivo, "fila_ausente");

    fs.writeFileSync(arquivo, "{json quebrado");
    assert.strictEqual(lerFilaWorkspaceSnapshot("user_teste", opcoes).motivo, "fila_json_corrompido");

    fs.writeFileSync(arquivo, "");
    assert.strictEqual(lerFilaWorkspaceSnapshot("user_teste", opcoes).motivo, "fila_arquivo_vazio");

    fs.writeFileSync(arquivo, "{}");
    assert.strictEqual(lerFilaWorkspaceSnapshot("user_teste", opcoes).motivo, "fila_formato_invalido");

    fs.writeFileSync(arquivo, "[]");
    fs.utimesSync(arquivo, new Date("2020-01-01T00:00:00.000Z"), new Date("2020-01-01T00:00:00.000Z"));
    assert.strictEqual(lerFilaWorkspaceSnapshot("user_teste", opcoes).ok, true, "mtime antigo nao invalida leitura atual valida");

    let leituras = 0;
    const leituraUnica = lerFilaWorkspaceSnapshot("user_teste", {
      ...opcoes,
      readFileSync: () => { leituras += 1; return "[]"; }
    });
    assert.strictEqual(leituraUnica.ok, true);
    assert.strictEqual(leituras, 1, "validade e conteudo devem vir da mesma leitura fisica");

    const erroLeitura = lerFilaWorkspaceSnapshot("user_teste", {
      ...opcoes,
      readFileSync: () => { const erro = new Error("negado"); erro.code = "EACCES"; throw erro; }
    });
    assert.strictEqual(erroLeitura.motivo, "fila_erro_leitura");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

testarLeituraEstritaFila();

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
assert.strictEqual(classificarStatusFila({ status: "nao_enviado" }), BUCKET_STATUS.ERRO_FINAL);
assert.strictEqual(classificarStatusFila({ status: "nao_enviada" }), BUCKET_STATUS.ERRO_FINAL);
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

// Contrato existente: idade >= TTL ja esta vencida; o relogio e injetado.
for (const [deslocamentoMs, acionavel] of [[-1, true], [0, false], [1, false]]) {
  const item = { status: "pendente", marketplace: "amazon",
    criadoEm: new Date(agora - TTL_ESTEIRA_MS.comum - deslocamentoMs).toISOString() };
  const leitura = resumoFilaWorkspace("user_fronteira_ttl", { filaItens: [item], agoraMs: agora });
  assert.strictEqual(itemPressionaCapacidade(item, agora).pressiona, acionavel);
  assert.strictEqual(leitura.queueDepthActionable, acionavel ? 1 : 0);
  assert.strictEqual(leitura.expiredAliveCount, acionavel ? 0 : 1);
  assert.strictEqual(leitura.oldestActionableAge, acionavel ? TTL_ESTEIRA_MS.comum - 1 : 0);
}

const resumoFila = resumoFilaWorkspace("user_pressao", {
  agoraMs: agora,
  janelaAbertaAgora: true,
  readClienteJson: () => filaComHistorico
});
assert.strictEqual(resumoFila.pendentesVivos, 7);
assert.strictEqual(resumoFila.emTentativaEnvio, 1);
assert.strictEqual(resumoFila.errosTemporariosRecuperaveis, 1);
assert.strictEqual(resumoFila.pressaoEsteiraViva, 4);
assert.strictEqual(resumoFila.queueDepthRaw, 9);
assert.strictEqual(resumoFila.queueDepthActionable, 4);
assert.strictEqual(resumoFila.oldestAgeRaw, 35 * 60 * 1000);
assert.strictEqual(resumoFila.oldestActionableAge, 20 * 60 * 1000);
assert.strictEqual(resumoFila.oldestHistoricalAge, 35 * 60 * 1000);
assert.strictEqual(resumoFila.expiredAliveCount, 2);
assert.strictEqual(resumoFila.expiredPendingCount, 2);
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

const resumoNaoEnviado = resumoFilaWorkspace("user_terminal", {
  agoraMs: agora,
  janelaAbertaAgora: true,
  readClienteJson: () => [
    { id: "terminal", status: "nao_enviado", criadoEm: new Date(agora - 5 * 60 * 1000).toISOString() },
    { id: "desconhecido_real", status: "estado_novo_nao_mapeado", criadoEm: new Date(agora - 5 * 60 * 1000).toISOString() }
  ]
});
assert.strictEqual(resumoNaoEnviado.errosFinais, 1);
assert.strictEqual(resumoNaoEnviado.status_desconhecido, 1);
assert.strictEqual(resumoNaoEnviado.pressaoEsteiraViva, 0);

const resumoFechado = resumoFilaWorkspace("user_fechado", {
  agoraMs: agora,
  janelaAbertaAgora: false,
  readClienteJson: () => filaComHistorico
});
assert.strictEqual(resumoFechado.candidatosExpiracao, 2);
assert.strictEqual(resumoFechado.vencidosOperacionalmente, 2);
assert.strictEqual(resumoFechado.aguardandoAuditoria, 1);

const filaHistorica = [
  ...Array.from({ length: 500 }, (_, i) => ({ id: `vencido_${i}`, status: "processando",
    criadoEm: new Date(agora - 3 * 24 * 60 * 60 * 1000).toISOString() })),
  ...Array.from({ length: 5 }, (_, i) => ({ id: `novo_${i}`, status: "pendente",
    criadoEm: new Date(agora - 12 * 60 * 1000).toISOString() }))
];
const resumoHistorico = resumoFilaWorkspace("user_historico", { filaItens: filaHistorica, agoraMs: agora });
assert.strictEqual(resumoHistorico.queueDepthRaw, 505);
assert.strictEqual(resumoHistorico.queueDepthActionable, 5);
assert.strictEqual(resumoHistorico.oldestAgeRaw, 3 * 24 * 60 * 60 * 1000);
assert.strictEqual(resumoHistorico.oldestActionableAge, 12 * 60 * 1000);
assert.strictEqual(resumoHistorico.oldestHistoricalAge, 3 * 24 * 60 * 60 * 1000);
assert.strictEqual(resumoHistorico.expiredAliveCount, 500);
assert.strictEqual(resumoHistorico.expiredProcessingCount, 500);
const somenteHistorico = resumoFilaWorkspace("user_sem_acao", { filaItens: filaHistorica.slice(0, 500), agoraMs: agora });
assert.strictEqual(somenteHistorico.queueDepthActionable, 0);
assert.strictEqual(somenteHistorico.oldestActionableAge, 0);

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

const gateComAutomacaoDesligada = montarGateWorkspace({
  clienteId: "user_sem_automacao", usuario: { id: "user_sem_automacao", creditos: 10 },
  configExecutor: { automacaoAtiva: false }, destinos: [destinoApto], fila: resumoHistorico, eventos: {}
});
assert(gateComAutomacaoDesligada.capacityTheoretical > 0);
assert.strictEqual(gateComAutomacaoDesligada.capacityEffective, 0);
assert.strictEqual(gateComAutomacaoDesligada.queueDepthActionable, 0);
assert.strictEqual(gateComAutomacaoDesligada.oldestActionableAge, 0);
assert.strictEqual(gateComAutomacaoDesligada.queueDepthRaw, 505);
assert.strictEqual(gateComAutomacaoDesligada.capacityEffectiveKnown, 0);
assert.strictEqual(gateComAutomacaoDesligada.capacityEffectiveComplete, true);
assert.strictEqual(gateComAutomacaoDesligada.capacityUnknownWorkspaces, 0);
const gateComAutomacaoLigada = montarGateWorkspace({
  clienteId: "user_com_automacao", usuario: { id: "user_com_automacao", creditos: 10 },
  configExecutor: { automacaoAtiva: true }, destinos: [destinoApto], fila: resumoHistorico, eventos: {}
});
assert.strictEqual(gateComAutomacaoLigada.queueDepthActionable, 5);
assert.strictEqual(gateComAutomacaoLigada.oldestActionableAge, 12 * 60 * 1000);
assert.strictEqual(gateComAutomacaoLigada.capacityEffective, 0);
assert.strictEqual(gateComAutomacaoLigada.creditosEstado, "SUFICIENTE");
const gateComUmCredito = montarGateWorkspace({ usuario: { creditos: 1 }, configExecutor: { automacaoAtiva: true },
  destinos: [destinoApto], fila: resumoFilaWorkspace("user_um_credito", { filaItens: [], agoraMs: agora }) });
assert.strictEqual(gateComUmCredito.capacityTheoretical, 3);
assert.strictEqual(gateComUmCredito.capacityEffective, 1);
assert.strictEqual(gateComUmCredito.capacityEffectiveKnown, 1);
assert.strictEqual(gateComUmCredito.creditosEstado, "SUFICIENTE");
const gateSemCreditos = montarGateWorkspace({ usuario: { creditos: 0 }, configExecutor: { automacaoAtiva: true },
  destinos: [destinoApto], fila: resumoFilaWorkspace("user_zero_credito", { filaItens: [], agoraMs: agora }) });
assert.strictEqual(gateSemCreditos.creditosEstado, "INSUFICIENTE");
assert.strictEqual(gateSemCreditos.capacityEffectiveKnown, 0);
assert.strictEqual(gateSemCreditos.capacityEffectiveComplete, true);
for (const saldo of [undefined, null, "", "invalido", "0x10", -1]) {
  const gateCreditoDesconhecido = montarGateWorkspace({ usuario: { creditos: saldo },
    configExecutor: { automacaoAtiva: true }, destinos: [destinoApto],
    fila: resumoFilaWorkspace("user_credito_desconhecido", { filaItens: [], agoraMs: agora }) });
  assert.strictEqual(gateCreditoDesconhecido.creditosEstado, "DESCONHECIDO");
  assert.strictEqual(gateCreditoDesconhecido.capacityEffectiveKnown, 0);
  assert.strictEqual(gateCreditoDesconhecido.capacityEffectiveComplete, false);
  assert.strictEqual(gateCreditoDesconhecido.capacityUnknownSlots, 3);
  assert.strictEqual(gateCreditoDesconhecido.capacityUnknownWorkspaces, 1);
}
const gateDesligadoSemSaldo = montarGateWorkspace({ usuario: {}, configExecutor: { automacaoAtiva: false },
  destinos: [destinoApto], fila: resumoFilaWorkspace("user_desligado_sem_saldo", { filaItens: [], agoraMs: agora }) });
assert.strictEqual(gateDesligadoSemSaldo.capacityEffectiveKnown, 0);
assert.strictEqual(gateDesligadoSemSaldo.capacityEffectiveComplete, true);
assert.strictEqual(gateDesligadoSemSaldo.capacityUnknownWorkspaces, 0);
const filaDestinoFechado = resumoFilaWorkspace("user_destino", { agoraMs: agora, filaItens: [
  { status: "pendente", destinoId: "destino_desligado", criadoEm: new Date(agora - 10 * 60 * 1000).toISOString() },
  { status: "pendente", destinoId: "destino_a", criadoEm: new Date(agora - 5 * 60 * 1000).toISOString() }
] });
const gateDestinoFechado = montarGateWorkspace({ usuario: { creditos: 10 }, configExecutor: { automacaoAtiva: true },
  destinos: [destinoApto, { ...destinoApto, id: "destino_desligado", ativo: false }], fila: filaDestinoFechado });
assert.strictEqual(gateDestinoFechado.queueDepthActionable, 1);
assert.strictEqual(gateDestinoFechado.oldestActionableAge, 5 * 60 * 1000);

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
    configsPorCliente: {
      user_livre: { automacaoAtiva: true },
      user_saturado: { automacaoAtiva: true },
      user_fechado: { automacaoAtiva: true }
    },
    agoraMs: agora,
    readFilaSnapshot: clienteId => ({
      ok: true,
      itens: clienteId === "user_saturado" || clienteId === "user_fechado" ? filaComHistorico : [],
      collectedAtMs: agora
    }),
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
  assert.strictEqual(gate.snapshotCompleto, true);
  assert.strictEqual(gate.fontesInvalidasCount, 0);
  assert.strictEqual(gate.fontesInvalidasTotais, 0);
  assert.strictEqual(gate.fontesInvalidasRelevantes, 0);
  assert.strictEqual(gate.fontesInvalidasIrrelevantes, 0);
  assert.equal(Number.isFinite(gate.collectedAtMs), true);
  assert.strictEqual(gate.totalWorkspaces, 3);
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_livre").estado, "LIVRE");
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_saturado").estado, "SATURADA");
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_fechado").estado, "FECHADA");
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_saturado").pressaoEsteiraViva, 4);
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_saturado").queueDepthActionable, 3);
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_fechado").queueDepthActionable, 0);
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_fechado").topologiaOperacionalPotencial, true);
  assert(gate.workspaces.find(w => w.workspaceId === "user_fechado").pressaoEsteiraViva > 0,
    "backlog valido permanece relevante mesmo com destino fechado");
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_livre").topologiaOperacionalPotencial, true);
  assert(gate.workspaces.find(w => w.workspaceId === "user_livre").slots15Min > 0,
    "fila vazia com capacidade real preserva topologia e slots");
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_saturado").totalEnviadosHistorico, 500);
  assert.strictEqual(gate.workspaces.find(w => w.workspaceId === "user_fechado").filaAlvo15Min, 0);
  assert.strictEqual(gate.resumo.porEstado.LIVRE, 1);
  assert.strictEqual(gate.resumo.porEstado.SATURADA, 1);
  assert.strictEqual(gate.resumo.porEstado.FECHADA, 1);
  assert.strictEqual(gate.resumo.pressaoEsteiraViva, 8);
  assert.strictEqual(gate.resumo.statusDesconhecido, 2);
  assert.strictEqual(gate.resumo.itensSemTimestamp, 2);

  const dirInvalido = fs.mkdtempSync(path.join(require("os").tmpdir(), "ofc-fila-invalida-"));
  try {
    const { coletarMetricasShadow } = require("../modules/auto-gate/auto-gate-metrics.service");
    const { avaliarShadow } = require("../modules/auto-gate/auto-gate-state-machine");
    const arquivoFila = path.join(dirInvalido, "fila.json");
    const coletarDoGate = gateAbsorcao => coletarMetricasShadow({
      ofc: {
        fluxoComercial: { ok: true, janelaMinutos: 15, fontes: { eventosComerciais: true }, enviosConfirmadosPorMinuto: 0 },
        gateAbsorcao
      },
      consultarEntradas: async () => ({ ok: true, janelaMinutos: 15, inputRadar: 0, inputTeleRadar: 0, inputTotal: 0,
        collectedAtMs: gateAbsorcao.collectedAtMs }),
      getRadarOperational: async () => ({ enabled: true, withinSchedule: true, sourceConfigured: true }),
      getTeleRadarOperational: async () => ({ enabled: false, withinSchedule: true, listenerActive: false,
        accountAuthorized: true, selectedSourceCount: 1 }),
      now: gateAbsorcao.collectedAtMs
    });
    let leiturasGate = 0;
    const gateVazioValido = await criarGateAbsorcaoShadowOfc({
      janelaMinutos: 15,
      usuarios: [{ id: "user_vazio" }],
      listarClientesAtivos: () => ["user_vazio"],
      destinosPorCliente: { user_vazio: [] },
      getClienteJsonPath: () => arquivoFila,
      readFileSync: () => { leiturasGate += 1; return "[]"; },
      clock: () => agora,
      consultarEventosAbsorcao: async () => ({ ok: true, janelaMinutos: 15, porWorkspace: [] })
    });
    assert.strictEqual(gateVazioValido.snapshotCompleto, true, JSON.stringify(gateVazioValido));
    assert.strictEqual(gateVazioValido.collectedAtMs, agora);
    assert.strictEqual(gateVazioValido.workspaces[0].fonteFilaValida, true);
    assert.strictEqual(gateVazioValido.workspaces[0].topologiaOperacionalPotencial, false);
    assert.strictEqual(leiturasGate, 1, "gate completo nao pode reler fila.json para validar");

    const casosIrrelevantes = [
      { nome: "ausente_sem_topologia", preparar: () => fs.rmSync(arquivoFila, { force: true }) },
      { nome: "corrompido_sem_topologia", preparar: () => fs.writeFileSync(arquivoFila, "{quebrado") }
    ];
    for (const caso of casosIrrelevantes) {
      caso.preparar();
      const gateIrrelevante = await criarGateAbsorcaoShadowOfc({
        janelaMinutos: 15,
        usuarios: [{ id: "user_sem_topologia" }],
        listarClientesAtivos: () => ["user_sem_topologia"],
        destinosPorCliente: { user_sem_topologia: [] },
        getClienteJsonPath: () => arquivoFila,
        consultarEventosAbsorcao: async () => ({ ok: true, janelaMinutos: 15, porWorkspace: [] })
      });
      assert.strictEqual(gateIrrelevante.snapshotCompleto, true, caso.nome);
      assert.strictEqual(gateIrrelevante.fontesInvalidasCount, 0, caso.nome);
      assert.strictEqual(gateIrrelevante.fontesInvalidasTotais, 1, caso.nome);
      assert.strictEqual(gateIrrelevante.fontesInvalidasRelevantes, 0, caso.nome);
      assert.strictEqual(gateIrrelevante.fontesInvalidasIrrelevantes, 1, caso.nome);
      assert.strictEqual(gateIrrelevante.workspaces[0].topologiaOperacionalPotencial, false, caso.nome);
      const metricasIrrelevantes = await coletarDoGate(gateIrrelevante);
      assert.strictEqual(metricasIrrelevantes.ok, true, caso.nome);
      assert.strictEqual(metricasIrrelevantes.sinaisAusentes.includes("fila_observada_incompleta"), false, caso.nome);
    }

    const casosInvalidos = [
      { nome: "ausente", preparar: () => fs.rmSync(arquivoFila, { force: true }), motivo: "fila_ausente" },
      { nome: "json_corrompido", preparar: () => fs.writeFileSync(arquivoFila, "{quebrado"), motivo: "fila_json_corrompido" },
      { nome: "arquivo_vazio", preparar: () => fs.writeFileSync(arquivoFila, ""), motivo: "fila_arquivo_vazio" },
      { nome: "formato_invalido", preparar: () => fs.writeFileSync(arquivoFila, "{}"), motivo: "fila_formato_invalido" },
      { nome: "erro_leitura", preparar: () => fs.writeFileSync(arquivoFila, "[]"), motivo: "fila_erro_leitura",
        readFileSync: () => { const erro = new Error("negado"); erro.code = "EACCES"; throw erro; } }
    ];

    for (const caso of casosInvalidos) {
      caso.preparar();
      const gateIncompleto = await criarGateAbsorcaoShadowOfc({
        janelaMinutos: 15,
        usuarios: [{ id: "user_capacidade" }],
        listarClientesAtivos: () => ["user_capacidade"],
        destinosPorCliente: { user_capacidade: [destinoApto] },
        getClienteJsonPath: () => arquivoFila,
        ...(caso.readFileSync ? { readFileSync: caso.readFileSync } : {}),
        consultarEventosAbsorcao: async () => ({ ok: true, janelaMinutos: 15, porWorkspace: [] })
      });
      assert.strictEqual(gateIncompleto.ok, true, caso.nome);
      assert.strictEqual(gateIncompleto.snapshotCompleto, false, caso.nome);
      assert.strictEqual(gateIncompleto.fontesInvalidasCount, 1, caso.nome);
      assert.strictEqual(gateIncompleto.fontesInvalidasTotais, 1, caso.nome);
      assert.strictEqual(gateIncompleto.fontesInvalidasRelevantes, 1, caso.nome);
      assert.strictEqual(gateIncompleto.fontesInvalidasIrrelevantes, 0, caso.nome);
      assert.strictEqual(gateIncompleto.fontesInvalidasPorMotivo[caso.motivo], 1, caso.nome);
      assert.strictEqual(gateIncompleto.workspaces[0].fonteFilaValida, false, caso.nome);
      assert.strictEqual(gateIncompleto.workspaces[0].topologiaOperacionalPotencial, true, caso.nome);

      const metricasIncompletas = await coletarDoGate(gateIncompleto);
      assert.strictEqual(metricasIncompletas.ok, false, caso.nome);
      assert(metricasIncompletas.sinaisAusentes.includes("fila_observada_incompleta"), caso.nome);
      assert.strictEqual(avaliarShadow(metricasIncompletas).decisaoSugerida, "NAO_INTERVIR", caso.nome);
    }

    fs.rmSync(arquivoFila, { force: true });
    const gateTopologiaFechada = await criarGateAbsorcaoShadowOfc({
      janelaMinutos: 15,
      usuarios: [{ id: "user_topologia_fechada" }],
      listarClientesAtivos: () => ["user_topologia_fechada"],
      destinosPorCliente: {
        user_topologia_fechada: [{ ...destinoApto, statusIntegracao: "desconectada" }]
      },
      getClienteJsonPath: () => arquivoFila,
      consultarEventosAbsorcao: async () => ({ ok: true, janelaMinutos: 15, porWorkspace: [] })
    });
    assert.strictEqual(gateTopologiaFechada.workspaces[0].topologiaOperacionalPotencial, true);
    assert.strictEqual(gateTopologiaFechada.workspaces[0].integracoesAptas, 0);
    assert.strictEqual(gateTopologiaFechada.workspaces[0].slots15Min, 0);
    assert.strictEqual(gateTopologiaFechada.snapshotCompleto, false);
    assert.strictEqual(gateTopologiaFechada.fontesInvalidasRelevantes, 1);
    const metricasTopologiaFechada = await coletarDoGate(gateTopologiaFechada);
    assert.strictEqual(metricasTopologiaFechada.ok, false);
    assert.strictEqual(avaliarShadow(metricasTopologiaFechada).decisaoSugerida, "NAO_INTERVIR");
  } finally {
    fs.rmSync(dirInvalido, { recursive: true, force: true });
  }

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
