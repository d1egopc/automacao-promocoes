const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-scheduler-runner-"));

const storage = require("../modules/manual-v2/manual-offers.storage");
const {
  intervaloManualV2Ms,
  listarClientesComAgendadas,
  rodarCicloManualV2Scheduler,
  iniciarManualV2Scheduler,
  pararManualV2Scheduler
} = require("../modules/manual-v2/manual-scheduler.runner");

const NOW = "2026-08-15T12:00:00.000Z";
const storageOptions = { now: () => NOW };

function criarOferta(clienteId, id) {
  return storage.criarOfertaManualV2(clienteId, {
    id,
    marketplace: "amazon",
    titulo: `Oferta ${id}`,
    precoAtual: "99,90",
    urlOriginal: `https://example.com/${id}`
  }, {
    ...storageOptions,
    idFactory: () => id
  });
}

function agendar(clienteId, id, agendadoPara) {
  const oferta = criarOferta(clienteId, id);
  return storage.marcarOfertaManualV2Agendada(clienteId, oferta.id, {
    agendadoPara,
    agendamentoLocal: "2026-08-15T08:55",
    agendamentoTimezone: "America/Sao_Paulo",
    destinosIds: ["destino_wa"],
    destinosAgendados: [{
      id: "destino_wa",
      nome: "Grupo Ofertas",
      tipo: "whatsapp",
      ativo: true,
      utilizavel: true,
      identificacaoVisual: "Grupo Ofertas"
    }]
  }, storageOptions);
}

function loggerCaptura() {
  const linhas = [];
  return {
    linhas,
    log: (...args) => linhas.push(args)
  };
}

function dispatcherSucesso(chamadas) {
  return async (entrada) => {
    chamadas.push(entrada);
    return {
      ok: true,
      ofertaId: entrada.ofertaId,
      enviados: 1,
      erros: 0,
      creditosDebitados: 1,
      resultados: [{
        destinoId: entrada.destinosIds[0],
        nome: "Grupo Ofertas",
        tipo: "whatsapp",
        status: "enviado",
        enviadoEm: NOW,
        erro: ""
      }]
    };
  };
}

(async function main() {
  pararManualV2Scheduler();

  {
    const logger = loggerCaptura();
    const chamadas = [];
    const resultado = await rodarCicloManualV2Scheduler({
      clientes: ["cliente_vazio"],
      storageOptions,
      logger,
      enviarOfertaManualV2: dispatcherSucesso(chamadas)
    });

    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.semTrabalho, true);
    assert.strictEqual(chamadas.length, 0, "ciclo vazio nao chama dispatcher");
    assert.strictEqual(logger.linhas.length, 0, "ciclo vazio nao gera log ruidoso");
  }

  {
    agendar("cliente_runner", "oferta_due", "2026-08-15T11:55:00.000Z");
    agendar("cliente_runner", "oferta_expirada", "2026-08-15T11:00:00.000Z");
    const chamadas = [];
    const logger = loggerCaptura();
    const resultado = await rodarCicloManualV2Scheduler({
      clientes: ["cliente_runner"],
      storageOptions,
      now: () => NOW,
      logger,
      enviarOfertaManualV2: dispatcherSucesso(chamadas)
    });

    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.totalAgendadas, 2);
    assert.strictEqual(chamadas.length, 1, "startup/ciclo respeita grace: apenas vencida recente envia");
    assert.strictEqual(chamadas[0].ofertaId, "oferta_due");
    assert.strictEqual(storage.buscarOfertaManualV2("cliente_runner", "oferta_due").status, "enviada");
    const expirada = storage.buscarOfertaManualV2("cliente_runner", "oferta_expirada");
    assert.strictEqual(expirada.status, "erro");
    assert.strictEqual(expirada.enviadoEm || "", "");
    assert.strictEqual(expirada.agendamentoErroResumo, "Agendamento vencido fora da janela segura");
    assert.ok(logger.linhas.some((linha) => String(linha[0]).includes("ciclo_iniciado")));
    assert.ok(logger.linhas.some((linha) => String(linha[0]).includes("ciclo_finalizado")));
  }

  {
    const clientes = listarClientesComAgendadas({
      clientes: ["cliente_runner", "cliente_vazio"],
      storageOptions
    });
    assert.deepStrictEqual(clientes, []);
  }

  {
    const logger = loggerCaptura();
    const resultado = await rodarCicloManualV2Scheduler({
      clientes: ["cliente_erro"],
      listarOfertasManuaisV2: () => [{ id: "oferta_erro", status: "agendada" }],
      processarAgendamentosManuaisV2Cliente: async () => {
        throw new Error("falha_controlada_scheduler");
      },
      logger
    });

    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.erro, "falha_controlada_scheduler");
    assert.ok(logger.linhas.some((linha) => String(linha[0]).includes("erro_fail_open")));
  }

  {
    assert.strictEqual(intervaloManualV2Ms(undefined), 60000);
    assert.strictEqual(intervaloManualV2Ms(45000), 45000);
    assert.strictEqual(intervaloManualV2Ms(1000), 30000, "intervalo agressivo e limitado ao minimo conservador");
  }

  {
    let intervalosCriados = 0;
    let intervalsLimpos = 0;
    const logger = loggerCaptura();
    const primeiro = iniciarManualV2Scheduler({
      clientes: ["cliente_vazio"],
      storageOptions,
      logger,
      intervalMs: 45000,
      setInterval: (_fn, ms) => {
        intervalosCriados += 1;
        return { ms };
      },
      clearInterval: () => {
        intervalsLimpos += 1;
      },
      defer: () => {}
    });
    const segundo = iniciarManualV2Scheduler({
      intervalMs: 30000,
      setInterval: () => {
        intervalosCriados += 1;
        return {};
      },
      defer: () => {}
    });

    assert.strictEqual(primeiro.iniciado, true);
    assert.strictEqual(primeiro.intervalMs, 45000);
    assert.strictEqual(segundo.iniciado, false);
    assert.strictEqual(segundo.motivo, "manual_v2_scheduler_ja_iniciado");
    assert.strictEqual(intervalosCriados, 1, "nao inicia timer duplicado no mesmo processo");
    pararManualV2Scheduler();
    assert.strictEqual(intervalsLimpos, 1);
  }

  {
    const fonteRunner = fs.readFileSync(
      path.join(__dirname, "..", "modules", "manual-v2", "manual-scheduler.runner.js"),
      "utf8"
    );
    const fonteIndex = fs.readFileSync(
      path.join(__dirname, "..", "index.js"),
      "utf8"
    );
    const proibidosRunner = [
      "utils/fila-ofertas",
      "fila.json",
      "processarFila",
      "adicionarOfertaInicioFila",
      "prepararOfertaGlobal",
      "Engine",
      "Radar",
      "Distributor",
      "Oferta Universal",
      "/fila",
      "/enviar-manual"
    ];

    for (const termo of proibidosRunner) {
      assert.ok(!fonteRunner.includes(termo), `runner Manual V2 nao pode referenciar ${termo}`);
    }

    assert.ok(fonteIndex.includes("iniciarManualV2Scheduler({"), "index deve iniciar runner Manual V2");
    assert.ok(fonteIndex.includes("enviarOfertaManualV2Dispatcher"), "index deve compor com dispatcher Manual V2 homologado");
    assert.ok(fonteIndex.includes("MANUAL_V2_SCHEDULER_INTERVAL_MS"), "intervalo deve ser configuravel por env");
  }

  console.log("manual-v2-scheduler-runner.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
