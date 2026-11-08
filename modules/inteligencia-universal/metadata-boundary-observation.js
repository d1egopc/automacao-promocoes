"use strict";

// Observacao exclusivamente diagnostica. Nao guarda payloads nem identificadores
// de oferta/workspace; apenas contadores agregados por fronteira e motivo fixo.
const BOUNDARIES = Object.freeze(["builder", "importer", "persistence", "distributor"]);
const REASONS = Object.freeze([
  "envelope_missing",
  "classification",
  "identity",
  "safety",
  "evidence",
  "affinities"
]);
const counters = new Map();
let flushScheduled = false;

function enabled(env = process.env) {
  return String(env.OPTIMUS_INTELLIGENCE_V1_MODE || "").trim().toLowerCase() === "shadow" &&
    String(env.OPTIMUS_INTELLIGENCE_V1_DISABLED || "").trim() !== "1";
}

function safeBoundary(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return BOUNDARIES.includes(normalized) ? normalized : "";
}

function safeReasons(reasons = []) {
  const values = Array.isArray(reasons) ? reasons : [reasons];
  const result = new Set();
  for (const value of values) {
    const normalized = String(value || "").trim().toLowerCase();
    if (REASONS.includes(normalized)) result.add(normalized);
  }
  return [...result].sort();
}

function reasonClassesFromValidationErrors(errors = []) {
  const values = Array.isArray(errors) ? errors : [errors];
  const result = new Set();
  for (const value of values) {
    const error = String(value || "").toLowerCase();
    if (/classification|bridge|classifier|version/.test(error)) result.add("classification");
    if (/identity/.test(error)) result.add("identity");
    if (/safety/.test(error)) result.add("safety");
    if (/evidence|principal/.test(error)) result.add("evidence");
    if (/affinit/.test(error)) result.add("affinities");
  }
  return [...result].sort();
}

function keyFor({ boundary, present, valid, outcome, reasons }) {
  return JSON.stringify({
    boundary,
    present: present === true,
    valid: valid === true,
    outcome: String(outcome || "observed").slice(0, 24),
    reasons
  });
}

function snapshot() {
  return [...counters.entries()].map(([key, count]) => ({ ...JSON.parse(key), count }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function flush() {
  flushScheduled = false;
  if (!counters.size) return;
  // O log e agregado e sanitizado; nao inclui payload, cliente, link ou oferta.
  console.log("[INTELLIGENCE-V1-METADATA-BOUNDARY]", JSON.stringify({
    version: 1,
    counters: snapshot()
  }));
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  const timer = setTimeout(flush, 250);
  if (typeof timer.unref === "function") timer.unref();
}

function observeMetadataBoundary(boundary, {
  present = false,
  valid = false,
  reasons = [],
  outcome = "observed",
  env = process.env
} = {}) {
  const safe = safeBoundary(boundary);
  if (!safe || !enabled(env)) return false;
  const normalizedReasons = safeReasons(reasons);
  const key = keyFor({
    boundary: safe,
    present,
    valid,
    outcome,
    reasons: normalizedReasons
  });
  counters.set(key, (counters.get(key) || 0) + 1);
  scheduleFlush();
  return true;
}

function reset() {
  counters.clear();
  flushScheduled = false;
}

module.exports = {
  BOUNDARIES,
  REASONS,
  enabled,
  reasonClassesFromValidationErrors,
  observeMetadataBoundary,
  snapshot,
  reset
};
