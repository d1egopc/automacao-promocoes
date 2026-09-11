const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-auto-dispatch-"));

const storage = require("../modules/manual-v2/manual-offers.storage");
const {
  INTERVALO_AUTO_MINIMO_MS,
  INTERVALO_AUTO_MAXIMO_MS,
  ORIGEM_AGENDAMENTO_AUTOMATICO,
  autorizarProximoDespachoAutomaticoCliente,
  registrarTentativaDespachoAutomatico
} = require("../modules/manual-v2/manual-auto-dispatch");
const {
  rodarCicloManualV2Scheduler,
  pararManualV2Scheduler
} = require("../modules/manual-v2/manual-scheduler.runner");

let agora = "2026-09-11T12:00:00.000Z";
const storageOptions = {
  now: () => agora,
  idFactory: () => `manual_auto_${Date.now()}_${Math.random().toString(16).slice(2)}`
};

function destino(id = "destino_wa") {
  return {
    id,
    nome: "Grupo Manual",
    tipo: "whatsapp",
    ativo: true,
    utilizavel: true,
    motivoIndisponivel: "",
    identificacaoVisual: "Grupo Manual"
  };
}

function depsAuto(extra = {}) {
  return {
    ...extra,
    now: () => agora,
    storageOptions,
    lerConfigManualV2: storage.lerConfigManualV2,
    salvarConfigManualV2: storage.salvarConfigManualV2,
    listarOfertasManuaisV2: storage.listarOfertasManuaisV2,
    agendarOfertaManualV2Automaticamente: storage.agendarOfertaManualV2Automaticamente,
    listarDestinosManuaisV2Async: async () => [destino()]
  };
}

function criarOferta(clienteId, id, status = "salva") {
  const oferta = storage.criarOfertaManualV2(clienteId, {
    id,
    marketplace: "amazon",
    titulo: id,
    precoAtual: "99,90",
    urlOriginal: `https://example.com/${id}`
  }, { ...storageOptions, idFactory: () => id });
  if (status === "agendada") {
    return storage.marcarOfertaManualV2Agendada(clienteId, id, {
      agendadoPara: "2026-09-12T12:00:00.000Z",
      destinosIds: ["destino_wa"],
      destinosAgendados: [destino()]
    }, storageOptions);
  }
  if (status !== "salva") {
    return storage.atualizarMetadadosEnvioManualV2(clienteId, id, { status }, storageOptions);
  }
  return oferta;
}

function salvarAuto(clienteId, dados = {}) {
  return storage.salvarConfigManualV2(clienteId, {
    automacoesNovasOfertas: { vitrine: { ativa: true } },
    despachoAutomatico: {
      ativo: true,
      destinosIds: ["destino_wa"],
      intervaloMs: INTERVALO_AUTO_MINIMO_MS,
      ultimoDespachoEm: null,
      ...dados
    }
  }, storageOptions);
}

