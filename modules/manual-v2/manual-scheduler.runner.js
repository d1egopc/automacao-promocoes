const {
  listClientes
} = require("../../utils/storage");
const storagePadrao = require("./manual-offers.storage");
const {
  processarAgendamentosManuaisV2Cliente
} = require("./manual-scheduler");

const INTERVALO_PADRAO_MS = 60 * 1000;
const INTERVALO_MINIMO_MS = 30 * 1000;

const estado = {
  timer: null,
  rodando: false,
  intervalMs: 0
};

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function inteiro(valor = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? Math.floor(numero) : 0;
}

function intervaloManualV2Ms(valor = process.env.MANUAL_V2_SCHEDULER_INTERVAL_MS) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return INTERVALO_PADRAO_MS;
  return Math.max(INTERVALO_MINIMO_MS, Math.floor(numero));
}

function loggerSeguro(deps = {}) {
  const logger = deps.logger || console;
  return typeof logger.log === "function" ? logger : console;
}

function logar(deps = {}, evento = "", dados = {}) {
  loggerSeguro(deps).log(`[MANUAL-V2-SCHEDULER] ${evento}`, dados);
}

function listarClientesComAgendadas(deps = {}) {
  const listarClientes = deps.listClientes || listClientes;
  const listarOfertas = deps.listarOfertasManuaisV2 || storagePadrao.listarOfertasManuaisV2;
  const clientes = Array.isArray(deps.clientes) ? deps.clientes : listarClientes();
  const storageOptions = deps.storageOptions || {};
  const resultado = [];

  for (const clienteId of clientes.map(texto).filter(Boolean)) {
    const ofertas = listarOfertas(clienteId, storageOptions)
      .filter((oferta) => texto(oferta.status).toLowerCase() === "agendada");
    if (ofertas.length) {
      resultado.push({
        clienteId,
        totalAgendadas: ofertas.length
      });
    }
  }

  return resultado;
}

function resumoResultadoOferta(item = {}) {
  const oferta = item.oferta || {};
  const resultado = item.resultado || {};
  return {
    ofertaId: texto(item.ofertaId || oferta.id),
    processado: item.processado === true,
    ok: item.ok === true,
    status: texto(oferta.status),
    motivo: texto(item.motivo),
    enviados: inteiro(resultado.enviados),
    erros: inteiro(resultado.erros)
  };
}

async function rodarCicloManualV2Scheduler(deps = {}) {
  if (estado.rodando) {
    return {
      ok: true,
      pulado: true,
      motivo: "ciclo_em_execucao"
    };
  }

  estado.rodando = true;
  try {
    const clientes = listarClientesComAgendadas(deps);
    const totalAgendadas = clientes.reduce((total, item) => total + item.totalAgendadas, 0);
    if (!totalAgendadas) {
      return {
        ok: true,
        semTrabalho: true,
        clientes: 0,
        totalAgendadas: 0
      };
    }

    logar(deps, "ciclo_iniciado", {
      clientes: clientes.length,
      totalAgendadas
    });

    const resultados = [];
    const processarCliente = deps.processarAgendamentosManuaisV2Cliente || processarAgendamentosManuaisV2Cliente;
    for (const item of clientes) {
      const resultadoCliente = await processarCliente({
        clienteId: item.clienteId
      }, deps);
      resultados.push(resultadoCliente);

      for (const resultadoOferta of resultadoCliente.resultados || []) {
        const resumo = resumoResultadoOferta(resultadoOferta);
        if (resumo.processado || resumo.motivo) {
          logar(deps, "oferta_agendada_processada", {
            clienteId: item.clienteId,
            ...resumo
          });
        }
      }
    }

    logar(deps, "ciclo_finalizado", {
      clientes: clientes.length,
      totalAgendadas,
      processados: resultados.reduce((total, item) => total + inteiro(item.processados), 0)
    });

    return {
      ok: true,
      semTrabalho: false,
      clientes: clientes.length,
      totalAgendadas,
      resultados
    };
  } catch (e) {
    logar(deps, "erro_fail_open", {
      erro: e.message || "manual_v2_scheduler_falhou"
    });
    return {
      ok: false,
      erro: e.message || "manual_v2_scheduler_falhou"
    };
  } finally {
    estado.rodando = false;
  }
}

function iniciarManualV2Scheduler(deps = {}) {
  if (estado.timer) {
    return {
      ok: true,
      iniciado: false,
      motivo: "manual_v2_scheduler_ja_iniciado",
      intervalMs: estado.intervalMs
    };
  }

  const intervalMs = intervaloManualV2Ms(deps.intervalMs);
  const setIntervalFn = deps.setInterval || setInterval;
  const clearIntervalFn = deps.clearInterval || clearInterval;
  const defer = deps.defer || ((fn) => Promise.resolve().then(fn));
  const ciclo = () => rodarCicloManualV2Scheduler(deps);

  estado.intervalMs = intervalMs;
  estado.clearInterval = clearIntervalFn;
  estado.timer = setIntervalFn(() => {
    ciclo().catch((e) => {
      logar(deps, "erro_intervalo_fail_open", {
        erro: e.message || "manual_v2_scheduler_intervalo_falhou"
      });
    });
  }, intervalMs);

  if (estado.timer && typeof estado.timer.unref === "function") {
    estado.timer.unref();
  }

  defer(() => {
    ciclo().catch((e) => {
      logar(deps, "erro_startup_fail_open", {
        erro: e.message || "manual_v2_scheduler_startup_falhou"
      });
    });
  });

  return {
    ok: true,
    iniciado: true,
    intervalMs
  };
}

function pararManualV2Scheduler() {
  if (estado.timer && typeof estado.clearInterval === "function") {
    estado.clearInterval(estado.timer);
  }
  estado.timer = null;
  estado.rodando = false;
  estado.intervalMs = 0;
}

module.exports = {
  INTERVALO_PADRAO_MS,
  INTERVALO_MINIMO_MS,
  intervaloManualV2Ms,
  listarClientesComAgendadas,
  rodarCicloManualV2Scheduler,
  iniciarManualV2Scheduler,
  pararManualV2Scheduler
};
