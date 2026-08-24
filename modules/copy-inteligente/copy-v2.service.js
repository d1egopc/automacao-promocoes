const { validarCopyV2 } = require("./validator-v2");
const providerClient = require("./provider-client");
const cacheV2 = require("./cache-v2");
const { criarCircuitBreakerCopyV2 } = require("./circuit-breaker-v2");
const quotaV2 = require("./quota-v2");
const { emitirEventoCopyV2 } = require("./observabilidade-v2");

const inflight = new Map();
const breakers = new Map();
const MAX_BREAKERS_COPY_V2 = 500;
const REASON_CODES_COPY_V2 = new Set([
  "ok",
  "timeout",
  "provider_error",
  "provider_rate_limited",
  "provider_invalid_response",
  "validator_rejected",
  "cache_error",
  "quota_error",
  "quota_excedida",
  "circuit_open",
  "singleflight_error",
  "context_invalid",
  "internal_error",
  "shadow_desligado",
  "feature_copyIaGenerativa_indisponivel"
]);

function planoPermiteCopyIaGenerativa(plano = {}) {
  return plano?.recursos?.copyIaGenerativa === true;
}

function latenciaBucket(ms = 0) {
  if (ms < 250) return "lt_250ms";
  if (ms < 750) return "lt_750ms";
  if (ms < 1500) return "lt_1500ms";
  return "gte_1500ms";
}

function falha(motivo = "fallback_v1", extra = {}) {
  const motivoSeguro = reasonCodeSeguro(motivo);
  return {
    ok: false,
    texto: "",
    motivo: motivoSeguro,
    fallback: "v1",
    ...extra
  };
}

function reasonCodeSeguro(motivo = "") {
  const valor = String(motivo || "").trim();
  if (valor === "rate_limited") return "provider_rate_limited";
  if (valor === "provider_resposta_invalida") return "provider_invalid_response";
  if (valor === "provider_indisponivel" || valor === "provider_erro" || valor === "fake_provider_falha") return "provider_error";
  if (valor === "cache_key_invalida") return "context_invalid";
  if (valor === "copy_reprovada") return "validator_rejected";
  return REASON_CODES_COPY_V2.has(valor) ? valor : "internal_error";
}

function emitirEventoSeguro(evento, payload = {}, logger = null) {
  try {
    return emitirEventoCopyV2(evento, {
      ...payload,
      reasonCode: reasonCodeSeguro(payload.reasonCode)
    }, { logger });
  } catch (_) {
    return null;
  }
}

function chaveBreakerCopyV2(contexto = {}, providerAlias = "fake", modelAlias = "fake-copy-v2") {
  const workspaceHash = String(contexto.workspaceHash || "");
  if (!workspaceHash) return "";
  return `${workspaceHash}:${providerAlias}:${modelAlias}`;
}

function limitarBreakersCopyV2() {
  while (breakers.size > MAX_BREAKERS_COPY_V2) {
    const primeira = breakers.keys().next().value;
    if (!primeira) break;
    breakers.delete(primeira);
  }
}

function resolverCircuitBreakerCopyV2(contexto = {}, providerAlias = "fake", modelAlias = "fake-copy-v2") {
  const chave = chaveBreakerCopyV2(contexto, providerAlias, modelAlias);
  if (!chave) return criarCircuitBreakerCopyV2();
  if (!breakers.has(chave)) {
    breakers.set(chave, criarCircuitBreakerCopyV2());
    limitarBreakersCopyV2();
  }
  return breakers.get(chave);
}

function registrarFalhaBreakerSeguro(circuitBreaker, quota = {}) {
  try {
    circuitBreaker.registrarFalha({ nowMs: quota.nowMs });
  } catch (_) {
    // Falha no breaker nunca pode vazar para o caminho operacional.
  }
}

function registrarSucessoBreakerSeguro(circuitBreaker) {
  try {
    circuitBreaker.registrarSucesso();
  } catch (_) {
    // Falha no breaker nunca pode vazar para o caminho operacional.
  }
}

async function resolverCopyV2(entrada = {}) {
  try {
    const { contexto = {}, plano = {}, provider = null, shadowMode = false, opcoesProvider = {}, quota = {}, logger = null, circuitBreaker = null, ttlMs } = entrada || {};
    if (shadowMode !== true) return falha("shadow_desligado");
    if (!planoPermiteCopyIaGenerativa(plano)) return falha("feature_copyIaGenerativa_indisponivel");

    const providerAlias = opcoesProvider.providerAlias || "fake";
    const modelAlias = opcoesProvider.modelAlias || "fake-copy-v2";
    let cacheKey = "";
    try {
      cacheKey = cacheV2.chaveCacheCopyV2(contexto, { providerAlias, modelAlias, promptVersion: opcoesProvider.promptVersion });
    } catch (_) {
      return falha("cache_error");
    }
    if (!cacheKey) return falha("context_invalid");

    let cached = null;
    try {
      cached = cacheV2.lerCacheCopyV2(cacheKey);
    } catch (_) {
      return falha("cache_error");
    }
    if (cached?.texto) {
      emitirEventoSeguro("copy_v2_cache_hit", {
        workspaceHash: contexto.workspaceHash,
        ofertaKeyHash: contexto.ofertaKeyHash,
        intencao: contexto.intencao,
        estilo: contexto.estilo,
        providerAlias,
        modelAlias,
        reasonCode: "ok"
      }, logger);
      return { ...cached, cacheHit: true };
    }

    if (inflight.has(cacheKey)) {
      try {
        return await inflight.get(cacheKey);
      } catch (_) {
        return falha("singleflight_error");
      }
    }

    const promise = executarGeracaoCopyV2({ contexto, plano, provider, opcoesProvider, quota, logger, circuitBreaker, ttlMs, providerAlias, modelAlias, cacheKey });
    inflight.set(cacheKey, promise);
    try {
      return await promise;
    } catch (_) {
      return falha("singleflight_error");
    } finally {
      inflight.delete(cacheKey);
    }
  } catch (_) {
    return falha("internal_error");
  }
}

