const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-campanhas-agendamentos-"));
process.env.DATA_DIR = dataDir;
process.env.CAMPANHAS_MEDIA_ORFA_TTL_MS = "1000";

const { readClienteJson, writeClienteJson } = require("../utils/storage");
const {
  salvarMidiaTemporaria,
  obterMidiaTemporaria
} = require("../campanhas/midiaTemporaria");
const { registrarHistoricoCampanha } = require("../campanhas/historicoCampanhas");
const {
  salvarAgendamentoCampanha,
  listarAgendamentosCampanhas,
  obterAgendamentoCampanha,
  cancelarAgendamentoCampanha,
  removerAgendamentoCampanha,
  executarAgendamentoCampanha,
  executarAgendamentosPendentesCliente,
  executarAgendamentosPendentesTodosClientes
} = require("../campanhas/agendamentosCampanhas");

function png() {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
}

function futuro(minutos = 10, base = new Date("2026-07-18T12:00:00.000Z")) {
  return new Date(base.getTime() + minutos * 60 * 1000).toISOString();
}

function contexto(clienteId = "cliente_a") {
  const chamadas = [];
  const debitos = [];
  const sock = {
    async sendMessage(grupo, msg) {
      chamadas.push({ grupo, msg });
      return { ok: true };
    }
  };
  return {
    chamadas,
    debitos,
    deps: {
      destinosPorCliente: {
        [clienteId]: {
          lista: [
            { id: "wa", tipo: "whatsapp", nome: "WhatsApp", conexaoId: "sessao_a", gruposWhatsapp: ["grupo_a"] }
          ]
        }
      },
      sessoes: { sessao_a: sock },
      configsPorCliente: { [clienteId]: { telegram: { destinos: [] } } },
      usuarioTemCreditos: () => true,
      debitarCreditos: (id, qtd) => debitos.push({ clienteId: id, qtd }),
      corrigirImagemUrl: url => url,
      httpClient: { async post() { return { data: { ok: true } }; } },
      esperaMsTelegram: 0,
      esperaMsWhatsApp: 0
    }
  };
}

