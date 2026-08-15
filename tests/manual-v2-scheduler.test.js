const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-scheduler-"));

const storage = require("../modules/manual-v2/manual-offers.storage");
const {
  processarOfertaAgendadaManualV2,
  processarAgendamentosManuaisV2Cliente,
  limparLocksMemoriaManualV2
} = require("../modules/manual-v2/manual-scheduler");

const NOW = "2026-08-15T12:00:00.000Z";
const storageOptions = { now: () => NOW };

function criarOferta(clienteId, id, extra = {}) {
  return storage.criarOfertaManualV2(clienteId, {
    id,
    marketplace: "amazon",
    titulo: `Oferta ${id}`,
    precoAtual: "99,90",
    urlOriginal: `https://example.com/${id}`,
    ...extra
  }, {
    ...storageOptions,
    idFactory: () => id
  });
}

function agendarOferta(clienteId, id, agendadoPara, extra = {}) {
  const oferta = criarOferta(clienteId, id, extra.oferta || {});
  return storage.marcarOfertaManualV2Agendada(clienteId, oferta.id, {
    agendadoPara,
    agendamentoLocal: extra.agendamentoLocal || "2026-08-15T08:55",
    agendamentoTimezone: "America/Sao_Paulo",
    destinosIds: extra.destinosIds || ["destino_wa"],
    destinosAgendados: extra.destinosAgendados || [{
      id: "destino_wa",
      nome: "Grupo Ofertas",
      tipo: "whatsapp",
      ativo: true,
      utilizavel: true,
      identificacaoVisual: "Grupo Ofertas",
      token: "token_nao_sair",
      botToken: "bot_token_nao_sair",
      chatId: "chat_id_nao_sair",
      secret: "secret_nao_sair"
    }]
  }, storageOptions);
}

function depsScheduler(dispatcher, extra = {}) {
  return {
    now: () => NOW,
    storageOptions,
    lockIdFactory: () => extra.lockId || "lock_teste",
    enviarOfertaManualV2: dispatcher,
    ...extra
  };
}

function sucesso(destinosIds = ["destino_wa"]) {
  return {
    ok: true,
    ofertaId: "oferta",
    enviados: destinosIds.length,
    erros: 0,
    creditosDebitados: destinosIds.length,
    resultados: destinosIds.map((destinoId) => ({
      destinoId,
      nome: destinoId === "destino_tg" ? "Canal Ofertas" : "Grupo Ofertas",
      tipo: destinoId === "destino_tg" ? "telegram" : "whatsapp",
      status: "enviado",
      enviadoEm: "2026-08-15T12:00:00.000Z",
      erro: "",
      token: "token_nao_sair",
      botToken: "bot_token_nao_sair",
      chatId: "chat_id_nao_sair",
      secret: "secret_nao_sair"
    }))
  };
}

function falha(destinoId = "destino_wa") {
  return {
    ok: false,
    ofertaId: "oferta",
    enviados: 0,
    erros: 1,
    creditosDebitados: 0,
    resultados: [{
      destinoId,
      nome: "Grupo Ofertas",
      tipo: "whatsapp",
      status: "erro",
      enviadoEm: "",
      erro: "falha_mock",
      token: "token_nao_sair",
      botToken: "bot_token_nao_sair",
      chatId: "chat_id_nao_sair",
      secret: "secret_nao_sair"
    }]
  };
}

function parcial() {
  return {
    ok: true,
    ofertaId: "oferta",
    enviados: 1,
    erros: 1,
    creditosDebitados: 1,
    resultados: [
      {
        destinoId: "destino_wa",
        nome: "Grupo Ofertas",
        tipo: "whatsapp",
        status: "enviado",
        enviadoEm: "2026-08-15T12:00:00.000Z",
        erro: ""
      },
      {
        destinoId: "destino_tg",
        nome: "Canal Ofertas",
        tipo: "telegram",
        status: "erro",
        enviadoEm: "",
        erro: "falha_tg_mock",
        chatId: "chat_id_nao_sair"
      }
    ]
  };
}

function assertSemSegredos(valor) {
  const serializado = JSON.stringify(valor);
  for (const termo of ["token_nao_sair", "bot_token_nao_sair", "chat_id_nao_sair", "secret_nao_sair", "botToken", "chatId", "secret"]) {
    assert.ok(!serializado.includes(termo), `scheduler nao deve persistir/expor ${termo}`);
  }
}

