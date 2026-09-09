"use strict";

const { resolverFilaItemId } = require("./fila-claims-shadow.service");
const { resolverOrigemFluxo } = require("../../utils/origem-fluxo");

function texto(valor = "", limite = 160) {
  return String(valor || "").trim().slice(0, limite);
}

function agoraMonotono() {
  return typeof process.hrtime?.bigint === "function" ? process.hrtime.bigint() : null;
}

function duracaoMs(inicioMonotono, inicioFallback) {
  if (typeof inicioMonotono === "bigint") return Number(process.hrtime.bigint() - inicioMonotono) / 1e6;
  return Math.max(0, Date.now() - Number(inicioFallback || Date.now()));
}

function dadosSeguro(estado = {}, extras = {}) {
  return {
    clienteId: texto(estado.clienteId),
    filaItemId: texto(estado.filaItemId),
    resultado: texto(estado.resultado),
    origemFluxo: texto(estado.origemFluxo),
    ...extras
  };
}

function criarCatracaAdvisoryFuncionalFila({ repository, logger = console, now = () => Date.now() } = {}) {
  if (!repository || typeof repository.adquirirAdvisoryLockFila !== "function" ||
    typeof repository.liberarAdvisoryLockFila !== "function") {
    throw new Error("fila_advisory_functional_repository_invalido");
  }

  const logar = (evento, dados) => {
    try {
      (typeof logger?.log === "function" ? logger : console).log(evento, JSON.stringify(dados));
    } catch {}
  };

  async function adquirir({ clienteId = "", oferta = {} } = {}) {
    const estado = {
      clienteId: texto(clienteId || oferta?.clienteId || "admin"),
      filaItemId: resolverFilaItemId(oferta),
      origemFluxo: texto(resolverOrigemFluxo(oferta)),
      resultado: "",
      handle: null,
      inicioMonotono: agoraMonotono(),
      inicioFallback: now()
    };

    if (!estado.filaItemId) {
      estado.resultado = "identidade_ausente";
      logar("[FILA-ADVISORY-FUNCIONAL]", dadosSeguro(estado));
      return estado;
    }

    try {
      const resultado = await repository.adquirirAdvisoryLockFila({
        clienteId: estado.clienteId,
        filaItemId: estado.filaItemId
      });
      estado.resultado = resultado?.adquirido === true ? "adquirido" : "ocupado";
      estado.handle = resultado?.handle || null;
    } catch {
      estado.resultado = "erro";
    }
    logar("[FILA-ADVISORY-FUNCIONAL]", dadosSeguro(estado));
    return estado;
  }

  async function finalizar(estado = null, { statusFinal = "" } = {}) {
    if (!estado || estado.resultado !== "adquirido" || !estado.handle) return null;
    let liberacao = "nao_liberado";
    try {
      const resultado = await repository.liberarAdvisoryLockFila(estado.handle);
      liberacao = resultado?.liberado === true ? "liberado" : "nao_liberado";
    } catch {
      liberacao = "erro";
    }
    const dados = dadosSeguro(estado, {
      statusFinal: texto(statusFinal),
      duracaoMs: Math.round(duracaoMs(estado.inicioMonotono, estado.inicioFallback)),
      liberacao
    });
    logar("[FILA-ADVISORY-FUNCIONAL-FIM]", dados);
    return dados;
  }

  return { adquirir, finalizar };
}

module.exports = { criarCatracaAdvisoryFuncionalFila };
