const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  ARQUIVO_OFERTAS_MANUAL_V2
} = require("../modules/manual-v2/manual-offers.storage");
const {
  INTERVALO_RETENCAO_PADRAO_MS,
  INTERVALO_RETENCAO_MINIMO_MS,
  intervaloRetencaoManualV2Ms,
  rodarCicloRetencaoManualV2,
  iniciarManualV2Retention,
  pararManualV2Retention
} = require("../modules/manual-v2/manual-retention.runner");

const NOW = "2026-08-15T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function diasAtras(dias) {
  return new Date(Date.parse(NOW) - dias * DAY_MS).toISOString();
}

function clone(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function oferta(clienteId, id, status, extras = {}) {
  return {
    id,
    clienteId,
    marketplace: "amazon",
    titulo: id,
    status,
    criadoEm: extras.criadoEm || diasAtras(20),
    atualizadoEm: extras.atualizadoEm || diasAtras(20),
    ...extras
  };
}

function criarStorageMock(inicial = {}) {
  const dados = new Map(Object.entries(inicial).map(([clienteId, ofertas]) => [clienteId, clone(ofertas)]));
  const escritas = {};
  return {
    dados,
    escritas,
    deps: {
      normalizarClienteId: (clienteId) => String(clienteId || "admin"),
      readClienteJson: (clienteId, arquivo, fallback) => {
        assert.strictEqual(arquivo, ARQUIVO_OFERTAS_MANUAL_V2);
        return clone(dados.get(clienteId) || fallback);
      },
      writeClienteJson: (clienteId, arquivo, ofertas) => {
        assert.strictEqual(arquivo, ARQUIVO_OFERTAS_MANUAL_V2);
        escritas[clienteId] = (escritas[clienteId] || 0) + 1;
        dados.set(clienteId, clone(ofertas));
        return true;
      }
    }
  };
}

const loggerSilencioso = {
  log() {}
};

(async () => {
  {
    assert.strictEqual(intervaloRetencaoManualV2Ms(undefined), INTERVALO_RETENCAO_PADRAO_MS);
    assert.strictEqual(intervaloRetencaoManualV2Ms("abc"), INTERVALO_RETENCAO_PADRAO_MS);
    assert.strictEqual(intervaloRetencaoManualV2Ms(10 * 60 * 1000), INTERVALO_RETENCAO_MINIMO_MS);
    assert.strictEqual(intervaloRetencaoManualV2Ms(2 * 60 * 60 * 1000), 2 * 60 * 60 * 1000);
  }

  {
    let chamadas = 0;
    const resultado = await rodarCicloRetencaoManualV2({
      clientes: [],
      logger: loggerSilencioso,
      limparRetencaoManualV2Cliente: () => {
        chamadas += 1;
      }
    });
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.semTrabalho, true);
    assert.strictEqual(resultado.clientesProcessados, 0);
    assert.strictEqual(chamadas, 0, "ciclo sem clientes nao deve chamar limpeza");
  }

  {
    const storage = criarStorageMock({
      cliente_remove: [
        oferta("cliente_remove", "enviada_antiga", "enviada", {
          enviadoEm: diasAtras(8)
        }),
        oferta("cliente_remove", "erro_antigo", "erro", {
          envioManual: {
            concluidoEm: diasAtras(8)
          }
        }),
        oferta("cliente_remove", "salva_preservada", "salva", {
          atualizadoEm: diasAtras(50)
        })
      ],
      cliente_sem_elegiveis: [
        oferta("cliente_sem_elegiveis", "enviada_recente", "enviada", {
          enviadoEm: diasAtras(2)
        }),
        oferta("cliente_sem_elegiveis", "agendada_antiga", "agendada", {
          agendadoPara: diasAtras(10)
        })
      ]
    });

    const resultado = await rodarCicloRetencaoManualV2({
      clientes: ["cliente_remove", "cliente_sem_elegiveis"],
      now: NOW,
      logger: loggerSilencioso,
      storageOptions: storage.deps
    });

    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.clientesProcessados, 2);
    assert.strictEqual(resultado.clientesComErro, 0);
    assert.strictEqual(resultado.removidos, 2);
    assert.strictEqual(resultado.preservados, 3);
    assert.deepStrictEqual(resultado.porStatus, { enviada: 1, erro: 1 });
    assert.deepStrictEqual(storage.dados.get("cliente_remove").map((item) => item.id), ["salva_preservada"]);
    assert.deepStrictEqual(storage.dados.get("cliente_sem_elegiveis").map((item) => item.id), [
      "enviada_recente",
      "agendada_antiga"
    ]);
    assert.strictEqual(storage.escritas.cliente_remove, 1);
    assert.strictEqual(storage.escritas.cliente_sem_elegiveis || 0, 0, "cliente sem elegiveis nao deve escrever");

    const segunda = await rodarCicloRetencaoManualV2({
      clientes: ["cliente_remove", "cliente_sem_elegiveis"],
      now: NOW,
      logger: loggerSilencioso,
      storageOptions: storage.deps
    });
    assert.strictEqual(segunda.removidos, 0);
    assert.strictEqual(storage.escritas.cliente_remove, 1, "segunda execucao idempotente nao escreve de novo");
  }

  {
    const eventos = [];
    const resultado = await rodarCicloRetencaoManualV2({
      clientes: ["cliente_erro", "cliente_ok"],
      logger: {
        log: (evento, dados) => eventos.push({ evento, dados })
      },
      limparRetencaoManualV2Cliente: (clienteId) => {
        if (clienteId === "cliente_erro") {
          throw new Error("falha_cliente");
        }
        return {
          ok: true,
          clienteId,
          removidos: 3,
          preservados: 4,
          porStatus: {
            enviada: 2,
            erro: 1
          }
        };
      }
    });

    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.clientesProcessados, 1);
    assert.strictEqual(resultado.clientesComErro, 1);
    assert.strictEqual(resultado.removidos, 3);
    assert.strictEqual(resultado.preservados, 4);
    assert.deepStrictEqual(resultado.porStatus, { enviada: 2, erro: 1 });
    assert.ok(eventos.some((item) => String(item.evento).includes("cliente_erro_fail_open")));
  }

  {
    const resultado = await rodarCicloRetencaoManualV2({
      listClientes: () => {
        throw new Error("falha_geral");
      },
      logger: loggerSilencioso
    });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.erro, "falha_geral");
  }

  {
    pararManualV2Retention();
    const timers = [];
    let clears = 0;
    let unrefs = 0;
    const iniciado = iniciarManualV2Retention({
      intervalMs: 10,
      logger: loggerSilencioso,
      defer: () => {},
      setInterval: (fn, ms) => {
        const timer = {
          fn,
          ms,
          unref: () => {
            unrefs += 1;
          }
        };
        timers.push(timer);
        return timer;
      },
      clearInterval: () => {
        clears += 1;
      }
    });
    const segundo = iniciarManualV2Retention({
      logger: loggerSilencioso,
      defer: () => {},
      setInterval: () => {
        throw new Error("nao_deve_iniciar_segundo_timer");
      }
    });

    assert.strictEqual(iniciado.ok, true);
    assert.strictEqual(iniciado.iniciado, true);
    assert.strictEqual(iniciado.intervalMs, INTERVALO_RETENCAO_MINIMO_MS);
    assert.strictEqual(segundo.ok, true);
    assert.strictEqual(segundo.iniciado, false);
    assert.strictEqual(segundo.motivo, "manual_v2_retention_ja_iniciado");
    assert.strictEqual(timers.length, 1);
    assert.strictEqual(timers[0].ms, INTERVALO_RETENCAO_MINIMO_MS);
    assert.strictEqual(unrefs, 1);
    pararManualV2Retention();
    assert.strictEqual(clears, 1);
  }

  {
    pararManualV2Retention();
    let deferChamou = 0;
    iniciarManualV2Retention({
      clientes: [],
      logger: loggerSilencioso,
      setInterval: () => ({ unref() {} }),
      clearInterval: () => {},
      defer: (fn) => {
        deferChamou += 1;
        return Promise.resolve().then(fn);
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(deferChamou, 1, "startup agenda um ciclo fail-open");
    pararManualV2Retention();
  }

  {
    const fonte = fs.readFileSync(
      path.join(__dirname, "..", "modules", "manual-v2", "manual-retention.runner.js"),
      "utf8"
    );
    const proibidos = [
      "utils/fila-ofertas",
      "processarFila",
      "prepararOfertaGlobal",
      "adicionarOfertaInicioFila",
      "enviarOfertaManualV2",
      "manual-dispatcher",
      "manual-scheduler",
      "Distributor",
      "Oferta Universal",
      "oferta-universal",
      "Engine",
      "Radar",
      "radar-ofertas",
      "fila.json",
      "/fila",
      "/enviar-manual"
    ];

    for (const termo of proibidos) {
      assert.ok(!fonte.includes(termo), `Manual V2 retention runner nao pode referenciar ${termo}`);
    }
  }

  console.log("manual-v2-retention-runner.test.js ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