(async function main() {
  limparLocksMemoriaManualV2();

  {
    const oferta = agendarOferta("cliente_future", "oferta_futura", "2026-08-15T12:10:00.000Z");
    const chamadas = [];
    const resposta = await processarAgendamentosManuaisV2Cliente({ clienteId: "cliente_future" }, depsScheduler(async (entrada) => {
      chamadas.push(entrada);
      return sucesso();
    }));

    assert.strictEqual(chamadas.length, 0, "oferta futura nao executa");
    assert.strictEqual(resposta.processados, 0);
    assert.strictEqual(storage.buscarOfertaManualV2("cliente_future", oferta.id).status, "agendada");
  }

  {
    const oferta = agendarOferta("cliente_sucesso", "oferta_sucesso", "2026-08-15T11:55:00.000Z");
    const chamadas = [];
    const resposta = await processarOfertaAgendadaManualV2({ clienteId: "cliente_sucesso", ofertaId: oferta.id }, depsScheduler(async (entrada) => {
      chamadas.push(entrada);
      return sucesso(entrada.destinosIds);
    }));

    assert.strictEqual(resposta.ok, true);
    assert.strictEqual(resposta.processado, true);
    assert.strictEqual(chamadas.length, 1, "dispatcher chamado exatamente uma vez");
    assert.deepStrictEqual(chamadas[0], {
      clienteId: "cliente_sucesso",
      ofertaId: oferta.id,
      destinosIds: ["destino_wa"]
    });

    const persistida = storage.buscarOfertaManualV2("cliente_sucesso", oferta.id);
    assert.strictEqual(persistida.status, "enviada");
    assert.strictEqual(persistida.enviadoEm, NOW);
    assert.strictEqual(persistida.envioManual.enviados, 1);
    assert.strictEqual(persistida.envioManual.creditosDebitados, 1);
    assert.strictEqual(persistida.agendamentoTentativas, 1);
    assert.strictEqual(persistida.agendamentoLockId || "", "");
    assert.strictEqual(persistida.agendamentoLockEm || "", "");
    assertSemSegredos(persistida);
  }

  {
    const oferta = agendarOferta("cliente_antigo", "oferta_antiga", "2026-08-15T11:00:00.000Z");
    const chamadas = [];
    const resposta = await processarOfertaAgendadaManualV2({ clienteId: "cliente_antigo", ofertaId: oferta.id }, depsScheduler(async (entrada) => {
      chamadas.push(entrada);
      return sucesso();
    }));

    assert.strictEqual(resposta.ok, false);
    assert.strictEqual(chamadas.length, 0, "vencida fora da janela nao chama dispatcher");
    const persistida = storage.buscarOfertaManualV2("cliente_antigo", oferta.id);
    assert.strictEqual(persistida.status, "erro");
    assert.strictEqual(Boolean(persistida.enviadoEm), false);
    assert.strictEqual(persistida.agendamentoTentativas, 1);
    assert.strictEqual(persistida.agendamentoErroResumo, "Agendamento vencido fora da janela segura");
  }

  {
    const oferta = agendarOferta("cliente_falha", "oferta_falha", "2026-08-15T11:58:00.000Z");
    const resposta = await processarOfertaAgendadaManualV2({ clienteId: "cliente_falha", ofertaId: oferta.id }, depsScheduler(async () => falha()));

    assert.strictEqual(resposta.ok, false);
    const persistida = storage.buscarOfertaManualV2("cliente_falha", oferta.id);
    assert.strictEqual(persistida.status, "erro");
    assert.strictEqual(Boolean(persistida.enviadoEm), false);
    assert.strictEqual(persistida.envioManual.enviados, 0);
    assert.strictEqual(persistida.envioManual.erros, 1);
    assert.strictEqual(persistida.envioManual.creditosDebitados, 0);
    assert.strictEqual(persistida.envioManual.erroResumo, "Grupo Ofertas: falha_mock");
    assert.strictEqual(persistida.agendamentoErroResumo, "Grupo Ofertas: falha_mock");
    assertSemSegredos(persistida);
  }

  {
    const oferta = agendarOferta("cliente_parcial", "oferta_parcial", "2026-08-15T11:57:00.000Z", {
      destinosIds: ["destino_wa", "destino_tg"],
      destinosAgendados: [
        {
          id: "destino_wa",
          nome: "Grupo Ofertas",
          tipo: "whatsapp",
          ativo: true,
          utilizavel: true,
          identificacaoVisual: "Grupo Ofertas"
        },
        {
          id: "destino_tg",
          nome: "Canal Ofertas",
          tipo: "telegram",
          ativo: true,
          utilizavel: true,
          identificacaoVisual: "Canal Ofertas",
          chatId: "chat_id_nao_sair"
        }
      ]
    });
    const resposta = await processarOfertaAgendadaManualV2({ clienteId: "cliente_parcial", ofertaId: oferta.id }, depsScheduler(async () => parcial()));

    assert.strictEqual(resposta.ok, true);
    const persistida = storage.buscarOfertaManualV2("cliente_parcial", oferta.id);
    assert.strictEqual(persistida.status, "enviada");
    assert.strictEqual(persistida.envioManual.enviados, 1);
    assert.strictEqual(persistida.envioManual.erros, 1);
    assert.strictEqual(persistida.envioManual.erroResumo, "Canal Ofertas: falha_tg_mock");
    assert.strictEqual(persistida.agendamentoErroResumo, "Canal Ofertas: falha_tg_mock");
    assertSemSegredos(persistida);
  }

  {
    const oferta = agendarOferta("cliente_lock", "oferta_lock", "2026-08-15T11:59:00.000Z");
    let liberar;
    const pendente = new Promise((resolve) => { liberar = resolve; });
    const chamadas = [];
    const dispatcher = async (entrada) => {
      chamadas.push(entrada);
      await pendente;
      return sucesso(entrada.destinosIds);
    };

    const primeira = processarOfertaAgendadaManualV2({ clienteId: "cliente_lock", ofertaId: oferta.id }, depsScheduler(dispatcher, {
      lockId: "lock_concorrente"
    }));
    const segunda = await processarOfertaAgendadaManualV2({ clienteId: "cliente_lock", ofertaId: oferta.id }, depsScheduler(dispatcher, {
      lockId: "lock_concorrente_2"
    }));
    liberar();
    await primeira;

    assert.strictEqual(segunda.processado, false);
    assert.strictEqual(segunda.motivo, "lock_memoria_ativo");
    assert.strictEqual(chamadas.length, 1, "lock em memoria impede segunda execucao no mesmo processo");

    const persistida = storage.buscarOfertaManualV2("cliente_lock", oferta.id);
    assert.strictEqual(persistida.status, "enviada");
    assert.strictEqual(persistida.agendamentoLockId || "", "");
    assert.strictEqual(persistida.agendamentoLockEm || "", "");
  }

  {
    const oferta = agendarOferta("cliente_status", "oferta_enviando", "2026-08-15T11:59:00.000Z");
    storage.atualizarMetadadosAgendamentoManualV2("cliente_status", oferta.id, {
      status: "enviando",
      agendamentoLockId: "lock_existente",
      agendamentoLockEm: NOW
    }, storageOptions);
    const chamadas = [];
    const resposta = await processarOfertaAgendadaManualV2({ clienteId: "cliente_status", ofertaId: oferta.id }, depsScheduler(async (entrada) => {
      chamadas.push(entrada);
      return sucesso();
    }));

    assert.strictEqual(resposta.processado, false);
    assert.strictEqual(chamadas.length, 0, "oferta enviando nao executa");
    assert.strictEqual(storage.buscarOfertaManualV2("cliente_status", oferta.id).status, "enviando");
  }

  {
    const oferta = agendarOferta("cliente_status", "oferta_enviada", "2026-08-15T11:59:00.000Z");
    storage.atualizarMetadadosEnvioManualV2("cliente_status", oferta.id, {
      status: "enviada",
      enviadoEm: NOW
    }, storageOptions);
    const chamadas = [];
    const resposta = await processarOfertaAgendadaManualV2({ clienteId: "cliente_status", ofertaId: oferta.id }, depsScheduler(async (entrada) => {
      chamadas.push(entrada);
      return sucesso();
    }));

    assert.strictEqual(resposta.processado, false);
    assert.strictEqual(chamadas.length, 0, "oferta enviada nao executa");
    assert.strictEqual(storage.buscarOfertaManualV2("cliente_status", oferta.id).status, "enviada");
  }

  {
    const fonteScheduler = fs.readFileSync(
      path.join(__dirname, "..", "modules", "manual-v2", "manual-scheduler.js"),
      "utf8"
    );
    const proibidos = [
      "utils/fila-ofertas",
      "fila.json",
      "processarFila",
      "adicionarOfertaInicioFila",
      "prepararOfertaGlobal",
      "enviarParaDestinoInteligente",
      "enviarOfertaAgoraDireto",
      "enviarCampanhaManual",
      "Engine",
      "Radar",
      "Distributor",
      "Oferta Universal",
      "/fila",
      "/enviar-manual",
      "enviarWhatsappManual",
      "enviarTelegramManual",
      "enviarWhatsApp",
      "enviarTelegram"
    ];

    for (const termo of proibidos) {
      assert.ok(!fonteScheduler.includes(termo), `scheduler Manual V2 nao pode referenciar ${termo}`);
    }
  }

  console.log("manual-v2-scheduler.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