(async function main() {
  pararManualV2Scheduler();

  {
    storage.salvarConfigManualV2("config", {
      automacoesNovasOfertas: { vitrine: { ativa: true } }
    }, storageOptions);
    const config = storage.lerConfigManualV2("config", storageOptions);
    assert.strictEqual(config.automacoesNovasOfertas.vitrine.ativa, true);
    assert.deepStrictEqual(config.despachoAutomatico, {
      ativo: false,
      destinosIds: [],
      intervaloMs: INTERVALO_AUTO_MINIMO_MS,
      ultimoDespachoEm: ""
    });

    assert.throws(() => salvarAuto("config_min", { intervaloMs: INTERVALO_AUTO_MINIMO_MS - 1 }), /intervalo_invalido/);
    assert.throws(() => salvarAuto("config_max", { intervaloMs: INTERVALO_AUTO_MAXIMO_MS + 1 }), /intervalo_invalido/);
    assert.throws(() => salvarAuto("config_destinos", { destinosIds: [] }), /destinos_obrigatorios/);
  }

  {
    criarOferta("off", "off_salva");
    storage.salvarConfigManualV2("off", {
      despachoAutomatico: {
        ativo: false,
        destinosIds: ["destino_wa"],
        intervaloMs: INTERVALO_AUTO_MINIMO_MS
      }
    }, storageOptions);
    const resultado = await autorizarProximoDespachoAutomaticoCliente("off", depsAuto());
    assert.strictEqual(resultado.autorizado, false);
    assert.strictEqual(storage.buscarOfertaManualV2("off", "off_salva").status, "salva");
  }

  {
    criarOferta("sem_destino", "sem_destino_salva");
    storage.salvarConfigManualV2("sem_destino", {
      despachoAutomatico: {
        ativo: false,
        destinosIds: [],
        intervaloMs: INTERVALO_AUTO_MINIMO_MS
      }
    }, storageOptions);
    const resultado = await autorizarProximoDespachoAutomaticoCliente("sem_destino", depsAuto());
    assert.strictEqual(resultado.autorizado, false);
    assert.strictEqual(storage.buscarOfertaManualV2("sem_destino", "sem_destino_salva").status, "salva");
  }

  {
    salvarAuto("elegibilidade");
    criarOferta("elegibilidade", "salva");
    criarOferta("elegibilidade", "agendada", "agendada");
    criarOferta("elegibilidade", "enviando", "enviando");
    criarOferta("elegibilidade", "enviada", "enviada");
    criarOferta("elegibilidade", "erro", "erro");

    const resultado = await autorizarProximoDespachoAutomaticoCliente("elegibilidade", depsAuto());
    assert.strictEqual(resultado.autorizado, true);
    assert.strictEqual(resultado.ofertaId, "salva");
    const auto = storage.buscarOfertaManualV2("elegibilidade", "salva");
    assert.strictEqual(auto.status, "agendada");
    assert.strictEqual(auto.origemAgendamento, ORIGEM_AGENDAMENTO_AUTOMATICO);
    assert.deepStrictEqual(auto.destinosIds, ["destino_wa"]);
    assert.strictEqual(storage.buscarOfertaManualV2("elegibilidade", "agendada").origemAgendamento || "", "", "reloginho individual permanece intacto");
    for (const id of ["enviando", "enviada", "erro"]) {
      assert.strictEqual(storage.buscarOfertaManualV2("elegibilidade", id).status, id);
    }

    criarOferta("elegibilidade", "segunda_salva");
    const segunda = await autorizarProximoDespachoAutomaticoCliente("elegibilidade", depsAuto());
    assert.strictEqual(segunda.autorizado, false);
    assert.strictEqual(segunda.motivo, "despacho_automatico_ja_agendado");
    assert.strictEqual(storage.buscarOfertaManualV2("elegibilidade", "segunda_salva").status, "salva");
  }

  {
    salvarAuto("intervalo");
    criarOferta("intervalo", "intervalo_primeira");
    const primeira = await autorizarProximoDespachoAutomaticoCliente("intervalo", depsAuto());
    const processada = {
      processado: true,
      oferta: primeira.oferta
    };
    registrarTentativaDespachoAutomatico("intervalo", processada, depsAuto());
    assert.strictEqual(storage.lerConfigManualV2("intervalo").despachoAutomatico.ultimoDespachoEm, agora);
    storage.atualizarMetadadosAgendamentoManualV2("intervalo", primeira.ofertaId, {
      status: "enviada",
      limparLock: true
    }, storageOptions);
    criarOferta("intervalo", "intervalo_segunda");
    agora = "2026-09-11T12:02:29.000Z";
    const bloqueada = await autorizarProximoDespachoAutomaticoCliente("intervalo", depsAuto());
    assert.strictEqual(bloqueada.autorizado, false);
    assert.strictEqual(bloqueada.motivo, "despacho_automatico_intervalo_ativo");
    agora = "2026-09-11T12:02:30.000Z";
    const liberada = await autorizarProximoDespachoAutomaticoCliente("intervalo", depsAuto());
    assert.strictEqual(liberada.autorizado, true);
    assert.strictEqual(liberada.ofertaId, "intervalo_segunda");
  }

  {
    salvarAuto("workspace_a");
    criarOferta("workspace_a", "oferta_a");
    criarOferta("workspace_b", "oferta_b");
    const resultado = await autorizarProximoDespachoAutomaticoCliente("workspace_a", depsAuto());
    assert.strictEqual(resultado.autorizado, true);
    assert.strictEqual(storage.buscarOfertaManualV2("workspace_a", "oferta_a").status, "agendada");
    assert.strictEqual(storage.buscarOfertaManualV2("workspace_b", "oferta_b").status, "salva");
  }

  {
    agora = "2026-09-11T13:00:00.000Z";
    salvarAuto("runner");
    criarOferta("runner", "runner_auto");
    const resultado = await rodarCicloManualV2Scheduler({
      clientes: ["runner"],
      ...depsAuto(),
      enviarOfertaManualV2: async ({ ofertaId, destinosIds }) => ({
        ok: true,
        ofertaId,
        enviados: 1,
        erros: 0,
        creditosDebitados: 1,
        resultados: [{
          destinoId: destinosIds[0],
          nome: "Grupo Manual",
          tipo: "whatsapp",
          status: "enviado",
          enviadoEm: agora,
          erro: ""
        }]
      }),
      logger: { log: () => {} }
    });
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(storage.buscarOfertaManualV2("runner", "runner_auto").status, "enviada");
    assert.strictEqual(storage.lerConfigManualV2("runner").despachoAutomatico.ultimoDespachoEm, agora);
  }

  console.log("manual-v2-auto-dispatch.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
