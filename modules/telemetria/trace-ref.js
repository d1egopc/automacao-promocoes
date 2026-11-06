"use strict";

const crypto = require("node:crypto");

// This is a correlation label, never a commercial or transport identifier.
// It is deterministic so old coverage IDs and new callback records can meet
// without exposing message IDs, JIDs, or the existing coberturaTraceId.
const TRACE_REF_PEPPER = "optimus_telemetria_trace_v1";

function texto(value = "") {
  return String(value ?? "").trim();
}

function coberturaDeMensagem(messageId = "") {
  const id = texto(messageId);
  if (!id || id.length > 200) return "";
  const digest = crypto
    .createHash("sha256")
    .update(`mensagem:${id}`)
    .digest("hex")
    .slice(0, 16);
  return `cov_${digest}`;
}

function sanitizarTraceRef(value = "", { messageId = "" } = {}) {
  const source = texto(value) || coberturaDeMensagem(messageId);
  if (!source) return null;
  if (/^tr_[a-f0-9]{24}$/.test(source)) return source;
  return `tr_${crypto
    .createHmac("sha256", TRACE_REF_PEPPER)
    .update(source)
    .digest("hex")
    .slice(0, 24)}`;
}

function extrairTraceRef(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const direct = texto(source.traceRef || source.trace_ref || "");
    if (direct) return sanitizarTraceRef(direct);
    const coverage = texto(
      source.coberturaTraceId || source.cobertura_trace_id || "",
    );
    if (coverage) return sanitizarTraceRef(coverage);
    // Existing ingress journals persist only the opaque eventRef. Reusing it
    // keeps old records correlatable without changing the journal schema.
    const eventRef = texto(source.eventRef || source.event_ref || "");
    if (/^[a-f0-9]{16}$/.test(eventRef)) return sanitizarTraceRef(eventRef);
    const metadata = source.metadata && typeof source.metadata === "object"
      ? source.metadata
      : source.detalhes && typeof source.detalhes === "object"
        ? source.detalhes
        : null;
    if (metadata) {
      const nested = extrairTraceRef(metadata);
      if (nested) return nested;
    }
  }
  return null;
}

module.exports = {
  coberturaDeMensagem,
  sanitizarTraceRef,
  extrairTraceRef,
};
