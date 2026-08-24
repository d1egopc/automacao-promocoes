const ESTADO_CLOSED = "closed";
const ESTADO_OPEN = "open";
const ESTADO_HALF_OPEN = "half_open";

function criarCircuitBreakerCopyV2({ falhasParaAbrir = 3, cooldownMs = 30 * 1000 } = {}) {
  let estado = ESTADO_CLOSED;
  let falhas = 0;
  let abertoEm = 0;

  function agora(opcoes = {}) {
    return Number(opcoes.nowMs) || Date.now();
  }

  return {
    estado() {
      return estado;
    },
    podeTentar(opcoes = {}) {
      if (estado !== ESTADO_OPEN) return true;
      if (agora(opcoes) - abertoEm >= cooldownMs) {
        estado = ESTADO_HALF_OPEN;
        return true;
      }
      return false;
    },
    registrarSucesso() {
      estado = ESTADO_CLOSED;
      falhas = 0;
      abertoEm = 0;
    },
    registrarFalha(opcoes = {}) {
      falhas += 1;
      if (falhas >= falhasParaAbrir) {
        estado = ESTADO_OPEN;
        abertoEm = agora(opcoes);
      }
    },
    reset() {
      estado = ESTADO_CLOSED;
      falhas = 0;
      abertoEm = 0;
    }
  };
}

module.exports = {
  ESTADO_CLOSED,
  ESTADO_OPEN,
  ESTADO_HALF_OPEN,
  criarCircuitBreakerCopyV2
};