(async () => {
  const base = new Date("2026-07-18T12:00:00.000Z");

  assert.throws(
    () => salvarAgendamentoCampanha("cliente_data", {
      mensagem: "Campanha",
      destinosIds: ["wa"],
      agendadoPara: new Date(base.getTime() - 1000).toISOString()
    }, { agora: base }),
    /campanhas_agendamento_data_passada/,
    "agendamento deve exigir data futura"
  );

  const agendamentoA = salvarAgendamentoCampanha("cliente_a", {
    mensagem: "Campanha A",
    destinosIds: ["wa"],
    agendadoPara: futuro(5, base)
  }, { agora: base });

  assert.ok(agendamentoA.agendamentoId, "deve criar agendamentoId");
  assert.strictEqual(listarAgendamentosCampanhas("cliente_a").length, 1, "cliente A deve listar seu agendamento");
  assert.strictEqual(listarAgendamentosCampanhas("cliente_b").length, 0, "cliente B nao deve enxergar agendamento de A");
  assert.strictEqual(obterAgendamentoCampanha("cliente_b", agendamentoA.agendamentoId), null, "consulta cruzada deve falhar");

  const midia = salvarMidiaTemporaria({ clienteId: "cliente_mid", buffer: png(), nomeOriginal: "arte.png", mimeType: "image/png", tipo: "imagem" });
  const agendamentoMidia = salvarAgendamentoCampanha("cliente_mid", {
    mensagem: "Com arte",
    destinosIds: ["wa"],
    midiaId: midia.midiaId,
    agendadoPara: futuro(10, base)
  }, { agora: base });
  const metaAssociada = obterMidiaTemporaria("cliente_mid", midia.midiaId);
  assert.strictEqual(metaAssociada.status, "associada", "midia agendada deve ficar associada");
  assert.strictEqual(metaAssociada.campanhaId, agendamentoMidia.agendamentoId, "midia deve apontar para o agendamento");

  cancelarAgendamentoCampanha("cliente_mid", agendamentoMidia.agendamentoId);
  assert.throws(
    () => obterMidiaTemporaria("cliente_mid", midia.midiaId),
    /campanhas_midia_nao_encontrada/,
    "cancelamento deve remover midia temporaria associada"
  );

  const ctx = contexto("cliente_exec");
  const agendamentoExec = salvarAgendamentoCampanha("cliente_exec", {
    mensagem: "Enviar no horario",
    destinosIds: ["wa"],
    agendadoPara: futuro(1, base)
  }, { agora: base });
  const exec = await executarAgendamentoCampanha({
    clienteId: "cliente_exec",
    agendamentoId: agendamentoExec.agendamentoId,
    deps: ctx.deps,
    agora: new Date(base.getTime() + 2 * 60 * 1000)
  });
  assert.strictEqual(exec.ok, true, "agendamento vencido deve executar");
  assert.strictEqual(exec.resultado.enviados, 1, "execucao deve usar o executor oficial");
  assert.strictEqual(ctx.chamadas.length, 1, "WhatsApp deve receber exatamente uma mensagem");
  assert.strictEqual(ctx.debitos.length, 1, "credito deve continuar debitado no executor oficial");
  assert.ok(exec.agendamento.campanhaId, "execucao deve guardar campanhaId do historico");

  const segundaRodada = await executarAgendamentosPendentesCliente({
    clienteId: "cliente_exec",
    deps: ctx.deps,
    agora: new Date(base.getTime() + 3 * 60 * 1000)
  });
  assert.strictEqual(segundaRodada.processados, 0, "segunda rodada nao deve reenviar agendamento ja executado");
  assert.strictEqual(ctx.chamadas.length, 1, "segunda rodada nao deve duplicar envio");

  const ctxRecupera = contexto("cliente_recupera");
  const agendamentoPreso = salvarAgendamentoCampanha("cliente_recupera", {
    mensagem: "Recuperar processando antigo",
    destinosIds: ["wa"],
    agendadoPara: futuro(1, base)
  }, { agora: base });
  const listaRecupera = readClienteJson("cliente_recupera", "campanhas-agendamentos.json", []);
  writeClienteJson("cliente_recupera", "campanhas-agendamentos.json", listaRecupera.map(item => item.agendamentoId === agendamentoPreso.agendamentoId ? {
    ...item,
    status: "processando",
    processandoEm: new Date(base.getTime() - 20 * 60 * 1000).toISOString(),
    atualizadoEm: new Date(base.getTime() - 20 * 60 * 1000).toISOString()
  } : item));
  const recuperado = await executarAgendamentosPendentesCliente({
    clienteId: "cliente_recupera",
    deps: ctxRecupera.deps,
    agora: new Date(base.getTime() + 2 * 60 * 1000)
  });
  assert.strictEqual(recuperado.processados, 1, "processando antigo deve ser recuperado pelo scheduler");
  assert.strictEqual(ctxRecupera.chamadas.length, 1, "recuperacao deve reutilizar o executor oficial uma unica vez");
  const storageRecuperado = readClienteJson("cliente_recupera", "campanhas-agendamentos.json", []);
  assert.strictEqual(storageRecuperado[0].status, "enviada", "recuperacao deve finalizar com status do executor");
  assert.strictEqual(storageRecuperado[0].recuperacaoMotivo, "processando_timeout", "recuperacao deve registrar motivo tecnico");
  assert.ok(storageRecuperado[0].recuperadoEm, "recuperacao deve registrar timestamp");
  const recuperadoRetry = await executarAgendamentosPendentesCliente({
    clienteId: "cliente_recupera",
    deps: ctxRecupera.deps,
    agora: new Date(base.getTime() + 3 * 60 * 1000)
  });
  assert.strictEqual(recuperadoRetry.processados, 0, "segunda rodada nao deve duplicar recuperacao finalizada");
  assert.strictEqual(ctxRecupera.chamadas.length, 1, "recuperacao finalizada nao deve reenviar");

  const ctxRecente = contexto("cliente_recente");
  const agendamentoRecente = salvarAgendamentoCampanha("cliente_recente", {
    mensagem: "Processando recente",
    destinosIds: ["wa"],
    agendadoPara: futuro(1, base)
  }, { agora: base });
  const listaRecente = readClienteJson("cliente_recente", "campanhas-agendamentos.json", []);
  writeClienteJson("cliente_recente", "campanhas-agendamentos.json", listaRecente.map(item => item.agendamentoId === agendamentoRecente.agendamentoId ? {
    ...item,
    status: "processando",
    processandoEm: base.toISOString(),
    atualizadoEm: base.toISOString()
  } : item));
  const recente = await executarAgendamentosPendentesCliente({
    clienteId: "cliente_recente",
    deps: ctxRecente.deps,
    agora: new Date(base.getTime() + 2 * 60 * 1000)
  });
  assert.strictEqual(recente.processados, 0, "processando recente nao deve ser recuperado antes do timeout");
  assert.strictEqual(ctxRecente.chamadas.length, 0, "processando recente nao deve enviar");

  const ctxHistorico = contexto("cliente_hist");
  const historicoConcluido = registrarHistoricoCampanha({
    clienteId: "cliente_hist",
    mensagem: "Ja concluida",
    enviados: 1,
    erros: 0,
    status: "enviada",
    concluidoEm: new Date(base.getTime() - 60 * 1000).toISOString()
  });
  const agendamentoHistorico = salvarAgendamentoCampanha("cliente_hist", {
    mensagem: "Nao reenviar historico",
    destinosIds: ["wa"],
    agendadoPara: futuro(1, base)
  }, { agora: base });
  const listaHistorico = readClienteJson("cliente_hist", "campanhas-agendamentos.json", []);
  writeClienteJson("cliente_hist", "campanhas-agendamentos.json", listaHistorico.map(item => item.agendamentoId === agendamentoHistorico.agendamentoId ? {
    ...item,
    status: "processando",
    processandoEm: new Date(base.getTime() - 20 * 60 * 1000).toISOString(),
    atualizadoEm: new Date(base.getTime() - 20 * 60 * 1000).toISOString(),
    campanhaId: historicoConcluido.campanhaId
  } : item));
  const recuperadoPorHistorico = await executarAgendamentosPendentesCliente({
    clienteId: "cliente_hist",
    deps: ctxHistorico.deps,
    agora: new Date(base.getTime() + 2 * 60 * 1000)
  });
  assert.strictEqual(recuperadoPorHistorico.processados, 1, "processando antigo com historico deve ser reconciliado");
  assert.strictEqual(ctxHistorico.chamadas.length, 0, "historico concluido impede reenvio");
  const storageHistorico = readClienteJson("cliente_hist", "campanhas-agendamentos.json", []);
  assert.strictEqual(storageHistorico[0].status, "enviada", "status deve seguir historico concluido");
  assert.strictEqual(storageHistorico[0].recuperacaoMotivo, "historico_concluido", "deve registrar recuperacao por historico");

  const agendamentoDelete = salvarAgendamentoCampanha("cliente_delete", {
    mensagem: "Apagar",
    destinosIds: ["wa"],
    agendadoPara: futuro(15, base)
  }, { agora: base });
  removerAgendamentoCampanha("cliente_delete", agendamentoDelete.agendamentoId);
  assert.strictEqual(listarAgendamentosCampanhas("cliente_delete").length, 0, "exclusao deve remover registro local");

  const ctxAll = contexto("cliente_all");
  salvarAgendamentoCampanha("cliente_all", {
    mensagem: "Rodada global",
    destinosIds: ["wa"],
    agendadoPara: futuro(1, base)
  }, { agora: base });
  const todos = await executarAgendamentosPendentesTodosClientes({
    deps: ctxAll.deps,
    agora: new Date(base.getTime() + 2 * 60 * 1000),
    clientes: ["cliente_all"]
  });
  assert.strictEqual(todos.resultados[0].processados, 1, "scheduler global deve processar cliente informado");

  const storage = readClienteJson("cliente_exec", "campanhas-agendamentos.json", []);
  assert.strictEqual(storage[0].status, "enviada", "storage deve persistir status final");

  console.log("campanhas-agendamentos.test.js OK");
})();
