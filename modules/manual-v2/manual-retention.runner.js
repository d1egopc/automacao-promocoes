const {
  listClientes
} = require("../../utils/storage");
const {
  limparRetencaoManualV2Cliente
} = require("./manual-retention");

const INTERVALO_RETENCAO_PADRAO_MS = 6 * 60 * 60 * 1000;
const INTERVALO_RETENCAO_MINIMO_MS = 60 * 60 * 1000;

const estado = {
  timer: null,
  rodando: false,
  intervalMs: 0,
  clearInterval: null
};

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function inteiro(valor = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? Math.floor(numero) : 0;
}

function intervaloRetencaoManualV2Ms(valor = process.env.MANUAL_V2_RETENTION_INTERVAL_MS) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return INTERVALO_RETENCAO_PADRAO_MS;
  return Math.max(INTERVALO_RETENCAO_MINIMO_MS, Math.floor(numero));
}

function loggerSeguro(deps = {}) {
  const logger = deps.logger || console;
  return typeof logger.log === "function" ? logger : console;
}

function logar(deps = {}, evento = "", dados = {}) {
  loggerSeguro(deps).log(`[MANUAL-V2-RETENTION] ${evento}`, dados);
}

function clientesRetencaoManualV2(deps = {}) {
  const listar = deps.listClientes || listClientes;
  const clientes = Array.isArray(deps.clientes) ? deps.clientes : listar();
  return clientes.map(texto).filter(Boolean);
}

function somarPorStatus(destino = {}, origem = {}) {
  for (const [status, quantidade] of Object.entries(origem || {})) {
    const chave = texto(status) || "desconhecido";
    destino[chave] = inteiro(destino[chave]) + inteiro(quantidade);
  }
  return destino;
}

async function rodarCicloRetencaoManualV2(deps = {}) {
  if (estado.rodando) {
    return {
      ok: true,
      pulado: true,
      motivo: "ciclo_em_execucao",
      clientesProcessados: 0,
      clientesComErro: 0,
      removidos: 0,
      preservados: 0,
      porStatus: {}
    };
  }

  estado.rodando = true;
  try {
    const clientes = clientesRetencaoManualV2(deps);
    if (!clientes.length) {
      return {
        ok: true,
        semTrabalho: true,
        clientesProcessados: 0,
        clientesComErro: 0,
        removidos: 0,
        preservados: 0,
        porStatus: {}
      };
    }

    const limparCliente = deps.limparRetencaoManualV2Cliente || limparRetencaoManualV2Cliente;
    const opcoes = {
      now: deps.now,
      retentionDays: deps.retentionDays ?? deps.retencaoDias
    };
    const storageDeps = deps.storageOptions || {};
    const resumo = {
      ok: true,
      clientesProcessados: 0,
      clientesComErro: 0,
      removidos: 0,
      preservados: 0,
      porStatus: {}
    };

    for (const clienteId of clientes) {
      try {
        const resultado = await limparCliente(clienteId, opcoes, storageDeps);
        resumo.clientesProcessados += 1;
        resumo.removidos += inteiro(resultado?.removidos);
        resumo.preservados += inteiro(resultado?.preservados);
        somarPorStatus(resumo.porStatus, resultado?.porStatus || {});
      } catch (e) {
        resumo.ok = false;
        resumo.clientesComErro += 1;
        logar(deps, "cliente_erro_fail_open", {
          clienteId,
          erro: e.message || "manual_v2_retention_cliente_falhou"
        });
      }
    }

    if (resumo.removidos > 0 || resumo.clientesComErro > 0) {
      logar(deps, "ciclo_finalizado", resumo);
    }

    return resumo;
  } catch (e) {
    logar(deps, "erro_fail_open", {
      erro: e.message || "manual_v2_retention_falhou"
    });
    return {
      ok: false,
      erro: e.message || "manual_v2_retention_falhou",
      clientesProcessados: 0,
      clientesComErro: 0,
      removidos: 0,
      preservados: 0,
      porStatus: {}
    };
  } finally {
    estado.rodando = false;
  }
}

function iniciarManualV2Retention(deps = {}) {
  if (estado.timer) {
    return {
      ok: true,
      iniciado: false,
      motivo: "manual_v2_retention_ja_iniciado",
      intervalMs: estado.intervalMs
    };
  }

  const intervalMs = intervaloRetencaoManualV2Ms(deps.intervalMs);
  const setIntervalFn = deps.setInterval || setInterval;
  const clearIntervalFn = deps.clearInterval || clearInterval;
  const defer = deps.defer || ((fn) => Promise.resolve().then(fn));
  const ciclo = () => rodarCicloRetencaoManualV2(deps);

  estado.intervalMs = intervalMs;
  estado.clearInterval = clearIntervalFn;
  estado.timer = setIntervalFn(() => {
    ciclo().catch((e) => {
      logar(deps, "erro_intervalo_fail_open", {
        erro: e.message || "manual_v2_retention_intervalo_falhou"
      });
    });
  }, intervalMs);

  if (estado.timer && typeof estado.timer.unref === "function") {
    estado.timer.unref();
  }

  defer(() => {
    ciclo().catch((e) => {
      logar(deps, "erro_startup_fail_open", {
        erro: e.message || "manual_v2_retention_startup_falhou"
      });
    });
  });

  return {
    ok: true,
    iniciado: true,
    intervalMs
  };
}

function pararManualV2Retention() {
  if (estado.timer && typeof estado.clearInterval === "function") {
    estado.clearInterval(estado.timer);
  }
  estado.timer = null;
  estado.rodando = false;
  estado.intervalMs = 0;
  estado.clearInterval = null;
}

module.exports = {
  INTERVALO_RETENCAO_PADRAO_MS,
  INTERVALO_RETENCAO_MINIMO_MS,
  intervaloRetencaoManualV2Ms,
  clientesRetencaoManualV2,
  rodarCicloRetencaoManualV2,
  iniciarManualV2Retention,
  pararManualV2Retention
};
