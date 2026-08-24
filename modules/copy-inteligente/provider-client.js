const TIMEOUT_PADRAO_COPY_V2_MS = 1200;
const TIMEOUT_MAX_COPY_V2_MS = 3000;

function timeoutMsConfigurado(valor = TIMEOUT_PADRAO_COPY_V2_MS) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return TIMEOUT_PADRAO_COPY_V2_MS;
  return Math.min(numero, TIMEOUT_MAX_COPY_V2_MS);
}

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class FakeCopyV2Provider {
  constructor({ texto = "Oferta segura para aproveitar", atrasoMs = 0, falhar = false, motivoFalha = "fake_provider_falha" } = {}) {
    this.texto = texto;
    this.atrasoMs = atrasoMs;
    this.falhar = falhar;
    this.motivoFalha = motivoFalha;
    this.chamadas = 0;
  }

  async gerar(contexto = {}) {
    this.chamadas += 1;
    if (this.atrasoMs > 0) await esperar(this.atrasoMs);
    if (this.falhar) return { ok: false, motivo: this.motivoFalha };
    return { ok: true, texto: this.texto, providerAlias: "fake", modelAlias: "fake-copy-v2", contexto };
  }
}

async function gerarCopy(contexto = {}, opcoes = {}) {
  const provider = opcoes.provider;
  if (!provider || typeof provider.gerar !== "function") {
    return { ok: false, motivo: "provider_indisponivel" };
  }

  const timeoutMs = timeoutMsConfigurado(opcoes.timeoutMs);
  let timer = null;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const signal = opcoes.signal || controller?.signal || null;
  try {
    const chamada = Promise.resolve(provider.gerar(contexto, { ...opcoes, signal }));
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        resolve({ ok: false, motivo: "timeout" });
      }, timeoutMs);
    });
    const resultado = await Promise.race([chamada, timeout]);
    if (!resultado || typeof resultado !== "object") return { ok: false, motivo: "provider_resposta_invalida" };
    return resultado;
  } catch (erro) {
    return { ok: false, motivo: erro?.message || "provider_erro" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  TIMEOUT_PADRAO_COPY_V2_MS,
  TIMEOUT_MAX_COPY_V2_MS,
  timeoutMsConfigurado,
  FakeCopyV2Provider,
  gerarCopy
};
