"use strict";

const {
  ORIGEM_FLUXO_OPTIMUS,
  ORIGEM_FLUXO_CLONADOR_GRUPOS,
  resolverOrigemFluxo
} = require("../../utils/origem-fluxo");

// Janela exclusivamente diagnóstica: evita uma linha shadow eterna se o
// processo encerrar antes do finally. Não participa de seleção, bloqueio,
// recovery ou de qualquer política operacional de TTL.
const LEASE_SHADOW_DIAGNOSTICO_MS = 15 * 60 * 1000;

function texto(valor = "", limite = 160) {
  return String(valor || "").trim().slice(0, limite);
}

function resolverFilaItemId(item = {}) {
  const oferta = item && typeof item === "object" ? item : {};
  const candidatos = [oferta.id, oferta.ofertaId, oferta.engineOfertaId];
  for (const candidato of candidatos) {
    const filaItemId = texto(candidato);
    if (filaItemId && !/^indice:/i.test(filaItemId)) return filaItemId;
  }
  return "";
}

function agoraMonotono() {
  if (typeof process.hrtime?.bigint === "function") return process.hrtime.bigint();
  return null;
}

function duracaoMs(inicioMonotono, inicioFallback, agora = Date.now()) {
  if (typeof inicioMonotono === "bigint") return Number(process.hrtime.bigint() - inicioMonotono) / 1e6;
  return Math.max(0, Number(agora) - Number(inicioFallback || agora));
}

function origemProtegida(oferta = {}) {
  const origem = resolverOrigemFluxo(oferta);
  return origem === ORIGEM_FLUXO_OPTIMUS || origem === ORIGEM_FLUXO_CLONADOR_GRUPOS
    ? origem
    : "";
}

function dadosSeguro(estado = {}, extras = {}) {
  return {
    clienteId: texto(estado.clienteId),
    filaItemId: texto(estado.filaItemId),
    resultadoClaim: texto(estado.resultadoClaim),
    origemFluxo: texto(estado.origemFluxo),
    marketplace: texto(estado.marketplace, 80),
    ...extras
  };
}

function criarObservadorClaimShadowFila({ repository, logger = console, now = () => Date.now() } = {}) {
  if (!repository || typeof repository.adquirirClaimFila !== "function") {
    throw new Error("fila_claim_shadow_repository_invalido");
  }

  const logar = (evento, dados) => {
    const destino = typeof logger?.log === "function" ? logger : console;
    try {
      destino.log(evento, JSON.stringify(dados));
    } catch {}
  };

  async function iniciar({ clienteId = "", oferta = {} } = {}) {
    const estado = {
      clienteId: texto(clienteId || oferta?.clienteId || "admin"),
      filaItemId: resolverFilaItemId(oferta),
      origemFluxo: origemProtegida(oferta),
      marketplace: texto(oferta?.marketplace || oferta?.mercado || "", 80),
      inicioMonotono: agoraMonotono(),
      inicioFallback: now(),
      resultadoClaim: "",
      claimToken: ""
    };

    if (!estado.filaItemId) {
      estado.resultadoClaim = "identidade_ausente";
      logar("[FILA-CLAIM-SHADOW]", dadosSeguro(estado));
      return estado;
    }

    try {
      const resultado = await repository.adquirirClaimFila({
        clienteId: estado.clienteId,
        filaItemId: estado.filaItemId,
        leaseExpiresAt: new Date(now() + LEASE_SHADOW_DIAGNOSTICO_MS)
      });
      estado.resultadoClaim = resultado?.adquirido === true ? "adquirido" : "perdido";
      estado.claimToken = texto(resultado?.claim?.claimToken, 80);
    } catch {
      estado.resultadoClaim = "erro";
    }

    logar("[FILA-CLAIM-SHADOW]", dadosSeguro(estado));
    return estado;
  }

  async function finalizar(estado = null, { oferta = {}, statusFinal = "" } = {}) {
    if (!estado) return null;

    let liberacao = "nao_aplicavel";
    if (estado.resultadoClaim === "adquirido" && estado.claimToken) {
      try {
        const resultado = await repository.liberarClaimFila({
          clienteId: estado.clienteId,
          filaItemId: estado.filaItemId,
          claimToken: estado.claimToken
        });
        liberacao = resultado?.liberado === true ? "liberado" : "nao_liberado";
      } catch {
        liberacao = "erro";
      }
    }

    const final = texto(statusFinal || oferta?.status || "");
    const dados = dadosSeguro(estado, {
      duracaoMs: Math.round(duracaoMs(estado.inicioMonotono, estado.inicioFallback, now())),
      statusFinal: final,
      voltouPendente: final === "pendente",
      liberacao
    });
    logar("[FILA-CLAIM-SHADOW-FIM]", dados);
    return dados;
  }

  return { iniciar, finalizar };
}

module.exports = {
  LEASE_SHADOW_DIAGNOSTICO_MS,
  resolverFilaItemId,
  criarObservadorClaimShadowFila
};
