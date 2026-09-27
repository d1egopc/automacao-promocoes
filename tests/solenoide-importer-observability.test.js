"use strict";

const assert = require("assert");
const { executarImportacaoComSolenoide } = require("../modules/engine/orchestrator.runner");
const { ESTADOS, planoColetor } = require("../modules/solenoide/solenoide.service");

async function executarComCaptura({ decisao, plano, rodadaId = "engine_observabilidade_1", marketplace = "amazon" } = {}) {
  const logs = [];
  const chamadas = [];
  const anterior = console.log;
  console.log = (...args) => logs.push(args);
  try {
    await executarImportacaoComSolenoide({
      nome: `importar_${marketplace}`,
      marketplace,
      limite: plano.limiteOriginal,
      rodadaId,
      decisaoSolenoide: decisao,
      solenoide: {
        planoColetor() {
          return { ...plano, marketplace };
        }
      },
      importarJobsProntosEngine: async args => {
        chamadas.push(args);
        return { processados: 0 };
      },
      depsImportador: {}
    });
  } finally {
    console.log = anterior;
  }

  const entrada = logs.find(args => args[0] === "[SOLENOID IMPORTADOR]");
  assert(entrada, "deve emitir uma linha compacta por importador");
  return { registro: JSON.parse(entrada[1]), chamadas, logs };
}

async function main() {
  const planoModeradoReal = planoColetor({ estado: ESTADOS.MODERADO, aplicouMudancas: true }, {
    marketplace: "mercadolivre",
    limite: 36
  });
  assert.strictEqual(planoModeradoReal.limiteOriginal, 36);
  assert.strictEqual(planoModeradoReal.limite, 18);
  assert.strictEqual(planoModeradoReal.executar, true);

  const planoAbertoReal = planoColetor({ estado: ESTADOS.ABERTO, aplicouMudancas: true }, { limite: 36 });
  assert.strictEqual(planoAbertoReal.limiteOriginal, 36);
  assert.strictEqual(planoAbertoReal.limite, 36);

  const planoFechadoReal = planoColetor({ estado: ESTADOS.FECHADO, aplicouMudancas: true }, { limite: 36 });
  assert.strictEqual(planoFechadoReal.limiteOriginal, 36);
  assert.strictEqual(planoFechadoReal.executar, false);

  const handlesAntes = typeof process._getActiveHandles === "function" ? process._getActiveHandles().length : 0;
  const listenersAntes = process.eventNames().reduce((total, evento) => total + process.listenerCount(evento), 0);
  const base = { limiteOriginal: 36, limite: 36, executar: true, motivo: "solenoide_aberto" };

  const off = await executarComCaptura({
    decisao: { modo: "off", estado: "ABERTO", aplicouMudancas: false },
    plano: { ...base, motivo: "sem_autoridade" }
  });
  assert.deepStrictEqual(off.registro, {
    rodadaId: "engine_observabilidade_1",
    marketplace: "amazon",
    modo: "off",
    estado: "ABERTO",
    acao: "coleta_normal",
    limiteOriginal: 36,
    limiteAplicado: 36,
    aplicouMudancas: false,
    motivo: "sem_autoridade"
  });
  assert.strictEqual(off.chamadas[0].limite, 36);

  const aberto = await executarComCaptura({
    decisao: { modo: "active", estado: "ABERTO", aplicouMudancas: true },
    plano: base
  });
  assert.strictEqual(aberto.registro.acao, "coleta_normal");
  assert.strictEqual(aberto.registro.limiteOriginal, 36);
  assert.strictEqual(aberto.registro.limiteAplicado, 36);
  assert.strictEqual(aberto.chamadas[0].limite, 36);

  const moderado = await executarComCaptura({
    decisao: { modo: "active", estado: "MODERADO", aplicouMudancas: true },
    plano: { ...base, limite: 18, motivo: "solenoide_moderado" }
  });
  assert.strictEqual(moderado.registro.acao, "reduzir_lote");
  assert.strictEqual(moderado.registro.limiteOriginal, 36);
  assert.strictEqual(moderado.registro.limiteAplicado, 18);
  assert.strictEqual(moderado.registro.aplicouMudancas, true);
  assert.strictEqual(moderado.chamadas[0].limite, 18);

  const fechado = await executarComCaptura({
    decisao: { modo: "active", estado: "FECHADO", aplicouMudancas: true },
    plano: { ...base, executar: false, motivo: "solenoide_fechado" }
  });
  assert.strictEqual(fechado.registro.acao, "pular_importacao");
  assert.strictEqual(fechado.registro.limiteOriginal, 36);
  assert.strictEqual(fechado.registro.limiteAplicado, 0);
  assert.strictEqual(fechado.chamadas.length, 0);

  const shadow = await executarComCaptura({
    decisao: { modo: "shadow", estado: "FECHADO", aplicouMudancas: false },
    plano: { ...base, motivo: "sem_autoridade" }
  });
  assert.strictEqual(shadow.registro.acao, "coleta_normal");
  assert.strictEqual(shadow.registro.limiteAplicado, 36);
  assert.strictEqual(shadow.registro.aplicouMudancas, false);

  const marketplaces = ["mercadolivre", "amazon", "shopee", "aliexpress", "awin", "kabum", "magalu"];
  const rodadaId = "engine_active_observabilidade_7";
  const registros = [];
  for (const marketplace of marketplaces) {
    const resultado = await executarComCaptura({
      marketplace,
      rodadaId,
      decisao: { modo: "active", estado: "MODERADO", aplicouMudancas: true },
      plano: { ...base, limite: 18, motivo: "solenoide_moderado" }
    });
    registros.push(resultado.registro);
  }
  assert.deepStrictEqual(registros.map(item => item.rodadaId), marketplaces.map(() => rodadaId));
  assert.deepStrictEqual(registros.map(item => item.marketplace), marketplaces);
  assert(registros.every(item => item.limiteOriginal === 36 && item.limiteAplicado === 18));
  assert(registros.every(item => item.aplicouMudancas === true));

  const handlesDepois = typeof process._getActiveHandles === "function" ? process._getActiveHandles().length : 0;
  const listenersDepois = process.eventNames().reduce((total, evento) => total + process.listenerCount(evento), 0);
  assert(handlesDepois <= handlesAntes + 1, `sem crescimento de handles: ${handlesAntes} -> ${handlesDepois}`);
  assert.strictEqual(listenersDepois, listenersAntes, "nenhum listener novo por importador");

  const texto = JSON.stringify(registros);
  for (const proibido of ["workspaceId", "clienteId", "produto", "token", "cookie", "payload", "credencial"]) {
    assert(!texto.includes(proibido), `log não pode conter ${proibido}`);
  }
  console.log("solenoide-importer-observability: PASS");
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