async function executarGeracaoCopyV2({ contexto = {}, provider = null, opcoesProvider = {}, quota = {}, logger = null, circuitBreaker = null, ttlMs, providerAlias = "fake", modelAlias = "fake-copy-v2", cacheKey = "" } = {}) {
  try {
    const breaker = circuitBreaker || resolverCircuitBreakerCopyV2(contexto, providerAlias, modelAlias);
    let podeTentar = false;
    try {
      podeTentar = breaker.podeTentar({ nowMs: quota.nowMs });
    } catch (_) {
      return falha("internal_error");
    }

    if (!podeTentar) {
      emitirEventoSeguro("copy_v2_circuit_open", {
        workspaceHash: contexto.workspaceHash,
        ofertaKeyHash: contexto.ofertaKeyHash,
        intencao: contexto.intencao,
        estilo: contexto.estilo,
        providerAlias,
        modelAlias,
        reasonCode: "circuit_open"
      }, logger);
      return falha("circuit_open");
    }

    let quotaResultado = null;
    try {
      quotaResultado = quotaV2.consumirQuotaCopyV2(contexto.workspaceHash, quota);
    } catch (_) {
      return falha("quota_error");
    }
    if (!quotaResultado.ok) {
      emitirEventoSeguro("copy_v2_quota_excedida", {
      workspaceHash: contexto.workspaceHash,
      ofertaKeyHash: contexto.ofertaKeyHash,
      intencao: contexto.intencao,
      estilo: contexto.estilo,
      providerAlias,
      modelAlias,
        reasonCode: "quota_excedida"
      }, logger);
      return falha("quota_excedida");
    }

    const inicio = Date.now();
    const bruto = await providerClient.gerarCopy(contexto, { ...opcoesProvider, provider });
    const latencyBucket = latenciaBucket(Date.now() - inicio);

    if (!bruto.ok) {
      registrarFalhaBreakerSeguro(breaker, quota);
      const motivoSeguro = reasonCodeSeguro(bruto.motivo || "provider_error");
      const evento = motivoSeguro === "timeout"
        ? "copy_v2_timeout"
        : motivoSeguro === "provider_rate_limited"
          ? "copy_v2_provider_rate_limited"
          : "copy_v2_fallback_v1";
      emitirEventoSeguro(evento, {
        workspaceHash: contexto.workspaceHash,
        ofertaKeyHash: contexto.ofertaKeyHash,
        intencao: contexto.intencao,
        estilo: contexto.estilo,
        providerAlias,
        modelAlias,
        latencyBucket,
        reasonCode: motivoSeguro
      }, logger);
      return falha(motivoSeguro, { latencyBucket });
    }

    let validacao = null;
    try {
      validacao = validarCopyV2({ textoGerado: bruto.texto, contexto });
    } catch (_) {
      return falha("validator_rejected", { latencyBucket });
    }
    if (!validacao.valida) {
      registrarSucessoBreakerSeguro(breaker);
      emitirEventoSeguro("copy_v2_reprovada", {
        workspaceHash: contexto.workspaceHash,
        ofertaKeyHash: contexto.ofertaKeyHash,
        intencao: contexto.intencao,
        estilo: contexto.estilo,
        providerAlias,
        modelAlias,
        latencyBucket,
        reasonCode: "validator_rejected"
      }, logger);
      return falha("validator_rejected", { motivoCodigo: reasonCodeSeguro(validacao.motivoCodigo), latencyBucket });
    }

    registrarSucessoBreakerSeguro(breaker);
    const resultado = {
      ok: true,
      texto: validacao.texto,
      fonte: "copy_v2_provider",
      cacheHit: false,
      providerAlias,
      modelAlias,
      latencyBucket
    };
    try {
      cacheV2.salvarCacheCopyV2(cacheKey, resultado, ttlMs);
    } catch (_) {
      return falha("cache_error", { latencyBucket });
    }
    emitirEventoSeguro("copy_v2_gerada", {
      workspaceHash: contexto.workspaceHash,
      ofertaKeyHash: contexto.ofertaKeyHash,
      intencao: contexto.intencao,
      estilo: contexto.estilo,
      providerAlias,
      modelAlias,
      latencyBucket,
      reasonCode: "ok"
    }, logger);
    return resultado;
  } catch (_) {
    return falha("internal_error");
  }
}

function limparInflightCopyV2() {
  inflight.clear();
}

function limparCircuitBreakersCopyV2() {
  breakers.clear();
}

module.exports = {
  MAX_BREAKERS_COPY_V2,
  REASON_CODES_COPY_V2: Array.from(REASON_CODES_COPY_V2),
  planoPermiteCopyIaGenerativa,
  reasonCodeSeguro,
  chaveBreakerCopyV2,
  resolverCircuitBreakerCopyV2,
  resolverCopyV2,
  limparInflightCopyV2,
  limparCircuitBreakersCopyV2,
  latenciaBucket
};
