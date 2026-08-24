const EVENTOS_COPY_V2 = new Set([
  "copy_v2_cache_hit",
  "copy_v2_gerada",
  "copy_v2_reprovada",
  "copy_v2_timeout",
  "copy_v2_fallback_v1",
  "copy_v2_fallback_original",
  "copy_v2_provider_rate_limited",
  "copy_v2_circuit_open",
  "copy_v2_quota_excedida"
]);

const CAMPOS_PERMITIDOS = [
  "workspaceHash",
  "ofertaKeyHash",
  "intencao",
  "estilo",
  "promptVersion",
  "providerAlias",
  "modelAlias",
  "latencyBucket",
  "reasonCode"
];

function payloadSanitizadoCopyV2(payload = {}) {
  const out = {};
  for (const campo of CAMPOS_PERMITIDOS) {
    if (payload[campo] === undefined || payload[campo] === null) continue;
    out[campo] = String(payload[campo]).slice(0, 80);
  }
  return out;
}

function emitirEventoCopyV2(evento = "", payload = {}, opcoes = {}) {
  const nome = String(evento || "");
  if (!EVENTOS_COPY_V2.has(nome)) return null;
  const seguro = payloadSanitizadoCopyV2(payload);
  if (typeof opcoes.logger === "function") {
    try {
      opcoes.logger(nome, seguro);
    } catch (_) {
      return null;
    }
  }
  return { evento: nome, payload: seguro };
}

module.exports = {
  EVENTOS_COPY_V2: Array.from(EVENTOS_COPY_V2),
  CAMPOS_PERMITIDOS_COPY_V2: CAMPOS_PERMITIDOS,
  payloadSanitizadoCopyV2,
  emitirEventoCopyV2
};
